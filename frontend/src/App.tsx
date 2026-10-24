import { useRef, useState } from 'react'
import './App.css'
import { IngredientConfirmation } from './components/IngredientConfirmation'
import { PhotoCapture, type SelectedPhoto } from './components/PhotoCapture'
import {
  rowsFromCandidates,
  type CandidateRow,
  type ConfirmedInventory,
} from './confirmedInventory'
import { logEvaluationEvent } from './eventLog'
import {
  loadIngredientCandidates,
  type CandidateLoadResult,
  type CandidateSource,
} from './loadIngredientCandidates'

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

  async function loadCandidates(photo: SelectedPhoto) {
    const generation = ++loadGeneration.current
    setInventory(null)
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
      setInventory(null)
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
          onInventoryChange={setInventory}
        />
      ) : null}
    </main>
  )
}

export default App
