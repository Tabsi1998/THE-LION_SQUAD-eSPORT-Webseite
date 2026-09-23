import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError, formatMemberSince } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { feeCard, formatDate } from "@/lib/dolibarr";
import { MemberCardPanel } from "@/components/tls/MemberCardPanel";
import { SkeletonCards, SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { SwitchRow } from "@/pages/user/profile/SwitchRow";
import { toast } from "sonner";
import { Crown, Calendar, Hash, FileText, Eye, EyeOff, ArrowLeft, History, Wallet, Users } from "lucide-react";

const STATUS_LABELS = {
  active: "Aktives Mitglied", honorary: "Ehrenmitglied",
  pending: "Antrag offen", inactive: "Ruhend",
  former: "Ehemalig", blocked: "Gesperrt", none: "Keine Mitgliedschaft",
};
const TYPE_LABELS = {
  ordinary: "Ordentlich", supporting: "Unterstützend",
  honorary: "Ehrenmitglied", youth: "Jugend", guest: "Gast", former: "Ehemalig",
};

export default function MyMembershipPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    api.get("/membership/me").then(({ data }) => setData(data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "users"]);

  if (!data) return <PublicLayout><div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8"><SkeletonDetailHeader label="Lade Mitgliedschaft" /><SkeletonCards count={4} columns={4} image={false} label="Lade Mitgliedschaft" /></div></PublicLayout>;

  const m = data.membership;
  const erp = data.dolibarr;
  const fee = feeCard(erp);
  const canAskForLink = erp?.connected && !erp.led_by_dolibarr && !["verified", "requested"].includes(erp.link?.status);
  const memberSince = m?.member_since ? new Date(m.member_since) : null;
  const yearsAsMember = memberSince ? Math.floor((Date.now() - memberSince.getTime()) / (1000 * 60 * 60 * 24 * 365.25)) : null;

  return (
    <PublicLayout>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/members/area" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#FFD700]">
          <ArrowLeft className="w-3.5 h-3.5" /> Mitgliederbereich
        </Link>

        {/* Hero card */}
        <div className="mt-8 border border-[#FFD700]/40 bg-gradient-to-br from-[#FFD700]/15 via-[#FFD700]/5 to-transparent rounded-sm p-6 md:p-8 relative overflow-hidden">
          <div className="absolute -right-8 -top-8 opacity-10"><Crown className="w-48 h-48 text-[#FFD700]" /></div>
          <div className="relative">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">MEINE MITGLIEDSCHAFT</span>
            <h1 className="font-heading text-3xl md:text-5xl font-black uppercase mt-2">{user?.display_name || user?.username}</h1>
            {m?.member_number && (
              <div className="mt-3 inline-flex items-center gap-2 text-[#FFD700] font-mono text-lg font-bold">
                <Hash className="w-4 h-4" /> {m.member_number}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <Pill icon={Crown} label={STATUS_LABELS[m?.member_status] || "—"} variant={m?.member_status === "active" || m?.member_status === "honorary" ? "gold" : "muted"} />
              {m?.membership_type && <Pill label={TYPE_LABELS[m.membership_type]} />}
              {m?.internal_role && <Pill label={m.internal_role} />}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={Calendar} label="Mitglied seit" value={formatMemberSince(m?.member_since, m?.member_since_precision)} />
          <Stat icon={History} label="Aktiv" value={yearsAsMember !== null ? `${yearsAsMember} Jahr${yearsAsMember === 1 ? "" : "e"}` : "—"} />
          <Stat icon={m?.show_member_number_publicly ? Eye : EyeOff} label="Nummer öffentlich" value={m?.show_member_number_publicly ? "Ja" : "Nein"} />
          <Stat icon={FileText} label="Mitgliedsart" value={m?.membership_type ? TYPE_LABELS[m.membership_type] : "—"} />
        </div>

        {/* Digitale Mitgliedskarte (#346): nur für aktive Mitglieder, der Server entscheidet */}
        {(m?.member_status === "active" || m?.member_status === "honorary") && <MemberCardPanel />}

        {/* Mitgliederverzeichnis per Opt-in (#410): der Server sagt, ob die Person eintragen darf */}
        {(m?.member_status === "active" || m?.member_status === "honorary") && <DirectoryCard />}

        {/* Beitrag und Stand aus der Mitgliederverwaltung (#295) */}
        {fee && (
          <div className={`mt-6 border rounded-sm bg-[#121212] p-5 ${fee.tone === "warn" ? "border-[#FFD700]/40" : "border-white/10"}`} data-testid="membership-fee-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-heading text-lg font-black uppercase inline-flex items-center gap-2"><Wallet className="w-4 h-4 text-[#FFD700]" /> Mitgliedsbeitrag</h2>
              <span className={`text-[10px] font-black uppercase tracking-widest ${fee.tone === "warn" ? "text-[#FFD700]" : fee.tone === "info" ? "text-[#29B6E8]" : "text-[#00FF88]"}`}>{fee.label}</span>
            </div>
            {fee.amount && <div className="mt-2 font-heading text-2xl font-black">{fee.amount} <span className="text-xs text-white/40 font-normal">je Beitragsperiode</span></div>}
            <ul className="mt-2 space-y-1 text-sm text-white/75">
              {fee.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
            {!!erp.functions?.length && (
              <div className="mt-3 text-sm text-white/75">Funktion im Verein: {erp.functions.map((fn) => fn.label).join(", ")}</div>
            )}
            <div className={`mt-3 text-xs ${fee.stale ? "text-[#FFD700]" : "text-white/40"}`}>
              Stand aus der Mitgliederverwaltung vom {formatDate(fee.asOf)}{fee.stale ? " – seither nicht mehr abgeglichen" : ""}. Stimmt etwas nicht, melde dich beim Vorstand.
            </div>
          </div>
        )}
        {erp?.connected && !erp.led_by_dolibarr && (
          <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-link-card">
            <h2 className="font-heading text-lg font-black uppercase">Bist du Vereinsmitglied?</h2>
            {erp.link?.status === "requested" ? (
              <p className="mt-2 text-sm text-white/70">Deine Anfrage vom {formatDate(erp.link.requested_at)} liegt beim Vorstand. Sobald sie bestätigt ist, erscheint hier dein Beitragsstand.</p>
            ) : erp.link?.status === "conflict" ? (
              <p className="mt-2 text-sm text-white/70">Deine Zuordnung braucht eine Klärung durch den Vorstand (z. B. geteilte E-Mail-Adresse in der Familie). Du musst nichts tun.</p>
            ) : (
              <p className="mt-2 text-sm text-white/70">Dein Konto ist noch keinem Mitglied in der Mitgliederverwaltung zugeordnet. Der Vorstand prüft und bestätigt die Zuordnung – eine Mitgliedsnummer allein reicht dafür nicht.</p>
            )}
            {canAskForLink && <LinkRequest onDone={load} />}
          </div>
        )}

        {/* History */}
        {!!m?.history?.length && (
          <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5">
            <h2 className="font-heading text-lg font-black uppercase mb-4 inline-flex items-center gap-2"><History className="w-4 h-4 text-[#FFD700]" /> Verlauf</h2>
            <div className="space-y-3">
              {m.history.slice().reverse().map((h, idx) => (
                <div key={idx} className="flex items-start gap-3 text-sm border-l-2 border-[#FFD700]/40 pl-4">
                  <div className="flex-1">
                    <div className="text-white">
                      Status:{" "}
                      <strong className="text-[#FFD700]">{STATUS_LABELS[h.to_status] || h.to_status || "—"}</strong>
                      {h.from_status && h.from_status !== h.to_status && (
                        <span className="text-white/40"> (vorher: {STATUS_LABELS[h.from_status] || h.from_status})</span>
                      )}
                    </div>
                    <div className="text-xs text-white/40 mt-0.5">{new Date(h.at).toLocaleString("de-DE")}</div>
                    {h.source === "dolibarr" && <div className="text-xs text-white/45 mt-1">aus der Mitgliederverwaltung übernommen</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/profile" className="px-4 py-2 border border-[#29B6E8]/40 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs">Profil bearbeiten</Link>
          <Link to="/members/benefits" className="px-4 py-2 border border-[#FFD700]/40 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm text-xs">Vorteile ansehen</Link>
          {erp?.led_by_dolibarr && <Link to="/profile?tab=invoices" data-testid="membership-invoices-link" className="px-4 py-2 border border-[#FFD700]/40 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm text-xs">Meine Rechnungen</Link>}
          <Link to="/privacy-account" className="px-4 py-2 border border-white/15 text-white/70 hover:text-white font-bold uppercase tracking-wider rounded-sm text-xs">DSGVO / Datenexport</Link>
        </div>
      </section>
    </PublicLayout>
  );
}

function toDirectoryForm(entry) {
  return { gamertag: entry?.gamertag || "", games: (entry?.games || []).join(", "), platforms: (entry?.platforms || []).join(", "), bio: entry?.bio || "" };
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

// Der eigene Eintrag im Mitgliederverzeichnis (#410): einschalten, Gamertag, Spiele, Plattformen
// und eine kurze Bio pflegen; Name und Foto kommen vom Konto. Gesperrt heißt: nur der Vorstand
// kann das aufheben.
function DirectoryCard() {
  const [entry, setEntry] = useState(null);
  const [form, setForm] = useState(toDirectoryForm(null));
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/membership/me/directory").then(({ data }) => {
      if (data && typeof data.eligible === "boolean") { setEntry(data); setForm(toDirectoryForm(data.entry)); }
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!entry?.eligible) return null;

  const save = async (patch, successText) => {
    setBusy(true);
    try {
      const { data } = await api.put("/membership/me/directory", patch);
      setEntry(data);
      setForm(toDirectoryForm(data.entry));
      toast.success(successText);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Speichern hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e) => {
    e.preventDefault();
    save({ gamertag: form.gamertag, games: splitList(form.games), platforms: splitList(form.platforms), bio: form.bio }, "Eintrag gespeichert.");
  };
  const inputClass = "w-full bg-[#0A0A0A] border border-white/10 focus:border-[#FFD700] px-3 py-2 rounded-sm text-white text-sm focus:outline-none";

  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-directory-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-black uppercase inline-flex items-center gap-2"><Users className="w-4 h-4 text-[#FFD700]" /> Mitgliederverzeichnis</h2>
        {entry.listed && entry.slug && <Link to={`/members/${entry.slug}`} data-testid="membership-directory-link" className="text-xs uppercase tracking-wider font-bold text-[#FFD700]">Meinen Eintrag ansehen</Link>}
      </div>
      {entry.blocked ? (
        <p className="mt-3 text-sm text-[#FFD700]" data-testid="membership-directory-blocked">Dein Eintrag ist von der Vereinsverwaltung gesperrt. Wenn du meinst, das stimmt nicht, melde dich beim Vorstand.</p>
      ) : (
        <div className="mt-3">
          <SwitchRow
            label="Im Mitgliederverzeichnis zeigen"
            description="Auf der öffentlichen Seite „Vereinsmitglieder“ mit Gamertag, Foto, Spielen und Plattformen. Du kannst das jederzeit wieder ausschalten."
            checked={entry.listed}
            onCheckedChange={(next) => save({ listed: next }, next ? "Du stehst jetzt im Mitgliederverzeichnis." : "Dein Eintrag ist nicht mehr öffentlich.")}
            disabled={busy}
            testId="membership-directory-switch"
          />
        </div>
      )}
      {entry.listed && !entry.blocked && (
        <form onSubmit={submit} className="mt-4 space-y-3" data-testid="membership-directory-form">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">Gamertag
              <input value={form.gamertag} onChange={(e) => set("gamertag", e.target.value)} maxLength={40} data-testid="membership-directory-gamertag" className={`mt-1 ${inputClass} normal-case tracking-normal font-normal`} />
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">Spiele
              <input value={form.games} onChange={(e) => set("games", e.target.value)} placeholder="F1 25, Rocket League" data-testid="membership-directory-games" className={`mt-1 ${inputClass} normal-case tracking-normal font-normal`} />
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">Plattformen
              <input value={form.platforms} onChange={(e) => set("platforms", e.target.value)} placeholder="PC, PS5" data-testid="membership-directory-platforms" className={`mt-1 ${inputClass} normal-case tracking-normal font-normal`} />
            </label>
          </div>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">Kurze Bio
            <textarea value={form.bio} onChange={(e) => set("bio", e.target.value)} rows={3} maxLength={2000} data-testid="membership-directory-bio" className={`mt-1 ${inputClass} normal-case tracking-normal font-normal`} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} data-testid="membership-directory-save" className="px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">Eintrag speichern</button>
            <span className="text-xs text-white/45">{entry.editorial ? "Name, Foto und Funktion pflegt die Vereinsverwaltung an deinem Profil." : "Name und Foto kommen von deinem Konto (Profil bearbeiten)."}</span>
          </div>
        </form>
      )}
    </div>
  );
}

function LinkRequest({ onDone }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/membership/dolibarr/link-request", { member_ref: ref.trim() || null });
      toast.success("Anfrage gesendet – der Vorstand prüft sie.");
      onDone();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col sm:flex-row gap-2">
      <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} placeholder="Mitgliedsnummer (falls bekannt)" data-testid="membership-link-ref"
        className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm sm:w-64" />
      <button type="button" onClick={send} disabled={busy} data-testid="membership-link-request"
        className="px-4 py-2 border border-[#FFD700]/50 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">Zuordnung anfragen</button>
    </div>
  );
}

function Pill({ icon: Icon, label, variant }) {
  const cls = variant === "gold"
    ? "border-[#FFD700]/50 text-[#FFD700] bg-[#FFD700]/10"
    : "border-white/15 text-white/80";
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest font-bold border rounded-sm ${cls}`}>
      {Icon && <Icon className="w-3 h-3" />} {label}
    </span>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/50 font-bold">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="mt-2 font-heading font-bold">{value}</div>
    </div>
  );
}
