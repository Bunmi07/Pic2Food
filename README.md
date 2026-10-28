# Pic2Food

Pic2Food turns a photo of food you already have into a few real recipes. You confirm the ingredients first. The app does not invent a recipe.

This is v1.0, a local prototype. It runs on your computer. It is not hosted, so other people cannot open it on their phone yet. Hosting is the next step.

## What v1.0 does

1. You take or choose a photo. It is shrunk in the browser and the camera data is removed before it is sent.
2. A vision model suggests ingredients. Every suggestion starts unchecked. You check, correct, remove, or add items.
3. If a name can mean more than one thing, you pick which one you have.
4. You can mark allergies and foods to avoid. Those are hard limits. A good match cannot override them.
5. The app looks up recipes from TheMealDB and shows at most three, with the source name and a link. Salt, black pepper, cooking oil, and water are assumed and are not counted as missing.
6. Each recipe has a short reason it fits what you confirmed. A photo that is not food stops, with no ingredient list and no recipes.

A photo is sent to OpenAI for the ingredient guess, and again only to reword that short reason. The key stays on the computer that runs the app. It is not in this repository.

## Run it locally

Backend, from the project folder:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

Put your OpenAI key in `.env` as `OPENAI_API_KEY`. Then:

```bash
.venv/bin/uvicorn server:app --port 8000
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173/. The page talks to the backend through `/api`.

Use a JPEG or PNG. iPhone HEIC photos are rejected on purpose, because the browser cannot reliably prepare them.

## Tests

```bash
.venv/bin/python -m unittest discover -s backend/tests -t .
cd frontend && npm test
```
