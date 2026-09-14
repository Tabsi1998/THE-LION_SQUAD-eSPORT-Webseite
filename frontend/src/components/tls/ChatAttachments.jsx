import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Loader2, Paperclip, X } from "lucide-react";
import { api } from "@/lib/api";
import {
  CHAT_ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENTS,
  canSendChatMessage,
  chatAttachmentKind,
  chatAttachmentSrc,
  imageFilesFromClipboard,
  readyAttachmentIds,
} from "@/lib/chatAttachments";
import { captureVideoPoster } from "@/lib/videoPoster";

function newLocalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function uploadErrorText(error) {
  const status = error?.response?.status;
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (status === 413) return "Datei ist zu groß.";
  return "Hochladen fehlgeschlagen.";
}

/**
 * Anhänge, die gerade für eine Nachricht vorbereitet werden.
 *
 * Jede Datei wird sofort hochgeladen; gesendet werden nur die Kennungen. So
 * sieht man beim Absenden gleich, ob etwas zu groß oder im falschen Format war.
 */
export function useChatAttachmentDrafts() {
  const [drafts, setDrafts] = useState([]);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  useEffect(() => () => {
    draftsRef.current.forEach((draft) => draft.previewUrl && URL.revokeObjectURL(draft.previewUrl));
  }, []);

  const update = useCallback((localId, patch) => {
    setDrafts((rows) => rows.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  }, []);

  const uploadOne = useCallback(async (localId, file, kind) => {
    try {
      const form = new FormData();
      form.append("file", file);
      if (kind === "video") {
        const poster = await captureVideoPoster(file);
        if (poster) form.append("poster", poster);
      }
      const { data } = await api.post("/chat-attachments", form);
      update(localId, { status: "ready", attachment: data });
    } catch (error) {
      update(localId, { status: "error", error: uploadErrorText(error) });
    }
  }, [update]);

  const addFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let free = MAX_CHAT_ATTACHMENTS - draftsRef.current.filter((draft) => draft.status !== "error").length;
    const added = [];
    for (const file of files) {
      const kind = chatAttachmentKind(file);
      const localId = newLocalId();
      if (!kind) {
        added.push({ localId, kind: "unknown", name: file.name, status: "error", error: "Nur Bilder und Videos." });
        continue;
      }
      if (free <= 0) {
        added.push({ localId, kind, name: file.name, status: "error", error: `Höchstens ${MAX_CHAT_ATTACHMENTS} Anhänge.` });
        continue;
      }
      free -= 1;
      const previewUrl = kind === "image" ? URL.createObjectURL(file) : null;
      added.push({ localId, kind, name: file.name, previewUrl, status: "uploading" });
      uploadOne(localId, file, kind);
    }
    setDrafts((rows) => [...rows, ...added]);
  }, [uploadOne]);

  const remove = useCallback((localId) => {
    setDrafts((rows) => rows.filter((row) => {
      if (row.localId !== localId) return true;
      if (row.previewUrl) URL.revokeObjectURL(row.previewUrl);
      return false;
    }));
  }, []);

  const reset = useCallback(() => {
    setDrafts((rows) => {
      rows.forEach((row) => row.previewUrl && URL.revokeObjectURL(row.previewUrl));
      return [];
    });
  }, []);

  const onPaste = useCallback((event) => {
    // Nur Bilder übernehmen; eingefügter Text landet wie gewohnt im Eingabefeld.
    const files = imageFilesFromClipboard(event);
    if (files.length) addFiles(files);
  }, [addFiles]);

  return {
    drafts,
    addFiles,
    remove,
    reset,
    onPaste,
    attachmentIds: readyAttachmentIds(drafts),
    uploading: drafts.some((draft) => draft.status === "uploading"),
    canSend: (text) => canSendChatMessage(text, drafts),
  };
}

export function ChatAttachButton({ onFiles, disabled = false, testId = "chat-attach" }) {
  const inputRef = useRef(null);
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Bild oder Video anhängen"
        title="Bild oder Video anhängen"
        data-testid={testId}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-white/10 text-white/60 hover:border-[#29B6E8]/50 hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#29B6E8] disabled:opacity-40"
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={CHAT_ATTACHMENT_ACCEPT}
        className="hidden"
        data-testid={`${testId}-input`}
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
}

export function ChatAttachmentDrafts({ drafts, onRemove }) {
  if (!drafts?.length) return null;
  const errors = [...new Set(drafts.filter((draft) => draft.status === "error").map((draft) => draft.error))];
  return (
    <div className="px-3 pt-3" data-testid="chat-attachment-drafts">
      <div className="flex flex-wrap gap-2">
        {drafts.map((draft) => (
          <div
            key={draft.localId}
            title={draft.error || draft.name}
            data-status={draft.status}
            className={`relative h-16 w-16 overflow-hidden rounded-sm border bg-[#0A0A0A] ${draft.status === "error" ? "border-[#FF3B30]/70" : "border-white/10"}`}
          >
            {draft.previewUrl ? (
              <img src={draft.previewUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/50"><Film className="h-5 w-5" /></div>
            )}
            {draft.status === "uploading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60" aria-label="Wird hochgeladen">
                <Loader2 className="h-4 w-4 animate-spin text-[#29B6E8]" />
              </div>
            )}
            <button
              type="button"
              onClick={() => onRemove(draft.localId)}
              aria-label={`${draft.name || "Anhang"} entfernen`}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white hover:bg-black"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      {errors.length > 0 && (
        <p role="alert" className="mt-2 text-xs text-[#FF6B61]">{errors.join(" ")}</p>
      )}
    </div>
  );
}

export function ChatMessageAttachments({ attachments }) {
  const items = Array.isArray(attachments) ? attachments : [];
  if (!items.length) return null;
  return (
    <div className={`mt-2 grid gap-1.5 ${items.length > 1 ? "grid-cols-2" : "grid-cols-1"}`} data-testid="chat-message-attachments">
      {items.map((item) => (item.kind === "video" ? (
        // Von Mitgliedern hochgeladene Chat-Videos haben keine Untertitel; eine leere
        // Spur würde Screenreadern Untertitel vortäuschen, die es nicht gibt.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          key={item.id}
          controls
          playsInline
          preload="none"
          poster={item.poster_url ? chatAttachmentSrc(item.poster_url) : undefined}
          src={chatAttachmentSrc(item.url)}
          className="max-h-72 w-full rounded-sm border border-white/10 bg-black"
        />
      ) : (
        <a key={item.id} href={chatAttachmentSrc(item.url)} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={chatAttachmentSrc(item.url, 400)}
            srcSet={`${chatAttachmentSrc(item.url, 400)} 400w, ${chatAttachmentSrc(item.url, 800)} 800w`}
            sizes="(max-width: 640px) 70vw, 320px"
            loading="lazy"
            alt="Bild im Chat"
            width={item.width || undefined}
            height={item.height || undefined}
            className="h-auto max-h-72 w-full rounded-sm border border-white/10 object-cover"
          />
        </a>
      )))}
    </div>
  );
}
