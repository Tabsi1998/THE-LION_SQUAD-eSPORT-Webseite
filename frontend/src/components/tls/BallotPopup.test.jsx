import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Abstimmung live (#844): Popup auf jeder Seite für Mitglieder mit offenem Stimmrecht; Antwort wählen, abgeben; „Später“
// wird ein Band; geheime Wahl nur als Hinweis; im Admin still; ohne Feed fragt die Seite in kurzem Takt selbst nach.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const authState = { user: { id: "u1" }, isClubMember: true };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { BallotPopup, rightLabel } = await import("./BallotPopup");

const OPTIONS = [{ code: "yes", label: "Ja" }, { code: "no", label: "Nein" }, { code: "abstain", label: "Enthaltung" }];
const OWN = { right_id: 1012, for: "self", name: "", state: "open", can_use: true };
const BALLOT = { id: 7, meeting: "Generalversammlung 2026", item: 3, kind_label: "Beschluss", question: "Entlastung des Vorstands", secret: false, can_vote: true, options: OPTIONS, rights: [OWN] };
const SECRET = { ...BALLOT, id: 8, item: 4, kind_label: "Wahl", question: "Wahl der Obfrau", secret: true, can_vote: false, rights: [{ ...OWN, right_id: 1013, can_use: false }] };

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: "u1" };
  authState.isClubMember = true;
});

function show(path = "/") {
  return render(<MemoryRouter initialEntries={[path]}><BallotPopup /></MemoryRouter>);
}

test("Beschriftung je Stimmrecht", () => {
  expect(rightLabel(OWN)).toBe("Deine Stimme");
  expect(rightLabel({ ...OWN, for: "proxy", name: "Anna Muster" })).toBe("Vollmacht für Anna Muster");
});

test("offene Abstimmung: Antwort wählen, abgeben, danach weg", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { available: true, ballots: [BALLOT], live: true, poll_seconds: 0 } })
    .mockResolvedValue({ data: { available: true, ballots: [], live: true, poll_seconds: 0 } });
  apiMock.post.mockResolvedValue({ data: {} });
  show();
  expect(await screen.findByTestId("ballot-popup")).toHaveTextContent("Entlastung des Vorstands");
  expect(screen.getByText(/Deine Stimme wird mit deinem Namen gespeichert/)).toBeInTheDocument();
  expect(screen.getByTestId("ballot-popup-cast")).toBeDisabled();
  fireEvent.click(screen.getByTestId("ballot-option-1012-yes"));
  fireEvent.click(screen.getByTestId("ballot-popup-cast"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/membership/me/ballots/7/votes", { right_id: 1012, option: "yes" }));
  await waitFor(() => expect(screen.queryByTestId("ballot-popup")).toBeNull());
  expect(toastMock.success).toHaveBeenCalledWith("Danke – deine Stimme ist angekommen.");
});

test("„Später“ wird ein Band, das Band holt das Popup zurück; geheime Wahl nur als Hinweis", async () => {
  apiMock.get.mockResolvedValue({ data: { available: true, ballots: [BALLOT, SECRET], live: true, poll_seconds: 0 } });
  show();
  await screen.findByTestId("ballot-popup");
  fireEvent.click(screen.getByTestId("ballot-popup-later"));
  expect(await screen.findByTestId("ballot-popup-secret")).toHaveTextContent("Geheime Wahl auf Papier");
  expect(screen.queryByTestId("ballot-popup-cast")).toBeNull();
  fireEvent.click(screen.getByTestId("ballot-popup-later"));
  expect(screen.queryByTestId("ballot-popup")).toBeNull();
  const band = screen.getByTestId("ballot-band");
  expect(band).toHaveTextContent("Abstimmung offen: Entlastung des Vorstands – jetzt abstimmen");
  fireEvent.click(band);
  expect(screen.getByTestId("ballot-popup")).toHaveTextContent("Entlastung des Vorstands");
});

test("ein Fehler beim Abgeben steht im Popup", async () => {
  apiMock.get.mockResolvedValue({ data: { available: true, ballots: [BALLOT], live: true, poll_seconds: 0 } });
  apiMock.post.mockRejectedValue({ response: { data: { detail: "Du stehst nicht auf der Anwesenheitsliste der Versammlung – am Eingang die Mitgliedskarte scannen lassen, dann abstimmen." } } });
  show();
  fireEvent.click(await screen.findByTestId("ballot-option-1012-no"));
  fireEvent.click(screen.getByTestId("ballot-popup-cast"));
  expect(await screen.findByTestId("ballot-popup-message")).toHaveTextContent("Anwesenheitsliste");
});

test("im Admin still, Nicht-Mitglieder fragen gar nicht; ohne Feed fragt die Seite selbst nach", async () => {
  vi.useFakeTimers();
  try {
    apiMock.get.mockResolvedValue({ data: { available: true, ballots: [BALLOT], live: true, poll_seconds: 15 } });
    const { unmount } = show("/admin/news");
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("ballot-popup")).toBeNull();
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(apiMock.get).toHaveBeenCalledTimes(2);
    unmount();

    apiMock.get.mockClear();
    authState.isClubMember = false;
    show();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(apiMock.get).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
