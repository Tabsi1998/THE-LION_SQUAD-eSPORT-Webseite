"""Expo push notification delivery for the native mobile app."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from database import get_db
from models import now_utc

logger = logging.getLogger("tls.push_notifications")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


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
        if isinstance(rows, list):
            for token, row in zip(push_tokens, rows):
                if not isinstance(row, dict) or row.get("status") != "error":
                    continue
                details = row.get("details") or {}
                logger.warning(
                    "Expo push token failed for notification %s: %s",
                    notification.get("id"),
                    row.get("message") or details,
                )
                if details.get("error") == "DeviceNotRegistered":
                    failed_tokens.append(token)
        if failed_tokens:
            await db.mobile_push_tokens.update_many(
                {"token": {"$in": failed_tokens}},
                {"$set": {"enabled": False, "disabled_at": now_utc().isoformat()}},
            )
        await db.mobile_push_tokens.update_many(
            {"token": {"$in": push_tokens}},
            {"$set": {"last_sent_at": now_utc().isoformat()}},
        )
        return len(push_tokens)
    except Exception as exc:
        logger.warning("Expo push delivery failed for notification %s: %s", notification.get("id"), exc)
        return 0
