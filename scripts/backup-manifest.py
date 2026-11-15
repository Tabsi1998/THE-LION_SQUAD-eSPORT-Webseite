#!/usr/bin/env python3
"""Manifest eines Backup-Paares bauen und prüfen (#1009, #1010).

Ein Backup ist ein **Paar**: verschlüsselter Mongo-Dump und verschlüsseltes Upload-Archiv, entstanden in derselben
Schreibpause. Das Manifest (``tls_backup_<zeit>.manifest.json``) hält fest, was zusammengehört: Paar-ID, Projekt,
Datenbank, Zeitpunkt, Versionen, SHA-256 beider Dateien, Sammlungen mit Anzahl, fachliche Summen und den
Upload-Bestand. ``scripts/restore-check.sh`` und ``scripts/restore.sh`` prüfen vor jeder Änderung gegen genau diesen
Vertrag (``verify``, ``compat``, ``extras``) und nach dem Restore das Ergebnis (``compare``).

Befehle (nur Standardbibliothek, läuft am Host)::

    tar-digest                    Upload-Archiv (tar.gz) von stdin lesen: Anzahl, Bytes, Fingerabdruck
    compose-project               Projektname aus ``docker compose config --format json`` (stdin)
    build    --out ...            Manifest schreiben
    verify   --manifest M ...     Manifest, Dateinamen, Prüfsummen, Projekt und Datenbank prüfen
    compat   --manifest M --target T.json   Versionen gegen das Ziel prüfen
    extras   --manifest M --target-collections C.json   Sammlungen im Ziel, die das Backup nicht kennt
    compare  --manifest M --after S.json    Bestand nach dem Restore gegen das Manifest
    field    --manifest M --name N          ein Feld ausgeben (für die Skripte)

Rückgabewert 0: in Ordnung, 1: abgelehnt (Grund auf stderr), 2: falscher Aufruf.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

FORMAT = "tls-backup-manifest"
FORMAT_VERSION = 2
# Betriebsdaten ohne Fachinhalt: der Zustand der Schreibpause (#1009). Ein Backup von vor der Pause kennt sie nicht, ein
# frisches Ziel vielleicht auch nicht - weder fehlend noch zusätzlich ist das ein Grund, den Restore aufzuhalten.
OPERATIONAL_COLLECTIONS = frozenset({"ops_maintenance"})
ROOT = Path(__file__).resolve().parents[1]
# Fingerabdruck der Uploads: dieselbe Funktion wie im Backend (services/backup_inventory.py), damit Archiv und Ordner
# nach dem Restore gleich gerechnet werden.
_spec = importlib.util.spec_from_file_location("tls_backup_inventory", ROOT / "backend" / "services" / "backup_inventory.py")
inventory = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(inventory)


class Rejected(Exception):
    """Ein Grund, nicht wiederherzustellen. Der Text ist für den Menschen am Server."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tar_digest(stream) -> dict:
    """Anzahl, Bytes und Fingerabdruck der Dateien eines tar.gz-Stroms. Ein kaputtes Archiv wirft ``tarfile.TarError``."""
    entries = []
    with tarfile.open(fileobj=stream, mode="r|gz") as archive:
        for member in archive:
            if member.isreg():
                entries.append((member.name, member.size))
    return inventory.digest_entries(entries)


