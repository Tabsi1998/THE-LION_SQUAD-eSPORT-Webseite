import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Datenschutzhinweis für Gäste (#1665, Nr. 1): bis zur Freigabe durch den Superadmin sehen Gäste den Platzhalter.
const apiMock = { put: vi.fn() };
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal()), api: apiMock }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
const auth = { user: { id: "u1", role: "superadmin" } };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

const { SeasonPrivacyRelease, privacyReleaseState } = await import("./SeasonPrivacyRelease");

const TEXT = "Eigener Hinweis der Leitung.";

beforeEach(() => {
  apiMock.put.mockReset();
  apiMock.put.mockResolvedValue({ data: {} });
  auth.user = { id: "u1", role: "superadmin" };
});

test("ohne Text nichts, mit Text offen, freigegeben nur für genau diesen Wortlaut", () => {
  expect(privacyReleaseState({})).toEqual({ state: "empty" });
  expect(privacyReleaseState({ application_privacy_text: TEXT })).toEqual({ state: "open" });
  expect(privacyReleaseState({ application_privacy_text: TEXT, application_privacy_release: { text: TEXT, at: "2026-11-27T10:00:00Z" } }).state).toBe("released");
  expect(privacyReleaseState({ application_privacy_text: `${TEXT} Neu.`, application_privacy_release: { text: TEXT } }).state).toBe("open");
});

test("der Superadmin gibt frei - mit ungespeicherter Änderung erst nach dem Speichern", async () => {
  const onReload = vi.fn();
  const season = { application_privacy_text: TEXT };
  const { rerender } = render(<SeasonPrivacyRelease season={season} seasonId="s1" formText={`${TEXT} x`} onReload={onReload} />);
  expect(screen.getByTestId("season-privacy-release")).toHaveTextContent("Gäste – Konten ohne Mitgliedschaft – sehen bei der Anmeldung den Platzhalter-Satz");
  expect(screen.getByTestId("season-privacy-release-toggle")).toBeDisabled();
  rerender(<SeasonPrivacyRelease season={season} seasonId="s1" formText={TEXT} onReload={onReload} />);
  fireEvent.click(screen.getByTestId("season-privacy-release-toggle"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/privacy-release", { released: true }));
  await waitFor(() => expect(onReload).toHaveBeenCalled());
});

test("andere sehen den Stand, aber keinen Knopf", () => {
  auth.user = { id: "u2", role: "user" };
  render(<SeasonPrivacyRelease season={{ application_privacy_text: TEXT, application_privacy_release: { text: TEXT, at: "2026-11-27T10:00:00Z" } }}
    seasonId="s1" formText={TEXT} />);
  expect(screen.getByTestId("season-privacy-release")).toHaveTextContent("Für Gäste freigegeben am 27.11.2026");
  expect(screen.queryByTestId("season-privacy-release-toggle")).toBeNull();
});

/** Ein Fehler wie von axios: Status und deutscher Satz des Servers im Inhalt, die Nachricht ist die englische von axios. */
function serverRefusal(status, detail) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data: { detail } };
  return error;
}

test("eine Absage des Servers steht mit seinem deutschen Satz da", async () => {
  apiMock.put.mockRejectedValue(serverRefusal(403, "Den Hinweis zum Datenschutz für Gäste gibt nur der Superadmin frei, nach der rechtlichen Prüfung."));
  render(<SeasonPrivacyRelease season={{ application_privacy_text: TEXT }} seasonId="s1" formText={TEXT} />);
  fireEvent.click(screen.getByTestId("season-privacy-release-toggle"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(
    "Den Hinweis zum Datenschutz für Gäste gibt nur der Superadmin frei, nach der rechtlichen Prüfung."));
});

