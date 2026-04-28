import type { Article } from "./data/articles";
import type { GlobalEvent } from "./data/events";
import { PLACEHOLDER_ARTICLES } from "./data/articles";
import { SEED_EVENTS } from "./data/events";
import { apiDelete, apiGet, apiGetOrNull, apiPost, isApiError } from "./lib/http";

// ── Public content ──────────────────────────────────────────────────

export async function fetchArticles(): Promise<readonly Article[]> {
  const data = await apiGetOrNull<Article[]>("/api/articles");
  return data && data.length > 0 ? data : PLACEHOLDER_ARTICLES;
}

export interface EventAttendee {
  ownerId: string;
  displayName: string;
  avatar: string | null;
  tier: number;
}

export interface EventAttendees {
  named: EventAttendee[];
  anonCount: number;
  maybeCount: number;
  total: number;
}

export async function fetchEventAttendees(eventId: string): Promise<EventAttendees | null> {
  return apiGetOrNull<EventAttendees>(`/api/events/${encodeURIComponent(eventId)}/attendees`);
}

export interface MyEventChat {
  eventId: string;
  slug: string;          // "event:<id>"
  title: string;
  startsAt: string;
  endsAt: string;
}

export async function fetchMyEventChats(ownerId: string): Promise<MyEventChat[]> {
  const r = await apiGetOrNull<{ chats: MyEventChat[] }>(
    `/api/chat/my-event-chats?ownerId=${encodeURIComponent(ownerId)}`,
  );
  return r?.chats ?? [];
}

export async function fetchOnlineCount(): Promise<number | null> {
  const r = await apiGetOrNull<{ users: number }>("/api/stats/online");
  return r?.users ?? null;
}

export interface TopOrganizer {
  displayName: string;
  avatar: string | null;
  tier: number;
  eventCount: number;
}

export interface CommunityStats {
  tierDistribution: Array<{ tier: number; count: number }>;
  totalUsers: number;
  topOrganizers: TopOrganizer[];
}

export async function fetchCommunityStats(): Promise<CommunityStats | null> {
  return apiGetOrNull<CommunityStats>("/api/stats/community");
}

// ── Admin application (tier 3+ users requesting community admin role) ──
export interface AdminApplicationStatus {
  id: string;
  citiesCsv: string;
  message: string | null;
  status: "pending" | "approved" | "rejected";
  appliedAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
}

export async function fetchAdminApplication(ownerId: string): Promise<AdminApplicationStatus | null> {
  const r = await apiGetOrNull<{ application: AdminApplicationStatus | null }>(
    `/api/admin/apply/${encodeURIComponent(ownerId)}`,
  );
  return r?.application ?? null;
}

export async function postAdminApplication(
  ownerId: string, citiesCsv: string, message: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const r = await apiPost<{ ok: true; id: string }>(`/api/admin/apply`, {
    ownerId, citiesCsv, message,
  });
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true, id: r.id };
}

// ── Event proposals (tier 4+ users) ──────────────────────────────
export interface EventProposalDraft {
  ownerId: string;
  title: string;
  description?: string;
  location: string;
  url?: string;
  startsAt: string; // ISO
  endsAt: string;   // ISO
  citiesCsv?: string;
  categoriesCsv?: string;
}

export interface EventProposalSummary {
  id: string;
  title: string;
  location: string;
  startsAt: string;
  status: "pending" | "approved" | "rejected";
  proposedAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
}

export async function postEventProposal(
  draft: EventProposalDraft,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const r = await apiPost<{ ok: true; id: string }>(`/api/events/propose`, draft);
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true, id: r.id };
}

export async function fetchOwnEventProposals(ownerId: string): Promise<EventProposalSummary[]> {
  const r = await apiGetOrNull<{ proposals: EventProposalSummary[] }>(
    `/api/events/proposals/${encodeURIComponent(ownerId)}`,
  );
  return r?.proposals ?? [];
}

