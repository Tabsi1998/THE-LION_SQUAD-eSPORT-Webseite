import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, RefreshCw, Search, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";

function formatTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("de-DE");
  } catch {
    return value;
  }
}

function userLabel(user) {
  return user?.display_name || user?.username || user?.email || user?.id?.slice(0, 8) || "Benutzer";
}

export default function AdminMobilePushPage() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "LionsAPP Push-Test",
    body: "Wenn du diese Nachricht am Handy siehst, funktionieren Push-Benachrichtigungen.",
  });

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selected) || status?.user || null,
    [selected, status, users],
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "80" });
      if (q.trim()) params.set("q", q.trim());
      const { data } = await api.get(`/admin/mobile-push/users?${params.toString()}`);
      const rows = Array.isArray(data) ? data : [];
      setUsers(rows);
      if (!selected && rows[0]?.id) setSelected(rows[0].id);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [q, selected]);

  const loadStatus = useCallback(async (userId = selected) => {
    if (!userId) {
      setStatus(null);
      return;
    }
    try {
      const { data } = await api.get(`/admin/mobile-push/status/${userId}`);
      setStatus(data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, [selected]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadStatus(selected); }, [loadStatus, selected]);

  const sendTest = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/mobile-push/test", { user_id: selected, ...form });
      const count = Number(data?.notification?.push_sent_count || 0);
      toast.success(count > 0 ? `Push-Test gesendet (${count} Token).` : "In-App erstellt, aber kein aktiver Push-Token gefunden.");
      await loadStatus(selected);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const checkReceipts = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/mobile-push/receipts/${selected}`);
      toast.success(`${Number(data?.checked || 0)} Receipt(s) geprüft.`);
      await loadStatus(selected);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Mobile</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Push-Tests</h1>
        </div>
        <button
          onClick={() => { loadUsers(); loadStatus(); }}
          className="inline-flex items-center gap-2 border border-white/10 bg-[#121212] px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider hover:border-[#29B6E8]/50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <section className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
          <div className="p-3 border-b border-white/10">
            <label className="relative block">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Benutzer suchen..."
                className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2.5 rounded-sm text-sm"
              />
            </label>
          </div>
          <div className="max-h-[620px] overflow-y-auto divide-y divide-white/5">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => setSelected(user.id)}
                className={`w-full p-4 text-left hover:bg-white/5 ${selected === user.id ? "bg-[#29B6E8]/10" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <Smartphone className={`w-5 h-5 mt-0.5 ${user.has_enabled_token ? "text-[#29B6E8]" : "text-white/25"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold truncate">{userLabel(user)}</div>
                    <div className="text-xs text-white/45 truncate">@{user.username || "-"} · {user.enabled_token_count}/{user.token_count} aktiv</div>
                    <div className="text-[11px] text-white/35 mt-1">Letztes Update: {formatTime(user.latest_updated_at)}</div>
                    {user.last_receipt_error || user.last_ticket_error ? (
                      <div className="text-[11px] text-[#FF6B61] mt-1 truncate">{user.last_receipt_error || user.last_ticket_error}</div>
                    ) : null}
                  </div>
                </div>
              </button>
            ))}
            {!users.length && (
              <div className="p-8 text-center text-white/40">{loading ? "Lade Tokens..." : "Keine Push-Tokens gefunden"}</div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-white/40">Zielgerät</div>
                <h2 className="text-xl font-black">{userLabel(selectedUser)}</h2>
                <p className="text-sm text-white/45">{selectedUser?.email || selectedUser?.id || "Kein Benutzer ausgewählt"}</p>
              </div>
              <span className={`inline-flex items-center gap-2 border px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider ${status?.has_enabled_token ? "border-[#29B6E8]/40 text-[#29B6E8]" : "border-[#FFCC00]/40 text-[#FFD95A]"}`}>
                <CheckCircle2 className="w-4 h-4" /> {status?.enabled_count || 0} aktiv
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <span className="block text-xs text-white/45 mb-1">Titel</span>
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
                />
              </label>
              <label>
                <span className="block text-xs text-white/45 mb-1">Text</span>
                <input
                  value={form.body}
                  onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={sendTest}
                disabled={!selected || busy}
                className="inline-flex items-center gap-2 bg-[#29B6E8] text-black px-4 py-2 rounded-sm text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> Test senden
              </button>
              <button
                onClick={checkReceipts}
                disabled={!selected || busy}
                className="inline-flex items-center gap-2 border border-white/10 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider text-white/70 disabled:opacity-50"
              >
                <BellRing className="w-4 h-4" /> Receipts prüfen
              </button>
            </div>
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <h3 className="font-bold uppercase tracking-wider text-sm">Token-Status</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                  <tr>
                    <th className="text-left px-4 py-3">Token</th>
                    <th className="text-left px-4 py-3">Plattform</th>
                    <th className="text-left px-4 py-3">Aktiv</th>
                    <th className="text-left px-4 py-3">Ticket</th>
                    <th className="text-left px-4 py-3">Receipt</th>
                    <th className="text-left px-4 py-3">Letzter Versand</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(status?.tokens || []).map((token, index) => (
                    <tr key={`${token.token_preview}-${index}`}>
                      <td className="px-4 py-3 font-mono text-xs text-white/65">{token.token_preview}</td>
                      <td className="px-4 py-3">{token.platform || "-"}</td>
                      <td className="px-4 py-3">{token.enabled === false ? "Nein" : "Ja"}</td>
                      <td className="px-4 py-3 text-xs">
                        <div>{token.last_ticket_status || "-"}</div>
                        {token.last_ticket_error ? <div className="text-[#FF6B61]">{token.last_ticket_error}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>{token.last_receipt_status || "-"}</div>
                        {token.last_receipt_error ? <div className="text-[#FF6B61]">{token.last_receipt_error}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-white/50 text-xs">{formatTime(token.last_sent_at)}</td>
                    </tr>
                  ))}
                  {!(status?.tokens || []).length && (
                    <tr>
                      <td colSpan="6" className="text-center py-10 text-white/40">Keine Tokens für diesen Benutzer</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
