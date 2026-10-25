"""Tests for ingredient normalization: aliases, plurals, ambiguity, unknowns,
and the integrity of the mapping file itself."""

import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app
from backend.normalization import load_aliases, normalize_term


def canonical(name):
    result = normalize_term(name)
    return result.canonical if result.status == "known" else result.status


class AliasTests(unittest.TestCase):
    def test_synonyms_resolve_to_one_standard_name(self):
        for name in ["scallion", "spring onion", "green onion"]:
            self.assertEqual(canonical(name), "green onion", name)
        self.assertEqual(canonical("courgette"), "zucchini")
        self.assertEqual(canonical("aubergine"), "eggplant")

    def test_case_spacing_and_plurals(self):
        self.assertEqual(canonical("  Green   Onions "), "green onion")
        self.assertEqual(canonical("Eggs"), "egg")
        self.assertEqual(canonical("potatoes"), "potato")
        self.assertEqual(canonical("tomatoes"), "tomato")
        self.assertEqual(canonical("cheese slices"), "sliced cheese")
        self.assertEqual(canonical("garbanzo beans"), "chickpea")

    def test_standard_name_maps_to_itself(self):
        self.assertEqual(canonical("green onion"), "green onion")

    def test_input_is_preserved(self):
        self.assertEqual(normalize_term("  Scallions ").input, "  Scallions ")


class AmbiguityTests(unittest.TestCase):
    def test_ambiguous_terms_return_options_and_no_pick(self):
        result = normalize_term("coriander")
        self.assertEqual(result.status, "ambiguous")
        self.assertIsNone(result.canonical)
        self.assertEqual(result.options, ["cilantro", "coriander seed"])

    def test_specific_forms_are_not_ambiguous(self):
        self.assertEqual(canonical("coriander leaf"), "cilantro")
        self.assertEqual(canonical("coriander seeds"), "coriander seed")


class UnknownTermTests(unittest.TestCase):
    def test_unknown_terms_are_not_guessed(self):
        for name in ["dragonfruit", "scallop", "onionz", "green", "eggg"]:
            result = normalize_term(name)
            self.assertEqual(result.status, "unknown", name)
            self.assertIsNone(result.canonical)
            self.assertEqual(result.options, [])


class MappingFileTests(unittest.TestCase):
    def test_shipped_mapping_file_is_valid(self):
        aliases = load_aliases()
        self.assertGreater(len(aliases), 0)

    def write_mapping(self, data):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(data, handle)
        handle.close()
        self.addCleanup(Path(handle.name).unlink)
        return Path(handle.name)

    def test_rejects_alias_pointing_to_missing_standard_name(self):
        with self.assertRaises(ValueError):
            load_aliases(self.write_mapping({"scallion": "green onion"}))

    def test_rejects_ambiguous_options_that_are_not_standard_names(self):
        path = self.write_mapping({"coriander": {"ambiguous": ["cilantro", "seed"]}})
        with self.assertRaises(ValueError):
            load_aliases(path)

    def test_rejects_keys_that_are_not_normalized(self):
        with self.assertRaises(ValueError):
            load_aliases(self.write_mapping({"Egg": "Egg"}))


class NormalizeEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def post(self, ingredients):
        return self.client.post(
            "/api/normalize-ingredients", json={"ingredients": ingredients}
        )

    def test_returns_one_result_per_name_in_order(self):
        response = self.post(["Scallions", "coriander", "dragonfruit"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "results": [
                    {"input": "Scallions", "status": "known", "canonical": "green onion"},
                    {
                        "input": "coriander",
                        "status": "ambiguous",
                        "options": ["cilantro", "coriander seed"],
                    },
                    {"input": "dragonfruit", "status": "unknown"},
                ]
            },
        )

    def test_unknown_terms_are_logged(self):
        with self.assertLogs("pic2food", level="INFO") as logs:
            self.post(["dragonfruit"])
        self.assertTrue(any("unknown_ingredient_term" in line for line in logs.output))
        self.assertTrue(any("dragonfruit" in line for line in logs.output))

    def test_rejects_bad_requests(self):
        for ingredients in [[], ["  "], ["x" * 61], ["egg"] * 51]:
            response = self.post(ingredients)
            self.assertEqual(response.status_code, 400, ingredients)
            self.assertEqual(response.json(), {"error": "invalid_ingredients"})
        self.assertEqual(self.post("egg").status_code, 422)


if __name__ == "__main__":
    unittest.main()
