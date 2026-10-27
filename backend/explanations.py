"""The "why this fits you" line on each recipe card.

Every line is built from facts we already hold, never from the model's
knowledge:
- the fact sheet: which of the user's ingredients the recipe uses, what
  they'd still need, and sugar-type swaps (from feasibility.py)
- a template line written by code from those facts; always available
- an optional reworded line from the model (explanation_client.py), used
  only if it passes check_model_line(); otherwise the template is kept
- a constraints sentence written by code ("Recipes listing sesame or pork
  were left out."). Allergies and foods to avoid are never sent to the model.

check_model_line() rejects a line that names a food outside the fact sheet,
contains a number, makes a safety/health/freshness/time/taste claim, or is
too long. Rejections fall back to the template and are logged by reason only.
"""

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Callable, Dict, FrozenSet, Iterable, List, Optional, Tuple

from backend.constraints import (
    DESCRIPTOR_WORDS,
    Constraints,
    default_allergen_groups,
    default_food_families,
    words,
)
from backend.feasibility import ScoredRecipe
from backend.normalization import default_aliases, singular_forms

MAX_LINE_LENGTH = 240
MIN_LINE_LENGTH = 10

# Words that may appear in ingredient names but don't name a food on their
# own, so the model may use them freely.
GENERIC_WORDS = DESCRIPTOR_WORDS | frozenset(
    """
    red green yellow white black brown golden dark light sweet hot dried ground
    and or with for in on to your you it its this that type types everything else
    need needs would have has uses use calls call recipe recipes ingredient ingredients
    more other just only also plus some any all both into out up dish meal
    great extra cooking ready mix mixed fry stir plain regular style made base
    """.split()
)

BANNED_WORDS = frozenset(
    """
    safe safely safety unsafe healthy healthier health nutritious nutrition nutrient
    fresh freshly freshness spoil spoiled spoilt quick quickly easy easily simple
    minute minutes hour hours traditional authentic classic delicious tasty flavorful
    flavourful allergy allergies allergen allergens allergic diet dietary vegan
    vegetarian gluten dairy calorie calories protein
    one two three four five six seven eight nine ten dozen half
    """.split()
)


@dataclass(frozen=True)
class ExplanationFacts:
    recipe_id: str
    title: str
    have: Tuple[str, ...]
    need: Tuple[str, ...]
    swaps: Tuple[Tuple[str, str], ...]  # (recipe calls for, user has)


def display_name(name: str) -> str:
    """ "Free-range Eggs, Beaten" -> "eggs": the food without preparation words."""
    all_words = words(name)
    core = [word for word in all_words if word not in DESCRIPTOR_WORDS]
    return " ".join(core or all_words)


def facts_for(scored: ScoredRecipe) -> ExplanationFacts:
    swapped = dict(scored.swaps)
    return ExplanationFacts(
        recipe_id=scored.recipe.id,
        title=scored.recipe.title,
        have=tuple(display_name(i.name) for i in scored.matched if i.name not in swapped),
        need=tuple(display_name(i.name) for i in scored.missing),
        swaps=tuple((display_name(name), has) for name, has in scored.swaps),
    )


def join_list(items: Iterable[str], word: str = "and") -> str:
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return "{} {} {}".format(", ".join(items[:-1]), word, items[-1])


def template_line(facts: ExplanationFacts) -> str:
    """The code-written line, e.g. "Uses your eggs and bread. You'd need flour." """
    parts = []
    if facts.have:
        parts.append("Uses your {}.".format(join_list(facts.have)))
    for calls_for, has in facts.swaps:
        parts.append("It calls for {}; you have {}.".format(calls_for, has))
    if facts.need:
        parts.append("You'd need {}.".format(join_list(facts.need)))
    else:
        parts.append("You have everything else it needs.")
    return " ".join(parts)


def constraints_sentence(constraints: Constraints) -> str:
    """Code-only sentence naming what was filtered out; empty with no constraints."""
    labels = [group.label.lower() for group in constraints.allergens]
    labels += [term.original for term in constraints.avoid]
    if not labels:
        return ""
    return "Recipes listing {} were left out.".format(join_list(labels, "or"))


