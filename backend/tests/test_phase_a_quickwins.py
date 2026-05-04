"""Phase A — Quick wins & bug fixes.

Tests cover:
- Galerie: /api/gallery returns list (was a 404-misroute before)
- Sponsors: tier system, placement filters (home / footer / all)
- Sponsor auto-defaults: gold→home+footer, bronze→nowhere
- Profile: input_devices/main_platforms/gaming_subscriptions multi-select fields persist
- Public profile: show_twitch_embed flag is exposed
- Image migration endpoint exists and returns a summary
"""


def test_gallery_list_endpoint(api, base_url):
    r = api.get(f"{base_url}/api/gallery")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_sponsor_tier_system(admin_client, base_url):
    db_clean = admin_client.get(f"{base_url}/api/sponsors/admin").json()
    for s in db_clean:
        if s.get("name", "").startswith("PHASE_A_"):
            admin_client.delete(f"{base_url}/api/sponsors/{s['id']}")

    # Create gold (auto: home+footer=true)
    r = admin_client.post(f"{base_url}/api/sponsors", json={"name": "PHASE_A_GOLD", "tier": "gold"})
    assert r.status_code == 200
    g = r.json()
    assert g["tier"] == "gold"
    assert g["show_on_home"] is True
    assert g["show_on_footer"] is True

    # Bronze (auto: home=false, footer=false)
    r = admin_client.post(f"{base_url}/api/sponsors", json={"name": "PHASE_A_BRONZE", "tier": "bronze"})
    b = r.json()
    assert b["tier"] == "bronze"
    assert b["show_on_home"] is False
    assert b["show_on_footer"] is False

    # Silver (auto: footer only)
    r = admin_client.post(f"{base_url}/api/sponsors", json={"name": "PHASE_A_SILVER", "tier": "silver"})
    s = r.json()
    assert s["show_on_home"] is False
    assert s["show_on_footer"] is True

    # Placement filters
    home = admin_client.get(f"{base_url}/api/sponsors?placement=home").json()
    home_names = {x["name"] for x in home}
    assert "PHASE_A_GOLD" in home_names
    assert "PHASE_A_BRONZE" not in home_names
    assert "PHASE_A_SILVER" not in home_names

    footer = admin_client.get(f"{base_url}/api/sponsors?placement=footer").json()
    footer_names = {x["name"] for x in footer}
    assert "PHASE_A_GOLD" in footer_names
    assert "PHASE_A_SILVER" in footer_names
    assert "PHASE_A_BRONZE" not in footer_names

    # Patch tier from bronze → gold should update placement defaults
    r = admin_client.patch(f"{base_url}/api/sponsors/{b['id']}", json={"tier": "gold"})
    assert r.status_code == 200
    assert r.json()["show_on_home"] is True

    # Cleanup
    for sp in (g, s, b):
        admin_client.delete(f"{base_url}/api/sponsors/{sp['id']}")


def test_profile_multiselect_fields(admin_client, base_url):
    payload = {
        "input_devices": ["controller", "wheel"],
        "main_platforms": ["PC", "Switch2"],
        "gaming_subscriptions": ["nintendo_online_expansion", "xbox_game_pass"],
        "twitch_handle": "tls_test",
        "show_twitch_embed": True,
        "privacy_public_profile": True,
    }
    r = admin_client.patch(f"{base_url}/api/users/me", json=payload)
    assert r.status_code == 200
    u = r.json()
    assert u["input_devices"] == ["controller", "wheel"]
    assert u["main_platforms"] == ["PC", "Switch2"]
    assert "nintendo_online_expansion" in u["gaming_subscriptions"]
    assert u["show_twitch_embed"] is True


def test_public_profile_exposes_twitch_embed(admin_client, api, base_url):
    # Make admin profile public
    admin_client.patch(f"{base_url}/api/users/me", json={
        "privacy_public_profile": True,
        "twitch_handle": "tls_test", "show_twitch_embed": True,
    })
    r = api.get(f"{base_url}/api/users/public/admin")
    assert r.status_code == 200
    pp = r.json()
    assert pp["twitch_handle"] == "tls_test"
    assert pp["show_twitch_embed"] is True
    assert "input_devices" in pp
    assert "main_platforms" in pp


def test_image_migration_endpoint(admin_client, base_url):
    r = admin_client.post(f"{base_url}/api/uploads/migrate-external-images")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "summary" in body
    # Each target collection is reported
    for coll in ("sponsors", "news_posts", "events", "users"):
        assert coll in body["summary"]
