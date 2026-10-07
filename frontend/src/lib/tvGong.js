// Ton beim Ergebnis (#1118): ein kurzer, weicher Gong - synthetisch über die Web Audio API wie die Klänge der Erfolge,
// keine Datei. Standard aus (Fabians Wahl „ohne Ton“); nur ein Bildschirm mit „Ton beim Ergebnis“ im Link oder in den
// Grundwerten gongt. Browser spielen Ton erst nach einem Klick auf die Seite - bis dahin sagt der TV einmal klein
// „Für Ton einmal klicken“. Den Klang-Baukasten legt der TV erst nach diesem Klick an, vorher bleibt alles still.

// Der Gong aus der TV-Vorschau: C5 mit zwei leisen Obertönen, klingt in gut 2,5 Sekunden aus.
export const GONG_PARTIALS = Object.freeze([[1, 0.16], [2.01, 0.05], [2.76, 0.028]]);
export const GONG_NOTE = 523.25;
export const GONG_SECONDS = 2.6;

/** Hat jemand schon auf die Seite geklickt oder getippt? Ohne Auskunft des Browsers: nein. */
export function pageActivated(nav = typeof navigator === "undefined" ? null : navigator) {
  return Boolean(nav?.userActivation?.hasBeenActive);
}

export function createGong({ win = typeof window === "undefined" ? null : window } = {}) {
  const AudioContextClass = win ? win.AudioContext || win.webkitAudioContext : null;
  let context = null;

  function running() {
    return Boolean(context && context.state === "running");
  }

  /** Nach einem Klick: den Klang-Baukasten anlegen oder aufwecken. Gibt zurück, ob jetzt Ton möglich ist. */
  async function unlock() {
    if (!AudioContextClass) return false;
    try {
      if (!context) context = new AudioContextClass();
      if (context.state === "suspended" && typeof context.resume === "function") await context.resume();
    } catch {
      return false;
    }
    return running();
  }

  /** Einmal gongen - nur, wenn der Browser Ton erlaubt. Gibt zurück, ob ein Ton gespielt wurde. */
  function play() {
    if (!running()) return false;
    try {
      const start = context.currentTime + 0.03;
      for (const [ratio, level] of GONG_PARTIALS) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = GONG_NOTE * ratio;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(level, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + GONG_SECONDS);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + GONG_SECONDS + 0.1);
      }
      return true;
    } catch {
      return false;
    }
  }

  return {
    supported: Boolean(AudioContextClass),
    unlock,
    play,
    running,
  };
}
