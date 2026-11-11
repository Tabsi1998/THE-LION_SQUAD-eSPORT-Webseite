import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Anmelden mit Co-Team (docs/LIGA.md, B.4, #2205): geführt in vier Schritten, ohne Vorwissen. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: LeagueApplyPage } = await import("./LeagueApplyPage");

const SQUAD = { squad_id: "s1", squad_name: "Rudel", team_name: "Loewen", team_id: "t1", display_name: "Loewen · Rudel", member_count: 4, can_apply: true, state: "open", application: null, problems: [], warnings: [], can_submit: true };
const BLOCKED = { ...SQUAD, squad_id: "s2", squad_name: "Horde", display_name: "Loewen · Horde", problems: ["Horde hat 2 Spieler im Kader – die Liga verlangt mindestens 4."], can_submit: false };
const VIEW = {
  application: { state: "open", slots: 8, slots_free: 3 }, season_problems: [], hint: null, squads: [SQUAD, BLOCKED],
  rules: { version_id: "v1", version: 2, label: "Version 2", title: "Regelwerk", valid_from: "2026-11-01", url: "/liga/probe-liga/season-1/regeln", pdf_url: "/api/league-rules/seasons/probe-liga/season-1/versions/v1/pdf" },
  privacy: { text: "Der Verein speichert die Angaben.", url: "/privacy" },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/liga/probe-liga/season-1/anmelden"]}>
      <Routes>
        <Route path="/liga/:league/:season/anmelden" element={<LeagueApplyPage />} />
        <Route path="/liga/:league/:season" element={<p data-testid="season-page">Ligaseite</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  apiMock.get.mockResolvedValue({ data: VIEW });
});

async function toConsent() {
  fireEvent.click(await screen.findByTestId("apply-squad-s1"));
  fireEvent.click(screen.getByTestId("apply-next"));
  await screen.findByTestId("apply-check-ok");
  fireEvent.click(screen.getByTestId("apply-next"));
  await screen.findByTestId("apply-accept-rules");
}

test("der ganze Weg: wählen, prüfen, zustimmen, einreichen, zurück zur Ligaseite", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "a1", status: "submitted" } });
  renderPage();

  await toConsent();
  expect(screen.getByTestId("apply-rules-version")).toHaveTextContent("Version 2");
  expect(screen.getByTestId("apply-rules-link")).toHaveAttribute("href", "/liga/probe-liga/season-1/regeln");
  expect(screen.getByTestId("apply-privacy-text")).toHaveTextContent("Der Verein speichert");
  expect(screen.getByTestId("apply-privacy-link")).toHaveAttribute("href", "/privacy");
  expect(screen.getByTestId("apply-next")).toBeDisabled();

  fireEvent.click(screen.getByTestId("apply-accept-rules"));
  expect(screen.getByTestId("apply-next")).toBeDisabled();
  fireEvent.click(screen.getByTestId("apply-accept-privacy"));
  fireEvent.click(screen.getByTestId("apply-next"));

  expect(await screen.findByTestId("apply-summary")).toHaveTextContent("Loewen · Rudel");
  fireEvent.click(screen.getByTestId("apply-submit"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/leagues/probe-liga/season-1/applications", { squad_id: "s1", rule_version_id: "v1", accept_rules: true, accept_privacy: true }));
  expect(await screen.findByTestId("season-page")).toBeInTheDocument();
  expect(toastMock.success).toHaveBeenCalled();
});

// #2348: Mit „automatisch annehmen“ zählt das Einreichen gleich - Zusammenfassung und Meldung sagen das, ohne die Prüfung durch die Leitung.
test("mit automatischer Annahme sagt die Zusammenfassung, dass ihr gleich angemeldet seid", async () => {
  apiMock.get.mockResolvedValue({ data: { ...VIEW, application: { ...VIEW.application, auto_accept: true } } });
  apiMock.post.mockResolvedValue({ data: { id: "a1", status: "accepted" } });
  renderPage();
  await toConsent();
  fireEvent.click(screen.getByTestId("apply-accept-rules"));
  fireEvent.click(screen.getByTestId("apply-accept-privacy"));
  fireEvent.click(screen.getByTestId("apply-next"));

  expect(await screen.findByTestId("apply-summary-auto")).toHaveTextContent("seid ihr mit dem Einreichen angemeldet");
  expect(screen.getByTestId("apply-summary")).not.toHaveTextContent("Die Liga-Leitung prüft die Anmeldung");
  fireEvent.click(screen.getByTestId("apply-submit"));

  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Angemeldet. Ihr habt einen Startplatz."));
});