def model_input(all_facts: List[ExplanationFacts]) -> str:
    """The only data the model sees: no allergies, quantities, steps, or photo."""
    return json.dumps(
        {
            "recipes": [
                {
                    "id": facts.recipe_id,
                    "title": facts.title,
                    "you_have": list(facts.have),
                    "you_would_need": list(facts.need),
                    "different_type": [
                        {"recipe_calls_for": calls_for, "you_have": has}
                        for calls_for, has in facts.swaps
                    ],
                }
                for facts in all_facts
            ]
        },
        ensure_ascii=False,
    )


@lru_cache(maxsize=1)
def reviewed_food_words() -> FrozenSet[str]:
    """Food words from our own files: alias names, allergen and family terms."""
    found = set()
    for key, value in default_aliases().items():
        found.update(words(key))
        if isinstance(value, str):
            found.update(words(value))
    groups = list(default_allergen_groups().values()) + [
        group for family in default_food_families().values() for group in family
    ]
    for group in groups:
        for phrase in group.terms + group.exceptions:
            found.update(phrase)
    return frozenset(found)


def _with_singulars(found: Iterable[str]) -> FrozenSet[str]:
    expanded = set()
    for word in found:
        expanded.add(word)
        expanded.update(singular_forms(word))
    return frozenset(expanded)


def check_model_line(text: str, facts: ExplanationFacts, food_words: FrozenSet[str]) -> str:
    """"" if the line may be shown, else a short rejection reason for the log."""
    if not isinstance(text, str):
        return "not_text"
    line = text.strip()
    if not MIN_LINE_LENGTH <= len(line) <= MAX_LINE_LENGTH:
        return "length"
    if "\n" in line or "http" in line.lower():
        return "format"
    if re.search(r"\d", line):
        return "number"
    tokens = words(line)
    if any(token in BANNED_WORDS for token in tokens):
        return "banned_word"

    fact_text = [facts.title] + list(facts.have) + list(facts.need)
    fact_text += [part for pair in facts.swaps for part in pair]
    allowed = _with_singulars(word for item in fact_text for word in words(item))
    for token in tokens:
        forms = _with_singulars([token])
        if token in GENERIC_WORDS or forms & allowed:
            continue
        if forms & food_words:
            return "unlisted_food"
    return ""


def explain(
    scored: List[ScoredRecipe],
    constraints: Constraints,
    catalog_food_words: FrozenSet[str],
    call_model: Optional[Callable[[str], str]] = None,
) -> Tuple[List[Dict[str, str]], Dict[str, int]]:
    """One {"id", "text", "worded_by"} per recipe, plus counts of outcomes for logging.

    worded_by is "ai" when the model's line passed every check, else "template".
    """
    all_facts = [facts_for(s) for s in scored]
    model_lines: Dict[str, str] = {}
    outcomes: Dict[str, int] = {}

    if call_model is not None and all_facts:
        try:
            model_lines = parse_model_lines(call_model(model_input(all_facts)), all_facts)
        except Exception as error:  # any model failure falls back to templates
            outcomes["model_error_" + type(error).__name__] = 1

    food_words = _with_singulars(reviewed_food_words() | catalog_food_words)
    tail = constraints_sentence(constraints)
    results = []
    for facts in all_facts:
        text, worded_by = template_line(facts), "template"
        if facts.recipe_id in model_lines:
            reason = check_model_line(model_lines[facts.recipe_id], facts, food_words)
            if reason:
                outcomes["rejected_" + reason] = outcomes.get("rejected_" + reason, 0) + 1
            else:
                text, worded_by = model_lines[facts.recipe_id].strip(), "ai"
        outcomes[worded_by] = outcomes.get(worded_by, 0) + 1
        results.append(
            {"id": facts.recipe_id, "text": " ".join(filter(None, [text, tail])), "worded_by": worded_by}
        )
    return results, outcomes


def parse_model_lines(raw: str, all_facts: List[ExplanationFacts]) -> Dict[str, str]:
    """Model JSON -> {recipe id: line}, keeping only ids we asked about, first answer wins."""
    body = json.loads(raw)
    if not isinstance(body, dict) or not isinstance(body.get("explanations"), list):
        raise ValueError("unexpected shape")
    wanted = {facts.recipe_id for facts in all_facts}
    lines: Dict[str, str] = {}
    for entry in body["explanations"]:
        if not isinstance(entry, dict):
            continue
        recipe_id, text = entry.get("id"), entry.get("text")
        if recipe_id in wanted and recipe_id not in lines and isinstance(text, str):
            lines[recipe_id] = text
    return lines
