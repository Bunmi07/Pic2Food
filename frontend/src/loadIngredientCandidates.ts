/**
 * Gets ingredient guesses for a photo and turns every possible answer into
 * one result type the screen can show.
 *
 * Normally it sends the photo to the backend (/api/ingredient-candidates).
 * With VITE_CANDIDATE_SOURCE=fixture it uses the saved sample list instead,
 * so the app works without an OpenAI key. Either way the guesses are
 * validated here before the checklist sees them.
 */
import { INGREDIENT_CANDIDATE_FIXTURE } from './fixtures/ingredientCandidates.ts'

export const MAX_GUESSES_PER_ITEM = 3

/** Slightly longer than the server's 15 s vision timeout, to allow for upload. */
export const CLIENT_TIMEOUT_MS = 20_000

export type IngredientCandidate =
  | { kind: 'named'; id: string; name: string }
  | { kind: 'ambiguous'; id: string; description: string; guesses: string[] }
  | { kind: 'manual-entry'; id: string; description: string }

export type CandidateSource = 'vision' | 'fixture'

export type ParseResult =
  | { ok: true; items: IngredientCandidate[] }
  | { ok: false; message: string }

export type CandidateLoadResult =
  | { ok: true; items: IngredientCandidate[]; source: CandidateSource }
  | {
      ok: false
      reason: 'not_food' | 'unreadable' | 'error'
      message: string
      canRetry: boolean
    }

export const NOT_FOOD_MESSAGE =
  'This doesn’t look like food — try a photo of your ingredients.'

export const UNREADABLE_MESSAGE =
  'I can see food but couldn’t identify anything clearly — try better lighting or spreading items out.'

const MALFORMED_MESSAGE =
  'Could not load ingredient guesses. Try another photo, or add ingredients yourself.'

const GENERIC_ERROR_MESSAGE =
  'Could not identify ingredients right now. Try again.'

const INVALID_IMAGE_MESSAGE =
  'That photo could not be used. Try taking or choosing another one.'

const NETWORK_ERROR_MESSAGE =
  'Could not reach Pic2Food. Check your connection and try again.'

const ERROR_MESSAGES: Record<string, string> = {
  vision_timeout: 'Identifying ingredients took too long. Try again.',
  vision_not_configured:
    'Ingredient detection isn’t set up yet (the server has no OpenAI key).',
}

/** Validate a raw list of guesses. Any malformed entry fails the whole list. */
export function parseIngredientCandidates(raw: unknown): ParseResult {
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

/** Map the backend's response (status code + JSON body) to a load result. */
export function interpretCandidateResponse(
  httpStatus: number,
  body: unknown,
): CandidateLoadResult {
  if (httpStatus === 200 && isRecord(body)) {
    if (body.status === 'not_food') {
      return { ok: false, reason: 'not_food', message: NOT_FOOD_MESSAGE, canRetry: false }
    }
    if (body.status === 'unreadable') {
      return {
        ok: false,
        reason: 'unreadable',
        message: UNREADABLE_MESSAGE,
        canRetry: false,
      }
    }
    if (body.status === 'ok') {
      const parsed = parseIngredientCandidates(body.items)
      return parsed.ok
        ? { ok: true, items: parsed.items, source: 'vision' }
        : { ok: false, reason: 'error', message: parsed.message, canRetry: true }
    }
  }

  const code = isRecord(body) && typeof body.error === 'string' ? body.error : ''
  if (code.startsWith('invalid_image')) {
    return { ok: false, reason: 'error', message: INVALID_IMAGE_MESSAGE, canRetry: false }
  }
  return {
    ok: false,
    reason: 'error',
    message: ERROR_MESSAGES[code] ?? GENERIC_ERROR_MESSAGE,
    canRetry: code !== 'vision_not_configured',
  }
}

/** Send the prepared photo to the backend, giving up after CLIENT_TIMEOUT_MS. */
export async function requestIngredientCandidates(
  photo: File,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = CLIENT_TIMEOUT_MS,
): Promise<CandidateLoadResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const form = new FormData()
    form.append('photo', photo)
    const response = await fetchImpl('/api/ingredient-candidates', {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
    const body: unknown = await response.json().catch(() => null)
    return interpretCandidateResponse(response.status, body)
  } catch (caught) {
    const timedOut = caught instanceof Error && caught.name === 'AbortError'
    return {
      ok: false,
      reason: 'error',
      message: timedOut ? ERROR_MESSAGES.vision_timeout : NETWORK_ERROR_MESSAGE,
      canRetry: true,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** What the app calls: live vision by default, the sample list in fixture mode. */
export async function loadIngredientCandidates(
  photo: File,
): Promise<CandidateLoadResult> {
  if (import.meta.env.VITE_CANDIDATE_SOURCE === 'fixture') {
    const parsed = parseIngredientCandidates(INGREDIENT_CANDIDATE_FIXTURE)
    return parsed.ok
      ? { ok: true, items: parsed.items, source: 'fixture' }
      : { ok: false, reason: 'error', message: parsed.message, canRetry: false }
  }
  return requestIngredientCandidates(photo)
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
