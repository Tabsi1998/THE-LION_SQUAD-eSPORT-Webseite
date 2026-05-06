import { useCallback, useEffect, useState } from "react";
import { api, formatMemberSince, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Crown, Search, X, Save } from "lucide-react";

const STATUS_LABELS = {
  none: "Kein Mitglied",
  pending: "Anfrage offen",
  active: "Aktives Mitglied",
  inactive: "Ruhend",
  honorary: "Ehrenmitglied",
  former: "Ehemalig",
  blocked: "Gesperrt",
};

const TYPE_LABELS = {
  ordinary: "Ordentlich",
  supporting: "Unterstützend",
  honorary: "Ehrenmitglied",
  youth: "Jugend",
  guest: "Gast",
  former: "Ehemalig",
};

const MONTHS = [
  ["", "Monat offen lassen"],
  ["01", "Januar"],
  ["02", "Februar"],
  ["03", "Maerz"],
  ["04", "April"],
  ["05", "Mai"],
  ["06", "Juni"],
  ["07", "Juli"],
  ["08", "August"],
  ["09", "September"],
  ["10", "Oktober"],
  ["11", "November"],
  ["12", "Dezember"],
];

function memberSinceParts(m) {
  if (!m?.member_since) return { year: "", month: "" };
  const date = new Date(m.member_since);
  if (Number.isNaN(date.getTime())) return { year: "", month: "" };
  const precision = m.member_since_precision || "day";
  return {
    year: String(date.getFullYear()),
    month: precision === "year" ? "" : String(date.getMonth() + 1).padStart(2, "0"),
  };
}

