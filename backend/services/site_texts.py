"""Texte, die Website und Crawler-Vorschau teilen (#545): Datenschutz, Impressum, Nutzungsbedingungen
und die Startseite - an einem Ort gebaut, aus den öffentlichen Vereinsdaten und den Schaltern, die
wirklich an sind (privacy_facts). Die Website rendert die Abschnitte, `/api/seo/preview` liefert
denselben Text als HTML. So sieht Google bei der OAuth-Prüfung die ganze Erklärung - vorher bekam ein
Crawler nur einen Satz und „Seite öffnen“, weil der Text erst im Browser entstand.

Blöcke: `p` (Absatz; **fett** und [Text](Adresse) erlaubt), `list` (Punkte), `info` (Begriff/Wert-Zeilen,
Wert auch mehrzeilig), `text` (freier Vereinstext, Zeilenumbrüche bleiben). Ein Block kann ein `testid`
tragen, damit Web-Tests denselben Namen benutzen wie früher. Abschnitte ohne Block fallen weg.
"""
from __future__ import annotations

import re
from html import escape

from services.public_site_settings import build_public_legal_settings

GOOGLE_USER_DATA_POLICY = "https://developers.google.com/terms/api-services-user-data-policy"
INLINE_RE = re.compile(r"(\*\*[^*]+\*\*|\[[^\]]+\]\((?:/|mailto:|https?://)[^)\s]+\))")
LINK_RE = re.compile(r"^\[([^\]]+)\]\(([^)]+)\)$")


# ---------------------------------------------------------------- Bausteine

def p(text: str, testid: str | None = None) -> dict:
    return {"type": "p", "text": text, **({"testid": testid} if testid else {})}


def lst(items: list[str], testid: str | None = None) -> dict:
    return {"type": "list", "items": [item for item in items if item], **({"testid": testid} if testid else {})}


def info(rows: list[tuple[str, object]]) -> dict | None:
    """Begriff/Wert-Zeilen; leere Werte fallen weg. Mehrzeilige Werte kommen als Liste."""
    kept = []
    for label, value in rows:
        if isinstance(value, (list, tuple)):
            value = [str(line) for line in value if line]
            if not value:
                continue
        elif value is None or str(value).strip() == "":
            continue
        kept.append([label, value])
    return {"type": "info", "rows": kept} if kept else None


def textbox(text: object) -> dict | None:
    value = str(text or "").strip()
    return {"type": "text", "text": value} if value else None


def section(sid: str, title: str, *blocks: dict | None) -> dict | None:
    kept = [block for block in blocks if block]
    return {"id": sid, "title": title, "blocks": kept} if kept else None


def link(label: str, href: str) -> str:
    return f"[{label}]({href})"


def mail(email: object) -> str:
    value = str(email or "").strip()
    return link(value, f"mailto:{value}") if value else ""


def site(url: object) -> str:
    value = str(url or "").strip()
    return link(value, value) if value else ""


def address_lines(legal: dict) -> list[str]:
    return [line for line in [
        legal.get("street_address"),
        legal.get("address_extra"),
        " ".join(part for part in [legal.get("postal_code"), legal.get("city")] if part),
        ", ".join(part for part in [legal.get("state"), legal.get("country")] if part),
    ] if line]


def _contact_or_form(legal: dict) -> str:
    email = legal.get("privacy_contact_email") or legal.get("contact_email")
    return mail(email) if email else link("das Kontaktformular", "/contact")


# ---------------------------------------------------------------- Datenschutz

def email_provider_text(provider: str) -> str:
    if provider == "resend":
        return ("Der Versand läuft über den E-Mail-Dienstleister Resend (Resend, Inc., USA). Übermittelt werden Empfängeradresse, "
                "Betreff und Inhalt der jeweiligen Nachricht; Resend ist Auftragsverarbeiter, Grundlage sind die EU-Standardvertragsklauseln (Art. 46 DSGVO).")
    if provider == "smtp":
        return "Der Versand läuft über einen eigenen Mailserver des Vereins. Ein Dienstleister erhält dabei keine Daten."
    return "Derzeit ist kein E-Mail-Versand eingerichtet; Systemnachrichten werden nicht per E-Mail verschickt."


def analytics_text(provider: str) -> str:
    if provider == "google":
        return ("Wir setzen Google Analytics 4 (Google Ireland Ltd.) ein – erst nach deiner Zustimmung im Cookie-Dialog. Erhoben werden gekürzte "
                "IP-Adresse, Seitenaufrufe, Gerät und Browser; Google kann die Daten in den USA verarbeiten (EU-Standardvertragsklauseln). "
                "Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), widerrufbar über die Cookie-Einstellungen.")
    if provider == "plausible":
        return ("Wir setzen Plausible Analytics ein – ohne Cookies und ohne Wiedererkennung einzelner Personen; erhoben werden Seitenaufrufe, "
                "Herkunftsseite, Land und Gerätetyp in aggregierter Form. Rechtsgrundlage ist unser berechtigtes Interesse an Reichweitenmessung (Art. 6 Abs. 1 lit. f DSGVO).")
    return "Wir setzen keinen Statistik- oder Tracking-Dienst ein. Es gibt keine Werbe-Cookies und kein Profiling."


