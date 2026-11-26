import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createCeremonyQueue } from "@/components/achievements/ceremony/queue";
import { planCeremony } from "@/components/achievements/ceremony/select";

// Saisonende-Moment (#1639), Nachbesserung nach der Prüfung: Meister und Belohnungen in einem Ablauf (Fabian 26.11., A), „Endstand
// korrigiert“ (B), Holen je Gerät mit Schlüssel und „fertig“, Abstieg in Grau-Blau, „Moment ansehen“ nur einmal in der Schlange.
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "p1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonMoment } = await import("./SeasonMoment");
const { momentPackage } = await import("./momentPackage");
const { replayMoment } = await import("@/components/tls/league/LeagueMomentHint");

const gold = { id: "a-gold", tournament: { id: "t1" }, team: { name: "Nordlicht" },
  reward: { kind: "medal", kind_label: "Medaille", name: "Goldmedaille", art: { season: "Season 1", division: "Liga 1", place: "1. Platz", metal: "gold" } } };
const champion = (extra = {}) => ({
  id: "m-champion", outcome: "champion", url: "/liga/probe/season-1", display_name: "Nordlicht Eins", corrected: false,
  from: { level: 1 }, to: { level: 1 }, badge_from: { level: 1 }, badge_to: { level: 1, champion: true }, next_step: null, rewards: [gold],
  texts: { label: "Meister", kicker: "Liga 1", title: "Meister", name: "Nordlicht Eins", meta: "Probe-Liga · Season 1",
    line: "Platz 1 im Endstand der Season.", next: null, summary: "Nordlicht Eins ist Meister in Liga 1.", aria: "Meister: …", notice: null },
  ...extra,
});
const down = (extra = {}) => ({
  ...champion(), id: "m-down", outcome: "down", rewards: [], from: { level: 1 }, to: { level: 2 }, badge_from: { level: 1 }, badge_to: { level: 2 },
  texts: { label: "Abstieg", kicker: "Abstieg", title: "Nächste Season in Liga 2", name: "Nordlicht Eins", meta: "Probe-Liga · Season 1",
    line: "Nordlicht Eins wechselt von Liga 1 in Liga 2.", next: "Die neue Season beginnt für alle bei null.", summary: "…", aria: "Abstieg: …",
    notice: null },
  ...extra,
});

function show(pkg, props = {}) {
  const onClose = vi.fn();
  const plan = planCeremony(pkg);
  render(<MemoryRouter><SeasonMoment plan={plan} onClose={onClose} {...props} /></MemoryRouter>);
  return { onClose, plan };
}

beforeEach(() => {
  window.localStorage.clear();
});

test("Meister mit Belohnung: ein Ablauf - erst der Moment, mit „Weiter“ die Belohnung als zweite Karte", () => {
  const shown = vi.fn();
  const { onClose } = show({ moments: [champion()], rewards: [gold], onRewardsShown: shown });
  expect(screen.getByTestId("season-moment-title")).toHaveTextContent("Meister");
  expect(screen.queryByTestId("season-moment-rewards")).toBeNull();
  fireEvent.click(screen.getByTestId("season-moment-done"));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByTestId("season-moment-rewards")).toHaveTextContent("Goldmedaille");
  expect(shown).toHaveBeenCalledTimes(1);
  // Dieselbe Karte, kein neues Aufpoppen - der Dialog bleibt derselbe.
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByTestId("season-moment-done"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("ohne Moment (ein anderes Gerät hatte ihn) bleiben die Belohnungen als eigener Ablauf", () => {
  expect(planCeremony({ moments: [], rewards: [gold] })).toMatchObject({ sequence: "reward", rewards: [gold] });
  expect(planCeremony({ moments: [champion()], rewards: [gold] })).toMatchObject({ sequence: "season", rewards: [gold] });
  expect(planCeremony({ moments: [] })).toBeNull();
});

test("ein korrigierter Endstand sagt es oben auf der Karte", () => {
  show({ moments: [down({ corrected: true, texts: { ...down().texts, notice: "Endstand korrigiert" } })] });
  expect(screen.getByTestId("season-moment-notice")).toHaveTextContent("Endstand korrigiert");
});

test("Abstieg: das Wappen in ruhigem Grau-Blau", () => {
  show({ moments: [down()] });
  expect(screen.getByTestId("season-moment-crest")).toHaveAttribute("data-metal", "calm");
});

test("Holen mit dem Schlüssel des Geräts, fertig erst nach dem Schließen; nach verlorener Antwort derselbe Schlüssel", async () => {
  const client = { post: vi.fn((url) => Promise.resolve({ data: url.endsWith("/seen") ? { claimed: ["m-down"] } : { ok: true } })) };
  const pkg = momentPackage(down(), client);
  await expect(pkg.check()).resolves.toEqual({ moments: [down()] });
  const token = client.post.mock.calls[0][1].token;
  expect(token).toMatch(/.{8,}/);
  // Ein neues Paket desselben Geräts (neu geladen) nimmt denselben Schlüssel.
  await momentPackage(down(), client).check();
  expect(client.post.mock.calls[1][1].token).toBe(token);
  pkg.onDone();
  await waitFor(() => expect(client.post).toHaveBeenCalledWith("/me/league-moments/done", { ids: ["m-down"] }));
});

test("hat ein anderes Gerät ihn, gilt er hier nicht als fertig - die Belohnungen kommen trotzdem", async () => {
  const client = { post: vi.fn((url) => Promise.resolve({ data: url.endsWith("/seen") ? { claimed: [] } : { ok: true } })) };
  const pkg = momentPackage(champion(), client);
  await expect(pkg.check()).resolves.toEqual({ moments: [] });
  pkg.onDone();
  await waitFor(() => expect(client.post).toHaveBeenCalledWith("/me/rewards/seen", { ids: ["a-gold"] }));
  expect(client.post).not.toHaveBeenCalledWith("/me/league-moments/done", expect.anything());
});

test("Belohnungen gelten als gesehen nur, wenn die zweite Karte kam", async () => {
  const client = { post: vi.fn((url) => Promise.resolve({ data: url.endsWith("/seen") && url.includes("league") ? { claimed: ["m-champion"] } : { ok: true } })) };
  const pkg = momentPackage(champion(), client);
  await pkg.check();
  pkg.onDone();
  await waitFor(() => expect(client.post).toHaveBeenCalledWith("/me/league-moments/done", { ids: ["m-champion"] }));
  expect(client.post).not.toHaveBeenCalledWith("/me/rewards/seen", expect.anything());
  const second = momentPackage(champion({ id: "m-zwei" }), client);
  await second.check();
  second.onRewardsShown();
  second.onDone();
  await waitFor(() => expect(client.post).toHaveBeenCalledWith("/me/rewards/seen", { ids: ["a-gold"] }));
});

test("„Moment ansehen“ mehrfach gedrückt steht nur einmal in der Schlange", () => {
  const queue = createCeremonyQueue();
  queue.enqueue({ tiers: [{ code: "erfolg", rank: 1 }] });
  replayMoment(down(), queue);
  replayMoment(down(), queue);
  replayMoment(down(), queue);
  expect(queue.getPendingCount()).toBe(1);
  expect(queue.has("moment-replay-m-down")).toBe(true);
});
