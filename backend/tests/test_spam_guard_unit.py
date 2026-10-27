"""Spamschutz (#2067): Formular-Token, Honeypot und Inhalts-Bewertung ohne Datenbank.

Die beiden echten Bot-Nachrichten vom 27.10.2026 müssen auffallen, normale Nachrichten echter Menschen nie.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import spam_guard  # noqa: E402

SECRET = "unit-tests-secret-with-at-least-32-characters"


@pytest.fixture(autouse=True)
def jwt_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", SECRET)


CONFIG = spam_guard.normalized(None)

BOTS = [
    {"name": "KuHHNCqrrWoOGwLSltUsNs", "subject": "JTslVviyjzDQSoOqIpLRRSU", "message": "welHMCbnDXaAOykIMdahEVhy",
     "email": "i.w.irir.o.f.a6.7@gmail.com"},
    {"name": "wBHeAZnwWoXYMRRGjJZrpspl", "subject": "nTXHBYWEppRvQjssDrRyWaT", "message": "KpKDzELIGCspLEZGffS",
     "email": "jo.hn.do.e1@gmail.com"},
]

HUMANS = [
    {"name": "Fabian", "subject": "Turnier", "message": "Hallo, wann ist das nächste Turnier?", "email": "fabian@example.at"},
    {"name": "Jürgen Müller-Lüdenscheidt", "subject": "Mitgliedschaft", "message": "Servus! Ich würde gern Mitglied werden. Was kostet das?",
     "email": "juergen.mueller@gmail.com"},
    {"name": "xX_Lion_Xx", "subject": "Frage", "message": "Gibt es noch Plätze?", "email": "lion.fan.tirol@gmail.com"},
    {"name": "Anna-Lena", "subject": "Sponsoring-Anfrage", "message": "Wir möchten euch unterstützen. Unsere Website: https://firma.at",
     "email": "anna-lena@firma.at"},
    {"name": "Ömer Çelik", "subject": "Rechtsschutzversicherung", "message": "Kurze Frage zur Haftpflicht bei Events.",
     "email": "oemer@example.com"},
    {"name": "Max", "subject": "Hi", "message": "Danke!", "email": "max@example.com"},
    {"name": "Sophie", "subject": "WhatsAppGruppe", "message": "Gibt es eine WhatsAppGruppe für Eltern?", "email": "sophie@example.com"},
    {"name": "Lukas Huber", "subject": "Lange Nachricht",
     "message": ("Liebes Team, " * 3) + "ich habe beim letzten Turnier in Innsbruck mitgespielt und wollte fragen, ob es "
     "eine Aufzeichnung gibt. Außerdem: Kann man sich auch als Team aus Südtirol anmelden? " * 20,
     "email": "lukas.huber@outlook.com"},
]


# ---------------------------------------------------------------- Inhalt


def texts(sample: dict) -> dict:
    return {key: value for key, value in sample.items() if key != "email"}


@pytest.mark.parametrize("sample", BOTS)
def test_the_two_real_bot_messages_are_suspect(sample):
    verdict = spam_guard.score_content(CONFIG, texts(sample), email=sample["email"])
    assert verdict["score"] >= CONFIG["suspect_score"]
    assert "random_text" in verdict["reasons"]


def test_dotted_gmail_counts_on_its_own():
    assert "gmail_dots" in spam_guard.score_content(CONFIG, {}, email="i.w.irir.o.f.a6.7@gmail.com")["reasons"]
    assert spam_guard.score_content(CONFIG, {}, email="anna.maria.huber@gmail.com")["reasons"] == []
    assert spam_guard.score_content(CONFIG, {}, email="i.w.i.r.i.r@example.com")["reasons"] == []


@pytest.mark.parametrize("sample", HUMANS, ids=[row["name"] for row in HUMANS])
def test_real_people_pass(sample):
    verdict = spam_guard.score_content(CONFIG, texts(sample), email=sample["email"])
    assert verdict["score"] < CONFIG["suspect_score"], verdict
    assert verdict["reasons"] == []


def test_random_text_needs_every_field():
    sample = {"name": "KuHHNCqrrWoOGwLSltUsNs", "subject": "Turnier", "message": "Hallo, wann ist das nächste Turnier?"}
    assert "random_text" not in spam_guard.score_content(CONFIG, sample)["reasons"]


def test_lowercase_random_without_vowels_is_random():
    assert spam_guard.looks_random("xkqjzvbnmwptrs", min_length=12)
    assert not spam_guard.looks_random("rechtsschutz", min_length=12)
    assert not spam_guard.looks_random("Donaudampfschifffahrt", min_length=12)


def test_many_links_and_spam_words_add_up():
    text = "Best casino bonus http://a.example http://b.example www.c.example"
    verdict = spam_guard.score_content(CONFIG, {"name": "Bob", "subject": "Offer", "message": text})
    assert {"links", "spam_words"} <= set(verdict["reasons"])
    assert verdict["score"] >= CONFIG["suspect_score"]


def test_one_link_is_fine():
    verdict = spam_guard.score_content(CONFIG, {"message": "Unser Stream: https://twitch.tv/lionsquad"})
    assert verdict["reasons"] == []


def test_word_filter_result_adds_points():
    assert spam_guard.word_filter_points(CONFIG, {"action": "hold"}) == CONFIG["weights"]["word_filter_hold"]
    assert spam_guard.word_filter_points(CONFIG, {"action": "flag"}) == CONFIG["weights"]["word_filter_flag"]
    assert spam_guard.word_filter_points(CONFIG, {"action": None}) == 0


# ---------------------------------------------------------------- Token


def test_token_round_trip():
    token = spam_guard.issue_token("contact", now=1000.0)
    assert spam_guard.verify_token(CONFIG, token, "contact", now=1010.0) == (True, "ok")


def test_token_too_fast():
    token = spam_guard.issue_token("contact", now=1000.0)
    assert spam_guard.verify_token(CONFIG, token, "contact", now=1001.0) == (False, "too_fast")


def test_token_expired():
    token = spam_guard.issue_token("contact", now=1000.0)
    later = 1000.0 + CONFIG["max_age_minutes"] * 60 + 1
    assert spam_guard.verify_token(CONFIG, token, "contact", now=later) == (False, "expired")


def test_token_from_the_future_is_not_accepted():
    token = spam_guard.issue_token("contact", now=5000.0)
    assert spam_guard.verify_token(CONFIG, token, "contact", now=1000.0)[0] is False


def test_forged_token():
    token = spam_guard.issue_token("contact", now=100000.0)
    form, issued, nonce, sig = token.split(".")
    backdated = f"{form}.{int(issued) - 3600}.{nonce}.{sig}"
    assert spam_guard.verify_token(CONFIG, backdated, "contact", now=100010.0) == (False, "forged")
    tampered = token[:-2] + ("xx" if not token.endswith("xx") else "yy")
    assert spam_guard.verify_token(CONFIG, tampered, "contact", now=100010.0) == (False, "forged")


def test_token_signed_with_another_secret(monkeypatch):
    token = spam_guard.issue_token("contact", now=1000.0)
    monkeypatch.setenv("JWT_SECRET", "another-secret-with-at-least-32-characters!!")
    assert spam_guard.verify_token(CONFIG, token, "contact", now=1010.0) == (False, "forged")


def test_token_for_another_form():
    token = spam_guard.issue_token("register", now=1000.0)
    assert spam_guard.verify_token(CONFIG, token, "contact", now=1010.0) == (False, "wrong_form")


@pytest.mark.parametrize("token", ["", "abc", "a.b.c.d", "contact.x.y.z", "contact.1000..sig", "x" * 600])
def test_malformed_tokens(token):
    ok, reason = spam_guard.verify_token(CONFIG, token, "contact", now=1010.0)
    assert ok is False and reason in ("missing", "malformed", "forged")


def test_unknown_form_cannot_get_a_token():
    with pytest.raises(ValueError):
        spam_guard.issue_token("newsletter")


# ---------------------------------------------------------------- Datenschutzerklärung


def test_privacy_page_names_turnstile_only_when_it_is_on():
    import json

    from services import site_texts

    without = json.dumps(site_texts.privacy_page({}, {}), ensure_ascii=False)
    with_turnstile = json.dumps(site_texts.privacy_page({}, {"spam_turnstile": True}), ensure_ascii=False)
    assert "privacy-spam-guard" in without and "Turnstile" not in without
    assert "privacy-turnstile" in with_turnstile and "Cloudflare, Inc." in with_turnstile


def test_csp_allows_turnstile_only_for_script_and_frame():
    nginx = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    policy = next(line for line in nginx.splitlines() if line.strip().startswith('default "default-src'))
    directives = {part.split()[0]: part for part in policy.strip().strip('default "').split(";") if part.strip()}
    directives = {key.strip(): value for key, value in directives.items()}
    assert "https://challenges.cloudflare.com" in directives["script-src"]
    assert "https://challenges.cloudflare.com" in directives["frame-src"]
    assert "https://challenges.cloudflare.com" not in directives["connect-src"]


# ---------------------------------------------------------------- Einstellungen


def test_settings_fall_back_to_safe_defaults():
    config = spam_guard.normalized({"min_seconds": -5, "max_age_minutes": "x", "suspect_score": 0, "weights": {"links": 999},
                                    "turnstile": {"enabled": "yes", "mode": "sometimes"}})
    defaults = spam_guard.normalized(None)
    assert config["min_seconds"] == defaults["min_seconds"]
    assert config["max_age_minutes"] == defaults["max_age_minutes"]
    assert config["suspect_score"] == defaults["suspect_score"]
    assert config["weights"]["links"] == defaults["weights"]["links"]
    assert config["turnstile"]["enabled"] is False
    assert config["turnstile"]["mode"] == "always"


def test_validate_changes_rejects_out_of_range():
    with pytest.raises(spam_guard.SpamGuardError):
        spam_guard.validate_changes(CONFIG, {"min_seconds": 600})
    with pytest.raises(spam_guard.SpamGuardError):
        spam_guard.validate_changes(CONFIG, {"unknown": 1})
    with pytest.raises(spam_guard.SpamGuardError):
        spam_guard.validate_changes(CONFIG, {"limits": {"contact": {"ip_limit": 0}}})
    after = spam_guard.validate_changes(CONFIG, {"min_seconds": 5, "limits": {"contact": {"email_limit": 2}}})
    assert after == {"min_seconds": 5, "limits": {**CONFIG["limits"], "contact": {**CONFIG["limits"]["contact"], "email_limit": 2}}}


def test_spam_words_are_cleaned():
    after = spam_guard.validate_changes(CONFIG, {"spam_words": ["  Casino ", "casino"]})
    assert after["spam_words"] == ["Casino"]
    with pytest.raises(spam_guard.SpamGuardError):
        spam_guard.validate_changes(CONFIG, {"spam_words": ["x"]})
