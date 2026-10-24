"""Backend settings read from environment variables (the .env file).

Keeps the OpenAI key, the model name, and the vision timeout out of the
code, so they can change without editing it.
"""

import os
from dataclasses import dataclass
from typing import Optional

DEFAULT_VISION_TIMEOUT_SECONDS = 15.0
DEFAULT_VISION_MODEL = "gpt-4o-mini"


@dataclass(frozen=True)
class VisionSettings:
    api_key: Optional[str]
    model: str
    timeout_seconds: float


def load_vision_settings() -> VisionSettings:
    """Read vision settings, falling back to defaults for missing or bad values."""
    return VisionSettings(
        api_key=os.getenv("OPENAI_API_KEY") or None,
        model=os.getenv("OPENAI_VISION_MODEL") or DEFAULT_VISION_MODEL,
        timeout_seconds=_positive_float(
            os.getenv("VISION_TIMEOUT_SECONDS"), DEFAULT_VISION_TIMEOUT_SECONDS
        ),
    )


def _positive_float(raw: Optional[str], default: float) -> float:
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default
