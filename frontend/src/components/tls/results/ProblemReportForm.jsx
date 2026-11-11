import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { DISPUTE_REASONS } from "@/lib/disputeReasons";
import { formatWhen } from "@/lib/datetime";
import { KIND_HINTS, incidentLabel, procedurePayload, remainingText } from "@/lib/leagueProcedures";
import { ProofList } from "@/components/tls/results/ProofList";
import { ProofPhotoPicker } from "@/components/tls/results/ProofPhotoPicker";

// „Problem melden“ (#1158): Grund antippen (falsches Ergebnis, Regelverstoß, Technik, Sonstiges), kurz beschreiben, auf
// Wunsch ein Foto. Die Turnierleitung bekommt es sofort und entscheidet; die Gegenseite erfährt nur, dass geprüft wird
// (ohne den Text). Geht in jedem Modus - bei „Nur Turnierleitung“ direkt an die Turnierleitung.
//
// Liga-Staffel (#1619, E.2): mit `guide` (Block `league.procedure_form` der Matchseite) wird das Formular geführt - erst die Art
// (Beanstandung vor, Protest nach der Bestätigung; sie ergibt sich aus dem Stand des Spiels), dann der Grund mit seinen
// Pflichtangaben, dann die Nachweise über den Baustein `ProofList`. Turniere bleiben beim Formular wie bisher.

const CHIP = "min-h-[40px] rounded-full border px-3 text-xs font-bold uppercase tracking-wider transition motion-reduce:transition-none";
const CHIP_ON = "border-[#29B6E8]/70 bg-[#29B6E8]/15 text-[#29B6E8]";
const CHIP_OFF = "border-white/10 bg-white/5 text-white/65 hover:border-white/25";
const STEPS = ["Art", "Grund", "Nachweise"];

