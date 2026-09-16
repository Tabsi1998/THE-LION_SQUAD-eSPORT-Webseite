import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { ChatMessageAttachments } from "@/components/tls/ChatAttachments";
import { ChatMessageSticker } from "@/components/tls/ChatStickers";
import { buildTimeline, timeLabel } from "./messageGroups";

const TOP_THRESHOLD_PX = 80;
const BOTTOM_THRESHOLD_PX = 40;

// Der Verlauf einer Unterhaltung (#254): scrollt in sich, beginnt unten, lädt
// beim Hochscrollen ältere Nachrichten nach und hält dabei die Scrollposition.
// Wer nicht ganz unten ist, sieht bei neuen Nachrichten einen Hinweis statt
// eines Sprungs. Tages-Trenner und zusammengefasste Köpfe wie in der App.
export function ConversationView({ me, messages, hasMore, loadingOlder, onLoadOlder, newCount, onSeenNew, emptyText = "Noch keine Nachrichten in diesem Gespräch." }) {
  const boxRef = useRef(null);
  const pendingRestore = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const firstIdRef = useRef(null);
  const lastIdRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
    onSeenNew?.();
  }, [onSeenNew]);

  // Ältere Seite angefordert: Höhe merken, damit nach dem Einfügen oben die
  // Sicht auf derselben Nachricht bleibt.
  const requestOlder = useCallback(() => {
    const box = boxRef.current;
    if (!box || !hasMore || loadingOlder) return;
    pendingRestore.current = { height: box.scrollHeight, top: box.scrollTop };
    onLoadOlder?.();
  }, [hasMore, loadingOlder, onLoadOlder]);

  const onScroll = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
    const bottom = distance <= BOTTOM_THRESHOLD_PX;
    if (bottom !== atBottomRef.current) {
      atBottomRef.current = bottom;
      setAtBottom(bottom);
      if (bottom) onSeenNew?.();
    }
    if (box.scrollTop <= TOP_THRESHOLD_PX) requestOlder();
  }, [onSeenNew, requestOlder]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const firstId = messages.length ? messages[0].id : null;
    const lastId = messages.length ? messages[messages.length - 1].id : null;
    const olderArrived = pendingRestore.current && firstId !== firstIdRef.current && firstIdRef.current !== null;
    if (olderArrived) {
      // Ältere Nachrichten sind oben dazugekommen: um ihre Höhe nachrücken.
      const { height, top } = pendingRestore.current;
      box.scrollTop = box.scrollHeight - height + top;
    } else if (lastId !== lastIdRef.current && (atBottomRef.current || lastIdRef.current === null)) {
      box.scrollTop = box.scrollHeight;
    }
    if (!loadingOlder) pendingRestore.current = null;
    firstIdRef.current = firstId;
    lastIdRef.current = lastId;
  }, [messages, loadingOlder]);

  // Beim Öffnen einer anderen Unterhaltung wieder unten anfangen.
  useEffect(() => {
    firstIdRef.current = null;
    lastIdRef.current = null;
    atBottomRef.current = true;
    setAtBottom(true);
  }, [me?.id]);

  const items = buildTimeline(messages, me?.id);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={boxRef}
        onScroll={onScroll}
        data-testid="conversation-scroll"
        className="absolute inset-0 overflow-y-auto overscroll-contain px-3 md:px-4 py-3"
      >
        {hasMore ? (
          <div className="text-center py-2">
            <button type="button" onClick={requestOlder} disabled={loadingOlder} data-testid="conversation-load-older" className="text-[11px] uppercase tracking-wider font-bold text-white/45 hover:text-white disabled:opacity-50">
              {loadingOlder ? "Lade ältere Nachrichten …" : "Ältere Nachrichten laden"}
            </button>
          </div>
        ) : null}
        {items.length === 0 ? <div className="text-center py-16 text-sm text-white/35">{emptyText}</div> : null}
        {items.map((item) => {
          if (item.type === "day") {
            return (
              <div key={item.key} className="flex items-center gap-3 my-3" data-testid="conversation-day">
                <span className="h-px flex-1 bg-white/10" />
                <span className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-bold">{item.label}</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
            );
          }
          const { message, mine, showHeader } = item;
          return (
            <div key={item.key} className={`flex ${mine ? "justify-end" : "justify-start"} ${showHeader ? "mt-3" : "mt-1"}`} data-testid={`conversation-message-${message.id}`}>
              <div className={`max-w-[85%] md:max-w-[70%] border rounded-sm px-3 py-2 ${mine ? "border-[#29B6E8]/40 bg-[#29B6E8]/10" : "border-white/10 bg-[#0A0A0A]"}`}>
                {showHeader ? (
                  <div className="text-[10px] uppercase tracking-widest text-white/35 flex items-center gap-2">
                    <span className="font-bold text-white/55">{mine ? "Du" : message.sender?.display_name || message.sender?.username || ""}</span>
                    <span>{timeLabel(message.created_at)}</span>
                  </div>
                ) : null}
                {message.message ? <div className={`whitespace-pre-wrap break-words text-sm text-white/85 ${showHeader ? "mt-1" : ""}`}>{message.message}</div> : null}
                <ChatMessageAttachments attachments={message.attachments} />
                <ChatMessageSticker sticker={message.sticker} />
              </div>
            </div>
          );
        })}
      </div>
      {!atBottom && newCount > 0 ? (
        <button
          type="button"
          onClick={scrollToBottom}
          data-testid="conversation-new-messages"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#29B6E8] text-black text-xs font-bold shadow-lg"
        >
          {newCount === 1 ? "1 neue Nachricht" : `${newCount} neue Nachrichten`} <ArrowDown className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </div>
  );
}
