import { useEffect, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { getActiveEngine, readSoundPrefs, writeSoundPrefs } from "./audio";

// Der Schalter für Saison-Klänge (#679) neben dem Widget: drei Stände im Kreis - Töne und Musik, nur Töne, aus.
// Er schreibt die Vorliebe je Gerät und sagt der laufenden Engine Bescheid; ohne Engine (noch keine Geste) merkt er
// sich den Wunsch, die Engine liest ihn beim Start.

export const SOUND_STATES = [
  { key: "all", label: "Töne und Musik an", prefs: { sounds: true, music: true }, Icon: Volume2 },
  { key: "sfx", label: "Nur Töne an, Musik aus", prefs: { sounds: true, music: false }, Icon: Volume1 },
  { key: "off", label: "Töne und Musik aus", prefs: { sounds: false, music: false }, Icon: VolumeX },
];

export function stateFor(prefs) {
  if (!prefs.sounds) return SOUND_STATES[2];
  return prefs.music ? SOUND_STATES[0] : SOUND_STATES[1];
}

export function SoundToggle() {
  const [prefs, setPrefs] = useState(() => readSoundPrefs());
  useEffect(() => {
    const engine = getActiveEngine();
    if (engine) setPrefs(engine.prefs);
  }, []);
  const current = stateFor(prefs);
  const next = SOUND_STATES[(SOUND_STATES.indexOf(current) + 1) % SOUND_STATES.length];
  const onClick = () => {
    const engine = getActiveEngine();
    if (engine) engine.setPrefs(next.prefs);
    else writeSoundPrefs(next.prefs);
    setPrefs({ ...next.prefs });
  };
  const Icon = current.Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tls-season-sound ${current.key === "off" ? "tls-season-sound--off" : ""}`}
      aria-label={`Saison-Klänge: ${current.label}. Weiter zu: ${next.label}`}
      title={`${current.label} - klicken für: ${next.label}`}
      data-testid="season-sound-toggle"
      data-state={current.key}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}
