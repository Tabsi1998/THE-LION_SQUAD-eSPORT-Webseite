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

    def _handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.scheme == "https", "die Website darf Dolibarr nur über https ansprechen"
        path = request.url.path.removeprefix("/api/index.php")
        params = dict(request.url.params)
        self.calls.append((path, params))
        if request.headers.get("DOLAPIKEY") != API_KEY:
            return httpx.Response(401, json={"error": {"code": 401, "message": "Unauthorized"}})
        assert API_KEY not in str(request.url), "der Schlüssel gehört nur in den Header"
        if self.fail_with and (not self.fail_paths or path in self.fail_paths):
            return httpx.Response(self.fail_with, json={"error": {"code": self.fail_with, "message": "x"}})
        if path == "/status":
            # Dolibarrs eigener Weg (Kern). Der Website-Benutzer hat dafür keine Rechte.
            return httpx.Response(self.core_status, json={"error": {"code": self.core_status, "message": "x"}})
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
