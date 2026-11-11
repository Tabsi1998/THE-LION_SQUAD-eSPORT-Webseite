"""``to_list(length)`` in den Tests wie bei Motor (#2357).

mongomock_motor gibt bei ``to_list(n)`` alle Treffer zurück und übergeht ``n``. Motor liefert höchstens ``n``. Damit
blieb lokal unsichtbar, wenn eine Begrenzung ohne passende Sortierung oder ohne passenden Filter wichtige Einträge
verdrängt - in Produktion fehlen sie dann (gefunden in #2352).

Diese Hülle gibt den drei Cursorn von mongomock_motor (``find``, ``aggregate``, ``list_indexes``) das Verhalten von
Motor 3.7 (``motor/core.py``, ``AgnosticBaseCursor.to_list`` und ``_to_list``):

* ``None`` (oder ohne Angabe): alle restlichen Treffer.
* ``n``: höchstens ``n`` Treffer; der Cursor bleibt stehen, ein weiterer ``to_list`` liest dort weiter.
* ``0``: eine leere Liste. Motor rechnet ``min(0 - 0, …)`` Einträge und meldet die Länge sofort als erreicht -
  ``0`` heißt bei Motor also nicht „alles“.
* kein ``int``: ``TypeError``; negativ: ``ValueError``.

``conftest.pytest_configure`` setzt die Hülle für jeden Testprozess einmal. Läufe gegen ein echtes MongoDB
(``FLOW_MONGO_URL``) benutzen Motor selbst und sind davon nicht berührt.
"""
from __future__ import annotations

from itertools import islice

_MARKER = "_lsw_motor_like_to_list"


def _sync_cursor(cursor, owner: type):
    """Der mongomock-Cursor hinter der Hülle; mongomock_motor legt ihn als privates ``__cursor`` der Klasse ab."""
    return cursor.__dict__[f"_{owner.__name__}__cursor"]


def _motor_to_list(owner: type):
    async def to_list(self, length=None):
        if length is not None:
            if not isinstance(length, int):
                raise TypeError("length must be an int, not %r" % length)
            if length < 0:
                raise ValueError("length must be non-negative")
        rows = _sync_cursor(self, owner)
        return list(rows) if length is None else list(islice(rows, length))

    setattr(to_list, _MARKER, True)
    return to_list


def _original_class(wrapped: type) -> type:
    """mongomock_motor tarnt jede Klasse als Motor-Klasse (``masquerade_class``); der Name des privaten Felds
    stammt von der Klasse darunter."""
    for klass in wrapped.__mro__:
        if "__init__" in vars(klass):
            return klass
    return wrapped


def install() -> None:
    """Ersetzt ``to_list`` der Cursor von mongomock_motor. Mehrfacher Aufruf ändert nichts mehr."""
    try:
        import mongomock_motor
    except ImportError:  # Live-Tests gegen einen laufenden Server brauchen mongomock nicht
        return
    for wrapped in (mongomock_motor.AsyncCursor, mongomock_motor.AsyncCommandCursor,
                    mongomock_motor.AsyncLatentCommandCursor):
        if getattr(wrapped.to_list, _MARKER, False):
            continue
        wrapped.to_list = _motor_to_list(_original_class(wrapped))


def installed() -> bool:
    import mongomock_motor

    return all(getattr(cursor.to_list, _MARKER, False) for cursor in (
        mongomock_motor.AsyncCursor, mongomock_motor.AsyncCommandCursor, mongomock_motor.AsyncLatentCommandCursor))
