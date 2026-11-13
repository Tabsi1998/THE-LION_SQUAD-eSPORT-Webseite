# Alte Live-Tests: Inventar und Testauswahl (#932)

Bis November 2026 lagen in `backend/tests` 20 Dateien aus der Zeit des früheren Anbieters
(`test_phase*`, `test_iter20_*`, `test_tls_arena_api.py`), die per `requests` gegen einen laufenden
Server liefen. Die CI hat sie nie ausgeführt. Mit #932 ist jeder ihrer 309 Testfälle eingeordnet,
die noch gültigen und ungeprüften sind als Flow-Tests neu geschrieben, danach sind die Dateien
entfallen.

## Was wo läuft

| Verbund | Was | Wo |
|---|---|---|
| Unit- und Flow-Tests | `python -m pytest -m "not live"`: Unit-Tests und Flow-Tests, also die echte App per ASGI gegen mongomock (`backend/tests/flow_harness.py`). Keine Dienste, keine Zugänge. | lokal und in der CI (Job „Backend“, drei Teile) |
| Echtes MongoDB | Dieselben Flow-Tests eines Gebiets gegen einen echten Server mit echten Indizes und Transaktionen: `FLOW_MONGO_URL=… python scripts/flow_mongo_tests.py`. Das Gebiet steht in `AREA` im Skript; `--all` nimmt jede Flow-Datei. | CI-Job mit MongoDB-Dienst; lokal mit eigenem Container ([Abnahme lokal](abnahme-lokal.md)) |
| Live-Tests | Die 14 verbliebenen Altdateien in `LIVE_TEST_FILES` (`backend/tests/conftest.py`). Sie brauchen `REACT_APP_BACKEND_URL`, `TEST_ADMIN_EMAIL` und `TEST_ADMIN_PASSWORD`; ohne diese überspringen sie sich. Schreibend nur gegen einen dafür vorbereiteten Teststack, nie gegen die Produktion. | nie in der CI (`-m "not live"`) |

Neue Tests sind Flow- oder Unit-Tests. `test_live_test_files_inventory_unit.py` hält `LIVE_TEST_FILES`
deckungsgleich mit den Dateien, die `REACT_APP_BACKEND_URL` lesen, und lässt die Liste nur schrumpfen.

**Nicht in #932:** die 14 übrigen Altdateien (`test_iter3`–`test_iter14_*`, `test_phase1_*`,
`test_live_preview_validation.py`). Sie überspringen sich ohne Server schon beim Import und standen
nicht in der Liste von #932. Für sie gilt dasselbe Vorgehen.

## Einordnung

- **a** – ein heutiger Test prüft dasselbe (Beleg: Datei::Test)
- **b** – veraltet: Route oder Funktion gibt es nicht mehr, nur alter Demo-Seed, oder die Regel wurde bewusst geändert
- **c** – eigener, lokal prüfbarer Fachfall: jetzt als Flow-Test (Spalte „neu in“)
- **d** – echter Integrationstest (Index, Transaktion, Drittanbieter): kein reiner Fall. Der Index-Anteil der
  Einladung (eindeutiges `audit_logs.id`) läuft über `test_admin_user_invite_flow.py` im echten MongoDB-Verbund.

Ergebnis über 309 Testfunktionen: 112 × a, 66 × b, 129 × c (übernommen), 2 gemischt (a/b bzw. a/c).
Kein gültiger Fall ist ersatzlos weggefallen; wo ein b-Fall noch einen gültigen, ungeprüften Kern hatte,
steht er ebenfalls als Flow-Test (Spalte „neu in“). Kein übernommener Fall zeigte einen Produktfehler.

Neue Dateien (alle in `backend/tests/`, Kurzname in den Tabellen):
`team` = test_team_leadership_edges_flow.py, `sponsor` = test_sponsor_tiers_flow.py,
`settings` = test_settings_legacy_cases_flow.py, `invite` = test_admin_user_invite_flow.py,
`fastlap` = test_fastlap_legacy_cases_flow.py, `tournament` = test_tournament_legacy_cases_flow.py,
`season` = test_season_legacy_cases_flow.py, `prize` = test_prize_lists_flow.py,
`news` = test_news_events_visibility_flow.py, `gallery` = test_gallery_admin_flow.py,
`upload` = test_upload_legacy_cases_flow.py, `documents` = test_documents_visibility_flow.py,
`achievements` = test_achievement_admin_edges_flow.py, `membership` = test_membership_admin_edges_flow.py,
`profile` = test_profile_fields_legacy_flow.py, `media` = test_admin_media_nav_rights_flow.py,
`removed` = test_removed_routes_unit.py.

