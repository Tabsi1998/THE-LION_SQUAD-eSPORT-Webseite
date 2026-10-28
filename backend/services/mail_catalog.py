"""Katalog aller Mails, die die Website verschickt (#437 A): Zweck, Empfänger, Variablen, Beispieldaten.
Die festen Vorlagen leben als `tpl_*` in email_service; der Admin kann jede unter System → E-Mail-Vorlagen
überschreiben (Betreff und HTML mit `{{variable}}`), Vorschau mit Beispieldaten sehen, sich eine Testmail
schicken und auf den Standard zurücksetzen. Die Vorlagen aus der Datenbank (Bewerbung, Kontakt,
Moderation) laufen weiter über `render_template` in phase_ef_routes."""
from __future__ import annotations

import inspect
from typing import Any

from models import now_utc
from services.mail_overrides import substitute  # noqa: F401 - umgezogen (#1420), hier weiter erreichbar

CATEGORIES = {
    "account": "Konto und Anmeldung",
    "tournament": "Turniere",
    "match": "Spiele und Erinnerungen",
    "prize": "Gewinne",
    "membership": "Mitgliedschaft",
    "billing": "Rechnungen",
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
    "account_banned": {"name": "Konto gesperrt", "purpose": "Die Vereinsverwaltung oder der Superadmin hat das Konto gesperrt – die Mail nennt den Grund (#1357).", "recipient": "das gesperrte Konto", "category": "account"},
    "membership_invited": {"name": "Einladung zum Mitgliedsantrag", "purpose": "Der Vorstand schaltet den Mitgliedsantrag für ein bestehendes Konto frei (#507).", "recipient": "das Konto", "category": "membership"},
    "registration_received": {"name": "Turnier: Anmeldung eingegangen", "purpose": "Die Anmeldung wartet auf die Freigabe der Turnierleitung oder steht auf der Warteliste.", "recipient": "die Verantwortlichen der Anmeldung (bei Teams Teamleitung und Co-Leitung)", "category": "tournament"},
    "registration_approved": {"name": "Turnier: Anmeldung bestätigt", "purpose": "Die Anmeldung ist bestätigt – direkt bei der Anmeldung, durch die Turnierleitung oder beim Nachrücken von der Warteliste; mit Hinweis zum Check-in.", "recipient": "die Verantwortlichen der Anmeldung (bei Teams Teamleitung und Co-Leitung)", "category": "tournament"},
    "registration_rejected": {"name": "Turnier: Anmeldung abgelehnt", "purpose": "Die Turnierleitung hat die Anmeldung abgelehnt – mit Grund, wenn einer angegeben ist.", "recipient": "die Verantwortlichen der Anmeldung (bei Teams Teamleitung und Co-Leitung)", "category": "tournament"},
    "checkin_closes_soon": {"name": "Turnier: Check-in schließt bald", "purpose": "Letzte Erinnerung vor dem Ende des Check-ins – mit „Jetzt einchecken“.", "recipient": "die Verantwortlichen jeder Anmeldung ohne Check-in", "category": "tournament"},
    "checkin_closes_soon_on_site": {"name": "Turnier vor Ort: Check-in schließt bald", "purpose": "Letzte Erinnerung bei Vor-Ort-Turnieren: bis wann man sich bei der Turnierleitung meldet – ohne Knopf zum Einchecken.", "recipient": "die Verantwortlichen jeder Anmeldung ohne Check-in", "category": "tournament"},
    "tournament_cancelled": {"name": "Turnier abgesagt", "purpose": "Die Turnierleitung hat das Turnier abgesagt – mit Grund, wenn einer angegeben ist (#2120). Nur, wenn die Person Mails zu Turnier-Updates zulässt.", "recipient": "alle Spieler der Anmeldungen, die noch mitspielen wollten (ausstehend, bestätigt, eingecheckt, Warteliste)", "category": "tournament"},
    "event_cancelled": {"name": "Event abgesagt", "purpose": "Das Event ist abgesagt; Anmeldung und Warteliste sind storniert (#2118). Nur, wenn die Person Mails zu Turnier-Updates zulässt.", "recipient": "die Angemeldeten und die Warteliste des Events (je Person einmal)", "category": "tournament"},
    "tournament_finished": {"name": "Turnier beendet", "purpose": "Das Turnier ist beendet – Platzierungen und Ergebnisse stehen auf der Turnierseite.", "recipient": "alle Spieler der bestätigten Anmeldungen", "category": "tournament"},
    "match_reminder": {"name": "Spiel startet jetzt", "purpose": "Die Turnierleitung hat das Spiel an der Station gestartet – mit Spiel und Station. Den Aufruf beim Reservieren gibt es im Postfach und per Push.", "recipient": "alle Spieler des Spiels (bei Teams jedes Mitglied)", "category": "match"},
    "match_lead_10m": {"name": "Spiel in 10 Minuten", "purpose": "Erinnerung zehn Minuten vor dem Spiel (nicht vor Ort mit festen Zeiten – dort ruft die Turnierleitung auf).", "recipient": "alle Spieler des Spiels", "category": "match"},
    "score_reported": {"name": "Ergebnis gemeldet", "purpose": "Die Gegenseite hat ihr Ergebnis gemeldet – bitte bestätigen oder anders melden.", "recipient": "die andere Seite des Spiels (bei Teams Teamleitung und Co-Leitung)", "category": "match"},
    "dispute_opened": {"name": "Dispute gemeldet", "purpose": "Jemand hat dem Ergebnis widersprochen; die Turnierleitung prüft und entscheidet. Die Turnierleitung selbst bekommt sofort eine Nachricht im Postfach und per Push.", "recipient": "die anderen Spieler des Spiels (bei Teams jedes Mitglied)", "category": "match"},
    "dispute_resolved": {"name": "Dispute entschieden", "purpose": "Die Turnierleitung hat den Dispute entschieden – mit dem Ergebnis.", "recipient": "alle Spieler des Spiels (bei Teams jedes Mitglied)", "category": "match"},
    "prize_ready": {"name": "Gewinn liegt bereit", "purpose": "Ein Gewinn wartet auf die Abholung – mit Frist.", "recipient": "der Gewinner", "category": "prize"},
    "prize_picked_up": {"name": "Gewinn abgeholt", "purpose": "Bestätigung der Abholung.", "recipient": "der Gewinner", "category": "prize"},
    "prize_expired": {"name": "Gewinn verfallen", "purpose": "Die Abholfrist ist abgelaufen.", "recipient": "der Gewinner", "category": "prize"},
    "membership_activated": {"name": "Mitgliedschaft aktiv", "purpose": "Die Mitgliedschaft ist aktiv – mit Mitgliedsnummer.", "recipient": "das Mitglied", "category": "membership"},
    "membership_deactivated": {"name": "Mitgliedschaft beendet", "purpose": "Die Mitgliedschaft ist beendet oder ruht.", "recipient": "das Mitglied", "category": "membership"},
    "membership_blocked": {"name": "Mitgliedschaft gesperrt", "purpose": "Der Vorstand hat die Mitgliedschaft gesperrt.", "recipient": "das Mitglied", "category": "membership"},
    "membership_approve": {"name": "Bewerbung angenommen", "purpose": "Der Vorstand hat die Mitgliedsbewerbung angenommen.", "recipient": "der Bewerber", "category": "membership"},
    "membership_reject": {"name": "Bewerbung abgelehnt", "purpose": "Der Vorstand hat die Mitgliedsbewerbung abgelehnt.", "recipient": "der Bewerber", "category": "membership"},
    "membership_application_admin": {"name": "Neue Bewerbung (an den Vorstand)", "purpose": "Hinweis an Club-Admins, dass eine Bewerbung wartet.", "recipient": "Club-Admins und Superadmins", "category": "membership"},
    "jersey_number_request_admin": {"name": "Antrag auf eine andere Nummer (an den Vorstand)", "purpose": "Ein Mitglied möchte eine andere Wunschnummer (#2034) – ohne die Nummer selbst; der Antrag steht im Admin unter Mitglieder → Nummern.", "recipient": "Club-Admins und Superadmins", "category": "membership"},
    "invoice_ready": {"name": "Deine Rechnung ist da", "purpose": "Sobald eine Event- oder Turnierrechnung freigegeben ist (#841) – mit Betrag, Zahlungsziel und Link ins Konto, ohne Anhang.", "recipient": "die Person, die angemeldet hat", "category": "billing"},
    "birthday_greeting": {"name": "Geburtstagsgruß", "purpose": "Ein Gruß am Geburtstag, wenn das Datum im Profil steht.", "recipient": "das Konto", "category": "community"},
    "achievement_recap": {"name": "Wochenrückblick Erfolge", "purpose": "Montags 09:00 an alle, die in der Woche XP oder Erfolge gesammelt haben – abbestellbar.", "recipient": "das Konto", "category": "community"},
    "direct_message": {"name": "Neue Direktnachricht", "purpose": "Jemand hat eine Nachricht geschrieben (nur, wenn die Person Mails dazu zulässt).", "recipient": "der Empfänger der Nachricht", "category": "community"},
    "team_chat_mention": {"name": "Erwähnung im Team-Chat", "purpose": "Jemand hat die Person im Team-Chat erwähnt.", "recipient": "die erwähnte Person", "category": "community"},
    "event_message": {"name": "Event: Nachricht an alle", "purpose": "Die Turnierleitung schreibt allen Angemeldeten eines Events (Seite „Anmeldungen & Einlass“, #1372) – nur, wenn die Person Mails zu Turnier-Updates zulässt.", "recipient": "die Angemeldeten des Events (je Person einmal)", "category": "tournament"},
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
    "display_name": "Paula", "name": "Paula", "applicant": "Paula Beispiel", "member": "Paula Beispiel", "invited_by": "Vorstand", "sender_name": "Max", "team_name": "Neon Kings",
    "tournament_title": "Mario Kart Winter Cup", "title": "Winter Clash 2026 – Anmeldung offen", "opponent": "Team Neon Kings", "station": "Station 3",
    "when": "Samstag, 04.10.2026, 18:00", "until": "18:30 Uhr", "deadline": "31.10.2026", "location": "Vereinsheim Innsbruck",
    "reason": "Beispielgrund", "decision": "Das Ergebnis 2:1 bleibt bestehen.", "summary": "Neon Kings gewinnt 2:1.", "place": "1. Platz", "prize_label": "Gutschein 50 €", "member_number": "TLS-2026-0007",
    "event_name": "Herbst-LAN 2026", "message": "Der Parkplatz ist gesperrt – bitte den Hintereingang nehmen.",
    "excerpt": "Mario Kart Winter Cup und Smash Showdown – jetzt anmelden!", "preview": "Bist du am Samstag dabei?", "note": "Wir freuen uns auf dich!",
    "url": "{origin}/tournaments/mario-kart-winter-cup", "verification_url": "{origin}/verify-email?token=beispiel", "reset_url": "{origin}/reset-password?token=beispiel",
    "invite_url": "{origin}/register?invite=beispiel", "preferences_url": "{origin}/profile", "appeal_url": "{origin}/contact", "branding": "THE LION SQUAD",
    # Rechnung ist da (#841)
    "source": "Weihnachtsfeier", "amount": "40,00 €", "due_on": "17.10.2026", "paid": "",
    # Wochenrückblick (#622)
    "week": "29.09. – 05.10.2026", "xp_week": "240", "level": "12", "level_title": "Rudel", "unlocked": "Champion III (Gold)\nFrühaufsteher I (Bronze)",
    "next_up": "Turnierspieler II – noch 2", "bonus_hint": "Vereinsmitglieder bekommen 10 % mehr XP auf alles.",
}


