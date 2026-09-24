"""Katalog aller Mails, die die Website verschickt (#437 A): Zweck, Empfänger, Variablen, Beispieldaten.
Die festen Vorlagen leben als `tpl_*` in email_service; der Admin kann jede unter System → E-Mail-Vorlagen
überschreiben (Betreff und HTML mit `{{variable}}`), Vorschau mit Beispieldaten sehen, sich eine Testmail
schicken und auf den Standard zurücksetzen. Die Vorlagen aus der Datenbank (Bewerbung, Kontakt,
Moderation) laufen weiter über `render_template` in phase_ef_routes."""
from __future__ import annotations

import html as html_lib
import inspect
from typing import Any

from database import get_db
from models import now_utc

CATEGORIES = {
    "account": "Konto und Anmeldung",
    "tournament": "Turniere",
    "match": "Spiele und Erinnerungen",
    "prize": "Gewinne",
    "membership": "Mitgliedschaft",
    "community": "Community",
    "newsletter": "Newsletter",
    "club": "Verein und Moderation",
    "system": "System",
}

# key → Zweck (Alltagssprache), Empfänger, Kategorie. Die Variablen kommen aus der Signatur der tpl-Funktion
# (feste Vorlagen) bzw. aus `vars` der Datenbank-Vorlage.
CATALOG: dict[str, dict[str, str]] = {
    "registration": {"name": "Willkommen nach der Registrierung", "purpose": "Geht raus, sobald jemand ein Konto anlegt.", "recipient": "das neue Konto", "category": "account"},
    "email_verification": {"name": "E-Mail bestätigen", "purpose": "Link zum Bestätigen der E-Mail-Adresse nach der Registrierung oder einer Adressänderung.", "recipient": "das Konto", "category": "account"},
    "password_reset": {"name": "Passwort zurücksetzen", "purpose": "Link aus „Passwort vergessen“, eine Stunde gültig.", "recipient": "das Konto", "category": "account"},
    "user_invite": {"name": "Einladung zur Website", "purpose": "Ein Admin lädt eine Person ein, ein Konto anzulegen.", "recipient": "die eingeladene Adresse", "category": "account"},
    "membership_invited": {"name": "Einladung zum Mitgliedsantrag", "purpose": "Der Vorstand schaltet den Mitgliedsantrag für ein bestehendes Konto frei (#507).", "recipient": "das Konto", "category": "membership"},
    "registration_received": {"name": "Turnier: Anmeldung eingegangen", "purpose": "Bestätigung nach der Anmeldung zu einem Turnier.", "recipient": "der Spieler", "category": "tournament"},
    "registration_approved": {"name": "Turnier: Anmeldung angenommen", "purpose": "Die Turnierleitung hat die Anmeldung bestätigt.", "recipient": "der Spieler", "category": "tournament"},
    "registration_rejected": {"name": "Turnier: Anmeldung abgelehnt", "purpose": "Die Turnierleitung hat die Anmeldung abgelehnt – mit Grund, wenn einer angegeben ist.", "recipient": "der Spieler", "category": "tournament"},
    "checkin_opens_soon": {"name": "Turnier: Check-in öffnet bald", "purpose": "Erinnerung kurz bevor der Check-in öffnet.", "recipient": "angemeldete Spieler", "category": "tournament"},
    "checkin_reminder": {"name": "Turnier: Check-in offen", "purpose": "Der Check-in ist offen – bitte einchecken.", "recipient": "angemeldete Spieler ohne Check-in", "category": "tournament"},
    "checkin_closes_soon": {"name": "Turnier: Check-in schließt bald", "purpose": "Letzte Erinnerung vor dem Ende des Check-ins.", "recipient": "angemeldete Spieler ohne Check-in", "category": "tournament"},
    "tournament_finished": {"name": "Turnier beendet", "purpose": "Das Turnier ist zu Ende, Ergebnisse stehen fest.", "recipient": "alle Teilnehmer", "category": "tournament"},
    "match_reminder": {"name": "Spiel: Erinnerung", "purpose": "Das nächste Spiel steht an – mit Gegner, Zeit und Station.", "recipient": "beide Seiten des Spiels", "category": "match"},
    "match_lead_24h": {"name": "Spiel in 24 Stunden", "purpose": "Vorlauf-Erinnerung einen Tag vor dem Spiel.", "recipient": "beide Seiten des Spiels", "category": "match"},
    "match_lead_2h": {"name": "Spiel in 2 Stunden", "purpose": "Vorlauf-Erinnerung zwei Stunden vor dem Spiel.", "recipient": "beide Seiten des Spiels", "category": "match"},
    "match_lead_30m": {"name": "Spiel in 30 Minuten", "purpose": "Vorlauf-Erinnerung eine halbe Stunde vor dem Spiel.", "recipient": "beide Seiten des Spiels", "category": "match"},
    "match_lead_10m": {"name": "Spiel in 10 Minuten", "purpose": "Vorlauf-Erinnerung zehn Minuten vor dem Spiel.", "recipient": "beide Seiten des Spiels", "category": "match"},
    "match_lead_5m": {"name": "Spiel in 5 Minuten", "purpose": "Letzte Vorlauf-Erinnerung vor dem Spiel.", "recipient": "beide Seiten des Spiels", "category": "match"},
    "score_reported": {"name": "Ergebnis gemeldet", "purpose": "Die Gegenseite hat ein Ergebnis eingetragen – bitte bestätigen oder widersprechen.", "recipient": "die andere Seite des Spiels", "category": "match"},
    "dispute_opened": {"name": "Dispute eröffnet", "purpose": "Jemand hat dem Ergebnis widersprochen; die Turnierleitung entscheidet.", "recipient": "beide Seiten und die Turnierleitung", "category": "match"},
    "dispute_resolved": {"name": "Dispute entschieden", "purpose": "Die Turnierleitung hat den Streit entschieden.", "recipient": "beide Seiten des Spiels", "category": "match"},
    "prize_ready": {"name": "Gewinn liegt bereit", "purpose": "Ein Gewinn wartet auf die Abholung – mit Frist.", "recipient": "der Gewinner", "category": "prize"},
    "prize_picked_up": {"name": "Gewinn abgeholt", "purpose": "Bestätigung der Abholung.", "recipient": "der Gewinner", "category": "prize"},
    "prize_expired": {"name": "Gewinn verfallen", "purpose": "Die Abholfrist ist abgelaufen.", "recipient": "der Gewinner", "category": "prize"},
    "membership_activated": {"name": "Mitgliedschaft aktiv", "purpose": "Die Mitgliedschaft ist aktiv – mit Mitgliedsnummer.", "recipient": "das Mitglied", "category": "membership"},
    "membership_deactivated": {"name": "Mitgliedschaft beendet", "purpose": "Die Mitgliedschaft ist beendet oder ruht.", "recipient": "das Mitglied", "category": "membership"},
    "membership_blocked": {"name": "Mitgliedschaft gesperrt", "purpose": "Der Vorstand hat die Mitgliedschaft gesperrt.", "recipient": "das Mitglied", "category": "membership"},
    "membership_approve": {"name": "Bewerbung angenommen", "purpose": "Der Vorstand hat die Mitgliedsbewerbung angenommen.", "recipient": "der Bewerber", "category": "membership"},
    "membership_reject": {"name": "Bewerbung abgelehnt", "purpose": "Der Vorstand hat die Mitgliedsbewerbung abgelehnt.", "recipient": "der Bewerber", "category": "membership"},
    "membership_application_admin": {"name": "Neue Bewerbung (an den Vorstand)", "purpose": "Hinweis an Club-Admins, dass eine Bewerbung wartet.", "recipient": "Club-Admins und Superadmins", "category": "membership"},
    "birthday_greeting": {"name": "Geburtstagsgruß", "purpose": "Ein Gruß am Geburtstag, wenn das Datum im Profil steht.", "recipient": "das Konto", "category": "community"},
    "direct_message": {"name": "Neue Direktnachricht", "purpose": "Jemand hat eine Nachricht geschrieben (nur, wenn die Person Mails dazu zulässt).", "recipient": "der Empfänger der Nachricht", "category": "community"},
    "team_chat_mention": {"name": "Erwähnung im Team-Chat", "purpose": "Jemand hat die Person im Team-Chat erwähnt.", "recipient": "die erwähnte Person", "category": "community"},
    "newsletter_news": {"name": "Newsletter: News", "purpose": "Eine veröffentlichte News an alle mit Newsletter-Einwilligung.", "recipient": "Newsletter-Empfänger", "category": "newsletter"},
    "newsletter_event": {"name": "Newsletter: Event", "purpose": "Ein angekündigtes Event an alle mit Newsletter-Einwilligung.", "recipient": "Newsletter-Empfänger", "category": "newsletter"},
    "contact_auto_reply": {"name": "Kontakt: Eingangsbestätigung", "purpose": "Antwort an den Absender einer Nachricht über das Kontaktformular.", "recipient": "der Absender", "category": "club"},
    "moderation_notice": {"name": "Moderation: Hinweis", "purpose": "Ein Moderator hat eine Person auf eine Regel hingewiesen.", "recipient": "die betroffene Person", "category": "club"},
    "moderation_warning": {"name": "Moderation: Verwarnung", "purpose": "Verwarnung mit vorübergehender Chat-Sperre.", "recipient": "die betroffene Person", "category": "club"},
    "moderation_suspension": {"name": "Moderation: Sperre", "purpose": "Sperre des Kontos bis zur Entscheidung.", "recipient": "die betroffene Person", "category": "club"},
    "moderation_lifted": {"name": "Moderation: aufgehoben", "purpose": "Eine Maßnahme der Moderation ist aufgehoben.", "recipient": "die betroffene Person", "category": "club"},
    "ops_alert": {"name": "Betriebsalarm", "purpose": "Alarm aus Betrieb → Alarme (Serverfehler, Check rot, Abgleich rot …).", "recipient": "die Empfänger unter Betrieb → Alarme", "category": "system"},
    "test": {"name": "Testmail", "purpose": "Die Testmail aus den Einstellungen – prüft nur den Versandweg.", "recipient": "die eingegebene Adresse", "category": "system"},
}

