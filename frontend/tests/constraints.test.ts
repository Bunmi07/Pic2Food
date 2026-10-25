/**
 * Tests for constraints.ts: tidying foods to avoid, reading the backend's
 * clash report, and the messages shown when recipe search is blocked.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ALLERGENS,
  addAvoidTerm,
  conflictMessage,
  hasConstraints,
  MAX_AVOID_TERMS,
  NO_CONSTRAINTS,
  parseConstraintCheckResponse,
  requestConstraintCheck,
} from '../src/constraints.ts'

test('offers exactly the nine common allergens', () => {
  assert.deepEqual(
    ALLERGENS.map((a) => a.id),
    ['milk', 'egg', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soy', 'sesame'],
  )
})

test('adds trimmed foods to avoid and skips blanks and duplicates', () => {
  let list = addAvoidTerm([], '  pork   belly ')
  assert.deepEqual(list, ['pork belly'])
  list = addAvoidTerm(list, 'PORK BELLY')
  assert.deepEqual(list, ['pork belly'])
  assert.equal(addAvoidTerm(list, '   '), list)
  assert.equal(addAvoidTerm(list, 'x'.repeat(61)), list)
})

test('stops adding at the limit', () => {
  const full = Array.from({ length: MAX_AVOID_TERMS }, (_, i) => `food ${i}`)
  assert.equal(addAvoidTerm(full, 'one more'), full)
})

test('knows when the user set nothing', () => {
  assert.equal(hasConstraints(NO_CONSTRAINTS), false)
  assert.equal(hasConstraints({ allergens: ['egg'], avoid: [] }), true)
  assert.equal(hasConstraints({ allergens: [], avoid: ['pork'] }), true)
})

test('reads a clash report', () => {
  const parsed = parseConstraintCheckResponse(200, {
    conflicts: [
      {
        ingredient: 'egg',
        reasons: [
          { type: 'allergy', id: 'egg', label: 'Egg' },
          { type: 'avoid', term: 'eggs' },
        ],
      },
    ],
  })
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.equal(
      conflictMessage(parsed.conflicts[0]),
      'You confirmed “egg”, but you marked egg as an allergy and you’re avoiding “eggs”.',
    )
  }
})

test('an empty clash report is clear', () => {
  assert.deepEqual(parseConstraintCheckResponse(200, { conflicts: [] }), {
    ok: true,
    conflicts: [],
  })
})

test('malformed or failed responses never count as clear', () => {
  const bad = [
    parseConstraintCheckResponse(500, { conflicts: [] }),
    parseConstraintCheckResponse(200, null),
    parseConstraintCheckResponse(200, {}),
    parseConstraintCheckResponse(200, { conflicts: [{ ingredient: 'egg', reasons: [] }] }),
    parseConstraintCheckResponse(200, {
      conflicts: [{ ingredient: 'egg', reasons: [{ type: 'maybe' }] }],
    }),
  ]
  for (const result of bad) {
    assert.equal(result.ok, false)
  }
})

test('network failure never counts as clear', async () => {
  const failingFetch = (async () => {
    throw new Error('offline')
  }) as typeof fetch
  const result = await requestConstraintCheck(['egg'], NO_CONSTRAINTS, failingFetch)
  assert.equal(result.ok, false)
})

test('sends ingredients, allergens, and foods to avoid', async () => {
  let sentBody = ''
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    sentBody = String(init?.body)
    return new Response(JSON.stringify({ conflicts: [] }), { status: 200 })
  }) as typeof fetch
  await requestConstraintCheck(['bread'], { allergens: ['egg'], avoid: ['pork'] }, fakeFetch)
  assert.deepEqual(JSON.parse(sentBody), {
    ingredients: ['bread'],
    allergens: ['egg'],
    avoid: ['pork'],
  })
})
