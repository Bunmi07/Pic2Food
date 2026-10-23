/** Max original file size before accept (then canvas prepare downscales). */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024

/** Prefer formats every target browser can decode for canvas prepare. */
export const IMAGE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/jpg'

export const HEIC_UNSUPPORTED_MESSAGE =
  'This photo is HEIC/HEIF, which most browsers cannot prepare (metadata strip needs a readable image). Take a new photo with the camera, or choose/export a JPEG or PNG.'

export type ImageValidationResult =
  | { ok: true }
  | { ok: false; message: string }

export function isHeicLike(file: File): boolean {
  const type = file.type.toLowerCase()
  if (
    type === 'image/heic' ||
    type === 'image/heif' ||
    type === 'image/heic-sequence' ||
    type === 'image/heif-sequence'
  ) {
    return true
  }
  return /\.(heic|heif)$/i.test(file.name)
}

export function validateImageFile(file: File): ImageValidationResult {
  if (!file.type.startsWith('image/') && !isHeicLike(file)) {
    return {
      ok: false,
      message: 'That file is not an image. Choose a photo of your ingredients.',
    }
  }

  // Canvas prepare cannot reliably decode HEIC outside Safari. Fail early
  // with a clear next step instead of a generic "JPEG or PNG" message.
  if (isHeicLike(file)) {
    return {
      ok: false,
      message: HEIC_UNSUPPORTED_MESSAGE,
    }
  }

  if (file.size === 0) {
    return {
      ok: false,
      message: 'That image file is empty. Try taking or choosing another photo.',
    }
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message:
        'That photo is too large (max 12 MB). Try a smaller image or a different photo.',
    }
  }

  return { ok: true }
}
