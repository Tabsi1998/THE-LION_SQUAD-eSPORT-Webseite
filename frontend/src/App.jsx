import "@/App.css";
import { Suspense } from "react";
import { lazyPage } from "@/lib/chunkReload";
import { SeasonProvider } from "@/seasons/SeasonContext";
import { SeasonStage } from "@/seasons/SeasonStage";
import { SignalSync } from "@/seasons/SignalSync";
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/tls/ProtectedRoute";
import { BrandingHead } from "@/components/tls/BrandingHead";
import { ApiInvalidationBridge } from "@/components/tls/ApiInvalidationBridge";
import { ScrollManager } from "@/components/tls/ScrollManager";
import { ViewTransitions } from "@/components/tls/ViewTransitions";
import { AchievementCatchUp } from "@/components/tls/AchievementCatchUp";
import { CeremonyHost } from "@/components/achievements/ceremony/CeremonyHost";
import { BallotPopup } from "@/components/tls/BallotPopup";
import { CalendarHintHost } from "@/components/calendar/CalendarHintHost";
import { CookieConsentProvider } from "@/components/tls/CookieConsent";
import { AnalyticsHead } from "@/components/tls/AnalyticsHead";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";
import { AppErrorBoundary, OptionalBoundary, RootErrorBoundary } from "@/components/tls/AppErrorBoundary";
import { BottomNav } from "@/components/tls/BottomNav";
import { PageTransition } from "@/components/tls/PageTransition";
import { RouteFallback, StartSplashGate } from "@/components/tls/RouteFallback";
// Seitenwechsel anhalten, solange in den Einstellungen etwas nicht gespeichert werden konnte (#1048): der Hörer für
// „Zurück“ muss vor dem des Routers stehen, deshalb wird das Modul hier früh geladen.
import "@/lib/navigationGuard";

