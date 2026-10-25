"""Allergies and foods to avoid: the hard filter applied before any recipe is shown.

Rules-based, not a model. The user picks allergens from a fixed list of nine
and may type foods to avoid. A recipe ingredient is blocked when its name
contains a blocked word or phrase, matched on whole words ("peanut" blocks
"peanut oil" but "nut" does not block "nutmeg"). Matching errs toward
blocking: a wrong block hides a recipe, a wrong pass could harm someone.

Allergen words live in backend/data/allergen_groups.json. Typed foods to
avoid are matched by name, plus the alias file's other names for them
("scallion" also blocks "green onion"). If the typed word names a food
family in backend/data/food_families.json ("pork", "dairy", "meat"...), the
whole family is blocked too ("pork" blocks "bacon").

A recipe ingredient we have never reviewed (not in the alias file and not an
allergen word) is reported as unchecked when the user has allergies, so the
recipe can be shown with a clear warning. Unchecked never means allowed-safe.
"""

import json
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, FrozenSet, Iterable, List, Optional, Tuple

from backend.normalization import clean_term, default_aliases, normalize_term, singular_forms

ALLERGENS_PATH = Path(__file__).parent / "data" / "allergen_groups.json"
FAMILIES_PATH = Path(__file__).parent / "data" / "food_families.json"
ALLERGEN_IDS = (
    "milk", "egg", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame",
)

Phrase = Tuple[str, ...]


@dataclass(frozen=True)
class AllergenGroup:
    id: str
    label: str
    terms: Tuple[Phrase, ...]
    exceptions: Tuple[Phrase, ...]


@dataclass(frozen=True)
class AvoidTerm:
    original: str
    phrases: Tuple[Phrase, ...]
    groups: Tuple[AllergenGroup, ...] = ()


@dataclass(frozen=True)
class Constraints:
    """What the user told us to keep out. Built once per request by build_constraints."""

    allergens: Tuple[AllergenGroup, ...] = ()
    avoid: Tuple[AvoidTerm, ...] = ()


@dataclass
class IngredientCheck:
    reasons: List[Dict[str, str]] = field(default_factory=list)
    unchecked: bool = False

    @property
    def blocked(self) -> bool:
        return bool(self.reasons)


@dataclass
class RecipeCheck:
    """allowed is False if any ingredient is blocked. unchecked lists names we
    could not verify against the user's allergies (shown as a warning)."""

    allowed: bool
    blocked: List[Dict[str, object]]
    unchecked: List[str]


def words(text: str) -> Phrase:
    """"Crème Fraîche, chilled" -> ("creme", "fraiche", "chilled")."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return tuple(re.findall(r"[a-z0-9]+", plain.lower()))


# Recipes often write just "Pepper". By product decision we read that as black
# pepper and say so on screen; allergy and avoid checks test both readings.
ASSUMED_RECIPE_MEANINGS = {
    ("pepper",): "black pepper",
    ("ground", "pepper"): "ground black pepper",
}


def assumed_meaning(name: str) -> Optional[str]:
    """The reading we assume for a vague recipe ingredient, if we have one."""
    return ASSUMED_RECIPE_MEANINGS.get(words(name))


@lru_cache(maxsize=16384)
def _word_keys(word: str) -> FrozenSet[str]:
    return frozenset([word] + singular_forms(word))


def contains_phrase(ingredient: Phrase, phrase: Phrase) -> bool:
    """True if the phrase appears as consecutive whole words, allowing plurals."""
    if not phrase or len(phrase) > len(ingredient):
        return False
    ingredient_keys = [_word_keys(word) for word in ingredient]
    phrase_keys = [_word_keys(word) for word in phrase]
    for start in range(len(ingredient) - len(phrase) + 1):
        if all(
            ingredient_keys[start + offset] & phrase_keys[offset]
            for offset in range(len(phrase))
        ):
            return True
    return False


def load_allergen_groups(path: Path = ALLERGENS_PATH) -> Dict[str, AllergenGroup]:
    """Read and check the allergen file. A broken file fails loudly at startup."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != set(ALLERGEN_IDS):
        raise ValueError("allergen file must define exactly: {}".format(", ".join(ALLERGEN_IDS)))

    groups = {}
    for group_id, entry in data.items():
        label = entry.get("label") if isinstance(entry, dict) else None
        terms = entry.get("terms") if isinstance(entry, dict) else None
        exceptions = entry.get("except", []) if isinstance(entry, dict) else None
        if not isinstance(label, str) or not label.strip():
            raise ValueError("allergen {!r} needs a label".format(group_id))
        if not isinstance(terms, list) or not terms or not isinstance(exceptions, list):
            raise ValueError("allergen {!r} needs terms and an except list".format(group_id))
        term_phrases = tuple(words(term) for term in terms)
        except_phrases = tuple(words(term) for term in exceptions)
        if not all(term_phrases) or not all(except_phrases):
            raise ValueError("allergen {!r} has an empty term".format(group_id))
        groups[group_id] = AllergenGroup(group_id, label, term_phrases, except_phrases)
    return groups


