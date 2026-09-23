import { Link } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";

// Formular-Rahmen für Anlegen und Bearbeiten im Admin (#434). Vorher sah jedes Formular anders
// aus: Turnier als schmale Seite, Fast Lap noch schmaler, Event und News als Fenster in der
// Bildschirmmitte. Jetzt gibt es eine Editor-Seite, die am PC die Breite nutzt (Inhalt links,
// Seitenleiste rechts), am Tablet und Handy eine Spalte wird und deren Speichern-Leiste unten
// immer sichtbar bleibt. Die Felder dazu liegen in `FormFields.jsx`.

const GRID_COLS = {
  1: "",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
};

export function AdminFormPage({ eyebrow, accent = "#29B6E8", title, intro, backTo, backLabel = "Zurück", onSubmit, aside, headerExtra, actions, testId = "admin-form", children }) {
  return (
    <form onSubmit={onSubmit} data-testid={testId} className="min-w-0">
      <div className="mb-6 min-w-0">
        {backTo && (
          <Link to={backTo} data-testid="admin-form-back" className="inline-flex items-center gap-1.5 mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-white/45 hover:text-white transition">
            <ArrowLeft className="w-3.5 h-3.5" /> {backLabel}
          </Link>
        )}
        <div className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: accent }}>{eyebrow}</div>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 break-words">{title}</h1>
        {intro && <p className="mt-2 text-sm text-white/50 max-w-2xl">{intro}</p>}
        {headerExtra}
      </div>
      {/* Ab 1280 px zwei Spalten: Inhalt links, Seitenleiste (Status, Zeiten, Vorschau) rechts.
          Darunter eine Spalte - die Seitenleiste folgt dem Inhalt. */}
      <div className={`grid gap-5 items-start min-w-0 ${aside ? "xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]" : ""}`}>
        <div className="min-w-0 space-y-5" data-testid="admin-form-main">{children}</div>
        {aside && <aside className="min-w-0 space-y-5" data-testid="admin-form-aside">{aside}</aside>}
      </div>
      {actions}
    </form>
  );
}

// Speichern-Leiste: klebt am unteren Rand, solange das Formular im Bild ist - kein Scrollen bis
// zum Knopf mehr. Abbrechen führt zurück zur Liste.
const CANCEL_CLASS = "inline-flex items-center px-4 py-2.5 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm transition";

export function FormActions({ accent = "#29B6E8", submitLabel = "Speichern", savingLabel = "Speichere …", saving = false, submitTestId, cancelTo, onCancel, cancelLabel = "Abbrechen", icon: Icon = Save, hint, children }) {
  return (
    <div data-testid="admin-form-actions" className="sticky bottom-0 z-20 mt-6 -mx-4 md:-mx-8 border-t border-white/10 bg-[#0A0A0A]/95 backdrop-blur px-4 md:px-8 py-3 flex flex-wrap items-center gap-3">
      {cancelTo && <Link to={cancelTo} data-testid="admin-form-cancel" className={CANCEL_CLASS}>{cancelLabel}</Link>}
      {!cancelTo && onCancel && <button type="button" onClick={onCancel} data-testid="admin-form-cancel" className={CANCEL_CLASS}>{cancelLabel}</button>}
      {hint && <span className="text-xs text-white/45">{hint}</span>}
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {children}
        <button type="submit" disabled={saving} data-testid={submitTestId} style={{ backgroundColor: accent }} className="inline-flex items-center gap-2 px-5 py-2.5 text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:opacity-90 disabled:opacity-50 transition">
          {Icon && <Icon className="w-3.5 h-3.5" />} {saving ? savingLabel : submitLabel}
        </button>
      </div>
    </div>
  );
}

// Ein benannter Abschnitt mit optionaler Erklärung in der Überschrift. Einklappbar für alles,
// was beim Anlegen nicht im Weg stehen soll; `plain` für einen Unterabschnitt ohne eigene Karte.
export function FormSection({ title, hint, accent = "#29B6E8", collapsible = false, defaultOpen = false, plain = false, testId, className = "", children }) {
  const shell = plain ? "" : "border border-white/10 bg-[#121212] rounded-sm p-4 md:p-5";
  const head = (
    <>
      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accent }}>{title}</span>
      {hint && <span className="block mt-1 text-xs text-white/45 normal-case tracking-normal font-normal">{hint}</span>}
    </>
  );
  if (collapsible) {
    return (
      <details open={defaultOpen || undefined} data-testid={testId} className={`${shell} ${plain ? "border border-white/10 bg-[#0A0A0A] rounded-sm p-3" : ""} ${className}`}>
        <summary className="cursor-pointer select-none">{head}</summary>
        <div className="mt-4 space-y-4">{children}</div>
      </details>
    );
  }
  return (
    <section data-testid={testId} className={`${shell} space-y-4 ${className}`}>
      <div>{head}</div>
      {children}
    </section>
  );
}

export function FormGrid({ cols = 2, className = "", children }) {
  return <div className={`grid gap-4 ${GRID_COLS[cols] || GRID_COLS[2]} ${className}`}>{children}</div>;
}
