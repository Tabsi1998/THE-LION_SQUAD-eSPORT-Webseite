"""GitHub-Releases der App von selbst abgleichen (#309).

Das Release-Skript legt die APK nach ``gh release create`` am Server ab - ein zweiter Weg, der
scheitern kann und dann Handarbeit braucht. Jetzt holt der Server sich die Releases selbst: alle
zehn Minuten ``GET /repos/…/releases``; jedes ``mobile-v<version>-build<N>``, das am Server fehlt,
wird als Asset geladen, gegen die ``.sha256``-Datei des Releases geprüft und wie ein Upload
gespeichert (``app_releases.store_release``). Pre-Release auf GitHub = Beta, Release = Release; ob
eine Beta gleich als aktuelles Release gilt, ist ein Schalter des Betreibers. Das Token (nur Lesen)
liegt verschlüsselt in den Einstellungen - nie im Repo, nie in einer Antwort.
"""
from __future__ import annotations

import logging
import re
from typing import AsyncIterator

import httpx

from models import now_utc
from services import app_releases
from services.secret_store import decrypt_secret, encrypt_secret, secret_is_configured

logger = logging.getLogger("tls.github_releases")

API = "https://api.github.com"
DEFAULT_REPO = "Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite"
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
TAG_RE = re.compile(r"^mobile-v(?P<version>\d+\.\d+\.\d+(?:-beta)?)-build(?P<build>[1-9]\d*)$")
SYNC_INTERVAL_MINUTES = 10
USER_AGENT = "lionsquad-website/1.0 (+https://lionsquad.at)"
TIMEOUT = 120
SETTINGS_ID = app_releases.SETTINGS_ID
_transport = None   # Tests hängen hier einen MockTransport ein


def parse_tag(tag: object) -> tuple[str, int] | None:
    """``mobile-v0.9.0-beta-build77`` → ``("0.9.0-beta", 77)``; alles andere ist kein App-Release."""
    match = TAG_RE.match(str(tag or "").strip())
    return (match.group("version"), int(match.group("build"))) if match else None


