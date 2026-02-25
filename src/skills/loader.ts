import matter from 'gray-matter'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Bundled skills imported as strings via tsdown loader: { '.md': 'text' }
// @ts-expect-error — .md imports resolved by esbuild at build time
import wpilibRaw from '../../skills/wpilib.md'
// @ts-expect-error — .md imports resolved by esbuild at build time
import commandBasedRaw from '../../skills/command-based.md'
// @ts-expect-error — .md imports resolved by esbuild at build time
import advantagekitRaw from '../../skills/advantagekit.md'

export interface Skill {
  name: string
  appliesTo: string[]
  version?: string
  content: string
  /** stem of the filename, used for override matching */
  stem: string
}

const BUNDLED_SKILLS: Array<{ stem: string; raw: string }> = [
  { stem: 'wpilib', raw: wpilibRaw as string },
  { stem: 'command-based', raw: commandBasedRaw as string },
  { stem: 'advantagekit', raw: advantagekitRaw as string },
]

function parseSkill(stem: string, raw: string): Skill {
  const parsed = matter(raw)
  const frontmatter = parsed.data as Record<string, unknown>

  const appliesTo = Array.isArray(frontmatter['applies-to'])
    ? (frontmatter['applies-to'] as string[])
    : []

  return {
    name: typeof frontmatter['name'] === 'string' ? frontmatter['name'] : stem,
    appliesTo,
    version: typeof frontmatter['version'] === 'string' ? frontmatter['version'] : undefined,
    content: parsed.content.trim(),
    stem,
  }
}

const MAX_SKILL_FILE_BYTES = 512 * 1024 // 512 KB

export async function loadSkills(repoSkillsPath: string): Promise<Skill[]> {
  // Parse bundled skills
  const bundled = BUNDLED_SKILLS.map(({ stem, raw }) => parseSkill(stem, raw))

  // Map by stem for easy override
  const skillMap = new Map<string, Skill>()
  for (const skill of bundled) {
    skillMap.set(skill.stem, skill)
  }

  // Resolve skillsPath relative to GITHUB_WORKSPACE and reject any path that
  // escapes that root, preventing path traversal on the Actions runner.
  const workspace = process.env['GITHUB_WORKSPACE'] ?? process.cwd()
  const resolvedSkillsPath = path.resolve(workspace, repoSkillsPath)
  if (!resolvedSkillsPath.startsWith(workspace + path.sep) && resolvedSkillsPath !== workspace) {
    throw new Error(
      `skills-path "${repoSkillsPath}" resolves outside the workspace. Use a relative path within the repository.`,
    )
  }

  // Load repo-local skills if the directory exists
  if (fs.existsSync(resolvedSkillsPath)) {
    const entries = fs.readdirSync(resolvedSkillsPath)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      // entry comes from readdirSync — it's a bare filename with no directory
      // component. path.basename is a belt-and-suspenders guard.
      const stem = path.basename(entry, '.md')
      const fullPath = path.join(resolvedSkillsPath, stem + '.md')

      const stat = fs.statSync(fullPath)
      if (!stat.isFile() || stat.size > MAX_SKILL_FILE_BYTES) continue

      const raw = fs.readFileSync(fullPath, 'utf-8')
      const skill = parseSkill(stem, raw)
      // Repo-local overrides bundled by filename stem
      skillMap.set(stem, skill)
    }
  }

  return Array.from(skillMap.values())
}
