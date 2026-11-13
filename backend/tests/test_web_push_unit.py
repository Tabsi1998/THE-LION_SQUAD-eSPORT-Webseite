"""Browser-Benachrichtigungen (Web-Push, #1163): Verschlüsselung, Schlüssel, Ziel und Inhalt einer Meldung.

Die Schlüssel entstehen hier zur Laufzeit - echte gehören nur in die Server-Konfiguration.
"""
import json
import pathlib
import struct
import sys

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import web_push  # noqa: E402


def browser_keys():
    """Ein Schlüsselpaar wie im Browser: öffentlicher Punkt und Geheimnis, base64url."""
    import os

    key = ec.generate_private_key(ec.SECP256R1())
    auth = os.urandom(16)
    return key, web_push._b64url(web_push._public_bytes(key.public_key())), web_push._b64url(auth)


def decrypt(body: bytes, key, auth: str) -> bytes:
    """Was der Browser tut (RFC 8291) - unabhängig vom Versand nachgebaut."""
    salt, record_size, id_length = body[:16], struct.unpack("!L", body[16:20])[0], body[20]
    server_public = body[21:21 + id_length]
    ciphertext = body[21 + id_length:]
    assert record_size == 4096
    shared = key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), server_public))
    ua_public = web_push._public_bytes(key.public_key())
    ikm = web_push._hkdf(web_push._b64url_decode(auth), shared, b"WebPush: info\x00" + ua_public + server_public, 32)
    cek = web_push._hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = web_push._hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert plain.endswith(b"\x02")
    return plain[:-1]


def env_with_keys(**extra):
    keys = web_push.generate_keys()
    return {**keys, "SENDER_EMAIL": "noreply@example.test", **extra}


def test_der_browser_kann_den_inhalt_entschluesseln():
    key, p256dh, auth = browser_keys()
    body = web_push.encrypt_payload(b'{"title":"Du bist dran"}', p256dh, auth)
    assert decrypt(body, key, auth) == b'{"title":"Du bist dran"}'


def test_ohne_schluessel_ist_web_push_still_aus():
    assert web_push.vapid_config({}) is None
    assert web_push.vapid_config({"WEB_PUSH_VAPID_PRIVATE_KEY": "kaputt", "SENDER_EMAIL": "a@example.test"}) is None


def test_schluesselpaar_und_kontakt():
    env = env_with_keys()
    config = web_push.vapid_config(env)
    assert config is not None
    assert config.public_key == env["WEB_PUSH_VAPID_PUBLIC_KEY"]
    assert config.contact == "mailto:noreply@example.test"
    # Ein öffentlicher Schlüssel, der nicht zum privaten passt, schaltet ab statt falsch zu signieren.
    other = web_push.generate_keys()["WEB_PUSH_VAPID_PUBLIC_KEY"]
    assert web_push.vapid_config({**env, "WEB_PUSH_VAPID_PUBLIC_KEY": other}) is None
    assert web_push.vapid_config({**env, "WEB_PUSH_CONTACT": "https://example.test/kontakt"}).contact == "https://example.test/kontakt"


def test_vapid_anmeldung_ist_beim_push_dienst_pruefbar():
    config = web_push.vapid_config(env_with_keys())
    header = web_push.vapid_headers("https://fcm.googleapis.com/fcm/send/abc", config)["Authorization"]
    token = header.split("t=", 1)[1].split(",", 1)[0]
    public = header.split("k=", 1)[1]
    assert public == config.public_key
    verifier = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), web_push._b64url_decode(public))
    claims = jwt.decode(token, verifier, algorithms=["ES256"], audience="https://fcm.googleapis.com")
    assert claims["sub"] == "mailto:noreply@example.test"


def test_nur_bekannte_push_dienste():
    assert web_push.endpoint_allowed("https://fcm.googleapis.com/fcm/send/abc")
    assert web_push.endpoint_allowed("https://updates.push.services.mozilla.com/wpush/v2/abc")
    assert web_push.endpoint_allowed("https://web.push.apple.com/QH")
    assert web_push.endpoint_allowed("https://wns2-par02p.notify.windows.com/w/?token=abc")
    for endpoint in ("http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://example.test/x",
                     "https://fcm.googleapis.com.example.test/x", "https://user:pw@fcm.googleapis.com/x",
                     "https://fcm.googleapis.com:8443/x", "javascript:alert(1)", ""):
        assert not web_push.endpoint_allowed(endpoint), endpoint
    assert web_push.endpoint_allowed("https://push.example.test/x", {"WEB_PUSH_EXTRA_HOSTS": "push.example.test"})


def test_ziel_bleibt_auf_dieser_website():
    base = "https://club.example"
    assert web_push.safe_path("/tournaments/cup?tab=checkin", base) == "/tournaments/cup?tab=checkin"
    assert web_push.safe_path("https://club.example/matches/m1#chat", base) == "/matches/m1#chat"
    assert web_push.safe_path("https://evil.example/x", base) == "/notifications"
    assert web_push.safe_path("//evil.example/x", base) == "/notifications"
    assert web_push.safe_path("javascript:alert(1)", base) == "/notifications"
    assert web_push.safe_path("", base) == "/notifications"


