import { useEffect, useState } from "react";
import { Star, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { feedbackTagPrompt, parseFeedbackTarget, STAR_LABELS } from "@/lib/feedback";
import { viennaDate } from "@/lib/vienna";

// Rückmeldung (#1196): „Wie war der FC 26 Cup?“ - ein bis fünf Sterne, auf Wunsch Stichworte und ein Satz. Das sieht
// nur der Verein, ohne Namen. „Lieber nicht“ beendet die Frage für dieses Turnier bzw. Event.

export function FeedbackDialog({ target, onClose, onDone }) {
  const [prompt, setPrompt] = useState(null);
  const [missing, setMissing] = useState(false);
  const [tags, setTags] = useState([]);
  const [textMax, setTextMax] = useState(280);
  const [stars, setStars] = useState(0);
  const [chosen, setChosen] = useState([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const { submitting, submitOnce } = useSubmissionGuard();
  const dialogRef = useModalBehavior(Boolean(target), onClose);
  const parsed = parseFeedbackTarget(target);

  useEffect(() => {
    if (!parsed) return undefined;
    let alive = true;
    setPrompt(null);
    setMissing(false);
    setStars(0);
    setChosen([]);
    setText("");
    setError("");
    api.get("/feedback/open").then(({ data }) => {
      if (!alive) return;
      const item = (data?.items || []).find((row) => row.kind === parsed.kind && row.target_id === parsed.id);
      setTags(Array.isArray(data?.tags) ? data.tags : []);
      setTextMax(Number(data?.text_max) || 280);
      if (item) setPrompt(item);
      else setMissing(true);
    }).catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [parsed?.kind, parsed?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!parsed) return null;

  const toggleTag = (tag) => setChosen((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));
  const send = async (decline = false) => {
    setError("");
    const attempt = await submitOnce(async () => {
      if (decline) await api.post(`/feedback/${parsed.kind}/${parsed.id}/decline`);
      else await api.post(`/feedback/${parsed.kind}/${parsed.id}`, { stars, tags: chosen, text: text.trim() });
      toast.success(decline ? "Alles klar – wir fragen nicht mehr." : "Danke! Das hilft beim nächsten Mal.");
      onDone?.();
    });
    if (attempt.started && attempt.error) setError(formatRequestError(attempt.error, "Das hat nicht geklappt."));
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="feedback-title" data-testid="feedback-dialog"
        className="w-full sm:max-w-md bg-[#121212] border border-white/10 rounded-t-md sm:rounded-sm shadow-2xl focus:outline-none max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div className="min-w-0">
            {prompt ? <div className="text-[11px] text-white/45">{viennaDate(prompt.day, { weekday: "short", day: "2-digit", month: "2-digit" })}</div> : null}
            <h2 id="feedback-title" className="font-heading text-2xl font-black leading-tight">{prompt?.question || (missing ? "Schon erledigt" : "Kurz bewerten")}</h2>
            <p className="mt-1 text-xs text-white/55">Das sieht nur der Verein – ohne deinen Namen. Es hilft beim nächsten Mal.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="p-1 text-white/45 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {missing ? (
          <div className="p-5 text-sm text-white/65" data-testid="feedback-missing">Dazu gibt es gerade nichts zu bewerten – entweder hast du schon geantwortet oder die Frage ist vorbei. Danke!</div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex justify-center gap-2" role="radiogroup" aria-label="Sterne">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} – ${STAR_LABELS[n]}`} onClick={() => setStars(n)} data-testid={`feedback-star-${n}`}
                  className="p-1 rounded-sm transition hover:scale-110">
                  <Star className={`w-9 h-9 ${n <= stars ? "text-[#FFD700] fill-[#FFD700]" : "text-white/30"}`} />
                </button>
              ))}
            </div>
            <div className="text-center text-xs text-white/55 min-h-[1rem]" data-testid="feedback-star-label">{stars ? STAR_LABELS[stars] : "Tippe auf die Sterne"}</div>
            {tags.length ? (
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">{feedbackTagPrompt(stars)}</div>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <button key={tag} type="button" aria-pressed={chosen.includes(tag)} onClick={() => toggleTag(tag)} data-testid={`feedback-tag-${tag}`}
                      className={`h-8 rounded-full border text-xs font-bold transition ${chosen.includes(tag) ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/15 text-white/70 hover:text-white"}`}>
                      <span className="mx-3">{tag}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">Ein Satz (freiwillig)</span>
              <textarea value={text} onChange={(event) => setText(event.target.value.slice(0, textMax))} rows={2} maxLength={textMax} data-testid="feedback-text"
                className="mt-1.5 w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm resize-none" placeholder="Was sollen wir beibehalten oder besser machen?" />
              <span className="block text-right text-[10px] text-white/40">{text.length}/{textMax}</span>
            </label>
            {error ? <div className="text-sm text-[#FF6B6B]" role="alert">{error}</div> : null}
            <button type="button" onClick={() => send(false)} disabled={!stars || submitting || !prompt} data-testid="feedback-submit"
              className="tls-btn tls-btn--primary w-full px-4 py-3 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">Abschicken</button>
            <button type="button" onClick={() => send(true)} disabled={submitting || !prompt} data-testid="feedback-decline"
              className="block mx-auto text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] hover:text-white disabled:opacity-45">Lieber nicht</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default FeedbackDialog;