# Beispielwerte je Variablenname - für Vorschau und Testmail.
SAMPLES: dict[str, str] = {
    "display_name": "Paula", "name": "Paula", "applicant": "Paula Beispiel", "invited_by": "Vorstand", "sender_name": "Max", "team_name": "Neon Kings",
    "tournament_title": "Mario Kart Winter Cup", "title": "Winter Clash 2026 – Anmeldung offen", "opponent": "Team Neon Kings", "station": "Station 3",
    "when": "Samstag, 04.10.2026, 18:00", "until": "18:30 Uhr", "deadline": "31.10.2026", "location": "Vereinsheim Innsbruck",
    "reason": "Beispielgrund", "decision": "Das Ergebnis 2:1 bleibt bestehen.", "place": "1. Platz", "prize_label": "Gutschein 50 €", "member_number": "TLS-2026-0007",
    "excerpt": "Mario Kart Winter Cup und Smash Showdown – jetzt anmelden!", "preview": "Bist du am Samstag dabei?", "note": "Wir freuen uns auf dich!",
    "url": "{origin}/tournaments/mario-kart-winter-cup", "verification_url": "{origin}/verify-email?token=beispiel", "reset_url": "{origin}/reset-password?token=beispiel",
    "invite_url": "{origin}/register?invite=beispiel", "preferences_url": "{origin}/profile", "appeal_url": "{origin}/contact", "branding": "THE LION SQUAD",
}