### test_tls_arena_api.py (23)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestAuth::test_register_login_me_logout | b | Registrierung verlangt `accept_terms` und liefert nur `verification_required` |
| TestAuth::test_admin_login_returns_superadmin | b | Konto aus Umgebung/Seed |
| TestAuth::test_demo_player_login | b | Demo-Seed |
| TestAuth::test_login_wrong_password | a | test_password_contract_flow.py::test_failed_sign_in_changes_nothing |
| TestGames::test_list_games_returns_six | b | Demo-Seed |
| TestGames::test_create_game_unauthenticated_401 | c | tournament |
| TestGames::test_create_game_player_403 | c | tournament |
| TestGames::test_create_game_superadmin_201 | a | test_game_archive_flow.py::test_an_unused_game_can_be_deleted_with_its_default_pool |
| TestTournaments::test_list_tournaments | b | Demo-Seed |
| TestTournaments::test_get_mario_kart_with_participants | b | Demo-Seed |
| TestTournaments::test_generate_bracket_single_elim_16 | b | Seed-Turnier; Regel in test_bracket_generator_sim_unit.py::test_single_elimination_plays_through_for_every_size |
| TestTournaments::test_register_and_checkin | b | Seed-Turnier, Anmeldung braucht heute Regeln/Datenschutz |
| TestF1::test_list_challenges | b | Demo-Seed |
| TestF1::test_leaderboard_auto_picks_track_sorted | c | fastlap |
| TestF1::test_leaderboard_with_slug_404 | b | prüfte nichts; Slug-Abruf ist behoben |
| TestF1::test_championship_standings | a | test_fastlap_ranking_flow.py::test_championship |
| TestF1::test_export_csv | b | Export braucht heute den Bereich Turniere; Inhalt: test_fastlap_lock_audit_flow.py::test_the_export_writes_names_as_text |
| TestF1::test_admin_add_lap_time_resorts | c | fastlap |
| TestAdmin::test_dashboard | b | Demo-Seed-Zahlen |
| TestAdmin::test_dashboard_player_403 | a | test_my_duty_flow.py::test_dashboard_gives_each_area_only_its_own_blocks |
| TestUsers::test_patch_me_display_name | a | test_profile_public_data_flow.py::test_new_profile_texts_have_limits_and_a_name_stays_filled |
| TestUsers::test_patch_other_user_forbidden | a | test_admin_profile_reset_flow.py::test_players_and_unknown_accounts |
| TestBruteForce::test_brute_force_lockout_eventual | a | test_login_ip_limit_settings_flow.py::test_account_protection_is_unchanged_by_a_high_address_limit |

### test_iter20_bug_hunt.py (28 Funktionen, mit Parametern 43 Fälle)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestSanity::test_admin_login | a | test_account_sign_in_contract_flow.py::test_the_right_password_still_signs_in_and_names_an_open_invitation |
| TestSanity::test_admin_me | a | test_permissions_flow.py::test_a_grant_opens_exactly_one_area |
| TestTeamSystem::test_team_create_fields | c | team |
| TestTeamSystem::test_team_update_roundtrip | a | test_team_labels_flow.py::test_limits_when_changing_and_old_values_stay_editable |
| TestTeamSystem::test_team_add_member_via_join_code | a | test_team_changes_notify_flow.py::test_kick_leave_and_join_tell_people_and_stay_in_the_log |
| TestTeamSystem::test_team_squad_create_and_update | a | test_squad_roles_flow.py::test_squads_without_roles_keep_working_as_before |
| TestTeamSystem::test_team_roster_role_change_endpoint_presence | a | test_team_member_joined_at_flow.py::test_rolle_setzen_legt_die_zeile_mit_dem_gruendungsdatum_an |
| TestTeamSystem::test_team_remove_member_endpoint_presence | a | test_admin_second_factor_flow.py::test_club_admin_team_actions_need_the_second_factor |
| TestSaveRoundtrip::test_news_update_roundtrip | b | Schema geändert (`body_md`, `is_published` gibt es nicht mehr) |
| TestSaveRoundtrip::test_tournament_update_roundtrip | b | Feld heißt `title` |
| TestSaveRoundtrip::test_events_update_roundtrip | b | Event verlangt `name` |
| TestSaveRoundtrip::test_cms_page_update_roundtrip | b | `/api/cms` gibt es nicht |
| TestSaveRoundtrip::test_branding_update_roundtrip | c | settings |
| TestSponsorTiers (6 Tests) | c | sponsor |
| TestBrandingSocials::test_branding_contains_all_socials | c | settings |
| TestMediaPerformance::test_admin_media_list_latency | a | test_media_library_flow.py::test_all_files_are_counted_and_reachable_page_by_page (Latenz gegen Live-Daten nicht übertragbar) |
| TestMediaPerformance::test_admin_media_delete_latency | a | test_media_usage_flow.py::test_a_file_shown_only_outside_the_known_places_needs_confirmation |
| TestLevelAndAchievements::test_me_has_level_fields | a | test_fastlap_ranking_flow.py::test_profile_podium_counts_fastlap_places |
| TestLevelAndAchievements::test_leaderboard | b | `/api/scoring/leaderboard` gibt es nicht |
| TestLevelAndAchievements::test_achievements_listing | b | keine Route `/api/achievements` ohne Pfad |
| TestEmailTemplates::test_templates_no_arena_wording | b | `/api/cms/templates` gibt es nicht |
| TestAdminInvite::test_admin_invite_user | c | invite |
| TestNo500Scan::test_no_5xx (16 Pfade) | a/b | b: `/api/cms/pages`, `/api/cms/templates`, `/api/badges`, `/api/scoring/leaderboard`, `/api/achievements`; a: die übrigen Listen je mit Flow-GET (Teams, News, Events, Turniere, Spiele, Sponsoren, Mediathek, Mitgliedschaft), Branding: settings |

