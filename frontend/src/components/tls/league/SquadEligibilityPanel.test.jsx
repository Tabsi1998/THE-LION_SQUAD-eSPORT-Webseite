import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

// Spielberechtigung auf der Team-Seite (#2204): nur „erfüllt“ oder „Geburtsdatum fehlt“, der Weg zum Transfer. Erfundene Namen.

const get = vi.fn();
const post = vi.fn();
const remove = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (...args) => get(...args), post: (...args) => post(...args), delete: (...args) => remove(...args) },
  API: "/api",
  formatApiError: (value) => value || "Fehler",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("react-router-dom", () => ({ Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a> }));

const { SquadEligibilityPanel } = await import("./SquadEligibilityPanel");

const VIEW = {
  seasons: [{
    season_id: "s1",
    rules: { min_squad_size: 3, max_squad_size: 50, one_team_per_season: true, min_age: 18, transfer_windows: [{ start_date: "2027-04-01", end_date: "2027-04-07" }], transfer_open: true },
    players: [
      { id: "u1", name: "Kapitaen", state: "locked", ok: true, reason: null, age: "met", until: null },
      { id: "u2", name: "Mila", state: "age_missing", ok: false, reason: "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein.", age: "missing", until: null },
    ],
    candidates: [
      { id: "u3", name: "Ida", can_add: false, needs_transfer: true, reason: "Steht oder stand in dieser Season in einem anderen Co-Team. Ein Wechsel geht nur als Transfer." },
      { id: "u4", name: "Ben", can_add: false, needs_transfer: false, reason: "Geburtsdatum fehlt." },
      { id: "u5", name: "Tara", can_add: true, needs_transfer: false, reason: null },
    ],
    transfers: [{ id: "t1", user_id: "u9", user_name: "Rio", status: "pending" }],
    can_edit: true,
  }],
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  remove.mockReset();
  get.mockResolvedValue({ data: VIEW });
  post.mockResolvedValue({ data: {} });
  remove.mockResolvedValue({ data: {} });
});

test("zeigt Regeln und Stand, das Panel öffnet sich, wenn jemand nicht spielen darf", async () => {
  render(<SquadEligibilityPanel teamId="team" squad={{ id: "sq" }} />);

  const panel = await screen.findByTestId("squad-eligibility-sq");
  expect(panel).toHaveAttribute("open");
  expect(panel.textContent).toContain("1 Person darf nicht spielen");
  expect(panel.textContent).toContain("Kader: 3 bis 50 Spieler");
  expect(screen.getByTestId("squad-eligibility-player-u2").textContent).toContain("Geburtsdatum fehlt");
  expect(screen.getByTestId("squad-eligibility-player-u1").textContent).toContain("Alter erfüllt");
  expect(panel.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  // #2313: die Sperre greift beim Spielen, nicht bei der Anmeldung.
  expect(screen.getByTestId("squad-eligibility-lock-s1")).toHaveTextContent("kann nicht einchecken und nicht aufgestellt werden");
});

// Regelwerk (#2269): gültige Fassung und der Stand der Zustimmung dieses Co-Teams auf der Team-Seite.
test("zeigt das Regelwerk mit „Neue Fassung, bitte zustimmen“", async () => {
  const rules_doc = { version_id: "v2", version: 2, label: "Version 2", valid_from: "2030-03-05", url: "/liga/probe/s1/regeln", pdf_url: "/api/x/pdf",
    consent: { required: true, agreed: false, agreed_at: null, demanded_label: "Version 2" } };
  const players = VIEW.seasons[0].players.map((player) => ({ ...player, ok: true, state: "locked", reason: null }));
  get.mockResolvedValue({ data: { seasons: [{ ...VIEW.seasons[0], players, rules_doc }] } });
  render(<SquadEligibilityPanel teamId="team" squad={{ id: "sq" }} />);

  const note = await screen.findByTestId("squad-rules-s1");
  expect(note).toHaveAttribute("data-consent", "open");
  expect(note.textContent).toContain("Version 2");
  expect(note.textContent).toContain("Neue Fassung, bitte zustimmen");
  expect(screen.getByTestId("squad-rules-s1-link")).toHaveAttribute("href", "/liga/probe/s1/regeln");
  // Auch wenn alle spielen dürfen: Der Bereich ist offen und die Überschrift sagt es, damit der Hinweis nicht verborgen bleibt.
  const panel = screen.getByTestId("squad-eligibility-sq");
  expect(panel).toHaveAttribute("open");
  expect(panel.querySelector("summary").textContent).toContain("Regelwerk: bitte zustimmen");
});

test("beantragt den Transfer und lädt neu", async () => {
  render(<SquadEligibilityPanel teamId="team" squad={{ id: "sq" }} />);

  fireEvent.click(await screen.findByTestId("squad-transfer-ask-u3"));

  await waitFor(() => expect(post).toHaveBeenCalledWith("/teams/team/squads/sq/transfers", { user_id: "u3" }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("squad-candidate-u4").textContent).toContain("Geburtsdatum fehlt");
  expect(screen.queryByTestId("squad-candidate-u5")).toBeNull();
});

test("außerhalb des Fensters geht kein Antrag", async () => {
  get.mockResolvedValue({ data: { seasons: [{ ...VIEW.seasons[0], rules: { ...VIEW.seasons[0].rules, transfer_open: false } }] } });
  render(<SquadEligibilityPanel teamId="team" squad={{ id: "sq" }} />);

  expect(await screen.findByTestId("squad-transfer-ask-u3")).toBeDisabled();
});

test("ein offener Antrag lässt sich zurückziehen", async () => {
  render(<SquadEligibilityPanel teamId="team" squad={{ id: "sq" }} />);

  fireEvent.click(await screen.findByTestId("squad-transfer-withdraw-t1"));

  await waitFor(() => expect(remove).toHaveBeenCalledWith("/teams/team/squads/sq/transfers/t1"));
});

test("wer es nicht sehen darf, sieht nichts", async () => {
  get.mockRejectedValue({ response: { status: 403 } });
  const { container } = render(<SquadEligibilityPanel teamId="team" squad={{ id: "sq" }} />);

  await waitFor(() => expect(get).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});
