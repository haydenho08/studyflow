# StudyFlow

A full-stack student productivity app: courses, assignments and deadlines, a Pomodoro study timer with weekly stats, and a calendar week view.

**Stack:** FastAPI · SQLAlchemy 2.0 · Alembic · PostgreSQL 16 (Docker) · React + TypeScript (Vite) · TanStack Query · pytest · Vitest

> Work in progress, built in stages. See [docs/](docs/) for a walkthrough of each stage.

## Running the backend locally

Prerequisites: Python 3.12+, Docker Desktop.

```powershell
# 1. Config and database
Copy-Item .env.example .env
docker compose up -d db

# 2. Python environment
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt

# 3. Schema, tests, server
alembic upgrade head
pytest
uvicorn app.main:app --reload
```

Then open http://localhost:8000/docs.

## Running the frontend locally

Prerequisites: Node.js 24 LTS, and the backend running on port 8000.

```powershell
cd frontend
npm install
npm run dev      # http://localhost:5173 (proxies /api to the backend)
npm test         # unit tests
npm run build    # typecheck + production build
```

After changing backend schemas, regenerate the frontend's API types:

```powershell
cd backend; python -m scripts.export_openapi
cd ../frontend; npm run gen:api
```
