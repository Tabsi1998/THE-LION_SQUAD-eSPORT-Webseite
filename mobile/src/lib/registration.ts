import { formatDateTime } from "./format";

type RegistrationLike = {
  is_invite_only?: boolean | null;
  online_registration_enabled?: boolean | null;
  public_phase?: { state?: string | null } | null;
  registration_enabled?: boolean | null;
  registration_open_from?: string | null;
  registration_open_until?: string | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  status?: string | null;
};

type RegistrationState = {
  canRegister: boolean;
  label: string;
  state: "closed" | "disabled" | "draft" | "open" | "scheduled" | "unknown";
};

export function hasOnlineRegistration(item?: RegistrationLike | null) {
  return Boolean(
    item?.online_registration_enabled === true &&
      item.registration_enabled === true &&
      (item.registration_open_from || item.registration_open_until),
  );
}

export function getRegistrationState(item?: RegistrationLike | null, noun = "Anmeldung"): RegistrationState {
  const now = Date.now();
  const openFrom = item?.registration_open_from || item?.registration_opens_at;
  const openUntil = item?.registration_open_until || item?.registration_closes_at;
  const openFromMs = parseMs(openFrom);
  const openUntilMs = parseMs(openUntil);
  const status = item?.public_phase?.state || item?.status;

  if (!item) return { state: "unknown", canRegister: false, label: `${noun} nicht verfuegbar` };
  if (item.registration_enabled === false || item.is_invite_only) {
    return { state: "disabled", canRegister: false, label: `${noun} deaktiviert` };
  }
  if (status === "draft") {
    return { state: "draft", canRegister: false, label: "Noch nicht veroeffentlicht" };
  }
  if (status === "scheduled" || status === "registration_pending" || status === "announced") {
    const suffix = openFromMs ? ` ab ${formatDateTime(openFrom)}` : "";
    return { state: "scheduled", canRegister: false, label: `${noun} oeffnet${suffix}` };
  }
  if (status !== "registration_open") {
    return { state: "closed", canRegister: false, label: `${noun} geschlossen` };
  }
  if (openFromMs && now < openFromMs) {
    return { state: "scheduled", canRegister: false, label: `${noun} oeffnet am ${formatDateTime(openFrom)}` };
  }
  if (openUntilMs && now > openUntilMs) {
    return { state: "closed", canRegister: false, label: `${noun} seit ${formatDateTime(openUntil)} geschlossen` };
  }
  return {
    state: "open",
    canRegister: true,
    label: openUntilMs ? `${noun} offen bis ${formatDateTime(openUntil)}` : `${noun} offen`,
  };
}

function parseMs(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}
