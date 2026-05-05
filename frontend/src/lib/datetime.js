export function formatDateTime(value, options = {}) {
  if (!value) return options.fallback || "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value, options = {}) {
  if (!value) return options.fallback || "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fromDateTimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function normalizeDateTimeFields(payload, fields) {
  fields.forEach((field) => {
    if (!payload[field]) {
      delete payload[field];
      return;
    }
    payload[field] = fromDateTimeLocal(payload[field]);
  });
  return payload;
}

export function getRegistrationState(item, noun = "Anmeldung") {
  const now = Date.now();
  const openFrom = item?.registration_open_from ? new Date(item.registration_open_from) : null;
  const openUntil = item?.registration_open_until ? new Date(item.registration_open_until) : null;
  const openFromMs = openFrom && !Number.isNaN(openFrom.getTime()) ? openFrom.getTime() : null;
  const openUntilMs = openUntil && !Number.isNaN(openUntil.getTime()) ? openUntil.getTime() : null;

  if (!item) return { state: "unknown", canRegister: false, label: `${noun} nicht verfügbar` };
  if (item.registration_enabled === false || item.is_invite_only) {
    return { state: "disabled", canRegister: false, label: `${noun} deaktiviert` };
  }
  if (item.status === "draft") {
    return { state: "draft", canRegister: false, label: "Noch nicht veröffentlicht" };
  }
  if (item.status === "scheduled") {
    const suffix = openFromMs ? ` ab ${formatDateTime(item.registration_open_from)}` : "";
    return { state: "scheduled", canRegister: false, label: `Warten auf Öffnung${suffix}` };
  }
  if (item.status !== "registration_open") {
    return { state: "closed", canRegister: false, label: `${noun} geschlossen` };
  }
  if (openFromMs && now < openFromMs) {
    return { state: "scheduled", canRegister: false, label: `${noun} öffnet am ${formatDateTime(item.registration_open_from)}` };
  }
  if (openUntilMs && now > openUntilMs) {
    return { state: "closed", canRegister: false, label: `${noun} seit ${formatDateTime(item.registration_open_until)} geschlossen` };
  }
  return {
    state: "open",
    canRegister: true,
    label: openUntilMs ? `${noun} offen bis ${formatDateTime(item.registration_open_until)}` : `${noun} offen`,
  };
}
