"""Tests for recipe retrieval, validation, matching, ranking, and the endpoint.

TheMealDB is replaced by a fake built on httpx.MockTransport, serving the
small hand-reviewed records below, so these tests never call the live API.

Scenarios the records cover:
- egg + bread + milk + butter       -> supported (French Toast, Scrambled Eggs)
- bread only                         -> near match (Ham Sandwich, 3 missing)
- parsley only                       -> no match (Herb Omelette misses 5)
- peanut allergy                     -> Peanut Noodles never shown
- foods to avoid "pork"              -> Ham Sandwich never shown
"""

import unittest
from dataclasses import replace

import httpx
from fastapi.testclient import TestClient

from backend.app import app, get_recipe_client
from backend.config import RecipeSettings, load_recipe_settings
from backend.constraints import build_constraints, check_recipe
from backend.feasibility import (
    NEAR_MATCH,
    NO_MATCH,
    SUPPORTED,
    classify,
    ingredient_keys,
    is_pantry_staple,
    score_recipe,
    scored_to_dict,
    user_key_set,
)
from backend.mealdb_client import MealDbClient, RecipeSourceError, RecipeSourceTimeout
from backend.recipe_search import clear_recipe_catalog_cache
from backend.recipes import RecipeRecordError, parse_recipe

SETTINGS = RecipeSettings(
    base_url="https://mealdb.test/api/json/v1",
    api_key="1",
    timeout_seconds=1.0,
    catalog_hours=24.0,
    max_missing=2,
    near_match_margin=1,
)


def meal(meal_id, title, ingredients, source=None, **extra):
    record = {
        "idMeal": meal_id,
        "strMeal": title,
        "strInstructions": "Instructions for {}.".format(title),
        "strMealThumb": "https://www.themealdb.com/images/media/meals/{}.jpg".format(meal_id),
        "strCategory": "Breakfast",
        "strArea": "British",
        "strTags": "Quick, Easy",
        "strSource": source,
    }
    for slot in range(1, 21):
        record["strIngredient{}".format(slot)] = ""
        record["strMeasure{}".format(slot)] = ""
    for slot, (name, measure) in enumerate(ingredients, start=1):
        record["strIngredient{}".format(slot)] = name
        record["strMeasure{}".format(slot)] = measure
    record.update(extra)
    return record


RECIPES = {
    "1001": meal(
        "1001", "French Toast",
        [("Eggs", "2"), ("Bread", "4 slices"), ("Milk", "1/2 cup"), ("Butter", "1 tbsp"),
         ("Salt", "pinch"), ("Sugar", "1 tbsp")],
        source="https://www.bbcgoodfood.com/recipes/french-toast",
    ),
    "1002": meal(
        "1002", "Scrambled Eggs",
        [("Free-range Eggs, Beaten", "3"), ("Butter", "knob"), ("Salt", "pinch"),
         ("Black Pepper", "pinch"), ("Spring Onions", "2")],
    ),
    "1003": meal(
        "1003", "Peanut Noodles",
        [("Eggs", "1"), ("Peanuts", "50g"), ("Soy Sauce", "2 tbsp"), ("Spring Onions", "2"),
         ("Garlic", "1 clove")],
    ),
    "1004": meal(
        "1004", "Herb Omelette",
        [("Eggs", "3"), ("Parsley", "handful"), ("Basil", "handful"), ("Lemon", "1/2"),
         ("Chives", "bunch"), ("Cream", "2 tbsp"), ("Nutmeg", "pinch")],
    ),
    "1005": meal(
        "1005", "Ham Sandwich",
        [("Bread", "2 slices"), ("Ham", "2 slices"), ("Butter", "spread"),
         ("Mystery Relish", "1 tbsp"), ("Extra Virgin Olive Oil", "drizzle")],
        source="javascript:alert(1)",
    ),
    "1006": meal("1006", "", [("Eggs", "2")]),
    "1008": meal("1008", "Æbleskiver", [("Eggs", "2"), ("Flour", "200g"), ("Milk", "250ml")]),
}


