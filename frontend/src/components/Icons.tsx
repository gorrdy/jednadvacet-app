import type { FC, SVGProps } from "react";

// Inline Lucide-style line icons. Stroke is inherited via currentColor.
// Kept small on purpose; only the icons we actually use.

const base: SVGProps<SVGSVGElement> = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const IconWallet: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M21 7H5a2 2 0 0 1 0-4h14v4z" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16V7H5a2 2 0 0 1-2-2z" />
    <circle cx="17" cy="14" r="1.2" fill="currentColor" />
  </svg>
);

export const IconSend: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M12 21V7" />
    <polyline points="6 13 12 7 18 13" />
    <line x1="4" y1="3" x2="20" y2="3" />
  </svg>
);

export const IconReceive: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3v14" />
    <polyline points="6 11 12 17 18 11" />
    <line x1="4" y1="21" x2="20" y2="21" />
  </svg>
);

export const IconBolt: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export const IconNut: FC<SVGProps<SVGSVGElement>> = (p) => (
  // Stylized Cashu-ish nut: a seed shape with a center line.
  <svg {...base} {...p}>
    <path d="M12 3c4 0 7 3 7 7 0 5-3 11-7 11S5 15 5 10c0-4 3-7 7-7z" />
    <path d="M12 3v18" opacity="0.55" />
    <path d="M8 9c1 1 3 1.5 4 1.5S15 10 16 9" opacity="0.55" />
  </svg>
);

export const IconHome: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M3 10.5 12 3l9 7.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </svg>
);

export const IconNews: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="7" y1="8" x2="17" y2="8" />
    <line x1="7" y1="12" x2="13" y2="12" />
    <line x1="7" y1="16" x2="15" y2="16" />
  </svg>
);

export const IconCalendar: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
  </svg>
);

export const IconKey: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2 21 2" />
    <path d="M16 7l3 3" />
    <path d="M19 4l2 2" />
  </svg>
);

export const IconCog: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const IconBookmark: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

export const IconBookmarkFilled: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p} fill="currentColor">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

export const IconClock: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </svg>
);

export const IconPin: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
);

export const IconCity: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M4 21V9l4-3 4 3v12" />
    <path d="M12 21V13h6v8" />
    <line x1="2" y1="21" x2="22" y2="21" />
  </svg>
);

export const IconBell: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M18 16V11a6 6 0 1 0-12 0v5L4 18h16z" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </svg>
);

export const IconCheck: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}><polyline points="20 6 9 17 4 12" /></svg>
);

export const IconX: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);

export const IconQuestion: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.67-2.5 2.5-2.5 4" />
    <circle cx="12" cy="17" r="0.5" fill="currentColor" />
  </svg>
);

export const IconDownload: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const IconRefresh: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export const IconCopy: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconExternal: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

export const IconQr: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <line x1="14" y1="14" x2="21" y2="14" />
    <line x1="14" y1="14" x2="14" y2="21" />
    <line x1="17" y1="17" x2="21" y2="17" />
    <line x1="17" y1="17" x2="17" y2="21" />
  </svg>
);

export const IconUsers: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const IconMessage: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const IconLogout: FC<SVGProps<SVGSVGElement>> = (p) => (
  <svg {...base} {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
