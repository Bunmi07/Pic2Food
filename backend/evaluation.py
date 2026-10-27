"""Scores the controlled evaluation set: confirmed ingredients in, pass or fail out.

Each scenario is a labeled kitchen (ingredients, allergies, foods to avoid) and
the result we expect from the real search. Recipes come from a frozen catalog
in backend/data, not from TheMealDB, so a change on their site cannot move the
score. Photos and the live vision model are not part of this set.

A scenario fails when the result state, the recipe ids, a hard constraint, the
source link, or the code-built explanation is wrong. Allergy choices are not
logged.
"""

import json
import re
from pathlib import Path
from typing import Dict, List
from urllib.parse import urlparse

from backend.config import DEFAULT_MAX_MISSING, DEFAULT_NEAR_MATCH_MARGIN, RecipeSettings
from backend.constraints import build_constraints, check_recipe, find_inventory_conflicts, words
from backend.explanations import BANNED_WORDS, constraints_sentence
from backend.recipe_search import RecipeCatalog, catalog_from_raw, search_catalog

DATA_DIR = Path(__file__).resolve().parent / "data"
CATALOG_FILE = DATA_DIR / "evaluation_catalog.json"
SCENARIO_FILE = DATA_DIR / "evaluation_scenarios.json"

SEARCH_STATUSES = ("supported", "near_match", "no_match", "constraint_conflict")

# The product thresholds, not whatever a local .env happens to set.
EVAL_SETTINGS = RecipeSettings(
    base_url="https://evaluation.invalid",
    api_key="evaluation",
    timeout_seconds=1.0,
    catalog_hours=24.0,
    max_missing=DEFAULT_MAX_MISSING,
    near_match_margin=DEFAULT_NEAR_MATCH_MARGIN,
)


def _mealdb_record(entry: Dict[str, object]) -> Dict[str, object]:
    """Turn one fixture into the shape parse_recipe already checks."""
    record = {
        "idMeal": entry.get("id", ""),
        "strMeal": entry.get("title", ""),
        "strInstructions": "Evaluation fixture. Not a published recipe.",
        "strSource": entry.get("source") or "",
        "strCategory": "",
        "strArea": "",
        "strTags": "",
        "strMealThumb": "",
    }
    for slot in range(1, 21):
        record["strIngredient{}".format(slot)] = ""
        record["strMeasure{}".format(slot)] = ""
    ingredients = entry.get("ingredients") or []
    if isinstance(ingredients, list):
        for slot, pair in enumerate(ingredients, start=1):
            if slot > 20 or not isinstance(pair, list) or not pair:
                continue
            record["strIngredient{}".format(slot)] = pair[0]
            record["strMeasure{}".format(slot)] = pair[1] if len(pair) > 1 else ""
    return record


def load_evaluation_catalog() -> RecipeCatalog:
    """The frozen recipes the scenarios are scored against, including any malformed record."""
    raw = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    return catalog_from_raw([_mealdb_record(entry) for entry in raw])


def load_scenarios() -> List[Dict[str, object]]:
    """The answer-key rows. The file's "about" note is for readers and is not scored."""
    raw = json.loads(SCENARIO_FILE.read_text(encoding="utf-8"))
    scenarios = raw.get("scenarios") if isinstance(raw, dict) else raw
    if not isinstance(scenarios, list):
        raise ValueError("evaluation scenarios must be a list")
    return scenarios


def _fail(scenario_id: str, check: str, detail: str) -> str:
    return "{}: {} ({})".format(scenario_id, check, detail)


def _https_url(url: object) -> bool:
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    return parsed.scheme == "https" and bool(parsed.hostname)


