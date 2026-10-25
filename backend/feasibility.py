"""Deterministic matching and ranking: which recipes the user can actually make.

For each recipe ingredient we decide one of three things:
- matched: the user confirmed it ("Free-range Eggs, Beaten" matches "egg").
           A different type from a close group (the recipe wants caster
           sugar, the user has sugar) also counts, with a note naming both
           so the user can judge.
- staple:  a pantry staple we assume (salt, black pepper, cooking oil, water);
           never counted as missing, never added to the user's inventory.
           A bare "Pepper" is read as black pepper, and the result says so.
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
from functools import lru_cache
from typing import Dict, FrozenSet, Iterable, List, Tuple

from backend.config import RecipeSettings
from backend.constraints import DESCRIPTOR_WORDS, assumed_meaning, words
from backend.normalization import normalize_term, singular_forms
from backend.recipes import RecipeIngredient, RecipeRecord

MAX_RESULTS = 3

PANTRY_STAPLE_KEYS = frozenset(
    [
        "salt", "sea salt", "kosher salt", "coarse salt", "table salt",
        "black pepper", "ground black pepper", "black peppercorn",
        "oil", "cooking oil", "olive oil", "extra virgin olive oil", "vegetable oil",
        "sunflower oil", "rapeseed oil", "canola oil", "high heat cooking oil",
        "water", "hot water", "warm water", "boiling water", "ice water", "tap water",
    ]
)

# Types the user can usually swap for each other. Matching across a group is
# never silent: the result names what the recipe asks for and what they have.
SWAP_GROUPS = (
    frozenset(
        [
            "sugar", "caster sugar", "granulated sugar", "brown sugar", "muscovado sugar",
            "demerara sugar", "icing sugar", "palm sugar",
        ]
    ),
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


@lru_cache(maxsize=8192)
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
    if ingredient_keys(name) & PANTRY_STAPLE_KEYS:
        return True
    assumed = assumed_meaning(name)
    return bool(assumed and ingredient_keys(assumed) & PANTRY_STAPLE_KEYS)


@dataclass(frozen=True)
class ScoredRecipe:
    recipe: RecipeRecord
    matched: Tuple[RecipeIngredient, ...]
    missing: Tuple[RecipeIngredient, ...]
    staples: Tuple[RecipeIngredient, ...]
    unchecked: Tuple[str, ...]
    swaps: Tuple[Tuple[str, str], ...] = ()  # (recipe ingredient name, what the user has)

    @property
    def sort_key(self) -> Tuple[int, int, int, int]:
        """Fewest missing first, then fewest swaps, then most matched."""
        return (len(self.missing), len(self.swaps), -len(self.matched), int(self.recipe.id))


def user_key_set(user_ingredients: Iterable[str]) -> FrozenSet[str]:
    keys = set()
    for name in user_ingredients:
        keys.update(ingredient_keys(name))
    return frozenset(keys)


def score_recipe(
    recipe: RecipeRecord, user_keys: FrozenSet[str], unchecked: Iterable[str] = ()
) -> ScoredRecipe:
    """Split one (already constraint-checked) recipe into matched, staple, and missing."""
    matched, missing, staples, swaps = [], [], [], []
    for ingredient in recipe.ingredients:
        keys = ingredient_keys(ingredient.name)
        if keys & user_keys:
            matched.append(ingredient)
            continue
        user_has = swap_for(keys, user_keys)
        if user_has:
            matched.append(ingredient)
            swaps.append((ingredient.name, user_has))
        elif is_pantry_staple(ingredient.name):
            staples.append(ingredient)
        else:
            missing.append(ingredient)
    return ScoredRecipe(
        recipe, tuple(matched), tuple(missing), tuple(staples), tuple(unchecked), tuple(swaps)
    )


def swap_for(keys: FrozenSet[str], user_keys: FrozenSet[str]) -> str:
    """What the user has from the same swap group, e.g. "sugar" for caster sugar; else ""."""
    for group in SWAP_GROUPS:
        if keys & group:
            have = sorted(user_keys & group)
            if have:
                return " or ".join(have)
    return ""


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

    staples = []
    for item in scored.staples:
        entry: Dict[str, str] = {"name": item.name, "measure": item.measure}
        assumed = assumed_meaning(item.name)
        if assumed:
            entry["assumed_as"] = assumed
        staples.append(entry)

    swaps = dict(scored.swaps)
    matched = []
    for item in scored.matched:
        entry = {"name": item.name, "measure": item.measure}
        if item.name in swaps:
            entry["you_have"] = swaps[item.name]
        matched.append(entry)

    return {
        "matched": matched,
        "missing": pairs(scored.missing),
        "staples": staples,
        "unchecked_allergy": list(scored.unchecked),
    }
