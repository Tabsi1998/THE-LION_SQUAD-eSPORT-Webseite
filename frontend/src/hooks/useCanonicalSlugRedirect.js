import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function useCanonicalSlugRedirect(currentSlug, canonicalSlug, basePath, suffix = "") {
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentSlug || !canonicalSlug || currentSlug === canonicalSlug || !basePath) return;
    const targetPath = `${basePath}/${encodeURIComponent(canonicalSlug)}${suffix || ""}`;
    const target = `${targetPath}${window.location.search || ""}${window.location.hash || ""}`;
    const current = `${window.location.pathname}${window.location.search || ""}${window.location.hash || ""}`;
    if (current !== target) {
      navigate(target, { replace: true });
    }
  }, [basePath, canonicalSlug, currentSlug, navigate, suffix]);
}
