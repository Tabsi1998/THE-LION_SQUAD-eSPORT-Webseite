import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { ChatThreadView } from "./ChatThreadView";

// Der gemeinsame Chat der App (Direktnachricht, Team, Turnier). Geprüft wird,
// was man am Gerät nicht sieht: dass Bilder mit der Anmeldung geladen werden -
// ohne sie liefert der Server private Anhänge nicht aus - und dass beim Senden
// genau die fertig hochgeladenen Anhänge mitgehen.

// Der erste Fall lädt den ganzen Chat-Baum (RichText, Anhänge, Navigation) zum
// ersten Mal. Unter Node 20, wie im CI-Job der App, dauerte das über die
// Standardgrenze von 5 s - ein Zeitproblem, kein Fehler im Chat.
jest.setTimeout(20_000);

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => ({ accessToken: "token-1" }) }));
jest.mock("../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => undefined }));
jest.mock("react-native-keyboard-controller", () => {
  const { View } = jest.requireActual("react-native");
  return { KeyboardAvoidingView: View };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// expo-asset liegt verschachtelt unter node_modules/expo. Metro findet es beim
// Bündeln der App (expo export läuft durch), Jest mit Node-Auflösung nicht.
// Icons sind hier ohnehin nicht Gegenstand des Tests.
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

type ImageSource = { uri: string; headers?: Record<string, string> };

const existing = {
  id: "m-1",
  user_id: "u-2",
  message: "Schaut euch das an",
  attachments: [{ id: "att-old", kind: "image", url: "/api/chat-attachments/att-old" }],
  author: { id: "u-2", display_name: "Mitspieler" },
};

async function renderChat() {
  await render(
    <ChatThreadView
      currentUserId="u-1"
      emptyTitle="Noch keine Teamnachrichten"
      listUrl="/teams/t-1/chat"
      postUrl="/teams/t-1/chat"
    />,
  );
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/teams/t-1/chat"));
}

function attachmentSource(id: string): ImageSource {
  const element = screen.getByTestId(`chat-attachment-image-${id}`) as unknown as { props: { source: ImageSource } };
  return element.props.source;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const stickerCatalog = {
  packs: [
    {
      id: "fluent-esports",
      name: "eSports & Party",
      builtin: true,
      stickers: [
        { id: "fluent-trophy", pack_id: "fluent-esports", name: "Pokal", keywords: ["sieg"], url: "/api/stickers/files/fluent/trophy.png" },
        { id: "fluent-fire", pack_id: "fluent-esports", name: "Feuer", keywords: ["heiß"], url: "/api/stickers/files/fluent/fire.png" },
      ],
    },
  ],
};

// Feste Antwortobjekte wie bisher mit mockResolvedValue: jede Abfrage liefert
// dasselbe Array, so wie React es beim erneuten Laden als unverändert erkennt.
const chatResponse = { data: [existing] };
const stickerResponse = { data: stickerCatalog };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (url: string) => (url === "/stickers" ? stickerResponse : chatResponse));
});

afterEach(async () => {
  // Der Chat scrollt nach dem Senden verzögert ans Ende (setTimeout 50 ms, dann
  // requestAnimationFrame). Diese Timer müssen durch sein, bevor Jest die
  // Umgebung abbaut - sonst meldet Jest nach allen grünen Tests einen Fehler.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
});

test("der Chat lädt beim Öffnen einmal - auch wenn jede Antwort ein neues Array ist", async () => {
  // Wie ein echter Server: jede Abfrage liefert neue Objekte.
  mockGet.mockImplementation(async () => ({ data: [{ ...existing }] }));
  await renderChat();
  await flush();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  expect(mockGet.mock.calls.filter(([url]) => url === "/teams/t-1/chat")).toHaveLength(1);
});

test("Nachrichten zeigen die Uhrzeit, und kurz aufeinanderfolgende teilen sich den Kopf", async () => {
  const today = (hour: number, minute: number) => new Date(new Date().setHours(hour, minute, 0, 0)).toISOString();
  mockGet.mockImplementation(async (url: string) => (url === "/stickers" ? stickerResponse : {
    data: [
      { id: "g-1", user_id: "u-2", message: "Erste", created_at: today(10, 0), author: { id: "u-2", display_name: "Mitspieler" } },
      { id: "g-2", user_id: "u-2", message: "Zweite, gleich danach", created_at: today(10, 2), author: { id: "u-2", display_name: "Mitspieler" } },
      { id: "g-3", user_id: "u-1", message: "Antwort", created_at: today(10, 3) },
    ],
  }));
  await renderChat();

  await waitFor(() => expect(screen.getByText("Antwort")).toBeTruthy());
  // Zwei Nachrichten von "Mitspieler" innerhalb von fünf Minuten: ein Kopf.
  expect(screen.getAllByText("Mitspieler")).toHaveLength(1);
  expect(screen.getByText("10:00")).toBeTruthy();
  expect(screen.queryByText("10:02")).toBeNull();
  expect(screen.getByText("10:03")).toBeTruthy();
});

test("Bilder im Verlauf laden mit Anmeldung und in der kleinen Fassung", async () => {
  await renderChat();

  await waitFor(() => expect(screen.getByTestId("chat-attachment-image-att-old")).toBeTruthy());
  const source = attachmentSource("att-old");
  expect(source.uri).toMatch(/\/api\/chat-attachments\/att-old\?w=800$/);
  expect(source.headers).toEqual({ Authorization: "Bearer token-1" });
});

test("ein ausgewähltes Bild wird hochgeladen und mit der Nachricht gesendet", async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:///aufstellung.jpg", mimeType: "image/jpeg", fileName: "aufstellung.jpg", fileSize: 2048, width: 10, height: 10 }],
  } as never);
  mockPost.mockImplementation(async (url: string) => {
    if (url === "/chat-attachments") {
      return { data: { id: "att-new", kind: "image", url: "/api/chat-attachments/att-new" } };
    }
    return { data: { id: "m-2", user_id: "u-1", message: "", attachments: [{ id: "att-new", kind: "image", url: "/api/chat-attachments/att-new" }] } };
  });
  await renderChat();

  await act(async () => {
    fireEvent.press(screen.getByLabelText("Bild oder Video anhängen"));
  });
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
    "/chat-attachments",
    expect.anything(),
    expect.objectContaining({ timeout: 120000 }),
  ));
  await flush();

  await act(async () => {
    fireEvent.press(screen.getByText("Senden"));
  });

  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/teams/t-1/chat", { message: "", attachment_ids: ["att-new"] }));
  await waitFor(() => expect(screen.queryByTestId("chat-attachment-drafts")).toBeNull());
});