// Admin-side review (any admin, not just superadmin)
export interface EventProposalReview {
  id: string;
  ownerId: string;
  proposerName: string;
  avatar: string | null;
  currentTier: number;
  title: string;
  description: string;
  location: string;
  url: string | null;
  startsAt: string;
  endsAt: string;
  citiesCsv: string;
  categoriesCsv: string;
  status: "pending" | "approved" | "rejected";
  proposedAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
  approvedEventId: string | null;
}

export async function adminListEventProposals(
  token: string, status: "pending" | "approved" | "rejected" = "pending",
): Promise<EventProposalReview[]> {
  const r = await apiGet<{ proposals: EventProposalReview[] }>(
    `/api/admin/event-proposals?status=${status}`, { token },
  );
  return isApiError(r) ? [] : r.proposals;
}

// ── Marketplace (P2P classifieds) ──────────────────────────────
export type MarketplaceOfferType = "buy_sats" | "sell_sats" | "service" | "goods";

export interface MarketplaceOffer {
  id: string;
  ownerId: string;
  proposerName: string;
  type: MarketplaceOfferType;
  title: string;
  description: string;
  location: string | null;
  citiesCsv: string;
  paymentMethodsCsv: string;
  priceText: string | null;
  status: "active" | "closed" | "sold";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  avatar: string | null;
  tier: number;
}

export interface MarketplaceFilter {
  type?: MarketplaceOfferType;
  city?: string;
  q?: string;
  status?: "active" | "closed" | "sold";
}

export async function fetchMarketplaceOffers(filter: MarketplaceFilter = {}): Promise<MarketplaceOffer[]> {
  const params = new URLSearchParams();
  if (filter.type) params.set("type", filter.type);
  if (filter.city) params.set("city", filter.city);
  if (filter.q) params.set("q", filter.q);
  if (filter.status) params.set("status", filter.status);
  const qs = params.toString();
  const url = qs ? `/api/marketplace/offers?${qs}` : `/api/marketplace/offers`;
  const r = await apiGetOrNull<{ offers: MarketplaceOffer[] }>(url);
  return r?.offers ?? [];
}

export async function fetchMyMarketplaceOffers(ownerId: string): Promise<MarketplaceOffer[]> {
  const r = await apiGetOrNull<{ offers: MarketplaceOffer[] }>(
    `/api/marketplace/offers/mine/${encodeURIComponent(ownerId)}`,
  );
  return r?.offers ?? [];
}

export interface MarketplaceOfferDraft {
  ownerId: string;
  type: MarketplaceOfferType;
  title: string;
  description?: string;
  location?: string;
  citiesCsv?: string;
  paymentMethodsCsv?: string;
  priceText?: string;
  ttlDays?: number;
}

export async function postMarketplaceOffer(
  draft: MarketplaceOfferDraft,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const r = await apiPost<{ ok: true; id: string }>(`/api/marketplace/offers`, draft);
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true, id: r.id };
}

export async function updateMarketplaceOffer(
  id: string, ownerId: string, patch: Partial<{ status: "active" | "closed" | "sold"; title: string; description: string; priceText: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const r = await apiPost(`/api/marketplace/offers/${encodeURIComponent(id)}/update`, { ownerId, ...patch });
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true };
}

export async function deleteMarketplaceOffer(id: string, ownerId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await apiDelete(`/api/marketplace/offers/${encodeURIComponent(id)}`, { ownerId });
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true };
}

export async function reportMarketplaceOffer(
  id: string, ownerId: string, reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await apiPost(`/api/marketplace/offers/${encodeURIComponent(id)}/report`, { ownerId, reason });
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true };
}

// ── Lightning Address (LUD-16) ──────────────────────────────────
export interface LightningAddressSuggestion {
  current: string | null;
  suggestion: string;
  host: string;
}

