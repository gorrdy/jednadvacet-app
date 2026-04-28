// One-time Cashu wallet bootstrap: seed the default mint on a fresh wallet
// and de-duplicate any historical extra cashuMint rows that share a URL.
//
// Lives at the top of the app tree (App.tsx) so it runs exactly once per
// session. Previously this logic lived inside useCashu, but that hook is
// called from 9 different components and on first mount they all raced
// to insert the default mint before Evolu's query had propagated the
// first row — producing 5+ duplicates of cashu.cz.
//
// The dedup branch is also one-shot: it cleans up old users' baggage on
// the next app open. Proofs and txs are keyed by mintUrl (string), not
// the mintId row, so removing the extra row keeps balances intact.
import { useEffect } from "react";
import { type SqliteBoolean } from "@evolu/common";
import { useQuery } from "@evolu/react";
import { allMintsQuery, useTypedEvolu } from "../evolu";
import { toNES1000, toNET100 } from "./evoluParse";

const DEFAULT_MINT_URL = "https://cashu.cz";
const DEFAULT_MINT_NAME = "cashu.cz";

export function useCashuBootstrap(): void {
  const mintRows = useQuery(allMintsQuery);
  const { insert, update } = useTypedEvolu();

  useEffect(() => {
    if (mintRows.length === 0) {
      const url = toNES1000(DEFAULT_MINT_URL);
      const name = toNET100(DEFAULT_MINT_NAME);
      if (url) insert("cashuMint", { url, ...(name ? { name } : {}) });
      return;
    }
    // Multiple rows with the same URL → cleanup pass. Keep the first one
    // (Evolu orders cashuMint rows by createdAt asc), soft-delete the rest.
    if (mintRows.length < 2) return;
    const seen = new Set<string>();
    const dupeIds: string[] = [];
    for (const r of mintRows) {
      const url = String(r.url ?? "");
      if (!url) continue;
      if (seen.has(url)) dupeIds.push(String(r.id));
      else seen.add(url);
    }
    for (const id of dupeIds) {
      update("cashuMint", {
        id: id as never,
        isDeleted: 1 as SqliteBoolean,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintRows.length]);
}
