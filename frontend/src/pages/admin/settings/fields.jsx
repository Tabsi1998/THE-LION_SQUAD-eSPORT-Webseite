// Bausteine der Einstellungsseite, die mehr als ein Reiter braucht (#223:
// die große Seite wird beim Anfassen Reiter für Reiter zerlegt).

export function BrandField({ label, value, onChange, testId, placeholder = "", disabled = false, hint = "" }) {
  // `disabled` mit `hint`: das Feld führt eine andere Quelle (z. B. Dolibarr, #326) - der Wert steht nur lesbar da.
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}{hint ? <span className="ml-2 normal-case tracking-normal text-[#29B6E8]">{hint}</span> : null}</div>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} data-testid={testId} className={`w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm ${disabled ? "opacity-60 cursor-not-allowed" : ""}`} />
    </label>
  );
}

export function SystemCard({ title, ok, detail, problem, testId }) {
  const ready = !!ok;
  return (
    <div data-testid={testId} className={`border rounded-sm bg-[#121212] p-5 ${ready ? "border-[#00FF88]/25" : "border-[#FFD700]/30"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-heading font-bold uppercase">{title}</div>
        <span className={`text-[10px] font-black uppercase tracking-widest ${ready ? "text-[#00FF88]" : "text-[#FFD700]"}`}>
          {ready ? "OK" : "Prüfen"}
        </span>
      </div>
      <div className="mt-3 text-xs text-white/55 break-words">{detail || "-"}</div>
      {problem && <div className="mt-2 text-xs text-[#FF3B30] break-words">{problem}</div>}
    </div>
  );
}

export function LegalTextArea({ label, value, onChange, testId, rows = 4 }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={rows} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

export function BrandSelect({ label, value, onChange, testId, options }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
        {options.map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
      </select>
    </label>
  );
}
