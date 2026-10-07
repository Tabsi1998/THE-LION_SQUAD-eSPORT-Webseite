import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LIFT_DELAY_MS, REST_MS, resetCardSignal } from "./cardLift";
import { CardChains } from "./christmas/CardChains";
import { SWING } from "./christmas/swing";
import { CardEggs } from "./easter/CardEggs";
import { ROLL } from "./easter/roll";
import { CardStreamers } from "./carnival/CardStreamers";
import { CARD_STREAMER } from "./carnival/cardStreamer";
import { CardGarlands } from "./birthday/CardGarlands";
import { PENNANT_FLUTTER } from "./birthday/cardGarland";
import { reportHuntActive, resetHuntActive } from "./easterHunt/api";

// Deko an Karten (Jahreszeiten IV, Variante B, #1091-#1094): Lichterkette, Osterei, Luftschlange und Wimpelkette sitzen
// zusätzlich an einigen Karten, die sich heben - nie an jeder - und reagieren nur, wenn sich genau ihre Karte hebt:
// erst nach einer Viertelsekunde, einmal je Anheben, danach zehn Sekunden Ruhe je Karte; nie ohne Maus und nie mit
// „Bewegung reduzieren“.

const mockSeason = { byKey: {} };
vi.mock("./SeasonContext", () => ({ useSeason: () => mockSeason }));

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top });
}

function media({ hover = true, reduced = false } = {}) {
  return (query) => ({ matches: query.includes("hover") ? hover : query.includes("reduced") ? reduced : false, addEventListener() {}, removeEventListener() {} });
}

let fixture = null;

/** Sechs Karten, die sich heben (zwei Reihen à drei), und eine, die sich nicht hebt. */
function page() {
  const cards = Array.from({ length: 6 }, (_, n) => `<a id="card-${n}" href="/x" class="tls-card" data-season-anchor="card"><div class="body"></div></a>`).join("");
  fixture = document.createElement("main");
  fixture.innerHTML = `${cards}<div id="still" data-season-anchor="card"></div>`;
  document.body.appendChild(fixture);
  for (let n = 0; n < 6; n += 1) {
    const left = 40 + (n % 3) * 340;
    const top = 120 + Math.floor(n / 3) * 300;
    box(document.getElementById(`card-${n}`), { left, right: left + 320, top, bottom: top + 260 });
  }
  box(document.getElementById("still"), { left: 40, right: 1040, top: 700, bottom: 760 });
}

function over(target, pointerType = "mouse") {
  const event = new window.MouseEvent("pointerover", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  target.dispatchEvent(event);
}

function out(target) {
  const event = new window.MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  target.dispatchEvent(event);
}

async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function hover(card, ms = LIFT_DELAY_MS) {
  await act(async () => over(card));
  await advance(ms);
}

async function unhover(card) {
  await act(async () => out(card));
}

function season(key, extra = {}) {
  return { key, phase: "deko", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: {}, starts_at: "2027-03-01T00:00:00+01:00", ends_at: "", data: {}, ...extra };
}

/** Hebt jede Karte kurz an und merkt sich, welche Deko dabei reagiert hat - so findet der Test die Karte der Deko. */
async function mapCards(selector) {
  const cards = [...document.querySelectorAll(".tls-card")];
  const owner = new Map();
  for (const card of cards) {
    await hover(card);
    document.querySelectorAll(selector).forEach((deco) => {
      if (deco.hasAttribute("data-season-lifted")) owner.set(deco.getAttribute("data-season-card"), card);
    });
    await unhover(card);
  }
  return owner;
}

let originalMatchMedia;

beforeEach(() => {
  vi.useFakeTimers();
  originalMatchMedia = window.matchMedia;
  window.matchMedia = media();
  resetCardSignal();
  resetHuntActive();
  mockSeason.byKey = {};
  page();
});

afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
  resetCardSignal();
  fixture?.remove();
  fixture = null;
});

function mount(node) {
  return render(<MemoryRouter initialEntries={["/"]}>{node}</MemoryRouter>);
}