@lru_cache(maxsize=1)
def default_allergen_groups() -> Dict[str, AllergenGroup]:
    return load_allergen_groups()


def load_food_families(
    path: Path = FAMILIES_PATH, allergens: Optional[Dict[str, AllergenGroup]] = None
) -> Dict[str, Tuple[AllergenGroup, ...]]:
    """Read and check the food-family file.

    Returns typed name -> every word group that name blocks, with "includes"
    already expanded ("meat" pulls in pork, beef, lamb, and poultry). A broken
    file, an unknown reference, or a loop fails loudly at startup.
    """
    allergen_groups = default_allergen_groups() if allergens is None else allergens
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("food family file must be a JSON object")

    own_groups = {}
    for key, entry in data.items():
        if not isinstance(entry, dict) or not all(
            isinstance(entry.get(field_name), list)
            for field_name in ("names", "terms", "except", "includes")
        ):
            raise ValueError("food family {!r} needs names, terms, except, includes".format(key))
        if not entry["names"] or not (entry["terms"] or entry["includes"]):
            raise ValueError("food family {!r} needs names and terms or includes".format(key))
        terms = tuple(words(term) for term in entry["terms"])
        exceptions = tuple(words(term) for term in entry["except"])
        if not all(terms) or not all(exceptions):
            raise ValueError("food family {!r} has an empty term".format(key))
        own_groups[key] = AllergenGroup("family:" + key, key, terms, exceptions)

    def expand(key: str, visiting: Tuple[str, ...]) -> List[AllergenGroup]:
        if key in visiting:
            raise ValueError("food family loop: {}".format(" -> ".join(visiting + (key,))))
        groups = [own_groups[key]] if own_groups[key].terms else []
        for ref in data[key]["includes"]:
            kind, _, name = ref.partition(":")
            if kind == "allergen" and name in allergen_groups:
                groups.append(allergen_groups[name])
            elif kind == "family" and name in data:
                groups.extend(expand(name, visiting + (key,)))
            else:
                raise ValueError("food family {!r} has a bad include {!r}".format(key, ref))
        return groups

    families = {}
    for key, entry in data.items():
        groups = tuple(dict.fromkeys(expand(key, ())))
        for name in entry["names"]:
            if name != clean_term(name) or name in families:
                raise ValueError("food family name {!r} is not normalized or repeats".format(name))
            families[name] = groups
    return families


@lru_cache(maxsize=1)
def default_food_families() -> Dict[str, Tuple[AllergenGroup, ...]]:
    return load_food_families()


def family_groups(raw: str) -> Tuple[AllergenGroup, ...]:
    """The food family a typed word names, if any ("Nuts" -> tree nuts + peanuts)."""
    term = clean_term(raw)
    families = default_food_families()
    for key in [term] + singular_forms(term):
        if key in families:
            return families[key]
    return ()


