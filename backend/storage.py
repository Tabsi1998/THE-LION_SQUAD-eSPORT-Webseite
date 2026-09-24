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
# Chat-Anhänge: nie öffentlich, ausgeliefert nur über /api/chat-attachments.
PRIVATE_CHAT_DIR = UPLOAD_DIR / "chat"
# App-Releases (#250): APKs für angemeldete Nutzer über /api/mobile/app-download.
APP_RELEASE_DIR = UPLOAD_DIR / "app-releases"
# Bildprüfung (#415): entfernte Originale - nur die Moderation sieht sie, nach 90 Tagen weg.
QUARANTINE_DIR = UPLOAD_DIR / "quarantine"


def ensure_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_storage_directories() -> None:
    for path in (UPLOAD_DIR, PUBLIC_UPLOAD_DIR, PRIVATE_DOC_DIR, PRIVATE_CHAT_DIR, APP_RELEASE_DIR, QUARANTINE_DIR):
        ensure_directory(path)
