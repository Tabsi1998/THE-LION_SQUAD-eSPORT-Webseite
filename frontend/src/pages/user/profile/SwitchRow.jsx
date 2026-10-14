// Ein Schalter mit Titel und Satz, wie in den App-Einstellungen. Ersetzt die
// Kästchen mit „An/Aus“-Text (#257). Bewusst ein eigener Knopf mit
// role="switch" statt der Radix-Switch: die braucht ResizeObserver, den die
// Tests nicht haben, und ihre Farben hängen an Design-Tokens, die die
// Webseite nicht setzt.
export function SwitchRow({ label, description, hint, checked, onCheckedChange, disabled = false, testId }) {
  return (
    <div
      className={`flex items-start justify-between gap-4 p-4 border rounded-sm bg-[#0A0A0A] ${checked && !disabled ? "border-[#29B6E8]/45" : "border-white/10"} ${disabled ? "opacity-50" : ""}`}
    >
      <div className="min-w-0">
        <div className="font-bold text-white">{label}</div>
        {description ? <div className="text-sm text-white/60 mt-1">{description}</div> : null}
        {hint ? <div className="text-[11px] text-[#FFD700] mt-1">{hint}</div> : null}
      </div>
      <ProfileSwitch label={label} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} testId={testId} className="mt-1" />
    </div>
  );
}

export function ProfileSwitch({ label, checked, onCheckedChange, disabled = false, testId, className = "" }) {
  const on = !!checked;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!on)}
      data-testid={testId}
      data-state={on ? "checked" : "unchecked"}
      className={`tls-hit relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8] disabled:cursor-not-allowed ${on ? "bg-[#29B6E8]" : "bg-white/20"} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

// Zeigt ruhig, was mit dem Speichern von selbst gerade passiert (#1048): „Speichert …“, kurz „Gespeichert ✓“, bei einem
// Fehler „Nicht gespeichert“ mit „Erneut versuchen“. Die Eingabe bleibt dabei stehen; ungültige Eingaben haben ihren
// Hinweis am Feld und gehen nicht an den Server.
export function AutosaveStatus({ status, message, onRetry, testId = "profile-autosave-status" }) {
  const text = {
    idle: "Änderungen speichern von selbst.",
    pending: "Speichert …",
    saving: "Speichert …",
    saved: "Gespeichert ✓",
    invalid: "Nicht gespeichert – bitte die markierte Eingabe prüfen.",
    error: "Nicht gespeichert.",
  }[status] || "";
  const tone = status === "error" || status === "invalid" ? "text-warn" : status === "saved" ? "text-ok" : "text-white/50";
  return (
    <div role="status" aria-live="polite" data-testid={testId} data-status={status} className={`flex flex-wrap items-center gap-2 text-xs ${tone}`}>
      <span>{text}</span>
      {status === "error" && message ? <span className="text-white/60">{message}</span> : null}
      {status === "error" && onRetry ? (
        <button
          type="button"
          onClick={() => { void onRetry(); }}
          data-testid="profile-autosave-retry"
          className="tls-hit min-h-11 px-3 border border-warn/30 rounded-sm font-bold uppercase tracking-wider hover:bg-warn/5"
        >
          Erneut versuchen
        </button>
      ) : null}
    </div>
  );
}
