"""Tests for the allergy and foods-to-avoid filter: whole-word matching,
exceptions, food families, unchecked ingredients, recipe blocking, and the
endpoint."""

import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app
from backend.constraints import (
    ALLERGEN_IDS,
    build_constraints,
    check_ingredient,
    check_recipe,
    load_allergen_groups,
    load_food_families,
)
from backend.normalization import default_aliases


def blocked(name, allergens=(), avoid=()):
    return check_ingredient(name, build_constraints(allergens, avoid)).blocked


class AllergenFileTests(unittest.TestCase):
    def test_file_defines_exactly_the_nine_allergens(self):
        self.assertEqual(set(load_allergen_groups()), set(ALLERGEN_IDS))

    def test_unknown_allergen_is_rejected(self):
        with self.assertRaises(ValueError):
            build_constraints(["gluten"], [])

    def test_alias_file_ingredients_are_covered(self):
        expected = {
            "egg": "egg",
            "bread": "wheat", "flour": "wheat", "pasta": "wheat",
            "milk": "milk", "cheese": "milk", "sliced cheese": "milk",
            "butter": "milk", "cream cheese": "milk",
            "tofu": "soy", "bean curd": "soy",
            "shrimp": "shellfish", "prawn": "shellfish",
        }
        for name, allergen in expected.items():
            self.assertTrue(blocked(name, [allergen]), name)

    def test_every_alias_file_ingredient_counts_as_reviewed(self):
        constraints = build_constraints(["milk"], [])
        for name in default_aliases():
            self.assertFalse(check_ingredient(name, constraints).unchecked, name)


class AllergyMatchingTests(unittest.TestCase):
    def test_blocks_forms_found_in_recipe_sources(self):
        cases = [
            ("Free-range Eggs, beaten", "egg"),
            ("Mayonnaise", "egg"),
            ("Parmesan Cheese", "milk"),
            ("Double Cream", "milk"),
            ("Crème Fraîche", "milk"),
            ("Plain Flour", "wheat"),
            ("Soy Sauce", "wheat"),
            ("Soy Sauce", "soy"),
            ("Worcestershire Sauce", "fish"),
            ("King Prawns", "shellfish"),
            ("Pine Nuts", "tree_nuts"),
            ("Peanut Oil", "peanuts"),
            ("Tahini", "sesame"),
        ]
        for name, allergen in cases:
            self.assertTrue(blocked(name, [allergen]), (name, allergen))

    def test_whole_words_only(self):
        self.assertFalse(blocked("Eggplant", ["egg"]))
        self.assertFalse(blocked("Nutmeg", ["tree_nuts"]))
        self.assertFalse(blocked("Butternut Squash", ["milk"]))
        self.assertFalse(blocked("Peanuts", ["tree_nuts"]))

    def test_listed_exceptions_are_not_blocked(self):
        self.assertFalse(blocked("Coconut Milk", ["milk"]))
        self.assertFalse(blocked("Peanut Butter", ["milk"]))
        self.assertFalse(blocked("Cream of Tartar", ["milk"]))
        self.assertFalse(blocked("Rice Flour", ["wheat"]))
        self.assertTrue(blocked("Peanut Butter", ["peanuts"]))


class AvoidTests(unittest.TestCase):
    def test_avoid_uses_alias_names(self):
        self.assertTrue(blocked("Spring Onions", avoid=["scallion"]))
        self.assertTrue(blocked("green onion", avoid=["Scallions"]))
        self.assertTrue(blocked("Courgette", avoid=["zucchini"]))

    def test_avoid_matches_whole_words(self):
        self.assertTrue(blocked("Pork Belly", avoid=["pork"]))
        self.assertTrue(blocked("Red Pepper Flakes", avoid=["pepper"]))
        self.assertFalse(blocked("Porky Pie", avoid=["pork"]))

    def test_unknown_typed_words_match_by_name_only(self):
        self.assertTrue(blocked("Celery Sticks", avoid=["celery"]))
        self.assertFalse(blocked("Celeriac", avoid=["celery"]))


