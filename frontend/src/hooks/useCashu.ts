import { useQuery } from "@evolu/react";
import { type SqliteBoolean } from "@evolu/common";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet,
  getDecodedToken,
  getEncodedToken,
  MintQuoteState,
  MeltQuoteState,
  CheckStateEnum,
  type Proof,
  type Token,
  type MintQuoteBolt11Response,
  type MeltQuoteBolt11Response,
} from "@cashu/cashu-ts";
import {
  allMintsQuery,
  allProofsQuery,
  allTxQuery,
  useTypedEvolu,
} from "../evolu";
import { toNES1000, toNET100 } from "../lib/evoluParse";

export const DEFAULT_MINT_URL = "https://cashu.cz";

export interface StoredProof {
  id: string;
  mintUrl: string;
  amount: number;
  state: "active" | "pending" | "spent";
  secret: string;
  proof: Proof;
}

export interface StoredMint {
  id: string;
  url: string;
  name: string | null;
}

export interface StoredTx {
  id: string;
  type: "mint" | "melt" | "send" | "receive";
  amount: number;
  mintUrl: string;
  /**
   * For send tx specifically:
   *   "pending"   — token created, not yet redeemed by recipient
   *   "paid"      — recipient swapped the token at the mint (proofs SPENT)
   *   "reclaimed" — sender pulled it back via wallet.receive (we hold the funds again)
   *   "failed"    — never made it
   */
  status: "pending" | "paid" | "failed" | "reclaimed";
  memo: string | null;
  token: string | null;
  invoice: string | null;
  quoteId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Auto-reclaim threshold — sent tokens still UNSPENT at the mint after this
 *  long get receive()'d back into our wallet. */
const SEND_RECLAIM_AFTER_MS = 2 * 60 * 60 * 1000;

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

// Proof.amount in cashu-ts v4 is an Amount class instance. Its `toJSON()`
// returns a decimal *string* (e.g. "128"), so after round-trip through
// JSON.stringify → Evolu → JSON.parse our `proof.amount` arrives as a string.
// This helper collapses all the supported runtime shapes down to a number so
// balance checks don't silently compute `0`.
function amountToNumber(a: unknown): number {
  if (typeof a === "number") return a;
  if (typeof a === "bigint") return Number(a);
  if (typeof a === "string") {
    const n = Number(a);
    return Number.isFinite(n) ? n : 0;
  }
  if (a && typeof a === "object") {
    const obj = a as { toNumber?: () => number; toString?: () => string; value?: unknown };
    if (typeof obj.toNumber === "function") {
      try { return obj.toNumber(); } catch { /* fall through */ }
    }
    if (typeof obj.value === "bigint") return Number(obj.value);
    if (typeof obj.value === "number") return obj.value;
    if (typeof obj.toString === "function") {
      const n = Number(obj.toString());
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function parseProof(row: {
  id: string;
  mintUrl: unknown;
  amount: unknown;
  state: unknown;
  secret: unknown;
  data: unknown;
}): StoredProof | null {
  try {
    const proof = JSON.parse(asString(row.data)) as Proof;
    return {
      id: row.id,
      mintUrl: asString(row.mintUrl),
      amount: Number(asString(row.amount)),
      state: (asString(row.state) || "active") as StoredProof["state"],
      secret: asString(row.secret),
      proof,
    };
  } catch {
    return null;
  }
}

/** Bucket proofs by their `mintUrl` so a caller can fan out one batch
 *  per mint (each `wallet.checkProofsStates` call is mint-specific). */
function groupProofsByMint(proofs: readonly StoredProof[]): Map<string, StoredProof[]> {
  const byMint = new Map<string, StoredProof[]>();
  for (const p of proofs) {
    const arr = byMint.get(p.mintUrl);
    if (arr) arr.push(p);
    else byMint.set(p.mintUrl, [p]);
  }
  return byMint;
}

// Per-mint wallet cache so we don't re-load keysets on every call.
const walletCache = new Map<string, Promise<Wallet>>();
async function getWallet(mintUrl: string): Promise<Wallet> {
  const hit = walletCache.get(mintUrl);
  if (hit) return hit;
  const p = (async () => {
    const w = new Wallet(mintUrl);
    await w.loadMint();
    return w;
  })();
  walletCache.set(mintUrl, p);
  try {
    return await p;
  } catch (e) {
    walletCache.delete(mintUrl);
    throw e;
  }
}

export function useCashu() {
  const mintRows = useQuery(allMintsQuery);
  const proofRows = useQuery(allProofsQuery);
  const txRows = useQuery(allTxQuery);
  const { insert, update } = useTypedEvolu();

  const mints: StoredMint[] = useMemo(
    () => mintRows.map((r) => ({
      id: r.id,
      url: asString(r.url),
      name: r.name ? asString(r.name) : null,
    })),
    [mintRows],
  );

  const proofs: StoredProof[] = useMemo(
    () => proofRows.map(parseProof).filter((p): p is StoredProof => p !== null),
    [proofRows],
  );

  const txs: StoredTx[] = useMemo(
    () => txRows.map((t) => ({
      id: t.id,
      type: (asString(t.type) || "receive") as StoredTx["type"],
      amount: Number(asString(t.amount)),
      mintUrl: asString(t.mintUrl),
      status: (asString(t.status) || "paid") as StoredTx["status"],
      memo: t.memo ? asString(t.memo) : null,
      token: t.token ? asString(t.token) : null,
      invoice: t.invoice ? asString(t.invoice) : null,
      quoteId: t.quoteId ? asString(t.quoteId) : null,
      createdAt: asString(t.createdAt),
      updatedAt: asString(t.updatedAt),
    })),
    [txRows],
  );

  // Active mint selector. Default-mint seeding and dedup live in
  // `useCashuBootstrap` (called once from App.tsx) — not here, because
  // useCashu has 9 callers and they would race on first mount.
  const [activeMintUrl, setActiveMintUrl] = useState<string | null>(null);

  // Balance per mint + total.
  const balances = useMemo(() => {
    const byMint: Record<string, number> = {};
    let total = 0;
    for (const p of proofs) {
      if (p.state !== "active") continue;
      byMint[p.mintUrl] = (byMint[p.mintUrl] ?? 0) + p.amount;
      total += p.amount;
    }
    return { total, byMint };
  }, [proofs]);

  // ── Proof storage helpers ──────────────────────────────────────

  const storeProofs = useCallback(
    (mintUrl: string, newProofs: Proof[]) => {
      const existing = new Set(proofs.map((p) => p.secret));
      const mintV = toNES1000(mintUrl);
      const stateV = toNET100("active");
      if (!mintV || !stateV) return;
      for (const p of newProofs) {
        if (existing.has(p.secret)) continue;
        const amountV = toNET100(String(amountToNumber(p.amount)));
        const secretV = toNES1000(p.secret);
        const dataV = toNES1000(JSON.stringify(p));
        if (!amountV || !secretV || !dataV) continue;
        insert("cashuProof", {
          mintUrl: mintV,
          amount: amountV,
          state: stateV,
          secret: secretV,
          data: dataV,
        });
      }
    },
    [proofs, insert],
  );

  const markProofsSpent = useCallback(
    (proofIds: string[]) => {
      const stateV = toNET100("spent");
      if (!stateV) return;
      for (const id of proofIds) {
        update("cashuProof", { id: id as never, state: stateV });
      }
    },
    [update],
  );

  const markProofsActive = useCallback(
    (proofIds: string[]) => {
      const stateV = toNET100("active");
      if (!stateV) return;
      for (const id of proofIds) {
        update("cashuProof", { id: id as never, state: stateV });
      }
    },
    [update],
  );

  // ── Add / remove mint ──────────────────────────────────────────

  const addMint = useCallback(
    async (url: string, name?: string) => {
      const normalized = url.replace(/\/+$/, "");
      if (mints.some((m) => m.url === normalized)) return mints.find((m) => m.url === normalized);
      // Verify mint responds before adding
      try {
        await getWallet(normalized);
      } catch (e) {
        throw new Error(`Mint nedostupný: ${(e as Error).message}`);
      }
      const urlV = toNES1000(normalized);
      const nameV = toNET100(name);
      if (!urlV) throw new Error("Neplatná URL");
      insert("cashuMint", { url: urlV, ...(nameV ? { name: nameV } : {}) });
    },
    [mints, insert],
  );

  const removeMint = useCallback(
    (id: string) => {
      update("cashuMint", { id: id as never, isDeleted: 1 as SqliteBoolean });
    },
    [update],
  );

  // ── Transactions ───────────────────────────────────────────────

  const addTx = useCallback(
    (tx: {
      type: StoredTx["type"];
      amount: number;
      mintUrl: string;
      status: StoredTx["status"];
      memo?: string;
      token?: string;
      invoice?: string;
      quoteId?: string;
    }) => {
      const type = toNET100(tx.type);
      const amount = toNET100((tx.type === "send" || tx.type === "melt" ? "-" : "+") + String(Math.abs(tx.amount)));
      const mintUrl = toNES1000(tx.mintUrl);
      const status = toNET100(tx.status);
      if (!type || !amount || !mintUrl || !status) return null;
      const memo = toNES1000(tx.memo);
      const token = toNES1000(tx.token);
      const invoice = toNES1000(tx.invoice);
      const quoteId = toNES1000(tx.quoteId);
      const result = insert("cashuTx", {
        type, amount, mintUrl, status,
        ...(memo ? { memo } : {}),
        ...(token ? { token } : {}),
        ...(invoice ? { invoice } : {}),
        ...(quoteId ? { quoteId } : {}),
      });
      return (result as { id?: string } | undefined)?.id ?? null;
    },
    [insert],
  );

  const updateTxStatus = useCallback(
    (id: string, status: StoredTx["status"]) => {
      const s = toNET100(status);
      if (!s) return;
      update("cashuTx", { id: id as never, status: s });
    },
    [update],
  );

  // ── High-level operations ──────────────────────────────────────

  /** Request a Lightning invoice to deposit sats into the mint. */
  const requestMint = useCallback(
    async (mintUrl: string, amount: number, memo?: string): Promise<{ quote: MintQuoteBolt11Response; txId: string | null }> => {
      const wallet = await getWallet(mintUrl);
      const quote = await wallet.createMintQuoteBolt11(amount, memo ?? "Jednadvacet");
      const txId = addTx({
        type: "mint",
        amount,
        mintUrl,
        status: "pending",
        ...(memo ? { memo } : {}),
        invoice: quote.request,
        quoteId: quote.quote,
      });
      return { quote, txId };
    },
    [addTx],
  );

  /** Poll mint to see if user's Lightning invoice has been paid; if yes, mint proofs. */
  const claimMintIfPaid = useCallback(
    async (mintUrl: string, amount: number, quoteId: string, txId: string | null): Promise<boolean> => {
      const wallet = await getWallet(mintUrl);
      const status = await wallet.checkMintQuoteBolt11(quoteId);

      // ISSUED means the mint already handed out proofs for this quote —
      // either we did (previous poll / different device with same mnemonic)
      // and the tx update just didn't land, or there's a retry race. Either
      // way the money is safely in our possession; just flip tx → paid.
      if (status.state === MintQuoteState.ISSUED) {
        if (txId) updateTxStatus(txId, "paid");
        return true;
      }
      if (status.state !== MintQuoteState.PAID) return false;

      // PAID: mint has the sats, hand us proofs. If mintProofs throws because
      // somebody beat us to it (race with concurrent poll / sibling device),
      // swallow the error and still mark paid — the proofs will arrive via
      // Evolu sync or be recoverable from the ISSUED branch above.
      try {
        const newProofs = await wallet.mintProofsBolt11(amount, quoteId);
        storeProofs(mintUrl, newProofs);
      } catch (e) {
        console.warn("[mint] mintProofsBolt11 failed (likely race):", (e as Error).message);
      }
      if (txId) updateTxStatus(txId, "paid");
      return true;
    },
    [storeProofs, updateTxStatus],
  );

  /**
   * Claim a Cashu mint quote that was created server-side for an
   * incoming Lightning Address payment. The quote is paid (mint has the
   * sats); we redeem it for proofs tied to *our* secrets and record a
   * "receive" tx so it shows in history. Returns true on success.
   *
   * No txId argument because the tx row is created here — the LNURL flow
   * has no preceding `requestMint` call from the user, so there's no
   * existing `pending` tx to flip.
   */
  const claimLnurlPayment = useCallback(
    async (mintUrl: string, amount: number, quoteId: string, comment: string | null): Promise<boolean> => {
      try {
        const wallet = await getWallet(mintUrl);
        const status = await wallet.checkMintQuoteBolt11(quoteId);
        // Quote not paid (or already issued elsewhere) — caller should
        // skip and try again later.
        if (status.state !== MintQuoteState.PAID && status.state !== MintQuoteState.ISSUED) {
          return false;
        }
        // ISSUED can mean a sibling device already redeemed; mintProofs
        // will throw, which we swallow to keep the tx-row write idempotent.
        try {
          const newProofs = await wallet.mintProofsBolt11(amount, quoteId);
          storeProofs(mintUrl, newProofs);
        } catch (e) {
          console.warn("[lnurlp] mintProofsBolt11 failed (likely sibling-device race):", (e as Error).message);
        }
        addTx({
          type: "mint",
          amount,
          mintUrl,
          status: "paid",
          ...(comment ? { memo: `⚡ ${comment}` } : { memo: "⚡ Lightning Address" }),
          quoteId,
        });
        return true;
      } catch (e) {
        console.warn("[lnurlp] claim failed:", (e as Error).message);
        return false;
      }
    },
    [storeProofs, addTx],
  );

  /**
   * Self-healing: walk every still-pending mint/melt tx and ask the mint
   * what actually happened. Fixes the common "user closed the receive
   * screen after the invoice was paid but before polling could update the
   * status" case. Runs on app open (wallet tab mount), cheap in practice.
   */
  const reconcilePendingTxs = useCallback(async (): Promise<void> => {
    const pending = txs.filter((t) => t.status === "pending" && t.quoteId);
    if (pending.length === 0) return;

    for (const t of pending) {
      try {
        const wallet = await getWallet(t.mintUrl);
        if (t.type === "mint") {
          const q = await wallet.checkMintQuoteBolt11(t.quoteId!);
          if (q.state === MintQuoteState.ISSUED) {
            updateTxStatus(t.id, "paid");
          } else if (q.state === MintQuoteState.PAID) {
            try {
              const newProofs = await wallet.mintProofsBolt11(Math.abs(t.amount), t.quoteId!);
              storeProofs(t.mintUrl, newProofs);
            } catch {
              /* race — someone already claimed; still mark paid */
            }
            updateTxStatus(t.id, "paid");
          }
          // UNPAID: leave as pending; user hasn't paid the invoice yet.
        } else if (t.type === "melt") {
          const q = await wallet.checkMeltQuoteBolt11(t.quoteId!);
          if (q.state === MeltQuoteState.PAID) updateTxStatus(t.id, "paid");
          else if (q.state === MeltQuoteState.UNPAID) updateTxStatus(t.id, "failed");
          // PENDING: actively being routed; leave alone.
        }
      } catch (e) {
        console.warn("[reconcile]", t.type, t.id, (e as Error).message);
      }
    }
  }, [txs, storeProofs, updateTxStatus]);

  /**
   * Self-healing: take every locally `spent` proof, ask the mint what state
   * it's actually in, and resurrect (→ active) any that the mint reports as
   * UNSPENT. Recovers funds from earlier versions of createSendToken /
   * meltToInvoice that incorrectly marked untouched originals as spent
   * (cashu-ts returns originals untouched in `keep` when an offline exact
   * match works or only a subset of inputs gets swapped).
   */
  const recoverProofs = useCallback(async (): Promise<number> => {
    const spentLocal = proofs.filter((p) => p.state === "spent");
    if (spentLocal.length === 0) return 0;

    let recovered = 0;
    for (const [mintUrl, group] of groupProofsByMint(spentLocal)) {
      try {
        const wallet = await getWallet(mintUrl);
        const states = await wallet.checkProofsStates(group.map((p) => ({ secret: p.secret })));
        const toResurrect: string[] = [];
        for (let i = 0; i < group.length; i++) {
          if (states[i]?.state === CheckStateEnum.UNSPENT) {
            toResurrect.push(group[i].id);
            recovered += group[i].amount;
          }
        }
        if (toResurrect.length > 0) {
          markProofsActive(toResurrect);
          console.info(`[recover] ${toResurrect.length} proofs (${recovered} sats) resurrected from ${mintUrl}`);
        }
      } catch (e) {
        console.warn("[recover]", mintUrl, (e as Error).message);
      }
    }
    return recovered;
  }, [proofs, markProofsActive]);

  /**
   * Verify every locally-active proof against the mint and mark spent any
   * the mint reports as SPENT (e.g. recipient already redeemed a token we
   * sent earlier, or the proof was somehow consumed elsewhere). Keeps the
   * balance in sync with reality.
   */
  const verifyActiveProofs = useCallback(async (): Promise<number> => {
    const activeLocal = proofs.filter((p) => p.state === "active");
    if (activeLocal.length === 0) return 0;

    let pruned = 0;
    for (const [mintUrl, group] of groupProofsByMint(activeLocal)) {
      try {
        const wallet = await getWallet(mintUrl);
        const states = await wallet.checkProofsStates(group.map((p) => ({ secret: p.secret })));
        const toSpend: string[] = [];
        for (let i = 0; i < group.length; i++) {
          if (states[i]?.state === CheckStateEnum.SPENT) {
            toSpend.push(group[i].id);
            pruned += group[i].amount;
          }
        }
        if (toSpend.length > 0) {
          markProofsSpent(toSpend);
          console.info(`[verify] pruned ${toSpend.length} stale-active proofs (${pruned} sats) at ${mintUrl}`);
        }
      } catch (e) {
        console.warn("[verify]", mintUrl, (e as Error).message);
      }
    }
    return pruned;
  }, [proofs, markProofsSpent]);

  /**
   * Inspect every pending send tx, ask the mint whether the contained proofs
   * have been spent (= recipient redeemed) and:
   *   - all SPENT          → flip to "paid"
   *   - all UNSPENT + age ≥ reclaimAfterMs → wallet.receive() it ourselves,
   *                          flip to "reclaimed"
   *   - mixed / younger    → leave pending; check again next pass
   */
  const reconcileSendTxs = useCallback(async (reclaimAfterMs = SEND_RECLAIM_AFTER_MS): Promise<void> => {
    const pendingSends = txs.filter((t) => t.type === "send" && t.status === "pending" && t.token);
    if (pendingSends.length === 0) return;

    for (const t of pendingSends) {
      try {
        let decoded: Token;
        try {
          decoded = getDecodedToken(t.token!, []);
        } catch (e) {
          console.warn("[reconcile-send] token decode failed for tx", t.id, (e as Error).message);
          continue;
        }
        const wallet = await getWallet(t.mintUrl);
        const sendProofs = decoded.proofs;
        const states = await wallet.checkProofsStates(sendProofs.map((p) => ({ secret: p.secret })));
        const allSpent = states.length > 0 && states.every((s) => s.state === CheckStateEnum.SPENT);
        const allUnspent = states.length > 0 && states.every((s) => s.state === CheckStateEnum.UNSPENT);

        if (allSpent) {
          updateTxStatus(t.id, "paid");
          continue;
        }

        const ageMs = Date.now() - new Date(t.createdAt || Date.now()).getTime();
        if (allUnspent && ageMs >= reclaimAfterMs) {
          // Pull it back. wallet.receive() swaps the proofs at the mint
          // (marking them SPENT) and gives us fresh proofs of equal value.
          const newProofs = await wallet.receive(t.token!);
          storeProofs(t.mintUrl, newProofs);
          updateTxStatus(t.id, "reclaimed");
          console.info(`[reclaim] tx ${t.id} (${Math.abs(t.amount)} sats) reclaimed after ${(ageMs / 3600000).toFixed(1)} h`);
        }
      } catch (e) {
        console.warn("[reconcile-send]", t.id, (e as Error).message);
      }
    }
  }, [txs, storeProofs, updateTxStatus]);

  /** Manually reclaim a still-pending send tx, ignoring the age threshold.
   *  Surfaces from the tx-detail screen as "Vzít zpět". */
  const reclaimSend = useCallback(async (txId: string): Promise<void> => {
    const t = txs.find((x) => x.id === txId);
    if (!t || t.type !== "send" || !t.token) throw new Error("Tato platba nejde vzít zpět.");
    if (t.status !== "pending") throw new Error("Tato platba už není v čekajícím stavu.");
    const wallet = await getWallet(t.mintUrl);
    // Verify nothing was already redeemed; if any proof is SPENT, refuse —
    // partial-receive would either fail or burn the rest at the mint.
    const decoded = getDecodedToken(t.token, []);
    const states = await wallet.checkProofsStates(decoded.proofs.map((p) => ({ secret: p.secret })));
    if (states.some((s) => s.state === CheckStateEnum.SPENT)) {
      updateTxStatus(txId, "paid");
      throw new Error("Token už byl vyzvednut příjemcem.");
    }
    const newProofs = await wallet.receive(t.token);
    storeProofs(t.mintUrl, newProofs);
    updateTxStatus(txId, "reclaimed");
  }, [txs, storeProofs, updateTxStatus]);

  /** Redeem an incoming Cashu token string. */
  const receiveToken = useCallback(
    async (tokenString: string): Promise<{ amount: number; mintUrl: string }> => {
      // Decode first to find the mint URL (we may need to add it).
      let decoded: Token;
      try {
        // In 4.x, getDecodedToken accepts the keyset IDs — pass an empty array
        // to bypass strict keyset-check; the mint will validate on receive.
        decoded = getDecodedToken(tokenString, []);
      } catch (e) {
        throw new Error("Neplatný token: " + (e as Error).message);
      }
      const mintUrl = decoded.mint;
      if (!mints.some((m) => m.url === mintUrl)) {
        await addMint(mintUrl);
      }
      const wallet = await getWallet(mintUrl);
      const newProofs = await wallet.receive(tokenString);
      storeProofs(mintUrl, newProofs);
      const amount = newProofs.reduce((a, p) => a + amountToNumber(p.amount), 0);
      addTx({ type: "receive", amount, mintUrl, status: "paid", token: tokenString });
      return { amount, mintUrl };
    },
    [mints, addMint, storeProofs, addTx],
  );

  /** Create a token to send off-band (QR / copy). */
  const createSendToken = useCallback(
    async (mintUrl: string, amount: number, memo?: string): Promise<{ token: string; amount: number }> => {
      const wallet = await getWallet(mintUrl);
      const activeStored = proofs.filter((p) => p.mintUrl === mintUrl && p.state === "active");
      const totalAvailable = activeStored.reduce((a, p) => a + p.amount, 0);
      if (totalAvailable < amount) throw new Error(`Málo prostředků: dostupných ${totalAvailable}, potřeba ${amount}`);

      const mintProofs = activeStored.map((p) => p.proof);
      const { keep, send } = await wallet.send(amount, mintProofs);
      // cashu-ts may return originals untouched in `keep` — when an offline
      // exact-match works (no swap) or when the library only swapped a subset.
      // Mark spent ONLY originals whose secret isn't in keep; otherwise we
      // mark untouched proofs spent and storeProofs' secret-dedup drops them
      // from re-insertion → balance vanishes (the bug we're fixing).
      const keepSecrets = new Set((keep ?? []).map((p) => p.secret));
      const spentIds = activeStored.filter((p) => !keepSecrets.has(p.secret)).map((p) => p.id);
      markProofsSpent(spentIds);
      if (keep && keep.length > 0) storeProofs(mintUrl, keep as Proof[]);

      const token = getEncodedToken({ mint: mintUrl, proofs: send as Proof[], ...(memo ? { memo } : {}) });
      // Status starts as "pending" — flips to "paid" once the recipient
      // swaps at the mint, or to "reclaimed" if we pull it back ourselves
      // (auto after 2 h or manually from the tx detail view).
      addTx({
        type: "send",
        amount,
        mintUrl,
        status: "pending",
        token,
        ...(memo ? { memo } : {}),
      });
      return { token, amount };
    },
    [proofs, markProofsSpent, storeProofs, addTx],
  );

  /** Melt ecash to a Lightning invoice (withdraw). */
  const meltToInvoice = useCallback(
    async (mintUrl: string, invoice: string): Promise<{ amount: number; fee: number }> => {
      const wallet = await getWallet(mintUrl);
      const quote: MeltQuoteBolt11Response = await wallet.createMeltQuoteBolt11(invoice);
      const quoteAmount = amountToNumber(quote.amount);
      const feeReserve = amountToNumber(quote.fee_reserve);
      const need = quoteAmount + feeReserve;

      const activeStored = proofs.filter((p) => p.mintUrl === mintUrl && p.state === "active");
      const totalAvailable = activeStored.reduce((a, p) => a + p.amount, 0);
      if (totalAvailable < need) throw new Error(`Málo prostředků: dostupných ${totalAvailable}, potřeba ${need} (vč. fee ${feeReserve})`);

      const mintProofs = activeStored.map((p) => p.proof);
      // includeFees: true → cashu-ts adds the per-proof keyset fee on top of
      // `need` when picking inputs. Without it, the wallet selects proofs
      // whose nominal sum equals `need` but their post-swap value is
      // `need - swap_fee`, and the mint refuses the melt with
      // "not enough inputs provided for melt. Provided: X, needed: Y".
      const { keep, send } = await wallet.send(need, mintProofs, { includeFees: true });
      // See createSendToken comment: only mark originals spent whose secret
      // wasn't returned in `keep` (untouched ones must stay active).
      const keepSecrets = new Set((keep ?? []).map((p) => p.secret));
      const spentIds = activeStored.filter((p) => !keepSecrets.has(p.secret)).map((p) => p.id);
      markProofsSpent(spentIds);
      if (keep && keep.length > 0) storeProofs(mintUrl, keep as Proof[]);

      const txId = addTx({
        type: "melt",
        amount: quoteAmount,
        mintUrl,
        status: "pending",
        invoice,
        quoteId: quote.quote,
      });
      try {
        const result = await wallet.meltProofsBolt11(quote, send as Proof[]);
        // Any change returned from overpaid fee-reserve gets stored as proofs.
        if (result.change && result.change.length > 0) storeProofs(mintUrl, result.change as Proof[]);
        if (txId) updateTxStatus(txId, "paid");
        return { amount: quoteAmount, fee: feeReserve };
      } catch (e) {
        // Don't flip to "failed" immediately — the mint may still be routing.
        // reconcilePendingTxs will recheck the quote state on next app open
        // and finalise. Rethrow so the caller shows an error UI.
        throw e;
      }
    },
    [proofs, markProofsSpent, storeProofs, addTx, updateTxStatus],
  );

  return {
    mints,
    proofs,
    txs,
    balances,
    activeMintUrl: activeMintUrl ?? mints[0]?.url ?? null,
    setActiveMintUrl,
    addMint,
    removeMint,
    requestMint,
    claimMintIfPaid,
    claimLnurlPayment,
    receiveToken,
    createSendToken,
    meltToInvoice,
    reconcilePendingTxs,
    recoverProofs,
    verifyActiveProofs,
    reconcileSendTxs,
    reclaimSend,
  };
}