def hosting_text(hosting: dict | None) -> str:
    provider = str((hosting or {}).get("provider") or "").strip()
    country = str((hosting or {}).get("country") or "").strip()
    if not provider and not country:
        return ""
    where = f" ({country})" if country else ""
    if provider.lower().startswith("eigen"):
        return f"Die Website läuft auf eigener Infrastruktur des Vereins{where}."
    return f"Die Website wird bei {provider}{where} betrieben; der Anbieter ist Auftragsverarbeiter."


def media_scan_text(provider: str) -> str:
    if provider == "google_vision":
        return "Dafür wird das Bild an Google Cloud Vision (Google Ireland Ltd.; EU-Standardvertragsklauseln) übermittelt und dort bewertet, aber nicht gespeichert."
    if provider and provider != "off":
        return "Die Prüfung läuft mit einem Erkennungsmodell auf unserem eigenen Server; kein Bild wird dafür an Dritte übermittelt."
    return ""


def _platforms(facts: dict) -> list[dict]:
    return [row for row in (facts.get("platforms") or []) if isinstance(row, dict) and row.get("key")]


def _google_data_section(facts: dict, club_name: str) -> dict | None:
    """Google verlangt für Google-Anmeldung und YouTube-Verknüpfung einen eigenen, klaren Abschnitt: was wir
    abfragen, was nicht, wie lange - und den Satz zur Google API Services User Data Policy (Limited Use)."""
    platforms = {row["key"]: row for row in _platforms(facts)}
    youtube = platforms.get("youtube")
    google_login = bool(facts.get("google_login"))
    if not youtube and not google_login:
        return None
    blocks = []
    if google_login:
        blocks.append(p("**Anmeldung mit Google:** Wir fragen bei Google nur E-Mail-Adresse, Name und die Konto-Kennung ab, um dein Konto "
                        "zuzuordnen. Google erfährt, dass du dich bei uns anmeldest. Die Verknüpfung lässt sich im Profil trennen.", "privacy-google-login-data"))
    if youtube:
        blocks.append(p("**YouTube-Verknüpfung:** Wer im Profil seinen YouTube-Kanal verknüpft, erlaubt uns einmalig lesenden Zugriff "
                        "(Google-Berechtigung „youtube.readonly“). Wir lesen damit nur Kanal-Kennung, Kanalname und Handle und speichern sie im Profil "
                        "– kein Zugriffstoken, keine Videos, keine Kommentare, keine Abonnements. Die Verknüpfung lässt sich im Profil jederzeit trennen; "
                        "den Zugriff kannst du außerdem unter https://myaccount.google.com/permissions widerrufen.", "privacy-youtube"))
    blocks.append(p(f"Die Nutzung von Informationen, die {club_name} über Google-APIs erhält, richtet sich nach der "
                    f"{link('Google API Services User Data Policy', GOOGLE_USER_DATA_POLICY)} einschließlich der Limited-Use-Anforderungen: "
                    "Wir nutzen Google-Nutzerdaten nur für die beschriebenen Funktionen, geben sie nicht weiter, verkaufen sie nicht, nutzen sie nicht "
                    "für Werbung und lassen sie nicht von Menschen lesen – außer mit deiner Einwilligung, zur Sicherheit oder wenn das Gesetz es verlangt.",
                    "privacy-google-limited-use"))
    return section("google", "Google-Nutzerdaten", *blocks)


def _platform_section(facts: dict) -> dict:
    platforms = _platforms(facts)
    if not platforms:
        return section("platform-links", "Verknüpfte Plattform-Konten",
                       p("Derzeit ist keine Plattform zum Verknüpfen eingerichtet; Social- und Gaming-Kennungen trägt man selbst im Profil ein.", "privacy-platform-links"))
    names = ", ".join(row["label"] for row in platforms)
    return section("platform-links", "Verknüpfte Plattform-Konten",
                   p(f"Wer im Profil ein Konto bei {names} verknüpft, meldet sich dafür bei der jeweiligen Plattform an. Die Website erhält "
                     "dabei nur die Kennung und den Nutzer- bzw. Anzeigenamen des Kontos und speichert sie zusammen mit dem Zeitpunkt der "
                     "Verknüpfung, um den Eintrag als verifiziert zu kennzeichnen. Keine Passwörter, keine Freundeslisten, keine Nachrichten. "
                     "Die Verknüpfung lässt sich im Profil jederzeit trennen; sie ist Teil des Datenexports und wird bei der Anonymisierung gelöscht.",
                     "privacy-platform-links"),
                   lst([f"{row['label']}: {row.get('delivers') or 'Kennung und Anzeigename'} – Betreiber: {row.get('operator') or row['label']}" for row in platforms],
                       "privacy-platform-list"))


