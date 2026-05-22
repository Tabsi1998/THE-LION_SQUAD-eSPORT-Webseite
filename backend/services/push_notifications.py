"""Expo push notification delivery for the native mobile app."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import httpx

from database import get_db
from models import now_utc

logger = logging.getLogger("tls.push_notifications")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
RECEIPT_RECHECK_AFTER_MINUTES = 10


def _is_expo_token(token: str | None) -> bool:
    value = str(token or "")
    return value.startswith("ExponentPushToken[") or value.startswith("ExpoPushToken[")


def _channel_for_kind(kind: str | None) -> str:
    value = str(kind or "").lower()
    if value.startswith(("tournament", "match", "station", "f1", "prize")):
        return "tournaments"
    return "default"


async def send_mobile_push_for_notification(notification: dict[str, Any]) -> int:
    user_id = notification.get("user_id")
    if not user_id:
        return 0

    db = get_db()
    tokens = await db.mobile_push_tokens.find(
        {"user_id": user_id, "enabled": {"$ne": False}},
        {"_id": 0, "token": 1},
    ).to_list(20)
    push_tokens = [row.get("token") for row in tokens if _is_expo_token(row.get("token"))]
    if not push_tokens:
        return 0

    title = str(notification.get("title") or "LionsAPP")[:120]
    body = str(notification.get("body") or "")[:180]
    kind = notification.get("kind")
    payloads = [
        {
            "to": token,
            "sound": "default",
            "channelId": _channel_for_kind(kind),
            "priority": "high",
            "title": title,
            "body": body,
            "data": {
                "notification_id": notification.get("id"),
                "kind": kind,
                "url": notification.get("url"),
                "meta": notification.get("meta") or {},
            },
        }
        for token in push_tokens
    ]

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(EXPO_PUSH_URL, json=payloads)
            response.raise_for_status()
        result = response.json()
        rows = result.get("data") if isinstance(result, dict) else None
        if isinstance(rows, dict):
            rows = [rows]
        failed_tokens = []
        ticket_updates = []
        if isinstance(rows, list):
            for token, row in zip(push_tokens, rows):
                if not isinstance(row, dict):
                    continue
                if row.get("status") == "ok":
                    ticket_id = row.get("id")
                    ticket_updates.append(
                        {
                            "token": token,
                            "ticket_id": ticket_id,
                            "status": "ok",
                            "message": "",
                            "error": "",
                        }
                    )
                    continue
                if row.get("status") != "error":
                    continue
                details = row.get("details") or {}
                logger.warning(
                    "Expo push token failed for notification %s: %s",
                    notification.get("id"),
                    row.get("message") or details,
                )
                ticket_updates.append(
                    {
                        "token": token,
                        "ticket_id": row.get("id"),
                        "status": "error",
                        "message": row.get("message") or "",
                        "error": details.get("error") or "",
                    }
                )
                if details.get("error") == "DeviceNotRegistered":
                    failed_tokens.append(token)
        now = now_utc().isoformat()
        for update in ticket_updates:
            await db.mobile_push_tokens.update_one(
                {"token": update["token"]},
                {"$set": {
                    "last_ticket_id": update.get("ticket_id"),
                    "last_ticket_status": update.get("status"),
                    "last_ticket_message": update.get("message"),
                    "last_ticket_error": update.get("error"),
                    "last_ticket_at": now,
                }},
            )
        if failed_tokens:
            await db.mobile_push_tokens.update_many(
                {"token": {"$in": failed_tokens}},
                {"$set": {"enabled": False, "disabled_at": now}},
            )
        await db.mobile_push_tokens.update_many(
            {"token": {"$in": push_tokens}},
            {"$set": {"last_sent_at": now}},
        )
        return len(push_tokens)
    except Exception as exc:
        logger.warning("Expo push delivery failed for notification %s: %s", notification.get("id"), exc)
        return 0


async def _check_receipts_for_tokens(tokens: list[dict[str, Any]]) -> dict[str, Any]:
    ticket_ids = [row.get("last_ticket_id") for row in tokens if row.get("last_ticket_id")]
    if not ticket_ids:
        return {"checked": 0, "receipts": [], "disabled": 0, "errors": 0}

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(EXPO_RECEIPTS_URL, json={"ids": ticket_ids})
            response.raise_for_status()
        result = response.json()
    except Exception as exc:
        logger.warning("Expo push receipt check failed: %s", exc)
        return {"checked": 0, "receipts": [], "disabled": 0, "errors": 0, "error": str(exc)}

    data = result.get("data") if isinstance(result, dict) else {}
    if not isinstance(data, dict):
        data = {}

    db = get_db()
    now = now_utc().isoformat()
    receipts = []
    token_by_ticket = {row.get("last_ticket_id"): row.get("token") for row in tokens}
    failed_tokens = []
    errors = 0

    for ticket_id, receipt in data.items():
        if not isinstance(receipt, dict):
            continue
        details = receipt.get("details") or {}
        token = token_by_ticket.get(ticket_id)
        error_code = details.get("error") or ""
        payload = {
            "last_receipt_status": receipt.get("status"),
            "last_receipt_message": receipt.get("message") or "",
            "last_receipt_error": error_code,
            "last_receipt_checked_at": now,
        }
        if receipt.get("status") == "error" or error_code:
            errors += 1
        if token:
            await db.mobile_push_tokens.update_one({"token": token}, {"$set": payload})
            if error_code == "DeviceNotRegistered":
                failed_tokens.append(token)
        receipts.append({"ticket_id": ticket_id, **payload})

    if failed_tokens:
        await db.mobile_push_tokens.update_many(
            {"token": {"$in": failed_tokens}},
            {"$set": {"enabled": False, "disabled_at": now, "updated_at": now}},
        )

    return {"checked": len(receipts), "receipts": receipts, "disabled": len(failed_tokens), "errors": errors}


async def check_mobile_push_receipts_for_user(user_id: str) -> dict[str, Any]:
    """Fetch latest Expo push receipts for a user's active device tokens."""
    if not user_id:
        return {"checked": 0, "receipts": []}
    db = get_db()
    tokens = await db.mobile_push_tokens.find(
        {
            "user_id": user_id,
            "enabled": {"$ne": False},
            "last_ticket_id": {"$nin": [None, ""]},
        },
        {"_id": 0, "token": 1, "last_ticket_id": 1},
    ).to_list(20)
    ticket_ids = [row.get("last_ticket_id") for row in tokens if row.get("last_ticket_id")]
    if not ticket_ids:
        return {"checked": 0, "receipts": []}

    return await _check_receipts_for_tokens(tokens)


