"""The controlled evaluation set: labeled kitchens scored against a frozen catalog.

These tests never call TheMealDB or a model. A failure names the scenario and
the check (recipes, status, a constraint, attribution, or the explanation).
"""

import unittest

from backend.evaluation import load_evaluation_catalog, load_scenarios, run_evaluation, score_scenario


class EvaluationSetTests(unittest.TestCase):
    def test_controlled_set_passes(self):
        failures = run_evaluation()
        self.assertEqual(failures, [], "\n".join(failures))

    def test_set_covers_the_safety_cases(self):
        ids = {scenario["id"] for scenario in load_scenarios()}
        self.assertGreaterEqual(len(ids), 12)
        for scenario_id in (
            "peanut-allergy-hides-recipe",
            "pork-removes-only-near-match",
            "coconut-not-a-tree-nut",
            "confirmed-ham-conflicts-with-pork",
            "parsley-no-match",
            "unrecognized-ingredient-warned",
        ):
            self.assertIn(scenario_id, ids)

    def test_malformed_fixture_is_dropped(self):
        catalog = load_evaluation_catalog()
        self.assertEqual(catalog.malformed, 1)
        self.assertNotIn("2099", [recipe.id for recipe in catalog.recipes])

    def test_wrong_expectation_is_reported(self):
        catalog = load_evaluation_catalog()
        scenario = dict(load_scenarios()[0])
        scenario["expected_ids"] = ["9999"]
        self.assertTrue(score_scenario(scenario, catalog))
