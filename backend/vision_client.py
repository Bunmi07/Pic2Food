import base64

import openai
from openai import OpenAI

from backend.config import VisionSettings
from backend.vision_prompt import (
    VISION_RESPONSE_SCHEMA,
    VISION_SYSTEM_PROMPT,
    VISION_USER_TEXT,
)


class VisionTimeoutError(Exception):
    pass


class VisionCallError(Exception):
    pass


def request_ingredient_candidates(image_jpeg: bytes, settings: VisionSettings) -> str:
    """Send one JPEG to the vision model and return its raw JSON text.

    No automatic retries: a retry doubles cost and must be an explicit
    user action. The image is only held in memory for this call.
    """
    client = OpenAI(
        api_key=settings.api_key,
        timeout=settings.timeout_seconds,
        max_retries=0,
    )
    image_url = "data:image/jpeg;base64," + base64.b64encode(image_jpeg).decode("ascii")

    try:
        response = client.chat.completions.create(
            model=settings.model,
            temperature=0,
            response_format={"type": "json_schema", "json_schema": VISION_RESPONSE_SCHEMA},
            messages=[
                {"role": "system", "content": VISION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_USER_TEXT},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                },
            ],
        )
    except openai.APITimeoutError as exc:
        raise VisionTimeoutError() from exc
    except openai.APIError as exc:
        raise VisionCallError(type(exc).__name__) from exc

    message = response.choices[0].message if response.choices else None
    if message is None or getattr(message, "refusal", None) or not message.content:
        raise VisionCallError("empty_or_refused")
    return message.content
