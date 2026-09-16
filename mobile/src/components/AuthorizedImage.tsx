import React, { useEffect, useRef, useState } from "react";
import { Image, type ImageResizeMode, type ImageStyle, type StyleProp } from "react-native";
import {
  authorizedSource,
  describeAttachmentError,
  fetchAttachmentDataUri,
  httpStatusFromImageError,
} from "../lib/chatAttachments";

/**
 * Ein Bild, das nur mit Anmeldung zu haben ist (Chat-Anhänge, #238).
 *
 * Erster Weg: der Bildlader des Systems mit der Bearer-Kopfzeile. Antwortet
 * der Server darauf mit einem Fehlercode, holt der API-Client das Bild - der
 * Weg, den jeder andere Aufruf der App nimmt, mit Token-Erneuerung - und
 * zeigt es als data:-Adresse. Klappt das, gehen weitere Bilder gleich so.
 * Scheitert auch der API-Client, steht der HTTP-Status mit dem Grund dran,
 * damit die Ursache im Test sichtbar wird.
 */
export type AuthorizedImageState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; reason: string };

type Phase = "direct" | "fetching" | "fallback" | "failed";

let directLoadBroken = false;

/** Nur für Tests: vergisst, dass der direkte Weg schon einmal scheiterte. */
export function resetAuthorizedImageState() {
  directLoadBroken = false;
}

type Props = {
  url: string;
  token: string | null;
  width?: number;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  testID?: string;
  /** Hochzählen lädt neu. */
  attempt?: number;
  onState?: (state: AuthorizedImageState) => void;
};

export function AuthorizedImage({ url, token, width, style, resizeMode = "cover", testID, attempt = 0, onState }: Props) {
  const [phase, setPhase] = useState<Phase>(directLoadBroken ? "fetching" : "direct");
  const [dataUri, setDataUri] = useState<string | null>(null);
  const directReasonRef = useRef("");
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    directReasonRef.current = "";
    setDataUri(null);
    setPhase(directLoadBroken ? "fetching" : "direct");
    onStateRef.current?.({ status: "loading" });
  }, [attempt, url, width]);

  useEffect(() => {
    if (phase !== "fetching") return undefined;
    let active = true;
    fetchAttachmentDataUri(url, width)
      .then((uri) => {
        if (!active) return;
        if (directReasonRef.current.startsWith("HTTP")) directLoadBroken = true;
        setDataUri(uri);
        setPhase("fallback");
      })
      .catch((error: unknown) => {
        if (!active) return;
        const reason = describeAttachmentError(error);
        const direct = directReasonRef.current;
        setPhase("failed");
        onStateRef.current?.({ status: "error", reason: direct && !reason.startsWith(direct) ? `${direct} / ${reason}` : reason });
      });
    return () => {
      active = false;
    };
  }, [phase, url, width]);

  if (phase === "failed" || phase === "fetching") return null;
  const source = phase === "fallback" && dataUri ? { uri: dataUri } : authorizedSource(url, token, width);
  if (!source) return null;
  return (
    <Image
      key={`${attempt}-${phase}`}
      source={source}
      style={style}
      resizeMode={resizeMode}
      testID={testID}
      onLoad={() => onStateRef.current?.({ status: "ready" })}
      onError={(event) => {
        const message = String(event?.nativeEvent?.error || "").trim();
        if (phase === "direct") {
          const status = httpStatusFromImageError(message);
          directReasonRef.current = status ? `HTTP ${status}` : message.slice(0, 60) || "Bildlader";
          setPhase("fetching");
          return;
        }
        setPhase("failed");
        onStateRef.current?.({ status: "error", reason: message.slice(0, 60) || "Bild lässt sich nicht anzeigen" });
      }}
    />
  );
}
