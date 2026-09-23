// Felder für die Admin-Formulare (#434): Beschriftung, Pflichtfeld-Stern, Eingabe, Auswahl und
// Haken sehen überall gleich aus. Vorher hatte jede Seite ihre eigene Kopie davon.

export const INPUT_CLASS = "w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none disabled:opacity-50";
const LABEL_CLASS = "text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5";

export function RequiredMark() {
  return <span className="text-[#FF3B30] ml-1" title="Pflichtfeld">*</span>;
}

// Beschriftung um beliebige Inhalte (Editor, Bild-Upload, Listen). Bewusst kein <label>, damit
// ein Klick auf die Überschrift nicht das erste Eingabefeld eines Editors fokussiert.
export function FieldLabel({ label, required, hint, className = "", children }) {
  return (
    <div className={`block min-w-0 ${className}`}>
      <div className={LABEL_CLASS}>{label}{required && <RequiredMark />}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-white/45">{hint}</div>}
    </div>
  );
}

export function TextField({ label, value, onChange, type = "text", required, placeholder, testId, min, max, step, hint, disabled, className = "" }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <div className={LABEL_CLASS}>{label}{required && <RequiredMark />}</div>
      <input
        type={type}
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={testId}
        className={INPUT_CLASS}
      />
      {hint && <div className="mt-1 text-xs text-white/45">{hint}</div>}
    </label>
  );
}

// `options` als [wert, text]-Paare oder als {k, l}-Objekte (so liefern die Meta-Endpunkte sie).
export function SelectField({ label, value, onChange, options = [], required, testId, hint, disabled, className = "" }) {
  const rows = options.map((option) => (Array.isArray(option) ? option : [option.k, option.l ?? option.k]));
  return (
    <label className={`block min-w-0 ${className}`}>
      <div className={LABEL_CLASS}>{label}{required && <RequiredMark />}</div>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled} data-testid={testId} className={INPUT_CLASS}>
        {rows.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <div className="mt-1 text-xs text-white/45">{hint}</div>}
    </label>
  );
}

export function CheckField({ label, checked, onChange, testId, accent = "#29B6E8", hint, disabled, className = "" }) {
  return (
    <label className={`flex items-start gap-2 text-sm text-white/75 ${disabled ? "opacity-60" : ""} ${className}`}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} data-testid={testId} style={{ accentColor: accent }} className="mt-1 shrink-0" />
      <span>
        {label}
        {hint && <span className="block text-xs text-white/45">{hint}</span>}
      </span>
    </label>
  );
}
