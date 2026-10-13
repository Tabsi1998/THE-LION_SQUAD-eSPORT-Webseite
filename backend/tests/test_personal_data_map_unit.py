"""Wächter für Kontolöschung und Auskunft (#1029, #1030): jede Sammlung, die der Code anfasst, steht in
``services/personal_data.py`` - mit Entscheidung für die Löschung und Platz in der Auskunft, oder als Sammlung ohne
Personenbezug. Eine neue Sammlung, die dort fehlt, lässt diesen Test scheitern, bevor sie bei der Löschung oder in
der Auskunft vergessen wird."""
import pathlib
import re

from services import account_erasure, personal_data

BACKEND = pathlib.Path(__file__).resolve().parents[1]
ATTR = re.compile(r"\bdb(?:\(\))?\.([a-z][a-z0-9_]*)\b")
ITEM = re.compile(r"\bdb(?:\(\))?\[\"([a-z][a-z0-9_]*)\"\]")
GETATTR = re.compile(r"getattr\(db, \"([a-z][a-z0-9_]*)\"")
CONST_USE = re.compile(r"\bdb(?:\(\))?\[([A-Z][A-Z0-9_]*)\]")
CONST_DEF = re.compile(r"^([A-Z][A-Z0-9_]*)\s*=\s*\"([a-z][a-z0-9_]*)\"", re.M)
# Methoden der Datenbank, keine Sammlungen.
NOT_COLLECTIONS = {"command", "list_collection_names", "get_collection", "drop_collection", "client", "name"}
# Felder, über die eine Zeile einer Person gehört - ein Index darauf heißt: hier liegen Daten je Person.
PERSON_FIELDS = ("user_id", "owner_id", "sender_id", "recipient_id", "requester_id", "from_user_id", "target_user_id",
                 "blocker_id", "reporter_id", "author_id", "member_id")


def _sources() -> dict[pathlib.Path, str]:
    return {path: path.read_text(encoding="utf-8") for path in BACKEND.rglob("*.py")
            if not {"tests", "venv", ".venv"} & set(path.relative_to(BACKEND).parts)}


def collections_in_code() -> set[str]:
    """Alle Sammlungen, die der Code anspricht: ``db.name``, ``db["name"]``, ``getattr(db, "name")`` und
    ``db[KONSTANTE]`` mit ``KONSTANTE = "name"`` (im selben Modul oder importiert)."""
    texts = _sources()
    constants: dict[str, set[str]] = {}
    for text in texts.values():
        for key, value in CONST_DEF.findall(text):
            constants.setdefault(key, set()).add(value)
    found: set[str] = set()
    for text in texts.values():
        found |= set(ATTR.findall(text)) | set(ITEM.findall(text)) | set(GETATTR.findall(text))
        local = dict(CONST_DEF.findall(text))
        for constant in CONST_USE.findall(text):
            found |= {local[constant]} if constant in local else constants.get(constant, set())
    return found - NOT_COLLECTIONS


def collections_indexed_by_person() -> set[str]:
    """Sammlungen mit einem Index auf einem Personenfeld (``database.py``)."""
    text = (BACKEND / "database.py").read_text(encoding="utf-8")
    fields = "|".join(PERSON_FIELDS)
    direct = re.findall(rf"db\.([a-z0-9_]+)\.create_index\([^\n]*\"(?:{fields})\"", text)
    listed = re.findall(rf"^\s*\(\"([a-z0-9_]+)\",[^\n]*\"(?:{fields})\"", text, re.M)
    return set(direct) | set(listed)


def test_every_collection_in_the_code_is_classified():
    known = set(personal_data.PERSONAL) | personal_data.CLUB_CONTENT | personal_data.NO_PERSON
    missing = sorted(collections_in_code() - known)
    assert not missing, (
        "Neue Sammlung(en) ohne Entscheidung für Kontolöschung und Auskunft - in services/personal_data.py eintragen: "
        + ", ".join(missing)
    )


def test_the_registry_names_only_collections_that_exist():
    stale = sorted((set(personal_data.PERSONAL) | personal_data.CLUB_CONTENT | personal_data.NO_PERSON) - collections_in_code())
    assert not stale, f"In services/personal_data.py, aber im Code nicht mehr verwendet: {', '.join(stale)}"


def test_each_collection_has_exactly_one_place():
    personal, club, none = set(personal_data.PERSONAL), personal_data.CLUB_CONTENT, personal_data.NO_PERSON
    assert not personal & club and not personal & none and not club & none


def test_every_decision_is_known_and_explained_where_needed():
    for name, entry in personal_data.PERSONAL.items():
        assert entry.erasure in personal_data.DECISIONS, name
        assert isinstance(entry.export, tuple), name
        if not entry.export or entry.erasure in (personal_data.KEPT, personal_data.EXPIRES):
            assert entry.note.strip(), f"{name}: warum nicht in der Auskunft bzw. warum sie bleibt"


def test_export_keys_are_unique():
    keys = [key for entry in personal_data.PERSONAL.values() for key in entry.export]
    assert len(keys) == len(set(keys))


def test_what_the_erasure_purges_is_registered_as_deleted():
    for name in account_erasure.PURGED:
        assert personal_data.PERSONAL[name].erasure == personal_data.DELETED, name


def test_collections_indexed_by_a_person_are_personal():
    indexed = collections_indexed_by_person()
    assert {"users", "notifications", "media_uploads", "direct_messages"} <= indexed | {"users"}, "die Suche greift"
    wrong = sorted(indexed - set(personal_data.PERSONAL) - {"users"})
    assert not wrong, f"Index auf einem Personenfeld, aber nicht als personenbezogen eingetragen: {', '.join(wrong)}"
