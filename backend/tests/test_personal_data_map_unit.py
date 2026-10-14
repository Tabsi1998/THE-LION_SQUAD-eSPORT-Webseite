"""Wächter für Kontolöschung und Auskunft (#1029, #1030): jede Sammlung, die der Code anfasst, steht in
``services/personal_data.py`` - mit Entscheidung für die Löschung und Platz in der Auskunft, oder als Sammlung ohne
Personenbezug. Eine neue Sammlung, die dort fehlt, lässt diesen Test scheitern, bevor sie bei der Löschung oder in
der Auskunft vergessen wird."""
import ast
import pathlib
import re
from functools import lru_cache

from services import account_erasure, personal_data

BACKEND = pathlib.Path(__file__).resolve().parents[1]
# Methoden der Datenbank, keine Sammlungen.
NOT_COLLECTIONS = {"command", "list_collection_names", "get_collection", "drop_collection", "create_collection", "client", "name"}
# Felder, über die eine Zeile einer Person gehört - ein Index darauf heißt: hier liegen Daten je Person.
PERSON_FIELDS = ("user_id", "owner_id", "sender_id", "recipient_id", "requester_id", "from_user_id", "target_user_id",
                 "blocker_id", "reporter_id", "author_id", "member_id")

# Zugriffe, deren Sammlung erst zur Laufzeit feststeht (``db[name]``, ``getattr(db, name)``). Jeder steht hier mit Grund:
# die Namen kommen aus einer festen Liste, deren Sammlungen der Code auch direkt anspricht. Ein neuer dynamischer
# Zugriff lässt den Test scheitern, bis er hier steht - dann ist geprüft, dass seine Sammlungen eingetragen sind.
MATCHES = "Match-Sammlung (matches_v2 bzw. die alte matches) je nach Turnierformat"
CHATS = "die Chat-Sammlungen aus chat_attachments.MESSAGE_COLLECTIONS bzw. word_filter.CHAT_COLLECTIONS"
MEDIA = "die Verwendungsstellen von Bildern aus media_audit (TARGETS, TEXT_TARGETS, USAGE_*)"
DYNAMIC = {
    "database.py:init_audit_indexes:getattr(db, collection)": "Indexliste in database.py; jede Sammlung steht dort als Text",
    "database.py:blocked_unique_indexes:getattr(db, collection)": "Indexliste in database.py; jede Sammlung steht dort als Text",
    "reset_data.py:reset_database:db[collection]": "RESET_COLLECTIONS, nur für Entwicklung und Tests",
    "routes/chat_routes.py:_chat_summary:getattr(db, collection)": CHATS,
    "routes/chat_routes.py:mark_chat_read:getattr(db, collection)": CHATS,
    "routes/dsgvo_routes.py:own_chat_messages:getattr(db, name)": "die drei Gruppen-Chats in der Auskunft",
    "routes/match_routes.py:_refresh_schedule_escalation:get_db()[collection]": MATCHES,
    "routes/match_routes.py:create_schedule_proposal:getattr(db, collection)": MATCHES,
    "routes/match_routes.py:decide_dispute:getattr(db, collection)": MATCHES,
    "routes/match_routes.py:decide_schedule_proposal:getattr(db, collection)": MATCHES,
    "routes/match_routes.py:dispute:getattr(db, collection)": MATCHES,
    "routes/phase_fg_routes.py:_clear_media_references:getattr(db, collection)": MEDIA,
    "routes/station_routes.py:_assign_match_to_station:db[collection_name]": MATCHES,
    "routes/station_routes.py:auto_assign_stations:db[collection_name]": MATCHES,
    "routes/station_routes.py:clear_station:db[collection_name]": MATCHES,
    "services/account_erasure.py:_clean:getattr(db, collection)": MEDIA,
    "services/account_erasure.py:erase_related:getattr(db, name)": "account_erasure.PURGED",
    "services/account_erasure.py:_retention:getattr(db, name)": "account_erasure.RETAINED (Nachweise mit Frist)",
    "services/account_erasure.py:purge_expired_records:getattr(db, name)": "account_erasure.RETAINED_COLLECTIONS",
    "services/achievement_counters.py:_stickers:ctx.db[name]": CHATS,
    "services/chat_attachments.py:delete_user_attachments:db[collection]": CHATS,
    "services/image_migrate.py:migrate_all:db[coll_name]": MEDIA,
    "services/match_planning.py:ensure_station_slot_available:db[other_collection]": MATCHES,
    "services/media_audit.py:_infer_scope_from_references:db[coll_name]": MEDIA,
    "services/media_audit.py:audit_image_references:db[coll_name]": MEDIA,
    "services/media_audit.py:iter_usages:getattr(db, collection)": MEDIA,
    "services/media_scan.py:_clear_references:db[collection]": "media_scan.REFERENCE_FIELDS (Chat, Ergebnisfotos, Galerie)",
    "services/media_scan.py:_mark_ref:db[REF_COLLECTIONS.get(doc.get('kind'), 'media_uploads')]": "media_scan.REF_COLLECTIONS",
    "services/member_activity.py:member_id_of:db[collection]": "dolibarr_links und dolibarr_identities",
    "services/ops_alerts.py:purge_old_logs:getattr(db, source)": "email_logs und audit_logs (Fristen)",
    "services/scheduler.py:_safe_status_transitions:db[collection_name]": "tournaments, f1_challenges und events",
    "services/scheduler.py:_write_transition:db[collection_name]": "tournaments, f1_challenges und events (Statuswechsel)",
    "services/station_runtime.py:release_station_for_match:db[collection_name]": MATCHES,
    "services/unique_duplicates.py:_groups:getattr(db, collection)": "database.AUDIT_UNIQUE_INDEXES (Altdubletten, #1043)",
    "services/unique_duplicates.py:_unique_active:getattr(db, collection)": "database.AUDIT_UNIQUE_INDEXES (Altdubletten, #1043)",
    "services/unique_duplicates.py:apply:getattr(db, collection)": "database.AUDIT_UNIQUE_INDEXES (Altdubletten, #1043)",
    "services/uploads_inventory.py:collect_references:db[collection]": MEDIA,
    "services/word_filter.py:review:db[collection]": CHATS,
}


