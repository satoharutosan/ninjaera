import { BRAND_LOGO_ALT, BRAND_LOGO_SRC } from "@/shared/branding";

type BrandLogoProps = {
  /** Display size in CSS pixels (width & height). */
  size?: number;
  className?: string;
  /** Soft elevation behind the mark (auth cards). */
  elevated?: boolean;
  /** Prefer eager load for above-the-fold navbar/footer marks. */
  priority?: boolean;
};

/**
 * Official Ninja Era logo. Import only this component (or BRAND_LOGO_SRC)
 * so branding stays consistent and the asset is bundled once.
 */
export function BrandLogo({
  size = 32,
  className = "",
  elevated = false,
  priority = false,
}: BrandLogoProps) {
  return (
    <img
      src={BRAND_LOGO_SRC}
      alt={BRAND_LOGO_ALT}
      width={size}
      height={size}
      decoding={priority ? "sync" : "async"}
      loading={priority ? "eager" : "lazy"}
      draggable={false}
      className={`shrink-0 object-contain select-none ${elevated ? "shadow-md" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        aspectRatio: "1 / 1",
        borderRadius: Math.round(size * 0.22),
      }}
    />
  );
}

export default BrandLogo;
