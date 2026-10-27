/**
 * Tests for recipeExplanations.ts: reading the reworded "why this fits you"
 * lines strictly, and falling back silently (null) on any failure.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseExplanationsResponse, requestExplanations } from '../src/recipeExplanations.ts'

const IDS = ['1001', '1002']

test('reads AI and template lines for the recipes we asked about', () => {
  const lines = parseExplanationsResponse(
    200,
    {
      explanations: [
        { id: '1001', text: 'Uses your eggs and bread.', worded_by: 'ai' },
        { id: '1002', text: 'Uses your eggs. You’d need butter.', worded_by: 'template' },
      ],
    },
    IDS,
  )
  assert.ok(lines)
  assert.deepEqual(lines.get('1001'), { text: 'Uses your eggs and bread.', byAi: true })
  assert.deepEqual(lines.get('1002')?.byAi, false)
})

test('anything unexpected keeps the code-written lines', () => {
  const ok = { id: '1001', text: 'Uses your eggs.', worded_by: 'ai' }
  const broken = [
    [500, { error: 'recipe_source_failed' }],
    [200, null],
    [200, { explanations: [{ ...ok, id: '9999' }] }],
    [200, { explanations: [ok, ok] }],
    [200, { explanations: [{ ...ok, text: '' }] }],
    [200, { explanations: [{ ...ok, text: 'x'.repeat(501) }] }],
    [200, { explanations: [{ ...ok, worded_by: 'model' }] }],
  ] as const
  for (const [status, body] of broken) {
    assert.equal(parseExplanationsResponse(status, body, IDS), null, JSON.stringify(body))
  }
})

test('sends ingredients, constraints and the shown recipe ids', async () => {
  let sent: unknown = null
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ explanations: [] }), { status: 200 })
  }) as unknown as typeof fetch
  const lines = await requestExplanations(
    ['egg'],
    { allergens: ['sesame'], avoid: ['pork'] },
    ['1001'],
    fakeFetch,
  )
  assert.ok(lines)
  assert.deepEqual(sent, {
    ingredients: ['egg'],
    allergens: ['sesame'],
    avoid: ['pork'],
    recipe_ids: ['1001'],
  })
})

test('network failure or timeout returns null', async () => {
  const offline = (async () => {
    throw new TypeError('down')
  }) as unknown as typeof fetch
  assert.equal(await requestExplanations(['egg'], { allergens: [], avoid: [] }, IDS, offline), null)
  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')))
    })) as unknown as typeof fetch
  assert.equal(
    await requestExplanations(['egg'], { allergens: [], avoid: [] }, IDS, hanging, 20),
    null,
  )
})
