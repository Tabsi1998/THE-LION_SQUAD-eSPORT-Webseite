"""Der Dolibarr-Adapter (#316) und der festgehaltene Vertrag (#330): nur feste Wege,
nur https, maskierte Fehler, begrenztes Wiederholen - und Testantworten, die dem
echten API-Schema des Vereinsmoduls entsprechen müssen."""
import pathlib
import sys

import httpx
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, MANIFEST, OPENAPI, ContractViolation, FakeDolibarr, member, response_schema, validate  # noqa: E402
from services import dolibarr_client  # noqa: E402
from services.dolibarr_client import DolibarrClient, DolibarrError, capabilities_for, clean_base_url, instance_key  # noqa: E402


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    return instance


def client() -> DolibarrClient:
    return DolibarrClient({"base_url": BASE_URL, "api_key": API_KEY, "environment": "production"})


# ---------------------------------------------------------------- Vertrag

def test_manifest_names_the_pinned_contract_and_only_paths_that_exist():
    assert MANIFEST["vereine"]["api_version"] == 2
    for path in MANIFEST["vereine"]["used_paths"]:
        assert path in OPENAPI["paths"], path


def test_fixture_follows_the_contract_and_a_drift_is_caught():
    validate(member(12, functions=[{"code": "kassier", "label": "Kassier:in", "since": "2026-03-01"}]),
             response_schema("/vereine/members/{id}/summary"))
    with pytest.raises(ContractViolation):
        validate({**member(12), "email": "paula@example.test"}, response_schema("/vereine/members/{id}/summary"))
    with pytest.raises(ContractViolation):
        validate({**member(12), "status": "gekuendigt"}, response_schema("/vereine/members/{id}/summary"))
    broken = member(12)
    del broken["fee"]
    with pytest.raises(ContractViolation):
        validate(broken, response_schema("/vereine/members/{id}/summary"))


def test_capabilities_never_claim_what_the_module_does_not_ship():
    caps = capabilities_for({"api_version": 1})
    assert caps["member_summary"] and caps["members_changed_since"] and caps["member_functions"]
    for waiting in MANIFEST["vereine"]["waiting_for"]:
        assert caps[waiting] is False
    assert not any(capabilities_for(None).values())


# ---------------------------------------------------------------- Adresse

@pytest.mark.parametrize("value, expected", [
    ("https://erp.example.test", "https://erp.example.test"),
    ("https://erp.example.test/", "https://erp.example.test"),
    ("https://erp.example.test/dolibarr/api/index.php", "https://erp.example.test/dolibarr"),
    ("https://erp.example.test:8443/erp", "https://erp.example.test:8443/erp"),
])
def test_base_url_is_normalised(value, expected):
    assert clean_base_url(value) == expected


@pytest.mark.parametrize("value", [
    "http://erp.example.test", "ftp://erp.example.test", "https://user:pw@erp.example.test",
    "https://erp.example.test/?x=1", "https://erp.example.test/#frag", "https://erp.example.test/a b", "erp.example.test",
])
def test_unsafe_base_urls_are_refused(value):
    with pytest.raises(DolibarrError) as caught:
        clean_base_url(value)
    assert caught.value.kind == "bad_url"


def test_http_only_for_an_instance_marked_as_test():
    assert clean_base_url("http://localhost:18080", environment="test") == "http://localhost:18080"
    with pytest.raises(DolibarrError):
        clean_base_url("", environment="test")


def test_instance_key_separates_installations():
    assert instance_key({"instance": "verein", "entity": 1}) != instance_key({"instance": "verein", "entity": 2})
    assert instance_key({}) == "default:1"


# ---------------------------------------------------------------- HTTP

