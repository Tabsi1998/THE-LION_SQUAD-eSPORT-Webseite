"""Erzeugt frontend/e2e/fixtures/discord-design.json aus der echten Gestaltung (#866).

Der Browser-Test `e2e/discord-design.spec.js` zeigt damit genau das, was der Server rendert. Nach einer Änderung an den
Standard-Vorlagen in `backend/services/discord_design.py` neu erzeugen:

    python scripts/make_discord_design_fixture.py

Die Adresse http://e2e-origin.test steht für den Testserver; der Test ersetzt sie durch seine eigene.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services import discord_design  # noqa: E402

ORIGIN = "http://e2e-origin.test"


def main() -> None:
    kinds = []
    for kind, spec in discord_design.KINDS.items():
        template = discord_design.default_template(kind)
        values, rows = discord_design.sample(kind, ORIGIN)
        kinds.append({"key": kind, "label": spec["label"], "group": spec["group"], "hint": spec["hint"], "list": bool(spec.get("list")),
                      "placeholders": discord_design.placeholder_list(kind, ORIGIN), "template": template, "default": template,
                      "customized": False, "changed": None, "preview": discord_design.render(kind, template, values, rows)})
    data = {"kinds": kinds, "groups": list(dict.fromkeys(spec["group"] for spec in discord_design.KINDS.values())), "limits": discord_design.LIMITS}
    target = ROOT / "frontend" / "e2e" / "fixtures" / "discord-design.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"{target.relative_to(ROOT)}: {len(kinds)} Meldungsarten")


if __name__ == "__main__":
    main()
