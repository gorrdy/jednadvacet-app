import { type FC } from "react";
import { usePush } from "../../hooks/usePush";
import { IconBell } from "../../components/Icons";

interface Props {
  push: ReturnType<typeof usePush>;
  tags: string[];
  iosNeedsInstall: boolean;
  testing: boolean;
  testResult: string | null;
  onTest: () => void;
  chatPush: boolean;
  onToggleChatPush: (next: boolean) => void;
}

export const NotificationsPanel: FC<Props> = ({
  push, tags, iosNeedsInstall, testing, testResult, onTest, chatPush, onToggleChatPush,
}) => (
  <section className="card">
    <p className="hint">
      Volitelné. Tvůj push endpoint se uloží pod náhodným identifikátorem.
      Server neví, kdo jsi — ví jen, že <em>někdo</em> chce dostávat zprávy pro určité tagy.
    </p>

    {iosNeedsInstall && (
      <div className="card" style={{
        background: "var(--ember-soft)",
        borderColor: "var(--ember-deep)",
        padding: "0.85rem 1rem",
        marginTop: "0.85rem",
      }}>
        <strong>📱 Na iPhonu / iPadu:</strong> Apple povoluje push notifikace jen pokud appku <strong>přidáš na plochu</strong>.
        <br />
        V Safari klepni na <span className="kbd">Sdílet</span> → <span className="kbd">Přidat na plochu</span>,
        pak otevři appku z plochy a zapni notifikace tam.
      </div>
    )}

    {push.state === "unsupported" && (
      <p className="error mt-md">Tento prohlížeč push notifikace nepodporuje.</p>
    )}
    {push.state === "blocked" && (
      <p className="error mt-md">Notifikace jsou zablokované v nastavení prohlížeče.</p>
    )}

    {push.state !== "unsupported" && push.state !== "blocked" && (
      <div className="row-actions mt-md">
        {push.state === "off" ? (
          <button className="btn btn-primary" onClick={push.enable} disabled={push.busy}>
            <IconBell style={{ width: 16, height: 16 }} />
            {push.busy ? "Aktivuji…" : "Zapnout notifikace"}
          </button>
        ) : (
          <>
            <span className="badge-brass badge"><IconBell style={{ width: 11, height: 11, marginRight: 3, verticalAlign: "-1px" }} /> AKTIVNÍ</span>
            <button className="btn btn-sm btn-secondary" onClick={onTest} disabled={testing || !push.token}>
              {testing ? "Odesílám…" : "Poslat testovací"}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={push.syncTags} disabled={push.busy}>
              Aktualizovat zájmy
            </button>
            <button className="btn btn-sm btn-danger" onClick={push.disable} disabled={push.busy}>
              Vypnout
            </button>
          </>
        )}
      </div>
    )}

    {testResult && (
      <p className="small mt-md" style={{ color: testResult.startsWith("✓") ? "var(--ok)" : "var(--danger)" }}>
        {testResult}
      </p>
    )}

    {push.state === "on" && (
      <div className="mt-md" style={{
        padding: "0.7rem 0.85rem",
        border: "1px solid var(--hairline)",
        borderRadius: "0.5rem",
        background: "var(--bg-elev)",
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={chatPush}
            onChange={(e) => onToggleChatPush(e.target.checked)}
            style={{ width: "auto" }}
          />
          <span style={{ fontWeight: 500 }}>Notifikace na nové zprávy v chatu</span>
        </label>
        <p className="small muted mt-sm" style={{ marginBottom: 0 }}>
          Když si někdo něco napíše v Globálním kanálu nebo v kanálech tvých měst,
          přijde ti push. Na zařízení, kde otevřenou appku máš (vidíš zprávy živě
          přes stream), se push neposílá — žádné duplikáty.
        </p>
      </div>
    )}

    {tags.length > 0 && (
      <p className="small muted mt-md">
        Zaregistrované tagy: <span className="mono" style={{ color: "var(--ember)" }}>{tags.join(" · ")}</span>
      </p>
    )}

    {push.state === "on" && (
      <details style={{ marginTop: "1rem" }}>
        <summary className="small muted" style={{ cursor: "pointer" }}>Notifikace nepřichází? (troubleshooting)</summary>
        <div className="hint" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
          <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
            <li><strong>iPhone / iPad:</strong> Appku musíš mít <strong>přidanou na plochu</strong>. V tabu Safari notifikace nefungují, to je restrikce Apple.</li>
            <li><strong>macOS Safari:</strong> Zkontroluj System Settings → Notifications → Safari → tahle doména povolena.</li>
            <li><strong>Android Chrome / Desktop:</strong> Mělo by fungovat přímo. Zkontroluj "Do Not Disturb" / režim Nerušit.</li>
            <li><strong>Brave:</strong> Shields → Shields Down pro tuto stránku nebo povolit push v site settings.</li>
            <li>Zkus <strong>Vypnout</strong> a znovu <strong>Zapnout</strong> — obnoví se endpoint.</li>
          </ul>
        </div>
      </details>
    )}
  </section>
);