class FakeMealDb:
    """Serves categories, letter search, and lookup from the records above; can be told to fail."""

    def __init__(self, recipes=None, failure=None):
        self.recipes = RECIPES if recipes is None else recipes
        self.failure = failure
        self.requests = []

    def handler(self, request):
        self.requests.append(request)
        if self.failure == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        if self.failure == "500":
            return httpx.Response(500, text="oops")
        if self.failure == "not_json":
            return httpx.Response(200, text="<html>")
        path = request.url.path.rsplit("/", 1)[-1]
        params = request.url.params
        if path == "list.php" and params.get("c") == "list":
            categories = sorted({record["strCategory"] for record in self.recipes.values()})
            meals = [{"strCategory": name} for name in categories]
        elif path == "filter.php" and "c" in params:
            meals = [
                {"idMeal": meal_id, "strMeal": record.get("strMeal")}
                for meal_id, record in self.recipes.items()
                if record["strCategory"] == params["c"]
            ] or None
        elif path == "search.php" and "f" in params:
            meals = [
                record
                for record in self.recipes.values()
                if record["strMeal"].lower().startswith(params["f"])
            ] or None
        elif path == "lookup.php":
            meals = [self.recipes[params["i"]]] if params["i"] in self.recipes else None
        else:
            return httpx.Response(404)
        return httpx.Response(200, json={"meals": meals})

    def client(self, settings=SETTINGS):
        return MealDbClient(settings, transport=httpx.MockTransport(self.handler))


class RecipeRecordTests(unittest.TestCase):
    def test_keeps_source_fields_in_order_and_skips_blank_slots(self):
        recipe = parse_recipe(RECIPES["1001"], retrieved_on="2026-10-25")
        self.assertEqual(recipe.title, "French Toast")
        self.assertEqual(
            [(i.name, i.measure) for i in recipe.ingredients][:2],
            [("Eggs", "2"), ("Bread", "4 slices")],
        )
        self.assertEqual(len(recipe.ingredients), 6)
        self.assertEqual(recipe.tags, ("Quick", "Easy"))
        self.assertEqual(recipe.retrieved_on, "2026-10-25")

    def test_original_source_is_cited_by_site_name(self):
        recipe = parse_recipe(RECIPES["1001"])
        self.assertEqual(recipe.source_name, "bbcgoodfood.com")
        self.assertEqual(recipe.source_url, "https://www.bbcgoodfood.com/recipes/french-toast")
        self.assertEqual(recipe.mealdb_url, "https://www.themealdb.com/meal/1001")

    def test_missing_or_unsafe_source_falls_back_to_mealdb_page(self):
        for meal_id in ("1002", "1005"):
            recipe = parse_recipe(RECIPES[meal_id])
            self.assertEqual(recipe.source_name, "TheMealDB")
            self.assertEqual(recipe.source_url, "https://www.themealdb.com/meal/{}".format(meal_id))

    def test_images_only_from_mealdb(self):
        record = dict(RECIPES["1001"], strMealThumb="https://evil.example/x.jpg")
        self.assertIsNone(parse_recipe(record).image_url)

    def test_rejects_unusable_records(self):
        bad = [
            RECIPES["1006"],
            dict(RECIPES["1001"], idMeal="abc"),
            meal("1007", "Empty", []),
            None,
        ]
        for record in bad:
            with self.assertRaises(RecipeRecordError):
                parse_recipe(record)