function Steps({ current }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold uppercase tracking-widest" aria-label="Schritte" data-testid="procedure-steps">
      {STEPS.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined} data-state={state}
            className={`flex items-center gap-1.5 transition-colors motion-reduce:transition-none ${state === "upcoming" ? "text-white/35" : state === "done" ? "text-white/60" : "text-[#29B6E8]"}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${state === "current" ? "border-[#29B6E8]/70 bg-[#29B6E8]/15" : "border-white/15"}`}>
              {state === "done" ? <Check className="h-3 w-3" aria-hidden="true" /> : index + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function GuidedForm({ matchId, guide, sides, busy, onSubmit, createdId, onDone, separated, help, initialCategory }) {
  const [form, setForm] = useState({ reasonKey: initialCategory || "", text: "", notified: null, scores: {}, incidentId: "" });
  const [error, setError] = useState("");
  // Jede Eingabe nimmt die letzte Fehlermeldung weg - sie gilt für den Stand beim Absenden, nicht für den korrigierten.
  const set = (key, value) => { setError(""); setForm((current) => ({ ...current, [key]: value })); };
  const reason = (guide.reasons || []).find((row) => row.key === form.reasonKey);
  const isResult = form.reasonKey === (guide.result_reason || "wrong_result");
  const wrapper = `space-y-4 ${separated ? "border-t border-white/10 pt-5" : ""}`;

  if (createdId) {
    return (
      <div className={wrapper} data-testid="match-dispute-form">
        <div className="text-xs text-[#FF6B60] font-bold uppercase tracking-wider flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Problem melden{help}</div>
        <Steps current={2} />
        <div className="tls-stagger space-y-3" data-testid="procedure-step-proofs">
          <p className="text-sm text-white/75">
            <strong className="text-white">{guide.kind_label} eingereicht.</strong> Füge jetzt deine Nachweise hinzu – Bilder oder den Link zu einem Video. Nachreichen geht bis zum Ende der Frist.
          </p>
          <ProofList matchId={matchId} kind="protest" refId={createdId} title="Nachweise zum Verfahren" testId="procedure-proofs" />
          <button type="button" onClick={onDone} className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="procedure-done">Fertig</button>
        </div>
      </div>
    );
  }

  const submit = async (event) => {
    event.preventDefault();
    const built = procedurePayload(form, guide, sides.map((side) => side.id));
    if (built.error) return setError(built.error);
    setError("");
    await onSubmit(built.payload);
    return undefined;
  };

  const left = remainingText(guide.until);
  return (
    <form onSubmit={submit} className={wrapper} data-testid="match-dispute-form" noValidate>
      <div className="text-xs text-[#FF6B60] font-bold uppercase tracking-wider flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Problem melden{help}</div>
      <Steps current={form.reasonKey ? 1 : 0} />
      <section className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2.5" data-testid="procedure-kind">
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">1 · Art</div>
        <div className="mt-1 font-heading text-base font-black uppercase text-white" data-testid="procedure-kind-label">{guide.kind_label}</div>
        <p className="mt-1 text-xs text-white/60">{KIND_HINTS[guide.kind]}{guide.until ? ` Möglich bis ${formatWhen(guide.until)}${left ? ` (${left})` : ""}.` : ""}</p>
      </section>
      <section className="space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">2 · Grund</div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Grund">
          {(guide.reasons || []).map((row) => (
            <button key={row.key} type="button" aria-pressed={form.reasonKey === row.key} onClick={() => set("reasonKey", row.key)}
              className={`${CHIP} ${form.reasonKey === row.key ? CHIP_ON : CHIP_OFF}`} data-testid={`match-dispute-reason-${row.key}`}>
              {row.label}
            </button>
          ))}
        </div>
        {reason ? (
          <div key={reason.key} className="tls-stagger space-y-3" data-testid="procedure-details">
            {sides.length === 2 ? (
              <fieldset className="space-y-1.5" data-testid="procedure-claimed">
                <legend className="text-sm text-white/75">{isResult ? "Welches Ergebnis stimmt aus eurer Sicht?" : "Abweichendes Ergebnis (nur, wenn es um das Ergebnis geht)"}</legend>
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  {sides.map((side, index) => (
                    <label key={side.id} className={`block min-w-0 ${index === 1 ? "order-3" : ""}`}>
                      <span className="mb-1 block truncate text-xs text-white/55">{side.name}</span>
                      <input type="number" inputMode="numeric" min={0} max={999} value={form.scores[side.id] ?? ""}
                        onChange={(event) => set("scores", { ...form.scores, [side.id]: event.target.value })}
                        className="input min-h-[44px] w-full text-center tabular-nums" aria-label={`Maps für ${side.name}`} data-testid={`procedure-claimed-${index}`} />
                    </label>
                  ))}
                  <span className="order-2 pb-3 text-white/50" aria-hidden="true">:</span>
                </div>
              </fieldset>
            ) : null}
            {reason.ask_notified ? (
              <fieldset className="space-y-1.5" data-testid="procedure-notified">
                <legend className="text-sm text-white/75">Habt ihr die Gegenseite sofort darauf hingewiesen?</legend>
                <div className="flex gap-2" role="group">
                  {[[true, "Ja"], [false, "Nein"]].map(([value, label]) => (
                    <button key={label} type="button" aria-pressed={form.notified === value} onClick={() => set("notified", value)}
                      className={`${CHIP} min-w-[72px] ${form.notified === value ? CHIP_ON : CHIP_OFF}`} data-testid={`procedure-notified-${value ? "yes" : "no"}`}>{label}</button>
                  ))}
                </div>
                <p className="text-xs text-white/50">Regelwerk § 8.8: Mängel an Ausrüstung, Lobby oder Spielberechtigung sind sofort anzusprechen.</p>
              </fieldset>
            ) : null}
            {(guide.incidents || []).length ? (
              <label className="block">
                <span className="mb-1 block text-sm text-white/75">Geht es um einen gemeldeten Vorfall? (freiwillig)</span>
                <select value={form.incidentId} onChange={(event) => set("incidentId", event.target.value)} className="input min-h-[44px] w-full" data-testid="procedure-incident">
                  <option value="">Nein, kein Vorfall</option>
                  {guide.incidents.map((incident) => <option key={incident.id} value={incident.id}>{incidentLabel(incident)}</option>)}
                </select>
              </label>
            ) : null}
            <label className="block">
              <span className="mb-1 block text-sm text-white/75">Begründung</span>
              <textarea value={form.text} onChange={(event) => set("text", event.target.value)} rows={4} maxLength={guide.reason_max || 1000} className="input w-full min-h-[6rem] resize-y"
                placeholder="Was ist passiert, auf welcher Map, in welcher Runde?" data-testid="match-dispute-input" />
              <span className="mt-1 block text-right text-[11px] tabular-nums text-white/40">{form.text.trim().length} / {guide.reason_max || 1000}</span>
            </label>
          </div>
        ) : <p className="text-xs text-white/50">Tippe an, worum es geht – dann fragen wir nur, was dazu nötig ist.</p>}
      </section>
      <p className="text-xs text-white/50" data-testid="match-dispute-hint">
        3 · Nachweise fügst du im nächsten Schritt hinzu. Die Gegenseite sieht Grund und Begründung und kann Stellung nehmen; das abweichende Ergebnis sieht nur die Liga-Leitung.
      </p>
      {error ? <p className="text-sm text-[#FF6B60]" role="alert" data-testid="match-dispute-error">{error}</p> : null}
      <button disabled={busy} className="tls-btn tls-btn--danger min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-dispute-btn">
        {guide.kind_label} einreichen
      </button>
    </form>
  );
}

export function ProblemReportForm({ matchId, until = null, busy = false, initialCategory = "", onSubmit, separated = false, help = null,
  guide = null, sides = [], createdId = null, onDone = null }) {
  const [category, setCategory] = useState(initialCategory);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { if (initialCategory) setCategory(initialCategory); }, [initialCategory]);

  if (guide) {
    return <GuidedForm matchId={matchId} guide={guide} sides={sides} busy={busy} onSubmit={onSubmit} createdId={createdId} onDone={onDone}
      separated={separated} help={help} initialCategory={initialCategory} />;
  }

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
      <div className="text-xs text-[#FF6B60] font-bold uppercase tracking-wider flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Problem melden{help}</div>
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
