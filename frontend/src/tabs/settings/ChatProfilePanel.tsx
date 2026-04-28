import { use, useEffect, useRef, useState, type ChangeEvent, type FC } from "react";
import { evolu } from "../../evolu";
import { useChatProfile } from "../../hooks/useChatProfile";
import { initialsFor, resizeAvatar } from "../../lib/imageResize";
import { IconCopy, IconMessage, IconQr } from "../../components/Icons";
import { QrCode } from "../../components/QrCode";
import { TierSection } from "../../components/TierSection";

const BIO_MAX = 500;

/** Profile panel: chat nickname + avatar + bio + QR/ID, plus the tier
 *  section underneath (only visible once the user has set a nickname,
 *  since tier 4 organizer matching needs a display_name). */
export const ChatProfilePanel: FC = () => {
  const owner = use(evolu.appOwner);
  const { profile, loading, save } = useChatProfile();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null); // data URL of new pick (unsaved)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const copyId = () => {
    navigator.clipboard.writeText(owner.id as string).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    });
  };

  // Hydrate from server profile.
  useEffect(() => {
    if (profile) {
      setName(profile.displayName);
      setBio(profile.bio ?? "");
      setAvatarDraft(null);
    }
  }, [profile]);

  const currentAvatar = avatarDraft ?? profile?.avatar ?? null;
  const hasName = name.trim().length >= 2;
  const dirty =
    (profile?.displayName ?? "") !== name.trim() ||
    (profile?.bio ?? "") !== bio.trim() ||
    avatarDraft !== null;

  const pickFile = () => fileInputRef.current?.click();

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!f) return;
    try {
      const dataUrl = await resizeAvatar(f);
      setAvatarDraft(dataUrl);
      setMsg(null);
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    }
  };

  const clearAvatar = () => setAvatarDraft(""); // empty string flags "remove on save"

  const submit = async () => {
    if (!hasName) { setMsg({ kind: "err", text: "Přezdívka musí mít alespoň 2 znaky." }); return; }
    setBusy(true); setMsg(null);
    const r = await save({
      displayName: name.trim(),
      ...(avatarDraft !== null ? { avatar: avatarDraft || null } : {}),
      ...(bio !== (profile?.bio ?? "") ? { bio: bio.trim() || null } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({
        kind: "err",
        text: r.error === "name taken" ? "Tuhle přezdívku už někdo používá. Zkus jinou variantu."
          : r.error === "bad name (2–40 chars)" ? "Přezdívka musí být 2–40 znaků."
          : r.error.includes("avatar too big") ? "Obrázek je moc velký, zkus menší."
          : r.error,
      });
      return;
    }
    setMsg({ kind: "ok", text: "Profil uložen. V chatu se změny projeví hned." });
    setAvatarDraft(null);
  };

  return (
    <>
      <section className="card">
        <h2><IconMessage style={{ width: 18, height: 18, verticalAlign: "-3px" }} /> Profil</h2>
        <p className="hint">
          Jak vystupuješ v komunitních kanálech. Přezdívka, fotka i popisek
          jsou stejné na všech tvých zařízeních díky BIP‑39 frázi. Když něco
          změníš, projeví se i u starších zpráv (jméno i fotka).
        </p>

        <div className="profile-editor mt-md">
          <div className="avatar-col">
            <div className="avatar-frame">
              {currentAvatar && currentAvatar.length > 0 ? (
                <img src={currentAvatar} alt="" />
              ) : (
                <span className="initials">{initialsFor(name || "?")}</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={onFile}
            />
            <div className="row-actions mt-sm" style={{ justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-sm btn-secondary" type="button" onClick={pickFile}>
                {currentAvatar ? "Změnit fotku" : "Nahrát fotku"}
              </button>
              {currentAvatar && (
                <button className="btn btn-sm btn-ghost" type="button" onClick={clearAvatar}>
                  Odstranit
                </button>
              )}
            </div>
          </div>

          <div className="fields-col">
            <div className="field">
              <label>Přezdívka *</label>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setMsg(null); }}
                maxLength={40}
                placeholder={loading ? "Načítám…" : "např. Honza"}
                disabled={loading}
              />
              <p className="small muted mt-sm" style={{ marginBottom: 0 }}>
                2–40 znaků. Nerozlišuje velká/malá písmena ani diakritiku ("Honza" a "honzá" se počítají jako totéž).
              </p>
            </div>
            <div className="field">
              <label>Popisek (volitelně)</label>
              <textarea
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
                placeholder="Např. 'HODLing since 2017, Plzeň'"
                disabled={loading}
              />
              <p className="small muted mt-sm" style={{ marginBottom: 0, textAlign: "right" }}>
                {bio.length}/{BIO_MAX}
              </p>
            </div>
          </div>
        </div>

        {msg && <p className={msg.kind === "ok" ? "success-msg" : "error"} style={{ marginTop: "0.5rem" }}>{msg.text}</p>}

        <div className="row-actions mt-md">
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || loading || !hasName || !dirty}
          >
            {busy ? "Ukládám…" : profile ? "Uložit změny" : "Vytvořit profil"}
          </button>
        </div>

        <div className="divider" />

        <h3><IconQr style={{ width: 15, height: 15, verticalAlign: "-2px" }} /> Moje ID</h3>
        <p className="hint">
          Tvůj veřejný identifikátor pro soukromé zprávy. Když ti ho někdo naskenuje
          (nebo zadá ručně), můžeš si s ním napsat přes DM.
        </p>

        <div className="row-actions mt-md">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowQr((v) => !v)}>
            <IconQr style={{ width: 14, height: 14 }} /> {showQr ? "Skrýt QR" : "Zobrazit QR"}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={copyId}>
            <IconCopy style={{ width: 14, height: 14 }} />
            {copiedId ? "Zkopírováno" : "Zkopírovat ID"}
          </button>
        </div>

        {showQr && (
          <div className="qr-wrap mt-md" style={{ display: "flex", justifyContent: "center" }}>
            <QrCode value={`jednadvacet-dm:${owner.id as string}`} size={220} />
          </div>
        )}

        <p className="mono small mt-md" style={{ wordBreak: "break-all", color: "var(--ink-dim)" }}>
          {owner.id as string}
        </p>
      </section>

      <TierWrapper />
    </>
  );
};

/** TierSection se renderuje až když máme chat_user profil — server ho
 *  potřebuje k validaci tier 4 (organizer match na display_name) a tier 5
 *  (referral link). Bez profilu zobrazíme alespoň hint, ať uživatel ví,
 *  kde tier systém najde — jinak by sekce zmizela bez vysvětlení. */
const TierWrapper: FC = () => {
  const owner = use(evolu.appOwner);
  const { profile, loading } = useChatProfile();
  if (loading) return null;
  if (!profile) {
    return (
      <div className="card" style={{ marginTop: "1.2rem" }}>
        <div className="small muted">Tvoje úroveň</div>
        <p className="small" style={{ marginTop: "0.4rem", marginBottom: 0 }}>
          Tier systém (úroveň + odznaky v chatu, referral link) se zpřístupní
          po nastavení přezdívky výše.
        </p>
      </div>
    );
  }
  return <TierSection ownerId={owner.id as string} />;
};
