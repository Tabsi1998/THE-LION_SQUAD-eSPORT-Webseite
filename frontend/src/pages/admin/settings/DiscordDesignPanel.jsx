import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Braces, FlaskConical, Palette, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { DiscordMessagePreview } from "@/components/tls/DiscordMessagePreview";

// Gestaltung der Discord-Meldungen (#866): je Meldungsart die Vorlage als Formular oder als JSON im Discord-Format,
// Platzhalter zum Anklicken, Live-Vorschau mit Beispielwerten oder den echten Daten von jetzt, Speichern (nur, was die
// Prüfung besteht), „Standard wiederherstellen“ und eine Testnachricht in den privaten Testkanal. Gerendert wird immer
// auf dem Server - die Vorschau zeigt genau das, was der Bot schicken würde.

const INPUT = "w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm";
const LABEL = "text-[10px] uppercase tracking-widest text-white/45 font-bold mb-1";

export function getPath(object, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);
}

/** Einen Wert an einem Pfad setzen, ohne das Original zu ändern; leere Teile fallen weg. */
export function setPath(object, path, value) {
  const keys = path.split(".");
  const root = Array.isArray(object) ? [...object] : { ...(object || {}) };
  let cursor = root;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      if (value === "" || value === undefined || value === null) delete cursor[key];
      else cursor[key] = value;
      return;
    }
    const next = cursor[key];
    cursor[key] = Array.isArray(next) ? [...next] : { ...(next || {}) };
    cursor = cursor[key];
  });
  for (const part of ["author", "thumbnail", "image", "footer", "row_field"]) {
    if (root[part] && typeof root[part] === "object" && !Array.isArray(root[part]) && Object.keys(root[part]).length === 0) delete root[part];
  }
  return root;
}

function colorHex(value) {
  if (typeof value === "number") return `#${value.toString(16).padStart(6, "0")}`;
  return /^#?[0-9a-fA-F]{6}$/.test(String(value || "")) ? `#${String(value).replace("#", "")}` : "";
}

function TextField({ label, path, draft, onChange, onFocus, multiline = false, rows = 3, placeholder = "", hint = "" }) {
  const value = getPath(draft, path) ?? "";
  const common = {
    value, placeholder, onFocus: () => onFocus(path), className: INPUT, "data-testid": `discord-design-field-${path}`,
    onChange: (event) => onChange(path, event.target.value), "aria-label": label,
  };
  return (
    <label className="block">
      <div className={LABEL}>{label}</div>
      {multiline ? <textarea rows={rows} {...common} /> : <input {...common} />}
      {hint && <div className="mt-1 text-[11px] text-white/40">{hint}</div>}
    </label>
  );
}

