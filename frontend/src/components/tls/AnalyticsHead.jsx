import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const SCRIPT_ATTR = "data-tls-analytics";
const GOOGLE_SCRIPT_ID_ATTR = "data-tls-google-id";

function removeAnalyticsScripts() {
  document.querySelectorAll(`[${SCRIPT_ATTR}="true"]`).forEach((node) => node.remove());
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
  if (!window.__tlsGoogleConsentDefault) {
    window.gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      security_storage: "granted",
      wait_for_update: 500,
    });
    window.__tlsGoogleConsentDefault = true;
  }
  return window.gtag;
}

function analyticsDebugMode() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("ga_debug");
}

function setGoogleConsent(state) {
  if (typeof window === "undefined") return;
  const gtag = ensureGoogleTag();
  const granted = state === "granted";
  gtag("consent", "update", {
    analytics_storage: granted ? "granted" : "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    security_storage: "granted",
  });
}

function injectGoogleAnalytics(measurementId) {
  const id = String(measurementId || "").trim();
  if (!id) return;
  const gtag = ensureGoogleTag();
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
  const id = String(measurementId || "").trim();
  if (!id || typeof window === "undefined") return;
  const gtag = ensureGoogleTag();
  gtag("config", id, {
    anonymize_ip: true,
    send_page_view: false,
  });
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
    if (!settings) return undefined;

    const analyticsConsent = hasConsent("analytics");
    const provider = settings.analytics_provider || "";
    if (provider === "google" && settings.google_analytics_id) {
      injectGoogleAnalytics(settings.google_analytics_id);
      setGoogleConsent(analyticsConsent ? "granted" : "denied");
      if (analyticsConsent) configureGoogleAnalytics(settings.google_analytics_id);
    } else if (provider === "plausible" && settings.plausible_domain) {
      setGoogleConsent("denied");
      if (analyticsConsent) injectPlausible(settings.plausible_domain);
    } else {
      setGoogleConsent("denied");
    }

    return removeAnalyticsScripts;
  }, [hasConsent, settings]);

  useEffect(() => {
    if (!hasConsent("analytics") || settings?.analytics_provider !== "google" || !settings?.google_analytics_id || typeof window === "undefined") return;
    setGoogleConsent("granted");
    configureGoogleAnalytics(settings.google_analytics_id);
    const gtag = ensureGoogleTag();
    const event = {
      page_title: document.title,
      page_location: window.location.href,
      page_path: `${location.pathname}${location.search}`,
      send_to: settings.google_analytics_id,
    };
    if (analyticsDebugMode()) event.debug_mode = true;
    gtag("event", "page_view", event);
  }, [hasConsent, location.pathname, location.search, settings]);

  return null;
}
