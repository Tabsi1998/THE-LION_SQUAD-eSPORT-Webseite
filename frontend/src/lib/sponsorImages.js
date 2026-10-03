// Logo und Banner der Partner aus dem Vereinsmodul (#880): die Verwaltung zeigt, was die Website zeigt - auf dunklem
// Grund die dunkle Fassung aus Dolibarr, sonst die helle, sonst das hier hochgeladene Logo.

export function shownLogo(entry) {
  const logo = entry?.dolibarr_images?.logo || {};
  return logo.dark?.url || logo.light?.url || entry?.logo_url || "";
}

const VARIANT_LABELS = { dark: "dunkel", light: "hell" };

function variants(list) {
  return (list || []).map((variant) => VARIANT_LABELS[variant] || variant).join(" und ");
}

// „Logo aus Dolibarr (dunkel und hell) · Banner aus Dolibarr (dunkel)“ - leer, wenn Dolibarr nichts liefert.
export function imageSourceText(summary) {
  const parts = [];
  if (summary?.logo?.variants?.length) parts.push(`Logo aus Dolibarr (${variants(summary.logo.variants)})`);
  if (summary?.banner?.variants?.length) parts.push(`Banner aus Dolibarr (${variants(summary.banner.variants)})`);
  return parts.join(" · ");
}
