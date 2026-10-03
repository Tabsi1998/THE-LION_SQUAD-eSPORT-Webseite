"""Konten in der Mitgliederakte (#846): ein bestätigtes Discord-, Twitch- oder Steam-Konto der Website - per Anmeldung
bei der Plattform geprüft (#260, ``platform_links``) - auf Wunsch des Mitglieds in die Akte übernehmen.

- **Nur auf Wunsch:** je Konto ein Schalter im Mitgliederbereich; ohne ihn wird nichts übertragen. Übernommen steht das
  Konto in Dolibarr als „bestätigt durch Anwendung“ (`PUT /vereine/me/accounts/{network}` mit ``confirmed`` und der
  Kennung beim Netzwerk); ausschalten nimmt es dort wieder heraus (`DELETE`).
- **Trennen auf der Website** nimmt ein übernommenes Konto auch aus der Akte; ein neu verknüpftes Konto derselben
  Plattform ersetzt den Namen dort.
- **Der Verein wünscht** ein Netzwerk (``asked``: ``required``/``optional``) - fehlt die Verknüpfung, zeigt der
  Mitgliederbereich den Weg dorthin.
- Nie Kennwörter oder Tokens - nur Name und Kennung, die die Plattform beim Anmelden genannt hat.
"""
from __future__ import annotations

import logging

from models import new_id, now_utc
from services import dolibarr_identity
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

logger = logging.getLogger("tls.dolibarr.accounts")

# Website-Plattform → Netzwerk im Dolibarr-Wörterbuch der sozialen Netzwerke. Nur, was die Website wirklich prüft.
NETWORKS = {"discord": "discord", "twitch": "twitch", "steam": "steam", "youtube": "youtube", "tiktok": "tiktok", "x": "twitter"}
PLATFORM_FOR = {network: platform for platform, network in NETWORKS.items()}
LABELS = {"discord": "Discord", "twitch": "Twitch", "steam": "Steam", "youtube": "YouTube", "tiktok": "TikTok", "twitter": "X"}
ASKED_LABELS = {"required": "Der Verein wünscht", "optional": "Der Verein freut sich über"}
CAPABILITY = "accounts"
REASON_TEXTS = {
    "not_connected": "Die Mitgliederverwaltung ist nicht live angebunden.",
    "not_bound": "Dafür muss dein Konto mit deinem Mitgliedseintrag verbunden sein – das passiert von selbst über die bestätigte "
                 "E-Mail-Adresse oder durch den Vorstand; alternativ mit einem Einladungscode unter Meine Mitgliedschaft.",
    "right_missing": dolibarr_identity.MEMBER_RIGHT_TEXT,
    "no_capability": "Deine Verbindung erlaubt das noch nicht – der Vorstand schaltet die Fähigkeit „Konten“ in Dolibarr ein.",
}


class AccountsError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


async def _access(db, user_id: str):
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return None, None, "not_connected"
    access = await dolibarr_identity.access_for(db, settings, user_id)
    if not access:
        return None, None, "not_bound"
    if access["mode"] == "subject" and CAPABILITY not in access["capabilities"]:
        return access, None, "no_capability"
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return access, None, exc.kind
    return access, client, None


async def _denied(db, access: dict) -> str:
    await dolibarr_identity.forbidden(db, access)
    return "right_missing" if access["mode"] == "member" else "not_bound"


async def _website_links(db, user_id: str) -> dict[str, dict]:
    """Die geprüften Konten der Website je Netzwerk: Name und Kennung bei der Plattform."""
    rows = await db.platform_links.find({"user_id": user_id, "platform": {"$in": list(NETWORKS)}},
                                        {"_id": 0, "platform": 1, "handle": 1, "display_name": 1, "external_id": 1}).to_list(20)
    return {NETWORKS[row["platform"]]: row for row in rows if row.get("platform") in NETWORKS}


def _row(network: str, in_file: dict | None, link: dict | None, shared: bool) -> dict:
    asked = str((in_file or {}).get("asked") or "")
    return {
        "network": network, "platform": PLATFORM_FOR.get(network, ""), "label": (in_file or {}).get("label") or LABELS.get(network, network),
        "asked": asked, "asked_label": ASKED_LABELS.get(asked, ""),
        # Was in der Akte steht - und ob die Website es dort bestätigt hat.
        "in_file": {"handle": (in_file or {}).get("handle") or "", "confirmed": bool((in_file or {}).get("confirmed")),
                    "client": (in_file or {}).get("client") or "", "confirmed_at": (in_file or {}).get("confirmed_at") or ""},
        # Was die Website geprüft hat (Profil → Konten) - Name, nie die Kennung.
        "website": {"linked": bool(link), "handle": (link or {}).get("handle") or (link or {}).get("display_name") or ""},
        "shared": bool(shared and link),
        "can_share": bool(link),
    }


