import { useId, useRef, useState, type FormEvent } from 'react'
import {
  canConfirmRow,
  confirmationEvents,
  countConfirmedRows,
  createConfirmedInventory,
  createManualRow,
  type CandidateRow,
  type ConfirmedInventory,
} from '../confirmedInventory'
import { logEvaluationEvent } from '../eventLog'

type IngredientConfirmationProps = {
  rows: CandidateRow[]
  onRowsChange: (rows: CandidateRow[]) => void
  inventory: ConfirmedInventory | null
  onInventoryChange: (inventory: ConfirmedInventory | null) => void
}

export function IngredientConfirmation({
  rows,
  onRowsChange,
  inventory,
  onInventoryChange,
}: IngredientConfirmationProps) {
  const addId = useId()
  const resultRef = useRef<HTMLDivElement>(null)
  const [addValue, setAddValue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const confirmedCount = countConfirmedRows(rows)

  function updateRow(id: string, patch: Partial<CandidateRow>) {
    onInventoryChange(null)
    setConfirmError(null)
    onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function removeRow(row: CandidateRow) {
    onInventoryChange(null)
    setConfirmError(null)
    if (editingId === row.id) {
      setEditingId(null)
    }
    if (row.origin === 'detected') {
      logEvaluationEvent({
        type: 'candidate_removed',
        candidateId: row.id,
        name: row.name || row.originalName,
      })
    }
    onRowsChange(rows.filter((item) => item.id !== row.id))
  }

  function addManual(event: FormEvent) {
    event.preventDefault()
    const name = addValue.trim()
    if (!name) {
      return
    }
    const row = createManualRow(`manual-${crypto.randomUUID()}`, name)
    logEvaluationEvent({
      type: 'manual_ingredient_added',
      candidateId: row.id,
      name: row.name,
    })
    onInventoryChange(null)
    setConfirmError(null)
    onRowsChange([...rows, row])
    setAddValue('')
  }

  function confirmInventory() {
    const result = createConfirmedInventory(rows)
    if (!result.ok) {
      setConfirmError(result.message)
      onInventoryChange(null)
      return
    }
    for (const event of confirmationEvents(result.inventory)) {
      logEvaluationEvent(event)
    }
    setConfirmError(null)
    onInventoryChange(result.inventory)
    window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 0)
  }

  return (
    <section className="card" aria-labelledby="candidate-heading">
      <h2 id="candidate-heading">Possible ingredients</h2>
      <p>
        These are guesses from a saved sample list, not a live look at your
        photo. Check each item you actually have. Unchecked items will not be
        used.
      </p>

      {rows.length === 0 ? (
        <p className="hint">No guesses on the list. Add what you actually have.</p>
      ) : (
        <ul className="candidate-list">
          {rows.map((row) => (
            <li key={row.id} className="candidate-row">
              {row.kind === 'manual-entry' ? (
                <p className="candidate-note">
                  Couldn’t narrow this one down: {row.description}. If you have
                  it, add it yourself below.
                </p>
              ) : (
                <div className="candidate-main">
                  <label className="candidate-check">
                    <input
                      type="checkbox"
                      checked={row.confirmed}
                      disabled={!canConfirmRow(row)}
                      onChange={(event) =>
                        updateRow(row.id, { confirmed: event.target.checked })
                      }
                    />
                    {editingId === row.id ? (
                      <input
                        className="candidate-edit"
                        value={row.name}
                        aria-label="Correct ingredient name"
                        onChange={(event) =>
                          updateRow(row.id, { name: event.target.value })
                        }
                      />
                    ) : (
                      <span>
                        {row.kind === 'ambiguous'
                          ? row.name || 'Pick what this is first'
                          : row.name}
                        {row.origin === 'manual' ? (
                          <span className="candidate-tag"> added</span>
                        ) : null}
                      </span>
                    )}
                  </label>

                  {row.kind === 'ambiguous' ? (
                    <fieldset className="guess-list">
                      <legend>Not sure: {row.description}. Could be:</legend>
                      {row.guesses.map((guess) => (
                        <label key={guess} className="guess-option">
                          <input
                            type="radio"
                            name={`guess-${row.id}`}
                            checked={row.name === guess}
                            onChange={() => updateRow(row.id, { name: guess })}
                          />
                          {guess}
                        </label>
                      ))}
                      <p className="candidate-note">
                        None of these? Use Correct to type it.
                      </p>
                    </fieldset>
                  ) : null}
                </div>
              )}

              <div className="candidate-row-actions">
                {row.origin === 'detected' && row.kind !== 'manual-entry' ? (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() =>
                      setEditingId((current) =>
                        current === row.id ? null : row.id,
                      )
                    }
                  >
                    {editingId === row.id ? 'Done' : 'Correct'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-action"
                  onClick={() => removeRow(row)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="add-ingredient" onSubmit={addManual}>
        <label htmlFor={addId}>Add an ingredient</label>
        <div className="add-ingredient-row">
          <input
            id={addId}
            value={addValue}
            onChange={(event) => setAddValue(event.target.value)}
            placeholder="e.g. onion"
          />
          <button type="submit" className="photo-remove">
            Add
          </button>
        </div>
      </form>

      <button
        type="button"
        className="primary-action"
        onClick={confirmInventory}
        disabled={confirmedCount === 0}
      >
        {confirmedCount === 0
          ? 'Check ingredients to confirm'
          : `Confirm ${confirmedCount} ingredient${confirmedCount === 1 ? '' : 's'}`}
      </button>

      {confirmError ? (
        <p className="photo-error" role="alert">
          {confirmError}
        </p>
      ) : null}

      {inventory ? (
        <div ref={resultRef} className="inventory" aria-live="polite">
          <h3>Confirmed inventory</h3>
          <p className="hint">
            Only these items can be used for recipes later. Recipe search is not
            wired yet.
          </p>
          <ul>
            {inventory.ingredients.map((item) => (
              <li key={item.candidateId}>
                {item.name}
                <span className="candidate-tag"> {item.source}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
