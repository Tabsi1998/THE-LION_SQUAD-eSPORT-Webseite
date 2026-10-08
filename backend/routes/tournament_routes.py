"""Turnierrouten unter /api/tournaments.

Die Endpunkte liegen in Fachmodulen und hängen sich beim Import an den
gemeinsamen Router aus routes.tournament_router. Dieses Modul importiert alle
Fachmodule, damit der Router vollständig ist, bevor server.py ihn einbindet.

Es exportiert bewusst keine Helfer. Tests patchen Namen an dem Modul, in dem
eine Funktion tatsächlich nachschlägt. Ein Patch am falschen Modul soll mit
AttributeError scheitern, statt still daneben zu greifen.
"""
import importlib

from routes.tournament_router import router

# Die Fachmodule werden nur geladen, nicht benutzt: beim Laden hängt jedes seine Endpunkte an den Router.
_FACHMODULE = (
    "tournament_crud_routes",
    "tournament_chat_routes",
    "tournament_lifecycle_routes",
    "tournament_registration_routes",
    "tournament_staff_routes",
    "tournament_stage_routes",
    "tournament_structure_routes",
    "tournament_view_routes",
    "tournament_format_routes",
)
for _name in _FACHMODULE:
    importlib.import_module(f"routes.{_name}")

__all__ = ["router"]
