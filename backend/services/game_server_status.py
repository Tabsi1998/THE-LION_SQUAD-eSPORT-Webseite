"""Live status probes for community game servers.

The service uses public game-server communication only: Minecraft status ping,
Steam/A2S and a generic TCP reachability check for ports that do not expose a
stable public query protocol.
"""
import asyncio
import json
import socket
import struct
from urllib.parse import urlparse


class GameServerProbeError(RuntimeError):
    pass


def parse_host_port(address: str | None, default_port: int | None = None) -> tuple[str, int | None]:
    raw = (address or "").strip()
    if not raw:
        return "", default_port
    if "://" in raw:
        parsed = urlparse(raw)
        return parsed.hostname or "", parsed.port or default_port
    if raw.count(":") == 1:
        host, port = raw.rsplit(":", 1)
        try:
            return host.strip(), int(port)
        except ValueError:
            return raw, default_port
    return raw, default_port


def _host_port_candidate_details(server: dict, default_port: int | None = None) -> list[dict]:
    query_default = server.get("query_port") or default_port
    candidates: list[dict] = []
    for source, raw, port_default in (
        ("interne Sync-Adresse", server.get("query_host"), query_default),
        ("öffentliche Adresse", server.get("address"), default_port or server.get("query_port")),
    ):
        host, port = parse_host_port(raw, port_default)
        if host and port:
            key = (host, int(port))
            if not any((item["host"], item["port"]) == key for item in candidates):
                candidates.append({"source": source, "host": host, "port": int(port)})
    return candidates


def _host_port_candidates(server: dict, default_port: int | None = None) -> list[tuple[str, int]]:
    return [(item["host"], item["port"]) for item in _host_port_candidate_details(server, default_port)]