def _load(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def major(version: str) -> int | None:
    head = str(version or "").split(".", 1)[0]
    return int(head) if head.isdigit() else None


# ---------------------------------------------------------------------------------------------------------------------
# Bauen
# ---------------------------------------------------------------------------------------------------------------------

def _unstable(before: dict, after: dict) -> list[str]:
    """Was sich zwischen den beiden Zählungen in der Pause geändert hat - dort hat trotz Pause jemand geschrieben."""
    names = set(before) | set(after)
    return sorted(name for name in names if before.get(name) != after.get(name))


def build_manifest(*, project: str, db_name: str, timestamp: str, pair_id: str, mongo_path: Path, uploads_path: Path,
                   app_version: str, git_commit: str, before: dict, after: dict, uploads: dict, pause: dict,
                   retention_days: int, created_at: datetime | None = None) -> dict:
    if not project or not db_name or not pair_id:
        raise Rejected("Projekt, Datenbank und Paar-ID sind Pflicht.")
    manifest = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "pair_id": pair_id,
        "project": project,
        "db_name": db_name,
        "timestamp": timestamp,
        "created_at": (created_at or datetime.now(timezone.utc)).isoformat(timespec="seconds"),
        "app_version": app_version or "unknown",
        "git_commit": git_commit or "unknown",
        "mongo_version": before.get("mongo_version") or "",
        "schema_version": int(before.get("schema_version") or 0),
        "code_schema_version": int(before.get("code_schema_version") or 0),
        "files": {
            "mongo": {"name": mongo_path.name, "sha256": sha256_file(mongo_path), "bytes": mongo_path.stat().st_size},
            "uploads": {"name": uploads_path.name, "sha256": sha256_file(uploads_path), "bytes": uploads_path.stat().st_size},
        },
        "collections": before.get("collections") or {},
        "unstable_collections": _unstable(before.get("collections") or {}, after.get("collections") or {}),
        # Mit TTL-Index: MongoDB löscht abgelaufene Einträge selbst, auch direkt nach dem Restore.
        "ttl_collections": sorted(before.get("ttl_collections") or []),
        "figures": before.get("figures") or {},
        "unstable_figures": _unstable(before.get("figures") or {}, after.get("figures") or {}),
        # Was im Archiv steht (aus dem Archiv gerechnet) - nicht, was im Ordner lag.
        "uploads": {key: uploads[key] for key in ("count", "bytes", "digest")},
        "write_pause": pause,
        "retention_days": int(retention_days),
    }
    if "references" in after:
        manifest["references"] = {key: after["references"][key] for key in ("referenced_files", "missing")}
    return manifest


# ---------------------------------------------------------------------------------------------------------------------
# Prüfen vor der ersten Änderung
# ---------------------------------------------------------------------------------------------------------------------

def _which_pair(path: Path, directory: Path) -> str:
    """Zu welchem anderen Manifest im Ordner diese Datei passt - für eine verständliche Meldung."""
    try:
        wanted = sha256_file(path)
    except OSError:
        return ""
    for other in sorted(directory.glob("tls_backup_*.manifest.json")):
        try:
            data = _load(other)
        except (OSError, ValueError):
            continue
        for entry in (data.get("files") or {}).values():
            if isinstance(entry, dict) and entry.get("sha256") == wanted:
                return f" Sie gehört zum Paar {data.get('pair_id', '?')} vom {data.get('timestamp', '?')} ({other.name})."
    return ""


def verify(manifest: dict, manifest_path: Path, *, mongo: Path | None, uploads: Path | None, project: str, db_name: str,
           allow_project: str = "") -> dict:
    """Manifest, Dateien und Ziel passen zusammen - sonst ``Rejected``. Liefert die geprüften Dateipfade."""
    if manifest.get("format") != FORMAT:
        raise Rejected("Das ist kein Backup-Manifest dieses Projekts.")
    if manifest.get("format_version") != FORMAT_VERSION:
        raise Rejected(f"Manifest-Version {manifest.get('format_version')!r} wird nicht unterstützt (erwartet {FORMAT_VERSION}).")
    for key in ("pair_id", "project", "db_name", "timestamp", "files", "collections", "uploads"):
        if not manifest.get(key):
            raise Rejected(f"Das Manifest ist unvollständig: „{key}“ fehlt.")
    files = manifest["files"]
    directory = manifest_path.parent
    checked = {}
    for role, given, label in (("mongo", mongo, "Datenbank-Archiv"), ("uploads", uploads, "Upload-Archiv")):
        entry = files.get(role) or {}
        name = str(entry.get("name") or "")
        expected = str(entry.get("sha256") or "")
        if not name or len(expected) != 64 or os.path.basename(name) != name:
            raise Rejected(f"Das Manifest nennt kein gültiges {label}.")
        path = given if given is not None else directory / name
        if not path.is_file():
            raise Rejected(f"{label} fehlt: {path}")
        if path.name != name:
            raise Rejected(f"{label} {path.name} ist nicht das aus dem Manifest ({name}) - anderes Paar?{_which_pair(path, directory)}")
        actual = sha256_file(path)
        if actual != expected:
            raise Rejected(f"Prüfsumme von {label} {path.name} stimmt nicht (verändert, unvollständig oder anderes Paar)."
                           f"{_which_pair(path, directory)}")
        checked[role] = str(path)
    if manifest["db_name"] != db_name:
        raise Rejected(f"Das Backup ist von der Datenbank „{manifest['db_name']}“, das Ziel ist „{db_name}“.")
    if manifest["project"] != project and manifest["project"] != allow_project:
        raise Rejected(f"Das Backup ist vom Projekt „{manifest['project']}“, das Ziel ist „{project}“. Nur wenn das "
                       f"wirklich gewollt ist: RESTORE_ALLOW_FOREIGN_PROJECT={manifest['project']}")
    return checked


