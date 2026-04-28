// LNURL-auth (LUD-04) view. Shows what the user is about to sign for
// (domain + intent), waits for explicit confirmation, then derives a
// per-domain linking key from the wallet identity, signs the challenge,
// and submits it to the same URL with `?sig=&key=` appended.
//
// Why an explicit confirm: the act of signing IS the auth. A drive-by
// QR could otherwise log the user into a hostile service silently, so
// we always show domain + action and require a button press.

import { use, useState, type FC } from "react";
import { evolu } from "../evolu";
import { buildAuthResponse } from "../lib/lnurlAuth";
import { maybeProxyLnurl, type LnurlAuthParams } from "../lib/lnurl";
import { WalletHeader } from "./shared";

interface Props {
  params: LnurlAuthParams;
  onBack: () => void;
}

const ACTION_LABEL: Record<LnurlAuthParams["action"], string> = {
  register: "Vytvořit účet u",
  login: "Přihlásit se k",
  link: "Propojit účet s",
  auth: "Autorizovat akci u",
};

export const LnurlAuthView: FC<Props> = ({ params, onBack }) => {
  const owner = use(evolu.appOwner);
  const ownerId = owner.id as string;

  const [phase, setPhase] = useState<"confirm" | "signing" | "done">("confirm");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setPhase("signing");
    setErr(null);
    try {
      const { sig, key } = buildAuthResponse(ownerId, params.domain, params.k1);
      const u = new URL(params.url);
      u.searchParams.set("sig", sig);
      u.searchParams.set("key", key);
      const r = await fetch(maybeProxyLnurl(u.toString()), { credentials: "omit" });
      if (!r.ok) throw new Error(`LNURL auth HTTP ${r.status}`);
      const j = (await r.json()) as Record<string, unknown>;
      if (j.status === "ERROR") throw new Error(String(j.reason ?? "Server odmítl podpis."));
      setPhase("done");
      setTimeout(onBack, 2000);
    } catch (e) {
      setErr((e as Error).message ?? "Auth selhal");
      setPhase("confirm");
    }
  };

  if (phase === "done") {
    return (
      <div>
        <WalletHeader onBack={onBack} title="LNURL auth" />
        <div className="card center" style={{ padding: "2rem 1rem" }}>
          <div style={{ fontSize: "3rem" }}>🔓</div>
          <h2>Autorizováno</h2>
          <p className="hint">
            {ACTION_LABEL[params.action]} <strong>{params.domain}</strong> proběhlo. Vrať se do prohlížeče / aplikace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WalletHeader onBack={onBack} title="LNURL auth" />
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Potvrď přihlášení</h3>
        <p className="hint">
          {ACTION_LABEL[params.action]} <strong>{params.domain}</strong>?
        </p>
        <p className="small muted">
          Tvoje peněženka podepíše challenge unikátním klíčem pro tuto doménu.
          Žádné sats se nepřesouvají.
        </p>
        {err && <p className="error small">{err}</p>}
        <div className="row-actions mt-md">
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={phase === "signing"}
          >
            {phase === "signing" ? "Podepisuji…" : "Potvrdit"}
          </button>
          <button className="btn btn-ghost" onClick={onBack}>
            Zrušit
          </button>
        </div>
      </div>

      <details className="card mt-md" style={{ padding: "0.6rem 0.8rem" }}>
        <summary className="small muted" style={{ cursor: "pointer" }}>Technické detaily</summary>
        <p className="small mono muted" style={{ wordBreak: "break-all", marginTop: "0.4rem" }}>
          Doména: {params.domain}<br />
          Akce: {params.action}<br />
          Challenge (k1): {params.k1}
        </p>
      </details>
    </div>
  );
};
