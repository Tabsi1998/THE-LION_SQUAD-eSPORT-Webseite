import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Fast Lap bearbeiten (#434): die Einstellungen liegen im Formular-Rahmen (Inhalt links,
// Veröffentlichung rechts, Speichern-Leiste unten) und schicken nur die Änderung.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const confirmMock = vi.fn(async () => true);
const promptMock = vi.fn(async () => "");
vi.mock("@/lib/api", () => ({
  API: "http://test.local/api",
  api: apiMock,
  formatRequestError: (_err, fallback) => fallback,
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: ({ testId }) => <textarea data-testid={testId} readOnly /> }));
vi.mock("@/components/tls/AccessLinksPanel", () => ({ AccessLinksPanel: () => <div data-testid="access-links" /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock, usePrompt: () => promptMock }));
let isTournamentLead = true;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ isAdmin: true, isTournamentLead, user: { id: "admin-1" } }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminF1EditPage = (await import("./AdminF1EditPage")).default;

const CHALLENGE = { id: "c-1", slug: "monza", title: "Monza Sprint", status: "draft", visibility: "public", tracks: [], platform: "PS5" };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/f1/c-1"]}>
      <Routes><Route path="/admin/f1/:id" element={<AdminF1EditPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (String(url).startsWith("/f1/challenges/c-1?")) return { data: CHALLENGE };
    return { data: [] };
  });
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: CHALLENGE });
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { id: "time-1" } });
  apiMock.delete.mockReset();
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  toastMock.info.mockReset();
  toastMock.error.mockReset();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  promptMock.mockReset();
  promptMock.mockResolvedValue("");
});

test("die Einstellungen stehen im Rahmen: Inhalt links, Veröffentlichung rechts, Speichern-Leiste", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { name: "Monza Sprint" })).toBeInTheDocument();
  const settings = screen.getByTestId("f1-edit-settings");
  expect(settings).toContainElement(screen.getByTestId("admin-form-main"));
  expect(screen.getByTestId("admin-form-aside")).toContainElement(screen.getByTestId("f1-edit-visibility"));
  expect(screen.getByTestId("f1-edit-title")).toHaveValue("Monza Sprint");
  expect(screen.getByTestId("f1-edit-save")).toBeInTheDocument();
});

test("Speichern schickt nur die Änderung; ohne Änderung nur ein Hinweis", async () => {
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });

  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Keine Änderungen zum Speichern."));
  expect(apiMock.patch).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("f1-edit-title"), { target: { value: "Monza Sprint 2026" } });
  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [url, patch] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/f1/challenges/c-1");
  expect(patch).toEqual(expect.objectContaining({ title: "Monza Sprint 2026" }));
  expect(patch).not.toHaveProperty("visibility");
});

