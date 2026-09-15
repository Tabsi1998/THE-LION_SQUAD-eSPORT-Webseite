
export function Section({ children }) { return <div className="space-y-4">{children}</div>; }
export function Row({ children }) {
  const count = Array.isArray(children) ? children.length : 1;
  const cls = count === 3 ? "grid grid-cols-1 sm:grid-cols-3 gap-4" : "grid grid-cols-1 sm:grid-cols-2 gap-4";
  return <div className={cls}>{children}</div>;
}
export function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
export function Input({ value, onChange, placeholder, testId, type = "text", required = false }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testId}
      required={required}
      className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white"
    />
  );
}