### test_iter20_bugfixes.py (5) und test_iter20_edge_cases.py (8)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| bugfixes::test_branding_get_returns_all_socials | c | settings |
| bugfixes::test_admin_user_invite_no_duplicate_key | c/d | invite (Index-Anteil im echten MongoDB-Verbund) |
| bugfixes::test_team_kick_role_transfer_full_flow | c | team |
| bugfixes::test_team_kick_anon_blocked | c | team |
| bugfixes::test_team_kick_leader_rejected | a | test_team_changes_notify_flow.py::test_messages_use_plain_words |
| edge::test_kick_self_rejected | c | team |
| edge::test_kick_leader_rejected | a | test_team_changes_notify_flow.py::test_messages_use_plain_words |
| edge::test_non_leader_role_change_forbidden | a | test_team_admin_grant_flow.py::test_dissolving_and_changing_roles_stay_out_of_reach |
| edge::test_invalid_role_value_rejected | a | test_team_changes_notify_flow.py::test_messages_use_plain_words |
| edge::test_transfer_to_non_member_404 | c | team |
| edge::test_transfer_to_current_leader_rejected | c | team |
| edge::test_admin_audit_paths_no_500 | a/c | Sperren: test_moderator_scope_flow.py::test_only_the_superadmin_bans_accounts_with_an_admin_area; Rolle: test_users_sheet_flow.py::test_only_the_superadmin_changes_roles_and_grants; Löschen: invite |
| edge::test_branding_specific_default_urls | c | settings |

### test_phase2_3.py (21)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestSettings::test_public_settings | c | settings |
| TestSettings::test_email_settings_admin_only | c | settings |
| TestSettings::test_branding_update_creates_audit | c | settings |
| TestSeasons::test_create_list_delete_season | c | season |
| TestWidgets::test_tournament_bracket_widget_no_sensitive_fields | c | tournament |
| TestWidgets::test_f1_leaderboard_widget | c | fastlap |
| TestDSGVO::test_export_my_data_shape | a | test_account_erasure_flow.py::test_the_export_names_everything_and_deleting_leaves_no_personal_copy |
| TestDSGVO::test_export_requires_auth | c | settings |
| TestAudit::test_audit_admin_only | c | settings |
| TestPDFExports::test_participants_pdf | a | test_league_conflict_flow.py::test_tournament_lead_keeps_everything_in_normal_tournaments, test_pdf_exports_unit.py::test_table_exports_generate_valid_pdfs |
| TestPDFExports::test_checkin_pdf | c | tournament |
| TestPDFExports::test_matches_pdf | c | tournament |
| TestPDFExports::test_station_signs_pdf | c | tournament |
| TestPDFExports::test_station_signs_pdf_landscape | c | tournament |
| TestPDFExports::test_standings_pdf | c | tournament (dazu: Gast vor Turnierende 403) |
| TestPDFExports::test_f1_leaderboard_pdf | a | test_fastlap_event_flow.py::test_after_publishing_certificates_go_to_the_person_and_the_lead_only |
| TestStations::test_list_stations_admin | a | test_station_list_view_flow.py::test_leads_see_everything_as_before_and_staff_their_tournament |
| TestStations::test_create_update_delete_station | a | test_station_delete_flow.py::test_a_station_without_matches_is_deleted, test_station_edit_flow.py::test_the_running_status_is_not_part_of_the_edit_log |
| TestF1TimePatch::test_patch_time_sets_invalid_and_proof | c | fastlap |
| TestSwissGroups::test_swiss_next_round_rejects_non_swiss | c | tournament |
| TestSwissGroups::test_groups_generate_rejects_non_groups | c | tournament |