def _origin(branding: dict | None) -> str:
    domain = str((branding or {}).get("domain") or "lionsquad.at").strip().rstrip("/")
    return domain if domain.startswith("http") else f"https://{domain}"


def sample_value(var: str, origin: str) -> str:
    value = SAMPLES.get(var)
    if value is None:
        value = "Beispiel"
    return value.replace("{origin}", origin)


def placeholder(var: str) -> str:
    """Der Platzhalter, den der Admin im Editor sieht und der beim Versand ersetzt wird."""
    return "{{" + var + "}}"


def _placeholder_kwargs(variables: list[str]) -> dict[str, str]:
    # Optionale Teile einer festen Vorlage hängen an `if wert:`. Ein Platzhalter ist nie leer - nur wo das Beispiel
    # bewusst leer ist (`paid`: offene Rechnung statt „schon bezahlt“), bleibt der Wert leer, damit der häufige Fall
    # im Editor steht.
    return {v: "" if SAMPLES.get(v) == "" else placeholder(v) for v in variables}


def default_source(key: str, fn: Any | None, default_doc: dict | None) -> dict:
    """Der Standard einer Vorlage mit `{{variable}}` statt Beispieldaten (#2119 ML1) - Ausgangspunkt im Editor."""
    if fn is not None:
        variables = template_vars(key, fn, None)
        kwargs = {"branding": "THE LION SQUAD"} if key == "test" else _placeholder_kwargs(variables)
        subject, html = fn(**kwargs)
        return {"subject": subject, "html": html}
    if default_doc:
        return {"subject": default_doc.get("subject") or "", "html": default_doc.get("html") or ""}
    return {"subject": "", "html": ""}


