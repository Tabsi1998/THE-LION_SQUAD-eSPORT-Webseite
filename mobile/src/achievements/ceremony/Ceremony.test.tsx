import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { Ceremony, ceremonyTexts } from "./Ceremony";
import { CeremonyHost } from "./CeremonyHost";
import { createCeremonyQueue } from "./queue";
import { type CeremonyTier, planCeremony } from "./select";
import { spawnParticles, stepParticles, particleOpacity } from "./particles";

// Die Zeremonie der App (E13, #623): je Kategorie ein Auftritt, Sonderabläufe für die großen Momente, Stapel zum
// Durchblättern, Level-Aufstieg mit aufbrechender Zahl, „Bewegung reduzieren“ nur mit Einblenden.

jest.mock("@expo/vector-icons", () => {
  const { Text } = require("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
});
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
const mockNavigate = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, navigate: (...args: unknown[]) => mockNavigate(...args) } }));

const tier = (code: string, material: string, rank: number, category: string, extra: Partial<CeremonyTier> = {}): CeremonyTier => ({ code, name: `Stufe ${code}`, material, rank, category, points: rank * 10, group_name: "Gruppe", ...extra });

async function show(pkg: Parameters<typeof planCeremony>[0], props: Partial<React.ComponentProps<typeof Ceremony>> = {}) {
  const plan = planCeremony(pkg)!;
  const onClose = jest.fn();
  const rendered = await render(<Ceremony plan={plan} onClose={onClose} autoClose={false} {...props} />);
  return { plan, onClose, rendered };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockNavigate.mockReset();
});
afterEach(() => jest.useRealTimers());

test("jede Kategorie hat ihren Auftritt, das Abzeichen trägt Material und Rang", async () => {
  const motions: Record<string, string> = { match: "impact", tournament: "lift", fastlap: "driveby", season: "flip", team: "merge", community: "bubbles", creator: "live", profile: "card", club: "banner", special: "curtain", hidden: "smoke" };
  for (const [category, motion] of Object.entries(motions)) {
    const { rendered } = await show({ tiers: [tier("a", "silver", 4, category)] });
    expect(screen.getByTestId(`ceremony-motion-${motion}`)).toBeTruthy();
    expect(screen.getByTestId("ceremony-badge").props.accessibilityLabel).toBe("Stufe a");
    await rendered.unmount();
  }
});

