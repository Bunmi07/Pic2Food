import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { IMAGE_ACCEPT, validateImageFile } from '../imageValidation'
import { ImagePrepareError, prepareImageFile } from '../prepareImage'

type SelectedPhoto = {
  file: File
  previewUrl: string
}

export function PhotoCapture() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [photo, setPhoto] = useState<SelectedPhoto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])

  function clearInputValue() {
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  function revokeCurrentPreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }

  function removePhoto() {
    if (isPreparing) {
      return
    }
    revokeCurrentPreview()
    setPhoto(null)
    setError(null)
    clearInputValue()
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const result = validateImageFile(file)
    if (!result.ok) {
      setError(result.message)
      clearInputValue()
      return
    }

    setIsPreparing(true)
    setError(null)

    try {
      // Keep only the canvas-re-encoded file (metadata stripped + downscaled).
      const prepared = await prepareImageFile(file)
      revokeCurrentPreview()
      const previewUrl = URL.createObjectURL(prepared)
      previewUrlRef.current = previewUrl
      setPhoto({ file: prepared, previewUrl })
    } catch (caught) {
      const message =
        caught instanceof ImagePrepareError
          ? caught.message
          : 'Could not prepare that photo. Try another image.'
      setError(message)
      clearInputValue()
    } finally {
      setIsPreparing(false)
    }
  }

  return (
    <section className="card photo-card" aria-labelledby="photo-capture-heading">
      <h2 id="photo-capture-heading">Your ingredient photo</h2>

      <div
        className={`preview${photo ? '' : ' empty'}`}
        aria-live="polite"
        aria-busy={isPreparing}
      >
        {photo ? (
          <img
            src={photo.previewUrl}
            alt={`Selected ingredient photo: ${photo.file.name}`}
          />
        ) : (
          <p>No photo yet. Take or choose a clear photo of the food you have.</p>
        )}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        className="photo-input"
        type="file"
        accept={IMAGE_ACCEPT}
        capture="environment"
        disabled={isPreparing}
        onChange={onFileChange}
      />

      <div className="photo-actions">
        <label
          htmlFor={inputId}
          className={`photo-pick${isPreparing ? ' disabled' : ''}`}
          aria-disabled={isPreparing}
        >
          {isPreparing
            ? 'Preparing photo…'
            : photo
              ? 'Replace photo'
              : 'Take or choose photo'}
        </label>
        {photo ? (
          <button
            type="button"
            className="photo-remove"
            onClick={removePhoto}
            disabled={isPreparing}
          >
            Remove
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="photo-error" role="alert">
          {error}
        </p>
      ) : null}

      {photo ? (
        <p className="hint">
          Photo is prepared in memory with metadata removed and size reduced.
          Confirmation and recipe search are not wired yet.
        </p>
      ) : (
        <p className="hint">
          Prefer JPEG or PNG. On iPhone, “Take photo” usually works; library
          HEIC files often cannot be prepared in the browser. Confirmation and
          recipe search are not wired yet.
        </p>
      )}
    </section>
  )
}
