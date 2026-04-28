// "Bazar" — P2P classifieds for the Jednadvacet community. Vexl-lite.
//
// Negotiation happens via DM — clicking "Kontaktovat" sends a DM
// request to the offer's owner, prefilled with the listing title so
// the recipient knows what it's about.

import { use, useEffect, useMemo, useState, type FC } from "react";
import { evolu } from "../evolu";
import { useChatProfile } from "../hooks/useChatProfile";
import {
  fetchMarketplaceOffers, fetchMyMarketplaceOffers, postMarketplaceOffer,
  updateMarketplaceOffer, deleteMarketplaceOffer, reportMarketplaceOffer,
  requestDm, dmSlugFor,
  type MarketplaceOffer, type MarketplaceOfferType,
} from "../api";
import { CITIES, cityName } from "../data/cities";
import { fetchTierState } from "../lib/tierSystem";
import { initialsFor } from "../lib/imageResize";
import { UserProfileModal } from "../components/UserProfileModal";

type View = "browse" | "mine";

const TYPE_LABELS: Record<MarketplaceOfferType, string> = {
  buy_sats: "Kupuju saty",
  sell_sats: "Prodávám saty",
  service: "Služba",
  goods: "Věc",
};

const TYPE_ICONS: Record<MarketplaceOfferType, string> = {
  buy_sats: "💰",
  sell_sats: "🛍",
  service: "🔧",
  goods: "📦",
};

export const BazarTab: FC = () => {
  const owner = use(evolu.appOwner);
  const ownerId = owner.id as string;
  const { profile } = useChatProfile();
  const [view, setView] = useState<View>("browse");
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [typeFilter, setTypeFilter] = useState<MarketplaceOfferType | "">("");
  const [cityFilter, setCityFilter] = useState("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [tier, setTier] = useState<number>(1);
  const [viewingProfile, setViewingProfile] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTierState(ownerId).then((t) => {
      if (!cancelled && t) setTier(t.tier);
    });
    return () => { cancelled = true; };
  }, [ownerId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetcher = view === "browse"
      ? fetchMarketplaceOffers({
          ...(typeFilter ? { type: typeFilter } : {}),
          ...(cityFilter ? { city: cityFilter } : {}),
          ...(q.trim() ? { q: q.trim() } : {}),
        })
      : fetchMyMarketplaceOffers(ownerId);
    fetcher.then((items) => {
      if (cancelled) return;
      setOffers(items);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, typeFilter, cityFilter, q, reloadKey, ownerId]);

  const refresh = () => setReloadKey((k) => k + 1);

  const startDm = async (offer: MarketplaceOffer) => {
    if (!profile) {
      alert("Nastav si přezdívku v Nastavení → Profil, ať tě druhá strana pozná.");
      return;
    }
    if (offer.ownerId === ownerId) {
      alert("Tohle je tvůj vlastní inzerát.");
      return;
    }
    const r = await requestDm(ownerId, offer.ownerId);
    if (!r.ok) {
      alert(`Žádost selhala: ${r.error}`);
      return;
    }
    // Open the DM thread directly via hash deep-link.
    const slug = dmSlugFor(ownerId, offer.ownerId);
    window.location.hash = `#chat/${slug}`;
  };

  const reportOffer = async (offer: MarketplaceOffer) => {
    const reason = window.prompt("Důvod nahlášení (5–500 znaků):");
    if (!reason) return;
    const r = await reportMarketplaceOffer(offer.id, ownerId, reason);
    if (!r.ok) { alert(`Nahlášení selhalo: ${r.error}`); return; }
    alert("Nahlášeno. Admini se na to podívají.");
  };

  const close = async (offer: MarketplaceOffer) => {
    if (!window.confirm("Označit inzerát jako uzavřený?")) return;
    await updateMarketplaceOffer(offer.id, ownerId, { status: "closed" });
    refresh();
  };

  const remove = async (offer: MarketplaceOffer) => {
    if (!window.confirm("Smazat inzerát natrvalo?")) return;
    await deleteMarketplaceOffer(offer.id, ownerId);
    refresh();
  };

  const empty = !loading && offers.length === 0;

  return (
    <div>
      <h1 className="page-h">
        Bazar
        <span className="counter">{offers.length}</span>
      </h1>
      <p className="page-sub">
        P2P inzeráty. Kupuj saty, prodávej HW peněženku, nabízej kurzy.
        Komunikace probíhá v DM.
      </p>

      {tier < 2 && (
        <div className="card" style={{ background: "var(--ember-soft)", borderColor: "var(--ember-deep)" }}>
          <p className="small" style={{ margin: 0 }}>
            <strong>Tier 2+</strong> může inzerovat. Zatím můžeš inzeráty jen procházet.
            Postup začneš v Profile → Tvoje úroveň.
          </p>
        </div>
      )}

      <div className="row-actions" style={{ flexWrap: "wrap", marginBottom: "0.8rem" }}>
        <button className={`btn btn-sm ${view === "browse" ? "btn-primary" : "btn-secondary"}`} onClick={() => setView("browse")}>
          Procházet
        </button>
        <button className={`btn btn-sm ${view === "mine" ? "btn-primary" : "btn-secondary"}`} onClick={() => setView("mine")}>
          Mé inzeráty
        </button>
        {tier >= 2 && profile && (
          <button className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)} style={{ marginLeft: "auto" }}>
            ➕ Přidat inzerát
          </button>
        )}
      </div>

      {view === "browse" && (
        <div className="toolbar" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as MarketplaceOfferType | "")}>
            <option value="">Všechny typy</option>
            <option value="buy_sats">{TYPE_ICONS.buy_sats} Kupuju saty</option>
            <option value="sell_sats">{TYPE_ICONS.sell_sats} Prodávám saty</option>
            <option value="service">{TYPE_ICONS.service} Služba</option>
            <option value="goods">{TYPE_ICONS.goods} Věc</option>
          </select>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
            <option value="">Všechna města</option>
            {CITIES.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Hledat…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: "1 1 8rem", minWidth: "8rem" }}
          />
        </div>
      )}

      {loading ? (
        <div className="loading">Načítám…</div>
      ) : empty ? (
        <p className="muted small mt-md">
          {view === "mine" ? "Zatím nemáš žádný inzerát." : "Žádné inzeráty pro tyto filtry."}
        </p>
      ) : (
        <div className="bazar-grid mt-md">
          {offers.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              isOwn={o.ownerId === ownerId}
              onContact={() => startDm(o)}
              onReport={() => reportOffer(o)}
              onClose={() => close(o)}
              onDelete={() => remove(o)}
              onViewProfile={() => setViewingProfile(o.ownerId)}
            />
          ))}
        </div>
      )}

      {createOpen && profile && (
        <CreateOfferModal
          ownerId={ownerId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); refresh(); }}
        />
      )}

      {viewingProfile && (
        <UserProfileModal
          ownerId={viewingProfile}
          onStartDm={(pid, _name) => {
            const slug = dmSlugFor(ownerId, pid);
            window.location.hash = `#chat/${slug}`;
          }}
          onClose={() => setViewingProfile(null)}
        />
      )}
    </div>
  );
};

