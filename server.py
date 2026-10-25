"""Starts the backend: `.venv/bin/uvicorn server:app --port 8000`.

The app itself is defined in backend/app.py.
"""

from backend.app import app

__all__ = ["app"]
