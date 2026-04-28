// Single source for the `{src ? <img/> : <span class="initials">…</span>}`
// pattern that previously lived inline in 13+ call sites. The outer
// wrapper className stays caller-controlled because the visual treatment
// differs per surface (`chat-avatar`, `sidebar-avatar`, `community-icon`,
// `bazar-card-avatar`, …) — only the inner conditional is shared.

import { type CSSProperties, type FC } from "react";
import { initialsFor } from "../lib/imageResize";

interface Props {
  src: string | null | undefined;
  /** Used to derive initials when there's no avatar image. Pass "?" if you
   *  genuinely don't have a name (e.g. an anonymous attendee). */
  name: string;
  /** Class name on the outer <span> — caller picks the visual context. */
  className?: string;
  /** Optional inline style for the outer span (size overrides etc.). */
  style?: CSSProperties;
}

export const Avatar: FC<Props> = ({ src, name, className, style }) => (
  <span className={className} aria-hidden="true" style={style}>
    {src
      ? <img src={src} alt="" />
      : <span className="initials">{initialsFor(name)}</span>}
  </span>
);
