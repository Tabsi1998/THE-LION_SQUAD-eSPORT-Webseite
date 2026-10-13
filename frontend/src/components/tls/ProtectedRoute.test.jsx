import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Rechte nach Bereichen (#287): eine Seite verlangt einen Bereich, nicht einen Rang.

const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

const { ProtectedRoute } = await import("./ProtectedRoute");

function MfaSetup() {
  const { search } = useLocation();
  return <div data-testid="mfa-setup" data-search={search}>mfa einrichten</div>;
}

function renderAt(path, element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/403" element={<div>verboten</div>} />
        <Route path="/login" element={<div>anmelden</div>} />
        <Route path="/profile" element={<MfaSetup />} />
      </Routes>
    </MemoryRouter>
  );
}

const mfa = { mfa_enabled: true, auth_mfa_verified: true };

test("eine Redakteurin kommt in die News, nicht in die Mitglieder", () => {
  authState.user = { id: "u", role: "player", areas: ["content"], ...mfa };
  renderAt("/admin/news", <ProtectedRoute requireArea="content"><div>news</div></ProtectedRoute>);
  expect(screen.getByText("news")).toBeInTheDocument();
});

test("ohne den Bereich landet man auf 403", () => {
  authState.user = { id: "u", role: "tournament_admin", areas: ["tournaments", "moderation"], ...mfa };
  renderAt("/admin/news", <ProtectedRoute requireArea="content"><div>news</div></ProtectedRoute>);
  expect(screen.getByText("verboten")).toBeInTheDocument();
});

test("ohne Zwei-Faktor geht es zur Einrichtung, außer für reine Moderation", () => {
  authState.user = { id: "u", role: "club_admin", areas: ["tournaments", "content", "club", "system", "moderation"], mfa_enabled: false };
  renderAt("/admin/members", <ProtectedRoute requireArea="club"><div>mitglieder</div></ProtectedRoute>);
  expect(screen.getByText("mfa einrichten")).toBeInTheDocument();

  authState.user = { id: "u", role: "moderator", areas: ["moderation"], mfa_enabled: false };
  renderAt("/admin/moderation", <ProtectedRoute requireArea="moderation"><div>meldungen</div></ProtectedRoute>);
  expect(screen.getByText("meldungen")).toBeInTheDocument();
});

test("Turnierseiten: Turnierleitung und Helfer mit Einsatz - Moderation allein nicht", () => {
  const page = <ProtectedRoute requireTournamentStaff><div>turniere</div></ProtectedRoute>;

  authState.user = { id: "u", role: "moderator", areas: ["moderation"], mfa_enabled: false };
  const refused = renderAt("/admin/tournaments", page);
  expect(screen.getByText("verboten")).toBeInTheDocument();
  refused.unmount();

  authState.user = { id: "u", role: "moderator", areas: ["moderation"], is_tournament_staff: true, mfa_enabled: false };
  const helper = renderAt("/admin/tournaments", page);
  expect(screen.getByText("turniere")).toBeInTheDocument();
  helper.unmount();

  authState.user = { id: "u", role: "tournament_admin", areas: ["tournaments", "moderation"], is_tournament_staff: true, ...mfa };
  renderAt("/admin/tournaments", page);
  expect(screen.getByText("turniere")).toBeInTheDocument();
});

test("requireAdmin heißt irgendein Adminbereich; ohne Anmeldung geht es zum Login", () => {
  authState.user = { id: "u", role: "player", areas: ["club"], ...mfa };
  renderAt("/admin", <ProtectedRoute requireAdmin><div>tageszentrale</div></ProtectedRoute>);
  expect(screen.getByText("tageszentrale")).toBeInTheDocument();

  authState.user = null;
  renderAt("/admin", <ProtectedRoute requireAdmin><div>tageszentrale</div></ProtectedRoute>);
  expect(screen.getByText("anmelden")).toBeInTheDocument();
});

// Turnierleitung (#1028): derselbe Vertrag wie im Server - die Leitung über alle Turniere (Rolle oder Freigabe) nur mit
// bestätigter Zwei-Faktor-Anmeldung, Helfer mit Einsatz ohne. Wer sonst einen Adminbereich hat, kommt nur als Helfer hinein.
test("die Turnierleitung mit Zwei-Faktor kommt in die Turnierseiten", () => {
  authState.user = { id: "u", role: "tournament_admin", areas: ["tournaments", "moderation"], is_tournament_staff: true, ...mfa };
  renderAt("/admin/tournaments", <ProtectedRoute requireTournamentStaff><div>turniere</div></ProtectedRoute>);
  expect(screen.getByText("turniere")).toBeInTheDocument();
});

test("die Turnierleitung ohne Zwei-Faktor geht zur Einrichtung - aus Rolle wie aus Freigabe", () => {
  const leads = [
    { id: "u", role: "tournament_admin", areas: ["tournaments", "moderation"], is_tournament_staff: true, mfa_enabled: false },
    { id: "u", role: "tournament_admin", areas: ["tournaments", "moderation"], is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: false },
    { id: "u", role: "player", areas: ["tournaments"], is_tournament_staff: true, mfa_enabled: false },
  ];
  for (const lead of leads) {
    authState.user = lead;
    const view = renderAt("/admin/f1", <ProtectedRoute requireTournamentStaff><div>fast lap</div></ProtectedRoute>);
    expect(screen.queryByText("fast lap")).toBeNull();
    const params = new URLSearchParams(screen.getByTestId("mfa-setup").dataset.search);
    expect(Object.fromEntries(params)).toEqual({ tab: "security", mfa: "required", next: "/admin/f1" });
    view.unmount();
  }
});

test("ein Helfer mit Einsatz kommt ohne Zwei-Faktor hinein, ein anderer Adminbereich ohne Einsatz nicht", () => {
  const page = <ProtectedRoute requireTournamentStaff><div>turniere</div></ProtectedRoute>;
  authState.user = { id: "u", role: "player", areas: [], is_tournament_staff: true, mfa_enabled: false };
  const helper = renderAt("/admin/tournaments", page);
  expect(screen.getByText("turniere")).toBeInTheDocument();
  helper.unmount();

  authState.user = { id: "u", role: "player", areas: ["content"], is_tournament_staff: false, ...mfa };
  renderAt("/admin/tournaments", page);
  expect(screen.getByText("verboten")).toBeInTheDocument();
});

test("eine Turnierleitung ohne Zwei-Faktor mit eigenem Helfer-Einsatz kommt in ihren Einsatz", () => {
  // Wie im Server (#1028): der Einsatz gilt ohne Zwei-Faktor weiter, die Rechte über alle Turniere nicht.
  authState.user = { id: "u", role: "tournament_admin", areas: ["tournaments", "moderation"], is_tournament_staff: true, has_staff_assignment: true, mfa_enabled: false };
  renderAt("/admin/tournaments", <ProtectedRoute requireTournamentStaff><div>turniere</div></ProtectedRoute>);
  expect(screen.getByText("turniere")).toBeInTheDocument();
});
