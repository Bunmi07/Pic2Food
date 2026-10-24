"""Checks the vision model's answer before anything else uses it.

Model output is untrusted. This file rejects malformed answers, trims and
de-duplicates names, enforces the three-guess limit, and drops any fields
we didn't ask for.

Output shape matches the frontend fixture:
- {"id", "name"}                      one clear guess
- {"id", "description", "guesses"}    2-3 guesses (ambiguous)
- {"id", "description", "guesses": []} could not narrow down -> manual entry
"""

import json
import re
from typing import Any, Dict, List

MAX_GUESSES_PER_ITEM = 3
MAX_ITEMS = 25
MAX_TEXT_LENGTH = 60
FALLBACK_DESCRIPTION = "Unclear item"

IMAGE_STATUSES = ("food", "not_food", "unreadable")


class VisionOutputError(ValueError):
    pass


def parse_vision_output(raw: str) -> Dict[str, Any]:
    """Turn the model's raw JSON text into {"status": ..., "items": [...]}.

    Raises VisionOutputError when the answer can't be trusted at all.
    """
    try:
        data = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise VisionOutputError("not_json") from exc

    if not isinstance(data, dict):
        raise VisionOutputError("not_object")

    status = data.get("image_status")
    raw_items = data.get("items")
    if status not in IMAGE_STATUSES or not isinstance(raw_items, list):
        raise VisionOutputError("bad_shape")

    if status != "food":
        return {"status": status}

    items: List[Dict[str, Any]] = []
    seen_names = set()

    for index, entry in enumerate(raw_items[:MAX_ITEMS]):
        if not isinstance(entry, dict) or not isinstance(entry.get("guesses"), list):
            raise VisionOutputError("bad_item")

        item_id = "item-{}".format(index + 1)
        label = _clean_text(entry.get("label")) or FALLBACK_DESCRIPTION
        guesses = _unique([_clean_text(guess) for guess in entry["guesses"]])

        if len(guesses) == 1:
            key = guesses[0].lower()
            if key in seen_names:
                continue
            seen_names.add(key)
            items.append({"id": item_id, "name": guesses[0]})
        elif 2 <= len(guesses) <= MAX_GUESSES_PER_ITEM:
            items.append({"id": item_id, "description": label, "guesses": guesses})
        else:
            items.append({"id": item_id, "description": label, "guesses": []})

    if not items:
        return {"status": "unreadable"}

    return {"status": "ok", "items": items}


def _clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()[:MAX_TEXT_LENGTH].strip()


def _unique(values: List[str]) -> List[str]:
    result: List[str] = []
    seen = set()
    for value in values:
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            result.append(value)
    return result
