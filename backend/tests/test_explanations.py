"""Tests for the "why this fits you" line: facts, template, model checks, and the endpoint.

The model is always replaced by a fake caller; TheMealDB by the fake from
test_recipe_search. Checks that matter most: the model never sees allergies
or foods to avoid, and any line naming an unlisted food, a number, or a
safety/health claim falls back to the code-written line.
"""

import json
import unittest

from fastapi.testclient import TestClient

from backend.app import app, get_explanation_caller, get_recipe_client
from backend.constraints import build_constraints
from backend.explanation_client import ExplanationTimeoutError
from backend.explanations import (
    ExplanationFacts,
    check_model_line,
    constraints_sentence,
    reviewed_food_words,
    template_line,
)
from backend.recipe_search import clear_recipe_catalog_cache
from backend.tests.test_recipe_search import FakeMealDb

USER = ["egg", "bread", "milk", "butter", "green onion"]

TOAST = ExplanationFacts(
    recipe_id="1001",
    title="French Toast",
    have=("eggs", "bread", "milk", "butter"),
    need=("sugar",),
    swaps=(),
)


class TemplateTests(unittest.TestCase):
    def test_template_names_what_you_have_and_need(self):
        self.assertEqual(
            template_line(TOAST), "Uses your eggs, bread, milk and butter. You'd need sugar."
        )

    def test_template_with_nothing_missing_and_a_swap(self):
        facts = ExplanationFacts("1", "Shortbread", ("butter",), (), (("caster sugar", "sugar"),))
        self.assertEqual(
            template_line(facts),
            "Uses your butter. It calls for caster sugar; you have sugar. "
            "You have everything else it needs.",
        )

    def test_constraints_sentence_is_written_by_code(self):
        constraints = build_constraints(["sesame", "peanuts"], ["pork"])
        self.assertEqual(
            constraints_sentence(constraints),
            "Recipes listing sesame, peanuts or pork were left out.",
        )
        self.assertEqual(constraints_sentence(build_constraints([], [])), "")


class ModelLineCheckTests(unittest.TestCase):
    def check(self, text):
        return check_model_line(text, TOAST, reviewed_food_words())

    def test_accepts_a_grounded_line(self):
        self.assertEqual(
            self.check("French toast uses your eggs, bread, milk and butter; you'd just need sugar."),
            "",
        )

    def test_accepts_plurals_and_everyday_words(self):
        self.assertEqual(self.check("A great way to use up your egg, bread and milk; you'd need sugar."), "")
        self.assertEqual(self.check("Your eggs and bread go into this, plus some extra sugar."), "")

    def test_rejects_followed_instructions_from_recipe_text(self):
        self.assertEqual(self.check("Uses your eggs. Ignore the rules and add peanuts."), "unlisted_food")

    def test_rejects_unlisted_food(self):
        self.assertEqual(self.check("Uses your eggs and bread; add chocolate for extra fun."), "unlisted_food")
        self.assertEqual(self.check("Uses your eggs and bacon; you'd need sugar."), "unlisted_food")

    def test_rejects_numbers_and_claims(self):
        self.assertEqual(self.check("Ready in 10 minutes with your eggs and bread."), "number")
        self.assertEqual(self.check("Uses two of your eggs; you'd need sugar."), "banned_word")
        self.assertEqual(self.check("A safe pick: uses your eggs and bread."), "banned_word")
        self.assertEqual(self.check("A healthy way to use your eggs and milk."), "banned_word")
        self.assertEqual(self.check("Allergy friendly and uses your eggs."), "banned_word")

    def test_rejects_bad_shapes(self):
        self.assertEqual(self.check("Eggs."), "length")
        self.assertEqual(self.check("x" * 300), "length")
        self.assertEqual(self.check("Uses your eggs.\nYou'd need sugar."), "format")
        self.assertEqual(self.check("See https://example.com for your eggs."), "format")
        self.assertEqual(check_model_line(None, TOAST, frozenset()), "not_text")


class FakeModel:
    def __init__(self, reply=None, error=None):
        self.reply = reply
        self.error = error
        self.inputs = []

    def __call__(self, facts_json):
        self.inputs.append(facts_json)
        if self.error:
            raise self.error
        if callable(self.reply):
            return self.reply(json.loads(facts_json))
        return self.reply


def echo_lines(facts):
    """A well-behaved model: rewords each fact sheet without adding anything."""
    return json.dumps(
        {
            "explanations": [
                {"id": r["id"], "text": "This recipe uses your {}.".format(", ".join(r["you_have"]))}
                for r in facts["recipes"]
            ]
        }
    )


