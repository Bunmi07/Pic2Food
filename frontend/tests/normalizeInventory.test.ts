/**
 * Tests for normalizeInventory.ts: checking the backend's answer, and
 * building the final list (ambiguous names need a user choice; unknown names
 * are kept as typed, never guessed).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildReadyInventory,
  parseNormalizationResponse,
  requestNormalization,
  type NormalizationResult,
} from '../src/normalizeInventory.ts'

const sent = ['Scallions', 'coriander', 'dragonfruit']
const goodBody = {
  results: [
    { input: 'Scallions', status: 'known', canonical: 'green onion' },
    { input: 'coriander', status: 'ambiguous', options: ['cilantro', 'coriander seed'] },
    { input: 'dragonfruit', status: 'unknown' },
  ],
}

test('accepts a well-formed response in the same order as sent', () => {
  const parsed = parseNormalizationResponse(200, goodBody, sent)
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.deepEqual(
      parsed.results.map((r) => r.status),
      ['known', 'ambiguous', 'unknown'],
    )
  }
})

test('rejects responses that do not line up with what was sent', () => {
  assert.equal(parseNormalizationResponse(200, goodBody, ['Scallions']).ok, false)
  assert.equal(
    parseNormalizationResponse(200, goodBody, ['coriander', 'Scallions', 'dragonfruit']).ok,
    false,
  )
})

test('rejects malformed or failed responses', () => {
  assert.equal(parseNormalizationResponse(500, goodBody, sent).ok, false)
  assert.equal(parseNormalizationResponse(200, null, sent).ok, false)
  const noCanonical = { results: [{ input: 'egg', status: 'known' }] }
  assert.equal(parseNormalizationResponse(200, noCanonical, ['egg']).ok, false)
  const oneOption = { results: [{ input: 'pepper', status: 'ambiguous', options: ['x'] }] }
  assert.equal(parseNormalizationResponse(200, oneOption, ['pepper']).ok, false)
  const madeUp = { results: [{ input: 'egg', status: 'probably' }] }
  assert.equal(parseNormalizationResponse(200, madeUp, ['egg']).ok, false)
})

const results: NormalizationResult[] = [
  { status: 'known', input: 'Scallions', canonical: 'green onion' },
  { status: 'ambiguous', input: 'coriander', options: ['cilantro', 'coriander seed'] },
  { status: 'unknown', input: ' dragonfruit ' },
]

test('ambiguous names block the list until the user chooses', () => {
  assert.deepEqual(buildReadyInventory(results, {}), { ready: false, pendingCount: 1 })
  assert.deepEqual(buildReadyInventory(results, { 1: 'not an option' }), {
    ready: false,
    pendingCount: 1,
  })
})

test('builds the final list with known, chosen, and as-typed names', () => {
  const built = buildReadyInventory(results, { 1: 'cilantro' })
  assert.deepEqual(built, {
    ready: true,
    ingredients: [
      { name: 'green onion', input: 'Scallions', match: 'known' },
      { name: 'cilantro', input: 'coriander', match: 'chosen' },
      { name: 'dragonfruit', input: ' dragonfruit ', match: 'as-typed' },
    ],
  })
})

test('names that resolve to the same standard name appear once', () => {
  const built = buildReadyInventory(
    [
      { status: 'known', input: 'Scallions', canonical: 'green onion' },
      { status: 'known', input: 'spring onion', canonical: 'green onion' },
    ],
    {},
  )
  assert.equal(built.ready, true)
  if (built.ready) {
    assert.deepEqual(built.ingredients.map((i) => i.name), ['green onion'])
  }
})

test('network failure becomes a safe error', async () => {
  const failingFetch = (async () => {
    throw new Error('offline')
  }) as typeof fetch
  const result = await requestNormalization(['egg'], failingFetch)
  assert.equal(result.ok, false)
})

test('sends the confirmed names as JSON', async () => {
  let sentBody = ''
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    sentBody = String(init?.body)
    return new Response(
      JSON.stringify({ results: [{ input: 'egg', status: 'known', canonical: 'egg' }] }),
      { status: 200 },
    )
  }) as typeof fetch
  const result = await requestNormalization(['egg'], fakeFetch)
  assert.equal(result.ok, true)
  assert.deepEqual(JSON.parse(sentBody), { ingredients: ['egg'] })
})
