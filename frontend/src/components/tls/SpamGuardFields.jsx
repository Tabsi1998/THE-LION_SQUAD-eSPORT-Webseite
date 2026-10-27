import { useEffect, useRef, useState } from "react";
import { loadTurnstile } from "@/lib/turnstile";

// Spamschutz (#2067): das unsichtbare Feld und - nur wenn eingeschaltet - das Turnstile-Widget.
//
// Das Feld ist für Menschen unsichtbar und für Screenreader ausgeblendet (aria-hidden), per Tab nicht erreichbar
// (tabIndex -1) und ohne Autofill (autoComplete off). Bewusst kein display:none - manche Bots überspringen solche
// Felder; es liegt außerhalb des sichtbaren Bereichs.
const HIDDEN_STYLE = {
  position: "absolute",
  left: "-10000px",
  top: "auto",
  width: "1px",
  height: "1px",
  overflow: "hidden",
};

export function SpamGuardFields({ guard, idPrefix }) {
  const id = `${idPrefix || guard.form}-hp`;
  return (
    <>
      <div aria-hidden="true" style={HIDDEN_STYLE} data-testid={`${idPrefix || guard.form}-honeypot`}>
        <label htmlFor={id}>Fax (bitte leer lassen)</label>
        <input
          id={id}
          type="text"
          name={guard.honeypot.name}
          value={guard.honeypot.value}
          onChange={(event) => guard.honeypot.onChange(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
          data-testid={`${idPrefix || guard.form}-honeypot-input`}
        />
      </div>
      {guard.turnstile.show && <TurnstileWidget key={guard.turnstile.widgetKey} turnstile={guard.turnstile} testId={`${idPrefix || guard.form}-turnstile`} />}
    </>
  );
}

function TurnstileWidget({ turnstile, testId }) {
  const containerRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const { config, onToken, onError } = turnstile;
  const siteKey = config?.site_key;
  const action = config?.action;

  useEffect(() => {
    let widgetId = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        widgetId = api.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: "dark",
          language: "de",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => {
            setFailed(true);
            onError(true);
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onError(true);
      });
    return () => {
      cancelled = true;
      if (widgetId !== null && window.turnstile?.remove) window.turnstile.remove(widgetId);
    };
  }, [siteKey, action, onToken, onError]);

  return (
    <div data-testid={testId}>
      <div ref={containerRef} />
      {failed && (
        <p className="mt-1 text-xs text-white/50" role="status">
          Die Sicherheitsprüfung von Cloudflare lässt sich gerade nicht laden – du kannst trotzdem senden, wir prüfen deine Nachricht dann selbst.
        </p>
      )}
    </div>
  );
}
