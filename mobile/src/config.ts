const defaultApiBaseUrl = __DEV__ ? "http://10.0.2.2:8001" : "https://lionsquad.at";

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || defaultApiBaseUrl
).replace(/\/+$/, "");

export const API_URL = `${API_BASE_URL}/api`;

// Die Website selbst (#1537): Datenschutz, Nutzungsbedingungen und andere Seiten des Webs. Im Entwicklungsbuild läuft
// sie getrennt vom Backend (Vite auf 3000, das Backend auf 8001); im Release ist es dieselbe Domain.
const defaultWebsiteBaseUrl = __DEV__ ? "http://10.0.2.2:3000" : "https://lionsquad.at";

export const WEBSITE_BASE_URL = (
  process.env.EXPO_PUBLIC_WEBSITE_BASE_URL || defaultWebsiteBaseUrl
).replace(/\/+$/, "");
