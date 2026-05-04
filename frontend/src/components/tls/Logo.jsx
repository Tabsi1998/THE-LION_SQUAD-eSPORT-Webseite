import { Link } from "react-router-dom";

export const TLS_MASCOT = "https://customer-assets.emergentagent.com/job_esports-hub-134/artifacts/2rsp6zmh_Lo%CC%88we_aufSchwarz_Web.png";
export const TLS_WORDMARK = "https://customer-assets.emergentagent.com/job_esports-hub-134/artifacts/e3zukpsb_TheLionSquad_Logo_%20aufSchwarz_Quer_Web.png";

export function Logo({ variant = "wordmark", size = "md", asLink = true, className = "" }) {
  const sizes = {
    sm: "h-8",
    md: "h-10",
    lg: "h-14",
    xl: "h-20",
  };
  const src = variant === "mascot" ? TLS_MASCOT : TLS_WORDMARK;
  const img = (
    <img
      src={src}
      alt="The Lion Squad eSports"
      className={`${sizes[size]} w-auto object-contain ${className}`}
      data-testid="tls-logo"
      draggable="false"
    />
  );
  if (!asLink) return img;
  return <Link to="/" className="inline-flex items-center" data-testid="tls-logo-link">{img}</Link>;
}

export function MascotBadge({ className = "" }) {
  return <img src={TLS_MASCOT} alt="TLS" className={`object-contain ${className}`} draggable="false" />;
}
