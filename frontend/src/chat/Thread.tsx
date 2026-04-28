import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { deleteChannelMessage, editChannelMessage, listChannelMessages, postChannelMessage, toggleMessageReaction, REACTION_EMOJIS, type ChannelEdit, type ChannelMessage, type MessageReaction } from "../api";
import { MESSAGE_MAX_CHARS } from "../../../shared/constants.js";
import { getOrCreateChatToken } from "../lib/chatIdentity";
import { useChatProfile } from "../hooks/useChatProfile";
import { useChatProfileMap } from "../hooks/useChatProfileMap";
import { useChannelStream } from "../hooks/useChannelStream";
import { formatRelative, formatTime } from "../lib/fmt";
import { Avatar } from "../components/Avatar";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { UserProfileModal } from "../components/UserProfileModal";

interface Props {
  slug: string;
  label: string;
  onBack: () => void;
  /** Called when the user taps an author name in a public channel. If set,
   *  the thread renders author names as buttons that open a "send DM" flow
   *  for other users (disabled for self + already-DM channels). */
  onAuthorRequest?: (ownerId: string, name: string) => void;
}

// SSE gives us instant delivery; the slow background poll is a belt-and-
// braces fallback for flaky networks / proxies that drop the stream.
const POLL_MS = 60_000;

