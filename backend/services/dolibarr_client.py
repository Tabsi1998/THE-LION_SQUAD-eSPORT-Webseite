"""Der eine Weg zu Dolibarr (#316): Einstellungen, HTTP, Fehler, Fähigkeiten.

Mitgliedschaft (#295), Vereinsfunktionen (#297), später Rechnungen (#296) und
Abrechnung (#314) sprechen alle über diese Schicht - keine zweite
Konfiguration, kein zweiter HTTP-Client.

Regeln, die hier durchgesetzt werden:
- Der API-Schlüssel steht nur im Header `DOLAPIKEY` und nie in einer Meldung.
- Es gibt keine freie Adresse: jede Methode baut ihren festen Pfad selbst.
  Kein Proxy, kein Pfad aus einer Anfrage des Browsers, keine Weiterleitungen.
- HTTPS ist Pflicht; `http://` nur für eine als Test markierte Instanz.
- Fehler sind maskiert: Art und HTTP-Status, nie der Antworttext (er kann
  Personendaten tragen).
- Wiederholt wird nur Lesen, höchstens zweimal, mit kurzer Pause.
"""
from __future__ import annotations

import asyncio
import logging
import re
import socket
import ssl
from urllib.parse import urlsplit

import httpx

from database import get_db
from services.secret_store import decrypt_secret

logger = logging.getLogger("tls.dolibarr")

SETTINGS_ID = "dolibarr"
MODES = ("off", "preview", "live")
ENVIRONMENTS = ("test", "production")
TIMEOUT_SECONDS = 10.0
RETRY_PAUSES = (0.5, 1.5)
RETRY_STATUS = {502, 503, 504}
PAGE_LIMIT = 100

ERROR_TEXTS = {
    "not_configured": "Adresse oder API-Schlüssel fehlt",
    "key_unreadable": "Der gespeicherte API-Schlüssel lässt sich nicht entschlüsseln – neu eintragen",
    "bad_url": "Die Adresse ist nicht zulässig (https, ohne Zugangsdaten, ohne Abfrage)",
    "bad_request": "Dolibarr lehnt die Anfrage ab (400)",
    "unauthorized": "Dolibarr kennt den API-Schlüssel nicht (401)",
    "forbidden": "Dem API-Benutzer fehlt ein Recht im Modul Vereine (403)",
    "not_found": "Nicht gefunden (404)",
    "conflict": "Mehrere Mitglieder passen (409)",
    "module_off": "Das Modul Vereine ist in Dolibarr deaktiviert (501)",
    "unavailable": "Dolibarr ist nicht erreichbar",
    "invalid_response": "Unter dieser Adresse antwortet etwas, aber nicht die Dolibarr-API (z. B. eine Anmeldeseite) – Adresse prüfen",
    # Warum es nicht klappt (#345) - ohne Adresse, Schlüssel oder Antworttext preiszugeben.
    "dns": "Diese Adresse gibt es nicht – bitte auf Tippfehler im Namen prüfen",
    "tls": "Das Zertifikat der Adresse wird nicht akzeptiert (abgelaufen, selbst signiert oder auf einen anderen Namen ausgestellt)",
    "timeout": "Der Server antwortet nicht rechtzeitig – läuft Dolibarr, und ist es vom Webserver aus erreichbar? "
               "Steht Dolibarr im selben Heimnetz wie der Webserver, braucht das Backend den Host-Eintrag in "
               "docker-compose.override.yml (UPDATE.md) – nach einem Update fehlt er, wenn er vorher direkt in docker-compose.yml stand",
    "refused": "Der Server nimmt unter dieser Adresse keine Verbindung an (falscher Port, Firewall, Dienst gestoppt)",
    "redirect": "Dolibarr leitet um – die Adresse genau so eintragen, wie sie im Browser nach dem Laden steht (https, mit Unterordner)",
    "api_missing": "Unter dieser Adresse gibt es keine Dolibarr-API: In Dolibarr das Modul „API REST“ aktivieren; liegt Dolibarr in einem Unterordner, gehört er in die Adresse",
    "vereine_missing": "Dolibarr antwortet, aber das Modul „Vereine“ bietet hier keine Schnittstelle an – Modul aktivieren und aktualisieren",
}
NO_RETRY_KINDS = {"dns", "tls", "refused", "redirect"}
STATUS_KINDS = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict", 501: "module_off"}

# Was das Vereinsmodul heute liefert (API-Version 1) und worauf die Website
# wartet. Die wartenden Fähigkeiten werden nie vorausgesetzt (#330).
CAPABILITIES_V1 = {
    "member_summary": True,
    "member_lookup": True,
    "members_changed_since": True,
    "member_functions": True,
    "member_invoices": True,
    "board": True,
    "membership_fees": True,
    "webhook_member_changed": True,
    "verified_identities": False,   # dolibarr-vereine#153
    "change_feed": False,           # dolibarr-vereine#154
    "signed_webhooks": False,       # dolibarr-vereine#155
    "documents": False,             # dolibarr-vereine#157
}

