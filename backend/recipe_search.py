"""Recipe search: confirmed ingredients + constraints in, ranked sourced recipes out.

Steps, in this order:
1. Learn TheMealDB's ingredient names (cached) and map each confirmed
   ingredient to the names TheMealDB uses for it, with the same rules as
   feasibility.py. Ingredients with no TheMealDB name are reported as
   not found; nothing is guessed.
2. Collect recipes that use any of those ingredients, keeping the ones that
   use the most of the user's ingredients, then fetch their full records.
3. Drop any recipe that hits an allergy or food to avoid (hard filter),
   before scoring. A blocked recipe can never become a near match.
4. Score and classify: supported match, near match, or no match.
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Set

from backend.config import RecipeSettings
from backend.constraints import Constraints, check_recipe
from backend.feasibility import classify, ingredient_keys, score_recipe, scored_to_dict, user_key_set
from backend.mealdb_client import MealDbClient, RecipeSourceError
from backend.recipes import RecipeRecordError, ingredient_names, parse_recipe, recipe_to_dict

logger = logging.getLogger("pic2food")

MAX_PARALLEL_REQUESTS = 6

_index_lock = threading.Lock()
_index_cache: Dict[str, Dict[str, List[str]]] = {}


class RecipeSourceMalformed(RecipeSourceError):
    """Every candidate record TheMealDB returned failed validation."""


def clear_ingredient_index_cache() -> None:
    with _index_lock:
        _index_cache.clear()


def source_ingredient_index(client: MealDbClient) -> Dict[str, List[str]]:
    """Map each matching key to TheMealDB's names, e.g. "green onion" -> ["Spring Onions"]."""
    cache_key = "{}/{}".format(client.settings.base_url, client.settings.api_key)
    with _index_lock:
        if cache_key in _index_cache:
            return _index_cache[cache_key]
    index: Dict[str, List[str]] = {}
    for name in client.list_ingredient_names():
        for key in ingredient_keys(name):
            index.setdefault(key, []).append(name)
    with _index_lock:
        _index_cache[cache_key] = index
    return index


def search_recipes(
    ingredients: List[str],
    constraints: Constraints,
    client: MealDbClient,
    settings: RecipeSettings,
) -> Dict[str, object]:
    """Run the full search. Raises RecipeSourceError (or a subclass) if TheMealDB fails."""
    index = source_ingredient_index(client)

    source_names: Dict[str, Set[int]] = {}
    not_found = []
    for position, name in enumerate(ingredients):
        names = {source for key in ingredient_keys(name) for source in index.get(key, [])}
        if not names:
            not_found.append(name)
        for source in names:
            source_names.setdefault(source, set()).add(position)

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_REQUESTS) as pool:
        ordered_names = sorted(source_names)
        id_lists = list(pool.map(client.recipe_ids_using, ordered_names))

        uses: Dict[str, Set[int]] = {}
        for source, ids in zip(ordered_names, id_lists):
            for meal_id in ids:
                uses.setdefault(meal_id, set()).update(source_names[source])

        candidate_ids = sorted(uses, key=lambda meal_id: (-len(uses[meal_id]), int(meal_id)))
        candidate_ids = candidate_ids[: settings.max_lookups]
        raw_records = list(pool.map(client.lookup_recipe, candidate_ids))

    records = []
    malformed = 0
    for raw in raw_records:
        if raw is None:
            continue
        try:
            records.append(parse_recipe(raw))
        except RecipeRecordError:
            malformed += 1
    if malformed and not records:
        raise RecipeSourceMalformed("all {} records were malformed".format(malformed))

    user_keys = user_key_set(ingredients)
    scored = []
    blocked = 0
    for recipe in records:
        check = check_recipe(ingredient_names(recipe), constraints)
        if not check.allowed:
            blocked += 1
            continue
        scored.append(score_recipe(recipe, user_keys, check.unchecked))

    status, chosen = classify(scored, settings)
    logger.info(
        "recipe_search outcome=%s candidates=%d looked_up=%d malformed=%d blocked=%d shown=%d",
        status, len(uses), len(records), malformed, blocked, len(chosen),
    )
    return {
        "status": status,
        "recipes": [dict(recipe_to_dict(s.recipe), **scored_to_dict(s)) for s in chosen],
        "not_found": not_found,
    }
