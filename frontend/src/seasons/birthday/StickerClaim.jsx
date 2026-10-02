import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { stickerSrc } from "@/lib/stickers";
import { previewTokenFor } from "../preview";
import "./birthday.css";

// Der Jahres-Sticker zum Vereinsgeburtstag (S13 #644, B3 #751): Vereinsmitglieder holen sich am Gründungstag einen
// Sticker aus „Zum Vereinsgeburtstag“ - einen je Jahr, der Server entscheidet welchen. Steht in der Gruß-Karte und im
// Mitgliederbereich; ohne Anmeldung oder ohne Mitgliedschaft zeigt der Baustein nichts. In der Vorschau (Admin) lässt
// er sich so oft abholen, wie man will - vergeben wird dabei nichts.

const PACK_NAME = "Zum Vereinsgeburtstag";

function previewConfig() {
  const preview = previewTokenFor("club_birthday");
  return preview ? { params: { preview } } : undefined;
}

/** `onWaiting(true)`, solange ein Mitglied seinen Sticker noch abholen kann - die Karte bleibt dann offen. */
export function StickerClaim({ className = "", testId = "birthday-sticker", onWaiting = null }) {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const waiting = Boolean(state?.active && state.member && !state.claimed);
  useEffect(() => {
    onWaiting?.(waiting);
  }, [waiting, onWaiting]);
  useEffect(() => {
    if (!user?.id) {
      setState(null);
      return undefined;
    }
    let alive = true;
    api.get("/seasonal/birthday", previewConfig())
      .then(({ data }) => alive && setState(data || null))
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [user?.id]);
  if (!state?.active || !state.member) return null;
  const claim = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/seasonal/birthday/sticker", null, previewConfig());
      setFresh(Boolean(data?.new));
      setState((current) => ({ ...current, claimed: true, sticker: data?.sticker || null }));
    } catch {
      setState((current) => ({ ...current, failed: true }));
    } finally {
      setBusy(false);
    }
  };
  if (state.claimed && state.sticker) {
    return (
      <div className={`tls-birthday-sticker ${fresh ? "tls-birthday-sticker--fresh" : ""} ${className}`} data-testid={testId} data-claimed="1">
        <img src={stickerSrc(state.sticker.url)} alt={state.sticker.name} width="48" height="48" />
        <span>
          <strong>{fresh ? "Dein Jahres-Sticker!" : "Dein Jahres-Sticker"}</strong>
          <small>Im Chat unter „{state.sticker.pack_name || PACK_NAME}“.</small>
        </span>
      </div>
    );
  }
  if (state.claimed) return null;
  return (
    <button type="button" className={`tls-birthday-claim ${className}`} onClick={claim} disabled={busy} data-testid={`${testId}-claim`}>
      {state.failed ? "Nochmal versuchen" : busy ? "Einen Moment …" : "Jahres-Sticker abholen"}
    </button>
  );
}