@pytest.mark.asyncio
async def test_reads_use_fixed_paths_and_the_key_stays_in_the_header(fake):
    fake.add(member(12), email="paula@example.test")
    assert (await client().status())["api_version"] == 2
    assert (await client().member_summary(12))["ref"] == "12"
    assert (await client().lookup_by_email(" Paula@example.test "))["id"] == 12
    assert [m["id"] for m in await client().members_page(page=0)] == [12]
    assert [path for path, _ in fake.calls] == [
        "/vereine/status", "/vereine/members/12/summary", "/vereine/members/lookup", "/vereine/members",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("status, kind", [(400, "bad_request"), (401, "unauthorized"), (403, "forbidden"), (404, "not_found"), (409, "conflict"), (501, "module_off")])
async def test_errors_are_named_and_masked(fake, status, kind):
    fake.fail_with = status
    with pytest.raises(DolibarrError) as caught:
        await client().member_summary(1)
    assert caught.value.kind == kind and caught.value.status == status
    assert API_KEY not in str(caught.value) and API_KEY not in caught.value.text
    assert len(fake.calls) == 1, "ein klares Nein wird nicht wiederholt"


@pytest.mark.asyncio
async def test_outage_is_retried_twice_and_then_reported(fake):
    fake.fail_with = 503
    with pytest.raises(DolibarrError) as caught:
        await client().status()
    assert caught.value.kind == "unavailable" and caught.value.status == 503
    assert len(fake.calls) == 3


@pytest.mark.asyncio
async def test_network_errors_do_not_leak_details(monkeypatch):
    def boom(request):
        raise httpx.ConnectError(f"cannot reach {request.url} with {API_KEY}")

    monkeypatch.setattr(dolibarr_client, "_transport", httpx.MockTransport(boom))
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    with pytest.raises(DolibarrError) as caught:
        await client().status()
    assert caught.value.kind == "unavailable"
    assert API_KEY not in str(caught.value)


@pytest.mark.asyncio
async def test_redirects_are_not_followed(monkeypatch):
    seen = []

    def redirect(request):
        seen.append(str(request.url))
        return httpx.Response(302, headers={"Location": "https://boese.example.test/api/index.php/vereine/status"})

    monkeypatch.setattr(dolibarr_client, "_transport", httpx.MockTransport(redirect))
    with pytest.raises(DolibarrError):
        await client().status()
    assert all("boese" not in url for url in seen)


def test_missing_key_or_unreadable_key_is_a_clear_error():
    with pytest.raises(DolibarrError) as caught:
        DolibarrClient({"base_url": BASE_URL, "api_key": ""})
    assert caught.value.kind == "not_configured"
    with pytest.raises(DolibarrError) as caught:
        DolibarrClient({"base_url": BASE_URL, "api_key": "enc:v1:kaputt"})
    assert caught.value.kind == "key_unreadable"


# ---------------------------------------------------------------- Warum es nicht klappt (#345)

def _raising(exc_factory):
    def handler(request):
        raise exc_factory(request)
    return httpx.MockTransport(handler)


def _with_cause(cause):
    def factory(request):
        error = httpx.ConnectError(f"boom {request.url} {API_KEY}")
        error.__cause__ = cause
        return error
    return factory


@pytest.mark.asyncio
@pytest.mark.parametrize("factory, kind, calls", [
    (_with_cause(__import__("socket").gaierror(-2, "Name or service not known")), "dns", 1),
    (_with_cause(__import__("ssl").SSLCertVerificationError("certificate verify failed")), "tls", 1),
    (_with_cause(ConnectionRefusedError(111, "refused")), "refused", 1),
    (lambda request: httpx.ConnectTimeout("timed out"), "timeout", 3),
])
async def test_network_errors_say_what_is_wrong_without_leaking(monkeypatch, factory, kind, calls):
    seen = []

    def handler(request):
        seen.append(1)
        raise factory(request)

    monkeypatch.setattr(dolibarr_client, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    with pytest.raises(DolibarrError) as caught:
        await client().status()
    assert caught.value.kind == kind
    assert API_KEY not in caught.value.text and "erp.example" not in caught.value.text
    assert len(seen) == calls, "ein Tippfehler oder ein Zertifikat wird nicht dreimal versucht"


def test_a_typo_in_the_address_gets_a_useful_sentence():
    assert "Tippfehler" in DolibarrError("dns").text
    assert "Zertifikat" in DolibarrError("tls").text
    assert "API REST" in DolibarrError("api_missing").text


@pytest.mark.asyncio
async def test_404_on_the_status_path_names_the_missing_part(fake):
    fake.fail_with = 404
    with pytest.raises(DolibarrError) as caught:
        await client().status()
    assert caught.value.kind == "api_missing"

    fake.fail_with = 404
    fake.fail_paths = {"/vereine/status"}
    with pytest.raises(DolibarrError) as caught:
        await client().status()
    assert caught.value.kind == "vereine_missing", "Dolibarrs API antwortet (403), nur das Vereinsmodul nicht"

    fake.fail_with = None
    fake.fail_paths = set()
    with pytest.raises(DolibarrError) as caught:
        await client().member_summary(999)
    assert caught.value.kind == "not_found", "bei einem Mitglied bleibt 404 ein 404"


@pytest.mark.asyncio
async def test_a_redirect_is_named(monkeypatch):
    monkeypatch.setattr(dolibarr_client, "_transport", httpx.MockTransport(lambda request: httpx.Response(301, headers={"Location": "https://x.example.test/"})))
    with pytest.raises(DolibarrError) as caught:
        await client().status()
    assert caught.value.kind == "redirect"


@pytest.mark.asyncio
async def test_a_login_page_instead_of_the_api_is_named(monkeypatch):
    monkeypatch.setattr(dolibarr_client, "_transport", httpx.MockTransport(lambda request: httpx.Response(200, text="<html>Login</html>")))
    with pytest.raises(DolibarrError) as caught:
        await client().status()
    assert caught.value.kind == "invalid_response" and "Anmeldeseite" in caught.value.text