def privacy_page(legal: dict, facts: dict) -> dict:
    f = facts or {}
    discord = f.get("discord") or {}
    media_scan = f.get("media_scan") or {}
    legal_source = legal.get("legal_source") or {}
    club_name = legal.get("legal_name") or legal.get("club_name") or "THE LION SQUAD"
    contact_email = legal.get("contact_email")
    privacy_email = legal.get("privacy_contact_email") or contact_email
    hosting = hosting_text(f.get("hosting"))
    platforms = _platforms(f)

    recipients = [f"Hosting und Datenbank: {hosting or 'eingesetzte Server und Backup-Speicher des Vereins'}"]
    if f.get("email_provider") == "resend":
        recipients.append("E-Mail-Versand: Resend, Inc. (Auftragsverarbeiter)")
    if f.get("email_provider") == "smtp":
        recipients.append("E-Mail-Versand: eigener Mailserver des Vereins")
    recipients.append("Push-Nachrichten und Absturzberichte der App: Google Ireland Ltd. (Firebase, Auftragsverarbeiter)")
    if f.get("google_login"):
        recipients.append("Anmeldung mit Google: Google Ireland Ltd.")
    if f.get("analytics") == "google":
        recipients.append("Statistik: Google Ireland Ltd. (Google Analytics, nur mit Einwilligung)")
    if f.get("analytics") == "plausible":
        recipients.append("Statistik: Plausible Insights OÜ (ohne Cookies)")
    if discord.get("channels") or discord.get("bot"):
        recipients.append("Discord Inc.: Vereinsserver (Meldungen, Bot)")
    if f.get("twitch_embed"):
        recipients.append("Twitch (Amazon): eingebetteter Stream, erst nach Zustimmung zu externen Medien")
    for row in platforms:
        recipients.append(f"Verknüpfung {row['label']}: {row.get('operator') or row['label']} (nur beim Verknüpfen, nur Kennung und Name)")
    if f.get("dolibarr"):
        recipients.append("Vereinsverwaltung Dolibarr: eigenes System des Vereins, kein Dritter")

    sections = [
        section("controller", "Verantwortlicher", info([
            ("Verantwortlicher", club_name), ("Adresse", address_lines(legal)), ("Website", site(legal.get("domain"))),
            ("Kontakt", mail(contact_email)), ("Datenschutz", mail(privacy_email)),
        ])),
        section("basis", "Grundsätze und Rechtsgrundlagen",
                p("Wir verarbeiten personenbezogene Daten ausschließlich auf Grundlage der DSGVO, des österreichischen Datenschutzgesetzes und "
                  "sonstiger anwendbarer Vorschriften. Maßgebliche Rechtsgrundlagen sind insbesondere Art. 6 Abs. 1 lit. b DSGVO für Vertrag, "
                  "Mitgliedschaft und vorvertragliche Maßnahmen, Art. 6 Abs. 1 lit. c DSGVO für rechtliche Pflichten, Art. 6 Abs. 1 lit. f DSGVO "
                  "für berechtigte Interessen sowie Art. 6 Abs. 1 lit. a DSGVO für Einwilligungen."),
                p("Berechtigte Interessen sind insbesondere sicherer Websitebetrieb, Missbrauchsschutz, Vereinsorganisation, nachvollziehbare "
                  "Turnierverwaltung, Kommunikation und technische Fehleranalyse.")),
        section("categories", "Kategorien personenbezogener Daten", lst([
            "Accountdaten: Benutzername, Anzeigename, E-Mail-Adresse, Passwort-Hash, Rollen, Login-Status.",
            "Profildaten: Avatar, Banner, Bio, Geburtsdatum, Ort, Land, Social- und Gaming-Handles.",
            "Mitgliedschaftsdaten: Antrag, Status, Mitgliedsnummer, Eintrittsdatum, Funktion, Verlauf.",
            "Turnier- und Eventdaten: Anmeldungen, Check-ins, Teams, Spiele, Ergebnisse, F1-Zeiten, Preise, Strafen.",
            "Zahlungs- und Nachweisdaten, sofern bei kostenpflichtigen Turnieren oder Mitgliedschaft erforderlich.",
            "Kommunikationsdaten: Kontaktformular, E-Mails, Systemnachrichten, Discord-Benachrichtigungen.",
            "Technische Daten: IP-Adresse, Zeitpunkte, Browser-/Request-Daten, Sicherheits- und Fehlerlogs.",
            "Uploads: Bilder, Dokumente und Nachweise, soweit Nutzer oder Admins sie bereitstellen.",
        ])),
        section("purposes", "Zwecke der Verarbeitung", lst([
            "Bereitstellung, Absicherung und Wartung der Website und API.",
            "Registrierung, Login, Rollen- und Rechteverwaltung.",
            "Organisation von Verein, Mitgliedschaft, Vorstand, Dokumenten und Mitgliederbereich.",
            "Organisation von Turnieren, Challenges, Teams, Events, Preisen und Ranglisten.",
            "Bearbeitung von Kontaktanfragen, Mitgliedsanträgen und Supportfällen.",
            "Versand von Systemmails, Passwort-Reset, Turnier- und Vereinsbenachrichtigungen.",
            "Erfüllung gesetzlicher Aufbewahrungs-, Nachweis- und Sicherheitsverpflichtungen.",
        ])),
        section("public-profiles", "Öffentliche Profile, Ranglisten und Achievements",
                p("Nutzerprofile, Ranglisten, Turnierergebnisse und Achievements können öffentlich sichtbar sein, soweit dies für Community- und "
                  "Wettbewerbsfunktionen vorgesehen ist. Nutzer können die Sichtbarkeit ihres öffentlichen Profils im Profilbereich einschränken. "
                  "Negative oder geheime Fun-/Negative-Achievements werden erst nach Freischaltung im Profil angezeigt."),
                p("Öffentliche Community-Profile registrierter Benutzer werden nicht in die Sitemap aufgenommen und mit einem technischen "
                  "Noindex-Hinweis für Suchmaschinen versehen. Sichtbar bleiben sie nur, wenn die Profilfreigabe aktiv ist. Offizielle "
                  "Vereinsmitglieder-Profile werden separat gepflegt und können als Teil der Vereinsdarstellung öffentlich auffindbar sein.")),
        section("crawlers", "Suchmaschinen und Crawler",
                p("Öffentliche Vereinsseiten, News, Events, Turniere, Fast-Lap-Challenges, Galerie, Teams, Sponsoren, Partner und offizielle "
                  "Vereinsmitglieder können von Suchmaschinen erfasst werden. Interne Bereiche, Accounts, private Mitgliederbereiche, Dokumente "
                  "sowie rechtliche Pflichtseiten werden nicht aktiv zur Indexierung eingereicht bzw. mit Noindex oder Zugriffsbeschränkungen versehen.")),
        section("documents", "Mitgliederdokumente",
                p("Dokumente im Mitgliederbereich sind nicht öffentlich. Sie sind nur für berechtigte Vorstands-/Adminrollen und aktive "
                  "Vereinsmitglieder vorgesehen. Standardmäßig werden Dokumente inline zur Ansicht bereitgestellt; ein Download wird nur angeboten, "
                  "wenn dies für das jeweilige Dokument freigegeben ist.")),
        section("forms", "Kontaktformular und Mitgliedsantrag",
                p("Angaben aus Formularen werden zur Bearbeitung der Anfrage, zur Kommunikation und zur Dokumentation verarbeitet. Bei "
                  "Mitgliedsanträgen werden die Daten zusätzlich zur Prüfung, Aufnahme und Verwaltung der Mitgliedschaft genutzt.")),
        section("account", "Konto und Anmeldung",
                p("Die Anmeldung läuft mit Benutzername und Passwort (Passwörter nur als Hash gespeichert), auf Wunsch mit einem **Passkey** "
                  "(WebAuthn): Der Schlüssel bleibt auf deinem Gerät oder in deinem Passwort-Manager, die Website speichert nur den öffentlichen "
                  "Teil und eine Kennung – kein Dritter ist beteiligt. Die optionale Zwei-Faktor-Anmeldung nutzt eine Authenticator-App auf deinem Gerät.",
                  "privacy-account"),
                p("Zusätzlich bieten wir **„Mit Google anmelden“** an (Google Ireland Ltd.). Dabei erhalten wir von Google nur E-Mail-Adresse, Name "
                  "und eine Konto-Kennung, um dein Konto zuzuordnen; Google erfährt, dass du dich bei uns anmeldest. Rechtsgrundlage ist die "
                  "Erfüllung des Nutzungsverhältnisses (Art. 6 Abs. 1 lit. b DSGVO); die Verknüpfung lässt sich im Profil trennen.",
                  "privacy-google-login") if f.get("google_login") else
                p("Eine Anmeldung über Google oder andere Anbieter bieten wir nicht an.", "privacy-no-google-login")),
        section("email", "E-Mail-Versand",
                p("Systemmails (Bestätigung, Passwort-Reset, Mitgliedschaft, Turnier- und Vereinsnachrichten) enthalten Empfängeradresse, Betreff "
                  f"und Inhalt; Versandzeitpunkt und -status werden für die Fehlersuche kurz protokolliert. {email_provider_text(f.get('email_provider') or 'none')}",
                  "privacy-email")),
        section("discord", "Discord",
                p("Ereignisse des Vereins – neue Turniere, Events, News und Ergebnisse – postet unser Vereins-Bot automatisch in Kanäle "
                  "unseres Discord-Servers (Discord Inc., USA; EU-Standardvertragsklauseln). Dabei gehen nur die auf der Website ohnehin "
                  "öffentlichen Angaben mit: Anzeigenamen, Teamnamen, Ergebnisse, Bilder der Beiträge. Interne Vereinsinhalte werden nur in "
                  "interne Kanäle gepostet.", "privacy-discord-channels") if discord.get("channels") else None,
                p("Auf unserem Discord-Server läuft der Vereins-Bot. Er zählt für Mitglieder, die ihr Discord-Konto im Profil verknüpft haben, "
                  "die **Anzahl** ihrer Nachrichten (nie den Inhalt – der Bot hat kein Recht, Nachrichten zu lesen), gleicht die Rollen "
                  "„Mitglied“, „Vorstand“ und „Turnierleitung“ mit dem Vereinsstand ab und beantwortet Befehle wie „nächstes Event“. Nicht "
                  "verknüpfte Konten werden ignoriert. Grundlage ist unser berechtigtes Interesse an einer gepflegten Community (Art. 6 Abs. 1 "
                  "lit. f DSGVO); die Verknüpfung lässt sich jederzeit im Profil trennen.", "privacy-discord-bot") if discord.get("bot") else None),
        _platform_section(f),
        _google_data_section(f, club_name),
        section("media-scan", "Automatische Bildprüfung",
                p("Bilder, die Nutzer hochladen (Chat-Anhänge, Profil- und Teambilder), werden automatisch auf Nacktheit und Gewalt geprüft, "
                  f"bevor oder kurz nachdem sie sichtbar werden. {media_scan_text(str(media_scan.get('provider') or ''))} Auffällige Bilder sieht "
                  "nur die Moderation des Vereins; entfernte Originale werden nach einer Aufbewahrungsfrist endgültig gelöscht. Grundlage sind "
                  "unser berechtigtes Interesse an einer sicheren Community und der Jugendschutz (Art. 6 Abs. 1 lit. f DSGVO); gegen eine "
                  "Entscheidung kann man sich bei der Moderation melden.", "privacy-media-scan") if media_scan.get("enabled") else None),
        section("dolibarr", "Mitgliederverwaltung",
                p("Mitgliedschaft, Beiträge, Funktionen und Vereinsdokumente verwalten wir in unserer eigenen Vereinsverwaltung (Dolibarr) auf "
                  "einem System des Vereins – kein Dritter. Die Website liest daraus nur, was sie für den Mitgliederbereich braucht "
                  "(Mitgliedsstand, Beitragsstand, eigene Belege, freigegebene Dokumente), und nur für die angemeldete Person selbst.", "privacy-dolibarr"),
                p("Für kostenpflichtige Events und Startgelder legt die Website dort Rechnungen an (Name, E-Mail, Vorgang, Betrag); Belege "
                  "bleiben nach dem Steuerrecht sieben Jahre in der Buchhaltung, auch nach einer Kontolöschung.", "privacy-dolibarr-billing")
                if f.get("dolibarr_billing") else None,
                p("Auch Vereinsname, Anschrift, ZVR und vertretungsbefugte Person im Impressum kommen aus dieser Vereinsverwaltung.", "privacy-legal-source")
                if legal_source.get("dolibarr") else None) if f.get("dolibarr") else None,
        section("app", "LionsAPP",
                p("Die LionsAPP (Android) nutzt dasselbe Konto wie die Website und verarbeitet dieselben Daten. Zusätzlich: **Push-Nachrichten** "
                  "laufen über Firebase Cloud Messaging (Google Ireland Ltd.); dafür speichern wir ein Geräte-Token, das du in den Einstellungen "
                  "der App jederzeit abschalten kannst. **Absturzberichte** gehen an Firebase Crashlytics (Google Ireland Ltd.): Gerätemodell, "
                  "Android-Version, App-Version, Zeitpunkt und die Stelle im Programm – keine Namen, keine Nachrichten, keine Inhalte; Löschung "
                  "nach 90 Tagen; Google kann die Daten in den USA verarbeiten (EU-Standardvertragsklauseln, Art. 46 DSGVO); Grundlage ist unser "
                  "berechtigtes Interesse an einer stabilen App (Art. 6 Abs. 1 lit. f DSGVO). Die optionale App-Sperre (Fingerabdruck, Gesicht, "
                  "Gerätecode) prüft das Gerät selbst – biometrische Daten verlassen es nie. Das Konto lässt sich in der App löschen (siehe unten).",
                  "privacy-app")),
        section("hosting", "Hosting, Logs und Backups",
                p("Die Plattform verarbeitet Daten auf den eingesetzten Servern, Datenbanken und Backup-Speichern. Technische Logs dienen "
                  f"Sicherheit, Fehleranalyse und Betrieb.{' ' + hosting if hosting else ''}"),
                info([("Hosting / Betrieb", (f.get("hosting") or {}).get("provider")), ("Hosting-Region", (f.get("hosting") or {}).get("country"))])),
        section("cookies", "Cookies, Statistik und lokale Speicherung",
                p("Die Plattform verwendet technisch notwendige Cookies und lokale Speichermechanismen für Login, Session, Refresh-Token, "
                  "CSRF-Schutz und grundlegende Bedienfunktionen. Ohne diese Funktionen sind geschützte Bereiche nicht nutzbar. Tracking- oder "
                  "Marketing-Cookies sind für den Betrieb dieser Plattform nicht erforderlich."),
                p(analytics_text(str(f.get("analytics") or "")), "privacy-analytics")),
        section("recipients", "Empfänger und Auftragsverarbeiter",
                p("Daten erhalten nur die Stellen, die für den Betrieb nötig sind – und nur im nötigen Umfang. Stand heute:"),
                lst(recipients, "privacy-recipients"),
                p("Bei extern eingebundenen Diensten wie Discord, Twitch oder YouTube gelten zusätzlich die Datenschutzbedingungen der "
                  "jeweiligen Anbieter, sobald deren Inhalte geöffnet werden; eingebettete Player laden erst nach deiner Zustimmung zu externen Medien.")),
        section("retention", "Speicherdauer",
                p("Daten werden nur so lange gespeichert, wie es für die jeweiligen Zwecke erforderlich ist. Account- und Profildaten bestehen "
                  "grundsätzlich bis zur Löschung des Accounts. Turnier-, Vereins-, Zahlungs- und Nachweisdaten können länger gespeichert werden, "
                  "soweit berechtigte Interessen, Dokumentationspflichten oder gesetzliche Aufbewahrungspflichten bestehen. Technische Logs werden "
                  "regelmäßig begrenzt aufbewahrt.")),
        section("security", "Sicherheit",
                p("Passwörter werden nicht im Klartext gespeichert, sondern gehasht. Zugriffe auf geschützte Bereiche erfolgen rollenbasiert. "
                  "Zusätzlich kommen Schutzmaßnahmen wie CSRF-Schutz, Zugriffsbeschränkungen, private Dokumentansichten, optional freigegebene "
                  "Downloads, SMTP-Diagnose und Audit-Logs zum Einsatz.")),
        # Konto löschen (#390): öffentlich lesbar, weil Google Play einen Link dorthin verlangt - die Anker-ID bleibt.
        section("account-deletion", "Konto löschen",
                p("Du kannst dein Konto jederzeit selbst löschen – in der LionsAPP unter Profil → Einstellungen (Zahnrad) → „Konto löschen“, "
                  f"oder auf der Website nach der Anmeldung unter {link('Datenschutz → Meine Daten → „Account anonymisieren“', '/privacy-account')}. "
                  "Ein Login ist dafür nötig, damit niemand ein fremdes Konto löscht; wer sich nicht mehr anmelden kann, schreibt an "
                  f"{_contact_or_form(legal)}."),
                p("Gelöscht bzw. überschrieben werden Name, E-Mail-Adresse, Profiltexte, Bilder, verknüpfte Konten, Push-Geräte, Freundschaften "
                  "und Anmeldedaten; eigene Chatnachrichten werden als „gelöscht“ markiert. Erhalten bleiben Turnier-Ergebnisse ohne Namen "
                  "(sportliche Integrität) und – wenn du Rechnungen hattest – die Belege in der Vereinsbuchhaltung, weil das Steuerrecht sieben "
                  "Jahre Aufbewahrung verlangt; der Auftrag auf der Website behält dann nur Betrag und Belegnummer. Die Löschung wirkt sofort und "
                  "lässt sich nicht rückgängig machen.")),
        section("rights", "Betroffenenrechte",
                p("Betroffene Personen haben nach Maßgabe der DSGVO Rechte auf Information, Auskunft, Berichtigung, Löschung, Einschränkung, "
                  f"Datenübertragbarkeit, Widerspruch sowie Widerruf erteilter Einwilligungen. Zur Ausübung nutze bitte {_contact_or_form(legal)}."),
                p("Außerdem besteht das Recht auf Beschwerde bei der Österreichischen Datenschutzbehörde, Barichgasse 40-42, 1030 Wien, "
                  f"{link('www.dsb.gv.at', 'https://www.dsb.gv.at/')}.")),
        section("extra", "Ergänzende Datenschutzhinweise", textbox(legal.get("privacy_extra"))),
        section("changes", "Änderungen",
                p("Diese Datenschutzerklärung kann angepasst werden, wenn sich Funktionen, Dienstleister, Turnierformate oder rechtliche "
                  "Anforderungen ändern. Die jeweils aktuelle Fassung ist auf dieser Seite abrufbar.")),
    ]
    return _page("privacy", "Datenschutzerklärung", "Informationen zur Verarbeitung personenbezogener Daten auf dieser Vereinsplattform.", legal, sections)