class ClientTests(unittest.TestCase):
    def test_failures_become_source_errors(self):
        for failure, error in [
            ("timeout", RecipeSourceTimeout),
            ("500", RecipeSourceError),
            ("not_json", RecipeSourceError),
        ]:
            with self.assertRaises(error):
                FakeMealDb(failure=failure).client().recipes_starting_with("e")

    def test_no_results_is_an_empty_list(self):
        self.assertEqual(FakeMealDb().client().recipes_starting_with("q"), [])
        self.assertIsNone(FakeMealDb().client().lookup_recipe("9999"))

    def test_non_numeric_ids_are_dropped(self):
        recipes = dict(RECIPES, bad=dict(RECIPES["1001"], idMeal="1;drop"))
        ids = FakeMealDb(recipes).client().recipe_ids_in_category("Breakfast")
        self.assertNotIn("1;drop", ids)
        self.assertIn("1001", ids)

    def test_missing_meals_field_is_an_error(self):
        client = MealDbClient(
            SETTINGS, transport=httpx.MockTransport(lambda r: httpx.Response(200, json={}))
        )
        with self.assertRaises(RecipeSourceError):
            client.lookup_recipe("1001")


class MatchingTests(unittest.TestCase):
    def test_source_names_match_user_names(self):
        self.assertIn("egg", ingredient_keys("Free-range Eggs, Beaten"))
        self.assertIn("green onion", ingredient_keys("Spring Onions"))
        self.assertIn("ground beef", ingredient_keys("Minced Beef"))
        self.assertIn("tomato", ingredient_keys("Chopped Tomatoes"))

    def test_different_foods_do_not_match(self):
        self.assertNotIn("egg", ingredient_keys("Egg Noodles"))
        self.assertNotIn("butter", ingredient_keys("Peanut Butter"))
        self.assertNotIn("tomato", ingredient_keys("Tomato Puree"))

    def test_pantry_staples(self):
        for name in [
            "Salt", "Sea Salt", "Black Pepper", "Extra Virgin Olive Oil", "Vegetable Oil",
            "Water", "Cold Water", "Boiling Water", "Pepper", "Ground Pepper",
        ]:
            self.assertTrue(is_pantry_staple(name), name)
        for name in [
            "Peanut Oil", "Sesame Seed Oil", "Sugar", "Butter", "Red Pepper",
            "Bell Pepper", "Cayenne Pepper", "Coconut Water",
        ]:
            self.assertFalse(is_pantry_staple(name), name)

    def test_bare_pepper_is_shown_as_assumed_black_pepper(self):
        record = dict(RECIPES["1002"], strIngredient6="Pepper", strMeasure6="pinch")
        scored = score_recipe(parse_recipe(record), user_key_set(["egg"]))
        staples = scored_to_dict(scored)["staples"]
        self.assertIn(
            {"name": "Pepper", "measure": "pinch", "assumed_as": "black pepper"}, staples
        )
        self.assertIn({"name": "Salt", "measure": "pinch"}, staples)

    def test_avoiding_black_pepper_also_blocks_bare_pepper(self):
        constraints = build_constraints([], ["black pepper"])
        self.assertFalse(check_recipe(["Eggs", "Pepper"], constraints).allowed)
        self.assertTrue(check_recipe(["Eggs", "Red Pepper"], constraints).allowed)

    def test_staples_are_not_missing_or_matched(self):
        scored = score_recipe(parse_recipe(RECIPES["1002"]), user_key_set(["egg"]))
        self.assertEqual([i.name for i in scored.matched], ["Free-range Eggs, Beaten"])
        self.assertEqual([i.name for i in scored.staples], ["Salt", "Black Pepper"])
        self.assertEqual([i.name for i in scored.missing], ["Butter", "Spring Onions"])


