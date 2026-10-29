from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.frontend import mount_frontend
from app.routers import assignments, auth, calendar, courses, stats, study_sessions


def create_app(static_dir: Path | None = None) -> FastAPI:
    settings = get_settings()
    static_dir = static_dir or settings.static_dir
    app = FastAPI(
        title="StudyFlow API",
        version="0.1.0",
        description="Courses, assignments and study tracking for students.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    api.include_router(auth.router)
    api.include_router(courses.router)
    api.include_router(assignments.router)
    api.include_router(study_sessions.router)
    api.include_router(stats.router)
    api.include_router(calendar.router)
    app.include_router(api)

    # In production the container ships the built frontend; in development Vite serves it.
    if static_dir is not None and (static_dir / "index.html").is_file():
        mount_frontend(app, static_dir)
    return app


app = create_app()
