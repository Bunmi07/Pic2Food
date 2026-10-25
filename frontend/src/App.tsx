/**
 * The whole screen, top to bottom: photo tips, photo capture, then either a
 * loading message, a failure message, or the ingredient confirmation list.
 *
 * Owns the flow between those steps. When a photo is ready it asks for
 * ingredient guesses, logs which ones were shown, and hands them to
 * IngredientConfirmation. Once the user confirms, NormalizedInventory turns
 * the confirmed names into standard names for recipe search, and then
 * AllergyExclusions collects allergies and foods to avoid. App keeps those
 * choices so they survive edits to the ingredient list. Only after the
 * allergy check is clear does RecipeResults search; any upstream change
 * (ingredients, meanings, allergies) clears that and removes old results.
 */
import { useCallback, useRef, useState } from 'react'
import './App.css'
import { AllergyExclusions } from './components/AllergyExclusions'
import { IngredientConfirmation } from './components/IngredientConfirmation'
import { NormalizedInventory } from './components/NormalizedInventory'
import { PhotoCapture, type SelectedPhoto } from './components/PhotoCapture'
import { RecipeResults } from './components/RecipeResults'
import {
  rowsFromCandidates,
  type CandidateRow,
  type ConfirmedInventory,
} from './confirmedInventory'
import { NO_CONSTRAINTS, type UserConstraints } from './constraints'
import { logEvaluationEvent } from './eventLog'
import {
  loadIngredientCandidates,
  type CandidateLoadResult,
  type CandidateSource,
} from './loadIngredientCandidates'
import type { ReadyIngredient } from './normalizeInventory'

type FailedLoad = Extract<CandidateLoadResult, { ok: false }>

function App() {
  const loadGeneration = useRef(0)
  const photoRef = useRef<SelectedPhoto | null>(null)
  const [candidateStatus, setCandidateStatus] = useState<
    'idle' | 'loading' | 'ready' | 'failed'
  >('idle')
  const [failure, setFailure] = useState<FailedLoad | null>(null)
  const [source, setSource] = useState<CandidateSource>('vision')
  const [rows, setRows] = useState<CandidateRow[]>([])
  const [inventory, setInventory] = useState<ConfirmedInventory | null>(null)
  const [readyIngredients, setReadyIngredients] = useState<ReadyIngredient[] | null>(null)
  const [constraints, setConstraints] = useState<UserConstraints>(NO_CONSTRAINTS)
  const [constraintsCleared, setConstraintsCleared] = useState(false)

  function changeInventory(next: ConfirmedInventory | null) {
    setInventory(next)
    setReadyIngredients(null)
    setConstraintsCleared(false)
  }

  const changeReadyIngredients = useCallback((next: ReadyIngredient[] | null) => {
    setReadyIngredients(next)
    setConstraintsCleared(false)
  }, [])

  /**
   * Fetch guesses for a photo and move the screen to ready or failed. If the
   * user replaces the photo mid-request, the older answer is discarded.
   */
  async function loadCandidates(photo: SelectedPhoto) {
    const generation = ++loadGeneration.current
    changeInventory(null)
    setFailure(null)
    setRows([])
    setCandidateStatus('loading')

    const result = await loadIngredientCandidates(photo.file)
    if (generation !== loadGeneration.current) {
      return
    }

    if (!result.ok) {
      setFailure(result)
      setCandidateStatus('failed')
      return
    }

    for (const item of result.items) {
      logEvaluationEvent({
        type: 'candidate_presented',
        candidateId: item.id,
        name: item.kind === 'named' ? item.name : item.description,
      })
    }
    setSource(result.source)
    setRows(rowsFromCandidates(result.items))
    setCandidateStatus('ready')
  }

  function handlePhotoChange(photo: SelectedPhoto | null) {
    if (candidateStatus === 'ready' && !inventory) {
      logEvaluationEvent({ type: 'confirmation_abandoned' })
    }
    photoRef.current = photo

    if (!photo) {
      loadGeneration.current += 1
      changeInventory(null)
      setFailure(null)
      setRows([])
      setCandidateStatus('idle')
      return
    }

    void loadCandidates(photo)
  }

  function retry() {
    if (photoRef.current) {
      void loadCandidates(photoRef.current)
    }
  }

  return (
    <main className="app">
      <header className="top">
        <p className="eyebrow">Pic2Food</p>
        <h1>What’s in the fridge. What you can actually cook.</h1>
      </header>

      <section className="card" aria-labelledby="photo-guidance-heading">
        <h2 id="photo-guidance-heading">Before you take a photo</h2>
        <p>
          Results depend on how clearly the ingredients show. This app proposes
          guesses from a photo; you confirm what you actually have before any
          recipes are retrieved.
        </p>
        <ul>
          <li>Use good lighting.</li>
          <li>Spread ingredients out where you can.</li>
          <li>
            Avoid shooting through closed packaging or items hidden behind other
            objects.
          </li>
        </ul>
      </section>

      <PhotoCapture onPhotoChange={handlePhotoChange} />

      {candidateStatus === 'loading' ? (
        <section className="card" aria-live="polite" aria-busy="true">
          <h2>Possible ingredients</h2>
          <p>Looking for ingredients in your photo…</p>
        </section>
      ) : null}

      {candidateStatus === 'failed' && failure ? (
        <section className="card" aria-live="assertive">
          <h2>
            {failure.reason === 'not_food'
              ? 'No food found'
              : failure.reason === 'unreadable'
                ? 'Couldn’t identify anything'
                : 'Something went wrong'}
          </h2>
          <p className="photo-error" role="alert">
            {failure.message}
          </p>
          {failure.canRetry ? (
            <button type="button" className="primary-action" onClick={retry}>
              Try again
            </button>
          ) : null}
        </section>
      ) : null}

      {candidateStatus === 'ready' ? (
        <IngredientConfirmation
          rows={rows}
          source={source}
          onRowsChange={setRows}
          inventory={inventory}
          onInventoryChange={changeInventory}
        />
      ) : null}

      {candidateStatus === 'ready' && inventory ? (
        <NormalizedInventory
          key={inventory.ingredients.map((item) => item.name).join('|')}
          inventory={inventory}
          onReadyChange={changeReadyIngredients}
        />
      ) : null}

      {candidateStatus === 'ready' && inventory && readyIngredients ? (
        <AllergyExclusions
          key={readyIngredients.map((item) => item.name).join('|')}
          ingredients={readyIngredients}
          constraints={constraints}
          onConstraintsChange={setConstraints}
          onClearedChange={setConstraintsCleared}
        />
      ) : null}

      {candidateStatus === 'ready' && inventory && readyIngredients && constraintsCleared ? (
        <RecipeResults
          key={JSON.stringify([readyIngredients.map((item) => item.name), constraints])}
          ingredients={readyIngredients}
          constraints={constraints}
        />
      ) : null}
    </main>
  )
}

export default App