class ClassifyTests(unittest.TestCase):
    def scored(self, user, *meal_ids):
        keys = user_key_set(user)
        return [score_recipe(parse_recipe(RECIPES[m]), keys) for m in meal_ids]

    def test_supported_ranks_fewest_missing_first(self):
        status, chosen = classify(
            self.scored(["egg", "bread", "milk", "butter", "green onion"], "1001", "1002", "1004"),
            SETTINGS,
        )
        self.assertEqual(status, SUPPORTED)
        self.assertEqual([s.recipe.id for s in chosen], ["1002", "1001"])

    def test_near_match_only_without_supported(self):
        status, chosen = classify(self.scored(["bread"], "1005", "1001"), SETTINGS)
        self.assertEqual(status, NEAR_MATCH)
        self.assertEqual([s.recipe.id for s in chosen], ["1005"])

    def test_too_many_missing_is_no_match(self):
        self.assertEqual(classify(self.scored(["parsley"], "1004"), SETTINGS), (NO_MATCH, []))

    def test_recipe_must_use_a_user_ingredient(self):
        self.assertEqual(classify(self.scored(["chives"], "1002"), SETTINGS)[0], NO_MATCH)

    def test_thresholds_are_configurable(self):
        strict = replace(SETTINGS, max_missing=0, near_match_margin=0)
        status, _ = classify(self.scored(["egg", "bread", "milk", "butter"], "1001"), strict)
        self.assertEqual(status, NO_MATCH)

    def test_at_most_three_results(self):
        recipes = {
            str(2000 + n): meal(str(2000 + n), "Toast {}".format(n), [("Bread", "1")])
            for n in range(5)
        }
        keys = user_key_set(["bread"])
        scored = [score_recipe(parse_recipe(r), keys) for r in recipes.values()]
        status, chosen = classify(scored, SETTINGS)
        self.assertEqual(len(chosen), 3)
        self.assertEqual([s.recipe.id for s in chosen], ["2000", "2001", "2002"])


