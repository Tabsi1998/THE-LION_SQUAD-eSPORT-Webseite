// Ton ist Beiwerk (#2080): Saison-Klänge, Zeremonie, TV-Gong. Hat das Gerät keinen Ausgang oder verweigert der Browser
// den Ton (NotAllowedError, „Failed to start the audio device“, kein AudioContext), bleibt es still - ohne Ausnahme,
// ohne unbehandelte Ablehnung und damit ohne „Fehler“ in den App-Logs. Höchstens ein Debug-Hinweis je Sitzung.

const HINT_KEY = "tls-audio-hint";
const AUDIO_PROBLEM = /audio device|AudioContext|play\(\) (?:failed|request)|not allowed to start/i;

let hinted = false;

/** Eine Meldung, die vom Ton kommt - der Fehler-Reporter lässt sie weg. */
export function isAudioProblem(error) {
  if (!error) return false;
  return AUDIO_PROBLEM.test(String(error.message || error));
}

/** Einmal je Sitzung leise in die Konsole, sonst nichts. */
export function noteAudioProblem(error) {
  if (hinted) return;
  hinted = true;
  try {
    if (window.sessionStorage.getItem(HINT_KEY)) return;
    window.sessionStorage.setItem(HINT_KEY, "1");
  } catch {
    // ohne Speicher bleibt es bei einem Hinweis je Seitenleben
  }
  // eslint-disable-next-line no-console
  console.debug("[Ton] nicht verfügbar – es bleibt still:", error?.message || error);
}

/** Ein Ergebnis, das ein Promise sein kann (resume, suspend, close, play): eine Ablehnung bleibt still. */
export function quietly(result) {
  if (result && typeof result.then === "function") result.then(undefined, noteAudioProblem);
  return result;
}

/** Eine Ton-Aktion ausführen: wirft sie oder lehnt sie ab, bleibt es still und `fallback` kommt zurück. */
export function attemptAudio(action, fallback = undefined) {
  try {
    return quietly(action());
  } catch (error) {
    noteAudioProblem(error);
    return fallback;
  }
}
