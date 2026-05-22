#!/usr/bin/env python3
"""Prepare writable runtime directories, then run the API as appuser."""
import os
import pathlib
import pwd
import stat


APP_USER = os.environ.get("APP_USER", "appuser")
UPLOAD_DIR = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
UPLOAD_SUBDIRS = (UPLOAD_DIR, UPLOAD_DIR / "public", UPLOAD_DIR / "documents")


def _log(message: str) -> None:
    print(f"[entrypoint] {message}", flush=True)


def _chown_if_needed(path: pathlib.Path, uid: int, gid: int) -> None:
    try:
        current = path.stat()
        if current.st_uid != uid or current.st_gid != gid:
            os.chown(path, uid, gid)
    except FileNotFoundError:
        return
    except OSError as exc:
        _log(f"could not chown {path}: {exc}")


def _chmod(path: pathlib.Path, mode: int) -> None:
    try:
        current_mode = stat.S_IMODE(path.stat().st_mode)
        if current_mode != mode:
            os.chmod(path, mode)
    except FileNotFoundError:
        return
    except OSError as exc:
        _log(f"could not chmod {path}: {exc}")


def prepare_upload_volume(uid: int, gid: int) -> None:
    for directory in UPLOAD_SUBDIRS:
        directory.mkdir(parents=True, exist_ok=True)

    for root, dirs, files in os.walk(UPLOAD_DIR):
        root_path = pathlib.Path(root)
        _chown_if_needed(root_path, uid, gid)
        _chmod(root_path, 0o750)
        for name in dirs:
            path = root_path / name
            _chown_if_needed(path, uid, gid)
            _chmod(path, 0o750)
        for name in files:
            path = root_path / name
            _chown_if_needed(path, uid, gid)
            _chmod(path, 0o640)


def drop_privileges(user: pwd.struct_passwd) -> None:
    if os.getuid() != 0:
        return
    os.initgroups(user.pw_name, user.pw_gid)
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)
    os.environ["HOME"] = user.pw_dir


def assert_upload_writable() -> None:
    for directory in UPLOAD_SUBDIRS:
        directory.mkdir(parents=True, exist_ok=True)
        probe = directory / ".tls-write-test"
        try:
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        except OSError as exc:
            raise RuntimeError(f"Upload path is not writable: {directory} ({exc})") from exc


def main() -> None:
    try:
        user = pwd.getpwnam(APP_USER)
    except KeyError as exc:
        raise SystemExit(f"App user does not exist: {APP_USER}") from exc

    if os.getuid() == 0:
        _log(f"preparing upload volume {UPLOAD_DIR} for {APP_USER}")
        prepare_upload_volume(user.pw_uid, user.pw_gid)

    drop_privileges(user)
    assert_upload_writable()
    _log("upload volume writable; starting backend")

    port = os.environ.get("PORT", "8001")
    os.execvp("uvicorn", ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", port])


if __name__ == "__main__":
    main()
