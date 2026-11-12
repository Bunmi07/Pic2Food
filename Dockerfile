# Pic2Food container. The first stage builds the page. The second runs the
# Python server, which serves that page and the /api routes on $PORT.
# Do not set VITE_CANDIDATE_SOURCE here: the production page must call the
# live vision endpoint, not the saved sample list.

FROM node:24-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ backend/
COPY server.py .
COPY --from=frontend /src/frontend/dist frontend/dist
EXPOSE 8000
CMD uvicorn server:app --host 0.0.0.0 --port $PORT
