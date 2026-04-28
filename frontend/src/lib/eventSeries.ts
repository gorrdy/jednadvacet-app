// Series-grouping for ICS recurring events.
//
// The ICS poller materialises every recurrence as its own row with an id
// shaped like `ics-<uid>-YYYY-MM-DD`. Without folding, a weekly meetup
// would dominate the calendar feed (12 instances ≈ a quarter of one
// year). We group instances by their `ics-<uid>` stem and keep only the
// next N upcoming entries per series — the rest are dropped.

import type { GlobalEvent } from "../data/events";

const ICS_INSTANCE_RE = /^(ics-.+)-\d{4}-\d{2}-\d{2}$/;

/** Stem of an ICS recurring-instance id, or the id itself for non-ICS
 *  events (admin-entered events have ids without the date suffix and
 *  are never folded). */
export function seriesKey(id: string): string {
  const m = id.match(ICS_INSTANCE_RE);
  return m ? m[1] : id;
}

/** Drop ICS recurrences past the first `head` instances per series.
 *  When `fold` is false (e.g. "past" scope where the user wants the
 *  full timeline), the input is returned as-is. */
export function foldRecurringSeries(
  events: readonly GlobalEvent[],
  { fold, head = 2 }: { fold: boolean; head?: number },
): GlobalEvent[] {
  if (!fold) return [...events];
  const seen = new Map<string, number>();
  const out: GlobalEvent[] = [];
  for (const ev of events) {
    const key = seriesKey(ev.id);
    const idx = seen.get(key) ?? 0;
    seen.set(key, idx + 1);
    if (idx < head) out.push(ev);
  }
  return out;
}