def _resolve_host_sync(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    addresses = []
    for info in infos:
        address = info[4][0]
        if address not in addresses:
            addresses.append(address)
    return addresses


def explain_connection_error(error: str | None) -> str | None:
    text = str(error or "").lower()
    if not text:
        return None
    if "connection refused" in text or "errno 111" in text or "winerror 10061" in text:
        return "Host erreichbar, aber Port geschlossen: falscher Port, Dienst lauscht nicht auf dieser IP oder Firewall lehnt aktiv ab."
    if "timed out" in text or "timeout" in text:
        return "Keine Antwort: Routing, Firewall, Hairpin-NAT oder UDP/TCP-Portweiterleitung prüfen."
    if "name or service not known" in text or "nodename nor servname" in text or "getaddrinfo" in text:
        return "DNS-Name kann vom Backend aus nicht aufgeloest werden."
    if "network is unreachable" in text or "no route to host" in text:
        return "Keine Route vom Backend-Netz zur Zieladresse."
    return None


def summarize_probe_failure(error: str) -> str:
    explanation = explain_connection_error(error)
    if not explanation:
        return error
    return f"{explanation} Details: {error}"


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            break
    return bytes(out)


def _read_varint(sock: socket.socket) -> int:
    value = 0
    shift = 0
    while True:
        data = sock.recv(1)
        if not data:
            raise GameServerProbeError("Minecraft hat keine Statusdaten gesendet.")
        byte = data[0]
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value
        shift += 7
        if shift > 35:
            raise GameServerProbeError("Minecraft-Statusantwort ist ungültig.")


def _read_exact(sock: socket.socket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        data = sock.recv(size - len(chunks))
        if not data:
            raise GameServerProbeError("Serververbindung wurde geschlossen.")
        chunks.extend(data)
    return bytes(chunks)


def _minecraft_status_sync(host: str, port: int, timeout: float) -> dict:
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        host_bytes = host.encode("utf-8")
        handshake = (
            _varint(0)
            + _varint(765)
            + _varint(len(host_bytes))
            + host_bytes
            + struct.pack(">H", port)
            + _varint(1)
        )
        sock.sendall(_varint(len(handshake)) + handshake)
        sock.sendall(b"\x01\x00")

        _read_varint(sock)
        packet_id = _read_varint(sock)
        if packet_id != 0:
            raise GameServerProbeError("Minecraft-Statusantwort hat einen unerwarteten Pakettyp.")
        payload_length = _read_varint(sock)
        payload = _read_exact(sock, payload_length)
        body = json.loads(payload.decode("utf-8"))
        players = body.get("players") or {}
        version = body.get("version") or {}
        description = body.get("description")
        if isinstance(description, dict):
            description = description.get("text") or ""
        elif description is not None:
            description = str(description)
        return {
            "status": "online",
            "player_count": int(players.get("online") or 0),
            "max_players": int(players.get("max") or 0),
            "player_names": [p.get("name") for p in players.get("sample") or [] if p.get("name")],
            "version": version.get("name") or "",
            "description": description or None,
        }


def _read_c_string(data: bytes, offset: int) -> tuple[str, int]:
    end = data.find(b"\x00", offset)
    if end < 0:
        raise GameServerProbeError("A2S-Antwort ist unvollständig.")
    return data[offset:end].decode("utf-8", errors="replace"), end + 1


def _a2s_query_sync(host: str, port: int, timeout: float) -> dict:
    request = b"\xff\xff\xff\xffTSource Engine Query\x00"
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(timeout)
        sock.sendto(request, (host, port))
        data, _ = sock.recvfrom(4096)
        if len(data) >= 9 and data[4] == 0x41:
            challenge = data[5:9]
            sock.sendto(request + challenge, (host, port))
            data, _ = sock.recvfrom(4096)
    if len(data) < 7 or data[:4] != b"\xff\xff\xff\xff" or data[4] != 0x49:
        raise GameServerProbeError("A2S_INFO hat keine gültige Antwort geliefert.")
    offset = 6
    name, offset = _read_c_string(data, offset)
    map_name, offset = _read_c_string(data, offset)
    _folder, offset = _read_c_string(data, offset)
    game_name, offset = _read_c_string(data, offset)
    if len(data) < offset + 5:
        raise GameServerProbeError("A2S_INFO-Antwort ist unvollständig.")
    offset += 2
    players = data[offset]
    max_players = data[offset + 1]
    return {
        "status": "online",
        "name": name,
        "game_name": game_name,
        "map_name": map_name,
        "player_count": int(players),
        "max_players": int(max_players),
    }


def _tcp_reachable_sync(host: str, port: int, timeout: float) -> dict:
    with socket.create_connection((host, port), timeout=timeout):
        return {"status": "online"}


async def probe_minecraft(server: dict, timeout: float = 5.0) -> dict:
    candidates = _host_port_candidates(server, 25565)
    if not candidates:
        raise GameServerProbeError("Minecraft-Query braucht Host und Port.")
    errors = []
    for host, port in candidates:
        try:
            return await asyncio.to_thread(_minecraft_status_sync, host, port, timeout)
        except (TimeoutError, socket.timeout):
            try:
                await asyncio.to_thread(_tcp_reachable_sync, host, port, min(timeout, 3.0))
                return {
                    "status": "online",
                    "sync_note": "Minecraft-Statusping hat nicht geantwortet, der Server-Port ist aber erreichbar.",
                }
            except Exception as exc:
                errors.append(f"{host}:{port}: {exc}")
        except Exception as exc:
            errors.append(f"{host}:{port}: {exc}")
    raise GameServerProbeError("Minecraft-Query fehlgeschlagen. " + " | ".join(errors))


async def probe_steam_a2s(server: dict, timeout: float = 3.0) -> dict:
    candidates = _host_port_candidates(server, server.get("query_port"))
    if not candidates:
        raise GameServerProbeError("Steam/A2S braucht Host und Query-Port.")
    errors = []
    for host, port in candidates:
        try:
            return await asyncio.to_thread(_a2s_query_sync, host, port, timeout)
        except Exception as exc:
            errors.append(f"{host}:{port}: {exc}")
    raise GameServerProbeError("Steam/A2S fehlgeschlagen. " + " | ".join(errors))


async def probe_rcon_reachable(server: dict, timeout: float = 3.0) -> dict:
    candidates = _host_port_candidates(server, server.get("rcon_port") or server.get("query_port"))
    if not candidates:
        raise GameServerProbeError("RCON-Erreichbarkeit braucht Host und Port.")
    errors = []
    for host, port in candidates:
        try:
            return await asyncio.to_thread(_tcp_reachable_sync, host, port, timeout)
        except Exception as exc:
            errors.append(f"{host}:{port}: {exc}")
    raise GameServerProbeError("TCP/RCON-Erreichbarkeit fehlgeschlagen. " + " | ".join(errors))


async def probe_auto_public(server: dict) -> dict:
    attempts = []
    _, detected_port = parse_host_port(server.get("query_host") or server.get("address"), server.get("query_port"))
    game_name = f"{server.get('game_name') or ''} {server.get('name') or ''}".lower()
    if detected_port == 25565 or "minecraft" in game_name:
        attempts.append(("Minecraft Query", probe_minecraft))
    attempts.append(("Steam/A2S Query", probe_steam_a2s))
    attempts.append(("TCP erreichbar", probe_rcon_reachable))

    errors = []
    for label, probe in attempts:
        try:
            result = await probe(server)
            result["detected_sync_provider"] = label
            return result
        except Exception as exc:
            errors.append(f"{label}: {exc}")
    raise GameServerProbeError("Keine öffentliche Abfrage erfolgreich. " + " | ".join(errors))


async def probe_game_server(server: dict) -> dict:
    provider = server.get("sync_provider") or "manual"
    if provider == "manual":
        raise GameServerProbeError("Dieser Server steht auf manueller Pflege.")
    if provider in {"auto_public", "amp"}:
        return await probe_auto_public(server)
    if provider == "minecraft":
        return await probe_minecraft(server)
    if provider == "steam_a2s":
        return await probe_steam_a2s(server)
    if provider == "rcon":
        return await probe_rcon_reachable(server)
    raise GameServerProbeError(f"Unbekannte Sync-Quelle: {provider}")


async def diagnose_game_server(server: dict) -> dict:
    game_name = f"{server.get('game_name') or ''} {server.get('name') or ''}".lower()
    default_port = server.get("query_port") or server.get("rcon_port") or (25565 if "minecraft" in game_name else None)
    candidates = _host_port_candidate_details(server, default_port)
    checks = []
    for candidate in candidates:
        host = candidate["host"]
        port = candidate["port"]
        item = {**candidate, "resolved_ips": [], "tcp_ok": False, "error": None}
        try:
            item["resolved_ips"] = await asyncio.to_thread(_resolve_host_sync, host)
            await asyncio.to_thread(_tcp_reachable_sync, host, port, 3.0)
            item["tcp_ok"] = True
        except Exception as exc:
            item["error"] = str(exc)
            item["hint"] = explain_connection_error(item["error"])
        checks.append(item)

    if any(item["tcp_ok"] for item in checks):
        recommendation = "Mindestens eine Adresse ist vom Backend aus erreichbar. Diese Adresse sollte für den Sync verwendet werden."
    elif any("Port geschlossen" in str(item.get("hint") or "") for item in checks):
        recommendation = "Mindestens ein Host antwortet, aber der Game-Port ist geschlossen. Prüfe in AMP/Minecraft den tatsächlichen Port, die Bind-Adresse und Firewall-Regeln."
    elif server.get("query_host"):
        recommendation = "Keine Sync-Adresse ist erreichbar. Prüfe internen DNS, LAN-IP, Firewall und ob der Spielserver auf diesem Port wirklich lauscht."
    else:
        recommendation = "Die öffentliche Adresse ist vom Backend aus nicht erreichbar. Hinter NAT/Reverse Proxy ist meist eine interne Sync-Adresse nötig, z.B. host.docker.internal oder die LAN-IP."

    return {
        "address": server.get("address"),
        "query_host": server.get("query_host"),
        "query_port": server.get("query_port"),
        "sync_provider": server.get("sync_provider") or "auto_public",
        "candidates": checks,
        "recommendation": recommendation,
    }