def _client(token: str) -> httpx.AsyncClient:
    # follow_redirects: das Asset kommt über eine signierte Adresse; httpx lässt die Authorization dabei
    # nicht auf den fremden Host mitgehen.
    return httpx.AsyncClient(timeout=TIMEOUT, transport=_transport, follow_redirects=True, headers={
        "User-Agent": USER_AGENT, "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })


async def _raw(db) -> dict:
    return await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}


def _token_state(raw: dict) -> str:
    value = raw.get("github_token")
    if not secret_is_configured(value):
        return "missing"
    try:
        decrypt_secret(value)
    except RuntimeError:
        return "unreadable"
    return "ok"


def public_settings(raw: dict) -> dict:
    """Die Einstellungen ohne das Token."""
    state = _token_state(raw)
    return {
        "github_repo": str(raw.get("github_repo") or DEFAULT_REPO),
        "github_sync_enabled": raw.get("github_sync_enabled", True) is not False,
        # Betas gleich ausrollen: Standard an - solange die App als Beta läuft, wäre der Abgleich sonst stumm.
        "github_rollout_betas": raw.get("github_rollout_betas", True) is not False,
        "github_token_configured": state != "missing",
        "github_token_unreadable": state == "unreadable",
        "github_last_checked_at": raw.get("github_last_checked_at"),
        "github_last_release": raw.get("github_last_release"),
        "github_last_error": raw.get("github_last_error"),
        "github_last_result": raw.get("github_last_result"),
        "sync_interval_minutes": SYNC_INTERVAL_MINUTES,
    }


async def settings(db) -> dict:
    return public_settings(await _raw(db))


async def save_settings(db, *, by: str | None = None, github_token: str | None = None, clear_github_token: bool = False,
                        github_repo: str | None = None, github_sync_enabled: bool | None = None,
                        github_rollout_betas: bool | None = None) -> dict:
    updates: dict = {"updated_at": now_utc().isoformat(), "updated_by": by}
    unset: dict = {}
    if clear_github_token:
        unset["github_token"] = ""
    elif github_token is not None and github_token.strip():
        updates["github_token"] = encrypt_secret(github_token.strip())
    if github_repo is not None:
        repo = github_repo.strip()
        if repo and not REPO_RE.match(repo):
            raise ValueError("Repository bitte als owner/name angeben, z. B. Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite.")
        updates["github_repo"] = repo or DEFAULT_REPO
    if github_sync_enabled is not None:
        updates["github_sync_enabled"] = bool(github_sync_enabled)
    if github_rollout_betas is not None:
        updates["github_rollout_betas"] = bool(github_rollout_betas)
    operation: dict = {"$set": updates, "$setOnInsert": {"id": SETTINGS_ID}}
    if unset:
        operation["$unset"] = unset
    await db.settings.update_one({"id": SETTINGS_ID}, operation, upsert=True)
    return await settings(db)


async def _record(db, **fields) -> None:
    await db.settings.update_one(
        {"id": SETTINGS_ID},
        {"$set": {**fields, "github_last_checked_at": now_utc().isoformat()}, "$setOnInsert": {"id": SETTINGS_ID}},
        upsert=True,
    )


def _sha_from_text(text: object) -> str:
    """Die 64 Hex-Zeichen aus einer .sha256-Datei (``<sha>  <datei>``)."""
    for token in str(text or "").split():
        if re.fullmatch(r"[0-9a-fA-F]{64}", token):
            return token.lower()
    return ""


async def _asset_chunks(client: httpx.AsyncClient, url: str) -> AsyncIterator[bytes]:
    async with client.stream("GET", url, headers={"Accept": "application/octet-stream"}) as response:
        if response.status_code != 200:
            raise RuntimeError(f"Asset HTTP {response.status_code}")
        async for chunk in response.aiter_bytes():
            yield chunk


async def sync(db, *, force: bool = False, limit: int = 10) -> dict:
    """Ein Abgleich: neue ``mobile-v*``-Releases holen, prüfen, speichern. Liefert, was passiert ist,
    und hält Stand und Fehler in den Einstellungen fest (für den Kasten im Admin)."""
    raw = await _raw(db)
    cfg = public_settings(raw)
    if not cfg["github_sync_enabled"] and not force:
        return {"skipped": "aus", "imported": [], "errors": []}
    state = _token_state(raw)
    if state != "ok":
        reason = ("kein GitHub-Token hinterlegt" if state == "missing"
                  else "GitHub-Token gespeichert, aber mit dem aktuellen SETTINGS_ENCRYPTION_KEY nicht lesbar")
        await _record(db, github_last_error=reason, github_last_result={"imported": [], "seen": 0, "errors": [reason]})
        return {"skipped": reason, "imported": [], "errors": [reason]}
    token = decrypt_secret(raw["github_token"])
    repo = cfg["github_repo"]
    imported: list[dict] = []
    errors: list[str] = []
    releases: list[dict] = []
    latest_tag = ""
    try:
        async with _client(token) as client:
            response = await client.get(f"{API}/repos/{repo}/releases", params={"per_page": 30})
            if response.status_code != 200:
                detail = ""
                try:
                    detail = str((response.json() or {}).get("message") or "")
                except ValueError:
                    pass
                reason = f"GitHub antwortet HTTP {response.status_code}" + (f": {detail}" if detail else "")
                await _record(db, github_last_error=reason)
                return {"error": reason, "imported": [], "errors": [reason]}
            body = response.json()
            releases = body if isinstance(body, list) else []
            known = {int(row["build"]) for row in await db.app_releases.find({}, {"_id": 0, "build": 1}).to_list(1000) if row.get("build")}
            candidates = []
            for release in releases:
                parsed = parse_tag(release.get("tag_name"))
                if not parsed or release.get("draft"):
                    continue
                version, build = parsed
                if not latest_tag:
                    latest_tag = str(release.get("tag_name"))   # GitHub liefert das neueste zuerst
                if build in known:
                    continue
                candidates.append((build, version, release))
            candidates.sort(key=lambda row: row[0])
            highest_known = max(known) if known else 0
            for build, version, release in candidates[:limit]:
                tag = str(release.get("tag_name"))
                assets = release.get("assets") or []
                apk = next((a for a in assets if str(a.get("name") or "").lower().endswith(".apk")), None)
                if not apk:
                    errors.append(f"{tag}: keine APK im Release")
                    continue
                sha_asset = next((a for a in assets if str(a.get("name") or "").lower().endswith(".sha256")), None)
                expected = ""
                if sha_asset:
                    sha_response = await client.get(str(sha_asset.get("url")), headers={"Accept": "application/octet-stream"})
                    expected = _sha_from_text(sha_response.text) if sha_response.status_code == 200 else ""
                prerelease = bool(release.get("prerelease"))
                channel = app_releases.channel_of(version, prerelease)
                # Als aktuell nur, wenn es das höchste Build ist - und bei einer Beta nur mit dem Schalter.
                set_current = build >= highest_known and (channel == "release" or cfg["github_rollout_betas"])
                try:
                    # Erst speichern, dann prüfen, erst dann als aktuell setzen - sonst nähme ein Release mit falscher
                    # Prüfsumme dem bisherigen das Häkchen weg und stünde selbst nicht mehr da.
                    stored = await app_releases.store_release(
                        db, build=build, version=version, notes=str(release.get("body") or ""),
                        chunks=_asset_chunks(client, str(apk.get("url"))), set_current=False, source="github",
                    )
                except (ValueError, RuntimeError, httpx.HTTPError) as exc:
                    errors.append(f"{tag}: {exc}")
                    continue
                if expected and stored.get("sha256") != expected:
                    await app_releases.delete_release(db, build)
                    errors.append(f"{tag}: Prüfsumme passt nicht zur .sha256-Datei des Releases – nicht übernommen")
                    continue
                if set_current:
                    await app_releases.update_release(db, build, is_current=True)
                await db.app_releases.update_one({"build": build}, {"$set": {
                    "channel": channel, "prerelease": prerelease, "github_tag": tag, "github_url": release.get("html_url"),
                    "github_published_at": release.get("published_at"),
                }})
                known.add(build)
                highest_known = max(highest_known, build)
                imported.append({"build": build, "version": version, "channel": channel, "is_current": set_current, "checked": bool(expected)})
                logger.info("[github_releases] %s übernommen (%s, aktuell=%s)", tag, channel, set_current)
    except httpx.HTTPError as exc:
        reason = f"GitHub nicht erreichbar ({type(exc).__name__})"
        await _record(db, github_last_error=reason)
        return {"error": reason, "imported": imported, "errors": errors + [reason]}
    result = {"imported": imported, "seen": len(releases), "errors": errors}
    await _record(db, github_last_error=("; ".join(errors) if errors else None),
                  github_last_release=latest_tag or raw.get("github_last_release"), github_last_result=result)
    return result
