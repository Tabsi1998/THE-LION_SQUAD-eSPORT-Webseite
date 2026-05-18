"""Helpers for attaching station display data to match payloads."""


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
            continue
        name = station.get("name") or station.get("label") or station_id
        device = station.get("device_type")
        label = f"{name} - {device}" if device else name
        match["station"] = station
        match["station_name"] = name
        match["station_label"] = label
    return matches
