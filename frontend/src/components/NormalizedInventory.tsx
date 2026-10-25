/**
 * The "Ready for recipe search" card shown after the user confirms.
 *
 * Fetches a standard name for each confirmed ingredient and shows what each
 * one became. Asks the user to pick a meaning for ambiguous names, and flags
 * names we don't recognize (they're kept as typed). Only when every choice
 * is made does it show the final list and hand it to App (onReadyChange).
 */
import { useEffect, useRef, useState } from 'react'
import type { ConfirmedInventory } from '../confirmedInventory'
import {
  buildReadyInventory,
  requestNormalization,
  type NormalizationResult,
  type ReadyIngredient,
} from '../normalizeInventory'

type NormalizedInventoryProps = {
  inventory: ConfirmedInventory
  /** Called with the final list once every ambiguous name has a choice, else null. */
  onReadyChange: (ingredients: ReadyIngredient[] | null) => void
}

function readyOrNull(results: NormalizationResult[], choices: Record<number, string>) {
  const built = buildReadyInventory(results, choices)
  return built.ready ? built.ingredients : null
}

type LoadState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'loaded'; results: NormalizationResult[] }

export function NormalizedInventory({ inventory, onReadyChange }: NormalizedInventoryProps) {
  const cardRef = useRef<HTMLElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [choices, setChoices] = useState<Record<number, string>>({})

  useEffect(() => {
    let cancelled = false
    const names = inventory.ingredients.map((item) => item.name)
    requestNormalization(names).then((result) => {
      if (cancelled) {
        return
      }
      if (result.ok) {
        setChoices({})
        setState({ status: 'loaded', results: result.results })
        onReadyChange(readyOrNull(result.results, {}))
      } else {
        setState({ status: 'failed', message: result.message })
        onReadyChange(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [inventory, attempt, onReadyChange])

  useEffect(() => {
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  function retry() {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }

  function choose(next: Record<number, string>) {
    setChoices(next)
    if (state.status === 'loaded') {
      onReadyChange(readyOrNull(state.results, next))
    }
  }

  return (
    <section ref={cardRef} className="card" aria-labelledby="ready-heading" aria-live="polite">
      <h2 id="ready-heading">Ready for recipe search</h2>

      {state.status === 'loading' ? <p>Matching ingredient names…</p> : null}

      {state.status === 'failed' ? (
        <>
          <p className="photo-error" role="alert">
            {state.message}
          </p>
          <button type="button" className="primary-action" onClick={retry}>
            Try again
          </button>
        </>
      ) : null}

      {state.status === 'loaded' ? (
        <LoadedList results={state.results} choices={choices} onChoose={choose} />
      ) : null}
    </section>
  )
}

type LoadedListProps = {
  results: NormalizationResult[]
  choices: Record<number, string>
  onChoose: (choices: Record<number, string>) => void
}

function LoadedList({ results, choices, onChoose }: LoadedListProps) {
  const ready = buildReadyInventory(results, choices)

  return (
    <>
      <p>We matched your ingredients to standard names so recipe search finds them.</p>
      <ul className="candidate-list">
        {results.map((result, index) => (
          <li key={`${result.input}-${index}`} className="candidate-row">
            <div className="candidate-main">
              {result.status === 'known' ? (
                <span className="candidate-check">
                  {result.canonical}
                  {result.canonical !== result.input.trim().toLowerCase() ? (
                    <span className="candidate-tag"> (you entered “{result.input}”)</span>
                  ) : null}
                </span>
              ) : null}

              {result.status === 'ambiguous' ? (
                <fieldset className="guess-list">
                  <legend>“{result.input}” can mean different things. Which do you have?</legend>
                  {result.options.map((option) => (
                    <label key={option} className="guess-option">
                      <input
                        type="radio"
                        name={`sense-${index}`}
                        checked={choices[index] === option}
                        onChange={() => onChoose({ ...choices, [index]: option })}
                      />
                      {option}
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {result.status === 'unknown' ? (
                <span className="candidate-check">
                  {result.input.trim()}
                  <span className="candidate-tag">
                    {' '}
                    — not in our ingredient list yet; we’ll search for it as typed.
                  </span>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {ready.ready ? (
        <div className="inventory">
          <h3>
            {ready.ingredients.length} ingredient
            {ready.ingredients.length === 1 ? '' : 's'} ready
          </h3>
          <p className="hint">Next: tell us about allergies and foods to avoid.</p>
          <ul>
            {ready.ingredients.map((item) => (
              <li key={item.name}>{item.name}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="hint">
          Choose a meaning for {ready.pendingCount} ingredient
          {ready.pendingCount === 1 ? '' : 's'} above.
        </p>
      )}
    </>
  )
}
