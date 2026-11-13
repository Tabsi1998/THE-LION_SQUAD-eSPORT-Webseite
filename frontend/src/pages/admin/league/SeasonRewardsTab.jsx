// Reiter „Belohnungen“ der Season-Seite (F.4, #2214, docs/LIGA.md „F.4 Belohnungen“): Banner, Emblem, Medaille und Titel je Platz,
// Platzbereich oder für alle Teilnehmer, an Team und/oder Spieler. Jede Liga N übernimmt die Belohnungen der Season oder bekommt eine
// eigene Zusammenstellung. Vergeben wird beim Abschluss einer Staffel (Reiter „Abschluss“) - eine Änderung hier wirkt erst beim nächsten
// Abschluss. Eigenes Laden und Speichern; bearbeiten darf „Season konfigurieren“, lesen jede Zuständigkeit.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Gift, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FormSection } from "@/components/tls/AdminForm";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { TextField } from "@/components/tls/FormFields";
import { RewardArt } from "@/components/tls/rewards/RewardArt";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api, formatApiError } from "@/lib/api";
import { rulesMediaProps } from "@/lib/leagueRules";
import {
  PLACE_MODES, PLAYER_BASIS, REWARD_KINDS, REWARD_LIMIT, NAME_MAX, emptyReward, listProblem, metalOf, placeLabel,
  rewardPayload, rewardProblem, rewardToForm,
  rosterFallbackText,
} from "@/lib/leagueRewards";

const BUTTON = "tls-btn inline-flex min-h-11 items-center gap-1.5 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const SMALL = "tls-btn tls-btn--quiet inline-flex min-h-9 items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider";
const SELECT = "min-h-11 w-full rounded-sm border border-white/15 bg-[#0A0A0A] px-3 text-sm text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";

/** Der Zustand des Formulars aus der Antwort des Servers. */
export function rewardsToForm(body) {
  return {
    reward_players: body?.reward_players || "fielded",
    items: (body?.items || []).map(rewardToForm),
    divisions: Object.fromEntries((body?.divisions || []).map((row) => [row.id, row.own ? row.items.map(rewardToForm) : null])),
  };
}

/** Was an PUT /rewards geht. */
export function rewardsPayload(form) {
  return {
    reward_players: form.reward_players,
    items: form.items.map(rewardPayload),
    divisions: Object.fromEntries(Object.entries(form.divisions).map(([key, rows]) => [key, rows === null ? null : rows.map(rewardPayload)])),
  };
}

