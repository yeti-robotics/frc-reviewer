import * as core from '@actions/core'
import type { Context } from '@actions/github/lib/context.js'
import type { Octokit } from '@octokit/rest'
import { getProvider } from './providers/index.js'
import { getPRFiles, getFileContent, parseDiffPositions } from './github/diff.js'
import {
  findLastReviewSHA,
  postSummaryComment,
  postInlineReview,
  formatSummaryComment,
  type InlineComment,
} from './github/comments.js'
import { loadSkills } from './skills/loader.js'
import { matchSkills } from './skills/matcher.js'
import { summarizePR } from './passes/summarize.js'
import { reviewPR } from './passes/review.js'
import { verifyIssues } from './passes/verify.js'

export interface ActionInputs {
  apiKey: string
  gateway: string
  model: string
  fastModel?: string
  skillsPath: string
  failOnCritical: boolean
  octokit: Octokit
  context: Context
}

export async function runPipeline(inputs: ActionInputs): Promise<void> {
  const { octokit, context, apiKey, gateway, model, fastModel, skillsPath, failOnCritical } =
    inputs

  const { owner, repo } = context.repo

  // Resolve PR number from either a PR event or an issue_comment event
  const prNumber =
    context.payload.pull_request?.number ?? context.payload.issue?.number
  if (!prNumber) throw new Error('Could not determine PR number from event context')

  // Get PR details
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  })

  const headSHA = pr.head.sha
  const baseSHA = pr.base.sha

  core.info(`Reviewing PR #${prNumber}: ${pr.title}`)
  core.info(`HEAD: ${headSHA}`)

  // Check for incremental review
  const lastSHA = await findLastReviewSHA(octokit, context)
  if (lastSHA) {
    core.info(`Incremental review: last reviewed SHA was ${lastSHA}`)
  }

  // 1. Load PR files
  const allFiles = await getPRFiles(octokit, owner, repo, prNumber)
  core.info(`Found ${allFiles.length} changed files`)

  // Filter to files changed since last review if incremental
  // For now, review all files (incremental filtering can use commit comparison)
  const filesToReview = lastSHA
    ? await getFilesChangedSince(octokit, owner, repo, lastSHA, headSHA, allFiles)
    : allFiles

  if (filesToReview.length === 0) {
    core.info('No new files to review since last review.')
    return
  }

  // 2. Load and match skills
  const allSkills = await loadSkills(skillsPath)
  const filenames = filesToReview.map((f) => f.filename)
  const relevantSkills = matchSkills(allSkills, filenames)
  core.info(`Using ${relevantSkills.length} relevant skills`)

  // 3. Pass 1: Summarize (use fast model if provided)
  const summarizeModel = getProvider(gateway, apiKey, fastModel ?? model)
  core.info('Pass 1: Summarizing PR...')
  const summary = await summarizePR(summarizeModel, filesToReview)

  // 4. Load full content for architecturally significant files
  const significantFiles = summary.files.filter((f) => f.architecturallySignificant)
  const fileContents = new Map<string, string>()

  await Promise.all(
    significantFiles.map(async (f) => {
      const content = await getFileContent(octokit, owner, repo, headSHA, f.filename)
      if (content) fileContents.set(f.filename, content)
    }),
  )

  // Also load content for files that appear in issues (for verify pass)
  // We'll do this after the review pass

  // 5. Pass 2: Review
  const reviewModel = getProvider(gateway, apiKey, model)
  core.info('Pass 2: Reviewing for issues...')
  const candidates = await reviewPR(reviewModel, summary, filesToReview, fileContents, relevantSkills)
  core.info(`Found ${candidates.length} candidate issues`)

  if (candidates.length === 0) {
    const summaryText = formatSummaryComment(summary.prGoal, summary.files, [])
    await postSummaryComment(octokit, context, summaryText, headSHA)
    core.info('No issues found. Posted summary comment.')
    return
  }

  // Load content for any files referenced in issues that weren't already loaded
  const issueFiles = [...new Set(candidates.map((i) => i.file))]
  await Promise.all(
    issueFiles
      .filter((f) => !fileContents.has(f))
      .map(async (f) => {
        const content = await getFileContent(octokit, owner, repo, headSHA, f)
        if (content) fileContents.set(f, content)
      }),
  )

  // 6. Pass 3: Verify (parallel)
  core.info('Pass 3: Verifying issues...')
  const confirmedIssues = await verifyIssues(reviewModel, candidates, fileContents)
  core.info(`Confirmed ${confirmedIssues.length} issues after verification`)

  // 7. Map line numbers → diff positions for inline comments
  const positionMaps = new Map<string, Map<number, number>>()
  for (const file of filesToReview) {
    if (file.patch) {
      positionMaps.set(file.filename, parseDiffPositions(file.patch))
    }
  }

  const inlineComments: InlineComment[] = []
  for (const issue of confirmedIssues) {
    const posMap = positionMaps.get(issue.file)
    if (!posMap) {
      core.warning(`No diff positions found for ${issue.file}, skipping inline comment`)
      continue
    }

    const position = posMap.get(issue.line)
    if (position === undefined) {
      core.warning(
        `Line ${issue.line} in ${issue.file} not found in diff positions, skipping inline comment`,
      )
      continue
    }

    inlineComments.push({
      path: issue.file,
      position,
      body: `**[${issue.severity.toUpperCase()}]** ${issue.message}\n\n_Skill: ${issue.skill}_`,
    })
  }

  // 8. Post summary comment
  const summaryText = formatSummaryComment(summary.prGoal, summary.files, confirmedIssues)
  await postSummaryComment(octokit, context, summaryText, headSHA)

  // 9. Post inline review
  if (inlineComments.length > 0) {
    await postInlineReview(octokit, context, inlineComments)
    core.info(`Posted ${inlineComments.length} inline review comments`)
  }

  // 10. Fail if critical issues found and fail-on-critical is enabled
  const criticalIssues = confirmedIssues.filter((i) => i.severity === 'critical')
  if (failOnCritical && criticalIssues.length > 0) {
    core.setFailed(
      `Found ${criticalIssues.length} critical issue(s). Review the PR comments for details.`,
    )
  }
}

async function getFilesChangedSince(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseSHA: string,
  headSHA: string,
  allFiles: Awaited<ReturnType<typeof getPRFiles>>,
): Promise<Awaited<ReturnType<typeof getPRFiles>>> {
  try {
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseSHA}...${headSHA}`,
    })

    const changedFilenames = new Set(data.files?.map((f) => f.filename) ?? [])
    return allFiles.filter((f) => changedFilenames.has(f.filename))
  } catch {
    // Fall back to reviewing all files if comparison fails
    core.warning(`Could not compare commits ${baseSHA}...${headSHA}, reviewing all files`)
    return allFiles
  }
}
