export function Section({ children }) { return <div className="space-y-4">{children}</div>; }
export function Row({ children }) {
  const count = Array.isArray(children) ? children.length : 1;
  const cls = count === 3 ? "grid grid-cols-1 sm:grid-cols-3 gap-4" : "grid grid-cols-1 sm:grid-cols-2 gap-4";
  return <div className={cls}>{children}</div>;
}
// Ein Hinweis am Feld (#1048): diese Eingabe wird so nicht gespeichert. Die Eingabe bleibt stehen.
export function FieldError({ message, testId }) {
  if (!message) return null;
  return <p role="alert" data-testid={testId} className="mt-1.5 text-[11px] text-warn">{message}</p>;
}
// Ein Feld mit einer Eingabe ist ein <label>: ein Klick auf den Titel setzt den Fokus hinein. Mehrere Knöpfe oder ein
// verstecktes Datei-Feld (Bild hochladen, Mehrfachauswahl, Häkchen-Liste) brauchen `group` - sonst löst jeder Klick in
// die Fläche, auch neben das Bild, den ersten Knopf darin aus und öffnet etwa die Dateiauswahl.
export function Field({ label, error = "", errorTestId, group = false, children }) {
  const title = <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>;
  if (group) {
    return (
      <div role="group" aria-label={typeof label === "string" ? label : undefined} className="block">
        {title}
        {children}
        <FieldError message={error} testId={errorTestId} />
      </div>
    );
  }
  return (
    <label className="block">
      {title}
      {children}
      <FieldError message={error} testId={errorTestId} />
    </label>
  );
}
export function Input({ value, onChange, placeholder, testId, type = "text", required = false, invalid = false }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testId}
      required={required}
      aria-invalid={invalid || undefined}
      className={`w-full bg-[#0A0A0A] border ${invalid ? "border-warn/60" : "border-white/10"} focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white`}
    />
  );
}
