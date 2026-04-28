import { use, useCallback, useEffect, useState } from "react";
import { evolu } from "../evolu";
import { fetchChatProfile, saveChatProfile, type ChatProfile } from "../api";
import { redeemPendingReferral } from "../lib/tierSystem";

/**
 * Cross-device chat profile bound to Evolu AppOwner id. Same mnemonic
 * (BIP-39) on different devices → same owner_id → same profile everywhere.
 *
 * Profile (nickname, avatar, bio) lives on our backend keyed by owner_id.
 * Evolu relay never sees this data (that was the wrong place — it's a
 * social profile, not personal state).
 */
export function useChatProfile() {
  const owner = use(evolu.appOwner);
  const ownerId = owner.id as string;

  const [profile, setProfile] = useState<ChatProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchChatProfile(ownerId).then((p) => {
      if (!mounted) return;
      setProfile(p);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [ownerId]);

  const save = useCallback(
    async (
      payload: { displayName: string; avatar?: string | null; bio?: string | null },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const r = await saveChatProfile(ownerId, payload);
      if (!r.ok) return { ok: false, error: r.error };
      setProfile(r.profile);
      // Po vytvoření / update profilu zkonzumuj případný pending referral.
      // Idempotentní — druhý save už nic neudělá. Záměrně bez await aby se
      // UI hnulo i když backend váhá nebo selže.
      void redeemPendingReferral(ownerId);
      return { ok: true };
    },
    [ownerId],
  );

  return { ownerId, profile, loading, save };
}
