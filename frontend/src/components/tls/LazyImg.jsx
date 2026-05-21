/**
 * LazyImg – Drop-in-Ersatz für <img> mit automatischem lazy loading,
 * async decoding und optionalem Blur-Placeholder.
 *
 * Verwendung:
 *   import { LazyImg } from "@/components/tls/LazyImg";
 *   <LazyImg src={url} alt="..." className="w-full h-full object-cover" />
 */
export function LazyImg({ src, alt = "", className = "", style, onError, onLoad, ...rest }) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      decoding="async"
      onError={onError}
      onLoad={onLoad}
      {...rest}
    />
  );
}
