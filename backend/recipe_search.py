"""Recipe search: confirmed ingredients + constraints in, ranked sourced recipes out.

Steps, in this order:
1. Load TheMealDB's whole catalog (about 800 recipes) into memory on the
   first search, and reuse it until it is older than the configured number
   of hours. Nothing is written to disk. Malformed records are skipped.
2. Report confirmed ingredients that no recipe in the catalog uses as not
   found; nothing is guessed.
3. Keep every recipe that uses at least one confirmed ingredient, then drop
   any that hits an allergy or food to avoid (hard filter) before scoring.
   A blocked recipe can never become a near match.
4. Score and classify: supported match, near match, or no match.
5. Attach each recipe's code-written "why this fits you" line
   (explanations.py). The optional AI-worded version is a separate request
   (score_recipes_by_id rebuilds the facts for it).
"""

import logging
import string
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Dict, FrozenSet, List, Optional, Tuple

from backend.config import RecipeSettings
from backend.constraints import Constraints, check_recipe, words
from backend.explanations import constraints_sentence, facts_for, template_line
from backend.feasibility import (
    ScoredRecipe,
    classify,
    ingredient_keys,
    score_recipe,
    scored_to_dict,
    user_key_set,
)
from backend.mealdb_client import MealDbClient, RecipeSourceError
from backend.recipes import (
    RecipeRecord,
    RecipeRecordError,
    ingredient_names,
    parse_recipe,
    recipe_to_dict,
)

logger = logging.getLogger("pic2food")

MAX_PARALLEL_REQUESTS = 6
TITLE_START_CHARACTERS = string.ascii_lowercase + string.digits
# Recipes whose title starts with something else ("Æbleskiver") are fetched
# one by one; the cap guards against a source change turning this into
# hundreds of calls.
MAX_SINGLE_LOOKUPS = 100


class RecipeSourceMalformed(RecipeSourceError):
    """Every record TheMealDB returned failed validation."""


@dataclass(frozen=True)
class RecipeCatalog:
    recipes: Tuple[RecipeRecord, ...]
    ingredient_keys: FrozenSet[str]
    food_words: FrozenSet[str]  # every word in any ingredient name; used to check explanations
    malformed: int
    loaded_at: float


_catalog_lock = threading.Lock()
_catalog_cache: Dict[str, RecipeCatalog] = {}


def clear_recipe_catalog_cache() -> None:
    with _catalog_lock:
        _catalog_cache.clear()


def load_catalog(client: MealDbClient) -> RecipeCatalog:
    """Fetch and validate every recipe TheMealDB has. Any failed request fails the load."""
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_REQUESTS) as pool:
        all_ids = set()
        for ids in pool.map(client.recipe_ids_in_category, client.list_categories()):
            all_ids.update(ids)

        raw_by_id: Dict[str, Dict[str, object]] = {}
        for meals in pool.map(client.recipes_starting_with, TITLE_START_CHARACTERS):
            for raw in meals:
                meal_id = raw.get("idMeal")
                if isinstance(meal_id, str):
                    raw_by_id[meal_id] = raw

        leftover = sorted(all_ids - set(raw_by_id), key=int)[:MAX_SINGLE_LOOKUPS]
        for meal_id, raw in zip(leftover, pool.map(client.lookup_recipe, leftover)):
            if raw is not None:
                raw_by_id[meal_id] = raw

    recipes: List[RecipeRecord] = []
    malformed = 0
    for meal_id in sorted(raw_by_id, key=lambda value: (not value.isdigit(), value)):
        try:
            recipes.append(parse_recipe(raw_by_id[meal_id]))
        except RecipeRecordError:
            malformed += 1
    if not recipes:
        if malformed:
            raise RecipeSourceMalformed("all {} records were malformed".format(malformed))
        raise RecipeSourceError("empty catalog")

    keys = frozenset(
        key for recipe in recipes for name in ingredient_names(recipe) for key in ingredient_keys(name)
    )
    food_words = frozenset(
        word for recipe in recipes for name in ingredient_names(recipe) for word in words(name)
    )
    logger.info("recipe_catalog loaded recipes=%d malformed=%d", len(recipes), malformed)
    return RecipeCatalog(tuple(recipes), keys, food_words, malformed, time.monotonic())


def get_catalog(client: MealDbClient) -> RecipeCatalog:
    """The cached catalog, reloaded when older than settings.catalog_hours."""
    cache_key = "{}/{}".format(client.settings.base_url, client.settings.api_key)
    max_age = client.settings.catalog_hours * 3600
    with _catalog_lock:
        cached: Optional[RecipeCatalog] = _catalog_cache.get(cache_key)
        if cached and time.monotonic() - cached.loaded_at < max_age:
            return cached
        catalog = load_catalog(client)
        _catalog_cache[cache_key] = catalog
        return catalog


def search_recipes(
    ingredients: List[str],
    constraints: Constraints,
    client: MealDbClient,
    settings: RecipeSettings,
) -> Dict[str, object]:
    """Run the full search. Raises RecipeSourceError (or a subclass) if TheMealDB fails."""
    catalog = get_catalog(client)
    not_found = [name for name in ingredients if not ingredient_keys(name) & catalog.ingredient_keys]

    user_keys = user_key_set(ingredients)
    candidates = [
        recipe
        for recipe in catalog.recipes
        if any(ingredient_keys(name) & user_keys for name in ingredient_names(recipe))
    ]

    scored = []
    blocked = 0
    for recipe in candidates:
        check = check_recipe(ingredient_names(recipe), constraints)
        if not check.allowed:
            blocked += 1
            continue
        scored.append(score_recipe(recipe, user_keys, check.unchecked))

    status, chosen = classify(scored, settings)
    logger.info(
        "recipe_search outcome=%s catalog=%d candidates=%d blocked=%d shown=%d",
        status, len(catalog.recipes), len(candidates), blocked, len(chosen),
    )
    tail = constraints_sentence(constraints)
    recipes = []
    for s in chosen:
        entry = dict(recipe_to_dict(s.recipe), **scored_to_dict(s))
        entry["explanation"] = " ".join(filter(None, [template_line(facts_for(s)), tail]))
        recipes.append(entry)
    return {"status": status, "recipes": recipes, "not_found": not_found}


class UnknownRecipeIds(ValueError):
    """An ID isn't in the catalog, is blocked by the constraints, or uses none of the ingredients."""


def score_recipes_by_id(
    recipe_ids: List[str],
    ingredients: List[str],
    constraints: Constraints,
    client: MealDbClient,
) -> Tuple[List[ScoredRecipe], RecipeCatalog]:
    """Rebuild the scored recipes for an explanation request, from our own data only.

    The browser sends only IDs; the facts are recomputed here so nothing the
    browser sends can reach the model as a "fact".
    """
    catalog = get_catalog(client)
    by_id = {recipe.id: recipe for recipe in catalog.recipes}
    user_keys = user_key_set(ingredients)
    scored = []
    for recipe_id in recipe_ids:
        recipe = by_id.get(recipe_id)
        if recipe is None:
            raise UnknownRecipeIds(recipe_id)
        check = check_recipe(ingredient_names(recipe), constraints)
        if not check.allowed:
            raise UnknownRecipeIds(recipe_id)
        result = score_recipe(recipe, user_keys, check.unchecked)
        if not result.matched:
            raise UnknownRecipeIds(recipe_id)
        scored.append(result)
    return scored, catalog
