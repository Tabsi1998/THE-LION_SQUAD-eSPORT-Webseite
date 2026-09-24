// Bausteine der Dolibarr-Seite (#223: aus AdminDolibarrPage herausgelöst, Verhalten unverändert).
const TONES = { ok: "border-[#00FF88]/25", warn: "border-[#FFD700]/30", danger: "border-[#FF3B30]/40", plain: "border-white/10" };

export function Tile({ label, value, detail, tone = "plain", testId }) {
  return (
    <div className={`border rounded-sm bg-[#121212] p-4 ${TONES[tone] || TONES.plain}`} data-testid={testId}>
      <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold">{label}</div>
      <div className="mt-1 font-heading text-xl font-black">{value}</div>
      {detail && <div className="mt-1 text-xs text-white/50 break-words">{detail}</div>}
    </div>
  );
}

export function Panel({ title, children }) {
  return (
    <section className="border border-white/10 bg-[#121212] rounded-sm p-5">
      <h2 className="font-heading font-bold uppercase mb-3">{title}</h2>
      {children}
    </section>
  );
}

export function Empty({ text }) {
  return <div className="text-sm text-white/40 py-4">{text}</div>;
}

export function Field({ label, value, onChange, placeholder = "", type = "text", testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} autoComplete="off"
        className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}
