// Keep in sync with frontend/src/data/cities.ts.
// Used by sync-ics.js to classify events coming from Google Calendar.

export const CITIES = [
  { slug: "online", name: "Online / celorepublikové", nationwide: true, aliases: ["stream"] },

  { slug: "praha", name: "Praha" },
  { slug: "brno", name: "Brno" },
  { slug: "ostrava", name: "Ostrava" },
  { slug: "plzen", name: "Plzeň" },
  { slug: "liberec", name: "Liberec" },
  { slug: "olomouc", name: "Olomouc" },
  { slug: "hradec-kralove", name: "Hradec Králové", aliases: ["hradec"] },
  { slug: "ceske-budejovice", name: "České Budějovice", aliases: ["cb", "čb"] },
  { slug: "pardubice", name: "Pardubice" },
  { slug: "zlin", name: "Zlín" },
  { slug: "jihlava", name: "Jihlava" },
  { slug: "karlovy-vary", name: "Karlovy Vary" },
  { slug: "usti-nad-labem", name: "Ústí nad Labem", aliases: ["usti"] },

  { slug: "bratislava", name: "Bratislava (SK)" },
  { slug: "kosice", name: "Košice (SK)" },
  { slug: "zilina", name: "Žilina (SK)" },
  { slug: "prievidza", name: "Prievidza (SK)" },

  { slug: "teplice", name: "Teplice" },
  { slug: "beroun", name: "Beroun" },
  { slug: "benesov", name: "Benešov" },
  { slug: "brandys-nad-labem", name: "Brandýs n. Labem", aliases: ["brandys"] },
  { slug: "decin", name: "Děčín" },
  { slug: "kladno", name: "Kladno" },
  { slug: "kolin", name: "Kolín" },
  { slug: "kromeriz", name: "Kroměříž" },
  { slug: "kyjov", name: "Kyjov" },
  { slug: "breclav", name: "Břeclav" },
  { slug: "melnik", name: "Mělník" },
  { slug: "mlada-boleslav", name: "Mladá Boleslav", aliases: ["mlboleslav"] },
  { slug: "nymburk", name: "Nymburk" },
  { slug: "opava", name: "Opava" },
  { slug: "pelhrimov", name: "Pelhřimov" },
  { slug: "pisek", name: "Písek" },
  { slug: "prostejov", name: "Prostějov" },
  { slug: "roznov-pod-radhostem", name: "Rožnov p. Radhoštěm", aliases: ["roznov"] },
  { slug: "slany", name: "Slaný" },
  { slug: "sumperk", name: "Šumperk" },
  { slug: "svitavy", name: "Svitavy" },
  { slug: "trutnov", name: "Trutnov" },
  { slug: "uherske-hradiste", name: "Uherské Hradiště" },
  { slug: "valasske-mezirici", name: "Valašské Meziříčí", aliases: ["valmez"] },
  { slug: "varnsdorf", name: "Varnsdorf" },
  { slug: "ceska-trebova", name: "Česká Třebová" },
  { slug: "bavory", name: "Bavory" },
  { slug: "bukovinka", name: "Bukovinka" },
  { slug: "prachatice", name: "Prachatice" },
  { slug: "znojmo", name: "Znojmo", aliases: ["znojemsko"] },

  { slug: "cheb", name: "Cheb" },
  { slug: "frydek-mistek", name: "Frýdek-Místek" },
  { slug: "prerov", name: "Přerov" },
  { slug: "bruntal", name: "Bruntál" },
  { slug: "turnov", name: "Turnov" },
  { slug: "trinec", name: "Třinec" },
  { slug: "pribram", name: "Příbram" },
  { slug: "babice", name: "Babice" },
  { slug: "tyn-nad-vltavou", name: "Týn n. Vltavou", aliases: ["tyn"] },
  { slug: "vrchlabi", name: "Vrchlabí" },
];

// Normalize — lowercase, strip diacritics, keep only a-z0-9.
export function normalize(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Build reverse lookup: needle → slug.
// Needles include canonical name, slug, and any aliases — all normalized.
const LOOKUP = (() => {
  const m = new Map();
  for (const c of CITIES) {
    const needles = new Set();
    needles.add(normalize(c.name));
    needles.add(normalize(c.slug.replace(/-/g, " ")));
    for (const a of c.aliases ?? []) needles.add(normalize(a));
    for (const n of needles) {
      if (n.length >= 2) m.set(n, c.slug);
    }
  }
  return m;
})();

// Tokens we look at to detect "online" intent.
const ONLINE_HINTS = ["online", "zoom", "meet.", "livestream", "stream", "youtube", "teams", "webinar", "twitter space", "x space", "spaces"];

// Given a text blob (summary/location/description), return an array of city
// slugs we think the event belongs to. Multiple matches possible.
export function extractCities(text) {
  const norm = normalize(text);
  const hits = new Set();
  for (const [needle, slug] of LOOKUP) {
    // Word-boundary-ish: wrap norm/needle with spaces so "usti" doesn't match "dusti".
    if ((" " + norm + " ").includes(" " + needle + " ")) {
      hits.add(slug);
    }
  }
  // If we already have city hits, don't add "online".
  if (hits.size > 0) return Array.from(hits);

  const lower = (text ?? "").toLowerCase();
  for (const h of ONLINE_HINTS) {
    if (lower.includes(h)) return ["online"];
  }
  return [];
}

// Category hints are simpler — keyword-based.
const CATEGORY_RULES = [
  { slug: "konference", needles: ["konference", "conference", "summit", "congress"] },
  { slug: "lightning", needles: ["lightning", " ln ", "lightning network"] },
  { slug: "self-custody", needles: ["self-custody", "self custody", "seed", "wallet", "hardware", "passphrase", "zalohu", "zálohu"] },
  { slug: "technika", needles: ["node", "nod ", "workshop", "technical"] },
  { slug: "privacy", needles: ["privacy", "soukrom", "coinjoin", "tor ", "lunarpunk"] },
  { slug: "makro", needles: ["makro", "macro", "etf", "ekonomi"] },
  { slug: "edukace", needles: ["přednáška", "prednaska", "edukac", "akademie", "škola", "skola", "kurz", "kvíz", "kviz", "workshop"] },
  { slug: "meetup", needles: ["meetup", "meet up", "pivko", "pivo", "beer", "setkání", "setkani", "bitcoin dinner", "piknik", "picnic"] },
];

export function extractCategories(text) {
  const t = (text ?? "").toLowerCase();
  const norm = normalize(text);
  const hits = new Set();
  for (const rule of CATEGORY_RULES) {
    for (const n of rule.needles) {
      const nNorm = normalize(n);
      if (t.includes(n.trim()) || (nNorm && (" " + norm + " ").includes(" " + nNorm + " "))) {
        hits.add(rule.slug);
        break;
      }
    }
  }
  if (hits.size === 0) hits.add("meetup");
  return Array.from(hits);
}