# Nur für Tests: ein httpx-Transport statt des Netzes.
_transport = None


def network_error_kind(exc: BaseException) -> str:
    """Art des Netzfehlers aus der Ursachenkette - nie deren Text."""
    seen = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, socket.gaierror):
            return "dns"
        if isinstance(current, ssl.SSLError):
            return "tls"
        if isinstance(current, ConnectionRefusedError):
            return "refused"
        current = current.__cause__ or current.__context__
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    text = str(exc).lower()
    if "getaddrinfo" in text or "name or service not known" in text or "name resolution" in text or "nodename nor servname" in text:
        return "dns"
    if "certificate" in text or "ssl" in text:
        return "tls"
    if "refused" in text:
        return "refused"
    return "unavailable"


class DolibarrError(Exception):
    def __init__(self, kind: str, status: int | None = None):
        self.kind = kind if kind in ERROR_TEXTS else "invalid_response"
        self.status = status
        super().__init__(self.text)

    @property
    def text(self) -> str:
        return ERROR_TEXTS[self.kind]


def clean_base_url(value: str | None, *, environment: str = "production") -> str:
    """Geprüfte Basis-Adresse ohne Schrägstrich am Ende, sonst DolibarrError."""
    raw = str(value or "").strip()
    if not raw:
        raise DolibarrError("not_configured")
    parts = urlsplit(raw)
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise DolibarrError("bad_url")
    if parts.scheme == "http" and environment != "test":
        raise DolibarrError("bad_url")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise DolibarrError("bad_url")
    path = re.sub(r"/+$", "", parts.path or "")
    path = re.sub(r"/api/index\.php$", "", path)
    if not re.fullmatch(r"(/[A-Za-z0-9._~-]+)*", path):
        raise DolibarrError("bad_url")
    host = parts.hostname if ":" not in parts.hostname else f"[{parts.hostname}]"
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{host}{port}{path}"


async def load_settings(db=None) -> dict:
    db = db if db is not None else get_db()
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    doc.setdefault("mode", "off")
    doc.setdefault("environment", "production")
    doc.setdefault("instance", "")
    doc.setdefault("entity", 1)
    if doc["mode"] not in MODES:
        doc["mode"] = "off"
    return doc


def write_capable(settings: dict | None) -> bool:
    """Schreibzugriff (Rechnungen, Geschäftspartner) nur im Modus „live“ und mit bewusst gesetztem
    Schalter (#316). Entscheidung des Betreibers vom 22.09.: **ein** Website-Benutzer in Dolibarr
    mit allen nötigen Rechten - der Schalter ist die Sicherung; ein eigener Schreib-Schlüssel
    bleibt möglich, ist aber nicht Pflicht."""
    if not settings or settings.get("mode") != "live" or not settings.get("write_enabled"):
        return False
    return bool(settings.get("write_api_key") or settings.get("api_key"))


def instance_key(settings: dict) -> str:
    """Kennung der Installation. Nummern zweier Installationen sind nie dasselbe Mitglied."""
    return f"{str(settings.get('instance') or '').strip() or 'default'}:{int(settings.get('entity') or 1)}"


def capabilities_for(status: dict | None) -> dict:
    if not status or int(status.get("api_version") or 0) < 1:
        return {name: False for name in CAPABILITIES_V1}
    return dict(CAPABILITIES_V1)


def _as_id(data) -> int:
    """Dolibarr antwortet auf POST mit der neuen Kennung - als Zahl, manchmal als Text."""
    try:
        value = int(data if not isinstance(data, dict) else data.get("id"))
    except (TypeError, ValueError) as exc:
        raise DolibarrError("invalid_response", 200) from exc
    if value < 1:
        raise DolibarrError("invalid_response", 200)
    return value


