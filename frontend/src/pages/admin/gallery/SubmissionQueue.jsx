import { useCallback, useEffect, useState } from "react";
import { Check, Inbox, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { chatAttachmentSrc } from "@/lib/chatAttachments";
import { usePrompt } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { viennaDateTime } from "@/lib/vienna";

// Eingesandte Fotos (#1186): was Mitglieder ins Album eines Events geschickt haben, wartet hier auf Freigabe - der
// einzige Ort dafür. Freigeben und ablehnen dürfen Redaktion und Vereinsverwaltung (der Vorstand hat sie von selbst).
// Freigeben geht erst, wenn die Bildprüfung durch ist; abgelehnte Fotos werden gleich gelöscht. Die Person, die
// eingesandt hat, bekommt in beiden Fällen Bescheid.

export function groupSubmissions(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = row.album_id;
    if (!groups.has(key)) groups.set(key, { album_id: key, album_title: row.album_title, event_name: row.event_name, items: [] });
    groups.get(key).items.push(row);
  }
  return [...groups.values()];
}

const READY = new Set(["safe", "failed"]);
const SCAN_TEXT = { pending: "Bildprüfung läuft", review: "Bei der Moderation", blocked: "Von der Bildprüfung entfernt" };

export function SubmissionQueue() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const prompt = usePrompt();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/gallery-submissions");
      setRows(data || []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["gallery"]);

  const decide = async (ids, action) => {
    let reason = null;
    if (action === "reject") {
      reason = await prompt({
        title: ids.length === 1 ? "Foto ablehnen?" : `${ids.length} Fotos ablehnen?`,
        description: "Abgelehnte Fotos werden gelöscht. Die Person bekommt Bescheid – auf Wunsch mit Grund.",
        placeholder: "Grund (freiwillig), z. B. unscharf",
        confirmLabel: "Ablehnen",
        tone: "danger",
        multiline: false,
      });
      if (reason === false || reason === undefined || reason === null) return;
    }
    setBusy(true);
    try {
      await api.post("/admin/gallery-submissions/decide", { ids, action, reason: reason || null });
      toast.success(action === "approve" ? "Freigegeben – die Fotos sind im Album." : "Abgelehnt und gelöscht.");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setBusy(false);
      load();
    }
  };

  if (!rows) return null;
  const groups = groupSubmissions(rows);

  return (
    <section className="mb-8 rounded-sm border border-white/10 bg-[#121212] p-4" data-testid="gallery-submissions">
      <div className="flex items-center gap-2">
        <Inbox className="w-4 h-4 text-[#29B6E8]" />
        <h2 className="font-heading text-lg font-black uppercase">Eingesandte Fotos</h2>
        <span className="text-[10px] uppercase tracking-widest text-white/40">{rows.length ? `${rows.length} warten auf Freigabe` : "nichts offen"}</span>
      </div>
      {!rows.length ? (
        <p className="mt-2 text-sm text-white/50">Wenn Mitglieder Fotos vom Event schicken, stehen sie hier zur Freigabe.</p>
      ) : groups.map((group) => {
        const ready = group.items.filter((item) => READY.has(item.scan_state)).map((item) => item.id);
        return (
          <div key={group.album_id} className="mt-4 border-t border-white/10 pt-4" data-testid={`submission-group-${group.album_id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-heading font-bold uppercase">{group.album_title || "Album"}</div>
                {group.event_name ? <div className="text-xs text-white/50">Event: {group.event_name}</div> : null}
              </div>
              {ready.length > 1 ? (
                <button type="button" disabled={busy} onClick={() => decide(ready, "approve")} className="tls-btn tls-btn--primary inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wider" data-testid={`submission-approve-all-${group.album_id}`}>
                  <Check className="w-3.5 h-3.5" /> Alle {ready.length} freigeben
                </button>
              ) : null}
            </div>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {group.items.map((item) => {
                const isReady = READY.has(item.scan_state);
                return (
                  <li key={item.id} className="overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A]" data-testid={`submission-${item.id}`}>
                    <div className="aspect-video bg-black">
                      {isReady ? <img src={chatAttachmentSrc(item.image_url, 400)} alt={`Eingesandt von ${item.owner_name}`} loading="lazy" className="h-full w-full object-cover" /> : (
                        <div className="flex h-full items-center justify-center text-xs text-white/50">{SCAN_TEXT[item.scan_state] || "Bildprüfung läuft"}</div>
                      )}
                    </div>
                    <div className="space-y-2 p-3 text-xs">
                      <div className="text-white/80">{item.owner_name} · {viennaDateTime(item.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                      <div className="text-white/50">{item.credit ? `Zeigt „Foto: ${item.owner_name}“` : "Ohne Namen"}</div>
                      <div className="flex gap-2">
                        <button type="button" disabled={busy || !isReady} onClick={() => decide([item.id], "approve")} className="tls-btn tls-btn--secondary inline-flex flex-1 items-center justify-center gap-1 rounded-sm px-2 py-1.5 font-bold uppercase" data-testid={`submission-approve-${item.id}`}>
                          <Check className="w-3.5 h-3.5" /> Freigeben
                        </button>
                        <button type="button" disabled={busy} onClick={() => decide([item.id], "reject")} className="tls-btn tls-btn--danger inline-flex flex-1 items-center justify-center gap-1 rounded-sm px-2 py-1.5 font-bold uppercase" data-testid={`submission-reject-${item.id}`}>
                          <X className="w-3.5 h-3.5" /> Ablehnen
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