### test_phase3.py (10)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestSponsors::test_sponsors_seed_three | b | Demo-Seed |
| TestFeaturedSeason::test_featured_active_season | b | Seed-Slug; Regel „höchstens 5“: season |
| TestFeaturedSeason::test_featured_standings_shape | c | season |
| TestDiscordSettings::test_discord_get_requires_admin | a | test_discord_targets_flow.py::test_settings_are_admin_only_validated_and_never_carry_the_token |
| TestDiscordSettings::test_discord_get_admin | a | dieselbe, dazu ::test_old_webhook_fields_are_removed_by_the_migration |
| TestDiscordSettings::test_discord_put_persists_and_audits | c | settings |
| TestDiscordSettings::test_discord_rejects_invalid_channel_id | a | test_discord_targets_flow.py::test_settings_are_admin_only_validated_and_never_carry_the_token |
| TestDiscordSettings::test_discord_can_clear_channel | c | settings |
| TestDiscordSettings::test_discord_test_says_why_nothing_is_sent | a | test_discord_targets_flow.py::test_settings_are_admin_only_validated_and_never_carry_the_token |
| TestDiscordSettings::test_discord_test_requires_admin | c | settings |

### test_phase3_news_events_gallery.py (38, überspringt sich ohne Server beim Import)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestMeta::test_news_meta | a | test_news_page_flow.py::test_news_meta_counts_only_categories_with_visible_articles_per_viewer |
| TestMeta::test_events_meta | a | test_event_program_flow.py::test_visibility_words_for_the_list |
| TestNews::test_admin_create_full | a | test_news_editorial_flow.py::test_edits_record_who_changed_what_and_show_a_history |
| TestNews::test_public_list_only_published_public_pinned_first | c | news |
| TestNews::test_community_user_sees_public_and_community | c | news |
| TestNews::test_filter_by_category | c | news |
| TestNews::test_get_by_slug_resolves_links | b | verknüpfte Entwürfe sieht nur die Redaktion; Positivfall: test_news_page_flow.py::test_linked_events_carry_their_signup_state |
| TestNews::test_members_visibility_anon_403 | c | news |
| TestNews::test_members_visibility_member_ok | a | test_member_area_flow.py::test_internal_news_and_board_by_area_not_by_role |
| TestNews::test_patch_news | a | test_news_editorial_flow.py::test_author_can_be_changed_to_an_account_of_the_newsroom |
| TestNews::test_cu_cannot_create_news | c | news |
| TestNews::test_admin_news_includes_drafts | c | news |
| TestNews::test_anon_news_excludes_drafts | a | test_news_editorial_flow.py::test_public_lists_hide_drafts_and_scheduled_posts_from_admins_too |
| TestNews::test_delete_news | b | veröffentlichte News werden zurückgezogen statt gelöscht: test_news_editorial_flow.py::test_published_posts_are_withdrawn_not_deleted_and_links_show_a_hint |
| TestEvents::test_create_lan_party | a | test_event_facts_flow.py::test_bring_along_and_highlights_are_saved_with_limits |
| TestEvents::test_list_events_anon_no_drafts | c | news |
| TestEvents::test_list_events_admin_includes_drafts | b | öffentliche Liste zeigt Entwürfe bewusst auch der Leitung nicht (Verwaltung: `include_drafts`) |
| TestEvents::test_upcoming_filter | c | news |
| TestEvents::test_filter_by_event_type | c | news |
| TestEvents::test_get_by_slug_attaches_relations | a | test_event_public_fields_flow.py::test_gast_sieht_keine_internen_felder_an_turnieren_und_fast_laps |
| TestEvents::test_draft_event_anon_404 | c | news |
| TestEvents::test_draft_event_admin_200 | a | test_tournament_staff_rights_flow.py::test_events_and_fast_laps_follow_the_same_rule |
| TestEvents::test_members_event_anon_403 | c | news |
| TestEvents::test_patch_event_status_location_program | a | test_event_cancel_delete_flow.py::test_max_participants_can_be_cleared_and_must_be_positive |
| TestEvents::test_delete_event | a | test_event_cancel_delete_flow.py::test_deleting_a_cancelled_event_removes_it_with_a_log |
| TestEvents::test_cu_cannot_create_event | c | news |
| TestGallery::test_create_album | c | gallery |
| TestGallery::test_public_album_list_with_photo_count | c | gallery |
| TestGallery::test_album_detail_with_photos_and_event | a | test_event_photos_flow.py::test_album_shows_its_event |
| TestGallery::test_member_album_anon_403 | c | gallery |
| TestGallery::test_patch_album_title | c | gallery |
| TestGallery::test_patch_photo_caption | c | gallery |
| TestGallery::test_delete_photo | c | gallery |
| TestGallery::test_admin_gallery_includes_unpublished | c | gallery |
| TestGallery::test_delete_album_cascades_photos | a | test_gallery_bulk_flow.py::test_deleting_an_album_keeps_the_files_as_the_dialog_says |
| TestGallery::test_album_accepts_external_video_media | c | gallery |
| TestGallery::test_album_sections_order_and_media_assignment | c | gallery |
| TestGallery::test_cu_cannot_create_album | c | gallery |

