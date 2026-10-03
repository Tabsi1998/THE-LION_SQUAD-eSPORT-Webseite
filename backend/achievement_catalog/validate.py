"""Erfolge II (E10, #620): die Katalog-Prüfung - dieselben Regeln für den Test und für den Admin. Sie
arbeitet auf Gruppen- und Stufen-Listen (aus dem Code oder aus der Datenbank) und liefert Fehler, die
jemand sehen würde, und Warnungen, die nur schief wirken.

Regeln (Fehler): Codes eindeutig, öffentliche Namen eindeutig je Kategorie, jede Stufe hat ihre Gruppe,
Bedingungsschlüssel bekannt, Ziele je Gruppe und Schlüssel steigen, Material und Rang passen zusammen,
Vereins-Stufen sind nur für Mitglieder, öffentliche Stufen nutzen keine geplante Automatik, Punkte über
null, Name und Beschreibung da. Warnungen: fehlendes „Wie schaffe ich das“, fehlendes Motiv, Gruppen ohne
Stufen, Leitern mit Lücken.
"""
from __future__ import annotations

from collections import Counter, defaultdict

from .materials import CATEGORIES, LADDERS, MATERIALS, category_v2


def _finding(code: str, message: str, *, group: str | None = None, tier: str | None = None) -> dict:
    out = {"code": code, "message": message}
    if group:
        out["group"] = group
    if tier:
        out["tier"] = tier
    return out


