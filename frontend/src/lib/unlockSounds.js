// Verträglichkeit (E8, #618): die Klänge leben jetzt in components/achievements/ceremony/sounds.js
// (neun Material-Sets, sieben Sonderabläufe). Diese Hülle bleibt für alte Aufrufer.
import { playCeremonySound, readSoundPrefs, writeSoundPrefs } from "@/components/achievements/ceremony/sounds";
import { materialForLevel } from "@/components/achievements/materials";

export function isSoundMuted() {
  return readSoundPrefs().muted;
}

export function setSoundMuted(muted) {
  writeSoundPrefs({ muted: Boolean(muted) });
}

export function playUnlockSound(level = 1) {
  return playCeremonySound({ material: materialForLevel(level) });
}
