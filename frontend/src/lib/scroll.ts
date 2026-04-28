// Body is locked across the whole app (position: fixed) so window.scrollTo
// is a no-op. The actual scroll container is `.content`. Call this anywhere
// you would have called `window.scrollTo({ top: 0 })` previously.
export function scrollContentTop(behavior: ScrollBehavior = "auto"): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector(".content");
  if (el instanceof HTMLElement) el.scrollTo({ top: 0, left: 0, behavior });
}
