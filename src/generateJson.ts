import { generateText } from 'ai'
import type { LanguageModel, CallSettings, Prompt } from 'ai'
import type { ZodType, ZodTypeDef } from 'zod'

/**
 * Calls generateText and parses the response as JSON, validated against the given Zod schema.
 * Strips markdown code fences (```json ... ```) if present.
 * Use this instead of generateObject / Output.object() for models that don't support response_format.
 */
export async function generateJson<T>(
  model: LanguageModel,
  schema: ZodType<T, ZodTypeDef, unknown>,
  options: CallSettings & Prompt,
): Promise<T> {
  const result = await generateText({ model, ...options })

  const raw = result.text.trim()
  const stripped = raw.startsWith('```') ? raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : raw

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    throw new Error(`Failed to parse JSON from model response:\n${raw}`)
  }

  return schema.parse(parsed)
}
