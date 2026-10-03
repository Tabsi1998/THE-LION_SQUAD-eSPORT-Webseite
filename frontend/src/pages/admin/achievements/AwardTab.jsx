import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Award, History, ListChecks, Undo2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { CheckField, INPUT_CLASS, SelectField, TextAreaField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { ROLE_LABELS } from "@/lib/permissions";
import { BoardOnly, EVENT_KINDS, FilePick, MaterialChip, Panel, PersonPicker, TierSelect, errorText, formatWhen, materialLabel, personName, useCatalog } from "./shared";

/** Namen aus einer CSV- oder Textliste: je Zeile die erste Zelle; eine Kopfzeile wird übersprungen. */
export function parseNames(text) {
  const header = new Set(["name", "username", "benutzername", "email", "e-mail", "mail", "konto"]);
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const cell = line.split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, "")).find(Boolean);
    if (!cell || header.has(cell.toLowerCase())) continue;
    if (!out.includes(cell)) out.push(cell);
  }
  return out;
}

/** „2026-09-01T18:00“ (Eingabefeld, Ortszeit) → ISO mit Zeitzone; leer bleibt leer. */
export function toIso(local) {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Die Optionen jeder Vergabe: Grund, Datum (wahlweise rückwirkend), ohne Zeremonie, Benachrichtigung. */
function AwardOptions({ value, onChange, testPrefix }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  return (
    <div className="space-y-2">
      <TextAreaField label="Grund (steht im Protokoll)" rows={2} value={value.note} onChange={(v) => set("note", v)} testId={`${testPrefix}-note`} placeholder="z. B. LAN-Party Herbst 2026" />
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Datum (leer = jetzt, sonst rückwirkend)</span>
        <input type="datetime-local" max={nowLocal()} value={value.when} onChange={(e) => set("when", e.target.value)} data-testid={`${testPrefix}-date`} className={`${INPUT_CLASS} mt-1`} />
      </label>
      <CheckField label="Ohne Zeremonie – zählt, wird aber nicht gefeiert" checked={value.silent} onChange={(v) => set("silent", v)} testId={`${testPrefix}-silent`} accent="#FFD700" />
      <CheckField label="Benachrichtigung schicken (Postfach, Push, Discord)" checked={value.notify} onChange={(v) => set("notify", v)} testId={`${testPrefix}-notify`} accent="#29B6E8" />
    </div>
  );
}

const EMPTY_OPTIONS = { note: "", when: "", silent: false, notify: true };

/** Vergeben (E10): Einzelvergabe, Rücknahme mit Grund, Massenvergabe mit Vorschau, Protokoll. */
export function AwardTab({ board = false }) {
  const catalog = useCatalog();
  const [person, setPerson] = useState(null);
  const [protocolTick, setProtocolTick] = useState(0);
  const changed = () => setProtocolTick((n) => n + 1);
  return (
    <div className="space-y-6" data-testid="ach-award">
      <div className="grid lg:grid-cols-2 gap-6">
        <SingleAward catalog={catalog} person={person} setPerson={setPerson} onDone={changed} />
        <PersonAwards person={person} tick={protocolTick} onDone={changed} />
      </div>
      <BulkAward catalog={catalog} board={board} onDone={changed} />
      <Protocol person={person} tick={protocolTick} />
    </div>
  );
}

function SingleAward({ catalog, person, setPerson, onDone }) {
  const [tierCode, setTierCode] = useState("");
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [busy, setBusy] = useState(false);
  const tier = catalog.tiers.find((t) => t.code === tierCode);

  const award = async () => {
    if (!person || !tierCode) return;
    if (tier?.member_only && !person.is_club_member) {
      toast.error("Diese Stufe ist nur für aktive Vereinsmitglieder.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/admin/achievements/award", { user_id: person.id, tier_code: tierCode, note: options.note || null, earned_at: toIso(options.when), silent: options.silent, notify: options.notify });
      if (data.already_awarded) toast.info(`${personName(person)} hat diese Stufe schon.`);
      else toast.success(`Vergeben an ${personName(person)}`);
      setOptions(EMPTY_OPTIONS);
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Einzelvergabe" icon={Award} testId="award-single">
      <div className="space-y-3">
        <PersonPicker value={person} onChange={setPerson} testId="award-person" />
        <TierSelect tiers={catalog.tiers} groupsByCode={catalog.groupsByCode} value={tierCode} onChange={setTierCode} testId="award-tier-select" filter={(t, g) => !g.is_negative} />
        {tier?.member_only && (
          <p className="border border-[#FFD700]/30 bg-[#FFD700]/10 px-3 py-2 text-xs text-white/70">Nur für aktive oder Ehren-Mitglieder.</p>
        )}
        <AwardOptions value={options} onChange={setOptions} testPrefix="award" />
        <button type="button" onClick={award} disabled={busy || !person || !tierCode} data-testid="award-submit" className="w-full px-4 py-3 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center justify-center gap-2 disabled:opacity-40">
          <Award className="w-4 h-4" /> {busy ? "Vergebe …" : "Vergeben"}
        </button>
      </div>
    </Panel>
  );
}

function PersonAwards({ person, tick, onDone }) {
  const [rows, setRows] = useState([]);
  const [revoking, setRevoking] = useState(null);
  const [reason, setReason] = useState("");
  const load = useCallback(() => {
    if (!person) { setRows([]); return; }
    api.get(`/admin/achievements/users/${person.id}/awards`).then(({ data }) => setRows(Array.isArray(data) ? data : [])).catch(() => setRows([]));
  }, [person]);
  useEffect(() => { load(); }, [load, tick]);

  const revoke = async (row) => {
    if (reason.trim().length < 3) { toast.error("Bitte einen Grund angeben."); return; }
    try {
      await api.delete("/admin/achievements/award", { data: { user_id: person.id, tier_code: row.tier_code, note: reason.trim() } });
      toast.success("Zurückgenommen");
      setRevoking(null);
      setReason("");
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <Panel title="Erfolge der Person · Rücknahme" icon={Undo2} accent="#FF3B30" hint={person ? `${rows.length} Erfolg${rows.length === 1 ? "" : "e"} von ${personName(person)}` : "Links eine Person wählen."} testId="award-person-list">
      <ul className="divide-y divide-white/5 max-h-[28rem] overflow-y-auto">
        {rows.map((row) => (
          <li key={row.tier_code} className="py-2" data-testid={`person-award-${row.tier_code}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{row.tier_name} <MaterialChip tier={row} className="ml-1" /></div>
                <div className="text-[11px] text-white/45">{row.group_name} · {formatWhen(row.earned_at)}{row.silent ? " · still" : ""}{row.is_negative ? " · negativ" : ""}{row.note ? ` · „${row.note}“` : ""}</div>
              </div>
              {revoking !== row.tier_code && (
                <button type="button" onClick={() => { setRevoking(row.tier_code); setReason(""); }} data-testid={`revoke-${row.tier_code}`} className="text-[#FF3B30] hover:underline text-xs shrink-0">Zurücknehmen</button>
              )}
            </div>
            {revoking === row.tier_code && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund der Rücknahme" aria-label="Grund der Rücknahme" data-testid={`revoke-reason-${row.tier_code}`} className={`${INPUT_CLASS} flex-1 min-w-[12rem]`} />
                <button type="button" onClick={() => revoke(row)} data-testid={`revoke-confirm-${row.tier_code}`} className="px-3 py-2 bg-[#FF3B30] text-white text-[10px] font-bold uppercase tracking-widest rounded-sm">Zurücknehmen</button>
                <button type="button" onClick={() => setRevoking(null)} className="text-[10px] uppercase tracking-widest text-white/50">Abbrechen</button>
              </div>
            )}
          </li>
        ))}
        {person && !rows.length && <li className="py-6 text-center text-xs text-white/40">Noch keine Erfolge.</li>}
      </ul>
    </Panel>
  );
}

const STATE_LABELS = { new: ["bekommt es", "#00FF88"], already: ["hat es schon", "rgba(255,255,255,0.45)"], skipped: ["darf nicht (nur Mitglieder)", "#FF3B30"] };

function BulkAward({ catalog, board, onDone }) {
  const [tierCode, setTierCode] = useState("");
  const [namesText, setNamesText] = useState("");
  const [sources, setSources] = useState({ tournament_id: "", event_id: "", team_id: "", role: "", members: false });
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [lists, setLists] = useState({ tournaments: [], events: [], teams: [] });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const names = useMemo(() => parseNames(namesText), [namesText]);

  useEffect(() => {
    if (!board) return;
    Promise.allSettled([api.get("/tournaments?include_drafts=true"), api.get("/events?include_drafts=true"), api.get("/teams")]).then(([t, e, m]) => {
      const list = (r) => (r.status === "fulfilled" && Array.isArray(r.value.data) ? r.value.data : []);
      setLists({ tournaments: list(t), events: list(e), teams: list(m) });
    });
  }, [board]);

  const body = (dryRun) => ({
    tier_code: tierCode, names, ...Object.fromEntries(Object.entries(sources).filter(([, v]) => v)),
    note: options.note || null, earned_at: toIso(options.when), silent: options.silent, notify: options.notify, dry_run: dryRun,
  });
  const hasSource = names.length || Object.values(sources).some(Boolean);
  const update = (setter) => (value) => { setter(value); setPreview(null); };

  const runPreview = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/achievements/award/bulk", body(true));
      setPreview(data);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    const tier = catalog.tiers.find((t) => t.code === tierCode);
    if (!await confirm({ title: "Massenvergabe starten?", description: `${preview.would_award} Person${preview.would_award === 1 ? "" : "en"} bekommen „${tier?.name || "die Stufe"}“ (${materialLabel(tier)}).`, confirmLabel: "Vergeben" })) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/achievements/award/bulk", body(false));
      toast.success(`${data.awarded} vergeben${data.already ? ` · ${data.already} hatten es schon` : ""}${data.skipped ? ` · ${data.skipped} übersprungen` : ""}`);
      setPreview(null);
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    update(setNamesText)(await file.text());
  };

  return (
    <Panel title="Massenvergabe" icon={Users} accent="#29B6E8" hint="Bis zu 500 Personen auf einmal – aus einer Liste (CSV) oder nach Turnier, Event, Team, Mitgliedschaft oder Rolle. Erst die Vorschau, dann vergeben." testId="award-bulk">
      <BoardOnly board={board} what="Massenvergaben">
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <TierSelect tiers={catalog.tiers} groupsByCode={catalog.groupsByCode} value={tierCode} onChange={update(setTierCode)} testId="bulk-tier-select" filter={(t, g) => !g.is_negative} />
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Liste: Benutzername, E-Mail oder Konto je Zeile</span>
              <textarea rows={4} value={namesText} onChange={(e) => update(setNamesText)(e.target.value)} data-testid="bulk-names" placeholder={"paula\nmax@example.com"} className={`${INPUT_CLASS} mt-1 font-mono text-xs`} />
            </label>
            <div className="flex items-center justify-between gap-2 text-[11px] text-white/45">
              <FilePick label="CSV-Datei wählen" accept=".csv,.txt,text/csv,text/plain" onFile={onFile} testId="bulk-file" />
              <span data-testid="bulk-name-count">{names.length} Namen</span>
            </div>
            <SelectField label="Turnier (angenommen oder eingecheckt)" value={sources.tournament_id} onChange={(v) => update(setSources)({ ...sources, tournament_id: v })} options={[["", "—"], ...lists.tournaments.map((t) => [t.id, t.name || t.title || t.slug])]} testId="bulk-tournament" />
            <SelectField label="Event (angemeldet oder eingecheckt)" value={sources.event_id} onChange={(v) => update(setSources)({ ...sources, event_id: v })} options={[["", "—"], ...lists.events.map((e) => [e.id, e.name || e.title || e.slug])]} testId="bulk-event" />
            <SelectField label="Team" value={sources.team_id} onChange={(v) => update(setSources)({ ...sources, team_id: v })} options={[["", "—"], ...lists.teams.map((t) => [t.id, t.name])]} testId="bulk-team" />
            <SelectField label="Rolle" value={sources.role} onChange={(v) => update(setSources)({ ...sources, role: v })} options={[["", "—"], ...Object.entries(ROLE_LABELS)]} testId="bulk-role" />
            <CheckField label="Alle aktiven Mitglieder (auch Ehrenmitglieder)" checked={sources.members} onChange={(v) => update(setSources)({ ...sources, members: v })} testId="bulk-members" accent="#FFD700" />
          </div>
          <div className="space-y-3">
            <AwardOptions value={options} onChange={setOptions} testPrefix="bulk" />
            <button type="button" onClick={runPreview} disabled={busy || !tierCode || !hasSource} data-testid="bulk-preview" className="w-full px-4 py-2.5 border border-[#29B6E8]/60 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center justify-center gap-2 disabled:opacity-40">
              <ListChecks className="w-4 h-4" /> Vorschau
            </button>
            {preview && (
              <div className="border border-white/10 rounded-sm p-3 text-xs space-y-2" data-testid="bulk-result">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-[#00FF88]" data-testid="bulk-would">{preview.would_award} bekommen es</span>
                  <span className="text-white/55">{preview.already} haben es schon</span>
                  {preview.skipped > 0 && <span className="text-[#FF3B30]">{preview.skipped} dürfen nicht</span>}
                  {preview.unknown?.length > 0 && <span className="text-[#FFD700]" data-testid="bulk-unknown">{preview.unknown.length} nicht gefunden</span>}
                </div>
                {preview.unknown?.length > 0 && <div className="text-[#FFD700]/80 break-words">Nicht gefunden: {preview.unknown.join(", ")}</div>}
                <ul className="max-h-48 overflow-y-auto divide-y divide-white/5">
                  {(preview.people || []).map((p) => (
                    <li key={p.id} className="py-1 flex justify-between gap-2">
                      <span className="truncate">{personName(p)} <span className="text-white/35">@{p.username}</span></span>
                      <span style={{ color: STATE_LABELS[p.state]?.[1] }}>{STATE_LABELS[p.state]?.[0]}</span>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={run} disabled={busy || !preview.would_award} data-testid="bulk-submit" className="w-full px-4 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">
                  {busy ? "Vergebe …" : `An ${preview.would_award} Person${preview.would_award === 1 ? "" : "en"} vergeben`}
                </button>
              </div>
            )}
          </div>
        </div>
      </BoardOnly>
    </Panel>
  );
}

function eventDetails(e) {
  const d = e.data || {};
  const parts = [];
  if (e.kind === "bulk_award") parts.push(`${d.awarded ?? 0} vergeben`, d.already ? `${d.already} hatten es` : "", d.skipped ? `${d.skipped} übersprungen` : "");
  if (e.kind === "xp" && d.amount) parts.push(`${d.amount > 0 ? "+" : ""}${d.amount} XP`);
  if (e.kind === "prestige_reset") parts.push(`${d.stars_before ?? 0} Sterne vorher`);
  if (e.kind === "season_award") parts.push(`${d.awarded ?? 0} Erfolge · ${d.ranked ?? 0} Plätze`);
  if (e.kind === "import") parts.push(`${d.groups ?? 0} Gruppen · ${d.tiers ?? 0} Stufen`);
  if (e.kind === "evaluate_all") parts.push(`${d.queued ?? 0} vorgemerkt`);
  if (["group_create", "group_update", "group_delete", "tier_delete"].includes(e.kind) && d.name) parts.push(d.name);
  if (d.awards_removed) parts.push(`${d.awards_removed} Vergaben entfernt`);
  if (d.silent) parts.push("still");
  if (d.notify === false) parts.push("ohne Benachrichtigung");
  if (d.earned_at) parts.push(`rückwirkend ${formatWhen(d.earned_at, false)}`);
  return parts.filter(Boolean).join(" · ");
}

function Protocol({ person, tick }) {
  const [kind, setKind] = useState("");
  const [onlyPerson, setOnlyPerson] = useState(false);
  const [rows, setRows] = useState([]);
  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: "200" });
    if (kind) params.set("kind", kind);
    if (onlyPerson && person) params.set("user_id", person.id);
    api.get(`/admin/achievements/events?${params}`).then(({ data }) => setRows(Array.isArray(data) ? data : [])).catch(() => setRows([]));
  }, [kind, onlyPerson, person]);
  useEffect(() => { load(); }, [load, tick]);
  useApiInvalidation(load, ["achievements"]);

  return (
    <Panel
      title="Protokoll"
      icon={History}
      accent="#A855F7"
      hint="Jede Aktion im Erfolge-Admin – wer, für wen, warum."
      actions={(
        <>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Art" data-testid="protocol-kind" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs text-white/80">
            <option value="">Alle Arten</option>
            {Object.entries(EVENT_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          {person && (
            <label className="text-[11px] text-white/60 inline-flex items-center gap-1.5">
              <input type="checkbox" checked={onlyPerson} onChange={(e) => setOnlyPerson(e.target.checked)} data-testid="protocol-only-person" /> nur {personName(person)}
            </label>
          )}
        </>
      )}
      testId="award-protocol"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="text-[10px] uppercase tracking-widest text-white/45">
            <tr>
              <th className="text-left py-2 pr-3">Wann</th>
              <th className="text-left py-2 pr-3">Was</th>
              <th className="text-left py-2 pr-3">Person</th>
              <th className="text-left py-2 pr-3">Stufe</th>
              <th className="text-left py-2 pr-3">Admin</th>
              <th className="text-left py-2">Grund · Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((e) => (
              <tr key={e.id} data-testid={`protocol-row-${e.kind}`}>
                <td className="py-2 pr-3 whitespace-nowrap text-white/50">{formatWhen(e.at)}</td>
                <td className="py-2 pr-3 whitespace-nowrap font-semibold">{EVENT_KINDS[e.kind] || e.kind}</td>
                <td className="py-2 pr-3">{e.user_id ? personName(e) : e.kind === "bulk_award" ? `${e.data?.awarded ?? 0} Personen` : "–"}</td>
                <td className="py-2 pr-3">{e.tier_name ? <>{e.tier_name} {e.material && <MaterialChip tier={e} className="ml-1" />}</> : "–"}</td>
                <td className="py-2 pr-3 text-white/60">{e.actor_name || "–"}</td>
                <td className="py-2 text-white/70">{[e.note && `„${e.note}“`, eventDetails(e)].filter(Boolean).join(" · ") || "–"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="6" className="py-6 text-center text-white/40">Noch nichts im Protokoll.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
