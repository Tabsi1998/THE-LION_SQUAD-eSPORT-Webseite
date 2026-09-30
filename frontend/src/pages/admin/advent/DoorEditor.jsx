import { useMemo, useState } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, FieldLabel, INPUT_CLASS, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { DoorContent } from "@/advent/DoorDialog";
import { KIND_ICONS } from "@/advent/Door";
import { KIND_HINTS, REF_KINDS, REF_LABELS, dayText, formFromDoor, missing, payloadFromForm, previewContent } from "./form";
import "@/advent/advent-calendar.css";

// Ein Türchen pflegen (#641): Art wählen, Titel und Text, dazu die Felder der Art. Unten steht sofort, wie das
// Türchen im Fenster aussehen wird - ohne zu speichern. Gespeichert wird erst mit dem Knopf; der Server prüft
// alles noch einmal und antwortet mit einem Satz, der sagt, was fehlt.

const GOLD = "#e9c46a";
const LETTERS = ["A", "B", "C"];

function KindPicker({ kinds, value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Art des Türchens" data-testid="advent-editor-kinds">
      {kinds.map((kind) => {
        const Icon = KIND_ICONS[kind.key];
        const active = value === kind.key;
        return (
          <button
            key={kind.key}
            type="button"
            role="radio"
            aria-checked={active}
            title={KIND_HINTS[kind.key]}
            onClick={() => onChange(kind.key)}
            data-testid={`advent-editor-kind-${kind.key}`}
            className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-sm border px-2 py-2 text-center text-[11px] font-bold leading-tight transition ${active ? "border-[#e9c46a] bg-[#e9c46a]/10 text-[#e9c46a]" : "border-white/10 bg-[#0A0A0A] text-white/60 hover:border-white/25 hover:text-white"}`}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="break-words">{kind.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function StickerPicker({ packs, value, onChange }) {
  if (!packs.length) return <p className="text-sm text-white/50">Es gibt gerade keine Sticker zur Auswahl (Verwaltung → Sticker).</p>;
  return (
    <div className="space-y-3" data-testid="advent-editor-stickers">
      {packs.map((pack) => (
        <div key={pack.id}>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">{pack.name}</div>
          <div className="flex flex-wrap gap-1.5">
            {pack.stickers.map((sticker) => (
              <button
                key={sticker.id}
                type="button"
                aria-pressed={value === sticker.id}
                aria-label={sticker.name}
                title={sticker.name}
                onClick={() => onChange(sticker.id)}
                data-testid={`advent-editor-sticker-${sticker.id}`}
                className={`h-12 w-12 rounded-sm border p-1 transition ${value === sticker.id ? "border-[#e9c46a] bg-[#e9c46a]/15" : "border-white/10 bg-[#0A0A0A] hover:border-white/30"}`}
              >
                <img src={resolveMediaUrl(sticker.url)} alt="" loading="lazy" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DoorEditor({ year, day, door, kinds, options, locked = false, saving = false, onSave, onClose }) {
  const [form, setForm] = useState(() => formFromDoor(door));
  const [problem, setProblem] = useState("");
  const set = (patch) => {
    setProblem("");
    setForm((current) => ({ ...current, ...patch }));
  };
  const setQuiz = (patch) => set({ quiz: { ...form.quiz, ...patch } });
  const setPrize = (patch) => set({ prize: { ...form.prize, ...patch } });
  const preview = useMemo(() => previewContent(form, options, day), [form, options, day]);
  const refs = REF_KINDS[form.kind] ? options[REF_KINDS[form.kind]] || [] : [];

  const submit = async (event) => {
    event.preventDefault();
    const gap = missing(form);
    if (gap) {
      setProblem(gap);
      return;
    }
    const failure = await onSave(day, payloadFromForm(form));
    if (failure) setProblem(failure);
  };

  return (
    <AdminSheet title={`Türchen ${day}`} eyebrow={`Adventkalender ${year} · ${dayText(year, day)}`} accent={GOLD} size="lg" onClose={onClose} onSubmit={submit} saving={saving} submitTestId="advent-editor-save" testId="advent-editor" noValidate>
      <FormSection title="Was steckt im Türchen?" hint={KIND_HINTS[form.kind]} accent={GOLD}>
        <KindPicker kinds={kinds} value={form.kind} onChange={(kind) => set({ kind })} />
      </FormSection>

      <FormSection title="Titel und Text" accent={GOLD}>
        <TextField label="Titel" value={form.title} onChange={(title) => set({ title })} required maxLength={80} testId="advent-editor-title" hint="Steht in der Nische des geöffneten Türchens und über dem Inhalt." />
        <TextAreaField label="Text" value={form.body} onChange={(body) => set({ body })} rows={5} required={form.kind === "text"} testId="advent-editor-body" hint="Absätze bleiben erhalten. Höchstens 2000 Zeichen." />
      </FormSection>

      {form.kind === "video" && (
        <FormSection title="Video" accent={GOLD}>
          <TextField label="Adresse bei YouTube" value={form.video_url} onChange={(video_url) => set({ video_url })} required placeholder="https://www.youtube.com/watch?v=…" testId="advent-editor-video" hint="Der Player lädt bei Besuchern erst nach ihrer Zustimmung zu externen Medien." />
        </FormSection>
      )}
      {form.kind === "clip" && (
        <FormSection title="Twitch-Clip" accent={GOLD}>
          <TextField label="Adresse des Clips" value={form.clip_url} onChange={(clip_url) => set({ clip_url })} required placeholder="https://clips.twitch.tv/…" testId="advent-editor-clip" hint="Auch twitch.tv/kanal/clip/… geht." />
        </FormSection>
      )}
      {REF_KINDS[form.kind] && (
        <FormSection title={REF_LABELS[form.kind]} accent={GOLD} hint={form.kind === "member_spotlight" ? "Zur Auswahl stehen die aktiven Mitgliederprofile der Vereinsseite." : "Was Besucher nicht sehen dürfen (Entwurf, nur Mitglieder), erscheint bei ihnen nicht – das Türchen zeigt dann Titel und Text."}>
          <SelectField label={`${REF_LABELS[form.kind]} auswählen`} value={form.ref_id} onChange={(ref_id) => set({ ref_id })} required testId="advent-editor-ref" options={[["", "Bitte wählen …"], ...refs.map((row) => [row.id, row.hint ? `${row.label} (${row.hint})` : row.label])]} />
          {form.kind === "member_spotlight" && (
            <CheckField label="Das Mitglied ist einverstanden, im Adventkalender vorgestellt zu werden." hint="Ohne diese Bestätigung lässt sich das Türchen nicht speichern. Sie gilt nur für dieses Jahr." checked={form.consent_confirmed} onChange={(consent_confirmed) => set({ consent_confirmed })} accent={GOLD} testId="advent-editor-consent" />
          )}
        </FormSection>
      )}
      {form.kind === "sticker" && (
        <FormSection title="Sticker" accent={GOLD}>
          <StickerPicker packs={options.stickers || []} value={form.sticker_id} onChange={(sticker_id) => set({ sticker_id })} />
        </FormSection>
      )}
      {form.kind === "quiz" && (
        <FormSection title="Quiz" accent={GOLD} hint="Die Auflösung sehen Besucher erst nach ihrer Antwort. Gespeichert wird nie, was jemand geantwortet hat.">
          <TextField label="Frage" value={form.quiz.question} onChange={(question) => setQuiz({ question })} required maxLength={200} testId="advent-editor-quiz-question" />
          <FieldLabel label="Drei Antworten – die richtige markieren" required>
            <div className="space-y-2" role="radiogroup" aria-label="Richtige Antwort">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex items-center gap-2">
                  <label className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-white/60" title="Diese Antwort ist richtig">
                    <input type="radio" name="advent-quiz-correct" checked={form.quiz.correct === index} onChange={() => setQuiz({ correct: index })} style={{ accentColor: GOLD }} data-testid={`advent-editor-quiz-correct-${index}`} />
                    {LETTERS[index]}
                  </label>
                  <input value={form.quiz.answers[index]} maxLength={120} onChange={(event) => setQuiz({ answers: form.quiz.answers.map((answer, n) => (n === index ? event.target.value : answer)) })} aria-label={`Antwort ${LETTERS[index]}`} className={INPUT_CLASS} data-testid={`advent-editor-quiz-answer-${index}`} />
                </div>
              ))}
            </div>
          </FieldLabel>
          <TextAreaField label="Erklärung zur Auflösung" value={form.quiz.explanation} onChange={(explanation) => setQuiz({ explanation })} rows={2} testId="advent-editor-quiz-explanation" hint="Freiwillig – ein Satz, warum die Antwort stimmt." />
        </FormSection>
      )}
      {form.kind === "prize" && (
        <FormSection title="Gewinn" accent={GOLD} hint={locked ? "Die Verlosung ist gezogen – der Gewinn steht fest. Titel und Text lassen sich weiter ändern." : "Mitmachen ist ein eigener Klick. Gezogen wird per Zufall; wer gewinnt, wird privat benachrichtigt."}>
          <FormGrid>
            <TextField label="Was gibt es zu gewinnen?" value={form.prize.label} onChange={(label) => setPrize({ label })} required maxLength={120} disabled={locked} placeholder="TLS-Hoodie" testId="advent-editor-prize-label" />
            <TextField label="Beschreibung" value={form.prize.value} onChange={(value) => setPrize({ value })} maxLength={120} disabled={locked} placeholder="Größe nach Wahl" testId="advent-editor-prize-value" />
            <TextField label="Wie viele gewinnen?" type="number" min={1} max={options.max_winners || 20} step={1} value={form.prize.winners} onChange={(winners) => setPrize({ winners })} required disabled={locked} testId="advent-editor-prize-winners" />
            <SelectField label="Wer darf mitmachen?" value={form.prize.audience} onChange={(audience) => setPrize({ audience })} disabled={locked} testId="advent-editor-prize-audience" options={(options.audiences || [{ key: "all", label: "alle mit Konto" }]).map((row) => [row.key, row.label])} />
          </FormGrid>
          <TextField label="Teilnahmeschluss" type="datetime-local" value={form.prize.closes_at} onChange={(closes_at) => setPrize({ closes_at })} disabled={locked} testId="advent-editor-prize-closes" hint="Uhrzeit in Wien. Leer = bis zum Ende des Kalenders (6. Jänner)." />
          <CheckField label="Vorstand und Verwaltung dürfen mitmachen" hint="Üblich ist: wer die Verlosung betreut, macht nicht mit." checked={form.prize.staff_may_enter} onChange={(staff_may_enter) => setPrize({ staff_may_enter })} disabled={locked} accent={GOLD} testId="advent-editor-prize-staff" />
        </FormSection>
      )}

      {form.kind !== "sticker" && (
        <FormSection title={form.kind === "image" ? "Bild" : "Bild dazu"} accent={GOLD} collapsible={form.kind !== "image"} defaultOpen={form.kind === "image" || Boolean(form.media_url)} hint={form.kind === "image" ? "Aus dem eigenen Upload – fremde Adressen nimmt der Kalender nicht." : "Freiwillig: ein Bild über dem Text."}>
          <ImageUpload value={form.media_url} onChange={(media_url) => set({ media_url: media_url || "" })} label="Bild" variant="wide" allowLibrary testId="advent-editor-image" />
        </FormSection>
      )}

      <FormSection title="Knopf unter dem Inhalt" accent={GOLD} collapsible defaultOpen={Boolean(form.link_url)} hint="Freiwillig: führt auf eine eigene Seite (/news) oder eine fremde (https://…).">
        <FormGrid>
          <TextField label="Adresse" value={form.link_url} onChange={(link_url) => set({ link_url })} placeholder="/news oder https://…" testId="advent-editor-link-url" />
          <TextField label="Beschriftung" value={form.link_label} onChange={(link_label) => set({ link_label })} maxLength={40} placeholder="Mehr dazu" testId="advent-editor-link-label" />
        </FormGrid>
      </FormSection>

      {problem && <div className="rounded-sm border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-4 py-3 text-sm text-[#ffb4ae]" role="alert" data-testid="advent-editor-problem">{problem}</div>}

      <FormSection title="So sieht es aus" accent={GOLD} hint="Das Fenster, das sich nach dem Öffnen zeigt. Die Verlosung und das Quiz sind hier nur zum Ansehen." testId="advent-editor-preview">
        <div className="tls-adv-dialog !static !max-h-none !w-full !translate-x-0 !translate-y-0" style={{ position: "static" }}>
          <div className="tls-adv-dialog__head">
            <div className="tls-adv-dialog__eyebrow">Türchen {day}</div>
            <div className="tls-adv-dialog__title">{preview.title}</div>
          </div>
          <div className="tls-adv-dialog__body">
            <DoorContent day={day} content={preview} signedIn onAnswer={async (_day, choice) => ({ correct: choice === form.quiz.correct, correct_index: form.quiz.correct ?? 0, correct_answer: form.quiz.answers[form.quiz.correct ?? 0] || "", explanation: form.quiz.explanation })} onRaffle={async () => {}} />
          </div>
        </div>
      </FormSection>
    </AdminSheet>
  );
}
