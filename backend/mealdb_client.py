"""Talks to TheMealDB, the approved recipe source for the MVP.

Three calls, all read-only: the full ingredient list (to learn TheMealDB's
names for things), recipes that use one ingredient, and one full recipe by
ID. Every answer is checked for the expected shape before it is returned;
the recipe content itself is validated in recipes.py.

Failures raise RecipeSourceTimeout or RecipeSourceError and are never retried
silently.
"""

from typing import Any, Dict, List, Optional

import httpx

from backend.config import RecipeSettings


class RecipeSourceError(Exception):
    """TheMealDB failed or answered with something we can't use."""


class RecipeSourceTimeout(RecipeSourceError):
    """TheMealDB took longer than the configured timeout."""


class MealDbClient:
    """Thin, validated wrapper over TheMealDB's v1 JSON API."""

    def __init__(self, settings: RecipeSettings, transport: Optional[httpx.BaseTransport] = None):
        self.settings = settings
        self._http = httpx.Client(
            base_url="{}/{}/".format(settings.base_url, settings.api_key),
            timeout=settings.timeout_seconds,
            transport=transport,
        )

    def _get_meals(self, path: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
        try:
            response = self._http.get(path, params=params)
        except httpx.TimeoutException as error:
            raise RecipeSourceTimeout() from error
        except httpx.HTTPError as error:
            raise RecipeSourceError("request failed") from error
        if response.status_code != 200:
            raise RecipeSourceError("status {}".format(response.status_code))
        try:
            body = response.json()
        except ValueError as error:
            raise RecipeSourceError("not JSON") from error
        if not isinstance(body, dict) or "meals" not in body:
            raise RecipeSourceError("missing meals field")
        meals = body["meals"]
        if meals is None or meals == "no data found":
            return []
        if not isinstance(meals, list) or not all(isinstance(meal, dict) for meal in meals):
            raise RecipeSourceError("meals is not a list of objects")
        return meals

    def list_ingredient_names(self) -> List[str]:
        """Every ingredient name TheMealDB uses, e.g. "Spring Onions"."""
        names = []
        for entry in self._get_meals("list.php", {"i": "list"}):
            name = entry.get("strIngredient")
            if isinstance(name, str) and name.strip():
                names.append(name.strip())
        if not names:
            raise RecipeSourceError("empty ingredient list")
        return names

    def recipe_ids_using(self, ingredient_name: str) -> List[str]:
        """IDs of recipes that list this exact TheMealDB ingredient."""
        ids = []
        for entry in self._get_meals("filter.php", {"i": ingredient_name}):
            meal_id = entry.get("idMeal")
            if isinstance(meal_id, str) and meal_id.isdigit():
                ids.append(meal_id)
        return ids

    def lookup_recipe(self, meal_id: str) -> Optional[Dict[str, Any]]:
        """The full raw record for one recipe, or None if TheMealDB has no such ID."""
        meals = self._get_meals("lookup.php", {"i": meal_id})
        return meals[0] if meals else None

    def close(self) -> None:
        self._http.close()
