import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// Bilder vom Handy (#1153): Tipp aufs Bild → Kamera oder Galerie → Zuschnitt im Format der Stelle → Hochladen wie im
// Web (`/uploads/image`) → speichern. Abbrechen ändert nichts; ohne Netz oder bei einem Fehler bleibt das alte Bild.

const mockLibrary = jest.fn();
const mockCamera = jest.fn();
const mockPermission = jest.fn();
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLibrary(...args),
  launchCameraAsync: (...args: unknown[]) => mockCamera(...args),
  requestCameraPermissionsAsync: () => mockPermission(),
}));
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback),
  resolveMediaUrl: (value: string) => value,
}));
jest.mock("./MediaImage", () => ({ MediaImage: ({ uri }: { uri?: string }) => {
  const { Text } = jest.requireActual("react-native");
  return <Text testID="media-image">{uri || "leer"}</Text>;
} }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const { IMAGE_ASPECT, ImagePickField } = require("./ImagePickField");

const asset = { uri: "file:///handy/bild.jpg", mimeType: "image/jpeg", fileName: "bild.jpg", width: 900, height: 300 };

/** Das Auswahl-Fenster: der Test tippt die gewünschte Schaltfläche. */
function chooseIn(label: string) {
  return jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    const button = (buttons || []).find((entry) => entry.text === label);
    button?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

test("Galerie: Zuschnitt im Breitformat, Hochladen wie im Web, dann speichern", async () => {
  chooseIn("Aus der Galerie");
  mockLibrary.mockResolvedValue({ canceled: false, assets: [asset] });
  mockPost.mockResolvedValue({ data: { url: "/api/static/uploads/neu.webp" } });
  const onUploaded = jest.fn(async () => {});
  await render(<ImagePickField label="Banner" shape="banner" value="/api/static/uploads/alt.webp" onUploaded={onUploaded} testID="pick" />);
  await fireEvent.press(screen.getByTestId("pick-open"));
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("/api/static/uploads/neu.webp"));
  expect(mockLibrary).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: true, aspect: [3, 1], mediaTypes: ["images"] }));
  const [url, form, config] = mockPost.mock.calls[0];
  expect(url).toBe("/uploads/image");
  expect(form).toBeInstanceOf(FormData);
  expect(config.headers["Content-Type"]).toBe("multipart/form-data");
  expect(screen.getByTestId("pick-message")).toHaveTextContent("Gespeichert. Jedes Bild geht noch kurz durch die Bildprüfung.");
  expect(IMAGE_ASPECT.round).toEqual([1, 1]);
  expect(IMAGE_ASPECT.square).toEqual([1, 1]);
});

test("Abbrechen: nichts wird hochgeladen, nichts gespeichert", async () => {
  chooseIn("Aus der Galerie");
  mockLibrary.mockResolvedValue({ canceled: true, assets: null });
  const onUploaded = jest.fn();
  await render(<ImagePickField label="Profilbild" shape="round" onUploaded={onUploaded} testID="pick" />);
  await fireEvent.press(screen.getByTestId("pick-open"));
  await waitFor(() => expect(mockLibrary).toHaveBeenCalled());
  expect(mockPost).not.toHaveBeenCalled();
  expect(onUploaded).not.toHaveBeenCalled();
});

test("Kamera ohne Erlaubnis: ein Satz statt Absturz; ohne Netz bleibt das alte Bild", async () => {
  chooseIn("Foto aufnehmen");
  mockPermission.mockResolvedValue({ granted: false });
  const onUploaded = jest.fn();
  await render(<ImagePickField label="Profilbild" shape="round" value="/api/static/uploads/alt.webp" onUploaded={onUploaded} testID="pick" />);
  await fireEvent.press(screen.getByTestId("pick-open"));
  await waitFor(() => expect(screen.getByTestId("pick-message")).toHaveTextContent(/Kamera-Erlaubnis/));
  expect(mockCamera).not.toHaveBeenCalled();

  mockPermission.mockResolvedValue({ granted: true });
  mockCamera.mockResolvedValue({ canceled: false, assets: [asset] });
  mockPost.mockRejectedValue(Object.assign(new Error("Network Error"), { isAxiosError: true, code: "ERR_NETWORK" }));
  await fireEvent.press(screen.getByTestId("pick-open"));
  await waitFor(() => expect(screen.getByTestId("pick-message")).toHaveTextContent("Ohne Netz – das alte Bild bleibt. Versuch es noch einmal, sobald du Netz hast."));
  expect(onUploaded).not.toHaveBeenCalled();
  expect(screen.getByTestId("media-image")).toHaveTextContent("/api/static/uploads/alt.webp");
});

test("Speichern scheitert (etwa keine Rechte am Team): Meldung, das alte Bild bleibt", async () => {
  chooseIn("Aus der Galerie");
  mockLibrary.mockResolvedValue({ canceled: false, assets: [asset] });
  mockPost.mockResolvedValue({ data: { url: "/api/static/uploads/neu.webp" } });
  const onUploaded = jest.fn(async () => {
    throw new Error("Keine Berechtigung");
  });
  await render(<ImagePickField label="Logo" shape="square" value="/api/static/uploads/alt.webp" onUploaded={onUploaded} testID="pick" />);
  await fireEvent.press(screen.getByTestId("pick-open"));
  await waitFor(() => expect(screen.getByTestId("pick-message")).toHaveTextContent("Keine Berechtigung Das alte Bild bleibt."));
  expect(screen.getByTestId("media-image")).toHaveTextContent("/api/static/uploads/alt.webp");
  expect(screen.getByTestId("pick-open").props.accessibilityLabel).toBe("Logo ändern");
});
