// Placeholder / seed globálních akcí. Reálné data přijdou z /api/events
// (backend drží SQLite s akcemi + admin je tam publikuje).

export interface GlobalEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  url?: string;
  startsAt: string; // ISO 8601
  endsAt: string;
  cities: string[]; // city slugs
  categories: string[]; // category slugs
  organizer?: string;
  /** Public "going" count from anonymous RSVP aggregate. 0 if nobody yet.
   *  `maybe` + `not_going` are NOT exposed publicly (admin-only). */
  goingCount?: number;
}

export const SEED_EVENTS: readonly GlobalEvent[] = [
  {
    id: "e-praha-meetup-kveten",
    title: "Pražský Bitcoin meetup — květen",
    description:
      "Pravidelné setkání komunity. Neformální, bez přednášek. Přijďte si popovídat.",
    location: "Paralelní Polis, Dělnická 43, Praha 7",
    startsAt: "2026-05-06T19:00:00+02:00",
    endsAt: "2026-05-06T22:00:00+02:00",
    cities: ["praha"],
    categories: ["meetup"],
    organizer: "Jednadvacet Praha",
  },
  {
    id: "e-brno-workshop-lightning",
    title: "Brno workshop: Postav si vlastní Lightning node",
    description:
      "Praktický workshop. Vezměte si notebook. Vhodné i pro úplné začátečníky.",
    location: "Coworking Brno — místo upřesníme",
    startsAt: "2026-05-15T17:30:00+02:00",
    endsAt: "2026-05-15T21:00:00+02:00",
    cities: ["brno"],
    categories: ["technika", "lightning", "edukace"],
    organizer: "Jednadvacet Brno",
  },
  {
    id: "e-bitcoin-prague-2026",
    title: "Bitcoin Prague 2026",
    description:
      "Největší evropská bitcoinová konference. Více dní programu, workshopy, meetupy.",
    location: "O2 Universum, Praha 9",
    url: "https://www.btcprague.com/",
    startsAt: "2026-06-18T09:00:00+02:00",
    endsAt: "2026-06-20T18:00:00+02:00",
    cities: ["praha"],
    categories: ["konference"],
    organizer: "Bitcoin Prague",
  },
  {
    id: "e-ostrava-self-custody",
    title: "Ostrava: Self-custody prakticky",
    description:
      "Hardwarové peněženky, seed backup, passphrase. Přineste si svůj device.",
    location: "Ostrava — místo upřesníme",
    startsAt: "2026-05-22T18:00:00+02:00",
    endsAt: "2026-05-22T20:30:00+02:00",
    cities: ["ostrava"],
    categories: ["self-custody", "edukace"],
    organizer: "Jednadvacet Ostrava",
  },
  {
    id: "e-online-aktualni-makro",
    title: "Online: Makro update (Q2 2026)",
    description:
      "Stream + diskuse. Sazby, ETF flows, těžaři, regulace. Dotazy přes chat.",
    location: "Online (odkaz přijde registrovaným)",
    startsAt: "2026-05-12T20:00:00+02:00",
    endsAt: "2026-05-12T21:30:00+02:00",
    cities: ["online"],
    categories: ["makro", "edukace"],
    organizer: "Jednadvacet",
  },
  {
    id: "e-bratislava-meetup",
    title: "Bratislava Bitcoin meetup",
    description:
      "Pravidelný meetup pre slovenskú komunitu. Prídi, dáme pivo a kecáme.",
    location: "Bratislava — miesto spresníme",
    startsAt: "2026-05-28T18:30:00+02:00",
    endsAt: "2026-05-28T22:00:00+02:00",
    cities: ["bratislava"],
    categories: ["meetup"],
    organizer: "Jednadvacet Bratislava",
  },
];
