// Spec-fetch boilerplate shared by LnurlPay and LnurlWithdraw views.
// Both views start with the exact same state machine: load the LNURL
// spec, narrow on `tag`, error out otherwise. Wraps useAsync and adds
// the tag check.

import { useMemo, useState, useEffect } from "react";
import { useAsync } from "./useAsync";
import { fetchLnurlSpec, type LnurlSpec } from "../lib/lnurl";

interface Result<T extends LnurlSpec> {
  spec: T | null;
  loading: boolean;
  err: string | null;
}

/** Fetch an LNURL spec and only return it when the `tag` matches the
 *  expected value. On mismatch (e.g. the user opened a payRequest URL
 *  in the withdraw view) the hook surfaces a Czech-language error
 *  message instead. */
export function useLnurlFlow<T extends LnurlSpec["tag"]>(
  url: string,
  expectedTag: T,
): Result<Extract<LnurlSpec, { tag: T }>> {
  const fetched = useAsync(() => fetchLnurlSpec(url), [url]);

  const [tagErr, setTagErr] = useState<string | null>(null);
  useEffect(() => {
    if (!fetched.data) { setTagErr(null); return; }
    if (fetched.data.tag !== expectedTag) {
      setTagErr(
        `Tento LNURL je typu ${fetched.data.tag}, ne ${expectedTag}. Použij QR scan z hlavní obrazovky.`,
      );
    } else {
      setTagErr(null);
    }
  }, [fetched.data, expectedTag]);

  const spec = useMemo(() => {
    if (!fetched.data || fetched.data.tag !== expectedTag) return null;
    return fetched.data as Extract<LnurlSpec, { tag: T }>;
  }, [fetched.data, expectedTag]);

  return {
    spec,
    loading: fetched.loading,
    err: tagErr ?? (fetched.error ? fetched.error.message : null),
  };
}
