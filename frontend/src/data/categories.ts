export interface Category {
  slug: string;
  name: string;
  icon: string;
}

export const CATEGORIES: readonly Category[] = [
  { slug: "novinky", name: "Novinky", icon: "📰" },
  { slug: "edukace", name: "Edukace", icon: "🎓" },
  { slug: "meetup", name: "Meetupy", icon: "🤝" },
  { slug: "konference", name: "Konference", icon: "🎤" },
  { slug: "technika", name: "Technika & nody", icon: "🔧" },
  { slug: "self-custody", name: "Self-custody", icon: "🔐" },
  { slug: "privacy", name: "Soukromí", icon: "🕵️" },
  { slug: "lightning", name: "Lightning", icon: "⚡" },
  { slug: "makro", name: "Makro & ekonomie", icon: "📈" },
];

export const categoryBySlug = (slug: string): Category | undefined =>
  CATEGORIES.find((c) => c.slug === slug);