export default function AdminMembersPage() {
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ statuses: [], types: [] });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | community | members | pending
  const [editing, setEditing] = useState(null); // {user, membership}

  const load = useCallback(async () => {
    const { data } = await api.get(`/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    setUsers(data);
  }, [q]);
  useEffect(() => { api.get("/membership/meta").then(({ data }) => setMeta(data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["users", "membership"]);

  const filtered = users.filter((u) => {
    if (filter === "members") return u.is_club_member;
    if (filter === "community") return !u.is_club_member;
    if (filter === "pending") return u.membership?.member_status === "pending";
    return true;
  });

  const save = async (userId, payload) => {
    try {
      const { data } = await api.put(`/membership/user/${userId}`, payload);
      toast.success("Mitgliedschaft aktualisiert.");
      setEditing(null);
      load();
      return data;
    } catch (e) {
      toast.error(formatRequestError(e, "Mitgliedschaft konnte nicht gespeichert werden."));
      return null;
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">VEREIN</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Mitgliederverwaltung</h1>
          <p className="text-sm text-white/60 mt-1">Community-Spieler zu offiziellen Vereinsmitgliedern befördern, Status, Mitgliedsnummern und interne Rollen pflegen.</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            placeholder="Suche User / E-Mail / Mitgliedsnr. …"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="members-search"
            className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm"
          />
        </div>
        <div className="flex gap-2">
          {[
            { k: "all", l: "Alle" },
            { k: "members", l: "Mitglieder" },
            { k: "community", l: "Community" },
            { k: "pending", l: "Offen" },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setFilter(t.k)}
              data-testid={`members-filter-${t.k}`}
              className={`px-3 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${filter === t.k ? "bg-[#FFD700] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">E-Mail</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Nummer</th>
                <th className="text-left px-4 py-3">Typ</th>
                <th className="text-left px-4 py-3">Seit</th>
                <th className="text-left px-4 py-3">Rolle</th>
                <th className="text-center px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((u) => {
                const m = u.membership;
                return (
                  <tr key={u.id} className={u.is_banned ? "opacity-50" : ""}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-white flex items-center gap-1.5">
                        {u.display_name || u.username}
                        {u.is_club_member && <Crown className="w-3 h-3 text-[#FFD700]" />}
                      </div>
                      <div className="text-[11px] text-white/50">@{u.username}</div>
                    </td>
                    <td className="px-4 py-3 text-white/60 text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={m?.member_status || "none"} />
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[#FFD700]">{m?.member_number || "—"}</td>
                    <td className="px-4 py-3 text-xs text-white/70">{m?.membership_type ? TYPE_LABELS[m.membership_type] || m.membership_type : "—"}</td>
                    <td className="px-4 py-3 text-xs text-white/70">{formatMemberSince(m?.member_since, m?.member_since_precision)}</td>
                    <td className="px-4 py-3 text-xs text-white/70">{m?.internal_role || "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => setEditing({ user: u, membership: m })} data-testid={`member-edit-${u.username}`} className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-sm border border-[#FFD700]/40 text-[#FFD700] hover:bg-[#FFD700]/10 transition">
                        Bearbeiten
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditModal entry={editing} meta={meta} onClose={() => setEditing(null)} onSave={save} />
      )}
    </AdminLayout>
  );
}

function StatusPill({ status }) {
  const colors = {
    active: "bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/40",
    honorary: "bg-[#9F7AEA]/15 text-[#C4A0FF] border-[#9F7AEA]/40",
    pending: "bg-[#29B6E8]/15 text-[#29B6E8] border-[#29B6E8]/40",
    inactive: "bg-white/5 text-white/50 border-white/15",
    former: "bg-white/5 text-white/40 border-white/10",
    blocked: "bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/40",
    none: "bg-white/5 text-white/40 border-white/10",
  };
  return (
    <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-sm border ${colors[status] || colors.none}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function EditModal({ entry, meta, onClose, onSave }) {
  const u = entry.user;
  const m = entry.membership || {};
  const since = memberSinceParts(m);
  const [form, setForm] = useState({
    member_status: m.member_status || "none",
    membership_type: m.membership_type || "",
    member_number: m.member_number || "",
    member_since_year: since.year,
    member_since_month: since.month,
    internal_role: m.internal_role || "",
    notes: m.notes || "",
    show_member_number_publicly: !!m.show_member_number_publicly,
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = { ...form };
    if (!payload.membership_type) delete payload.membership_type;
    if (!payload.member_number) delete payload.member_number;
    if (payload.member_since_year) {
      payload.member_since = payload.member_since_month
        ? `${payload.member_since_year}-${payload.member_since_month}`
        : payload.member_since_year;
      payload.member_since_precision = payload.member_since_month ? "month" : "year";
    }
    delete payload.member_since_year;
    delete payload.member_since_month;
    await onSave(u.id, payload);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-lg bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h2 className="font-heading font-black uppercase">Mitgliedschaft bearbeiten</h2>
            <div className="text-xs text-white/50">{u.display_name || u.username} · @{u.username}</div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-white/60 hover:text-white" aria-label="Schließen"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <Field label="Status">
            <select value={form.member_status} onChange={(e) => set("member_status", e.target.value)} data-testid="edit-status" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
              {meta.statuses.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
            </select>
          </Field>
          <Field label="Mitgliedsart">
            <select value={form.membership_type} onChange={(e) => set("membership_type", e.target.value)} data-testid="edit-type" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
              <option value="">— wählen —</option>
              {meta.types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
            </select>
          </Field>
          <Field label="Mitgliedsnummer (leer = automatisch)">
            <input value={form.member_number} onChange={(e) => set("member_number", e.target.value)} placeholder="z.B. TLS-2026-0007" data-testid="edit-number" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm font-mono" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mitglied seit Jahr">
              <input
                type="number"
                min="1900"
                max={new Date().getFullYear()}
                value={form.member_since_year}
                onChange={(e) => set("member_since_year", e.target.value)}
                placeholder="z.B. 2024"
                data-testid="edit-member-since-year"
                className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm"
              />
            </Field>
            <Field label="Monat optional">
              <select
                value={form.member_since_month}
                onChange={(e) => set("member_since_month", e.target.value)}
                data-testid="edit-member-since-month"
                className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm"
              >
                {MONTHS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Interne Rolle">
            <input value={form.internal_role} onChange={(e) => set("internal_role", e.target.value)} placeholder="z.B. Vorstand, Captain, Helfer" data-testid="edit-role" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
          </Field>
          <Field label="Interne Notizen">
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} data-testid="edit-notes" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.show_member_number_publicly} onChange={(e) => set("show_member_number_publicly", e.target.checked)} data-testid="edit-show-number" className="accent-[#FFD700]" />
            <span>Mitgliedsnummer auf öffentlichem Profil anzeigen</span>
          </label>
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} data-testid="edit-save" className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#FFD700] text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-[#e8c200] disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
