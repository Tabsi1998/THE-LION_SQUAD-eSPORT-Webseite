def sponsor_public_key(sponsor: dict) -> str:
    logo = str(sponsor.get("logo_url") or "").strip().lower()
    if logo:
        return f"logo:{logo}"
    sid = str(sponsor.get("id") or "").strip().lower()
    if sid:
        return f"id:{sid}"
    return f"name:{str(sponsor.get('name') or '').strip().lower()}|link:{str(sponsor.get('link') or '').strip().lower()}"


def dedupe_public_sponsors(sponsors: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for sponsor in sponsors:
        key = sponsor_public_key(sponsor)
        if key in seen:
            continue
        seen.add(key)
        out.append(sponsor)
    return out
