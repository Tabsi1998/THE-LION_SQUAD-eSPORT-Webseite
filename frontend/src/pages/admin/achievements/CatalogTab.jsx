import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, EyeOff, Plus, Search, ShieldCheck, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, FieldLabel, INPUT_CLASS, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ACHIEVEMENT_ICON_NAMES, AchievementIcon } from "@/components/tls/AchievementIcon";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { Badge } from "@/components/achievements/Badge";
import { BADGE_ART_KEYS } from "@/components/achievements/badgeArt";
import { BoardOnly, CATEGORIES, FilePick, LADDER, MATERIALS, MaterialChip, Panel, categoryOf, download, errorText } from "./shared";

/**
 * Welche Materialien eine Stufe annehmen darf (E10): nur innerhalb der Leiter Holz bis Diamant und nur
 * zwischen den Nachbarstufen ihrer Gruppe - sonst stünde sie über einer anderen. Neue Stufen bekommen die
 * freien Plätze der Leiter, dazu Legendär und Geheim. Der Server prüft dieselbe Regel.
 */
export function allowedMaterials(tier, siblings = []) {
  const others = siblings.filter((t) => t.code !== tier?.code);
  if (!tier) {
    const used = new Set(others.map((t) => t.material));
    return [...LADDER.filter((m) => !used.has(m)), "legendary", "hidden"];
  }
  if (!LADDER.includes(tier.material)) return [tier.material].filter(Boolean);
  const rank = (m) => LADDER.indexOf(m) + 1;
  const own = rank(tier.material);
  const ranks = others.filter((t) => LADDER.includes(t.material)).map((t) => rank(t.material));
  const lower = Math.max(0, ...ranks.filter((r) => r < own));
  const upper = Math.min(8, ...ranks.filter((r) => r > own));
  return LADDER.filter((m) => rank(m) > lower && rank(m) < upper);
}

