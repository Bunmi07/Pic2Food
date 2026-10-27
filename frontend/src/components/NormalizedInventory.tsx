/**
 * The "Ready for recipe search" card shown after the user confirms.
 *
 * App has already asked once for a standard name for each confirmed
 * ingredient. This card shows that answer. It asks the user to pick a
 * meaning for ambiguous names, and flags names we don't recognize (they're
 * kept as typed). It does not ask the server again. Only when every choice
 * is made does it show the final list and hand it to App (onReadyChange).
 */
import { useState } from 'react'
import {
  buildReadyInventory,
  type NormalizationResult,
  type ReadyIngredient,
} from '../normalizeInventory'

export type NameMatch =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'loaded'; results: NormalizationResult[] }

type NormalizedInventoryProps = {
  match: NameMatch
  /** Called with the final list once every ambiguous name has a choice, else null. */
  onReadyChange: (ingredients: ReadyIngredient[] | null) => void
  onRetry: () => void
}

export function NormalizedInventory({ match, onReadyChange, onRetry }: NormalizedInventoryProps) {
  const [choices, setChoices] = useState<Record<number, string>>({})

  function choose(next: Record<number, string>) {
    setChoices(next)
    if (match.status === 'loaded') {
      const built = buildReadyInventory(match.results, next)
      onReadyChange(built.ready ? built.ingredients : null)
    }
  }

  return (
    <section className="card" aria-labelledby="ready-heading">
      <h2 id="ready-heading">Ready for recipe search</h2>
      <div aria-live="polite">
        {match.status === 'loading' ? <p>Matching ingredient names…</p> : null}

        {match.status === 'failed' ? (
          <>
            <p className="photo-error" role="alert">
              {match.message}
            </p>
            <button type="button" className="primary-action" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : null}

        {match.status === 'loaded' ? (
          <LoadedList results={match.results} choices={choices} onChoose={choose} />
        ) : null}
      </div>
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
