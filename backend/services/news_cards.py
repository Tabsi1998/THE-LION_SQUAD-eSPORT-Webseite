"""Angaben für News-Karten, die mehr brauchen als der Beitrag selbst.

* Ergebnis-News (#1343): Ist ein verknüpftes Turnier mit veröffentlichten Ergebnissen dabei, trägt die News den
  Sieger (``result``) - die Text-Karte zeigt dann Pokal und „1. Name“ statt eines Satzes.
"""
from __future__ import annotations

from services.event_recap import load_users, registration_name
from services.visibility import user_can_see

RESULT_STATUSES = {"results_published", "archived"}


async def _visible_tournament(tournament: dict, user: dict | None) -> bool:
    if tournament.get("is_public") is False:
        return False
    return await user_can_see(user, tournament.get("visibility") or "public")


async def attach_result_winners(db, posts: list[dict], user: dict | None) -> None:
    """Setzt ``result = {"winner", "tournament"}`` je Beitrag mit verknüpftem, abgeschlossenem Turnier - mit wenigen
    Abfragen für die ganze Liste. Nur Turniere, die der Besucher sehen darf."""
    ids = {tid for post in posts for tid in (post.get("linked_tournament_ids") or []) if tid}
    if not ids:
        return
    tournaments = await db.tournaments.find(
        {"id": {"$in": list(ids)}, "status": {"$in": list(RESULT_STATUSES)}},
        {"_id": 0, "id": 1, "title": 1, "visibility": 1, "is_public": 1},
    ).to_list(len(ids))
    visible = {t["id"]: t for t in tournaments if await _visible_tournament(t, user)}
    if not visible:
        return
    awards = await db.tournament_awards.find(
        {"tournament_id": {"$in": list(visible)}, "rank": 1}, {"_id": 0, "tournament_id": 1, "registration_id": 1},
    ).to_list(len(visible) * 4)
    first_award = {}
    for award in awards:
        first_award.setdefault(award["tournament_id"], award.get("registration_id"))
    regs = {
        reg["id"]: reg for reg in await db.tournament_registrations.find(
            {"id": {"$in": [rid for rid in first_award.values() if rid]}}, {"_id": 0},
        ).to_list(len(first_award) or 1)
    }
    users = await load_users(db, [reg.get("user_id") for reg in regs.values()])
    winners = {}
    for tid, rid in first_award.items():
        reg = regs.get(rid)
        if reg:
            winners[tid] = {"winner": registration_name(reg, users), "tournament": visible[tid].get("title") or "Turnier"}
    for post in posts:
        for tid in post.get("linked_tournament_ids") or []:
            if tid in winners:
                post["result"] = winners[tid]
                break
