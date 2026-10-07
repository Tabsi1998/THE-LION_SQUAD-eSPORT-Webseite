import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Save, Tv } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { formatBracketSection, formatRoundName } from "@/lib/tournamentLabels";
import { asInstant, viennaDay, viennaTime } from "@/lib/vienna";

// Was nur ein Turnier am Bildschirm betrifft (Meilenstein 60) - beim Turnier, nicht unter TV & Beamer:
// - „Pause bis“ (#1123): beim Status „Pausiert“ eine Uhrzeit; der TV zählt bis „Weiter um 14:30“ herunter. Ohne Uhrzeit
//   steht „Kurze Pause“. Beim Weiterspielen fällt die Uhrzeit von selbst weg.
// - Sponsor je Runde (#1125): „Runde 2 präsentiert von“ - nur Sponsoren mit dem Haken „TV / Anzeige“.

const INPUT = "bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm";

/** „14:30“ als Zeitpunkt: heute in Wien, liegt es schon zurück, morgen. */
export function pauseUntilFromClock(clock, now = Date.now()) {
  if (!/^\d{2}:\d{2}$/.test(String(clock || ""))) return null;
  const today = asInstant(`${viennaDay(now)}T${clock}`);
  if (today.getTime() > now) return today.toISOString();
  const tomorrow = viennaDay(now + 24 * 60 * 60 * 1000);
  return asInstant(`${tomorrow}T${clock}`).toISOString();
}

/** „Pause bis“ für die Turnierleitung - nur beim Status „Pausiert“. */
export function PauseUntilControl({ tournament, onSaved }) {
  const current = tournament?.paused_until ? viennaTime(tournament.paused_until, { hour: "2-digit", minute: "2-digit" }) : "";
  const [clock, setClock] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => setClock(current), [current]);
  if (tournament?.status !== "paused") return null;
  const save = async (value) => {
    setBusy(true);
    try {
      await api.put(`/tournaments/${tournament.id}/pause`, { paused_until: value });
      toast.success(value ? `Pause bis ${viennaTime(value, { hour: "2-digit", minute: "2-digit" })} – der TV zählt herunter.` : "Kurze Pause ohne Uhrzeit.");
      onSaved?.();
    } catch (error) {
      toast.error(formatRequestError(error, "„Pause bis“ konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm px-3 py-2" data-testid="admin-tr-pause-until">
      <Clock className="w-4 h-4 text-[#FFD700]" />
      <label className="text-xs font-bold uppercase tracking-wider text-white/70" htmlFor="pause-until-clock">Pause bis</label>
      <input id="pause-until-clock" type="time" value={clock} onChange={(event) => setClock(event.target.value)} className={`${INPUT} py-1`} data-testid="admin-tr-pause-until-input" />
      <button type="button" disabled={busy || !clock} onClick={() => save(pauseUntilFromClock(clock))} className="px-3 py-1.5 bg-[#FFD700] text-black rounded-sm text-[11px] uppercase tracking-wider font-bold disabled:opacity-40" data-testid="admin-tr-pause-until-save">Speichern</button>
      <button type="button" disabled={busy || !tournament.paused_until} onClick={() => save(null)} className="px-3 py-1.5 border border-white/15 text-white/70 rounded-sm text-[11px] uppercase tracking-wider font-bold disabled:opacity-40" data-testid="admin-tr-pause-until-clear">Ohne Uhrzeit</button>
      <span className="text-[11px] text-white/45">Der TV zeigt „Weiter um …“ mit Countdown. Beim Weiterspielen fällt die Uhrzeit weg.</span>
    </div>
  );
}

const SECTION_ORDER = { WB: 0, LB: 1, BRONZE: 2, GF: 3 };

function roundsOf(matches = [], stages = []) {
  const stageById = new Map((stages || []).map((stage) => [stage.id, stage]));
  const byKey = new Map();
  for (const match of matches || []) {
    if (!match?.round) continue;
    const key = `${match.stage_id || ""}::${String(match.section || "").toUpperCase()}::${Number(match.round)}`;
    if (!byKey.has(key)) byKey.set(key, match);
  }
  const multipleStages = new Set([...byKey.values()].map((match) => match.stage_id || "")).size > 1;
  return [...byKey.entries()]
    .map(([key, match]) => {
      const stage = stageById.get(match.stage_id);
      const section = match.section ? formatBracketSection(match.section) : "";
      const name = formatRoundName(match.round_name, match.round);
      const label = [multipleStages ? stage?.name : "", section && !name.toLowerCase().includes(section.toLowerCase().split(" ")[0]) ? section : "", name].filter(Boolean).join(" · ");
      return { key, stageId: match.stage_id || null, section: match.section ? String(match.section).toUpperCase() : null, round: Number(match.round), label, order: [Number(match.stage_number || stage?.number || 0), SECTION_ORDER[String(match.section || "").toUpperCase()] ?? 9, Number(match.round)] };
    })
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]);
}