# ---------------------------------------------------------------- Impressum

def imprint_page(legal: dict) -> dict:
    club_name = legal.get("club_name") or "THE LION SQUAD"
    legal_name = legal.get("legal_name") or club_name
    contact_email = legal.get("contact_email")
    privacy_email = legal.get("privacy_contact_email") or contact_email
    seat = legal.get("registered_seat")
    sections = [
        section("operator", "Medieninhaber und Betreiber", info([
            ("Verein", legal_name), ("Rechtsform", legal.get("legal_form")), ("ZVR-Zahl", legal.get("zvr_number")),
            ("Vereinssitz", seat or legal.get("city")), ("Adresse", address_lines(legal)), ("Website", site(legal.get("domain"))),
            ("E-Mail", mail(contact_email)), ("Telefon", legal.get("phone")),
        ])),
        section("representation", "Vertretung und Verantwortung", info([
            ("Vertretungsbefugt", legal.get("representative_name")), ("Funktion", legal.get("representative_role")),
            ("Inhaltlich verantwortlich", legal.get("content_responsible") or legal.get("representative_name")),
            ("Vereinsbehörde", legal.get("register_authority")),
        ])),
        section("direction", "Grundlegende Richtung",
                p(f"Diese Website ist das offizielle Informations- und Serviceangebot von {legal_name}. Sie informiert über den Verein, "
                  "Mitgliedschaft, Vorstand, Veranstaltungen, Community, eSports-Turniere, Fast-Lap-Challenges, Ranglisten, News, Sponsoren "
                  "und Kontaktmöglichkeiten."),
                p(f"{'Der Vereinssitz liegt in ' + str(seat) + '. ' if seat else ''}Die Vereinstätigkeit ist nicht auf Gewinn gerichtet, soweit "
                  "sich aus den Statuten nichts anderes ergibt.")),
        section("tournaments", "Turniere, Startgeld und Preise",
                p("Auf der Plattform können auch Turniere oder Veranstaltungen mit Startgeld, Sachpreisen oder sonstigen Gewinnen angekündigt "
                  "werden. Die konkreten Teilnahmebedingungen, Altersgrenzen, Regeln, Kosten, Zahlungsmodalitäten, Fristen und Preisbedingungen "
                  "ergeben sich jeweils aus der Turnier- oder Eventbeschreibung und den dort verlinkten Regeln."),
                p("Bezahlte Turniere können stattfinden. Die Website stellt dafür organisatorische Informationen bereit; die jeweilige "
                  "Ausschreibung ist für Details maßgeblich.") if legal.get("paid_tournaments_enabled") else
                p("Sofern kein Startgeld ausgewiesen ist, ist die Teilnahme kostenlos. Bezahlte Formate werden gesondert und transparent in der "
                  "jeweiligen Ausschreibung gekennzeichnet."),
                p(f"Aktuelle Teilnahmebedingungen: {site(legal.get('tournament_terms_url'))}") if legal.get("tournament_terms_url") else None),
        section("vat", "UID und wirtschaftliche Angaben", info([("UID-Nummer", legal.get("vat_number"))])),
        section("liability", "Haftung und externe Links",
                p("Die Inhalte dieser Website werden mit Sorgfalt erstellt und gepflegt. Für Aktualität, Richtigkeit und Vollständigkeit wird, "
                  "soweit gesetzlich zulässig, keine Gewähr übernommen. Inhalte können sich kurzfristig ändern, insbesondere bei Turnieren, "
                  "Events, Ranglisten und organisatorischen Hinweisen."),
                p("Diese Website kann Links zu externen Angeboten enthalten. Für externe Inhalte sind ausschließlich deren Betreiber "
                  "verantwortlich. Bei Bekanntwerden rechtswidriger Inhalte werden entsprechende Links entfernt.")),
        section("copyright", "Urheberrecht",
                p("Texte, Bilder, Grafiken, Logos, Videos, Turnierdaten und sonstige Inhalte dieser Website unterliegen, soweit nicht anders "
                  "angegeben, dem Urheberrecht bzw. den Nutzungsrechten des Vereins oder der jeweiligen Rechteinhaber. Eine Verwendung außerhalb "
                  "der gesetzlich erlaubten Fälle bedarf der vorherigen Zustimmung.")),
        section("privacy-contact", "Datenschutzkontakt",
                p(f"Datenschutzanfragen können an {mail(privacy_email)} gerichtet werden. Weitere Informationen stehen in der "
                  f"{link('Datenschutzerklärung', '/privacy')}.") if privacy_email else None),
        section("extra", "Ergänzende Angaben", textbox(legal.get("legal_extra"))),
    ]
    return _page("imprint", "Impressum", "Anbieterkennzeichnung, Offenlegung und Kontaktinformationen des Vereins.", legal, sections)


