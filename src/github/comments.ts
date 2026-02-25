import type { Octokit } from '@octokit/rest'
import type { Context } from '@actions/github/lib/context.js'
import type { Issue } from '../passes/review.js'

const STATE_MARKER = 'frc-reviewer:state'

interface ReviewState {
  sha: string
  timestamp: string
}

function makeStateComment(state: ReviewState): string {
  return `<!-- ${STATE_MARKER} ${JSON.stringify(state)} -->`
}

// Matches only the exact format we write: {"sha":"<40 hex chars>","timestamp":"<ISO string>"}
// Using character-class constraints instead of .* prevents ReDoS on malformed comments.
const STATE_COMMENT_RE = new RegExp(
  `<!-- ${STATE_MARKER} (\\{"sha":"[0-9a-f]{40}","timestamp":"[^"]{1,64}"\\}) -->`,
)

function parseStateComment(body: string): ReviewState | null {
  // Bail early if the comment is implausibly large to avoid running the regex
  // against enormous comment bodies.
  if (body.length > 10_000) return null
  const match = body.match(STATE_COMMENT_RE)
  if (!match || !match[1]) return null
  try {
    return JSON.parse(match[1]) as ReviewState
  } catch {
    return null
  }
}

export async function findLastReviewSHA(
  octokit: Octokit,
  ctx: Context,
): Promise<string | null> {
  const prNumber = ctx.payload.pull_request?.number ?? ctx.payload.issue?.number
  if (!prNumber) return null

  const { owner, repo } = ctx.repo

  let page = 1
  let lastSHA: string | null = null

  while (true) {
    const { data } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
      page,
    })

    for (const comment of data) {
      if (!comment.body) continue
      const state = parseStateComment(comment.body)
      if (state) lastSHA = state.sha
    }

    if (data.length < 100) break
    page++
  }

  return lastSHA
}

export async function postSummaryComment(
  octokit: Octokit,
  ctx: Context,
  summary: string,
  headSHA: string,
): Promise<void> {
  const prNumber = ctx.payload.pull_request?.number ?? ctx.payload.issue?.number
  if (!prNumber) throw new Error('No PR number in context')

  const { owner, repo } = ctx.repo

  const state: ReviewState = {
    sha: headSHA,
    timestamp: new Date().toISOString(),
  }

  const body = `${summary}\n\n${makeStateComment(state)}`

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  })
}

export interface InlineComment {
  path: string
  position: number
  body: string
}

export async function postInlineReview(
  octokit: Octokit,
  ctx: Context,
  comments: InlineComment[],
): Promise<void> {
  if (comments.length === 0) return

  const prNumber = ctx.payload.pull_request?.number ?? ctx.payload.issue?.number
  if (!prNumber) throw new Error('No PR number in context')

  const { owner, repo } = ctx.repo

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event: 'COMMENT',
    comments: comments.map((c) => ({
      path: c.path,
      position: c.position,
      body: c.body,
    })),
  })
}

export async function postReactionOnTriggerComment(
  octokit: Octokit,
  ctx: Context,
  commentId: number,
  reaction: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes',
): Promise<void> {
  const { owner, repo } = ctx.repo

  await octokit.rest.reactions.createForIssueComment({
    owner,
    repo,
    comment_id: commentId,
    content: reaction,
  })
}

export function formatSummaryComment(
  prGoal: string,
  fileSummaries: Array<{ filename: string; summary: string; architecturallySignificant: boolean }>,
  issues: Issue[],
): string {
  const criticalCount = issues.filter((i) => i.severity === 'critical').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  const suggestionCount = issues.filter((i) => i.severity === 'suggestion').length

  const severityIcon = (s: string) => {
    if (s === 'critical') return '🔴'
    if (s === 'warning') return '🟡'
    return '🔵'
  }

  const lines: string[] = [
    '## FRC Code Review',
    '',
    `**PR Goal:** ${prGoal}`,
    '',
    '### Summary',
    `- 🔴 Critical: ${criticalCount}`,
    `- 🟡 Warnings: ${warningCount}`,
    `- 🔵 Suggestions: ${suggestionCount}`,
    '',
  ]

  if (fileSummaries.length > 0) {
    lines.push('### Files Changed')
    for (const f of fileSummaries) {
      const tag = f.architecturallySignificant ? ' ⭐' : ''
      lines.push(`- **${f.filename}**${tag}: ${f.summary}`)
    }
    lines.push('')
  }

  if (issues.length > 0) {
    lines.push('### Issues Found')
    for (const issue of issues) {
      lines.push(
        `${severityIcon(issue.severity)} **${issue.severity.toUpperCase()}** in \`${issue.file}:${issue.line}\` _(${issue.skill})_`,
      )
      lines.push(`> ${issue.message}`)
      lines.push('')
    }
  } else {
    lines.push('No issues found. ✅')
  }

  return lines.join('\n')
}
