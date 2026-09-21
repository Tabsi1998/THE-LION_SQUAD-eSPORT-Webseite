// Bequem anmelden (#348): der Haken „Angemeldet bleiben“ und das einmalige Angebot,
// einen Passkey einzurichten. Beides merkt sich nur dieses Gerät - nichts davon geht
// an den Server, und fällt der Speicher aus (privates Fenster), gilt der Standard.

const REMEMBER_KEY = "tls_remember_me";
const OFFER_KEY = "tls_passkey_offer";
const LATER_DAYS = 30;

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // privates Fenster: dann eben ohne Merken
  }
}

/** Standard ist „bleiben“ – am eigenen Handy will niemand alle zwei Wochen neu tippen. */
export function readRemember() {
  return read(REMEMBER_KEY) !== "0";
}

export function writeRemember(value) {
  write(REMEMBER_KEY, value ? "1" : "0");
}

/** „later“ fragt nach 30 Tagen wieder, „never“ nie mehr. */
export function dismissPasskeyOffer(kind, now = Date.now()) {
  write(OFFER_KEY, kind === "never" ? "never" : String(now));
}

export function shouldOfferPasskey({ supported, enabled, passkeyCount, usedPasskey = false }, now = Date.now()) {
  if (!supported || !enabled || usedPasskey || passkeyCount > 0) return false;
  const state = read(OFFER_KEY);
  if (state === "never") return false;
  const asked = Number(state);
  if (asked && now - asked < LATER_DAYS * 24 * 3600 * 1000) return false;
  return true;
}

/** Name für den neuen Passkey, damit man ihn in der Liste wiedererkennt. */
export function deviceLabel(userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "") {
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android-Handy";
  if (/Windows/i.test(userAgent)) return "Windows-PC";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "Mac";
  if (/Linux/i.test(userAgent)) return "Linux-PC";
  return "Mein Gerät";
}
