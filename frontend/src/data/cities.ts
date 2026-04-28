export interface City {
  slug: string;
  name: string;
  nationwide?: boolean;
  aliases?: readonly string[];
}

// Static list for the UI (filter + push tags). Keep in sync with
// backend/cities.js which is used for ICS classification.
export const CITIES: readonly City[] = [
  { slug: "online", name: "Online / celorepublikové", nationwide: true, aliases: ["stream"] },

  // Major
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

  // SK
  { slug: "bratislava", name: "Bratislava (SK)" },
  { slug: "kosice", name: "Košice (SK)" },
  { slug: "zilina", name: "Žilina (SK)" },
  { slug: "prievidza", name: "Prievidza (SK)" },

  // Regional (CZ) — pulled from Jednadvacet ICS prefix distribution
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
  { slug: "mlada-boleslav", name: "Mladá Boleslav", aliases: ["ml.boleslav", "mlboleslav"] },
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

  // Cities with a Jednadvacet community (per pow.jednadvacet.org seed)
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

export const cityName = (slug: string): string =>
  CITIES.find((c) => c.slug === slug)?.name ?? slug;

/** Slugs of nationwide / online-only "cities" that should show in every
 *  user's "Moje města" view. A Praha local still wants to see a celorepublic
 *  online meetup in their feed. */
export const NATIONWIDE_SLUGS: ReadonlySet<string> = new Set(
  CITIES.filter((c) => c.nationwide).map((c) => c.slug),
);

export const isNationwide = (slug: string): boolean => NATIONWIDE_SLUGS.has(slug);