export async function fetchLightningAddressSuggestion(ownerId: string): Promise<LightningAddressSuggestion | null> {
  return apiGetOrNull<LightningAddressSuggestion>(`/api/lnurlp/suggest/${encodeURIComponent(ownerId)}`);
}

export async function claimLightningUsername(
  ownerId: string, username: string,
): Promise<{ ok: true; username: string; host: string } | { ok: false; error: string }> {
  const r = await apiPost<{ ok: true; username: string; host: string }>(
    `/api/lnurlp/claim`, { ownerId, username },
  );
  if (isApiError(r)) return { ok: false, error: r.error };
  return r;
}

export async function releaseLightningUsername(ownerId: string): Promise<void> {
  await apiDelete(`/api/lnurlp/claim`, { ownerId });
}

export interface LnurlPendingPayment {
  quoteId: string;
  mintUrl: string;
  amountSats: number;
  invoice: string;
  comment: string | null;
  createdAt: string;
  paidAt: string | null;
}

export async function fetchLnurlPending(ownerId: string): Promise<LnurlPendingPayment[]> {
  const r = await apiGetOrNull<{ pending: LnurlPendingPayment[] }>(
    `/api/lnurlp/pending/${encodeURIComponent(ownerId)}`,
  );
  return r?.pending ?? [];
}

export async function markLnurlClaimed(quoteId: string, ownerId: string): Promise<void> {
  await apiPost(`/api/lnurlp/claimed/${encodeURIComponent(quoteId)}`, { ownerId });
}

export async function adminReviewEventProposal(
  token: string, id: string, decision: "approved" | "rejected", rejectReason?: string,
): Promise<{ ok: boolean; error?: string; approvedEventId?: string | null }> {
  const r = await apiPost<{ ok: true; approvedEventId: string | null }>(
    `/api/admin/event-proposals/${encodeURIComponent(id)}/review`,
    { decision, rejectReason: rejectReason ?? null },
    { token },
  );
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true, approvedEventId: r.approvedEventId };
}

export async function fetchEvents(): Promise<readonly GlobalEvent[]> {
  const data = await apiGetOrNull<GlobalEvent[]>("/api/events");
  return data && data.length > 0 ? data : SEED_EVENTS;
}

export interface Community {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  signal: string | null;
  website: string | null;
  icon: string | null;
  org: string | null;
  btcmapId: number;
  urlAlias: string | null;
}

export interface CommunityList {
  updatedAt: string | null;
  communities: Community[];
}

export async function fetchCommunities(): Promise<CommunityList | null> {
  const data = await apiGetOrNull<CommunityList>("/api/communities");
  return data && Array.isArray(data.communities) ? data : null;
}

// ── Push ────────────────────────────────────────────────────────────
// Anonymous: backend stores (endpoint, keys, tags) under an opaque token.
// No user id, no mnemonic, no correlation.

export interface PushRegistration {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  tags: string[];
  token?: string;
}

export async function registerPush(reg: PushRegistration): Promise<string | null> {
  const r = await apiPost<{ token?: string }>("/api/push/register", reg);
  return isApiError(r) ? null : r.token ?? null;
}

export async function unregisterPush(token: string): Promise<void> {
  await apiPost("/api/push/unregister", { token });
}

export async function sendTestPush(token: string): Promise<{ ok: boolean; error?: string; statusCode?: number }> {
  const r = await apiPost<{ ok: boolean; error?: string; statusCode?: number }>("/api/push/test", { token });
  if (isApiError(r)) return { ok: false, error: r.error };
  return r;
}

export async function getVapidPublicKey(): Promise<string | null> {
  const r = await apiGet<{ key: string }>("/api/push/vapid");
  return isApiError(r) ? null : r.key;
}

// ── Admin types ─────────────────────────────────────────────────────

export interface AdminEventPayload {
  id?: string;
  title: string;
  description: string;
  location: string;
  url?: string;
  startsAt: string;
  endsAt: string;
  cities: string[];
  categories: string[];
  organizer?: string;
}