def _origin(branding: dict | None) -> str:
    domain = str((branding or {}).get("domain") or "lionsquad.at").strip().rstrip("/")
    return domain if domain.startswith("http") else f"https://{domain}"


def sample_value(var: str, origin: str) -> str:
    value = SAMPLES.get(var)
    if value is None:
        value = "Beispiel"
    return value.replace("{origin}", origin)


def code_templates() -> dict[str, Any]:
    """Die festen Vorlagen aus email_service - Name → Funktion."""
    import email_service

    return {name[4:]: fn for name, fn in inspect.getmembers(email_service, inspect.isfunction) if name.startswith("tpl_")}


def template_vars(key: str, fn: Any | None, db_doc: dict | None) -> list[str]:
    if fn is not None:
        return [p for p in inspect.signature(fn).parameters]
    if db_doc and isinstance(db_doc.get("vars"), list):
        return [str(v) for v in db_doc["vars"]]
    return []


def substitute(text: str, values: dict[str, str], escape: bool) -> str:
    out = text or ""
    for k, v in values.items():
        v_str = "" if v is None else str(v)
        out = out.replace("{{" + k + "}}", html_lib.escape(v_str, quote=True) if escape else v_str.replace("\r", " ").replace("\n", " "))
    return out


async def apply_override(template_key: str, subject: str, html: str, values: dict[str, Any]) -> tuple[str, str]:
    """Hat der Admin eine feste Vorlage überschrieben, gilt sein Betreff/HTML mit den Werten des Versands."""
    db = get_db()
    doc = await db.email_templates.find_one({"key": template_key, "override": True}, {"_id": 0, "subject": 1, "html": 1})
    if not doc or not (doc.get("html") or "").strip():
        return subject, html
    return substitute(doc.get("subject") or subject, values, escape=False), substitute(doc["html"], values, escape=True)


