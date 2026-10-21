"""Partner an Serien und Ligen (#1934): Veranstalter und Mitwirkende einer Spur und ihrer Saisons.

Datenmodell (kompatibel zu #469): Spur und Saison tragen ``partner_ids`` (Reihenfolge des Formulars) und dazu
``partner_roles`` - je Partner ``organizer`` (Veranstalter) oder ``contributor`` (Mitwirkender). Fehlt ein Eintrag, gilt
„Mitwirkender“; so bleiben Spuren gültig, die nur ``partner_ids`` kennen. Die Saison erbt die Partner der Spur und kann
eigene ergänzen (etwa einen Sponsor nur dieser Season); steht ein Partner an beiden, gilt die Rolle der Saison.

Nach außen gehen nur aktive Partner (Kurzform wie ``partner_pages.partner_badge`` mit ``role``) - gesammelt geladen,
nie je Spur oder Saison; Kurzform und Logo kommen aus ``partner_pages.partner_badge`` wie bei Events und Turnieren.
Ohne Routen-Importe; „Ligen und Serien mit uns“ der Partnerseite steht in
``services/partner_series_view.py``.
"""
from __future__ import annotations

from services import partner_pages

ORGANIZER = "organizer"
CONTRIBUTOR = "contributor"
ROLES = (ORGANIZER, CONTRIBUTOR)
PARTNER_FIELDS = {"_id": 0, "id": 1, "slug": 1, "name": 1, "logo_url": 1, "dolibarr_images": 1, "kind": 1}


def clean_roles(ids: list[str], roles: dict | None, previous: dict | None = None) -> dict:
    """Rollen nur für Partner der Liste; ohne Angabe die bisherige Rolle, sonst „Mitwirkender“."""
    roles, previous = roles or {}, previous or {}
    return {pid: roles.get(pid) if roles.get(pid) in ROLES else previous.get(pid) if previous.get(pid) in ROLES
            else CONTRIBUTOR for pid in ids}


async def clean(db, updates: dict, existing: dict | None = None) -> None:
    """``partner_ids``/``partner_roles`` in ``updates`` bereinigen: nur aktive Partner, Rollen passend dazu. Schickt ein
    älterer Aufruf nur ``partner_ids``, bleiben die Rollen der übrigen Partner."""
    if "partner_ids" not in updates and "partner_roles" not in updates:
        return
    existing = existing or {}
    ids = updates["partner_ids"] if "partner_ids" in updates else existing.get("partner_ids")
    ids = await partner_pages.clean_partner_ids(db, ids)
    roles = updates.get("partner_roles") if "partner_roles" in updates else None
    updates["partner_ids"] = ids
    updates["partner_roles"] = clean_roles(ids, roles, existing.get("partner_roles"))


def effective(lineage: dict, series: dict | None = None) -> list[tuple[str, str]]:
    """(Partner, Rolle) einer Saison: die der Spur, dann die eigenen; die Rolle der Saison geht vor."""
    out: dict[str, str] = {}
    for doc in (lineage, series or {}):
        roles = doc.get("partner_roles") or {}
        for pid in doc.get("partner_ids") or []:
            if pid:
                out[pid] = roles.get(pid) if roles.get(pid) in ROLES else CONTRIBUTOR
    return list(out.items())


async def badges(db, ids) -> dict[str, dict]:
    """Kurzform aktiver Partner je ID - eine Abfrage."""
    wanted = list({pid for pid in ids if pid})
    if not wanted:
        return {}
    rows = await db.partners.find({"id": {"$in": wanted}, "is_active": {"$ne": False}}, PARTNER_FIELDS).to_list(None)
    return {row["id"]: partner_pages.partner_badge(row) for row in rows}


def grouped(pairs: list[tuple[str, str]], by_id: dict) -> dict:
    """``organizers`` und ``contributors`` in der Reihenfolge der Spur, nur aktive Partner."""
    out = {"organizers": [], "contributors": []}
    for pid, role in pairs:
        if pid in by_id:
            out["organizers" if role == ORGANIZER else "contributors"].append({**by_id[pid], "role": role})
    return out


async def for_series_page(db, lineage: dict, series: dict) -> dict:
    pairs = effective(lineage, series)
    return grouped(pairs, await badges(db, [pid for pid, _ in pairs]))


async def organizers_many(db, docs: list[tuple[dict, dict | None]]) -> list[list[dict]]:
    """Veranstaltende Partner für viele (Spur, Saison)-Paare - eine Abfrage für alle."""
    pairs = [effective(lineage, series) for lineage, series in docs]
    by_id = await badges(db, [pid for items in pairs for pid, _ in items])
    return [grouped(items, by_id)["organizers"] for items in pairs]