const OfferCard: FC<{
  offer: MarketplaceOffer;
  isOwn: boolean;
  onContact: () => void;
  onReport: () => void;
  onClose: () => void;
  onDelete: () => void;
  onViewProfile: () => void;
}> = ({ offer, isOwn, onContact, onReport, onClose, onDelete, onViewProfile }) => {
  const cities = offer.citiesCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const payments = offer.paymentMethodsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const expired = new Date(offer.expiresAt).getTime() < Date.now();

  return (
    <article className={`card bazar-card ${offer.status !== "active" ? "is-closed" : ""}`}>
      <div className="bazar-card-head">
        <span className="bazar-card-type">{TYPE_ICONS[offer.type]} {TYPE_LABELS[offer.type]}</span>
        {offer.status !== "active" && (
          <span className="badge" style={{ background: "var(--ink-faint)", color: "var(--ink)" }}>
            {offer.status === "sold" ? "Prodáno" : "Uzavřeno"}
          </span>
        )}
        {expired && offer.status === "active" && (
          <span className="badge" style={{ background: "rgba(224, 83, 61, 0.2)", color: "var(--danger)" }}>
            Vypršelo
          </span>
        )}
      </div>
      <h3 className="bazar-card-title">{offer.title}</h3>
      {offer.priceText && (
        <div className="bazar-card-price">{offer.priceText}</div>
      )}
      {offer.description && (
        <p className="bazar-card-desc">{offer.description}</p>
      )}
      <div className="bazar-card-meta">
        {offer.location && <span>📍 {offer.location}</span>}
        {cities.length > 0 && <span>🏙 {cities.map(cityName).join(", ")}</span>}
        {payments.length > 0 && <span>💳 {payments.join(", ")}</span>}
      </div>
      <div className="bazar-card-foot">
        <button type="button" className="bazar-card-author" onClick={onViewProfile}>
          <span className="chat-avatar" aria-hidden="true" style={{ width: 24, height: 24 }}>
            {offer.avatar
              ? <img src={offer.avatar} alt="" />
              : <span className="initials">{initialsFor(offer.proposerName)}</span>}
          </span>
          <span>{offer.proposerName}</span>
          {offer.tier >= 2 && (
            <span className={`tier-badge tier-${offer.tier}`} title={`Tier ${offer.tier}`}>T{offer.tier}</span>
          )}
        </button>
        <div className="row-actions" style={{ marginLeft: "auto" }}>
          {isOwn ? (
            <>
              {offer.status === "active" && (
                <button className="btn btn-sm btn-ghost" onClick={onClose}>Uzavřít</button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={onDelete} style={{ color: "var(--danger)" }}>
                Smazat
              </button>
            </>
          ) : (
            <>
              {offer.status === "active" && !expired && (
                <button className="btn btn-sm btn-primary" onClick={onContact}>
                  Kontaktovat
                </button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={onReport} title="Nahlásit">⚠</button>
            </>
          )}
        </div>
      </div>
    </article>
  );
};

const CreateOfferModal: FC<{
  ownerId: string;
  onClose: () => void;
  onCreated: () => void;
}> = ({ ownerId, onClose, onCreated }) => {
  const [type, setType] = useState<MarketplaceOfferType>("buy_sats");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [pickedCities, setPickedCities] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [priceText, setPriceText] = useState("");
  const [ttlDays, setTtlDays] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const togglePM = (m: string) => {
    setPaymentMethods(paymentMethods.includes(m)
      ? paymentMethods.filter((x) => x !== m)
      : [...paymentMethods, m]);
  };

  const COMMON_PMS = ["Hotovost", "Bank převod", "Revolut", "QR Lightning", "BTC Lightning", "On-chain"];

  const submit = async () => {
    setErr(null);
    if (title.trim().length < 3) { setErr("Název musí mít aspoň 3 znaky."); return; }
    setSubmitting(true);
    const r = await postMarketplaceOffer({
      ownerId,
      type,
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      citiesCsv: pickedCities.join(","),
      paymentMethodsCsv: paymentMethods.join(","),
      ...(priceText.trim() ? { priceText: priceText.trim() } : {}),
      ttlDays,
    });
    setSubmitting(false);
    if (!r.ok) { setErr(r.error); return; }
    onCreated();
  };

  return (
    <div className="pow-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pow-container bazar-create-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pow-close" onClick={onClose} aria-label="Zavřít">×</button>
        <div className="bazar-create-body">
          <h3 style={{ margin: "0 0 1rem" }}>Nový inzerát</h3>
          <div className="form">
            <div className="field">
              <label>Typ</label>
              <select value={type} onChange={(e) => setType(e.target.value as MarketplaceOfferType)}>
                <option value="buy_sats">{TYPE_ICONS.buy_sats} Kupuju saty</option>
                <option value="sell_sats">{TYPE_ICONS.sell_sats} Prodávám saty</option>
                <option value="service">{TYPE_ICONS.service} Služba</option>
                <option value="goods">{TYPE_ICONS.goods} Věc</option>
              </select>
            </div>
            <div className="field">
              <label>Název *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))}
                placeholder="Stručně, co inzeruješ" />
            </div>
            <div className="field">
              <label>Cena / podmínky</label>
              <input value={priceText} onChange={(e) => setPriceText(e.target.value.slice(0, 100))}
                placeholder="Např. tržní kurz +1%, nebo 500 Kč/h" />
            </div>
            <div className="field">
              <label>Popis</label>
              <textarea rows={4} value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 5000))}
                placeholder="Detaily, podmínky, kontakt na sebe…" />
            </div>
            <div className="field">
              <label>Místo (volné textové pole)</label>
              <input value={location} onChange={(e) => setLocation(e.target.value.slice(0, 200))}
                placeholder="Např. Praha 7, online…" />
            </div>
            <div className="field">
              <label>Města</label>
              <div className="chip-row">
                {CITIES.map((c) => (
                  <button key={c.slug} type="button"
                    className={`chip selectable ${pickedCities.includes(c.slug) ? "active" : ""}`}
                    onClick={() => setPickedCities(
                      pickedCities.includes(c.slug)
                        ? pickedCities.filter((s) => s !== c.slug)
                        : [...pickedCities, c.slug],
                    )}
                  >{c.name}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Způsoby platby</label>
              <div className="chip-row">
                {COMMON_PMS.map((m) => (
                  <button key={m} type="button"
                    className={`chip selectable ${paymentMethods.includes(m) ? "active" : ""}`}
                    onClick={() => togglePM(m)}
                  >{m}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Doba inzerátu (dny)</label>
              <input type="number" min={1} max={90} value={ttlDays}
                onChange={(e) => setTtlDays(Number(e.target.value) || 30)} />
            </div>
            {err && <p className="error">{err}</p>}
            <div className="row-actions">
              <button className="btn btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? "Odesílám…" : "Zveřejnit"}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Zrušit</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
