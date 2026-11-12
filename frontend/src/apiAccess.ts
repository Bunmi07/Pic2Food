/**
 * Remembers the private-hosting access code on this device and attaches it
 * to /api calls. When the server has no ACCESS_CODE, nothing is stored and
 * no header is sent, so local runs stay the same.
 */

const STORAGE_KEY = 'pic2food.accessCode'

export const WRONG_CODE_MESSAGE = "That code didn't work."

type KeyValueStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

/** The code saved on this device, or empty when there is none or storage is blocked. */
export function readAccessCode(store: KeyValueStore | null = browserStore()): string {
  if (!store) return ''
  try {
    return store.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Save the code, or forget it when the value is empty. Storage failures are ignored. */
export function writeAccessCode(code: string, store: KeyValueStore | null = browserStore()): void {
  if (!store) return
  try {
    if (code) store.setItem(STORAGE_KEY, code)
    else store.removeItem(STORAGE_KEY)
  } catch {
    // Private browsing can refuse storage. The code still works for this page load
    // only if the caller keeps it; the next visit will ask again.
  }
}

/** Copy the request headers and add X-Access-Code when this device has a code. */
export function withAccessHeader(init: RequestInit | undefined, code: string): RequestInit {
  const headers = new Headers(init?.headers)
  if (code) headers.set('X-Access-Code', code)
  return { ...init, headers }
}

/** fetch with the saved access code attached. Used as the default for every /api call. */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, withAccessHeader(init, readAccessCode()))
}

export type AccessCheck = 'ready' | 'denied' | 'unreachable'

/** Ask the server whether the saved code is accepted. Never sends the photo. */
export async function checkAccess(fetchImpl: typeof fetch = apiFetch): Promise<AccessCheck> {
  try {
    const response = await fetchImpl('/api/access', withAccessHeader(undefined, readAccessCode()))
    if (response.status === 401) return 'denied'
    if (response.ok) return 'ready'
    return 'unreachable'
  } catch {
    return 'unreachable'
  }
}
