import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// „Mein Bereich“ (#2059): Seitenleiste mit den Gruppen (Verein nur für Mitglieder), „Zu tun“ aus vorhandenen Daten,
// Reiter unter „Rechnungen & Unterlagen“ und die Weiterleitung der alten Adressen. Erfundene Daten, keine echten Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const authState = { user: null, adminNeedsSecondFactor: false };

vi.mock("@/lib/api", () => ({
  api: apiMock,
  API: "/api",
  formatApiError: (value) => String(value || ""),
  formatRequestError: (_error, fallback) => fallback,
  formatMemberSince: (value) => String(value || ""),
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ ...authState, refresh: vi.fn(), logout: vi.fn() }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div data-testid="public-layout">{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({ settings: {}, loading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { default: MeinBereichLayout } = await import("./MeinBereichLayout");
const { default: UebersichtSeite } = await import("./UebersichtSeite");
const { RechnungenSeite, MitgliedschaftSeite } = await import("./GruppenSeiten");
const { MeinBereichUmleitung } = await import("./Umleitung");
const { BereichSeite } = await import("./BereichSeite");
const { useEffect, useState } = await import("react");

function Wo() {
  const location = useLocation();
  return <div data-testid="wo" data-path={location.pathname} data-search={location.search} data-hash={location.hash} />;
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/mein-bereich" element={<MeinBereichLayout />}>
          <Route index element={<UebersichtSeite />} />
          <Route path="rechnungen" element={<RechnungenSeite />} />
          <Route path="mitgliedschaft" element={<MitgliedschaftSeite />} />
          <Route path="*" element={<Wo />} />
        </Route>
        {["/profile", "/members/area", "/members/membership", "/members/meetings", "/account/invoices", "/account/documents", "/my/prizes", "/my/penalties", "/privacy-account"].map((path) => (
          <Route key={path} path={path} element={<MeinBereichUmleitung />} />
        ))}
        <Route path="*" element={<Wo />} />
      </Routes>
      <Wo />
    </MemoryRouter>,
  );
}

function serve(extra = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url in extra) return { data: extra[url] };
    if (url === "/account/invoices") return { data: { summary: { count: 0, open_count: 0 }, invoices: [] } };
    if (url === "/prizes/me/open-count") return { data: { count: 0 } };
    return { data: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: "u-1", username: "nachtfuchs", display_name: "Nachtfuchs", is_club_member: false };
  authState.adminNeedsSecondFactor = false;
  serve();
});

test("Seitenleiste: acht Gruppen für Mitglieder, ohne Verein für alle anderen; die aktive ist die aktuelle Seite", async () => {
  renderAt("/mein-bereich");
  const nav = await screen.findByTestId("mein-bereich-nav");
  expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Übersicht", "Profil", "Mitgliedschaft", "Rechnungen & Unterlagen", "Benachrichtigungen", "Konto & Sicherheit", "Datenschutz",
  ]);
  expect(within(nav).getByTestId("mein-bereich-nav-start")).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Mein Bereich");
});

test("Mitglieder sehen Verein; ohne Mitgliedschaft zeigt die Gruppe den Weg hinein", async () => {
  authState.user = { ...authState.user, is_club_member: true };
  const view = renderAt("/mein-bereich");
  expect(await screen.findByTestId("mein-bereich-nav-verein")).toHaveAttribute("href", "/mein-bereich/verein");
  view.unmount();

  authState.user = { ...authState.user, is_club_member: false };
  renderAt("/mein-bereich/mitgliedschaft");
  expect(await screen.findByTestId("membership-join-cta")).toHaveAttribute("href", "/membership/join");
  expect(screen.getByTestId("mein-bereich-nav-mitgliedschaft")).toHaveAttribute("aria-current", "page");
});

test("Zu tun: offene Rechnung und Nummer wählen als große Knöpfe, die Zahl steht an der Gruppe", async () => {
  authState.user = { ...authState.user, is_club_member: true };
  serve({
    "/account/invoices": { currency: "EUR", summary: { count: 2, open_count: 1, open_total: 25, overdue_count: 0 }, invoices: [] },
    "/membership/me/jersey-number": { available: true, can_choose: true, number: null },
  });
  renderAt("/mein-bereich");
  const rechnung = await screen.findByTestId("mein-bereich-todo-rechnung");
  expect(rechnung).toHaveAttribute("href", "/mein-bereich/rechnungen");
  expect(rechnung).toHaveTextContent("Offene Rechnung bezahlen");
  expect(screen.getByTestId("mein-bereich-todo-nummer")).toHaveAttribute("href", "/mein-bereich/mitgliedschaft#nummer");
  expect(screen.getByTestId("mein-bereich-nav-rechnungen")).toHaveAttribute("aria-label", "Rechnungen & Unterlagen, 1 offen");
  expect(apiMock.get).toHaveBeenCalledWith("/membership/me/jersey-number");
});

test("Zu tun leer: ein Satz statt einer leeren Liste; ohne Mitgliedschaft keine Abfragen des Vereins", async () => {
  renderAt("/mein-bereich");
  expect(await screen.findByTestId("mein-bereich-todo-empty")).toHaveTextContent("Alles erledigt");
  expect(apiMock.get).not.toHaveBeenCalledWith("/membership/me");
  expect(screen.getByTestId("mein-bereich-schnell-loeschung")).toHaveAttribute("href", "/mein-bereich/datenschutz?tab=loeschung");
  expect(screen.queryByTestId("mein-bereich-schnell-nummer")).toBeNull();
});

