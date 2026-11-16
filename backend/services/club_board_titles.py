"""Funktionen aus dem Vorstand je Vereinsprofil (Obmann, Kassierin, …-Stv.) - für die Vereinsseiten und den Hinweis
„Vereinsmitglied · Funktion“ im Spielerprofil (#1267). Ein Blatt-Modul: Routen importieren es, es importiert keine Route."""


def title_for_position(position: dict, person: dict | None = None) -> str:
    if person and person.get("gender") == "female" and position.get("title_female"):
        return position["title_female"]
    return position.get("title_male") or position.get("display_title") or "Vorstand"


async def board_titles_by_profile_id(db) -> dict[str, str]:
    profiles = await db.club_member_profiles.find(
        {},
        {"_id": 0, "id": 1, "user_id": 1, "gender": 1},
    ).to_list(2000)
    by_profile_id = {p["id"]: p for p in profiles}
    by_user_id = {p["user_id"]: p for p in profiles if p.get("user_id")}
    titles: dict[str, str] = {}
    positions = await db.board_positions.find(
        {"is_active": True}, {"_id": 0}
    ).sort("order_index", 1).to_list(200)
    for position in positions:
        main = by_profile_id.get(position.get("user_id")) or by_user_id.get(position.get("user_id"))
        if main:
            titles[main["id"]] = title_for_position(position, main)
        deputy = by_profile_id.get(position.get("deputy_user_id")) or by_user_id.get(position.get("deputy_user_id"))
        if deputy:
            titles[deputy["id"]] = f"{title_for_position(position, deputy)}-Stv."
    return titles
