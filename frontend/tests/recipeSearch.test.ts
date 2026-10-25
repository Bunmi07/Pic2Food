/**
 * Tests for recipeSearch.ts: reading the backend's recipe answer strictly
 * (no unsourced or malformed recipe gets through), error messages and retry,
 * and the request sent to /api/recipe-search.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  itemLabel,
  parseRecipeSearchResponse,
  requestRecipeSearch,
  stapleLabel,
  swapNote,
} from '../src/recipeSearch.ts'

function recipe(overrides: Record<string, unknown> = {}) {
  return {
    id: '1002',
    title: 'Scrambled Eggs',
    image_url: 'https://www.themealdb.com/images/media/meals/eggs.jpg',
    category: 'Breakfast',
    area: null,
    tags: [],
    source: { name: 'TheMealDB', url: 'https://www.themealdb.com/meal/1002' },
    mealdb_url: 'https://www.themealdb.com/meal/1002',
    retrieved_on: '2026-10-24',
    ingredients: [
      { name: 'Eggs', measure: '3' },
      { name: 'Butter', measure: '1 tbsp' },
      { name: 'Salt', measure: '' },
    ],
    instructions: 'Whisk.\nCook gently.',
    matched: [{ name: 'Eggs', measure: '3' }],
    missing: [{ name: 'Butter', measure: '1 tbsp' }],
    staples: [{ name: 'Salt', measure: '' }],
    unchecked_allergy: [],
    ...overrides,
  }
}

function answer(overrides: Record<string, unknown> = {}) {
  return { status: 'supported', recipes: [recipe()], not_found: [], ...overrides }
}

test('reads a supported answer with source, matched, missing and staples', () => {
  const result = parseRecipeSearchResponse(200, answer({ not_found: ['dragonfruit'] }))
  assert.ok(result.ok)
  assert.equal(result.status, 'supported')
  assert.deepEqual(result.notFound, ['dragonfruit'])
  const [first] = result.recipes
  assert.equal(first.source.url, 'https://www.themealdb.com/meal/1002')
  assert.deepEqual(first.missing, [{ name: 'Butter', measure: '1 tbsp' }])
  assert.deepEqual(first.staples, [{ name: 'Salt', measure: '' }])
})

test('reads near matches and no-match answers', () => {
  const near = parseRecipeSearchResponse(200, answer({ status: 'near_match' }))
  assert.ok(near.ok && near.status === 'near_match')
  const none = parseRecipeSearchResponse(200, answer({ status: 'no_match', recipes: [] }))
  assert.ok(none.ok && none.status === 'no_match' && none.recipes.length === 0)
})

test('rejects the whole answer when any recipe lacks a usable source link', () => {
  for (const source of [
    { name: 'Somewhere', url: 'javascript:alert(1)' },
    { name: 'Somewhere', url: '' },
    { name: '', url: 'https://example.com/r' },
    null,
  ]) {
    const result = parseRecipeSearchResponse(
      200,
      answer({ recipes: [recipe(), recipe({ id: '1003', source })] }),
    )
    assert.equal(result.ok, false, JSON.stringify(source))
  }
})

test('rejects answers that break the result contract', () => {
  const broken = [
    null,
    answer({ status: 'maybe' }),
    answer({ status: 'supported', recipes: [] }),
    answer({ status: 'no_match' }),
    answer({ recipes: [recipe(), recipe(), recipe(), recipe()] }),
    answer({ not_found: 'dragonfruit' }),
    answer({ recipes: [recipe({ id: 'abc' })] }),
    answer({ recipes: [recipe({ title: ' ' })] }),
    answer({ recipes: [recipe({ ingredients: [] })] }),
    answer({ recipes: [recipe({ missing: [{ name: 'Butter' }] })] }),
    answer({ recipes: [recipe({ unchecked_allergy: [3] })] }),
    answer({ recipes: [recipe({ image_url: 'https://tracker.example.com/x.jpg' })] }),
    answer({ recipes: [recipe({ mealdb_url: 'https://example.com/meal/1002' })] }),
  ]
  for (const body of broken) {
    assert.equal(parseRecipeSearchResponse(200, body).ok, false, JSON.stringify(body))
  }
})

test('keeps the unchecked-allergy warning list', () => {
  const result = parseRecipeSearchResponse(
    200,
    answer({ recipes: [recipe({ unchecked_allergy: ['Mystery Relish'] })] }),
  )
  assert.ok(result.ok)
  assert.deepEqual(result.recipes[0].uncheckedAllergy, ['Mystery Relish'])
})

test('maps backend errors to messages, with retry only where it can help', () => {
  const conflict = parseRecipeSearchResponse(409, { error: 'constraint_conflict' })
  assert.ok(!conflict.ok && !conflict.canRetry && /clashes/.test(conflict.message))
  const timeout = parseRecipeSearchResponse(504, { error: 'recipe_source_timeout' })
  assert.ok(!timeout.ok && timeout.canRetry && /too long/.test(timeout.message))
  const failed = parseRecipeSearchResponse(502, { error: 'recipe_source_failed' })
  assert.ok(!failed.ok && failed.canRetry)
  const invalid = parseRecipeSearchResponse(400, { error: 'invalid_constraints' })
  assert.ok(!invalid.ok && !invalid.canRetry)
})

test('sends ingredients and constraints to the recipe search endpoint', async () => {
  let sent: { url: string; body: unknown } | null = null
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent = { url, body: JSON.parse(String(init.body)) }
    return new Response(JSON.stringify(answer()), { status: 200 })
  }) as unknown as typeof fetch
  const result = await requestRecipeSearch(
    ['egg', 'bread'],
    { allergens: ['milk'], avoid: ['pork'] },
    fakeFetch,
  )
  assert.ok(result.ok)
  assert.deepEqual(sent, {
    url: '/api/recipe-search',
    body: { ingredients: ['egg', 'bread'], allergens: ['milk'], avoid: ['pork'] },
  })
})

test('a network failure or timeout becomes a retryable error', async () => {
  const offline = (async () => {
    throw new TypeError('network down')
  }) as unknown as typeof fetch
  const down = await requestRecipeSearch(['egg'], { allergens: [], avoid: [] }, offline)
  assert.ok(!down.ok && down.canRetry)

  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      )
    })) as unknown as typeof fetch
  const slow = await requestRecipeSearch(['egg'], { allergens: [], avoid: [] }, hanging, 20)
  assert.ok(!slow.ok && slow.canRetry && /too long/.test(slow.message))
})

test('shows how a vague staple was read, and rejects a blank reading', () => {
  const staples = [
    { name: 'Salt', measure: '' },
    { name: 'Pepper', measure: 'pinch', assumed_as: 'black pepper' },
  ]
  const result = parseRecipeSearchResponse(200, answer({ recipes: [recipe({ staples })] }))
  assert.ok(result.ok)
  assert.deepEqual(result.recipes[0].staples.map(stapleLabel), [
    'salt',
    'pepper (we read this as black pepper)',
  ])
  const blank = [{ name: 'Pepper', measure: '', assumed_as: ' ' }]
  assert.equal(
    parseRecipeSearchResponse(200, answer({ recipes: [recipe({ staples: blank })] })).ok,
    false,
  )
})

test('flags a different sugar type the user has instead of calling it missing', () => {
  const matched = [{ name: 'Caster Sugar', measure: '50g', you_have: 'sugar' }]
  const result = parseRecipeSearchResponse(200, answer({ recipes: [recipe({ matched })] }))
  assert.ok(result.ok)
  const [item] = result.recipes[0].matched
  assert.equal(
    swapNote(item),
    'Recipe calls for caster sugar; you have sugar. Check it works for you.',
  )
  assert.equal(swapNote({ name: 'Eggs', measure: '3' }), null)
  const blank = [{ name: 'Caster Sugar', measure: '', you_have: '' }]
  assert.equal(
    parseRecipeSearchResponse(200, answer({ recipes: [recipe({ matched: blank })] })).ok,
    false,
  )
})

test('labels items with the source measure exactly as written', () => {
  assert.equal(itemLabel({ name: 'Eggs', measure: '3' }), 'Eggs (3)')
  assert.equal(itemLabel({ name: 'Salt', measure: '' }), 'Salt')
})
