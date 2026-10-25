/**
 * Allergies and foods to avoid, entered after the ingredient list is ready.
 *
 * Holds the fixed list of nine allergens (ids must match the backend's
 * allergen_groups.json), tidies typed foods to avoid, and asks the backend
 * (/api/check-constraints) whether any confirmed ingredient clashes with
 * them. Recipe search stays blocked until there are no clashes.
 *
 * Allergy choices stay in the browser session; they are never logged.
 */

export const CONSTRAINT_CHECK_TIMEOUT_MS = 10_000
export const MAX_AVOID_TERMS = 20
export const MAX_AVOID_LENGTH = 60

export const ALLERGENS = [
  { id: 'milk', label: 'Milk' },
  { id: 'egg', label: 'Egg' },
  { id: 'fish', label: 'Fish' },
  { id: 'shellfish', label: 'Shellfish' },
  { id: 'tree_nuts', label: 'Tree nuts' },
  { id: 'peanuts', label: 'Peanuts' },
  { id: 'wheat', label: 'Wheat' },
  { id: 'soy', label: 'Soy' },
  { id: 'sesame', label: 'Sesame' },
] as const

export type AllergenId = (typeof ALLERGENS)[number]['id']

export type UserConstraints = {
  allergens: AllergenId[]
  avoid: string[]
}

export const NO_CONSTRAINTS: UserConstraints = { allergens: [], avoid: [] }

export type ConflictReason =
  | { type: 'allergy'; id: string; label: string }
  | { type: 'avoid'; term: string }

export type Conflict = { ingredient: string; reasons: ConflictReason[] }

export type ConstraintCheckResult =
  | { ok: true; conflicts: Conflict[] }
  | { ok: false; message: string }

const FAILURE_MESSAGE = 'Could not check your allergies right now. Try again.'

/** Add a typed food to avoid. Returns the same list if it is empty, a duplicate, or over the limits. */
export function addAvoidTerm(list: string[], raw: string): string[] {
  const term = raw.trim().replace(/\s+/g, ' ')
  if (
    !term ||
    term.length > MAX_AVOID_LENGTH ||
    list.length >= MAX_AVOID_TERMS ||
    list.some((existing) => existing.toLowerCase() === term.toLowerCase())
  ) {
    return list
  }
  return [...list, term]
}

export function hasConstraints(constraints: UserConstraints): boolean {
  return constraints.allergens.length > 0 || constraints.avoid.length > 0
}

/** Plain-language reason a confirmed ingredient blocks recipe search. */
export function conflictMessage(conflict: Conflict): string {
  const why = conflict.reasons
    .map((reason) =>
      reason.type === 'allergy'
        ? `you marked ${reason.label.toLowerCase()} as an allergy`
        : `you’re avoiding “${reason.term}”`,
    )
    .join(' and ')
  return `You confirmed “${conflict.ingredient}”, but ${why}.`
}

export function parseConstraintCheckResponse(
  httpStatus: number,
  body: unknown,
): ConstraintCheckResult {
  const failure = { ok: false as const, message: FAILURE_MESSAGE }
  if (httpStatus !== 200 || !isRecord(body) || !Array.isArray(body.conflicts)) {
    return failure
  }
  const conflicts: Conflict[] = []
  for (const entry of body.conflicts) {
    if (
      !isRecord(entry) ||
      typeof entry.ingredient !== 'string' ||
      !Array.isArray(entry.reasons) ||
      entry.reasons.length === 0
    ) {
      return failure
    }
    const reasons: ConflictReason[] = []
    for (const reason of entry.reasons) {
      if (
        isRecord(reason) &&
        reason.type === 'allergy' &&
        typeof reason.id === 'string' &&
        typeof reason.label === 'string'
      ) {
        reasons.push({ type: 'allergy', id: reason.id, label: reason.label })
      } else if (isRecord(reason) && reason.type === 'avoid' && typeof reason.term === 'string') {
        reasons.push({ type: 'avoid', term: reason.term })
      } else {
        return failure
      }
    }
    conflicts.push({ ingredient: entry.ingredient, reasons })
  }
  return { ok: true, conflicts }
}

export async function requestConstraintCheck(
  ingredients: string[],
  constraints: UserConstraints,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = CONSTRAINT_CHECK_TIMEOUT_MS,
): Promise<ConstraintCheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl('/api/check-constraints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredients,
        allergens: constraints.allergens,
        avoid: constraints.avoid,
      }),
      signal: controller.signal,
    })
    const body: unknown = await response.json().catch(() => null)
    return parseConstraintCheckResponse(response.status, body)
  } catch {
    return { ok: false, message: FAILURE_MESSAGE }
  } finally {
    clearTimeout(timer)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
