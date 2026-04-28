// Tap-username-in-chat → modal with that user's profile (avatar, display
// name, bio, tier badge) plus "Start DM" CTA. Reuses the same shape that's
// already loaded in batch by Thread.tsx (`fetchChatProfiles`), but allows
// fetching by single id when the caller doesn't have it cached.
//
// Privacy: only shows what's already public in chat (display_name, avatar,
// bio that the user filled in themselves). Doesn't reveal anything new.

import { useEffect, useState, type FC } from "react";
import { fetchChatProfile, type ChatProfile } from "../api";
import { initialsFor } from "../lib/imageResize";

interface Props {
  ownerId: string;
  /** Optional: skip the fetch if the caller already has the profile. */
  preloaded?: ChatProfile | null;
  /** When user taps "Začít DM" — null disables the button (e.g. on self). */
  onStartDm?: ((ownerId: string, displayName: string) => void) | null;
  onClose: () => void;
}

export const UserProfileModal: FC<Props> = ({ ownerId, preloaded, onStartDm, onClose }) => {
  const [profile, setProfile] = useState<ChatProfile | null>(preloaded ?? null);
  const [loading, setLoading] = useState(!preloaded);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (preloaded) return;
    let cancelled = false;
    setLoading(true);
    fetchChatProfile(ownerId)
      .then((p) => {
        if (cancelled) return;
        if (!p) setErr("Profil se nepodařilo načíst.");
        else setProfile(p);
      })
      .catch(() => { if (!cancelled) setErr("Profil se nepodařilo načíst."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ownerId, preloaded]);

  return (
    <div className="pow-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pow-container user-profile-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pow-close" onClick={onClose} aria-label="Zavřít">×</button>
        <div className="user-profile-body">
          {loading && <p className="small muted">Načítám…</p>}
          {err && <p className="error small">{err}</p>}
          {profile && (
            <>
              <div className="user-profile-head">
                <span className="chat-avatar user-profile-avatar" aria-hidden="true">
                  {profile.avatar
                    ? <img src={profile.avatar} alt="" />
                    : <span className="initials">{initialsFor(profile.displayName)}</span>}
                </span>
                <div className="user-profile-name-row">
                  <strong className="user-profile-name">{profile.displayName}</strong>
                  {profile.tier >= 2 && (
                    <span className={`tier-badge tier-${profile.tier}`} title={`Tier ${profile.tier}`}>
                      T{profile.tier}
                    </span>
                  )}
                </div>
              </div>

              {profile.bio && (
                <p className="user-profile-bio">{profile.bio}</p>
              )}

              <div className="user-profile-meta small muted">
                <span>ID: <code className="mono" style={{ wordBreak: "break-all" }}>{profile.ownerId}</code></span>
              </div>

              {onStartDm && (
                <div className="row-actions" style={{ marginTop: "1rem", justifyContent: "center" }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => { onStartDm(profile.ownerId, profile.displayName); onClose(); }}
                  >
                    Začít DM
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