### test_phase4_documents.py (26)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestDocumentsMeta::test_meta_categories_visibilities | b | Sichtbarkeiten bewusst auf members/internal reduziert: test_document_meta_words_flow.py::test_visibility_labels_match_the_badge_and_keep_their_values |
| TestUploads::test_upload_txt_admin | b | Dokumente liegen privat, keine öffentliche URL mehr |
| TestUploads::test_upload_pdf_admin | c | upload |
| TestUploads::test_upload_disallowed_exe | c | upload |
| TestUploads::test_upload_disallowed_sh | c | upload |
| TestUploads::test_upload_community_user_403 | c | upload |
| TestDocumentsCRUDVisibility::test_create_basics | c | documents |
| …::test_anonymous_cannot_see_members_doc | c | documents |
| …::test_community_user_cannot_see_members_doc | a | test_roles_two_flow.py::test_member_content_needs_a_membership_or_the_club_area |
| …::test_admin_sees_all_docs | c | documents |
| …::test_active_member_sees_members_doc | a | test_roles_two_flow.py::test_member_content_needs_a_membership_or_the_club_area |
| …::test_active_member_does_not_see_internal_doc | c | documents |
| …::test_filter_by_category | c | documents |
| …::test_admin_listing | c | documents |
| …::test_patch_update | c | documents |
| …::test_patch_404 | c | documents |
| …::test_delete_404 | a | test_penalties_documents_gaps_flow.py::test_create_update_delete_are_logged_and_delete_takes_the_file |
| …::test_delete_doc | a | dieselbe |
| TestAuthorisation::test_create_cu_403 | c | documents |
| TestAuthorisation::test_patch_cu_403 | c | documents |
| TestAuthorisation::test_delete_cu_403 | a | test_penalties_documents_gaps_flow.py::test_only_the_club_area_changes_documents |
| TestAuthorisation::test_admin_listing_cu_403 | c | documents |
| TestMembersNewsVisibility::test_anon_does_not_see_members_news | c | news |
| TestMembersNewsVisibility::test_active_member_sees_members_news | a | test_roles_two_flow.py::test_member_content_needs_a_membership_or_the_club_area |
| TestMembershipMeHistory::test_member_me_has_history | b | `actor_id` bewusst ausgeblendet: test_dolibarr_flow.py::test_internal_notes_stay_internal |
| TestMemberAreaAggregate::test_member_can_load_all_member_data | a | test_membership_gaps_flow.py::test_benefits_respect_their_days |


### test_phase4_features.py (8)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestSeededEvents::test_tournaments_contain_real_events | b | Seed-Slugs gibt es nicht mehr |
| TestSeededEvents::test_f1_challenges_contain_real_events | b | dito |
| TestPublicSettings::test_public_settings_has_discord_twitch_defaults | c | settings |
| TestTournamentCreateNewFields::test_create_tournament_with_prize_and_twitch | c | tournament |
| TestF1CreateNewFields::test_create_f1_with_prize_and_twitch | c | fastlap |
| TestPDFExports::test_f1_leaderboard_pdf | a | test_fastlap_event_flow.py::test_after_publishing_certificates_go_to_the_person_and_the_lead_only |
| TestPDFExports::test_f1_championship_pdf_for_any_challenge | c | fastlap |
| TestDiscordTriggers::test_set_status_does_not_crash_when_webhook_not_configured | a | test_checkin_end_flow.py::test_opening_the_check_in_does_not_fix_the_bracket_yet |

### test_phase5_badges.py (11, dito)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestBadges::test_list_badges_22 | b | `/api/badges` gibt es nicht mehr (Nachfolger `/api/achievements`); jetzt in removed |
| TestBadges::test_get_first_win_badge | b | dito |
| TestPublicProfile::test_get_pixelhawk_profile | b | Demo-Seed |
| TestPublicProfile::test_get_nonexistent_user | a | test_profile_public_data_flow.py::test_old_names_stay_reachable_in_every_spelling |
| TestUpload::test_upload_requires_auth | c | upload |
| TestUpload::test_upload_png_and_serve | c | upload |
| TestUpload::test_upload_rejects_bad_mime | c | upload |
| TestSponsorsCRUD::test_create_patch_delete | a | test_content_archive_flow.py::test_sponsor_is_archived_while_used_and_deleted_when_not |
| TestSponsorsCRUD::test_sponsor_create_requires_admin | c | sponsor |
| TestBadgeTriggers::test_first_tournament_badge_idempotent | b | Code `first_tournament` gibt es nicht mehr |
| TestBadgeTriggers::test_first_lap_badge | b | Code `first_lap` gibt es nicht mehr |

