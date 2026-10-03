"""Antworten der neuen Slash-Befehle (#573) - Rechnung mit den Daten der Website, ohne Discord-Bibliothek.

``/rangliste`` (Top 10 der laufenden Saison), ``/bracket`` (Auswahl aus laufenden Turnieren), ``/wer-streamt``,
``/mitglied`` (eigener Stand, nur verknüpft) und ``/verknuepfen`` (der Weg zum Verknüpfen). Jede Antwort sieht
nur die fragende Person (Wunsch des Betreibers, 25.09.). Was um die eigene Person geht, braucht ein verknüpftes
Konto und nennt nie Daten anderer; Beitrags- und Zahlungsdaten bleiben auf der Website - Discord ist ein
fremder Dienst.

Eine Antwort ist ``{"content": str | None, "embed": dict | None, "buttons": [...]}``; ``BotRunner`` macht daraus
die Discord-Nachricht (``discord_bot.answer_kwargs``).
"""
from __future__ import annotations

from datetime import date

RUNNING_STATUSES = ("live", "paused")
LINK_PATH = "/profile?tab=socials"
NOT_LINKED = "Dein Discord-Konto ist nicht mit der Website verknüpft – mit `/verknuepfen` steht, wie es geht."
MEMBER_AREA_PATH = "/member-area"
APPLY_PATH = "/membership/apply"


def answer(content: str | None = None, *, embed: dict | None = None, buttons: list[dict] | None = None) -> dict:
    return {"content": content, "embed": embed, "buttons": list(buttons or [])}


async def _linked_user_id(db, discord_user_id) -> str | None:
    from services.discord_bot import linked_discord_ids

    return (await linked_discord_ids(db)).get(str(discord_user_id))


# ---------------------------------------------------------------- /rangliste und /wer-streamt

async def answer_rangliste(db) -> dict:
    """Dieselbe Rechnung wie die angepinnte Rangliste (#569)."""
    from services.discord_embeds import build

    embed = await build(db, "ranking")
    return answer(embed=embed, buttons=[{"label": "Rangliste ansehen", "url": embed.get("url")}])


async def answer_wer_streamt(db) -> dict:
    """Wer aus dem Verein gerade streamt - dieselbe Regel wie die Startseite (nur freigegebene Kanäle)."""
    from services.discord_embeds import build

    return answer(embed=await build(db, "live"))


# ---------------------------------------------------------------- /bracket

async def bracket_choices(db, typed: str = "", limit: int = 25) -> list[dict]:
    """Die laufenden öffentlichen Turniere zur Auswahl - ohne „Ohne Discord“ (#572); Discord zeigt höchstens 25."""
    from services.discord_threads import wants_discord

    rows = await db.tournaments.find({"status": {"$in": list(RUNNING_STATUSES)}, "is_public": {"$ne": False}},
                                     {"_id": 0, "id": 1, "title": 1, "visibility": 1, "is_public": 1, "discord_skip": 1, "start_date": 1}
                                     ).sort("start_date", -1).to_list(200)
    needle = (typed or "").strip().casefold()
    out = []
    for row in rows:
        if not wants_discord(row) or (needle and needle not in str(row.get("title") or "").casefold()):
            continue
        out.append({"name": str(row.get("title") or "Turnier")[:100], "value": row["id"]})
        if len(out) >= limit:
            break
    return out


async def answer_bracket(db, wanted: str | None = None) -> dict:
    """Das Bracket wie im Turnier-Thread (#571) - für das gewählte Turnier; läuft nur eins, dieses."""
    from services import discord_bracket

    choices = await bracket_choices(db)
    if not choices:
        return answer("Gerade läuft kein Turnier – sobald eins live ist, steht sein Bracket hier.")
    pick = None
    if wanted:
        needle = str(wanted).strip().casefold()
        pick = next((c for c in choices if c["value"] == wanted), None) or next((c for c in choices if needle in c["name"].casefold()), None)
    elif len(choices) == 1:
        pick = choices[0]
    if not pick:
        names = ", ".join(f"„{c['name']}“" for c in choices[:10])
        return answer(f"Welches Turnier? Beim Befehl aus der Liste wählen – gerade laufen: {names}.")
    tournament = await db.tournaments.find_one({"id": pick["value"]}, {"_id": 0})
    if not tournament:
        return answer("Dieses Turnier läuft gerade nicht mehr.")
    embed = await discord_bracket.build(db, tournament)
    return answer(embed=embed, buttons=[{"label": "Bracket ansehen", "url": embed.get("url")}])


