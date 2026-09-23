"""Ein Dolibarr für die Tests, das sich an den echten Vertrag hält (#330).

Jede Antwort wird gegen `contracts/vereine-openapi.json` geprüft - die Datei, gegen
die das Vereinsmodul seine echten Antworten in Dolibarr 22, 23 und 24 selbst
prüft. Weicht eine Testantwort vom Vertrag ab, scheitert der Test hier und nicht
erst am Server. Fähigkeiten, die das Modul noch nicht hat, gibt es hier auch
nicht: keine erfundenen erfolgreichen Antworten.
"""
from __future__ import annotations

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


def invoice(invoice_id: int, *, ref: str | None = None, kind: str = "standard", status: str = "open", total: float = 60,
            remaining: float | None = None, date: str = "2026-08-01", due: str = "2026-08-15", payment_url: str = "", fee: bool = True) -> dict:
    if remaining is None:
        remaining = 0 if status in ("paid", "abandoned") else total
    return {"id": invoice_id, "ref": ref or f"FA-{invoice_id}", "type": kind, "date": date, "due_date": due, "total": total,
            "remaining": remaining, "status": status, "overdue": status == "overdue", "payment_url": payment_url, "fee": fee}


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
            "country_profile": "AT", "country_profile_complete": True, "name": "Testverein Löwen", "register": {"kind": "ZVR", "number": "123456789", "court": ""},
            "authority": "Bezirkshauptmannschaft Testbezirk", "address": {"street": "Teststraße 1", "zip": "6410", "town": "Testdorf", "country_code": "AT"},
            "email": "office@runtime-verein.test", "phone": "+43 5262 0", "url": "https://runtime-verein.test", "founded": "2019-03-01",
            "nonprofit": True, "purpose": "Förderung des eSports", "fiscal_year_start_month": 1,
        }
        self.board = [
            {"code": "obmann", "label": "Obmann", "board": True, "represents": True, "auditor": False, "holders": [{"name": "Otto Obmann", "since": "2024-04-01"}]},
            {"code": "kassier", "label": "Kassier:in", "board": True, "represents": False, "auditor": False, "holders": [{"name": None, "since": "2024-04-01"}]},
            {"code": "rechnungspruefung", "label": "Rechnungsprüfer:in", "board": False, "represents": False, "auditor": True, "holders": []},
        ]

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

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _json(self, template: str, payload, status: int = 200) -> httpx.Response:
        if status == 200:
            validate(payload, response_schema(template))
        return httpx.Response(status, json=payload)

    # ------------------------------------------------ Kern-API (Abrechnung)
    def add_thirdparty(self, name: str, email: str = "", **extra) -> dict:
        self.next_id += 1
        row = {"id": self.next_id, "name": name, "email": email, "client": 1, **extra}
        self.thirdparties[row["id"]] = row
        return row

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
        if path == "/vereine/organization":
            # Der Verein fürs Impressum (#326); die Form ist der Vertrag des Moduls.
            return self._json("/vereine/organization", self.organization)
        if path == "/vereine/board":
            return self._json("/vereine/board", self.board)
        if path == "/vereine/status":
            return self._json("/vereine/status", {
                "module_version": self.module_version, "api_version": 1, "country_profile": "AT",
                "country_profile_complete": True, "server_time": self.server_time,
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
            content = self.pdf_bytes(invoice_id)
            return self._json("/vereine/members/{id}/invoices/{invoice}/pdf", {
                "filename": f"FA-{invoice_id}.pdf", "content_type": "application/pdf",
                "filesize": len(content), "content": __import__("base64").b64encode(content).decode(),
            })
        match = re.fullmatch(r"/vereine/members/(\d+)/summary", path)
        if match:
            summary = self.members.get(int(match.group(1)))
            if not summary:
                return httpx.Response(404, json={"error": {"code": 404, "message": "x"}})
            return self._json("/vereine/members/{id}/summary", summary)
        raise AssertionError(f"Die Website ruft einen Weg auf, den es im Vertrag nicht gibt: {path}")
