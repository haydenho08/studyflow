"""Write the API's OpenAPI schema to frontend/openapi.json.

The frontend generates its TypeScript types from that file (`npm run gen:api`), so the API
contract has one source of truth: the Pydantic schemas in this backend.

Usage (from backend/):  python -m scripts.export_openapi
"""

import json
from pathlib import Path

from app.main import app

OUTPUT = Path(__file__).resolve().parents[2] / "frontend" / "openapi.json"


def main() -> None:
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
