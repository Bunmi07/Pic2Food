/**
 * First screen when the server requires an access code. The rest of the app
 * stays unmounted until GET /api/access accepts the code. When no code is
 * configured, this renders the app immediately.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { checkAccess, readAccessCode, writeAccessCode, WRONG_CODE_MESSAGE } from '../apiAccess.ts'

type Gate = 'checking' | 'ready' | 'needed' | 'wrong' | 'unreachable'

export function AccessGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('checking')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    const stored = readAccessCode()
    void checkAccess().then((result) => {
      if (cancelled) return
      if (result === 'ready') {
        setGate('ready')
        return
      }
      setDraft(stored)
      setGate(result === 'denied' ? (stored ? 'wrong' : 'needed') : 'unreachable')
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    writeAccessCode(draft.trim())
    const result = await checkAccess()
    if (result === 'ready') setGate('ready')
    else if (result === 'denied') setGate('wrong')
    else setGate('unreachable')
  }

  if (gate === 'ready') return children

  return (
    <main className="app">
      <form className="card access-code" onSubmit={onSubmit}>
        <p className="eyebrow">Pic2Food</p>
        <h1>Enter the access code</h1>
        {gate === 'checking' ? <p>Checking this device…</p> : null}
        {gate === 'unreachable' ? (
          <p role="alert">Pic2Food couldn't be reached. Try again.</p>
        ) : null}
        {gate === 'needed' || gate === 'wrong' ? (
          <>
            <label htmlFor="access-code">Access code</label>
            <input
              id="access-code"
              name="access-code"
              value={draft}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
            />
            {gate === 'wrong' ? (
              <p className="photo-error" role="alert">
                {WRONG_CODE_MESSAGE}
              </p>
            ) : null}
            <button className="primary-action" type="submit">
              Continue
            </button>
          </>
        ) : null}
        {gate === 'unreachable' ? (
          <button
            className="primary-action"
            type="button"
            onClick={() => {
              setGate('checking')
              void checkAccess().then((result) => {
                if (result === 'ready') setGate('ready')
                else if (result === 'denied') setGate(readAccessCode() ? 'wrong' : 'needed')
                else setGate('unreachable')
              })
            }}
          >
            Try again
          </button>
        ) : null}
      </form>
    </main>
  )
}
