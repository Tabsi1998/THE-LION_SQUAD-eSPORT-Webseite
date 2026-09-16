import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MessageSquare, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { ChatAttachButton, ChatAttachmentDrafts, useChatAttachmentDrafts } from "@/components/tls/ChatAttachments";
import { ChatStickerButton, ChatStickerPicker } from "@/components/tls/ChatStickers";
import { ConversationView } from "./messages/ConversationView";
import { mergeMessages } from "./messages/messageGroups";

// Nachrichten als eigene Seite (#254, der Rest von #222): Liste links, die
// Unterhaltung rechts in fester Höhe mit eigener Scrollleiste; am Handy zwei
// Ansichten mit Zurück. Die Unterhaltung lädt die neuesten 50 und beim
// Hochscrollen die älteren; neue Nachrichten kommen über den Änderungsstrom.
export const PAGE_SIZE = 50;

function threadPreview(thread) {
  const latest = thread.latest_message;
  if (!latest) return "Noch keine Nachricht";
  if (latest.message) return latest.message;
  if (latest.attachments?.length) return "[Anhang]";
  if (latest.sticker) return "[Sticker]";
  return "Noch keine Nachricht";
}

export default function MessagesPage() {
  const { user } = useAuth();
  const { userId } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [threads, setThreads] = useState(null);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [canSend, setCanSend] = useState(true);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [hint, setHint] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const messagesRef = useRef([]);
  const dmAttachments = useChatAttachmentDrafts();

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const loadThreads = useCallback(async () => {
    const { data } = await api.get("/messages/conversations");
    setThreads(data || []);
  }, []);
  useEffect(() => { loadThreads().catch(() => setThreads([])); }, [loadThreads]);
  useApiInvalidation(loadThreads, ["messages", "admin/notifications"]);

  // Öffnen lädt die neueste Seite und markiert sie gelesen. Ein stiller Lauf
  // (Änderungsstrom) führt nur zusammen, was neu ist, und lässt geladene
  // ältere Seiten stehen.
  const loadLatest = useCallback(async (id, { silent = false } = {}) => {
    try {
      const { data } = await api.get(`/messages/direct/${id}?limit=${PAGE_SIZE}`);
      setActive(data.user || { id });
      setCanSend(data.can_send !== false);
      setBlockedByMe(!!data.blocked_by_me);
      setHint(data.message_hint || "");
      if (silent && messagesRef.current.length) {
        const { messages: merged, appended } = mergeMessages(messagesRef.current, data.messages || []);
        setMessages(merged);
        if (appended > 0) setNewCount((count) => count + appended);
      } else {
        setMessages(data.messages || []);
        setHasMore(!!data.has_more);
        setNewCount(0);
      }
      loadThreads().catch(() => {});
    } catch (err) {
      if (!silent) toast.error(formatRequestError(err, "Nachrichten konnten nicht geladen werden."));
    }
  }, [loadThreads]);

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setNewCount(0);
    setStickersOpen(false);
    if (userId) {
      setActive({ id: userId });
      loadLatest(userId);
    } else {
      setActive(null);
    }
  }, [userId, loadLatest]);

  // Der offene Chat lädt bei jeder Nachrichtenänderung nach; ohne Strom alle 8 s.
  useLiveRefresh(() => userId && loadLatest(userId, { silent: true }), ["messages"], { fallbackMs: 8000, enabled: Boolean(userId) });

  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0];
    if (!userId || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { data } = await api.get(`/messages/direct/${userId}?before=${encodeURIComponent(oldest.id)}&limit=${PAGE_SIZE}`);
      const { messages: merged } = mergeMessages(messagesRef.current, data.messages || []);
      setMessages(merged);
      setHasMore(!!data.has_more);
    } catch (err) {
      toast.error(formatRequestError(err, "Ältere Nachrichten konnten nicht geladen werden."));
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, userId]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setCandidates([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get(`/messages/users?q=${encodeURIComponent(needle)}`);
        setCandidates(data || []);
      } catch {
        setCandidates([]);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const open = (id) => {
    setQuery("");
    navigate(`/messages/${id}`);
  };

  const send = async () => {
    const message = text.trim();
    if (!userId || !dmAttachments.canSend(message) || sending) return;
    setSending(true);
    try {
      const { data } = await api.post(`/messages/direct/${userId}`, { message, attachment_ids: dmAttachments.attachmentIds });
      setMessages((rows) => mergeMessages(rows, [data]).messages);
      setText("");
      dmAttachments.reset();
      setHint("");
      setCanSend(true);
      loadThreads().catch(() => {});
    } catch (err) {
      toast.error(formatRequestError(err, "Nachricht konnte nicht gesendet werden."));
    } finally {
      setSending(false);
    }
  };

  const sendSticker = async (sticker) => {
    if (!userId || sending) return;
    setSending(true);
    try {
      const { data } = await api.post(`/messages/direct/${userId}`, { sticker_id: sticker.id });
      setMessages((rows) => mergeMessages(rows, [data]).messages);
      setStickersOpen(false);
      loadThreads().catch(() => {});
    } catch (err) {
      toast.error(formatRequestError(err, "Sticker konnte nicht gesendet werden."));
    } finally {
      setSending(false);
    }
  };

  const toggleBlock = async () => {
    if (!userId) return;
    try {
      if (blockedByMe) {
        await api.delete(`/moderation/blocks/${userId}`);
        toast.success("Blockierung aufgehoben.");
      } else {
        const accepted = await confirm({
          title: "Benutzer blockieren?",
          description: "Direktnachrichten und Freundschaftsanfragen werden in beide Richtungen unterbunden.",
          confirmLabel: "Blockieren",
          destructive: true,
        });
        if (!accepted) return;
        await api.post(`/moderation/blocks/${userId}`);
        toast.success("Benutzer blockiert.");
      }
      await loadLatest(userId);
    } catch (error) {
      toast.error(formatRequestError(error, "Blockierung konnte nicht geändert werden."));
    }
  };

  const report = async () => {
    if (!userId) return;
    const details = await prompt({
      title: "Benutzer melden",
      description: "Beschreibe sachlich, was passiert ist. Die Moderation prüft die Meldung.",
      placeholder: "Grund und Kontext der Meldung",
      confirmLabel: "Meldung senden",
      multiline: true,
      required: true,
    });
    if (!details || details.trim().length < 5) return;
    try {
      const latestForeign = [...messagesRef.current].reverse().find((message) => message.sender_id === userId);
      await api.post("/moderation/reports", {
        target_user_id: userId,
        category: "other",
        details: details.trim(),
        message_id: latestForeign?.id || null,
      });
      toast.success("Meldung wurde an die Moderation gesendet.");
    } catch (error) {
      toast.error(formatRequestError(error, "Meldung konnte nicht gesendet werden."));
    }
  };

  const showList = !userId;
  const activeName = active?.display_name || active?.username || "";

  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6">
        <div className="md:h-[calc(100dvh-9rem)] md:min-h-[30rem] grid md:grid-cols-[320px_minmax(0,1fr)] gap-4 md:gap-5" data-testid="messages-page">
          <aside className={`${showList ? "flex" : "hidden md:flex"} flex-col min-h-0 h-[calc(100dvh-7rem)] md:h-auto border border-white/10 bg-[#121212] rounded-sm overflow-hidden`}>
            <div className="px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#29B6E8]" />
                <h1 className="font-heading font-black uppercase">Nachrichten</h1>
              </div>
              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                  placeholder="Benutzer suchen"
                  aria-label="Benutzer suchen"
                  data-testid="messages-search"
                  className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm"
                />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {query.trim().length >= 2 ? (
                <div className="p-2 space-y-1">
                  {candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => open(candidate.id)}
                      data-testid={`messages-candidate-${candidate.id}`}
                      className="w-full text-left border border-white/10 hover:border-[#29B6E8]/45 bg-[#0A0A0A] rounded-sm p-3 transition"
                    >
                      <div className="font-bold text-sm truncate">{candidate.display_name || candidate.username}</div>
                      <div className="text-xs text-white/40 truncate">@{candidate.username}</div>
                      {!candidate.can_message ? <div className="mt-1 text-[10px] text-[#FFD700]">{candidate.message_hint}</div> : null}
                    </button>
                  ))}
                  {candidates.length === 0 ? <div className="p-3 text-xs text-white/35">Keine passenden Benutzer gefunden.</div> : null}
                </div>
              ) : (
                <>
                  {(threads || []).map((thread) => {
                    const other = thread.user || {};
                    const current = userId === other.id;
                    return (
                      <button
                        key={other.id}
                        type="button"
                        onClick={() => open(other.id)}
                        aria-current={current ? "true" : undefined}
                        data-testid={`conversation-item-${other.id}`}
                        className={`w-full text-left px-4 py-3 border-b border-white/5 transition ${current ? "bg-[#29B6E8]/10" : "hover:bg-white/[0.03]"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold text-sm truncate">{other.display_name || other.username}</div>
                          {thread.unread_count > 0 ? <span className="shrink-0 min-w-5 h-5 px-1 rounded-sm bg-[#29B6E8] text-black text-[10px] font-black inline-flex items-center justify-center">{thread.unread_count}</span> : null}
                        </div>
                        <div className="text-xs text-white/40 truncate">{threadPreview(thread)}</div>
                      </button>
                    );
                  })}
                  {threads === null ? <div className="p-5 text-sm text-white/35">Lade Gespräche …</div> : null}
                  {threads && threads.length === 0 ? <div className="p-5 text-sm text-white/35">Noch keine Gespräche. Suche oben einen Benutzer.</div> : null}
                </>
              )}
            </div>
          </aside>

          <section className={`${showList ? "hidden md:flex" : "flex"} flex-col min-h-0 h-[calc(100dvh-7rem)] md:h-auto border border-white/10 bg-[#121212] rounded-sm overflow-hidden`} data-testid="conversation-pane">
            {userId && active ? (
              <>
                <div className="px-3 md:px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <button type="button" onClick={() => navigate("/messages")} data-testid="conversation-back" aria-label="Zurück zur Liste" className="md:hidden p-1.5 -ml-1 text-white/70 hover:text-white">
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0">
                      <div className="font-heading font-black uppercase truncate">{activeName}</div>
                      {active.username ? <div className="text-xs text-white/45">@{active.username}</div> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!canSend && hint ? <div className="text-xs text-[#FFD700] max-w-xs text-right">{hint}</div> : null}
                    <button type="button" onClick={report} className="px-2 py-1 border border-[#FFD700]/35 text-[#FFD700] text-[10px] uppercase font-bold">Melden</button>
                    <button type="button" onClick={toggleBlock} className="px-2 py-1 border border-[#FF3B30]/35 text-[#FF6B6B] text-[10px] uppercase font-bold">{blockedByMe ? "Freigeben" : "Blockieren"}</button>
                  </div>
                </div>
                <ConversationView
                  me={user}
                  messages={messages}
                  hasMore={hasMore}
                  loadingOlder={loadingOlder}
                  onLoadOlder={loadOlder}
                  newCount={newCount}
                  onSeenNew={() => setNewCount(0)}
                />
                <ChatAttachmentDrafts drafts={dmAttachments.drafts} onRemove={dmAttachments.remove} />
                <ChatStickerPicker open={stickersOpen && canSend} onClose={() => setStickersOpen(false)} onPick={sendSticker} disabled={sending} />
                <div className="border-t border-white/10 p-2 md:p-3 flex gap-2" onPaste={dmAttachments.onPaste}>
                  <ChatAttachButton onFiles={dmAttachments.addFiles} disabled={!canSend || sending} testId="direct-chat-attach" />
                  <ChatStickerButton open={stickersOpen && canSend} onToggle={() => setStickersOpen((value) => !value)} disabled={!canSend || sending} testId="direct-chat-stickers" />
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    disabled={!canSend}
                    maxLength={1500}
                    placeholder={canSend ? "Nachricht schreiben …" : "Direktnachrichten nicht erlaubt"}
                    aria-label="Nachricht"
                    data-testid="direct-chat-input"
                    className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm disabled:opacity-50"
                  />
                  <button type="button" disabled={!canSend || sending || !dmAttachments.canSend(text)} onClick={send} data-testid="direct-chat-send" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">
                    <Send className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Senden</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-center text-white/40">
                <div>
                  <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <div className="font-heading font-bold uppercase">Gespräch auswählen</div>
                  <div className="mt-1 text-sm">Wähle links ein Gespräch oder suche einen Benutzer.</div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </PublicLayout>
  );
}