def avoid_phrases(raw: str) -> Tuple[Phrase, ...]:
    """The typed word plus every name the alias file links to it."""
    names = {raw}
    result = normalize_term(raw)
    standard_names = [result.canonical] if result.canonical else list(result.options)
    for alias, target in default_aliases().items():
        if alias in standard_names or target in standard_names:
            names.add(alias)
    return tuple(phrase for phrase in sorted({words(name) for name in names}) if phrase)


def build_constraints(
    allergen_ids: Iterable[str],
    avoid: Iterable[str],
    groups: Optional[Dict[str, AllergenGroup]] = None,
) -> Constraints:
    """Turn the user's choices into a Constraints value. Unknown allergen ids raise."""
    all_groups = default_allergen_groups() if groups is None else groups
    selected = []
    for allergen_id in allergen_ids:
        if allergen_id not in all_groups:
            raise ValueError("unknown allergen: {!r}".format(allergen_id))
        if all_groups[allergen_id] not in selected:
            selected.append(all_groups[allergen_id])
    avoid_terms = tuple(
        AvoidTerm(original=term.strip(), phrases=avoid_phrases(term), groups=family_groups(term))
        for term in avoid
        if term.strip()
    )
    return Constraints(allergens=tuple(selected), avoid=avoid_terms)


def matches_group(ingredient: Phrase, group: AllergenGroup) -> bool:
    if any(contains_phrase(ingredient, phrase) for phrase in group.exceptions):
        return False
    return any(contains_phrase(ingredient, phrase) for phrase in group.terms)


@lru_cache(maxsize=8192)
def is_reviewed(name: str, ingredient: Phrase) -> bool:
    """We know what this ingredient is: it's in the alias file or the allergen file."""
    if normalize_term(" ".join(ingredient)).status != "unknown":
        return True
    if normalize_term(name).status != "unknown":
        return True
    known_groups = list(default_allergen_groups().values()) + [
        group for groups in default_food_families().values() for group in groups
    ]
    return any(
        contains_phrase(ingredient, phrase)
        for group in known_groups
        for phrase in group.terms + group.exceptions
    )


def check_ingredient(name: str, constraints: Constraints) -> IngredientCheck:
    """Which of the user's allergies or avoided foods this one ingredient hits."""
    ingredient = words(name)
    assumed = assumed_meaning(name)
    readings = [ingredient] + ([words(assumed)] if assumed else [])
    check = IngredientCheck()
    for group in constraints.allergens:
        if any(matches_group(reading, group) for reading in readings):
            check.reasons.append({"type": "allergy", "id": group.id, "label": group.label})
    for term in constraints.avoid:
        if any(
            contains_phrase(reading, phrase) for reading in readings for phrase in term.phrases
        ) or any(matches_group(reading, group) for reading in readings for group in term.groups):
            check.reasons.append({"type": "avoid", "term": term.original})
    if constraints.allergens and not check.blocked and not is_reviewed(name, ingredient):
        check.unchecked = True
    return check


def check_recipe(ingredient_names: Iterable[str], constraints: Constraints) -> RecipeCheck:
    """The hard filter for one recipe. Ranking must never override allowed=False."""
    blocked = []
    unchecked = []
    for name in ingredient_names:
        check = check_ingredient(name, constraints)
        if check.blocked:
            blocked.append({"ingredient": name, "reasons": check.reasons})
        elif check.unchecked:
            unchecked.append(name)
    return RecipeCheck(allowed=not blocked, blocked=blocked, unchecked=unchecked)


def find_inventory_conflicts(names: Iterable[str], constraints: Constraints) -> List[Dict[str, object]]:
    """Confirmed ingredients that clash with the user's own allergies or avoided foods."""
    return check_recipe(names, constraints).blocked