test("ohne automatische Annahme prüft die Leitung", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "a1", status: "submitted" } });
  renderPage();
  await toConsent();
  fireEvent.click(screen.getByTestId("apply-accept-rules"));
  fireEvent.click(screen.getByTestId("apply-accept-privacy"));
  fireEvent.click(screen.getByTestId("apply-next"));

  expect(await screen.findByTestId("apply-summary")).toHaveTextContent("Die Liga-Leitung prüft die Anmeldung");
  expect(screen.queryByTestId("apply-summary-auto")).toBeNull();
  fireEvent.click(screen.getByTestId("apply-submit"));

  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Anmeldung eingereicht. Die Liga-Leitung prüft sie jetzt."));
});

test("die Prüfung sagt im Klartext, was fehlt, und hält den Weg an", async () => {
  renderPage();

  fireEvent.click(await screen.findByTestId("apply-squad-s2"));
  fireEvent.click(screen.getByTestId("apply-next"));

  expect(await screen.findByTestId("apply-problems")).toHaveTextContent("mindestens 4");
  expect(screen.getByTestId("apply-next")).toBeDisabled();
  expect(screen.getByTestId("apply-team-link")).toHaveAttribute("href", "/teams?team=t1");
});

test("Warnungen halten nicht auf", async () => {
  apiMock.get.mockResolvedValue({ data: { ...VIEW, squads: [{ ...SQUAD, warnings: ["Tom: Spiel-ID fehlt."] }] } });
  renderPage();

  fireEvent.click(await screen.findByTestId("apply-squad-s1"));
  fireEvent.click(screen.getByTestId("apply-next"));

  expect(await screen.findByTestId("apply-warnings")).toHaveTextContent("Spiel-ID fehlt");
  expect(screen.getByTestId("apply-next")).toBeEnabled();
});

test("fehlende Angaben und zu wenige Spielberechtigte sind nur ein Hinweis, die Anmeldung geht weiter (#2313)", async () => {
  const shortfall = "Nur 2 von 4 Spielern sind spielberechtigt, für ein Spiel braucht ein Team mindestens 3. Bis zum ersten Spiel im Profil nachtragen. Sonst kann das Team nicht einchecken und gilt als nicht angetreten – die Liga-Leitung kann das Spiel dann kampflos werten.";
  apiMock.get.mockResolvedValue({ data: { ...VIEW, squads: [{ ...SQUAD, shortfall, warnings: ["Mila: Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein.", "Tom: Probe-ID fehlt im Profil."] }] } });
  renderPage();

  fireEvent.click(await screen.findByTestId("apply-next"));

  expect(await screen.findByTestId("apply-check-ok")).toHaveTextContent("Loewen · Rudel kann angemeldet werden.");
  expect(screen.queryByTestId("apply-problems")).toBeNull();
  expect(screen.queryByText(/Das fehlt noch/)).toBeNull();
  const hints = screen.getByTestId("apply-warnings");
  expect(hints).toHaveTextContent("Die Anmeldung geht trotzdem.");
  expect(hints).toHaveTextContent("Geburtsdatum fehlt");
  expect(hints).toHaveTextContent("kann nicht einchecken");
  expect(screen.getByTestId("apply-shortfall")).toHaveTextContent("Nur 2 von 4 Spielern");
  expect(screen.getByTestId("apply-next")).toBeEnabled();
});