function RewardRow({ item, index, onChange, onRemove, readOnly, testId, media }) {
  const set = (key, value) => onChange({ ...item, [key]: value });
  const setPlaces = (patch) => set("places", { ...item.places, ...patch });
  const toggle = (who) => set("recipients", item.recipients.includes(who) ? item.recipients.filter((value) => value !== who) : [...item.recipients, who]);
  const problem = rewardProblem(item);
  const preview = { ...item, art: { place: placeLabel(item.places), metal: metalOf(item.places), season: "Season", division: "Liga N" } };
  return (
    <li className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`${testId}-row-${index}`}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex shrink-0 justify-center sm:block">
          <RewardArt reward={preview} size="md" testId={`${testId}-preview-${index}`} />
        </div>
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-2">
          <label className="block text-[11px] font-bold uppercase tracking-widest text-white/60">
            Art
            <select value={item.kind} disabled={readOnly} onChange={(event) => set("kind", event.target.value)} className={`${SELECT} mt-1`} data-testid={`${testId}-kind-${index}`}>
              {REWARD_KINDS.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
            </select>
          </label>
          <TextField label="Name" value={item.name} maxLength={NAME_MAX} disabled={readOnly} onChange={(value) => set("name", value)}
            placeholder="z. B. Goldmedaille Season 1" testId={`${testId}-name-${index}`} />
          <fieldset className="min-w-0">
            <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Für wen</legend>
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <select value={item.places.mode} disabled={readOnly} aria-label="Platz, Platzbereich oder alle"
                onChange={(event) => set("places", event.target.value === "rank" ? { mode: "rank", rank: 1 } : event.target.value === "range" ? { mode: "range", from: 4, to: 6 } : { mode: "all" })}
                className={`${SELECT} w-auto min-w-[10rem] flex-1`} data-testid={`${testId}-mode-${index}`}>
                {PLACE_MODES.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
              </select>
              {item.places.mode === "rank" ? (
                <TextField label="Platz" type="number" min={1} max={99} value={item.places.rank} disabled={readOnly} className="w-24"
                  onChange={(value) => setPlaces({ rank: value })} testId={`${testId}-rank-${index}`} />
              ) : null}
              {item.places.mode === "range" ? (
                <>
                  <TextField label="von" type="number" min={1} max={99} value={item.places.from} disabled={readOnly} className="w-20"
                    onChange={(value) => setPlaces({ from: value })} testId={`${testId}-from-${index}`} />
                  <TextField label="bis" type="number" min={1} max={99} value={item.places.to} disabled={readOnly} className="w-20"
                    onChange={(value) => setPlaces({ to: value })} testId={`${testId}-to-${index}`} />
                </>
              ) : null}
            </div>
          </fieldset>
          <fieldset className="min-w-0">
            <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Bekommt</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {[["team", "Team"], ["players", "Spieler"]].map(([key, label]) => (
                <label key={key} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-white/85">
                  <input type="checkbox" checked={item.recipients.includes(key)} disabled={readOnly} onChange={() => toggle(key)}
                    className="h-4 w-4 accent-[var(--tls-cyan)]" data-testid={`${testId}-to-${key}-${index}`} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <TextField label="Beschreibung (freiwillig)" value={item.description} maxLength={200} disabled={readOnly}
            onChange={(value) => set("description", value)} testId={`${testId}-description-${index}`} />
          <TextField label="Echter Gewinn (freiwillig)" value={item.prize} maxLength={160} disabled={readOnly}
            onChange={(value) => set("prize", value)} placeholder="z. B. Gutschein – geht in „Gewinne“ zur Abholung" testId={`${testId}-prize-${index}`} />
          {readOnly ? null : (
            // Eigenes Bild nur auf Wunsch aufgeklappt - sonst bleibt jede Zeile kurz (offen, wenn schon eines gewählt ist).
            <details className="md:col-span-2 group" open={Boolean(item.image_url)} data-testid={`${testId}-image-box-${index}`}>
              <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-widest text-white/60 hover:text-white min-h-9 flex items-center">
                Eigenes Bild (freiwillig, sonst Lionsquad-Vorlage){item.image_url ? " · gewählt" : ""}
              </summary>
              <div className="mt-2">
                <ImageUpload value={item.image_url} onChange={(url) => set("image_url", url || "")} label="Bild der Belohnung"
                  testId={`${testId}-image-${index}`} variant="square" allowLibrary {...media} />
              </div>
            </details>
          )}
        </div>
        {readOnly ? null : (
          <button type="button" onClick={onRemove} aria-label={`${item.name || "Belohnung"} entfernen`} data-testid={`${testId}-remove-${index}`}
            className="tls-btn tls-btn--danger inline-flex h-11 w-11 shrink-0 items-center justify-center self-end rounded-sm sm:self-start">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {problem ? <p className="mt-2 text-xs text-warn" role="alert" data-testid={`${testId}-problem-${index}`}>{problem}</p> : null}
    </li>
  );
}

function RewardList({ items, onChange, readOnly, testId, emptyText }) {
  const media = rulesMediaProps(useAuth().user);
  return (
    <div className="space-y-3" data-testid={testId}>
      {items.length ? (
        <ul className="space-y-3">
          {items.map((item, index) => (
            <RewardRow key={item.key} item={item} index={index} readOnly={readOnly} testId={testId} media={media}
              onChange={(next) => onChange(items.map((row, at) => (at === index ? next : row)))}
              onRemove={() => onChange(items.filter((_, at) => at !== index))} />
          ))}
        </ul>
      ) : <p className="text-sm text-white/55" data-testid={`${testId}-empty`}>{emptyText}</p>}
      {readOnly || items.length >= REWARD_LIMIT ? null : (
        <button type="button" onClick={() => onChange([...items, emptyReward(items.length)])} className={SMALL} data-testid={`${testId}-add`}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Belohnung hinzufügen
        </button>
      )}
    </div>
  );
}

function StaffelState({ row }) {
  const text = !row.closed ? "Noch nicht abgeschlossen"
    : row.suspended ? "Ruht – Staffel wieder geöffnet"
      : row.awards ? `${row.awards} vergeben · ${row.teams} ${row.teams === 1 ? "Team" : "Teams"} · ${row.players} Spieler · Fassung ${row.version}`
        : "Abgeschlossen – nichts vergeben";
  return (
    <li className="text-sm" data-testid={`rewards-staffel-${row.tournament_id}`}>
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-white">Staffel {row.staffel}</span>
        <span className={row.closed && row.awards && !row.suspended ? "text-[#29B6E8]" : "text-white/55"}>{text}</span>
      </span>
      {/* Nr. 167: ohne gemeldete Aufstellung ging die Spieler-Belohnung an den Kader. */}
      {row.closed && !row.suspended && row.roster_fallback?.length ? (
        <span className="mt-1 block text-xs text-warn" data-testid={`rewards-fallback-${row.tournament_id}`}>
          {rosterFallbackText(row.roster_fallback)}
        </span>
      ) : null}
    </li>
  );
}

export function SeasonRewardsTab({ seasonId }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}/rewards`);
      setData(body);
      setForm(rewardsToForm(body));
      setError("");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Die Belohnungen konnten nicht geladen werden.");
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["leagues"]);

  const saved = useMemo(() => (data ? JSON.stringify(rewardsPayload(rewardsToForm(data))) : ""), [data]);
  const dirty = Boolean(form) && JSON.stringify(rewardsPayload(form)) !== saved;
  const problem = form ? [listProblem(form.items), ...Object.values(form.divisions).map((rows) => (rows ? listProblem(rows) : ""))].find(Boolean) || "" : "";

  if (error && !data) return <p className="text-sm text-warn" role="alert" data-testid="season-rewards-error">{error}</p>;
  if (!data || !form) return <div className="h-40 animate-pulse rounded-sm bg-white/5" aria-busy="true" aria-label="Lade Belohnungen" />;
  const readOnly = !data.can_edit;

  const save = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const { data: body } = await api.put(`/admin/leagues/seasons/${seasonId}/rewards`, rewardsPayload(form));
      setData(body);
      setForm(rewardsToForm(body));
      toast.success("Belohnungen gespeichert. Sie gelten beim nächsten Abschluss einer Staffel.");
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail) || "Speichern ging nicht.");
    }
    setSaving(false);
  };
  const setDivision = (id, rows) => setForm((current) => ({ ...current, divisions: { ...current.divisions, [id]: rows } }));

  return (
    <div className="space-y-6" data-testid="season-rewards">
      <FormSection title="Belohnungen der Season" className="scroll-mt-24" testId="season-rewards-season"
        hint="Banner, Emblem, Medaille oder Titel je Platz, Platzbereich oder für alle Teilnehmer. Vergeben wird beim Abschluss einer Staffel aus dem Endstand – wer etwas bekommt, sieht es sofort in Profil und Teamseite und bekommt eine Nachricht.">
        {readOnly ? <p className="text-xs text-white/55" data-testid="season-rewards-readonly">Ändern darf, wer „Season konfigurieren“ hat.</p> : null}
        <fieldset>
          <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Spieler-Belohnungen gehen an</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {PLAYER_BASIS.map((row) => (
              <label key={row.key} aria-label={row.label} className={`flex cursor-pointer items-start gap-3 rounded-sm border p-3 ${form.reward_players === row.key ? "border-[#29B6E8]/60 bg-[#29B6E8]/5" : "border-white/10"}`}>
                <input type="radio" name="reward-players" value={row.key} checked={form.reward_players === row.key} disabled={readOnly}
                  onChange={() => setForm((current) => ({ ...current, reward_players: row.key }))} className="mt-1 h-4 w-4 accent-[var(--tls-cyan)]"
                  data-testid={`season-rewards-basis-${row.key}`} />
                <span>
                  <span className="block text-sm font-semibold text-white">{row.label}{row.key === "fielded" ? " (Vorgabe)" : ""}</span>
                  <span className="block text-xs text-white/55">{row.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <RewardList items={form.items} readOnly={readOnly} testId="season-rewards-items" onChange={(items) => setForm((current) => ({ ...current, items }))}
          emptyText="Noch keine Belohnungen – die Season vergibt dann nur den Meister-Eintrag wie bisher." />
      </FormSection>

      <FormSection title="Liga N" id="belohnungen-ligen" className="scroll-mt-24" testId="season-rewards-divisions"
        hint="Jede Liga N übernimmt die Belohnungen der Season – oder bekommt eine eigene Zusammenstellung (auch „keine“).">
        <div className="space-y-4">
          {data.divisions.map((division) => {
            const own = form.divisions[division.id];
            return (
              <section key={division.id} className="rounded-sm border border-white/10 p-3 sm:p-4" aria-label={division.label} data-testid={`season-rewards-division-${division.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-heading text-lg font-black uppercase">{division.label}</h3>
                  {readOnly ? null : (
                    <button type="button" className={SMALL} data-testid={`season-rewards-own-${division.id}`}
                      onClick={() => setDivision(division.id, own === null ? form.items.map((item) => ({ ...item, key: `${item.key}-${division.id}`, id: null })) : null)}>
                      {own === null ? <><Copy className="h-3.5 w-3.5" aria-hidden="true" /> Eigene Zusammenstellung</> : "Wie die Season"}
                    </button>
                  )}
                </div>
                {own === null ? (
                  <p className="mt-2 text-sm text-white/60" data-testid={`season-rewards-inherit-${division.id}`}>
                    Wie die Season: {form.items.length ? form.items.map((item) => `${item.name || "ohne Namen"} (${placeLabel(item.places)})`).join(", ") : "keine Belohnungen"}.
                  </p>
                ) : (
                  <div className="mt-3">
                    <RewardList items={own} readOnly={readOnly} testId={`season-rewards-division-items-${division.id}`} onChange={(rows) => setDivision(division.id, rows)}
                      emptyText="Diese Liga N vergibt keine Belohnungen." />
                  </div>
                )}
                {division.staffeln.length ? (
                  <ul className="mt-3 space-y-1 border-t border-white/10 pt-3" aria-label={`Vergabe in ${division.label}`}>
                    {division.staffeln.map((row) => <StaffelState key={row.tournament_id} row={row} />)}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      </FormSection>

      {readOnly ? null : (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-sm border border-white/10 bg-[#0A0A0A]/95 p-3" data-testid="season-rewards-bar">
          <span className="mr-auto text-xs text-white/60">
            <Gift className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {problem || (dirty ? "Nicht gespeichert." : "Gespeichert. Gilt beim nächsten Abschluss einer Staffel.")}
          </span>
          {dirty ? (
            <button type="button" onClick={() => setForm(rewardsToForm(data))} className={`${BUTTON} tls-btn--quiet`} data-testid="season-rewards-discard">Verwerfen</button>
          ) : null}
          <button type="button" onClick={save} disabled={!dirty || saving || Boolean(problem)} className={`${BUTTON} tls-btn--primary`} data-testid="season-rewards-save">
            Belohnungen speichern
          </button>
        </div>
      )}
    </div>
  );
}
