#!/usr/bin/env python3
"""Interactive First-Run Setup Wizard for THE LION SQUAD eSports.

Usage:
    docker exec -it tls-backend python setup_cli.py
    # or locally:
    cd /app/backend && python setup_cli.py
"""
import asyncio
import getpass
import sys
import os
from dotenv import load_dotenv
from pathlib import Path

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient
from runtime_config import is_placeholder_secret, resolve_app_environment
from services.password_policy import password_problem
from services.secret_store import encrypt_secret


RESET = "\033[0m"
CYAN = "\033[38;5;39m"
YELLOW = "\033[33m"
RED = "\033[31m"
GREEN = "\033[32m"
BOLD = "\033[1m"
DIM = "\033[2m"


def banner():
    print(f"""{CYAN}{BOLD}
████████ ██      ███████      █████  ██████  ███████ ███    ██  █████
   ██    ██      ██          ██   ██ ██   ██ ██      ████   ██ ██   ██
   ██    ██      ███████     ███████ ██████  █████   ██ ██  ██ ███████
   ██    ██           ██     ██   ██ ██   ██ ██      ██  ██ ██ ██   ██
   ██    ███████ ███████     ██   ██ ██   ██ ███████ ██   ████ ██   ██
{RESET}{DIM}            THE LION SQUAD · eSports Tournament System{RESET}
""")


def ask(prompt: str, default: str = "", validator=None) -> str:
    while True:
        hint = f" {DIM}[{default}]{RESET}" if default else ""
        full = f"{CYAN}▸{RESET} {prompt}{hint}: "
        val = input(full)
        val = (val.strip() or default).strip()
        if not val and not default:
            print(f"{RED}  ✕ Pflichtfeld{RESET}")
            continue
        if validator and not validator(val):
            print(f"{RED}  ✕ Ungültige Eingabe{RESET}")
            continue
        return val


def ask_secret(prompt: str, validator=None, *, strip: bool = True) -> str:
    """Read a secret without sharing the public-input data flow or echoing it.

    Passwörter mit ``strip=False``: der Passwortvertrag (#1033) lässt Leerzeichen unverändert."""
    while True:
        val = getpass.getpass(f"{CYAN}▸{RESET} {prompt}: ")
        if strip:
            val = val.strip()
        if not val:
            print(f"{RED}  ✕ Pflichtfeld{RESET}")
            continue
        if validator and not validator(val):
            print(f"{RED}  ✕ Ungültige Eingabe{RESET}")
            continue
        return val


def _valid_setup_password(value: str) -> bool:
    """Passwortvertrag (#1033), für Einrichtungskonten zusätzlich mindestens 12 Zeichen."""
    return password_problem(value) is None and len(value) >= 12


def ask_yes_no(prompt: str, default=True) -> bool:
    hint = "J/n" if default else "j/N"
    val = input(f"{CYAN}▸{RESET} {prompt} [{hint}]: ").strip().lower()
    if not val:
        return default
    return val in ("j", "ja", "y", "yes")


def require_jwt_secret() -> str:
    value = os.environ.get("JWT_SECRET", "")
    if len(value) < 32 or is_placeholder_secret(value):
        raise RuntimeError("JWT_SECRET muss vor dem Setup sicher gesetzt sein (mindestens 32 Zeichen).")
    return value


