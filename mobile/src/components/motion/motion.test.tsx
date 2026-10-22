import React from "react";
import { AccessibilityInfo, Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { CountUp, Glow, Press, StaggerIn, staggerInDelay, useReduceMotion } from ".";

// Mikro-Bewegung (#1969): die Bausteine wie im Web. Im Test gibt es keinen UI-Thread - jede Bewegung ist sofort am
// Ziel (jest.setup.js); geprüft wird, was startet, was am Ende dasteht und was mit „Bewegung reduzieren“ passiert.

const reanimated = jest.requireMock("react-native-reanimated");

function reduceAtStart(value: boolean) {
  jest.spyOn(reanimated, "useReducedMotion").mockReturnValue(value);
  // Das Handy antwortet (noch) nicht - es zählt allein der Startwert.
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(new Promise<boolean>(() => undefined));
}

afterEach(() => jest.restoreAllMocks());

describe("useReduceMotion", () => {
  function Probe() {
    return <Text testID="probe">{useReduceMotion() ? "still" : "bewegt"}</Text>;
  }

  test("gilt sofort beim ersten Zeichnen (Reanimated), ohne auf das Handy zu warten", async () => {
    reduceAtStart(true);
    const seen: boolean[] = [];
    function Spy() {
      seen.push(useReduceMotion());
      return null;
    }
    await render(<Spy />);
    expect(seen[0]).toBe(true);
  });

  test("folgt einer Änderung der Einstellung, während die App offen ist", async () => {
    reduceAtStart(false);
    let listener: ((value: boolean) => void) | undefined;
    jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((_event: string, handler: (value: boolean) => void) => {
      listener = handler;
      return { remove: jest.fn() };
    }) as never);
    await render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("bewegt");
    await act(async () => listener?.(true));
    expect(screen.getByTestId("probe")).toHaveTextContent("still");
  });
});

describe("CountUp", () => {
  test("zählt beim ersten Anzeigen und steht am Ende exakt auf dem Endwert", async () => {
    reduceAtStart(false);
    const timing = jest.spyOn(reanimated, "withTiming");
    const done = jest.fn();
    await render(<CountUp value="1:24,587" onDone={done} testID="zeit" />);
    expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 900 }), expect.any(Function));
    expect(done).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("zeit")).toHaveTextContent("1:24,587");
  });

  test("Zahlen mit Tausenderpunkt und vom alten Wert aus", async () => {
    reduceAtStart(false);
    await render(<CountUp value={12500} grouped from={12000} testID="zahl" />);
    expect(screen.getByTestId("zahl")).toHaveTextContent("12.500");
  });

  test("während des Zählens hört der Vorleser nur den Endwert, der Zähltext beginnt bei null", async () => {
    reduceAtStart(false);
    // Die Bewegung kommt nie ans Ziel: so bleibt der Zählstand stehen.
    jest.spyOn(reanimated, "withTiming").mockImplementation(() => 0);
    await render(<CountUp value="31:55,056" testID="lauf" />);
    const node = screen.getByTestId("lauf");
    expect(node.props.accessibilityLabel).toBe("31:55,056");
    expect(screen.getByDisplayValue("00:00,000", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText("31:55,056")).toBeNull();
  });

  test("„Bewegung reduzieren“: sofort der Endwert, nichts zählt", async () => {
    reduceAtStart(true);
    const timing = jest.spyOn(reanimated, "withTiming");
    await render(<CountUp value="+0,412" testID="abstand" />);
    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByTestId("abstand")).toHaveTextContent("+0,412");
  });

  test("Wörter, Null und play={false} zählen nicht", async () => {
    reduceAtStart(false);
    const timing = jest.spyOn(reanimated, "withTiming");
    await render(<><CountUp value="+2 Runden" testID="a" /><CountUp value="0" testID="b" /><CountUp value="35" play={false} testID="c" /></>);
    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByTestId("a")).toHaveTextContent("+2 Runden");
    expect(screen.getByTestId("c")).toHaveTextContent("35");
  });

  test("Live-Nachladen: der neue Wert zählt nicht neu, er leuchtet einmal kurz auf", async () => {
    reduceAtStart(false);
    await render(<CountUp value="1:24,587" playKey="spa" testID="zeit" />);
    const timing = jest.spyOn(reanimated, "withTiming");
    const sequence = jest.spyOn(reanimated, "withSequence");
    await screen.rerender(<CountUp value="1:23,999" playKey="spa" testID="zeit" />);
    expect(screen.getByTestId("zeit")).toHaveTextContent("1:23,999");
    expect(timing.mock.calls.some(([, config]) => (config as { duration?: number })?.duration === 900)).toBe(false);
    expect(sequence).toHaveBeenCalledTimes(1);
    // Ein neuer Reiter zählt wieder.
    await screen.rerender(<CountUp value="1:30,000" playKey="monza" testID="zeit" />);
    expect(timing.mock.calls.some(([, config]) => (config as { duration?: number })?.duration === 900)).toBe(true);
  });

  test("ein Wert, der erst nach dem Laden kommt, zählt dann", async () => {
    reduceAtStart(false);
    await render(<CountUp value={null} testID="spaeter" />);
    const timing = jest.spyOn(reanimated, "withTiming");
    await screen.rerender(<CountUp value="42" testID="spaeter" />);
    expect(timing).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("spaeter")).toHaveTextContent("42");
  });
});

