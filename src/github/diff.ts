import type { Octokit } from '@octokit/rest'

export interface PRFile {
  filename: string
  status: string
  patch?: string
  additions: number
  deletions: number
}

export interface DiffPosition {
  lineNumber: number
  position: number
}

export async function getPRFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRFile[]> {
  const files: PRFile[] = []
  let page = 1

  while (true) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    })

    files.push(
      ...data.map((f) => ({
        filename: f.filename,
        status: f.status,
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
      })),
    )

    if (data.length < 100) break
    page++
  }

  return files
}

export async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    })

    if (Array.isArray(data) || data.type !== 'file') return null
    if (!('content' in data)) return null

    return Buffer.from(data.content, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

/**
 * Parse a unified diff patch and build a map of file line numbers → diff positions.
 *
 * GitHub's review comment API uses `position` — a 1-based line count within
 * the full diff text (including @@ hunk headers). This function walks the
 * patch hunk by hunk and maps each new-file line number to its diff position.
 */
export function parseDiffPositions(patch: string): Map<number, number> {
  const positions = new Map<number, number>()
  const lines = patch.split('\n')

  let diffPosition = 0
  let newLineNumber = 0

  for (const line of lines) {
    diffPosition++

    if (line.startsWith('@@')) {
      // Parse @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        newLineNumber = parseInt(match[1] ?? '0', 10) - 1
      }
      // The @@ line itself counts as position but no file line mapping
      continue
    }

    if (line.startsWith('+')) {
      newLineNumber++
      positions.set(newLineNumber, diffPosition)
    } else if (line.startsWith('-')) {
      // Deleted lines don't appear in the new file
    } else {
      // Context line
      newLineNumber++
    }
  }

  return positions
}