def _sample_needles(variables: list[str], origin: str) -> list[str]:
    """Beispielwerte, die in einer gespeicherten Vorlage nichts verloren haben. Zu kurze Werte und reine Zahlen
    („12“, „240“) wären Zufallstreffer; der Ersatzwert „Beispiel“ für unbekannte Variablen steht in „zum Beispiel“."""
    needles: list[str] = []
    for var in variables:
        raw = SAMPLES.get(var)
        if not raw:
            continue
        for line in raw.replace("{origin}", origin).splitlines():
            line = line.strip()
            if len(line) >= 4 and not line.isdigit() and line not in needles:
                needles.append(line)
    return needles


def sample_leaks(subject: str | None, html: str | None, variables: list[str], origin: str, default: dict | None = None) -> list[str]:
    """Welche Beispielwerte der Vorschau im gespeicherten Text stehen (#2119 ML1). Werte, die schon der Standard
    selbst enthält („Vorstand“, „Rudel“), zählen nicht - die stehen dort mit Absicht."""
    import html as html_lib

    text = f"{subject or ''}\n{html or ''}"
    baseline = f"{(default or {}).get('subject') or ''}\n{(default or {}).get('html') or ''}"
    found = []
    for needle in _sample_needles(variables, origin):
        forms = {needle, html_lib.escape(needle, quote=True)}
        if any(form in text for form in forms) and not any(form in baseline for form in forms):
            found.append(needle)
    return found


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


