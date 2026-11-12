/**
 * Makes the copy of the photo the app actually uses: shrunk to at most
 * 1600px and re-saved as JPEG, which removes location and camera data.
 * The original camera file is never kept or uploaded.
 */

/** Longest edge after prepare. Full-resolution phone photos are not kept. */
export const MAX_IMAGE_EDGE_PX = 1600

const JPEG_QUALITY = 0.85

export class ImagePrepareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImagePrepareError'
  }
}

/**
 * Re-encodes the image through canvas so EXIF and other embedded metadata
 * are not carried forward. Also downscales so the longest edge is at most
 * MAX_IMAGE_EDGE_PX. Some browsers (iPhone Safari) still write an Exif APP1
 * segment into that new JPEG; stripExifApp1 removes it. The prepared File is
 * what the app should keep in memory for preview and any later upload — never
 * the original camera file.
 */
export async function prepareImageFile(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    const type = file.type.toLowerCase()
    const looksHeic =
      type.includes('heic') ||
      type.includes('heif') ||
      /\.(heic|heif)$/i.test(file.name)
    throw new ImagePrepareError(
      looksHeic
        ? 'This photo is HEIC/HEIF, which most browsers cannot prepare. Take a new photo with the camera, or choose/export a JPEG or PNG.'
        : 'Could not read that photo. Try a JPEG, PNG, or WebP image.',
    )
  }

  try {
    const { width, height } = fitWithinMaxEdge(
      bitmap.width,
      bitmap.height,
      MAX_IMAGE_EDGE_PX,
    )

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) {
      throw new ImagePrepareError(
        'Could not prepare that photo in this browser. Try another browser or device.',
      )
    }

    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await canvasToJpegBlob(canvas)
    const stripped = stripExifApp1(new Uint8Array(await blob.arrayBuffer()))
    if (await jpegContainsExifApp1(new Blob([stripped], { type: 'image/jpeg' }))) {
      throw new ImagePrepareError(
        'This photo could not be prepared. Try another photo of your ingredients.',
      )
    }

    const baseName = stripExtension(file.name) || 'ingredient-photo'
    return new File([stripped], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } finally {
    bitmap.close()
  }
}

export function fitWithinMaxEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    return { width, height }
  }

  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(
            new ImagePrepareError(
              'Could not prepare that photo. Try another image.',
            ),
          )
          return
        }
        resolve(blob)
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/**
 * Remove APP1 Exif segments from a JPEG. The scan (the picture bytes after
 * the SOS marker) is copied through unchanged. A buffer that is not a JPEG
 * is returned as-is.
 */
export function stripExifApp1(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return bytes
  }

  const chunks: Uint8Array[] = [bytes.subarray(0, 2)]
  let offset = 2

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      chunks.push(bytes.subarray(offset))
      return concatChunks(chunks)
    }

    const marker = bytes[offset + 1]
    // SOS begins the scan. Copy it and everything after it, including EOI.
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(bytes.subarray(offset))
      return concatChunks(chunks)
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(bytes.subarray(offset, offset + 2))
      offset += 2
      continue
    }

    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) {
      chunks.push(bytes.subarray(offset))
      return concatChunks(chunks)
    }

    const segmentEnd = offset + 2 + segmentLength
    if (!(marker === 0xe1 && payloadStartsWithExif(bytes, offset + 4, segmentEnd))) {
      chunks.push(bytes.subarray(offset, segmentEnd))
    }
    offset = segmentEnd
  }

  if (offset < bytes.length) {
    chunks.push(bytes.subarray(offset))
  }
  return concatChunks(chunks)
}

function payloadStartsWithExif(bytes: Uint8Array, start: number, end: number): boolean {
  return (
    start + 4 <= end &&
    bytes[start] === 0x45 &&
    bytes[start + 1] === 0x78 &&
    bytes[start + 2] === 0x69 &&
    bytes[start + 3] === 0x66
  )
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** True if a JPEG buffer contains an APP1 Exif segment. */
export async function jpegContainsExifApp1(blob: Blob): Promise<boolean> {
  if (blob.type && blob.type !== 'image/jpeg') {
    return false
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return false
  }

  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      break
    }

    const marker = bytes[offset + 1]
    if (marker === 0xda) {
      // Start of scan — image data follows; stop looking for metadata.
      break
    }

    if (marker === 0xd9) {
      break
    }

    // Standalone markers with no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) {
      break
    }

    if (marker === 0xe1 && payloadStartsWithExif(bytes, offset + 4, offset + 2 + segmentLength)) {
      return true
    }

    offset += 2 + segmentLength
  }

  return false
}

function stripExtension(name: string): string {
  const trimmed = name.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) {
    return trimmed
  }
  return trimmed.slice(0, dot)
}
