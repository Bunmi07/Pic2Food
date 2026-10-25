/**
 * AI-worded "why this fits you" lines for the recipes already on screen.
 *
 * Recipe cards first show the code-written line that comes with the search
 * results. This asks /api/recipe-explanations for the reworded version; the
 * backend only marks a line "ai" after checking it against the recipe's
 * facts. Any failure here just keeps the code-written lines, so it never
 * shows an error.
 */
import type { UserConstraints } from './constraints'
import { isNonEmpty, isRecord, MAX_EXPLANATION_LENGTH } from './recipeSearch.ts'

export const EXPLANATION_TIMEOUT_MS = 15_000

export type Explanation = { text: string; byAi: boolean }

/** Only lines for recipes we asked about, each at most once; anything malformed yields null. */
export function parseExplanationsResponse(
  httpStatus: number,
  body: unknown,
  recipeIds: string[],
): Map<string, Explanation> | null {
  if (httpStatus !== 200 || !isRecord(body) || !Array.isArray(body.explanations)) return null
  const lines = new Map<string, Explanation>()
  for (const entry of body.explanations) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      !recipeIds.includes(entry.id) ||
      lines.has(entry.id) ||
      !isNonEmpty(entry.text) ||
      entry.text.length > MAX_EXPLANATION_LENGTH ||
      (entry.worded_by !== 'ai' && entry.worded_by !== 'template')
    ) {
      return null
    }
    lines.set(entry.id, { text: entry.text, byAi: entry.worded_by === 'ai' })
  }
  return lines
}

export async function requestExplanations(
  ingredients: string[],
  constraints: UserConstraints,
  recipeIds: string[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = EXPLANATION_TIMEOUT_MS,
): Promise<Map<string, Explanation> | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl('/api/recipe-explanations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredients,
        allergens: constraints.allergens,
        avoid: constraints.avoid,
        recipe_ids: recipeIds,
      }),
      signal: controller.signal,
    })
    const body: unknown = await response.json().catch(() => null)
    return parseExplanationsResponse(response.status, body, recipeIds)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