test("Rechnungen & Unterlagen: vier Reiter, der Reiter steht in der Adresse", async () => {
  const user = userEvent.setup();
  renderAt("/mein-bereich/rechnungen");
  const reiter = await screen.findByTestId("mein-bereich-reiter");
  expect(within(reiter).getAllByRole("button").map((button) => button.textContent.trim())).toEqual(["Rechnungen", "Unterlagen", "Gewinne", "Strafen"]);
  expect(screen.getByTestId("mein-bereich-tab-rechnungen")).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByTestId("mein-bereich-tab-strafen"));
  await waitFor(() => expect(screen.getAllByTestId("wo").at(-1)).toHaveAttribute("data-search", "?tab=strafen"));
  expect(screen.getByTestId("mein-bereich-tab-strafen")).toHaveAttribute("aria-current", "page");
});

test.each([
  ["/profile?tab=security&mfa=required", "/mein-bereich/konto", "?mfa=required", ""],
  ["/members/area#versammlung", "/mein-bereich/verein", "", "#versammlung"],
  ["/members/membership#mitgliedskarte", "/mein-bereich/mitgliedschaft", "", "#mitgliedskarte"],
  ["/members/meetings?meeting=4", "/mein-bereich/verein/versammlungen", "?meeting=4", ""],
  ["/account/invoices?invoice=d-12", "/mein-bereich/rechnungen", "?invoice=d-12", ""],
  ["/my/penalties", "/mein-bereich/rechnungen", "?tab=strafen", ""],
  ["/privacy-account", "/mein-bereich/datenschutz", "?tab=daten", ""],
  ["/profile?tab=inbox&to=u-9", "/messages/u-9", "", ""],
])("alte Adresse %s → %s%s%s", async (from, path, search, hash) => {
  renderAt(from);
  await waitFor(() => expect(screen.getAllByTestId("wo").at(-1)).toHaveAttribute("data-path", path));
  const where = screen.getAllByTestId("wo").at(-1);
  expect(where).toHaveAttribute("data-search", search);
  expect(where).toHaveAttribute("data-hash", hash);
});

// Fokus nach einem Wechsel (Prüfung #2059): unabhängig davon, ob die Gruppe oder der Rahmen zuerst fertig ist - so wie
// im Produktions-Build, wo Effekte der Seite vor denen des Rahmens laufen.
function Gruppe({ title, children }) {
  return <BereichSeite title={title} testId={`gruppe-${title}`}>{children}</BereichSeite>;
}

test("Wechsel in der Seitenleiste: der Fokus landet auf der Überschrift der neuen Gruppe", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/mein-bereich/profil"]}>
      <Routes>
        <Route path="/mein-bereich" element={<MeinBereichLayout />}>
          <Route path="profil" element={<Gruppe title="Profil" />} />
          <Route path="konto" element={<Gruppe title="Konto & Sicherheit" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { level: 1, name: "Profil" })).not.toHaveFocus();
  await user.click(screen.getByTestId("mein-bereich-nav-konto"));
  const heading = await screen.findByRole("heading", { level: 1, name: "Konto & Sicherheit" });
  await waitFor(() => expect(heading).toHaveFocus());
});

test("ein Reiterwechsel ist kein Gruppenwechsel: der Fokus bleibt auf dem Reiter", async () => {
  const user = userEvent.setup();
  renderAt("/mein-bereich/rechnungen");
  const strafen = await screen.findByTestId("mein-bereich-tab-strafen");
  await user.click(strafen);
  await waitFor(() => expect(screen.getByTestId("mein-bereich-tab-strafen")).toHaveAttribute("aria-current", "page"));
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();
  expect(screen.getByTestId("mein-bereich-tab-strafen")).toHaveFocus();
});

// Anker, deren Ziel erst nach dem Laden kommt (Prüfung #2059): #nummer steht in einer Karte, die ihre Daten selbst holt.
function SpaeteKarte() {
  const [da, setDa] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDa(true), 120);
    return () => clearTimeout(timer);
  }, []);
  return <Gruppe title="Mitgliedschaft">{da ? <div id="nummer" data-testid="spaete-karte">Meine Nummer</div> : <p>lädt</p>}</Gruppe>;
}

test("Wunschnummer aus „Häufig gebraucht“: der Sprung wartet, bis die Karte da ist", async () => {
  const user = userEvent.setup();
  authState.user = { ...authState.user, is_club_member: true };
  const scrolled = [];
  const original = window.Element.prototype.scrollIntoView;
  window.Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.id || this.tagName); };
  try {
    render(
      <MemoryRouter initialEntries={["/mein-bereich"]}>
        <Routes>
          <Route path="/mein-bereich" element={<MeinBereichLayout />}>
            <Route index element={<UebersichtSeite />} />
            <Route path="mitgliedschaft" element={<SpaeteKarte />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByTestId("mein-bereich-schnell-nummer"));
    expect(await screen.findByTestId("spaete-karte")).toBeInTheDocument();
    await waitFor(() => expect(scrolled).toContain("nummer"));
  } finally {
    window.Element.prototype.scrollIntoView = original;
  }
});
