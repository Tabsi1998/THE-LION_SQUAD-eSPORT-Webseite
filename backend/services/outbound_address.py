"""Zieladressen für Anbindungen, die mit gespeicherten Zugangsdaten anfragen (AMP-Panel, Dolibarr, #2112).

Abgelehnt werden Adressen, die nie ein solcher Dienst sein können: Loopback (die Plattform selbst), Link-local (dort
liegen Metadaten-Dienste von Cloud-Anbietern), unbestimmte, Multicast- und reservierte Adressen - als IP-Literal und,
soweit sich der Name auflösen lässt, auch nach der Auflösung. Private Adressen (Heimnetz) sind als IP-Literal
abgelehnt; ein **Name**, der ins Heimnetz zeigt, bleibt erlaubt - so ist der dokumentierte Weg für ein Dolibarr im
selben Heimnetz (Host-Eintrag in ``docker-compose.override.yml``).

Die Auflösung hier ist eine zusätzliche Hürde beim Speichern, kein Schutz gegen DNS-Rebinding.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

RESOLVE_TIMEOUT_SECONDS = 2.0
LOCAL_NAMES = ("localhost", "localhost.localdomain")


def _resolve(host: str) -> list[str]:
    return sorted({item[4][0] for item in socket.getaddrinfo(host, None)})


def _reason(address, *, allow_local: bool, literal: bool) -> str | None:
    checked = getattr(address, "ipv4_mapped", None) or address
    if checked.is_link_local:
        return "Link-local- und Metadatenadressen sind als Ziel nicht erlaubt."
    if checked.is_unspecified or checked.is_multicast or checked.is_reserved:
        return "Diese Adresse ist kein gültiges Ziel."
    if checked.is_loopback and not allow_local:
        return "Adressen, die auf die Plattform selbst zeigen (localhost, 127.x), sind als Ziel nicht erlaubt."
    if literal and checked.is_private and not allow_local:
        return "Bitte den Namen des Dienstes eintragen, keine Heimnetz-IP."
    return None


async def outbound_block_reason(url: str, *, allow_local: bool = False) -> str | None:
    """Warum diese Adresse kein Ziel sein darf - oder None. ``allow_local`` für Testumgebungen auf dem eigenen Rechner."""
    host = (urlsplit(str(url or "").strip()).hostname or "").strip("[]").lower()
    if not host:
        return None
    try:
        return _reason(ipaddress.ip_address(host), allow_local=allow_local, literal=True)
    except ValueError:
        pass
    if not allow_local and (host in LOCAL_NAMES or host.endswith(".localhost")):
        return "Adressen, die auf die Plattform selbst zeigen (localhost, 127.x), sind als Ziel nicht erlaubt."
    try:
        resolved = await asyncio.wait_for(asyncio.to_thread(_resolve, host), timeout=RESOLVE_TIMEOUT_SECONDS)
    except (OSError, asyncio.TimeoutError, UnicodeError):
        return None  # nicht auflösbar: die Anfrage selbst scheitert dann mit einer eigenen Meldung
    for item in resolved:
        try:
            reason = _reason(ipaddress.ip_address(item.split("%")[0]), allow_local=allow_local, literal=False)
        except ValueError:
            continue
        if reason:
            return reason
    return None
