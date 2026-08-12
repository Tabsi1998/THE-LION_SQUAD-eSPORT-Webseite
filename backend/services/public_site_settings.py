"""Canonical public contact and legal settings derived from the branding document."""

from __future__ import annotations

import re
from typing import Any


PUBLIC_LEGAL_SOURCE_FIELDS = frozenset({
    "club_name",
    "domain",
    "contact_email",
    "imprint",
    "privacy_policy",
    "legal_name",
    "legal_form",
    "zvr_number",
    "street_address",
    "address_extra",
    "postal_code",
    "city",
    "state",
    "country",
    "registered_seat",
    "register_authority",
    "representative_name",
    "representative_role",
    "content_responsible",
    "phone",
    "privacy_contact_email",
    "hosting_provider",
    "hosting_country",
    "vat_number",
    "tournament_terms_url",
    "paid_tournaments_enabled",
    "legal_extra",
    "privacy_extra",
})

PUBLIC_LEGAL_REQUIRED_FIELDS = (
    "legal_name",
    "legal_form",
    "zvr_number",
    "street_address",
    "postal_code",
    "city",
    "country",
    "registered_seat",
    "register_authority",
    "representative_name",
    "representative_role",
    "content_responsible",
    "contact_email",
    "privacy_contact_email",
)

_PLACEHOLDER_VALUES = {
    "-",
    "demo",
    "example",
    "image: null",
    "lorem ipsum",
    "n/a",
    "na",
    "none",
    "noch im adminbereich zu hinterlegen",
    "not set",
    "null",
    "test",
    "todo",
    "tbd",
    "undefined",
}
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_RESERVED_EMAIL_DOMAINS = ("example.com", "example.org", "example.net", "example.test", "test", "invalid", "localhost")


def public_text(value: Any) -> str:
    """Return configured public text while suppressing common seed placeholders."""
    text = str(value or "").strip()
    if not text or text.casefold() in _PLACEHOLDER_VALUES:
        return ""
    return text


def public_email(value: Any) -> str:
    """Return only a plausible configured public email address."""
    email = public_text(value)
    if not _EMAIL_RE.fullmatch(email):
        return ""
    domain = email.rsplit("@", 1)[1].casefold().rstrip(".")
    if domain in _RESERVED_EMAIL_DOMAINS or any(domain.endswith(f".{item}") for item in _RESERVED_EMAIL_DOMAINS):
        return ""
    return email


def _merge_unique_text(*values: Any) -> str:
    blocks: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = public_text(value)
        key = " ".join(text.split()).casefold()
        if text and key not in seen:
            seen.add(key)
            blocks.append(text)
    return "\n\n".join(blocks)


def build_public_legal_settings(branding: dict[str, Any] | None) -> dict[str, Any]:
    """Build the sole public contact/legal contract from the branding document.

    Old imprint/privacy free-text fields are retained as additional content, but
    folded into one output field each so they can never be rendered twice.
    """
    source = branding or {}
    contact_email = public_email(source.get("contact_email"))
    privacy_contact_email = public_email(source.get("privacy_contact_email")) or contact_email
    representative_name = public_text(source.get("representative_name"))
    city = public_text(source.get("city"))

    result: dict[str, Any] = {
        "contact_email": contact_email,
        "legal_name": public_text(source.get("legal_name")) or public_text(source.get("club_name")),
        "legal_form": public_text(source.get("legal_form")),
        "zvr_number": public_text(source.get("zvr_number")),
        "street_address": public_text(source.get("street_address")),
        "address_extra": public_text(source.get("address_extra")),
        "postal_code": public_text(source.get("postal_code")),
        "city": city,
        "state": public_text(source.get("state")),
        "country": public_text(source.get("country")),
        "registered_seat": public_text(source.get("registered_seat")) or city,
        "register_authority": public_text(source.get("register_authority")),
        "representative_name": representative_name,
        "representative_role": public_text(source.get("representative_role")),
        "content_responsible": public_text(source.get("content_responsible")) or representative_name,
        "phone": public_text(source.get("phone")),
        "privacy_contact_email": privacy_contact_email,
        "hosting_provider": public_text(source.get("hosting_provider")),
        "hosting_country": public_text(source.get("hosting_country")),
        "vat_number": public_text(source.get("vat_number")),
        "tournament_terms_url": public_text(source.get("tournament_terms_url")),
        "paid_tournaments_enabled": bool(source.get("paid_tournaments_enabled", False)),
        "legal_extra": _merge_unique_text(source.get("legal_extra"), source.get("imprint")),
        "privacy_extra": _merge_unique_text(source.get("privacy_extra"), source.get("privacy_policy")),
        "legal_updated_at": public_text(source.get("legal_updated_at")),
    }
    missing = [field for field in PUBLIC_LEGAL_REQUIRED_FIELDS if not result.get(field)]
    result["contact_ready"] = bool(contact_email)
    result["legal_ready"] = not missing
    result["missing_legal_fields"] = missing
    return result


def missing_public_legal_fields(branding: dict[str, Any] | None) -> list[str]:
    return list(build_public_legal_settings(branding)["missing_legal_fields"])