def verify_legacy(text: str, manifest_path: Path, *, mongo: Path, uploads: Path, db_name: str) -> dict:
    """Altes Manifest (``.manifest.txt``, vor #1010): nur Dateinamen, Datenbank und Prüfsummen. Projekt, Versionen und
    Bestand stehen nicht darin - der Restore verlangt dafür ausdrücklich ``RESTORE_ALLOW_LEGACY_MANIFEST=true``."""
    fields, sums = {}, {}
    for line in text.splitlines():
        if "=" in line and not line.startswith(" "):
            key, _sep, value = line.partition("=")
            fields[key.strip()] = value.strip()
            continue
        parts = line.split(None, 1)
        if len(parts) == 2 and len(parts[0]) == 64:
            sums[os.path.basename(parts[1].strip().lstrip("*"))] = parts[0].lower()
    checked = {}
    for role, path, label in (("mongo_file", mongo, "Datenbank-Archiv"), ("uploads_file", uploads, "Upload-Archiv")):
        name = fields.get(role, "")
        if not name or path.name != name:
            raise Rejected(f"{label} {path.name} ist nicht das aus dem Manifest ({name or 'fehlt'}).")
        if not path.is_file():
            raise Rejected(f"{label} fehlt: {path}")
        if name not in sums:
            raise Rejected(f"Das alte Manifest hat keine Prüfsumme für {name}.")
        if sha256_file(path) != sums[name]:
            raise Rejected(f"Prüfsumme von {label} {name} stimmt nicht.")
        checked[role.split("_")[0]] = str(path)
    if fields.get("db_name") != db_name:
        raise Rejected(f"Das Backup ist von der Datenbank „{fields.get('db_name')}“, das Ziel ist „{db_name}“.")
    return checked


def compat(manifest: dict, target: dict, *, allow_version_mismatch: bool = False) -> list[str]:
    """Versionen: ein Backup, das neuer ist als der laufende Code oder die Ziel-Datenbank, wird abgewiesen.
    Liefert Hinweise, die den Restore nicht aufhalten."""
    problems, notes = [], []
    code_schema = target.get("code_schema_version")
    backup_schema = int(manifest.get("schema_version") or 0)
    if not isinstance(code_schema, int):
        problems.append("Der Stand des Codes am Ziel ist unbekannt (höchste Migration).")
    elif backup_schema > code_schema:
        problems.append(f"Das Backup hat Migration {backup_schema}, der Code am Ziel kennt nur bis {code_schema} - "
                        "erst den passenden Code (Commit "
                        f"{manifest.get('git_commit', '?')}, Version {manifest.get('app_version', '?')}) einspielen.")
    elif backup_schema < code_schema:
        notes.append(f"Backup mit Migration {backup_schema}, Code bei {code_schema}: der Start holt die Migrationen nach.")
    backup_major, target_major = major(manifest.get("mongo_version", "")), major(target.get("mongo_version", ""))
    if backup_major is None or target_major is None:
        problems.append("Die MongoDB-Version von Backup oder Ziel ist unbekannt.")
    elif backup_major > target_major:
        problems.append(f"Das Backup kommt von MongoDB {manifest.get('mongo_version')}, das Ziel hat {target.get('mongo_version')}.")
    if problems and not allow_version_mismatch:
        raise Rejected(" ".join(problems) + " Nur bewusst übergehen: RESTORE_ALLOW_VERSION_MISMATCH=true")
    return notes + [f"Übergangen: {text}" for text in problems]