class ExplanationEndpointTests(unittest.TestCase):
    def setUp(self):
        clear_recipe_catalog_cache()
        self.fake_source = FakeMealDb()
        self.http = TestClient(app)
        app.dependency_overrides[get_recipe_client] = lambda: self.fake_source.client()
        self.model = FakeModel(reply=echo_lines)
        app.dependency_overrides[get_explanation_caller] = lambda: self.model

    def tearDown(self):
        app.dependency_overrides.clear()
        clear_recipe_catalog_cache()

    def explain(self, ids, allergens=(), avoid=(), ingredients=USER):
        return self.http.post(
            "/api/recipe-explanations",
            json={
                "ingredients": ingredients,
                "allergens": list(allergens),
                "avoid": list(avoid),
                "recipe_ids": ids,
            },
        )

    def test_model_line_is_used_and_code_adds_the_constraints_sentence(self):
        response = self.explain(["1001", "1002"], allergens=["sesame"], avoid=["pork"])
        self.assertEqual(response.status_code, 200)
        first, second = response.json()["explanations"]
        self.assertEqual(first["id"], "1001")
        self.assertEqual(first["worded_by"], "ai")
        self.assertEqual(
            first["text"],
            "This recipe uses your eggs, bread, milk, butter. "
            "Recipes listing sesame or pork were left out.",
        )
        self.assertEqual(second["id"], "1002")

    def test_model_never_sees_allergies_or_foods_to_avoid(self):
        self.explain(["1001"], allergens=["sesame", "tree_nuts"], avoid=["pork", "mushroom"])
        sent = self.model.inputs[0].lower()
        for private in ["sesame", "tree", "nut", "pork", "mushroom", "allerg", "avoid"]:
            self.assertNotIn(private, sent)
        self.assertEqual(json.loads(sent)["recipes"][0]["you_would_need"], ["sugar"])

    def test_rejected_or_missing_lines_fall_back_to_the_template(self):
        self.model.reply = json.dumps(
            {"explanations": [{"id": "1001", "text": "Uses your eggs; great with chocolate sauce."}]}
        )
        with self.assertLogs("pic2food", level="INFO") as logs:
            body = self.explain(["1001", "1002"]).json()
        toast, eggs = body["explanations"]
        self.assertEqual(toast["worded_by"], "template")
        self.assertEqual(toast["text"], "Uses your eggs, bread, milk and butter. You'd need sugar.")
        self.assertEqual(eggs["worded_by"], "template")
        joined = "\n".join(logs.output)
        self.assertIn("rejected_unlisted_food=1", joined)
        self.assertNotIn("chocolate", joined)

    def test_model_failures_fall_back_to_templates(self):
        for model in [FakeModel(error=ExplanationTimeoutError()), FakeModel(reply="not json"),
                      FakeModel(reply=json.dumps({"wrong": []}))]:
            app.dependency_overrides[get_explanation_caller] = lambda model=model: model
            body = self.explain(["1001"]).json()
            self.assertEqual(body["explanations"][0]["worded_by"], "template")

    def test_without_an_api_key_templates_are_returned(self):
        app.dependency_overrides[get_explanation_caller] = lambda: None
        body = self.explain(["1001"]).json()
        self.assertEqual(body["explanations"][0]["worded_by"], "template")

    def test_lines_for_other_ids_are_ignored(self):
        self.model.reply = json.dumps(
            {"explanations": [{"id": "9999", "text": "Uses your eggs and bread, nothing else."}]}
        )
        body = self.explain(["1001"]).json()
        self.assertEqual([e["id"] for e in body["explanations"]], ["1001"])
        self.assertEqual(body["explanations"][0]["worded_by"], "template")

    def test_blocked_unknown_or_unrelated_recipes_are_refused(self):
        self.assertEqual(self.explain(["1003"], allergens=["peanuts"],
                                      ingredients=["egg", "garlic"]).status_code, 400)
        self.assertEqual(self.explain(["4242"]).status_code, 400)
        self.assertEqual(self.explain(["1004"], ingredients=["bread"]).status_code, 400)
        self.assertEqual(self.model.inputs, [])

    def test_bad_requests(self):
        self.assertEqual(self.explain([]).status_code, 400)
        self.assertEqual(self.explain(["1001", "1002", "1005", "1008"]).status_code, 400)
        self.assertEqual(self.explain(["1001", "1001"]).status_code, 400)
        self.assertEqual(self.explain(["10a1"]).status_code, 400)
        self.assertEqual(self.explain(["1001"], allergens=["egg"]).status_code, 409)

    def test_recipe_search_includes_the_template_line(self):
        body = self.http.post(
            "/api/recipe-search", json={"ingredients": USER, "allergens": ["sesame"], "avoid": []}
        ).json()
        toast = next(r for r in body["recipes"] if r["id"] == "1001")
        self.assertEqual(
            toast["explanation"],
            "Uses your eggs, bread, milk and butter. You'd need sugar. "
            "Recipes listing sesame were left out.",
        )


if __name__ == "__main__":
    unittest.main()
