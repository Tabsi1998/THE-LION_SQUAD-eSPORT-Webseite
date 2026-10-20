// Basis-Adresse des öffentlichen Content-Audits (#1007).
// Der Audit startet nur mit ausdrücklich gewählter Adresse (PUBLIC_AUDIT_BASE_URL), nie mit einer
// stillschweigenden Vorgabe. Die echte Seite ist nur mit einem bewussten zweiten Schalter erlaubt.

const PRODUCTION_HOSTS = ["lionsquad.at"];

// Hostname vereinheitlichen: Kleinbuchstaben, ohne DNS-Punkt am Ende.
function normalizeHostname(hostname) {
  return String(hostname || "").trim().toLowerCase().replace(/\.+$/, "");
}

// new URL() wandelt IDN in Punycode und vereinheitlicht Punkt-Schreibweisen; so wird auch geprüft.
function isProductionHost(hostname) {
  let host = normalizeHostname(hostname);
  try {
    host = normalizeHostname(new URL(`http://${host}`).hostname);
  } catch {
    // unverändert prüfen
  }
  return PRODUCTION_HOSTS.some((production) => host === production || host.endsWith(`.${production}`));
}

function isProductionUrl(value) {
  try {
    return isProductionHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

// Ohne ausdrückliche Freigabe darf der Audit nie bei der echten Seite landen (auch nicht per Weiterleitung).
function assertNotProduction(value, env = {}) {
  if (env.PUBLIC_AUDIT_ALLOW_PRODUCTION !== "1" && isProductionUrl(value)) {
    throw new Error(
      `Abbruch: der Audit würde die echte Seite erreichen (${new URL(value).origin}). `
      + "Nur mit ausdrücklich gesetztem PUBLIC_AUDIT_ALLOW_PRODUCTION=1 erlaubt.",
    );
  }
}

function resolveAuditBaseUrl(env = {}) {
  const raw = String(env.PUBLIC_AUDIT_BASE_URL || "").trim();
  if (!raw) {
    throw new Error(
      "PUBLIC_AUDIT_BASE_URL fehlt. Der Audit startet nur mit ausdrücklich gewählter Test-Adresse, "
      + "z. B. PUBLIC_AUDIT_BASE_URL=http://127.0.0.1:3000 yarn audit:public",
    );
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`PUBLIC_AUDIT_BASE_URL ist keine gültige Adresse: ${raw}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("PUBLIC_AUDIT_BASE_URL muss mit http:// oder https:// beginnen.");
  }
  if (url.username || url.password) {
    throw new Error("PUBLIC_AUDIT_BASE_URL darf keine Zugangsdaten enthalten.");
  }
  if (isProductionUrl(url.href) && env.PUBLIC_AUDIT_ALLOW_PRODUCTION !== "1") {
    throw new Error(
      "PUBLIC_AUDIT_BASE_URL zeigt auf die echte Seite. Das ist nur mit ausdrücklich gesetztem "
      + "PUBLIC_AUDIT_ALLOW_PRODUCTION=1 erlaubt (nur lesender Audit, nach Absprache).",
    );
  }

  return url.origin + url.pathname.replace(/\/+$/, "");
}

module.exports = { resolveAuditBaseUrl, isProductionHost, isProductionUrl, assertNotProduction };
