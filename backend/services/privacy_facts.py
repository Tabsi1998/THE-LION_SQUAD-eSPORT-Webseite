"""Was die Datenschutzerklärung über den echten Betrieb sagen darf (Rechtliches II).

Die Erklärung stand bisher in der Möglichkeitsform („wenn Discord-Webhooks aktiviert sind …“).
Jetzt liest die Website die Schalter, die wirklich gesetzt sind, und die Seite zeigt nur die
Abschnitte, die zutreffen - mit konkretem Empfänger, Zweck und Rechtsgrundlage. Hier stehen nur
Ja/Nein und Anbieternamen, nie Schlüssel, Adressen oder Personendaten: die Antwort ist öffentlich.
"""
from __future__ import annotations

from services.auth_settings import load_auth_settings


def email_provider(email_settings: dict | None) -> str:
    """„smtp“ (eigener Mailserver), „resend“ (Dienstleister) oder „none“ - wie es der Versand wirklich macht."""
    doc = email_settings or {}
    provider = str(doc.get("provider") or "").strip().lower()
    if provider == "smtp" or (not provider and doc.get("smtp_host")):
        return "smtp" if doc.get("smtp_host") else "none"
    if provider == "resend" or doc.get("resend_api_key"):
        return "resend" if doc.get("resend_api_key") else "none"
    return "smtp" if doc.get("smtp_host") else "none"


def discord_facts(discord_settings: dict | None) -> dict:
    doc = discord_settings or {}
    targets = doc.get("targets") or {}
    webhooks = bool(doc.get("webhook_url")) or any(bool((entry or {}).get("webhook_url")) for entry in (targets.values() if isinstance(targets, dict) else []))
    return {"webhooks": webhooks, "bot": bool(doc.get("bot_enabled"))}


def facts_from(branding: dict | None, auth: dict | None, discord: dict | None, email: dict | None, dolibarr: dict | None) -> dict:
    """Reine Rechnung aus den Einstellungsdokumenten - ohne Geheimnisse."""
    b = branding or {}
    d = dolibarr or {}
    return {
        "analytics": str(b.get("analytics_provider") or "").strip().lower(),   # "", "google", "plausible"
        "google_login": bool((auth or {}).get("google_login_enabled")),
        "passkeys": True,                      # WebAuthn im eigenen Backend, kein Dritter
        "discord": discord_facts(discord),
        "twitch_embed": bool(str(b.get("twitch_channel") or "").strip()),
        "email_provider": email_provider(email),
        "dolibarr": str(d.get("mode") or "off") != "off",
        "dolibarr_billing": bool(d.get("write_enabled")),
        "app": {"push": True, "crash_reports": True, "app_lock": True},   # LionsAPP seit Build 70/72
        "hosting": {"provider": str(b.get("hosting_provider") or "").strip(), "country": str(b.get("hosting_country") or "").strip()},
    }


async def privacy_facts(db) -> dict:
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "analytics_provider": 1, "twitch_channel": 1, "hosting_provider": 1, "hosting_country": 1}) or {}
    discord = await db.settings.find_one({"id": "discord"}, {"_id": 0, "webhook_url": 1, "targets": 1, "bot_enabled": 1}) or {}
    email = await db.settings.find_one({"id": "email"}, {"_id": 0, "provider": 1, "smtp_host": 1, "resend_api_key": 1}) or {}
    dolibarr = await db.settings.find_one({"id": "dolibarr"}, {"_id": 0, "mode": 1, "write_enabled": 1}) or {}
    return facts_from(branding, await load_auth_settings(db), discord, email, dolibarr)
