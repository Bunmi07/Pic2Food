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
