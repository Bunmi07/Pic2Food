"""Calls OpenAI to reword the "why this fits you" lines.

Sends the fact sheet JSON from explanations.py with the prompt and output
schema from explanation_prompt.py, and returns the model's raw JSON text.
It does not interpret that text; explanations.py validates it.

Failures become ExplanationTimeoutError or ExplanationCallError. There is no
retry: the caller falls back to template lines, which are always available.
"""

import openai
from openai import OpenAI

from backend.config import ExplanationSettings
from backend.explanation_prompt import EXPLANATION_RESPONSE_SCHEMA, EXPLANATION_SYSTEM_PROMPT


class ExplanationTimeoutError(Exception):
    """The model did not answer within EXPLANATION_TIMEOUT_SECONDS."""


class ExplanationCallError(Exception):
    """The model call failed, was refused, or returned nothing."""


def request_explanations(facts_json: str, settings: ExplanationSettings) -> str:
    client = OpenAI(api_key=settings.api_key, timeout=settings.timeout_seconds, max_retries=0)
    try:
        response = client.chat.completions.create(
            model=settings.model,
            temperature=0,
            response_format={"type": "json_schema", "json_schema": EXPLANATION_RESPONSE_SCHEMA},
            messages=[
                {"role": "system", "content": EXPLANATION_SYSTEM_PROMPT},
                {"role": "user", "content": facts_json},
            ],
        )
    except openai.APITimeoutError as exc:
        raise ExplanationTimeoutError() from exc
    except openai.APIError as exc:
        raise ExplanationCallError(type(exc).__name__) from exc

    message = response.choices[0].message if response.choices else None
    if message is None or getattr(message, "refusal", None) or not message.content:
        raise ExplanationCallError("empty_or_refused")
    return message.content
