import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createCeremonyQueue } from "@/components/achievements/ceremony/queue";
import { planCeremony } from "@/components/achievements/ceremony/select";

// Saisonende-Moment (#1639): drei Ausgänge, eigener Ablauf in der Zeremonie, einmal je Gerät (claim), Endzustand ohne Bewegung.
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "p1" } }) }));

const { SeasonMoment } = await import("./SeasonMoment");
const { RewardWatcher } = await import("@/components/tls/rewards/RewardWatcher");
const { momentPackage } = await import("./momentPackage");

const moment = (outcome = "up", extra = {}) => {
  const levels = { up: [2, 1], down: [2, 3], champion: [1, 1] }[outcome];
  return {
    id: `m-${outcome}`, outcome, title: "Probe-Liga · Season 1", url: "/liga/probe/season-1", display_name: "Nordlicht Eins",
    from: { level: levels[0], label: `Liga ${levels[0]}` }, to: { level: levels[1], label: `Liga ${levels[1]}` },
    badge_from: { level: levels[0], nickname: null, champion: false }, badge_to: { level: levels[1], nickname: null, champion: outcome === "champion" },
    texts: {
      up: { label: "Aufstieg", kicker: "Aufstieg", title: "Liga 1", name: "Nordlicht Eins", meta: "Probe-Liga · Season 1",
        line: "Nordlicht Eins steigt von Liga 2 in Liga 1 auf.", summary: "Nordlicht Eins steigt von Liga 2 in Liga 1 auf.", next: null, aria: "Aufstieg: Nordlicht Eins steigt von Liga 2 in Liga 1 auf." },
      down: { label: "Abstieg", kicker: "Abstieg", title: "Nächste Season in Liga 3", name: "Nordlicht Eins", meta: "Probe-Liga · Season 1",
        line: "Nordlicht Eins wechselt von Liga 2 in Liga 3.", summary: "Nordlicht Eins spielt die nächste Season in Liga 3.", next: "Die neue Season beginnt für alle bei null.", aria: "Abstieg: …" },
      champion: { label: "Meister", kicker: "Liga 1", title: "Meister", name: "Nordlicht Eins", meta: "Probe-Liga · Season 1", summary: "Nordlicht Eins ist Meister in Liga 1.",
        line: "Platz 1 im Endstand der Season.", next: null, aria: "Meister: Nordlicht Eins ist Meister." },
    }[outcome],
    next_step: null,
    ...extra,
  };
};

function show(row, props = {}) {
  const onClose = vi.fn();
  render(<MemoryRouter><SeasonMoment plan={planCeremony({ moments: [row] })} onClose={onClose} {...props} /></MemoryRouter>);
  return onClose;
}

test("ein Moment ist ein eigenes Paket vor wartenden Erfolgen - ruhig, ohne Partikel", () => {
  const queue = createCeremonyQueue();
  queue.enqueue({ tiers: [{ code: "erfolg", rank: 1 }] });
  queue.enqueue({ tiers: [{ code: "zweiter", rank: 1 }] });
  queue.enqueue({ moments: [moment()] });
  queue.advance();
  expect(queue.getCurrent().moments.map((row) => row.id)).toEqual(["m-up"]);
  expect(planCeremony(queue.getCurrent())).toMatchObject({ sequence: "season", particles: 0, moment: { id: "m-up" } });
});

test("hat ein anderes Gerät ihn schon, fällt der Moment weg und es geht weiter", () => {
  const queue = createCeremonyQueue();
  const entry = queue.enqueue({ moments: [moment()], check: () => ({ moments: [] }) });
  queue.enqueue({ tiers: [{ code: "erfolg", rank: 1 }] });
  expect(queue.getCurrent().id).toBe(entry.id);
  queue.refine(entry.id, { moments: [] });
  expect(queue.getCurrent().tiers.map((tier) => tier.code)).toEqual(["erfolg"]);
  expect(planCeremony({ moments: [] })).toBeNull();
});

test("Aufstieg: Wappen mit Zahlenwechsel, Krone in Liga 1, Texte vom Server, Dialog mit Beschreibung", () => {
  show(moment("up"));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("data-outcome", "up");
  expect(dialog).toHaveAttribute("data-metal", "lion");
  expect(dialog).toHaveAccessibleName("Liga 1");
  expect(dialog).toHaveAccessibleDescription("Nordlicht Eins steigt von Liga 2 in Liga 1 auf.");
  expect(screen.getByTestId("season-moment-kicker")).toHaveTextContent("Aufstieg");
  // Liga N steht nur im Titel - keine dritte Zeile mit derselben Liga.
  expect(screen.queryByTestId("season-moment-next")).toBeNull();
  const crest = screen.getByTestId("season-moment-crest");
  expect(crest.querySelector(".tls-season-moment__num--from")).toHaveTextContent("2");
  expect(crest.querySelector(".tls-season-moment__num--to")).toHaveTextContent("1");
  expect(screen.getByTestId("season-moment-crown")).toBeInTheDocument();
  expect(crest.closest("[data-play]")).toHaveAttribute("data-play", "run");
  expect(screen.getByTestId("season-moment-final")).toHaveAttribute("href", "/liga/probe/season-1");
});

