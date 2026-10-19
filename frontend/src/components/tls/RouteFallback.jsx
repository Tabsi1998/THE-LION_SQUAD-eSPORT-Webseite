import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { usePageLoading } from "@/lib/pageLoading";
import { releaseStartSplash } from "@/lib/startSplash";
import { PublicLayout } from "./PublicLayout";
import { PublicLoadingState } from "./PublicLoadingState";
import { SkeletonPage } from "./Skeleton";

// Seitenwechsel (#1324): Kopf und Leiste bleiben stehen, darin ein Skelett und die dünne Linie unter dem Kopf - kein
// schwarzer Vollbild-Kreisel mehr. Verwaltung, TV-Seiten und Anmeldung haben einen eigenen Rahmen: dort nur das ruhige
// Skelett.
const OWN_FRAME = /^\/(admin|display|print|tv|login|register|forgot-password|reset-password|verify-email)(\/|$)/;

export function RouteFallback() {
  const { pathname } = useLocation();
  if (OWN_FRAME.test(pathname)) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] px-4 py-10 sm:px-8" data-testid="route-fallback">
        <SkeletonPage label="Seite lädt" />
      </div>
    );
  }
  return (
    <PublicLayout>
      <PublicLoadingState label="Seite lädt" />
    </PublicLayout>
  );
}

// Der Start-Löwe der installierten Website (#1324) geht, sobald nichts mehr lädt - also wenn die erste Seite steht.
export function StartSplashGate() {
  const loading = usePageLoading();
  useEffect(() => {
    if (loading) return undefined;
    const timer = window.setTimeout(releaseStartSplash, 120);
    return () => window.clearTimeout(timer);
  }, [loading]);
  return null;
}