export interface AdminUser {
  id: string;
  email: string | null;
  username: string | null;
  role: "superadmin" | "admin";
  city: string | null;
  displayName: string | null;
}

export interface AdminLoginResult {
  token: string;
  expiresAt: string;
  admin: AdminUser;
}

export interface RsvpCounts {
  going: number;
  maybe: number;
  not_going: number;
  total: number;
}

export interface AdminInvite {
  code: string;
  role: "admin" | "superadmin";
  city: string | null;
  displayName: string | null;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  usedAt: string | null;
  usedByEmail: string | null;
  usedByUsername: string | null;
}

export interface InvitePublicInfo {
  code: string;
  role: "admin" | "superadmin";
  city: string | null;
  displayName: string | null;
  note: string | null;
  expiresAt: string;
}

export interface AdminStats {
  subscribers: number;
  byTag: Record<string, number>;
  events: number;
  rsvps?: number;
  bySource?: Record<string, number>;
}

export interface DeviceUserPair {
  devices: number;
  users: number;
}

export interface DashboardPayload {
  devices: { pushSubscribers: number; rsvpTokens: number; adminAccounts: number; inviteActive: number };
  activity: {
    onlineNow: DeviceUserPair;
    activeToday: DeviceUserPair;
    active7d: DeviceUserPair;
    active30d: DeviceUserPair;
    dauSeries: Array<{ day: string; devices: number; users: number }>;
    standaloneRate: number;
    standaloneSample: number;
  };
  features: Array<{ kind: string; users: number; devices: number }>;
  content: {
    eventsTotal: number;
    eventsBySource: Record<string, number>;
    articlesTotal: number;
    rsvpTotal: number;
    topRsvp: Array<{ id: string; title: string; startsAt: string; going: number; maybe: number; notGoing: number; total: number }>;
  };
  tags: { byTag: Record<string, number> };
  sync: {
    ics: { url: string; intervalMs: number; lastSync: unknown };
    rss: { url: string; intervalMs: number; lastSync: unknown };
  };
}

export interface BroadcastPayload {
  title: string;
  body: string;
  url?: string;
  tags: string[];
}

export interface BroadcastResult {
  matched: number;
  sent: number;
  failed: number;
}

// ── Admin: auth ─────────────────────────────────────────────────────

export async function adminLogin(identifier: string, password: string): Promise<AdminLoginResult | { error: string }> {
  const r = await apiPost<AdminLoginResult>("/api/admin/login", { identifier, password });
  return r;
}

export async function adminLogout(token: string): Promise<void> {
  await apiPost("/api/admin/logout", {}, { token });
}

export async function adminMe(token: string): Promise<AdminUser | null> {
  const r = await apiGet<{ admin: AdminUser }>("/api/admin/me", { token });
  return isApiError(r) ? null : r.admin;
}

// ── Admin: events, broadcast, stats, rsvps ──────────────────────────

export async function adminCreateEvent(token: string, ev: AdminEventPayload): Promise<GlobalEvent | null> {
  const r = await apiPost<GlobalEvent>("/api/admin/events", ev, { token });
  return isApiError(r) ? null : r;
}

export async function adminDeleteEvent(token: string, id: string): Promise<boolean> {
  const r = await apiDelete(`/api/admin/events/${encodeURIComponent(id)}`, undefined, { token });
  return !isApiError(r);
}

export async function adminBroadcast(token: string, p: BroadcastPayload): Promise<BroadcastResult | null> {
  const r = await apiPost<BroadcastResult>("/api/admin/broadcast", p, { token });
  return isApiError(r) ? null : r;
}

export async function adminStats(token: string): Promise<AdminStats | null> {
  const r = await apiGet<AdminStats>("/api/admin/stats", { token });
  return isApiError(r) ? null : r;
}

export async function adminDashboard(token: string): Promise<DashboardPayload | null> {
  const r = await apiGet<DashboardPayload>("/api/admin/dashboard", { token });
  return isApiError(r) ? null : r;
}

