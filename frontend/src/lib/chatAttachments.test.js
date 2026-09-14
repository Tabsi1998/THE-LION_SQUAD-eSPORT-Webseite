import {
  canSendChatMessage,
  chatAttachmentKind,
  chatAttachmentSrc,
  imageFilesFromClipboard,
  readyAttachmentIds,
} from "./chatAttachments";

describe("Chat-Anhänge", () => {
  test("erkennt Bilder und Videos, auch wenn der Browser keinen Typ nennt", () => {
    expect(chatAttachmentKind({ type: "image/jpeg", name: "foto.jpg" })).toBe("image");
    expect(chatAttachmentKind({ type: "video/quicktime", name: "clip.mov" })).toBe("video");
    expect(chatAttachmentKind({ type: "", name: "IMG_0001.WEBP" })).toBe("image");
    expect(chatAttachmentKind({ type: "", name: "tor.mp4" })).toBe("video");
  });

  test("lehnt alles andere ab", () => {
    expect(chatAttachmentKind({ type: "application/pdf", name: "vertrag.pdf" })).toBeNull();
    expect(chatAttachmentKind({ type: "image/gif", name: "lustig.gif" })).toBeNull();
    expect(chatAttachmentKind(null)).toBeNull();
  });

  test("baut die Adresse mit der gewünschten Bildbreite", () => {
    const src = chatAttachmentSrc("/api/chat-attachments/a1", 400);
    expect(src.endsWith("/api/chat-attachments/a1?w=400")).toBe(true);
    expect(chatAttachmentSrc("/api/chat-attachments/a1").endsWith("/api/chat-attachments/a1")).toBe(true);
    expect(chatAttachmentSrc("")).toBe("");
  });

  test("sendet Text, fertige Anhänge oder beides - aber nicht während eines Uploads", () => {
    const ready = { status: "ready", attachment: { id: "a1" } };
    const uploading = { status: "uploading" };
    const failed = { status: "error", error: "zu groß" };

    expect(canSendChatMessage("", [])).toBe(false);
    expect(canSendChatMessage("  ", [failed])).toBe(false);
    expect(canSendChatMessage("", [ready])).toBe(true);
    expect(canSendChatMessage("Hallo", [])).toBe(true);
    expect(canSendChatMessage("Hallo", [ready, uploading])).toBe(false);
  });

  test("schickt nur die Kennungen fertiger Anhänge mit", () => {
    const drafts = [
      { status: "ready", attachment: { id: "a1" } },
      { status: "error" },
      { status: "ready", attachment: { id: "a2" } },
    ];
    expect(readyAttachmentIds(drafts)).toEqual(["a1", "a2"]);
  });

  test("holt eingefügte Bilder aus der Zwischenablage und lässt Text in Ruhe", () => {
    const picture = { name: "screenshot.png" };
    const event = {
      clipboardData: {
        items: [
          { kind: "string", type: "text/plain", getAsFile: () => null },
          { kind: "file", type: "image/png", getAsFile: () => picture },
          { kind: "file", type: "application/pdf", getAsFile: () => ({ name: "x.pdf" }) },
        ],
      },
    };
    expect(imageFilesFromClipboard(event)).toEqual([picture]);
    expect(imageFilesFromClipboard({})).toEqual([]);
  });
});
