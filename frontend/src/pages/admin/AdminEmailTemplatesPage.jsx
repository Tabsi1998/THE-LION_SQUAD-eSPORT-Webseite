import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, Mail, RotateCcw, Save, Send, X } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

// E-Mail-Vorlagen (#437 A): alle Mails, die die Website verschickt, an einer Stelle - je Vorlage Zweck,
// Empfänger und Variablen; Bearbeiten mit Vorschau (Beispieldaten), Testmail an mich, Zurücksetzen.
// Das frühere „Web-CMS“ (Seiten-Tab ohne Anbindung) ist weg; die E-Mail-Vorlagen sind seine eine Aufgabe.

export default function AdminEmailTemplatesPage() {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get("/admin/email-templates").then(({ data }) => setRows(Array.isArray(data) ? data : [])).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["email-templates", "settings"]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const row of rows || []) {
      if (!map.has(row.category)) map.set(row.category, { label: row.category_label, rows: [] });
      map.get(row.category).rows.push(row);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">System</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 flex items-center gap-3" data-testid="email-templates-title"><Mail className="w-6 h-6" /> E-Mail-Vorlagen</h1>
      <p className="mt-2 text-white/55 text-sm max-w-3xl">
        Jede Mail, die die Website verschickt – mit Zweck, Empfänger und den Variablen, die in den Text dürfen. Ändere Betreff und Text, sieh die Vorschau mit
        Beispieldaten, schick dir eine Testmail. „Zurücksetzen“ holt den Standard zurück. Ob eine Person eine Mail überhaupt bekommt, entscheiden weiter ihre Einstellungen.
      </p>
      {rows === null ? <div className="mt-6 text-sm text-white/45">Lade …</div> : null}
      <div className="mt-6 space-y-6">
        {groups.map(([key, group]) => (
          <section key={key} data-testid={`email-templates-group-${key}`}>
            <h2 className="font-heading text-lg font-black uppercase mb-2">{group.label}</h2>
            <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5">
              {group.rows.map((row) => (
                <div key={row.key} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1" data-testid={`tpl-row-${row.key}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold flex items-center gap-2">
                      {row.name}
                      {row.custom ? <span className="text-[10px] font-bold uppercase tracking-wider border border-[#FFD700]/50 text-[#FFD700] px-1.5 py-0.5 rounded-sm" data-testid={`tpl-custom-${row.key}`}>angepasst</span> : null}
                    </div>
                    <div className="text-xs text-white/50">{row.purpose}</div>
                    <div className="text-[11px] text-white/40 mt-0.5">Empfänger: {row.recipient}{row.vars?.length ? ` · Variablen: ${row.vars.map((v) => `{{${v}}}`).join(", ")}` : ""}</div>
                  </div>
                  {row.editable ? (
                    <button type="button" onClick={() => setEditing(row)} data-testid={`tpl-edit-${row.key}`} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">Bearbeiten</button>
                  ) : <span className="text-[11px] text-white/35">fester Text</span>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {editing ? <TemplateEditor template={editing} onClose={() => setEditing(null)} onSaved={load} /> : null}
    </AdminLayout>
  );
}

function TemplateEditor({ template, onClose, onSaved }) {
  const confirm = useConfirm();
  const [form, setForm] = useState({ subject: template.subject ?? "", html: template.html ?? "" });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const draft = () => ({ subject: form.subject, html: form.html });

  const loadPreview = useCallback(async (body) => {
    try {
      const { data } = await api.post(`/admin/email-templates/${template.key}/preview`, body);
      setPreview(data);
      if (body && Object.keys(body).length === 0 && !template.custom) setForm({ subject: data.subject, html: data.html });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Vorschau hat nicht geklappt.");
    }
  }, [template.key, template.custom]);
  // Beim Öffnen: den geltenden Stand zeigen - für feste Vorlagen der gerenderte Standard als Ausgangspunkt.
  useEffect(() => { loadPreview({}); }, [loadPreview]);

  const save = async () => {
    setBusy("save");
    try {
      await api.put(`/admin/email-templates/${template.key}`, draft());
      toast.success("Vorlage gespeichert – ab jetzt geht dieser Text raus.");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Speichern hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };
  const sendTest = async () => {
    setBusy("test");
    try {
      const { data } = await api.post(`/admin/email-templates/${template.key}/test`, draft());
      toast.success(`Testmail mit Beispieldaten an ${data.to} eingereiht.`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Testmail hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };
  const reset = async () => {
    const ok = await confirm({ title: "Auf Standard zurücksetzen?", description: "Dein Betreff und Text für diese Vorlage werden verworfen; ab dann geht wieder der Standard raus.", confirmLabel: "Zurücksetzen" });
    if (!ok) return;
    setBusy("reset");
    try {
      await api.post(`/admin/email-templates/${template.key}/reset`);
      toast.success("Standard wiederhergestellt.");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Zurücksetzen hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur p-4 overflow-y-auto" data-testid="tpl-editor">
      <div className="bg-[#121212] border border-white/10 rounded-sm w-full max-w-5xl mx-auto my-6 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="font-heading text-2xl font-black uppercase">{template.name}</h3>
            <p className="text-xs text-white/50 mt-1">{template.purpose} · Empfänger: {template.recipient}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Betreff</div>
              <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} data-testid="tpl-subject" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </label>
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Text (HTML)</div>
              <textarea rows={16} value={form.html} onChange={(e) => setForm((f) => ({ ...f, html: e.target.value }))} data-testid="tpl-html" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-xs font-mono" />
            </label>
            {template.vars?.length ? (
              <div className="text-xs text-white/50">Variablen: {template.vars.map((v) => (
                <button key={v} type="button" onClick={() => setForm((f) => ({ ...f, html: `${f.html}{{${v}}}` }))} data-testid={`tpl-var-${v}`} className="inline-block mr-1 mb-1 px-1.5 py-0.5 border border-white/15 rounded-sm font-mono text-[11px] hover:border-[#29B6E8]">{`{{${v}}}`}</button>
              ))}</div>
            ) : null}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Vorschau mit Beispieldaten</div>
              <button type="button" onClick={() => loadPreview(draft())} data-testid="tpl-preview" className="inline-flex items-center gap-1 text-xs text-[#29B6E8] hover:text-white"><Eye className="w-3.5 h-3.5" /> aktualisieren</button>
            </div>
            <div className="border border-white/10 rounded-sm bg-white">
              <div className="px-3 py-2 border-b border-black/10 text-sm text-black font-bold" data-testid="tpl-preview-subject">{preview?.subject || "–"}</div>
              <iframe title="Vorschau" sandbox="" srcDoc={preview?.html || "<p style='font-family:sans-serif;color:#666'>Vorschau lädt …</p>"} className="w-full h-[420px] bg-white" data-testid="tpl-preview-frame" />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-between gap-2 pt-4 mt-4 border-t border-white/10">
          <button type="button" onClick={reset} disabled={!!busy || !template.custom} data-testid="tpl-reset" className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-[#FF3B30] disabled:opacity-40"><RotateCcw className="w-3.5 h-3.5" /> Auf Standard zurücksetzen</button>
          <div className="flex gap-2">
            <button type="button" onClick={sendTest} disabled={!!busy} data-testid="tpl-test" className="inline-flex items-center gap-1 px-4 py-2 border border-[#29B6E8] text-[#29B6E8] text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-50"><Send className="w-3.5 h-3.5" /> Testmail an mich</button>
            <button type="button" onClick={save} disabled={!!busy} data-testid="tpl-save" className="inline-flex items-center gap-1 px-5 py-2 bg-[#FFD700] text-black text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-50"><Save className="w-3.5 h-3.5" /> {busy === "save" ? "Speichere …" : "Speichern"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