// Admin application review (superadmin only)
export interface AdminApplicationReview {
  id: string;
  ownerId: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  citiesCsv: string;
  message: string | null;
  tierAtApply: number;
  currentTier: number;
  status: "pending" | "approved" | "rejected";
  appliedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectReason: string | null;
}

export async function adminListApplications(
  token: string, status: "pending" | "approved" | "rejected" = "pending",
): Promise<AdminApplicationReview[]> {
  const r = await apiGet<{ applications: AdminApplicationReview[] }>(
    `/api/admin/applications?status=${status}`, { token },
  );
  return isApiError(r) ? [] : r.applications;
}

export async function adminReviewApplication(
  token: string, id: string, decision: "approved" | "rejected", rejectReason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await apiPost(
    `/api/admin/applications/${encodeURIComponent(id)}/review`,
    { decision, rejectReason: rejectReason ?? null },
    { token },
  );
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true };
}

export interface ScheduledNotification {
  slug: string;
  cityName: string;
  tag: string;
  alreadySent: boolean;
  alreadySentAt: string | null;
  alreadySentCount: number;
  events: Array<{ id: string; title: string; startsAt: string; location: string }>;
  recipients: Array<{ tokenSuffix: string; endpointHost: string }>;
  recipientCount: number;
}

export interface ReminderUpcoming {
  preview: {
    day: string;
    nextFireAt: string | null;
    reminderHour: number | null;
    timezone: string;
    channels: ScheduledNotification[];
  };
  history: Array<{ day: string; city: string; events: number; sent: number; sent_at: string }>;
}

export async function adminRemindersUpcoming(token: string): Promise<ReminderUpcoming | null> {
  const r = await apiGet<ReminderUpcoming>("/api/admin/reminders/upcoming", { token });
  return isApiError(r) ? null : r;
}

export async function adminFireReminders(token: string): Promise<{ ok: boolean; sent?: number; error?: string }> {
  const r = await apiPost<{ ok: boolean; sent?: number; error?: string }>("/api/admin/reminders/fire", {}, { token });
  if (isApiError(r)) return { ok: false, error: r.error };
  return r;
}

export async function adminRsvps(token: string): Promise<Record<string, RsvpCounts>> {
  const r = await apiGet<Record<string, RsvpCounts>>("/api/admin/rsvps", { token });
  return isApiError(r) ? {} : r;
}

// ── Superadmin: users ───────────────────────────────────────────────

export async function adminListUsers(token: string): Promise<AdminUser[]> {
  const r = await apiGet<AdminUser[]>("/api/admin/users", { token });
  return isApiError(r) ? [] : r;
}

export async function adminCreateUser(
  token: string,
  payload: {
    email?: string;
    username?: string;
    password: string;
    role: "admin" | "superadmin";
    city?: string;
    displayName?: string;
  },
): Promise<{ ok: boolean; error?: string; user?: AdminUser }> {
  const r = await apiPost<AdminUser>("/api/admin/users", payload, { token });
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true, user: r };
}

export async function adminDeleteUser(token: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await apiDelete(`/api/admin/users/${encodeURIComponent(id)}`, undefined, { token });
  return isApiError(r) ? { ok: false, error: r.error } : { ok: true };
}

export async function adminResetUserPassword(
  token: string,
  id: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await apiPost(`/api/admin/users/${encodeURIComponent(id)}/password`, { password }, { token });
  return isApiError(r) ? { ok: false, error: r.error } : { ok: true };
}

// ── Superadmin: invites ─────────────────────────────────────────────

export async function adminListInvites(token: string): Promise<AdminInvite[]> {
  const r = await apiGet<AdminInvite[]>("/api/admin/invites", { token });
  return isApiError(r) ? [] : r;
}