# ---------------------------------------------------------------- Nutzungsbedingungen

def terms_page(legal: dict) -> dict:
    club_name = legal.get("legal_name") or legal.get("club_name") or "THE LION SQUAD"
    sections = [
        section("scope", "Geltungsbereich", p("Diese Bedingungen gelten für die Nutzung der Website, der mobilen App, von Community-Funktionen sowie für Anmeldungen zu Turnieren und Vereinsveranstaltungen.")),
        section("account", "Account und Sicherheit", p("Angaben müssen wahrheitsgemäß sein. Zugangsdaten dürfen nicht weitergegeben werden. Missbrauch, Umgehung von Sperren und automatisierte Angriffe sind untersagt.")),
        section("community", "Community-Regeln", p("Beleidigungen, Bedrohungen, Diskriminierung, Belästigung, Spam, Betrug und rechtswidrige Inhalte sind nicht erlaubt. Inhalte können gemeldet und bei Verstößen moderiert werden.")),
        section("competitions", "Wettbewerbe", p("Zusätzliche Turnierregeln, Teilnahmevoraussetzungen und Entscheidungen der Turnierleitung gelten für den jeweiligen Wettbewerb. Manipulation, Cheating und falsche Ergebnisangaben können zum Ausschluss führen.")),
        section("availability", "Verfügbarkeit und Haftung", p("Ein unterbrechungsfreier Betrieb kann nicht garantiert werden. Gesetzlich zwingende Ansprüche bleiben unberührt. Für externe Dienste und verlinkte Inhalte gelten zusätzlich deren Bedingungen.")),
        section("termination", "Beendigung und Änderungen", p("Accounts können selbst beendet oder bei schweren beziehungsweise wiederholten Verstößen eingeschränkt werden. Wesentliche Änderungen werden mit einer neuen Versionskennung zur erneuten Bestätigung vorgelegt.")),
        section("extra", "Ergänzende Bedingungen des Vereins", textbox(legal.get("terms_of_use"))),
        section("contact", "Kontakt", p(f"Fragen zu diesen Bedingungen können über {link('das Kontaktformular', '/contact')} gestellt werden.")),
    ]
    return _page("terms", "Nutzungsbedingungen", f"Regeln für Accounts, Community-Funktionen und Wettbewerbe von {club_name}.", legal, sections)


