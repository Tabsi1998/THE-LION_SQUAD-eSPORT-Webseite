// Wach halten (#1112): Die TV-Seite bittet den Browser beim Start, den Bildschirm anzulassen (Wake Lock), und nach
// dem Zurückkehren erneut - der Browser gibt die Sperre selbst frei, sobald die Seite verdeckt ist. Kann er das nicht
// (zu alt, kein HTTPS, abgelehnt), meldet `onUnavailable` das genau einmal; die Seite läuft normal weiter.

/**
 * @param {{ nav?: Navigator, doc?: Document, onUnavailable?: (reason: string) => void }} options
 * @returns {() => void} hört auf und gibt die Sperre frei
 */
export function keepScreenAwake({ nav = typeof navigator === "undefined" ? null : navigator, doc = typeof document === "undefined" ? null : document, onUnavailable } = {}) {
  let sentinel = null;
  let stopped = false;
  let pending = false;
  let reported = false;

  const report = (reason) => {
    if (reported) return;
    reported = true;
    onUnavailable?.(reason);
  };

  const visible = () => !doc || doc.visibilityState === undefined || doc.visibilityState === "visible";

  const onRelease = () => {
    sentinel = null;
    // Freigegeben, während die Seite noch zu sehen ist (z. B. vom System): gleich wieder anfordern.
    if (!stopped && visible()) request();
  };

  async function request() {
    if (stopped || pending || sentinel || !visible()) return;
    const lock = nav?.wakeLock;
    if (!lock || typeof lock.request !== "function") {
      report("unsupported");
      return;
    }
    pending = true;
    try {
      const next = await lock.request("screen");
      if (stopped) {
        next?.release?.().catch?.(() => {});
        return;
      }
      sentinel = next;
      sentinel?.addEventListener?.("release", onRelease);
    } catch {
      report("denied");
    } finally {
      pending = false;
    }
  }

  const onVisibility = () => {
    if (visible()) request();
  };

  doc?.addEventListener?.("visibilitychange", onVisibility);
  request();

  return () => {
    stopped = true;
    doc?.removeEventListener?.("visibilitychange", onVisibility);
    const current = sentinel;
    sentinel = null;
    if (current) {
      current.removeEventListener?.("release", onRelease);
      Promise.resolve(current.release?.()).catch(() => {});
    }
  };
}
