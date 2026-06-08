import { Eye, EyeOff } from "lucide-react";

const inputBase =
  "w-full bg-[#0A0A0A] border px-3 py-2.5 rounded-sm text-white placeholder:text-white/35 focus:outline-none transition";

function fieldIds(id, description, error) {
  const describedBy = [
    description ? `${id}-description` : null,
    error ? `${id}-error` : null,
  ].filter(Boolean).join(" ");

  return {
    descriptionId: `${id}-description`,
    errorId: `${id}-error`,
    describedBy: describedBy || undefined,
  };
}

function labelContent(label, required) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {required && <span className="text-[9px] text-[#FFD700]">Pflichtfeld</span>}
    </span>
  );
}

function borderClass(error) {
  return error
    ? "border-[#FF3B30] focus:border-[#FF3B30]"
    : "border-white/10 focus:border-[#29B6E8]";
}

export function AuthTextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  minLength,
  autoComplete,
  inputMode,
  description,
  error,
  testId,
}) {
  const ids = fieldIds(id, description, error);

  return (
    <div className="block">
      <label htmlFor={id} className="block text-[11px] font-bold uppercase tracking-widest text-white/65 mb-1.5">
        {labelContent(label, required)}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={!!error}
        aria-describedby={ids.describedBy}
        data-testid={testId}
        className={`${inputBase} ${borderClass(error)}`}
      />
      <FieldHelp ids={ids} description={description} error={error} />
    </div>
  );
}

export function AuthPasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggle,
  required = false,
  minLength,
  autoComplete,
  description,
  error,
  testId,
}) {
  const ids = fieldIds(id, description, error);

  return (
    <div className="block">
      <label htmlFor={id} className="block text-[11px] font-bold uppercase tracking-widest text-white/65 mb-1.5">
        {labelContent(label, required)}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          aria-describedby={ids.describedBy}
          data-testid={testId}
          className={`${inputBase} pr-10 ${borderClass(error)}`}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? "Passwort verbergen" : "Passwort anzeigen"}
          aria-controls={id}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 hover:text-[#29B6E8] transition"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      <FieldHelp ids={ids} description={description} error={error} />
    </div>
  );
}

export function AuthSelectField({
  id,
  label,
  value,
  onChange,
  required = false,
  description,
  error,
  testId,
  children,
}) {
  const ids = fieldIds(id, description, error);

  return (
    <div className="block">
      <label htmlFor={id} className="block text-[11px] font-bold uppercase tracking-widest text-white/65 mb-1.5">
        {labelContent(label, required)}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        aria-invalid={!!error}
        aria-describedby={ids.describedBy}
        data-testid={testId}
        className={`${inputBase} ${borderClass(error)}`}
      >
        {children}
      </select>
      <FieldHelp ids={ids} description={description} error={error} />
    </div>
  );
}

export function AuthCheckboxField({ id, checked, onChange, required = false, error, testId, children }) {
  const ids = fieldIds(id, null, error);

  return (
    <div>
      <label className="flex items-start gap-2 text-sm text-white/75">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          required={required}
          aria-invalid={!!error}
          aria-describedby={ids.describedBy}
          data-testid={testId}
          className="mt-1 accent-[#29B6E8]"
        />
        <span className="min-w-0">
          {children}
          {required && <span className="ml-1 text-[#FFD700]" aria-label="Pflichtfeld">*</span>}
        </span>
      </label>
      <FieldHelp ids={ids} error={error} />
    </div>
  );
}

export function AuthFormAlert({ id, tone = "error", children }) {
  const cls = tone === "success"
    ? "text-white/75 bg-[#00FF88]/10 border-[#00FF88]/30"
    : "text-[#FF8A80] bg-[#FF3B30]/10 border-[#FF3B30]/35";

  return (
    <div id={id} role={tone === "success" ? "status" : "alert"} className={`text-sm border p-3 rounded-sm ${cls}`}>
      {children}
    </div>
  );
}

function FieldHelp({ ids, description, error }) {
  return (
    <>
      {description && <div id={ids.descriptionId} className="mt-1 text-[10px] text-white/45">{description}</div>}
      {error && <div id={ids.errorId} role="alert" className="mt-1 text-xs text-[#FF8A80]">{error}</div>}
    </>
  );
}