async def main():
    banner()
    print(f"{BOLD}Willkommen beim THE LION SQUAD Setup-Assistenten.{RESET}")
    print(f"{DIM}Dieser Assistent führt dich durch die Erstkonfiguration.{RESET}\n")

    mongo_url = os.environ.get("MONGO_URL", "")
    db_name = os.environ.get("DB_NAME", "")
    if not mongo_url or not db_name:
        print(f"{RED}MONGO_URL oder DB_NAME fehlen in .env. Abbruch.{RESET}")
        sys.exit(1)

    try:
        require_jwt_secret()
    except RuntimeError:
        print(f"{RED}JWT_SECRET fehlt oder ist unsicher. Bitte zuerst .env/install.sh sicher konfigurieren.{RESET}")
        raise SystemExit(1)

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # ---- Check existing setup ----
    existing_super = await db.users.find_one({"role": "superadmin"})
    setup_done = await db.settings.find_one({"id": "setup"})
    if setup_done and existing_super and not ask_yes_no("Setup ist bereits abgeschlossen. Erneut ausführen?", False):
        print(f"{YELLOW}Setup übersprungen.{RESET}")
        client.close()
        return

    print(f"\n{BOLD}[1/6]{RESET} Vereins-Branding")
    club_name = ask("Vereinsname", "THE LION SQUAD")
    tagline = ask("Tagline / Untertitel", "eSports Verein")
    domain = ask("Öffentliche Domain", "lionsquad.at")
    timezone_str = ask("Zeitzone", "Europe/Vienna")
    primary_color = ask("Akzentfarbe (HEX)", "#29B6E8")

    print(f"\n{BOLD}[2/6]{RESET} Superadmin Account")
    admin_email = ask("Admin E-Mail", os.environ.get("ADMIN_EMAIL", "admin@lionsquad.at"))
    while True:
        admin_pw = ask_secret("Admin Passwort (min. 12 Zeichen, höchstens 72 Byte)",
                              validator=_valid_setup_password, strip=False)
        admin_pw2 = ask_secret("Passwort bestätigen", strip=False)
        if admin_pw == admin_pw2:
            break
        print(f"{RED}  ✕ Passwörter stimmen nicht überein.{RESET}")

    print(f"\n{BOLD}[3/6]{RESET} E-Mail-Versand (Resend)")
    if ask_yes_no("Resend jetzt konfigurieren?", False):
        resend_key = ask_secret("Resend API Key (re_...)")
        sender_name = ask("Absendername", club_name)
        sender_email = ask("Absender-E-Mail", "noreply@lionsquad.at")
    else:
        resend_key = None
        print(f"{DIM}  → Kannst du später im Adminbereich unter Einstellungen → E-Mail hinterlegen.{RESET}")

    print(f"\n{BOLD}[4/6]{RESET} Rechtliches")
    imprint = ask("Impressum (kurz, 1 Zeile — voller Text im Admin)", f"{club_name}, Wien, Österreich")
    privacy_short = ask("Datenschutz Kontakt", "datenschutz@lionsquad.at")

    print(f"\n{BOLD}[5/6]{RESET} Demo-Daten")
    if resolve_app_environment() == "production":
        seed_demo = False
        print(f"{DIM}  → Demo-Daten sind in Produktion gesperrt.{RESET}")
    else:
        seed_demo = ask_yes_no("Demo-Daten (20 Testspieler + Beispielturniere) anlegen?", False)
    demo_password = None
    if seed_demo:
        while True:
            demo_password = ask_secret(
                "Eigenes Demo-Passwort (min. 12 Zeichen, höchstens 72 Byte)",
                validator=_valid_setup_password, strip=False,
            )
            confirmation = ask_secret("Demo-Passwort bestätigen", strip=False)
            if demo_password == confirmation:
                break
            print(f"{RED}  ✕ Passwörter stimmen nicht überein.{RESET}")

    print(f"\n{BOLD}[6/6]{RESET} JWT-Secret")
    print(f"{GREEN}  ✓ Extern vorkonfiguriertes JWT-Secret ist gültig.{RESET}")

    print(f"\n{YELLOW}Konfiguration schreiben …{RESET}")

    # --- Save admin user ---
    from auth import password_fields
    pw_fields = password_fields(admin_pw)
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    if existing_super:
        await db.users.update_one(
            {"email": existing_super["email"]},
            {"$set": {**pw_fields, "email": admin_email.lower(),
                      "is_banned": False, "updated_at": now_iso}},
        )
        print(f"{GREEN}  ✓ Superadmin aktualisiert{RESET}")
    else:
        uid = os.urandom(16).hex()
        await db.users.insert_one({
            "id": uid, "email": admin_email.lower(), "username": "admin",
            **pw_fields, "display_name": "TLS Admin",
            "role": "superadmin", "is_active": True, "is_banned": False,
            "privacy_public_profile": False, "accepted_privacy": True,
            "created_at": now_iso, "updated_at": now_iso,
        })
        print(f"{GREEN}  ✓ Superadmin erstellt{RESET}")

    # --- Branding ---
    await db.settings.update_one(
        {"id": "branding"}, {"$set": {
            "id": "branding", "club_name": club_name, "tagline": tagline,
            "primary_color": primary_color, "domain": domain, "timezone": timezone_str,
            "imprint": imprint, "privacy_policy": f"Kontakt Datenschutz: {privacy_short}",
            "updated_at": now_iso,
        }}, upsert=True,
    )
    print(f"{GREEN}  ✓ Branding gespeichert{RESET}")

    # --- Email ---
    if resend_key:
        await db.settings.update_one(
            {"id": "email"}, {"$set": {
                "id": "email", "resend_api_key": encrypt_secret(resend_key),
                "sender_name": sender_name, "sender_email": sender_email,
                "enabled": True, "updated_at": now_iso,
            }}, upsert=True,
        )
        print(f"{GREEN}  ✓ E-Mail-Versand konfiguriert{RESET}")

    # --- Setup marker ---
    await db.settings.update_one(
        {"id": "setup"}, {"$set": {
            "id": "setup", "completed": True, "completed_at": now_iso,
            "seed_demo": seed_demo,
        }}, upsert=True,
    )

    # --- Optional demo seed ---
    if seed_demo:
        from seed import seed_demo_data
        if await db.games.count_documents({}) == 0:
            await seed_demo_data(demo_password)
            print(f"{GREEN}  ✓ Demo-Daten angelegt{RESET}")

    print(f"\n{BOLD}{GREEN}✓ Setup abgeschlossen.{RESET}")
    print(f"\n{DIM}Öffne {CYAN}https://{domain}{RESET}{DIM} und logge dich mit dem eben gesetzten Superadmin-Konto ein.{RESET}")
    print(f"\n{YELLOW}Wichtig: Ändere dein Passwort über das Profil, falls jemand Zugriff auf diese Session hatte.{RESET}\n")
    client.close()


if __name__ == "__main__":
    from services.bootstrap import ensure_wiring

    ensure_wiring()  # Anmeldungen beim Import (#1420), siehe services/bootstrap.py
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Abgebrochen.{RESET}")
        sys.exit(1)
