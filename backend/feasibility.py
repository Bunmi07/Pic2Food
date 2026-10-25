"""Deterministic matching and ranking: which recipes the user can actually make.

For each recipe ingredient we decide one of three things:
- matched: the user confirmed it ("Free-range Eggs, Beaten" matches "egg")
- staple:  a pantry staple we assume (salt, black pepper, cooking oil);
           never counted as missing, never added to the user's inventory
- missing: anything else

Matching is rules-based, never fuzzy. Both sides are turned into "keys":
the alias file's standard name when it knows the phrase, otherwise the
lowercased words with simple plurals removed. Preparation words that don't
change the food ("chopped", "fresh", "free-range") are ignored. When unsure,
an ingredient counts as missing, which only ever makes a recipe look harder,
never easier.

Hard constraints (allergies, foods to avoid) are applied by the caller before
scoring; scoring never sees a blocked recipe.
"""

from dataclasses import dataclass
from typing import Dict, FrozenSet, Iterable, List, Tuple

from backend.config import RecipeSettings
from backend.constraints import words
from backend.normalization import normalize_term, singular_forms
from backend.recipes import RecipeIngredient, RecipeRecord

MAX_RESULTS = 3

DESCRIPTOR_WORDS = frozenset(
    """
    chopped diced sliced minced grated shredded crushed beaten fresh large small
    medium whole raw free range organic peeled cubed finely roughly thinly
    softened melted chilled cold can tin jar of a an the
    """.split()
)

PANTRY_STAPLE_KEYS = frozenset(
    [
        "salt", "sea salt", "kosher salt", "coarse salt", "table salt",
        "black pepper", "ground black pepper", "black peppercorn",
        "oil", "cooking oil", "olive oil", "extra virgin olive oil", "vegetable oil",
        "sunflower oil", "rapeseed oil", "canola oil", "high heat cooking oil",
    ]
)

SUPPORTED = "supported"
NEAR_MATCH = "near_match"
NO_MATCH = "no_match"


def _phrase_keys(phrase: str) -> List[str]:
    result = normalize_term(phrase)
    if result.status == "known" and result.canonical:
        return [result.canonical]
    parts = phrase.split(" ")
    return [phrase] + [" ".join(parts[:-1] + [form]) for form in singular_forms(parts[-1])]


def ingredient_keys(name: str) -> FrozenSet[str]:
    """Comparable forms of one ingredient name, used for both user and recipe sides."""
    all_words = words(name)
    phrases = {
        " ".join(all_words),
        " ".join(word for word in all_words if word not in DESCRIPTOR_WORDS),
    }
    keys = set()
    for phrase in phrases:
        if phrase:
            keys.update(_phrase_keys(phrase))
    return frozenset(keys)


def is_pantry_staple(name: str) -> bool:
    return bool(ingredient_keys(name) & PANTRY_STAPLE_KEYS)


@dataclass(frozen=True)
class ScoredRecipe:
    recipe: RecipeRecord
    matched: Tuple[RecipeIngredient, ...]
    missing: Tuple[RecipeIngredient, ...]
    staples: Tuple[RecipeIngredient, ...]
    unchecked: Tuple[str, ...]

    @property
    def sort_key(self) -> Tuple[int, int, int]:
        return (len(self.missing), -len(self.matched), int(self.recipe.id))


def user_key_set(user_ingredients: Iterable[str]) -> FrozenSet[str]:
    keys = set()
    for name in user_ingredients:
        keys.update(ingredient_keys(name))
    return frozenset(keys)


def score_recipe(
    recipe: RecipeRecord, user_keys: FrozenSet[str], unchecked: Iterable[str] = ()
) -> ScoredRecipe:
    """Split one (already constraint-checked) recipe into matched, staple, and missing."""
    matched, missing, staples = [], [], []
    for ingredient in recipe.ingredients:
        keys = ingredient_keys(ingredient.name)
        if keys & user_keys:
            matched.append(ingredient)
        elif keys & PANTRY_STAPLE_KEYS:
            staples.append(ingredient)
        else:
            missing.append(ingredient)
    return ScoredRecipe(recipe, tuple(matched), tuple(missing), tuple(staples), tuple(unchecked))


def classify(scored: List[ScoredRecipe], settings: RecipeSettings) -> Tuple[str, List[ScoredRecipe]]:
    """Supported match, near match, or no match, with at most three ranked recipes.

    Near matches are shown only when there is no supported match. A recipe
    must use at least one of the user's ingredients to count at all.
    """
    usable = sorted((s for s in scored if s.matched), key=lambda s: s.sort_key)
    supported = [s for s in usable if len(s.missing) <= settings.max_missing]
    if supported:
        return SUPPORTED, supported[:MAX_RESULTS]
    near_limit = settings.max_missing + settings.near_match_margin
    near = [s for s in usable if settings.max_missing < len(s.missing) <= near_limit]
    if near:
        return NEAR_MATCH, near[:MAX_RESULTS]
    return NO_MATCH, []


def scored_to_dict(scored: ScoredRecipe) -> Dict[str, object]:
    def pairs(items: Tuple[RecipeIngredient, ...]) -> List[Dict[str, str]]:
        return [{"name": item.name, "measure": item.measure} for item in items]

    return {
        "matched": pairs(scored.matched),
        "missing": pairs(scored.missing),
        "staples": pairs(scored.staples),
        "unchecked_allergy": list(scored.unchecked),
    }
