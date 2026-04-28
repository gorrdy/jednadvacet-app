// Shrink a user-picked image down to a square avatar, encode as JPEG data
// URL under our ~200 KB backend limit. Runs client-side via canvas; no
// external dependency.
//
// - Center-crops to square aspect (largest centered square).
// - Max side 256 px (crisp at 2× on phones, plenty for chat avatars).
// - JPEG quality 0.85; bigger quality only matters for static photography.

const MAX_SIDE = 256;
const QUALITY = 0.85;

export async function resizeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Vyber obrázek.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Obrázek je moc velký (max 20 MB).");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const minSide = Math.min(bitmap.width, bitmap.height);
    const sx = Math.floor((bitmap.width - minSide) / 2);
    const sy = Math.floor((bitmap.height - minSide) / 2);

    const out = Math.min(MAX_SIDE, minSide);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context není dostupný.");

    ctx.drawImage(bitmap, sx, sy, minSide, minSide, 0, 0, out, out);
    return canvas.toDataURL("image/jpeg", QUALITY);
  } finally {
    bitmap.close?.();
  }
}

/** Initials fallback when no avatar — "Honza Novák" → "HN", "h" → "H". */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
