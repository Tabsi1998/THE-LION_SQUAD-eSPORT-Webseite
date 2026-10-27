import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

// Spamschutz öffentlicher Formulare (#2067): holt beim Laden ein signiertes Formular-Token, hält das unsichtbare Feld
// und - wenn im Admin eingeschaltet - die Antwort von Cloudflare Turnstile. Echte Menschen merken davon nichts:
// `prepare()` wartet notfalls die Mindestzeit ab (höchstens ein paar Sekunden) und holt ein abgelaufenes Token neu,
// statt eine Nachricht still verwerfen zu lassen.

export const HONEYPOT_FALLBACK = "hp_fax";
const REFRESH_MS = 30 * 60 * 1000;
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const MIN_WAIT_MARGIN_MS = 250;
const TURNSTILE_WAIT_MS = 8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchToken(form) {
  const response = await api.get("/spam-guard/token", { params: { form } });
  const data = response?.data || {};
  return {
    token: typeof data.token === "string" ? data.token : "",
    honeypot: data.honeypot || HONEYPOT_FALLBACK,
    minSeconds: Number(data.min_seconds) || 0,
    maxAgeSeconds: Number(data.max_age_seconds) || 0,
    turnstile: data.turnstile && data.turnstile.site_key ? data.turnstile : null,
    fetchedAt: Date.now(),
  };
}

export function useSpamGuard(form) {
  const [info, setInfo] = useState(null);
  const infoRef = useRef(null);
  const [honeypotValue, setHoneypotValue] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [turnstileToken, setTurnstileTokenState] = useState("");
  const turnstileTokenRef = useRef("");
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const turnstileFailedRef = useRef(false);
  const [widgetKey, setWidgetKey] = useState(0);
  const waitersRef = useRef([]);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await fetchToken(form);
      infoRef.current = next;
      if (mountedRef.current) setInfo(next);
      return next;
    } catch {
      return infoRef.current;
    }
  }, [form]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => {
      const current = infoRef.current;
      if (document.visibilityState === "visible" && (!current || Date.now() - current.fetchedAt > REFRESH_MS)) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const setTurnstileToken = useCallback((value) => {
    turnstileTokenRef.current = value || "";
    setTurnstileTokenState(value || "");
    if (value) {
      waitersRef.current.splice(0).forEach((resolve) => resolve(value));
    }
  }, []);

  const setTurnstileError = useCallback((failed) => {
    turnstileFailedRef.current = !!failed;
    setTurnstileFailed(!!failed);
    if (failed) waitersRef.current.splice(0).forEach((resolve) => resolve(""));
  }, []);

  const turnstileConfig = challenge || info?.turnstile || null;
  const showTurnstile = !!turnstileConfig && (turnstileConfig.mode === "always" || !!challenge);

  const waitForTurnstile = useCallback(() => {
    if (turnstileTokenRef.current || turnstileFailedRef.current) return Promise.resolve(turnstileTokenRef.current);
    return new Promise((resolve) => {
      waitersRef.current.push(resolve);
      setTimeout(() => resolve(turnstileTokenRef.current), TURNSTILE_WAIT_MS);
    });
  }, []);

  // Die Felder für den Versand. Wartet höchstens die Mindestzeit (ein paar Sekunden) und kurz auf Turnstile.
  const prepare = useCallback(async () => {
    let current = infoRef.current;
    const tooOld = current && current.maxAgeSeconds && Date.now() - current.fetchedAt > current.maxAgeSeconds * 1000 - EXPIRY_MARGIN_MS;
    if (!current?.token || tooOld) current = await load();
    if (current?.token && current.minSeconds) {
      const remaining = current.minSeconds * 1000 + MIN_WAIT_MARGIN_MS - (Date.now() - current.fetchedAt);
      if (remaining > 0) await sleep(remaining);
    }
    const fields = { form_token: current?.token || "", [current?.honeypot || HONEYPOT_FALLBACK]: honeypotValue };
    if (showTurnstile) {
      const value = await waitForTurnstile();
      if (value) fields.turnstile_token = value;
    }
    return fields;
  }, [honeypotValue, load, showTurnstile, waitForTurnstile]);

  // Nach jedem Versuch, ob Erfolg oder Fehler: ein neues Formular-Token (ein Token gilt nur für wenige Versuche) und
  // ein frisches Widget (eine Turnstile-Antwort gilt nur einmal). `prepare()` wartet beim nächsten Senden die
  // Mindestzeit ab, falls nötig. Ausnahme: nach der Turnstile-Rückfrage (428) bleibt das Token - lädt Turnstile nicht,
  // erkennt der Server die wiederholte Anfrage daran und blockiert sie nicht noch einmal.
  const afterAttempt = useCallback((error) => {
    setTurnstileToken("");
    setTurnstileError(false);
    setWidgetKey((key) => key + 1);
    const challenged = error?.response?.status === 428 && error?.response?.data?.detail?.code === "turnstile_required";
    if (!challenged) load();
  }, [load, setTurnstileError, setTurnstileToken]);

  // „Nur bei Verdacht“: der Server verlangt Turnstile nachträglich (428). Dann zeigt das Formular das Widget.
  const handleError = useCallback((error) => {
    const detail = error?.response?.data?.detail;
    if (error?.response?.status === 428 && detail?.code === "turnstile_required" && detail.turnstile?.site_key) {
      setChallenge(detail.turnstile);
      return detail.msg || "Bitte bestätige kurz, dass du kein Bot bist, und sende dann noch einmal.";
    }
    return null;
  }, []);

  // Nach einem erfolgreichen Versand: Formular zurück auf Anfang (das neue Token holt schon `afterAttempt`).
  const reset = useCallback(() => {
    setHoneypotValue("");
    setChallenge(null);
  }, []);

  return {
    form,
    ready: !!info?.token,
    honeypot: { name: info?.honeypot || HONEYPOT_FALLBACK, value: honeypotValue, onChange: setHoneypotValue },
    turnstile: {
      show: showTurnstile,
      config: turnstileConfig,
      token: turnstileToken,
      failed: turnstileFailed,
      widgetKey,
      onToken: setTurnstileToken,
      onError: setTurnstileError,
    },
    prepare,
    afterAttempt,
    handleError,
    reset,
  };
}
