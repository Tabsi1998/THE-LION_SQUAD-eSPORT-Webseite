import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DISPUTE_REASONS } from "@/lib/disputeReasons";
import { formatWhen } from "@/lib/datetime";
import { ProofPhotoPicker } from "@/components/tls/results/ProofPhotoPicker";

// „Problem melden“ (#1158): Grund antippen (falsches Ergebnis, Regelverstoß, Technik, Sonstiges), kurz beschreiben, auf
// Wunsch ein Foto. Die Turnierleitung bekommt es sofort und entscheidet; die Gegenseite erfährt nur, dass geprüft wird
// (ohne den Text). Geht in jedem Modus - bei „Nur Turnierleitung“ direkt an die Turnierleitung.

export function ProblemReportForm({ matchId, until = null, busy = false, initialCategory = "", onSubmit, separated = false }) {
  const [category, setCategory] = useState(initialCategory);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { if (initialCategory) setCategory(initialCategory); }, [initialCategory]);

  const submit = async (event) => {
    event.preventDefault();
    if (!category) return setError("Bitte antippen, was nicht stimmt.");
    if (!text.trim()) return setError("Bitte kurz beschreiben, was nicht stimmt.");
    if (photo?.status === "uploading") return setError("Das Foto wird noch hochgeladen – einen Moment.");
    setError("");
    const done = await onSubmit({ reason: text.trim(), category, photo_id: photo?.status === "ready" ? photo.id : null });
    if (done) {
      setText("");
      setPhoto(null);
      setCategory("");
    }
    return undefined;
  };

  return (
    <form onSubmit={submit} className={`space-y-3 ${separated ? "border-t border-white/10 pt-5" : ""}`} data-testid="match-dispute-form" noValidate>
      <div className="text-xs text-[#FF6B60] font-bold uppercase tracking-wider flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Problem melden</div>
      <div className="text-sm text-white/60">Was stimmt nicht?</div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Grund">
        {DISPUTE_REASONS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
            className={`min-h-[40px] rounded-full border px-3 text-xs font-bold uppercase tracking-wider transition ${category === key ? "border-[#29B6E8]/70 bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/10 bg-white/5 text-white/65 hover:border-white/25"}`}
            data-testid={`match-dispute-reason-${key}`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} className="input w-full min-h-[5rem] resize-y" placeholder="Kurz beschreiben, z. B. „Es stand 2:1 für mich, nicht 1:2.“" data-testid="match-dispute-input" />
      <ProofPhotoPicker matchId={matchId} value={photo} onChange={setPhoto} testId="dispute-photo" label="Foto als Beleg" />
      <p className="text-xs text-white/50" data-testid="match-dispute-hint">
        Die Turnierleitung bekommt sofort Bescheid, prüft und entscheidet.
        {until ? ` Möglich bis ${formatWhen(until)}.` : ""}
      </p>
      {error ? <p className="text-sm text-[#FF6B60]" role="alert" data-testid="match-dispute-error">{error}</p> : null}
      <button disabled={busy} className="tls-btn tls-btn--danger min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-dispute-btn">An die Turnierleitung schicken</button>
    </form>
  );
}
