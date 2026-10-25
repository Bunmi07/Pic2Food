/**
 * Standard names for the confirmed inventory, ready for recipe search.
 *
 * Sends the confirmed names to the backend (/api/normalize-ingredients),
 * checks the answer, and builds the final list. Ambiguous names (for example
 * "coriander") must be resolved by the user; the code never picks a meaning.
 * Unknown names are kept as typed, so recipe search can still try them.
 */

export const NORMALIZE_TIMEOUT_MS = 10_000

export type NormalizationResult =
  | { status: 'known'; input: string; canonical: string }
  | { status: 'ambiguous'; input: string; options: string[] }
  | { status: 'unknown'; input: string }

export type ReadyIngredient = {
  name: string
  input: string
  match: 'known' | 'chosen' | 'as-typed'
}

const FAILURE_MESSAGE = 'Could not match ingredient names right now. Try again.'

/** Check the backend's answer lines up one-to-one with the names we sent. */
export function parseNormalizationResponse(
  httpStatus: number,
  body: unknown,
  sentNames: string[],
): { ok: true; results: NormalizationResult[] } | { ok: false; message: string } {
  const failure = { ok: false as const, message: FAILURE_MESSAGE }
  if (httpStatus !== 200 || !isRecord(body) || !Array.isArray(body.results)) {
    return failure
  }
  if (body.results.length !== sentNames.length) {
    return failure
  }

  const results: NormalizationResult[] = []
  for (const [index, entry] of body.results.entries()) {
    if (!isRecord(entry) || entry.input !== sentNames[index]) {
      return failure
    }
    const input = entry.input
    if (entry.status === 'known' && isNonEmptyString(entry.canonical)) {
      results.push({ status: 'known', input, canonical: entry.canonical })
    } else if (
      entry.status === 'ambiguous' &&
      Array.isArray(entry.options) &&
      entry.options.length >= 2 &&
      entry.options.every(isNonEmptyString)
    ) {
      results.push({ status: 'ambiguous', input, options: entry.options })
    } else if (entry.status === 'unknown') {
      results.push({ status: 'unknown', input })
    } else {
      return failure
    }
  }
  return { ok: true, results }
}

export async function requestNormalization(
  names: string[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = NORMALIZE_TIMEOUT_MS,
): Promise<{ ok: true; results: NormalizationResult[] } | { ok: false; message: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl('/api/normalize-ingredients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients: names }),
      signal: controller.signal,
    })
    const body: unknown = await response.json().catch(() => null)
    return parseNormalizationResponse(response.status, body, names)
  } catch {
    return { ok: false, message: FAILURE_MESSAGE }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The final list for recipe search. Not ready until every ambiguous name has
 * a user choice. Names that end up the same (e.g. "scallions" and
 * "green onion") appear once.
 *
 * `choices` maps a result's position in the list to the option the user picked.
 */
export function buildReadyInventory(
  results: NormalizationResult[],
  choices: Record<number, string>,
): { ready: true; ingredients: ReadyIngredient[] } | { ready: false; pendingCount: number } {
  const ingredients: ReadyIngredient[] = []
  const seen = new Set<string>()
  let pendingCount = 0

  results.forEach((result, index) => {
    let entry: ReadyIngredient
    if (result.status === 'known') {
      entry = { name: result.canonical, input: result.input, match: 'known' }
    } else if (result.status === 'ambiguous') {
      const choice = choices[index]
      if (!choice || !result.options.includes(choice)) {
        pendingCount += 1
        return
      }
      entry = { name: choice, input: result.input, match: 'chosen' }
    } else {
      entry = { name: result.input.trim(), input: result.input, match: 'as-typed' }
    }

    const key = entry.name.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      ingredients.push(entry)
    }
  })

  return pendingCount > 0 ? { ready: false, pendingCount } : { ready: true, ingredients }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
