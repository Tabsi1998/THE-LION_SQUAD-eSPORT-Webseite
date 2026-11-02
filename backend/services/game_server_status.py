"""Live status probes for community game servers.

The service uses public game-server communication only: Minecraft status ping,
Steam/A2S and a generic TCP reachability check for ports that do not expose a
stable public query protocol.
"""
import asyncio
import ipaddress
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


# Bei den meisten Spielen antwortet die Statusabfrage auf einem anderen Port als
# das Spiel selbst. Wer nur die Spieleradresse eintraegt, fragt deshalb ins Leere
# - genau der Grund, warum ARK, Rust und Palworld bisher nichts anzeigten. Diese
# Vorgaben greifen nur, wenn kein Query-Port gepflegt ist.
QUERY_PORT_HINTS: dict[str, int] = {
    "ark": 27015,
    "ark survival ascended": 27015,
    "ark survival evolved": 27015,
    "rust": 28016,
    "valheim": 2457,
    "conan exiles": 27015,
    "dayz": 27016,
    "squad": 27165,
    "arma 3": 2303,
    "project zomboid": 16261,
    "7 days to die": 26900,
    "unturned": 27016,
}

# Spielport -> ueblicher Query-Port, wenn der Spielname nichts hergibt.
QUERY_PORT_BY_GAME_PORT: dict[int, int] = {
    7777: 27015,   # ARK und andere Unreal-Titel
    28015: 28016,  # Rust
    2456: 2457,    # Valheim
}


def suggested_query_port(server: dict) -> int | None:
    """Best guess for the status port when the operator only entered the game address.

    Deliberately only a fallback: an explicitly maintained query port always
    wins, because the operator knows their setup better than a table does.
    """
    explicit = server.get("query_port")
    if explicit:
        return int(explicit)

    haystack = " ".join(str(server.get(field) or "") for field in ("game_name", "name", "game_id")).lower()
    for needle, port in QUERY_PORT_HINTS.items():
        if needle in haystack:
            return port

    _host, address_port = parse_host_port(server.get("address"))
    if address_port and address_port in QUERY_PORT_BY_GAME_PORT:
        return QUERY_PORT_BY_GAME_PORT[address_port]
    return None


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


def probe_target_block_reason(host: str) -> str | None:
    """Name the reason a probe target must not be contacted, or None if it may be.

    Private LAN ranges stay allowed on purpose: an internal sync address such as
    ``host.docker.internal`` or ``192.168.x.x`` is a documented setup for servers
    that run next to the backend. Rejected are only the addresses that can never
    be a community game server - the platform's own loopback services and
    link-local space, which is where cloud metadata endpoints live.

    A hostname is resolved once for this check and again by the connect call, so
    this is defense in depth against misconfigured or malicious server entries,
    not a guarantee against a DNS rebinding attack.
    """
    raw = (host or "").strip().strip("[]")
    if not raw:
        return "Kein Host angegeben."
    try:
        addresses = [ipaddress.ip_address(raw)]
    except ValueError:
        try:
            addresses = [ipaddress.ip_address(item) for item in _resolve_host_sync(raw)]
        except (OSError, ValueError):
            return None
    for address in addresses:
        checked = getattr(address, "ipv4_mapped", None) or address
        if checked.is_loopback:
            return "Loopback-Adressen zeigen auf die Plattform selbst und werden nicht abgefragt."
        if checked.is_link_local:
            return "Link-local- und Metadatenadressen werden nicht abgefragt."
        if checked.is_unspecified or checked.is_multicast or checked.is_reserved:
            return "Diese Zieladresse ist keine gueltige Serveradresse."
    return None


def ensure_probe_target_allowed(host: str) -> None:
    reason = probe_target_block_reason(host)
    if reason:
        raise GameServerProbeError(reason)


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
    ensure_probe_target_allowed(host)
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


