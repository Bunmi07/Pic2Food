import { INGREDIENT_CANDIDATE_FIXTURE } from './fixtures/ingredientCandidates.ts'

export const MAX_GUESSES_PER_ITEM = 3

export type IngredientCandidate =
  | { kind: 'named'; id: string; name: string }
  | { kind: 'ambiguous'; id: string; description: string; guesses: string[] }
  | { kind: 'manual-entry'; id: string; description: string }

export type CandidateLoadResult =
  | { ok: true; items: IngredientCandidate[] }
  | { ok: false; message: string }

const MALFORMED_MESSAGE =
  'Could not load ingredient guesses. Try another photo, or add ingredients yourself.'

export function parseIngredientCandidates(raw: unknown): CandidateLoadResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: MALFORMED_MESSAGE }
  }

  const items: IngredientCandidate[] = []
  const seenIds = new Set<string>()

  for (const entry of raw) {
    const item = parseCandidate(entry)
    if (!item || seenIds.has(item.id)) {
      return { ok: false, message: MALFORMED_MESSAGE }
    }
    seenIds.add(item.id)
    items.push(item)
  }

  return { ok: true, items }
}

function parseCandidate(entry: unknown): IngredientCandidate | null {
  if (!isRecord(entry)) {
    return null
  }

  const id = trimmedString(entry.id)
  if (!id) {
    return null
  }

  if (entry.guesses === undefined) {
    const name = trimmedString(entry.name)
    return name ? { kind: 'named', id, name } : null
  }

  const description = trimmedString(entry.description)
  if (!description || !Array.isArray(entry.guesses)) {
    return null
  }

  const guesses = [...new Set(entry.guesses.map(trimmedString))]
  if (guesses.some((guess) => !guess)) {
    return null
  }

  // More than three guesses means the item could not be narrowed down:
  // route it to manual entry instead of showing a long guess list.
  if (guesses.length === 0 || guesses.length > MAX_GUESSES_PER_ITEM) {
    return { kind: 'manual-entry', id, description }
  }

  return { kind: 'ambiguous', id, description, guesses }
}

export async function loadIngredientCandidates(): Promise<CandidateLoadResult> {
  return parseIngredientCandidates(INGREDIENT_CANDIDATE_FIXTURE)
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
