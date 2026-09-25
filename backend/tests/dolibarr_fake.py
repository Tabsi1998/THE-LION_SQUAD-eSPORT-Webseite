"""Ein Dolibarr für die Tests, das sich an den echten Vertrag hält (#330).

Jede Antwort wird gegen `contracts/vereine-openapi.json` geprüft - die Datei, gegen
die das Vereinsmodul seine echten Antworten in Dolibarr 22, 23 und 24 selbst
prüft. Weicht eine Testantwort vom Vertrag ab, scheitert der Test hier und nicht
erst am Server. Fähigkeiten, die das Modul noch nicht hat, gibt es hier auch
nicht: keine erfundenen erfolgreichen Antworten.
"""
from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import re

import httpx

CONTRACTS = pathlib.Path(__file__).resolve().parent / "contracts"
OPENAPI = json.loads((CONTRACTS / "vereine-openapi.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((CONTRACTS / "manifest.json").read_text(encoding="utf-8"))
API_KEY = "test-key-nur-im-test"
BASE_URL = "https://erp.example.test"

TYPES = {"object": dict, "array": list, "string": str, "boolean": bool}


class ContractViolation(AssertionError):
    pass


def validate(value, schema: dict, where: str = "$") -> None:
    """Der Teil von OpenAPI 3.0, den der Vertrag benutzt."""
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        return validate(value, OPENAPI["components"]["schemas"][name], where)
    if value is None:
        if schema.get("nullable"):
            return None
        raise ContractViolation(f"{where}: null ist nicht erlaubt")
    kind = schema.get("type")
    if kind == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            raise ContractViolation(f"{where}: Ganzzahl erwartet, {value!r} bekommen")
    elif kind == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ContractViolation(f"{where}: Zahl erwartet, {value!r} bekommen")
    elif kind in TYPES and not isinstance(value, TYPES[kind]):
        raise ContractViolation(f"{where}: {kind} erwartet, {value!r} bekommen")
    if "enum" in schema and value not in schema["enum"]:
        raise ContractViolation(f"{where}: {value!r} steht nicht in {schema['enum']}")
    if "pattern" in schema and isinstance(value, str) and not re.search(schema["pattern"], value):
        raise ContractViolation(f"{where}: {value!r} passt nicht auf {schema['pattern']}")
    if "minimum" in schema and value < schema["minimum"]:
        raise ContractViolation(f"{where}: {value!r} unter {schema['minimum']}")
    if "maximum" in schema and value > schema["maximum"]:
        raise ContractViolation(f"{where}: {value!r} über {schema['maximum']}")
    if kind == "object":
        properties = schema.get("properties") or {}
        for name in schema.get("required") or []:
            if name not in value:
                raise ContractViolation(f"{where}: Pflichtfeld {name} fehlt")
        for name, item in value.items():
            if name in properties:
                validate(item, properties[name], f"{where}.{name}")
            elif schema.get("additionalProperties") is False:
                raise ContractViolation(f"{where}: Feld {name} steht nicht im Vertrag")
    if kind == "array":
        for index, item in enumerate(value):
            validate(item, schema.get("items") or {}, f"{where}[{index}]")


def response_schema(path_template: str) -> dict:
    return OPENAPI["paths"][path_template]["get"]["responses"]["200"]["content"]["application/json"]["schema"]


def request_schema(path_template: str, method: str = "post") -> dict:
    return OPENAPI["paths"][path_template][method]["requestBody"]["content"]["application/json"]["schema"]


NL_BYTES = bytes([10])


def statute_pdf_bytes(version_id: int) -> bytes:
    """Die Datei einer Statutenfassung, wie sie in der Vereinsakte liegt - je Fassung andere Bytes."""
    return b"%PDF-1.7\n%fake-statutes-" + str(version_id).encode() + b"\n%%EOF\n"


def statute_version(version_id: int, version: int, *, decided_on: str, valid_from: str, valid_to: str = "", state: str = "in_force") -> dict:
    content = statute_pdf_bytes(version_id)
    return {"id": version_id, "version": version, "decided_on": decided_on, "valid_from": valid_from, "valid_to": valid_to, "state": state,
            "source": "generated", "sha256": hashlib.sha256(content).hexdigest(), "size": len(content)}


def document_pdf_bytes(document_id: int, revision: int = 1) -> bytes:
    """Die Datei einer Fassung aus der Vereinsakte - je Dokument und Fassung andere Bytes."""
    return b"%PDF-1.7\n%fake-document-" + f"{document_id}-{revision}".encode() + b"\n%%EOF\n"


def published_document(document_id: int, *, title: str, kind: str = "minutes", audience: str = "members", member_id: int | None = None,
                       what: str = "signed", revision: int = 1, date: str = "2026-09-24T18:02:11+00:00") -> dict:
    content = document_pdf_bytes(document_id, revision)
    return {"document_id": document_id, "revision": revision, "derived_from": 0, "code": f"DOC{document_id:02d}-{revision}", "kind": kind, "title": title,
            "date": date, "what": what, "sha256": hashlib.sha256(content).hexdigest(), "size": len(content), "audience": audience,
            "_member_id": member_id}


def membership_fee(fee_id: int, label: str, *, amount: float | None = 50.0, for_whom: str = "natural", description: str = "",
                   admission_fee: float = 0, prorated: bool = False) -> dict:
    return {
        "id": fee_id, "label": label, "description": description, "for": for_whom, "subscription_required": amount is not None,
        "amount": amount, "amount_editable": False, "duration": {"value": 1, "unit": "y"}, "year_starts_month": 1,
        "prorated": prorated, "proration": "half_year" if prorated else "none", "admission_fee": admission_fee, "currency": "EUR",
    }


def invoice(invoice_id: int, *, ref: str | None = None, kind: str = "standard", status: str = "open", total: float = 60,
            remaining: float | None = None, date: str = "2026-08-01", due: str = "2026-08-15", payment_url: str = "", fee: bool = True) -> dict:
    if remaining is None:
        remaining = 0 if status in ("paid", "abandoned") else total
    return {"id": invoice_id, "ref": ref or f"FA-{invoice_id}", "type": kind, "date": date, "due_date": due, "total": total,
            "remaining": remaining, "status": status, "overdue": status == "overdue", "payment_url": payment_url, "fee": fee}


def ballot_right(right_id: int, *, for_: str = "self", name: str = "", state: str = "open", reason: str = "own", option: str = "") -> dict:
    """Ein Stimmrecht, wie das Modul es festhält: eigenes oder Vollmacht, offen oder genutzt."""
    return {"right_id": right_id, "for": for_, "name": name, "state": state, "reason": reason, "option": option}


def member(member_id: int, *, status: str = "active", firstname: str = "Paula", lastname: str = "Beispiel",
           type_id: int = 2, type_label: str = "Ordentliches Mitglied", functions: list | None = None,
           fee_status: str = "paid", paid_until: str = "2026-12-31", membership_ends: str = "",
           updated_at: str = "2026-09-17T06:12:40Z", member_since: str = "2023-01-01") -> dict:
    return {
        "id": member_id, "ref": str(member_id), "firstname": firstname, "lastname": lastname, "company": "",
        "type": {"id": type_id, "label": type_label}, "status": status,
        "member_since": "" if status == "draft" else member_since, "paid_until": paid_until,
        "functions": functions or [], "membership_ends": membership_ends, "currency": "EUR",
        "fee": {"required": True, "status": fee_status, "next_due": "2027-01-01", "amount": 50,
                "discount": {"kind": "none", "label": ""}, "payer": "self", "payment_url": ""},
        "open_invoices": [], "updated_at": updated_at,
    }


class FakeDolibarr:
    def __init__(self):
        self.members: dict[int, dict] = {}
        self.emails: dict[str, list[int]] = {}
        # Rechnungen je Mitglied (#296); PDFs werden daraus erzeugt, Bytes fest je Rechnung.
        self.invoices: dict[int, list[dict]] = {}
        self.pdf_failures: set[int] = set()
        self.calls: list[tuple[str, dict]] = []
        self.fail_with: int | None = None
        self.fail_paths: set[str] = set()
        self.break_after_pages: int | None = None
        self.core_status = 403
        self.server_time = "2026-09-21T10:00:00Z"
        self.module_version = MANIFEST["vereine"]["module_version"]
        # Kern-API für die Abrechnung (#316, #317): Geschäftspartner, Belege, Mitglieder (fk_soc),
        # Leistungen. Formen wie Dolibarrs eigene REST-API (22-24); kein Vertrag des Vereinsmoduls.
        self.thirdparties: dict[int, dict] = {}
        # Kategorien der Geschäftspartner (#405): Sponsor/Partner mit Unterkategorien; Zuordnung je Firma.
        self.categories: list[dict] = []
        self.thirdparty_categories: dict[int, set[int]] = {}
        self.core_members: dict[int, dict] = {}
        self.products: dict[int, dict] = {}
        self.core_invoices: dict[int, dict] = {}
        self.next_id = 100
        self.write_key = API_KEY
        self.posts: list[tuple[str, dict]] = []
        # Konditionen (#370): Wörterbücher wie in einem frischen Dolibarr, Bankkonten nur mit Recht.
        self.payment_terms = [{"id": 1, "code": "RECEP", "label": "Sofort"}, {"id": 2, "code": "30D", "label": "30 Tage"}, {"id": 3, "code": "30DENDMONTH", "label": "30 Tage Monatsende"}]
        self.payment_types = [{"id": 2, "code": "VIR", "label": "Banküberweisung"}, {"id": 4, "code": "LIQ", "label": "Bar"}, {"id": 6, "code": "CB", "label": "Kreditkarte"}]
        self.bank_accounts: list[dict] = [{"id": 1, "ref": "GIRO", "label": "Girokonto", "bank": "Raiffeisen"}]
        self.bank_readable = True
        # Vereinsdaten und Vorstand (#326) - Testwerte, keine echten Personen.
        self.organization = {
            "name": "Testverein Löwen", "register": {"kind": "ZVR", "number": "123456789"},
            "authority": "Bezirkshauptmannschaft Testbezirk", "address": {"street": "Teststraße 1", "zip": "6410", "town": "Testdorf", "country_code": "AT"},
            "email": "office@runtime-verein.test", "phone": "+43 5262 0", "url": "https://runtime-verein.test", "founded": "2019-03-01",
            "nonprofit": True, "purpose": "Förderung des eSports", "fiscal_year_start_month": 1,
            "channels": [{"network": "twitch", "network_label": "Twitch", "label": "Hauptstream", "target": "testverein",
                          "url": "https://www.twitch.tv/testverein", "stream": True, "live_url": "https://www.twitch.tv/testverein"},
                         {"network": "discord", "network_label": "Discord", "label": "Community", "target": "https://discord.gg/testverein",
                          "url": "https://discord.gg/testverein", "stream": False, "live_url": ""},
                         {"network": "twitter", "network_label": "X", "label": "Ohne Adresse", "target": "testverein", "url": "", "stream": False, "live_url": ""}],
        }
        # Statuten (#326 Teil 3): drei beschlossene Fassungen - aufgehoben, geltend, künftig; der Entwurf fehlt bewusst.
        self.statutes = {
            "state": "in_force",
            "current": statute_version(3, 2, decided_on="2026-03-14", valid_from="2026-04-20", valid_to="2026-12-31", state="in_force"),
            "versions": [
                statute_version(5, 3, decided_on="2026-09-01", valid_from="2027-01-01", state="future"),
                statute_version(3, 2, decided_on="2026-03-14", valid_from="2026-04-20", valid_to="2026-12-31", state="in_force"),
                statute_version(1, 1, decided_on="2019-02-10", valid_from="2019-03-01", valid_to="2026-04-19", state="repealed"),
            ],
        }
        self.statutes_public = True          # Einrichtung > Statuten: für die Öffentlichkeit freigegeben
        self.statutes_members = False        # … oder nur für Mitglieder (über die Bindung, Fähigkeit documents)
        # Persönlicher Zugriff (#324): Einladungen je Code, Bindungen je Kennung, veröffentlichte Dokumente der Akte.
        self.identity_right = True           # die Website darf „für Personen handeln“ (Recht im Modul)
        self.members_act_right = True        # … „im Namen jedes Mitglieds handeln“ (Vereine 1.4.0: member_id statt subject, #531)
        self.invitations: dict[str, dict] = {}
        self.identities: dict[str, dict] = {}
        # Versammlungen und Abstimmungen (#327, Vereine 1.4): Einladungen je Sitzung, Antworten, Anträge,
        # Abstimmungen mit Stimmrechten je Mitglied, Anwesenheitsliste, abgegebene Stimmen.
        self.meetings: dict[int, dict] = {}
        self.meeting_invites: dict[int, dict[int, bool]] = {}
        self.meeting_responses: dict[tuple[int, int], dict] = {}
        self.motions: dict[int, list[dict]] = {}
        self.ballots: dict[int, dict] = {}
        self.ballot_rights: dict[int, dict[int, list[dict]]] = {}
        self.present: dict[int, set[int]] = {}
        self.votes: dict[tuple[int, str], dict] = {}
        self.members_vote_right = True       # „… im Namen jedes Mitglieds abstimmen“ (member_id-Modus)
        self.today = "2026-09-25"
        self.published_documents: list[dict] = []
        self.tampered_document_ids: set[int] = set()
        # Eigene Daten und Austritt (#329 Teil 2): Profil je Mitglied, Einreichungen je Kennung, Kündigungsregel.
        self.profiles: dict[int, dict] = {}
        self.profile_requests: dict[str, list[dict]] = {}
        self.direct_fields = ["phone", "phone_mobile"]
        self.exit_rule_last_day = "2026-12-31"
        # Website-Profil je Mitglied (#255): was der Verein in Dolibarr pflegt, und das Foto der Mitgliedskarte.
        self.website_profile_consent = ""
        self.member_profiles: dict[int, dict] = {}
        self.tampered_pdf_ids: set[int] = set()  # Fassungen, deren Datei nicht mehr zur Akte passt
        self.tampered_invoice_ids: set[int] = set()  # Rechnungen, deren PDF nicht mehr zur Prüfsumme passt (1.4.0)
        self.board = [
            {"code": "obmann", "label": "Obmann", "board": True, "represents": True, "auditor": False, "holders": [{"name": "Otto Obmann", "since": "2024-04-01"}]},
            {"code": "kassier", "label": "Kassier:in", "board": True, "represents": False, "auditor": False, "holders": [{"name": None, "since": "2024-04-01"}]},
            {"code": "rechnungspruefung", "label": "Rechnungsprüfer:in", "board": False, "represents": False, "auditor": True, "holders": []},
        ]
        # Beitrittsantrag (#328): Pflichtfelder wie ab Werk, zwei Mitgliedsarten, ein Einwilligungstext; Anträge je external_id.
        self.application_form = {"required": ["lastname", "firstname", "address", "zip", "town", "email"], "fields": [], "accounts": []}
        self.membership_fees = [membership_fee(2, "Ordentliches Mitglied", amount=50.0, description="Mit Stimmrecht", prorated=True),
                                membership_fee(3, "Jugend", amount=20.0, description="Bis 18"), membership_fee(4, "Firma", amount=200.0, for_whom="legal")]
        self.consent_texts = [{"code": "fotos", "label": "Fotos auf der Website", "version": 2, "text": "Fotos von Veranstaltungen dürfen auf der Website erscheinen."}]
        self.applications: dict[str, dict] = {}
        # Einwilligungen je Mitglied (#329): Zweck -> Stand; Aufträge je reference nur einmal.
        self.member_consents: dict[int, dict[str, dict]] = {}
        self.consent_references: set[str] = set()

    def decide(self, external_id: str, status: str, reason: str = "") -> dict:
        """Der Verein entscheidet in Dolibarr: aufgenommen wird das Entwurfsmitglied aktiv."""
        row = self.applications[external_id]
        row["status"] = status
        row["decided_at"] = "2026-09-24T18:00:00+02:00"
        row["reason"] = reason if status == "rejected" else ""
        if status == "accepted":
            row["member_id"] = row["draft_member_id"]
            row["member_ref"] = str(row["draft_member_id"])
            self.members[row["draft_member_id"]]["status"] = "active"
            self.members[row["draft_member_id"]]["member_since"] = "2026-09-24"
        return row

    def add(self, summary: dict, email: str | None = None) -> dict:
        self.members[summary["id"]] = summary
        if email:
            self.emails.setdefault(email.lower(), []).append(summary["id"])
        return summary

    def add_invoice(self, member_id: int, invoice: dict) -> dict:
        self.invoices.setdefault(member_id, []).append(invoice)
        return invoice

    @staticmethod
    def pdf_bytes(invoice_id: int) -> bytes:
        return b"%PDF-1.7\n%fake-invoice-" + str(invoice_id).encode() + b"\n%%EOF\n"

    def _invoice_pdf(self, template: str, invoice_id: int) -> httpx.Response:
        """Das PDF mit Prüfsumme (Vereine 1.4.0) - eine manipulierte Datei passt nicht mehr dazu."""
        content = self.pdf_bytes(invoice_id)
        digest = hashlib.sha256(content).hexdigest()
        if invoice_id in self.tampered_invoice_ids:
            content = b"%PDF-1.7" + NL_BYTES + b"%tampered" + NL_BYTES + b"%%EOF" + NL_BYTES
        return self._json(template, {"filename": f"FA-{invoice_id}.pdf", "content_type": "application/pdf", "filesize": len(content),
                                     "sha256": digest, "content": base64.b64encode(content).decode()})

    def invite(self, code: str, member_id: int, capabilities: tuple[str, ...] = ("documents",)) -> None:
        """Einrichtung > Externe Identitäten: eine Einladung für ein Mitglied, einmal einlösbar."""
        self.invitations[code] = {"member_id": member_id, "capabilities": list(capabilities), "used": False}

    def publish(self, document_id: int, **fields) -> dict:
        row = published_document(document_id, **fields)
        self.published_documents.append(row)
        return row

    def revoke_identity(self, subject: str) -> None:
        if subject in self.identities:
            self.identities[subject]["revoked"] = True

    def _website_fields(self, member_id: int) -> list[dict]:
        """Die Felder des Website-Profils (Vereine 1.2). Alt gespeicherte Werte (gamertag/bio/games/platforms) erscheinen
        wie nach dem Update des Moduls: Textfelder mit denselben Codes, Listen als „a, b“."""
        stored = self.member_profiles.get(member_id) or {}
        if isinstance(stored.get("fields"), list):
            return [dict(f) for f in stored["fields"]]
        legacy = [("gamertag", "Gamertag", "text", 40), ("bio", "Kurztext", "textarea", 2000), ("games", "Spiele", "text", 255), ("platforms", "Plattformen", "text", 255)]
        fields = []
        for code, label, kind, limit in legacy:
            if code not in stored:
                continue
            value = stored.get(code)
            if isinstance(value, list):
                value = ", ".join(str(v) for v in value)
            fields.append({"code": code, "label": label, "type": kind, "editable": False, "value": str(value).strip() or None if value is not None else None, "max_length": limit})
        return fields

    def _identity(self, params: dict, capability: str | None = None) -> dict | None:
        ident = self.identities.get(str(params.get("subject") or ""))
        if not ident or ident.get("revoked"):
            return None
        if capability and capability not in ident["capabilities"]:
            return None
        return ident

    def _person(self, params: dict, capability: str | None = None) -> tuple[dict | None, httpx.Response | None]:
        """Für wen der Aufruf gilt: subject (Bindung) oder ab 1.4.0 member_id (Recht „im Namen jedes Mitglieds handeln“).
        Beides zusammen 400, altes Modul 400 „subject is needed“, fehlendes Recht 403, unbekanntes Mitglied 404."""
        subject, member_id = str(params.get("subject") or ""), str(params.get("member_id") or "")
        if member_id:
            if subject:
                return None, httpx.Response(400, json={"error": {"code": 400, "message": "subject and member_id are exclusive"}})
            version = tuple(int("".join(ch for ch in piece if ch.isdigit()) or 0) for piece in str(self.module_version).split(".")[:3])
            if version < (1, 4, 0):
                return None, httpx.Response(400, json={"error": {"code": 400, "message": "subject is needed"}})
            if not self.members_act_right:
                return None, httpx.Response(403, json={"error": {"code": 403, "message": "Not allowed: the user needs the right to act for members"}})
            if not member_id.isdigit() or int(member_id) not in self.members:
                return None, httpx.Response(404, json={"error": {"code": 404, "message": "Member not found"}})
            return {"subject": None, "member_id": int(member_id), "application_id": None,
                    "capabilities": ["documents", "consents", "votes", "meetings", "profile", "events", "accounts", "website", "invoices"]}, None
        ident = self._identity(params, capability)
        if ident is None:
            return None, httpx.Response(403, json={"error": {"code": 403, "message": "Not allowed"}})
        return ident, None

    def profile_for(self, member_id: int) -> dict:
        """Die eigenen Daten, wie das Modul sie liefert - beim ersten Zugriff aus der Zusammenfassung gebaut."""
        if member_id not in self.profiles:
            summary = self.members.get(member_id) or {}
            email = next((address for address, ids in self.emails.items() if member_id in ids), "")
            self.profiles[member_id] = {
                "member_id": member_id, "ref": str(member_id), "firstname": summary.get("firstname") or "Paula", "lastname": summary.get("lastname") or "Beispiel",
                "birth": "1990-05-04", "address": "Teststraße 1", "zip": "6410", "town": "Testdorf", "country_code": "AT", "phone": "", "phone_mobile": "+43 660 0000000",
                "email": email, "member_type": (summary.get("type") or {}).get("label") or "Ordentliches Mitglied", "status": "active",
                "version": "v1", "direct": list(self.direct_fields), "exit": None,
            }
        return self.profiles[member_id]

    # ---------- Versammlungen und Abstimmungen (#327)
    def add_meeting(self, meeting_id: int, *, kind: str = "general", title: str = "Generalversammlung 2026", day: str = "2026-10-24", time: str = "18:00",
                    format: str = "hybrid", place: str = "Vereinsheim", access: str = "https://meet.example.test/gv-2026", status: str = "invited",
                    agenda=("Begrüßung", "Bericht des Vorstands"), motion_deadline: str = "2026-10-21", invited=()) -> dict:
        """Eine Sitzung mit Einladungen: ``invited`` = [(member_id, stimmberechtigt)]."""
        self.meetings[meeting_id] = {
            "id": meeting_id, "kind": kind, "title": title, "day": day, "time": time, "timezone": "Europe/Vienna", "format": format,
            "place": "" if format == "virtual" else place, "access": "" if format == "physical" else access, "status": status,
            "agenda": list(agenda), "motion_deadline": "" if kind == "board" else motion_deadline,
        }
        self.meeting_invites[meeting_id] = {int(member_id): bool(voting) for member_id, voting in invited}
        return self.meetings[meeting_id]

    def add_ballot(self, ballot_id: int, meeting_id: int, *, item: int = 3, kind: str = "resolution", question: str = "Entlastung des Vorstands",
                   status: str = "released", closes: str = "", options: list[dict] | None = None, rights: dict[int, list[dict]] | None = None) -> dict:
        self.ballots[ballot_id] = {
            "id": ballot_id, "meeting_id": meeting_id, "item": item, "kind": kind, "question": question, "status": status, "closes": closes,
            "options": options or [{"code": "yes", "label": "Ja"}, {"code": "no", "label": "Nein"}, {"code": "abstain", "label": "Enthaltung"}],
            "result": None,
        }
        self.ballot_rights[ballot_id] = {int(member_id): [dict(row) for row in rows] for member_id, rows in (rights or {}).items()}
        return self.ballots[ballot_id]

    def set_ballot_status(self, ballot_id: int, status: str) -> None:
        self.ballots[ballot_id]["status"] = status

    def confirm_result(self, ballot_id: int, *, outcome: str = "passed", passed: bool = True, counts: dict | None = None, valid: int = 0,
                       abstain: int = 0, winner: str = "") -> None:
        self.ballots[ballot_id]["result"] = {"revision": 1, "outcome": outcome, "passed": passed, "counts": dict(counts or {}), "valid": valid, "abstain": abstain, "winner": winner}

    def _rights_for(self, ballot_id: int, member_id: int) -> list[dict]:
        """Die Stimmrechte der Person - beim Öffnen aus der Einladung festgehalten, danach nur noch genutzt."""
        rows = self.ballot_rights.setdefault(ballot_id, {})
        if member_id not in rows:
            voting = self.meeting_invites.get(self.ballots[ballot_id]["meeting_id"], {}).get(member_id, False)
            rows[member_id] = [ballot_right(1000 + member_id) if voting else ballot_right(0, state="none", reason="no_voting_right")]
        return rows[member_id]

    def _my_meeting(self, meeting_id: int, member_id: int) -> dict:
        base = self.meetings[meeting_id]
        answer = self.meeting_responses.get((meeting_id, member_id)) or {"response": "", "responded_at": ""}
        motions = [{key: value for key, value in row.items() if key != "member_id"} for row in self.motions.get(meeting_id, []) if row["member_id"] == member_id]
        return {**base, "voting": self.meeting_invites[meeting_id][member_id], "response": answer["response"], "responded_at": answer["responded_at"], "motions": motions}

    def _my_ballot(self, ballot_id: int, member_id: int) -> dict:
        ballot = self.ballots[ballot_id]
        meeting = self.meetings[ballot["meeting_id"]]
        return {
            "id": ballot_id, "meeting_id": ballot["meeting_id"], "meeting": meeting["title"], "day": meeting["day"], "item": ballot["item"], "kind": ballot["kind"],
            "question": ballot["question"], "status": ballot["status"], "closes": ballot["closes"], "timezone": meeting["timezone"], "options": ballot["options"],
            "rights": self._rights_for(ballot_id, member_id), "result": ballot["result"],
        }

    def _json_method(self, template: str, method: str, payload) -> httpx.Response:
        validate(payload, OPENAPI["paths"][template][method]["responses"]["200"]["content"]["application/json"]["schema"])
        return httpx.Response(200, json=payload)

    def _vote_person(self, params: dict) -> tuple[dict | None, httpx.Response | None]:
        """Abstimmen über die Mitgliedsnummer braucht das zweite Recht „… im Namen jedes Mitglieds abstimmen“."""
        ident, denied = self._person(params, "votes")
        if denied:
            return None, denied
        if params.get("member_id") and not self.members_vote_right:
            return None, httpx.Response(403, json={"error": {"code": 403, "message": "Not allowed: the user needs the right to vote for members"}})
        return ident, None

    def _statutes_payload(self, visible: bool) -> dict:
        return self.statutes if visible else {"state": "not_published", "current": None, "versions": []}

    def _statute_pdf(self, template: str, version_id: int, visible: bool) -> httpx.Response:
        row = next((v for v in self.statutes["versions"] if v["id"] == version_id), None) if visible else None
        if row is None:
            return httpx.Response(404, json={"error": {"code": 404, "message": "No such version for the caller"}})
        content = b"%PDF-1.7" + NL_BYTES + b"%tampered" + NL_BYTES + b"%%EOF" + NL_BYTES if version_id in self.tampered_pdf_ids else statute_pdf_bytes(version_id)
        # Die Prüfsumme ist die der Vereinsakte - passt die Datei nicht mehr dazu, merkt es die Website.
        return self._json(template, {"filename": f"Statuten-{row['version']}.pdf", "content_type": "application/pdf", "filesize": len(content),
                                     "sha256": row["sha256"], "content": base64.b64encode(content).decode()})

    def _visible_documents(self, member_id: int | None) -> list[dict]:
        rows = []
        for row in self.published_documents:
            audience = row["audience"]
            if audience == "public" or (member_id is not None and (audience == "members" or (audience == "person" and row.get("_member_id") == member_id))):
                rows.append({k: v for k, v in row.items() if not k.startswith("_")})
        return rows

    def _document_pdf(self, template: str, rows: list[dict], document_id: int) -> httpx.Response:
        row = next((r for r in rows if r["document_id"] == document_id), None)
        if row is None:
            return httpx.Response(404, json={"error": {"code": 404, "message": "No such document for the caller"}})
        content = b"%PDF-1.7\n%corrupt\n%%EOF\n" if document_id in self.tampered_document_ids else document_pdf_bytes(document_id, row["revision"])
        return self._json(template, {"filename": f"{row['code']}.pdf", "content_type": "application/pdf", "filesize": len(content),
                                     "sha256": row["sha256"], "content": base64.b64encode(content).decode()})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _json(self, template: str, payload, status: int = 200) -> httpx.Response:
        if status == 200:
            validate(payload, response_schema(template))
        return httpx.Response(status, json=payload)

    def _json_post(self, template: str, payload) -> httpx.Response:
        validate(payload, OPENAPI["paths"][template]["post"]["responses"]["200"]["content"]["application/json"]["schema"])
        return httpx.Response(200, json=payload)

    def _consent_rows(self, member_id: int) -> list[dict]:
        rows = []
        state = self.member_consents.get(member_id, {})
        for text in self.consent_texts:
            own = state.get(text["code"], {"state": "none", "version": 0, "moment": ""})
            rows.append({
                "code": text["code"], "label": text["label"], "state": own["state"], "version": own["version"], "current_version": text["version"],
                "moment": own.get("moment") or "", "can_give": own["state"] != "given" or own["version"] < text["version"], "can_withdraw": own["state"] == "given",
            })
        return rows

    def _consent_decision(self, member_id: int, body: dict) -> httpx.Response:
        """Wie das Modul: Zustimmen nur mit der gezeigten Version, Widerruf immer, reference nur einmal,
        eine Zustimmung vor einem gespeicherten Widerruf bleibt abgewiesen."""
        validate(body, request_schema("/vereine/members/{id}/consents"))
        if member_id not in self.members:
            return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        text = next((t for t in self.consent_texts if t["code"] == body.get("code")), None)
        if not text:
            return httpx.Response(400, json={"error": {"code": 400, "message": "unknown purpose"}})
        own = self.member_consents.setdefault(member_id, {}).get(body["code"], {"state": "none", "version": 0, "moment": ""})
        reference = body.get("reference")
        if reference and reference in self.consent_references:
            return self._json_post("/vereine/members/{id}/consents", {"code": body["code"], "state": own["state"] if own["state"] != "none" else body["decision"], "version": own["version"], "recorded": False})
        if body["decision"] == "given":
            if body.get("version") != text["version"]:
                return httpx.Response(400, json={"error": {"code": 400, "message": "consent version outdated"}})
            if own["state"] == "withdrawn" and body.get("granted_at") and body["granted_at"] < own.get("moment", ""):
                return httpx.Response(409, json={"error": {"code": 409, "message": "withdrawal is newer"}})
            own = {"state": "given", "version": text["version"], "moment": body.get("granted_at") or "2026-09-23T10:00:00+02:00"}
        else:
            own = {"state": "withdrawn", "version": own["version"], "moment": body.get("granted_at") or "2026-09-23T10:00:00+02:00"}
        self.member_consents[member_id][body["code"]] = own
        if reference:
            self.consent_references.add(reference)
        return self._json_post("/vereine/members/{id}/consents", {"code": body["code"], "state": own["state"], "version": own["version"], "recorded": True})

    def _application(self, body: dict) -> httpx.Response:
        """POST /vereine/applications wie das Modul: Pflichtfelder aus dem Formular, bekannte Felder,
        aktuelle Einwilligungsversionen; dieselbe external_id legt nie ein zweites Mitglied an."""
        validate(body, request_schema("/vereine/applications"))
        external_id = body.get("external_id") or f"anon-{self.next_id + 1}"
        existing = self.applications.get(external_id)
        if existing:
            if existing["payload"] != body:
                return httpx.Response(409, json={"error": {"code": 409, "message": "x"}})
            known_member = self.members[existing["draft_member_id"]]
            return self._json_post("/vereine/applications", {"id": known_member["id"], "ref": known_member["ref"], "status": known_member["status"], "duplicate": True, "document": True, "application_status": existing["status"]})
        for field in self.application_form["required"]:
            if not str(body.get(field) or "").strip():
                return httpx.Response(400, json={"error": {"code": 400, "message": f"{field} is required"}})
        known = {f["code"]: f for f in self.application_form["fields"]}
        for code in body.get("fields") or {}:
            if code not in known:
                return httpx.Response(400, json={"error": {"code": 400, "message": f"fields.{code} unknown"}})
        for code, meta in known.items():
            if meta["required"] and not str((body.get("fields") or {}).get(code) or "").strip():
                return httpx.Response(400, json={"error": {"code": 400, "message": f"fields.{code} is required"}})
        current = {c["code"]: c["version"] for c in self.consent_texts}
        for consent in body.get("consents") or []:
            if current.get(consent.get("code")) != consent.get("version"):
                return httpx.Response(400, json={"error": {"code": 400, "message": "consent version outdated"}})
        if not any(fee["id"] == body.get("type_id") and fee["for"] in ("natural", "both") for fee in self.membership_fees):
            return httpx.Response(400, json={"error": {"code": 400, "message": "type_id unknown"}})
        self.next_id += 1
        member_id = self.next_id
        self.members[member_id] = member(member_id, status="draft", firstname=body["firstname"], lastname=body["lastname"], type_id=body["type_id"],
                                         type_label=next(fee["label"] for fee in self.membership_fees if fee["id"] == body["type_id"]), fee_status="due", paid_until="")
        if body.get("email"):
            self.emails.setdefault(body["email"].lower(), []).append(member_id)
        self.applications[external_id] = {
            "external_id": external_id, "status": "received", "received_at": "2026-09-23T10:15:00+02:00", "decided_at": "", "reason": "",
            "member_id": 0, "member_ref": "", "payload": body, "draft_member_id": member_id,
        }
        return self._json_post("/vereine/applications", {"id": member_id, "ref": str(member_id), "status": "draft", "duplicate": False, "document": True, "application_status": "received"})

    # ------------------------------------------------ Kern-API (Abrechnung)
    def add_thirdparty(self, name: str, email: str = "", **extra) -> dict:
        self.next_id += 1
        row = {"id": self.next_id, "name": name, "email": email, "client": 1, **extra}
        self.thirdparties[row["id"]] = row
        return row

    def add_category(self, label: str, *, parent: int | None = None, kind: str = "customer") -> dict:
        """Wie Dolibarrs `/categories`: Kennungen als Text, `fk_parent` 0 für Oberkategorien, Typ Kunde = 2."""
        self.next_id += 1
        row = {"id": str(self.next_id), "label": label, "fk_parent": str(parent or 0), "type": {"customer": "2", "supplier": "1", "member": "3"}.get(kind, "2"), "description": ""}
        self.categories.append(row)
        return row

    def categorize(self, thirdparty_id: int, *categories: int) -> None:
        self.thirdparty_categories.setdefault(int(thirdparty_id), set()).update(int(c) for c in categories)

    def add_core_member(self, member_id: int, fk_soc: int | None = None) -> dict:
        row = {"id": member_id, "fk_soc": fk_soc}
        self.core_members[member_id] = row
        return row

    def _core(self, request: httpx.Request, path: str, params: dict) -> httpx.Response | None:
        method = request.method
        body = json.loads(request.content.decode("utf-8")) if request.content else {}
        if method == "POST":
            self.posts.append((path, body))
            assert request.headers.get("DOLAPIKEY") == self.write_key, "Schreiben nur mit dem Schreib-Schlüssel"
        if path == "/categories" and method == "GET":
            wanted = {"customer": "2", "supplier": "1", "member": "3"}.get(params.get("type", "customer"), "2")
            rows = [c for c in self.categories if c["type"] == wanted]
            return httpx.Response(200, json=rows) if rows else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        if path == "/thirdparties" and method == "GET" and params.get("category"):
            # Wie Dolibarr: nur genau diese Kategorie (keine Unterkategorien), Kennungen als Text, 404 bei leer.
            wanted = int(params["category"])
            page, limit = int(params.get("page", 0)), int(params.get("limit", 100))
            rows = [{**r, "id": str(r["id"])} for _id, r in sorted(self.thirdparties.items()) if wanted in self.thirdparty_categories.get(_id, set())]
            rows = rows[page * limit:(page + 1) * limit]
            return httpx.Response(200, json=rows) if rows else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        if path == "/thirdparties" and method == "GET":
            match = re.search(r"t\.email:=:'([^']*)'", params.get("sqlfilters", ""))
            rows = [r for r in self.thirdparties.values() if match and r.get("email", "").lower() == match.group(1).lower()]
            return httpx.Response(200, json=rows) if rows else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        if path == "/thirdparties" and method == "POST":
            assert body.get("client") == 1 and body.get("name"), "ein Kunde braucht einen Namen"
            row = self.add_thirdparty(body["name"], body.get("email", ""), note_private=body.get("note_private", ""))
            return httpx.Response(200, json=row["id"])
        match = re.fullmatch(r"/thirdparties/(\d+)", path)
        if match and method == "GET":
            row = self.thirdparties.get(int(match.group(1)))
            return httpx.Response(200, json=row) if row else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        match = re.fullmatch(r"/members/(\d+)", path)
        if match and method == "GET":
            row = self.core_members.get(int(match.group(1)))
            return httpx.Response(200, json=row) if row else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        if path == "/products" and method == "GET":
            assert params.get("mode") == "2", "nur Dienstleistungen, keine Waren"
            rows = [r for r in self.products.values() if str(r.get("fk_product_type", 1)) == "1"]
            return httpx.Response(200, json=rows) if rows else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        match = re.fullmatch(r"/products/(\d+)", path)
        if match and method == "GET":
            row = self.products.get(int(match.group(1)))
            return httpx.Response(200, json=row) if row else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        if path == "/invoices" and method == "GET":
            match = re.search(r"t\.ref_ext:=:'([^']*)'", params.get("sqlfilters", ""))
            source = re.search(r"t\.fk_facture_source:=:'?(\d+)'?", params.get("sqlfilters", ""))
            if source:
                # Gutschriften zu einem Beleg (#321): Art 2 mit Verweis auf das Original.
                rows = [r for r in self.core_invoices.values() if str(r.get("fk_facture_source") or "") == source.group(1)]
            else:
                rows = [r for r in self.core_invoices.values() if match and r.get("ref_ext") == match.group(1)]
            return httpx.Response(200, json=rows) if rows else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        match = re.fullmatch(r"/invoices/(\d+)/payments", path)
        if match and method == "GET":
            row = self.core_invoices.get(int(match.group(1)))
            if not row:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            rows = row.get("payments") or []
            return httpx.Response(200, json=rows) if rows else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        if path == "/invoices" and method == "POST":
            assert int(body.get("socid") or 0) in self.thirdparties, "Rechnung braucht einen bestehenden Geschäftspartner"
            assert body.get("lines"), "Rechnung ohne Zeilen"
            for line in body["lines"]:
                assert isinstance(line["subprice"], (int, float)) and int(line["qty"]) >= 1 and "tva_tx" in line
            self.next_id += 1
            total = round(sum(float(l["subprice"]) * int(l["qty"]) * (1 + float(l["tva_tx"]) / 100) for l in body["lines"]), 2)
            row = {"id": self.next_id, "ref": f"(PROV{self.next_id})", "ref_ext": body.get("ref_ext"), "socid": int(body["socid"]), "type": int(body.get("type") or 0),
                   "statut": 0, "paye": 0, "total_ttc": total, "remaintopay": total, "lines": body["lines"], "note_public": body.get("note_public", ""),
                   # Zahlungsziel (#321): 30 Tage nach dem Belegdatum, als Unix-Sekunden wie Dolibarr.
                   "date_lim_reglement": int(body.get("date") or 0) + 30 * 86400, "payments": [],
                   # Konditionen (#370): Dolibarr übernimmt sie beim Anlegen, sonst bleiben sie leer.
                   "cond_reglement_id": body.get("cond_reglement_id"), "mode_reglement_id": body.get("mode_reglement_id"), "fk_account": body.get("fk_account")}
            self.core_invoices[row["id"]] = row
            return httpx.Response(200, json=row["id"])
        if path == "/setup/dictionary/payment_terms" and method == "GET":
            return httpx.Response(200, json=self.payment_terms)
        if path == "/setup/dictionary/payment_types" and method == "GET":
            return httpx.Response(200, json=self.payment_types)
        if path == "/bankaccounts" and method == "GET":
            if not self.bank_readable:
                return httpx.Response(403, json={"error": {"code": 403, "message": "Insufficient rights"}})
            return httpx.Response(200, json=self.bank_accounts) if self.bank_accounts else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        match = re.fullmatch(r"/invoices/(\d+)/validate", path)
        if match and method == "POST":
            row = self.core_invoices.get(int(match.group(1)))
            if not row:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            row["statut"] = 1
            row["ref"] = f"FA2609-{row['id']:04d}"
            return httpx.Response(200, json=row)
        match = re.fullmatch(r"/invoices/(\d+)", path)
        if match and method == "GET":
            row = self.core_invoices.get(int(match.group(1)))
            return httpx.Response(200, json=row) if row else httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
        if path == "/documents" and method == "GET":
            # Dokument-API des Kerns (#320): das PDF eines freigegebenen Belegs unter <ref>/<ref>.pdf.
            assert params.get("modulepart") == "facture", "nur Rechnungsdokumente"
            match = re.fullmatch(r"([^/]+)/([^/]+)\.pdf", params.get("original_file", ""))
            row = next((r for r in self.core_invoices.values() if match and match.group(1) == match.group(2) and r.get("ref") == match.group(1) and int(r.get("statut") or 0) >= 1), None)
            if not row or row["id"] in self.pdf_failures:
                return httpx.Response(404 if not row else 500, json={"error": {"code": 404 if not row else 500, "message": "x"}})
            content = self.pdf_bytes(row["id"])
            return httpx.Response(200, json={"filename": f"{row['ref']}.pdf", "content-type": "application/pdf", "filesize": len(content),
                                             "content": __import__("base64").b64encode(content).decode(), "encoding": "base64"})
        return None

    def pay(self, invoice_id: int, amount: float | None = None, on: str = "2026-09-23", kind: str = "VIR") -> None:
        """Der Kassier bucht in Dolibarr eine Zahlung - die Website liest es nur. Ohne Betrag den
        ganzen Rest; ein Teilbetrag lässt den Rest offen; zu viel ergibt eine Überzahlung (Rest < 0)."""
        row = self.core_invoices[invoice_id]
        amount = float(row["remaintopay"]) if amount is None else float(amount)
        row.setdefault("payments", []).append({"amount": f"{amount:.2f}", "date": on, "type": kind, "ref": f"PAY-{len(row.get('payments') or []) + 1}", "num": ""})
        row["remaintopay"] = round(float(row["total_ttc"]) - sum(float(p["amount"]) for p in row["payments"]) - float(row.get("credited") or 0), 2)
        if row["remaintopay"] <= 0:
            row.update(statut=2, paye=1)

    def credit(self, invoice_id: int, amount: float, *, validated: bool = True) -> dict:
        """Eine Gutschrift in Dolibarr mit Bezug auf den Beleg (#321) - angewendet auf den Rest."""
        original = self.core_invoices[invoice_id]
        self.next_id += 1
        row = {"id": self.next_id, "ref": f"AV2609-{self.next_id:04d}" if validated else f"(PROV{self.next_id})", "type": 2, "fk_facture_source": invoice_id,
               "socid": original["socid"], "statut": 1 if validated else 0, "paye": 0, "total_ttc": -float(amount), "remaintopay": 0, "lines": [], "payments": []}
        self.core_invoices[row["id"]] = row
        if validated:
            original["credited"] = float(original.get("credited") or 0) + float(amount)
            original["remaintopay"] = round(float(original["total_ttc"]) - sum(float(p["amount"]) for p in original.get("payments") or []) - original["credited"], 2)
            if original["remaintopay"] <= 0:
                original.update(statut=2, paye=1)
        return row

    def abandon(self, invoice_id: int) -> None:
        self.core_invoices[invoice_id].update(statut=3)

    def remove(self, invoice_id: int) -> None:
        """Jemand löscht den Beleg in Dolibarr - die Website darf das nie, sieht es aber."""
        self.core_invoices.pop(invoice_id, None)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.scheme == "https", "die Website darf Dolibarr nur über https ansprechen"
        path = request.url.path.removeprefix("/api/index.php")
        params = dict(request.url.params)
        self.calls.append((path, params))
        if request.headers.get("DOLAPIKEY") not in (API_KEY, self.write_key):
            return httpx.Response(401, json={"error": {"code": 401, "message": "Unauthorized"}})
        assert API_KEY not in str(request.url), "der Schlüssel gehört nur in den Header"
        if self.fail_with and (not self.fail_paths or path in self.fail_paths):
            return httpx.Response(self.fail_with, json={"error": {"code": self.fail_with, "message": "x"}})
        core = self._core(request, path, params)
        if core is not None:
            return core
        if path == "/status":
            # Dolibarrs eigener Weg (Kern). Der Website-Benutzer hat dafür keine Rechte.
            return httpx.Response(self.core_status, json={"error": {"code": self.core_status, "message": "x"}})
        match = re.fullmatch(r"/vereine/members/(\d+)/(profile|photo)", path)
        if match and request.method == "GET":
            member_id, what = int(match.group(1)), match.group(2)
            if member_id not in self.members:
                return httpx.Response(404, json={"error": {"code": 404, "message": "No member with this id"}})
            code = self.website_profile_consent
            given = bool(code) and (self.member_consents.get(member_id, {}).get(code) or {}).get("state") == "given"
            stored = self.member_profiles.get(member_id) or {}
            photo_bytes = stored.get("photo")
            if what == "photo":
                if not given or not photo_bytes:
                    return httpx.Response(404, json={"error": {"code": 404, "message": "No photo for this member the website may show"}})
                return self._json("/vereine/members/{id}/photo", {
                    "filename": stored.get("photo_name") or "photo.png", "content_type": stored.get("photo_type") or "image/png", "filesize": len(photo_bytes),
                    "sha256": hashlib.sha256(photo_bytes).hexdigest(), "content": base64.b64encode(photo_bytes).decode()})
            payload = {"consent": code, "given": given}
            if given:
                payload.update({"fields": self._website_fields(member_id),
                                "photo": {"sha256": hashlib.sha256(photo_bytes).hexdigest(), "size": len(photo_bytes), "content_type": stored.get("photo_type") or "image/png",
                                          "updated_at": "2026-09-25T10:00:00Z"} if photo_bytes else None})
            return self._json("/vereine/members/{id}/profile", payload)
        match = re.fullmatch(r"/vereine/members/(\d+)/consents", path)
        if match and request.method == "GET":
            member_id = int(match.group(1))
            if member_id not in self.members:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            return self._json("/vereine/members/{id}/consents", self._consent_rows(member_id))
        if match and request.method == "POST":
            return self._consent_decision(int(match.group(1)), json.loads(request.content.decode("utf-8")))
        if path == "/vereine/applicationform":
            return self._json("/vereine/applicationform", self.application_form)
        if path == "/vereine/membershipfees":
            return self._json("/vereine/membershipfees", self.membership_fees)
        if path == "/vereine/consents":
            return self._json("/vereine/consents", self.consent_texts)
        if path == "/vereine/applications" and request.method == "POST":
            return self._application(json.loads(request.content.decode("utf-8")))
        match = re.fullmatch(r"/vereine/applications/([^/]+)/withdraw", path)
        if match and request.method == "POST":
            row = self.applications.get(match.group(1))
            if not row:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            if row["status"] in ("accepted", "rejected"):
                return httpx.Response(409, json={"error": {"code": 409, "message": "x"}})
            changed = row["status"] != "withdrawn"
            row["status"] = "withdrawn"
            return self._json_post("/vereine/applications/{external_id}/withdraw", {"external_id": row["external_id"], "status": "withdrawn", "changed": changed})
        match = re.fullmatch(r"/vereine/applications/([^/]+)", path)
        if match and request.method == "GET":
            row = self.applications.get(match.group(1))
            if not row:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            return self._json("/vereine/applications/{external_id}", {k: v for k, v in row.items() if k not in ("payload", "draft_member_id")})
        if path == "/vereine/identities/claim" and request.method == "POST":
            subject, code = str(params.get("subject") or ""), str(params.get("code") or "")
            invitation = self.invitations.get(code)
            current = self.identities.get(subject)
            if not self.identity_right or not subject or not invitation or invitation["used"] or (current and not current.get("revoked")):
                return httpx.Response(403, json={"error": {"code": 403, "message": "Not allowed"}})
            invitation["used"] = True
            identity = {"subject": subject, "member_id": invitation["member_id"], "application_id": None, "capabilities": list(invitation["capabilities"]),
                        "proof": "invitation", "linked_at": "2026-09-24T10:00:00Z"}
            self.identities[subject] = {**identity, "revoked": False}
            return self._json_post("/vereine/identities/claim", identity)
        if path == "/vereine/identities/me":
            ident = self._identity(params)
            if ident is None:
                return httpx.Response(403, json={"error": {"code": 403, "message": "Not allowed"}})
            return self._json("/vereine/identities/me", {k: v for k, v in ident.items() if k != "revoked"})
        if path == "/vereine/me/documents":
            ident, denied = self._person(params, "documents")
            if denied:
                return denied
            return self._json("/vereine/me/documents", self._visible_documents(ident["member_id"]))
        match = re.fullmatch(r"/vereine/me/documents/(\d+)/pdf", path)
        if match:
            ident, denied = self._person(params, "documents")
            if denied:
                return denied
            return self._document_pdf("/vereine/me/documents/{id}/pdf", self._visible_documents(ident["member_id"]), int(match.group(1)))
        if path == "/vereine/me/website-profile":
            ident, denied = self._person(params, "profile")
            if denied:
                return denied
            member_id = ident["member_id"]
            fields = self._website_fields(member_id)
            if request.method == "PUT":
                body = json.loads(request.content.decode("utf-8"))
                validate(body, request_schema("/vereine/me/website-profile", "put"))
                by_code = {f["code"]: f for f in fields}
                for code, value in body["fields"].items():
                    field = by_code.get(code)
                    if field is None:
                        return httpx.Response(400, json={"error": {"code": 400, "message": "Unknown field", "field": code}})
                    if not field.get("editable"):
                        return httpx.Response(400, json={"error": {"code": 400, "message": "Field is not editable", "field": code}})
                    if value in (None, "", []):
                        field["value"] = None
                        continue
                    kind = field.get("type", "text")
                    codes = [o["code"] for o in field.get("options") or []]
                    if kind in ("text", "textarea") and field.get("max_length") and len(str(value)) > field["max_length"]:
                        return httpx.Response(400, json={"error": {"code": 400, "message": f"At most {field['max_length']} characters", "field": code}})
                    if kind == "select" and value not in codes:
                        return httpx.Response(400, json={"error": {"code": 400, "message": "Not an option", "field": code}})
                    if kind == "multi" and (not isinstance(value, list) or any(v not in codes for v in value)):
                        return httpx.Response(400, json={"error": {"code": 400, "message": "Not an option", "field": code}})
                    if kind == "date" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value)):
                        return httpx.Response(400, json={"error": {"code": 400, "message": "Not a day", "field": code}})
                    field["value"] = str(value).strip() if kind in ("text", "textarea", "select", "date") else value
                self.member_profiles.setdefault(member_id, {})["fields"] = fields
            code = self.website_profile_consent
            given = bool(code) and (self.member_consents.get(member_id, {}).get(code) or {}).get("state") == "given"
            return self._json("/vereine/me/website-profile", {"consent": code, "given": given, "fields": fields})
        if path == "/vereine/me/profile" and request.method == "GET":
            ident, denied = self._person(params, "profile")
            if denied:
                return denied
            return self._json("/vereine/me/profile", self.profile_for(ident["member_id"]))
        if path == "/vereine/me/profile/changes":
            ident, denied = self._person(params, "profile")
            if denied:
                return denied
            rows = self.profile_requests.setdefault(f"m{ident['member_id']}", [])
            if request.method == "GET":
                return self._json("/vereine/me/profile/changes", rows)
            body = json.loads(request.content.decode("utf-8"))
            validate(body, request_schema("/vereine/me/profile/changes"))
            existing = next((row for row in rows if row["external_id"] == body["external_id"]), None)
            if existing:
                return self._json_post("/vereine/me/profile/changes", existing)
            profile = self.profile_for(ident["member_id"])
            if body["version"] != profile["version"]:
                return httpx.Response(409, json={"error": {"code": 409, "message": "version changed"}})
            allowed = ("address", "zip", "town", "country_code", "phone", "phone_mobile", "email")
            if any(key not in allowed for key in body["changes"]) or not body["changes"]:
                return httpx.Response(400, json={"error": {"code": 400, "message": "field not allowed"}})
            direct = {key: value for key, value in body["changes"].items() if key in profile["direct"]}
            applied = bool(direct) and len(direct) == len(body["changes"])
            row = {"external_id": body["external_id"], "kind": "change", "changes": dict(body["changes"]), "status": "applied" if applied else "received",
                   "received_at": "2026-09-24T12:00:00Z"}
            if applied:
                profile.update(direct)
                profile["version"] = f"v{int(profile['version'][1:]) + 1}"
                row["decided_at"] = "2026-09-24T12:00:00Z"
            rows.append(row)
            return self._json_post("/vereine/me/profile/changes", row)
        if path == "/vereine/me/meetings" and request.method == "GET":
            ident, denied = self._person(params, "meetings")
            if denied:
                return denied
            rows = [self._my_meeting(mid, ident["member_id"]) for mid in sorted(self.meetings, reverse=True) if ident["member_id"] in self.meeting_invites.get(mid, {})]
            return self._json("/vereine/me/meetings", rows)
        match = re.fullmatch(r"/vereine/me/meetings/(\d+)/response", path)
        if match and request.method == "PUT":
            ident, denied = self._person(params, "meetings")
            if denied:
                return denied
            mid = int(match.group(1))
            if mid not in self.meetings or ident["member_id"] not in self.meeting_invites.get(mid, {}):
                return httpx.Response(404, json={"error": {"code": 404, "message": "Meeting not found"}})
            body = json.loads(request.content.decode("utf-8"))
            validate(body, request_schema("/vereine/me/meetings/{id}/response", "put"))
            if self.meetings[mid]["status"] != "invited":
                return httpx.Response(409, json={"error": {"code": 409, "message": "meeting is over"}})
            self.meeting_responses[(mid, ident["member_id"])] = {"response": body["response"], "responded_at": f"{self.today}T10:00:00Z"}
            return self._json_method("/vereine/me/meetings/{id}/response", "put", self._my_meeting(mid, ident["member_id"]))
        match = re.fullmatch(r"/vereine/me/meetings/(\d+)/motions", path)
        if match and request.method == "POST":
            ident, denied = self._person(params, "meetings")
            if denied:
                return denied
            mid = int(match.group(1))
            meeting = self.meetings.get(mid)
            if not meeting or ident["member_id"] not in self.meeting_invites.get(mid, {}) or meeting["kind"] == "board":
                return httpx.Response(404, json={"error": {"code": 404, "message": "Meeting not found"}})
            body = json.loads(request.content.decode("utf-8"))
            validate(body, request_schema("/vereine/me/meetings/{id}/motions"))
            rows = self.motions.setdefault(mid, [])
            existing = next((row for row in rows if row["external_id"] == body["external_id"] and row["member_id"] == ident["member_id"]), None)
            if existing:
                if existing["title"] != body["title"] or existing["text"] != body.get("text", ""):
                    return httpx.Response(409, json={"error": {"code": 409, "message": "external_id already used with different content"}})
                return self._json_method("/vereine/me/meetings/{id}/motions", "post", {key: value for key, value in existing.items() if key != "member_id"})
            deadline = meeting["motion_deadline"]
            row = {"member_id": ident["member_id"], "external_id": body["external_id"], "title": body["title"], "text": body.get("text", ""),
                   "received_at": f"{self.today}T10:05:00Z", "late": bool(deadline) and self.today > deadline, "status": "received"}
            rows.append(row)
            return self._json_method("/vereine/me/meetings/{id}/motions", "post", {key: value for key, value in row.items() if key != "member_id"})
        if path == "/vereine/me/ballots" and request.method == "GET":
            ident, denied = self._vote_person(params)
            if denied:
                return denied
            rows = [self._my_ballot(bid, ident["member_id"]) for bid in sorted(self.ballots) if ident["member_id"] in self.meeting_invites.get(self.ballots[bid]["meeting_id"], {})]
            return self._json("/vereine/me/ballots", rows)
        match = re.fullmatch(r"/vereine/me/ballots/(\d+)/votes", path)
        if match and request.method == "POST":
            ident, denied = self._vote_person(params)
            if denied:
                return denied
            bid = int(match.group(1))
            ballot = self.ballots.get(bid)
            if not ballot or ident["member_id"] not in self.meeting_invites.get(ballot["meeting_id"], {}):
                return httpx.Response(404, json={"error": {"code": 404, "message": "Ballot not found"}})
            body = json.loads(request.content.decode("utf-8"))
            validate(body, request_schema("/vereine/me/ballots/{id}/votes"))
            right = next((row for row in self._rights_for(bid, ident["member_id"]) if row["right_id"] == body["right_id"] and row["right_id"] > 0), None)
            if right is None:
                return httpx.Response(404, json={"error": {"code": 404, "message": "Voting right not found"}})
            if body["option"] not in {option["code"] for option in ballot["options"]}:
                return httpx.Response(400, json={"error": {"code": 400, "message": "unknown option", "field": "option"}})
            if ballot["status"] == "released":
                return httpx.Response(409, json={"error": {"code": 409, "message": "not_open"}})
            if ballot["status"] != "open":
                return httpx.Response(409, json={"error": {"code": 409, "message": "closed"}})
            if ident["member_id"] not in self.present.get(ballot["meeting_id"], set()):
                return httpx.Response(409, json={"error": {"code": 409, "message": "not_present"}})
            external_id = str(body.get("external_id") or "")
            earlier = self.votes.get((bid, external_id)) if external_id else None
            if earlier:
                if earlier["right_id"] != body["right_id"] or earlier["option"] != body["option"]:
                    return httpx.Response(409, json={"error": {"code": 409, "message": "external_id"}})
                return self._json_method("/vereine/me/ballots/{id}/votes", "post", self._my_ballot(bid, ident["member_id"]))
            if right["state"] != "open":
                return httpx.Response(409, json={"error": {"code": 409, "message": "used"}})
            right["state"], right["option"] = "used", body["option"]
            self.votes[(bid, external_id or f"anon-{len(self.votes)}")] = {"right_id": body["right_id"], "option": body["option"], "member_id": ident["member_id"]}
            return self._json_method("/vereine/me/ballots/{id}/votes", "post", self._my_ballot(bid, ident["member_id"]))
        if path == "/vereine/me/exit" and request.method == "POST":
            ident, denied = self._person(params, "profile")
            if denied:
                return denied
            body = json.loads(request.content.decode("utf-8"))
            validate(body, request_schema("/vereine/me/exit"))
            rows = self.profile_requests.setdefault(f"m{ident['member_id']}", [])
            existing = next((row for row in rows if row["external_id"] == body["external_id"]), None)
            if existing:
                return self._json_post("/vereine/me/exit", existing)
            profile = self.profile_for(ident["member_id"])
            if profile.get("exit"):
                return httpx.Response(409, json={"error": {"code": 409, "message": "exit already planned"}})
            wished = str(body.get("wished_last_day") or "")
            last_day = wished if wished and wished > self.exit_rule_last_day else self.exit_rule_last_day
            row = {"external_id": body["external_id"], "kind": "exit", "status": "received", "received_at": "2026-09-24T12:00:00Z", "notice_day": "2026-09-24",
                   "last_day": last_day, "wished_last_day": wished, "wished_too_early": bool(wished and wished < self.exit_rule_last_day)}
            profile["exit"] = {"status": "planned", "reason": "", "notice_day": "2026-09-24", "last_day": last_day}
            rows.append(row)
            return self._json_post("/vereine/me/exit", row)
        if path == "/vereine/documents":
            return self._json("/vereine/documents", self._visible_documents(None))
        match = re.fullmatch(r"/vereine/documents/(\d+)/pdf", path)
        if match:
            return self._document_pdf("/vereine/documents/{id}/pdf", self._visible_documents(None), int(match.group(1)))
        if path == "/vereine/me/statutes":
            ident, denied = self._person(params, "documents")
            if denied:
                return denied
            return self._json("/vereine/me/statutes", self._statutes_payload(self.statutes_public or self.statutes_members))
        match = re.fullmatch(r"/vereine/me/statutes/(" + chr(92) + "d+)/pdf", path)
        if match:
            ident, denied = self._person(params, "documents")
            if denied:
                return denied
            return self._statute_pdf("/vereine/me/statutes/{id}/pdf", int(match.group(1)), self.statutes_public or self.statutes_members)
        if path == "/vereine/statutes":
            payload = self.statutes if self.statutes_public else {"state": "not_published", "current": None, "versions": []}
            return self._json("/vereine/statutes", payload)
        match = re.fullmatch(r"/vereine/statutes/(\d+)/pdf", path)
        if match:
            version_id = int(match.group(1))
            row = next((v for v in self.statutes["versions"] if v["id"] == version_id), None) if self.statutes_public else None
            if row is None:
                return httpx.Response(404, json={"error": {"code": 404, "message": "No such version for the caller"}})
            content = b"%PDF-1.7\n%tampered\n%%EOF\n" if version_id in self.tampered_pdf_ids else statute_pdf_bytes(version_id)
            return self._json("/vereine/statutes/{id}/pdf", {"filename": f"Statuten-{row['version']}.pdf", "content_type": "application/pdf", "filesize": len(content),
                                                            "sha256": hashlib.sha256(content).hexdigest(), "content": base64.b64encode(content).decode()})
        if path == "/vereine/organization":
            # Der Verein fürs Impressum (#326); die Form ist der Vertrag des Moduls.
            return self._json("/vereine/organization", self.organization)
        if path == "/vereine/board":
            return self._json("/vereine/board", self.board)
        if path == "/vereine/status":
            return self._json("/vereine/status", {
                "module_version": self.module_version, "api_version": 2, "server_time": self.server_time,
                # Website-Profil (#255): welche Einwilligung es öffnet - leer, wenn keine gewählt ist.
                "website_profile_consent": self.website_profile_consent,
            })
        if path == "/vereine/members":
            page, limit = int(params.get("page", 0)), int(params.get("limit", 100))
            if self.break_after_pages is not None and page >= self.break_after_pages:
                return httpx.Response(503, json={"error": {"code": 503, "message": "x"}})
            rows = [m for _id, m in sorted(self.members.items())]
            since = params.get("changed_since")
            if since:
                assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", since), "changed_since braucht eine Zeitzone"
                rows = [m for m in rows if m["updated_at"] >= since]
            return self._json("/vereine/members", rows[page * limit:(page + 1) * limit])
        if path == "/vereine/members/lookup":
            if "email" in params:
                ids = self.emails.get(params["email"].lower(), [])
            else:
                ids = [mid for mid, m in self.members.items() if m["ref"] == params.get("ref")]
            if not ids:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            if len(ids) > 1:
                return httpx.Response(409, json={"error": {"code": 409, "message": "x"}})
            return self._json("/vereine/members/lookup", self.members[ids[0]])
        match = re.fullmatch(r"/vereine/members/(\d+)/invoices", path)
        if match:
            member_id = int(match.group(1))
            if member_id not in self.members:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            page, limit = int(params.get("page", 0)), int(params.get("limit", 100))
            if not 1 <= limit <= 100 or page < 0:
                return httpx.Response(400, json={"error": {"code": 400, "message": "x"}})
            rows = sorted(self.invoices.get(member_id, []), key=lambda r: (r["date"], r["id"]), reverse=True)
            return self._json("/vereine/members/{id}/invoices", rows[page * limit:(page + 1) * limit])
        match = re.fullmatch(r"/vereine/members/(\d+)/invoices/(\d+)/pdf", path)
        if match:
            member_id, invoice_id = int(match.group(1)), int(match.group(2))
            own = any(r["id"] == invoice_id for r in self.invoices.get(member_id, []))
            if member_id not in self.members or not own:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            if invoice_id in self.pdf_failures:
                return httpx.Response(500, json={"error": {"code": 500, "message": "x"}})
            return self._invoice_pdf("/vereine/members/{id}/invoices/{invoice}/pdf", invoice_id)
        # Eigene Rechnungen über die Bindung oder die Mitgliedsnummer (Vereine 1.4.0, #324).
        if path == "/vereine/me/invoices":
            ident, denied = self._person(params, "invoices")
            if denied:
                return denied
            page, limit = int(params.get("page", 0)), int(params.get("limit", 100))
            if not 1 <= limit <= 100 or page < 0:
                return httpx.Response(400, json={"error": {"code": 400, "message": "x"}})
            rows = sorted(self.invoices.get(ident["member_id"], []), key=lambda r: (r["date"], r["id"]), reverse=True)
            return self._json("/vereine/me/invoices", rows[page * limit:(page + 1) * limit])
        match = re.fullmatch(r"/vereine/me/invoices/(" + chr(92) + "d+)/pdf", path)
        if match:
            ident, denied = self._person(params, "invoices")
            if denied:
                return denied
            invoice_id = int(match.group(1))
            if not any(r["id"] == invoice_id for r in self.invoices.get(ident["member_id"], [])):
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            if invoice_id in self.pdf_failures:
                return httpx.Response(500, json={"error": {"code": 500, "message": "x"}})
            return self._invoice_pdf("/vereine/me/invoices/{invoice}/pdf", invoice_id)
        match = re.fullmatch(r"/vereine/members/(\d+)/summary", path)
        if match:
            summary = self.members.get(int(match.group(1)))
            if not summary:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            return self._json("/vereine/members/{id}/summary", summary)
        raise AssertionError(f"Die Website ruft einen Weg auf, den es im Vertrag nicht gibt: {path}")
