// Static catalogue of tools/resources shown on the Home tab.
//
// The Home tab is a "one-stop-shop for pleb bitcoiners" — a launcher that
// serves both newbies (clear entry points) and existing bitcoiners (quick
// access to tools they already use). All content here is static — redeploy
// to update. No external API, no tracking.
//
// Tile actions:
//   - url:    opens an external URL in a new tab (rel="noopener")
//   - tab:    navigates to an internal app tab
//   - scroll: scrolls to an anchor on the Home page itself (used for the
//             "jak koupit sats" onboarding deep-link)
//
// Order within a section = curated recommendation order. KYC-minimum first,
// centralised/KYC options as a fallback.
//
// Every external link is trust-verified by the community — if you're adding
// new resources, keep this bar: grassroots, self-custody-friendly, Czech
// context where relevant.

export type DirectoryTab = "articles" | "calendar" | "messages" | "wallet" | "profile" | "komunity";
export type ScrollAnchor = "doporucujeme";

export interface DirectoryTile {
  id: string;
  label: string;
  desc: string;
  icon: string;          // emoji — easy to scan, culturally neutral, no SVG import fuss
  url?: string;          // external link
  tab?: DirectoryTab;    // internal tab navigation
  scroll?: ScrollAnchor; // in-page anchor
  badge?: string;        // optional short chip text, e.g. "KYC-free"
}

export interface DirectorySection {
  id: string;
  title: string;
  hint?: string;
  tiles: DirectoryTile[];
}

export const DIRECTORY_SECTIONS: DirectorySection[] = [
  {
    id: "start",
    title: "🚀 Začni tady",
    hint: "Nový v Bitcoinu? Tady je cesta.",
    tiles: [
      { id: "what-is-btc", label: "Proč Bitcoin",    desc: "procbitcoin.cz — česky pro nováčky",          icon: "₿", url: "https://procbitcoin.cz" },
      { id: "self-custody",label: "Vlastní úschova", desc: "Trezor: co znamená self-custody a proč",       icon: "🔑", url: "https://trezor.io/learn/basics/what-is-self-custody-and-why-is-it-important-for-your-crypto" },
      { id: "lightning",   label: "Lightning",       desc: "Rychlé platby, micropayments",                 icon: "⚡", url: "https://lightning.network" },
      { id: "cashu",       label: "Cashu / ecash",   desc: "Anonymní sats, chaum-style",                   icon: "🕶", url: "https://cashu.space" },
      { id: "privacy",     label: "Privacy",         desc: "Bitcoiner.guide — coinjoin, Tor, návody",      icon: "🛡", url: "https://bitcoiner.guide/privacy/" },
    ],
  },
  {
    id: "doporucujeme",
    title: "🤝 Doporučujeme",
    hint: "Ověřené služby z české komunity. Affiliate odkazy podporují provoz appky.",
    tiles: [
      { id: "p-firefish",   label: "Firefish",     desc: "Bitcoinem zajištěné půjčky",       icon: "🐟", url: "https://firefish.io/?ref=jednadvacet" },
      { id: "p-uctovsem",   label: "Účtovšem",     desc: "Účetnictví pro bitcoinery",        icon: "📒", url: "https://uctovsem.cz" },
      { id: "p-anycoin",    label: "Anycoin",      desc: "Český Bitcoin broker (CZK)",       icon: "🪙", url: "https://www.anycoin.cz/register?ref=1kyucp" },
      { id: "p-btcprague",  label: "BTC Prague",   desc: "Bitcoin konference v Praze",       icon: "🎫", url: "https://btcprg.me/JEDNADVACET" },
      { id: "p-stosuj",     label: "Stosuj",       desc: "Pravidelný nákup Bitcoinu (DCA)",  icon: "📈", url: "https://stosuj.cz/?aff=jednadvacet" },
      { id: "p-trezor",     label: "Trezor",       desc: "HW peněženka z ČR",                icon: "🔒", url: "https://affil.trezor.io/aff_c?offer_id=137&aff_id=9775" },
      { id: "p-veribi",     label: "Veribi",       desc: "Bitcoinová investiční platforma",  icon: "📊", url: "https://app.veribi.com/signup?invite=9267" },
      { id: "p-21energy",   label: "21Energy",     desc: "Bitcoin miner jako topení",        icon: "🔥", url: "https://21energy.com?sca_ref=8362575.HHRDEJ9MRFGkjM" },
      { id: "p-fixedfloat", label: "FixedFloat",   desc: "Altcoin → Bitcoin swap",           icon: "🔄", url: "https://ff.io/?ref=8cw27hzb" },
      { id: "p-vexl",       label: "Vexl",         desc: "P2P přes přátele, bez KYC",        icon: "👥", url: "https://vexl.it",                                               badge: "KYC-free" },
    ],
  },
  {
    id: "tools",
    title: "🧰 Nástroje",
    hint: "Běžné checky — ideálně přes vlastní instanci.",
    tiles: [
      { id: "mempool",   label: "Mempool",   desc: "Fees, bloky, mempool visualizace",     icon: "🧊", url: "https://mempool.jednadvacet.org" },
      { id: "explorer",  label: "Explorer",  desc: "Hledání adresy nebo transakce",         icon: "🔍", url: "https://explorer.jednadvacet.org" },
      { id: "btcmap",    label: "BTC Map",   desc: "Kde zaplatit Bitcoinem (globálně)",     icon: "🗺", url: "https://btcmap.org/map" },
      { id: "mint",      label: "Cashu mint",desc: "cashu.cz — český Cashu mint",           icon: "🏦", url: "https://cashu.cz" },
      { id: "node",      label: "Umbrel",    desc: "Plug-and-play vlastní node",            icon: "🖥", url: "https://umbrel.com" },
      { id: "start9",    label: "Start9",    desc: "Privacy-first node OS",                 icon: "🔐", url: "https://start9.com" },
    ],
  },
];

// Inline "V appce" quick-nav chips. Rendered as a tiny strip below the
// directory. Intentionally separate from the big sections — these are
// already-navigated-daily tabs, not discovery content.
export interface InAppChip {
  id: string;
  label: string;
  icon: string;
  tab: DirectoryTab;
}

export const IN_APP_CHIPS: InAppChip[] = [
  // "Novinky" temporarily hidden — see App.tsx bottom-nav comment.
  { id: "a-calendar", label: "Kalendář", icon: "📅", tab: "calendar" },
  { id: "a-komunity", label: "Komunity", icon: "👥", tab: "komunity" },
  { id: "a-messages", label: "Zprávy",   icon: "💬", tab: "messages" },
  { id: "a-wallet",   label: "Peníze",   icon: "🔶", tab: "wallet" },
  { id: "a-profile",  label: "Nastavení",icon: "🔑", tab: "profile" },
];
