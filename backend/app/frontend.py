"""Serve the built React app (frontend/dist) from FastAPI, so production is one container, one URL.

Same origin for the UI and the API means no CORS and no API host baked into the frontend build.
"""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException


class ImmutableStaticFiles(StaticFiles):
    """Vite puts a content hash in every asset filename (index-BoGGLlR-.js), so a given URL's
    contents never change: browsers may cache them for a year. A new build means new URLs."""

    def file_response(self, *args, **kwargs) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def mount_frontend(app: FastAPI, static_dir: Path) -> None:
    index = static_dir / "index.html"
    app.mount("/assets", ImmutableStaticFiles(directory=static_dir / "assets"), name="assets")

    @app.exception_handler(StarletteHTTPException)
    async def spa_fallback(request: Request, exc: StarletteHTTPException) -> Response:
        """Client-side routing: /calendar, /stats?week=… aren't files or API routes, so they 404
        here; for page navigations, answer with index.html and let React Router render them.

        API paths keep their JSON errors, and a missing /assets file stays a real 404 (serving
        HTML in place of a script would only produce a confusing error in the browser).
        """
        path = request.url.path
        is_page = not (path == "/api" or path.startswith(("/api/", "/assets/")))
        if exc.status_code == 404 and request.method == "GET" and is_page:
            # no-cache: always check for a new index.html, which points at the newest assets.
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return await http_exception_handler(request, exc)
