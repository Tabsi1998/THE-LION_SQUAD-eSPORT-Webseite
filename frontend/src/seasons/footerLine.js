import { useEffect, useState } from "react";

// Die Kante im Footer (#662): der Strich über der Impressum-Leiste (`data-season-line`), auf dem die Saison-Deko steht -
// Gräber und Kürbisse zu Halloween, der Stiefel am Nikolaustag (#736).

/** Wo der Strich über dem Impressum liegt (Abstand zur Oberkante des Footers) - null, wenn es keinen gibt. */
export function useFooterLineTop(deps = []) {
  const [top, setTop] = useState(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const measure = () => {
      const line = document.querySelector("footer [data-season-line]");
      setTop(line ? line.offsetTop : null);
    };
    measure();
    const timer = window.setTimeout(measure, 1200);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return top;
}
