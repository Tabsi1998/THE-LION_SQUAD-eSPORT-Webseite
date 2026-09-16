import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Crown, LayoutDashboard, LogOut, MessageSquare, Settings, Shield } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { resolveMediaUrl } from "@/lib/api";

// Das Benutzermenü im Kopf (#282): ein Knopf mit Avatar und Name, dahinter
// Dashboard, Mein Profil, Nachrichten, Mitgliederbereich (Mitglieder), Admin
// (Admins) und Abmelden. Vorher standen sechs Knöpfe nebeneinander, und seit
// #256 fehlte der Weg ins Profil ganz.
function Avatar({ user }) {
  const [failed, setFailed] = useState(false);
  const url = user?.avatar_url ? resolveMediaUrl(user.avatar_url) : "";
  const label = user?.display_name || user?.username || "";
  const initials = (label || "TL").slice(0, 2).toUpperCase();
  return (
    <span className="w-7 h-7 shrink-0 rounded-sm border border-white/15 bg-[#121212] overflow-hidden inline-flex items-center justify-center font-heading font-black text-[11px] text-[#29B6E8]">
      {url && !failed ? <img src={url} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} /> : <span>{initials}</span>}
    </span>
  );
}

const itemClass = "flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-white/80 hover:bg-white/5 hover:text-white transition";

export function UserMenu() {
  const { user, logout, isAdmin, isClubMember } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
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
  }, [open]);

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
        className={`inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 text-xs font-bold uppercase tracking-wider border rounded-sm transition ${open ? "border-[#29B6E8]/50 text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 text-white/80 hover:border-[#29B6E8]/40 hover:text-[#29B6E8]"}`}
      >
        <Avatar user={user} />
        <span className="max-w-[10rem] truncate">{name}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div role="menu" data-testid="nav-user-menu" className="absolute right-0 top-full mt-2 w-60 border border-white/10 bg-[#0F0F10] rounded-sm shadow-2xl shadow-black/70 overflow-hidden z-[70]">
          <div className="px-3 py-2.5 border-b border-white/10">
            <div className="font-bold text-sm text-white truncate">{name}</div>
            <div className="text-[11px] text-white/45 truncate">@{user.username}</div>
          </div>
          <Link to="/dashboard" role="menuitem" onClick={close} data-testid="nav-dashboard" className={itemClass}><LayoutDashboard className="w-3.5 h-3.5" /> Dashboard</Link>
          <Link to="/profile" role="menuitem" onClick={close} data-testid="nav-profile" className={itemClass}><Settings className="w-3.5 h-3.5" /> Mein Profil</Link>
          <Link to="/messages" role="menuitem" onClick={close} data-testid="nav-messages-menu" className={itemClass}><MessageSquare className="w-3.5 h-3.5" /> Nachrichten</Link>
          {isClubMember ? (
            <Link to="/members/area" role="menuitem" onClick={close} data-testid="nav-member-area" className={`${itemClass} text-[#FFD700] hover:text-[#FFD700]`}><Crown className="w-3.5 h-3.5" /> Mitgliederbereich</Link>
          ) : null}
          {isAdmin ? (
            <Link to="/admin" role="menuitem" onClick={close} data-testid="nav-admin-menu" className={`${itemClass} text-[#29B6E8] hover:text-[#29B6E8]`}><Shield className="w-3.5 h-3.5" /> Admin</Link>
          ) : null}
          <button type="button" role="menuitem" onClick={doLogout} data-testid="nav-logout" className={`${itemClass} w-full text-left text-[#FF3B30] hover:text-[#FF3B30] border-t border-white/10`}>
            <LogOut className="w-3.5 h-3.5" /> Abmelden
          </button>
        </div>
      ) : null}
    </div>
  );
}
