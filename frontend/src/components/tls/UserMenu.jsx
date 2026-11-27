import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ClipboardList, Eye, LogOut, Shield, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { resolveMediaUrl } from "@/lib/api";
import { useUserMenu } from "@/lib/mobileMenu";
import { isAnyAdmin, mfaSetupPath, showsDutyEntry } from "@/lib/permissions";
import { LazyImg } from "@/components/tls/LazyImg";
import { userMenuEntries, userMenuTestId } from "@/pages/user/profile/constants";

// Das Benutzermenü im Kopf (#282, #516, #1150, #2059): ein Knopf mit Avatar und Name, dahinter oben der eigene Name als
// Weg zum öffentlichen Profil („So sehen andere mich“), dann die Liste aus userMenuEntries - das Dashboard und „Mein
// Bereich“ mit seinen Gruppen, direkt anspringbar -, Admin (Admins) und Abmelden. Jedes Thema an genau einem Ort: Chats
// unter Community, die Liste der Benachrichtigungen hinter der Glocke.
function Avatar({ user }) {
  const [failed, setFailed] = useState(false);
  const url = user?.avatar_url ? resolveMediaUrl(user.avatar_url) : "";
  const label = user?.display_name || user?.username || "";
  const initials = (label || "TL").slice(0, 2).toUpperCase();
  return (
    <span className="w-7 h-7 shrink-0 rounded-sm border border-white/15 bg-[#121212] overflow-hidden inline-flex items-center justify-center tls-type-small font-black text-[#29B6E8]">
      {/* Im Kopf jeder Seite (#1227): die 160er Fassung statt des Originals - das waren oft über 1000 Pixel für 28. */}
      {url && !failed ? <LazyImg src={url} widths={[160]} sizes="28px" loading="eager" alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} /> : <span>{initials}</span>}
    </span>
  );
}

// Grundklasse ohne Textfarbe (#431): Gold für den Mitgliederbereich, Blau für Admin und Rot für
// Abmelden kamen vorher als Zusatz zu `text-white/80` - und blieben im Browser weiß.
const itemBase = "flex items-center gap-2.5 px-3 py-2.5 tls-type-label transition";
const itemClass = `${itemBase} text-white/80 hover:bg-white/5 hover:text-white`;
const adminClass = `${itemBase} text-[#29B6E8] hover:bg-[#29B6E8]/10`;
const logoutClass = `${itemBase} w-full text-left text-[#FF3B30] hover:bg-[#FF3B30]/10 border-t border-white/10`;

export function UserMenu() {
  const { user, logout, isAdmin, adminNeedsSecondFactor } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Geteilt mit dem Kopf des Seitenwechsels (#1324): ein Klick auf den Namen, während die Seite lädt, geht nicht verloren.
  const [open, setOpen] = useUserMenu(pathname);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  if (!user) return null;

  const close = () => setOpen(false);
  const doLogout = async () => {
    if (await logout()) {
      close();
      navigate("/");
    }
  };
  const name = user.display_name || user.username;

  return (
    <div ref={boxRef} className="relative hidden md:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        data-testid="nav-user"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Benutzermenü ${name}`}
        className={`inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 tls-type-label border rounded-sm transition ${open ? "border-[#29B6E8]/50 text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 text-white/80 hover:border-[#29B6E8]/40 hover:text-[#29B6E8]"}`}
      >
        <Avatar user={user} />
        {/* Im Kopf bleibt der eigene Name einzeilig (#1314: die Kopfzeile behält ihre Höhe) - ganz steht er im title, im
            aria-label und im geöffneten Menü. */}
        <span className="max-w-[10rem] truncate lg:hidden min-[1440px]:inline" title={name}>{name}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div role="menu" data-testid="nav-user-menu" className="absolute right-0 top-full mt-2 w-60 border border-white/10 bg-[#0F0F10] rounded-sm shadow-2xl shadow-black/70 overflow-hidden z-[70]">
          {/* Der eigene Name öffnet das öffentliche Profil (#2059) - so, wie andere es sehen. */}
          <Link to={`/u/${encodeURIComponent(user.username)}`} role="menuitem" onClick={close} data-testid={userMenuTestId("profile")} className="block px-3 py-2.5 border-b border-white/10 hover:bg-white/5 transition-colors">
            <span className="tls-wrap block font-bold tls-type-small text-white" data-testid="nav-user-menu-name">{name}</span>
            <span className="tls-wrap flex items-center gap-1.5 tls-type-small text-white/45">@{user.username} · <Eye className="w-3 h-3 shrink-0" aria-hidden="true" /> So sehen andere mich</span>
          </Link>
          {userMenuEntries({ mitglied: Boolean(user.is_club_member) || isAnyAdmin(user) }).map((entry, index, list) => (
            <Link key={entry.key} to={entry.to} role="menuitem" onClick={close} data-testid={userMenuTestId(entry.key)} className={`${itemClass} ${entry.bereich && !list[index - 1]?.bereich ? "border-t border-white/10" : ""}`.trim()}>
              <entry.icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> <span className="tls-wrap min-w-0">{entry.label}</span>
            </Link>
          ))}
          <div className="border-t border-white/10" />
          {/* Ohne bestätigte Zwei-Faktor-Anmeldung (#1028) führt der Eintrag zur Einrichtung statt in die Verwaltung. */}
          {isAdmin && adminNeedsSecondFactor ? (
            <Link to={mfaSetupPath("/admin")} role="menuitem" onClick={close} data-testid="nav-mfa-setup" className={adminClass}><ShieldCheck className="w-3.5 h-3.5" /> 2FA einrichten</Link>
          ) : isAdmin ? (
            <Link to="/admin" role="menuitem" onClick={close} data-testid="nav-admin" className={adminClass}><Shield className="w-3.5 h-3.5" /> Admin</Link>
          ) : null}
          {/* „Mein Dienst“ (#1352): Helfer und Moderation ohne Verwaltungsbereich - /admin führt auf ihre Arbeit. */}
          {showsDutyEntry(user) ? (
            <Link to="/admin" role="menuitem" onClick={close} data-testid="nav-duty" className={adminClass}><ClipboardList className="w-3.5 h-3.5" /> Mein Dienst</Link>
          ) : null}
          <button type="button" role="menuitem" onClick={doLogout} data-testid="nav-logout" className={logoutClass}>
            <LogOut className="w-3.5 h-3.5" /> Abmelden
          </button>
        </div>
      ) : null}
    </div>
  );
}
