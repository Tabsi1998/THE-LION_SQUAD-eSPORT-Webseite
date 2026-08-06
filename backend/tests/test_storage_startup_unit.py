"""Regression tests for side-effect-free API imports."""
import os
from pathlib import Path
import subprocess
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_importing_api_does_not_create_upload_directory(tmp_path):
    upload_dir = tmp_path / "must-not-exist-during-import"
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "test",
            "MONGO_URL": "mongodb://127.0.0.1:27017",
            "DB_NAME": "tls_import_test",
            "UPLOAD_DIR": str(upload_dir),
            "DISABLE_SCHEDULER": "true",
        }
    )
    script = "\n".join(
        (
            "from pathlib import Path",
            "import os",
            "import routes.upload_routes",
            "import routes.document_routes",
            "import services.image_migrate",
            "import server",
            "path = Path(os.environ['UPLOAD_DIR'])",
            "assert not path.exists(), f'import created {path}'",
        )
    )

    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_storage_directories_are_created_explicitly(tmp_path, monkeypatch):
    import storage

    root = tmp_path / "uploads"
    monkeypatch.setattr(storage, "UPLOAD_DIR", root)
    monkeypatch.setattr(storage, "PUBLIC_UPLOAD_DIR", root / "public")
    monkeypatch.setattr(storage, "PRIVATE_DOC_DIR", root / "documents")

    storage.ensure_storage_directories()

    assert storage.UPLOAD_DIR.is_dir()
    assert storage.PUBLIC_UPLOAD_DIR.is_dir()
    assert storage.PRIVATE_DOC_DIR.is_dir()