async def overview(db, user: dict) -> dict:
    """Die Konten aus der Akte neben den geprüften der Website - oder warum es hier nichts gibt."""
    access, client, reason = await _access(db, user["id"])
    if reason:
        return {"available": False, "reason": reason, "text": REASON_TEXTS.get(reason, "Dolibarr antwortet gerade nicht.")}
    try:
        rows = await client.my_accounts(access["params"])
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            reason = await _denied(db, access)
            return {"available": False, "reason": reason, "text": REASON_TEXTS[reason]}
        return {"available": False, "reason": exc.kind, "text": f"Dolibarr antwortet gerade nicht ({exc.text})."}
    await dolibarr_identity.member_call_ok(db, access)
    links = await _website_links(db, user["id"])
    shared = ((await db.users.find_one({"id": user["id"]}, {"_id": 0, "dolibarr_accounts_shared": 1})) or {}).get("dolibarr_accounts_shared") or {}
    by_network = {str(row.get("network") or ""): row for row in rows if isinstance(row, dict) and row.get("network")}
    networks = [network for network in by_network if network in PLATFORM_FOR or by_network[network].get("asked")]
    networks += [network for network in links if network not in by_network]
    order = {"required": 0, "optional": 1}
    items = [_row(network, by_network.get(network), links.get(network), bool(shared.get(network))) for network in networks]
    items.sort(key=lambda item: (order.get(item["asked"], 2), item["label"].lower()))
    return {"available": True, "accounts": items,
            "wishes": [{"network": item["network"], "platform": item["platform"], "label": item["label"], "asked": item["asked"]}
                       for item in items if item["asked"] == "required" and not item["website"]["linked"] and item["platform"]]}


async def _put(client, access: dict, network: str, link: dict) -> list[dict]:
    payload = {"handle": str(link.get("handle") or link.get("display_name") or link.get("external_id") or "")[:120], "confirmed": True,
               "external_id": str(link.get("external_id") or "")[:120]}
    return await client.put_my_account(access["params"], network, payload)


async def share(db, user: dict, network: str, on: bool) -> dict:
    """In die Akte übernehmen (an) oder dort herausnehmen (aus) - nur geprüfte Konten der Website."""
    if network not in PLATFORM_FOR:
        raise AccountsError(404, "Dieses Netzwerk prüft die Website nicht.")
    access, client, reason = await _access(db, user["id"])
    if reason:
        raise AccountsError(409 if reason == "no_capability" else 403, REASON_TEXTS.get(reason, "Nicht möglich."))
    link = (await _website_links(db, user["id"])).get(network)
    if on and not link:
        raise AccountsError(409, "Erst das Konto auf der Website verknüpfen (Profil → Konten) – übernommen werden nur geprüfte Konten.")
    try:
        if on:
            await _put(client, access, network, link)
        else:
            await client.delete_my_account(access["params"], network)
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            reason = await _denied(db, access)
            raise AccountsError(403, REASON_TEXTS[reason]) from exc
        if exc.kind == "bad_request":
            raise AccountsError(400, f"Die Mitgliederakte kennt das Netzwerk „{LABELS.get(network, network)}“ nicht – der Vorstand nimmt es in Dolibarr ins "
                                     "Wörterbuch der sozialen Netzwerke auf.") from exc
        raise AccountsError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).") from exc
    field = f"dolibarr_accounts_shared.{network}"
    if on:
        await db.users.update_one({"id": user["id"]}, {"$set": {field: True, "updated_at": now_utc().isoformat()}})
    else:
        await db.users.update_one({"id": user["id"]}, {"$unset": {field: ""}, "$set": {"updated_at": now_utc().isoformat()}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "dolibarr.accounts.share" if on else "dolibarr.accounts.unshare",
                                    "actor_id": user["id"], "target_id": user["id"], "data": {"network": network}, "created_at": now_utc().isoformat()})
    return await overview(db, user)


async def follow_platform(db, user_id: str, platform: str, *, linked: dict | None) -> None:
    """Die Website hat ein Konto neu verknüpft oder getrennt: ein übernommenes folgt in der Akte (Name ersetzt, oder
    heraus). Nie ein Abbruch für die Verknüpfung - ein Fehler steht im Log, der nächste Schalter holt es nach."""
    network = NETWORKS.get(platform)
    if not network:
        return
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "dolibarr_accounts_shared": 1})
    if not ((user or {}).get("dolibarr_accounts_shared") or {}).get(network):
        return
    try:
        access, client, reason = await _access(db, user_id)
        if reason:
            return
        if linked:
            await _put(client, access, network, linked)
        else:
            await client.delete_my_account(access["params"], network)
            await db.users.update_one({"id": user_id}, {"$unset": {f"dolibarr_accounts_shared.{network}": ""}})
    except Exception as exc:  # noqa: BLE001 - die Verknüpfung auf der Website darf nie an Dolibarr scheitern
        logger.warning("[dolibarr] Konto %s in der Akte nicht nachgezogen: %s", network, exc)