test("die Prüfung nennt die Plattform der Season und abweichende Ligen (#2270)", async () => {
  const platform = { field_label: "Plattform", allowed: ["PC"], crossplay: false, input_device: null, divisions: [
    { id: "d1", label: "Liga 1", allowed: ["PC"], crossplay: false, input_device: null, differs: false },
    { id: "d2", label: "Liga 2", allowed: [], crossplay: true, input_device: null, differs: true },
  ] };
  apiMock.get.mockResolvedValue({ data: { ...VIEW, platform, squads: [{ ...SQUAD, warnings: ["Tom: Diese Season ist nur für PC – angegeben ist PlayStation."] }] } });
  renderPage();

  fireEvent.click(await screen.findByTestId("apply-squad-s1"));
  fireEvent.click(screen.getByTestId("apply-next"));

  const note = await screen.findByTestId("apply-platform");
  expect(note).toHaveTextContent("Plattform: nur PC.");
  expect(note).toHaveTextContent("Crossplay: aus.");
  expect(note).toHaveTextContent("Abweichend: Liga 2: alle Plattformen · Crossplay an.");
  expect(note).not.toHaveTextContent("Liga 1");
  expect(screen.getByTestId("apply-warnings")).toHaveTextContent("angegeben ist PlayStation");
});

test("ohne Plattform-Angabe steht nichts dazu", async () => {
  apiMock.get.mockResolvedValue({ data: { ...VIEW, platform: null, squads: [SQUAD] } });
  renderPage();

  fireEvent.click(await screen.findByTestId("apply-next"));

  expect(await screen.findByTestId("apply-check-ok")).toBeInTheDocument();
  expect(screen.queryByTestId("apply-platform")).toBeNull();
});

test("ein einziges Co-Team ist schon gewählt", async () => {
  apiMock.get.mockResolvedValue({ data: { ...VIEW, squads: [SQUAD] } });
  renderPage();

  expect(await screen.findByTestId("apply-squad-s1")).toBeChecked();
  expect(screen.getByTestId("apply-next")).toBeEnabled();
});

test("ohne eigenes Co-Team führt die Seite zurück und nennt den Hinweis", async () => {
  apiMock.get.mockResolvedValue({ data: { ...VIEW, squads: [{ ...SQUAD, can_apply: false }], hint: "Anmelden dürfen Captain und Vertreter." } });
  renderPage();

  expect(await screen.findByTestId("apply-none")).toHaveTextContent("Captain und Vertreter");
  expect(screen.queryByTestId("apply-next")).toBeNull();
});

test("ein Co-Team mit offenem Antrag steht da, ist aber nicht wählbar", async () => {
  apiMock.get.mockResolvedValue({ data: { ...VIEW, squads: [SQUAD, { ...SQUAD, squad_id: "s3", squad_name: "Meute", state: "submitted", application: { id: "a", status: "submitted" }, can_submit: false }] } });
  renderPage();

  expect(await screen.findByTestId("apply-squad-s3")).toBeDisabled();
  expect(screen.getByTestId("apply-squad-row-s3")).toHaveTextContent("Eingereicht");
});

test("eine neue Regelfassung führt zurück zur Zustimmung", async () => {
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Das Regelwerk hat sich geändert. Bitte die Seite neu laden und der neuen Fassung zustimmen." } } });
  renderPage();
  await toConsent();
  fireEvent.click(screen.getByTestId("apply-accept-rules"));
  fireEvent.click(screen.getByTestId("apply-accept-privacy"));
  fireEvent.click(screen.getByTestId("apply-next"));
  fireEvent.click(await screen.findByTestId("apply-submit"));

  await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  expect(await screen.findByTestId("apply-accept-rules")).not.toBeChecked();
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

test("ist das Fenster zu, sagt die Seite es und bietet keinen Weg", async () => {
  apiMock.get.mockResolvedValue({ data: { ...VIEW, application: { state: "closed" }, season_problems: ["Die Anmeldung ist vorbei."] } });
  renderPage();

  expect(await screen.findByTestId("apply-closed")).toHaveTextContent("vorbei");
});

test("eine unsichtbare Season sagt das wie die Ligaseite", async () => {
  apiMock.get.mockRejectedValue({ response: { status: 404 } });
  renderPage();

  expect(await screen.findByTestId("apply-missing")).toBeInTheDocument();
});