# ---------------------------------------------------------------- Startseite (nur Crawler-Vorschau)

def home_page(branding: dict, site_name: str, description: str, play_store_url: str = "") -> dict:
    """Was ein Prüfer ohne JavaScript über die Startseite wissen muss: wozu Website und App da sind, dass alles
    Öffentliche ohne Anmeldung geht, und wo Datenschutz, Impressum und Nutzungsbedingungen stehen."""
    club_name = branding.get("club_name") or site_name
    sections = [
        section("purpose", f"Was {club_name} ist",
                p(description),
                p(f"Diese Website ist das offizielle Angebot des Vereins {club_name}: News, Events, eSports-Turniere mit Anmeldung, Brackets und "
                  "Ranglisten, Fast-Lap-Challenges, Teams, Spielerprofile, Vereinsmitglieder, Sponsoren, Partner, Galerie und Kontakt.")),
        section("no-login", "Ohne Anmeldung nutzbar",
                p("Alle öffentlichen Inhalte – Startseite, News, Events, Turniere, Ranglisten, Teams, Vereinsseiten und die rechtlichen "
                  "Seiten – sind ohne Konto und ohne Anmeldung erreichbar. Ein Konto ist freiwillig und nur nötig, um selbst an Turnieren "
                  "teilzunehmen, ein Profil zu pflegen oder den Mitgliederbereich des Vereins zu nutzen.", "home-no-login")),
        section("app", "LionsAPP",
                p("Die LionsAPP (Android) ist die App zu dieser Website: dasselbe Konto, dieselben Turniere, Events und Mitgliederfunktionen, "
                  f"dazu Push-Nachrichten.{' ' + link('Im Google Play Store', play_store_url) if play_store_url else ''}")),
        section("legal", "Rechtliches und Kontakt", lst([
            link("Datenschutzerklärung", "/privacy"), link("Impressum", "/imprint"), link("Nutzungsbedingungen", "/terms"),
            link("Über den Verein", "/about"), link("Mitglied werden", "/membership"), link("Kontakt", "/contact"),
        ], "home-links")),
    ]
    return {"page": "home", "title": site_name, "intro": description, "updated_at": None, "legal_ready": True, "sections": [s for s in sections if s]}


