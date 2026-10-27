"""Wunschnummer je Mitglied (#2034): Mitglied wählt einmal, stellt danach Anträge; der Vorstand vergibt, gibt frei,
fordert Neuwahl an und stellt Bereich, reservierte Nummern und das Feld in Dolibarr ein. Logik in
``services/jersey_numbers.py``."""

from typing import Literal

from auth import get_current_user, require_area
from database import get_db
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from services import jersey_numbers
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api", tags=["jersey-numbers"])


class CheckBody(BaseModel):
    number: int | str


class AdminCheckBody(BaseModel):
    number: int | str
    user_id: str | None = Field(default=None, max_length=80)


class ChooseBody(BaseModel):
    number: int | str
    confirmed: bool = False


class RequestBody(BaseModel):
    wished: int | str | None = None
    reason: str = Field(default="", max_length=2000)


class SetBody(BaseModel):
    number: int | str
    note: str = Field(default="", max_length=300)


class NoteBody(BaseModel):
    note: str = Field(default="", max_length=300)


class DecisionBody(BaseModel):
    decision: Literal["approve", "reopen", "reject"]
    reason: str = Field(default="", max_length=2000)


class SettingsBody(BaseModel):
    min: int | str | None = None
    max: int | str | None = None
    reserved: list[int | str] | str | None = None
    dolibarr_field: str | None = Field(default=None, max_length=80)


def _fail(exc: jersey_numbers.JerseyError):
    raise HTTPException(exc.status, exc.detail)


# ---------------------------------------------------------------- Mitglied


@router.get("/membership/me/jersey-number")
async def my_jersey_number(user: dict = Depends(get_current_user)):
    """Die eigene Nummer - nur für das Mitglied selbst, nie öffentlich."""
    return await jersey_numbers.overview(get_db(), user)


@router.post("/membership/me/jersey-number/check")
async def check_jersey_number(
    body: CheckBody, request: Request, user: dict = Depends(get_current_user)
):
    """Prüfung einer Nummer: frei oder vergeben - nie, wer sie hat. Im Körper statt in der Adresse, damit die Nummer
    nicht im Zugriffsprotokoll steht; knapp begrenzt, denn die freien Nummern zeigt die Seite ohnehin als Raster.
    """
    await enforce_rate_limit(
        request,
        "jersey-number:check",
        limit=60,
        window_seconds=600,
        subject=user["id"],
    )
    try:
        return await jersey_numbers.check(get_db(), user, body.number)
    except jersey_numbers.JerseyError as exc:
        _fail(exc)


@router.post("/membership/me/jersey-number")
async def choose_jersey_number(
    body: ChooseBody, request: Request, user: dict = Depends(get_current_user)
):
    await enforce_rate_limit(
        request,
        "jersey-number:choose",
        limit=20,
        window_seconds=600,
        subject=user["id"],
    )
    try:
        return await jersey_numbers.choose(get_db(), user, body.number, body.confirmed)
    except jersey_numbers.JerseyError as exc:
        _fail(exc)


@router.post("/membership/me/jersey-number/requests")
async def request_jersey_number_change(
    body: RequestBody, request: Request, user: dict = Depends(get_current_user)
):
    await enforce_rate_limit(
        request,
        "jersey-number:request",
        limit=10,
        window_seconds=3600,
        subject=user["id"],
    )
    try:
        return await jersey_numbers.request_change(
            get_db(), user, body.wished, body.reason
        )
    except jersey_numbers.JerseyError as exc:
        _fail(exc)


# ---------------------------------------------------------------- Vorstand


@router.get("/admin/jersey-numbers")
async def admin_jersey_numbers(me: dict = Depends(require_area("club"))):
    return await jersey_numbers.admin_overview(get_db())


@router.post("/admin/jersey-numbers/check")
async def admin_check_jersey_number(
    body: AdminCheckBody, me: dict = Depends(require_area("club"))
):
    try:
        return await jersey_numbers.availability(
            get_db(), jersey_numbers.parse_number(body.number), user_id=body.user_id
        )
    except jersey_numbers.JerseyError as exc:
        _fail(exc)


@router.put("/admin/jersey-numbers/settings")
async def save_jersey_number_settings(
    body: SettingsBody, me: dict = Depends(require_area("club"))
):
    try:
        return await jersey_numbers.save_settings(
            get_db(), body.model_dump(exclude_none=True), me["id"]
        )
    except jersey_numbers.JerseyError as exc:
        _fail(exc)


@router.put("/admin/jersey-numbers/members/{user_id}")
async def set_member_jersey_number(
    user_id: str, body: SetBody, me: dict = Depends(require_area("club"))
):
    try:
        return await jersey_numbers.set_number(
            get_db(), me, user_id, body.number, body.note
        )
    except jersey_numbers.JerseyError as exc:
        _fail(exc)


@router.post("/admin/jersey-numbers/members/{user_id}/reopen")
async def reopen_member_jersey_number(
    user_id: str, body: NoteBody, me: dict = Depends(require_area("club"))
):
    """Neuwahl anfordern: die Nummer wird sofort frei, das Mitglied darf wieder einmal wählen."""
    try:
        return await jersey_numbers.reopen(get_db(), me, user_id, body.note)
    except jersey_numbers.JerseyError as exc:
        _fail(exc)


@router.post("/admin/jersey-numbers/requests/{request_id}/decision")
async def decide_jersey_number_request(
    request_id: str, body: DecisionBody, me: dict = Depends(require_area("club"))
):
    try:
        return await jersey_numbers.decide(
            get_db(), me, request_id, body.decision, body.reason
        )
    except jersey_numbers.JerseyError as exc:
        _fail(exc)


@router.post("/admin/jersey-numbers/sync")
async def sync_jersey_numbers(me: dict = Depends(require_area("club"))):
    """Jetzt nachtragen, was noch nicht in Dolibarr steht (sonst alle zehn Minuten)."""
    return {
        "counts": await jersey_numbers.sync_pending(get_db()),
        "overview": await jersey_numbers.admin_overview(get_db()),
    }