def test_inhalt_der_meldung_mit_knopf_nur_bei_eigenem_ziel():
    checkin = web_push.build_payload({
        "id": "n1", "kind": "tournament_checkin", "title": "Check-in offen", "body": "Bis 18:00",
        "url": "/tournaments/cup", "meta": {},
    }, "https://club.example")
    assert checkin["url"] == "/tournaments/cup"
    assert checkin["actions"] == [{"action": "checkin", "title": "Jetzt einchecken", "url": "/tournaments/cup"}]
    assert checkin["tag"] == "n1"
    # Ohne sicheres Ziel kein Knopf - ein Knopf öffnet immer eine Seite.
    foreign = web_push.build_payload({"id": "n2", "kind": "tournament_checkin", "title": "x", "url": "https://evil.example/"}, "https://club.example")
    assert "actions" not in foreign and foreign["url"] == "/notifications"
    plain = web_push.build_payload({"id": "n3", "kind": "achievement", "title": "Erfolg", "url": "/profile"}, "")
    assert "actions" not in plain
    long = web_push.build_payload({"id": "n4", "kind": "x", "title": "T" * 500, "body": "B" * 500, "meta": {"push_body": "kurz"}}, "")
    assert len(long["title"]) == 120 and long["body"] == "kurz"
    assert len(json.dumps(long)) < 3000


def test_browser_name_ohne_ganzen_user_agent():
    assert web_push.browser_label("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36") == "Chrome unter Windows"
    assert web_push.browser_label("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1") == "Safari unter iPhone"
    assert web_push.browser_label(None) == "Browser"


def test_schluessel_des_browsers_werden_geprueft():
    _key, p256dh, auth = browser_keys()
    assert web_push.valid_keys(p256dh, auth)
    assert not web_push.valid_keys(p256dh, "kurz")
    assert not web_push.valid_keys("A" * 87, auth)


def test_ttl_ist_einstellbar_und_begrenzt():
    assert web_push.ttl_seconds({}) == web_push.DEFAULT_TTL_SECONDS
    assert web_push.ttl_seconds({"WEB_PUSH_TTL_SECONDS": "600"}) == 600
    assert web_push.ttl_seconds({"WEB_PUSH_TTL_SECONDS": "5"}) == 60
    assert web_push.ttl_seconds({"WEB_PUSH_TTL_SECONDS": "x"}) == web_push.DEFAULT_TTL_SECONDS


def test_sperrbildschirm_ohne_nachrichtentext_und_betrag():
    """Im Browser stehen weder Chat-Texte noch Beträge - nur, dass etwas da ist (#1163)."""
    invoice = web_push.build_payload({"id": "n1", "kind": "invoice_ready", "title": "Deine Rechnung ist da",
                                      "body": "Weihnachtsfeier: 40,00 €, zahlbar bis 17.10.2026.", "url": "/profile?tab=invoices"})
    assert invoice["title"] == "Deine Rechnung ist da" and invoice["body"] == "Deine Rechnung liegt in deinem Konto."
    assert "40" not in json.dumps(invoice)
    message = web_push.build_payload({"id": "n2", "kind": "direct_message", "title": "Neue Nachricht von Max",
                                      "body": "Treffen um acht?", "url": "/profile?tab=inbox&to=max"})
    assert message["title"] == "Neue Nachricht von Max" and "Treffen" not in json.dumps(message)
    for kind in ("team_chat_message", "match_chat_mention", "tournament_chat_message"):
        assert web_push.build_payload({"kind": kind, "title": "Chat", "body": "geheim"})["body"] == web_push.MESSAGE_BODY
    # Kostenbeitrag in einer Anmeldung: kein Betrag, aber der Hinweis aufs Konto.
    fee = web_push.build_payload({"kind": "event_registration", "title": "Angemeldet: Sommerfest",
                                  "body": "Dein Kostenbeitrag: 12,50 €. Die Rechnung findest du unter „Meine Rechnungen“."})
    assert fee["title"] == "Angemeldet: Sommerfest" and fee["body"] == web_push.MONEY_BODY
    assert web_push.build_payload({"kind": "x", "title": "Gewinn 100 EUR", "body": "ok"})["title"] == "THE LION SQUAD"
    # Andere Meldungen bleiben, wie sie sind.
    checkin = web_push.build_payload({"kind": "tournament_checkin", "title": "Check-in offen", "body": "Bis 18:00 Uhr"})
    assert checkin["body"] == "Bis 18:00 Uhr"


def test_inhalt_verbergen_zeigt_nur_dass_etwas_da_ist():
    hidden = web_push.build_payload({"id": "n1", "kind": "tournament_checkin", "title": "Check-in offen", "body": "Bis 18:00",
                                     "url": "/tournaments/cup"}, private=True)
    assert hidden["title"] == "THE LION SQUAD" and hidden["body"] == "Neue Benachrichtigung"
    assert hidden["url"] == "/tournaments/cup" and "actions" not in hidden and hidden["kind"] == ""
