# One image for production: FastAPI serves the API *and* the built React app.
#
#   docker build -t studyflow .
#   docker run -p 8000:8000 -e DATABASE_URL=... -e JWT_SECRET_KEY=... studyflow

# --- Stage 1: build the frontend -------------------------------------------------------------
# Only this stage has Node and node_modules; the final image gets just the static files.
FROM node:24-alpine AS frontend
WORKDIR /frontend
# Copy the lockfile first: this layer (npm ci) is cached until dependencies actually change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: the runtime --------------------------------------------------------------------
FROM python:3.14-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STATIC_DIR=/app/static

WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY backend/scripts ./scripts
COPY --from=frontend /frontend/dist ./static

# Don't run as root: if the app were ever compromised, the attacker isn't root in the container.
RUN useradd --create-home --uid 10001 studyflow
USER studyflow

# Hosts like Render set $PORT. Migrations run on start-up so a deploy can't run new code against
# an old schema (fine for one instance; with several, run them as a separate release step).
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
