import { useEffect, useState } from "react";
import { useSeason } from "@/seasons/SeasonContext";
import { DECO_OPTIONS } from "@/seasons/DecoSwitch";
import { SOUND_STATES, stateFor } from "@/seasons/SoundToggle";
import { getActiveEngine, readSoundPrefs, writeSoundPrefs } from "@/seasons/audio";

// Darstellung (#1146): Saison-Deko und Töne - dieselbe Gruppe wie in der App. Angemeldet gilt die Deko fürs Konto (auch
// in der App); die Töne gelten je Gerät. Der Schalter im Footer bleibt nur für Gäste.

const LABELS = { on: "An", subtle: "Dezent", off: "Aus" };

function Choice({ options, value, onChange, testId }) {
  return (
    <div className="inline-flex flex-wrap gap-2" role="group" data-testid={testId}>
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          data-testid={`${testId}-${key}`}
          className={`min-h-11 px-4 py-2 rounded-sm border text-xs font-bold uppercase tracking-wider transition ${value === key ? "border-[#29B6E8]/60 bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/10 bg-[#121212] text-white/60 hover:text-white hover:border-white/25"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function AppearanceTab() {
  const { preference, setPreference, seasons } = useSeason();
  const running = (seasons || []).map((season) => season.label).filter(Boolean).join(", ");
  const [sound, setSound] = useState(() => stateFor(readSoundPrefs()).key);
  useEffect(() => {
    const engine = getActiveEngine();
    if (engine) setSound(stateFor(engine.prefs).key);
  }, []);
  const changeSound = (key) => {
    const state = SOUND_STATES.find((item) => item.key === key) || SOUND_STATES[0];
    const engine = getActiveEngine();
    if (engine) engine.setPrefs(state.prefs);
    else writeSoundPrefs(state.prefs);
    setSound(state.key);
  };
  return (
    <div className="space-y-5" data-testid="settings-appearance">
      <section className="border border-white/10 rounded-sm bg-[#0A0A0A] p-5 space-y-3">
        <h2 className="font-heading font-black uppercase">Saisonale Deko</h2>
        <p className="text-sm text-white/60">
          {running ? `Gerade läuft: ${running}.` : "Halloween, Advent, Silvester, Fasching und Ostern schmücken Website und App zur passenden Zeit."}
          {" "}Die Wahl gilt für dein Konto – auch in der App.
        </p>
        <Choice options={DECO_OPTIONS.map(([key]) => [key, LABELS[key]])} value={preference} onChange={(value) => setPreference(value)} testId="settings-deco" />
      </section>
      <section className="border border-white/10 rounded-sm bg-[#0A0A0A] p-5 space-y-3">
        <h2 className="font-heading font-black uppercase">Töne</h2>
        <p className="text-sm text-white/60">Klänge der Saison-Deko, erst nach einem Klick und leise. Gilt für diesen Browser.</p>
        <Choice options={[["all", "Töne und Musik"], ["sfx", "Nur Töne"], ["off", "Aus"]]} value={sound} onChange={changeSound} testId="settings-sound" />
      </section>
    </div>
  );
}