def _page(page: str, title: str, intro: str, legal: dict, sections: list) -> dict:
    return {
        "page": page, "title": title, "intro": intro,
        "updated_at": legal.get("legal_updated_at") or None,
        "legal_ready": legal.get("legal_ready") is not False,
        "sections": [s for s in sections if s],
    }


PAGES = {"privacy": "Datenschutzerklärung", "imprint": "Impressum", "terms": "Nutzungsbedingungen"}


def legal_page(page: str, legal: dict, facts: dict) -> dict | None:
    if page == "privacy":
        return privacy_page(legal, facts)
    if page == "imprint":
        return imprint_page(legal)
    if page == "terms":
        return terms_page(legal)
    return None


async def legal_context(db) -> tuple[dict, dict]:
    """Dieselben öffentlichen Rechtsdaten und Schalter, die auch `/api/settings/public` liefert - eine Quelle."""
    from services import club_facts, privacy_facts
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    overlay, legal_source = await club_facts.public_legal_source(db, branding)
    legal = build_public_legal_settings(branding, overlay)
    legal["legal_source"] = legal_source
    legal["club_name"] = branding.get("club_name", "THE LION SQUAD")
    domain = str(branding.get("domain") or "https://lionsquad.at").strip()
    legal["domain"] = domain if domain.startswith(("http://", "https://")) else f"https://{domain}"
    return legal, await privacy_facts.privacy_facts(db)


