import { api, formatUploadError } from "@/lib/api";

const GATEWAY_STATUS_CODES = new Set([413, 502, 503, 504]);

function shouldRecordClientFailure(error) {
  const status = error?.response?.status;
  if (!status) return true;
  return GATEWAY_STATUS_CODES.has(status);
}

export async function logUploadClientFailure(error, file, options = {}) {
  if (!shouldRecordClientFailure(error)) return;
  const statusCode = error?.response?.status || null;
  const message = options.message || formatUploadError(error, "Upload fehlgeschlagen.", {
    appLimitMb: options.appLimitMb,
    proxyLimitMb: options.proxyLimitMb,
  });
  try {
    await api.post("/uploads/client-failure", {
      endpoint: options.endpoint || "/uploads/media",
      media_scope: options.mediaScope || "admin",
      filename: options.filename || file?.name || "upload",
      size: Number.isFinite(file?.size) ? file.size : null,
      mime: file?.type || "",
      kind: options.kind || "unknown",
      phase: options.phase || "",
      status_code: statusCode,
      message,
    });
  } catch {
    // Diagnostics must never block the actual admin workflow.
  }
}
