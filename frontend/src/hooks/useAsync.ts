// Generic async-data hook to replace the
//   useEffect + let mounted = true + .then/.catch + setState
// boilerplate that lived inline at 20+ sites.
//
// Returns the latest snapshot of {data, loading, error}. Re-runs when
// any value in `deps` changes; cancels stale results so a slow first
// fetch can't clobber a faster second one. Errors are captured into
// state — caller decides whether to render an ErrorBox or fall through.
//
// NOT a replacement for useCashu / Evolu / SSE patterns — those have
// their own state machines. This is for one-shot fetches that store
// the result locally.

import { useEffect, useState, type DependencyList } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: DependencyList,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    void fn()
      .then((data) => {
        if (mounted) setState({ data, loading: false, error: null });
      })
      .catch((error: Error) => {
        if (mounted) setState({ data: null, loading: false, error });
      });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