export const Thread: FC<Props> = ({ slug, label, onBack, onAuthorRequest }) => {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [viewingProfile, setViewingProfile] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  // Per-message overflow menu (tří-tečka) and inline edit state. Only one
  // menu / one edit at a time — opening a new one closes the previous.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Per-device token (for delete / edit auth) — never leaves localStorage.
  const token = useRef(getOrCreateChatToken()).current;
  // Cross-device identity: nickname resolved from backend per-ownerId.
  const { profile, loading: profileLoading, ownerId } = useChatProfile();
  // Batch-fetch profiles (avatar + bio) for all unique authors in this thread.
  const ownerIds = useMemo(
    () => messages.map((m) => m.authorOwnerId).filter((x): x is string => !!x),
    [messages],
  );
  const profileMap = useChatProfileMap(ownerIds);

  // DM and event channels both require ownerId on every request for the
  // backend's `canAccessChannel` gate (DM: must be a participant; event:
  // must have RSVP'd). Without ownerId the GET returns 401 and our poll
  // would clobber local state with an empty array — that was the
  // "messages disappear after sending" bug in event chats.
  const isDm = slug.startsWith("dm:");
  const requiresOwner = isDm || slug.startsWith("event:");

  // Initial load + slow background poll as SSE fallback.
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const ms = await listChannelMessages(slug, undefined, 100, requiresOwner ? ownerId : undefined);
      if (!mounted) return;
      setMessages(ms);
      setLoading(false);
    };
    void load();
    const poll = setInterval(load, POLL_MS);
    return () => { mounted = false; clearInterval(poll); };
  }, [slug, requiresOwner, ownerId]);

  // Real-time fan-in via SSE. Both new messages and in-place edits flow
  // through here — the message handler upserts (id-replace if present,
  // append otherwise) so optimistic local state and SSE end up identical.
  const streamSlugs = useMemo(() => [slug], [slug]);
  const onStreamed = useCallback((m: ChannelMessage) => {
    if (m.channelSlug !== slug) return;
    setMessages((prev) => {
      const idx = prev.findIndex((x) => x.id === m.id);
      if (idx === -1) return [...prev, m];
      const next = prev.slice();
      next[idx] = m;
      return next;
    });
  }, [slug]);
  const onEdited = useCallback((e: ChannelEdit) => {
    // Patch only body + editedAt. Reactions aren't shipped on edit events
    // (they're per-viewer); the local copy already has the right values.
    setMessages((prev) => prev.map((m) =>
      m.id === e.id ? { ...m, body: e.body, editedAt: e.editedAt } : m,
    ));
  }, []);
  useChannelStream(streamSlugs, onStreamed, requiresOwner ? ownerId : null, onEdited);

  // Scroll to bottom on new messages. Wrapped in rAF so the layout can settle
  // first — important on iOS Safari, where setting `scrollTop` synchronously
  // during the same frame as a state update + virtual-keyboard transition has
  // historically caused tab crashes ("WebContent ran out of memory" white
  // screen on send).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(raf);
  }, [messages.length]);

  // Click outside any open menu/picker closes it. We also close on Escape
  // for keyboard parity. The handler runs at the document level — each
  // open menu's button stops propagation so its own click doesn't fall
  // through and immediately re-close it.
  useEffect(() => {
    if (menuFor === null && pickingFor === null) return;
    const close = () => { setMenuFor(null); setPickingFor(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor, pickingFor]);

  const send = async () => {
    if (!profile || sending) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSending(true); setErr(null);
    try {
      const r = await postChannelMessage(slug, { token, ownerId, body: trimmed });
      if (!r.ok) {
        setErr(
          r.error === "too many messages (slow down)" ? "Pomalejc — moc zpráv krátce za sebou." :
          r.error === "set nickname first" ? "Nastav si přezdívku v Nastavení → Profil." :
          r.error === "event chat archived (read-only)" ? "Vlákno k akci je archivované — jen pro čtení." :
          r.error,
        );
        return;
      }
      // Optimistic upsert with id-dedupe — SSE can race us and deliver the
      // same message back before React flushes our state. Both paths use
      // the upsert pattern; whichever wins we end up with one copy.
      setMessages((prev) => prev.some((x) => x.id === r.message.id) ? prev : [...prev, r.message]);
      setDraft("");
    } catch (e) {
      setErr((e as Error).message ?? "Síťová chyba.");
    } finally {
      setSending(false);
    }
  };

  const removeOwn = async (m: ChannelMessage) => {
    if (m.authorToken !== token) return;
    if (!window.confirm("Smazat tuhle zprávu?")) return;
    const r = await deleteChannelMessage(slug, m.id, token);
    if (!r.ok) { alert(r.error ?? "Smazání selhalo."); return; }
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
  };

  const beginEdit = (m: ChannelMessage) => {
    setEditingFor(m.id);
    setEditDraft(m.body);
    setMenuFor(null);
  };
  const cancelEdit = () => { setEditingFor(null); setEditDraft(""); };
  const saveEdit = async (m: ChannelMessage) => {
    if (m.authorToken !== token || savingEdit) return;
    const trimmed = editDraft.trim();
    if (!trimmed) { cancelEdit(); return; }
    if (trimmed === m.body) { cancelEdit(); return; }
    setSavingEdit(true);
    try {
      const r = await editChannelMessage(slug, m.id, { token, body: trimmed });
      if (!r.ok) { alert(r.error ?? "Úprava selhala."); return; }
      setMessages((prev) => prev.map((x) =>
        x.id === m.id ? { ...x, body: r.body, editedAt: r.editedAt } : x,
      ));
      cancelEdit();
    } finally {
      setSavingEdit(false);
    }
  };

  // Toggle a reaction. Optimistic — the SSE path doesn't broadcast
  // reaction events yet (followup), so we update local state in place
  // and let the next refresh reconcile if anything diverges.
  const toggleReaction = useCallback(async (msg: ChannelMessage, emoji: string) => {
    if (!ownerId) return;
    const reactions = msg.reactions ?? [];
    const existing = reactions.find((r) => r.emoji === emoji);
    const op = existing?.mine ? "remove" : "add";
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msg.id) return m;
      const list = m.reactions ?? [];
      const cur = list.find((r) => r.emoji === emoji);
      let next: MessageReaction[];
      if (op === "add") {
        if (!cur) next = [...list, { emoji, count: 1, mine: true }];
        else next = list.map((r) => r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r);
      } else {
        next = list
          .map((r) => r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r)
          .filter((r) => r.count > 0);
      }
      return { ...m, reactions: next };
    }));
    setPickingFor(null);
    void toggleMessageReaction(msg.id, ownerId, emoji, op);
  }, [ownerId]);

  // No nickname yet — nudge them to Moje instead of a per-device input.
  const needsNickname = !profileLoading && !profile;

  // Discord-style author grouping: a new "header row" (avatar + name + time)
  // only appears when the author changes OR more than 7 minutes elapsed since
  // the previous message in the same thread. Within a tight burst from the
  // same author the messages stack tightly, indented under the avatar gutter.
  const AUTHOR_GROUP_GAP_MS = 7 * 60_000;

  // The bubble + (own-only) overflow-menu button + edit-mode textarea live
  // in one place so head-row and continuation-row don't drift apart.
  const renderBubble = (m: ChannelMessage, mine: boolean) => {
    const isEditing = editingFor === m.id;
    if (isEditing) {
      return (
        <div className="chat-bubble chat-bubble-editing">
          <textarea
            className="chat-edit-input"
            value={editDraft}
            autoFocus
            maxLength={MESSAGE_MAX_CHARS}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(m); }
              if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
            }}
          />
          <div className="chat-edit-actions">
            <button type="button" className="btn small" onClick={cancelEdit} disabled={savingEdit}>Zrušit</button>
            <button type="button" className="btn small primary" onClick={() => void saveEdit(m)} disabled={savingEdit || !editDraft.trim()}>
              {savingEdit ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="chat-bubble">
        {m.body}
        {m.editedAt && <span className="chat-edited-tag" title={`Upraveno ${formatRelative(m.editedAt)}`}>(upraveno)</span>}
        {mine && (
          <div className="chat-msg-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="chat-msg-menu-btn"
              onClick={() => setMenuFor((id) => id === m.id ? null : m.id)}
              aria-label="Možnosti zprávy"
              title="Možnosti"
            >
              ⋯
            </button>
            {menuFor === m.id && (
              <div className="chat-msg-menu" role="menu">
                <button type="button" role="menuitem" className="chat-msg-menu-item" onClick={() => beginEdit(m)}>
                  Upravit
                </button>
                <button type="button" role="menuitem" className="chat-msg-menu-item danger" onClick={() => { setMenuFor(null); void removeOwn(m); }}>
                  Smazat
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="chat-thread">
      <div className="chat-thread-head">
        {/* On mobile the messages-topbar (hamburger) handles channel switching;
         *  on desktop the sidebar is always visible. We keep `onBack` available
         *  via a small "show channels" button shown only on narrow screens. */}
        <button className="chat-thread-back" onClick={onBack} aria-label="Zobrazit kanály">☰</button>
        <h2>{label}</h2>
        <div />
      </div>

      {needsNickname && (
        <div className="card" style={{ padding: "0.85rem 1rem", marginBottom: "0.6rem", background: "var(--ember-soft)", borderColor: "var(--ember-deep)" }}>
          <p className="hint" style={{ color: "var(--ink)", margin: 0 }}>
            <strong>Před psaním si zvol přezdívku.</strong> Otevři{" "}
            <span className="kbd">Nastavení → Profil</span>{" "}
            a zadej jméno — objeví se stejné na všech tvých zařízeních.
          </p>
        </div>
      )}

      <div className="chat-list" ref={listRef}>
        {loading ? (
          <LoadingSpinner label="Načítám zprávy…" />
        ) : messages.length === 0 ? (
          <div className="empty-state" style={{ padding: "2rem 0" }}>
            <div className="glyph">ZATÍM TICHO</div>
            <p>Napiš první zprávu v tomto kanálu.</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const mine = m.authorOwnerId ? m.authorOwnerId === ownerId : m.authorToken === token;
            const prev = messages[i - 1];
            const sameAuthor = prev && (prev.authorOwnerId ?? prev.authorToken) === (m.authorOwnerId ?? m.authorToken);
            const tinyGap = prev && (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()) < AUTHOR_GROUP_GAP_MS;
            const newAuthor = !sameAuthor || !tinyGap;
            const authorProfile = m.authorOwnerId
              ? (mine ? profile : profileMap[m.authorOwnerId])
              : null;
            const avatar = authorProfile?.avatar ?? null;
            const name = authorProfile?.displayName ?? m.authorName;
            const tier = authorProfile?.tier ?? 1;
            const hasReactions = (m.reactions?.length ?? 0) > 0;
            const showReactRow = hasReactions || pickingFor === m.id;
            const canReact = !!ownerId && !!profile && editingFor !== m.id;
            return (
              <div
                key={m.id}
                className={`chat-msg ${newAuthor ? "is-head" : "is-cont"}`}
              >
                {newAuthor ? (
                  <div className="chat-msg-row">
                    <Avatar src={avatar} name={name} className="chat-avatar" />
                    <div className="chat-msg-body">
                      <div className="chat-msg-meta">
                        {!mine && m.authorOwnerId ? (
                          <button
                            type="button"
                            className="chat-author-btn"
                            onClick={() => setViewingProfile(m.authorOwnerId!)}
                            title="Zobrazit profil"
                          >
                            <strong>{name}</strong>
                          </button>
                        ) : (
                          <strong className="chat-author-name">{name}</strong>
                        )}
                        {tier >= 2 && (
                          <span className={`tier-badge tier-${tier}`} title={`Tier ${tier}`}>T{tier}</span>
                        )}
                        <span className="chat-msg-time" title={formatRelative(m.createdAt)}>{formatTime(m.createdAt)}</span>
                      </div>
                      {renderBubble(m, mine)}
                      {canReact && !showReactRow && (
                        <button
                          type="button"
                          className="reaction-add-btn floating"
                          onClick={(e) => { e.stopPropagation(); setPickingFor(m.id); }}
                          aria-label="Přidat reakci"
                          title="Přidat reakci"
                        >
                          🙂+
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="chat-msg-row chat-msg-row-cont">
                    <span className="chat-msg-time-gutter" aria-hidden="true">{formatTime(m.createdAt)}</span>
                    <div className="chat-msg-body">
                      {renderBubble(m, mine)}
                      {canReact && !showReactRow && (
                        <button
                          type="button"
                          className="reaction-add-btn floating"
                          onClick={(e) => { e.stopPropagation(); setPickingFor(m.id); }}
                          aria-label="Přidat reakci"
                          title="Přidat reakci"
                        >
                          🙂+
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {showReactRow && editingFor !== m.id && (
                  <div className="chat-reactions">
                    {(m.reactions ?? []).map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        className={`reaction-chip ${r.mine ? "mine" : ""}`}
                        onClick={() => toggleReaction(m, r.emoji)}
                        title={r.mine ? "Klikni pro odebrání" : "Klikni pro přidání"}
                      >
                        {r.emoji} <span className="count">{r.count}</span>
                      </button>
                    ))}
                    {canReact && pickingFor !== m.id && (
                      <button
                        type="button"
                        className="reaction-add-btn"
                        onClick={(e) => { e.stopPropagation(); setPickingFor((p) => p === m.id ? null : m.id); }}
                        aria-label="Přidat reakci"
                        title="Přidat reakci"
                      >
                        🙂+
                      </button>
                    )}
                    {pickingFor === m.id && (
                      <div className="reaction-picker" onClick={(e) => e.stopPropagation()}>
                        {REACTION_EMOJIS.map((e) => (
                          <button
                            key={e}
                            type="button"
                            className="reaction-pick"
                            onClick={() => toggleReaction(m, e)}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="chat-composer">
        {err && <p className="error small">{err}</p>}
        <div className="chat-composer-input">
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setErr(null); }}
            placeholder={needsNickname ? "Nejdřív si nastav přezdívku v Moje…" : `Napiš zprávu v ${label}`}
            disabled={needsNickname}
            maxLength={MESSAGE_MAX_CHARS}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
          />
          <button
            className="chat-send-btn"
            onClick={send}
            disabled={sending || needsNickname || !draft.trim()}
            aria-label="Poslat"
          >
            {sending ? "…" : "↑"}
          </button>
        </div>
      </div>

      {viewingProfile && (
        <UserProfileModal
          ownerId={viewingProfile}
          preloaded={profileMap[viewingProfile] ?? null}
          onStartDm={onAuthorRequest && !isDm ? onAuthorRequest : null}
          onClose={() => setViewingProfile(null)}
        />
      )}
    </div>
  );
};