### test_phase567.py (19)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestHomeState::test_home_state_anon_structure | a | test_home_live_banner_flow.py::test_a_tournament_past_its_end_leaves_the_banner_although_the_status_is_still_live |
| TestHomeState::test_home_state_hides_drafts | c | tournament |
| TestHomeState::test_home_state_live_tournament_shows | a | dieselbe |
| TestTournamentStatus::test_create_scheduled_is_actually_draft | b | Anlegen übernimmt heute den Status bewusst |
| TestTournamentStatus::test_set_status_to_scheduled | c | tournament |
| TestTournamentStatus::test_set_status_invalid | c | tournament |
| TestTournamentStatus::test_list_hides_drafts_for_anon | a | test_tournament_list_groups_flow.py::test_status_groups_finished_and_running |
| TestTournamentStatus::test_get_draft_anon_404 | c | tournament |
| TestTournamentStatus::test_get_draft_admin_200 | c | tournament |
| TestTournamentStatus::test_create_stream_fields_ignored | b | prüfte nichts; Stream-Felder sind heute Teil des Anlegens |
| TestTournamentStatus::test_patch_stream_fields | c | tournament |
| TestTournamentStatus::test_patch_season_weight | c | tournament |
| TestBadgesAudience (6 Tests) | b | `/api/badges` und die Codes gibt es nicht mehr; Kern „Aktivieren wertet Vereinserfolge aus“: membership |
| TestBadgesAudience::test_user_badges_negative_hidden_for_viewer | b | negative Erfolge sind heute sichtbar, aber `secret` |

### test_phase_8_9_10.py (7)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| test_smtp_settings_roundtrip | c | settings |
| test_mail_queue_endpoints | a | test_mail_queue_masked_flow.py::test_list_and_stats_never_carry_a_full_address |
| test_setup_status | c | settings |
| test_setup_complete_idempotent | a | test_password_contract_flow.py::test_setup_wizard_marks_the_admin_account |
| test_sitemap | a | test_partner_pages_flow.py::test_sitemap_lists_only_active_partner_pages |
| test_prizes_crud | a/c | Anlegen bis Löschen: test_prize_lifecycle_flow.py::test_undoing_picked_up_sends_nothing_and_everything_is_logged; Filter und offene Gewinne: prize |
| test_prizes_unauthorized | c | prize |

### test_phase_a_quickwins.py (5)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| test_gallery_list_endpoint | a | test_empty_albums_flow.py::test_gallery_hides_empty_albums_from_guests_and_members |
| test_sponsor_tier_system | c | sponsor |
| test_profile_multiselect_fields | c | profile |
| test_public_profile_exposes_twitch_embed | c | profile |
| test_image_migration_endpoint | c | media |

### test_phase_b_v4_achievements.py (19, dito)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestPublicCatalog::test_groups_anonymous_excludes_negative | c | achievements |
| TestPublicCatalog::test_groups_anonymous_count_matches_spec | b | alter Katalog |
| TestPublicCatalog::test_user_achievements_anonymous_admin_profile | b | Seed-Vergaben; negative Erfolge heute sichtbar als `secret` |
| TestPublicCatalog::test_user_404_unknown | c | achievements |
| TestMyAchievements::test_me_returns_groups_and_awards | b | Seed-Zahl; Form: test_achievement_admin_flow.py::test_einzelvergabe_mit_datum_ohne_zeremonie_und_ruecknahme_mit_grund |
| TestMyAchievements::test_evaluate_endpoint_self | a | test_achievement_recount_flow.py::test_the_page_only_hears_about_loud_awards |
| TestAdminGroups::test_admin_groups_includes_negative | b | Zahlen des alten Seeds |
| TestAdminGroups::test_admin_groups_unauthorized | c | achievements |
| TestAdminGroups::test_create_patch_delete_custom_group | a | test_achievement_admin_tabs_flow.py::test_katalog_aenderungen_im_protokoll_und_material_nur_zwischen_den_nachbarn |
| TestAdminGroups::test_delete_system_group_blocked | c | achievements |
| TestAdminTiers::test_list_tiers_for_match_master | b | Gruppe `match_master` abgelöst; Filter: test_achievements_v2_flow.py::test_admin_legt_stufen_mit_material_an |
| TestAdminTiers::test_create_patch_delete_tier | a | test_achievements_v2_flow.py::test_admin_legt_stufen_mit_material_an |
| TestAdminAwardManual::test_award_revoke_flow | a | test_achievement_admin_flow.py::test_einzelvergabe_mit_datum_ohne_zeremonie_und_ruecknahme_mit_grund |
| TestAdminAwardManual::test_award_unknown_user | a | dieselbe |
| TestAdminAwardManual::test_award_unknown_tier | c | achievements |
| TestNegativePrivacy::test_negative_award_hidden_from_public_profile | b | negative Erfolge heute sichtbar als `secret`; Postfach: test_achievement_admin_tabs_flow.py::test_erfolge_einer_person_fuer_die_ruecknahme |
| TestNegHolzmedailleRetestPrivacy::test_setup_award_then_full_privacy_then_cleanup | b | dito |
| TestUserSearch::test_search_admin | c | achievements |
| TestOldBadgesRouteGone::test_old_badges_endpoint_404 | c | removed |

