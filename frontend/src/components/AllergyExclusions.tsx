/**
 * The "Allergies and foods to avoid" card, shown once the ingredient list is ready.
 *
 * The user ticks any of the nine common allergens and may type foods to
 * avoid, then presses the button to check. If a confirmed ingredient clashes
 * (for example egg with an egg allergy), recipe search is blocked until the
 * user removes the ingredient or unticks the allergy. Choices are owned by
 * App so they survive edits to the ingredient list. App is told whether the
 * check is clear (onClearedChange); only a clear check starts recipe search.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ALLERGENS,
  addAvoidTerm,
  conflictMessage,
  hasConstraints,
  MAX_AVOID_LENGTH,
  requestConstraintCheck,
  type AllergenId,
  type Conflict,
  type UserConstraints,
} from '../constraints'
import type { ReadyIngredient } from '../normalizeInventory'

type AllergyExclusionsProps = {
  ingredients: ReadyIngredient[]
  constraints: UserConstraints
  onConstraintsChange: (constraints: UserConstraints) => void
  onClearedChange: (cleared: boolean) => void
}

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'failed'; message: string }
  | { status: 'blocked'; conflicts: Conflict[] }
  | { status: 'clear' }

export function AllergyExclusions({
  ingredients,
  constraints,
  onConstraintsChange,
  onClearedChange,
}: AllergyExclusionsProps) {
  const cardRef = useRef<HTMLElement>(null)
  const checkGeneration = useRef(0)
  const [check, setCheck] = useState<CheckState>({ status: 'idle' })
  const [avoidDraft, setAvoidDraft] = useState('')

  useEffect(() => {
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  function update(next: UserConstraints) {
    checkGeneration.current += 1
    setCheck({ status: 'idle' })
    onClearedChange(false)
    onConstraintsChange(next)
  }

  function toggleAllergen(id: AllergenId) {
    const allergens = constraints.allergens.includes(id)
      ? constraints.allergens.filter((existing) => existing !== id)
      : [...constraints.allergens, id]
    update({ ...constraints, allergens })
  }

  function addAvoid(event: FormEvent) {
    event.preventDefault()
    const avoid = addAvoidTerm(constraints.avoid, avoidDraft)
    if (avoid !== constraints.avoid) {
      update({ ...constraints, avoid })
    }
    setAvoidDraft('')
  }

  function removeAvoid(term: string) {
    update({ ...constraints, avoid: constraints.avoid.filter((existing) => existing !== term) })
  }

  /** Ask the backend for clashes. Search is only unblocked by a "clear" answer. */
  async function runCheck() {
    const generation = ++checkGeneration.current
    setCheck({ status: 'checking' })
    onClearedChange(false)
    const result = await requestConstraintCheck(
      ingredients.map((item) => item.name),
      constraints,
    )
    if (generation !== checkGeneration.current) {
      return
    }
    if (!result.ok) {
      setCheck({ status: 'failed', message: result.message })
    } else if (result.conflicts.length > 0) {
      setCheck({ status: 'blocked', conflicts: result.conflicts })
    } else {
      setCheck({ status: 'clear' })
      onClearedChange(true)
    }
  }

  const anyConstraints = hasConstraints(constraints)
  const allergenLabels = ALLERGENS.filter((a) => constraints.allergens.includes(a.id)).map(
    (a) => a.label,
  )

  return (
    <section ref={cardRef} className="card" aria-labelledby="constraints-heading">
      <h2 id="constraints-heading">Allergies and foods to avoid</h2>
      <p>
        Any recipe that lists one of these will be left out, even if it’s a
        great match.
      </p>

      <fieldset className="allergen-grid">
        <legend>Allergies</legend>
        {ALLERGENS.map((allergen) => (
          <label key={allergen.id} className="candidate-check">
            <input
              type="checkbox"
              checked={constraints.allergens.includes(allergen.id)}
              onChange={() => toggleAllergen(allergen.id)}
            />
            {allergen.label}
          </label>
        ))}
      </fieldset>

      <form className="add-ingredient" onSubmit={addAvoid}>
        <label htmlFor="avoid-input">Other foods to avoid</label>
        <div className="add-ingredient-row">
          <input
            id="avoid-input"
            value={avoidDraft}
            maxLength={MAX_AVOID_LENGTH}
            placeholder="e.g. pork"
            onChange={(event) => setAvoidDraft(event.target.value)}
          />
          <button type="submit" className="photo-remove" disabled={!avoidDraft.trim()}>
            Add
          </button>
        </div>
        <p className="hint">
          Groups like “pork”, “meat”, “dairy”, “nuts”, “gluten”, and “alcohol”
          also cover related foods (“pork” covers bacon and ham). Anything else
          is matched by name, so add each food you want left out.
        </p>
      </form>

      {constraints.avoid.length > 0 ? (
        <ul className="chip-list" aria-label="Foods to avoid">
          {constraints.avoid.map((term) => (
            <li key={term} className="chip">
              {term}
              <button
                type="button"
                className="text-action"
                aria-label={`Stop avoiding ${term}`}
                onClick={() => removeAvoid(term)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="hint">
        We filter by the ingredient names listed in each recipe. That can’t
        guarantee a dish is free of an allergen, so always check labels and the
        full recipe.
      </p>

      <button
        type="button"
        className="primary-action constraints-action"
        disabled={check.status === 'checking'}
        onClick={runCheck}
      >
        {check.status === 'checking'
          ? 'Checking…'
          : anyConstraints
            ? 'Check and continue'
            : 'Continue with no allergies or foods to avoid'}
      </button>

      <div aria-live="polite">
        {check.status === 'failed' ? (
          <p className="photo-error" role="alert">
            {check.message}
          </p>
        ) : null}

        {check.status === 'blocked' ? (
          <div className="photo-error" role="alert">
            <ul>
              {check.conflicts.map((conflict) => (
                <li key={conflict.ingredient}>{conflictMessage(conflict)}</li>
              ))}
            </ul>
            <p>
              Remove {check.conflicts.length === 1 ? 'it' : 'them'} from your
              ingredients above, or change your allergies and foods to avoid.
            </p>
          </div>
        ) : null}

        {check.status === 'clear' ? (
          <div className="inventory">
            <h3>Searching with these filters</h3>
            <p className="hint">
              {allergenLabels.length > 0
                ? `Leaving out: ${allergenLabels.join(', ')}.`
                : 'No allergies set.'}{' '}
              {constraints.avoid.length > 0 ? `Avoiding: ${constraints.avoid.join(', ')}.` : ''}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
