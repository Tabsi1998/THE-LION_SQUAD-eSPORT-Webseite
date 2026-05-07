import "@/App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/tls/ProtectedRoute";
import { BrandingHead } from "@/components/tls/BrandingHead";
import { ApiInvalidationBridge } from "@/components/tls/ApiInvalidationBridge";
import { CookieConsentProvider } from "@/components/tls/CookieConsent";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

function RouteFallback() {
  return <div className="min-h-screen flex items-center justify-center text-white/40 font-display tracking-widest">LADE …</div>;
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

import HomePage from "@/pages/public/HomePage";
import TournamentsPage from "@/pages/public/TournamentsPage";
import TournamentDetailPage from "@/pages/public/TournamentDetailPage";
import TournamentBracketPage from "@/pages/public/TournamentBracketPage";
import TournamentStandingsPage from "@/pages/public/TournamentStandingsPage";
import F1ListPage from "@/pages/public/F1ListPage";
import F1DetailPage from "@/pages/public/F1DetailPage";
import EventsPage from "@/pages/public/EventsPage";
import EventDetailPage from "@/pages/public/EventDetailPage";
import TeamsPage from "@/pages/public/TeamsPage";
import NewsPage from "@/pages/public/NewsPage";
import LoginPage from "@/pages/public/LoginPage";
import RegisterPage from "@/pages/public/RegisterPage";
import { ForgotPasswordPage, ResetPasswordPage } from "@/pages/public/PasswordRecoveryPage";
import { PrivacyPage, ImprintPage } from "@/pages/public/LegalPages";

const DashboardPage = lazy(() => import("@/pages/user/DashboardPage"));
const ProfilePage = lazy(() => import("@/pages/user/ProfilePage"));
const MatchHubPage = lazy(() => import("@/pages/user/MatchHubPage"));
const PrivacyAccountPage = lazy(() => import("@/pages/user/PrivacyAccountPage"));

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
const AdminAuditPage = lazy(() => import("@/pages/admin/AdminAuditPage"));
const AdminWidgetsPage = lazy(() => import("@/pages/admin/AdminWidgetsPage"));
const AdminMembersPage = lazy(() => import("@/pages/admin/AdminMembersPage"));
const AdminClubMemberProfilesPage = lazy(() => import("@/pages/admin/AdminClubMemberProfilesPage"));
const AdminBenefitsPage = lazy(() => import("@/pages/admin/AdminBenefitsPage"));
const AdminGalleryPage = lazy(() => import("@/pages/admin/AdminGalleryPage"));
const AdminDocumentsPage = lazy(() => import("@/pages/admin/AdminDocumentsPage"));
import SeasonPage from "@/pages/public/SeasonPage";
const PublicProfilePage = lazy(() => import("@/pages/public/PublicProfilePage"));
const AdminAchievementsPage = lazy(() => import("@/pages/admin/AdminAchievementsPage"));
const AdminMembershipApplicationsPage = lazy(() => import("@/pages/admin/AdminMembershipApplicationsPage"));
const AdminCmsPage = lazy(() => import("@/pages/admin/AdminCmsPage"));
const AdminMediaPage = lazy(() => import("@/pages/admin/AdminMediaPage"));
const AdminNavPage = lazy(() => import("@/pages/admin/AdminNavPage"));
import MembershipApplyPage from "@/pages/public/MembershipApplyPage";
import AdminSponsorsPage from "@/pages/admin/AdminSponsorsPage";
import AdminPartnersPage from "@/pages/admin/AdminPartnersPage";

import AboutPage from "@/pages/public/AboutPage";
import ContactPage from "@/pages/public/ContactPage";
import SponsorsPage from "@/pages/public/SponsorsPage";
import PartnersPage from "@/pages/public/PartnersPage";
import PlayersPage from "@/pages/public/PlayersPage";
import CommunityPage from "@/pages/public/CommunityPage";
import MembersDirectoryPage from "@/pages/public/MembersDirectoryPage";
import MemberProfilePage from "@/pages/public/MemberProfilePage";
import JoinMembershipPage from "@/pages/public/JoinMembershipPage";
import NewsDetailPage from "@/pages/public/NewsDetailPage";
import GalleryPage from "@/pages/public/GalleryPage";
import GalleryAlbumPage from "@/pages/public/GalleryAlbumPage";
const MemberAreaPage = lazy(() => import("@/pages/user/MemberAreaPage"));
const MemberBenefitsPage = lazy(() => import("@/pages/user/MemberBenefitsPage"));
const MemberDocumentsPage = lazy(() => import("@/pages/user/MemberDocumentsPage"));
const MemberNewsPage = lazy(() => import("@/pages/user/MemberNewsPage"));
const MyMembershipPage = lazy(() => import("@/pages/user/MyMembershipPage"));

import F1TVPage from "@/pages/display/F1TVPage";
import BracketTVPage from "@/pages/display/BracketTVPage";
const MyPrizesPage = lazy(() => import("@/pages/user/MyPrizesPage"));
const MyPenaltiesPage = lazy(() => import("@/pages/user/MyPenaltiesPage"));
const AdminPrizesPage = lazy(() => import("@/pages/admin/AdminPrizesPage"));
const AdminPenaltiesPage = lazy(() => import("@/pages/admin/AdminPenaltiesPage"));
const AdminContactPage = lazy(() => import("@/pages/admin/AdminContactPage"));
const AdminBoardPage = lazy(() => import("@/pages/admin/AdminBoardPage"));
const SetupWizardPage = lazy(() => import("@/pages/SetupWizardPage"));
import { NotFoundPage, ForbiddenPage } from "@/pages/ErrorPages";
import { BoardPage, ValuesPage } from "@/pages/public/ClubPages";
import CurrentSeasonRedirect from "@/pages/public/CurrentSeasonRedirect";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <CookieConsentProvider>
          <ConfirmDialogProvider>
            <BrandingHead />
            <ApiInvalidationBridge />
            <Toaster theme="dark" position="top-right" richColors />
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
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/members" element={<MembersDirectoryPage />} />
          <Route path="/members/:slug" element={<MemberProfilePage />} />
          <Route path="/membership/join" element={<JoinMembershipPage />} />
          <Route path="/membership/apply" element={<MembershipApplyPage />} />

          {/* Public — Arena */}
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:slug" element={<TournamentDetailPage />} />
          <Route path="/tournaments/:slug/bracket" element={<TournamentBracketPage />} />
          <Route path="/tournaments/:slug/standings" element={<TournamentStandingsPage />} />
          <Route path="/f1" element={<FastLapLegacyRedirect />} />
          <Route path="/f1/:slug" element={<FastLapLegacyRedirect />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/:slug" element={<EventDetailPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:id" element={<TeamsPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/news/:slug" element={<NewsDetailPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/imprint" element={<ImprintPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* User */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/matches/:id" element={<ProtectedRoute><MatchHubPage /></ProtectedRoute>} />
          <Route path="/privacy-account" element={<ProtectedRoute><PrivacyAccountPage /></ProtectedRoute>} />

          {/* Member-only */}
          <Route path="/members/area" element={<ProtectedRoute requireMember><MemberAreaPage /></ProtectedRoute>} />
          <Route path="/members/benefits" element={<ProtectedRoute requireMember><MemberBenefitsPage /></ProtectedRoute>} />
          <Route path="/members/documents" element={<ProtectedRoute requireMember><MemberDocumentsPage /></ProtectedRoute>} />
          <Route path="/members/news" element={<ProtectedRoute requireMember><MemberNewsPage /></ProtectedRoute>} />
          <Route path="/members/membership" element={<ProtectedRoute requireMember><MyMembershipPage /></ProtectedRoute>} />

          {/* Admin */}
          <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboardPage /></ProtectedRoute>} />
          <Route path="/admin/members" element={<ProtectedRoute requireAdmin><AdminMembersPage /></ProtectedRoute>} />
          <Route path="/admin/member-profiles" element={<ProtectedRoute requireAdmin><AdminClubMemberProfilesPage /></ProtectedRoute>} />
          <Route path="/admin/benefits" element={<ProtectedRoute requireAdmin><AdminBenefitsPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments" element={<ProtectedRoute requireModerator><AdminTournamentsPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments/new" element={<ProtectedRoute requireAdmin><AdminTournamentNewPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments/:id" element={<ProtectedRoute requireModerator><AdminTournamentEditPage /></ProtectedRoute>} />
          <Route path="/admin/f1" element={<ProtectedRoute requireModerator><AdminF1Page /></ProtectedRoute>} />
          <Route path="/admin/f1/new" element={<ProtectedRoute requireAdmin><AdminF1NewPage /></ProtectedRoute>} />
          <Route path="/admin/f1/:id" element={<ProtectedRoute requireModerator><AdminF1EditPage /></ProtectedRoute>} />
          <Route path="/admin/games" element={<ProtectedRoute requireAdmin><AdminGamesPage /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requireAdmin><AdminUsersPage /></ProtectedRoute>} />
          <Route path="/admin/stations" element={<ProtectedRoute requireAdmin><AdminStationsPage /></ProtectedRoute>} />
          <Route path="/admin/events" element={<ProtectedRoute requireAdmin><AdminEventsPage /></ProtectedRoute>} />
          <Route path="/admin/news" element={<ProtectedRoute requireAdmin><AdminNewsPage /></ProtectedRoute>} />
          <Route path="/admin/gallery" element={<ProtectedRoute requireAdmin><AdminGalleryPage /></ProtectedRoute>} />
          <Route path="/admin/documents" element={<ProtectedRoute requireAdmin><AdminDocumentsPage /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute requireAdmin><AdminSettingsPage /></ProtectedRoute>} />
          <Route path="/admin/seasons" element={<ProtectedRoute requireAdmin><AdminSeasonsPage /></ProtectedRoute>} />
          <Route path="/admin/audit" element={<ProtectedRoute requireAdmin><AdminAuditPage /></ProtectedRoute>} />
          <Route path="/admin/widgets" element={<ProtectedRoute requireAdmin><AdminWidgetsPage /></ProtectedRoute>} />

          <Route path="/seasons/current" element={<CurrentSeasonRedirect />} />
          <Route path="/seasons/:slug" element={<SeasonPage />} />
          <Route path="/u/me" element={<MeRedirect />} />
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/players/:username" element={<PublicProfilePage />} />
          <Route path="/fastlap" element={<F1ListPage />} />
          <Route path="/fastlap/:slug" element={<F1DetailPage />} />
          <Route path="/galerie" element={<GalleryPage />} />
          <Route path="/galerie/:slug" element={<GalleryAlbumPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/gallery/:slug" element={<GalleryAlbumPage />} />

          {/* Admin */}
          <Route path="/admin/sponsors" element={<ProtectedRoute requireAdmin><AdminSponsorsPage /></ProtectedRoute>} />
          <Route path="/admin/partners" element={<ProtectedRoute requireAdmin><AdminPartnersPage /></ProtectedRoute>} />
          <Route path="/admin/achievements" element={<ProtectedRoute requireAdmin><AdminAchievementsPage /></ProtectedRoute>} />
          <Route path="/admin/membership-applications" element={<ProtectedRoute requireAdmin><AdminMembershipApplicationsPage /></ProtectedRoute>} />
          <Route path="/admin/cms" element={<ProtectedRoute requireAdmin><AdminCmsPage /></ProtectedRoute>} />
          <Route path="/admin/media" element={<ProtectedRoute requireAdmin><AdminMediaPage /></ProtectedRoute>} />
          <Route path="/admin/nav" element={<ProtectedRoute requireAdmin><AdminNavPage /></ProtectedRoute>} />
          <Route path="/admin/prizes" element={<ProtectedRoute requireAdmin><AdminPrizesPage /></ProtectedRoute>} />
          <Route path="/admin/penalties" element={<ProtectedRoute requireAdmin><AdminPenaltiesPage /></ProtectedRoute>} />
          <Route path="/admin/contact" element={<ProtectedRoute requireAdmin><AdminContactPage /></ProtectedRoute>} />
          <Route path="/admin/board" element={<ProtectedRoute requireAdmin><AdminBoardPage /></ProtectedRoute>} />

          {/* Setup wizard */}
          <Route path="/setup" element={<ProtectedRoute requireAdmin><SetupWizardPage /></ProtectedRoute>} />

          {/* User: Meine Gewinne */}
          <Route path="/my/prizes" element={<ProtectedRoute><MyPrizesPage /></ProtectedRoute>} />
          <Route path="/my/penalties" element={<ProtectedRoute><MyPenaltiesPage /></ProtectedRoute>} />

          {/* Display / TV */}
          <Route path="/display/f1/:id" element={<F1TVPage />} />
          <Route path="/display/bracket/:id" element={<BracketTVPage />} />

          {/* Error pages */}
          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </Suspense>
          </ConfirmDialogProvider>
        </CookieConsentProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
