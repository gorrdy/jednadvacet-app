// "X online" counter — polls /api/stats/online every 90s. The endpoint
// is cached on the backend for 60s so this is cheap. Returns null while
// loading or on error so the UI can hide gracefully.

import { useEffect, useState } from "react";
import { fetchOnlineCount } from "../api";

const POLL_INTERVAL_MS = 90 * 1000;

export function useOnlineCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const n = await fetchOnlineCount();
      if (!cancelled) setCount(n);
    };
    void tick();
    const id = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return count;
}
