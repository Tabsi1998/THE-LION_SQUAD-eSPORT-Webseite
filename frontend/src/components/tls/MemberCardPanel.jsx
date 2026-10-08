import { useCallback, useEffect, useRef, useState } from "react";
import { Download, QrCode, RefreshCw, Smartphone, WifiOff } from "lucide-react";
import { toBlob } from "html-to-image";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { refreshDelayMs, validUntilLine } from "@/lib/memberCard";
import { cardChanged, loadOfflineCard, saveOfflineCard, shareOrDownload, standLine, storeOfflineCardImage } from "@/lib/memberCardOffline";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";
import { MemberCardArt } from "@/components/tls/MemberCardArt";

// Die Mitgliedskarte auf „Meine Mitgliedschaft“ (#346, #1335, #1256): die Karte wie auf „Mitglied werden“ (schwarz mit
// Gold), daneben groß der Prüfcode - er erneuert sich vor Ablauf von selbst. „Als Bild speichern“ legt die Karte ohne
// gültigen Code ins Fotoalbum (am Handy über das Teilen-Menü, am PC als Download). Ohne Netz zeigt die Seite die zuletzt
// geladene Karte mit „Stand“ und statt des Codes „Prüfcode braucht Netz“; das Bild liegt auch für die installierte Website
// bereit. Abmelden löscht die gespeicherte Karte.

const IMAGE_OPTIONS = { pixelRatio: 2, cacheBust: true };

export function MemberCardPanel() {
  const { user } = useAuth();
  const userId = user?.id || "";
  const [card, setCard] = useState(null);
  const [offline, setOffline] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const imageNode = useRef(null);
  const lastStored = useRef(null);

  const rememberImage = useCallback(async (snapshot) => {
    // Ein neues Bild nur, wenn sich auf der Karte etwas geändert hat - nicht bei jedem neuen Prüfcode.
    if (!imageNode.current || !cardChanged(lastStored.current, snapshot)) return;
    lastStored.current = snapshot;
    try {
      const blob = await toBlob(imageNode.current, IMAGE_OPTIONS);
      await storeOfflineCardImage(blob, snapshot);
    } catch {
      // ohne Bild bleibt die Offline-Karte auf der Seite selbst
    }
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get("/account/member-card");
      setCard(data);
      setOffline(null);
      if (data?.status === "valid") {
        const snapshot = saveOfflineCard(userId, data);
        if (snapshot) window.setTimeout(() => rememberImage(snapshot), 0);
      }
    } catch {
      // Ohne Netz: die zuletzt geladene Karte mit Stand - der Prüfcode braucht Netz.
      const stored = loadOfflineCard(userId);
      setOffline(stored);
      if (!stored) setError("Die Karte konnte gerade nicht geladen werden.");
    }
  }, [userId, rememberImage]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const delay = refreshDelayMs(card);
    if (delay === null) return undefined;
    timer.current = setTimeout(load, delay);
    return () => clearTimeout(timer.current);
  }, [card, load]);

  // Netz weg: sofort die gespeicherte Karte zeigen; Netz wieder da: neu laden.
  useEffect(() => {
    const goOffline = () => setOffline(loadOfflineCard(userId));
    const goOnline = () => load();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [userId, load]);

  const shown = offline || (card?.status === "valid" ? card : null);
  if (!shown) {
    if (error) return <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5 text-sm text-white/60" data-testid="member-card-error">{error}</div>;
    return null;
  }

  const saveImage = async () => {
    if (!imageNode.current) return;
    setBusy(true);
    try {
      const blob = await toBlob(imageNode.current, IMAGE_OPTIONS);
      await shareOrDownload(blob, "mitgliedskarte.png");
    } catch {
      // Speichern abgebrochen oder nicht möglich - die Karte bleibt auf der Seite
    } finally {
      setBusy(false);
    }
  };

  const art = (props) => (
    <MemberCardArt name={shown.name} number={shown.member_number} since={shown.member_since} typeLabel={shown.type_label} validUntil={shown.valid_until} clubName={shown.club_name} {...props} />
  );

  return (
    <section id="mitgliedskarte" className="mt-6 scroll-mt-24" data-testid="member-card">
      <div className="grid gap-6 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] items-center">
        <div className="w-full max-w-[420px] mx-auto md:mx-0">{art({ offline: Boolean(offline), testId: "member-card-art" })}</div>
        <div className="flex flex-col items-center md:items-start gap-3 text-center md:text-left">
          {offline ? (
            <div className="border border-white/10 rounded-sm bg-[#121212] p-4 text-sm text-white/70 max-w-sm" data-testid="member-card-offline">
              <div className="inline-flex items-center gap-2 font-bold text-white"><WifiOff className="w-4 h-4 text-[#29B6E8]" /> Ohne Netz</div>
              <p className="mt-1">{standLine(offline)}. Der Prüfcode braucht Netz – er erscheint wieder, sobald du online bist.</p>
            </div>
          ) : (
            <>
              <div className="rounded-sm bg-white p-2" data-testid="member-card-qr-box"><BrandedQRCode value={card.verify_url} size={168} logoRatio={0.2} /></div>
              <div className="text-sm text-white">{validUntilLine(card)}</div>
              <div className="inline-flex items-start gap-1.5 text-xs text-white/50 max-w-sm"><QrCode className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Ein Partner scannt den Code und sieht nur: gültig, Vorname, Mitgliedsart. Er erneuert sich alle paar Minuten – ein Foto davon gilt nicht.</div>
            </>
          )}
          <div className="flex flex-wrap justify-center md:justify-start gap-2">
            <button type="button" onClick={saveImage} disabled={busy} data-testid="member-card-save-image" className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              <Download className="w-3.5 h-3.5" /> Als Bild speichern
            </button>
            <button type="button" onClick={load} data-testid="member-card-refresh" className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
              <RefreshCw className="w-3.5 h-3.5" /> Code erneuern
            </button>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-white/40"><Smartphone className="w-3.5 h-3.5" /> In der LionsAPP unter „Verein → Karte“ immer dabei.</div>
        </div>
      </div>
      {/* Die Vorlage für das Bild: dieselbe Karte, groß, ohne Code - außerhalb des sichtbaren Bereichs. */}
      <div aria-hidden="true" className="fixed -left-[10000px] top-0 w-[640px] pointer-events-none" data-testid="member-card-image-source">
        {art({ offline: true, shine: false, ref: imageNode, testId: "member-card-image" })}
      </div>
    </section>
  );
}
