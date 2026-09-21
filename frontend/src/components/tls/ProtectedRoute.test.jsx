import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Rechte nach Bereichen (#287): eine Seite verlangt einen Bereich, nicht einen Rang.

const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

const { ProtectedRoute } = await import("./ProtectedRoute");

function renderAt(path, element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/403" element={<div>verboten</div>} />
        <Route path="/login" element={<div>anmelden</div>} />
        <Route path="/profile" element={<div>mfa einrichten</div>} />
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

test("requireAdmin heißt irgendein Adminbereich; ohne Anmeldung geht es zum Login", () => {
  authState.user = { id: "u", role: "player", areas: ["club"], ...mfa };
  renderAt("/admin", <ProtectedRoute requireAdmin><div>tageszentrale</div></ProtectedRoute>);
  expect(screen.getByText("tageszentrale")).toBeInTheDocument();

  authState.user = null;
  renderAt("/admin", <ProtectedRoute requireAdmin><div>tageszentrale</div></ProtectedRoute>);
  expect(screen.getByText("anmelden")).toBeInTheDocument();
});
