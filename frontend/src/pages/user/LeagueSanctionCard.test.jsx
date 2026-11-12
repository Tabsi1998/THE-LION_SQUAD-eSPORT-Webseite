import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Strafe der Liga unter „Meine Strafen“ (E.3): Frist sichtbar, Einspruch in zwei Schritten, einmal je Strafe. Erfundene Namen.
const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { LeagueSanctionCard } = await import("./LeagueSanctionCard");

const row = (extra = {}) => ({
  kind: "league_sanction", label: "Spielsperre", ref_id: "s1", context_title: "Probe-Liga · Season 1", context_url: "/leagues/probe/season-1",
  issued_at: "2026-11-12T18:00:00+00:00", issued_by_name: "Strafleitung",
  sanction: { id: "s1", status: "active", state: "final", rule_ref: "Anlage C.4", reason: "Makro nachgewiesen", period: "2 Liga-Spiele, noch 2",
    appeal_until: "2099-01-01T00:00:00+00:00", can_appeal: true, appeal: null, ...extra },
});

function renderCard(p, onChanged = vi.fn()) {
  render(<MemoryRouter><LeagueSanctionCard p={p} onChanged={onChanged} /></MemoryRouter>);
  return onChanged;
}

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: {} });
});

test("zeigt Verstoß, Begründung, Zeitraum und Frist - der Einspruch braucht eine Begründung", async () => {
  const onChanged = renderCard(row());
  const card = screen.getByTestId("penalty-card-s1");
  expect(card).toHaveTextContent("Strafe der Liga-Leitung gegen dich");
  expect(card).toHaveTextContent("Anlage C.4");
  expect(card).toHaveTextContent("Makro nachgewiesen");
  // Wer verhängt hat, steht für Betroffene nie da - auch wenn die Antwort einen Namen trüge.
  expect(card).toHaveTextContent("durch die Liga-Leitung");
  expect(card).not.toHaveTextContent("Strafleitung");
  expect(screen.getByTestId("sanction-period-s1")).toHaveTextContent("2 Liga-Spiele, noch 2");
  expect(screen.getByTestId("sanction-deadline-s1")).toHaveTextContent("Einspruch möglich bis");
  fireEvent.click(screen.getByTestId("sanction-appeal-open-s1"));
  expect(screen.getByTestId("sanction-appeal-submit-s1")).toBeDisabled();
  fireEvent.change(screen.getByTestId("sanction-appeal-text-s1"), { target: { value: "Der Clip zeigt eine andere Person." } });
  fireEvent.click(screen.getByTestId("sanction-appeal-submit-s1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/penalties/sanctions/s1/appeal", { text: "Der Clip zeigt eine andere Person." }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

test("nach dem Einspruch gibt es keinen zweiten - offen steht, dass die Strafe weiter gilt", () => {
  renderCard(row({ can_appeal: false, appeal: { state: "open", at: "2026-11-12T19:00:00+00:00", text: "Das war ich nicht." } }));
  expect(screen.getByTestId("sanction-appeal-s1")).toHaveTextContent("Bis dahin gilt die Strafe weiter");
  expect(screen.queryByTestId("sanction-appeal-open-s1")).not.toBeInTheDocument();
});

test("Teamstrafe, vorläufige Sperre, abgelaufene Frist und Widerruf sagen, was gilt", () => {
  renderCard({ ...row({ status: "provisional", state: "provisional", can_appeal: false, appeal_until: null }), team_penalty: true, team_name: "Rudel A" });
  expect(screen.getByTestId("penalty-card-s1")).toHaveTextContent("gegen das Co-Team Rudel A");
  expect(screen.getByTestId("sanction-provisional-s1")).toHaveTextContent("ab der endgültigen Entscheidung");
  expect(screen.getByTestId("sanction-status-s1")).toHaveTextContent("Vorläufig");
});

test("eine abgelaufene Frist bietet keinen Einspruch mehr an, ein Widerruf nennt den Grund", () => {
  renderCard(row({ can_appeal: false, appeal_until: "2026-11-01T00:00:00+00:00" }));
  expect(screen.getByTestId("sanction-deadline-s1")).toHaveTextContent("abgelaufen");
  expect(screen.queryByTestId("sanction-appeal-open-s1")).not.toBeInTheDocument();
});
