// Ein Zeichen-Loop für alle Canvas-Effekte der Jahreszeiten (#634): Partikelbudget nach Gerät, Pause
// bei verstecktem Tab, ein requestAnimationFrame für alles, Zeitbudget je Bild im Dev-Modus messbar.
// Ruhen alle Ebenen (Wetter ohne Niederschlag, #673), schläft der Loop: kein Bild, und die Zeichenfläche gibt ihren
// Speicher frei - ein trockener Tag kostet nichts.

export const TIERS = { low: 40, mid: 120, high: 240 };
/** Ruhen alle Ebenen (`layer.idle()`), schläft der Loop und schaut so oft wieder nach (Wetter ohne Niederschlag). */
export const IDLE_CHECK_MS = 2000;
/** Ein Ereignis am Fenster weckt den schlafenden Loop sofort (eine Ebene hat gerade etwas Neues). */
export const SKY_WAKE_EVENT = "tls:sky-wake";

export function wakeSky(win = typeof window === "undefined" ? null : window) {
  if (win && typeof win.dispatchEvent === "function" && typeof win.Event === "function") win.dispatchEvent(new win.Event(SKY_WAKE_EVENT));
}

/** Wie viele Partikel dieses Gerät verträgt - grob nach Kernen, Speicher und Fensterbreite. */
export function particleBudget(env = typeof window === "undefined" ? {} : window) {
  const nav = env.navigator || {};
  const cores = Number(nav.hardwareConcurrency) || 4;
  const memory = Number(nav.deviceMemory) || 4;
  const width = Number(env.innerWidth) || 1280;
  const saveData = Boolean(nav.connection && nav.connection.saveData);
  if (saveData || cores <= 2 || memory <= 2 || width < 640) return TIERS.low;
  if (cores <= 4 || memory <= 4 || width < 1200) return TIERS.mid;
  return TIERS.high;
}

/** Die Fläche, für die das Budget gedacht ist - größere Fenster bekommen mehr Teilchen für dieselbe Dichte. */
export const REFERENCE_AREA = 1440 * 900;
export const MAX_AREA_FACTOR = 2;

/** Wie viel mehr Teilchen ein großes Fenster braucht: Fläche gegen 1440 × 900, nie weniger als 1, höchstens das Doppelte. */
export function areaFactor(size) {
  const area = Math.max(0, Number(size && size.width) || 0) * Math.max(0, Number(size && size.height) || 0);
  if (!area) return 1;
  return Math.min(MAX_AREA_FACTOR, Math.max(1, area / REFERENCE_AREA));
}

/** Stärke → Anteil des Budgets. „dezent“ zeichnet gar nicht (nur statische Deko). */
export function budgetFor(intensity, base = particleBudget()) {
  if (intensity === "subtle") return 0;
  if (intensity === "full") return base;
  return Math.round(base / 2);
}

/**
 * Der gemeinsame Loop: `add(layer)` mit `layer.draw(ctx, dt, size)`; gibt eine Funktion zum Entfernen zurück.
 * Läuft nur, solange es Ebenen gibt und der Tab sichtbar ist.
 */
export function createSkyLoop(canvas, { win = window, doc = document, onFrameTime } = {}) {
  const layers = new Set();
  let frame = 0;
  let last = 0;
  let running = false;
  let idleTimer = 0;
  let sleptAt = 0;
  // Geparkt hat die Zeichenfläche einen einzigen Punkt: Speicher für das ganze Fenster nur, solange gezeichnet wird.
  let parked = true;
  const clock = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());
  const ctx = canvas.getContext("2d");

  const resize = () => {
    canvas.style.width = `${win.innerWidth}px`;
    canvas.style.height = `${win.innerHeight}px`;
    if (parked) {
      canvas.width = 1;
      canvas.height = 1;
      return;
    }
    const ratio = Math.min(win.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(win.innerWidth * ratio);
    canvas.height = Math.floor(win.innerHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const park = (value) => {
    if (parked === value) return;
    parked = value;
    resize();
  };
  const allIdle = () => layers.size > 0 && [...layers].every((layer) => typeof layer.idle === "function" && layer.idle());

  const tick = (now) => {
    if (!running) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const started = typeof performance !== "undefined" ? performance.now() : 0;
    ctx.clearRect(0, 0, win.innerWidth, win.innerHeight);
    const size = { width: win.innerWidth, height: win.innerHeight };
    layers.forEach((layer) => layer.draw(ctx, dt, size, now));
    if (onFrameTime && typeof performance !== "undefined") onFrameTime(performance.now() - started);
    // Ruhen alle Ebenen, schläft der Loop: kein Bild je Sekunde sechzigmal für einen leeren Himmel.
    if (allIdle()) {
      running = false;
      frame = 0;
      sleep();
      return;
    }
    frame = win.requestAnimationFrame(tick);
  };

  /** Schlafen: nichts zeichnen, Speicher freigeben, in zwei Sekunden nachschauen. */
  const sleep = () => {
    last = 0;
    sleptAt = clock();
    park(true);
    idleTimer = win.setTimeout(start, IDLE_CHECK_MS);
  };

  const start = () => {
    win.clearTimeout(idleTimer);
    idleTimer = 0;
    if (running || layers.size === 0 || doc.hidden) return;
    if (sleptAt) {
      // Die Uhren der Ebenen laufen auch im Schlaf weiter (der nächste Blitz kommt, wann er kommen soll).
      const seconds = Math.max(0, (clock() - sleptAt) / 1000);
      layers.forEach((layer) => layer.slept?.(seconds));
      sleptAt = 0;
    }
    // Nachschauen kostet kein Bild: ruht noch alles (oder von Anfang an), wird weitergeschlafen.
    if (allIdle()) {
      sleep();
      return;
    }
    park(false);
    running = true;
    last = 0;
    frame = win.requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    win.clearTimeout(idleTimer);
    idleTimer = 0;
    sleptAt = 0;
    park(true);
  };
  const visibility = () => (doc.hidden ? stop() : start());
  // Aufwecken auf Zuruf (Fasching: Konfetti nach einem Klick) - sonst käme es erst beim nächsten Nachschauen.
  const wake = () => start();

  resize();
  win.addEventListener("resize", resize);
  win.addEventListener(SKY_WAKE_EVENT, wake);
  doc.addEventListener("visibilitychange", visibility);

  return {
    add(layer) {
      layers.add(layer);
      start();
      return () => {
        layers.delete(layer);
        // Mit der letzten Ebene hört der Loop auf; geparkt ist die Zeichenfläche auch leer.
        if (layers.size === 0) stop();
      };
    },
    get running() {
      return running;
    },
    /** Schläft der Loop gerade, weil alle Ebenen ruhen? */
    get sleeping() {
      return Boolean(idleTimer);
    },
    /** Hat die Zeichenfläche gerade keinen Speicher (Schlaf, versteckter Tab, keine Ebene)? */
    get parked() {
      return parked;
    },
    destroy() {
      stop();
      layers.clear();
      win.removeEventListener("resize", resize);
      win.removeEventListener(SKY_WAKE_EVENT, wake);
      doc.removeEventListener("visibilitychange", visibility);
    },
  };
}
