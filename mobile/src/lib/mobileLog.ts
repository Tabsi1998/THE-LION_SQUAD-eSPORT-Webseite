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

const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let installed = false;

function clip(value: unknown, limit: number) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length > limit ? text.slice(0, limit) : text;
}

function describeArg(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message || value.name;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      error_name: clip(error.name || "Error", 160),
      stack: clip(error.stack || error.message, 8000),
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
  const payload = {
    level,
    message: clip(message, 2000),
    source: options.source,
    screen: options.screen,
    context: options.context,
    platform: Platform.OS,
    device_name: Device.deviceName || Device.modelName || "",
    os_version: Device.osVersion || "",
    app_version: appVersion(),
    build_version: buildVersion(),
    session_id: sessionId,
    created_at: new Date().toISOString(),
    ...errorDetails(options.error),
  };
  api.post("/mobile/client-logs", payload).catch(() => {});
}

export function logMobileError(error: unknown, source = "app", context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : describeArg(error);
  sendMobileLog("error", message || "Unbekannter App-Fehler", { error, source, context });
}

export function installMobileLogHandlers() {
  if (installed) return;
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