test("ein Sticker geht mit einem Tipp in den Chat - nur mit seiner Kennung", async () => {
  mockPost.mockResolvedValue({
    data: { id: "m-3", user_id: "u-1", message: "", attachments: [], sticker: stickerCatalog.packs[0].stickers[0] },
  });
  await renderChat();

  await act(async () => {
    fireEvent.press(screen.getByLabelText("Sticker"));
  });
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/stickers"));
  fireEvent.changeText(screen.getByTestId("chat-sticker-search"), "sieg");
  await waitFor(() => expect(screen.queryByLabelText("Sticker Feuer senden")).toBeNull());

  await act(async () => {
    fireEvent.press(screen.getByLabelText("Sticker Pokal senden"));
  });

  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/teams/t-1/chat", { sticker_id: "fluent-trophy" }));
  const sticker = await screen.findByTestId("chat-message-sticker");
  const source = (sticker as unknown as { props: { source: ImageSource } }).props.source;
  expect(source.uri).toMatch(/\/api\/stickers\/files\/fluent\/trophy\.png$/);
  expect(source.headers).toBeUndefined();
});

test("ein GIF wird gar nicht erst hochgeladen", async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:///lustig.gif", mimeType: "image/gif", fileName: "lustig.gif", fileSize: 512, width: 10, height: 10 }],
  } as never);
  await renderChat();

  await act(async () => {
    fireEvent.press(screen.getByLabelText("Bild oder Video anhängen"));
  });

  await waitFor(() => expect(screen.getByText("Nur Bilder und Videos.")).toBeTruthy());
  expect(mockPost).not.toHaveBeenCalledWith("/chat-attachments", expect.anything(), expect.anything());
});

test("lange auf eine fremde Nachricht drücken meldet sie - eigene nicht (#414)", async () => {
  const onReportMessage = jest.fn();
  mockGet.mockImplementation(async (url: string) => (url === "/stickers" ? stickerResponse : {
    data: [
      { id: "g-1", user_id: "u-2", message: "Fremd", author: { id: "u-2", display_name: "Mitspieler" } },
      { id: "g-2", user_id: "u-1", message: "Eigen" },
    ],
  }));
  await render(
    <ChatThreadView currentUserId="u-1" emptyTitle="Leer" listUrl="/teams/t-1/chat" postUrl="/teams/t-1/chat" onReportMessage={onReportMessage} />,
  );
  await waitFor(() => expect(screen.getByText("Fremd")).toBeTruthy());

  await fireEvent(screen.getByTestId("chat-message-g-1"), "longPress");
  expect(onReportMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "g-1", user_id: "u-2" }));
  await fireEvent(screen.getByTestId("chat-message-g-2"), "longPress");
  expect(onReportMessage).toHaveBeenCalledTimes(1);
});
