/**
 * Phase F — Admin CMS-Pages + Email-Templates editor.
 *
 * Two tabs in one shell. Markdown-light editor (textarea preview side-by-side).
 */
import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import { FileText, Mail, Save, Plus, Trash2, X, Eye, EyeOff } from "lucide-react";

export default function AdminCmsPage() {
  const [tab, setTab] = useState("pages");
  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Phase F</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Web-CMS</h1>
      <p className="mt-2 text-white/55 text-sm max-w-2xl">Verwalte statische Seiten und E-Mail-Templates direkt im Admin-Panel — ohne Code-Deploy.</p>

      <div className="mt-6 flex gap-1 border-b border-white/10">
        {[
          ["pages", "Seiten", FileText],
          ["templates", "E-Mail-Templates", Mail],
        ].map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`cms-tab-${k}`} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 border-b-2 transition ${tab === k ? "border-[#FFD700] text-[#FFD700]" : "border-transparent text-white/50 hover:text-white"}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "pages" && <PagesTab />}
        {tab === "templates" && <TemplatesTab />}
      </div>
    </AdminLayout>
  );
}

// -------- Pages --------
function PagesTab() {
  const [pages, setPages] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = () => api.get("/admin/pages").then(({ data }) => setPages(data));
  useEffect(() => { load(); }, []);

  const togglePub = async (p) => {
    try { await api.patch(`/admin/pages/${p.slug}`, { is_published: !(p.is_published ?? true) }); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };
  const del = async (p) => {
    if (!window.confirm(`Seite "${p.title}" wirklich löschen?`)) return;
    try { await api.delete(`/admin/pages/${p.slug}`); toast.success("Gelöscht"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-white/50">{pages.length} Seiten · {pages.filter(p => p.is_default).length} system</span>
        <button onClick={() => setCreating(true)} data-testid="page-new" className="px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 text-xs"><Plus className="w-3.5 h-3.5" /> Neue Seite</button>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]" data-testid="pages-table">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr><th className="text-left px-4 py-3">Slug</th><th className="text-left px-4 py-3">Titel</th><th className="text-left px-4 py-3">Sichtbar</th><th className="text-left px-4 py-3">Geändert</th><th className="text-right px-4 py-3">Aktionen</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pages.map(p => (
                <tr key={p.slug} data-testid={`page-row-${p.slug}`}>
                  <td className="px-4 py-3 text-xs font-mono text-white/40">/{p.slug}</td>
                  <td className="px-4 py-3 font-semibold">{p.title}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => togglePub(p)} className={`text-xs uppercase tracking-wider font-bold inline-flex items-center gap-1 ${p.is_published !== false ? "text-[#00FF88]" : "text-white/40"}`}>
                      {p.is_published !== false ? <><Eye className="w-3 h-3" /> Live</> : <><EyeOff className="w-3 h-3" /> Versteckt</>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/45 whitespace-nowrap">{p.updated_at ? new Date(p.updated_at).toLocaleDateString("de-DE") : "—"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(p)} className="text-[#29B6E8] hover:underline mr-3 text-xs">Bearbeiten</button>
                    {!p.is_default && <button onClick={() => del(p)} className="text-[#FF3B30] hover:underline text-xs">Löschen</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {(creating || editing) && (
        <PageEditor page={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={load} />
      )}
    </div>
  );
}

function PageEditor({ page, onClose, onSaved }) {
  const isNew = !page;
  const [form, setForm] = useState({
    slug: page?.slug || "",
    title: page?.title || "",
    body_md: page?.body_md || "",
    meta_description: page?.meta_description || "",
    is_published: page?.is_published ?? true,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (isNew) await api.post("/admin/pages", form);
      else await api.patch(`/admin/pages/${page.slug}`, { ...form, slug: undefined });
      toast.success("Gespeichert"); onSaved(); onClose();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur p-4 overflow-y-auto">
      <div className="bg-[#121212] border border-white/10 rounded-sm w-full max-w-5xl mx-auto my-6 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-2xl font-black uppercase">{isNew ? "Neue Seite" : `Seite: /${page.slug}`}</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Field label="Slug (URL-Pfad)"><input required disabled={!isNew} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} data-testid="page-slug" className="input" placeholder="z. B. statuten" /></Field>
            <Field label="Titel"><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="page-title" className="input" /></Field>
            <Field label="Meta-Description (SEO)"><input value={form.meta_description} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} className="input" /></Field>
            <Field label="Inhalt (Markdown-Light: # ## ### **bold** *italic* [Link](url) - Liste 1. Liste)">
              <textarea rows={18} value={form.body_md} onChange={(e) => setForm({ ...form, body_md: e.target.value })} data-testid="page-body" className="input font-mono text-xs" />
            </Field>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} className="accent-[#FFD700]" /> Veröffentlicht
            </label>
          </div>
          <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 overflow-y-auto max-h-[70vh]">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Vorschau</div>
            <h2 className="font-heading text-2xl font-black uppercase mb-3">{form.title || "Titel…"}</h2>
            <div className="prose-cms text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(form.body_md) }} />
            <style>{`.prose-cms h1{font-size:1.25rem;font-weight:700;margin:1em 0 0.4em;color:#fff}.prose-cms h2{font-size:1.1rem;font-weight:700;margin:1em 0 0.3em;color:#fff}.prose-cms h3{font-weight:700;margin:0.8em 0 0.3em;color:#fff}.prose-cms p{margin-bottom:0.8em;color:rgba(255,255,255,.7)}.prose-cms a{color:#29B6E8;text-decoration:underline}.prose-cms ul{padding-left:1.25rem;list-style-type:disc}.prose-cms ol{padding-left:1.25rem;list-style-type:decimal}.prose-cms strong{color:#fff}`}</style>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/60 hover:text-white">Abbrechen</button>
          <button onClick={save} disabled={saving} data-testid="page-save" className="px-5 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center gap-2"><Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}</button>
        </div>
        <style>{`.input{ width:100%; background:#0A0A0A; border:1px solid rgba(255,255,255,0.1); padding:0.5rem 0.75rem; border-radius:2px; font-size:13px; color:#fff; }`}</style>
      </div>
    </div>
  );
}

// -------- Email Templates --------
function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/admin/email-templates").then(({ data }) => setTemplates(data));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <table className="w-full text-sm" data-testid="templates-table">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr><th className="text-left px-4 py-3">Schlüssel</th><th className="text-left px-4 py-3">Bezeichnung</th><th className="text-left px-4 py-3">Subject</th><th className="text-right px-4 py-3">Aktionen</th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {templates.map(t => (
              <tr key={t.key} data-testid={`tpl-row-${t.key}`}>
                <td className="px-4 py-3 text-xs font-mono text-white/40">{t.key}</td>
                <td className="px-4 py-3 font-semibold">{t.name}</td>
                <td className="px-4 py-3 text-white/65 truncate max-w-md">{t.subject}</td>
                <td className="px-4 py-3 text-right"><button onClick={() => setEditing(t)} className="text-[#29B6E8] hover:underline text-xs">Bearbeiten</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function TemplateEditor({ template, onClose, onSaved }) {
  const [form, setForm] = useState({ name: template.name, subject: template.subject, html: template.html });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await api.patch(`/admin/email-templates/${template.key}`, form); toast.success("Gespeichert"); onSaved(); onClose(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur p-4 overflow-y-auto">
      <div className="bg-[#121212] border border-white/10 rounded-sm w-full max-w-3xl mx-auto my-6 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-2xl font-black uppercase">Template: {template.key}</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <Field label="Bezeichnung"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></Field>
          <Field label="Subject"><input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} data-testid="tpl-subject" className="input" /></Field>
          <Field label={`HTML (verfügbare Variablen: ${(template.vars || []).map(v => `{{${v}}}`).join(", ")})`}>
            <textarea rows={14} value={form.html} onChange={(e) => setForm({ ...form, html: e.target.value })} data-testid="tpl-html" className="input font-mono text-xs" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/60 hover:text-white">Abbrechen</button>
          <button onClick={save} disabled={saving} data-testid="tpl-save" className="px-5 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs">{saving ? "Speichere…" : "Speichern"}</button>
        </div>
        <style>{`.input{ width:100%; background:#0A0A0A; border:1px solid rgba(255,255,255,0.1); padding:0.5rem 0.75rem; border-radius:2px; font-size:13px; color:#fff; }`}</style>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>{children}</label>;
}

// Re-implement minimal renderer here to avoid coupling with public CmsPage
function renderMarkdownLite(md) {
  if (!md) return "";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split(/\r?\n/);
  let html = ""; let inList = null;
  const close = () => { if (inList) { html += inList === "ul" ? "</ul>" : "</ol>"; inList = null; } };
  for (let raw of lines) {
    let line = esc(raw)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    if (/^###\s+/.test(raw)) { close(); html += `<h3>${line.replace(/^###\s+/, "")}</h3>`; continue; }
    if (/^##\s+/.test(raw))  { close(); html += `<h2>${line.replace(/^##\s+/, "")}</h2>`; continue; }
    if (/^#\s+/.test(raw))   { close(); html += `<h1>${line.replace(/^#\s+/, "")}</h1>`; continue; }
    if (/^\s*[-*]\s+/.test(raw)) { if (inList !== "ul") { close(); html += "<ul>"; inList = "ul"; } html += `<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`; continue; }
    if (/^\s*\d+\.\s+/.test(raw)) { if (inList !== "ol") { close(); html += "<ol>"; inList = "ol"; } html += `<li>${line.replace(/^\s*\d+\.\s+/, "")}</li>`; continue; }
    if (raw.trim() === "") { close(); continue; }
    close(); html += `<p>${line}</p>`;
  }
  close();
  return html;
}
