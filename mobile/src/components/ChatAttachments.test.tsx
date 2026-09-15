import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MessageAttachments } from "./ChatAttachments";

// Bilder im Chat: Lädt eines nicht, steht das in der Kachel - vorher blieb
// sie einfach schwarz (#238). Ein Tipp lädt neu.

jest.mock("../auth/AuthContext", () => ({ useAuth: () => ({ accessToken: "token-1" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const image = { id: "a-1", kind: "image" as const, url: "/api/chat-attachments/a-1", mime: "image/webp", width: 800, height: 600 };

test("ein Ladefehler steht in der Kachel, ein Tipp versucht es erneut", async () => {
  await render(<MessageAttachments attachments={[image]} />);

  const tile = screen.getByTestId("chat-attachment-image-a-1");
  expect(screen.getByLabelText("Bild wird geladen")).toBeTruthy();

  await fireEvent(tile, "error", { nativeEvent: { error: "HTTP 404" } });
  expect(screen.getByTestId("chat-attachment-error-a-1")).toBeTruthy();
  expect(screen.getByText(/Bild konnte nicht geladen werden \(HTTP 404\)/)).toBeTruthy();

  await fireEvent.press(screen.getByLabelText("Bild erneut laden"));
  expect(screen.queryByTestId("chat-attachment-error-a-1")).toBeNull();
  expect(screen.getByTestId("chat-attachment-image-a-1")).toBeTruthy();
});

test("nach dem Laden verschwindet der Hinweis", async () => {
  await render(<MessageAttachments attachments={[image]} />);

  await fireEvent(screen.getByTestId("chat-attachment-image-a-1"), "load");
  expect(screen.queryByLabelText("Bild wird geladen")).toBeNull();
  expect(screen.queryByTestId("chat-attachment-error-a-1")).toBeNull();
});
