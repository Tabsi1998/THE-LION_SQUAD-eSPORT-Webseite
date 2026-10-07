import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { NUDGE_KEY, SignInNudge } from "./SignInNudge";

// Gast zuerst (#918): beim allerersten Start nach ein paar Sekunden einmal „Konto erstellen oder anmelden“ -
// wegdrücken reicht, danach nie wieder.

const mockOpenSignIn = jest.fn();
const mockSignInOpen = { value: false };
jest.mock("../navigation/rootNavigation", () => ({ openSignIn: (...args: unknown[]) => mockOpenSignIn(...args), signInOpen: () => mockSignInOpen.value }));
const mockUpdate = { whatsNewOpen: false };
jest.mock("../update/AppUpdateProvider", () => ({ useAppUpdate: () => mockUpdate }));

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

async function after(ms: number) {
  await act(async () => {
    await flush();
    jest.advanceTimersByTime(ms);
    await flush();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockOpenSignIn.mockClear();
  mockSignInOpen.value = false;
  mockUpdate.whatsNewOpen = false;
});

afterEach(() => {
  jest.useRealTimers();
});

test("erst nach ein paar Sekunden; „Konto erstellen“ führt zur Registrierung - danach kommt der Hinweis nie wieder", async () => {
  const first = await render(<SignInNudge delayMs={12000} />);
  await after(11000);
  expect(screen.queryByTestId("sign-in-nudge")).toBeNull();
  await after(1000);
  expect(screen.getByText("Schön, dass du da bist!")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("sign-in-nudge-register"));
  await act(flush);
  expect(mockOpenSignIn).toHaveBeenCalledWith("Register");
  expect(screen.queryByTestId("sign-in-nudge")).toBeNull();
  expect(await SecureStore.getItemAsync(NUDGE_KEY)).toBe("true");
  await first.unmount();

  await render(<SignInNudge delayMs={12000} />);
  await after(60000);
  expect(screen.queryByTestId("sign-in-nudge")).toBeNull();
});

test("„Anmelden“ öffnet die Anmeldung, „Später“ schließt nur - gemerkt wird beides", async () => {
  const first = await render(<SignInNudge delayMs={10} />);
  await after(10);
  await fireEvent.press(screen.getByTestId("sign-in-nudge-login"));
  await act(flush);
  expect(mockOpenSignIn).toHaveBeenCalledWith("Login");
  await first.unmount();

  await SecureStore.deleteItemAsync(NUDGE_KEY);
  mockOpenSignIn.mockClear();
  await render(<SignInNudge delayMs={10} />);
  await after(10);
  // Seit #1143 gibt es keinen Tab „Mehr“: der Hinweis zeigt auf den Tab, in dem Gäste sich anmelden.
  expect(screen.getByText(/geht jederzeit unter „Profil“/)).toBeTruthy();
  expect(screen.queryByText(/„Mehr“/)).toBeNull();
  await fireEvent.press(screen.getByTestId("sign-in-nudge-later"));
  await act(flush);
  expect(mockOpenSignIn).not.toHaveBeenCalled();
  expect(screen.queryByTestId("sign-in-nudge")).toBeNull();
  expect(await SecureStore.getItemAsync(NUDGE_KEY)).toBe("true");
});

test("„Was ist neu“ zuerst: der Hinweis wartet, bis die Karte zu ist", async () => {
  mockUpdate.whatsNewOpen = true;
  const view = await render(<SignInNudge delayMs={10} />);
  await after(30000);
  expect(screen.queryByTestId("sign-in-nudge")).toBeNull();

  mockUpdate.whatsNewOpen = false;
  await view.rerender(<SignInNudge delayMs={10} />);
  await after(0);
  expect(screen.getByTestId("sign-in-nudge")).toBeTruthy();
});

test("schon auf dem Weg zum Konto (Anmelden offen): kein Hinweis - und auch später keiner", async () => {
  mockSignInOpen.value = true;
  await render(<SignInNudge delayMs={10} />);
  await after(10);
  expect(screen.queryByTestId("sign-in-nudge")).toBeNull();
  expect(await SecureStore.getItemAsync(NUDGE_KEY)).toBe("true");
});