### test_phase_c_iter16.py (12, dito)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestCatalogExpansion::test_anon_groups_count_and_tier_total | b | Katalog umgebaut; Leitungs-Gruppen: test_achievement_reach_flow.py::test_turnierleitung_und_schiedsrichter_nur_fuer_die_leitung |
| TestNegativeIncidents::test_incident_types | b | heute 34 Vorfall-Typen |
| TestNegativeIncidents::test_trigger_incident_invalid_type | c | achievements |
| TestNegativeIncidents::test_trigger_rage_quit_and_privacy | b | Datenschutz-Teil bewusst geändert; Auslösen: test_achievement_admin_tabs_flow.py::test_katalog_aenderungen_im_protokoll_und_material_nur_zwischen_den_nachbarn |
| TestSeasonCompletion404::test_unknown_season | c | achievements |
| TestProfileCompleteness::test_my_completeness_score | a | test_profile_public_data_flow.py::test_profile_completeness_is_only_for_the_person |
| TestProfileCompleteness::test_auto_award_profile_completeness_bronze | b | Gruppe neu definiert, Stufe `_b` gibt es nicht |
| TestMembershipApply::test_apply_creates_pending | a | test_dolibarr_applications_flow.py::test_without_the_switch_the_website_keeps_its_own_application |
| TestMembershipApply::test_double_submit_409 | a | test_dolibarr_applications_flow.py::test_application_goes_to_dolibarr_once_and_the_person_follows_its_state |
| TestMembershipApply::test_admin_lists_pending | c | membership |
| TestMembershipApply::test_admin_approve_creates_membership_and_mail | a | test_membership_gaps_flow.py::test_approve_goes_the_same_way_as_by_hand |
| TestPublicListEnrichment::test_public_list_has_completeness_and_top_achievement | c | achievements |

### test_phase_d_v3.py (9, dito)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestBadges::test_list_anon | b | `/api/badges` gibt es nicht mehr; removed |
| TestBadges::test_list_admin_includes_members_only | b | dito |
| TestBadges::test_progress_me | b | `/api/badges/progress/me` gibt es nicht mehr; removed |
| TestContact::test_topics | a | test_contact_inbox_flow.py::test_topics_include_invoice_and_the_form_accepts_it |
| TestContact::test_submit_and_admin_inbox_flow | a | test_spam_guard_flow.py::test_real_person_gets_through_with_mails, test_contact_inbox_flow.py::test_answered_by_hand_keeps_who_and_when_and_the_first_time_counts |
| TestBoard::test_defaults_present | a | test_board_portraits_flow.py::test_board_marks_cutout_photos_genders_titles_and_carries_vacancy_texts |
| TestBoard::test_assignable_users | c | membership |
| TestBoard::test_create_patch_delete_custom | a | test_rights_gaps_flow.py::test_posts_are_logged_and_the_person_is_told |
| TestBoard::test_delete_default_blocked | c | membership |

### test_phase_ef_iter17.py (16)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestStreams::test_public_live_streams_returns_list | a | test_streams_diagnose_flow.py::test_homepage_rule_is_unchanged_and_admin_names_the_reason_per_channel |
| TestStreams::test_admin_streams_refresh_requires_admin | c | media |
| TestStreams::test_admin_streams_refresh_no_creds | a | test_streams_diagnose_flow.py::test_poll_records_why_it_delivers_nothing |
| TestBrandingTwitch::test_branding_accepts_twitch_fields | a | test_platform_links_flow.py::test_settings_hide_the_secrets_and_export_and_anonymize_carry_the_links |
| TestEmailTemplates::test_list_default_templates | a | test_email_templates_flow.py::test_catalog_lists_every_mail_with_purpose_recipient_and_vars |
| TestEmailTemplates::test_patch_template_persists | a | test_email_templates_flow.py::test_preview_override_test_and_reset |
| TestEmailTemplates::test_patch_unknown_template_404 | a | dieselbe |
| TestDiscordCounter::test_bump_counter_persists_and_audit | c | achievements |
| TestDiscordCounter::test_counters_list_contains_user | c | achievements |
| TestDiscordCounter::test_discord_active_b_auto_awarded | c | achievements |
| TestDiscordCounter::test_bump_unknown_user_404 | c | achievements |
| TestAutoHooks::test_dispute_hook_creates_neg_dispute | c | achievements (auch über den echten Streitfall-Hook) |
| TestAutoHooks::test_forfeit_hook_no_show_incident | a | test_heat_no_show_flow.py::test_no_show_in_a_heat_marks_only_that_person_and_the_heat_stays_open |
| TestAutoHooks::test_late_checkin_hook_neg_afk | a | test_achievement_admin_tabs_flow.py::test_erfolge_einer_person_fuer_die_ruecknahme |
| TestPrivacy::test_negative_awards_not_in_my_achievements | b | prüfte nichts; negative Erfolge heute sichtbar als `secret` |
| TestPrivacy::test_negative_awards_not_in_public_profile | b | dito |

