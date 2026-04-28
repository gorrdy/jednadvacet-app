// "Tip dne" — rotating one-liner tips for pleb bitcoiners.
//
// Deterministic by date: same day → same tip for everyone. Possible
// conversation starter in the community chat (all readers see the same
// thing on the same day). Static array — edit in code, redeploy to change.

export const DAILY_TIPS: string[] = [
  "Záložní fráze (BIP-39) patří na papír, ne do fotky, mailu, cloudu ani password manageru. Elektronická kopie = riziko.",
  "Not your keys, not your coins. Drž sats v peněžence, kde máš privátní klíč — ne na burze.",
  "Kupuj v pravidelných intervalech (DCA). Volatilita zkracuje tvá nervová zakončení, ne tvé sats.",
  "1 BTC = 100 000 000 sats. Mysli v sats — orange-pilling je snažší v malých číslech.",
  "Lightning Network = rychlé a levné platby, ale channels vyžadují on-chain transakci. Phoenix a Breez to řeší za tebe.",
  "Passphrase (13. slovo) dává další úroveň bezpečí nad BIP-39 frází. Pozor — pokud ji zapomeneš, peníze jsou pryč stejně jako bez fráze.",
  "Cashu tokeny = IOU od mintu. Perfektní pro mikroplatby a privacy, ale mint má tvé sats — proto drž jen malé částky.",
  "Running your own node = suverenita + privacy. Umbrel/Start9/RaspiBlitz startují za odpoledne.",
  "CoinJoin (Samourai, JoinMarket) rozbíjí chain-analýzu. Dlouhodobé pleb strategy.",
  "Vexl ti najde P2P obchod přes telefonní kontakty — bez KYC, bez KYC. Funguje lokálně.",
  "Robosats je P2P burza v prohlížeči. Tor onion + ephemeral identity = nejlepší KYC-free zážitek.",
  "Před přijetím transakce čekej aspoň 1 konfirmaci. Nízké částky 3 bloky, vysoké 6+.",
  "Paper wallet? Multisig je lepší. 2-of-3 multisig distribuuje riziko na 3 místa/zařízení.",
  "Hot wallet = pro útratu. Cold storage = pro HODL. Nikdy nemíchej.",
  "Bitcoin block ≈ 10 minut. Halving každých 210 000 bloků (~4 roky). Poslední sats se vydělá kolem roku 2140.",
  "Lightning invoice = BOLT 11. Obsahuje částku, expiraci, payment hash. Nikdy expirovanou nepoužívej — platba sedí v limbu.",
  "Ordinals/BRC-20? Mempool spam. Některé bloky 98 % ordinals, 2 % platby. Konvertuj názor volbou vyšších fees při platbě.",
  "Mempool je fronta transakcí. Nízké fees → čekáš déle. Mempool.space/mempool.jednadvacet.org ukazují přesné odhady.",
  "RBF (Replace-By-Fee) = zvýš fee už odeslané transakce. Flag v peněžence, ne všechny to podporují.",
  "Samopayable invoice (BOLT 12 Offer) = statická LN platba. Něco jako QR kód, co funguje opakovaně.",
  "Pokud tě někdo osloví první s investiční nabídkou — je to scam. Nikdy.",
  "Seed fráze má 24 slov (256 bits). 12-word (128 bits) je taky OK, ale 24 má víc bezpečnosti do budoucna.",
  "Ověř si HW wallet při doručení — antitampering seal, checksum. Trezor/BitBox mají oba.",
  "Sparrow Wallet + vlastní Bitcoin Core node = nejlepší desktop setup pro privacy.",
  "Taproot adresy (bc1p...) šetří místo v bloku + pomáhají privacy přes schnorr signatures. Používej je.",
  "Cena BTC v hodu není to samé jako hodnota BTC. V USA tištěných dollars bude v roce 2030 hodně. Měř ji v sats.",
  "Sdílej seed frázi s nikým. Ani s rodinou. Ani s sebou samým přes Signal. Papír. Trezor. Steel plate.",
  "Každé setkání komunity = +1 k lokální síle Bitcoinu. Jeď na meetup, i kdyby jsi mluvil jen 2 lidi.",
  "Pokud kupuješ HODL-long, nastav si alert na cenové cíle a nepřepokaždé kontroluj cenu. Zvyšuje to stres, snižuje hodl období.",
  "Fiat mentality: tento rok spořit, příští rok utratit. Bitcoin mentality: tento rok stackovat, za 10 let platit.",
];

/**
 * Deterministic tip-of-day: indexed by (days since 1970-01-01) modulo
 * array length. Everyone in the same timezone sees the same tip on the
 * same calendar day.
 */
export function getTipOfDay(now: Date = new Date()): string {
  const day = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
  return DAILY_TIPS[day % DAILY_TIPS.length];
}
