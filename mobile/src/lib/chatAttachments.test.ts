import {
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_VIDEO_BYTES,
  attachmentKindForAsset,
  authorizedSource,
  canSendChatMessage,
  describeAttachmentError,
  httpStatusFromImageError,
  readyAttachmentIds,
  tooLargeMessage,
  uploadPartForAsset,
  type ChatAttachmentDraft,
} from "./chatAttachments";

// Chat-Anhänge in der App. Zwei Zusagen stehen im Mittelpunkt: Nur Bilder und
// Videos gehen überhaupt auf die Reise, und jede Quelle trägt die Anmeldung -
// ohne Token liefert der Server private Anhänge gar nicht aus.

describe("welche Dateien in den Chat dürfen", () => {
  test("Bilder und Videos nach Dateityp", () => {
    expect(attachmentKindForAsset({ uri: "file:///a", mimeType: "image/jpeg" })).toBe("image");
    expect(attachmentKindForAsset({ uri: "file:///a", mimeType: "image/heic" })).toBe("image");
    expect(attachmentKindForAsset({ uri: "file:///a", mimeType: "video/quicktime" })).toBe("video");
  });

  test("ohne Dateityp entscheiden Endung und Auswahl", () => {
    expect(attachmentKindForAsset({ uri: "file:///clip.MOV" })).toBe("video");
    expect(attachmentKindForAsset({ uri: "content://media/42", fileName: "foto.png" })).toBe("image");
    expect(attachmentKindForAsset({ uri: "content://media/43", type: "livePhoto" })).toBe("image");
    expect(attachmentKindForAsset({ uri: "content://media/44", type: "video" })).toBe("video");
  });

  test("GIFs sind Bilder (#239); alles andere wird abgelehnt", () => {
    expect(attachmentKindForAsset({ uri: "file:///lustig.gif", mimeType: "image/gif" })).toBe("image");
    expect(attachmentKindForAsset({ uri: "content://tastatur/7", fileName: "sticker.GIF" })).toBe("image");
    expect(attachmentKindForAsset({ uri: "file:///vertrag.pdf", mimeType: "application/pdf" })).toBeNull();
    expect(attachmentKindForAsset({ uri: "content://unbekannt" })).toBeNull();
  });

  test("zu große Dateien fallen vor dem Hochladen auf", () => {
    expect(tooLargeMessage({ uri: "x", fileSize: MAX_CHAT_IMAGE_BYTES + 1 }, "image")).toMatch(/25 MB/);
    expect(tooLargeMessage({ uri: "x", fileSize: MAX_CHAT_VIDEO_BYTES + 1 }, "video")).toMatch(/100 MB/);
    expect(tooLargeMessage({ uri: "x", fileSize: MAX_CHAT_IMAGE_BYTES }, "image")).toBeNull();
    // Ohne Größenangabe entscheidet der Server.
    expect(tooLargeMessage({ uri: "x" }, "video")).toBeNull();
  });
});

describe("Hochladen", () => {
  test("ein Asset ohne Dateinamen bekommt einen passenden Namen", () => {
    expect(uploadPartForAsset({ uri: "file:///1", mimeType: "video/quicktime" }, "video"))
      .toEqual({ uri: "file:///1", name: "video.mov", type: "video/quicktime" });
    expect(uploadPartForAsset({ uri: "file:///2" }, "image"))
      .toEqual({ uri: "file:///2", name: "bild.jpg", type: "image/jpeg" });
    expect(uploadPartForAsset({ uri: "file:///3", fileName: "tor.mp4", mimeType: "video/mp4" }, "video").name).toBe("tor.mp4");
  });
});

describe("Senden", () => {
  const ready: ChatAttachmentDraft = { localId: "1", kind: "image", name: "a", previewUri: null, status: "ready", attachment: { id: "att-1", kind: "image", url: "/api/chat-attachments/att-1" } };
  const uploading: ChatAttachmentDraft = { localId: "2", kind: "video", name: "b", previewUri: null, status: "uploading" };
  const failed: ChatAttachmentDraft = { localId: "3", kind: "unknown", name: "c", previewUri: null, status: "error", error: "Nur Bilder und Videos." };

  test("Text, fertige Anhänge oder beides - aber nicht während eines Uploads", () => {
    expect(canSendChatMessage("", [])).toBe(false);
    expect(canSendChatMessage("  ", [failed])).toBe(false);
    expect(canSendChatMessage("", [ready])).toBe(true);
    expect(canSendChatMessage("Hallo", [])).toBe(true);
    expect(canSendChatMessage("Hallo", [ready, uploading])).toBe(false);
  });

  test("mitgeschickt werden nur fertige Anhänge", () => {
    expect(readyAttachmentIds([ready, failed, uploading])).toEqual(["att-1"]);
  });
});

describe("Quellen mit Anmeldung", () => {
  test("jede Quelle trägt den Token und kann eine kleinere Fassung anfordern", () => {
    const source = authorizedSource("/api/chat-attachments/att-1", "token-1", 800);
    expect(source?.uri).toMatch(/\/api\/chat-attachments\/att-1\?w=800$/);
    expect(source).toMatchObject({ headers: { Authorization: "Bearer token-1" } });
  });

  test("ohne Adresse keine Quelle, ohne Token keine Kopfzeile", () => {
    expect(authorizedSource(null, "token-1")).toBeNull();
    expect(authorizedSource("/api/chat-attachments/att-1", null)).not.toHaveProperty("headers");
  });
});

describe("Fehlergrund eines Bildes (#238)", () => {
  test("der HTTP-Status steckt in den Meldungen von Android, iOS und im Kurzformat", () => {
    expect(httpStatusFromImageError("Unexpected HTTP code Response{protocol=h2, code=404, message=, url=https://x/a?w=800}")).toBe(404);
    expect(httpStatusFromImageError("The operation couldn’t be completed. Response status code: 401")).toBe(401);
    expect(httpStatusFromImageError("HTTP 503")).toBe(503);
    expect(httpStatusFromImageError("Failed to decode image")).toBeNull();
    expect(httpStatusFromImageError(undefined)).toBeNull();
  });

  test("die Beschreibung nennt Status und Grund des Servers, sonst die Netzmeldung", () => {
    const denied = Object.assign(new Error("Request failed with status code 404"), {
      isAxiosError: true,
      response: { status: 404, data: { detail: "Anhang nicht gefunden" } },
    });
    expect(describeAttachmentError(denied)).toBe("HTTP 404: Anhang nicht gefunden");
    const offline = Object.assign(new Error("Network Error"), { isAxiosError: true, code: "ERR_NETWORK" });
    expect(describeAttachmentError(offline)).toBe("Keine Internetverbindung. Bitte prüfe dein Netz.");
    expect(describeAttachmentError(new Error("Bild konnte nicht gelesen werden."))).toBe("Bild konnte nicht gelesen werden.");
  });
});