export function DiscordDesignPanel({ initialKind = "stream_live" }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(initialKind);
  const [draft, setDraft] = useState(null);
  const [mode, setMode] = useState("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [preview, setPreview] = useState(null);
  const [dataMode, setDataMode] = useState("sample");
  const [busy, setBusy] = useState("");
  const focusRef = useRef("description");

  const load = useCallback(async () => {
    try {
      const { data: next } = await api.get("/settings/discord/design");
      setData(next);
      return next;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return null;
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const kind = useMemo(() => (data?.kinds || []).find((entry) => entry.key === selected) || null, [data, selected]);
  useEffect(() => {
    if (!kind) return;
    setDraft(kind.template);
    setJsonText(JSON.stringify(kind.template, null, 2));
    setJsonError("");
    setPreview(kind.preview ? { ...kind.preview, errors: [], data: "sample" } : null);
  }, [kind]);

  // Vorschau: kurz nach jeder Änderung vom Server rendern lassen.
  useEffect(() => {
    if (!kind || !draft) return undefined;
    const id = window.setTimeout(() => {
      api.post(`/settings/discord/design/${kind.key}/preview`, { template: draft, data: dataMode })
        .then(({ data: next }) => setPreview(next))
        .catch(() => {});
    }, 350);
    return () => window.clearTimeout(id);
  }, [kind, draft, dataMode]);

  const dirty = Boolean(kind && draft && JSON.stringify(draft) !== JSON.stringify(kind.template));
  const change = (path, value) => {
    const next = setPath(draft, path, value);
    setDraft(next);
    setJsonText(JSON.stringify(next, null, 2));
  };
  const insert = (name) => {
    const path = focusRef.current || "description";
    const current = getPath(draft, path);
    change(path, `${typeof current === "string" ? current : ""}{${name}}`);
  };
  const editJson = (text) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Die Vorlage muss ein JSON-Objekt sein – in geschweiften Klammern.");
      setDraft(parsed);
      setJsonError("");
    } catch (err) {
      setJsonError(err.message || "Kein gültiges JSON.");
    }
  };
  const choose = (key) => {
    if (key === selected) return;
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    setSelected(key);
  };
  const run = async (key, action, success) => {
    if (busy) return;
    setBusy(key);
    try {
      const result = await action();
      if (success) toast.success(success);
      return result;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return null;
    } finally {
      setBusy("");
    }
  };
  const replaceKind = (updated) => setData((current) => ({ ...current, kinds: current.kinds.map((entry) => (entry.key === updated.key ? updated : entry)) }));
  const save = () => run("save", async () => {
    const { data: updated } = await api.put(`/settings/discord/design/${kind.key}`, { template: draft });
    replaceKind(updated);
  }, "Gestaltung gespeichert – sie gilt ab der nächsten Meldung.");
  const reset = () => {
    if (!window.confirm(`„${kind.label}“ auf den Standard zurücksetzen? Die eigene Fassung geht verloren.`)) return;
    run("reset", async () => {
      const { data: updated } = await api.delete(`/settings/discord/design/${kind.key}`);
      replaceKind(updated);
    }, "Standard wiederhergestellt.");
  };
  const sendTest = () => run("test", () => api.post(`/settings/discord/design/${kind.key}/test`, { template: draft }), "Testnachricht im Testkanal – ohne Erwähnung.");

  if (!data) return null;
  if (!kind || !draft) return null;
  const rowPlaceholders = kind.placeholders.filter((entry) => entry.row);
  const ownPlaceholders = kind.placeholders.filter((entry) => !entry.row);
  const fields = Array.isArray(draft.fields) ? draft.fields : [];
  const rowsMode = draft.rows === "fields" ? "fields" : "lines";
  const errors = [...(jsonError ? [jsonError] : []), ...(preview?.errors || [])];
  const isStream = kind.key.startsWith("stream_");

  return (
    <section className="space-y-4" data-testid="discord-design">
      <div>
        <h3 className="font-heading text-lg font-black uppercase inline-flex items-center gap-2"><Palette className="w-5 h-5 text-[#b8c0ff]" /> Gestaltung der Meldungen</h3>
        <p className="mt-1 text-sm text-white/60 max-w-3xl">
          Jede Meldung des Bots als Vorlage: Farbe, Autorzeile, Titel, Text, Felder, Bilder, Fußzeile. Platzhalter in geschweiften Klammern
          füllt die Website mit echten Werten. Rechts siehst du sofort, wie es im Discord aussieht.
        </p>
      </div>

      <div className="flex flex-wrap gap-4" role="tablist" aria-label="Meldungsart">
        {data.groups.map((group) => (
          <div key={group} className="space-y-1">
            <div className={LABEL}>{group}</div>
            <div className="flex flex-wrap gap-2">
              {data.kinds.filter((entry) => entry.group === group).map((entry) => (
                <button key={entry.key} type="button" role="tab" aria-selected={entry.key === selected} onClick={() => choose(entry.key)} data-testid={`discord-design-kind-${entry.key}`}
                  className={`px-3 py-1.5 rounded-sm border text-xs font-bold uppercase tracking-wider ${entry.key === selected ? "border-[#5865F2] bg-[#5865F2]/15 text-[#b8c0ff]" : "border-white/10 text-white/60 hover:text-white"}`}>
                  {entry.label}{entry.customized ? " ●" : ""}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4 min-w-0">
          <div className="border border-white/10 rounded-sm p-3 text-xs text-white/60">
            <div className="text-white/80 font-bold">{kind.label}{kind.customized ? " – eigene Fassung" : " – Standard"}</div>
            <div className="mt-1">{kind.hint}</div>
          </div>

          <div className="flex gap-2" role="tablist" aria-label="Bearbeiten als">
            {[["form", "Formular"], ["json", "JSON"]].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)} data-testid={`discord-design-mode-${key}`}
                className={`px-3 py-1.5 rounded-sm border text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 ${mode === key ? "border-[#29B6E8] text-[#29B6E8]" : "border-white/10 text-white/60"}`}>
                {key === "json" && <Braces className="w-3.5 h-3.5" />} {label}
              </button>
            ))}
          </div>

          {mode === "json" ? (
            <label className="block">
              <div className={LABEL}>Vorlage im Discord-Format (JSON)</div>
              <textarea rows={22} value={jsonText} onChange={(event) => editJson(event.target.value)} spellCheck={false} data-testid="discord-design-json"
                className={`${INPUT} font-mono text-xs`} aria-label="Vorlage als JSON" />
            </label>
          ) : (
            <div className="space-y-3" data-testid="discord-design-form">
              <TextField label="Text über dem Kasten" path="content" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} multiline rows={2}
                hint={isStream ? "Hier – und nur hier – erwähnt {role} die gewählte Rolle." : "Optional; die meisten Einbettungen brauchen keinen."} />
              <div className="grid sm:grid-cols-[8rem_minmax(0,1fr)] gap-3 items-end">
                <label className="block">
                  <div className={LABEL}>Farbe</div>
                  <input type="color" value={colorHex(draft.color) || "#29b6e8"} onChange={(event) => change("color", event.target.value)} data-testid="discord-design-color"
                    className="h-9 w-full bg-transparent border border-white/10 rounded-sm" aria-label="Farbe wählen" />
                </label>
                <TextField label="Farbe als Code oder Platzhalter" path="color" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} placeholder="#9146FF" />
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <TextField label="Autorzeile" path="author.name" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
                <TextField label="Link der Autorzeile" path="author.url" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
                <TextField label="Bild der Autorzeile" path="author.icon_url" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <TextField label="Titel" path="title" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
                <TextField label="Link des Titels" path="url" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
              </div>
              <TextField label="Text" path="description" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} multiline rows={4} />

              {kind.list && (
                <div className="border border-white/10 rounded-sm p-3 space-y-3" data-testid="discord-design-rows">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="block">
                      <div className={LABEL}>Einträge zeigen als</div>
                      <select value={rowsMode} onChange={(event) => change("rows", event.target.value)} className={INPUT} data-testid="discord-design-rows-mode">
                        <option value="fields">ein Feld je Eintrag</option>
                        <option value="lines">Zeilen im Text ({"{rows}"})</option>
                      </select>
                    </label>
                    <label className="block">
                      <div className={LABEL}>Höchstens so viele Einträge</div>
                      <input type="number" min={1} max={25} value={draft.max_rows ?? ""} onChange={(event) => change("max_rows", event.target.value ? Number(event.target.value) : "")} className={INPUT} data-testid="discord-design-max-rows" />
                    </label>
                  </div>
                  {rowsMode === "fields" ? (
                    <>
                      <TextField label="Feldname je Eintrag" path="row_field.name" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
                      <TextField label="Feldinhalt je Eintrag" path="row_field.value" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} multiline rows={2} />
                    </>
                  ) : (
                    <TextField label="Zeile je Eintrag" path="row" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} hint="Die Zeilen stehen dort, wo im Text {rows} steht." />
                  )}
                  <TextField label="Text ohne Einträge" path="empty" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
                </div>
              )}

              <div className="space-y-2" data-testid="discord-design-fields">
                <div className={LABEL}>Felder</div>
                {fields.map((field, index) => (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2 items-start">
                    <input value={field.name || ""} onChange={(event) => change(`fields.${index}.name`, event.target.value)} onFocus={() => { focusRef.current = `fields.${index}.name`; }} className={INPUT} aria-label={`Feld ${index + 1}: Name`} data-testid={`discord-design-field-fields.${index}.name`} />
                    <input value={field.value || ""} onChange={(event) => change(`fields.${index}.value`, event.target.value)} onFocus={() => { focusRef.current = `fields.${index}.value`; }} className={INPUT} aria-label={`Feld ${index + 1}: Inhalt`} data-testid={`discord-design-field-fields.${index}.value`} />
                    <div className="flex items-center gap-1">
                      <label className="inline-flex items-center gap-1 text-[11px] text-white/60" title="nebeneinander">
                        <input type="checkbox" checked={field.inline !== false} onChange={(event) => change(`fields.${index}.inline`, event.target.checked)} aria-label={`Feld ${index + 1}: nebeneinander`} /> ⇆
                      </label>
                      <button type="button" disabled={index === 0} onClick={() => change("fields", fields.map((_, i) => (i === index - 1 ? fields[index] : i === index ? fields[index - 1] : fields[i])))} className="p-1 text-white/50 disabled:opacity-30" aria-label="nach oben"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button type="button" disabled={index === fields.length - 1} onClick={() => change("fields", fields.map((_, i) => (i === index + 1 ? fields[index] : i === index ? fields[index + 1] : fields[i])))} className="p-1 text-white/50 disabled:opacity-30" aria-label="nach unten"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => change("fields", fields.filter((_, i) => i !== index))} className="p-1 text-[#FF3B30]/80" aria-label={`Feld ${index + 1} entfernen`} data-testid={`discord-design-field-remove-${index}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
                <button type="button" disabled={fields.length >= 25} onClick={() => change("fields", [...fields, { name: "", value: "", inline: true }])} data-testid="discord-design-field-add"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/15 text-white/70 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">
                  <Plus className="w-3.5 h-3.5" /> Feld hinzufügen
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <TextField label="Bild rechts (klein)" path="thumbnail.url" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
                <TextField label="Großes Bild" path="image.url" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <TextField label="Fußzeile" path="footer.text" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
                <TextField label="Symbol der Fußzeile" path="footer.icon_url" draft={draft} onChange={change} onFocus={(path) => { focusRef.current = path; }} />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-white/75">
                <input type="checkbox" checked={!!draft.timestamp} onChange={(event) => change("timestamp", event.target.checked || "")} data-testid="discord-design-timestamp" />
                Uhrzeit in der Fußzeile {isStream ? "(Beginn bzw. Ende des Streams)" : "(Zeitpunkt der Meldung)"}
              </label>
            </div>
          )}

          <div className="border border-white/10 rounded-sm p-3 space-y-2" data-testid="discord-design-placeholders">
            <div className={LABEL}>Platzhalter – anklicken fügt ihn ins zuletzt gewählte Feld ein</div>
            <div className="flex flex-wrap gap-1.5">
              {ownPlaceholders.map((entry) => (
                <button key={entry.name} type="button" onClick={() => insert(entry.name)} title={`${entry.text}${entry.sample ? ` – z. B. ${entry.sample}` : ""}`} data-testid={`discord-design-placeholder-${entry.name}`}
                  className="px-2 py-1 rounded-sm bg-white/5 border border-white/10 text-[11px] font-mono text-[#b8c0ff] hover:border-[#5865F2]">{`{${entry.name}}`}</button>
              ))}
            </div>
            {rowPlaceholders.length > 0 && (
              <>
                <div className={LABEL}>Je Eintrag (nur in Zeile oder Feld je Eintrag)</div>
                <div className="flex flex-wrap gap-1.5">
                  {rowPlaceholders.map((entry) => (
                    <button key={entry.name} type="button" onClick={() => insert(entry.name)} title={`${entry.text}${entry.sample ? ` – z. B. ${entry.sample}` : ""}`} data-testid={`discord-design-placeholder-${entry.name}`}
                      className="px-2 py-1 rounded-sm bg-white/5 border border-white/10 text-[11px] font-mono text-[#00FF88]/80 hover:border-[#00FF88]/50">{`{${entry.name}}`}</button>
                  ))}
                </div>
              </>
            )}
            <p className="text-[11px] text-white/45">
              Teile in <code>[[ … ]]</code> erscheinen nur, wenn jeder Platzhalter darin einen Wert hat. Formatierung wie im Discord: <code>**fett**</code>, <code>*kursiv*</code>,
              <code> __unterstrichen__</code>, <code>[Text](Adresse)</code>. Bilder brauchen eine volle Adresse mit https:// oder einen Platzhalter.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy || !dirty || !!jsonError} onClick={save} data-testid="discord-design-save"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#5865F2] text-white font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">
              <Save className="w-3.5 h-3.5" /> Speichern
            </button>
            <button type="button" disabled={!!busy || !!jsonError} onClick={sendTest} data-testid="discord-design-test"
              className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">
              <FlaskConical className="w-3.5 h-3.5" /> Testnachricht
            </button>
            <button type="button" disabled={!!busy || !kind.customized} onClick={reset} data-testid="discord-design-reset"
              className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 text-white/60 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /> Standard wiederherstellen
            </button>
            {dirty && <span className="self-center text-xs text-[#FFD700]">nicht gespeichert</span>}
          </div>
        </div>

        <div className="space-y-2 min-w-0 xl:sticky xl:top-4 self-start" data-testid="discord-design-preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={LABEL}>So sieht es im Discord aus</div>
            <div className="flex gap-1" role="tablist" aria-label="Daten der Vorschau">
              {[["sample", "Beispieldaten"], ["live", "Echte Daten"]].map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={dataMode === key} onClick={() => setDataMode(key)} data-testid={`discord-design-data-${key}`}
                  className={`px-2 py-1 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${dataMode === key ? "border-[#29B6E8] text-[#29B6E8]" : "border-white/10 text-white/50"}`}>{label}</button>
              ))}
            </div>
          </div>
          {preview?.embed ? (
            <DiscordMessagePreview embed={preview.embed} content={preview.content || ""} botName="THE LION SQUAD"
              buttons={isStream && preview.embed?.url ? [{ label: "Zuschauen", url: preview.embed.url }] : []} testId="discord-design-message" />
          ) : (
            <div className="border border-dashed border-white/15 rounded-sm p-6 text-center text-sm text-white/40">Noch keine Vorschau.</div>
          )}
          {preview?.note && <div className="text-xs text-white/50" data-testid="discord-design-note">{preview.note}</div>}
          {typeof preview?.length === "number" && <div className="text-[11px] text-white/40" data-testid="discord-design-length">{preview.length} / {data.limits?.total || 6000} Zeichen</div>}
          {errors.length > 0 && (
            <ul className="border border-[#FF3B30]/40 bg-[#FF3B30]/10 rounded-sm p-3 text-xs text-white/80 list-disc pl-5 space-y-1" data-testid="discord-design-errors">
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