### test_phase_fg_iter18.py (10)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| test_admin_media_list | a | test_media_usage_flow.py::test_a_file_used_anywhere_counts_as_used_in_the_media_library |
| test_admin_media_list_usage_fields | a | dieselbe |
| test_admin_media_audit | a | test_media_library_flow.py::test_all_files_are_counted_and_reachable_page_by_page |
| test_admin_media_traversal_protection | c | media |
| test_admin_media_anonymous_blocked | c | media |
| test_admin_nav_get_and_put | a | test_nav_editor_flow.py::test_league_is_a_menu_entry_that_can_be_hidden_and_renamed |
| test_admin_nav_anonymous_blocked | c | media |
| test_public_nav_anon | a | test_nav_editor_flow.py::test_child_order_is_saved_and_survives_a_reload |
| test_sitemap_xml | a | test_sitemap_public_routes.py::test_sitemap_lists_public_tournament_subpages |
| test_robots_txt | c | settings |

### test_phase_membership.py (25)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| TestAuth::test_register_response_shape | b | Registrierung liefert nur `verification_required` |
| TestAuth::test_admin_login_membership_attached | b | Seed-Nummer; Kern „Login bringt die Mitgliedschaft mit“: membership |
| TestAuth::test_me_includes_membership | b | Seed-Nummer |
| TestAuth::test_me_community_user | c | membership |
| TestMembershipMeta::test_meta_public | a | test_membership_gaps_flow.py::test_export_stays_in_dolibarr_when_it_leads |
| TestMembershipMeta::test_membership_me_community | a | test_dolibarr_flow.py::test_draft_and_stranger_get_no_access_and_preview_mode_writes_nothing |
| TestMembershipMeta::test_membership_list_admin | b | Seed-Nummer; Liste: test_private_fields_flow.py::test_no_answer_shows_a_private_field_and_public_fields_stay |
| TestMembershipUpsert::test_promote_user_to_active | a | test_membership_gaps_flow.py::test_approve_goes_the_same_way_as_by_hand |
| TestMembershipUpsert::test_history_grows | b | Verlauf nur bei Statuswechsel: test_dolibarr_flow.py::test_internal_notes_stay_internal |
| TestMembershipUpsert::test_email_log_activated | a | test_membership_gaps_flow.py::test_a_status_change_mails_once_and_a_note_mails_nothing |
| TestMembershipUpsert::test_block_user_renders_template | a | test_membership_gaps_flow.py::test_blocked_and_ended_arrive_with_mails_switched_off |
| TestMembershipUpsert::test_demote_to_inactive | c | membership |
| TestMembershipUpsert::test_re_promote_keeps_member_number | a | test_membership_gaps_flow.py::test_a_returning_member_keeps_the_number_and_the_beginning |
| TestBenefits::test_community_no_benefits | a | test_membership_gaps_flow.py::test_benefits_respect_their_days |
| TestBenefits::test_admin_create_visible_to_member | c | membership |
| TestBenefits::test_patch_deactivate_hides | c | membership |
| TestBenefits::test_admin_all_includes_inactive | c | membership |
| TestBenefits::test_authz_community_cannot_create | c | membership |
| TestBenefits::test_authz_community_cannot_update_membership | c | membership |
| TestPublic::test_public_members_directory | a | test_public_profile_fields_flow.py::test_lists_follow_the_privacy_levels_and_never_show_the_internal_role |
| TestPublic::test_public_user_list | a | test_private_fields_flow.py::test_no_answer_shows_a_private_field_and_public_fields_stay |
| TestPublic::test_public_profile_includes_membership | a | test_user_socials_migration_flow.py::test_public_profile_keeps_a_private_value_hidden_after_the_move |
| TestUserUpdate::test_patch_extended_fields | c | profile |
| TestUserUpdate::test_patch_favorite_games_list | c | profile |
| TestEmailLogs::test_email_logs_admin | b | keiner der Pfade existiert |


### test_phase_penalty_iter19.py (10)

| Test | Kat. | Beleg / neu in |
|---|---|---|
| test_lap_with_penalty_no_note_rejected | a | test_fastlap_time_rules_flow.py::test_penalty_needs_a_reason_on_both_ways_and_taking_it_back_needs_none |
| test_lap_invalid_no_note_rejected | a | dieselbe |
| test_lap_with_penalty_and_note_allowed | c | fastlap |
| test_lap_clean_no_note_required | a | test_fastlap_time_rules_flow.py::test_entering_and_correcting_refuse_the_same_values |
| test_my_penalties_requires_auth | c | fastlap |
| test_my_penalties_returns_own | a | test_penalties_documents_gaps_flow.py::test_incidents_appear_for_the_person_and_the_admin |
| test_admin_penalties_aggregated | a | test_league_penalties_flow.py::test_the_admin_list_names_the_team_once |
| test_admin_penalties_kind_filter | a | dieselbe |
| test_admin_penalties_anonymous_blocked | c | fastlap |
| test_match_forfeit_requires_note | a | test_v2_match_flows_unit.py::test_a_forfeit_without_a_real_reason_is_rejected |
