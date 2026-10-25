"""Backend settings read from environment variables (the .env file).

Keeps the OpenAI key, the model name, timeouts, the recipe source, and the
match thresholds out of the code, so they can change without editing it.
"""

import os
from dataclasses import dataclass
from typing import Optional

DEFAULT_VISION_TIMEOUT_SECONDS = 15.0
DEFAULT_VISION_MODEL = "gpt-4o-mini"

DEFAULT_MEALDB_BASE_URL = "https://www.themealdb.com/api/json/v1"
DEFAULT_MEALDB_API_KEY = "1"
DEFAULT_RECIPE_TIMEOUT_SECONDS = 8.0
DEFAULT_RECIPE_CATALOG_HOURS = 24.0
DEFAULT_MAX_MISSING = 2
DEFAULT_NEAR_MATCH_MARGIN = 1


@dataclass(frozen=True)
class VisionSettings:
    api_key: Optional[str]
    model: str
    timeout_seconds: float


@dataclass(frozen=True)
class RecipeSettings:
    """TheMealDB access plus the feasibility rules.

    max_missing: a recipe is a supported match when it misses at most this many
    ingredients (pantry staples don't count). near_match_margin: a near match
    misses more than max_missing but no more than max_missing + margin.
    catalog_hours: how long the in-memory recipe catalog is kept before reloading.
    """

    base_url: str
    api_key: str
    timeout_seconds: float
    catalog_hours: float
    max_missing: int
    near_match_margin: int


def load_vision_settings() -> VisionSettings:
    """Read vision settings, falling back to defaults for missing or bad values."""
    return VisionSettings(
        api_key=os.getenv("OPENAI_API_KEY") or None,
        model=os.getenv("OPENAI_VISION_MODEL") or DEFAULT_VISION_MODEL,
        timeout_seconds=_positive_float(
            os.getenv("VISION_TIMEOUT_SECONDS"), DEFAULT_VISION_TIMEOUT_SECONDS
        ),
    )


def load_recipe_settings() -> RecipeSettings:
    """Read recipe-source settings. The default key "1" is TheMealDB's free development key."""
    return RecipeSettings(
        base_url=(os.getenv("MEALDB_BASE_URL") or DEFAULT_MEALDB_BASE_URL).rstrip("/"),
        api_key=os.getenv("MEALDB_API_KEY") or DEFAULT_MEALDB_API_KEY,
        timeout_seconds=_positive_float(
            os.getenv("RECIPE_TIMEOUT_SECONDS"), DEFAULT_RECIPE_TIMEOUT_SECONDS
        ),
        catalog_hours=_positive_float(
            os.getenv("RECIPE_CATALOG_HOURS"), DEFAULT_RECIPE_CATALOG_HOURS
        ),
        max_missing=_non_negative_int(os.getenv("RECIPE_MAX_MISSING"), DEFAULT_MAX_MISSING),
        near_match_margin=_non_negative_int(
            os.getenv("RECIPE_NEAR_MATCH_MARGIN"), DEFAULT_NEAR_MATCH_MARGIN
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


def _non_negative_int(raw: Optional[str], default: int) -> int:
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= 0 else default
