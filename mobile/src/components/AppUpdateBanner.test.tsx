import React from "react";
import { Platform } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppUpdateBanner } from "./AppUpdateBanner";
import type { AppRelease } from "../lib/appUpdate";

// Update aus der App (#250, #421, #593): jedes Update kommt über Google Play - „Update starten“
// öffnet Googles Dialog, sonst die Store-Seite; Pflicht-Updates haben kein „Später“; die
// Rückfrage je Art (#309) steht vor dem Start. Einen Download mit Installer gibt es nicht mehr.

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

beforeAll(() => {
  Platform.OS = "android";
});

const release: AppRelease = {
  build: 63, version: "0.5.0-beta", notes: "- Neu", sha256: "abc", md5: "aa", size: 4,
  filename: "LionsAPP-v0.5.0-beta-build63.apk", download_url: "/api/mobile/app-download/63",
};

function openUrlSpy() {
  const { Linking } = jest.requireActual("react-native");
  return jest.spyOn(Linking, "openURL").mockResolvedValue(true);
}

test("„Update starten“ öffnet Googles Dialog; geht er nicht auf, die Store-Seite", async () => {
  const openUrl = openUrlSpy();
  const onStartPlayUpdate = jest.fn(async () => false);
  await render(
    <AppUpdateBanner release={release} mandatory onLater={jest.fn()} onWhatsNew={jest.fn()} confirmInstall={async () => true} onStartPlayUpdate={onStartPlayUpdate} />,
  );
  expect(screen.getByText("Build 63 ist da – v0.5.0-beta")).toBeTruthy();
  expect(screen.getByText(/kommt über den Play Store/)).toBeTruthy();
  expect(screen.queryByTestId("app-update-download")).toBeNull();

  await fireEvent.press(screen.getByTestId("app-update-play"));
  await waitFor(() => expect(onStartPlayUpdate).toHaveBeenCalledWith(true));
  await waitFor(() => expect(openUrl).toHaveBeenCalledWith("market://details?id=at.lionsquad.app"));
  openUrl.mockRestore();
});

test("ohne Googles Dialog (Sideload-Installation) führt der Knopf in den Play Store", async () => {
  const openUrl = openUrlSpy();
  await render(
    <AppUpdateBanner release={release} mandatory={false} onLater={jest.fn()} onWhatsNew={jest.fn()} confirmInstall={async () => true} />,
  );
  expect(screen.getByText("Play Store öffnen")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("app-update-play"));
  await waitFor(() => expect(openUrl).toHaveBeenCalledWith("market://details?id=at.lionsquad.app"));
  openUrl.mockRestore();
});

test("ein Pflicht-Update hat kein „Später“, ein normales schon", async () => {
  const onLater = jest.fn();
  const { rerender } = await render(
    <AppUpdateBanner release={release} mandatory onLater={onLater} onWhatsNew={jest.fn()} confirmInstall={async () => true} />,
  );
  expect(screen.queryByTestId("app-update-later")).toBeNull();
  expect(screen.getByText(/Dieses Update ist Pflicht\./)).toBeTruthy();

  await rerender(
    <AppUpdateBanner release={release} mandatory={false} onLater={onLater} onWhatsNew={jest.fn()} confirmInstall={async () => true} />,
  );
  await fireEvent.press(screen.getByTestId("app-update-later"));
  expect(onLater).toHaveBeenCalledTimes(1);
});

// Beta oder Release (#309): Plakette im Kopf, Rückfrage je Art vor dem Start; „Abbrechen“ startet nichts.
test("Beta-Plakette und Rückfrage: abgelehnt startet nichts, bestätigt startet", async () => {
  const onStartPlayUpdate = jest.fn(async () => true);
  const confirmInstall = jest.fn(async () => false);
  const { rerender } = await render(
    <AppUpdateBanner release={release} mandatory={false} onLater={jest.fn()} onWhatsNew={jest.fn()} confirmInstall={confirmInstall} onStartPlayUpdate={onStartPlayUpdate} />,
  );
  expect(screen.getByTestId("app-update-channel")).toHaveTextContent("BETA · Testversion");
  await fireEvent.press(screen.getByTestId("app-update-play"));
  await waitFor(() => expect(confirmInstall).toHaveBeenCalledWith("beta", false));
  expect(onStartPlayUpdate).not.toHaveBeenCalled();

  const yes = jest.fn(async () => true);
  await rerender(
    <AppUpdateBanner release={{ ...release, version: "1.0.0", channel: "release" }} mandatory onLater={jest.fn()} onWhatsNew={jest.fn()} confirmInstall={yes} onStartPlayUpdate={onStartPlayUpdate} />,
  );
  expect(screen.getByTestId("app-update-channel")).toHaveTextContent("RELEASE");
  await fireEvent.press(screen.getByTestId("app-update-play"));
  await waitFor(() => expect(onStartPlayUpdate).toHaveBeenCalledWith(true));
  expect(yes).toHaveBeenCalledWith("release", true);
});
