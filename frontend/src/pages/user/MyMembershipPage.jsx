import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Crown, Calendar, Hash, FileText, Eye, EyeOff, ArrowLeft, History } from "lucide-react";

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

  useEffect(() => {
    api.get("/membership/me").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  if (!data) return <PublicLayout><div className="p-20 text-center text-white/40">Lade …</div></PublicLayout>;

  const m = data.membership;
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
          <Stat icon={Calendar} label="Mitglied seit" value={memberSince ? memberSince.toLocaleDateString("de-DE", { dateStyle: "long" }) : "—"} />
          <Stat icon={History} label="Aktiv" value={yearsAsMember !== null ? `${yearsAsMember} Jahr${yearsAsMember === 1 ? "" : "e"}` : "—"} />
          <Stat icon={m?.show_member_number_publicly ? Eye : EyeOff} label="Nummer öffentlich" value={m?.show_member_number_publicly ? "Ja" : "Nein"} />
          <Stat icon={FileText} label="Mitgliedsart" value={m?.membership_type ? TYPE_LABELS[m.membership_type] : "—"} />
        </div>

        {/* Notes */}
        {m?.notes && (
          <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5">
            <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">Notiz vom Vorstand</div>
            <div className="text-sm text-white/85 whitespace-pre-line">{m.notes}</div>
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
                    {h.notes && <div className="text-xs text-white/60 mt-1 italic">„{h.notes}"</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/profile" className="px-4 py-2 border border-[#29B6E8]/40 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs">Profil bearbeiten</Link>
          <Link to="/members/benefits" className="px-4 py-2 border border-[#FFD700]/40 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm text-xs">Vorteile ansehen</Link>
          <Link to="/privacy-account" className="px-4 py-2 border border-white/15 text-white/70 hover:text-white font-bold uppercase tracking-wider rounded-sm text-xs">DSGVO / Datenexport</Link>
        </div>
      </section>
    </PublicLayout>
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