export async function adminCreateInvite(
  token: string,
  payload: { role: "admin" | "superadmin"; city?: string; displayName?: string; note?: string },
): Promise<{ ok: boolean; error?: string; invite?: AdminInvite }> {
  const r = await apiPost<AdminInvite>("/api/admin/invites", payload, { token });
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true, invite: r };
}

export async function adminRevokeInvite(token: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const r = await apiDelete(`/api/admin/invites/${encodeURIComponent(code)}`, undefined, { token });
  return isApiError(r) ? { ok: false, error: r.error } : { ok: true };
}

// ── Invite: public ──────────────────────────────────────────────────

export async function fetchInviteInfo(code: string): Promise<InvitePublicInfo | { error: string }> {
  return apiGet<InvitePublicInfo>(`/api/admin/invites/${encodeURIComponent(code)}/info`);
}

export async function redeemInvite(
  code: string,
  payload:
    | { mode: "create"; username: string; password: string; displayName?: string }
    | { mode: "pair"; identifier: string; password: string },
): Promise<AdminLoginResult | { error: string }> {
  return apiPost<AdminLoginResult>(`/api/admin/invites/${encodeURIComponent(code)}/redeem`, payload);
}

// ── Community channels (Global + per-city) ──────────────────────────

export interface MessageReaction {
  emoji: string;
  count: number;
  /** True if the requesting ownerId already added this reaction. */
  mine: boolean;
}

export interface ChannelMessage {
  id: string;
  channelSlug: string;
  authorToken: string;
  authorOwnerId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  /** ISO timestamp of the last edit, or null for unedited messages. */
  editedAt: string | null;
  reactions: MessageReaction[];
}

/** SSE payload for an in-place body edit. Reactions are per-viewer
 *  (the `mine` flag) so the server doesn't ship them; clients patch
 *  their own message and keep the local reaction state intact. */
export interface ChannelEdit {
  id: string;
  body: string;
  editedAt: string;
}

/** Allowlist sourced from shared/constants.js — single source of truth
 *  shared with the backend's REACTIONS validator. */
export { REACTIONS as REACTION_EMOJIS } from "../../shared/constants.js";

export async function toggleMessageReaction(
  messageId: string, ownerId: string, emoji: string, op: "add" | "remove",
): Promise<{ ok: boolean; error?: string }> {
  const r = await apiPost(
    `/api/messages/${encodeURIComponent(messageId)}/reactions`,
    { ownerId, emoji, op },
  );
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true };
}

export interface ChatProfile {
  ownerId: string;
  displayName: string;
  avatar: string | null;   // base64 data URL or null
  bio: string | null;
  updatedAt: string;
  /** Aktuální tier uživatele (1–5). Backend joinuje z user_tier;
   *  legacy uživatelé bez user_tier řádku dostanou 1. */
  tier: number;
}

export async function listChannelMessages(
  slug: string,
  since?: string,
  limit = 50,
  ownerId?: string,
): Promise<ChannelMessage[]> {
  const qs = new URLSearchParams();
  if (since) qs.set("since", since);
  qs.set("limit", String(limit));
  if (ownerId) qs.set("ownerId", ownerId);
  const r = await apiGet<ChannelMessage[]>(`/api/channels/${encodeURIComponent(slug)}/messages?${qs}`);
  return isApiError(r) ? [] : r;
}

export async function postChannelMessage(
  slug: string,
  payload: { token: string; ownerId: string; body: string },
): Promise<{ ok: true; message: ChannelMessage } | { ok: false; error: string }> {
  const r = await apiPost<ChannelMessage>(`/api/channels/${encodeURIComponent(slug)}/messages`, payload);
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true, message: r };
}

export async function deleteChannelMessage(
  slug: string,
  id: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await apiDelete(`/api/channels/${encodeURIComponent(slug)}/messages/${encodeURIComponent(id)}`, { token });
  return isApiError(r) ? { ok: false, error: r.error } : { ok: true };
}

