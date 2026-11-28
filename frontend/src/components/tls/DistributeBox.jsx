import { useCallback, useEffect, useState } from "react";
import { Bell, ChevronDown, Mail, MessageSquare, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { formatWhen } from "@/lib/datetime";

// Verteilen (#1359): im News- und Event-Editor steht, was mit dem Beitrag hinausgeht - der Newsletter mit der Zahl der
// Empfänger und „Jetzt senden“ bzw. „gesendet am … an …“, die Meldung an Mitglieder oder Vorstand und die Discord-Vorschau
// (als Kind übergeben). Nur die Zahl der Empfänger, nie Namen oder Adressen. Ein zweites Mal senden nur Redaktion und System.
// Am Handy ist der Kasten zugeklappt, ab Tablet offen.

function people(count) {
  const value = Number(count) || 0;
  return value === 1 ? "1 Person" : `${value} Personen`;
}

function startsOpen() {
  try {
    return window.matchMedia ? window.matchMedia("(min-width: 768px)").matches : true;
  } catch {
    return true;
  }
}

// „Nur App“ (#1532): kein Newsletter - die Mail führte zur Website, die den Beitrag nicht zeigt.
export const APP_ONLY_NEWSLETTER = "Kein Newsletter – „Nur App“ geht nicht per Mail hinaus.";

// App-Push bei öffentlichen News „nur App“ (#1532): angekündigt, gesendet oder bewusst ausgelassen.
const APP_PUSH_VISIBILITIES = new Set(["", "public", "community"]);

// `alreadyPublic` (#2553): der gespeicherte Beitrag ist schon öffentlich und erscheint nicht nur in der App - stellt ihn
// jemand jetzt auf „Nur App“, geht beim Speichern kein Push hinaus (der Server merkt sich das als „channel_changed“).
// `wasMembersOnly`: veröffentlicht war er bisher nur für Mitglieder bzw. intern - dann heißt es „schon veröffentlicht“.
// `membersNotified` (Nr. 230): zur News ging schon eine Mitglieder-Meldung - wer sie bekam, bekommt keinen zweiten Push.
export function appPushLine({ appOnly = false, visibility = "", appPush = null, alreadyPublic = false, wasMembersOnly = false,
  membersNotified = false } = {}) {
  if (!appOnly || !APP_PUSH_VISIBILITIES.has(visibility || "")) return "";
  if (appPush?.skipped === "channel_changed") return "Kein App-Push – der Beitrag war schon öffentlich, als er auf „Nur App“ gestellt wurde.";
  if (appPush?.skipped === "too_old") return "Kein App-Push – der Beitrag war beim Veröffentlichen schon älter als 24 Stunden.";
  if (appPush?.sent_at) return `App-Push gesendet am ${formatWhen(appPush.sent_at, { relative: false })} an ${people(appPush.count)}.`;
  if (alreadyPublic && wasMembersOnly) return "Kein App-Push – der Beitrag ist schon veröffentlicht. Wird er jetzt auf „Nur App“ gestellt, geht beim Speichern kein Push hinaus.";
  if (alreadyPublic) return "Kein App-Push – der Beitrag ist schon öffentlich. Wird er auf „Nur App“ gestellt, geht beim Speichern kein Push hinaus.";
  const line = "Beim Veröffentlichen geht ein App-Push an alle App-Nutzer mit Zustimmung für „News & Events“.";
  return membersNotified ? `${line} Wer die Mitglieder-Meldung schon bekam, bekommt keinen zweiten Push.` : line;
}

export function newsletterLine(box) {
  if (!box) return "";
  if (box.state === "sent") return `Gesendet am ${formatWhen(box.sent_at, { relative: false })} an ${people(box.sent_count)}.`;
  if (box.state === "internal") return "Kein Newsletter – „Nur intern“ geht nicht per Mail hinaus.";
  if (box.state === "draft") return `Geht beim Veröffentlichen von selbst an ${people(box.recipients)} mit Newsletter-Zustimmung.`;
  return `Noch nicht verschickt – geht an ${people(box.recipients)} mit Newsletter-Zustimmung.`;
}

/** Vor dem ersten Speichern (#2122 NW1): wie viele den Newsletter bei dieser Sichtbarkeit bekämen. */
export function audienceLine(audience) {
  if (!audience) return "";
  if (audience.internal) return "Kein Newsletter – „Nur intern“ geht nicht per Mail hinaus.";
  return `Geht beim Veröffentlichen an ${people(audience.recipients)} mit Newsletter-Zustimmung – vorher kommt eine Rückfrage.`;
}

export function DistributeBox({ kind, itemId, title = "", visibility = "", appOnly = false, appPush = null, alreadyPublic = false,
  wasMembersOnly = false, membersNotified = false, children }) {
  const [box, setBox] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(startsOpen);
  const [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState(null);
  const confirm = useConfirm();

  useEffect(() => {
    if (itemId || !visibility || appOnly) {
      setAudience(null);
      return undefined;
    }
    let cancelled = false;
    api.get("/settings/newsletter/audience", { params: { kind, visibility } })
      .then(({ data }) => { if (!cancelled) setAudience(data && typeof data === "object" && !Array.isArray(data) ? data : null); })
      .catch(() => { if (!cancelled) setAudience(null); });
    return () => { cancelled = true; };
  }, [kind, itemId, visibility, appOnly]);

  const load = useCallback(() => {
    if (!itemId) return;
    api.get("/settings/newsletter/state", { params: { kind, id: itemId } })
      .then(({ data }) => {
        setBox(data && typeof data === "object" && !Array.isArray(data) && data.state ? data : null);
        setError("");
      })
      .catch((failure) => setError(failure?.response?.status === 403
        ? (kind === "event" ? "Den Newsletter dieses Events verschickt, wer das Event bearbeiten darf – hier steht dann der Stand." : "Den Newsletter verschickt die Redaktion – hier steht dann der Stand.")
        : "Der Stand des Newsletters lässt sich gerade nicht laden."));
  }, [kind, itemId]);
  useEffect(() => { load(); }, [load]);

  // Vorschau (#2119 ML5): die Mail, wie sie hinausginge - mit deinem Namen als Anrede, nichts wird verschickt.
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const togglePreview = async () => {
    if (preview) {
      setPreview(null);
      return;
    }
    setPreviewBusy(true);
    try {
      const { data } = await api.post("/settings/newsletter/preview", { kind, id: itemId });
      if (data?.mail) setPreview(data.mail);
      else toast.error("Für diesen Beitrag gibt es keine Newsletter-Mail.");
    } catch (failure) {
      toast.error(formatRequestError(failure, "Die Vorschau lässt sich gerade nicht laden."));
    } finally {
      setPreviewBusy(false);
    }
  };

  const send = async (force) => {
    const name = box?.title || title || (kind === "event" ? "dieses Event" : "diesen Beitrag");
    const approved = await confirm(force ? {
      title: "Newsletter ein zweites Mal senden?",
      description: `Der Newsletter zu „${name}“ ist schon hinausgegangen. Alle ${people(box?.recipients)} bekommen ihn ein zweites Mal.`,
      confirmLabel: "Nochmal senden",
      tone: "danger",
    } : {
      title: "Newsletter jetzt senden?",
      description: `Der Newsletter zu „${name}“ geht an ${people(box?.recipients)} mit Newsletter-Zustimmung.`,
      confirmLabel: "Jetzt senden",
      tone: "info",
    });
    if (!approved) return;
    setBusy(true);
    try {
      const { data } = await api.post("/settings/newsletter/send", { kind, id: itemId, force: Boolean(force) });
      toast.success(data?.skipped ? "Der Newsletter war schon verschickt." : `Newsletter an ${people(data?.queued)} eingereiht.`);
      load();
    } catch (failure) {
      toast.error(formatRequestError(failure, "Der Newsletter konnte nicht gesendet werden."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-white/10 bg-[#121212] rounded-sm" data-testid="distribute-box">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid="distribute-toggle" className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="tls-type-label text-[#29B6E8]">Verteilen</span>
        <ChevronDown className={`w-4 h-4 text-white/50 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex items-start gap-3" data-testid="distribute-newsletter">
            <Mail className="w-4 h-4 mt-0.5 text-white/50 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="tls-type-label text-white/70">Newsletter</div>
              {!itemId && (audience || appOnly
                ? <p className="tls-type-small text-white/75" data-testid="distribute-audience-line">{appOnly ? APP_ONLY_NEWSLETTER : audienceLine(audience)}</p>
                : <p className="tls-type-body text-white/55">Nach dem ersten Speichern steht hier, an wie viele Personen der Newsletter geht.</p>)}
              {itemId && error && <p className="tls-type-small text-warn" data-testid="distribute-error">{error}</p>}
              {itemId && !error && box && appOnly && box.state !== "sent" && (
                <p className="tls-type-small text-white/75" data-testid="distribute-newsletter-line">{APP_ONLY_NEWSLETTER}</p>
              )}
              {itemId && !error && box && !(appOnly && box.state !== "sent") && (
                <>
                  <p className="tls-type-small text-white/75" data-testid="distribute-newsletter-line">{newsletterLine(box)}</p>
                  {box.state === "ready" && box.can_send && (
                    <button type="button" disabled={busy} onClick={() => send(false)} data-testid="distribute-send" className="tls-btn tls-btn--primary px-4 py-2 rounded-sm tls-type-label disabled:opacity-50">Jetzt senden</button>
                  )}
                  {box.state === "sent" && (box.can_resend ? (
                    <button type="button" disabled={busy} onClick={() => send(true)} data-testid="distribute-resend" className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm tls-type-label disabled:opacity-50">Nochmal senden …</button>
                  ) : (
                    <p className="tls-type-small text-white/45" data-testid="distribute-resend-locked">Ein zweites Mal senden nur Redaktion und System.</p>
                  ))}
                  {box.state !== "internal" && (
                    <div>
                      <button type="button" disabled={previewBusy} onClick={togglePreview} aria-expanded={Boolean(preview)} data-testid="distribute-preview-toggle" className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm tls-type-label disabled:opacity-50">
                        {preview ? "Vorschau schließen" : previewBusy ? "Lade Vorschau …" : "Mail ansehen"}
                      </button>
                      {preview && (
                        <div className="mt-2 border border-white/10 rounded-sm bg-white" data-testid="distribute-preview">
                          <div className="px-3 py-2 border-b border-black/10 tls-type-small text-black font-bold break-words" data-testid="distribute-preview-subject">{preview.subject}</div>
                          <iframe title="Vorschau der Newsletter-Mail" sandbox="" srcDoc={preview.html} className="w-full h-[420px] bg-white" data-testid="distribute-preview-frame" />
                          <p className="px-3 py-2 border-t border-black/10 tls-type-small text-black/60">So sieht die Mail aus – mit deinem Namen als Anrede. Jede Person bekommt ihren eigenen.</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {appPushLine({ appOnly, visibility, appPush, alreadyPublic, wasMembersOnly, membersNotified }) && (
            <div className="flex items-start gap-3" data-testid="distribute-app-push-row">
              <Smartphone className="w-4 h-4 mt-0.5 text-white/50 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="tls-type-label text-white/70">App-Push</div>
                <p className="mt-1 tls-type-small text-white/75" data-testid="distribute-app-push">{appPushLine({ appOnly, visibility, appPush, alreadyPublic, wasMembersOnly, membersNotified })}</p>
              </div>
            </div>
          )}
          {box && (
            <div className="flex items-start gap-3" data-testid="distribute-announcement">
              <Bell className="w-4 h-4 mt-0.5 text-white/50 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="tls-type-label text-white/70">Meldung</div>
                <p className="mt-1 tls-type-small text-white/65">{box.announcement}{box.announced_at && box.announced_count ? ` Gemeldet am ${formatWhen(box.announced_at, { relative: false })} an ${people(box.announced_count)}.` : ""}</p>
              </div>
            </div>
          )}
          {children && (
            <div className="flex items-start gap-3" data-testid="distribute-discord">
              <MessageSquare className="w-4 h-4 mt-0.5 text-white/50 shrink-0" />
              <div className="min-w-0 flex-1">{children}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default DistributeBox;
