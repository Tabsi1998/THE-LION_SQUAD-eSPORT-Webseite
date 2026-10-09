"""Check repository-local Markdown link targets; remote URLs need separate review.

Also holds the size budget of the files every Claude session loads at start.
"""
import os
import re
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
IGNORED = {".git", "node_modules", ".pytest_cache", "dist", "test-results", "playwright-report", ".venv", "__pycache__"}
# CLAUDE.md is read by every Claude session and every agent before the first line of code (#929): what
# stands there is paid for at every start. State, history and pitfalls live in the operator's private
# project notes, not in the repository. Bytes are counted with LF line endings, so Windows and the CI agree.
SIZE_BUDGETS = {"CLAUDE.md": 60_000}


def over_budget(root=ROOT, budgets=None):
    """The files that outgrew their budget, as lines to print."""
    found = []
    for name, limit in (SIZE_BUDGETS if budgets is None else budgets).items():
        path = Path(root) / name
        if not path.is_file():
            continue
        size = len(path.read_bytes().replace(b"\r\n", b"\n"))
        if size > limit:
            found.append(f"{name}: {size} bytes, the budget is {limit} - move details to the private project notes "
                         "and keep only rules and the short map here")
    return found


def main():
    checked = 0
    broken = []
    for directory, children, filenames in os.walk(ROOT):
        children[:] = [name for name in children if name not in IGNORED]
        for name in filenames:
            if not name.endswith(".md"):
                continue
            source = Path(directory) / name
            checked += 1
            content = re.sub(r"```[\s\S]*?```", "", source.read_text(encoding="utf-8"))
            for match in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", content):
                target = match.group(1).strip().split(' "', 1)[0].strip("<>")
                if target.startswith(("#", "http://", "https://", "mailto:", "app://")):
                    continue
                path = unquote(target.split("#", 1)[0].split("?", 1)[0])
                if path and not (source.parent / path).exists():
                    broken.append(f"{source.relative_to(ROOT)}: {target}")
    for entry in broken:
        print(entry)
    print(f"Checked {checked} Markdown files; {len(broken)} missing local link targets.")
    heavy = over_budget()
    for entry in heavy:
        print(entry)
    return int(bool(broken or heavy))


if __name__ == "__main__":
    raise SystemExit(main())
