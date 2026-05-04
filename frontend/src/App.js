import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/tls/ProtectedRoute";

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
import { PrivacyPage, ImprintPage } from "@/pages/public/LegalPages";

import DashboardPage from "@/pages/user/DashboardPage";
import ProfilePage from "@/pages/user/ProfilePage";
import MatchHubPage from "@/pages/user/MatchHubPage";

import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import AdminTournamentsPage from "@/pages/admin/AdminTournamentsPage";
import AdminTournamentNewPage from "@/pages/admin/AdminTournamentNewPage";
import AdminTournamentEditPage from "@/pages/admin/AdminTournamentEditPage";
import AdminF1Page from "@/pages/admin/AdminF1Page";
import AdminF1NewPage from "@/pages/admin/AdminF1NewPage";
import AdminF1EditPage from "@/pages/admin/AdminF1EditPage";
import AdminGamesPage from "@/pages/admin/AdminGamesPage";
import AdminUsersPage from "@/pages/admin/AdminUsersPage";
import AdminStationsPage from "@/pages/admin/AdminStationsPage";
import AdminEventsPage from "@/pages/admin/AdminEventsPage";
import AdminNewsPage from "@/pages/admin/AdminNewsPage";
import AdminSettingsPage from "@/pages/admin/AdminSettingsPage";
import AdminSeasonsPage from "@/pages/admin/AdminSeasonsPage";
import AdminAuditPage from "@/pages/admin/AdminAuditPage";
import AdminWidgetsPage from "@/pages/admin/AdminWidgetsPage";
import SeasonPage from "@/pages/public/SeasonPage";

import F1TVPage from "@/pages/display/F1TVPage";
import BracketTVPage from "@/pages/display/BracketTVPage";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster theme="dark" position="top-right" richColors />
        <Routes>
          {/* Public */}
          <Route path="/" element={<HomePage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:slug" element={<TournamentDetailPage />} />
          <Route path="/tournaments/:slug/bracket" element={<TournamentBracketPage />} />
          <Route path="/tournaments/:slug/standings" element={<TournamentStandingsPage />} />
          <Route path="/f1" element={<F1ListPage />} />
          <Route path="/f1/:slug" element={<F1DetailPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/:slug" element={<EventDetailPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/imprint" element={<ImprintPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* User */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/matches/:id" element={<ProtectedRoute><MatchHubPage /></ProtectedRoute>} />

          {/* Admin */}
          <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboardPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments" element={<ProtectedRoute requireAdmin><AdminTournamentsPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments/new" element={<ProtectedRoute requireAdmin><AdminTournamentNewPage /></ProtectedRoute>} />
          <Route path="/admin/tournaments/:id" element={<ProtectedRoute requireAdmin><AdminTournamentEditPage /></ProtectedRoute>} />
          <Route path="/admin/f1" element={<ProtectedRoute requireAdmin><AdminF1Page /></ProtectedRoute>} />
          <Route path="/admin/f1/new" element={<ProtectedRoute requireAdmin><AdminF1NewPage /></ProtectedRoute>} />
          <Route path="/admin/f1/:id" element={<ProtectedRoute requireAdmin><AdminF1EditPage /></ProtectedRoute>} />
          <Route path="/admin/games" element={<ProtectedRoute requireAdmin><AdminGamesPage /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requireAdmin><AdminUsersPage /></ProtectedRoute>} />
          <Route path="/admin/stations" element={<ProtectedRoute requireAdmin><AdminStationsPage /></ProtectedRoute>} />
          <Route path="/admin/events" element={<ProtectedRoute requireAdmin><AdminEventsPage /></ProtectedRoute>} />
          <Route path="/admin/news" element={<ProtectedRoute requireAdmin><AdminNewsPage /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute requireAdmin><AdminSettingsPage /></ProtectedRoute>} />
          <Route path="/admin/seasons" element={<ProtectedRoute requireAdmin><AdminSeasonsPage /></ProtectedRoute>} />
          <Route path="/admin/audit" element={<ProtectedRoute requireAdmin><AdminAuditPage /></ProtectedRoute>} />
          <Route path="/admin/widgets" element={<ProtectedRoute requireAdmin><AdminWidgetsPage /></ProtectedRoute>} />

          <Route path="/seasons/:slug" element={<SeasonPage />} />

          {/* Display / TV */}
          <Route path="/display/f1/:id" element={<F1TVPage />} />
          <Route path="/display/bracket/:id" element={<BracketTVPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
