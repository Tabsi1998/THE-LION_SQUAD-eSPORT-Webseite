import { useCallback, useEffect, useState, useRef } from "react";
import { API, api, formatApiError, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Plus, Save, X, Trash2, FileText, Pin, UploadCloud, Eye, Download } from "lucide-react";

const parseUploadMb = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DOCUMENT_UPLOAD_LIMIT_MB = parseUploadMb(
  process.env.REACT_APP_MAX_DOCUMENT_UPLOAD_MB || process.env.REACT_APP_MAX_IMAGE_UPLOAD_MB,
  50,
);
const PROXY_UPLOAD_LIMIT_MB = parseUploadMb(process.env.REACT_APP_PROXY_UPLOAD_LIMIT_MB, Math.ceil(DOCUMENT_UPLOAD_LIMIT_MB * 1.2));

const CATEGORY_LABELS = {
  statutes: "Statuten", minutes: "Protokolle", form: "Formular",
  regulations: "Regelwerk", guideline: "Leitlinie", download: "Download",
  media_kit: "Media Kit", presentation: "Präsentation", template: "Vorlage",
  other: "Sonstiges",
};

function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AdminDocumentsPage() {
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ categories: [], visibilities: [] });
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get("/documents/admin");
    setList(data);
  }, []);
  useEffect(() => { load(); api.get("/documents/meta").then(({ data }) => setMeta(data)).catch(() => {}); }, [load]);
  useApiInvalidation(load, ["documents", "uploads"]);

  const remove = async (id) => {
    if (!await confirm({
      title: "Dokument löschen?",
      description: "Das Dokument wird aus dem Mitglieder-CMS entfernt.",
      confirmLabel: "Löschen",
    })) return;
    try { await api.delete(`/documents/${id}`); toast.success("Gelöscht."); load(); } catch (err) { toast.error(formatRequestError(err, "Dokument konnte nicht geloescht werden.")); }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">VEREINS-CMS</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Dokumente & Downloads</h1>
        </div>
        <button onClick={() => setEditing({})} data-testid="docs-new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#e8c200] transition">
          <Plus className="w-3.5 h-3.5" /> Neues Dokument
        </button>
      </div>

      {list.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
          <FileText className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <div className="font-heading font-bold">Noch keine Dokumente</div>
        </div>
      ) : (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                <tr>
                  <th className="text-left px-4 py-3">Titel</th>
                  <th className="text-left px-4 py-3">Kategorie</th>
                  <th className="text-left px-4 py-3">Sichtbar</th>
                  <th className="text-left px-4 py-3">Größe</th>
                  <th className="text-left px-4 py-3">Nutzung</th>
                  <th className="text-left px-4 py-3">Download</th>
                  <th className="text-center px-4 py-3">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {list.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-white flex items-center gap-1.5">
                        {d.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
                        {d.title}
                      </div>
                      <div className="text-[11px] text-white/50 truncate max-w-xs">{d.original_filename}</div>
                    </td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-[#FFD700] font-bold">{CATEGORY_LABELS[d.category] || d.category}</td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-white/60 font-bold">{d.visibility}</td>
                    <td className="px-4 py-3 text-xs text-white/65">{fmtSize(d.file_size)}</td>
                    <td className="px-4 py-3 text-xs text-white/55">{d.view_count || 0} Ansicht(en) · {d.download_count || 0} Download(s)</td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest font-bold">
                      <span className={d.allow_download ? "text-[#00FF88]" : "text-white/35"}>{d.allow_download ? "erlaubt" : "inline"}</span>
                    </td>
                    <td className="px-4 py-3 text-center space-x-1 whitespace-nowrap">
                      <a href={`${API}/documents/${d.id}/view`} target="_blank" rel="noreferrer" className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-white/15 text-white/70 hover:text-white inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Ansicht</a>
                      <a href={`${API}/documents/${d.id}/download`} target="_blank" rel="noreferrer" className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-white/15 text-white/70 hover:text-white inline-flex items-center gap-1"><Download className="w-3 h-3" /> Datei</a>
                      <button onClick={() => setEditing(d)} data-testid={`doc-edit-${d.id}`} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#FFD700]/40 text-[#FFD700] hover:bg-[#FFD700]/10">Bearbeiten</button>
                      <button onClick={() => remove(d.id)} data-testid={`doc-delete-${d.id}`} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 inline-flex items-center"><Trash2 className="w-3 h-3" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <DocModal doc={editing} meta={meta} onClose={() => setEditing(null)} onSaved={load} />}
    </AdminLayout>
  );
}

function DocModal({ doc, meta, onClose, onSaved }) {
  const isNew = !doc?.id;
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    title: doc.title || "",
    description: doc.description || "",
    category: doc.category || "other",
    visibility: doc.visibility || "members",
    file_url: doc.file_url || "",
    storage_key: doc.storage_key || "",
    original_filename: doc.original_filename || "",
    file_size: doc.file_size || 0,
    mime: doc.mime || "",
    tags: (doc.tags || []).join(", "),
    pinned: doc.pinned ?? false,
    allow_download: doc.allow_download ?? false,
    order_index: doc.order_index ?? 0,
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > DOCUMENT_UPLOAD_LIMIT_MB * 1024 * 1024) {
      toast.error(`Datei zu gross (max ${DOCUMENT_UPLOAD_LIMIT_MB} MB)`);
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/uploads/document", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({
        ...f,
        file_url: data.url,
        storage_key: data.storage_key || data.filename,
        original_filename: data.original_filename,
        file_size: data.size,
        mime: data.mime,
        title: f.title || (data.original_filename || "").replace(/\.[^.]+$/, ""),
      }));
      toast.success("Datei hochgeladen.");
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      const message = status === 413
        ? `Datei zu gross oder Reverse Proxy blockiert den Upload. App-Limit: ${DOCUMENT_UPLOAD_LIMIT_MB} MB, externer Proxy bitte auf mindestens ${PROXY_UPLOAD_LIMIT_MB} MB setzen.`
        : detail ? formatApiError(detail) : "Upload fehlgeschlagen.";
      toast.error(status ? `Upload fehlgeschlagen (${status}): ${message}` : message);
    } finally {
      e.target.value = "";
      setUploading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.storage_key && !form.file_url) { toast.error("Bitte zuerst eine Datei hochladen."); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
        order_index: parseInt(form.order_index) || 0,
        file_size: parseInt(form.file_size) || null,
      };
      if (isNew) await api.post("/documents", payload);
      else await api.patch(`/documents/${doc.id}`, payload);
      toast.success("Gespeichert.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(formatRequestError(err, "Dokument konnte nicht gespeichert werden.", { title: form.title }));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-xl bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">{isNew ? "Neues Dokument" : "Dokument bearbeiten"}</h2>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* File upload */}
          <div className="border border-dashed border-[#FFD700]/40 rounded-sm p-5 bg-[#0A0A0A] text-center">
            <input ref={fileRef} type="file" onChange={upload} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.csv,.md,.png,.jpg,.jpeg" data-testid="doc-file" />
            {(form.storage_key || form.file_url) ? (
              <div className="text-sm">
                <div className="font-mono text-xs text-white/60 break-all">{form.original_filename || form.file_url}</div>
                <div className="text-[10px] uppercase tracking-widest text-[#FFD700] mt-1">{fmtSize(form.file_size)} · {form.mime || "Datei"}</div>
                <button type="button" onClick={() => fileRef.current.click()} disabled={uploading} className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold border border-white/20 text-white/70 rounded-sm">
                  <UploadCloud className="w-3 h-3" /> Datei ersetzen
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current.click()} disabled={uploading} data-testid="doc-upload-btn" className="inline-flex items-center gap-2 text-sm text-[#FFD700] font-bold uppercase tracking-wider">
                <UploadCloud className="w-4 h-4" /> {uploading ? "Lade hoch…" : `Datei auswählen (max ${DOCUMENT_UPLOAD_LIMIT_MB} MB)`}
              </button>
            )}
          </div>

          <Field label="Titel"><Input value={form.title} onChange={(v) => set("title", v)} testId="doc-title" required /></Field>
          <Field label="Beschreibung"><textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kategorie">
              <select value={form.category} onChange={(e) => set("category", e.target.value)} data-testid="doc-category" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                {meta.categories.map((c) => <option key={c.k} value={c.k}>{c.l}</option>)}
              </select>
            </Field>
            <Field label="Sichtbarkeit">
              <select value={form.visibility} onChange={(e) => set("visibility", e.target.value)} data-testid="doc-visibility" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                {meta.visibilities.map((v) => <option key={v.k} value={v.k}>{v.l}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Tags (Komma-getrennt)"><Input value={form.tags} onChange={(v) => set("tags", v)} placeholder="2026, Vorstand, GV" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sortierung"><Input value={form.order_index} onChange={(v) => set("order_index", v)} /></Field>
            <label className="flex items-end gap-2 text-sm pb-2">
              <input type="checkbox" checked={form.pinned} onChange={(e) => set("pinned", e.target.checked)} className="accent-[#FFD700]" />
              <Pin className="w-3 h-3 text-[#FFD700]" /> Anpinnen
            </label>
          </div>
          <label className="flex items-start gap-3 border border-white/10 rounded-sm bg-[#0A0A0A] p-3 text-sm text-white/70">
            <input type="checkbox" checked={form.allow_download} onChange={(e) => set("allow_download", e.target.checked)} className="accent-[#FFD700] mt-1" />
            <span>
              <span className="block font-bold text-white">Download erlauben</span>
              <span className="block text-xs text-white/45 mt-0.5">Standard ist nur Inline-Ansicht. Aktivieren, wenn Mitglieder die Datei bewusst herunterladen sollen.</span>
            </span>
          </label>
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} data-testid="doc-save" className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#FFD700] text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-[#e8c200] disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>{children}</label>;
}
function Input({ value, onChange, placeholder, testId, required }) {
  return <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} required={required} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />;
}