def validate_catalog(groups: list[dict], tiers: list[dict], condition_status: dict | None = None) -> dict:
    """Prüft Gruppen und Stufen. ``condition_status`` ist die Karte Schlüssel → live/counter/planned."""
    errors: list[dict] = []
    warnings: list[dict] = []
    group_codes = [g.get("code") for g in groups]
    for code, count in Counter(group_codes).items():
        if count > 1:
            errors.append(_finding("group_code_duplicate", f"Gruppen-Code „{code}“ kommt {count}-mal vor.", group=code))
    tier_codes = [t.get("code") for t in tiers]
    for code, count in Counter(tier_codes).items():
        if count > 1:
            errors.append(_finding("tier_code_duplicate", f"Stufen-Code „{code}“ kommt {count}-mal vor.", tier=code))

    by_code = {g.get("code"): g for g in groups}

    def gname(g: dict) -> str:
        return str(g.get("name") or "").strip() or str(g.get("code"))

    def tname(t: dict) -> str:
        return str(t.get("name") or "").strip() or str(t.get("code"))

    names: Counter = Counter()
    for g in groups:
        if g.get("public") and not g.get("is_negative"):
            names[(category_v2(g.get("category")), str(g.get("name") or "").strip().lower())] += 1
    for (cat, name), count in names.items():
        if count > 1 and name:
            errors.append(_finding("group_name_duplicate", f"Der Name „{name}“ steht {count}-mal in der Kategorie {CATEGORIES.get(cat, {}).get('label', cat)}."))

    for g in groups:
        code = g.get("code")
        cat = category_v2(g.get("category"))
        if cat not in CATEGORIES:
            errors.append(_finding("group_category_unknown", f"Gruppe „{gname(g)}“ hat die unbekannte Kategorie „{g.get('category')}“.", group=code))
        if not str(g.get("name") or "").strip():
            errors.append(_finding("group_name_missing", f"Gruppe „{code}“ hat keinen Namen.", group=code))
        if not g.get("is_negative") and not str(g.get("description") or "").strip():
            errors.append(_finding("group_description_missing", f"Gruppe „{gname(g)}“ hat keine Beschreibung.", group=code))
        if not g.get("is_negative") and not str(g.get("how_to") or "").strip():
            warnings.append(_finding("group_how_to_missing", f"Gruppe „{gname(g)}“ sagt nicht, wie man sie schafft.", group=code))
        if not g.get("is_negative") and not str(g.get("art") or "").strip():
            warnings.append(_finding("group_art_missing", f"Gruppe „{gname(g)}“ hat kein Motiv.", group=code))
        if cat == "hidden" and not g.get("hidden"):
            warnings.append(_finding("group_hidden_flag", f"Gruppe „{gname(g)}“ steht in „Geheim“, ist aber nicht als versteckt markiert.", group=code))

    per_group: dict[str, list[dict]] = defaultdict(list)
    for t in tiers:
        per_group[str(t.get("group_code"))].append(t)
        code = t.get("code")
        group = by_code.get(t.get("group_code"))
        if group is None:
            errors.append(_finding("tier_group_missing", f"Stufe „{tname(t)}“ zeigt auf eine Gruppe, die es nicht gibt.", tier=code))
            continue
        negative = bool(group.get("is_negative"))
        if not str(t.get("name") or "").strip():
            errors.append(_finding("tier_name_missing", f"Eine Stufe in „{gname(group)}“ hat keinen Namen.", tier=code, group=group.get("code")))
        if not negative and not str(t.get("description") or "").strip():
            errors.append(_finding("tier_description_missing", f"Stufe „{tname(t)}“ hat keine Beschreibung.", tier=code, group=group.get("code")))
        if int(t.get("points") or 0) <= 0:
            errors.append(_finding("tier_points", f"Stufe „{tname(t)}“ bringt keine Punkte.", tier=code, group=group.get("code")))
        material = t.get("material")
        if material and material not in MATERIALS:
            errors.append(_finding("tier_material_unknown", f"Stufe „{tname(t)}“ hat ein unbekanntes Material.", tier=code, group=group.get("code")))
        elif material and t.get("rank") is not None and int(t.get("rank") or 0) != MATERIALS[material]["rank"]:
            errors.append(_finding("tier_rank_material", f"Stufe „{tname(t)}“: Rang {t.get('rank')} passt nicht zu {MATERIALS[material]['name']}.", tier=code, group=group.get("code")))
        key = t.get("condition_key")
        if key and condition_status is not None and key not in condition_status:
            errors.append(_finding("tier_condition_unknown", f"Stufe „{tname(t)}“ nutzt eine Automatik, die es nicht gibt.", tier=code, group=group.get("code")))
        if key and condition_status is not None and condition_status.get(key) == "planned" and group.get("public") and not t.get("manual_only"):
            errors.append(_finding("tier_planned_public", f"Stufe „{tname(t)}“ ist öffentlich, ihre Automatik aber erst geplant.", tier=code, group=group.get("code")))
        if not negative and not key and not t.get("manual_only"):
            errors.append(_finding("tier_no_condition", f"Stufe „{tname(t)}“ hat weder eine Automatik noch „von Hand“.", tier=code, group=group.get("code")))
        if category_v2(group.get("category")) == "club" and not t.get("member_only"):
            errors.append(_finding("tier_club_member_only", f"Stufe „{tname(t)}“ liegt im Verein, ist aber nicht nur für Mitglieder.", tier=code, group=group.get("code")))
        if not negative and not str(t.get("how_to") or "").strip():
            warnings.append(_finding("tier_how_to_missing", f"Stufe „{tname(t)}“ sagt nicht, wie man sie schafft.", tier=code, group=group.get("code")))

    for gcode, rows in per_group.items():
        group = by_code.get(gcode)
        if not group:
            continue
        by_key: dict[str, list[dict]] = defaultdict(list)
        for t in rows:
            if t.get("condition_key") and t.get("progress_target") is not None:
                by_key[t["condition_key"]].append(t)
        for key, items in by_key.items():
            ordered = sorted(items, key=lambda t: (int(t.get("rank") or 0), int(t.get("level") or 0)))
            targets = [int(t.get("progress_target") or 0) for t in ordered]
            if targets != sorted(targets) or len(set(targets)) != len(targets):
                errors.append(_finding("tier_targets_not_monotonic", f"Gruppe „{gname(group)}“: die Ziele steigen nicht ({', '.join(map(str, targets))}).", group=gcode))
        materials = [t.get("material") for t in sorted(rows, key=lambda t: int(t.get("rank") or 0)) if t.get("material")]
        if materials and len(materials) == len(rows) and not group.get("is_negative") and materials not in LADDERS.values() and len(set(materials)) == len(materials) and len(materials) > 1:
            ranks = [MATERIALS[m]["rank"] for m in materials if m in MATERIALS]
            names_in_order = ", ".join(MATERIALS[m]["name"] for m in materials if m in MATERIALS)
            if ranks != sorted(ranks):
                errors.append(_finding("tier_ladder_order", f"Gruppe „{gname(group)}“: die Materialien steigen nicht ({names_in_order}).", group=gcode))
            elif all(r <= 7 for r in ranks):
                warnings.append(_finding("tier_ladder_gap", f"Gruppe „{gname(group)}“ nutzt eine Leiter mit Lücken ({names_in_order}).", group=gcode))
    for g in groups:
        if not per_group.get(str(g.get("code"))):
            warnings.append(_finding("group_without_tiers", f"Gruppe „{gname(g)}“ hat keine Stufen.", group=g.get("code")))

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "counts": {"groups": len(groups), "tiers": len(tiers), "errors": len(errors), "warnings": len(warnings)},
    }
