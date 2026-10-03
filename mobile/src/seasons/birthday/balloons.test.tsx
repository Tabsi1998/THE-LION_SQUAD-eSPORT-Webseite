import React from "react";
import { act, render, screen } from "@testing-library/react-native";

// Luftballons und Feier-Takt in der App (#856): Wellen ganz außen am Rand, Ballons steigen auf und verschwinden wieder;
// Konfetti alle paar Minuten; ohne Bewegung nichts.

const mockSeasonState: Record<string, unknown> = { reducedMotion: false };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("../../components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));

const { BALLOON_COLORS, BirthdayCelebration, appBalloonWave, nextCelebration } = require("./balloons");
const { BirthdaySky } = require("./index");
const { mulberry32 } = require("../rng");
const { resetCarnivalState } = require("../carnival");

function birthday(overrides: Record<string, unknown> = {}) {
  return { key: "club_birthday", label: "Vereinsgeburtstag", phase: "feier", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: {}, data: { years: 8 }, starts_at: "2027-03-01T00:00:00+01:00", ends_at: "2027-03-01T23:59:59+01:00", forced: false, ...overrides };
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSeasonState.reducedMotion = false;
  resetCarnivalState();
});

afterEach(() => {
  jest.useRealTimers();
});

test("eine Welle: abwechselnd links und rechts ganz außen, kleine Ballons in Vereinsfarben", () => {
  const wave = appBalloonWave(mulberry32(5), 390, 4);
  expect(wave).toHaveLength(4);
  const sides = wave.map((balloon: { x: number }) => (balloon.x < 195 ? "left" : "right"));
  expect(sides[0]).not.toBe(sides[1]);
  wave.forEach((balloon: { x: number; size: number; color: number; duration: number }) => {
    expect(balloon.x < 16 || balloon.x + balloon.size > 390 - 16).toBe(true);
    expect(balloon.size).toBeLessThanOrEqual(22);
    expect(BALLOON_COLORS[balloon.color]).toBeTruthy();
    expect(balloon.duration).toBeGreaterThanOrEqual(13000);
  });
  expect(new Set(wave.map((balloon: { id: number }) => balloon.id)).size).toBe(4);
});

test("der Takt wie im Web: Ballons nach 2,5 s und dann alle 70–120 s, Konfetti alle drei bis fünf Minuten", () => {
  expect(nextCelebration("balloons", () => 0, true)).toBe(2500);
  expect(nextCelebration("balloons", () => 1)).toBe(120000);
  expect(nextCelebration("confetti", () => 0)).toBe(180000);
});

test("Ballons steigen nach dem Start auf und verschwinden wieder; ohne Bewegung keine", async () => {
  const view = await render(<BirthdayCelebration moving random={() => 0.5} />);
  expect(screen.queryAllByTestId("birthday-balloon")).toHaveLength(0);
  await advance(2600);
  expect(screen.getAllByTestId("birthday-balloon")).toHaveLength(3);
  await advance(40000);
  expect(screen.queryAllByTestId("birthday-balloon")).toHaveLength(0);
  await view.unmount();
  await render(<BirthdayCelebration moving={false} random={() => 0.5} />);
  await advance(600000);
  expect(screen.queryAllByTestId("birthday-balloon")).toHaveLength(0);
});

test("am Himmel: ein Konfetti-Schub nach ein paar Minuten weckt die Ebene; „Bewegung reduzieren“ feiert nicht", async () => {
  const view = await render(<BirthdaySky season={birthday()} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
  await advance(210000);
  expect(screen.getByTestId("carnival-sky")).toBeTruthy();
  await view.unmount();
  await render(<BirthdaySky season={birthday()} screen="Dashboard" reducedMotion />);
  await advance(600000);
  expect(screen.queryByTestId("carnival-sky")).toBeNull();
  expect(screen.queryAllByTestId("birthday-balloon")).toHaveLength(0);
});
