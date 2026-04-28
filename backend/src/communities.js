// Czech "Jednadvacet" community directory.
//
// Authoritative list: maintained alongside the 21-captcha (pow.jednadvacet.org)
// seed.js on the PoW server. Each entry maps 1:1 to a Signal group — the
// PoW gate is `https://pow.jednadvacet.org/<slug>`. When a new community
// lights up, add it here AND in 21-captcha's seed.js.
//
// Metadata policy:
//   - 9 of these also exist on BTC Map (api.btcmap.org), so they carry a
//     richer payload (signal URL, icon, GeoJSON polygon centroid). Those
//     are refreshed from BTC Map every 24 h.
//   - The rest are "PoW-only" and carry just slug + name + approximate
//     centre coords (one-time Nominatim geocode of the city name, baked
//     into the source). No runtime refresh.
//
// Frontend uses this for the Komunity tab (sorted list + search) and
// NearestCommunities (Haversine over the user's geolocation fix).

const BTCMAP_IDS = [
  { id: 408, slug: "brno" },
  { id: 409, slug: "liberec" },
  { id: 410, slug: "melnik" },
  { id: 411, slug: "praha" },
  { id: 760, slug: "prachatice" },
  { id: 762, slug: "slany" },
  { id: 772, slug: "znojmo" },
  { id: 773, slug: "olomouc" },
  { id: 894, slug: "prostejov" },
];

const SEED = [
  { slug: "brno", name: "Jednadvacet Brno", lat: 49.21059, lng: 16.59569, signal: "https://signal.group/#CjQKIL2KyHPPAotCRX1bQS2Kx_NV46s7om25K23Sy5Sf_u2pEhB1vJrPckxkIryjgdeTybmx", website: "https://jednadvacet.org/", icon: "https://static.btcmap.org/images/communities/jednadvacet-brno.png", org: "jednadvacet", btcmapId: 408, urlAlias: "jednadvacet-brno" },
  { slug: "liberec", name: "Jednadvacet Liberec", lat: 50.82191, lng: 15.01068, signal: "https://signal.group/#CjQKIKtzoUpECn8UMe75RVp5JarCLBHIRjks3CpZKWXVMPMDEhDPRKeK6Qx3BcNBol90npXl", website: "https://jednadvacet.org/", icon: "https://static.btcmap.org/images/communities/jednadvacet-liberec.png", org: "jednadvacet", btcmapId: 409, urlAlias: "jednadvacet-liberec" },
  { slug: "melnik", name: "Jednadvacet Mělník", lat: 50.36643, lng: 14.48786, signal: "https://signal.group/#CjQKIB3sQNlSJ2OrJTp2IOImyrMmjCNLwLuFD-EStYxIrLfaEhClCLnYWHVjmK2aRQMY_M8e", website: "https://jednadvacet.org/", icon: "https://static.btcmap.org/images/communities/jednadvacet-mělník.png", org: "jednadvacet", btcmapId: 410, urlAlias: "jednadvacet-mělník" },
  { slug: "praha", name: "Jednadvacet Praha", lat: 50.06614, lng: 14.46193, signal: "https://signal.group/#CjQKIK0vXB9EYpepoD4CL_aB2BXXOTSk8rXX26bjIfVTmeZqEhCOdTX83XGSUnYr6BIwMgwy", website: "https://jednadvacet.org/", icon: "https://static.btcmap.org/images/communities/jednadvacet-praha.png", org: "jednadvacet", btcmapId: 411, urlAlias: "jednadvacet-praha" },
  { slug: "prachatice", name: "Jednadvacet Prachatice", lat: 49.00706, lng: 13.98526, signal: "https://signal.group/#CjQKIBOYXWuUE3LzYuWy_AKoSYfV9-_o1bVltueIL3k4hTisEhCVzu1ua6U1EhOa6OhfJK78", website: "https://jednadvacet.org/", icon: "https://static.btcmap.org/images/communities/jednadvacet-prachatice.png", org: "jednadvacet", btcmapId: 760, urlAlias: "jednadvacet-prachatice" },
  { slug: "slany", name: "Jednadvacet Slaný", lat: 50.23591, lng: 14.07748, signal: "https://signal.group/#CjQKIGPYP6KQt7Rwm6uyzqDm2KFJL_KLzcjUGNrW3LP5by7oEhBRjYvaHLIdM4RjpbnWViqI", website: null, icon: "https://static.btcmap.org/images/communities/jednadvacet-slany.png", org: "jednadvacet", btcmapId: 762, urlAlias: "jednadvacet-slany" },
  { slug: "znojmo", name: "Jednadvacet Znojmo", lat: 48.94441, lng: 16.07422, signal: "https://signal.group/#CjQKINldUD7mEb3xFT672GJFmlmrEC1eqvrDFhzUdTUeS0OoEhCDutJWAofDBAC31AFf7pdX", website: null, icon: "https://pbs.twimg.com/profile_images/1686719100595163136/OMt5ZBGH_400x400.jpg", org: "jednadvacet", btcmapId: 772, urlAlias: "jednadvacet-znojemsko" },
  { slug: "olomouc", name: "Jednadvacet Olomouc", lat: 49.6053, lng: 17.27911, signal: "https://signal.group/#CjQKIKjU9GK60QXNQyMqSDOizIl5L5WESmJRwM4fG3-ANAP7EhBS3FvBjUDUTjlreHoPfc9Y", website: null, icon: "https://static.btcmap.org/images/communities/jednadvacet-olomouc.svg", org: "jednadvacet", btcmapId: 773, urlAlias: "jednadvacet-olomouc" },
  { slug: "prostejov", name: "Jednadvacet Prostějov", lat: 49.48476, lng: 16.97499, signal: null, website: "https://jednadvacet.org/", icon: "https://static.btcmap.org/images/communities/jednadvacet-prostejov.svg", org: "jednadvacet", btcmapId: 894, urlAlias: "jednadvacet-prostejov" },
];

