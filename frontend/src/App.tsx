import { useRef, useState } from 'react'
import './App.css'
import { IngredientConfirmation } from './components/IngredientConfirmation'
import { PhotoCapture } from './components/PhotoCapture'
import {
  rowsFromCandidates,
  type CandidateRow,
  type ConfirmedInventory,
} from './confirmedInventory'
import { logEvaluationEvent } from './eventLog'
import { loadIngredientCandidates } from './loadIngredientCandidates'

function App() {
  const loadGeneration = useRef(0)
  const [hasPhoto, setHasPhoto] = useState(false)
  const [candidateStatus, setCandidateStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [candidateError, setCandidateError] = useState<string | null>(null)
  const [rows, setRows] = useState<CandidateRow[]>([])
  const [inventory, setInventory] = useState<ConfirmedInventory | null>(null)

  async function handlePhotoChange(photo: { file: File; previewUrl: string } | null) {
    const generation = ++loadGeneration.current
    if (candidateStatus === 'ready' && !inventory) {
      logEvaluationEvent({ type: 'confirmation_abandoned' })
    }
    setInventory(null)
    setCandidateError(null)

    if (!photo) {
      setHasPhoto(false)
      setRows([])
      setCandidateStatus('idle')
      return
    }

    setHasPhoto(true)
    setCandidateStatus('loading')
    setRows([])

    const result = await loadIngredientCandidates()
    if (generation !== loadGeneration.current) {
      return
    }

    if (!result.ok) {
      setCandidateStatus('error')
      setCandidateError(result.message)
      return
    }

    for (const item of result.items) {
      logEvaluationEvent({
        type: 'candidate_presented',
        candidateId: item.id,
        name: item.kind === 'named' ? item.name : item.description,
      })
    }
    setRows(rowsFromCandidates(result.items))
    setCandidateStatus('ready')
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
          <p>Loading ingredient guesses…</p>
        </section>
      ) : null}

      {candidateStatus === 'error' && candidateError ? (
        <section className="card" aria-live="assertive">
          <h2>Possible ingredients</h2>
          <p className="photo-error" role="alert">
            {candidateError}
          </p>
        </section>
      ) : null}

      {hasPhoto && candidateStatus === 'ready' ? (
        <IngredientConfirmation
          rows={rows}
          onRowsChange={setRows}
          inventory={inventory}
          onInventoryChange={setInventory}
        />
      ) : null}
    </main>
  )
}

export default App
