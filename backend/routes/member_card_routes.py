"""Mitgliedskarte (#346): die Karte fürs eigene Konto, die Prüfseite für Partner."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from auth import get_current_user
from services.member_card import card_for, verify_token, wallet_model
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api", tags=["member-card"])


@router.get("/account/member-card")
async def my_member_card(request: Request, user: dict = Depends(get_current_user)):
    # Jeder Aufruf erzeugt einen frischen Code; wer die Karte offen hat, holt alle paar Minuten neu.
    await enforce_rate_limit(request, "member-card:issue", limit=60, window_seconds=600, subject=user["id"])
    card = await card_for(user)
    if card.get("status") == "valid":
        card["wallet"] = wallet_model(card)
    return card


@router.get("/card/verify/{token}")
async def verify_member_card(token: str, request: Request):
    """Öffentlich, damit ein Partner ohne Konto scannen kann - gedrosselt gegen Durchprobieren."""
    await enforce_rate_limit(request, "member-card:verify", limit=30, window_seconds=600)
    return await verify_token(token)
