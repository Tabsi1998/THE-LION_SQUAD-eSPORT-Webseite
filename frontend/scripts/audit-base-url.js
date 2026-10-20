// Basis-Adresse des öffentlichen Content-Audits (#1007).
// Der Audit startet nur mit ausdrücklich gewählter Adresse (PUBLIC_AUDIT_BASE_URL), nie mit einer
// stillschweigenden Vorgabe. Die echte Seite ist nur mit einem bewussten zweiten Schalter erlaubt.

const PRODUCTION_HOSTS = ["lionsquad.at"];

function isProductionHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  return PRODUCTION_HOSTS.includes(host);
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
  if (isProductionHost(url.hostname) && env.PUBLIC_AUDIT_ALLOW_PRODUCTION !== "1") {
    throw new Error(
      "PUBLIC_AUDIT_BASE_URL zeigt auf die echte Seite. Das ist nur mit ausdrücklich gesetztem "
      + "PUBLIC_AUDIT_ALLOW_PRODUCTION=1 erlaubt (nur lesender Audit, nach Absprache).",
    );
  }

  return url.origin + url.pathname.replace(/\/+$/, "");
}

module.exports = { resolveAuditBaseUrl, isProductionHost };