def parse_a2s_info(data: bytes) -> dict:
    """Read a full A2S_INFO answer.

    The previous version stopped after the player counts and threw the rest
    away - including the version string and the keyword field, which is exactly
    where ARK, Rust and 7 Days To Die put their mod list, build number and PvP
    setting. Everything after the counts is optional in practice, so each step
    is guarded: a short or odd answer yields fewer fields instead of an error.
    """
    if len(data) < 7 or data[:4] != b"\xff\xff\xff\xff" or data[4] != 0x49:
        raise GameServerProbeError("A2S_INFO hat keine gültige Antwort geliefert.")

    offset = 6
    name, offset = _read_c_string(data, offset)
    map_name, offset = _read_c_string(data, offset)
    _folder, offset = _read_c_string(data, offset)
    game_name, offset = _read_c_string(data, offset)
    if len(data) < offset + 5:
        raise GameServerProbeError("A2S_INFO-Antwort ist unvollständig.")

    offset += 2  # App-ID
    info = {
        "status": "online",
        "name": name,
        "game_name": game_name,
        "map_name": map_name,
        "player_count": int(data[offset]),
        "max_players": int(data[offset + 1]),
    }
    offset += 2

    if len(data) > offset:
        info["bot_count"] = int(data[offset])
        offset += 1
    offset += 1  # Servertyp
    offset += 1  # Betriebssystem
    if len(data) > offset:
        info["password_protected"] = data[offset] == 1
        offset += 1
    if len(data) > offset:
        info["vac_enabled"] = data[offset] == 1
        offset += 1

    try:
        version, offset = _read_c_string(data, offset)
        if version:
            info["version"] = version
    except GameServerProbeError:
        return info

    if len(data) <= offset:
        return info
    extra_flags = data[offset]
    offset += 1
    if extra_flags & 0x80:
        offset += 2  # Spielport
    if extra_flags & 0x10:
        offset += 8  # SteamID
    if extra_flags & 0x40:
        offset += 2
        try:
            _spectator_name, offset = _read_c_string(data, offset)
        except GameServerProbeError:
            return info
    if extra_flags & 0x20:
        try:
            keywords, offset = _read_c_string(data, offset)
        except GameServerProbeError:
            return info
        tags = [tag.strip() for tag in keywords.split(",") if tag.strip()]
        if tags:
            info["server_tags"] = tags
    return info


def parse_a2s_rules(data: bytes) -> dict:
    """Read an A2S_RULES answer into plain key/value pairs.

    This is where the genuinely game-specific values live: world day and
    difficulty for 7 Days To Die, map size and seed for Rust.
    """
    if len(data) < 7 or data[:4] != b"\xff\xff\xff\xff" or data[4] != 0x45:
        raise GameServerProbeError("A2S_RULES hat keine gültige Antwort geliefert.")
    count = int.from_bytes(data[5:7], "little")
    offset = 7
    rules: dict[str, str] = {}
    for _ in range(count):
        try:
            key, offset = _read_c_string(data, offset)
            value, offset = _read_c_string(data, offset)
        except GameServerProbeError:
            break
        if key:
            rules[key] = value
    return rules


def parse_a2s_players(data: bytes) -> list[str]:
    """Read the player names from an A2S_PLAYER answer.

    Only the names are kept. Scores and play time would be personal data of
    guests on a club server without any display purpose here.
    """
    if len(data) < 6 or data[:4] != b"\xff\xff\xff\xff" or data[4] != 0x44:
        raise GameServerProbeError("A2S_PLAYER hat keine gültige Antwort geliefert.")
    count = int(data[5])
    offset = 6
    names: list[str] = []
    for _ in range(count):
        if len(data) <= offset:
            break
        offset += 1  # Index
        try:
            name, offset = _read_c_string(data, offset)
        except GameServerProbeError:
            break
        offset += 8  # Punkte und Spielzeit
        if name:
            names.append(name)
    return names


def _a2s_exchange(sock, host: str, port: int, header: bytes, payload: bytes = b"\xff\xff\xff\xff") -> bytes:
    """Send one A2S request and answer the challenge if the server asks for one."""
    sock.sendto(header + payload, (host, port))
    data, _ = sock.recvfrom(4096)
    if len(data) >= 9 and data[4] == 0x41:
        challenge = data[5:9]
        sock.sendto(header + challenge, (host, port))
        data, _ = sock.recvfrom(4096)
    return data


