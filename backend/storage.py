"""Filesystem locations used by the API.

Importing this module is deliberately side-effect free.  Writable directories
are created during application startup or immediately before a standalone
storage operation.
"""
import os
from pathlib import Path


UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
PRIVATE_DOC_DIR = UPLOAD_DIR / "documents"


def ensure_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_storage_directories() -> None:
    for path in (UPLOAD_DIR, PUBLIC_UPLOAD_DIR, PRIVATE_DOC_DIR):
        ensure_directory(path)