test("eine Stufe: Material im Untertitel, Punkte, Schließen per Kreuz", async () => {
  const { onClose } = await show({ tiers: [tier("a", "gold", 5, "match")] });
  expect(screen.getByTestId("ceremony-sub")).toHaveTextContent("Gold V freigeschaltet");
  expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Neues Achievement!");
  expect(screen.getByTestId("ceremony-points")).toHaveTextContent(/\+50 Punkte/);
  await fireEvent.press(screen.getByTestId("achievement-unlock-close"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Legendär mit Banner und Teilen, Diamant mit Prisma, Kategorie mit Vitrine und Farbflut", async () => {
  const legendary = await show({ tiers: [tier("l", "legendary", 8, "special", { award_id: "aw-1", name: "Gamers Heaven I" })] });
  expect(screen.getByTestId("ceremony-legendary-banner")).toBeTruthy();
  expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("GAMERS HEAVEN I");
  expect(screen.getByTestId("ceremony-share")).toBeTruthy();
  await legendary.rendered.unmount();

  const diamond = await show({ tiers: [tier("d", "diamond", 7, "match")] });
  expect(screen.getByTestId("ceremony-prism")).toBeTruthy();
  expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Diamant");
  await diamond.rendered.unmount();

  await show({ tiers: [tier("c", "gold", 5, "season")], context: { categoryCompleted: "season" } });
  expect(screen.getByTestId("ceremony-vitrine")).toBeTruthy();
  expect(screen.getByTestId("ceremony-flood")).toBeTruthy();
  expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Kategorie abgeschlossen");
});

test("Gruppe abgeschlossen: Sockel mit allen sieben Stufen; erster Erfolg: Erklärung und Weg zu den Erfolgen", async () => {
  // Gemischtes Paket: die höchste Stufe ist geheim, abgeschlossen hat aber „Spielmacher“ - die Gruppe trägt Sockel und Titel.
  const group = await show({ tiers: [tier("s", "hidden", 9, "hidden", { group_name: "Geheimtür", art: "keyhole" }), tier("g", "diamond", 7, "match", { group_name: "Spielmacher", group_code: "matches_played", art: "crossed-swords" })], context: { groupCompleted: "matches_played" } });
  const pedestal = screen.getByTestId("ceremony-pedestal");
  for (const m of ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond"]) expect(within(pedestal).getByTestId(`ceremony-pedestal-${m}`)).toBeTruthy();
  expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Spielmacher vollständig");
  await group.rendered.unmount();

  const first = await show({ tiers: [tier("f", "wood", 1, "match")], context: { firstEver: true } });
  expect(screen.getByTestId("ceremony-first-text")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("ceremony-showcase-link"));
  expect(first.onClose).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("Profile", { tab: "achievements" });
});

test("ein Stapel blättert alle 2,5 Sekunden weiter und lässt sich von Hand durchgehen", async () => {
  await show({ tiers: [tier("a", "gold", 5, "match"), tier("b", "silver", 4, "team"), tier("c", "wood", 1, "season")] });
  expect(screen.getByTestId("ceremony-stack-index")).toHaveTextContent("1 / 3");
  await act(async () => { jest.advanceTimersByTime(2500); });
  expect(screen.getByTestId("ceremony-stack-index")).toHaveTextContent("2 / 3");
  await fireEvent.press(screen.getByTestId("ceremony-prev"));
  expect(screen.getByTestId("ceremony-stack-index")).toHaveTextContent("1 / 3");
  await fireEvent.press(screen.getByTestId("ceremony-tier-c"));
  expect(screen.getByTestId("ceremony-stack-index")).toHaveTextContent("3 / 3");
});

test("Level-Aufstieg: erst bricht die alte Zahl, dann fällt die neue; Titel und Prestige-Sterne", async () => {
  await show({ tiers: [], levelUp: { level: 10, previous: 9, title: "Kämpfer", titleChanged: true, prestige: 2, prestigeGained: true } });
  expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Level 10 erreicht");
  expect(screen.getByTestId("ceremony-level-old")).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(950); });
  expect(screen.getByTestId("ceremony-level-number")).toHaveTextContent("10");
  expect(screen.getByTestId("ceremony-title-banner")).toHaveTextContent("Neuer Titel: Kämpfer");
  expect(screen.getByTestId("ceremony-prestige-stars").props.accessibilityLabel).toBe("Prestige 2");
});

test("ein Level-up hinter Erfolgen bekommt nach den Abzeichen seine eigene Phase", async () => {
  const plan = planCeremony({ tiers: [tier("a", "gold", 5, "match")], levelUp: { level: 7, previous: 6, title: "Rookie" } })!;
  const onClose = jest.fn();
  await render(<Ceremony plan={plan} onClose={onClose} />);
  await act(async () => { jest.advanceTimersByTime(plan.duration); });
  expect(screen.getByTestId("ceremony-sub")).toHaveTextContent("Level 7 erreicht");
  expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Rookie");
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(6000); });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Bewegung reduzieren: nur Einblenden, keine Partikel, kein Prisma", async () => {
  await show({ tiers: [tier("d", "diamond", 7, "fastlap")] }, { reduced: true });
  expect(screen.getByTestId("ceremony-motion-fade")).toBeTruthy();
  expect(screen.queryByTestId("ceremony-particles")).toBeNull();
  expect(screen.queryByTestId("ceremony-prism")).toBeNull();
});

test("Partikel verglühen nach gut vier Sekunden; die Texte folgen dem Web", async () => {
  await show({ tiers: [tier("a", "gold", 5, "match")] });
  expect(screen.getByTestId("ceremony-particles")).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(4600); });
  expect(screen.queryByTestId("ceremony-particles")).toBeNull();
  const plan = planCeremony({ tiers: [tier("a", "iron", 2, "match")], context: { catchUp: true } })!;
  expect(ceremonyTexts(plan, 1)).toEqual({ heading: "Neues Achievement!", sub: "Nachgeholte Erfolge" });
});

test("der Wirt zeigt die Warteschlange der Reihe nach", async () => {
  const queue = createCeremonyQueue({ now: () => 0 });
  await render(<CeremonyHost queue={queue} />);
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
  await act(async () => { queue.enqueue({ id: "one", tiers: [tier("a", "gold", 5, "match")] }); });
  expect(screen.getByTestId("ceremony-heading")).toHaveTextContent("Neues Achievement!");
  await act(async () => { queue.enqueue({ tiers: [], levelUp: { level: 3, previous: 2 } }); });
  await fireEvent.press(screen.getByTestId("achievement-unlock-close"));
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
});

test("Partikel: Konfetti fällt von oben, Flammen steigen, alles verblasst und verlässt die Bühne", () => {
  let seed = 1;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const confetti = spawnParticles({ kind: "confetti", count: 10, width: 400, height: 800, rng });
  expect(confetti.every((p) => p.y < 0 && p.vy > 0)).toBe(true);
  const flames = spawnParticles({ kind: "flame", count: 10, width: 400, height: 800, rng, origin: { x: 200, y: 300 } });
  const before = flames.map((p) => p.vy);
  stepParticles(flames, 0.1, 400, 800);
  expect(flames.every((p, i) => p.vy < before[i])).toBe(true);
  const one = spawnParticles({ kind: "glint", count: 1, rng })[0];
  expect(particleOpacity(one)).toBe(1);
  for (let i = 0; i < 100; i += 1) stepParticles([one], 0.05, 400, 800);
  expect(particleOpacity(one)).toBe(0);
});