def score_scenario(scenario: Dict[str, object], catalog: RecipeCatalog) -> List[str]:
    """Run one labeled scenario through search and return the reasons it failed."""
    scenario_id = str(scenario.get("id") or "(missing id)")
    status = scenario.get("expected_status")
    if status not in SEARCH_STATUSES:
        return [_fail(scenario_id, "expected_status", "missing or unknown")]
    ingredients = scenario.get("ingredients")
    if not isinstance(ingredients, list) or not all(isinstance(name, str) for name in ingredients):
        return [_fail(scenario_id, "ingredients", "must be a list of names")]

    try:
        constraints = build_constraints(
            scenario.get("allergies") or [],
            scenario.get("avoid") or [],
        )
    except ValueError as error:
        return [_fail(scenario_id, "constraints", str(error))]

    conflicts = find_inventory_conflicts(ingredients, constraints)
    if status == "constraint_conflict":
        if conflicts:
            return []
        return [_fail(scenario_id, "constraint_conflict", "search would have been allowed")]

    failures = []
    if conflicts:
        failures.append(_fail(scenario_id, "constraint_conflict", "search would have been refused"))
        return failures

    result = search_catalog(ingredients, constraints, catalog, EVAL_SETTINGS)
    shown = result["recipes"]
    shown_ids = [recipe["id"] for recipe in shown]
    expected_ids = scenario.get("expected_ids")
    if shown_ids != expected_ids:
        failures.append(_fail(scenario_id, "recipes", "got {} expected {}".format(shown_ids, expected_ids)))
    if result["status"] != status:
        failures.append(_fail(scenario_id, "status", "got {} expected {}".format(result["status"], status)))

    forbidden = set(scenario.get("forbidden_ids") or [])
    catalog_ids = {recipe.id for recipe in catalog.recipes}
    tail = constraints_sentence(constraints)
    not_found = scenario.get("not_found")
    if not_found is not None and result["not_found"] != not_found:
        failures.append(_fail(scenario_id, "not_found", "got {}".format(result["not_found"])))

    unchecked_needed = list(scenario.get("unchecked") or [])
    assumed = scenario.get("assumed_as") or ""
    saw_assumed = False
    sources = scenario.get("sources") or {}

    for recipe in shown:
        recipe_id = recipe["id"]
        if recipe_id not in catalog_ids:
            failures.append(_fail(scenario_id, "invented_recipe", recipe_id))
        if recipe_id in forbidden:
            failures.append(_fail(scenario_id, "forbidden_recipe", recipe_id))
        names = [item["name"] for item in recipe["ingredients"]]
        if not check_recipe(names, constraints).allowed:
            failures.append(_fail(scenario_id, "constraint_violation", recipe_id))

        source = recipe.get("source") or {}
        url = source.get("url")
        if not source.get("name") or not _https_url(url):
            failures.append(_fail(scenario_id, "attribution", "{} {}".format(recipe_id, source)))
        elif recipe_id in sources and url != sources[recipe_id]:
            failures.append(_fail(scenario_id, "attribution", "{} got {}".format(recipe_id, url)))

        explanation = recipe.get("explanation") or ""
        if not isinstance(explanation, str) or not explanation.strip():
            failures.append(_fail(scenario_id, "explanation", "{} is empty".format(recipe_id)))
            continue
        if "http" in explanation.lower() or re.search(r"\d", explanation):
            failures.append(_fail(scenario_id, "explanation", "{} has a link or a number".format(recipe_id)))
        body = explanation[: -len(tail)].strip() if tail and explanation.endswith(tail) else explanation
        if tail and not explanation.endswith(tail):
            failures.append(_fail(scenario_id, "explanation", "{} omits what was left out".format(recipe_id)))
        banned = [token for token in words(body) if token in BANNED_WORDS]
        if banned:
            failures.append(_fail(scenario_id, "explanation", "{} says {}".format(recipe_id, banned[0])))
        for name in recipe.get("unchecked_allergy") or []:
            if name in unchecked_needed:
                unchecked_needed.remove(name)
        for staple in recipe.get("staples") or []:
            if staple.get("assumed_as") == assumed:
                saw_assumed = True

    if unchecked_needed:
        failures.append(_fail(scenario_id, "unchecked", ", ".join(unchecked_needed)))
    if assumed and not saw_assumed:
        failures.append(_fail(scenario_id, "assumed_as", assumed))
    return failures


def run_evaluation() -> List[str]:
    """Score every scenario. An empty list means the set passed."""
    catalog = load_evaluation_catalog()
    scenarios = load_scenarios()
    failures = []
    seen = set()
    for scenario in scenarios:
        scenario_id = str(scenario.get("id") or "")
        if not scenario_id or scenario_id in seen:
            failures.append(_fail(scenario_id or "(missing id)", "id", "missing or duplicated"))
            continue
        seen.add(scenario_id)
        failures.extend(score_scenario(scenario, catalog))
    return failures
