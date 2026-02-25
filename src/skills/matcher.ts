import { minimatch } from 'minimatch'
import type { Skill } from './loader.js'

/**
 * Filter skills whose appliesTo patterns match any of the changed filenames.
 * Skills with an empty appliesTo array (or missing) apply globally.
 */
export function matchSkills(skills: Skill[], filenames: string[]): Skill[] {
  return skills.filter((skill) => {
    // No appliesTo patterns → global skill, always include
    if (skill.appliesTo.length === 0) return true

    // Check for wildcard pattern
    if (skill.appliesTo.includes('*')) return true

    // Check if any pattern matches any filename
    return skill.appliesTo.some((pattern) =>
      filenames.some((filename) => minimatch(filename, pattern, { matchBase: true })),
    )
  })
}
