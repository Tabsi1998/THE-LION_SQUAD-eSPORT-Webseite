"""App-Releases am Vereinsserver (#250).

Die LionsAPP wird über GitHub-Releases verteilt, aber das Repo ist privat:
vom Handy aus kommt niemand ohne GitHub-Login an die APK. Deshalb hält der
Server je Build eine Kopie im Upload-Volume (``uploads/app-releases``) und
liefert sie an angemeldete Nutzer. Die App fragt ``/api/mobile/app-version``
und lädt ``/api/mobile/app-download/{build}``.

Hochladen darf der Vereinsadmin (Web) oder das Release-Skript mit dem
Upload-Token aus der Server-Umgebung (``APP_RELEASE_UPLOAD_TOKEN``) - das
Token steht nie im Repo.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
from datetime import timedelta
from pathlib import Path
from typing import Any, AsyncIterator

from models import new_id, now_utc
from storage import APP_RELEASE_DIR
APK_MAGIC = b"PK\x03\x04"
MAX_APK_BYTES = 300 * 1024 * 1024
VERSION_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta)?$")
UPLOAD_TOKEN_ENV = "APP_RELEASE_UPLOAD_TOKEN"
CHECK_INTERVAL_MINUTES = 60


def apk_filename(version: str, build: int) -> str:
    return f"LionsAPP-v{version}-build{int(build)}.apk"


def release_path(build: int) -> Path:
    return APP_RELEASE_DIR / f"build{int(build)}.apk"


def valid_version(version: str) -> bool:
    return bool(VERSION_PATTERN.match(str(version or "").strip()))


def upload_token_status() -> dict:
    """Ob am Server ein brauchbares Token liegt - nur ja/nein und Länge, nie der Wert (#307)."""
    expected = os.environ.get(UPLOAD_TOKEN_ENV, "").strip()
    return {"configured": len(expected) >= 24, "length": len(expected), "min_length": 24, "env": UPLOAD_TOKEN_ENV}


def upload_token_matches(presented: str | None) -> bool:
    """Das Release-Skript weist sich mit dem Token aus der Server-Umgebung aus."""
    expected = os.environ.get(UPLOAD_TOKEN_ENV, "").strip()
    given = (presented or "").strip()
    if len(expected) < 24 or not given:
        return False
    return hmac.compare_digest(expected, given)


def upload_token_problem(presented: str | None) -> str | None:
    """Warum ein mitgeschicktes Token nicht zählt - ohne das Geheimnis zu verraten."""
    if not (presented or "").strip():
        return None
    if not upload_token_status()["configured"]:
        return f"Am Server ist kein {UPLOAD_TOKEN_ENV} hinterlegt (mindestens 24 Zeichen in der .env, docker-compose reicht es durch, danach update.sh)."
    return "Upload-Token stimmt nicht mit dem Server überein."


def update_decision(own_build: int | None, current: dict | None) -> dict:
    """Was die App tun soll: nichts, Update anbieten, oder Update verlangen."""
    if not current:
        return {"update_available": False, "mandatory": False}
    latest = int(current.get("build") or 0)
    minimum = int(current.get("min_build") or 0)
    own = int(own_build or 0)
    available = own > 0 and latest > own
    mandatory = available and minimum > 0 and own < minimum
    return {"update_available": available, "mandatory": mandatory}


def public_release(doc: dict | None) -> dict | None:
    if not doc:
        return None
    build = int(doc.get("build") or 0)
    return {
        "build": build,
        "version": doc.get("version"),
        "notes": doc.get("notes") or "",
        "sha256": doc.get("sha256"),
        "md5": doc.get("md5"),
        "size": int(doc.get("size") or 0),
        "published_at": doc.get("published_at"),
        "min_build": int(doc.get("min_build") or 0) or None,
        "is_current": bool(doc.get("is_current")),
        "filename": apk_filename(doc.get("version") or "0.0.0", build),
        "download_url": f"/api/mobile/app-download/{build}",
    }


async def store_release(db, *, build: int, version: str, notes: str, chunks: AsyncIterator[bytes],
                        min_build: int | None = None, set_current: bool = True, source: str = "admin") -> dict:
    """Die APK stückweise auf die Platte schreiben, dabei Prüfsumme und Größe rechnen."""
    build = int(build)
    if build <= 0:
        raise ValueError("Build muss eine positive Zahl sein.")
    version = str(version or "").strip()
    if not valid_version(version):
        raise ValueError("Version passt nicht zum Schema (z. B. 0.5.0-beta).")
    APP_RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    target = release_path(build)
    partial = target.with_suffix(".apk.part")
    digest = hashlib.sha256()
    # MD5 zusätzlich: die App kann eine Datei auf der Platte nur per MD5 prüfen
    # (expo-file-system getInfoAsync), SHA-256 bleibt für Menschen und GitHub.
    md5 = hashlib.md5()
    size = 0
    head = b""
    with partial.open("wb") as handle:
        async for chunk in chunks:
            if not chunk:
                continue
            if len(head) < 4:
                head += chunk[: 4 - len(head)]
            size += len(chunk)
            if size > MAX_APK_BYTES:
                handle.close()
                partial.unlink(missing_ok=True)
                raise ValueError("Die APK ist größer als 300 MB.")
            digest.update(chunk)
            md5.update(chunk)
            handle.write(chunk)
    if size < 1024 or not head.startswith(APK_MAGIC):
        partial.unlink(missing_ok=True)
        raise ValueError("Das ist keine APK-Datei.")
    partial.replace(target)
    now = now_utc()
    doc = {
        "build": build,
        "version": version,
        "notes": (notes or "").strip()[:8000],
        "sha256": digest.hexdigest(),
        "md5": md5.hexdigest(),
        "size": size,
        "storage_key": target.name,
        "published_at": now.isoformat(),
        "source": source,
        "is_current": bool(set_current),
    }
    if min_build is not None:
        doc["min_build"] = int(min_build)
    existing = await db.app_releases.find_one({"build": build}, {"_id": 0, "id": 1, "min_build": 1})
    if existing:
        if min_build is None and existing.get("min_build"):
            doc["min_build"] = int(existing["min_build"])
        await db.app_releases.update_one({"build": build}, {"$set": doc})
    else:
        await db.app_releases.insert_one({"id": new_id(), **doc})
    if set_current:
        await db.app_releases.update_many({"build": {"$ne": build}}, {"$set": {"is_current": False}})
    stored = await db.app_releases.find_one({"build": build}, {"_id": 0})
    return stored or doc


async def current_release(db) -> dict | None:
    doc = await db.app_releases.find_one({"is_current": True}, {"_id": 0}, sort=[("build", -1)])
    if doc:
        return doc
    return await db.app_releases.find_one({}, {"_id": 0}, sort=[("build", -1)])


async def list_releases(db, limit: int = 50) -> list[dict]:
    rows = await db.app_releases.find({}, {"_id": 0}).sort("build", -1).to_list(limit)
    return [public_release(row) for row in rows]


async def update_release(db, build: int, *, min_build: int | None = None, is_current: bool | None = None, notes: str | None = None) -> dict | None:
    updates: dict[str, Any] = {}
    if min_build is not None:
        updates["min_build"] = int(min_build)
    if notes is not None:
        updates["notes"] = str(notes).strip()[:8000]
    if is_current:
        await db.app_releases.update_many({"build": {"$ne": int(build)}}, {"$set": {"is_current": False}})
        updates["is_current"] = True
    elif is_current is False:
        updates["is_current"] = False
    if updates:
        updates["updated_at"] = now_utc().isoformat()
        await db.app_releases.update_one({"build": int(build)}, {"$set": updates})
    return await db.app_releases.find_one({"build": int(build)}, {"_id": 0})


async def delete_release(db, build: int) -> bool:
    doc = await db.app_releases.find_one({"build": int(build)}, {"_id": 0})
    if not doc:
        return False
    await db.app_releases.delete_one({"build": int(build)})
    release_path(int(build)).unlink(missing_ok=True)
    return True


def release_file(doc: dict) -> Path | None:
    key = str(doc.get("storage_key") or "")
    if not key or "/" in key or "\\" in key or ".." in key:
        return None
    path = APP_RELEASE_DIR / key
    return path if path.is_file() else None


def next_check_after() -> str:
    return (now_utc() + timedelta(minutes=CHECK_INTERVAL_MINUTES)).isoformat()


# Server-Updater als Schalter (#421): Play-Installationen bekommen Googles Update-Dialog; die
# Server-APK ist nur für Sideload und den Notfall. Sobald die App öffentlich im Play Store ist,
# schaltet der Betreiber den Server-Updater ab - dann zeigt auch eine Sideload-App nur noch Play.
SETTINGS_ID = "app_releases"


async def updater_settings(db) -> dict:
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    return {"server_updater_enabled": doc.get("server_updater_enabled", True) is not False}


async def set_updater_settings(db, *, server_updater_enabled: bool, by: str | None = None) -> dict:
    await db.settings.update_one(
        {"id": SETTINGS_ID},
        {"$set": {"server_updater_enabled": bool(server_updater_enabled), "updated_at": now_utc().isoformat(), "updated_by": by}},
        upsert=True,
    )
    return await updater_settings(db)