function MeRedirect() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  // Solange die Sitzung noch geladen wird (user undefined), nicht zum Login schicken - sonst landet jeder
  // angemeldete Klick auf /u/me auf der Login-Seite. Der Reiter (?tab=achievements …) geht mit (#1149).
  if (user === undefined) return null;
  const query = params.toString() ? `?${params.toString()}` : "";
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(`/u/me${query}`)}`} replace />;
  return <Navigate to={`/u/${user.username}${query}`} replace />;
}

function FastLapLegacyRedirect() {
  const { slug } = useParams();
  return <Navigate to={slug ? `/fastlap/${slug}` : "/fastlap"} replace />;
}

function GalleryLegacyRedirect() {
  const { slug } = useParams();
  return <Navigate to={slug ? `/galerie/${slug}` : "/galerie"} replace />;
}

function PlayerLegacyRedirect() {
  const { username } = useParams();
  return <Navigate to={`/u/${username}`} replace />;
}

// Turnierbaum-TV (#1110): mit Anzeige-Schlüssel im Link läuft er ohne Anmeldung - der Schlüssel erlaubt nur das
// Anschauen dieses Turniers. Ohne Schlüssel bleibt es bei der Anmeldung der Turnierleitung.
function BracketTvRoute({ station = false }) {
  const [params] = useSearchParams();
  const page = station ? <StationTVPage /> : <BracketTVPage />;
  if (params.get("key")) return page;
  return <ProtectedRoute requireTournamentStaff>{page}</ProtectedRoute>;
}

import HomePage from "@/pages/public/HomePage";
const TournamentsPage = lazyPage(() => import("@/pages/public/TournamentsPage"));
const TournamentDetailPage = lazyPage(() => import("@/pages/public/TournamentDetailPage"));
// Vor-Ort-Zugang (#1592): Ziel des QR-Codes auf TV und Aushang.
const OnsiteAccessPage = lazyPage(() => import("@/pages/public/OnsiteAccessPage"));
const AdminOnsitePosterPage = lazyPage(() => import("@/pages/admin/AdminOnsitePosterPage"));
// Druckansicht (#1283): Plan B auf Papier - Baum, Spielplan, Check-in-Liste und Tagesplan, ohne Menü und Deko.
const PrintPage = lazyPage(() => import("@/pages/print/PrintPage"));
const TournamentBracketPage = lazyPage(() => import("@/pages/public/TournamentBracketPage"));
const TournamentStandingsPage = lazyPage(() => import("@/pages/public/TournamentStandingsPage"));
const TournamentSchedulePage = lazyPage(() => import("@/pages/public/TournamentSchedulePage"));
const LeagueIndexPage = lazyPage(() => import("@/pages/public/LeagueIndexPage"));
const LeagueSeasonPage = lazyPage(() => import("@/pages/public/LeagueSeasonPage"));
const MatchPage = lazyPage(() => import("@/pages/public/MatchPage"));
// Turnierleitung am Handy (#1156): Ergebnisse eintragen, was fehlt, Streitfälle - nur für die Turnierleitung des Turniers.
const TournamentLeadPage = lazyPage(() => import("@/pages/public/TournamentLeadPage"));
const EsportsOverviewPage = lazyPage(() => import("@/pages/public/EsportsOverviewPage"));
const F1ListPage = lazyPage(() => import("@/pages/public/F1ListPage"));
const F1DetailPage = lazyPage(() => import("@/pages/public/F1DetailPage"));
const EventsPage = lazyPage(() => import("@/pages/public/EventsPage"));
// Anmeldungen & Einlass (#1372): Suche, „noch nicht da“, Einchecken und Nachricht an alle - nur für die Turnierleitung.
const EventLeadPage = lazyPage(() => import("@/pages/public/EventLeadPage"));
const CalendarPage = lazyPage(() => import("@/pages/public/CalendarPage"));
const AdventCalendarPage = lazyPage(() => import("@/pages/public/AdventCalendarPage"));
const EventDetailPage = lazyPage(() => import("@/pages/public/EventDetailPage"));
const EventLivePage = lazyPage(() => import("@/pages/public/EventLivePage"));
const TeamsPage = lazyPage(() => import("@/pages/public/TeamsPage"));
const NewsPage = lazyPage(() => import("@/pages/public/NewsPage"));
const LoginPage = lazyPage(() => import("@/pages/public/LoginPage"));
const RegisterPage = lazyPage(() => import("@/pages/public/RegisterPage"));
const ForgotPasswordPage = lazyPage(() => import("@/pages/public/PasswordRecoveryPage").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazyPage(() => import("@/pages/public/PasswordRecoveryPage").then((m) => ({ default: m.ResetPasswordPage })));
const EmailVerificationPage = lazyPage(() => import("@/pages/public/EmailVerificationPage"));
const NewsletterUnsubscribePage = lazyPage(() => import("@/pages/public/NewsletterUnsubscribePage"));
const PrivacyPage = lazyPage(() => import("@/pages/public/LegalPages").then((m) => ({ default: m.PrivacyPage })));
const ImprintPage = lazyPage(() => import("@/pages/public/LegalPages").then((m) => ({ default: m.ImprintPage })));
const TermsPage = lazyPage(() => import("@/pages/public/LegalPages").then((m) => ({ default: m.TermsPage })));
// „Neu auf der Website“ (#1240): die letzten Neuerungen aus src/whatsnew.json.
const WhatsNewPage = lazyPage(() => import("@/pages/public/WhatsNewPage"));

const DashboardPage = lazyPage(() => import("@/pages/user/DashboardPage"));
const YearReviewPage = lazyPage(() => import("@/pages/user/YearReviewPage"));
const ProfilePage = lazyPage(() => import("@/pages/user/ProfilePage"));
const MessagesPage = lazyPage(() => import("@/pages/user/MessagesPage"));
const NotificationsPage = lazyPage(() => import("@/pages/user/NotificationsPage"));
const MatchHubPage = lazyPage(() => import("@/pages/user/MatchHubPage"));
const PrivacyAccountPage = lazyPage(() => import("@/pages/user/PrivacyAccountPage"));
const ConsentPage = lazyPage(() => import("@/pages/user/ConsentPage"));

const AdminDashboardPage = lazyPage(() => import("@/pages/admin/AdminDashboardPage"));
// „Mein Dienst“ (#1352): eigene Einsätze und Aufgaben für Helfer und Moderation - statt „Kein Zugriff“.
const AdminDutyPage = lazyPage(() => import("@/pages/admin/AdminDutyPage"));
const AdminTournamentsPage = lazyPage(() => import("@/pages/admin/AdminTournamentsPage"));
const AdminTournamentNewPage = lazyPage(() => import("@/pages/admin/AdminTournamentNewPage"));
const AdminTournamentGuidePage = lazyPage(() => import("@/pages/admin/AdminTournamentGuidePage"));
const AdminTvPage = lazyPage(() => import("@/pages/admin/AdminTvPage"));
const AdminTournamentEditPage = lazyPage(() => import("@/pages/admin/AdminTournamentEditPage"));
const AdminF1Page = lazyPage(() => import("@/pages/admin/AdminF1Page"));
const AdminF1NewPage = lazyPage(() => import("@/pages/admin/AdminF1NewPage"));
const AdminF1EditPage = lazyPage(() => import("@/pages/admin/AdminF1EditPage"));
const AdminGamesPage = lazyPage(() => import("@/pages/admin/AdminGamesPage"));
const AdminGameMapsPage = lazyPage(() => import("@/pages/admin/AdminGameMapsPage"));
const AdminLeaguesPage = lazyPage(() => import("@/pages/admin/league/AdminLeaguesPage"));
const AdminLeagueSeasonPage = lazyPage(() => import("@/pages/admin/league/AdminLeagueSeasonPage"));
const AdminUsersPage = lazyPage(() => import("@/pages/admin/AdminUsersPage"));
const AdminStationsPage = lazyPage(() => import("@/pages/admin/AdminStationsPage"));
const AdminEventsPage = lazyPage(() => import("@/pages/admin/AdminEventsPage"));
const AdminEventEditPage = lazyPage(() => import("@/pages/admin/AdminEventEditPage"));
const AdminNewsPage = lazyPage(() => import("@/pages/admin/AdminNewsPage"));
const AdminNewsEditPage = lazyPage(() => import("@/pages/admin/AdminNewsEditPage"));
const AdminSettingsPage = lazyPage(() => import("@/pages/admin/AdminSettingsPage"));
const AdminClubDataPage = lazyPage(() => import("@/pages/admin/AdminClubDataPage"));
const AdminSeasonsPage = lazyPage(() => import("@/pages/admin/AdminSeasonsPage"));
const AdminOpsPage = lazyPage(() => import("@/pages/admin/AdminOpsPage"));
const AdminDolibarrPage = lazyPage(() => import("@/pages/admin/AdminDolibarrPage"));
const AdminFinancePage = lazyPage(() => import("@/pages/admin/AdminFinancePage"));
const AdminShopPage = lazyPage(() => import("@/pages/admin/AdminShopPage"));
const AdminShopDesignsPage = lazyPage(() => import("@/pages/admin/AdminShopDesignsPage"));
const AdminShopProductsPage = lazyPage(() => import("@/pages/admin/AdminShopProductsPage"));
const AdminShopGamertagPage = lazyPage(() => import("@/pages/admin/AdminShopGamertagPage"));
const AdminShopTestDraftPage = lazyPage(() => import("@/pages/admin/AdminShopTestDraftPage"));
const AdminModerationPage = lazyPage(() => import("@/pages/admin/AdminModerationPage"));
const AdminSetupPage = lazyPage(() => import("@/pages/admin/AdminSetupPage"));
const AdminIntegrationPage = lazyPage(() => import("@/pages/admin/AdminIntegrationPage"));
const AdminIntegrationsOverviewPage = lazyPage(() => import("@/pages/admin/AdminIntegrationsOverviewPage"));
const AdminMobilePushPage = lazyPage(() => import("@/pages/admin/AdminMobilePushPage"));
const AdminAppReleasesPage = lazyPage(() => import("@/pages/admin/AdminAppReleasesPage"));
const AdminWidgetsPage = lazyPage(() => import("@/pages/admin/AdminWidgetsPage"));
const AdminMembersPage = lazyPage(() => import("@/pages/admin/AdminMembersPage"));
const AdminBenefitsPage = lazyPage(() => import("@/pages/admin/AdminBenefitsPage"));
const AdminAdmissionPage = lazyPage(() => import("@/pages/admin/AdminAdmissionPage"));
const AdminGalleryPage = lazyPage(() => import("@/pages/admin/AdminGalleryPage"));
const AdminDocumentsPage = lazyPage(() => import("@/pages/admin/AdminDocumentsPage"));
const SeasonPage = lazyPage(() => import("@/pages/public/SeasonPage"));
const PublicProfilePage = lazyPage(() => import("@/pages/public/PublicProfilePage"));
const AdminAchievementsPage = lazyPage(() => import("@/pages/admin/AdminAchievementsPage"));
const AdminMembershipApplicationsPage = lazyPage(() => import("@/pages/admin/AdminMembershipApplicationsPage"));
const AdminEmailTemplatesPage = lazyPage(() => import("@/pages/admin/AdminEmailTemplatesPage"));
const AdminMediaPage = lazyPage(() => import("@/pages/admin/AdminMediaPage"));
const AdminNavPage = lazyPage(() => import("@/pages/admin/AdminNavPage"));
const MembershipApplyPage = lazyPage(() => import("@/pages/public/MembershipApplyPage"));
const AdminSponsorsPage = lazyPage(() => import("@/pages/admin/AdminSponsorsPage"));
const AdminPartnersPage = lazyPage(() => import("@/pages/admin/AdminPartnersPage"));
const AdminStickersPage = lazyPage(() => import("@/pages/admin/AdminStickersPage"));
const AdminAdventPage = lazyPage(() => import("@/pages/admin/AdminAdventPage"));
const AdminEasterHuntPage = lazyPage(() => import("@/pages/admin/AdminEasterHuntPage"));
const EasterHuntPage = lazyPage(() => import("@/pages/public/EasterHuntPage"));

const AboutPage = lazyPage(() => import("@/pages/public/AboutPage"));
const VereinPage = lazyPage(() => import("@/pages/public/VereinPage"));
const ContactPage = lazyPage(() => import("@/pages/public/ContactPage"));
const SponsorsPage = lazyPage(() => import("@/pages/public/SponsorsPage"));
const PartnersPage = lazyPage(() => import("@/pages/public/PartnersPage"));
const PartnerDetailPage = lazyPage(() => import("@/pages/public/PartnerDetailPage"));
const ReferencesPage = lazyPage(() => import("@/pages/public/ReferencesPage"));
const ReferenceDetailPage = lazyPage(() => import("@/pages/public/ReferencesPage").then((m) => ({ default: m.ReferenceDetailPage })));
// Externe Serien (#1741): Seite einer Saison - die Adresse steht, die Seite kommt mit #1745 ff.
const ReferenceSeriesPage = lazyPage(() => import("@/pages/public/ReferenceSeriesPage"));
// Ergebnistabelle je Runde einer Rennliga (#1950), Reiter je Lauf als ?lauf=…
const ReferenceRoundPage = lazyPage(() => import("@/pages/public/ReferenceRoundPage"));
const PlayersPage = lazyPage(() => import("@/pages/public/PlayersPage"));
const AchievementsShowcasePage = lazyPage(() => import("@/pages/public/AchievementsShowcasePage"));
const AchievementSharePage = lazyPage(() => import("@/pages/public/AchievementSharePage"));
const ResultSharePage = lazyPage(() => import("@/pages/public/ResultSharePage"));
const CommunityPage = lazyPage(() => import("@/pages/public/CommunityPage"));
const ServersPage = lazyPage(() => import("@/pages/public/ServersPage"));
const MembersDirectoryPage = lazyPage(() => import("@/pages/public/MembersDirectoryPage"));
const MemberProfilePage = lazyPage(() => import("@/pages/public/MemberProfilePage"));
const JoinMembershipPage = lazyPage(() => import("@/pages/public/JoinMembershipPage"));
const MemberCardVerifyPage = lazyPage(() => import("@/pages/public/MemberCardVerifyPage"));
const NewsDetailPage = lazyPage(() => import("@/pages/public/NewsDetailPage"));
const GalleryPage = lazyPage(() => import("@/pages/public/GalleryPage"));
const GalleryAlbumPage = lazyPage(() => import("@/pages/public/GalleryAlbumPage"));
const MemberAreaPage = lazyPage(() => import("@/pages/user/MemberAreaPage"));
const MemberBenefitsPage = lazyPage(() => import("@/pages/user/MemberBenefitsPage"));
const MemberDocumentsPage = lazyPage(() => import("@/pages/user/MemberDocumentsPage"));
const MemberMeetingsPage = lazyPage(() => import("@/pages/user/MemberMeetingsPage"));
const MemberHelperShiftsPage = lazyPage(() => import("@/pages/user/MemberHelperShiftsPage"));
const MemberNewsPage = lazyPage(() => import("@/pages/user/MemberNewsPage"));
const MyMembershipPage = lazyPage(() => import("@/pages/user/MyMembershipPage"));
const MyInvoicesPage = lazyPage(() => import("@/pages/user/MyInvoicesPage"));
const AccountDocumentsPage = lazyPage(() => import("@/pages/user/AccountDocumentsPage"));

const F1TVPage = lazyPage(() => import("@/pages/display/F1TVPage"));
const BracketTVPage = lazyPage(() => import("@/pages/display/BracketTVPage"));
const StationTVPage = lazyPage(() => import("@/pages/display/StationTVPage"));
const EventTVPage = lazyPage(() => import("@/pages/display/EventTVPage"));
const EventCallsTVPage = lazyPage(() => import("@/pages/display/EventCallsTVPage"));
const MyPrizesPage = lazyPage(() => import("@/pages/user/MyPrizesPage"));
const MyPenaltiesPage = lazyPage(() => import("@/pages/user/MyPenaltiesPage"));
const AdminPrizesPage = lazyPage(() => import("@/pages/admin/AdminPrizesPage"));
const AdminPenaltiesPage = lazyPage(() => import("@/pages/admin/AdminPenaltiesPage"));
const AdminContactPage = lazyPage(() => import("@/pages/admin/AdminContactPage"));
const AdminBoardPage = lazyPage(() => import("@/pages/admin/AdminBoardPage"));
const AdminReferencesPage = lazyPage(() => import("@/pages/admin/AdminReferencesPage"));
const AdminReferenceSeriesPage = lazyPage(() => import("@/pages/admin/AdminReferenceSeriesPage"));
const AdminReferenceSeriesDetailPage = lazyPage(() => import("@/pages/admin/AdminReferenceSeriesDetailPage"));
const AdminAboutPage = lazyPage(() => import("@/pages/admin/AdminAboutPage"));
const AdminGameServersPage = lazyPage(() => import("@/pages/admin/AdminGameServersPage"));
const SetupWizardPage = lazyPage(() => import("@/pages/SetupWizardPage"));
const NotFoundPage = lazyPage(() => import("@/pages/ErrorPages").then((m) => ({ default: m.NotFoundPage })));
const ForbiddenPage = lazyPage(() => import("@/pages/ErrorPages").then((m) => ({ default: m.ForbiddenPage })));
const ServerErrorPage = lazyPage(() => import("@/pages/ErrorPages").then((m) => ({ default: m.ServerErrorPage })));
const BoardPage = lazyPage(() => import("@/pages/public/ClubPages").then((m) => ({ default: m.BoardPage })));
const CurrentSeasonRedirect = lazyPage(() => import("@/pages/public/CurrentSeasonRedirect"));

function App() {
  // Grenzen gegen Renderfehler (#986): ganz außen eine Karte für Fehler in Anmeldung, Router oder Saison-Kontext; die
  // optionalen Teile über jeder Seite haben je eine eigene Grenze, damit ihr Fehler nicht die Seite darunter leert.
  return (
    <RootErrorBoundary>
    <AuthProvider>
      <BrowserRouter>
        <SeasonProvider>
        <CookieConsentProvider>
          <ConfirmDialogProvider>
            <BrandingHead />
            <AnalyticsHead />
            <ApiInvalidationBridge />
            <ScrollManager />
            {/* Seitenwechsel mit der Übergangs-Funktion des Browsers (#1073) - nach ScrollManager, siehe dort. */}
            <ViewTransitions />
            {/* Still (#986): Erfolge-Nachholen und Saison-Signale arbeiten im Hintergrund und zeigen selbst nichts. */}
            <OptionalBoundary quiet><AchievementCatchUp /></OptionalBoundary>
            {/* Saison-Signale (#678): was gesammelt wurde, geht an den Server - nach dem Login auch das von vorher. */}
            <OptionalBoundary quiet><SignalSync /></OptionalBoundary>
            <OptionalBoundary><CeremonyHost /></OptionalBoundary>
            {/* Abstimmung live (#844): offene Abstimmung mit eigenem Stimmrecht als Popup auf jeder Seite, nie im Admin. */}
            <OptionalBoundary><BallotPopup /></OptionalBoundary>
            {/* Jahreszeiten (#634): Deko-Ebenen über der ganzen Website, nie im Admin, nie klickbar. Still (#986): reine
                Deko - der Adventkalender darin hat eine eigene Grenze mit Hinweis (seasons/adventCalendar). */}
            <OptionalBoundary quiet><SeasonStage /></OptionalBoundary>
            <Toaster theme="dark" position="top-right" richColors />
            {/* Abo-Hinweis nach einer Anmeldung (#1788): einmal je Konto, unten - die Meldungen bleiben oben rechts. */}
            <OptionalBoundary quiet><CalendarHintHost /></OptionalBoundary>
            <StartSplashGate />
            <AppErrorBoundary>
            <BottomNav />
            <Suspense fallback={<RouteFallback />}>
            <PageTransition>
            <Routes>
          {/* Public — Verein */}
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          {/* Verein (#1147): alles vom Verein an einem Ort - Ziel des Eintrags „Verein“ in der Handy-Leiste. */}
          <Route path="/verein" element={<VereinPage />} />
          <Route path="/board" element={<BoardPage />} />
          {/* „Werte & Ziele“ ist seit #1253 ein Abschnitt von „Über uns“ - die alte Adresse leitet weiter. */}
          <Route path="/values" element={<Navigate to="/about#werte" replace />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/sponsors" element={<SponsorsPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/partners/:slug" element={<PartnerDetailPage />} />
          <Route path="/references" element={<ReferencesPage />} />
          <Route path="/references/:id" element={<ReferenceDetailPage />} />
          <Route path="/references/series/:lineageSlug/:seasonSlug" element={<ReferenceSeriesPage />} />
          <Route path="/references/series/:lineageSlug/:seasonSlug/runde/:roundNumber" element={<ReferenceRoundPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/achievements" element={<AchievementsShowcasePage />} />
          <Route path="/achievements/a/:awardId" element={<AchievementSharePage />} />
          <Route path="/members" element={<MembersDirectoryPage />} />
          <Route path="/members/:slug" element={<MemberProfilePage />} />
          <Route path="/membership/join" element={<JoinMembershipPage />} />
          {/* Prüfseite der Mitgliedskarte (#346): öffentlich, ohne Anmeldung, zeigt nur das Nötigste */}
          <Route path="/karte/pruefen/:token" element={<MemberCardVerifyPage />} />
          <Route path="/membership/apply" element={<MembershipApplyPage />} />

          {/* Public — Arena */}
          <Route path="/esports" element={<EsportsOverviewPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:slug" element={<TournamentDetailPage />} />
          <Route path="/vor-ort" element={<OnsiteAccessPage />} />
          <Route path="/tournaments/:slug/bracket" element={<TournamentBracketPage />} />
          <Route path="/tournaments/:slug/matches" element={<TournamentSchedulePage />} />
          <Route path="/tournaments/:slug/standings" element={<TournamentStandingsPage />} />
          <Route path="/liga" element={<LeagueIndexPage />} />
          <Route path="/liga/:league/:season" element={<LeagueSeasonPage />} />
          <Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} />
          <Route path="/tournaments/:slug/ergebnis/:username" element={<ResultSharePage />} />
          <Route path="/matches/:id" element={<MatchPage />} />
          <Route path="/f1" element={<FastLapLegacyRedirect />} />
          <Route path="/f1/:slug" element={<FastLapLegacyRedirect />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/:slug" element={<EventDetailPage />} />
          <Route path="/events/:slug/live" element={<EventLivePage />} />
          <Route path="/events/:slug/leitung" element={<EventLeadPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          {/* „Mein Kalender“ (#1788): nur die eigenen Termine, auch ohne Abo - der Reiter neben „Alle“. */}
          <Route path="/calendar/mine" element={<CalendarPage />} />
          <Route path="/advent" element={<AdventCalendarPage />} />
          <Route path="/ostern" element={<EasterHuntPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:id" element={<TeamsPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/news/:slug" element={<NewsDetailPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/imprint" element={<ImprintPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/neu" element={<WhatsNewPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<EmailVerificationPage />} />
          <Route path="/newsletter/abbestellen" element={<NewsletterUnsubscribePage />} />

          {/* User */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/dein-jahr" element={<ProtectedRoute><YearReviewPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
          <Route path="/messages/:userId" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
          <Route path="/hub/matches/:id" element={<ProtectedRoute><MatchHubPage /></ProtectedRoute>} />
          <Route path="/privacy-account" element={<ProtectedRoute><PrivacyAccountPage /></ProtectedRoute>} />
          <Route path="/consent" element={<ProtectedRoute><ConsentPage /></ProtectedRoute>} />

          {/* Member-only */}
          <Route path="/members/area" element={<ProtectedRoute requireMember><MemberAreaPage /></ProtectedRoute>} />
          {/* Alte und deutsche Adressen des Mitgliederbereichs (#364) */}
          <Route path="/mitgliederbereich" element={<Navigate to="/members/area" replace />} />
          <Route path="/member-area" element={<Navigate to="/members/area" replace />} />
          <Route path="/members/benefits" element={<ProtectedRoute requireMember><MemberBenefitsPage /></ProtectedRoute>} />
          <Route path="/members/documents" element={<ProtectedRoute requireMember><MemberDocumentsPage /></ProtectedRoute>} />
          <Route path="/members/meetings" element={<ProtectedRoute requireMember><MemberMeetingsPage /></ProtectedRoute>} />
          <Route path="/members/helfen" element={<ProtectedRoute requireMember><MemberHelperShiftsPage /></ProtectedRoute>} />
          <Route path="/members/news" element={<ProtectedRoute requireMember><MemberNewsPage /></ProtectedRoute>} />
          <Route path="/members/membership" element={<ProtectedRoute requireMember><MyMembershipPage /></ProtectedRoute>} />
          {/* Eigene Rechnungen (#296): auch für Ehemalige - es zählt die Zuordnung, nicht die Mitgliedschaft. */}
          <Route path="/account/invoices" element={<ProtectedRoute><MyInvoicesPage /></ProtectedRoute>} />
          {/* Eigene Unterlagen aus der Vereinsakte (#1255): wie die Rechnungen über „Nur für dich“ im Profil. */}
          <Route path="/account/documents" element={<ProtectedRoute><AccountDocumentsPage /></ProtectedRoute>} />

          {/* Admin */}
          {/* Eingang (#1352): Startseite für die Verwaltung, sonst „Mein Dienst“ oder die Meldungen der Moderation. */}
          <Route path="/admin" element={<ProtectedRoute adminHome><AdminDashboardPage /></ProtectedRoute>} />
          <Route path="/admin/dienst" element={<ProtectedRoute requireDuty><AdminDutyPage /></ProtectedRoute>} />
          <Route path="/admin/members" element={<ProtectedRoute requireArea="club"><AdminMembersPage /></ProtectedRoute>} />
          {/* Öffentliche Profile (#1365): nur noch ein Reiter unter Mitglieder - die alte Adresse öffnet ihn. */}
          <Route path="/admin/member-profiles" element={<Navigate to="/admin/members?tab=profiles" replace />} />
          <Route path="/admin/benefits" element={<ProtectedRoute requireArea="club"><AdminBenefitsPage /></ProtectedRoute>} />
          <Route path="/admin/einlass" element={<ProtectedRoute requireArea="club"><AdminAdmissionPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments" element={<ProtectedRoute requireTournamentStaff><AdminTournamentsPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments/new" element={<ProtectedRoute requireArea="tournaments"><AdminTournamentNewPage /></ProtectedRoute>} />
          <Route path="/admin/tournament-guide" element={<ProtectedRoute requireArea="tournaments"><AdminTournamentGuidePage /></ProtectedRoute>} />
          <Route path="/admin/tv" element={<ProtectedRoute requireArea="tournaments"><AdminTvPage /></ProtectedRoute>} />
          {/* Aushang zum Vor-Ort-Zugang (#1592): eigenes Blatt ohne Admin-Rahmen, zum Drucken. */}
          <Route path="/admin/tournaments/:id/aushang" element={<ProtectedRoute requireArea="tournaments"><AdminOnsitePosterPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments/:id" element={<ProtectedRoute requireTournamentStaff><AdminTournamentEditPage /></ProtectedRoute>} />
          <Route path="/admin/f1" element={<ProtectedRoute requireTournamentStaff><AdminF1Page /></ProtectedRoute>} />
          <Route path="/admin/f1/new" element={<ProtectedRoute requireArea="tournaments"><AdminF1NewPage /></ProtectedRoute>} />
          <Route path="/admin/f1/:id" element={<ProtectedRoute requireTournamentStaff><AdminF1EditPage /></ProtectedRoute>} />
          <Route path="/admin/games" element={<ProtectedRoute requireArea="tournaments"><AdminGamesPage /></ProtectedRoute>} />
          <Route path="/admin/games/:gameId/maps" element={<ProtectedRoute requireArea="tournaments"><AdminGameMapsPage /></ProtectedRoute>} />
          <Route path="/admin/leagues" element={<ProtectedRoute requireArea="tournaments"><AdminLeaguesPage /></ProtectedRoute>} />
          <Route path="/admin/leagues/seasons/:seasonId" element={<ProtectedRoute requireArea="tournaments"><AdminLeagueSeasonPage /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requireArea="club"><AdminUsersPage /></ProtectedRoute>} />
          <Route path="/admin/stations" element={<ProtectedRoute requireTournamentStaff><AdminStationsPage /></ProtectedRoute>} />
          <Route path="/admin/events" element={<ProtectedRoute requireArea="tournaments"><AdminEventsPage /></ProtectedRoute>} />
          {/* Event und Beitrag als eigene Seite mit URL statt Fenster über der Liste (#434). */}
          <Route path="/admin/events/new" element={<ProtectedRoute requireArea="tournaments"><AdminEventEditPage /></ProtectedRoute>} />
          <Route path="/admin/events/:id" element={<ProtectedRoute requireArea="tournaments"><AdminEventEditPage /></ProtectedRoute>} />
          <Route path="/admin/news" element={<ProtectedRoute requireArea="content"><AdminNewsPage /></ProtectedRoute>} />
          <Route path="/admin/news/new" element={<ProtectedRoute requireArea="content"><AdminNewsEditPage /></ProtectedRoute>} />
          <Route path="/admin/news/:id" element={<ProtectedRoute requireArea="content"><AdminNewsEditPage /></ProtectedRoute>} />
          <Route path="/admin/gallery" element={<ProtectedRoute requireArea={["content", "club"]}><AdminGalleryPage /></ProtectedRoute>} />
          <Route path="/admin/documents" element={<ProtectedRoute requireArea="club"><AdminDocumentsPage /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute requireArea="system"><AdminSettingsPage /></ProtectedRoute>} />
          <Route path="/admin/settings/:section" element={<ProtectedRoute requireArea="system"><AdminSettingsPage /></ProtectedRoute>} />
          <Route path="/admin/club" element={<ProtectedRoute requireArea="system"><AdminClubDataPage /></ProtectedRoute>} />
          <Route path="/admin/seasons" element={<ProtectedRoute requireArea="tournaments"><AdminSeasonsPage /></ProtectedRoute>} />
          <Route path="/admin/logs" element={<Navigate to="/admin/ops?tab=events" replace />} />
          <Route path="/admin/ops" element={<ProtectedRoute requireArea="system"><AdminOpsPage /></ProtectedRoute>} />
          <Route path="/admin/dolibarr" element={<ProtectedRoute requireArea={["club", "system"]}><AdminDolibarrPage /></ProtectedRoute>} />
          <Route path="/admin/finance" element={<ProtectedRoute requireArea={["finance"]}><AdminFinancePage /></ProtectedRoute>} />
          <Route path="/admin/shop" element={<ProtectedRoute requireArea={["finance"]}><AdminShopPage /></ProtectedRoute>} />
          <Route path="/admin/shop/designs" element={<ProtectedRoute requireArea={["finance"]}><AdminShopDesignsPage /></ProtectedRoute>} />
          <Route path="/admin/shop/products" element={<ProtectedRoute requireArea={["finance"]}><AdminShopProductsPage /></ProtectedRoute>} />
          <Route path="/admin/shop/products/:productId" element={<ProtectedRoute requireArea={["finance"]}><AdminShopProductsPage /></ProtectedRoute>} />
          <Route path="/admin/shop/gamertag" element={<ProtectedRoute requireArea={["finance"]}><AdminShopGamertagPage /></ProtectedRoute>} />
          <Route path="/admin/shop/test-draft" element={<ProtectedRoute requireArea={["finance"]}><AdminShopTestDraftPage /></ProtectedRoute>} />
          <Route path="/admin/audit" element={<Navigate to="/admin/ops?tab=events&source=audit" replace />} />
          <Route path="/admin/moderation" element={<ProtectedRoute requireArea="moderation"><AdminModerationPage /></ProtectedRoute>} />
          <Route path="/admin/setup" element={<ProtectedRoute requireArea={["system"]}><AdminSetupPage /></ProtectedRoute>} />
          <Route path="/admin/integrations" element={<ProtectedRoute requireArea={["system"]}><AdminIntegrationsOverviewPage /></ProtectedRoute>} />
          <Route path="/admin/integrations/:key" element={<ProtectedRoute requireArea={["system"]}><AdminIntegrationPage /></ProtectedRoute>} />
          <Route path="/admin/mobile-logs" element={<Navigate to="/admin/ops?tab=app" replace />} />
          <Route path="/admin/mobile-push" element={<ProtectedRoute requireArea="system"><AdminMobilePushPage /></ProtectedRoute>} />
          <Route path="/admin/app-releases" element={<ProtectedRoute requireArea="system"><AdminAppReleasesPage /></ProtectedRoute>} />
          <Route path="/admin/downloads" element={<ProtectedRoute requireArea={["tournaments", "content", "club", "system"]}><AdminWidgetsPage /></ProtectedRoute>} />
          {/* Eine Adresse je Seite (#512): Widgets sind Downloads & QR. */}
          <Route path="/admin/widgets" element={<Navigate to="/admin/downloads" replace />} />

          <Route path="/seasons/current" element={<CurrentSeasonRedirect />} />
          <Route path="/seasons/:slug" element={<SeasonPage />} />
          <Route path="/u/me" element={<MeRedirect />} />
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/players/:username" element={<PlayerLegacyRedirect />} />
          <Route path="/fastlap" element={<F1ListPage />} />
          <Route path="/fastlap/:slug" element={<F1DetailPage />} />
          <Route path="/galerie" element={<GalleryPage />} />
          <Route path="/galerie/:slug" element={<GalleryAlbumPage />} />
          <Route path="/gallery" element={<GalleryLegacyRedirect />} />
          <Route path="/gallery/:slug" element={<GalleryLegacyRedirect />} />

          {/* Admin */}
          <Route path="/admin/sponsors" element={<ProtectedRoute requireArea="content"><AdminSponsorsPage /></ProtectedRoute>} />
          <Route path="/admin/partners" element={<ProtectedRoute requireArea="content"><AdminPartnersPage /></ProtectedRoute>} />
          <Route path="/admin/references" element={<ProtectedRoute requireArea="content"><AdminReferencesPage /></ProtectedRoute>} />
          <Route path="/admin/reference-series" element={<ProtectedRoute requireArea="content"><AdminReferenceSeriesPage /></ProtectedRoute>} />
          <Route path="/admin/reference-series/:seriesId" element={<ProtectedRoute requireArea="content" allowSeriesCaptain><AdminReferenceSeriesDetailPage /></ProtectedRoute>} />
          <Route path="/admin/about" element={<ProtectedRoute requireArea="content"><AdminAboutPage /></ProtectedRoute>} />
          <Route path="/admin/game-servers" element={<ProtectedRoute requireArea="system"><AdminGameServersPage /></ProtectedRoute>} />
          <Route path="/admin/achievements" element={<ProtectedRoute requireArea="content"><AdminAchievementsPage /></ProtectedRoute>} />
          <Route path="/admin/achievements/preview" element={<Navigate to="/admin/achievements?tab=preview" replace />} />
          <Route path="/admin/stickers" element={<ProtectedRoute requireArea="content"><AdminStickersPage /></ProtectedRoute>} />
          <Route path="/admin/advent" element={<ProtectedRoute requireArea={["content", "club"]}><AdminAdventPage /></ProtectedRoute>} />
          <Route path="/admin/ostern" element={<ProtectedRoute requireArea={["content", "club"]}><AdminEasterHuntPage /></ProtectedRoute>} />
          <Route path="/admin/membership-applications" element={<ProtectedRoute requireArea="club"><AdminMembershipApplicationsPage /></ProtectedRoute>} />
          <Route path="/admin/email-templates" element={<ProtectedRoute requireArea="system"><AdminEmailTemplatesPage /></ProtectedRoute>} />
          {/* Das Web-CMS ist weg (#437 A): alte Lesezeichen landen bei den E-Mail-Vorlagen, seiner einen verbliebenen Aufgabe. */}
          <Route path="/admin/cms" element={<Navigate to="/admin/email-templates" replace />} />
          <Route path="/admin/media" element={<ProtectedRoute requireArea="content"><AdminMediaPage /></ProtectedRoute>} />
          <Route path="/admin/nav" element={<ProtectedRoute requireArea="content"><AdminNavPage /></ProtectedRoute>} />
          <Route path="/admin/prizes" element={<ProtectedRoute requireArea="tournaments"><AdminPrizesPage /></ProtectedRoute>} />
          <Route path="/admin/penalties" element={<ProtectedRoute requireArea="tournaments"><AdminPenaltiesPage /></ProtectedRoute>} />
          <Route path="/admin/contact" element={<ProtectedRoute requireArea="club"><AdminContactPage /></ProtectedRoute>} />
          <Route path="/admin/board" element={<ProtectedRoute requireArea="club"><AdminBoardPage /></ProtectedRoute>} />

          {/* Setup wizard */}
          <Route path="/setup" element={<ProtectedRoute requireArea="system"><SetupWizardPage /></ProtectedRoute>} />

          {/* User: Meine Gewinne */}
          <Route path="/my/prizes" element={<ProtectedRoute><MyPrizesPage /></ProtectedRoute>} />
          <Route path="/my/penalties" element={<ProtectedRoute><MyPenaltiesPage /></ProtectedRoute>} />

          {/* Display / TV */}
          <Route path="/display/f1/:id" element={<F1TVPage />} />
          <Route path="/display/event/:id" element={<EventTVPage />} />
          <Route path="/display/event/:id/calls" element={<EventCallsTVPage />} />
          <Route path="/display/bracket/:id" element={<BracketTvRoute />} />
          <Route path="/display/bracket/:id/station/:stationId" element={<BracketTvRoute station />} />

          {/* Druckansicht (#1283): öffentlich wie Baum und Spielplan; die Check-in-Liste prüft der Server. */}
          <Route path="/print/tournaments/:slug" element={<PrintPage scope="tournament" />} />
          <Route path="/print/events/:slug" element={<PrintPage scope="event" />} />

          {/* Error pages */}
          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="/500" element={<ServerErrorPage />} />
          <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </PageTransition>
            </Suspense>
            </AppErrorBoundary>
          </ConfirmDialogProvider>
        </CookieConsentProvider>
        </SeasonProvider>
      </BrowserRouter>
    </AuthProvider>
    </RootErrorBoundary>
  );
}

export default App;
