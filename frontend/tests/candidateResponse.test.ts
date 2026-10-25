/**
 * Tests for handling the backend's answers: guesses, "not food",
 * "unreadable", timeouts, and errors. The network is faked; no real calls.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { rowsFromCandidates } from '../src/confirmedInventory.ts'
import {
  NOT_FOOD_MESSAGE,
  UNREADABLE_MESSAGE,
  interpretCandidateResponse,
  requestIngredientCandidates,
} from '../src/loadIngredientCandidates.ts'

const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', {
  type: 'image/jpeg',
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('interpreting the vision response', () => {
  test('candidates from the backend still render unchecked', () => {
    const result = interpretCandidateResponse(200, {
      status: 'ok',
      items: [
        { id: 'item-1', name: 'eggs' },
        { id: 'item-2', description: 'pale block', guesses: ['butter', 'tofu'] },
        { id: 'item-3', description: 'jar', guesses: [] },
      ],
    })
    assert.ok(result.ok)
    assert.equal(result.source, 'vision')
    assert.deepEqual(
      result.items.map((item) => item.kind),
      ['named', 'ambiguous', 'manual-entry'],
    )
    assert.ok(rowsFromCandidates(result.items).every((row) => !row.confirmed))
  })

  test('non-food is distinct from unreadable and from errors', () => {
    const notFood = interpretCandidateResponse(200, { status: 'not_food' })
    const unreadable = interpretCandidateResponse(200, { status: 'unreadable' })
    assert.ok(!notFood.ok && !unreadable.ok)
    assert.equal(notFood.reason, 'not_food')
    assert.equal(notFood.message, NOT_FOOD_MESSAGE)
    assert.equal(unreadable.reason, 'unreadable')
    assert.equal(unreadable.message, UNREADABLE_MESSAGE)
    assert.notEqual(notFood.message, unreadable.message)
  })

  test('server errors become safe, retryable failures', () => {
    const timeout = interpretCandidateResponse(504, { error: 'vision_timeout' })
    assert.ok(!timeout.ok)
    assert.equal(timeout.reason, 'error')
    assert.match(timeout.message, /too long/)
    assert.equal(timeout.canRetry, true)
  })

  test('a missing API key is reported and not retryable', () => {
    const result = interpretCandidateResponse(503, { error: 'vision_not_configured' })
    assert.ok(!result.ok)
    assert.equal(result.canRetry, false)
  })

  test('rejected images ask for a different photo', () => {
    const result = interpretCandidateResponse(400, { error: 'invalid_image_has_metadata' })
    assert.ok(!result.ok)
    assert.equal(result.canRetry, false)
  })

  test('malformed bodies are safe failures', () => {
    for (const [status, body] of [
      [200, null],
      [200, { status: 'ok', items: 'eggs' }],
      [200, { status: 'ok', items: [{ name: 'no id' }] }],
      [200, { status: 'something_else' }],
      [500, 'oops'],
    ] as const) {
      const result = interpretCandidateResponse(status, body)
      assert.equal(result.ok, false, JSON.stringify(body))
    }
  })
})

describe('requesting candidates', () => {
  test('sends the prepared photo to the candidates endpoint', async () => {
    let sentUrl = ''
    let sentPhoto: FormDataEntryValue | null = null
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sentUrl = url
      sentPhoto = (init.body as FormData).get('photo')
      return jsonResponse(200, { status: 'not_food' })
    }) as typeof fetch

    const result = await requestIngredientCandidates(photo, fakeFetch)
    assert.equal(sentUrl, '/api/ingredient-candidates')
    assert.ok(sentPhoto instanceof File)
    assert.equal(result.ok, false)
  })

  test('a slow server produces a timeout failure, not a hang', async () => {
    const neverResolves = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as typeof fetch

    const result = await requestIngredientCandidates(photo, neverResolves, 20)
    assert.ok(!result.ok)
    assert.match(result.message, /too long/)
    assert.equal(result.canRetry, true)
  })

  test('a network failure is a safe failure', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const result = await requestIngredientCandidates(photo, offline)
    assert.ok(!result.ok)
    assert.equal(result.canRetry, true)
  })
})
