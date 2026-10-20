import React from "react";
import { AppState, Text } from "react-native";
import { act, render } from "@testing-library/react-native";
import { NavigationContext } from "@react-navigation/native";
import type { LiveChange } from "./liveChanges";

// Inaktive Screens und Hintergrund (#1015): Ohne Live-Strom fragt eine Ansicht nur ab, solange sie zu sehen ist - ein
// Reiter im Hintergrund und die App im Hintergrund pollen nicht. Live-Meldungen für eine verdeckte Ansicht merken
// sich nur „veraltet“; kommt sie wieder nach vorn, lädt sie genau einmal neu (kein Schwall an Anfragen).

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LiveChangesContext, useLiveRefresh } = require("./LiveChangesProvider");

type Listener = (event: LiveChange) => void;

function liveBus(connected = false) {
  const listeners = new Set<Listener>();
  return {
    value: {
      connected,
      subscribe: (listener: Listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit: (event: LiveChange) => listeners.forEach((listener) => listener(event)),
    size: () => listeners.size,
  };
}

function fakeNavigation(focused = true) {
  const handlers: Record<string, Set<() => void>> = { focus: new Set(), blur: new Set() };
  const navigation = {
    focused,
    isFocused: () => navigation.focused,
    addListener: (name: "focus" | "blur", handler: () => void) => {
      handlers[name].add(handler);
      return () => handlers[name].delete(handler);
    },
  };
  return {
    navigation,
    focus: () => {
      navigation.focused = true;
      handlers.focus.forEach((handler) => handler());
    },
    blur: () => {
      navigation.focused = false;
      handlers.blur.forEach((handler) => handler());
    },
  };
}

function Probe({ onRefresh, fallbackMs, resources = ["/tournaments"] }: { onRefresh: () => void; fallbackMs?: number; resources?: string[] }) {
  useLiveRefresh(onRefresh, resources, { fallbackMs, debounceMs: 100 });
  return <Text>probe</Text>;
}

function mount(element: React.ReactElement, bus: ReturnType<typeof liveBus>, navigation?: ReturnType<typeof fakeNavigation>) {
  const tree = <LiveChangesContext.Provider value={bus.value}>{element}</LiveChangesContext.Provider>;
  return render(navigation ? <NavigationContext.Provider value={navigation.navigation as never}>{tree}</NavigationContext.Provider> : tree);
}

let appStateListeners: ((state: string) => void)[] = [];
let appStateSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  appStateListeners = [];
  appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (state: string) => void) => {
    appStateListeners.push(listener);
    return { remove: () => (appStateListeners = appStateListeners.filter((item) => item !== listener)) };
  }) as never);
});

afterEach(() => {
  appStateSpy.mockRestore();
  jest.useRealTimers();
});

const setAppState = (state: string) => act(() => appStateListeners.forEach((listener) => listener(state)));
const advance = (ms: number) => act(() => {
  jest.advanceTimersByTime(ms);
});

test("ohne Live-Strom pollt der sichtbare Screen im Takt", async () => {
  const refresh = jest.fn();
  await mount(<Probe onRefresh={refresh} fallbackMs={5000} />, liveBus(), fakeNavigation());
  await advance(15000);
  expect(refresh).toHaveBeenCalledTimes(3);
});

