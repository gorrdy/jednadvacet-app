// Per-event "kdo jde" modal. Lists attendees who RSVP'd "going" with a
// known chat profile (avatar + display name + tier badge), plus a count
// of anonymous-token attendees ("+ X dalších bez profilu").
//
// Privacy note: the per-event_rsvp ownerId is only set when the user
// has a chat_user row — i.e. they've already chosen to be visible in
// chat under that name. So this modal doesn't reveal anyone who hasn't
// already opted into public identity. Anonymous RSVPs stay anonymous.

import { useEffect, useState, type FC } from "react";
import { fetchEventAttendees, type EventAttendees } from "../api";
import { initialsFor } from "../lib/imageResize";

interface Props {
  eventId: string;
  eventTitle: string;
  onClose: () => void;
}

export const AttendeeListModal: FC<Props> = ({ eventId, eventTitle, onClose }) => {
  const [data, setData] = useState<EventAttendees | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEventAttendees(eventId)
      .then((d) => {
        if (cancelled) return;
        if (!d) setErr("Nepodařilo se načíst seznam.");
        else setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [eventId]);

  return (
    <div className="pow-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pow-container attendee-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pow-close" onClick={onClose} aria-label="Zavřít">×</button>
        <div className="attendee-modal-body">
          <h3 style={{ margin: "0 0 0.3rem" }}>Kdo jde</h3>
          <p className="small muted" style={{ margin: "0 0 1rem" }}>{eventTitle}</p>

          {loading && <p className="small muted">Načítám…</p>}
          {err && <p className="error small">{err}</p>}
          {data && (
            <>
              {data.named.length === 0 && data.anonCount === 0 ? (
                <p className="small muted">Zatím nikdo nepotvrdil účast.</p>
              ) : (
                <ul className="attendee-list">
                  {data.named.map((a) => (
                    <li key={a.ownerId} className="attendee-row">
                      <span className="chat-avatar" aria-hidden="true">
                        {a.avatar
                          ? <img src={a.avatar} alt="" />
                          : <span className="initials">{initialsFor(a.displayName)}</span>}
                      </span>
                      <span className="attendee-name">{a.displayName}</span>
                      {a.tier >= 2 && (
                        <span className={`tier-badge tier-${a.tier}`} title={`Tier ${a.tier}`}>
                          T{a.tier}
                        </span>
                      )}
                    </li>
                  ))}
                  {data.anonCount > 0 && (
                    <li className="attendee-row attendee-row-anon">
                      <span className="chat-avatar" aria-hidden="true">
                        <span className="initials">?</span>
                      </span>
                      <span className="attendee-name muted">
                        + {data.anonCount} {data.anonCount === 1 ? "další bez profilu" : data.anonCount < 5 ? "další bez profilu" : "dalších bez profilu"}
                      </span>
                    </li>
                  )}
                </ul>
              )}
              {data.maybeCount > 0 && (
                <p className="small muted" style={{ marginTop: "0.8rem" }}>
                  Plus {data.maybeCount} „možná".
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
