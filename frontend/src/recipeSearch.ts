/**
 * Recipe search: sends the ready ingredient list plus allergies and foods to
 * avoid to the backend (/api/recipe-search) and checks the answer.
 *
 * The answer is one of three results: supported (up to three recipes),
 * near_match (up to three recipes that each need a few more things), or
 * no_match. Every recipe must carry a real source name and link; a response
 * with any unattributed or malformed recipe is rejected as a whole, so nothing
 * unsourced is ever shown.
 */
import type { UserConstraints } from './constraints'

export const RECIPE_SEARCH_TIMEOUT_MS = 30_000
export const MAX_RECIPES = 3
export const MAX_EXPLANATION_LENGTH = 500

/**
 * assumedAs: how we read a vague staple, e.g. "Pepper" read as black pepper.
 * youHave: the recipe wants a different type than the user has (caster sugar
 * vs sugar); shown so the user can judge.
 */
export type RecipeItem = { name: string; measure: string; assumedAs?: string; youHave?: string }

export type Recipe = {
  id: string
  title: string
  imageUrl: string | null
  category: string | null
  area: string | null
  source: { name: string; url: string }
  mealdbUrl: string
  ingredients: RecipeItem[]
  instructions: string
  matched: RecipeItem[]
  missing: RecipeItem[]
  staples: RecipeItem[]
  uncheckedAllergy: string[]
  /** Code-written "why this fits you" line; may later be replaced by a checked AI wording. */
  explanation: string
}

export type RecipeSearchStatus = 'supported' | 'near_match' | 'no_match'

export type RecipeSearchResult =
  | { ok: true; status: RecipeSearchStatus; recipes: Recipe[]; notFound: string[] }
  | { ok: false; message: string; canRetry: boolean }

const SOURCE_FAILED = 'Couldn’t reach the recipe source right now. Try again.'
const SOURCE_TIMEOUT = 'The recipe source took too long to answer. Try again.'
const CONFLICT =
  'One of your ingredients clashes with your allergies or foods to avoid. Fix that above first.'

/** Validate the backend's answer. Anything unexpected is a failure, never a partial result. */
export function parseRecipeSearchResponse(httpStatus: number, body: unknown): RecipeSearchResult {
  if (httpStatus !== 200) {
    const code = isRecord(body) ? body.error : undefined
    if (code === 'constraint_conflict') return { ok: false, message: CONFLICT, canRetry: false }
    if (code === 'recipe_source_timeout') return { ok: false, message: SOURCE_TIMEOUT, canRetry: true }
    return { ok: false, message: SOURCE_FAILED, canRetry: httpStatus !== 400 }
  }

  const failure = { ok: false as const, message: SOURCE_FAILED, canRetry: true }
  if (!isRecord(body) || !Array.isArray(body.recipes) || !isStringArray(body.not_found)) {
    return failure
  }
  const status = body.status
  if (status !== 'supported' && status !== 'near_match' && status !== 'no_match') {
    return failure
  }
  if (status === 'no_match' ? body.recipes.length !== 0 : body.recipes.length < 1) {
    return failure
  }
  if (body.recipes.length > MAX_RECIPES) {
    return failure
  }

  const recipes: Recipe[] = []
  for (const raw of body.recipes) {
    const recipe = parseRecipe(raw)
    if (!recipe) return failure
    recipes.push(recipe)
  }
  return { ok: true, status, recipes, notFound: body.not_found }
}

function parseRecipe(raw: unknown): Recipe | null {
  if (!isRecord(raw) || !isRecord(raw.source)) return null
  const { id, title, source, mealdb_url: mealdbUrl, image_url: imageUrl } = raw
  if (
    typeof id !== 'string' ||
    !/^\d+$/.test(id) ||
    !isNonEmpty(title) ||
    !isNonEmpty(source.name) ||
    !isHttpUrl(source.url) ||
    !isHttpUrl(mealdbUrl) ||
    !new URL(mealdbUrl).hostname.endsWith('themealdb.com') ||
    !(imageUrl === null || (isHttpUrl(imageUrl) && new URL(imageUrl).hostname.endsWith('themealdb.com'))) ||
    typeof raw.instructions !== 'string' ||
    !isStringArray(raw.unchecked_allergy) ||
    !isNonEmpty(raw.explanation) ||
    raw.explanation.length > MAX_EXPLANATION_LENGTH
  ) {
    return null
  }
  const lists = [raw.ingredients, raw.matched, raw.missing, raw.staples].map(parseItems)
  const [ingredients, matched, missing, staples] = lists
  if (!ingredients || !matched || !missing || !staples || ingredients.length === 0) return null

  return {
    id,
    title,
    imageUrl,
    category: optionalString(raw.category),
    area: optionalString(raw.area),
    source: { name: source.name, url: source.url },
    mealdbUrl,
    ingredients,
    instructions: raw.instructions,
    matched,
    missing,
    staples,
    uncheckedAllergy: raw.unchecked_allergy,
    explanation: raw.explanation,
  }
}

function parseItems(raw: unknown): RecipeItem[] | null {
  if (!Array.isArray(raw)) return null
  const items: RecipeItem[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || !isNonEmpty(entry.name) || typeof entry.measure !== 'string') {
      return null
    }
    const item: RecipeItem = { name: entry.name, measure: entry.measure }
    for (const [field, key] of [
      ['assumed_as', 'assumedAs'],
      ['you_have', 'youHave'],
    ] as const) {
      if (entry[field] === undefined) continue
      if (!isNonEmpty(entry[field])) return null
      item[key] = entry[field]
    }
    items.push(item)
  }
  return items
}

export async function requestRecipeSearch(
  ingredients: string[],
  constraints: UserConstraints,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = RECIPE_SEARCH_TIMEOUT_MS,
): Promise<RecipeSearchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl('/api/recipe-search', {
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
    return parseRecipeSearchResponse(response.status, body)
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError'
    return { ok: false, message: timedOut ? SOURCE_TIMEOUT : SOURCE_FAILED, canRetry: true }
  } finally {
    clearTimeout(timer)
  }
}

/** A staple's name, plus how we read it when the recipe was vague. */
export function stapleLabel(item: RecipeItem): string {
  const name = item.name.toLowerCase()
  return item.assumedAs ? `${name} (we read this as ${item.assumedAs})` : name
}

/** Note for a matched item the user has a different type of, else null. */
export function swapNote(item: RecipeItem): string | null {
  return item.youHave
    ? `Recipe calls for ${item.name.toLowerCase()}; you have ${item.youHave}. Check it works for you.`
    : null
}

/** "2 eggs" style label, keeping the source's measure exactly as written. */
export function itemLabel(item: RecipeItem): string {
  return item.measure ? `${item.name} (${item.measure})` : item.name
}

function optionalString(value: unknown): string | null {
  return isNonEmpty(value) ? value : null
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
