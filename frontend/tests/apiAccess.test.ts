/**
 * Tests for the access code remembered on this device. No server is called;
 * fetch and storage are stand-ins.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  WRONG_CODE_MESSAGE,
  checkAccess,
  readAccessCode,
  withAccessHeader,
  writeAccessCode,
} from '../src/apiAccess.ts'
import { requestIngredientCandidates } from '../src/loadIngredientCandidates.ts'

const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', {
  type: 'image/jpeg',
})

function memoryStore() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

describe('access code on this device', () => {
  test('a blocked store does not throw', () => {
    const blocked = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
      removeItem() {
        throw new Error('blocked')
      },
    }
    assert.equal(readAccessCode(blocked), '')
    assert.doesNotThrow(() => writeAccessCode('secret', blocked))
  })

  test('the saved code is sent as X-Access-Code and a wrong one is the set message', () => {
    const store = memoryStore()
    writeAccessCode('gate-code', store)
    assert.equal(readAccessCode(store), 'gate-code')
    const headers = new Headers(withAccessHeader({ headers: { 'Content-Type': 'application/json' } }, readAccessCode(store)).headers)
    assert.equal(headers.get('X-Access-Code'), 'gate-code')
    assert.equal(headers.get('Content-Type'), 'application/json')
    assert.equal(WRONG_CODE_MESSAGE, "That code didn't work.")
    writeAccessCode('', store)
    assert.equal(readAccessCode(store), '')
  })

  test('no stored code means no header', () => {
    const headers = new Headers(withAccessHeader(undefined, '').headers)
    assert.equal(headers.get('X-Access-Code'), null)
  })

  test('401 means the code was refused, and a good code opens the app', async () => {
    const denied = await checkAccess(async () => new Response('{"error":"unauthorized"}', { status: 401 }))
    const ready = await checkAccess(async () => new Response('{"ok":true}', { status: 200 }))
    const down = await checkAccess(async () => {
      throw new Error('offline')
    })
    assert.equal(denied, 'denied')
    assert.equal(ready, 'ready')
    assert.equal(down, 'unreachable')
  })

  test('the photo request carries the code when one is saved', async () => {
    const store = memoryStore()
    writeAccessCode('gate-code', store)
    const previous = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: store,
    })
    try {
      let sent: string | null = null
      await requestIngredientCandidates(photo, async (_url, init) => {
        sent = new Headers(init?.headers).get('X-Access-Code')
        return new Response(JSON.stringify({ status: 'not_food' }), { status: 200 })
      })
      assert.equal(sent, 'gate-code')
    } finally {
      if (previous === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage
      } else {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous })
      }
    }
  })
})
