import inspect

from fastapi.params import Depends

from auth import get_optional_user
from routes import extras_routes


STAFF_ONLY_EXPORTS = [
    extras_routes.pdf_qr_sign_export,
    extras_routes.pdf_tournament_participants,
    extras_routes.pdf_tournament_checkin,
    extras_routes.pdf_tournament_registration_qr,
    extras_routes.pdf_tournament_matches,
    extras_routes.pdf_tournament_station_signs,
]

PUBLIC_RESULT_EXPORTS = [
    extras_routes.pdf_tournament_standings,
    extras_routes.pdf_f1_lb,
    extras_routes.pdf_f1_championship,
]


def _depends_parameter(endpoint, name):
    default = inspect.signature(endpoint).parameters[name].default
    assert isinstance(default, Depends)
    return default.dependency


def test_operational_pdf_exports_require_moderator_role():
    for endpoint in STAFF_ONLY_EXPORTS:
        dependency = _depends_parameter(endpoint, "me")
        closure_values = [cell.cell_contents for cell in (dependency.__closure__ or [])]

        assert ("moderator",) in closure_values


def test_result_pdf_exports_are_optional_but_status_gated():
    for endpoint in PUBLIC_RESULT_EXPORTS:
        assert _depends_parameter(endpoint, "user") is get_optional_user
        assert "_result_export_allowed" in inspect.getsource(endpoint)