class RecipeSearchEndpointTests(unittest.TestCase):
    def setUp(self):
        clear_recipe_catalog_cache()
        self.fake = FakeMealDb()
        self.http = TestClient(app)
        self.use(self.fake)

    def tearDown(self):
        app.dependency_overrides.clear()
        clear_recipe_catalog_cache()

    def use(self, fake):
        app.dependency_overrides[get_recipe_client] = lambda: fake.client()

    def search(self, ingredients, allergens=(), avoid=()):
        return self.http.post(
            "/api/recipe-search",
            json={"ingredients": ingredients, "allergens": list(allergens), "avoid": list(avoid)},
        )

    def test_supported_results_carry_source_and_split_ingredients(self):
        body = self.search(["egg", "bread", "milk", "butter", "green onion"]).json()
        self.assertEqual(body["status"], "supported")
        self.assertEqual([r["id"] for r in body["recipes"]], ["1002", "1001", "1008"])
        toast = body["recipes"][1]
        self.assertEqual(
            toast["source"],
            {"name": "bbcgoodfood.com", "url": "https://www.bbcgoodfood.com/recipes/french-toast"},
        )
        self.assertEqual(toast["mealdb_url"], "https://www.themealdb.com/meal/1001")
        self.assertEqual([m["name"] for m in toast["missing"]], ["Sugar"])
        self.assertEqual([m["name"] for m in toast["staples"]], ["Salt"])
        self.assertEqual(
            [m["name"] for m in toast["matched"]], ["Eggs", "Bread", "Milk", "Butter"]
        )
        self.assertEqual(toast["ingredients"][1], {"name": "Bread", "measure": "4 slices"})

    def test_every_shown_recipe_is_a_real_source_record(self):
        body = self.search(["egg", "bread", "milk", "butter", "green onion"]).json()
        for recipe in body["recipes"]:
            original = RECIPES[recipe["id"]]
            self.assertEqual(recipe["title"], original["strMeal"])
            self.assertEqual(recipe["instructions"], original["strInstructions"])
            self.assertTrue(recipe["source"]["url"].startswith("https://"))

    def test_allergy_removes_recipe_before_ranking(self):
        ingredients = ["egg", "green onion", "garlic"]
        open_ids = [r["id"] for r in self.search(ingredients).json()["recipes"]]
        self.assertIn("1003", open_ids)
        body = self.search(ingredients, allergens=["peanuts"]).json()
        self.assertNotIn("1003", [r["id"] for r in body["recipes"]])

    def test_near_match_never_bypasses_a_food_to_avoid(self):
        self.assertEqual(self.search(["bread"]).json()["status"], "near_match")
        body = self.search(["bread"], avoid=["pork"]).json()
        self.assertEqual(body, {"status": "no_match", "recipes": [], "not_found": []})

    def test_unchecked_ingredients_are_named(self):
        body = self.search(["bread"], allergens=["egg"]).json()
        self.assertEqual(body["status"], "near_match")
        self.assertEqual(body["recipes"][0]["unchecked_allergy"], ["Mystery Relish"])

    def test_no_match_and_not_found(self):
        body = self.search(["parsley", "dragonfruit"]).json()
        self.assertEqual(body, {"status": "no_match", "recipes": [], "not_found": ["dragonfruit"]})

    def test_confirmed_ingredient_clash_is_refused(self):
        response = self.search(["egg"], allergens=["egg"])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"error": "constraint_conflict"})
        self.assertEqual(self.fake.requests, [])

    def test_source_failures_are_safe_errors(self):
        for failure, status, code in [
            ("timeout", 504, "recipe_source_timeout"),
            ("500", 502, "recipe_source_failed"),
            ("not_json", 502, "recipe_source_failed"),
        ]:
            clear_recipe_catalog_cache()
            self.use(FakeMealDb(failure=failure))
            response = self.search(["egg"])
            self.assertEqual((response.status_code, response.json()), (status, {"error": code}))

    def test_all_malformed_records_is_a_failure_not_a_no_match(self):
        self.use(FakeMealDb(recipes={"1006": RECIPES["1006"]}))
        response = self.search(["egg"])
        self.assertEqual(response.status_code, 502)

    def test_malformed_record_is_skipped(self):
        body = self.search(["egg", "bread", "milk", "butter", "green onion"]).json()
        self.assertNotIn("1006", [r["id"] for r in body["recipes"]])

    def test_catalog_is_loaded_once_and_reused(self):
        self.search(["egg"])
        first_load = len(self.fake.requests)
        self.search(["bread"])
        self.assertEqual(len(self.fake.requests), first_load)

    def test_catalog_reloads_when_old(self):
        app.dependency_overrides[get_recipe_client] = lambda: self.fake.client(
            replace(SETTINGS, catalog_hours=1e-9)
        )
        self.search(["egg"])
        first_load = len(self.fake.requests)
        self.search(["egg"])
        self.assertEqual(len(self.fake.requests), 2 * first_load)

    def test_titles_not_starting_with_a_letter_are_still_searched(self):
        body = self.search(["egg", "milk", "flour"]).json()
        self.assertIn("1008", [r["id"] for r in body["recipes"]])
        lookups = [r.url.params["i"] for r in self.fake.requests if r.url.path.endswith("lookup.php")]
        self.assertEqual(sorted(lookups), ["1006", "1008"])

    def test_every_recipe_is_checked_not_just_a_sample(self):
        recipes = {
            str(3000 + n): meal(str(3000 + n), "Bread {}".format(n), [("Bread", "1"), ("Ham", "1")])
            for n in range(60)
        }
        recipes["3999"] = meal("3999", "Toast", [("Bread", "1"), ("Butter", "1")])
        self.use(FakeMealDb(recipes))
        body = self.search(["bread", "butter"], avoid=["pork"]).json()
        self.assertEqual([r["id"] for r in body["recipes"]], ["3999"])

    def test_allergy_choices_are_not_logged(self):
        with self.assertLogs("pic2food", level="INFO") as logs:
            self.search(["bread"], allergens=["peanuts"], avoid=["pork"])
        joined = "\n".join(logs.output)
        self.assertNotIn("pork", joined)
        self.assertNotIn("peanut", joined)

    def test_bad_requests(self):
        self.assertEqual(self.search([]).status_code, 400)
        self.assertEqual(self.search(["egg"], allergens=["gluten"]).status_code, 400)


class RecipeSettingsTests(unittest.TestCase):
    def test_defaults_match_product_decisions(self):
        settings = load_recipe_settings()
        self.assertEqual((settings.max_missing, settings.near_match_margin), (2, 1))
        self.assertEqual(settings.api_key, "1")


if __name__ == "__main__":
    unittest.main()