test("Lichterkette (#1091): an zwei von sechs Karten; schwingt nur an der gehobenen, flackert einmal, beim Loslassen in klein", async () => {
  mount(<CardChains season={season("christmas", { phase: "gruss" })} salt="2026" />);
  await advance(500);
  const chains = screen.getAllByTestId("christmas-card-chain");
  expect(chains).toHaveLength(2);
  expect(document.querySelector("#still [data-testid]")).toBeNull();
  const owners = await mapCards("[data-testid='christmas-card-chain']");
  expect(owners.size).toBe(2);
  // Die Ruhezeit der Zuordnung abwarten.
  await advance(REST_MS.small);
  const [first, second] = chains;
  const card = owners.get(first.getAttribute("data-season-card"));
  // Drüberwischen löst nichts aus.
  await act(async () => over(card));
  await advance(LIFT_DELAY_MS - 50);
  await unhover(card);
  await advance(100);
  expect(first.getAttribute("data-swing")).toBeNull();

  await hover(card);
  expect(first.getAttribute("data-swing")).toBe("lift");
  expect(first.hasAttribute("data-season-lifted")).toBe(true);
  expect(second.getAttribute("data-swing")).toBeNull();
  expect(first.querySelectorAll("[data-blink='1']")).toHaveLength(1);
  expect(first.querySelector(".tls-lights--swing-lift")).not.toBeNull();
  // Dieselbe Gruppe bleibt (das Glimmen der anderen Lämpchen beginnt nicht neu).
  const rig = first.querySelector(".tls-lights__rig");
  await advance(SWING.ms + 100);
  expect(first.getAttribute("data-swing")).toBeNull();
  // Loslassen nach dem Ausschwingen: dasselbe in klein.
  await unhover(card);
  expect(first.getAttribute("data-swing")).toBe("leave");
  expect(first.querySelector(".tls-lights--swing-leave").style.getPropertyValue("--amp")).toBe(String(SWING.leave));
  expect(first.querySelector(".tls-lights__rig")).toBe(rig);
  await advance(SWING.ms + 100);
  expect(first.getAttribute("data-swing")).toBeNull();
  // Zehn Sekunden Ruhe je Karte - die andere Karte darf sofort.
  await hover(card);
  expect(first.getAttribute("data-swing")).toBeNull();
  await unhover(card);
  expect(first.getAttribute("data-swing")).toBeNull();
  const other = owners.get(second.getAttribute("data-season-card"));
  await hover(other);
  expect(second.getAttribute("data-swing")).toBe("lift");
  await unhover(other);
  // Losgelassen, bevor sie ausgeschwungen ist: kein zweites Schwingen obendrauf.
  expect(second.getAttribute("data-swing")).toBe("lift");
  await advance(REST_MS.small);
  await hover(card);
  expect(first.getAttribute("data-swing")).toBe("lift");
});

test("Osterei (#1092): wackelt und rollt höchstens sechs Pixel zur Ecke, bleibt liegen, nie über die Ecke", async () => {
  mount(<CardEggs season={season("easter")} />);
  await advance(500);
  const eggs = screen.getAllByTestId("easter-card-egg");
  expect(eggs.length).toBeGreaterThanOrEqual(1);
  const owners = await mapCards("[data-testid='easter-card-egg']");
  await advance(REST_MS.small);
  const egg = eggs[0];
  const card = owners.get(egg.getAttribute("data-season-card"));
  // Beim Zuordnen hat es schon einmal gerollt.
  const start = Number(egg.getAttribute("data-offset"));
  expect(Math.abs(start)).toBeLessThanOrEqual(ROLL.maxPx);
  const offsets = [start];
  for (let n = 0; n < 12; n += 1) {
    await hover(card);
    if (n === 0) {
      expect(egg.getAttribute("data-roll")).toBe("1");
      expect(egg.querySelector(".tls-card-egg__roll--go").style.getPropertyValue("--from")).toBe(`${start}px`);
    }
    await advance(ROLL.ms + 100);
    expect(egg.getAttribute("data-roll")).toBeNull();
    await unhover(card);
    await advance(REST_MS.small);
    offsets.push(Number(egg.getAttribute("data-offset")));
  }
  offsets.slice(1).forEach((offset, index) => expect(Math.abs(offset - offsets[index])).toBeLessThanOrEqual(ROLL.maxPx));
  // Am Ende liegt es still knapp vor der Ecke und rollt nicht weiter.
  expect(offsets[offsets.length - 1]).toBe(offsets[offsets.length - 2]);
  const others = eggs.slice(1);
  others.forEach((other) => expect(Math.abs(Number(other.getAttribute("data-offset")))).toBeLessThanOrEqual(ROLL.maxPx));
});

