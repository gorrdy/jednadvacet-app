import { type FC } from "react";
import { cityName } from "../data/cities";
import { useUserPrefs } from "../hooks/usePrefs";

export interface ChannelItem {
  slug: string;
  label: string;
  sub: string | null;
}

/** Build the channel list for the current user. Global CZ is always first,
 * then one per city from their Profile. Memoization isn't worth it — this
 * runs only when the Messages tab re-renders. */
export function useChannelList(): ChannelItem[] {
  const { prefs } = useUserPrefs();
  const channels: ChannelItem[] = [
    { slug: "global", label: "Globální · CZ", sub: "Všechny jednadvacítky" },
  ];
  for (const slug of prefs.cities) {
    channels.push({ slug, label: cityName(slug), sub: null });
  }
  return channels;
}

export const ChannelList: FC<{
  items: ChannelItem[];
  activeSlug: string | null;
  onOpen: (slug: string) => void;
}> = ({ items, activeSlug, onOpen }) => {
  if (items.length === 0) return null;
  return (
    <div>
      {items.map((c) => (
        <button
          key={c.slug}
          className={`channel-row ${activeSlug === c.slug ? "active" : ""}`}
          onClick={() => onOpen(c.slug)}
        >
          <div className="left">
            <div className="name">{c.label}</div>
            {c.sub && <div className="sub">{c.sub}</div>}
          </div>
        </button>
      ))}
    </div>
  );
};
