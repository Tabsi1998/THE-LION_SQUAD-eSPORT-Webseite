import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { isGoogleMeasurementId, normalizeGoogleMeasurementId } from "@/lib/analyticsConfig";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const SCRIPT_ATTR = "data-tls-analytics";
const GOOGLE_SCRIPT_ID_ATTR = "data-tls-google-id";

function removeAnalyticsScripts() {
  document.querySelectorAll(`[${SCRIPT_ATTR}="true"]`).forEach((node) => node.remove());
}

function resetGoogleState() {
  if (typeof window === "undefined") return;
  delete window.__tlsGoogleConfiguredFor;
  delete window.__tlsGoogleTagStarted;
}

function appendScript(attrs) {
  const script = document.createElement("script");
  script.setAttribute(SCRIPT_ATTR, "true");
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null) script.setAttribute(key, value);
  });
  document.head.appendChild(script);
  return script;
}

function ensureGoogleTag() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };
  return window.gtag;
}

function analyticsDebugMode() {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).has("ga_debug")) return true;
  try {
    return window.localStorage.getItem("tls_analytics_debug") === "true";
  } catch {
    return false;
  }
}

function publishAnalyticsStatus(status) {
  if (typeof window === "undefined") return;
  const next = { ...status, updated_at: new Date().toISOString() };
  window.__tlsAnalyticsStatus = next;
  if (analyticsDebugMode()) {
    console.info("[TLS analytics]", next);
  }
}

function setGoogleConsent(state, mode = "update") {
  if (typeof window === "undefined") return;
  const gtag = ensureGoogleTag();
  const granted = state === "granted";
  gtag("consent", mode, {
    analytics_storage: granted ? "granted" : "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    security_storage: "granted",
  });
}

function injectGoogleAnalytics(measurementId) {
  const id = normalizeGoogleMeasurementId(measurementId);
  if (!id) return;
  const gtag = ensureGoogleTag();
  setGoogleConsent("denied", "default");
  const escapedId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  const existing = document.querySelector(`[${SCRIPT_ATTR}="true"][${GOOGLE_SCRIPT_ID_ATTR}="${escapedId}"]`);
  if (!existing) {
    appendScript({
      async: "true",
      src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`,
      [GOOGLE_SCRIPT_ID_ATTR]: id,
    });
  }
  if (window.__tlsGoogleTagStarted !== id) {
    gtag("js", new Date());
    window.__tlsGoogleTagStarted = id;
  }
}

function configureGoogleAnalytics(measurementId) {
  const id = normalizeGoogleMeasurementId(measurementId);
  if (!id || typeof window === "undefined") return;
  const gtag = ensureGoogleTag();
  const config = {
    anonymize_ip: true,
    send_page_view: false,
    cookie_domain: "auto",
  };
  if (analyticsDebugMode()) config.debug_mode = true;
  gtag("config", id, config);
  window.__tlsGoogleConfiguredFor = id;
}

function injectPlausible(domain) {
  appendScript({
    defer: "true",
    src: "https://plausible.io/js/script.js",
    "data-domain": domain,
  });
}

export function AnalyticsHead() {
  const { hasConsent } = useCookieConsent();
  const location = useLocation();
  const [settings, setSettings] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/public");
      setSettings(data || {});
    } catch {
      setSettings({});
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useApiInvalidation(load, ["settings", "branding"]);

  useEffect(() => {
    removeAnalyticsScripts();
    if (!settings) {
      publishAnalyticsStatus({ state: "loading" });
      return undefined;
    }

    const analyticsConsent = hasConsent("analytics");
    const provider = settings.analytics_provider || "";
    if (!analyticsConsent) {
      setGoogleConsent("denied", "default");
      resetGoogleState();
      publishAnalyticsStatus({ state: "blocked", reason: "analytics_consent_missing", provider });
      return undefined;
    }

    if (provider === "google" && settings.google_analytics_id) {
      const measurementId = normalizeGoogleMeasurementId(settings.google_analytics_id);
      if (!isGoogleMeasurementId(measurementId)) {
        publishAnalyticsStatus({ state: "blocked", reason: "invalid_google_measurement_id", provider, measurement_id: settings.google_analytics_id });
        return undefined;
      }
      injectGoogleAnalytics(measurementId);
      setGoogleConsent("granted");
      configureGoogleAnalytics(measurementId);
      publishAnalyticsStatus({ state: "active", provider, measurement_id: measurementId });
    } else if (provider === "plausible" && settings.plausible_domain) {
      injectPlausible(settings.plausible_domain);
      publishAnalyticsStatus({ state: "active", provider, domain: settings.plausible_domain });
    } else {
      publishAnalyticsStatus({ state: "disabled", provider });
    }

    return () => {
      removeAnalyticsScripts();
      resetGoogleState();
    };
  }, [hasConsent, settings]);

  useEffect(() => {
    if (!hasConsent("analytics") || settings?.analytics_provider !== "google" || !settings?.google_analytics_id || typeof window === "undefined") return;
    const measurementId = normalizeGoogleMeasurementId(settings.google_analytics_id);
    if (!isGoogleMeasurementId(measurementId)) return;
    setGoogleConsent("granted");
    configureGoogleAnalytics(measurementId);
    const gtag = ensureGoogleTag();
    const event = {
      page_title: document.title,
      page_location: window.location.href,
      page_path: `${location.pathname}${location.search}`,
      send_to: measurementId,
    };
    if (analyticsDebugMode()) event.debug_mode = true;
    gtag("event", "page_view", event);
    publishAnalyticsStatus({ state: "page_view_sent", provider: "google", measurement_id: measurementId, page_path: event.page_path, debug_mode: !!event.debug_mode });
  }, [hasConsent, location.pathname, location.search, settings]);

  return null;
}
