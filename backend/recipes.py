"""Turns a raw TheMealDB record into a checked, source-backed recipe.

Only fields TheMealDB actually supplied are kept: ID, title, image, category,
area, tags, ingredients with their measures, instructions, and the source
link. Nothing is added or rewritten. A record without an ID, a title, or at
least one ingredient is rejected (RecipeRecordError), and the caller skips it.

Attribution is required: the original source link when TheMealDB has one,
otherwise the recipe's own TheMealDB page.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

MAX_INGREDIENT_SLOTS = 20
MEALDB_SOURCE_NAME = "TheMealDB"
MEALDB_RECIPE_URL = "https://www.themealdb.com/meal/{}"


class RecipeRecordError(ValueError):
    """The record is missing something every displayed recipe must have."""


@dataclass(frozen=True)
class RecipeIngredient:
    name: str
    measure: str


@dataclass(frozen=True)
class RecipeRecord:
    """One recipe exactly as the source gave it, plus where it came from."""

    id: str
    title: str
    ingredients: Tuple[RecipeIngredient, ...]
    instructions: str
    source_name: str
    source_url: str
    mealdb_url: str
    retrieved_on: str
    image_url: Optional[str] = None
    category: Optional[str] = None
    area: Optional[str] = None
    tags: Tuple[str, ...] = field(default_factory=tuple)


def _text(record: Dict[str, Any], key: str) -> str:
    value = record.get(key)
    return value.strip() if isinstance(value, str) else ""


def _http_url(raw: str, allowed_hosts: Optional[Tuple[str, ...]] = None) -> Optional[str]:
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    if allowed_hosts and not any(
        parsed.hostname == host or parsed.hostname.endswith("." + host) for host in allowed_hosts
    ):
        return None
    return raw


def _source_name(url: str) -> str:
    host = urlparse(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


def parse_recipe(record: Any, retrieved_on: Optional[str] = None) -> RecipeRecord:
    """Validate one raw lookup.php record. Raises RecipeRecordError if unusable."""
    if not isinstance(record, dict):
        raise RecipeRecordError("record is not an object")

    meal_id = _text(record, "idMeal")
    title = _text(record, "strMeal")
    if not meal_id.isdigit() or not title:
        raise RecipeRecordError("record needs a numeric idMeal and a strMeal")

    ingredients = []
    for slot in range(1, MAX_INGREDIENT_SLOTS + 1):
        name = _text(record, "strIngredient{}".format(slot))
        if name:
            ingredients.append(
                RecipeIngredient(name=name, measure=_text(record, "strMeasure{}".format(slot)))
            )
    if not ingredients:
        raise RecipeRecordError("record has no ingredients")

    mealdb_url = MEALDB_RECIPE_URL.format(meal_id)
    original = _http_url(_text(record, "strSource"))
    tags = tuple(tag.strip() for tag in _text(record, "strTags").split(",") if tag.strip())

    return RecipeRecord(
        id=meal_id,
        title=title,
        ingredients=tuple(ingredients),
        instructions=_text(record, "strInstructions"),
        source_name=_source_name(original) if original else MEALDB_SOURCE_NAME,
        source_url=original or mealdb_url,
        mealdb_url=mealdb_url,
        retrieved_on=retrieved_on or date.today().isoformat(),
        image_url=_http_url(_text(record, "strMealThumb"), ("themealdb.com",)),
        category=_text(record, "strCategory") or None,
        area=_text(record, "strArea") or None,
        tags=tags,
    )


def recipe_to_dict(recipe: RecipeRecord) -> Dict[str, Any]:
    """The source-backed fields the frontend may show, as plain JSON."""
    return {
        "id": recipe.id,
        "title": recipe.title,
        "image_url": recipe.image_url,
        "category": recipe.category,
        "area": recipe.area,
        "tags": list(recipe.tags),
        "ingredients": [{"name": i.name, "measure": i.measure} for i in recipe.ingredients],
        "instructions": recipe.instructions,
        "source": {"name": recipe.source_name, "url": recipe.source_url},
        "mealdb_url": recipe.mealdb_url,
        "retrieved_on": recipe.retrieved_on,
    }


def ingredient_names(recipe: RecipeRecord) -> List[str]:
    return [ingredient.name for ingredient in recipe.ingredients]
