"""Server-side checks on the uploaded photo.

The browser downscales the photo and re-encodes it as JPEG with metadata
removed. The server does not trust that: it accepts only JPEG and rejects
any file that still carries an Exif segment.
"""

from typing import Optional

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def validate_jpeg_upload(data: bytes) -> Optional[str]:
    """Return an error code, or None when the upload is acceptable."""
    if not data:
        return "empty"
    if len(data) > MAX_UPLOAD_BYTES:
        return "too_large"
    if not data.startswith(b"\xff\xd8\xff"):
        return "not_jpeg"
    if jpeg_contains_exif(data):
        return "has_metadata"
    return None


def jpeg_contains_exif(data: bytes) -> bool:
    """True if the JPEG still carries an Exif block (camera, location, time)."""
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            return False
        marker = data[offset + 1]
        if marker in (0xDA, 0xD9):
            return False
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            offset += 2
            continue
        length = (data[offset + 2] << 8) | data[offset + 3]
        if length < 2 or offset + 2 + length > len(data):
            return False
        if marker == 0xE1 and data[offset + 4 : offset + 8] == b"Exif":
            return True
        offset += 2 + length
    return False
