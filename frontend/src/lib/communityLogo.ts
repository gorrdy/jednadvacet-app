// Community logo URL helper. Loga žijí v
// github.com/Jednadvacet-org/jednadvacet-grafika a fetchují se přímo
// z `raw.githubusercontent.com` — bez deploy se nový logo objeví na
// klientovi jakmile expiruje GitHub CDN cache (≈5 minut).
//
// GitHub raw posílá `Cross-Origin-Resource-Policy: cross-origin` +
// `Access-Control-Allow-Origin: *`, takže s naším COEP `require-corp`
// (které potřebuje Evolu OPFS) je to bez problémů.
//
// Generic fallback (`/community-logos/generic.svg`) je zabundlovaný v
// `public/`, ať appka funguje i pokud GitHub padne nebo je uživatel
// offline.

const GH_RAW_BASE =
  "https://raw.githubusercontent.com/Jednadvacet-org/jednadvacet-grafika/main";

/** Best-guess URL for a community logo on GitHub raw. Pokud město svoje
 *  logo nikdy do grafika repa nepushlo, request 404-ne a `<img onError>`
 *  na klientu fallbackne na {@link GENERIC_LOGO}. */
export function communityLogoUrl(slug: string): string {
  const city = slug.replace(/^jednadvacet-/, "").toLowerCase();
  return `${GH_RAW_BASE}/jednadvacet-lokalni-komunity/${city}/orange-square-logo-${city}.svg`;
}

/** Bundlovaný generic fallback. */
export const GENERIC_LOGO = "/community-logos/generic.svg";
