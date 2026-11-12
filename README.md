# Pic2Food

Pic2Food turns a photo of food you already have into a few real recipes. You confirm the ingredients first. The app does not invent a recipe.

v1.0 runs on your computer. v1.1 can also run as one private server that serves the page and the API. A shared access code keeps that copy off the public internet. It is not deployed until you put the container on Render.

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

## Private hosting

Build the page, then let the Python server serve it. Do not set `VITE_CANDIDATE_SOURCE` for that build. The production page calls the live vision endpoint.

```bash
cd frontend && npm run build
cd ..
.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
```

Leave `ACCESS_CODE` empty in `.env` for this. The app opens straight to the photo screen, the same as local development on port 5173.

To require a code, set `ACCESS_CODE` in the environment before starting the server. The first screen asks for it and remembers it on that device. A wrong code says "That code didn't work." Every `/api` call must send the code in the `X-Access-Code` header. `/health` stays open. There is no per-visitor rate limit. The photo cap is still 5 MB, checked in `backend/image_validation.py`.

The repo-root `Dockerfile` is what Render runs. The first stage builds the page (`npm ci` and `npm run build` in `frontend/`). The second installs `requirements.txt` and runs:

```bash
uvicorn server:app --host 0.0.0.0 --port $PORT
```

On Render, create a web service from this repo using that Dockerfile. Set `OPENAI_API_KEY`, `ACCESS_CODE`, and `MEALDB_API_KEY`. Render sets `PORT`. The OpenAI key stays on the server. It is not in the page or in API responses.

`docker build` and `docker run` were not run here: Docker is not installed on this machine.

## Tests

```bash
.venv/bin/python -m unittest discover -s backend/tests -t .
cd frontend && npm test
```
