// Ask the browser to treat our storage (OPFS, IndexedDB) as *persistent*
// so it's less likely to be evicted under memory pressure. This is the
// single best mitigation for the intermittent
//   UnknownError: The operation failed for an unknown transient reason
// that Safari throws when OPFS can't initialise — eviction is one of the
// documented triggers, per MDN:
//   "Eviction skips over origins granted persistence via navigator.storage.persist()."
//
// WebKit grants persistence without a user prompt based on engagement
// heuristics (PWA on home screen ≈ always approved, regular tabs vary).
// Chromium typically grants after repeat visits. Either way, asking is
// free and only improves resilience.

// Cached result so UI can read without waiting for the Promise — we set
// this once during startup.
let _granted: boolean | null = null;
export const isPersistGranted = (): boolean | null => _granted;

export async function requestPersistentStorage(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
  try {
    const already = await navigator.storage.persisted();
    if (already) {
      _granted = true;
      if (import.meta.env.DEV) console.info("[persist-storage] already granted");
      return;
    }
    const granted = await navigator.storage.persist();
    _granted = granted;
    console.info(`[persist-storage] granted: ${granted}`);
  } catch (e) {
    console.warn("[persist-storage] request failed:", (e as Error).message);
  }
}
