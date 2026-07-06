import { useCallback, useEffect, useRef, useState } from "react";

const EMPTY_PROGRESS = {
  active: false,
  status: "idle",
  total: 0,
  completed: 0,
  failed: 0,
  originals: 0,
  currentIndex: 0,
  currentName: "",
  currentSize: 0,
  phase: "",
  loaded: 0,
  totalBytes: 0,
  speedBps: 0,
  currentStartedAt: 0,
};

export function useUploadProgress({ autoHideMs = 6000 } = {}) {
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const hideTimer = useRef(null);

  const clearTimer = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setProgress(EMPTY_PROGRESS);
  }, [clearTimer]);

  const start = useCallback((files) => {
    clearTimer();
    setProgress({
      ...EMPTY_PROGRESS,
      active: true,
      status: "uploading",
      total: Array.from(files || []).length,
      phase: "Warte auf Upload",
    });
  }, [clearTimer]);

  const startFile = useCallback((file, index, phase = "Bereite vor") => {
    clearTimer();
    const now = performance.now();
    setProgress((current) => ({
      ...current,
      active: true,
      status: "uploading",
      currentIndex: index,
      currentName: file?.name || "Medium",
      currentSize: file?.size || 0,
      phase,
      loaded: 0,
      totalBytes: file?.size || 0,
      speedBps: 0,
      currentStartedAt: now,
    }));
  }, [clearTimer]);

  const setPhase = useCallback((phase) => {
    setProgress((current) => ({ ...current, phase }));
  }, []);

  const beginTransfer = useCallback((totalBytes = 0) => {
    const now = performance.now();
    setProgress((current) => ({
      ...current,
      phase: "Upload läuft",
      loaded: 0,
      totalBytes: Number(totalBytes || current.currentSize || 0),
      speedBps: 0,
      currentStartedAt: now,
    }));
  }, []);

  const updateUpload = useCallback((event) => {
    const now = performance.now();
    const loaded = Number(event?.loaded || 0);
    const reportedTotal = Number(event?.total || 0);
    setProgress((current) => {
      const elapsedSeconds = Math.max((now - (current.currentStartedAt || now)) / 1000, 0.1);
      const totalBytes = reportedTotal || current.totalBytes || current.currentSize || loaded;
      return {
        ...current,
        loaded,
        totalBytes,
        speedBps: loaded / elapsedSeconds,
        phase: current.phase || "Upload läuft",
      };
    });
  }, []);

  const finishFile = useCallback(({ original = false } = {}) => {
    setProgress((current) => ({
      ...current,
      completed: current.completed + 1,
      originals: current.originals + (original ? 1 : 0),
      loaded: current.totalBytes || current.loaded,
      speedBps: current.speedBps,
      phase: "Gespeichert",
    }));
  }, []);

  const failFile = useCallback(() => {
    setProgress((current) => ({
      ...current,
      failed: current.failed + 1,
      phase: "Fehlgeschlagen",
    }));
  }, []);

  const finish = useCallback(() => {
    setProgress((current) => ({
      ...current,
      status: "done",
      phase: current.failed ? "Abgeschlossen mit Fehlern" : "Abgeschlossen",
      loaded: 0,
      totalBytes: 0,
      speedBps: 0,
    }));
    clearTimer();
    hideTimer.current = window.setTimeout(() => {
      setProgress(EMPTY_PROGRESS);
      hideTimer.current = null;
    }, autoHideMs);
  }, [autoHideMs, clearTimer]);

  return {
    progress,
    start,
    startFile,
    setPhase,
    beginTransfer,
    updateUpload,
    finishFile,
    failFile,
    finish,
    reset,
  };
}
