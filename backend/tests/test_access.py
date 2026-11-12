"""Tests for the private-hosting gate and the built page.

The vision model is replaced with a stand-in. These tests never call OpenAI,
and they check that logs and responses do not carry the photo or the API key.
"""

import logging
import os
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import app, get_vision_caller, FrontendFiles
from backend.image_validation import MAX_UPLOAD_BYTES

CLEAN_JPEG = b"\xff\xd8\xff\xdb\x00\x04\x00\x00\xff\xda\x00\x02\x00\xff\xd9"
IMAGE_MARKER = b"UNIQUEIMAGEBYTES"
FAKE_KEY = "sk-test-should-not-leak"


def jpeg_with_marker():
    """A JPEG the validator accepts, with a recognizable string in a comment."""
    payload = IMAGE_MARKER
    comment = b"\xff\xfe" + (len(payload) + 2).to_bytes(2, "big") + payload
    return b"\xff\xd8" + comment + CLEAN_JPEG[2:]


class AccessCodeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.previous_code = os.environ.get("ACCESS_CODE")
        self.previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ.pop("ACCESS_CODE", None)
        os.environ["OPENAI_API_KEY"] = FAKE_KEY

    def tearDown(self):
        app.dependency_overrides.clear()
        self._restore("ACCESS_CODE", self.previous_code)
        self._restore("OPENAI_API_KEY", self.previous_key)

    def _restore(self, name, value):
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value

    def test_unset_code_leaves_api_open(self):
        response = self.client.get("/api/access")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertNotIn(FAKE_KEY, response.text)

    def test_health_stays_open_when_a_code_is_set(self):
        os.environ["ACCESS_CODE"] = "pic2food-test"
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertNotIn("pic2food-test", response.text)
        self.assertNotIn(FAKE_KEY, response.text)

    def test_api_requires_the_header_when_a_code_is_set(self):
        os.environ["ACCESS_CODE"] = "pic2food-test"
        missing = self.client.get("/api/access")
        wrong = self.client.get("/api/access", headers={"X-Access-Code": "nope"})
        right = self.client.get("/api/access", headers={"X-Access-Code": "pic2food-test"})
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(missing.json(), {"error": "unauthorized"})
        self.assertNotIn("pic2food-test", missing.text)
        self.assertNotIn(FAKE_KEY, missing.text)
        self.assertEqual(right.status_code, 200)

    def test_blank_code_counts_as_unset(self):
        os.environ["ACCESS_CODE"] = "   "
        response = self.client.get("/api/access")
        self.assertEqual(response.status_code, 200)

    def test_upload_limit_still_rejects_over_five_megabytes(self):
        """The hosted path uses the same 5 MB check. No second limit was added."""
        os.environ["ACCESS_CODE"] = "pic2food-test"
        app.dependency_overrides[get_vision_caller] = lambda: lambda image: "{}"
        photo = jpeg_with_marker() + b"x" * MAX_UPLOAD_BYTES
        self.assertGreater(len(photo), MAX_UPLOAD_BYTES)
        with self.assertLogs("pic2food", level=logging.INFO) as captured:
            response = self.client.post(
                "/api/ingredient-candidates",
                files={"photo": ("photo.jpg", photo, "image/jpeg")},
                headers={"X-Access-Code": "pic2food-test"},
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"error": "invalid_image_too_large"})
        logged = "\n".join(captured.output)
        self.assertNotIn("UNIQUEIMAGEBYTES", logged)
        self.assertNotIn(FAKE_KEY, logged)
        self.assertNotIn("pic2food-test", logged)

    def test_a_rejected_upload_does_not_log_the_code(self):
        os.environ["ACCESS_CODE"] = "pic2food-test"
        records = []

        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())

        handler = Capture()
        logger = logging.getLogger("pic2food")
        logger.addHandler(handler)
        try:
            response = self.client.post(
                "/api/ingredient-candidates",
                files={"photo": ("photo.jpg", jpeg_with_marker(), "image/jpeg")},
            )
        finally:
            logger.removeHandler(handler)
        self.assertEqual(response.status_code, 401)
        logged = "\n".join(records)
        self.assertNotIn("pic2food-test", logged)
        self.assertNotIn("UNIQUEIMAGEBYTES", logged)
        self.assertNotIn(FAKE_KEY, logged)


class FrontendFilesTests(unittest.TestCase):
    def test_pages_come_from_the_build_and_api_paths_are_not_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text("hello page", encoding="utf-8")
            (root / "assets").mkdir()
            (root / "assets" / "app.js").write_text("live-vision", encoding="utf-8")
            hosted = FastAPI()
            hosted.mount("/", FrontendFiles(directory=directory, html=True), name="frontend")
            client = TestClient(hosted)
            self.assertEqual(client.get("/").text, "hello page")
            self.assertEqual(client.get("/saved").text, "hello page")
            self.assertEqual(client.get("/assets/app.js").text, "live-vision")
            self.assertEqual(client.get("/assets/missing.js").status_code, 404)
