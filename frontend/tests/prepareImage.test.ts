/**
 * Tests for removing an Exif block from a JPEG without touching the picture
 * bytes. No canvas and no photo file: the buffer is built in the test.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { jpegContainsExifApp1, stripExifApp1 } from '../src/prepareImage.ts'

const SCAN = new Uint8Array([0x53, 0x43, 0x41, 0x4e, 0x11, 0x22, 0xff, 0xd9])

function concat(...parts: Array<Uint8Array | number[]>): Uint8Array {
  const chunks = parts.map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)))
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** SOI, an Exif APP1 segment, a kept quantization segment, then SOS and scan bytes. */
function jpegWithExif(scan: Uint8Array): Uint8Array {
  const exifPayload = new Uint8Array([
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a,
  ])
  const exifLength = 2 + exifPayload.length
  return concat(
    [0xff, 0xd8],
    [0xff, 0xe1, exifLength >> 8, exifLength & 0xff],
    exifPayload,
    [0xff, 0xdb, 0x00, 0x04, 0x00, 0x11],
    [0xff, 0xda, 0x00, 0x02],
    scan,
  )
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    let matches = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }
  return false
}

describe('stripping Exif from a JPEG', () => {
  test('an Exif APP1 segment is removed and the scan data stays', async () => {
    const input = jpegWithExif(SCAN)
    const before = new Blob([input], { type: 'image/jpeg' })
    assert.equal(await jpegContainsExifApp1(before), true)

    const output = stripExifApp1(input)

    assert.equal(output[0], 0xff)
    assert.equal(output[1], 0xd8)
    assert.equal(await jpegContainsExifApp1(new Blob([output], { type: 'image/jpeg' })), false)
    assert.equal(contains(output, new Uint8Array([0x45, 0x78, 0x69, 0x66])), false)
    assert.equal(contains(output, new Uint8Array([0xff, 0xda])), true)
    assert.equal(contains(output, SCAN), true)
    assert.equal(contains(output, new Uint8Array([0xff, 0xdb, 0x00, 0x04, 0x00, 0x11])), true)
  })
})
