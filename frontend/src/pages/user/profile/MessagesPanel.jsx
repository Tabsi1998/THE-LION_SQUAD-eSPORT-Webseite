import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { MessageSquare, Search, Send } from "lucide-react";
import { ChatAttachButton, ChatAttachmentDrafts, ChatMessageAttachments, useChatAttachmentDrafts } from "@/components/tls/ChatAttachments";
import { ChatMessageSticker, ChatStickerButton, ChatStickerPicker } from "@/components/tls/ChatStickers";

export function MessagesPanel() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [params] = useSearchParams();
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [canSend, setCanSend] = useState(true);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [hint, setHint] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  const loadThreads = useCallback(async () => {
    const { data } = await api.get("/messages/conversations");
    setThreads(data || []);
  }, []);

  const openThread = useCallback(async (target) => {
    if (!target?.id) return;
    setActive(target);
    try {
      const { data } = await api.get(`/messages/direct/${target.id}`);
      setActive(data.user || target);
      setMessages(data.messages || []);
      setCanSend(data.can_send !== false);
      setBlockedByMe(!!data.blocked_by_me);
      setHint(data.message_hint || "");
      loadThreads();
    } catch (err) {
      toast.error(formatRequestError(err, "Nachrichten konnten nicht geladen werden."));
    }
  }, [loadThreads]);

  useEffect(() => { loadThreads().catch(() => setThreads([])); }, [loadThreads]);
  useApiInvalidation(loadThreads, ["messages", "admin/notifications"]);

  useEffect(() => {
    const targetId = params.get("to");
    if (!targetId || active?.id === targetId) return;
    openThread({ id: targetId });
  }, [params, active?.id, openThread]);

  // Der offene Chat lädt bei jeder Nachrichtenänderung nach; ohne Strom alle 8 s.
  useLiveRefresh(() => openThread(active), ["messages"], { fallbackMs: 8000, enabled: Boolean(active?.id) });

  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages.length, active?.id]);

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

  const dmAttachments = useChatAttachmentDrafts();
  const [stickersOpen, setStickersOpen] = useState(false);

  const send = async () => {
    const message = text.trim();
    if (!active?.id || !dmAttachments.canSend(message) || sending) return;
    setSending(true);
    try {
      const { data } = await api.post(`/messages/direct/${active.id}`, { message, attachment_ids: dmAttachments.attachmentIds });
      setMessages((rows) => [...rows, data]);
      setText("");
      dmAttachments.reset();
      setHint("");
      setCanSend(true);
      loadThreads();
    } catch (err) {
      toast.error(formatRequestError(err, "Nachricht konnte nicht gesendet werden."));
    } finally {
      setSending(false);
    }
  };

  const sendSticker = async (sticker) => {
    if (!active?.id || sending) return;
    setSending(true);
    try {
      const { data } = await api.post(`/messages/direct/${active.id}`, { sticker_id: sticker.id });
      setMessages((rows) => [...rows, data]);
      setStickersOpen(false);
      loadThreads();
    } catch (err) {
      toast.error(formatRequestError(err, "Sticker konnte nicht gesendet werden."));
    } finally {
      setSending(false);
    }
  };

  const toggleBlock = async () => {
    if (!active?.id) return;
    if (blockedByMe) {
      await api.delete(`/moderation/blocks/${active.id}`);
      toast.success("Blockierung aufgehoben.");
    } else {
      const accepted = await confirm({
        title: "Benutzer blockieren?",
        description: "Direktnachrichten und Freundschaftsanfragen werden in beide Richtungen unterbunden.",
        confirmLabel: "Blockieren",
        destructive: true,
      });
      if (!accepted) return;
      await api.post(`/moderation/blocks/${active.id}`);
      toast.success("Benutzer blockiert.");
    }
    await openThread(active);
    await loadThreads();
  };

  const report = async () => {
    if (!active?.id) return;
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
      const latestForeign = [...messages].reverse().find((message) => message.sender_id === active.id);
      await api.post("/moderation/reports", {
        target_user_id: active.id,
        category: "other",
        details: details.trim(),
        message_id: latestForeign?.id || null,
      });
      toast.success("Meldung wurde an die Moderation gesendet.");
    } catch (error) {
      toast.error(formatRequestError(error, "Meldung konnte nicht gesendet werden."));
    }
  };

  return (
    <div className="space-y-5" data-testid="profile-inbox-tab">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
        <div className="flex items-start gap-3">
          <MessageSquare className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Inbox</div>
            <h2 className="font-heading text-2xl md:text-3xl font-black uppercase mt-1">Direktnachrichten</h2>
            <p className="text-sm text-white/55 mt-1">Suche Benutzer, schreibe private Nachrichten und steuere den Empfang über Privatsphäre.</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
        <aside className="space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
            <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold mb-3">Benutzer suchen</div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                placeholder="Username oder Name"
                className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm"
              />
            </div>
            <div className="mt-3 space-y-2">
              {candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => openThread(candidate)}
                  className="w-full text-left border border-white/10 hover:border-[#29B6E8]/45 bg-[#0A0A0A] rounded-sm p-3 transition"
                >
                  <div className="font-bold text-sm truncate">{candidate.display_name || candidate.username}</div>
                  <div className="text-xs text-white/40 truncate">@{candidate.username}</div>
                  {!candidate.can_message && <div className="mt-1 text-[10px] text-[#FFD700]">{candidate.message_hint}</div>}
                </button>
              ))}
              {query.trim().length >= 2 && candidates.length === 0 && <div className="text-xs text-white/35">Keine passenden Benutzer gefunden.</div>}
            </div>
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-[11px] uppercase tracking-widest text-white/50 font-bold">Gespräche</div>
            <div className="max-h-[28rem] overflow-y-auto">
              {threads.map((thread) => {
                const other = thread.user || {};
                const activeThread = active?.id === other.id;
                return (
                  <button
                    key={other.id}
                    type="button"
                    onClick={() => openThread(other)}
                    className={`w-full text-left px-4 py-3 border-b border-white/5 transition ${activeThread ? "bg-[#29B6E8]/10" : "hover:bg-white/[0.03]"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-sm truncate">{other.display_name || other.username}</div>
                      {thread.unread_count > 0 && <span className="shrink-0 min-w-5 h-5 px-1 rounded-sm bg-[#29B6E8] text-black text-[10px] font-black inline-flex items-center justify-center">{thread.unread_count}</span>}
                    </div>
                    <div className="text-xs text-white/40 truncate">{thread.latest_message?.message || (thread.latest_message?.attachments?.length ? "[Anhang]" : thread.latest_message?.sticker ? "[Sticker]" : "Noch keine Nachricht")}</div>
                  </button>
                );
              })}
              {threads.length === 0 && <div className="p-5 text-sm text-white/35">Noch keine Gespräche.</div>}
            </div>
          </div>
        </aside>

        <section className="border border-white/10 bg-[#121212] rounded-sm min-h-[34rem] flex flex-col overflow-hidden">
          {active ? (
            <>
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-heading font-black uppercase truncate">{active.display_name || active.username}</div>
                  <div className="text-xs text-white/45">@{active.username}</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {!canSend && <div className="text-xs text-[#FFD700] max-w-xs text-right">{hint}</div>}
                  <button type="button" onClick={report} className="px-2 py-1 border border-[#FFD700]/35 text-[#FFD700] text-[10px] uppercase font-bold">Melden</button>
                  <button type="button" onClick={() => toggleBlock().catch((error) => toast.error(formatRequestError(error, "Blockierung konnte nicht geändert werden.")))} className="px-2 py-1 border border-[#FF3B30]/35 text-[#FF6B6B] text-[10px] uppercase font-bold">{blockedByMe ? "Freigeben" : "Blockieren"}</button>
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((message) => {
                  const mine = message.sender_id === user?.id;
                  return (
                    <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] border rounded-sm px-3 py-2 ${mine ? "border-[#29B6E8]/40 bg-[#29B6E8]/10" : "border-white/10 bg-[#0A0A0A]"}`}>
                        <div className="text-[10px] uppercase tracking-widest text-white/35">
                          {message.created_at && new Date(message.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                        </div>
                        {message.message && <div className="mt-1 whitespace-pre-wrap break-words text-sm text-white/85">{message.message}</div>}
                        <ChatMessageAttachments attachments={message.attachments} />
                        <ChatMessageSticker sticker={message.sticker} />
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && <div className="text-center py-16 text-sm text-white/35">Noch keine Nachrichten in diesem Gespräch.</div>}
              </div>
              <ChatAttachmentDrafts drafts={dmAttachments.drafts} onRemove={dmAttachments.remove} />
              <ChatStickerPicker open={stickersOpen && canSend} onClose={() => setStickersOpen(false)} onPick={sendSticker} disabled={sending} />
              <div className="border-t border-white/10 p-3 flex gap-2" onPaste={dmAttachments.onPaste}>
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
                  placeholder={canSend ? "Nachricht schreiben..." : "Direktnachrichten nicht erlaubt"}
                  className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm disabled:opacity-50"
                />
                <button type="button" disabled={!canSend || sending || !dmAttachments.canSend(text)} onClick={send} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">
                  <Send className="w-3.5 h-3.5" /> Senden
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-white/40">
              <div>
                <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <div className="font-heading font-bold uppercase">Gespräch auswählen</div>
                <div className="mt-1 text-sm">Suche links einen Benutzer oder öffne ein bestehendes Gespräch.</div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