# ---------------------------------------------------------------- /mitglied

def _since_text(membership: dict) -> str:
    raw = str(membership.get("member_since") or "")[:10]
    try:
        day = date.fromisoformat(raw)
    except ValueError:
        return ""
    precision = membership.get("member_since_precision") or "day"
    if precision == "year":
        return f"seit {day.year}"
    if precision == "month":
        return f"seit {day.month:02d}/{day.year}"
    return f"seit {day.strftime('%d.%m.%Y')}"


def membership_text(membership: dict | None, base_url: str = "", today: str | None = None) -> str:
    """Der eigene Stand in einem Satz: aktiv mit Art und „seit“, Antrag offen, beendet oder keins - ohne Beitrag."""
    from services.member_card import _type_label, card_status

    membership = membership or {}
    status = membership.get("member_status")
    if status == "pending":
        return "Dein Mitgliedsantrag ist eingegangen und wartet auf den Vorstand."
    if status == "blocked":
        return "Zu deiner Mitgliedschaft wende dich bitte an den Vorstand."
    state = card_status(membership, today)
    if state == "valid":
        details = ", ".join(part for part in (_type_label(membership), _since_text(membership)) if part)
        return f"✅ Du bist aktives Vereinsmitglied ({details}). Mitgliederbereich: {base_url}{MEMBER_AREA_PATH}"
    if state == "ended":
        ends = str((membership.get("dolibarr") or {}).get("membership_ends") or "")[:10]
        try:
            ends = date.fromisoformat(ends).strftime("%d.%m.%Y")
        except ValueError:
            pass
        return f"Deine Mitgliedschaft ist am {ends} ausgelaufen. Wieder Mitglied werden: {base_url}{APPLY_PATH}"
    return f"Du bist (noch) kein Vereinsmitglied. Mitglied werden: {base_url}{APPLY_PATH}"


async def answer_mitglied(db, discord_user_id, base_url: str = "") -> dict:
    user_id = await _linked_user_id(db, discord_user_id)
    if not user_id:
        return answer(NOT_LINKED, buttons=[{"label": "Konto verknüpfen", "url": LINK_PATH}])
    membership = await db.memberships.find_one({"user_id": user_id}, {"_id": 0})
    button = {"label": "Mitgliederbereich", "url": MEMBER_AREA_PATH} if (membership or {}).get("member_status") in ("active", "honorary") \
        else {"label": "Mitglied werden", "url": APPLY_PATH}
    return answer(membership_text(membership, base_url), buttons=[button])


# ---------------------------------------------------------------- /verknuepfen

def link_text(linked: bool, base_url: str = "") -> str:
    if linked:
        return (f"✅ Dein Discord-Konto ist schon mit der Website verknüpft – Erfolge, Vereinsrollen und auf Wunsch Benachrichtigungen "
                f"laufen. Verwalten: {base_url}{LINK_PATH}")
    return (f"So verknüpfst du dein Discord-Konto: auf der Website anmelden → Profil → Socials → „Mit Discord verknüpfen“ "
            f"({base_url}{LINK_PATH}). Danach zählen deine Nachrichten für Erfolge, du bekommst deine Vereinsrollen und auf Wunsch "
            f"Benachrichtigungen als Direktnachricht.")


async def answer_verknuepfen(db, discord_user_id, base_url: str = "") -> dict:
    linked = bool(await _linked_user_id(db, discord_user_id))
    return answer(link_text(linked, base_url), buttons=[{"label": "Verknüpfung verwalten" if linked else "Konto verknüpfen", "url": LINK_PATH}])
