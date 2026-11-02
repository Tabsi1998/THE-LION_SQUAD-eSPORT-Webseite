"""Regelwerk der Liga (docs/LIGA.md, #1646): Abschnitte, Anker, Bausteine im Text und Vergleich - ohne Datenbank.

Web und PDF bekommen dieselben Abschnitte von hier. Eine Überschrift (``#`` bis ``###``) beginnt einen Abschnitt, der Anker ist
der Slug der Überschrift und bleibt damit über Versionen stabil, solange sie gleich bleibt.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from services.slug_utils import slugify

ANCHOR_MAX = 80
INTRO_ANCHOR = "einleitung"
FALLBACK_ANCHOR = "abschnitt"
# Ab diesem Anteil gleicher Wörter gilt ein Abschnitt mit neuer Überschrift als umbenannt statt als neu und entfernt.
RENAME_RATIO = 0.6
# Darüber vergleicht ``word_ops`` einen geänderten Block nicht mehr Wort für Wort, sondern zeigt ihn als alt und neu - der
# Aufwand wächst mit dem Produkt der Längen.
WORD_DIFF_MAX = 4_000_000

_HEADING = re.compile(r"^(#{1,3})\s+(.+?)\s*#*\s*$")
_FENCE = re.compile(r"^\s*```")
_TOKEN = re.compile(r"\[\[\s*baustein\s*:\s*([a-z0-9_-]+)\s*\]\]", re.IGNORECASE)
_WORDS = re.compile(r"\s+|\S+")
_INLINE_MARKS = re.compile(r"\*\*|\*|`|~~|\+\+")


def _plain_title(raw: str) -> str:
    return _INLINE_MARKS.sub("", raw).strip()


def _split(body: str) -> list[dict]:
    """Der Text in Abschnitte: Überschrift (oder ``None`` davor) und Rumpf. Überschriften in Code-Blöcken zählen nicht."""
    rows: list[dict] = [{"title": None, "level": 0, "lines": []}]
    fenced = False
    for line in str(body or "").replace("\r\n", "\n").split("\n"):
        if _FENCE.match(line):
            fenced = not fenced
        heading = None if fenced else _HEADING.match(line)
        if heading:
            rows.append({"title": _plain_title(heading.group(2)), "level": len(heading.group(1)), "lines": []})
        else:
            rows[-1]["lines"].append(line)
    return [{"title": row["title"], "level": row["level"], "body_md": "\n".join(row["lines"]).strip("\n")}
            for row in rows if row["title"] is not None or "\n".join(row["lines"]).strip()]


def _anchor(title: str | None, prefix: str, seen: dict[str, int]) -> str:
    base = slugify(title, fallback=FALLBACK_ANCHOR, max_length=ANCHOR_MAX) if title else INTRO_ANCHOR
    base = f"{prefix}-{base}"[:ANCHOR_MAX].strip("-") if prefix else base
    seen[base] = seen.get(base, 0) + 1
    return base if seen[base] == 1 else f"{base}-{seen[base]}"


def sections_of(body_md: str | None, annexes: list[dict] | None = None, *, fill=None) -> list[dict]:
    """Haupttext und Anlagen als Abschnitte ``{anchor, title, level, kind, body_md}``. ``fill``: Text → Text, setzt die
    Bausteine ein, bevor geschnitten wird."""
    fill = fill or (lambda value: value)
    seen: dict[str, int] = {}
    out: list[dict] = []
    for row in _split(fill(body_md or "")):
        out.append({"anchor": _anchor(row["title"], "", seen), "title": row["title"], "level": row["level"],
                    "kind": "main", "body_md": row["body_md"]})
    for annex in annexes or []:
        key = str(annex.get("key") or "").upper()
        prefix = f"anlage-{key.lower()}"
        parts = _split(fill(annex.get("body_md") or ""))
        lead = parts.pop(0)["body_md"] if parts and parts[0]["title"] is None else ""
        seen[prefix] = seen.get(prefix, 0) + 1
        out.append({"anchor": prefix, "title": f"Anlage {key}: {annex.get('title') or ''}".rstrip(": "), "level": 1,
                    "kind": "annex", "body_md": lead})
        for row in parts:
            out.append({"anchor": _anchor(row["title"], prefix, seen), "title": row["title"], "level": max(row["level"], 2),
                        "kind": "annex", "body_md": row["body_md"]})
    return out


# ---------------------------------------------------------------- Bausteine im Text

def block_keys(*texts: str | None) -> list[str]:
    """Die Bausteine im Text, in der Reihenfolge ihres ersten Auftretens."""
    found: list[str] = []
    for value in texts:
        for match in _TOKEN.finditer(str(value or "")):
            key = match.group(1).lower()
            if key not in found:
                found.append(key)
    return found


def fill_blocks(body: str | None, values: dict[str, str], *, missing: str | None = None) -> str:
    """Setzt die Bausteine ein - als eigener Block. Ohne Wert: ``missing``, ohne ``missing`` bleibt die Marke stehen."""
    def replace(match: re.Match) -> str:
        value = values.get(match.group(1).lower())
        if value is None:
            value = missing
        return match.group(0) if value is None else f"\n\n{value}\n\n"

    return _TOKEN.sub(replace, str(body or ""))


# ---------------------------------------------------------------- Vergleich

def _normal(text: str | None) -> str:
    return " ".join(str(text or "").split())


def _head(row: dict) -> dict:
    return {"anchor": row["anchor"], "title": row.get("title")}


def _same_words(left: str, right: str) -> float:
    """Anteil gleicher Wörter. Erst die billigen Obergrenzen: Bei einem umgeschriebenen langen Text trifft das fast jedes Paar."""
    if not left or not right:
        return 0.0
    matcher = SequenceMatcher(None, left.split(), right.split(), autojunk=False)
    if matcher.real_quick_ratio() < RENAME_RATIO or matcher.quick_ratio() < RENAME_RATIO:
        return 0.0
    return matcher.ratio()


def _pairs(base: list[dict], target: list[dict]) -> dict[str, dict]:
    """Je Abschnitt von ``target`` sein Gegenstück in ``base``: erst über den Anker, dann über ähnlichen Text."""
    by_anchor = {row["anchor"]: row for row in base}
    pairs = {row["anchor"]: by_anchor[row["anchor"]] for row in target if row["anchor"] in by_anchor}
    left = [row for row in base if row["anchor"] not in pairs]
    for row in target:
        if row["anchor"] in pairs or not left:
            continue
        ratio, best = max(((_same_words(_normal(row["body_md"]), _normal(other["body_md"])), other) for other in left),
                          key=lambda pair: pair[0])
        if ratio >= RENAME_RATIO:
            pairs[row["anchor"]] = best
            left.remove(best)
    return pairs


def compare(base: list[dict] | None, target: list[dict]) -> dict:
    """Was ``target`` gegenüber ``base`` geändert hat. ``marks``: Anker → ``new``/``changed`` für die Markierung. Leerraum zählt
    nicht. Ohne ``base`` (erste Fassung) ist nichts markiert."""
    if base is None:
        return {"new": [], "changed": [], "removed": [], "marks": {}}
    pairs = _pairs(base, target)
    new: list[dict] = []
    changed: list[dict] = []
    for row in target:
        other = pairs.get(row["anchor"])
        if other is None:
            new.append(_head(row))
        elif _normal(other["body_md"]) != _normal(row["body_md"]) or _normal(other.get("title")) != _normal(row.get("title")):
            changed.append({**_head(row), **({"previous_anchor": other["anchor"]} if other["anchor"] != row["anchor"] else {})})
    used = {id(other) for other in pairs.values()}
    return {"new": new, "changed": changed, "removed": [_head(row) for row in base if id(row) not in used],
            "marks": {**{row["anchor"]: "new" for row in new}, **{row["anchor"]: "changed" for row in changed}}}


def _append(ops: list[dict], op: str, text: str) -> None:
    if not text:
        return
    if ops and ops[-1]["op"] == op:
        ops[-1]["text"] += text
    else:
        ops.append({"op": op, "text": text})


def _word_block(ops: list[dict], left: str, right: str) -> None:
    left_words, right_words = _WORDS.findall(left), _WORDS.findall(right)
    if len(left_words) * len(right_words) > WORD_DIFF_MAX:
        _append(ops, "del", left)
        _append(ops, "ins", right)
        return
    matcher = SequenceMatcher(None, left_words, right_words, autojunk=False)
    for tag, left_from, left_to, right_from, right_to in matcher.get_opcodes():
        if tag == "equal":
            _append(ops, "eq", "".join(left_words[left_from:left_to]))
        else:
            _append(ops, "del", "".join(left_words[left_from:left_to]))
            _append(ops, "ins", "".join(right_words[right_from:right_to]))


def word_ops(base: str | None, target: str | None) -> list[dict]:
    """Wort für Wort: ``[{op: eq|ins|del, text}]``. Erst zeilenweise, damit lange Texte schnell bleiben; ``eq`` + ``del`` ergibt
    genau den alten Text, ``eq`` + ``ins`` genau den neuen."""
    left, right = str(base or ""), str(target or "")
    left_lines, right_lines = left.splitlines(keepends=True), right.splitlines(keepends=True)
    ops: list[dict] = []
    for tag, left_from, left_to, right_from, right_to in SequenceMatcher(None, left_lines, right_lines).get_opcodes():
        if tag == "equal":
            _append(ops, "eq", "".join(left_lines[left_from:left_to]))
        else:
            _word_block(ops, "".join(left_lines[left_from:left_to]), "".join(right_lines[right_from:right_to]))
    return ops


def diff_view(base: list[dict], target: list[dict]) -> list[dict]:
    """Der Vergleich zweier Fassungen, Abschnitt für Abschnitt - entfernte Abschnitte am Ende, mit ihrem Text."""
    pairs = _pairs(base, target)
    rows: list[dict] = []
    for row in target:
        other = pairs.get(row["anchor"])
        head = {**_head(row), "level": row.get("level")}
        if other is None:
            rows.append({**head, "status": "new", "ops": word_ops("", row["body_md"])})
        elif _normal(other["body_md"]) != _normal(row["body_md"]) or _normal(other.get("title")) != _normal(row.get("title")):
            rows.append({**head, "status": "changed", "ops": word_ops(other["body_md"], row["body_md"]),
                         **({"previous_title": other.get("title")} if other.get("title") != row.get("title") else {})})
        else:
            rows.append({**head, "status": "same"})
    used = {id(other) for other in pairs.values()}
    rows += [{**_head(row), "level": row.get("level"), "status": "removed", "ops": word_ops(row["body_md"], "")}
             for row in base if id(row) not in used]
    return rows