async def render(db, key: str, *, subject: str | None = None, html: str | None = None, values: dict[str, str] | None = None) -> dict:
    """Vorschau: Entwurf (subject/html) oder gespeicherter Stand oder feste Vorlage - mit Beispieldaten."""
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1, "club_name": 1}) or {}
    origin = _origin(branding)
    fns = code_templates()
    fn = fns.get(key)
    doc = await db.email_templates.find_one({"key": key}, {"_id": 0})
    variables = template_vars(key, fn, doc)
    sample = {v: sample_value(v, origin) for v in variables}
    if values:
        sample.update({k: str(v) for k, v in values.items() if k in variables})
    draft_html = html if html is not None else (doc.get("html") if doc and (fn is None or doc.get("override")) else None)
    draft_subject = subject if subject is not None else (doc.get("subject") if doc and (fn is None or doc.get("override")) else None)
    if draft_html is not None and str(draft_html).strip():
        return {"subject": substitute(draft_subject or "", sample, escape=False), "html": substitute(draft_html, sample, escape=True), "vars": variables, "sample": sample, "source": "custom"}
    if fn is not None:
        kwargs = {v: sample[v] for v in variables}
        if key == "test":
            kwargs = {"branding": branding.get("club_name") or sample.get("branding", "THE LION SQUAD")}
        rendered_subject, rendered_html = fn(**kwargs)
        return {"subject": rendered_subject, "html": rendered_html, "vars": variables, "sample": sample, "source": "code"}
    if doc:
        return {"subject": substitute(doc.get("subject") or "", sample, escape=False), "html": substitute(doc.get("html") or "", sample, escape=True), "vars": variables, "sample": sample, "source": "db"}
    return {"subject": "", "html": "", "vars": variables, "sample": sample, "source": "missing"}


async def list_templates(db, defaults: list[dict]) -> list[dict]:
    """Alle Mails der Website mit Zweck, Empfänger, Variablen und Stand (Standard oder angepasst)."""
    fns = code_templates()
    docs = {d["key"]: d for d in await db.email_templates.find({}, {"_id": 0}).to_list(200)}
    default_by_key = {d["key"]: d for d in defaults}
    rows = []
    for key, meta in CATALOG.items():
        fn = fns.get(key)
        doc = docs.get(key)
        if fn is None and doc is None and key not in default_by_key and key != "ops_alert":
            continue
        variables = template_vars(key, fn, doc or default_by_key.get(key))
        if key == "ops_alert":
            variables = []
        if fn is not None:
            custom = bool(doc and doc.get("override") and (doc.get("html") or "").strip())
            source = "code"
        else:
            base = default_by_key.get(key) or {}
            custom = bool(doc and base and ((doc.get("subject") != base.get("subject")) or (doc.get("html") != base.get("html"))))
            source = "db"
        rows.append({
            "key": key, "name": meta["name"], "purpose": meta["purpose"], "recipient": meta["recipient"],
            "category": meta["category"], "category_label": CATEGORIES[meta["category"]], "vars": variables,
            "source": source, "custom": custom, "editable": key != "ops_alert",
            "subject": (doc or {}).get("subject") if (doc and (fn is None or doc.get("override"))) else None,
            "html": (doc or {}).get("html") if (doc and (fn is None or doc.get("override"))) else None,
            "updated_at": (doc or {}).get("updated_at"),
        })
    return rows


async def save_override(db, key: str, defaults: list[dict], *, subject: str | None, html: str | None, name: str | None, actor_id: str | None) -> dict:
    fns = code_templates()
    if key not in CATALOG or key == "ops_alert":
        raise ValueError("Diese Vorlage gibt es nicht.")
    doc = {"updated_at": now_utc().isoformat(), "updated_by": actor_id}
    if subject is not None:
        doc["subject"] = str(subject).strip()[:300]
    if html is not None:
        doc["html"] = str(html)[:50000]
    if name is not None:
        doc["name"] = str(name).strip()[:120]
    if key in fns:
        doc["override"] = True
        await db.email_templates.update_one({"key": key}, {"$set": doc, "$setOnInsert": {"id": key, "key": key, "created_at": now_utc().isoformat()}}, upsert=True)
    else:
        res = await db.email_templates.update_one({"key": key}, {"$set": doc})
        if res.matched_count == 0:
            raise ValueError("Vorlage nicht gefunden.")
    return await db.email_templates.find_one({"key": key}, {"_id": 0})


async def reset_template(db, key: str, defaults: list[dict]) -> dict:
    """Feste Vorlage: Überschreibung weg. Datenbank-Vorlage: Standardtext von der Erstinstallation zurück."""
    fns = code_templates()
    if key in fns:
        await db.email_templates.delete_one({"key": key})
        return {"ok": True, "source": "code"}
    base = next((d for d in defaults if d["key"] == key), None)
    if not base:
        raise ValueError("Diese Vorlage gibt es nicht.")
    await db.email_templates.update_one({"key": key}, {"$set": {**base, "updated_at": now_utc().isoformat()}}, upsert=True)
    return {"ok": True, "source": "db"}
