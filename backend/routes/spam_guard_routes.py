"""Spamschutz (#2067): Formular-Token für die Website, Zähler für die Kontakt-Inbox, Schwellen und Turnstile.

- ``GET /api/spam-guard/token?form=…`` - öffentlich: Token, Name des Honeypot-Felds, Mindestzeit, ggf. Turnstile.
- ``GET /api/spam-guard/stats`` - Kontakt-Inbox (Bereich Verein) und Betrieb: abgefangen heute / 7 Tage mit Gründen.
- Schwellen und Turnstile ändert nur der Superadmin mit bestätigter Zwei-Faktor-Anmeldung, immer mit Grund; jede
  Änderung steht im Protokoll. Der Secret Key geht nur hinein, nie wieder heraus.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from auth import require_area, require_super
from database import get_db
from services import spam_guard
from services.rate_limit import enforce_rate_limit, get_client_ip, keyed_subject

router = APIRouter(prefix="/api/spam-guard", tags=["spam-guard"])

TOKEN_REQUESTS_PER_WINDOW = 60
TOKEN_WINDOW_SECONDS = 600


def _bad_request(exc: spam_guard.SpamGuardError) -> HTTPException:
    return HTTPException(400, str(exc))


@router.get("/token")
async def form_token(form: Literal["contact", "register", "forgot_password", "resend_verification"], request: Request,
                     response: Response):
    await enforce_rate_limit(request, "spam-guard:token", TOKEN_REQUESTS_PER_WINDOW, TOKEN_WINDOW_SECONDS,
                             subject=keyed_subject(f"ip:{get_client_ip(request)}"))
    response.headers["Cache-Control"] = "no-store"
    config = await spam_guard.load(get_db())
    return {
        "token": spam_guard.issue_token(form),
        "honeypot": spam_guard.HONEYPOT_FIELD,
        "min_seconds": config["min_seconds"],
        "max_age_seconds": config["max_age_minutes"] * 60,
        "turnstile": spam_guard.public_turnstile(config, form),
    }


@router.get("/stats")
async def spam_stats(me: dict = Depends(require_area("club", "system"))):
    return await spam_guard.stats_view(get_db())


@router.get("/settings")
async def spam_settings(response: Response, me: dict = Depends(require_super())):
    response.headers["Cache-Control"] = "no-store"
    return spam_guard.admin_view(await spam_guard.load(get_db()))


class SettingsChange(BaseModel):
    changes: dict
    reason: str = Field(default="", max_length=500)


@router.put("/settings")
async def update_spam_settings(body: SettingsChange, me: dict = Depends(require_super())):
    try:
        config, changed = await spam_guard.update(get_db(), body.changes, actor=me, reason=body.reason)
    except spam_guard.SpamGuardError as exc:
        raise _bad_request(exc)
    return {**spam_guard.admin_view(config), "changed": changed}


class TurnstileChange(BaseModel):
    enabled: bool | None = None
    site_key: str | None = Field(default=None, max_length=200)
    mode: str | None = Field(default=None, max_length=20)
    forms: dict[str, bool] | None = None
    reason: str = Field(default="", max_length=500)


@router.put("/turnstile")
async def update_turnstile(body: TurnstileChange, me: dict = Depends(require_super())):
    changes = body.model_dump(exclude_unset=True, exclude={"reason"})
    try:
        config = await spam_guard.update_turnstile(get_db(), changes, actor=me, reason=body.reason)
    except spam_guard.SpamGuardError as exc:
        raise _bad_request(exc)
    return spam_guard.admin_view(config)


class TurnstileSecret(BaseModel):
    secret: str = Field(max_length=500)
    reason: str = Field(default="", max_length=500)


@router.put("/turnstile/secret")
async def set_turnstile_secret(body: TurnstileSecret, me: dict = Depends(require_super())):
    try:
        config = await spam_guard.set_turnstile_secret(get_db(), body.secret, actor=me, reason=body.reason)
    except spam_guard.SpamGuardError as exc:
        raise _bad_request(exc)
    return spam_guard.admin_view(config)


class ReasonOnly(BaseModel):
    reason: str = Field(default="", max_length=500)


@router.post("/turnstile/secret/remove")
async def remove_turnstile_secret(body: ReasonOnly, me: dict = Depends(require_super())):
    try:
        config = await spam_guard.remove_turnstile_secret(get_db(), actor=me, reason=body.reason)
    except spam_guard.SpamGuardError as exc:
        raise _bad_request(exc)
    return spam_guard.admin_view(config)


@router.post("/turnstile/test")
async def test_turnstile(me: dict = Depends(require_super())):
    return await spam_guard.run_turnstile_test(get_db())