# ---------------------------------------------------------------- HTML für die Crawler-Vorschau

def inline_html(text: object) -> str:
    """**fett** und [Text](Adresse) - alles andere wird escaped. Nur /, mailto: und http(s) als Adresse."""
    out = []
    for piece in INLINE_RE.split(str(text or "")):
        if not piece:
            continue
        if piece.startswith("**") and piece.endswith("**") and len(piece) > 4:
            out.append(f"<strong>{escape(piece[2:-2])}</strong>")
            continue
        match = LINK_RE.match(piece)
        if match:
            out.append(f'<a href="{escape(match.group(2), quote=True)}">{escape(match.group(1))}</a>')
            continue
        out.append(escape(piece))
    return "".join(out)


def block_html(block: dict) -> str:
    kind = block.get("type")
    if kind == "p":
        return f"<p>{inline_html(block.get('text'))}</p>"
    if kind == "list":
        return "<ul>" + "".join(f"<li>{inline_html(item)}</li>" for item in block.get("items") or []) + "</ul>"
    if kind == "info":
        rows = []
        for label, value in block.get("rows") or []:
            lines = value if isinstance(value, list) else [value]
            rows.append(f"<dt>{escape(str(label))}</dt><dd>{'<br />'.join(inline_html(line) for line in lines)}</dd>")
        return "<dl>" + "".join(rows) + "</dl>"
    if kind == "text":
        return f"<p>{escape(str(block.get('text') or '')).replace(chr(10), '<br />')}</p>"
    return ""


def page_html(page: dict) -> str:
    parts = [f"<h1>{escape(str(page.get('title') or ''))}</h1>"]
    if page.get("intro"):
        parts.append(f"<p>{escape(str(page['intro']))}</p>")
    for sec in page.get("sections") or []:
        parts.append(f'<section id="{escape(str(sec.get("id") or ""), quote=True)}"><h2>{escape(str(sec.get("title") or ""))}</h2>'
                     + "".join(block_html(block) for block in sec.get("blocks") or []) + "</section>")
    return "\n      ".join(parts)