test("Neue Strecke mit Zielzeit (#613): der Text wird zu Millisekunden, leer heißt keine Zielzeit, Unsinn wird gemeldet", async () => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { id: "tr-1" } });
  toastMock.error.mockReset();
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  fireEvent.change(screen.getByTestId("f1-new-track-name"), { target: { value: "Monza" } });
  fireEvent.change(screen.getByTestId("f1-new-track-target"), { target: { value: "1:32,450" } });
  fireEvent.click(screen.getByTestId("f1-add-track-btn"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
  const [url, body] = apiMock.post.mock.calls[0];
  expect(url).toBe("/f1/challenges/c-1/tracks");
  expect(body).toEqual(expect.objectContaining({ name: "Monza", target_time_ms: 92450, order_index: 0 }));
  expect(body).not.toHaveProperty("target_time");
  // Nach dem Speichern ist das Formular leer; ohne Zielzeit geht null mit.
  expect(screen.getByTestId("f1-new-track-target")).toHaveValue("");
  fireEvent.change(screen.getByTestId("f1-new-track-name"), { target: { value: "Spa" } });
  fireEvent.click(screen.getByTestId("f1-add-track-btn"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
  expect(apiMock.post.mock.calls[1][1]).toEqual(expect.objectContaining({ name: "Spa", target_time_ms: null }));
  // Unlesbare Zielzeit: Hinweis, kein Aufruf.
  fireEvent.change(screen.getByTestId("f1-new-track-name"), { target: { value: "Suzuka" } });
  fireEvent.change(screen.getByTestId("f1-new-track-target"), { target: { value: "schnell" } });
  fireEvent.click(screen.getByTestId("f1-add-track-btn"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Zielzeit bitte als m:ss.mmm angeben, z. B. 1:32.450."));
  expect(apiMock.post).toHaveBeenCalledTimes(2);
});

// Personensuche (#1354): der Fahrer kommt aus der Suche, nicht aus der ganzen Kontoliste; fehlt ein Recht für das Team,
// steht dort ein Satz und das Zeiten-Eintragen geht weiter.
test("Fahrer über die Personensuche: Zeit geht mit der Kennung, die Kontoliste wird nie geladen", async () => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { id: "time-1" } });
  apiMock.get.mockImplementation(async (url) => {
    if (String(url).startsWith("/f1/challenges/c-1?")) return { data: { ...CHALLENGE, tracks: [{ id: "tr-1", name: "Spa" }], block_club_member_results: true } };
    if (url === "/admin/people/search") return { data: [{ id: "u-7", name: "Erika Beispiel", context: "Mitglied", is_club_member: true }] };
    return { data: [] };
  });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  fireEvent.change(screen.getByTestId("f1-add-time-user-search"), { target: { value: "eri" } });
  fireEvent.click(await screen.findByTestId("f1-add-time-user-option-u-7"));
  // Vereinsmitglied bei gesperrter Wertung: nur Referenzzeit.
  await waitFor(() => expect(screen.getByTestId("f1-add-time-scope")).toHaveValue("club_reference"));
  fireEvent.change(screen.getByTestId("f1-add-time-value"), { target: { value: "1:24.587" } });
  fireEvent.click(screen.getByTestId("f1-add-time-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/challenges/c-1/times", expect.objectContaining({ user_id: "u-7", track_id: "tr-1", score_scope: "club_reference" })));
  expect(apiMock.get.mock.calls.map(([url]) => url)).not.toContain("/users");
});

test("fehlt das Recht für das Fast-Lap-Team, steht dort ein Satz – der Rest der Seite geht weiter", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (String(url).startsWith("/f1/challenges/c-1?")) return { data: { ...CHALLENGE, tracks: [{ id: "tr-1", name: "Spa" }] } };
    if (url === "/f1/challenges/c-1/staff") throw { response: { status: 403, data: { detail: "Keine Fast-Lap-Berechtigung für diese Aktion" } } };
    return { data: [] };
  });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  expect(await screen.findByTestId("f1-staff-error")).toHaveTextContent("Dafür fehlt dir das Recht, das Fast-Lap-Team zu sehen.");
  expect(screen.getByTestId("f1-add-time-value")).toBeInTheDocument();
  expect(screen.getByTestId("f1-staff-person-search")).toBeInTheDocument();
});

// Nachweis-Links (#1038): nur http(s) wird ein Link - ein alter Eintrag mit javascript: bleibt ohne Link.
test("Nachweis-Link nur bei http(s)", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (String(url).startsWith("/f1/challenges/c-1?")) return { data: { ...CHALLENGE, tracks: [{ id: "tr-1", name: "Spa" }] } };
    if (String(url).startsWith("/f1/challenges/c-1/times")) {
      return { data: [
        { id: "t-ok", attempt_number: 1, time_str: "1:24.587", user: { display_name: "Erika" }, proof_url: "https://example.test/clip" },
        { id: "t-alt", attempt_number: 2, time_str: "1:25.000", user: { display_name: "Otto" }, proof_url: "javascript:alert(1)" },
      ] };
    }
    return { data: [] };
  });
  renderPage();
  await screen.findByText("Otto");
  const links = screen.getAllByRole("link", { name: "Nachweis" });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute("href", "https://example.test/clip");
});

// #1584: ein Parser (Komma und Punkt), Rückfrage bei unplausibler Zeit und beim Löschen, Begründung nach der
// Veröffentlichung, Plausibilitätsgrenzen je Strecke, Hinweis am Ende.
const TIMES = [{ id: "t-1", attempt_number: 1, time_ms: 84587, time_str: "1:24.587", user: { display_name: "Erika" } }];

function answerWith(challenge) {
  apiMock.get.mockImplementation(async (url) => {
    if (String(url).startsWith("/f1/challenges/c-1?")) return { data: { ...CHALLENGE, tracks: [{ id: "tr-1", name: "Spa" }], ...challenge } };
    if (url === "/admin/people/search") return { data: [{ id: "u-7", name: "Erika Beispiel", context: "Community" }] };
    if (String(url).startsWith("/f1/challenges/c-1/times")) return { data: TIMES };
    return { data: [] };
  });
}