def _a2s_query_sync(host: str, port: int, timeout: float) -> dict:
    ensure_probe_target_allowed(host)
    info_header = b"\xff\xff\xff\xffTSource Engine Query\x00"
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(timeout)
        data = _a2s_exchange(sock, host, port, info_header, b"")
        info = parse_a2s_info(data)

        # Regeln und Spielerliste sind Zusatznutzen: antwortet ein Server darauf
        # nicht, bleibt die Grundabfrage trotzdem gültig.
        for header, parser, key in (
            (b"\xff\xff\xff\xff\x56", parse_a2s_rules, "rules"),
            (b"\xff\xff\xff\xff\x55", parse_a2s_players, "player_names"),
        ):
            try:
                extra = parser(_a2s_exchange(sock, host, port, header))
            except (GameServerProbeError, OSError, IndexError):
                continue
            if extra:
                info[key] = extra
    return info


def _tcp_reachable_sync(host: str, port: int, timeout: float) -> dict:
    ensure_probe_target_allowed(host)
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
    # Ohne gepflegten Query-Port wird der uebliche Port des Spiels ergaenzt,
    # sonst landet die Abfrage auf dem Spielport und bleibt ohne Antwort.
    fallback_port = suggested_query_port(server)
    candidates = _host_port_candidates(server, server.get("query_port") or fallback_port)
    if fallback_port:
        for host, _port in list(candidates):
            if (host, fallback_port) not in candidates:
                candidates.append((host, fallback_port))
    if not candidates:
        raise GameServerProbeError("Steam/A2S braucht Host und Query-Port.")
    errors = []
    for host, port in candidates:
        try:
            result = await asyncio.to_thread(_a2s_query_sync, host, port, timeout)
            if port != server.get("query_port"):
                result.setdefault("sync_note", f"Statusabfrage beantwortet auf Port {port}.")
            return result
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


async def probe_amp(server: dict) -> dict:
    """Ask the AMP panel about this server's instance.

    AMP is the better source wherever a game has no usable public query - it
    knows every instance because it runs them. If the panel is unreachable or
    the instance is not found, the public query still has its turn: a panel
    outage must not blank out a server that answers on its own.
    """
    from services.amp_client import AmpClient, AmpError, instance_matches, status_from_amp
    from services.amp_settings import load_amp_settings

    wanted = str(server.get("amp_instance") or "").strip()
    if not wanted:
        raise GameServerProbeError("Für diesen Server ist keine AMP-Instanz hinterlegt.")
    settings = await load_amp_settings()
    if not settings:
        raise GameServerProbeError("AMP ist nicht konfiguriert.")

    try:
        async with AmpClient(settings["base_url"], settings["username"], settings["password"]) as client:
            instances = await client.instances()
            match = next((item for item in instances if instance_matches(item, wanted)), None)
            if not match:
                raise GameServerProbeError(f"AMP kennt keine Instanz '{wanted}'.")
            status = await client.instance_status(match.get("InstanceID") or wanted)
    except AmpError as exc:
        raise GameServerProbeError(str(exc)) from exc
    return status_from_amp(match, status)


async def probe_game_server(server: dict) -> dict:
    provider = server.get("sync_provider") or "manual"
    if provider == "manual":
        raise GameServerProbeError("Dieser Server steht auf manueller Pflege.")
    if provider == "amp":
        return await probe_amp(server)
    if provider == "auto_public":
        return await probe_auto_public(server)
    if provider == "minecraft":
        return await probe_minecraft(server)
    if provider == "steam_a2s":
        return await probe_steam_a2s(server)
    if provider == "rcon":
        return await probe_rcon_reachable(server)
    # Eine unbekannte Quelle stammt aus einem älteren oder von Hand gesetzten
    # Eintrag. Der Server soll deswegen nicht dauerhaft ohne Status dastehen,
    # also wird öffentlich abgefragt statt abgebrochen. Bis Block 2 gilt das
    # ausdrücklich auch für "amp": echte AMP-Anbindung gibt es noch nicht.
    return await probe_auto_public(server)


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
