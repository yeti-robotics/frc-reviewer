import { generateObject } from 'ai'
import { z } from 'zod'
import type { LanguageModel } from 'ai'
import type { PRSummary } from '../passes/summarize.js'
import type { Skill, SkillWithRefs } from './loader.js'
import { inlineRefs } from './loader.js'

const SelectionSchema = z.object({
  selected: z
    .array(z.string())
    .describe('Stems of the skills that are relevant to this pull request'),
})

const RefsSchema = z.object({
  filenames: z
    .array(z.string())
    .describe('Filenames of the reference files needed for this PR (e.g. "command-based.md")'),
})

/**
 * Uses the model to select which skills are relevant to the PR based on their descriptions.
 * Skills without a description apply globally and are always included.
 */
export async function selectSkills(
  model: LanguageModel,
  summary: PRSummary,
  skills: SkillWithRefs[],
): Promise<SkillWithRefs[]> {
  const globalSkills = skills.filter((s) => !s.description)
  const selectableSkills = skills.filter((s) => s.description)

  if (selectableSkills.length === 0) return skills

  const skillList = selectableSkills.map((s) => `- **${s.stem}**: ${s.description}`).join('\n')
  const fileSummaries = summary.files.map((f) => `- ${f.filename}: ${f.summary}`).join('\n')

  const { object } = await generateObject({
    model,
    schema: SelectionSchema,
    system: `You are selecting which code review skills to apply to a pull request.
Only select skills that are genuinely relevant based on what the PR is doing.
Return an empty array if no skills apply.`,
    prompt: `## PR Goal
${summary.prGoal}

## Changed Files
${fileSummaries}

## Available Skills
${skillList}

Which skills are relevant to this PR? Return the stems of applicable skills.`,
  })

  const selectedStems = new Set(object.selected)
  const selected = selectableSkills.filter((s) => selectedStems.has(s.stem))
  return [...globalSkills, ...selected]
}

/**
 * For each selected skill that has reference files, asks the model which references
 * are needed for this PR and inlines only those into the skill content.
 */
export async function resolveReferences(
  model: LanguageModel,
  summary: PRSummary,
  skills: SkillWithRefs[],
): Promise<Skill[]> {
  return Promise.all(
    skills.map(async (skill) => {
      if (skill.refs.length === 0) return inlineRefs(skill, [])

      const refList = skill.refs.map((r) => `- ${r.filename}`).join('\n')
      const fileSummaries = summary.files.map((f) => `- ${f.filename}: ${f.summary}`).join('\n')

      const { object } = await generateObject({
        model,
        schema: RefsSchema,
        system: `You are selecting which reference files to load for a code review skill.
Read the skill's index and select only the references relevant to this pull request.
Return an empty array if no references are needed beyond the skill's main content.`,
        prompt: `## PR Goal
${summary.prGoal}

## Changed Files
${fileSummaries}

## Skill: ${skill.name}
${skill.content}

## Available References
${refList}

Which reference files are needed to review this PR? Return only the filenames.`,
      })

      return inlineRefs(skill, object.filenames)
    }),
  )
}
