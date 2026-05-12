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


def _host_port_candidates(server: dict, default_port: int | None = None) -> list[tuple[str, int]]:
    query_default = server.get("query_port") or default_port
    candidates: list[tuple[str, int]] = []
    for raw, port_default in (
        (server.get("query_host"), query_default),
        (server.get("address"), default_port or server.get("query_port")),
    ):
        host, port = parse_host_port(raw, port_default)
        if host and port:
            candidate = (host, int(port))
            if candidate not in candidates:
                candidates.append(candidate)
    return candidates


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
