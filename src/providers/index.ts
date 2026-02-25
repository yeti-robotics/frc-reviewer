import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

export function getProvider(gateway: string, apiKey: string, model: string): LanguageModel {
  switch (gateway) {
    case 'digitalocean':
      return createOpenAI({ apiKey, baseURL: 'https://inference.do-ai.run/v1' })(model)
    case 'vercel':
      return createOpenAI({ apiKey, baseURL: 'https://ai.vercel.app/v1' })(model)
    case 'openai':
      return createOpenAI({ apiKey })(model)
    case 'anthropic':
      return createAnthropic({ apiKey })(model)
    default:
      throw new Error(`Unknown gateway: ${gateway}`)
  }
}