// Non-BTCMap communities — all 37 of the "PoW-only" Signal groups.
// Coords are Nominatim geocodes of the city name (one-time, baked in).
// Labels match the Czech names used in the PoW seed on 21-captcha server.
const POW_ONLY = [
  { slug: "ostrava", name: "Jednadvacet Ostrava", lat: 49.8349, lng: 18.2820 },
  { slug: "plzen", name: "Jednadvacet Plzeň", lat: 49.7477, lng: 13.3775 },
  { slug: "zlin", name: "Jednadvacet Zlín", lat: 49.2268, lng: 17.6667 },
  { slug: "pardubice", name: "Jednadvacet Pardubice", lat: 50.0386, lng: 15.7791 },
  { slug: "hradec-kralove", name: "Jednadvacet Hradec Králové", lat: 50.2092, lng: 15.8328 },
  { slug: "jihlava", name: "Jednadvacet Jihlava", lat: 49.3961, lng: 15.5903 },
  { slug: "ceske-budejovice", name: "Jednadvacet České Budějovice", lat: 48.9747, lng: 14.4743 },
  { slug: "beroun", name: "Jednadvacet Beroun", lat: 49.9640, lng: 14.0734 },
  { slug: "valasske-mezirici", name: "Jednadvacet Val. Meziříčí", lat: 49.4716, lng: 17.9716 },
  { slug: "sumperk", name: "Jednadvacet Šumperk", lat: 49.9656, lng: 16.9706 },
  { slug: "teplice", name: "Jednadvacet Teplice", lat: 50.6407, lng: 13.8245 },
  { slug: "kolin", name: "Jednadvacet Kolín", lat: 50.0289, lng: 15.2012 },
  { slug: "bruntal", name: "Jednadvacet Bruntál", lat: 49.9885, lng: 17.4653 },
  { slug: "turnov", name: "Jednadvacet Turnov", lat: 50.5874, lng: 15.1574 },
  { slug: "cheb", name: "Jednadvacet Cheb", lat: 50.0794, lng: 12.3704 },
  { slug: "trinec", name: "Jednadvacet Třinec", lat: 49.6779, lng: 18.6712 },
  { slug: "frydek-mistek", name: "Jednadvacet Frýdek-Místek", lat: 49.6856, lng: 18.3483 },
  { slug: "kromeriz", name: "Jednadvacet Kroměříž", lat: 49.2984, lng: 17.3930 },
  { slug: "brandys", name: "Jednadvacet Brandýs n. L.", lat: 50.1912, lng: 14.6650 },
  { slug: "opava", name: "Jednadvacet Opava", lat: 49.9389, lng: 17.9024 },
  { slug: "varnsdorf", name: "Jednadvacet Varnsdorf", lat: 50.9124, lng: 14.6194 },
  { slug: "pribram", name: "Jednadvacet Příbram", lat: 49.6901, lng: 14.0104 },
  { slug: "benesov", name: "Jednadvacet Benešov", lat: 49.7829, lng: 14.6876 },
  { slug: "karlovy-vary", name: "Jednadvacet Karlovy Vary", lat: 50.2306, lng: 12.8701 },
  { slug: "uherske-hradiste", name: "Jednadvacet Uh. Hradiště", lat: 49.0681, lng: 17.4664 },
  { slug: "pisek", name: "Jednadvacet Písek", lat: 49.3090, lng: 14.1478 },
  { slug: "trutnov", name: "Jednadvacet Trutnov", lat: 50.5608, lng: 15.9129 },
  { slug: "kladno", name: "Jednadvacet Kladno", lat: 50.1466, lng: 14.1026 },
  { slug: "breclav", name: "Jednadvacet Břeclav", lat: 48.7594, lng: 16.8813 },
  { slug: "svitavy", name: "Jednadvacet Svitavy", lat: 49.7562, lng: 16.4689 },
  { slug: "decin", name: "Jednadvacet Děčín", lat: 50.7824, lng: 14.2147 },
  { slug: "babice", name: "Jednadvacet Babice", lat: 49.1279, lng: 17.4795 },
  { slug: "kyjov", name: "Jednadvacet Kyjov", lat: 49.0104, lng: 17.1225 },
  { slug: "tyn-nad-vltavou", name: "Jednadvacet Týn n. Vltavou", lat: 49.2234, lng: 14.4211 },
  { slug: "vrchlabi", name: "Jednadvacet Vrchlabí", lat: 50.6271, lng: 15.6096 },
  { slug: "mlada-boleslav", name: "Jednadvacet Mladá Boleslav", lat: 50.4116, lng: 14.9031 },
  { slug: "prerov", name: "Jednadvacet Přerov", lat: 49.4554, lng: 17.4509 },
].map((c) => ({
  ...c,
  signal: null, website: null, icon: null, org: "jednadvacet", btcmapId: null, urlAlias: null,
}));