def extras(manifest: dict, target_collections: list[str]) -> list[str]:
    """Sammlungen im Ziel, die nicht im Backup stehen. ``mongorestore --drop`` lässt sie stehen."""
    known = set(manifest.get("collections") or {})
    return sorted(name for name in target_collections
                  if name not in known and not name.startswith("system.") and name not in OPERATIONAL_COLLECTIONS)


# ---------------------------------------------------------------------------------------------------------------------
# Prüfen nach dem Restore
# ---------------------------------------------------------------------------------------------------------------------

def compare(manifest: dict, after: dict, *, kept_extras: list[str] | tuple[str, ...] = ()) -> tuple[list[str], list[str]]:
    """Abweichungen (Fehler) und Hinweise zwischen Manifest und wiederhergestelltem Ziel."""
    errors, notes = [], []
    want, have = manifest.get("collections") or {}, dict(after.get("collections") or {})
    unstable = set(manifest.get("unstable_collections") or [])
    for name in (*kept_extras, *OPERATIONAL_COLLECTIONS):
        have.pop(name, None)
    want = {name: count for name, count in want.items() if name not in OPERATIONAL_COLLECTIONS}
    missing = sorted(set(want) - set(have))
    surplus = sorted(set(have) - set(want))
    if missing:
        errors.append("Sammlungen fehlen nach dem Restore: " + ", ".join(missing))
    if surplus:
        errors.append("Sammlungen zu viel nach dem Restore: " + ", ".join(surplus))
    expiring = set(manifest.get("ttl_collections") or [])
    for name in sorted(set(want) & set(have)):
        if want[name] == have[name]:
            continue
        text = f"{name}: {have[name]} statt {want[name]} Dokumente"
        if name in unstable:
            notes.append(text + " (in der Pause verändert)")
        elif name in expiring and have[name] < want[name]:
            notes.append(text + " (abgelaufene Einträge, TTL)")
        else:
            errors.append(text)
    unstable_figures = set(manifest.get("unstable_figures") or [])
    for name, expected in sorted((manifest.get("figures") or {}).items()):
        actual = (after.get("figures") or {}).get(name)
        if actual != expected:
            text = f"Summen {name}: {json.dumps(actual, ensure_ascii=False)} statt {json.dumps(expected, ensure_ascii=False)}"
            (notes if name in unstable_figures else errors).append(text)
    uploads_want, uploads_have = manifest.get("uploads") or {}, after.get("uploads") or {}
    if uploads_want.get("digest") != uploads_have.get("digest"):
        errors.append(f"Uploads: {uploads_have.get('count')} Dateien / {uploads_have.get('bytes')} Bytes statt "
                      f"{uploads_want.get('count')} / {uploads_want.get('bytes')} (Fingerabdruck weicht ab)")
    refs_want, refs_have = manifest.get("references"), after.get("references")
    if refs_want and refs_have:
        if refs_have.get("missing", 0) > refs_want.get("missing", 0):
            errors.append(f"Datei-Verweise: {refs_have.get('missing')} fehlende Dateien statt {refs_want.get('missing')}")
        if refs_have.get("referenced_files") != refs_want.get("referenced_files"):
            errors.append(f"Datei-Verweise: {refs_have.get('referenced_files')} genannte Dateien statt {refs_want.get('referenced_files')}")
    return errors, notes


# ---------------------------------------------------------------------------------------------------------------------
# Kommandozeile
# ---------------------------------------------------------------------------------------------------------------------

