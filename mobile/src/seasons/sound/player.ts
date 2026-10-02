import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { MEOWS, SAMPLE_RATE, encodeWav, pickMeow, renderMeow, toBase64 } from "./synth";

// Klänge der Saison-Deko in der App (#772): der Schalter „Töne“ (je Gerät, wie im Web), der Cache der vorgerechneten
// Laute und das Abspielen. Leise, nur nach einem Antippen, nie bei Lautlos oder Vibration (`playsInSilentMode: false`
// gilt auf Android und iOS) und ohne die Musik anderer Apps zu unterbrechen (`mixWithOthers`).

export const SOUND_KEY = "season_sounds";
/** Zwei Klänge nie dichter als das - wie `MIN_GAP_MS` im Web, kein Geknatter bei schnellem Tippen. */
export const MIN_GAP_MS = 150;
/** Version der Rechnung im Dateinamen: ändert sich der Laut, entsteht eine neue Datei statt der alten. */
export const SOUND_VERSION = 1;

export type SeasonSound = "cat_meow";

let soundsOn: boolean | null = null;
const listeners = new Set<(on: boolean) => void>();
const files = new Map<string, Promise<string | null>>();
let lastPlayed = -Infinity;
let audioReady: Promise<void> | null = null;

/** Sind die Töne an? Vorgabe wie im Web: an. Ohne lesbaren Speicher bleibt es bei der Vorgabe. */
export async function readSoundsOn(): Promise<boolean> {
  if (soundsOn === null) {
    try {
      soundsOn = (await SecureStore.getItemAsync(SOUND_KEY)) !== "off";
    } catch {
      soundsOn = true;
    }
  }
  return soundsOn;
}

export async function setSoundsOn(on: boolean): Promise<void> {
  soundsOn = on;
  listeners.forEach((listener) => listener(on));
  try {
    await SecureStore.setItemAsync(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Dann gilt die Wahl, bis die App neu startet.
  }
}

/** Der Schalter für die Einstellungen: aktueller Stand und Setzen. */
export function useSoundsOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(soundsOn ?? true);
  useEffect(() => {
    let alive = true;
    void readSoundsOn().then((value) => {
      if (alive) setOn(value);
    });
    listeners.add(setOn);
    return () => {
      alive = false;
      listeners.delete(setOn);
    };
  }, []);
  return [on, (value: boolean) => { void setSoundsOn(value); }];
}

/** Nur für Tests: alles vergessen. */
export function resetSounds(): void {
  soundsOn = null;
  files.clear();
  lastPlayed = -Infinity;
  audioReady = null;
}

type FileSystemLike = typeof import("expo-file-system/legacy");
type AudioLike = Pick<typeof import("expo-audio"), "createAudioPlayer" | "setAudioModeAsync">;

/**
 * Speicher und Audio erst beim ersten Laut laden - wie `installSource.ts` mit `require` statt `import()`: Metro und
 * Jest laden das Modul so gleich, und fehlt es, bleibt die Deko still statt abzustürzen.
 */
function loadModules(): { fs: FileSystemLike; audio: AudioLike } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("expo-file-system/legacy") as FileSystemLike;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio = require("expo-audio") as AudioLike;
    return fs && audio && typeof audio.createAudioPlayer === "function" ? { fs, audio } : null;
  } catch {
    return null;
  }
}

/** Die Datei eines Lauts im Cache - einmal gerechnet und geschrieben, danach nur noch abgespielt. */
function soundFile(fs: FileSystemLike, name: string, render: () => Float32Array): Promise<string | null> {
  let pending = files.get(name);
  if (!pending) {
    pending = (async () => {
      const dir = `${fs.cacheDirectory || ""}season-sounds/`;
      const uri = `${dir}${name}-v${SOUND_VERSION}.wav`;
      const info = await fs.getInfoAsync(uri);
      if (!info.exists) {
        await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
        await fs.writeAsStringAsync(uri, toBase64(encodeWav(render(), SAMPLE_RATE)), { encoding: fs.EncodingType.Base64 });
      }
      return uri;
    })().catch(() => {
      files.delete(name);
      return null;
    });
    files.set(name, pending);
  }
  return pending;
}

/**
 * Spielt einen Klang der Saison-Deko - wenn die Töne an sind und der letzte nicht eben erst lief. `true`, wenn
 * gespielt wurde. Fehler (kein Speicher, kein Audio) bleiben still: die Deko darf nie stören.
 */
export async function playSeasonSound(name: SeasonSound, { rng = Math.random, now = Date.now() }: { rng?: () => number; now?: number } = {}): Promise<boolean> {
  if (!(await readSoundsOn())) return false;
  if (now - lastPlayed < MIN_GAP_MS) return false;
  lastPlayed = now;
  const modules = loadModules();
  if (!modules) return false;
  const { fs, audio } = modules;
  try {
    let uri: string | null = null;
    let seconds = 1;
    if (name === "cat_meow") {
      const kind = pickMeow(rng());
      seconds = MEOWS[kind].seconds + 0.05;
      uri = await soundFile(fs, `meow-${kind}`, () => renderMeow(MEOWS[kind]));
    }
    if (!uri) return false;
    audioReady = audioReady || audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" }).catch(() => undefined);
    await audioReady;
    const player = audio.createAudioPlayer({ uri });
    player.play();
    // Der Spieler gibt sich nicht selbst frei - nach dem Laut aufräumen. `remove()` nimmt ihn nur aus der Liste des
    // Moduls; erst `release()` gibt ihn samt seiner Media-Session sofort frei (sonst lebt sie bis zur nächsten
    // Speicherbereinigung, und die Tasten am Kopfhörer landen so lange bei der App statt bei der Musik).
    setTimeout(() => {
      try {
        player.remove();
        player.release();
      } catch {
        // schon weg
      }
    }, seconds * 1000 + 800);
    return true;
  } catch {
    return false;
  }
}