test("Aufstieg in Liga 2 ohne Krone; Liga 10 und mehr mit kleinerer Zahl", () => {
  show(moment("up", { badge_from: { level: 11 }, badge_to: { level: 10 }, from: { level: 11 }, to: { level: 10 } }));
  expect(screen.queryByTestId("season-moment-crown")).toBeNull();
  const number = screen.getByTestId("season-moment-crest").querySelector(".tls-season-moment__num--to text");
  expect(number).toHaveTextContent("10");
  expect(number).toHaveAttribute("font-size", "17");
});

test("Abstieg: ruhig, grau, Blick auf die nächste Season, die Krone von Liga 1 geht still", () => {
  show(moment("down", { badge_from: { level: 1 }, badge_to: { level: 2 }, from: { level: 1 }, to: { level: 2 } }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("data-metal", "calm");
  expect(screen.getByTestId("season-moment-title")).toHaveTextContent("Nächste Season in Liga 3");
  expect(screen.getByTestId("season-moment-next")).toHaveTextContent("Die neue Season beginnt für alle bei null.");
  expect(dialog.querySelector(".tls-season-moment__crown--from")).toBeInTheDocument();
  expect(screen.queryByTestId("season-moment-crown")).toBeNull();
});

test("Meister: goldener Pokal mit goldenem Abzeichen", () => {
  show(moment("champion"));
  expect(screen.getByRole("dialog")).toHaveAttribute("data-metal", "gold");
  expect(screen.getByTestId("season-moment-trophy").querySelector("[data-medal='gold']")).toBeInTheDocument();
  expect(screen.getByTestId("season-moment-trophy").querySelector(".tls-lbadge")).toHaveAttribute("data-metal", "gold");
  expect(screen.queryByTestId("season-moment-next")).toBeNull();
});

test("reduzierte Bewegung: gleich der Endzustand, ohne Ablauf", () => {
  show(moment("up"), { reduced: true });
  expect(screen.getByRole("dialog")).toHaveAttribute("data-reduced", "true");
  expect(document.querySelector(".tls-season-moment__card")).not.toHaveAttribute("data-play");
});

test("schließen mit Escape, X und Weiter; ein offenes Startrecht führt zu den Teams", () => {
  const onClose = show(moment("up", { next_step: { label: "Startrecht zusagen", url: "/teams" } }));
  expect(screen.getByTestId("season-moment-next-step")).toHaveAttribute("href", "/teams");
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByTestId("season-moment-close"));
  fireEvent.click(screen.getByTestId("season-moment-done"));
  expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(3);
});

test("das Paket holt sich den Moment vor dem Zeigen beim Server - nur, was dieses Gerät bekommt", async () => {
  const client = { post: vi.fn().mockResolvedValueOnce({ data: { claimed: ["m-up"] } }).mockResolvedValueOnce({ data: { claimed: [] } }) };
  const pkg = momentPackage(moment("up"), client);
  await expect(pkg.check()).resolves.toEqual({ moments: [moment("up")] });
  // Läuft die Prüfung doppelt (React im Entwicklungsmodus), fragt sie nicht ein zweites Mal - sonst hielte sie sich selbst für „schon gesehen“.
  await expect(pkg.check()).resolves.toEqual({ moments: [moment("up")] });
  expect(client.post).toHaveBeenCalledTimes(1);
  expect(client.post).toHaveBeenCalledWith("/me/league-moments/seen", { ids: ["m-up"], token: expect.any(String) });
  // Ein neues Paket (anderes Gerät, neu geladen) bekommt ihn nicht mehr.
  await expect(momentPackage(moment("up"), client).check()).resolves.toEqual({ moments: [] });
  const failing = momentPackage(moment("up"), { post: vi.fn().mockRejectedValue(new Error("offline")) });
  await expect(failing.check()).resolves.toEqual({ moments: [] });
});

test("der Wächter reiht den Moment vor den Belohnungen ein", async () => {
  const queue = createCeremonyQueue();
  const award = { id: "a", tournament: { id: "t1" }, reward: { name: "Gold", art: {} } };
  const client = {
    get: vi.fn((url) => Promise.resolve({ data: url.includes("league-moments") ? { moments: [moment("champion")] } : { rewards: [award] } })),
    post: vi.fn().mockResolvedValue({ data: { claimed: ["m-champion"] } }),
  };
  render(<RewardWatcher queue={queue} client={client} />);
  await waitFor(() => expect(queue.getCurrent()?.moments?.[0]?.id).toBe("m-champion"));
  expect(queue.getPendingCount()).toBe(1);
  queue.advance();
  expect(queue.getCurrent().rewards[0].id).toBe("a");
});