export async function editChannelMessage(
  slug: string,
  id: string,
  payload: { token: string; body: string },
): Promise<{ ok: true; body: string; editedAt: string } | { ok: false; error: string }> {
  const r = await apiPost<{ ok: true; id: string; body: string; editedAt: string }>(
    `/api/channels/${encodeURIComponent(slug)}/messages/${encodeURIComponent(id)}/edit`,
    payload,
  );
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true, body: r.body, editedAt: r.editedAt };
}

export async function fetchChatProfile(ownerId: string): Promise<ChatProfile | null> {
  const r = await apiGet<ChatProfile>(`/api/chat/profile/${encodeURIComponent(ownerId)}`);
  return isApiError(r) ? null : r;
}

export async function saveChatProfile(
  ownerId: string,
  payload: { displayName: string; avatar?: string | null; bio?: string | null },
): Promise<{ ok: true; profile: ChatProfile } | { ok: false; error: string }> {
  const r = await apiPost<ChatProfile>(`/api/chat/profile`, { ownerId, ...payload });
  if (isApiError(r)) return { ok: false, error: r.error };
  return { ok: true, profile: r };
}

// ── Direct messages (1:1) ───────────────────────────────────────────

/** Deterministic DM channel slug. Both participants derive the same string,
 *  so either side can subscribe/post using the same identifier. */
export function dmSlugFor(a: string, b: string): string {
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

export interface DmContact {
  partnerOwnerId: string;
  partnerName: string | null;
  partnerAvatar: string | null;
  dmSlug: string;
  lastMessage: { body: string; createdAt: string; authorOwnerId: string | null } | null;
  acceptedAt: string;
}

export interface DmIncomingRequest {
  id: string;
  fromOwnerId: string;
  fromName: string | null;
  fromAvatar: string | null;
  createdAt: string;
}

export interface DmOutgoingRequest {
  id: string;
  toOwnerId: string;
  toName: string | null;
  toAvatar: string | null;
  status: "pending" | "rejected";
  createdAt: string;
}

export interface DmState {
  incoming: DmIncomingRequest[];
  outgoing: DmOutgoingRequest[];
  contacts: DmContact[];
}

export async function fetchDmState(ownerId: string): Promise<DmState | null> {
  const r = await apiGet<DmState>(`/api/dm/state?ownerId=${encodeURIComponent(ownerId)}`);
  return isApiError(r) ? null : r;
}

export async function requestDm(
  fromOwnerId: string,
  toOwnerId: string,
): Promise<{ ok: true; id: string; status: string; reciprocal?: boolean } | { ok: false; error: string }> {
  const r = await apiPost<{ ok: true; id: string; status: string; reciprocal?: boolean }>(
    `/api/dm/request`,
    { fromOwnerId, toOwnerId },
  );
  if (isApiError(r)) return { ok: false, error: r.error };
  return r;
}

export async function acceptDmRequest(id: string, ownerId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await apiPost<{ ok: true }>(`/api/dm/requests/${encodeURIComponent(id)}/accept`, { ownerId });
  return isApiError(r) ? { ok: false, error: r.error } : { ok: true };
}

export async function rejectDmRequest(
  id: string,
  ownerId: string,
  block = false,
): Promise<{ ok: boolean; error?: string }> {
  const r = await apiPost<{ ok: true; status: string }>(
    `/api/dm/requests/${encodeURIComponent(id)}/reject`,
    { ownerId, block },
  );
  return isApiError(r) ? { ok: false, error: r.error } : { ok: true };
}

/** Batch fetch: returns map keyed by ownerId. Missing ids are omitted. */
export async function fetchChatProfiles(ownerIds: string[]): Promise<Record<string, ChatProfile>> {
  if (ownerIds.length === 0) return {};
  const qs = new URLSearchParams({ ids: ownerIds.join(",") });
  const r = await apiGet<Record<string, ChatProfile>>(`/api/chat/profiles?${qs}`);
  return isApiError(r) ? {} : r;
}