export function slugFrom(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function conditionText(tier) {
  if (tier.manual_only) return { text: "von Hand", tone: "text-[#FF3B30]" };
  if (!tier.condition_key) return { text: "—", tone: "text-white/40" };
  return { text: `Automatik · Ziel ${Number(tier.progress_target || 0).toLocaleString("de-DE")}`, tone: "text-white/60" };
}

const STATUS = { live: ["live", "#00FF88"], counter: ["Zähler", "#FFD700"], planned: ["geplant", "rgba(255,255,255,0.35)"] };

/** Katalog (E10): Gruppen je Kategorie mit ihren Stufen, Bearbeiten, Prüfung, Export und Import. */
export function CatalogTab({ board = false }) {
  const [groups, setGroups] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingTier, setEditingTier] = useState(null);
  const [report, setReport] = useState(null);
  const [checking, setChecking] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const [g, t] = await Promise.all([api.get("/admin/achievements/groups"), api.get("/admin/achievements/tiers")]);
      setGroups(Array.isArray(g.data) ? g.data : []);
      setTiers(Array.isArray(t.data) ? t.data : []);
    } catch (err) {
      toast.error(errorText(err));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["achievements"]);

  const tiersByGroup = useMemo(() => {
    const map = {};
    for (const tier of tiers) (map[tier.group_code] ||= []).push(tier);
    for (const list of Object.values(map)) list.sort((a, b) => (a.rank || 0) - (b.rank || 0));
    return map;
  }, [tiers]);
  const groupsByCode = useMemo(() => Object.fromEntries(groups.map((g) => [g.code, g])), [groups]);
  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CATEGORIES.map((c) => ({
      ...c,
      groups: groups.filter((g) => categoryOf(g) === c.value && (!needle || `${g.name} ${g.description || ""}`.toLowerCase().includes(needle))),
    })).filter((section) => section.groups.length);
  }, [groups, query]);

  const toggle = (code, force) => setOpen((current) => {
    const next = new Set(current);
    if (force ?? !next.has(code)) next.add(code); else next.delete(code);
    return next;
  });

  const check = async () => {
    setChecking(true);
    try {
      const { data } = await api.get("/admin/achievements/catalog/check");
      setReport(data);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  const exportJson = async () => {
    try {
      await download("/admin/achievements/catalog/export", `erfolge-katalog-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (err) {
      toast.error(errorText(err, "Der Export hat nicht geklappt."));
    }
  };

  const togglePublic = async (g) => {
    try { await api.patch(`/admin/achievements/groups/${g.code}`, { public: !g.public }); load(); }
    catch (err) { toast.error(errorText(err)); }
  };
  const deleteGroup = async (g) => {
    if (!await confirm({ title: "Gruppe löschen?", description: `„${g.name}“ mit allen Stufen und Vergaben wirklich löschen?`, confirmLabel: "Löschen" })) return;
    try { await api.delete(`/admin/achievements/groups/${g.code}`); toast.success("Gelöscht"); load(); }
    catch (err) { toast.error(errorText(err)); }
  };
  const deleteTier = async (t) => {
    if (!await confirm({ title: "Stufe löschen?", description: `„${t.name}“ und alle Vergaben dieser Stufe wirklich löschen?`, confirmLabel: "Löschen" })) return;
    try { await api.delete(`/admin/achievements/tiers/${t.code}`); toast.success("Gelöscht"); load(); }
    catch (err) { toast.error(errorText(err)); }
  };

  return (
    <div className="space-y-6" data-testid="ach-catalog">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="relative block w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Gruppe suchen …" aria-label="Gruppe suchen" data-testid="catalog-search" className={`${INPUT_CLASS} pl-9`} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={check} disabled={checking} data-testid="catalog-check" className="px-3 py-2 border border-[#00FF88]/50 text-[#00FF88] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 disabled:opacity-40">
            <ShieldCheck className="w-3.5 h-3.5" /> {checking ? "Prüfe …" : "Katalog prüfen"}
          </button>
          <button type="button" onClick={exportJson} data-testid="catalog-export" className="px-3 py-2 border border-white/20 text-white/70 text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:text-white">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button type="button" onClick={() => setEditingGroup({})} data-testid="group-new-btn" className="px-3 py-2 bg-[#FFD700] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" /> Neue Gruppe
          </button>
        </div>
      </div>

      {report && <CheckReport report={report} groupsByCode={groupsByCode} onJump={(code) => { toggle(code, true); setQuery(""); setTimeout(() => document.querySelector(`[data-group="${code}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }} onClose={() => setReport(null)} />}

      {sections.map((section) => (
        <section key={section.value} data-testid={`catalog-section-${section.value}`}>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/50 mb-2">{section.label} <span className="text-white/30">· {section.groups.length}</span></h3>
          <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5">
            {section.groups.map((g) => {
              const groupTiers = tiersByGroup[g.code] || [];
              const isOpen = open.has(g.code);
              const hidden = g.hidden || categoryOf(g) === "hidden";
              return (
                <div key={g.code} data-group={g.code} data-testid={`group-row-${g.code}`}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <button type="button" onClick={() => toggle(g.code)} aria-expanded={isOpen} data-testid={`group-toggle-${g.code}`} className="flex items-center gap-3 min-w-[14rem] flex-1 text-left">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-white/40 shrink-0" /> : <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />}
                      <Badge material={groupTiers[groupTiers.length - 1]?.material || "bronze"} art={g.art} icon={g.icon} size="sm" animate={false} />
                      <span className="min-w-0">
                        <span className="block font-semibold truncate">{g.name}</span>
                        <span className="block text-[11px] text-white/45 truncate">{g.description || "ohne Beschreibung"}</span>
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest">
                      <span className="text-white/40">{groupTiers.length} Stufe{groupTiers.length === 1 ? "" : "n"}</span>
                      {hidden && <span className="inline-flex items-center gap-1 text-[#A855F7]" title="Name und Stufen erscheinen erst nach der Freischaltung" data-testid={`group-hidden-${g.code}`}><EyeOff className="w-3 h-3" /> versteckt</span>}
                      {g.is_special && <span className="text-[#FFD700]">Sonder</span>}
                      {g.is_negative && <span className="text-[#FF3B30]">Negativ</span>}
                      {g.is_admin_created && <span className="text-[#29B6E8]">Eigen</span>}
                      <button type="button" onClick={() => togglePublic(g)} data-testid={`group-public-${g.code}`} className={`font-bold ${g.public ? "text-[#00FF88]" : "text-white/40"}`}>{g.public ? "Öffentlich" : "Intern"}</button>
                      <button type="button" onClick={() => setEditingGroup(g)} data-testid={`group-edit-${g.code}`} className="text-[#29B6E8] hover:underline normal-case tracking-normal text-xs">Bearbeiten</button>
                      {g.is_admin_created && <button type="button" onClick={() => deleteGroup(g)} className="text-[#FF3B30] hover:underline normal-case tracking-normal text-xs">Löschen</button>}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-4" data-testid={`group-tiers-${g.code}`}>
                      {hidden && <p className="mb-2 text-[11px] text-[#A855F7]/80">Versteckt: Wer die Gruppe noch nicht hat, sieht nur ein Fragezeichen – Name und Stufen erscheinen erst nach der Freischaltung.</p>}
                      <div className="overflow-x-auto border border-white/5 rounded-sm">
                        <table className="w-full text-sm min-w-[640px]">
                          <thead className="bg-[#0A0A0A] text-[10px] uppercase tracking-widest text-white/45">
                            <tr>
                              <th className="text-left px-3 py-2">Material</th>
                              <th className="text-left px-3 py-2">Stufe</th>
                              <th className="text-left px-3 py-2">Bedingung</th>
                              <th className="text-right px-3 py-2">Punkte</th>
                              <th className="text-right px-3 py-2">Aktionen</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {groupTiers.map((t) => {
                              const condition = conditionText(t);
                              const status = STATUS[t.condition_status];
                              return (
                                <tr key={t.code} data-testid={`tier-row-${t.code}`}>
                                  <td className="px-3 py-2"><MaterialChip tier={t} /></td>
                                  <td className="px-3 py-2"><div className="font-semibold">{t.name}</div>{t.description && <div className="text-[11px] text-white/45">{t.description}</div>}</td>
                                  <td className={`px-3 py-2 text-xs ${condition.tone}`}>
                                    {condition.text}
                                    {status && !t.manual_only && <span className="ml-2 text-[9px] uppercase tracking-widest" style={{ color: status[1] }}>{status[0]}</span>}
                                    {t.member_only && <div className="mt-0.5 text-[9px] uppercase tracking-widest text-[#FFD700]">nur Mitglieder</div>}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">+{t.points}</td>
                                  <td className="px-3 py-2 text-right whitespace-nowrap">
                                    <button type="button" onClick={() => setEditingTier({ tier: t, group: g })} data-testid={`tier-edit-${t.code}`} className="text-[#29B6E8] hover:underline mr-3 text-xs">Bearbeiten</button>
                                    <button type="button" onClick={() => deleteTier(t)} className="text-[#FF3B30] hover:underline text-xs">Löschen</button>
                                  </td>
                                </tr>
                              );
                            })}
                            {!groupTiers.length && <tr><td colSpan="5" className="px-3 py-6 text-center text-white/40 text-xs">Noch keine Stufen.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      <button type="button" onClick={() => setEditingTier({ tier: null, group: g })} data-testid={`tier-new-${g.code}`} className="mt-2 px-3 py-1.5 border border-[#FFD700]/40 text-[#FFD700] text-[10px] font-bold uppercase tracking-widest rounded-sm inline-flex items-center gap-1.5">
                        <Plus className="w-3 h-3" /> Neue Stufe
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {!sections.length && <p className="text-sm text-white/40">Keine Gruppe passt zur Suche.</p>}

      <Panel title="Katalog einspielen" icon={Upload} accent="#29B6E8" hint="Eine Exportdatei (JSON) übernehmen: erst wird der zusammengeführte Stand geprüft, bei Fehlern wird nichts geschrieben. Gelöscht wird nie etwas." testId="catalog-import">
        <BoardOnly board={board} what="Einspielen">
          <ImportBox onApplied={load} />
        </BoardOnly>
      </Panel>

      {editingGroup && <GroupForm group={editingGroup.code ? editingGroup : null} onClose={() => setEditingGroup(null)} onSaved={load} />}
      {editingTier && <TierForm tier={editingTier.tier} group={editingTier.group} siblings={tiersByGroup[editingTier.group.code] || []} onClose={() => setEditingTier(null)} onSaved={load} />}
    </div>
  );
}

function CheckReport({ report, groupsByCode, onJump, onClose }) {
  const rows = [...report.errors.map((f) => ({ ...f, level: "error" })), ...report.warnings.map((f) => ({ ...f, level: "warning" }))];
  return (
    <Panel
      title={report.ok ? "Katalog-Prüfung: keine Fehler" : `Katalog-Prüfung: ${report.counts.errors} Fehler`}
      icon={report.ok ? CheckCircle2 : AlertTriangle}
      accent={report.ok ? "#00FF88" : "#FF3B30"}
      hint={`${report.counts.groups} Gruppen und ${report.counts.tiers} Stufen geprüft – dieselben Regeln wie im automatischen Test. ${report.counts.warnings} Hinweis${report.counts.warnings === 1 ? "" : "e"}.`}
      actions={<button type="button" onClick={onClose} className="text-[10px] uppercase tracking-widest text-white/50 hover:text-white">Schließen</button>}
      testId="catalog-report"
    >
      {rows.length ? (
        <ul className="divide-y divide-white/5 max-h-80 overflow-y-auto">
          {rows.map((f, i) => (
            <li key={`${f.code}-${f.group || ""}-${f.tier || ""}-${i}`} className="py-2 flex items-start gap-3 text-xs" data-testid={`finding-${f.level}`}>
              <span className={`mt-0.5 shrink-0 text-[9px] font-bold uppercase tracking-widest ${f.level === "error" ? "text-[#FF3B30]" : "text-[#FFD700]"}`}>{f.level === "error" ? "Fehler" : "Hinweis"}</span>
              <span className="flex-1 text-white/75">{f.message}</span>
              {f.group && groupsByCode[f.group] && <button type="button" onClick={() => onJump(f.group)} className="shrink-0 text-[#29B6E8] hover:underline">zur Gruppe</button>}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-white/55">Alles in Ordnung.</p>}
    </Panel>
  );
}

function ImportBox({ onApplied }) {
  const [payload, setPayload] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async (body, dryRun) => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/achievements/catalog/import", { groups: body.groups || [], tiers: body.tiers || [], dry_run: dryRun });
      setResult(data);
      if (data.applied) {
        toast.success(`Eingespielt: ${data.groups} Gruppen, ${data.tiers} Stufen.`);
        setPayload(null);
        onApplied?.();
      }
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    setResult(null);
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast.error("Die Datei ist kein gültiges JSON.");
      return;
    }
    if (!Array.isArray(parsed?.groups) || !Array.isArray(parsed?.tiers)) {
      toast.error("In der Datei fehlen Gruppen und Stufen.");
      return;
    }
    setPayload(parsed);
    await send(parsed, true);
  };

  return (
    <div className="space-y-3">
      <FilePick label="Exportdatei wählen" accept="application/json,.json" onFile={onFile} testId="catalog-import-file" />
      {result && (
        <div className="text-xs border border-white/10 rounded-sm p-3 space-y-2" data-testid="catalog-import-result">
          <div>{result.groups} Gruppen und {result.tiers} Stufen in der Datei · {result.check.ok ? <span className="text-[#00FF88]">Prüfung ohne Fehler</span> : <span className="text-[#FF3B30]">{result.check.counts.errors} Fehler – nichts eingespielt</span>}</div>
          {!result.check.ok && (
            <ul className="list-disc pl-5 text-white/70 max-h-40 overflow-y-auto">
              {result.check.errors.slice(0, 30).map((f, i) => <li key={`${f.code}-${i}`}>{f.message}</li>)}
            </ul>
          )}
          {payload && result.check.ok && !result.applied && (
            <button type="button" onClick={() => send(payload, false)} disabled={busy} data-testid="catalog-import-apply" className="px-3 py-1.5 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-widest rounded-sm disabled:opacity-40">
              {busy ? "Spiele ein …" : "Jetzt einspielen"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ArtField({ value, onChange, material = "gold", testId }) {
  return (
    <FieldLabel label="Motiv">
      <div className="flex items-center gap-2">
        <Badge material={material} art={value || undefined} size="sm" animate={false} />
        <select value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} className={INPUT_CLASS}>
          <option value="">— Symbol statt Motiv —</option>
          {BADGE_ART_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
      </div>
    </FieldLabel>
  );
}

function IconField({ value, onChange }) {
  return (
    <FieldLabel label="Symbol">
      <div className="flex items-center gap-2">
        <AchievementIcon name={value} fallback="trophy" className="w-5 h-5 shrink-0 text-[#FFD700]" aria-hidden="true" />
        <select value={value} onChange={(event) => onChange(event.target.value)} className={INPUT_CLASS}>
          {ACHIEVEMENT_ICON_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
    </FieldLabel>
  );
}

function GroupForm({ group, onClose, onSaved }) {
  const isNew = !group;
  const [form, setForm] = useState({
    code: group?.code || "",
    name: group?.name || "",
    category: group?.category || "special",
    icon: group?.icon || "trophy",
    art: group?.art || "",
    accent_color: group?.accent_color || "#FF3B30",
    description: group?.description || "",
    how_to: group?.how_to || "",
    public: group?.public ?? true,
    is_special: group?.is_special ?? true,
    is_negative: group?.is_negative ?? false,
    hidden: group?.hidden ?? false,
    sort_order: group?.sort_order ?? 600,
  });
  const [codeTouched, setCodeTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, art: form.art || null };
      if (isNew) await api.post("/admin/achievements/groups", payload);
      else { delete payload.code; await api.patch(`/admin/achievements/groups/${group.code}`, payload); }
      toast.success("Gespeichert"); onSaved(); onClose();
    } catch (err) { toast.error(errorText(err)); }
    setSaving(false);
  };

  return (
    <AdminSheet title={isNew ? "Neue Gruppe" : "Gruppe bearbeiten"} eyebrow="Erfolge" accent="#FFD700" onClose={onClose} onSubmit={save} saving={saving} submitTestId="group-save" testId="group-sheet">
      <FormGrid>
        <TextField label="Name" required value={form.name} onChange={(v) => setForm((c) => ({ ...c, name: v, code: isNew && !codeTouched ? slugFrom(v) : c.code }))} testId="group-name" />
        <SelectField label="Kategorie" value={form.category} onChange={(v) => set("category", v)} options={CATEGORIES.map((c) => [c.value, c.label])} testId="group-category" />
        <TextField label="Reihenfolge" type="number" value={form.sort_order} onChange={(v) => set("sort_order", parseInt(v, 10) || 0)} />
        <FieldLabel label="Farbe"><input type="color" value={form.accent_color} onChange={(e) => set("accent_color", e.target.value)} className={`${INPUT_CLASS} h-10`} /></FieldLabel>
        <ArtField value={form.art} onChange={(v) => set("art", v)} testId="group-art" />
        <IconField value={form.icon} onChange={(v) => set("icon", v)} />
      </FormGrid>
      <TextAreaField label="Beschreibung" rows={2} value={form.description} onChange={(v) => set("description", v)} testId="group-description" />
      <TextAreaField label="So schaffst du es" rows={2} value={form.how_to} onChange={(v) => set("how_to", v)} testId="group-how-to" />
      <CheckField label="Öffentlich sichtbar" checked={form.public} onChange={(v) => set("public", v)} testId="group-public" accent="#FFD700" />
      <CheckField label="Versteckt bis zur Freischaltung" checked={form.hidden} onChange={(v) => set("hidden", v)} testId="group-hidden" accent="#A855F7" />
      <CheckField label="Sonderauszeichnung (von Hand kuratiert)" checked={form.is_special} onChange={(v) => set("is_special", v)} accent="#FFD700" />
      <CheckField label="Negativ/Fun (bis zur Freischaltung geheim)" checked={form.is_negative} onChange={(v) => set("is_negative", v)} testId="group-negative" accent="#FF3B30" />
      {isNew && (
        <FormSection title="Kennung" hint="Wird aus dem Namen gebildet und lässt sich später nicht mehr ändern." collapsible>
          <TextField label="Kennung" required value={form.code} onChange={(v) => { setCodeTouched(true); set("code", slugFrom(v)); }} testId="group-code" />
        </FormSection>
      )}
    </AdminSheet>
  );
}

function TierForm({ tier, group, siblings, onClose, onSaved }) {
  const isNew = !tier;
  const options = allowedMaterials(tier, siblings);
  const [form, setForm] = useState({
    code: tier?.code || `${group.code}_${siblings.length + 1}`,
    material: tier?.material || options[0] || "bronze",
    name: tier?.name || "",
    description: tier?.description || "",
    how_to: tier?.how_to || "",
    condition_key: tier?.condition_key || "",
    progress_target: tier?.progress_target || 1,
    points: tier?.points ?? "",
    icon: tier?.icon || group.icon || "trophy",
    art: tier?.art || "",
    manual_only: tier?.manual_only ?? !siblings.some((t) => t.condition_key),
    member_only: tier?.member_only ?? categoryOf(group) === "club",
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, art: form.art || null, points: form.points === "" ? null : Number(form.points) };
      if (form.manual_only) { payload.condition_key = null; payload.progress_target = null; }
      if (payload.points === null) delete payload.points;
      if (isNew) await api.post("/admin/achievements/tiers", { ...payload, group_code: group.code });
      else { delete payload.code; await api.patch(`/admin/achievements/tiers/${tier.code}`, payload); }
      toast.success("Gespeichert"); onSaved(); onClose();
    } catch (err) { toast.error(errorText(err)); }
    setSaving(false);
  };

  return (
    <AdminSheet title={isNew ? `Neue Stufe in „${group.name}“` : `${tier.name} bearbeiten`} eyebrow="Erfolge" accent="#FFD700" onClose={onClose} onSubmit={save} saving={saving} submitTestId="tier-save" testId="tier-sheet">
      <FormGrid>
        <TextField label="Name" required value={form.name} onChange={(v) => set("name", v)} testId="tier-name" />
        <SelectField
          label="Material"
          value={form.material}
          onChange={(v) => set("material", v)}
          options={options.map((key) => [key, MATERIALS[key]?.[0] || key])}
          hint={!isNew && options.length <= 1 ? "Das Material bleibt – es gibt keinen freien Platz zwischen den Nachbarstufen." : "Nur innerhalb der Leiter und zwischen den Nachbarstufen."}
          testId="tier-material"
        />
        <TextField label="Punkte" type="number" value={form.points} onChange={(v) => set("points", v)} placeholder="nach Material" testId="tier-points" />
        <ArtField value={form.art} onChange={(v) => set("art", v)} material={form.material} testId="tier-art" />
      </FormGrid>
      <TextAreaField label="Beschreibung" rows={2} value={form.description} onChange={(v) => set("description", v)} testId="tier-description" />
      <TextAreaField label="So schaffst du es" rows={2} value={form.how_to} onChange={(v) => set("how_to", v)} testId="tier-how-to" />
      <CheckField label="Von Hand vergeben (keine Automatik)" checked={form.manual_only} onChange={(v) => set("manual_only", v)} testId="tier-manual" accent="#FFD700" />
      <CheckField label="Nur für Vereinsmitglieder" checked={form.member_only} onChange={(v) => set("member_only", v)} testId="tier-member-only" accent="#FFD700" />
      {!form.manual_only && (
        <FormGrid>
          <TextField label="Ziel" type="number" value={form.progress_target} onChange={(v) => set("progress_target", parseInt(v, 10) || 1)} testId="tier-target" />
          <TextField label="Automatik (Zähler)" value={form.condition_key} onChange={(v) => set("condition_key", v.trim())} hint="Welcher Zähler das Ziel prüft – die Katalog-Prüfung meldet unbekannte." testId="tier-condition" />
        </FormGrid>
      )}
      <IconField value={form.icon} onChange={(v) => set("icon", v)} />
      {isNew && (
        <FormSection title="Kennung" hint="Wird vorgeschlagen und lässt sich später nicht mehr ändern." collapsible>
          <TextField label="Kennung" required value={form.code} onChange={(v) => set("code", slugFrom(v))} testId="tier-code" />
        </FormSection>
      )}
    </AdminSheet>
  );
}