async def check_recent_mobile_push_receipts(limit: int = 100) -> dict[str, Any]:
    """Background receipt sweep for recent Expo tickets.

    Expo tickets only tell us that Expo accepted the push. Receipts tell us later
    whether Android/FCM rejected it, for example because a device token expired.
    """
    db = get_db()
    safe_limit = max(1, min(int(limit or 100), 500))
    cutoff = (now_utc() - timedelta(minutes=RECEIPT_RECHECK_AFTER_MINUTES)).isoformat()
    tokens = await db.mobile_push_tokens.find(
        {
            "enabled": {"$ne": False},
            "last_ticket_id": {"$nin": [None, ""]},
            "last_ticket_status": "ok",
            "$or": [
                {"last_receipt_checked_at": {"$exists": False}},
                {"last_receipt_checked_at": {"$in": [None, ""]}},
                {"last_receipt_checked_at": {"$lt": cutoff}},
            ],
        },
        {"_id": 0, "token": 1, "last_ticket_id": 1},
    ).sort("last_ticket_at", -1).to_list(safe_limit)
    return await _check_receipts_for_tokens(tokens)


async def mobile_push_health_summary() -> dict[str, Any]:
    db = get_db()
    active_filter = {"enabled": {"$ne": False}}
    active_tokens = await db.mobile_push_tokens.count_documents(active_filter)
    disabled_tokens = await db.mobile_push_tokens.count_documents({"enabled": False})
    users_with_tokens = len(await db.mobile_push_tokens.distinct("user_id", active_filter))
    ticket_errors = await db.mobile_push_tokens.count_documents(
        {"last_ticket_error": {"$nin": [None, ""]}},
    )
    receipt_errors = await db.mobile_push_tokens.count_documents(
        {"last_receipt_error": {"$nin": [None, ""]}},
    )
    latest_problem = await db.mobile_push_tokens.find_one(
        {
            "$or": [
                {"last_ticket_error": {"$nin": [None, ""]}},
                {"last_receipt_error": {"$nin": [None, ""]}},
            ],
        },
        {
            "_id": 0,
            "user_id": 1,
            "platform": 1,
            "last_ticket_error": 1,
            "last_ticket_message": 1,
            "last_ticket_at": 1,
            "last_receipt_error": 1,
            "last_receipt_message": 1,
            "last_receipt_checked_at": 1,
        },
        sort=[("last_receipt_checked_at", -1), ("last_ticket_at", -1)],
    )
    latest_receipt_check = await db.mobile_push_tokens.find_one(
        {"last_receipt_checked_at": {"$nin": [None, ""]}},
        {"_id": 0, "last_receipt_checked_at": 1},
        sort=[("last_receipt_checked_at", -1)],
    )
    return {
        "active_tokens": active_tokens,
        "disabled_tokens": disabled_tokens,
        "users_with_tokens": users_with_tokens,
        "ticket_errors": ticket_errors,
        "receipt_errors": receipt_errors,
        "latest_problem": latest_problem,
        "latest_receipt_checked_at": (latest_receipt_check or {}).get("last_receipt_checked_at"),
    }