test("Osterei: am Karfreitag rührt sich nichts; läuft die Eiersuche, liegen keine Eier an Karten", async () => {
  const { unmount } = mount(<CardEggs season={season("easter")} quiet />);
  await advance(500);
  const egg = screen.getAllByTestId("easter-card-egg")[0];
  for (const card of document.querySelectorAll(".tls-card")) {
    await hover(card);
    await unhover(card);
  }
  expect(egg.getAttribute("data-offset")).toBe("0");
  expect(egg.getAttribute("data-roll")).toBeNull();
  unmount();
  mockSeason.byKey = { easter_hunt: { key: "easter_hunt", effective: "normal" } };
  mount(<CardEggs season={season("easter")} />);
  await advance(500);
  expect(screen.queryAllByTestId("easter-card-egg")).toHaveLength(0);
  await act(async () => reportHuntActive(false));
  await advance(500);
  expect(screen.queryAllByTestId("easter-card-egg").length).toBeGreaterThan(0);
});

test("Luftschlange (#1093): flattert einmal durch, nur an der gehobenen Karte, unter einer Sekunde", async () => {
  mount(<CardStreamers season={season("carnival")} />);
  await advance(500);
  const streamers = screen.getAllByTestId("carnival-card-streamer");
  expect(streamers.length).toBeGreaterThanOrEqual(1);
  const owners = await mapCards("[data-testid='carnival-card-streamer']");
  await advance(REST_MS.small);
  const card = owners.get(streamers[0].getAttribute("data-season-card"));
  await hover(card);
  expect(streamers[0].getAttribute("data-flutter")).toBe("1");
  streamers.slice(1).forEach((other) => expect(other.getAttribute("data-flutter")).toBeNull());
  expect(streamers[0].querySelectorAll(".tls-cstreamer__loop").length).toBeGreaterThanOrEqual(2);
  await advance(CARD_STREAMER.ms + 100);
  expect(streamers[0].getAttribute("data-flutter")).toBeNull();
  await unhover(card);
  expect(streamers[0].getAttribute("data-flutter")).toBeNull();
});

test("Wimpelkette (#1094): flattert einmal durch (eine Sekunde), nur an der gehobenen Karte", async () => {
  mount(<CardGarlands season={season("club_birthday")} year={2027} />);
  await advance(500);
  const garlands = screen.getAllByTestId("birthday-card-garland");
  expect(garlands).toHaveLength(2);
  const owners = await mapCards("[data-testid='birthday-card-garland']");
  await advance(REST_MS.small);
  const [first, second] = garlands;
  await hover(owners.get(first.getAttribute("data-season-card")));
  expect(first.getAttribute("data-flutter")).toBe("1");
  expect(second.getAttribute("data-flutter")).toBeNull();
  expect(first.querySelectorAll("[data-testid='birthday-card-pennant']").length).toBe(Number(first.getAttribute("data-pennants")));
  await advance(PENNANT_FLUTTER.ms + 100);
  expect(first.getAttribute("data-flutter")).toBeNull();
});

test("ohne Maus und mit „Bewegung reduzieren“: die Deko hängt, aber nichts reagiert", async () => {
  window.matchMedia = media({ reduced: true });
  mount(<CardChains season={season("christmas", { phase: "gruss" })} salt="2026" />);
  await advance(500);
  const chains = screen.getAllByTestId("christmas-card-chain");
  for (const card of document.querySelectorAll(".tls-card")) {
    await hover(card);
    await unhover(card);
  }
  chains.forEach((chain) => {
    expect(chain.getAttribute("data-swing")).toBeNull();
    expect(chain.hasAttribute("data-season-lifted")).toBe(false);
  });
  window.matchMedia = media({ hover: false });
  resetCardSignal();
  for (const card of document.querySelectorAll(".tls-card")) {
    await act(async () => over(card, "touch"));
    await advance(LIFT_DELAY_MS + 50);
  }
  chains.forEach((chain) => expect(chain.getAttribute("data-swing")).toBeNull());
});