async function chooseDriverAndType(value) {
  fireEvent.change(screen.getByTestId("f1-add-time-user-search"), { target: { value: "eri" } });
  fireEvent.click(await screen.findByTestId("f1-add-time-user-option-u-7"));
  fireEvent.change(screen.getByTestId("f1-add-time-value"), { target: { value } });
  fireEvent.click(screen.getByTestId("f1-add-time-submit"));
}

test("Zeit mit Komma: 1:24,587 geht als 84587 ms", async () => {
  answerWith({});
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  await chooseDriverAndType("1:24,587");
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/challenges/c-1/times", expect.objectContaining({ time_ms: 84587 })));
  expect(confirmMock).not.toHaveBeenCalled();
});

test("unplausible Zeit: erst nachfragen; Nein speichert nichts, Ja schickt die Bestätigung mit", async () => {
  answerWith({});
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  confirmMock.mockResolvedValueOnce(false);
  await chooseDriverAndType("12");
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(confirmMock.mock.calls[0][0].description).toContain("0:12,000");
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("f1-add-time-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/challenges/c-1/times", expect.objectContaining({ time_ms: 12000, confirm_implausible: true })));
});

test("Löschen fragt nach; Abbrechen löscht nichts", async () => {
  answerWith({});
  renderPage();
  await screen.findByText("Erika");
  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("f1-delete-time-t-1"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(apiMock.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("f1-delete-time-t-1"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/f1/times/t-1", undefined));
});

test("nach der Veröffentlichung: Löschen und Eintragen nur mit Begründung", async () => {
  answerWith({ status: "results_published" });
  renderPage();
  await screen.findByText("Erika");
  expect(screen.getByTestId("f1-published-lock")).toHaveTextContent("Ergebnisse veröffentlicht");
  promptMock.mockResolvedValueOnce(null);
  fireEvent.click(screen.getByTestId("f1-delete-time-t-1"));
  await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1));
  expect(apiMock.delete).not.toHaveBeenCalled();
  promptMock.mockResolvedValueOnce("Doppelt eingetragen laut Video");
  fireEvent.click(screen.getByTestId("f1-delete-time-t-1"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/f1/times/t-1", { data: { change_reason: "Doppelt eingetragen laut Video" } }));
  promptMock.mockResolvedValueOnce("Nachtrag aus der Zeitnahme");
  await chooseDriverAndType("1:24.587");
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/challenges/c-1/times", expect.objectContaining({ change_reason: "Nachtrag aus der Zeitnahme" })));
});

test("Ergebnisse veröffentlichen fragt nach, weil danach Zeiten gesperrt sind", async () => {
  answerWith({ status: "live" });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  confirmMock.mockResolvedValueOnce(false);
  fireEvent.change(screen.getByTestId("f1-status-select"), { target: { value: "results_published" } });
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("nach dem Statuswechsel steht der Status auf Deutsch da, nicht als Kennung (Abnahme #1598)", async () => {
  answerWith({ status: "live" });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  toastMock.success.mockReset();
  fireEvent.change(screen.getByTestId("f1-status-select"), { target: { value: "results_published" } });
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Status: Ergebnisse veröffentlicht"));
});

test("Ende erreicht: die Seite sagt, dass die Leitung bestätigt", async () => {
  answerWith({ status: "live", end_date: "2026-01-01T10:00:00Z", public_phase: { state: "completed" } });
  renderPage();
  expect(await screen.findByTestId("f1-end-reached")).toHaveTextContent("die Ergebnisse veröffentlichen - erst dann entstehen die Saisonpunkte");
});

test("Beendet mit Zeiten: Hinweis auf die Saisonpunkte, Archivieren steht erst nach dem Veröffentlichen zur Wahl (#2130)", async () => {
  answerWith({ status: "completed", participant_count: 3 });
  renderPage();
  expect(await screen.findByTestId("f1-completed-hint")).toHaveTextContent("Saisonpunkte gibt es noch keine");
  const archived = [...screen.getByTestId("f1-status-select").options].find((option) => option.value === "archived");
  expect(archived.disabled).toBe(true);
  expect(archived.textContent).toContain("erst nach dem Veröffentlichen");
});

test("CSV nur für die Turnierleitung - ein Helfer bekäme sonst eine rohe 403 (#2130)", async () => {
  answerWith({ status: "live" });
  const lead = renderPage();
  expect(await screen.findByTestId("f1-export-csv")).toBeInTheDocument();
  lead.unmount();
  isTournamentLead = false;
  try {
    renderPage();
    await screen.findByRole("heading", { name: "Monza Sprint" });
    expect(screen.queryByTestId("f1-export-csv")).toBeNull();
  } finally {
    isTournamentLead = true;
  }
});

test("aus der Strafenliste: ?track= öffnet die Strecke mit der Zeit (#2130)", async () => {
  answerWith({ status: "live", tracks: [{ id: "tr-1", name: "Spa" }, { id: "tr-2", name: "Monza" }] });
  render(
    <MemoryRouter initialEntries={["/admin/f1/c-1?track=tr-2"]}>
      <Routes><Route path="/admin/f1/:id" element={<AdminF1EditPage />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Monza Sprint" });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/f1/challenges/c-1/times?track_id=tr-2"));
});

test("Veröffentlicht: Archivieren ist frei (#2130)", async () => {
  answerWith({ status: "results_published", participant_count: 3 });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  const archived = [...screen.getByTestId("f1-status-select").options].find((option) => option.value === "archived");
  expect(archived.disabled).toBe(false);
  expect(screen.queryByTestId("f1-completed-hint")).toBeNull();
});

test("Strecke: Plausibilitätsgrenzen werden zu Millisekunden", async () => {
  answerWith({});
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  fireEvent.change(screen.getByTestId("f1-new-track-name"), { target: { value: "Monza" } });
  fireEvent.change(screen.getByTestId("f1-new-track-min"), { target: { value: "1:10" } });
  fireEvent.change(screen.getByTestId("f1-new-track-max"), { target: { value: "2:30" } });
  fireEvent.click(screen.getByTestId("f1-add-track-btn"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/challenges/c-1/tracks", expect.objectContaining({ min_plausible_ms: 70000, max_plausible_ms: 150000 })));
});

test("nach der Veröffentlichung: „Vereinsmitglieder ausschließen“ ändern geht nur mit Begründung", async () => {
  answerWith({ status: "results_published" });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  fireEvent.click(screen.getByTestId("f1-edit-block-members"));
  promptMock.mockResolvedValueOnce(null);
  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1));
  expect(apiMock.patch).not.toHaveBeenCalled();
  promptMock.mockResolvedValueOnce("Mitglied fuhr irrtümlich offiziell");
  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/f1/challenges/c-1", expect.objectContaining({ block_club_member_results: true, change_reason: "Mitglied fuhr irrtümlich offiziell" })));
});

test("Meisterschaft, Punkte je Platz und Stream stehen im Bearbeiten; geschickt wird nur, was sich ändert (#2130)", async () => {
  answerWith({ status: "live", twitch_channel: "alt", twitch_enabled: true });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  expect(screen.queryByTestId("f1-edit-points")).toBeNull();
  expect(screen.getByTestId("f1-edit-stream-url")).toHaveValue("alt");
  fireEvent.click(screen.getByTestId("f1-edit-championship"));
  expect(screen.getByTestId("f1-edit-points")).toHaveValue("25, 18, 15, 12, 10, 8, 6, 4, 2, 1");
  fireEvent.change(screen.getByTestId("f1-edit-points"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Bitte die Punkte je Platz eintragen, z. B. 25, 18, 15."));
  expect(apiMock.patch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("f1-edit-points"), { target: { value: "10, 5" } });
  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/f1/challenges/c-1", { is_championship: true, points_per_position: [10, 5] }));
  expect(promptMock).not.toHaveBeenCalled();
});

test("nach der Veröffentlichung: Punkte je Platz ändern braucht eine Begründung (#2130)", async () => {
  answerWith({ status: "results_published", is_championship: true, points_per_position: [10, 5] });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  fireEvent.change(screen.getByTestId("f1-edit-points"), { target: { value: "12, 6" } });
  promptMock.mockResolvedValueOnce("Ausschreibung sah andere Punkte vor");
  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/f1/challenges/c-1", { points_per_position: [12, 6], change_reason: "Ausschreibung sah andere Punkte vor" }));
});

test("nach der Veröffentlichung: ein neuer Preis braucht eine Begründung", async () => {
  answerWith({ status: "results_published", prize_places: [{ place: 1, label: "Platz 1", value: "Pokal" }] });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  fireEvent.change(screen.getByTestId("f1-edit-prize-value-0"), { target: { value: "Großer Pokal" } });
  promptMock.mockResolvedValueOnce("Sponsor hat den Preis aufgewertet");
  fireEvent.click(screen.getByTestId("f1-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/f1/challenges/c-1", expect.objectContaining({ change_reason: "Sponsor hat den Preis aufgewertet" })));
  expect(promptMock).toHaveBeenCalledTimes(1);
});

test("scheitert der Abgleich, sagt die Seite es nach dem Speichern", async () => {
  answerWith({ status: "results_published" });
  apiMock.delete.mockResolvedValue({ data: { ok: true, resync_warning: "Korrektur gespeichert - Gewinne und Saisonpunkte ließen sich nicht angleichen, bitte prüfen." } });
  promptMock.mockResolvedValueOnce("Doppelt eingetragen laut Video");
  renderPage();
  await screen.findByText("Erika");
  fireEvent.click(screen.getByTestId("f1-delete-time-t-1"));
  await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(expect.stringContaining("bitte prüfen")));
});

test("ein Entwurf lässt sich nach Rückfrage löschen (#2112), danach geht es zur Liste", async () => {
  render(
    <MemoryRouter initialEntries={["/admin/f1/c-1"]}>
      <Routes>
        <Route path="/admin/f1/:id" element={<AdminF1EditPage />} />
        <Route path="/admin/f1" element={<div>Fast-Lap-Liste</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Monza Sprint" });
  fireEvent.click(screen.getByTestId("f1-delete-challenge"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/f1/challenges/c-1"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Entwurf löschen?" }));
  expect(await screen.findByText("Fast-Lap-Liste")).toBeInTheDocument();
});

test("ohne Rückfrage-Ja wird nichts gelöscht; außerhalb des Entwurfs gibt es keinen Löschen-Knopf", async () => {
  confirmMock.mockResolvedValue(false);
  const { unmount } = renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  fireEvent.click(screen.getByTestId("f1-delete-challenge"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalled());
  expect(apiMock.delete).not.toHaveBeenCalled();
  unmount();
  answerWith({ status: "live" });
  renderPage();
  await screen.findByRole("heading", { name: "Monza Sprint" });
  expect(screen.queryByTestId("f1-delete-challenge")).not.toBeInTheDocument();
});

test("Gästeliste (#2112): umbenennen und Gäste ohne Zeiten löschen", async () => {
  const guests = [
    { id: "g-1", display_name: "Anna", has_times: true },
    { id: "g-2", display_name: "Ben", has_times: false },
  ];
  apiMock.get.mockImplementation(async (url) => {
    if (String(url).startsWith("/f1/challenges/c-1?")) return { data: CHALLENGE };
    if (url === "/f1/challenges/c-1/guests") return { data: guests };
    return { data: [] };
  });
  promptMock.mockResolvedValueOnce("Gast 1");
  renderPage();
  expect(await screen.findByTestId("f1-guests-panel")).toBeInTheDocument();
  expect(screen.queryByTestId("f1-guest-delete-g-1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("f1-guest-rename-g-1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/f1/guests/g-1", { display_name: "Gast 1" }));
  fireEvent.click(screen.getByTestId("f1-guest-delete-g-2"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/f1/guests/g-2"));
});

test("nach der Veröffentlichung braucht das Umbenennen eine Begründung", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (String(url).startsWith("/f1/challenges/c-1?")) return { data: { ...CHALLENGE, status: "results_published" } };
    if (url === "/f1/challenges/c-1/guests") return { data: [{ id: "g-1", display_name: "Anna", has_times: true }] };
    return { data: [] };
  });
  promptMock.mockResolvedValueOnce("Gast 1").mockResolvedValueOnce("Gast will anonym bleiben");
  renderPage();
  fireEvent.click(await screen.findByTestId("f1-guest-rename-g-1"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/f1/guests/g-1", { display_name: "Gast 1", change_reason: "Gast will anonym bleiben" }));
});
test("nach der Veröffentlichung braucht das Löschen eines Gastes eine Begründung", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (String(url).startsWith("/f1/challenges/c-1?")) return { data: { ...CHALLENGE, status: "results_published" } };
    if (url === "/f1/challenges/c-1/guests") return { data: [{ id: "g-2", display_name: "Ben", has_times: false }] };
    return { data: [] };
  });
  promptMock.mockResolvedValueOnce("Doppelt angelegt, nie gefahren");
  renderPage();
  fireEvent.click(await screen.findByTestId("f1-guest-delete-g-2"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/f1/guests/g-2", { data: { change_reason: "Doppelt angelegt, nie gefahren" } }));
});