def _template_state(key: str, fn: Any | None, doc: dict | None, default_doc: dict | None, origin: str) -> dict:
    """Stand einer Vorlage: Variablen, ob angepasst, der Text mit Platzhaltern und gespeicherte Beispielwerte."""
    variables = [] if key == "ops_alert" else template_vars(key, fn, doc or default_doc)
    stored = bool(doc and (fn is None or doc.get("override")))
    if fn is not None:
        custom = bool(stored and (doc.get("html") or "").strip())
        source = "code"
    else:
        base = default_doc or {}
        custom = bool(doc and base and ((doc.get("subject") != base.get("subject")) or (doc.get("html") != base.get("html"))))
        source = "db"
    default = default_source(key, fn, default_doc)
    leaks = sample_leaks(doc.get("subject"), doc.get("html"), variables, origin, default) if stored else []
    return {"vars": variables, "source": source, "custom": custom, "stored": stored, "default": default, "sample_leaks": leaks}


async def _origin_of(db) -> str:
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    return _origin(branding)


async def list_templates(db, defaults: list[dict]) -> list[dict]:
    """Alle Mails der Website mit Zweck, Empfänger, Variablen und Stand (Standard oder angepasst)."""
    fns = code_templates()
    docs = {d["key"]: d for d in await db.email_templates.find({}, {"_id": 0}).to_list(200)}
    default_by_key = {d["key"]: d for d in defaults}
    origin = await _origin_of(db)
    rows = []
    for key, meta in CATALOG.items():
        fn = fns.get(key)
        doc = docs.get(key)
        if fn is None and doc is None and key not in default_by_key and key != "ops_alert":
            continue
        state = _template_state(key, fn, doc, default_by_key.get(key), origin)
        rows.append({
            "key": key, "name": meta["name"], "purpose": meta["purpose"], "recipient": meta["recipient"],
            "category": meta["category"], "category_label": CATEGORIES[meta["category"]], "vars": state["vars"],
            "source": state["source"], "custom": state["custom"], "editable": key != "ops_alert",
            "subject": (doc or {}).get("subject") if state["stored"] else None,
            "html": (doc or {}).get("html") if state["stored"] else None,
            "updated_at": (doc or {}).get("updated_at"),
            # Beispielwerte aus der Vorschau im gespeicherten Text (#2119 ML1) - gingen so an alle Empfänger.
            "sample_leaks": state["sample_leaks"],
        })
    return rows


async def editor_source(db, key: str, defaults: list[dict]) -> dict:
    """Was der Editor lädt (#2119 ML1): der geltende Text mit `{{variable}}` - nie die Vorschau mit Beispieldaten."""
    if key not in CATALOG or key == "ops_alert":
        raise ValueError("Diese Vorlage gibt es nicht.")
    fn = code_templates().get(key)
    doc = await db.email_templates.find_one({"key": key}, {"_id": 0})
    default_doc = next((d for d in defaults if d["key"] == key), None)
    if fn is None and doc is None and default_doc is None:
        raise ValueError("Diese Vorlage gibt es nicht.")
    state = _template_state(key, fn, doc, default_doc, await _origin_of(db))
    text = {"subject": doc.get("subject") or "", "html": doc.get("html") or ""} if state["stored"] and (fn is None or state["custom"]) else state["default"]
    return {"key": key, "subject": text["subject"], "html": text["html"], "vars": state["vars"], "source": state["source"],
            "custom": state["custom"], "sample_leaks": state["sample_leaks"]}


async def check_samples(db, key: str, defaults: list[dict], *, subject: str | None, html: str | None) -> list[str]:
    """Beispielwerte im Entwurf, der gespeichert werden soll - zusammen mit dem, was davon schon gespeichert ist."""
    fn = code_templates().get(key)
    doc = await db.email_templates.find_one({"key": key}, {"_id": 0}) or {}
    default_doc = next((d for d in defaults if d["key"] == key), None)
    stored = bool(doc) and (fn is None or doc.get("override"))
    merged_subject = subject if subject is not None else (doc.get("subject") if stored else None)
    merged_html = html if html is not None else (doc.get("html") if stored else None)
    variables = template_vars(key, fn, doc or default_doc)
    return sample_leaks(merged_subject, merged_html, variables, await _origin_of(db), default_source(key, fn, default_doc))


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