describe("StaggerIn", () => {
  test("nur die ersten zwölf staffeln, je 50 ms; spätere Einträge stehen sofort", async () => {
    reduceAtStart(false);
    expect(staggerInDelay(0)).toBe(0);
    expect(staggerInDelay(11)).toBe(550);
    expect(staggerInDelay(12)).toBeNull();
    const delays = jest.spyOn(reanimated, "withDelay");
    const items = Array.from({ length: 15 }, (_, index) => <Text key={index}>{`Eintrag ${index}`}</Text>);
    await render(<StaggerIn>{items}</StaggerIn>);
    expect(delays.mock.calls.map(([ms]) => ms)).toEqual(Array.from({ length: 12 }, (_, index) => index * 50));
    delays.mockClear();
    await screen.rerender(<StaggerIn>{[...items, <Text key="neu">Neu</Text>]}</StaggerIn>);
    expect(delays).not.toHaveBeenCalled();
    expect(screen.getByText("Neu")).toBeTruthy();
  });

  test("„Bewegung reduzieren“: sofort, nichts bewegt sich", async () => {
    reduceAtStart(true);
    const delays = jest.spyOn(reanimated, "withDelay");
    await render(<StaggerIn><Text>Eins</Text><Text>Zwei</Text></StaggerIn>);
    expect(delays).not.toHaveBeenCalled();
    expect(screen.getByText("Zwei")).toBeTruthy();
  });
});

describe("Glow", () => {
  test("einmal beim ersten Zeichnen mit `active`, dann bei jedem neuen `trigger`", async () => {
    reduceAtStart(false);
    const sequence = jest.spyOn(reanimated, "withSequence");
    await render(<Glow active trigger="a" tone="pole" testID="schein" />);
    expect(sequence).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("schein")).toHaveStyle({ backgroundColor: "#E879F9" });
    await screen.rerender(<Glow active trigger="a" tone="pole" testID="schein" />);
    expect(sequence).toHaveBeenCalledTimes(1);
    await screen.rerender(<Glow active trigger="b" tone="pole" testID="schein" />);
    expect(sequence).toHaveBeenCalledTimes(2);
  });

  test("ohne `active` nicht beim ersten Zeichnen; Dauer 840 ms (35 % auf, Rest ab)", async () => {
    reduceAtStart(false);
    const sequence = jest.spyOn(reanimated, "withSequence");
    const timing = jest.spyOn(reanimated, "withTiming");
    await render(<Glow trigger={1} />);
    expect(sequence).not.toHaveBeenCalled();
    await screen.rerender(<Glow trigger={2} />);
    expect(timing.mock.calls.map(([, config]) => (config as { duration: number }).duration)).toEqual([294, 546]);
  });

  test("„Bewegung reduzieren“: kein Schein", async () => {
    reduceAtStart(true);
    await render(<Glow active testID="schein" />);
    expect(screen.queryByTestId("schein")).toBeNull();
  });
});

describe("Press", () => {
  test("gibt beim Drücken nach, mit `haptic` eine leichte Vibration", async () => {
    reduceAtStart(false);
    const timing = jest.spyOn(reanimated, "withTiming");
    const onPress = jest.fn();
    await render(<Press haptic onPress={onPress} testID="karte"><Text>Karte</Text></Press>);
    await fireEvent(screen.getByTestId("karte"), "pressIn");
    expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 150 }));
    await fireEvent.press(screen.getByTestId("karte"));
    expect(onPress).toHaveBeenCalled();
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
  });

  test("„Bewegung reduzieren“: die Fläche bleibt still, ohne `haptic` keine Vibration", async () => {
    reduceAtStart(true);
    (Haptics.impactAsync as jest.Mock).mockClear();
    const timing = jest.spyOn(reanimated, "withTiming");
    await render(<Press onPress={() => undefined} testID="karte"><Text>Karte</Text></Press>);
    await fireEvent(screen.getByTestId("karte"), "pressIn");
    await fireEvent.press(screen.getByTestId("karte"));
    expect(timing).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});
