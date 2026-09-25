import React from "react";
import { Platform } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppUpdateBanner } from "./AppUpdateBanner";
import type { AppRelease } from "../lib/appUpdate";

// Update aus der App (#250): Herunterladen mit der Anmeldung, prüfen, dann
// installieren; eine kaputte Datei wird nicht installiert; Pflicht-Updates
// haben kein „Später“.

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

test("Herunterladen schickt die Anmeldung mit, prüft die Datei und öffnet den Installer", async () => {
  const downloader = jest.fn(async (_url: string, _headers: Record<string, string>, onProgress: (w: number, e: number) => void) => {
    onProgress(2, 4);
    return { uri: "file:///cache/lionsapp-update.apk", size: 4, md5: "AA" };
  });
  const installer = jest.fn(async () => {});
  await render(
    <AppUpdateBanner release={release} mandatory={false} token="token-1" onLater={jest.fn()} onWhatsNew={jest.fn()} confirmInstall={async () => true} downloader={downloader} installer={installer} />,
  );

  expect(screen.getByText("Build 63 ist da – v0.5.0-beta")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("app-update-download"));
  await waitFor(() => expect(installer).toHaveBeenCalledWith("file:///cache/lionsapp-update.apk"));
  const [url, headers] = downloader.mock.calls[0];
  expect(url).toMatch(/\/api\/mobile\/app-download\/63$/);
  expect(headers).toEqual({ Authorization: "Bearer token-1" });
  expect(screen.queryByTestId("app-update-error")).toBeNull();
});

test("eine falsche Prüfsumme wird nicht installiert, „Nochmal“ erscheint", async () => {
  const downloader = jest.fn(async () => ({ uri: "file:///cache/x.apk", size: 4, md5: "ff" }));
  const installer = jest.fn(async () => {});
  await render(
    <AppUpdateBanner release={release} mandatory={false} token={null} onLater={jest.fn()} onWhatsNew={jest.fn()} confirmInstall={async () => true} downloader={downloader} installer={installer} />,
  );

  await fireEvent.press(screen.getByTestId("app-update-download"));
  await waitFor(() => expect(screen.getByTestId("app-update-error")).toBeTruthy());
  expect(screen.getByText(/Prüfsumme stimmt nicht/)).toBeTruthy();
  expect(installer).not.toHaveBeenCalled();
  expect(screen.getByText("Nochmal")).toBeTruthy();
});

test("ein Pflicht-Update hat kein „Später“, ein normales schon", async () => {
  const onLater = jest.fn();
  const { rerender } = await render(
    <AppUpdateBanner release={release} mandatory onLater={onLater} onWhatsNew={jest.fn()} confirmInstall={async () => true} token={null} downloader={jest.fn()} installer={jest.fn()} />,
  );
  expect(screen.queryByTestId("app-update-later")).toBeNull();
  expect(screen.getByText(/Dieses Update ist Pflicht\./)).toBeTruthy();

  await rerender(
    <AppUpdateBanner release={release} mandatory={false} onLater={onLater} onWhatsNew={jest.fn()} confirmInstall={async () => true} token={null} downloader={jest.fn()} installer={jest.fn()} />,
  );
  await fireEvent.press(screen.getByTestId("app-update-later"));
  expect(onLater).toHaveBeenCalledTimes(1);
});

// Herkunft Google Play (#421): kein Download, „Update starten“ öffnet Googles Dialog; klappt der
// nicht, die Store-Seite.
test("über Google Play: Update starten statt herunterladen, Store als Rückfall", async () => {
  const { Linking } = jest.requireActual("react-native");
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const downloader = jest.fn();
  const onStartPlayUpdate = jest.fn(async () => false);
  await render(
    <AppUpdateBanner release={release} mandatory onLater={jest.fn()} onWhatsNew={jest.fn()} confirmInstall={async () => true} token={null} path="play" onStartPlayUpdate={onStartPlayUpdate} downloader={downloader} installer={jest.fn()} />,
  );
  expect(screen.queryByTestId("app-update-download")).toBeNull();
  expect(screen.getByText(/kommt über den Play Store/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId("app-update-play"));
  await waitFor(() => expect(onStartPlayUpdate).toHaveBeenCalledWith(true));
  await waitFor(() => expect(openUrl).toHaveBeenCalledWith("market://details?id=at.lionsquad.app"));
  expect(downloader).not.toHaveBeenCalled();
  openUrl.mockRestore();
});

// Beta oder Release (#309): Plakette im Kopf, Rückfrage je Art vor dem Download; „Abbrechen“ lädt nichts.
test("Beta-Plakette und Rückfrage: abgelehnt lädt nichts, bestätigt lädt", async () => {
  const downloader = jest.fn(async () => ({ uri: "file:///cache/x.apk", size: 4, md5: "AA" }));
  const installer = jest.fn(async () => {});
  const confirmInstall = jest.fn(async () => false);
  const { rerender } = await render(
    <AppUpdateBanner release={release} mandatory={false} token={null} onLater={jest.fn()} onWhatsNew={jest.fn()} confirmInstall={confirmInstall} downloader={downloader} installer={installer} />,
  );
  expect(screen.getByTestId("app-update-channel")).toHaveTextContent("BETA · Testversion");
  await fireEvent.press(screen.getByTestId("app-update-download"));
  await waitFor(() => expect(confirmInstall).toHaveBeenCalledWith("beta", false));
  expect(downloader).not.toHaveBeenCalled();

  const yes = jest.fn(async () => true);
  await rerender(
    <AppUpdateBanner release={{ ...release, version: "1.0.0", channel: "release" }} mandatory token={null} onLater={jest.fn()} onWhatsNew={jest.fn()} confirmInstall={yes} downloader={downloader} installer={installer} />,
  );
  expect(screen.getByTestId("app-update-channel")).toHaveTextContent("RELEASE");
  await fireEvent.press(screen.getByTestId("app-update-download"));
  await waitFor(() => expect(installer).toHaveBeenCalled());
  expect(yes).toHaveBeenCalledWith("release", true);
});
