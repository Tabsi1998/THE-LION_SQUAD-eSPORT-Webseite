"""Helpers for attaching station display data to match payloads."""
import re

# Die Geräte einer Station im Klartext (#1220) - dieselben Namen wie in der Verwaltung (AdminStationsPage.jsx) und in
# frontend/src/lib/tournamentLabels.js. Ein Kürzel wie „switch2“ erscheint so nie auf einer Seite.
DEVICE_TYPE_LABELS = {
    "switch": "Switch",
    "switch2": "Switch 2",
    "pc": "PC",
    "racing_rig": "Renn-Setup",
    "beamer": "Beamer",
    "stream_setup": "Übertragungsplatz",
    "admin_desk": "Orga-Tisch",
}
_STATION_WORD = re.compile(r"\bstation\b", re.IGNORECASE)


def device_label(device_type) -> str:
    """Das Gerät als Name aus der Liste - ein unbekanntes Kürzel lesbar gemacht („vr_set“ wird „Vr Set“)."""
    key = str(device_type or "").strip()
    if not key:
        return ""
    known = DEVICE_TYPE_LABELS.get(key.lower())
    if known:
        return known
    return " ".join(part[:1].upper() + part[1:] for part in key.replace("_", " ").split())


def station_text(name, device_type=None) -> str:
    """Der fertige Text für Website und App (#1220): „Station A · Switch 2“.

    „Station“ steht genau einmal: ein kurzer Name wie „A“ oder „3“ bekommt es vorne dazu, ein Name, der „Station“
    schon enthält, nicht noch einmal. Das Gerät kommt als Name aus der Liste und fehlt, wenn der Name es schon nennt
    („Switch 2 Station 1“). Ohne Namen und Gerät bleibt der Text leer - eine interne Kennung zeigt er nie.
    """
    clean = " ".join(str(name or "").split())
    device = device_label(device_type)
    if clean and len(clean) <= 3 and not _STATION_WORD.search(clean):
        clean = f"Station {clean}"
    if device and clean and device.casefold() in clean.casefold():
        device = ""
    return " · ".join(part for part in (clean, device) if part)


async def attach_station_info(db, matches: list[dict]) -> list[dict]:
    station_ids = sorted({
        match.get("station_id")
        for match in matches
        if match.get("station_id")
    })
    if not station_ids:
        return matches

    stations = await db.stations.find(
        {"id": {"$in": station_ids}},
        {"_id": 0, "id": 1, "name": 1, "label": 1, "device_type": 1, "status": 1, "notes": 1},
    ).to_list(len(station_ids))
    by_id = {station["id"]: station for station in stations if station.get("id")}

    for match in matches:
        station_id = match.get("station_id")
        if not station_id:
            continue
        station = by_id.get(station_id)
        if not station:
            match["station_name"] = station_id
            match["station_label"] = station_id
            match["station_text"] = ""
            continue
        name = station.get("name") or station.get("label") or station_id
        device = station.get("device_type")
        label = f"{name} - {device}" if device else name
        match["station"] = station
        match["station_name"] = name
        match["station_label"] = label
        match["station_text"] = station_text(station.get("name") or station.get("label"), device)
    return matches
