import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { PhotoSubmitCard } from "./PhotoSubmitCard";

// Fotos vom Event einsenden (#1186): ohne Haken kein Senden; je Foto ein Upload mit Einverständnis und Wunsch zum
// Namen; danach „wartet auf Freigabe“. Nach der Frist nur ein Satz.

const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [
    { uri: "file:///a.jpg", mimeType: "image/jpeg", fileName: "a.jpg" },
    { uri: "file:///b.heic", mimeType: "image/heic", fileName: "b.heic" },
    { uri: "file:///c.png", mimeType: "image/png", fileName: "c.png" },
  ] })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));

const OPEN = { open: true, until: "2026-10-22", max: 20, used: 0, pending: 0, remaining: 20, can_submit: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: { id: "s1", status: "pending" } });
});

test("ohne Angaben nichts, nach der Frist nur ein Satz", async () => {
  await render(<PhotoSubmitCard albumId="herbst" info={null} />);
  expect(screen.queryByTestId("photo-submit")).toBeNull();
  await render(<PhotoSubmitCard albumId="herbst" info={{ ...OPEN, open: false, can_submit: false }} />);
  expect(screen.getByTestId("photo-submit-closed")).toHaveTextContent("Einsenden war bis Do., 22. Oktober möglich.");
  expect(screen.queryByTestId("photo-submit-open")).toBeNull();
});

test("Fotos wählen, ohne Haken kein Senden, dann je Foto ein Upload", async () => {
  const onSent = jest.fn();
  await render(<PhotoSubmitCard albumId="herbst-lan-fotos" info={OPEN} onSent={onSent} />);
  expect(screen.getByTestId("photo-submit-hint")).toHaveTextContent("Bis Do., 22. Oktober · noch 20 Fotos");
  await fireEvent.press(screen.getByTestId("photo-submit-open"));
  await fireEvent.press(screen.getByTestId("photo-submit-library"));
  await waitFor(() => expect(screen.getByTestId("photo-submit-files")).toBeTruthy());
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 20 }));
  expect(screen.getByText(/1 Bild passt nicht dazu/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId("photo-submit-send"));
  expect(mockPost).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId("photo-submit-credit"));
  await fireEvent.press(screen.getByTestId("photo-submit-consent"));
  await fireEvent.press(screen.getByTestId("photo-submit-send"));
  await waitFor(() => expect(screen.getByTestId("photo-submit-done")).toHaveTextContent("Danke! 2 Fotos warten auf Freigabe durch den Vorstand."));
  expect(mockPost).toHaveBeenCalledTimes(2);
  const [url, form] = mockPost.mock.calls[0] as [string, unknown];
  expect(url).toBe("/gallery/herbst-lan-fotos/submissions");
  // React Native kennt `_parts`, die Testumgebung ein FormData mit `get`.
  const field = (key: string) => {
    const data = form as { get?: (name: string) => unknown; _parts?: Array<[string, unknown]> };
    return data.get ? data.get(key) : data._parts?.find(([name]) => name === key)?.[1];
  };
  expect(field("consent")).toBe("true");
  expect(field("credit")).toBe("false");
  expect(onSent).toHaveBeenCalled();
});