class FoodFamilyTests(unittest.TestCase):
    def test_family_file_is_valid(self):
        families = load_food_families()
        self.assertIn("pork", families)
        self.assertIn("nut", families)

    def test_pork_covers_hidden_pork(self):
        for name in ["Bacon", "Smoked Ham", "Chorizo", "Pancetta", "Lard", "Gelatine"]:
            self.assertTrue(blocked(name, avoid=["pork"]), name)
        self.assertFalse(blocked("Hamburger Buns", avoid=["pork"]))

    def test_families_reuse_allergen_lists(self):
        self.assertTrue(blocked("Parmesan", avoid=["dairy"]))
        self.assertFalse(blocked("Coconut Milk", avoid=["dairy"]))
        self.assertTrue(blocked("Pine Nuts", avoid=["nuts"]))
        self.assertTrue(blocked("Peanut Butter", avoid=["Nuts"]))
        self.assertTrue(blocked("Plain Flour", avoid=["gluten"]))
        self.assertTrue(blocked("Pearl Barley", avoid=["gluten"]))
        self.assertTrue(blocked("Fish Sauce", avoid=["seafood"]))

    def test_meat_includes_other_families(self):
        for name in ["Bacon", "Beef Stock", "Lamb Shank", "Chicken Thighs", "Venison"]:
            self.assertTrue(blocked(name, avoid=["meat"]), name)
        self.assertFalse(blocked("Kidney Beans", avoid=["meat"]))
        self.assertFalse(blocked("Goat's Cheese", avoid=["meat"]))

    def test_alcohol_exceptions(self):
        self.assertTrue(blocked("Red Wine", avoid=["alcohol"]))
        self.assertTrue(blocked("Mirin", avoid=["alcohol"]))
        self.assertFalse(blocked("Red Wine Vinegar", avoid=["alcohol"]))
        self.assertFalse(blocked("Ginger", avoid=["alcohol"]))

    def test_specific_word_does_not_expand_to_family(self):
        self.assertTrue(blocked("Bacon", avoid=["bacon"]))
        self.assertFalse(blocked("Ham", avoid=["bacon"]))

    def test_family_hits_report_what_the_user_typed(self):
        check = check_ingredient("Bacon", build_constraints([], ["Pork"]))
        self.assertEqual(check.reasons, [{"type": "avoid", "term": "Pork"}])

    def test_family_words_count_as_reviewed(self):
        constraints = build_constraints(["milk"], [])
        self.assertFalse(check_ingredient("Pancetta", constraints).unchecked)

    def write_families(self, data):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(data, handle)
        handle.close()
        self.addCleanup(Path(handle.name).unlink)
        return Path(handle.name)

    def family(self, **overrides):
        entry = {"names": ["x"], "terms": ["x"], "except": [], "includes": []}
        entry.update(overrides)
        return entry

    def test_rejects_bad_includes_and_loops(self):
        bad_files = [
            {"a": self.family(includes=["allergen:gluten"])},
            {"a": self.family(includes=["family:missing"])},
            {
                "a": self.family(names=["a"], includes=["family:b"]),
                "b": self.family(names=["b"], includes=["family:a"]),
            },
            {"a": self.family(names=["a"]), "b": self.family(names=["a"])},
        ]
        for data in bad_files:
            with self.assertRaises(ValueError):
                load_food_families(self.write_families(data))

    def test_reason_reports_what_the_user_typed(self):
        check = check_ingredient("Spring Onions", build_constraints([], [" Scallions "]))
        self.assertEqual(check.reasons, [{"type": "avoid", "term": "Scallions"}])


class RecipeCheckTests(unittest.TestCase):
    recipe = ["Chicken", "Plain Flour", "Garam Masala", "Salt"]

    def test_one_blocked_ingredient_blocks_the_recipe(self):
        result = check_recipe(self.recipe, build_constraints(["wheat"], []))
        self.assertFalse(result.allowed)
        self.assertEqual(
            result.blocked,
            [{"ingredient": "Plain Flour", "reasons": [{"type": "allergy", "id": "wheat", "label": "Wheat"}]}],
        )

    def test_unreviewed_ingredients_are_reported_when_allergies_are_set(self):
        result = check_recipe(self.recipe, build_constraints(["milk"], []))
        self.assertTrue(result.allowed)
        self.assertEqual(result.unchecked, ["Garam Masala"])

    def test_nothing_is_unchecked_without_allergies(self):
        result = check_recipe(self.recipe, build_constraints([], ["pork"]))
        self.assertTrue(result.allowed)
        self.assertEqual(result.unchecked, [])

    def test_unchecked_never_unblocks(self):
        result = check_recipe(["Mystery Sauce", "Butter"], build_constraints(["milk"], []))
        self.assertFalse(result.allowed)
        self.assertEqual(result.unchecked, ["Mystery Sauce"])


class CheckConstraintsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def post(self, ingredients, allergens=(), avoid=()):
        return self.client.post(
            "/api/check-constraints",
            json={"ingredients": ingredients, "allergens": list(allergens), "avoid": list(avoid)},
        )

    def test_reports_conflicts_with_confirmed_ingredients(self):
        response = self.post(["egg", "bread", "green onion"], ["egg"], ["scallion"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "conflicts": [
                    {"ingredient": "egg", "reasons": [{"type": "allergy", "id": "egg", "label": "Egg"}]},
                    {"ingredient": "green onion", "reasons": [{"type": "avoid", "term": "scallion"}]},
                ]
            },
        )

    def test_no_conflicts(self):
        response = self.post(["bread", "potato"], ["egg"])
        self.assertEqual(response.json(), {"conflicts": []})

    def test_allergy_choices_are_not_logged(self):
        with self.assertLogs("pic2food", level="INFO") as logs:
            self.post(["egg"], ["egg"], ["pork"])
        joined = "\n".join(logs.output)
        self.assertNotIn("pork", joined)
        self.assertNotIn("allerg", joined.replace("check_constraints", ""))

    def test_rejects_bad_requests(self):
        bad = [
            self.post(["egg"], ["gluten"]),
            self.post([], ["egg"]),
            self.post(["egg"], [], ["x" * 61]),
            self.post(["egg"], [], ["pork"] * 21),
            self.post(["egg"], [], ["  "]),
        ]
        for response in bad:
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json(), {"error": "invalid_constraints"})


if __name__ == "__main__":
    unittest.main()
