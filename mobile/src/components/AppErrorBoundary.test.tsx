import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppErrorBoundary } from "./AppErrorBoundary";

// Fehlerseite der App (#2131 KO9, Nachzug #2173): neben „Ansicht neu laden“ führt „Fehler melden“ ins Kontaktformular -
// mit dem Bildschirm und ohne Kennungen.

jest.mock("../lib/mobileLog", () => ({ logMobileError: jest.fn() }));
jest.mock("../navigation/rootNavigation", () => ({
  navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "MatchDetail", params: { id: "m-geheim" } }) },
  navigateToUrl: () => false,
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaView: View };
});

function Broken(): React.ReactElement {
  throw new Error("kaputt");
}

test("Fehler melden: Kontaktformular mit Thema und Bildschirm, ohne Kennung", async () => {
  const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  try {
    await render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
    await fireEvent.press(screen.getByTestId("app-error-report"));
    await waitFor(() => expect(opened).toHaveBeenCalled());
    const url = String(opened.mock.calls[0][0]);
    expect(new URL(url).searchParams.get("topic")).toBe("report_bug");
    expect(new URL(url).searchParams.get("from")).toBe("/app/matchdetail");
    expect(url).not.toContain("m-geheim");
  } finally {
    opened.mockRestore();
    errors.mockRestore();
  }
});
