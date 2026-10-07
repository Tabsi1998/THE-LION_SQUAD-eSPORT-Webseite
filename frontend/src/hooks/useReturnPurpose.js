import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { nextTarget, purposeSentence } from "@/lib/returnPath";

/**
 * Der Satz „wofür“ oben auf Login und Registrieren (#1225). Für Turnier und Event holt er den Titel; bis der da ist (oder
 * die Abfrage scheitert), steht noch nichts da, damit der Satz nicht springt.
 */
export function useReturnPurpose(next, mode = "login") {
  const target = useMemo(() => nextTarget(next), [next]);
  const needsTitle = Boolean(target && target.kind !== "membership");
  const path = needsTitle ? `/${target.kind === "tournament" ? "tournaments" : "events"}/${encodeURIComponent(target.slug)}` : "";
  const access = needsTitle ? target.access : "";
  const [title, setTitle] = useState({ path: "", value: "" });

  useEffect(() => {
    if (!path) return undefined;
    let active = true;
    api.get(path, { params: access ? { access } : undefined })
      .then(({ data }) => { if (active) setTitle({ path, value: String(data?.title || data?.name || "") }); })
      .catch(() => { if (active) setTitle({ path, value: "" }); });
    return () => { active = false; };
  }, [path, access]);

  if (!target) return "";
  if (needsTitle && title.path !== path) return "";
  return purposeSentence(target, needsTitle ? title.value : "", mode);
}
