import { useEffect, useRef } from "react";
import { API_BASE } from "../lib/http";
import type { ChannelEdit, ChannelMessage } from "../api";

/**
 * Subscribe to one or more channels over Server-Sent Events. The browser
 * `EventSource` auto-reconnects on network blips; we drop the connection
 * only when the component unmounts or the slug set changes.
 *
 * SSE is one-way (server → client). Posting messages still goes through
 * the normal `POST /api/channels/.../messages` endpoint, and the server
 * fans the resulting message out to everyone listening on the stream.
 */
export function useChannelStream(
  slugs: readonly string[],
  onMessage: (m: ChannelMessage) => void,
  ownerId?: string | null,
  onEdit?: (e: ChannelEdit) => void,
): void {
  // Stable key so we don't tear down the connection every re-render.
  const key = slugs.slice().sort().join(",");

  // Capture the latest callbacks in refs so we don't have to put them
  // in the effect's dep array — the EventSource lifecycle is tied to
  // the stream key, not to callback identity churn.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  useEffect(() => {
    if (!key) return;
    const qs = new URLSearchParams({ slugs: key });
    if (ownerId) qs.set("ownerId", ownerId);
    const url = `${API_BASE}/api/chat/stream?${qs}`;
    const es = new EventSource(url, { withCredentials: false });

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as
          | { kind: "message"; message: ChannelMessage }
          | { kind: "edit"; id: string; body: string; editedAt: string }
          | { kind: string };
        if (data.kind === "message" && "message" in data && data.message) {
          onMessageRef.current(data.message);
        } else if (data.kind === "edit" && "id" in data && "body" in data && "editedAt" in data) {
          onEditRef.current?.({ id: data.id, body: data.body, editedAt: data.editedAt });
        }
      } catch {
        /* malformed frame — ignore */
      }
    };

    // `onerror` fires on reconnect cycles too. EventSource handles
    // backoff itself, so we only log for diagnostics.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        console.warn("[chat-stream] closed");
      }
    };

    return () => { es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ownerId]);
}
