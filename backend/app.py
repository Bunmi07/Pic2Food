"""The backend's web API.

POST /api/ingredient-candidates takes one prepared photo, asks the vision
model for ingredient guesses, and returns them for the user to confirm.

POST /api/normalize-ingredients takes the user's confirmed ingredient names
and returns one standard name for each (or flags it as ambiguous/unknown).

POST /api/check-constraints takes the ready ingredient list plus the user's
allergies and foods to avoid, and reports any confirmed ingredient that
clashes with them (recipe search stays blocked until there are none).

POST /api/recipe-search takes the same request and returns up to three
sourced TheMealDB recipes: a supported match, a near match, or no match.

This file only runs the requests step by step. The work itself lives in
separate modules: image_validation.py (is the photo acceptable),
vision_client.py (call OpenAI), candidates.py (check the answer),
normalization.py (standard names), constraints.py (allergy filter), and
recipe_search.py (retrieval, filtering, and ranking).
"""

import logging
from typing import Callable, Iterator, List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.candidates import VisionOutputError, parse_vision_output
from backend.config import load_recipe_settings, load_vision_settings
from backend.constraints import build_constraints, find_inventory_conflicts
from backend.image_validation import MAX_UPLOAD_BYTES, validate_jpeg_upload
from backend.mealdb_client import MealDbClient, RecipeSourceError, RecipeSourceTimeout
from backend.normalization import normalize_term
from backend.recipe_search import search_recipes
from backend.vision_client import (
    VisionCallError,
    VisionTimeoutError,
    request_ingredient_candidates,
)

load_dotenv()

logger = logging.getLogger("pic2food")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)

app = FastAPI(title="Pic2Food")

VisionCaller = Callable[[bytes], str]

MAX_NORMALIZE_ITEMS = 50
MAX_INGREDIENT_NAME_LENGTH = 60
MAX_AVOID_ITEMS = 20


def get_vision_caller() -> Optional[VisionCaller]:
    """Return a function that calls the vision model, or None with no API key.

    Tests replace this so they never make paid model calls.
    """
    settings = load_vision_settings()
    if not settings.api_key:
        return None
    return lambda image: request_ingredient_candidates(image, settings)


def error_response(
    status_code: int, code: str, endpoint: str = "ingredient_candidates"
) -> JSONResponse:
    """Log a failure (never the image) and return {"error": code}."""
    logger.warning("%s outcome=error code=%s", endpoint, code)
    return JSONResponse(status_code=status_code, content={"error": code})


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/ingredient-candidates")
def ingredient_candidates(
    photo: UploadFile = File(...),
    call_vision: Optional[VisionCaller] = Depends(get_vision_caller),
):
    """Photo in, ingredient guesses out.

    Possible answers:
    - 200 {"status": "ok", "items": [...]}     guesses for the user to confirm
    - 200 {"status": "not_food"}               photo doesn't show food
    - 200 {"status": "unreadable"}             food, but nothing identifiable
    - 400 invalid_image_*                      photo rejected before the model
    - 502 vision_failed / vision_malformed     model call or answer unusable
    - 503 vision_not_configured                no OpenAI key on the server
    - 504 vision_timeout                       model took too long
    """
    if call_vision is None:
        return error_response(503, "vision_not_configured")

    image = photo.file.read(MAX_UPLOAD_BYTES + 1)
    image_error = validate_jpeg_upload(image)
    if image_error:
        return error_response(400, "invalid_image_" + image_error)

    try:
        raw = call_vision(image)
    except VisionTimeoutError:
        return error_response(504, "vision_timeout")
    except VisionCallError:
        return error_response(502, "vision_failed")

    try:
        result = parse_vision_output(raw)
    except VisionOutputError:
        return error_response(502, "vision_malformed")

    logger.info(
        "ingredient_candidates outcome=%s items=%d",
        result["status"],
        len(result.get("items", [])),
    )
    return result


