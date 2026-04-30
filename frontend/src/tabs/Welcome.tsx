import type { FC } from "react";

interface Props {
  onContinue: () => void;
}

export const Welcome: FC<Props> = ({ onContinue }) => (
  <div className="welcome">
    <div className="welcome-card">
      <img
        className="welcome-logo"
        src="/brand/jednadvacet-jeden-radek-bila-nbg.svg"
        alt="Jednadvacet"
      />
      <p className="tagline">
        Komunita ve tvé kapse.<br />
        Články, meetupy, lidé.
      </p>

      <div className="welcome-features">
        <div className="welcome-feature">
          <span className="num">01</span>
          <div className="body">
            <strong>Žádné účty, žádné hesla.</strong>
            <span>Tvá identita je jen na tvém zařízení — 24 slov tě vrátí všude.</span>
          </div>
        </div>
        <div className="welcome-feature">
          <span className="num">02</span>
          <div className="body">
            <strong>Kalendář všech jednadvacítek.</strong>
            <span>Vybereš si města a uvidíš jen to, co tě zajímá.</span>
          </div>
        </div>
        <div className="welcome-feature">
          <span className="num">03</span>
          <div className="body">
            <strong>Anonymní notifikace.</strong>
            <span>Server ví o tagech (Brno, Lightning…), ale ne o tobě.</span>
          </div>
        </div>
      </div>

      <button className="btn btn-primary btn-full" onClick={onContinue}>
        Pojďme na to
      </button>

      <p className="footnote">
        SYNC · EVOLU · GORRDY.CZ
      </p>
    </div>
  </div>
);
