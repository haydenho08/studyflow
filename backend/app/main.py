from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import assignments, auth, courses, stats, study_sessions


def create_app() -> FastAPI:
    settings = get_settings()
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
    app.include_router(api)
    return app


app = create_app()
