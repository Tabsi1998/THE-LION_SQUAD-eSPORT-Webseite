# Alte Live-Tests, zweiter Teil: Inventar (#2395)

Nach [#932](altetests-932.md) lagen noch 14 Altdateien in `backend/tests`, die per `requests` gegen einen laufenden
Server liefen (`test_iter3`–`test_iter14_*`, `test_phase1_*`, `test_live_preview_validation.py`, zusammen rund 2600
Zeilen). Die CI hat sie nie ausgeführt. Mit #2395 ist jede ihrer 165 Testfunktionen eingeordnet, die noch gültigen und
ungeprüften sind als Flow-Tests neu geschrieben, danach sind die Dateien entfallen. `LIVE_TEST_FILES` in
`backend/tests/conftest.py` ist leer; `test_live_test_files_inventory_unit.py` hält die Liste leer und schlägt an,
sobald eine Testdatei wieder `REACT_APP_BACKEND_URL` liest.

Welche Tests wo laufen und was die Kategorien bedeuten, steht in [altetests-932.md](altetests-932.md#was-wo-läuft).

## Ergebnis

Über 165 Testfunktionen: 46 × a, 46 × b, 73 × c (übernommen, einer davon vorab), kein d. Zwei c-Fälle haben einen Anteil, den nur echtes
MongoDB prüfen kann: die gleichzeitige Vergabe derselben Erfolgsstufe (eindeutiger Index, mit `init_indexes` im
Verbund) und die neuen Konten je Tag im Kasten „Wachstum“ (`$substrBytes`, das mongomock nicht kennt; dieser Teil
überspringt sich auf mongomock). Alle neuen Dateien stehen im Gebiet von `scripts/flow_mongo_tests.py` und laufen so
auch im CI-Job „Backend-Abläufe auf MongoDB“.

Die b-Fälle sind fast alle Demo-Seed (feste Turnier-IDs, Alben, Konten wie `ace_racer`), Katalogdaten statt Regeln
(Gruppennamen und Kategorien vor dem Katalog v2, #611) oder Prüfungen, die „200 oder 404“ gelten ließen. Kein
gültiger Fall ist ersatzlos weggefallen.

Neue Dateien (alle in `backend/tests/`, Kurzname in den Tabellen):
`geraete` = test_session_devices_flow.py, `schalter` = test_auth_switches_flow.py,
`erfolge` = test_achievement_ranking_legacy_flow.py, `baum` = test_match_plan_and_bracket_legacy_flow.py,
`verwaltung` = test_admin_legacy_cases_flow.py.

Jede übernommene Regel ist gegengeprüft: kurz im Produktcode gebrochen, der Test wurde rot, danach zurück.

## Befund

Kronen und Erfolge-Rangliste zählen nicht dieselben Personen: Die Rangliste lässt gesperrte und deaktivierte Konten
weg (`services/achievement_visibility.py`, `leaderboard`), die Kronen nicht (`services/crown_events.py`,
`_points_rows`). Ein gesperrtes Konto mit den meisten Punkten trägt so die Gold-Krone, steht aber auf keiner Rangliste;
die Nummer 1 der Rangliste bekommt Silber. Nicht im Produktcode geändert (Auftrag: nur Tests), eigener Punkt.

## Inventar

### test_iter14_logout_regression.py (1, vorab)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| test_logout_invalidates_me | c | test_logout_ends_session_flow.py::test_logout_ends_the_session_at_once (echte Anmelde-Prüfung: Anmelden mit Passwort, Abmelden, danach `/api/auth/me` = `null` und `/api/auth/sessions` = 401, auch mit altem Zugangs-Cookie). Die Teile davor: test_auth_security_unit.py::test_access_token_is_rejected_after_its_session_is_revoked, test_web_push_flow.py::test_abmelden_vom_konto_nimmt_die_browser_anmeldung_mit |

### test_iter3_achievements_bracket.py (16, mit Parametern 20 Fälle)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestAchievementsLeaderboard::test_leaderboard_public_and_sorted | a | test_achievement_visibility_flow.py::test_rangliste_je_kategorie_und_zeitraum |
| TestAchievementsLeaderboard::test_top1_is_ace_racer | b | Demo-Seed |
| TestAchievementsLeaderboard::test_leaderboard_limit_respected | c | erfolge |
| TestAchievementsLeaderboard::test_leaderboard_limit_capped_and_sanitised | c | erfolge |
| TestAchievementsLeaderboard::test_leaderboard_entries_have_public_profiles | c | erfolge |
| TestAchievementsCatalog::test_groups_public | a | test_achievements_v2_flow.py::test_oeffentlicher_katalog_traegt_material_alte_felder_bleiben |
| TestAchievementsCatalog::test_me_requires_auth | c | erfolge |
| TestAchievementsCatalog::test_me_returns_earned_for_demo_player | a | test_achievements_v2_flow.py::test_geheime_gruppe_erst_nach_freischaltung (Demo-Konto: b) |
| TestAchievementsCatalog::test_evaluate_converges_to_zero | c | erfolge |
| TestAchievementsCatalog::test_evaluate_requires_auth | c | erfolge |
| TestPublicBracket::test_public_bracket_by_id_and_slug | c | baum (16 Spiele des Demo-Turniers: b) |
| TestPublicBracket::test_public_bracket_unknown_id_404 | c | baum |
| TestPublicBracket::test_bracket_display_requires_auth | a | test_tv_display_flow.py::test_a_display_key_opens_the_tv_without_login_and_only_with_tv_data |
| TestPublicBracket::test_bracket_display_forbidden_for_plain_player | c | baum |
| TestPublicBracket::test_bracket_display_for_admin | c | baum |
| TestRegressionEndpoints::test_public_get_ok (5 Pfade) | b | Demo-Turnier-ID; die Routen: test_news_events_visibility_flow.py, test_tournament_legacy_cases_flow.py::test_a_draft_is_hidden_from_guests_and_open_to_the_lead |

### test_iter4_achievement_taxonomy_nav.py (14, mit Parametern 18 Fälle)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestAchievementTaxonomy::test_team_and_community_categories_exist | b | Katalog v2 (#611) ordnet die Kategorien neu; die Regel „jede Gruppe in einer bekannten Kategorie“: test_achievements_v2_flow.py::test_jede_alte_stufe_traegt_material_rang_und_level |
| TestAchievementTaxonomy::test_team_group_membership | b | `team_loyalty` entfallen, Namen geändert (Katalogdaten); Regel: dieselbe |
| TestAchievementTaxonomy::test_community_group_membership | b | `discord_active` entfallen (Katalogdaten); Regel: dieselbe |
| TestAchievementTaxonomy::test_no_team_or_community_group_left_under_club | b | Katalogdaten; Regel: dieselbe |
| TestAchievementTaxonomy::test_club_category_still_has_membership_groups | b | `event_attendance` entfallen; Vereinsgruppe: test_achievement_catalog_audit.py::test_membership_tenure_is_marked_member_only |
| TestAchievementTaxonomy::test_no_mongo_id_and_tiers_present | a | test_achievements_v2_flow.py::test_jede_alte_stufe_traegt_material_rang_und_level, ::test_oeffentlicher_katalog_traegt_material_alte_felder_bleiben |
| TestAchievementTaxonomy::test_no_emoji_in_group_or_tier_names | c | erfolge (Katalog im Code) |
| TestAchievementTaxonomy::test_catalog_overrides_module_consistent | a | test_achievements_v2_flow.py::test_jede_alte_stufe_traegt_material_rang_und_level |
| TestAchievementTaxonomy::test_me_endpoint_uses_new_categories | a | test_achievement_reach_flow.py::test_profil_bekommt_den_stand_je_kategorie_vom_server |
| TestAchievementTaxonomy::test_me_requires_auth | c | erfolge |
| TestNavAchievementsLink::test_community_has_achievements_child | a | test_nav_community_flow.py::test_default_menu_has_leaderboards_and_chats_under_community |
| TestNavAchievementsLink::test_nav_items_have_no_mongo_id | a | dieselbe |
| TestRegression::test_public_get_ok (5 Pfade) | b | Demo-Turnier-ID |
| TestRegression::test_leaderboard_top1_ace_racer | b | Demo-Seed |

### test_iter5_taxonomy_premium.py (15)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestTaxonomy::test_streaming_groups_are_content | b | `content` heißt jetzt `creator`, `stream_growth` und `streamer_path` entfallen (Katalog v2) |
| TestTaxonomy::test_progression_groups | b | `progression` heißt jetzt `profile`, Gruppen neu |
| TestTaxonomy::test_community_groups | b | Katalogdaten; Regel: test_achievements_v2_flow.py::test_jede_alte_stufe_traegt_material_rang_und_level |
| TestTaxonomy::test_club_only_membership_groups | b | Regel bewusst geändert: der Verein hat heute 14 Gruppen |
| TestTaxonomy::test_team_category | b | Katalogdaten; Regel: dieselbe |
| TestTaxonomy::test_all_categories_known | a | test_achievements_v2_flow.py::test_oeffentlicher_katalog_traegt_material_alte_felder_bleiben |
| TestTaxonomy::test_no_emoji_in_group_metadata | c | erfolge |
| TestAnonymousAccess::test_groups_public | a | dieselbe |
| TestAnonymousAccess::test_me_requires_auth | c | erfolge |
| TestAnonymousAccess::test_leaderboard_public | a | test_achievement_visibility_flow.py::test_rangliste_je_kategorie_und_zeitraum (als Gast) |
| TestBracketDisplay::test_bracket_display_returns_matches | c | baum |
| TestBracketDisplay::test_densest_round_has_six_or_more_matches | b | Größe des Demo-Turniers |
| TestBracketDisplay::test_public_bracket_by_slug | c | baum |
| TestAuthAndLevel::test_admin_achievements_me | a | test_achievements_v2_flow.py::test_geheime_gruppe_erst_nach_freischaltung |
| TestAuthAndLevel::test_public_profile_ace_racer | b | Demo-Seed; das Profil aus der Rangliste: erfolge |

### test_iter6_google_gallery.py (10, mit Parametern 11 Fälle)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestGoogleSession::test_missing_session_id | b | Google-Anmeldung läuft heute über `credential` (Google Identity Services), `session_id` gibt es nicht mehr |
| TestGoogleSession::test_bogus_session_id | c | schalter (abgelehnte Google-Kennung: 401) |
| TestGoogleSession::test_no_cookies_issued_on_failure | c | schalter |
| TestGallery::test_gallery_list | b | Demo-Alben; Liste für Gäste: test_gallery_admin_flow.py::test_guests_see_published_public_albums_with_media_only |
| TestGallery::test_album_detail (2 Alben) | b | Demo-Alben; dieselbe |
| TestGallery::test_album_images_reachable | b | externe Bilder des Demo-Seeds |
| TestGallery::test_unknown_album_404 | c | verwaltung |
| TestAchievementCatalog::test_sturmreihe_tier | b | `win_streak_p` gibt es seit Katalog A nicht mehr |
| TestAchievementCatalog::test_taxonomy_sections | b | Katalogdaten |
| TestBracket::test_bracket_loads | c | baum |

### test_iter7_fixes.py (18, mit Parametern 21 Fälle)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestGoogleSessionGuard::test_non_json_body_returns_400 | b | Der Körper ist heute ein festes Modell (`credential`); FastAPI weist kaputtes JSON mit 422 ab, kein eigener Code mehr |
| TestGoogleSessionGuard::test_malformed_json_body_returns_400 | b | dito |
| TestGoogleSessionGuard::test_empty_body_returns_400 | b | dito |
| TestGoogleSessionGuard::test_json_array_body_returns_400 | b | dito |
| TestGoogleSessionGuard::test_empty_dict_returns_400 | b | `session_id` entfallen |
| TestGoogleSessionGuard::test_bogus_session_id_returns_401 | c | schalter |
| TestGoogleSessionGuard::test_no_cookie_on_failure | c | schalter |
| TestGalleryReseed::test_overview_has_two_albums | b | Demo-Alben |
| TestGalleryReseed::test_album_has_six_distinct_photos (2) | b | Demo-Alben |
| TestGalleryReseed::test_no_fabricated_dimensions (2) | b | Demo-Alben |
| TestGalleryReseed::test_no_image_shared_across_albums | b | Demo-Alben, war schon `xfail` |
| TestGalleryReseed::test_all_images_reachable (2) | b | externe Bilder |
| TestGalleryReseed::test_unknown_album_404 | c | verwaltung |
| TestBracketDisplay::test_bracket_display_ok | c | baum |
| TestBracketDisplay::test_bracket_display_requires_auth | a | test_tv_display_flow.py::test_a_display_key_opens_the_tv_without_login_and_only_with_tv_data |
| TestBracketDisplay::test_densest_column_match_count | b | Größe des Demo-Turniers |
| TestAchievementsTaxonomy::test_catalog_taxonomy | b | Gruppennamen vor Katalog v2 |
| TestAchievementsTaxonomy::test_tier_points_present | a | test_achievement_catalog_audit.py::test_katalog_a_ziele_steigen_material_passt_zur_leiter_texte_da |

### test_iter10_auth_settings.py (13)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestAuthSettingsEndpoint::test_get_requires_admin | c | schalter |
| TestAuthSettingsEndpoint::test_get_returns_four_booleans | c | schalter |
| TestAuthSettingsEndpoint::test_put_persists_and_public_reflects | c | schalter |
| TestAuthSettingsEndpoint::test_put_requires_csrf | a | test_auth_security_unit.py::test_csrf_checks_origin_fetch_metadata_and_refresh_token_pair |
| TestEnforcement::test_registration_disabled_blocks_register | c | schalter |
| TestEnforcement::test_google_login_disabled_blocks_session | c | schalter |
| TestGoogleLinkGuards::test_link_requires_auth | c | schalter |
| TestGoogleLinkGuards::test_link_empty_body_returns_400 | b | `session_id` entfallen (heute `credential`) |
| TestGoogleLinkGuards::test_link_disabled_returns_403 | c | schalter |
| TestGoogleLinkGuards::test_unlink_local_account_ok | c | schalter (dazu: ein reines Google-Konto kann nicht trennen) |
| TestGoogleLinkGuards::test_unlink_requires_auth | c | schalter |
| test_public_settings_contains_all_flags | c | schalter |
| test_final_state_all_true | b | stellte nur den Server-Stand der anderen Fälle zurück |

### test_iter11_refresh_race.py (12)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestLoginPersists::test_login_then_me_returns_user | a | test_logout_ends_session_flow.py::test_logout_ends_the_session_at_once |
| TestLoginPersists::test_sequential_refresh_keeps_session | a | test_login_comfort_flow.py::test_remember_me_keeps_the_session_for_90_days_and_renews_it |
| TestLoginPersists::test_admin_login_and_me | b | Konto aus dem Seed |
| TestConcurrentRefresh::test_two_parallel_refreshes_both_succeed_and_session_survives | a | test_auth_security_unit.py::test_parallel_refresh_replays_return_one_deterministic_successor |
| TestConcurrentRefresh::test_five_parallel_refreshes_all_succeed | a | dieselbe |
| TestConcurrentRefresh::test_old_token_replay_after_grace_is_rejected_and_family_revoked | c | geraete |
| TestRefreshSecurity::test_garbage_refresh_token_rejected | c | geraete |
| TestRefreshSecurity::test_forged_refresh_token_rejected | c | geraete |
| TestRefreshSecurity::test_no_refresh_cookie_returns_401 | c | geraete |
| TestRefreshSecurity::test_refresh_requires_csrf_header | c | geraete |
| TestRefreshSecurity::test_me_without_cookies_is_guest | a | test_logout_ends_session_flow.py::test_logout_ends_the_session_at_once |
| TestRefreshSecurity::test_logout_revokes_session | a | dieselbe |

### test_iter12_sessions_growth.py (17)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestSessionsList::test_me_after_login | a | test_logout_ends_session_flow.py::test_logout_ends_the_session_at_once |
| TestSessionsList::test_sessions_list_has_current | c | geraete |
| TestSessionsList::test_second_login_appears_as_extra_session | c | geraete |
| TestSessionsList::test_sessions_requires_auth | c | geraete |
| TestRefreshRegression::test_two_parallel_refresh_same_ua | a | test_auth_security_unit.py::test_parallel_refresh_replays_return_one_deterministic_successor |
| TestRefreshRegression::test_five_parallel_refresh_same_ua | a | dieselbe |
| TestRefreshRegression::test_replay_with_different_ua_is_theft | a | test_auth_security_unit.py::test_refresh_reuse_outside_the_same_client_grace_revokes_only_that_family, test_mobile_sessions_flow.py::test_the_same_device_may_repeat_a_rotation_within_a_minute_but_a_stranger_may_not |
| TestRefreshRegression::test_old_access_token_survives_rotation | c | geraete |
| TestSessionRevocation::test_logout_kills_access_token_immediately | a | test_logout_ends_session_flow.py::test_logout_ends_the_session_at_once |
| TestSessionRevocation::test_logout_all_keeps_current_kills_others | c | geraete |
| TestSessionRevocation::test_single_session_revoke | c | geraete |
| TestSessionRevocation::test_revoke_unknown_session_404 | c | geraete |
| TestSessionRevocation::test_revoke_other_users_session_404 | c | geraete |
| TestGrowthStats::test_growth_stats_admin | c | verwaltung (neue Konten je Tag nur auf echtem MongoDB) |
| TestGrowthStats::test_growth_stats_clamped | c | verwaltung |
| TestGrowthStats::test_growth_stats_requires_admin | a | test_admin_growth_members_flow.py::test_only_club_administration_and_system_see_the_growth_box |
| TestVideoUpload::test_video_upload_and_fetch | c | verwaltung |

### test_iter13_crowns.py (9)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestCrowns::test_crowns_public_no_auth | c | erfolge |
| TestCrowns::test_crowns_match_top3_of_leaderboard | c | erfolge |
| TestCrowns::test_no_crowns_outside_top3_unless_onyx | c | erfolge |
| TestCrowns::test_crown_variants_valid | c | erfolge, dazu test_crown_onyx_unit.py::test_onyx_crown_for_level_30_and_podium_for_the_rest |
| TestCrowns::test_crowns_stable_across_calls | c | erfolge |
| TestRegression::test_leaderboard_shape | a | test_achievement_visibility_flow.py::test_rangliste_je_kategorie_und_zeitraum |
| TestRegression::test_leaderboard_limit | c | erfolge |
| TestRegression::test_public_list | a | Liste: test_public_profile_fields_flow.py::test_lists_follow_the_privacy_levels_and_never_show_the_internal_role; Level in der Spielerliste: test_achievement_ranking_legacy_flow.py::test_the_leaderboard_lists_public_profiles_ranked_and_never_more_than_100 (nach der Prüfung ergänzt) |
| TestRegression::test_public_profile_top_players | c | erfolge |

### test_iter14_team_levels_crowns.py (9)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestTeamLevels::test_levels_all_teams | c | erfolge |
| TestTeamLevels::test_level_detail_matches_summary | c | erfolge |
| TestTeamLevels::test_level_detail_unknown_team_404 | a | test_team_visibility_flow.py::test_level_of_a_team_that_is_gone_is_404_even_from_the_cache |
| TestTeamLevels::test_levels_route_precedence | a | test_team_visibility_flow.py::test_only_the_lead_switches_and_private_means_hidden |
| TestCrownsRegression::test_crowns_shape | c | erfolge |
| TestCrownsRegression::test_leaderboard_ok | a | test_achievement_visibility_flow.py::test_rangliste_je_kategorie_und_zeitraum |
| TestCrownTransition::test_transition_creates_exactly_one_pair_each_way | a | test_profile_public_data_flow.py::test_switching_achievements_back_and_forth_does_not_flood_with_crown_notices, test_achievement_switch_flow.py::test_crown_messages_follow_the_achievements_switch |
| TestCrownTransition::test_temp_tier_cleaned_up | b | räumte nur die Probe-Stufe weg |
| TestConcurrentEvaluate::test_parallel_evaluate_and_profile_completeness | c | erfolge (zwei gleichzeitige Vergaben derselben Stufe; auf echtem MongoDB mit dem eindeutigen Index) |

### test_live_preview_validation.py (15, mit Parametern 30 Fälle)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestPublicEndpoints::test_public_list (7 Pfade) | b | Mindestmengen des Demo-Seeds |
| TestPublicEndpoints::test_home_state | a | test_home_numbers_flow.py::test_club_numbers_count_only_public_and_real_things |
| TestPublicEndpoints::test_nav | a | test_nav_community_flow.py::test_default_menu_has_leaderboards_and_chats_under_community |
| TestPublicEndpoints::test_settings_public | a | test_settings_legacy_cases_flow.py::test_public_settings_have_defaults_and_show_a_new_tagline_with_one_audit_row |
| TestPublicEndpoints::test_tournament_detail | a | test_tournament_legacy_cases_flow.py::test_a_draft_is_hidden_from_guests_and_open_to_the_lead |
| TestPublicEndpoints::test_tournament_bracket_and_standings | b | ließ 200 oder 404 gelten, prüfte nichts |
| TestPublicEndpoints::test_unknown_tournament_404 | c | baum |
| TestAuthFlow::test_login_sets_cookies | a | test_logout_ends_session_flow.py::test_logout_ends_the_session_at_once |
| TestAuthFlow::test_login_wrong_password | a | test_password_contract_flow.py::test_failed_sign_in_changes_nothing |
| TestAuthFlow::test_me_unauthenticated | a | test_logout_ends_session_flow.py::test_logout_ends_the_session_at_once |
| TestAuthFlow::test_csrf_rejects_missing_header | a | test_auth_security_unit.py::test_csrf_checks_origin_fetch_metadata_and_refresh_token_pair |
| TestAuthFlow::test_cross_site_origin_rejected_at_origin_server | a | test_auth_security_unit.py::test_cross_site_login_is_rejected_even_when_path_is_csrf_exempt |
| TestAdminEndpoints::test_admin_get (10 Pfade) | b | ließ 200 oder 404 gelten |
| TestAdminEndpoints::test_admin_requires_auth | a | test_my_duty_flow.py::test_dashboard_gives_each_area_only_its_own_blocks (403 je Rolle, Gast 401 nach der Prüfung ergänzt) |
| TestAdminEndpoints::test_news_create_update_delete | a | test_news_editorial_flow.py::test_edits_record_who_changed_what_and_show_a_history, ::test_drafts_that_never_went_out_can_still_be_deleted |

### test_phase1_unified_match.py (11, mit Parametern 16 Fälle)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestAuthAndNotifications::test_login_and_me | b | Konto aus dem Seed |
| TestAuthAndNotifications::test_notifications_me_returns_200 | c | verwaltung (die Glocke: nur eigene, sichtbare Meldungen) |
| TestUnifiedMatchWritePath::test_bracket_has_16_matches | b | Demo-Seed |
| TestUnifiedMatchWritePath::test_unified_patch_result_advances_winner | b | schrieb Ergebnisse per PATCH in den klassischen Speicher, den es seit #231 nicht mehr gibt; Ergebnis und Weiterrücken: test_result_contract_flow.py::test_a_correction_after_the_follow_up_was_played_resets_it_and_keeps_the_history |
| TestUnifiedMatchWritePath::test_unified_patch_schedule | c | baum |
| TestUnifiedMatchWritePath::test_unified_patch_rejects_invalid_winner | b | PATCH nimmt kein Ergebnis mehr an (die Felder bleiben wirkungslos: baum); ungültige Ergebnisse: test_result_contract_flow.py::test_values_outside_the_contract_are_refused_on_every_entry_path |
| TestUnifiedMatchWritePath::test_unified_patch_unknown_match_404 | c | baum |
| TestUnifiedMatchWritePath::test_unified_write_requires_auth | c | baum |
| TestUnifiedV2Path::test_v2_schedule_through_unified_route | c | baum |
| TestUnifiedV2Path::test_v2_result_fields_ignored_on_patch | c | baum |
| TestPublicRegression::test_public_get (6 Pfade) | b | Demo-Turnier-ID |

### test_phase1_v2_unified_seeded.py (5)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestUnifiedV2Branch::test_v2_schedule_patch_via_unified_route | c | baum |
| TestUnifiedV2Branch::test_v2_idempotent_replay | c | baum |
| TestUnifiedV2Branch::test_v2_result_fields_stripped | c | baum |
| TestUnifiedV2Branch::test_v2_get_match_via_unified_route | c | baum |
| TestUnifiedV2Branch::test_legacy_result_form_rejected_for_v2 | a | test_result_contract_flow.py::test_values_outside_the_contract_are_refused_on_every_entry_path |
