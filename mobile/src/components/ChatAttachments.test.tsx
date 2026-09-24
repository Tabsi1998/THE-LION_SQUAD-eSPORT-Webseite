import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { api } from "../lib/api";
import { forgetAttachmentData } from "../lib/chatAttachments";
import { resetAuthorizedImageState } from "./AuthorizedImage";
import { MessageAttachments } from "./ChatAttachments";

// Bilder im Chat (#238). Scheitert der Bildlader des Systems mit einem
// Fehlercode, holt der API-Client das Bild; klappt das, gehen weitere Bilder
// gleich diesen Weg. Scheitert auch das, steht der HTTP-Status mit Grund in
// der Kachel, und ein Tipp lädt neu.

jest.mock("../auth/AuthContext", () => ({ useAuth: () => ({ accessToken: "token-1" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    this.result = "data:image/webp;base64,QUJD";
    setTimeout(() => this.onloadend?.(), 0);
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = FakeFileReader;

const image = { id: "a-1", kind: "image" as const, url: "/api/chat-attachments/a-1", mime: "image/webp", width: 800, height: 600 };
const other = { id: "b-2", kind: "image" as const, url: "/api/chat-attachments/b-2", mime: "image/webp", width: 800, height: 600 };
const fresco = "Unexpected HTTP code Response{protocol=h2, code=404, message=, url=https://lionsquad.at/api/chat-attachments/a-1?w=800}";

function notFound() {
  return Object.assign(new Error("Request failed with status code 404"), {
    isAxiosError: true,
    response: { status: 404, data: { detail: "Anhang nicht gefunden" } },
  });
}

let get: jest.SpyInstance;

beforeEach(() => {
  resetAuthorizedImageState();
  forgetAttachmentData();
  get = jest.spyOn(api, "get");
});

afterEach(() => {
  get.mockRestore();
});

test("scheitern Bildlader und API-Client, steht der HTTP-Status mit Grund in der Kachel; ein Tipp versucht es erneut", async () => {
  get.mockRejectedValue(notFound());
  await render(<MessageAttachments attachments={[image]} />);

  const tile = screen.getByTestId("chat-attachment-image-a-1");
  expect(screen.getByLabelText("Bild wird geladen")).toBeTruthy();

  await fireEvent(tile, "error", { nativeEvent: { error: fresco } });
  await waitFor(() => expect(screen.getByTestId("chat-attachment-error-a-1")).toBeTruthy());
  expect(screen.getByText(/Bild konnte nicht geladen werden \(HTTP 404: Anhang nicht gefunden\)/)).toBeTruthy();
  expect(get).toHaveBeenCalledWith("http://10.0.2.2:8001/api/chat-attachments/a-1?w=800", { responseType: "blob" });

  await fireEvent.press(screen.getByLabelText("Bild erneut laden"));
  expect(screen.queryByTestId("chat-attachment-error-a-1")).toBeNull();
  expect(screen.getByTestId("chat-attachment-image-a-1")).toBeTruthy();
});

test("liefert der API-Client das Bild, erscheint es ohne Hinweis - und das nächste Bild geht gleich diesen Weg", async () => {
  get.mockResolvedValue({ data: new Blob(["abc"]) });
  await render(<MessageAttachments attachments={[image]} />);

  await fireEvent(screen.getByTestId("chat-attachment-image-a-1"), "error", { nativeEvent: { error: fresco } });
  await waitFor(() => expect(screen.getByTestId("chat-attachment-image-a-1").props.source).toEqual({ uri: "data:image/webp;base64,QUJD" }));
  expect(screen.queryByTestId("chat-attachment-error-a-1")).toBeNull();
  await fireEvent(screen.getByTestId("chat-attachment-image-a-1"), "load");
  expect(screen.queryByLabelText("Bild wird geladen")).toBeNull();

  await render(<MessageAttachments attachments={[other]} />);
  await waitFor(() => expect(screen.getByTestId("chat-attachment-image-b-2").props.source).toEqual({ uri: "data:image/webp;base64,QUJD" }));
  expect(get).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenLastCalledWith("http://10.0.2.2:8001/api/chat-attachments/b-2?w=800", { responseType: "blob" });
});

test("ein Fehler ohne HTTP-Status (Decoder) steht als Text in der Kachel, ohne den direkten Weg abzuschreiben", async () => {
  get.mockResolvedValue({ data: new Blob(["abc"]) });
  await render(<MessageAttachments attachments={[image]} />);

  await fireEvent(screen.getByTestId("chat-attachment-image-a-1"), "error", { nativeEvent: { error: "Failed to decode image" } });
  await waitFor(() => expect(screen.getByTestId("chat-attachment-image-a-1").props.source).toEqual({ uri: "data:image/webp;base64,QUJD" }));
  await fireEvent(screen.getByTestId("chat-attachment-image-a-1"), "error", { nativeEvent: { error: "Failed to decode image" } });
  expect(screen.getByText(/Bild konnte nicht geladen werden \(Failed to decode image\)/)).toBeTruthy();

  await render(<MessageAttachments attachments={[other]} />);
  expect(screen.getByTestId("chat-attachment-image-b-2").props.source).toMatchObject({ headers: { Authorization: "Bearer token-1" } });
});

test("nach dem Laden verschwindet der Hinweis", async () => {
  await render(<MessageAttachments attachments={[image]} />);

  await fireEvent(screen.getByTestId("chat-attachment-image-a-1"), "load");
  expect(screen.queryByLabelText("Bild wird geladen")).toBeNull();
  expect(screen.queryByTestId("chat-attachment-error-a-1")).toBeNull();
  expect(get).not.toHaveBeenCalled();
});

test("Bildprüfung (#415): ein entferntes Bild ist ein Platzhalter, ein ungeprüftes zeigt „wird geprüft“ statt des Fehlers", async () => {
  get.mockRejectedValue(notFound());
  await render(<MessageAttachments attachments={[{ ...image, scan_state: "blocked" as const }, { ...other, scan_state: "pending" as const }]} />);

  expect(screen.getByTestId("chat-attachment-removed-a-1")).toBeTruthy();
  expect(screen.queryByTestId("chat-attachment-image-a-1")).toBeNull();
  expect(screen.getByText("Bild entfernt – Moderation")).toBeTruthy();

  await fireEvent(screen.getByTestId("chat-attachment-image-b-2"), "error", { nativeEvent: { error: fresco } });
  await waitFor(() => expect(screen.getByTestId("chat-attachment-error-b-2")).toBeTruthy());
  expect(screen.getByText("Bild wird geprüft – noch nicht sichtbar.")).toBeTruthy();
});