// Combined list — BTC Map entries get their rich metadata, the rest just
// slug+name+coords. Dedupe by slug so a BTCMap refresh can never duplicate
// a POW_ONLY entry if one later gets added to BTC Map upstream.
const ALL_SEED = (() => {
  const seen = new Set(SEED.map((c) => c.slug));
  return [...SEED, ...POW_ONLY.filter((c) => !seen.has(c.slug))];
})();

let current = { updatedAt: null, communities: ALL_SEED };

export function getCommunities() {
  return current;
}

/** Walk a Polygon or MultiPolygon coordinate tree and return the average
 *  vertex (good enough as a "centre" for nearest-community UX). */
function centroid(geo) {
  if (!geo) return null;
  const t = geo.type;
  const coords = geo.coordinates;
  if (!coords) return null;
  const xs = [], ys = [];
  const push = (pt) => { if (Array.isArray(pt) && pt.length >= 2) { xs.push(pt[0]); ys.push(pt[1]); } };
  if (t === "Polygon") {
    for (const ring of coords) for (const pt of ring) push(pt);
  } else if (t === "MultiPolygon") {
    for (const poly of coords) for (const ring of poly) for (const pt of ring) push(pt);
  } else {
    return null;
  }
  if (xs.length === 0) return null;
  const lng = xs.reduce((a, b) => a + b, 0) / xs.length;
  const lat = ys.reduce((a, b) => a + b, 0) / ys.length;
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

async function fetchOne({ id, slug }) {
  const r = await fetch(`https://api.btcmap.org/v3/areas/${id}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "jednadvacet-app/1.0 (+https://jednadvacet.gorrdy.cz)" },
  });
  if (!r.ok) throw new Error(`btcmap ${id} → ${r.status}`);
  const d = await r.json();
  const tags = d.tags || {};
  const c = centroid(tags.geo_json);
  if (!c) throw new Error(`btcmap ${id} → no centroid`);
  return {
    slug,
    name: tags.name ?? slug,
    lat: c.lat,
    lng: c.lng,
    signal: tags["contact:signal"] ?? null,
    website: tags["contact:website"] ?? null,
    icon: tags["icon:square"] ?? null,
    org: tags.organization ?? null,
    btcmapId: d.id,
    urlAlias: tags.url_alias ?? null,
  };
}

/** Refresh the BTC Map-sourced entries; non-BTCMap entries are preserved
 *  from POW_ONLY unchanged. Per-id failures fall back to the seed entry. */
export async function refreshCommunities() {
  const results = await Promise.allSettled(BTCMAP_IDS.map((e) => fetchOne(e)));
  const refreshed = BTCMAP_IDS.map((e, i) => {
    const r = results[i];
    if (r.status === "fulfilled") return r.value;
    const fallback = SEED.find((s) => s.slug === e.slug);
    return fallback ?? null;
  }).filter(Boolean);
  const refreshedSlugs = new Set(refreshed.map((c) => c.slug));
  const merged = [...refreshed, ...POW_ONLY.filter((c) => !refreshedSlugs.has(c.slug))];
  current = { updatedAt: new Date().toISOString(), communities: merged };
  const failed = results.filter((r) => r.status === "rejected").length;
  console.log(`[communities] refreshed ${refreshed.length} BTCMap + ${merged.length - refreshed.length} PoW-only (${failed} failed)`);
  return current;
}

export function startCommunityRefresh() {
  // Kick off a refresh ~20 s after boot so the seed is replaced by live data
  // but the startup path isn't blocked on a network call.
  setTimeout(() => {
    refreshCommunities().catch((e) => console.error("[communities] initial refresh failed:", e.message));
  }, 20_000);
  // Then every 24 h.
  setInterval(() => {
    refreshCommunities().catch((e) => console.error("[communities] refresh failed:", e.message));
  }, 24 * 60 * 60 * 1000);
  console.log(`[communities] seed loaded (${ALL_SEED.length} entries); refresh scheduled in 20s then daily`);
}
