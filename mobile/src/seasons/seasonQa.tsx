import React from "react";
import { Text, View } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { type ScreenClass } from "./intensity";

// Abnahme-Standard für jede Saison in der App (Seasonal Core C6, #726 - wie frontend/e2e/seasonQa.js im Web):
// „nichts darf schlechter werden“ ist keine Halloween-Regel mehr. Eine Saison legt nur ihre Teile fest (welche
// testIDs sich bewegen dürfen, welche still sind, welche Ebenen keine Berührung nehmen); die Prüfungen sind für
// alle gleich: still bleibt still, „dezent“ und Reduced Motion ohne Bewegung, die Bühne nimmt keine Berührung,
// Saison aus = keine Bühne. Läuft nur unter Jest (Test-Helfer, kein App-Code); Beispiel: acceptance.test.tsx.

/** Ein Screen je Klasse (intensity.ts) - die Abnahme prüft jede Klasse einmal. */
export const SCREEN_OF_CLASS: Record<ScreenClass, string> = { lively: "Dashboard", medium: "EventDetail", calm: "TournamentDetail", quiet: "Consent" };

export type SeasonQaConfig = {
  key: string;
  label: string;
  /** Die Ecken-Ebene der Saison. */
  Corners: React.ComponentType<{ season: never; screen: string }>;
  /** Kartenkomponente mit `perch` (die Anker der App). */
  Card: React.ComponentType<{ perch?: string; children?: React.ReactNode }>;
  /** Setzt den Screen-Namen der (gemockten) Navigation. */
  setScreen: (name: string) => void;
  /** Schaltet „Bewegung reduzieren“ des (gemockten) Saison-Kontexts. */
  setReducedMotion: (on: boolean) => void;
  /** Setzt Läden und Planer vor jedem Aufbau zurück. */
  reset: () => void;
  /** testIDs bewegter Teile: bei „dezent“ und Reduced Motion nicht da. */
  moving: (string | RegExp)[];
  /** testID der Bühne (muss `box-none` sein) und Ebenen, die `none` sein müssen. */
  stage: string;
  passive: (string | RegExp)[];
  /** Die Bühne der App (rendert ohne Saison nichts) - optional. */
  Stage?: React.ComponentType;
  stageTestId?: string;
  /** Zusätzliche Daten der Saison. */
  data?: Record<string, unknown>;
};

/** Ein Saison-Eintrag wie vom Server, mit der wirksamen Stärke. */
export function seasonFixture(config: Pick<SeasonQaConfig, "key" | "label" | "data">, effective = "normal") {
  return { key: config.key, label: config.label, phase: "deko", intensity: "normal", effective, channels: ["app"], texts: {}, starts_at: "", ends_at: "", forced: false, data: config.data || {} };
}

export function countTestIds(ids: (string | RegExp)[]): number {
  return ids.reduce((sum, id) => sum + screen.queryAllByTestId(id).length, 0);
}

/** Baut die Ecken-Ebene mit Karten (Anker) für einen Screen auf und lässt die Bühne kurz laufen. */
export async function renderSeasonScreen(config: SeasonQaConfig, screenName: string, effective = "normal", cards = 4) {
  const { Corners, Card } = config;
  config.setScreen(screenName);
  await render(
    <View>
      <Corners season={seasonFixture(config, effective) as never} screen={screenName} />
      {Array.from({ length: cards }, (_, index) => (
        <Card key={index} perch={`${screenName}-${index}`}>
          <Text>Karte {index}</Text>
        </Card>
      ))}
    </View>,
  );
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
}

/** Die gemeinsamen Prüfungen jeder Saison - die Saison ergänzt ihre eigenen (Zahlen je Klasse, Figuren, Reaktionen). */
export function defineSeasonAcceptance(config: SeasonQaConfig) {
  const { label } = config;
  const stageChecks = () => {
    expect(screen.getByTestId(config.stage).props.pointerEvents).toBe("box-none");
    config.passive.forEach((id) => screen.queryAllByTestId(id).forEach((node) => expect(node.props.pointerEvents).toBe("none")));
  };

  test(`${label}: still (${SCREEN_OF_CLASS.quiet}) zeigt nichts außer der Bühne`, async () => {
    config.reset();
    await renderSeasonScreen(config, SCREEN_OF_CLASS.quiet);
    expect(countTestIds(config.moving)).toBe(0);
    expect(countTestIds(config.passive)).toBe(0);
    stageChecks();
  });

  test(`${label}: „dezent“ bewegt nichts, die Bühne nimmt keine Berührung`, async () => {
    config.reset();
    await renderSeasonScreen(config, SCREEN_OF_CLASS.lively, "subtle");
    expect(countTestIds(config.moving)).toBe(0);
    stageChecks();
  });

  test(`${label}: Reduced Motion bewegt nichts - auch auf dem lebendigsten Screen`, async () => {
    config.reset();
    config.setReducedMotion(true);
    try {
      await renderSeasonScreen(config, SCREEN_OF_CLASS.lively);
      expect(countTestIds(config.moving)).toBe(0);
      stageChecks();
    } finally {
      config.setReducedMotion(false);
    }
  });

  test(`${label}: lebendig - die Bühne und ihre passiven Ebenen nehmen keine Berührung`, async () => {
    config.reset();
    await renderSeasonScreen(config, SCREEN_OF_CLASS.lively);
    stageChecks();
  });

  if (config.Stage) {
    const Stage = config.Stage;
    test(`${label}: Saison aus - keine Bühne`, async () => {
      config.reset();
      await render(<Stage />);
      expect(screen.queryByTestId(config.stageTestId || "season-stage")).toBeNull();
    });
  }
}
