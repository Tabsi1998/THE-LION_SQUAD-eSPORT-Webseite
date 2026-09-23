def sponsor_public_key(sponsor: dict) -> str:
    logo = str(sponsor.get("logo_url") or "").strip().lower()
    if logo:
        return f"logo:{logo}"
    sid = str(sponsor.get("id") or "").strip().lower()
    if sid:
        return f"id:{sid}"
    return f"name:{str(sponsor.get('name') or '').strip().lower()}|link:{str(sponsor.get('link') or '').strip().lower()}"


# Was nie öffentlich wird (#405): Ansprechpartner, Kontaktdaten, Notizen, Dolibarr-Verweise, Laufzeit im
# Detail - öffentlich ist nur, seit wann (und bis wann) eine Firma dabei ist.
PRIVATE_SPONSOR_FIELDS = frozenset({
    "contact_name", "contact_email", "contact_phone", "internal_notes", "dolibarr_id", "dolibarr_seen_at",
    "dolibarr_gone_at", "contract_start", "contract_end", "contract_status", "created_at", "updated_at",
})


def public_sponsor_view(sponsor: dict) -> dict:
    view = {key: value for key, value in sponsor.items() if key not in PRIVATE_SPONSOR_FIELDS}
    start = str(sponsor.get("contract_start") or "")[:4]
    end = str(sponsor.get("contract_end") or "")[:4]
    view["since_year"] = int(start) if start.isdigit() else None
    view["until_year"] = int(end) if end.isdigit() else None
    return view


def dedupe_public_sponsors(sponsors: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for sponsor in sponsors:
        key = sponsor_public_key(sponsor)
        if key in seen:
            continue
        seen.add(key)
        out.append(public_sponsor_view(sponsor))
    return out
