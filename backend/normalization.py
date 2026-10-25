"""Turns confirmed ingredient names into one standard name each.

Rules-based, not a model: every name is looked up in the owned mapping file
backend/data/ingredient_aliases.json. For example "scallions" and
"spring onion" both become "green onion", so recipe search sees one name.

- known:     found in the mapping; returns its standard name
- ambiguous: the mapping marks it as having more than one meaning (for
             example "coriander"); returns the options for the user to pick
- unknown:   not in the mapping; never guessed, the caller logs it

Lookup is exact after lowercasing, trimming, and trying simple singular
forms. There is no fuzzy matching.
"""

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Union

ALIASES_PATH = Path(__file__).parent / "data" / "ingredient_aliases.json"

MappingValue = Union[str, Dict[str, List[str]]]


@dataclass(frozen=True)
class NormalizationResult:
    input: str
    status: str
    canonical: Optional[str] = None
    options: List[str] = field(default_factory=list)


def clean_term(raw: str) -> str:
    """Lowercase, trim, and collapse spaces: "  Green  Onions " -> "green onions"."""
    return re.sub(r"\s+", " ", raw).strip().lower()


def singular_forms(term: str) -> List[str]:
    """Simple singular spellings to try when the plural isn't in the mapping.

    Only used as lookup keys: a form is accepted only if it exists in the
    mapping file, so this never invents a name.
    """
    forms = []
    if term.endswith("ies") and len(term) > 4:
        forms.append(term[:-3] + "y")
    if term.endswith("oes"):
        forms.append(term[:-2])
    if re.search(r"(s|x|z|ch|sh)es$", term):
        forms.append(term[:-2])
    if term.endswith("s") and not term.endswith(("ss", "us", "is")):
        forms.append(term[:-1])
    return forms


def load_aliases(path: Path = ALIASES_PATH) -> Dict[str, MappingValue]:
    """Read and check the mapping file. A broken file fails loudly at startup."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("alias file must be a JSON object")

    for key, value in data.items():
        if key != clean_term(key):
            raise ValueError("alias key is not normalized: {!r}".format(key))
        if isinstance(value, str):
            if data.get(value) != value:
                raise ValueError("standard name must map to itself: {!r}".format(value))
        elif isinstance(value, dict) and isinstance(value.get("ambiguous"), list):
            options = value["ambiguous"]
            if len(options) < 2 or any(data.get(option) != option for option in options):
                raise ValueError("ambiguous options must be standard names: {!r}".format(key))
        else:
            raise ValueError("bad mapping value for {!r}".format(key))
    return data


@lru_cache(maxsize=1)
def default_aliases() -> Dict[str, MappingValue]:
    return load_aliases()


def normalize_term(raw: str, aliases: Optional[Dict[str, MappingValue]] = None) -> NormalizationResult:
    """Look up one confirmed name and say whether it is known, ambiguous, or unknown."""
    mapping = default_aliases() if aliases is None else aliases
    term = clean_term(raw)

    for key in [term] + singular_forms(term):
        value = mapping.get(key)
        if isinstance(value, str):
            return NormalizationResult(input=raw, status="known", canonical=value)
        if isinstance(value, dict):
            return NormalizationResult(
                input=raw, status="ambiguous", options=list(value["ambiguous"])
            )

    return NormalizationResult(input=raw, status="unknown")
