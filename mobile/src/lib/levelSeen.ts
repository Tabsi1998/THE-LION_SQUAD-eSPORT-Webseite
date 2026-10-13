import * as SecureStore from "expo-secure-store";
import { type LevelState, type LevelUp, levelUpFrom } from "../achievements/ceremony/select";

// Der zuletzt gesehene Level-Stand je Konto (#617, #1456). Zwei Prüfungen auf demselben Gerät (Start, Benachrichtigung,
// Prestige) können gleichzeitig laufen - dann würden beide den alten Stand lesen und denselben Aufstieg zweimal zeigen.
// Darum läuft „lesen, vergleichen, schreiben“ je Schlüssel nacheinander (Sperre im Speicher der App): die zweite
// Prüfung findet schon den neuen Stand. Bewusste Grenze: auf einem anderen Gerät (oder im Web) erscheint der Aufstieg
// dort noch einmal - der Stand liegt nur im Gerät, nicht auf dem Server.

const chains = new Map<string, Promise<unknown>>();

/** `fn` läuft erst, wenn alle früheren Aufrufe mit demselben Schlüssel fertig sind. */
export function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

/**
 * Den Aufstieg beanspruchen: gemerkten Stand lesen, mit `next` vergleichen und `next` merken - unter der Sperre.
 * `stillValid` wird vor dem Schreiben gefragt (z. B. „ist noch dasselbe Konto angemeldet?“); sagt es nein, bleibt
 * der Merker unberührt und es gibt nichts zu feiern.
 */
export function claimLevelUp(key: string, next: LevelState, stillValid: () => boolean = () => true): Promise<LevelUp | null> {
  return withKeyLock(key, async () => {
    let prev: Partial<LevelState> | null = null;
    try {
      prev = JSON.parse((await SecureStore.getItemAsync(key)) || "null");
    } catch {
      prev = null;
    }
    if (!stillValid()) return null;
    const levelUp = levelUpFrom(prev, next);
    await SecureStore.setItemAsync(key, JSON.stringify(next));
    return levelUp;
  });
}