/** Je Runde ein Sponsor für „präsentiert von“ - eine Liste, gespeichert mit einem Klick. */
export function RoundSponsorsPanel({ tournament, matches = [], stages = [], onSaved }) {
  const rounds = useMemo(() => roundsOf(matches, stages), [matches, stages]);
  const [sponsors, setSponsors] = useState(null);
  const initial = useMemo(() => {
    const map = {};
    for (const row of tournament?.round_sponsors || []) {
      const key = `${row.stage_id || ""}::${String(row.section || "").toUpperCase()}::${Number(row.round)}`;
      map[key] = row.sponsor_id;
    }
    return map;
  }, [tournament?.round_sponsors]);
  const [choice, setChoice] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setChoice(initial), [initial]);
  useEffect(() => {
    let active = true;
    api.get("/sponsors?placement=tv")
      .then(({ data }) => { if (active) setSponsors(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setSponsors([]); });
    return () => {
      active = false;
    };
  }, []);
  if (!rounds.length) return null;
  const sorted = (map) => JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  const dirty = sorted(choice) !== sorted(initial);
  const save = async () => {
    setBusy(true);
    try {
      const items = rounds.filter((round) => choice[round.key]).map((round) => ({ stage_id: round.stageId, section: round.section, round: round.round, sponsor_id: choice[round.key] }));
      await api.put(`/tournaments/${tournament.id}/round-sponsors`, { items });
      toast.success(items.length ? "Gespeichert – solange die Runde läuft, steht ihr Sponsor oben am TV." : "Keine Runde hat mehr einen Sponsor.");
      onSaved?.();
    } catch (error) {
      toast.error(formatRequestError(error, "Die Sponsoren je Runde konnten nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-4 border border-white/10 bg-[#0F0F0F] rounded-sm p-4" data-testid="admin-tr-round-sponsors">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-sm font-black uppercase inline-flex items-center gap-2"><Tv className="w-4 h-4 text-[#29B6E8]" /> Runde präsentiert von</h3>
          <p className="mt-1 text-xs text-white/50 max-w-2xl">Wählst du für eine Runde einen Sponsor, steht am Turnierbaum-TV oben „Runde 2 präsentiert von“ mit Logo – solange diese Runde läuft. Ob das überhaupt läuft, steht unter <Link to="/admin/tv" className="text-[#29B6E8] hover:underline">TV &amp; Beamer</Link>.</p>
        </div>
        <button type="button" onClick={save} disabled={busy || !dirty} className="inline-flex items-center gap-2 px-3 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-40" data-testid="admin-tr-round-sponsors-save">
          <Save className="w-3.5 h-3.5" /> Speichern
        </button>
      </div>
      {sponsors && !sponsors.length ? (
        <p className="mt-3 text-xs text-[#FFD700]" data-testid="admin-tr-round-sponsors-none">Noch kein Sponsor mit „TV / Anzeige“. Unter Sponsoren bei einem Sponsor den Haken „TV / Anzeige“ setzen.</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rounds.map((round) => (
            <label key={round.key} className="block" data-testid={`admin-tr-round-sponsor-${round.key}`}>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">{round.label}</div>
              <select value={choice[round.key] || ""} onChange={(event) => setChoice((current) => {
                const next = { ...current };
                if (event.target.value) next[round.key] = event.target.value;
                else delete next[round.key];
                return next;
              })} className={`w-full ${INPUT}`} disabled={!sponsors}>
                <option value="">Kein Sponsor</option>
                {(sponsors || []).map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