test("ein Reiter im Hintergrund pollt nicht; zurück im Vordergrund lädt er einmal neu", async () => {
  const refresh = jest.fn();
  const nav = fakeNavigation();
  await mount(<Probe onRefresh={refresh} fallbackMs={5000} />, liveBus(), nav);
  await act(() => nav.blur());
  await advance(60000);
  expect(refresh).not.toHaveBeenCalled();
  await act(() => nav.focus());
  await advance(100);
  expect(refresh).toHaveBeenCalledTimes(1);
  // Danach wieder der normale Takt.
  await advance(5000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("kurz verdeckt (kein Takt verpasst): kein zusätzliches Neuladen", async () => {
  const refresh = jest.fn();
  const nav = fakeNavigation();
  await mount(<Probe onRefresh={refresh} fallbackMs={5000} />, liveBus(), nav);
  await advance(1000);
  await act(() => nav.blur());
  await advance(1000);
  await act(() => nav.focus());
  await advance(1000);
  expect(refresh).not.toHaveBeenCalled();
});

test("App im Hintergrund pollt nicht; die Rückkehr lädt einmal, auch mit der Reset-Meldung des Stroms", async () => {
  const refresh = jest.fn();
  const bus = liveBus();
  await mount(<Probe onRefresh={refresh} fallbackMs={5000} />, bus, fakeNavigation());
  await setAppState("background");
  await advance(120000);
  expect(refresh).not.toHaveBeenCalled();
  await setAppState("active");
  // Der Provider meldet beim Zurückkommen „app_resumed“ - beides zusammen ergibt einen Aufruf.
  await act(() => bus.emit({ reset: true, reason: "app_resumed" }));
  await advance(100);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("Live-Meldungen für einen verdeckten Reiter laden erst beim Zurückkommen, und nur einmal", async () => {
  const visible = jest.fn();
  const hidden = jest.fn();
  const bus = liveBus(true);
  const front = fakeNavigation(true);
  const back = fakeNavigation(false);
  await mount(
    <>
      <NavigationContext.Provider value={front.navigation as never}>
        <Probe onRefresh={visible} />
      </NavigationContext.Provider>
      <NavigationContext.Provider value={back.navigation as never}>
        <Probe onRefresh={hidden} />
      </NavigationContext.Provider>
    </>,
    bus,
  );
  await act(() => {
    bus.emit({ path: "/tournaments/t-1", event_type: "tournament.updated" });
    bus.emit({ path: "/tournaments/t-1", event_type: "tournament.updated" });
  });
  await advance(100);
  expect(visible).toHaveBeenCalledTimes(1);
  expect(hidden).not.toHaveBeenCalled();
  await act(() => back.focus());
  await advance(100);
  expect(hidden).toHaveBeenCalledTimes(1);
});

test("mit Live-Strom kein Polling, und nach dem Abbauen bleiben weder Abo noch Takt", async () => {
  const refresh = jest.fn();
  const bus = liveBus(true);
  const view = await mount(<Probe onRefresh={refresh} fallbackMs={5000} />, bus, fakeNavigation());
  await advance(30000);
  expect(refresh).not.toHaveBeenCalled();
  expect(bus.size()).toBe(1);
  await view.unmount();
  expect(bus.size()).toBe(0);
  expect(appStateListeners).toHaveLength(0);
  await advance(60000);
  expect(refresh).not.toHaveBeenCalled();
});

test("ohne Navigation (Provider wie Chats und Benachrichtigungen) gilt die Ansicht als sichtbar, pausiert aber im Hintergrund", async () => {
  const refresh = jest.fn();
  await mount(<Probe onRefresh={refresh} fallbackMs={5000} />, liveBus());
  await advance(5000);
  expect(refresh).toHaveBeenCalledTimes(1);
  await setAppState("background");
  await advance(60000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("nach dem Abbauen läuft auch der Ersatz-Takt nicht weiter", async () => {
  const refresh = jest.fn();
  const view = await mount(<Probe onRefresh={refresh} fallbackMs={5000} />, liveBus(), fakeNavigation());
  await view.unmount();
  await advance(60000);
  expect(refresh).not.toHaveBeenCalled();
});

test("verdeckt, während ein Neuladen noch entprellt wird: es lädt nicht verdeckt, sondern einmal beim Zurückkommen", async () => {
  const refresh = jest.fn();
  const bus = liveBus(true);
  const nav = fakeNavigation();
  await mount(<Probe onRefresh={refresh} />, bus, nav);
  await act(() => bus.emit({ path: "/tournaments/t-1", event_type: "tournament.updated" }));
  await act(() => nav.blur());
  await advance(500);
  expect(refresh).not.toHaveBeenCalled();
  await act(() => nav.focus());
  await advance(100);
  expect(refresh).toHaveBeenCalledTimes(1);
});
