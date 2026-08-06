import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { api } from "./api";

type MobileLogLevel = "debug" | "info" | "warn" | "error" | "fatal";

type MobileLogOptions = {
  source?: string;
  screen?: string;
  error?: unknown;
  context?: Record<string, unknown>;
};

declare const ErrorUtils: {
  getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
} | undefined;

function randomSessionSuffix() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(8);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Platform.OS}`;
}

const sessionId = `${Date.now().toString(36)}-${randomSessionSuffix()}`;
const clientLoggingEnabled = Constants.expoConfig?.extra?.clientLogging === true;
const DEDUPE_MS = 60_000;
const MAX_LOGS_PER_MINUTE = 12;
const sentAtByFingerprint = new Map<string, number>();
let recentSendTimes: number[] = [];
let installed = false;

const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|email|session|api[_-]?key)/i;

function clip(value: unknown, limit: number) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length > limit ? text.slice(0, limit) : text;
}

function scrubLogText(value: unknown, limit: number) {
  const scrubbed = String(value ?? "")
    .replace(/https?:\/\/[^\s)]+/gi, (url) => url.split(/[?#]/, 1)[0])
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]")
    .replace(/([?&](?:access_token|refresh_token|token|code|key|secret|email)=)[^&#\s]*/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/file:\/\/[^\s)]+/gi, "[local-file]")
    .replace(/[A-Z]:\\[^\s)]+/gi, "[local-path]")
    .replace(/\/(?:data|storage|Users|home)\/[^\s)]+/gi, "[local-path]");
  return clip(scrubbed, limit);
}

function sanitizeContext(value: unknown, depth = 0): unknown {
  if (depth > 2) return "[truncated]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return scrubLogText(value, 600);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeContext(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).slice(0, 30).forEach(([key, item]) => {
      const safeKey = scrubLogText(key, 80);
      out[safeKey] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeContext(item, depth + 1);
    });
    return out;
  }
  return scrubLogText(value, 200);
}

function describeArg(value: unknown): string {
  if (value instanceof Error) return scrubLogText(value.message || value.name, 1000);
  if (typeof value === "string") return scrubLogText(value, 1000);
  try {
    return scrubLogText(JSON.stringify(value), 1000);
  } catch {
    return scrubLogText(value, 1000);
  }
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      error_name: clip(error.name || "Error", 160),
    };
  }
  return {};
}

function appVersion() {
  return Constants.expoConfig?.version || Constants.manifest2?.extra?.expoClient?.version || "";
}

function buildVersion() {
  const config = Constants.expoConfig;
  const androidCode = config?.android?.versionCode;
  const iosBuild = config?.ios?.buildNumber;
  return Platform.OS === "android" && androidCode ? String(androidCode) : iosBuild || "";
}

export function sendMobileLog(level: MobileLogLevel, message: string, options: MobileLogOptions = {}) {
  if (!clientLoggingEnabled) return;
  const payload = {
    level,
    message: scrubLogText(message, 2000),
    source: scrubLogText(options.source, 120),
    screen: scrubLogText(options.screen, 120),
    context: sanitizeContext(options.context),
    platform: Platform.OS,
    os_version: Device.osVersion || "",
    app_version: appVersion(),
    build_version: buildVersion(),
    session_id: sessionId,
    created_at: new Date().toISOString(),
    ...errorDetails(options.error),
  };

  const now = Date.now();
  const fingerprint = `${payload.level}|${payload.source}|${payload.screen}|${payload.message}|${payload.error_name || ""}`;
  const lastSentAt = sentAtByFingerprint.get(fingerprint) || 0;
  if (now - lastSentAt < DEDUPE_MS) return;
  recentSendTimes = recentSendTimes.filter((sentAt) => now - sentAt < 60_000);
  if (recentSendTimes.length >= MAX_LOGS_PER_MINUTE) return;
  sentAtByFingerprint.set(fingerprint, now);
  recentSendTimes.push(now);
  api.post("/mobile/client-logs", payload).catch(() => {});
}

export function logMobileError(error: unknown, source = "app", context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : describeArg(error);
  sendMobileLog("error", message || "Unbekannter App-Fehler", { error, source, context });
}

export function installMobileLogHandlers() {
  if (installed || !clientLoggingEnabled) return;
  installed = true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    sendMobileLog("warn", args.map(describeArg).join(" "), { source: "console.warn" });
  };

  console.error = (...args: unknown[]) => {
    originalError(...args);
    const firstError = args.find((arg) => arg instanceof Error);
    sendMobileLog("error", args.map(describeArg).join(" "), {
      error: firstError,
      source: "console.error",
    });
  };

  const previousHandler = typeof ErrorUtils !== "undefined" ? ErrorUtils?.getGlobalHandler?.() : undefined;
  if (typeof ErrorUtils !== "undefined" && ErrorUtils?.setGlobalHandler) {
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      sendMobileLog(isFatal ? "fatal" : "error", error.message || "Unhandled JS error", {
        error,
        source: "ErrorUtils",
        context: { isFatal: Boolean(isFatal) },
      });
      previousHandler?.(error, isFatal);
    });
  }
}