class NormalizeRequest(BaseModel):
    ingredients: List[str]


@app.post("/api/normalize-ingredients")
def normalize_ingredients(request: NormalizeRequest):
    """Confirmed names in, one result per name out, in the same order.

    Each result is {"input", "status"} plus "canonical" when known or
    "options" when ambiguous. Unknown names are logged for later review and
    are never mapped to a guess.
    """
    names = request.ingredients
    if not names or not valid_names(names, MAX_NORMALIZE_ITEMS):
        return error_response(400, "invalid_ingredients", "normalize_ingredients")

    results = []
    for name in names:
        result = normalize_term(name)
        if result.status == "unknown":
            logger.info("unknown_ingredient_term term=%r", name.strip().lower())
        entry = {"input": result.input, "status": result.status}
        if result.canonical:
            entry["canonical"] = result.canonical
        if result.options:
            entry["options"] = result.options
        results.append(entry)

    return {"results": results}


def valid_names(names: List[str], max_items: int) -> bool:
    return len(names) <= max_items and all(
        name.strip() and len(name) <= MAX_INGREDIENT_NAME_LENGTH for name in names
    )


class ConstraintsRequest(BaseModel):
    ingredients: List[str]
    allergens: List[str]
    avoid: List[str]


@app.post("/api/check-constraints")
def check_constraints(request: ConstraintsRequest):
    """Report confirmed ingredients that clash with the user's allergies or foods to avoid.

    Returns {"conflicts": [{"ingredient", "reasons": [...]}]}. An empty list
    means recipe search may go ahead. Allergy choices are never logged.
    """
    if (
        not request.ingredients
        or not valid_names(request.ingredients, MAX_NORMALIZE_ITEMS)
        or not valid_names(request.avoid, MAX_AVOID_ITEMS)
    ):
        return error_response(400, "invalid_constraints", "check_constraints")
    try:
        constraints = build_constraints(request.allergens, request.avoid)
    except ValueError:
        return error_response(400, "invalid_constraints", "check_constraints")

    conflicts = find_inventory_conflicts(request.ingredients, constraints)
    logger.info("check_constraints conflicts=%d", len(conflicts))
    return {"conflicts": conflicts}


def get_recipe_client() -> Iterator[MealDbClient]:
    """A TheMealDB client for one request. Tests replace this with a fake source."""
    client = MealDbClient(load_recipe_settings())
    try:
        yield client
    finally:
        client.close()


@app.post("/api/recipe-search")
def recipe_search(
    request: ConstraintsRequest,
    client: MealDbClient = Depends(get_recipe_client),
):
    """Ready ingredients + allergies/foods to avoid in, sourced recipes out.

    Possible answers:
    - 200 {"status": "supported" | "near_match" | "no_match", "recipes", "not_found"}
    - 400 invalid_constraints                bad request
    - 409 constraint_conflict                a confirmed ingredient clashes; search refused
    - 502 recipe_source_failed               TheMealDB failed or sent unusable data
    - 504 recipe_source_timeout              TheMealDB took too long
    """
    if (
        not request.ingredients
        or not valid_names(request.ingredients, MAX_NORMALIZE_ITEMS)
        or not valid_names(request.avoid, MAX_AVOID_ITEMS)
    ):
        return error_response(400, "invalid_constraints", "recipe_search")
    try:
        constraints = build_constraints(request.allergens, request.avoid)
    except ValueError:
        return error_response(400, "invalid_constraints", "recipe_search")
    if find_inventory_conflicts(request.ingredients, constraints):
        return error_response(409, "constraint_conflict", "recipe_search")

    try:
        return search_recipes(request.ingredients, constraints, client, client.settings)
    except RecipeSourceTimeout:
        return error_response(504, "recipe_source_timeout", "recipe_search")
    except RecipeSourceError:
        return error_response(502, "recipe_source_failed", "recipe_search")