def _is_db(node: ast.AST) -> bool:
    """``db``, ``self.db``/``ctx.db`` oder ``get_db()``."""
    return ((isinstance(node, ast.Name) and node.id == "db") or (isinstance(node, ast.Attribute) and node.attr == "db")
            or (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "get_db"))


def _string_constants(tree: ast.Module) -> dict[str, str]:
    return {node.targets[0].id: node.value.value for node in tree.body
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
            and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)}


@lru_cache(maxsize=1)
def scan() -> tuple[frozenset, tuple]:
    """Alle Sammlungen im Code (Syntaxbaum statt Textsuche) und alle Zugriffe mit erst zur Laufzeit bekanntem Namen.

    Erkannt werden ``db.name``, ``get_db().name``, ``self.db.name``, ``db["name"]``, ``getattr(db, "name")`` und
    ``db[KONSTANTE]`` bzw. ``db[modul.KONSTANTE]`` mit ``KONSTANTE = "name"``."""
    trees = {path: ast.parse(path.read_text(encoding="utf-8")) for path in BACKEND.rglob("*.py")
             if not {"tests", "venv", ".venv"} & set(path.relative_to(BACKEND).parts)}
    constants: dict[str, set[str]] = {}
    for tree in trees.values():
        for key, value in _string_constants(tree).items():
            constants.setdefault(key, set()).add(value)
    found: set[str] = set()
    dynamic: list[str] = []
    for path, tree in trees.items():
        local = _string_constants(tree)
        where = path.relative_to(BACKEND).as_posix()

        def name_of(node: ast.AST, local=local) -> set[str] | None:
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                return {node.value}
            if isinstance(node, ast.Name) and node.id.isupper() and (node.id in local or node.id in constants):
                return {local[node.id]} if node.id in local else constants[node.id]
            if isinstance(node, ast.Attribute) and node.attr.isupper() and node.attr in constants:
                return constants[node.attr]
            return None

        def visit(node: ast.AST, function: str, where=where, name_of=name_of) -> None:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                function = node.name
            if isinstance(node, ast.Attribute) and _is_db(node.value) and node.attr not in NOT_COLLECTIONS:
                found.add(node.attr)
            target = None
            if isinstance(node, ast.Subscript) and _is_db(node.value):
                target = node.slice
            elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "getattr"
                  and len(node.args) >= 2 and _is_db(node.args[0])):
                target = node.args[1]
            if target is not None:
                names = name_of(target)
                if names is None:
                    dynamic.append(f"{where}:{function}:{ast.unparse(node)}")
                else:
                    found.update(names)
            for child in ast.iter_child_nodes(node):
                visit(child, function)

        visit(tree, "<modul>")
    return frozenset(found - NOT_COLLECTIONS), tuple(sorted(set(dynamic)))


def collections_in_code() -> set[str]:
    return set(scan()[0])


def test_the_scan_sees_every_way_of_reaching_a_collection():
    found = collections_in_code()
    # get_db().upload_events (upload_routes), self.db/ctx.db (achievement_counters), db[modul.KONSTANTE] (advent_calendar).
    assert {"upload_events", "user_signals", "season_raffles", "dolibarr_identities", "discord_guilds"} <= found


def test_every_dynamic_access_is_listed_with_a_reason():
    dynamic = set(scan()[1])
    new = sorted(dynamic - set(DYNAMIC))
    assert not new, ("Zugriff mit erst zur Laufzeit bekanntem Sammlungsnamen - in DYNAMIC eintragen und prüfen, dass seine "
                     "Sammlungen in services/personal_data.py stehen: " + "; ".join(new))
    assert not sorted(set(DYNAMIC) - dynamic), "DYNAMIC nennt Zugriffe, die es nicht mehr gibt"
    assert all(reason.strip() for reason in DYNAMIC.values())


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


def test_records_with_a_deadline_say_so():
    """Entscheidung zu #1029: was nach der Löschung drei Jahre bleibt, nennt die Frist auch in der Liste."""
    for name in account_erasure.RETAINED_COLLECTIONS:
        assert personal_data.THREE_YEARS in personal_data.PERSONAL[name].note, name


def test_what_the_erasure_purges_is_registered_as_deleted():
    for name in account_erasure.PURGED:
        assert personal_data.PERSONAL[name].erasure == personal_data.DELETED, name


def test_collections_indexed_by_a_person_are_personal():
    indexed = collections_indexed_by_person()
    assert {"users", "notifications", "media_uploads", "direct_messages"} <= indexed | {"users"}, "die Suche greift"
    wrong = sorted(indexed - set(personal_data.PERSONAL) - {"users"})
    assert not wrong, f"Index auf einem Personenfeld, aber nicht als personenbezogen eingetragen: {', '.join(wrong)}"
