import "@/App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/tls/ProtectedRoute";
import { BrandingHead } from "@/components/tls/BrandingHead";
import { ApiInvalidationBridge } from "@/components/tls/ApiInvalidationBridge";
import { ScrollManager } from "@/components/tls/ScrollManager";
import { AchievementCatchUp } from "@/components/tls/AchievementCatchUp";
import { CookieConsentProvider } from "@/components/tls/CookieConsent";
import { AnalyticsHead } from "@/components/tls/AnalyticsHead";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";
import { AppErrorBoundary } from "@/components/tls/AppErrorBoundary";
import { BottomNav } from "@/components/tls/BottomNav";

function RouteFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0A] gap-4">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-[#29B6E8]/20" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#29B6E8] animate-spin" />
      </div>
      <span className="text-white/30 font-display tracking-[0.3em] text-xs uppercase">Lade …</span>
    </div>
  );
}

function MeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login?next=/profile" replace />;
  return <Navigate to={`/u/${user.username}`} replace />;
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

import HomePage from "@/pages/public/HomePage";
const TournamentsPage = lazy(() => import("@/pages/public/TournamentsPage"));
const TournamentDetailPage = lazy(() => import("@/pages/public/TournamentDetailPage"));
const TournamentBracketPage = lazy(() => import("@/pages/public/TournamentBracketPage"));
const TournamentStandingsPage = lazy(() => import("@/pages/public/TournamentStandingsPage"));
const TournamentSchedulePage = lazy(() => import("@/pages/public/TournamentSchedulePage"));
const MatchPage = lazy(() => import("@/pages/public/MatchPage"));
const EsportsOverviewPage = lazy(() => import("@/pages/public/EsportsOverviewPage"));
const F1ListPage = lazy(() => import("@/pages/public/F1ListPage"));
const F1DetailPage = lazy(() => import("@/pages/public/F1DetailPage"));
const EventsPage = lazy(() => import("@/pages/public/EventsPage"));
const EventDetailPage = lazy(() => import("@/pages/public/EventDetailPage"));
const EventLivePage = lazy(() => import("@/pages/public/EventLivePage"));
const TeamsPage = lazy(() => import("@/pages/public/TeamsPage"));
const NewsPage = lazy(() => import("@/pages/public/NewsPage"));
const LoginPage = lazy(() => import("@/pages/public/LoginPage"));
const RegisterPage = lazy(() => import("@/pages/public/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("@/pages/public/PasswordRecoveryPage").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("@/pages/public/PasswordRecoveryPage").then((m) => ({ default: m.ResetPasswordPage })));
const EmailVerificationPage = lazy(() => import("@/pages/public/EmailVerificationPage"));
const PrivacyPage = lazy(() => import("@/pages/public/LegalPages").then((m) => ({ default: m.PrivacyPage })));
const ImprintPage = lazy(() => import("@/pages/public/LegalPages").then((m) => ({ default: m.ImprintPage })));
const TermsPage = lazy(() => import("@/pages/public/LegalPages").then((m) => ({ default: m.TermsPage })));

const DashboardPage = lazy(() => import("@/pages/user/DashboardPage"));
const ProfilePage = lazy(() => import("@/pages/user/ProfilePage"));
const MessagesPage = lazy(() => import("@/pages/user/MessagesPage"));
const NotificationsPage = lazy(() => import("@/pages/user/NotificationsPage"));
const MatchHubPage = lazy(() => import("@/pages/user/MatchHubPage"));
const PrivacyAccountPage = lazy(() => import("@/pages/user/PrivacyAccountPage"));
const ConsentPage = lazy(() => import("@/pages/user/ConsentPage"));

const AdminDashboardPage = lazy(() => import("@/pages/admin/AdminDashboardPage"));
const AdminTournamentsPage = lazy(() => import("@/pages/admin/AdminTournamentsPage"));
const AdminTournamentNewPage = lazy(() => import("@/pages/admin/AdminTournamentNewPage"));
const AdminTournamentEditPage = lazy(() => import("@/pages/admin/AdminTournamentEditPage"));
const AdminF1Page = lazy(() => import("@/pages/admin/AdminF1Page"));
const AdminF1NewPage = lazy(() => import("@/pages/admin/AdminF1NewPage"));
const AdminF1EditPage = lazy(() => import("@/pages/admin/AdminF1EditPage"));
const AdminGamesPage = lazy(() => import("@/pages/admin/AdminGamesPage"));
const AdminUsersPage = lazy(() => import("@/pages/admin/AdminUsersPage"));
const AdminStationsPage = lazy(() => import("@/pages/admin/AdminStationsPage"));
const AdminEventsPage = lazy(() => import("@/pages/admin/AdminEventsPage"));
const AdminNewsPage = lazy(() => import("@/pages/admin/AdminNewsPage"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/AdminSettingsPage"));
const AdminSeasonsPage = lazy(() => import("@/pages/admin/AdminSeasonsPage"));
const AdminLogsPage = lazy(() => import("@/pages/admin/AdminLogsPage"));
const AdminOpsPage = lazy(() => import("@/pages/admin/AdminOpsPage"));
const AdminAuditPage = lazy(() => import("@/pages/admin/AdminAuditPage"));
const AdminModerationPage = lazy(() => import("@/pages/admin/AdminModerationPage"));
const AdminMobileLogsPage = lazy(() => import("@/pages/admin/AdminMobileLogsPage"));
const AdminMobilePushPage = lazy(() => import("@/pages/admin/AdminMobilePushPage"));
const AdminAppReleasesPage = lazy(() => import("@/pages/admin/AdminAppReleasesPage"));
const AdminWidgetsPage = lazy(() => import("@/pages/admin/AdminWidgetsPage"));
const AdminMembersPage = lazy(() => import("@/pages/admin/AdminMembersPage"));
const AdminClubMemberProfilesPage = lazy(() => import("@/pages/admin/AdminClubMemberProfilesPage"));
const AdminBenefitsPage = lazy(() => import("@/pages/admin/AdminBenefitsPage"));
const AdminGalleryPage = lazy(() => import("@/pages/admin/AdminGalleryPage"));
const AdminDocumentsPage = lazy(() => import("@/pages/admin/AdminDocumentsPage"));
const SeasonPage = lazy(() => import("@/pages/public/SeasonPage"));
const PublicProfilePage = lazy(() => import("@/pages/public/PublicProfilePage"));
const AdminAchievementsPage = lazy(() => import("@/pages/admin/AdminAchievementsPage"));
const AdminMembershipApplicationsPage = lazy(() => import("@/pages/admin/AdminMembershipApplicationsPage"));
const AdminCmsPage = lazy(() => import("@/pages/admin/AdminCmsPage"));
const AdminMediaPage = lazy(() => import("@/pages/admin/AdminMediaPage"));
const AdminNavPage = lazy(() => import("@/pages/admin/AdminNavPage"));
const MembershipApplyPage = lazy(() => import("@/pages/public/MembershipApplyPage"));
const AdminSponsorsPage = lazy(() => import("@/pages/admin/AdminSponsorsPage"));
const AdminPartnersPage = lazy(() => import("@/pages/admin/AdminPartnersPage"));
const AdminStickersPage = lazy(() => import("@/pages/admin/AdminStickersPage"));

const AboutPage = lazy(() => import("@/pages/public/AboutPage"));
const ContactPage = lazy(() => import("@/pages/public/ContactPage"));
const SponsorsPage = lazy(() => import("@/pages/public/SponsorsPage"));
const PartnersPage = lazy(() => import("@/pages/public/PartnersPage"));
const ReferencesPage = lazy(() => import("@/pages/public/ReferencesPage"));
const ReferenceDetailPage = lazy(() => import("@/pages/public/ReferencesPage").then((m) => ({ default: m.ReferenceDetailPage })));
const PlayersPage = lazy(() => import("@/pages/public/PlayersPage"));
const AchievementsShowcasePage = lazy(() => import("@/pages/public/AchievementsShowcasePage"));
const CommunityPage = lazy(() => import("@/pages/public/CommunityPage"));
const ServersPage = lazy(() => import("@/pages/public/ServersPage"));
const MembersDirectoryPage = lazy(() => import("@/pages/public/MembersDirectoryPage"));
const MemberProfilePage = lazy(() => import("@/pages/public/MemberProfilePage"));
const JoinMembershipPage = lazy(() => import("@/pages/public/JoinMembershipPage"));
const NewsDetailPage = lazy(() => import("@/pages/public/NewsDetailPage"));
const GalleryPage = lazy(() => import("@/pages/public/GalleryPage"));
const GalleryAlbumPage = lazy(() => import("@/pages/public/GalleryAlbumPage"));
const MemberAreaPage = lazy(() => import("@/pages/user/MemberAreaPage"));
const MemberBenefitsPage = lazy(() => import("@/pages/user/MemberBenefitsPage"));
const MemberDocumentsPage = lazy(() => import("@/pages/user/MemberDocumentsPage"));
const MemberNewsPage = lazy(() => import("@/pages/user/MemberNewsPage"));
const MyMembershipPage = lazy(() => import("@/pages/user/MyMembershipPage"));

const F1TVPage = lazy(() => import("@/pages/display/F1TVPage"));
const BracketTVPage = lazy(() => import("@/pages/display/BracketTVPage"));
const EventTVPage = lazy(() => import("@/pages/display/EventTVPage"));
const MyPrizesPage = lazy(() => import("@/pages/user/MyPrizesPage"));
const MyPenaltiesPage = lazy(() => import("@/pages/user/MyPenaltiesPage"));
const AdminPrizesPage = lazy(() => import("@/pages/admin/AdminPrizesPage"));
const AdminPenaltiesPage = lazy(() => import("@/pages/admin/AdminPenaltiesPage"));
const AdminContactPage = lazy(() => import("@/pages/admin/AdminContactPage"));
const AdminBoardPage = lazy(() => import("@/pages/admin/AdminBoardPage"));
const AdminReferencesPage = lazy(() => import("@/pages/admin/AdminReferencesPage"));
const AdminGameServersPage = lazy(() => import("@/pages/admin/AdminGameServersPage"));
const SetupWizardPage = lazy(() => import("@/pages/SetupWizardPage"));
const NotFoundPage = lazy(() => import("@/pages/ErrorPages").then((m) => ({ default: m.NotFoundPage })));
const ForbiddenPage = lazy(() => import("@/pages/ErrorPages").then((m) => ({ default: m.ForbiddenPage })));
const ServerErrorPage = lazy(() => import("@/pages/ErrorPages").then((m) => ({ default: m.ServerErrorPage })));
const BoardPage = lazy(() => import("@/pages/public/ClubPages").then((m) => ({ default: m.BoardPage })));
const ValuesPage = lazy(() => import("@/pages/public/ClubPages").then((m) => ({ default: m.ValuesPage })));
const CurrentSeasonRedirect = lazy(() => import("@/pages/public/CurrentSeasonRedirect"));

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <CookieConsentProvider>
          <ConfirmDialogProvider>
            <BrandingHead />
            <AnalyticsHead />
            <ApiInvalidationBridge />
            <ScrollManager />
            <AchievementCatchUp />
            <Toaster theme="dark" position="top-right" richColors />
            <AppErrorBoundary>
            <BottomNav />
            <Suspense fallback={<RouteFallback />}>
            <Routes>
          {/* Public — Verein */}
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/values" element={<ValuesPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/sponsors" element={<SponsorsPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/references" element={<ReferencesPage />} />
          <Route path="/references/:id" element={<ReferenceDetailPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/achievements" element={<AchievementsShowcasePage />} />
          <Route path="/members" element={<MembersDirectoryPage />} />
          <Route path="/members/:slug" element={<MemberProfilePage />} />
          <Route path="/membership/join" element={<JoinMembershipPage />} />
          <Route path="/membership/apply" element={<MembershipApplyPage />} />

          {/* Public — Arena */}
          <Route path="/esports" element={<EsportsOverviewPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:slug" element={<TournamentDetailPage />} />
          <Route path="/tournaments/:slug/bracket" element={<TournamentBracketPage />} />
          <Route path="/tournaments/:slug/matches" element={<TournamentSchedulePage />} />
          <Route path="/tournaments/:slug/standings" element={<TournamentStandingsPage />} />
          <Route path="/matches/:id" element={<MatchPage />} />
          <Route path="/f1" element={<FastLapLegacyRedirect />} />
          <Route path="/f1/:slug" element={<FastLapLegacyRedirect />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/:slug" element={<EventDetailPage />} />
          <Route path="/events/:slug/live" element={<EventLivePage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:id" element={<TeamsPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/news/:slug" element={<NewsDetailPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/imprint" element={<ImprintPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<EmailVerificationPage />} />

          {/* User */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
          <Route path="/messages/:userId" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
          <Route path="/hub/matches/:id" element={<ProtectedRoute><MatchHubPage /></ProtectedRoute>} />
          <Route path="/privacy-account" element={<ProtectedRoute><PrivacyAccountPage /></ProtectedRoute>} />
          <Route path="/consent" element={<ProtectedRoute><ConsentPage /></ProtectedRoute>} />

          {/* Member-only */}
          <Route path="/members/area" element={<ProtectedRoute requireMember><MemberAreaPage /></ProtectedRoute>} />
          <Route path="/members/benefits" element={<ProtectedRoute requireMember><MemberBenefitsPage /></ProtectedRoute>} />
          <Route path="/members/documents" element={<ProtectedRoute requireMember><MemberDocumentsPage /></ProtectedRoute>} />
          <Route path="/members/news" element={<ProtectedRoute requireMember><MemberNewsPage /></ProtectedRoute>} />
          <Route path="/members/membership" element={<ProtectedRoute requireMember><MyMembershipPage /></ProtectedRoute>} />

          {/* Admin */}
          <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboardPage /></ProtectedRoute>} />
          <Route path="/admin/members" element={<ProtectedRoute requireArea="club"><AdminMembersPage /></ProtectedRoute>} />
          <Route path="/admin/member-profiles" element={<ProtectedRoute requireArea="club"><AdminClubMemberProfilesPage /></ProtectedRoute>} />
          <Route path="/admin/benefits" element={<ProtectedRoute requireArea="club"><AdminBenefitsPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments" element={<ProtectedRoute requireModerator><AdminTournamentsPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments/new" element={<ProtectedRoute requireArea="tournaments"><AdminTournamentNewPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments/:id" element={<ProtectedRoute requireModerator><AdminTournamentEditPage /></ProtectedRoute>} />
          <Route path="/admin/f1" element={<ProtectedRoute requireModerator><AdminF1Page /></ProtectedRoute>} />
          <Route path="/admin/f1/new" element={<ProtectedRoute requireArea="tournaments"><AdminF1NewPage /></ProtectedRoute>} />
          <Route path="/admin/f1/:id" element={<ProtectedRoute requireModerator><AdminF1EditPage /></ProtectedRoute>} />
          <Route path="/admin/games" element={<ProtectedRoute requireArea="tournaments"><AdminGamesPage /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requireArea="club"><AdminUsersPage /></ProtectedRoute>} />
          <Route path="/admin/stations" element={<ProtectedRoute requireModerator><AdminStationsPage /></ProtectedRoute>} />
          <Route path="/admin/events" element={<ProtectedRoute requireArea="tournaments"><AdminEventsPage /></ProtectedRoute>} />
          <Route path="/admin/news" element={<ProtectedRoute requireArea="content"><AdminNewsPage /></ProtectedRoute>} />
          <Route path="/admin/gallery" element={<ProtectedRoute requireArea="content"><AdminGalleryPage /></ProtectedRoute>} />
          <Route path="/admin/documents" element={<ProtectedRoute requireArea="club"><AdminDocumentsPage /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute requireArea="system"><AdminSettingsPage /></ProtectedRoute>} />
          <Route path="/admin/seasons" element={<ProtectedRoute requireArea="tournaments"><AdminSeasonsPage /></ProtectedRoute>} />
          <Route path="/admin/logs" element={<ProtectedRoute requireArea="system"><AdminLogsPage /></ProtectedRoute>} />
          <Route path="/admin/ops" element={<ProtectedRoute requireArea="system"><AdminOpsPage /></ProtectedRoute>} />
          <Route path="/admin/audit" element={<ProtectedRoute requireArea="system"><AdminAuditPage /></ProtectedRoute>} />
          <Route path="/admin/moderation" element={<ProtectedRoute requireModerator><AdminModerationPage /></ProtectedRoute>} />
          <Route path="/admin/mobile-logs" element={<ProtectedRoute requireArea="system"><AdminMobileLogsPage /></ProtectedRoute>} />
          <Route path="/admin/mobile-push" element={<ProtectedRoute requireArea="system"><AdminMobilePushPage /></ProtectedRoute>} />
          <Route path="/admin/app-releases" element={<ProtectedRoute requireArea="system"><AdminAppReleasesPage /></ProtectedRoute>} />
          <Route path="/admin/downloads" element={<ProtectedRoute requireAdmin><AdminWidgetsPage /></ProtectedRoute>} />
          <Route path="/admin/widgets" element={<ProtectedRoute requireAdmin><AdminWidgetsPage /></ProtectedRoute>} />

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
          <Route path="/admin/game-servers" element={<ProtectedRoute requireArea="system"><AdminGameServersPage /></ProtectedRoute>} />
          <Route path="/admin/achievements" element={<ProtectedRoute requireArea="content"><AdminAchievementsPage /></ProtectedRoute>} />
          <Route path="/admin/stickers" element={<ProtectedRoute requireArea="content"><AdminStickersPage /></ProtectedRoute>} />
          <Route path="/admin/membership-applications" element={<ProtectedRoute requireArea="club"><AdminMembershipApplicationsPage /></ProtectedRoute>} />
          <Route path="/admin/cms" element={<ProtectedRoute requireArea="content"><AdminCmsPage /></ProtectedRoute>} />
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
          <Route path="/display/bracket/:id" element={<ProtectedRoute requireModerator><BracketTVPage /></ProtectedRoute>} />

          {/* Error pages */}
          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="/500" element={<ServerErrorPage />} />
          <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </Suspense>
            </AppErrorBoundary>
          </ConfirmDialogProvider>
        </CookieConsentProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
