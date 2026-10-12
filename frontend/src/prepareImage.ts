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
 * MAX_IMAGE_EDGE_PX. The prepared File is what the app should keep in memory
 * for preview and any later upload — never the original camera file.
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
    if (await jpegContainsExifApp1(blob)) {
      throw new ImagePrepareError(
        'Could not strip photo metadata. Try another image.',
      )
    }

    const baseName = stripExtension(file.name) || 'ingredient-photo'
    return new File([blob], `${baseName}.jpg`, {
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

    if (marker === 0xe1) {
      const payloadStart = offset + 4
      if (
        payloadStart + 4 <= bytes.length &&
        bytes[payloadStart] === 0x45 &&
        bytes[payloadStart + 1] === 0x78 &&
        bytes[payloadStart + 2] === 0x69 &&
        bytes[payloadStart + 3] === 0x66
      ) {
        return true
      }
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
