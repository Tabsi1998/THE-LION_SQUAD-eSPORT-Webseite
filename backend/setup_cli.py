#!/usr/bin/env python3
"""Interactive First-Run Setup Wizard for THE LION SQUAD eSports.

Usage:
    docker exec -it tls-backend python setup_cli.py
    # or locally:
    cd /app/backend && python setup_cli.py
"""
import asyncio
import getpass
import secrets
import sys
import os
from dotenv import load_dotenv
from pathlib import Path

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient
import bcrypt


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


def ask(prompt: str, default: str = "", secret: bool = False, validator=None) -> str:
    while True:
        hint = f" {DIM}[{default}]{RESET}" if default else ""
        full = f"{CYAN}▸{RESET} {prompt}{hint}: "
        val = getpass.getpass(full) if secret else input(full)
        val = (val.strip() or default).strip()
        if not val and not default:
            print(f"{RED}  ✕ Pflichtfeld{RESET}")
            continue
        if validator and not validator(val):
            print(f"{RED}  ✕ Ungültige Eingabe{RESET}")
            continue
        return val


def ask_yes_no(prompt: str, default=True) -> bool:
    hint = "J/n" if default else "j/N"
    val = input(f"{CYAN}▸{RESET} {prompt} [{hint}]: ").strip().lower()
    if not val:
        return default
    return val in ("j", "ja", "y", "yes")


async def main():
    banner()
    print(f"{BOLD}Willkommen beim THE LION SQUAD Setup-Assistenten.{RESET}")
    print(f"{DIM}Dieser Assistent führt dich durch die Erstkonfiguration.{RESET}\n")

    mongo_url = os.environ.get("MONGO_URL", "")
    db_name = os.environ.get("DB_NAME", "")
    if not mongo_url or not db_name:
        print(f"{RED}MONGO_URL oder DB_NAME fehlen in .env. Abbruch.{RESET}")
        sys.exit(1)

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # ---- Check existing setup ----
    existing_super = await db.users.find_one({"role": "superadmin"})
    setup_done = await db.settings.find_one({"id": "setup"})
    if setup_done and existing_super and not ask_yes_no("Setup ist bereits abgeschlossen. Erneut ausführen?", False):
        print(f"{YELLOW}Setup übersprungen.{RESET}")
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
        admin_pw = ask("Admin Passwort (min. 8 Zeichen)", secret=True,
                        validator=lambda v: len(v) >= 8)
        admin_pw2 = ask("Passwort bestätigen", secret=True)
        if admin_pw == admin_pw2:
            break
        print(f"{RED}  ✕ Passwörter stimmen nicht überein.{RESET}")

    print(f"\n{BOLD}[3/6]{RESET} E-Mail-Versand (Resend)")
    if ask_yes_no("Resend jetzt konfigurieren?", False):
        resend_key = ask("Resend API Key (re_...)", secret=True)
        sender_name = ask("Absendername", club_name)
        sender_email = ask("Absender-E-Mail", "noreply@lionsquad.at")
    else:
        resend_key = None
        sender_name = club_name
        sender_email = None
        print(f"{DIM}  → Kannst du später im Adminbereich unter Einstellungen → E-Mail hinterlegen.{RESET}")

    print(f"\n{BOLD}[4/6]{RESET} Rechtliches")
    imprint = ask("Impressum (kurz, 1 Zeile — voller Text im Admin)", f"{club_name}, Wien, Österreich")
    privacy_short = ask("Datenschutz Kontakt", "datenschutz@lionsquad.at")

    print(f"\n{BOLD}[5/6]{RESET} Demo-Daten")
    seed_demo = ask_yes_no("Demo-Daten (20 Testspieler + Beispielturniere) anlegen?", False)

    print(f"\n{BOLD}[6/6]{RESET} JWT-Secret")
    jwt_secret = os.environ.get("JWT_SECRET", "")
    if not jwt_secret or len(jwt_secret) < 32:
        jwt_secret = secrets.token_hex(32)
        print(f"{GREEN}  → Neues JWT-Secret generiert (bitte in .env speichern):{RESET}")
        print(f"    JWT_SECRET={jwt_secret}")

    print(f"\n{YELLOW}Konfiguration schreiben …{RESET}")

    # --- Save admin user ---
    pw_hash = bcrypt.hashpw(admin_pw.encode(), bcrypt.gensalt()).decode()
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    if existing_super:
        await db.users.update_one(
            {"email": existing_super["email"]},
            {"$set": {"password_hash": pw_hash, "email": admin_email.lower(),
                      "is_banned": False, "updated_at": now_iso}},
        )
        print(f"{GREEN}  ✓ Superadmin aktualisiert{RESET}")
    else:
        uid = os.urandom(16).hex()
        await db.users.insert_one({
            "id": uid, "email": admin_email.lower(), "username": "admin",
            "password_hash": pw_hash, "display_name": "TLS Admin",
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
                "id": "email", "resend_api_key": resend_key,
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
            await seed_demo_data()
            print(f"{GREEN}  ✓ Demo-Daten angelegt{RESET}")

    print(f"\n{BOLD}{GREEN}✓ Setup abgeschlossen.{RESET}")
    print(f"\n{DIM}Öffne {CYAN}https://{domain}{RESET}{DIM} und logge dich ein:{RESET}")
    print(f"  {BOLD}E-Mail:{RESET}   {admin_email}")
    print(f"  {BOLD}Passwort:{RESET} {'*' * len(admin_pw)}")
    print(f"\n{YELLOW}Wichtig: Ändere dein Passwort über das Profil, falls jemand Zugriff auf diese Session hatte.{RESET}\n")
    client.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Abgebrochen.{RESET}")
        sys.exit(1)
