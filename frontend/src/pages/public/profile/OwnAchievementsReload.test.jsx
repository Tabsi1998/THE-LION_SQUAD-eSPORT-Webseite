import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Profil → Erfolge lud ohne Ende neu: das Öffnen wertet einmal aus (POST /achievements/evaluate). Jeder POST meldet eine
// Änderung an „achievements“ (Client-Interceptor und Server-Strom) - die Profilseite lud darauf mit „LADE PROFIL …“ neu,
// hängte dabei die eigenen Erfolge aus und wieder ein, und die frisch eingehängten werteten wieder aus. Hier läuft der
// echte api-Client (nur der Adapter ist nachgestellt) mit der echten Invalidierung, dazu Catch-up und Level-Erkennung.

const authState = vi.hoisted(() => ({ user: { id: "u1", username: "paula" } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => false, consent: {}, allow: () => {} }) }));
vi.mock("@/components/tls/LevelAvatarFrame", () => ({ LevelAvatarFrame: ({ children, testId }) => <div data-testid={testId}>{children}</div>, useCrownFor: () => null }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/achievements/ceremony/queue", () => ({ enqueueCeremony: vi.fn(), enqueueLevelUp: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { api } = await import("@/lib/api");
const { default: PublicProfilePage } = await import("../PublicProfilePage");
const { AchievementCatchUp } = await import("@/components/tls/AchievementCatchUp");
const { LevelUpCelebration } = await import("@/components/tls/LevelUpCelebration");
const { ConfirmDialogProvider } = await import("@/components/tls/ConfirmDialog");
const { emitApiInvalidation } = await import("@/lib/apiInvalidation");

const PROFILE = {
  id: "u1", username: "paula", display_name: "Paula B.", role: "member", created_at: "2025-03-01T00:00:00Z", privacy_public_profile: true,
  stats: { points: 900, level: 9 }, achievement_level: { level: 9, points: 900, next_level_points: 1000, progress: 40 },
  tournaments: [], f1_bests: [], awards: [], teams: [], references: { stats: {}, items: [] },
};
const TIER = (code, earnedAt) => ({ code, name: code, level: 3, level_name: "Gold", material_name: "Gold", points: 50, earned: true, earned_at: earnedAt });
const ME = {
  level: { level: 9, title: "Jäger", prestige: 0, points: 900, next_level_points: 1000 },
  groups: [{ code: "sieg", name: "Siege", category: "play", tiers: [TIER("sieg-1", "2026-10-01T10:00:00Z"), TIER("sieg-2", "2026-10-13T10:00:00Z")] }],
  awards: [{ code: "sieg-1", award_id: "a1", name: "Sieg I" }, { code: "sieg-2", award_id: "a2", name: "Sieg II" }],
  pinned_codes: ["sieg-1", "sieg-2"],
  pinned: [{ code: "sieg-1", name: "Sieg I" }, { code: "sieg-2", name: "Sieg II" }],
  next_up: [],
};

const calls = [];
const failing = new Set();
function respond(config) {
  const method = (config.method || "get").toUpperCase();
  const url = config.url || "";
  calls.push(`${method} ${url}`);
  if (failing.has(url)) {
    return new Promise((_, reject) => { setTimeout(() => reject(Object.assign(new Error("500"), { config, response: { status: 500, data: {}, headers: {}, config } })), 20); });
  }
  let data = [];
  if (url === "/users/public/paula") data = PROFILE;
  else if (url === "/achievements/me") data = ME;
  else if (url === "/achievements/evaluate") data = { newly_awarded: 1 };
  else if (url === "/achievements/me/pins") data = { pinned_codes: ME.pinned_codes, pinned: ME.pinned };
  else if (url === "/achievements/user/u1") data = { groups: ME.groups, awards: ME.awards };
  else if (url === "/users/me/profile-completeness") data = { score: 80, missing: [] };
  else if (url === "/users/me/level") data = { level: 10, title: "Jäger", prestige: 0 };
  // Wie im Netz: die Antwort kommt etwas später - sonst fasst React „lädt“ und „fertig“ in einem Zug zusammen.
  return new Promise((resolve) => { setTimeout(() => resolve({ data, status: 200, statusText: "OK", headers: {}, config, request: {} }), 20); });
}

const count = (entry) => calls.filter((call) => call === entry).length;
const originalAdapter = api.defaults.adapter;

beforeEach(() => {
  calls.length = 0;
  failing.clear();
  api.defaults.adapter = respond;
  localStorage.clear();
  // Ein schon gesehener Stand: Catch-up und Level-up haben etwas zu feiern.
  localStorage.setItem("tls_ach_seen:u1", "2026-10-05T00:00:00Z");
  localStorage.setItem("tls-level-seen:u1", JSON.stringify({ level: 9, title: "Jäger", prestige: 0 }));
});
afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

test("Profil → Erfolge: einmal auswerten, dann bleibt es ruhig - kein Neuladen ohne Ende", async () => {
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/u/paula?tab=achievements"]}>
        <AchievementCatchUp />
        <LevelUpCelebration />
        <Routes><Route path="/u/:username" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
  expect(await screen.findByTestId("profile-own-achievements")).toBeInTheDocument();
  // Zwei Sekunden zuschauen: jede Runde der Schleife dauert nur die Entprellung (150 ms) plus die Antworten.
  // Bewusst ohne act(): act hielte die Updates bis zum Ende zurück und versteckte das Aus- und Einhängen.
  await new Promise((resolve) => { setTimeout(resolve, 2000); });

  expect(screen.getByTestId("profile-own-achievements")).toBeInTheDocument();
  expect(count("POST /achievements/evaluate")).toBe(1);
  expect(count("PUT /achievements/me/pins")).toBe(0);
  // Die Änderung darf die Seite einmal still nachladen - aber nicht immer wieder.
  expect(count("GET /users/public/paula")).toBeLessThanOrEqual(2);
  expect(count("GET /achievements/me")).toBeLessThanOrEqual(3);
}, 10000);

test("stilles Nachladen scheitert: der bisherige Stand bleibt stehen, kein „Spieler nicht gefunden“", async () => {
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/u/paula?tab=achievements"]}>
        <Routes><Route path="/u/:username" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
  expect(await screen.findByTestId("profile-own-achievements")).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 500); });
  const before = count("GET /users/public/paula");
  failing.add("/users/public/paula");
  failing.add("/achievements/user/u1");
  // Eine Änderung aus dem Strom des Servers, wie sie Staff-Konten bekommen.
  emitApiInvalidation({ source: "server", event_id: "evt-quiet-1", method: "POST", path: "/api/achievements/evaluate", resource: "achievements" });
  await new Promise((resolve) => { setTimeout(resolve, 500); });

  expect(count("GET /users/public/paula")).toBe(before + 1);
  expect(screen.queryByText("Spieler nicht gefunden")).toBeNull();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Paula B.");
  expect(screen.getByTestId("profile-own-achievements")).toBeInTheDocument();
  expect(count("POST /achievements/evaluate")).toBe(1);
}, 10000);
