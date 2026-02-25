import matter from 'gray-matter'
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface SkillRef {
  filename: string // e.g. "command-based.md"
  filePath: string // absolute path
}

/** Skill with SKILL.md content loaded but references not yet inlined */
export interface SkillWithRefs {
  name: string
  description: string
  appliesTo: string[]
  /** SKILL.md body only — references not yet inlined */
  content: string
  stem: string
  refs: SkillRef[]
}

/** Fully resolved skill ready for use in the review prompt */
export interface Skill {
  name: string
  description: string
  appliesTo: string[]
  content: string
  stem: string
}

const MAX_SKILL_FILE_BYTES = 512 * 1024 // 512 KB

function readFileSafe(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_SKILL_FILE_BYTES) return null
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

function parseSkillDir(dirPath: string, stem: string): SkillWithRefs | null {
  const raw = readFileSafe(path.join(dirPath, 'SKILL.md'))
  if (!raw) return null

  const parsed = matter(raw)
  const fm = parsed.data as Record<string, unknown>

  const refsDir = path.join(dirPath, 'references')
  const refs: SkillRef[] = []
  if (fs.existsSync(refsDir)) {
    for (const entry of fs.readdirSync(refsDir)) {
      if (!entry.endsWith('.md')) continue
      refs.push({ filename: entry, filePath: path.join(refsDir, entry) })
    }
  }

  return {
    name: typeof fm['name'] === 'string' ? fm['name'] : stem,
    description: typeof fm['description'] === 'string' ? fm['description'] : '',
    appliesTo: Array.isArray(fm['applies-to']) ? (fm['applies-to'] as string[]) : [],
    content: parsed.content.trim(),
    stem,
    refs,
  }
}

function parseSkillFile(filePath: string, stem: string): SkillWithRefs | null {
  const raw = readFileSafe(filePath)
  if (!raw) return null

  const parsed = matter(raw)
  const fm = parsed.data as Record<string, unknown>

  return {
    name: typeof fm['name'] === 'string' ? fm['name'] : stem,
    description: typeof fm['description'] === 'string' ? fm['description'] : '',
    appliesTo: Array.isArray(fm['applies-to']) ? (fm['applies-to'] as string[]) : [],
    content: parsed.content.trim(),
    stem,
    refs: [],
  }
}

export function inlineRefs(skill: SkillWithRefs, filenames: string[]): Skill {
  const selected = skill.refs.filter((r) => filenames.includes(r.filename))
  const sections = selected.map((r) => readFileSafe(r.filePath)?.trim()).filter(Boolean) as string[]

  return {
    name: skill.name,
    description: skill.description,
    appliesTo: skill.appliesTo,
    content: sections.length > 0 ? skill.content + '\n\n---\n\n' + sections.join('\n\n---\n\n') : skill.content,
    stem: skill.stem,
  }
}

function loadSkillsFromDirectory(skillsDir: string): SkillWithRefs[] {
  if (!fs.existsSync(skillsDir)) return []

  const skills: SkillWithRefs[] = []
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const skill = parseSkillDir(path.join(skillsDir, entry.name), entry.name)
      if (skill) skills.push(skill)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const stem = path.basename(entry.name, '.md')
      const skill = parseSkillFile(path.join(skillsDir, entry.name), stem)
      if (skill) skills.push(skill)
    }
  }
  return skills
}

export async function loadSkills(repoSkillsPath: string): Promise<SkillWithRefs[]> {
  // Load bundled skills from the action's own skills/ directory (sibling of dist/)
  const bundledDir = path.join(__dirname, '../skills')
  const skillMap = new Map<string, SkillWithRefs>()

  for (const skill of loadSkillsFromDirectory(bundledDir)) {
    skillMap.set(skill.stem, skill)
  }

  // Resolve repo skills path relative to GITHUB_WORKSPACE, reject path traversal
  const workspace = process.env['GITHUB_WORKSPACE'] ?? process.cwd()
  const resolvedPath = path.resolve(workspace, repoSkillsPath)
  if (!resolvedPath.startsWith(workspace + path.sep) && resolvedPath !== workspace) {
    throw new Error(
      `skills-path "${repoSkillsPath}" resolves outside the workspace. Use a relative path within the repository.`,
    )
  }

  // Repo-local skills override bundled ones by stem
  if (fs.existsSync(resolvedPath)) {
    for (const skill of loadSkillsFromDirectory(resolvedPath)) {
      skillMap.set(skill.stem, skill)
    }
  }

  return Array.from(skillMap.values())
}