def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("tar-digest")
    sub.add_parser("compose-project")
    build = sub.add_parser("build")
    for name in ("out", "project", "db", "timestamp", "pair-id", "mongo-file", "uploads-file", "app-version", "git-commit",
                 "before", "after", "uploads-listing", "pause"):
        build.add_argument(f"--{name}", required=True)
    build.add_argument("--retention-days", type=int, default=14)
    check = sub.add_parser("verify")
    check.add_argument("--manifest", required=True)
    check.add_argument("--mongo", default="")
    check.add_argument("--uploads", default="")
    check.add_argument("--project", required=True)
    check.add_argument("--db", required=True)
    check.add_argument("--allow-project", default="")
    legacy = sub.add_parser("verify-legacy")
    legacy.add_argument("--manifest", required=True)
    legacy.add_argument("--mongo", required=True)
    legacy.add_argument("--uploads", required=True)
    legacy.add_argument("--db", required=True)
    versions = sub.add_parser("compat")
    versions.add_argument("--manifest", required=True)
    versions.add_argument("--target", required=True)
    versions.add_argument("--allow-version-mismatch", action="store_true")
    extra = sub.add_parser("extras")
    extra.add_argument("--manifest", required=True)
    extra.add_argument("--target-collections", required=True)
    after = sub.add_parser("compare")
    after.add_argument("--manifest", required=True)
    after.add_argument("--after", required=True)
    after.add_argument("--kept-extras", default="", help="Sammlungen, die bewusst stehen blieben (mit Komma)")
    field = sub.add_parser("field")
    field.add_argument("--manifest", required=True)
    field.add_argument("--name", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "tar-digest":
            try:
                print(json.dumps(tar_digest(sys.stdin.buffer)))
            except (tarfile.TarError, OSError, EOFError):
                raise Rejected("Das Upload-Archiv ist kein lesbares tar.gz.")
            return 0
        if args.command == "compose-project":
            # Die Compose-Konfiguration enthält Geheimnisse: nur den Namen ausgeben, nie den Inhalt.
            try:
                name = json.load(sys.stdin).get("name")
            except (ValueError, AttributeError):
                name = None
            if not isinstance(name, str) or not name:
                raise Rejected("Der Projektname der Compose-Konfiguration ist nicht lesbar.")
            print(name)
            return 0
        if args.command == "build":
            manifest = build_manifest(
                project=args.project, db_name=args.db, timestamp=args.timestamp, pair_id=args.pair_id,
                mongo_path=Path(args.mongo_file), uploads_path=Path(args.uploads_file), app_version=args.app_version,
                git_commit=args.git_commit, before=_load(args.before), after=_load(args.after),
                uploads=_load(args.uploads_listing), pause=_load(args.pause), retention_days=args.retention_days)
            Path(args.out).write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            return 0
        manifest_path = Path(args.manifest)
        if args.command == "verify-legacy":
            try:
                text = manifest_path.read_text(encoding="utf-8")
            except OSError:
                raise Rejected(f"Manifest nicht lesbar: {manifest_path}")
            print(json.dumps(verify_legacy(text, manifest_path, mongo=Path(args.mongo), uploads=Path(args.uploads), db_name=args.db)))
            return 0
        try:
            manifest = _load(manifest_path)
        except (OSError, ValueError):
            raise Rejected(f"Manifest nicht lesbar: {manifest_path}")
        if not isinstance(manifest, dict):
            raise Rejected(f"Manifest nicht lesbar: {manifest_path}")
        if args.command == "verify":
            checked = verify(manifest, manifest_path, mongo=Path(args.mongo) if args.mongo else None,
                             uploads=Path(args.uploads) if args.uploads else None, project=args.project, db_name=args.db,
                             allow_project=args.allow_project)
            print(json.dumps(checked))
            return 0
        if args.command == "compat":
            for note in compat(manifest, _load(args.target), allow_version_mismatch=args.allow_version_mismatch):
                print(note)
            return 0
        if args.command == "extras":
            for name in extras(manifest, _load(args.target_collections)):
                print(name)
            return 0
        if args.command == "compare":
            kept = [part.strip() for part in args.kept_extras.split(",") if part.strip()]
            errors, notes = compare(manifest, _load(args.after), kept_extras=kept)
            for note in notes:
                print(f"Hinweis: {note}")
            if errors:
                raise Rejected("Der wiederhergestellte Stand weicht vom Backup ab: " + "; ".join(errors))
            return 0
        value = manifest
        for part in args.name.split("."):
            value = value.get(part) if isinstance(value, dict) else None
        if value is None:
            raise Rejected(f"Das Manifest hat kein Feld „{args.name}“.")
        print(value if isinstance(value, (str, int, float)) else json.dumps(value, ensure_ascii=False))
        return 0
    except Rejected as rejected:
        print(str(rejected), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
