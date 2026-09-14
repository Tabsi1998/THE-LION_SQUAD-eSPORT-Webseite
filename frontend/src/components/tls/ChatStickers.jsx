import { useEffect, useRef, useState } from "react";
import { Loader2, Search, Sticker as StickerIcon, X } from "lucide-react";
import { api } from "@/lib/api";
import { searchStickers, stickerSrc } from "@/lib/stickers";

// Ein Katalog für alle Chats der Seite. Beim Öffnen wird er trotzdem neu
// geholt, damit ein frisch angelegtes Paket ohne Neuladen erscheint.
let cachedPacks = null;

export function ChatStickerButton({ open, onToggle, disabled = false, testId = "chat-stickers" }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label="Sticker"
      aria-expanded={Boolean(open)}
      title="Sticker"
      data-testid={testId}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border hover:border-[#29B6E8]/50 hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#29B6E8] disabled:opacity-40 ${open ? "border-[#29B6E8]/60 text-[#29B6E8]" : "border-white/10 text-white/60"}`}
    >
      <StickerIcon className="h-4 w-4" />
    </button>
  );
}

/** Auswahl über dem Eingabefeld. Ein Klick sendet den Sticker sofort, wie im Messenger. */
export function ChatStickerPicker({ open, onClose, onPick, disabled = false }) {
  const [packs, setPacks] = useState(cachedPacks);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [activePackId, setActivePackId] = useState(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api.get("/stickers")
      .then(({ data }) => {
        if (cancelled) return;
        cachedPacks = Array.isArray(data?.packs) ? data.packs : [];
        setPacks(cachedPacks);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled && !cachedPacks) setFailed(true);
      });
    const onKey = (event) => {
      if (event.key === "Escape") closeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  const list = packs || [];
  const activePack = list.find((pack) => pack.id === activePackId) || list[0];
  const searching = Boolean(query.trim());
  const visible = searching ? searchStickers(list, query) : activePack?.stickers || [];

  return (
    <div className="border-t border-white/10 bg-[#0A0A0A] px-3 pb-2 pt-3" role="dialog" aria-label="Sticker auswählen" data-testid="chat-sticker-picker">
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Sticker suchen</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sticker suchen, z. B. Pokal"
            data-testid="chat-sticker-search"
            className="h-9 w-full rounded-sm border border-white/10 bg-[#121212] pl-8 pr-3 text-sm focus:border-[#29B6E8] focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label="Sticker schließen"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-white/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#29B6E8]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!searching && list.length > 1 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Stickerpakete">
          {list.map((pack) => {
            const selected = pack.id === activePack?.id;
            return (
              <button
                key={pack.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActivePackId(pack.id)}
                className={`shrink-0 whitespace-nowrap rounded-sm border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${selected ? "border-[#29B6E8]/60 bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/10 text-white/55 hover:text-white"}`}
              >
                {pack.name}
              </button>
            );
          })}
        </div>
      )}

      {visible.length > 0 && (
        <div className="mt-2 grid max-h-56 grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1 overflow-y-auto">
          {visible.map((sticker) => (
            <button
              key={sticker.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(sticker)}
              aria-label={`Sticker ${sticker.name} senden`}
              title={sticker.name}
              className="flex aspect-square items-center justify-center rounded-sm p-1 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#29B6E8] disabled:opacity-40"
            >
              <img src={stickerSrc(sticker.url)} alt="" loading="lazy" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}

      {packs === null && !failed && (
        <div className="flex justify-center py-6" aria-label="Sticker werden geladen">
          <Loader2 className="h-4 w-4 animate-spin text-[#29B6E8]" />
        </div>
      )}
      {failed && <p role="alert" className="py-4 text-center text-xs text-[#FF6B61]">Sticker konnten nicht geladen werden.</p>}
      {packs !== null && searching && visible.length === 0 && (
        <p className="py-4 text-center text-xs text-white/40">Kein Sticker passt zu „{query.trim()}“.</p>
      )}
    </div>
  );
}

export function ChatMessageSticker({ sticker }) {
  if (!sticker?.url) return null;
  return (
    <img
      src={stickerSrc(sticker.url)}
      alt={`Sticker: ${sticker.name || "Sticker"}`}
      title={sticker.name}
      loading="lazy"
      width={112}
      height={112}
      data-testid="chat-message-sticker"
      className="mt-1 h-28 w-28 object-contain"
    />
  );
}
