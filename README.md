# Jednadvacet — komunitní appka

> ⚠️ **Early stage — nepoužívat v produkci.**
>
> Tenhle projekt je v rané fázi vývoje. API se může měnit, schémata se
> můžou rozbít, šifrované zálohy se můžou stát nečitelnými mezi verzemi,
> v Cashu walletce se mohou ztratit prostředky kvůli bugům. **Neručím
> za žádné problémy ani ztráty** vzniklé použitím tohoto kódu nebo živé
> instance. Software je poskytován "tak jak je" (`AS IS`) bez jakékoliv
> záruky — viz [LICENSE](LICENSE). Pro plnou funkčnost a bezpečnost
> počkej na stabilní release. Pokud i tak chceš zkoušet, **drž jen
> takové částky, o které si můžeš dovolit přijít**, a předem si zazálohuj BIP-39 frázi
> i případný export Cashu tokenů.

Local-first PWA pro českou Bitcoin komunitu **[Jednadvacet](https://jednadvacet.org)**.

- Kalendář meetupů (ICS sync)
- Komunity podle BTC Map + Signal vstupy s PoW captcha
- DM mezi uživateli + globální/městské kanály
- Anonymní push notifikace (Web Push, žádné identifikátory)
- Cashu walletka (NUT-04/05/07/08, multi-mint)
- E2E šifrovaná uživatelská data přes [Evolu](https://github.com/evoluhq/evolu)
  + 24-word BIP-39 recovery

**Live demo:** [jednadvacet.gorrdy.cz](https://jednadvacet.gorrdy.cz)

## Architektura

```
┌──────────────────────────────────┐
│  Browser / PWA (React 19 + Vite) │
│  • Evolu (OPFS + XChaCha20)      │
│  • cashu-ts walletka             │
│  • service worker + Web Push     │
└──────────┬───────────────────────┘
           │ wss://<evolu-relay>          (E2E sync osobních dat)
           │ https://<host>/api           (veřejný obsah, anonymní push)
           ▼
┌──────────────────────────────────┐
│  Node + Express backend          │
│  • /api/articles, /api/events    │
│  • /api/communities              │
│  • /api/push/*                   │
│  • /api/admin/* (session-auth)   │
│  better-sqlite3 + web-push       │
└──────────────────────────────────┘
```

## Stack

- **Frontend:** Vite 7, React 19, TypeScript, [Evolu](https://github.com/evoluhq/evolu),
  [cashu-ts](https://github.com/cashubtc/cashu-ts) v4
- **Backend:** Node ≥ 20, Express 5, better-sqlite3, web-push, fast-xml-parser
- **Deploy:** systemd + nginx (templates v [`deploy/`](deploy/))

## Vývoj

```bash
git clone https://github.com/gorrdy/jednadvacet-app.git
cd jednadvacet-app

# Frontend (port 5173, proxy /api → :3021)
cd frontend
cp .env.example .env.local      # nastav VITE_EVOLU_RELAYS, instance
npm install
npm run dev

# Backend (port 3021)
cd ../backend
cp .env.example .env
npm run keys                    # vygeneruje VAPID_PUBLIC + VAPID_PRIVATE
# Edituj .env — VAPID, SUPERADMIN_EMAIL/PASSWORD, případně ICS_URL/RSS_FEEDS
npm install
npm start
```

Admin UI je schované. Po spuštění otevři `http://localhost:5173/#admin`,
přihlas se SUPERADMIN_EMAIL/PASSWORD z `.env`.

## Evolu config (frontend)

Frontend čte dvě proměnné z `frontend/.env` (resp. `.env.local`,
`.env.staging` podle Vite módu):

| Proměnná                | Co dělá                                                |
|-------------------------|--------------------------------------------------------|
| `VITE_EVOLU_RELAYS`     | Comma-separated list WebSocket relay URLs pro E2E sync |
| `VITE_EVOLU_INSTANCE`   | Namespace na klientu (OPFS db) i na relayi             |

**Důležité o `VITE_EVOLU_INSTANCE`:**

- **Není to secret.** Vite bundluje všechny `VITE_*` hodnoty do veřejného
  JS, který si stáhne kdokoliv. Nenastavuj tam náhodný řetězec ve víře, že
  je to bezpečnostní opatření.
- **Bezpečnost dat stojí na mnemonice**, ne na namespace. Každý uživatel
  má jedinečnou 24-slovnou BIP-39 frázi → unikátní `appOwner.id` →
  vlastní šifrovací klíč (XChaCha20). Ani my, ani provozovatel relayie,
  ani nikdo s přístupem k bucketu cizí data nepřečte.
- **Pro fork** zvol stabilní lidsky čitelné jméno (`jednadvacet-myfork`),
  ne random hash. Změna jména po nasazení = stávající uživatelé "ztratí"
  lokální OPFS databázi a musí přesyncovat z relayie.
- **Pro vlastní infra** ideálně provozuj **vlastní [evolu-relay](https://github.com/evoluhq/evolu)**
  místo používání cizího — kosmetické oddělení namespace bucketu navíc
  není potřeba (cryptografická izolace platí i v rámci jednoho bucketu).

## Deploy

V `deploy/` jsou šablony:

- `jednadvacet-backend.service` — systemd unit pro backend
- `jednadvacet.gorrdy.cz.nginx` — nginx config (frontend + reverse proxy
  na backend + WebSocket pro Evolu relay, pokud běží na stejném hostu)

Skripty `scripts/deploy-staging.sh` a `scripts/deploy-prod.sh` jsou
deploy skripty upstream maintainera. Pro vlastní setup se dají
přeparametrizovat env vars (viz hlavičku každého skriptu) nebo přepsat —
jsou krátké.

Obecný recept (zjednodušený):

```bash
# 1. Backend jako systemd service
cd backend && npm install
cp .env.example .env
# … nastav VAPID, ADMIN, případně ICS_URL/RSS_FEEDS …
sudo cp ../deploy/jednadvacet-backend.service /etc/systemd/system/
# (uprav uvnitř WorkingDirectory + User dle svého stroje)
sudo systemctl daemon-reload
sudo systemctl enable --now jednadvacet-backend

# 2. Frontend build → /var/www/<host>
cd ../frontend && npm install && npm run build
sudo rsync -a --delete dist/ /var/www/<your-host>/

# 3. nginx + Let's Encrypt
sudo cp ../deploy/jednadvacet.gorrdy.cz.nginx /etc/nginx/sites-available/<your-host>
# (uprav server_name + cesty)
sudo ln -s /etc/nginx/sites-available/<your-host> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <your-host>
```

## Anonymita push notifikací

- Při zapnutí push appka pošle backendu jen `{ endpoint, p256dh, auth, tags }`
  — žádné UUID, žádná seed, žádná mnemonic.
- Backend uloží záznam pod náhodným neprůhledným tokenem (`push_sub.token`).
- Pro každý broadcast admin volí *tagy*, ne *uživatele*. Backend rozesílá
  na všechny endpointy s průnikem tagů. Pro odolnost vůči analýze provozu
  používej *široké* tagy (město/kategorie), ne unikátní (e-mail, telefon).
- 404/410 z push služby → záznam se tiše smaže.

Limity:

- Endpoint adresu zná push provider (Google, Mozilla, Apple). Pro vyšší
  ochranu použij VPN / Orbot — appka tohle neskrývá.
- Pokud má tag jen 1 uživatele, anonymita není úplná. Vyhni se příliš
  úzkým broadcast tagům.

## Datový model

### Evolu (per-uživatel, E2E)

| Tabulka         | Účel                                                     |
|-----------------|----------------------------------------------------------|
| `userPrefs`     | Vybraná města, kategorie, jazyk, opaque `pushToken`      |
| `eventOverride` | RSVP (going / maybe / not_going) na globální akci        |
| `bookmark`      | Uložený článek                                           |
| `readArticle`   | Přečtený článek                                          |
| `localEvent`    | Soukromá akce (nesdílí se se serverem)                   |
| `cashuMint`     | Přidané mint URLs                                        |
| `cashuProof`    | Cashu proofy (active/pending/spent)                      |
| `cashuTx`       | Wallet transakce (mint / melt / send / receive)          |

### SQLite backend (veřejný obsah)

| Tabulka            | Co tam je                                                  |
|--------------------|------------------------------------------------------------|
| `articles`         | RSS-agregované články (id, title, body, feed_name…)        |
| `events`           | Globální akce, ICS-importované + admin-vytvořené           |
| `event_rsvp`       | Anonymní RSVP počty (per opaque token)                     |
| `push_sub`         | **token** (PK, opaque), endpoint, p256dh, auth             |
| `push_tag`         | (token, tag) many-to-many                                  |
| `channel_message`  | Veřejné komunitní/DM zprávy                                |
| `chat_user`        | Pseudonymní identita (Evolu owner_id ↔ display name)       |
| `dm_request`       | Stav DM žádostí (pending/accepted/rejected/blocked)        |
| `admin_user`       | Admin/superadmin účty                                      |

## Bezpečnost

Reportování zranitelností: viz [SECURITY.md](SECURITY.md).

## Licence

MIT — viz [LICENSE](LICENSE).