class DolibarrClient:
    def __init__(self, settings: dict):
        self.settings = settings
        self.base_url = clean_base_url(settings.get("base_url"), environment=settings.get("environment") or "production")
        try:
            self._key = decrypt_secret(settings.get("api_key"))
        except RuntimeError as exc:
            raise DolibarrError("key_unreadable") from exc
        if not self._key:
            raise DolibarrError("not_configured")
        # Schreiben mit eigenem Schlüssel, wenn einer hinterlegt ist - sonst mit dem des Website-Benutzers.
        try:
            self._write_key = decrypt_secret(settings.get("write_api_key")) or self._key
        except RuntimeError as exc:
            raise DolibarrError("key_unreadable") from exc

    @classmethod
    async def from_db(cls, db=None) -> "DolibarrClient":
        return cls(await load_settings(db))

    async def _get(self, path: str, params: dict | None = None):
        return await self._request("GET", path, params=params)

    async def _send(self, method: str, path: str, payload: dict | None = None):
        """Schreibender Aufruf mit dem Schreib-Schlüssel - **ohne Wiederholung**: ein zweites
        POST /invoices wäre eine zweite Rechnung. Wer wiederholt, prüft vorher (ref_ext)."""
        return await self._request(method, path, payload=payload, key=self._write_key, retries=0)

    async def _request(self, method: str, path: str, *, params: dict | None = None, payload: dict | None = None,
                       key: str | None = None, retries: int | None = None):
        url = f"{self.base_url}/api/index.php{path}"
        headers = {"DOLAPIKEY": key or self._key, "Accept": "application/json"}
        attempts = (len(RETRY_PAUSES) if retries is None else retries) + 1
        last_kind, last_status = "unavailable", None
        for attempt in range(attempts):
            try:
                async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False, transport=_transport) as cli:
                    response = await cli.request(method, url, params=params, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                last_kind, last_status = network_error_kind(exc), None
                logger.warning("[dolibarr] %s nicht erreichbar: %s (%s)", path, type(exc).__name__, last_kind)
                if last_kind in NO_RETRY_KINDS:
                    break
            else:
                if response.status_code == 200:
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise DolibarrError("invalid_response", 200) from exc
                if response.status_code in STATUS_KINDS:
                    raise DolibarrError(STATUS_KINDS[response.status_code], response.status_code)
                if 300 <= response.status_code < 400:
                    raise DolibarrError("redirect", response.status_code)
                logger.warning("[dolibarr] %s antwortet mit %s", path, response.status_code)
                last_kind, last_status = "unavailable", response.status_code
                if response.status_code not in RETRY_STATUS:
                    break
            if attempt < attempts - 1:
                await asyncio.sleep(RETRY_PAUSES[min(attempt, len(RETRY_PAUSES) - 1)])
        raise DolibarrError(last_kind, last_status)

    # ------------------------------------------------ Kern-API: Geschäftspartner, Rechnungen (#316, #317)
    # Dolibarrs eigene REST-API (Module „Drittparteien“, „Rechnungen“, „Mitglieder“, „Produkte“).
    # Feste Pfade, feste Felder - kein Durchreichen von Aufrufen aus dem Browser.

    async def thirdparty(self, thirdparty_id: int) -> dict:
        data = await self._get(f"/thirdparties/{int(thirdparty_id)}")
        if not isinstance(data, dict) or "id" not in data:
            raise DolibarrError("invalid_response", 200)
        return data

    async def thirdparties_by_email(self, email: str) -> list[dict]:
        """Alle Geschäftspartner mit dieser E-Mail - zum Erkennen von Doppelanlagen, nie zum stillen Zuordnen."""
        clean = str(email or "").strip().replace("'", "")
        if not clean:
            return []
        try:
            data = await self._get("/thirdparties", {"sqlfilters": f"(t.email:=:'{clean}')", "limit": 20})
        except DolibarrError as exc:
            if exc.kind == "not_found":   # Dolibarr antwortet 404 auf eine leere Liste
                return []
            raise
        return data if isinstance(data, list) else []

    async def create_thirdparty(self, *, name: str, email: str | None, note: str) -> int:
        payload = {"name": name[:120], "email": email or "", "client": 1, "code_client": "-1", "note_private": note[:500]}
        data = await self._send("POST", "/thirdparties", payload)
        return _as_id(data)

    async def core_member(self, member_id: int) -> dict:
        """Das Mitglied aus Dolibarrs Mitgliedermodul - wegen `fk_soc`, dem verknüpften Geschäftspartner."""
        data = await self._get(f"/members/{int(member_id)}")
        if not isinstance(data, dict):
            raise DolibarrError("invalid_response", 200)
        return data

    async def product(self, product_id: int) -> dict:
        data = await self._get(f"/products/{int(product_id)}")
        if not isinstance(data, dict) or "id" not in data:
            raise DolibarrError("invalid_response", 200)
        return data

    async def services(self, *, limit: int = 100) -> list[dict]:
        """Verkaufbare Leistungen (Dienstleistungen) - zum Auswählen im Event, statt Nummern zu tippen."""
        try:
            data = await self._get("/products", {"mode": 2, "sortfield": "t.label", "sortorder": "ASC", "limit": int(limit)})
        except DolibarrError as exc:
            if exc.kind == "not_found":   # leere Liste
                return []
            raise
        return data if isinstance(data, list) else []

    async def invoice(self, invoice_id: int) -> dict:
        data = await self._get(f"/invoices/{int(invoice_id)}")
        if not isinstance(data, dict) or "id" not in data:
            raise DolibarrError("invalid_response", 200)
        return data

    async def invoices_by_ref_ext(self, ref_ext: str) -> list[dict]:
        """Gibt es den Beleg zu diesem Auftrag schon? Der Schutz vor Doppelrechnungen nach einem Abbruch."""
        clean = str(ref_ext or "").replace("'", "")
        try:
            data = await self._get("/invoices", {"sqlfilters": f"(t.ref_ext:=:'{clean}')", "limit": 5})
        except DolibarrError as exc:
            if exc.kind == "not_found":
                return []
            raise
        return data if isinstance(data, list) else []

    async def create_invoice(self, payload: dict) -> int:
        data = await self._send("POST", "/invoices", payload)
        return _as_id(data)

    # ------------------------------------------------ Konditionen (#370): Wörterbücher und Konten
    async def _rows(self, path: str, params: dict) -> list[dict] | None:
        """Eine Liste - oder None, wenn der Website-Benutzer sie nicht lesen darf (dann Nummer tippen)."""
        try:
            data = await self._get(path, params)
        except DolibarrError as exc:
            if exc.kind == "not_found":
                return []
            if exc.kind in ("forbidden", "unauthorized"):
                return None
            raise
        return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

    async def payment_terms(self) -> list[dict] | None:
        return await self._rows("/setup/dictionary/payment_terms", {"sortfield": "sortorder", "sortorder": "ASC", "limit": 100, "active": 1})

    async def payment_types(self) -> list[dict] | None:
        return await self._rows("/setup/dictionary/payment_types", {"sortfield": "id", "sortorder": "ASC", "limit": 100, "active": 1})

    async def bank_accounts(self) -> list[dict] | None:
        return await self._rows("/bankaccounts", {"sortfield": "t.rowid", "sortorder": "ASC", "limit": 100})

    async def validate_invoice(self, invoice_id: int) -> dict:
        data = await self._send("POST", f"/invoices/{int(invoice_id)}/validate", {"idwarehouse": 0, "notrigger": 0})
        return data if isinstance(data, dict) else {}

    # ------------------------------------------------ feste Lesewege
    async def status(self) -> dict:
        try:
            data = await self._get("/vereine/status")
        except DolibarrError as exc:
            if exc.kind != "not_found":
                raise
            # 404 auf dem Status-Weg heißt nie „kein Mitglied“. Gibt es die API überhaupt?
            raise DolibarrError(await self._why_no_status(), 404) from exc
        if not isinstance(data, dict) or "api_version" not in data:
            raise DolibarrError("invalid_response", 200)
        return data

    async def _why_no_status(self) -> str:
        """Fehlt Dolibarrs API ganz - oder nur die Schnittstelle des Vereinsmoduls?"""
        try:
            await self._get("/status")
        except DolibarrError as exc:
            # Dolibarrs eigener Status-Weg braucht Rechte, die der Website-Benutzer nicht hat:
            # 401/403 beweisen, dass die API da ist.
            return "vereine_missing" if exc.kind in ("unauthorized", "forbidden") else "api_missing"
        return "vereine_missing"

    async def member_summary(self, member_id: int) -> dict:
        data = await self._get(f"/vereine/members/{int(member_id)}/summary")
        if not isinstance(data, dict) or "id" not in data:
            raise DolibarrError("invalid_response", 200)
        return data

    async def lookup_by_email(self, email: str) -> dict:
        return await self._get("/vereine/members/lookup", {"email": str(email or "").strip()})

    async def lookup_by_ref(self, ref: str) -> dict:
        return await self._get("/vereine/members/lookup", {"ref": str(ref or "").strip()})

    async def member_invoices(self, member_id: int, *, page: int = 0) -> list[dict]:
        """Freigegebene Rechnungen des Geschäftspartners des Mitglieds, neueste zuerst (#296)."""
        data = await self._get(f"/vereine/members/{int(member_id)}/invoices", {"limit": PAGE_LIMIT, "page": int(page)})
        if not isinstance(data, list):
            raise DolibarrError("invalid_response", 200)
        return data

    async def member_invoice_pdf(self, member_id: int, invoice_id: int) -> dict:
        """Das PDF einer eigenen Rechnung, base64 - fremde und Entwürfe antworten 404 (#296)."""
        data = await self._get(f"/vereine/members/{int(member_id)}/invoices/{int(invoice_id)}/pdf")
        if not isinstance(data, dict) or "content" not in data:
            raise DolibarrError("invalid_response", 200)
        return data

    async def members_page(self, *, page: int, changed_since: str | None = None) -> list[dict]:
        params: dict = {"limit": PAGE_LIMIT, "page": int(page)}
        if changed_since:
            params["changed_since"] = changed_since
        data = await self._get("/vereine/members", params)
        if not isinstance(data, list):
            raise DolibarrError("invalid_response", 200)
        return data
