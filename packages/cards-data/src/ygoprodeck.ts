/**
 * Minimal typing for YGOPRODeck's /api/v7/cardinfo.php response.
 * The real response has many more fields; we narrow to what the
 * engine consumes. Extend as needed.
 */
export interface RawYgoCard {
  id: number;
  name: string;
  type: string;            // e.g. "Effect Monster", "Spell Card"
  frameType: string;       // e.g. "synchro", "xyz", "pendulum"
  desc: string;
  atk?: number;
  def?: number;
  level?: number;
  race: string;
  attribute?: string;
  archetype?: string;
  scale?: number;
  linkval?: number;
  linkmarkers?: string[];
  card_images?: { id: number; image_url: string }[];
}

export interface RawYgoResponse {
  data: RawYgoCard[];
}

export const YGOPRODECK_ENDPOINT =
  "https://db.ygoprodeck.com/api/v7/cardinfo.php";

/**
 * Fetch the entire catalog. Use sparingly (rate-limited, ~13k cards).
 * Callers should cache the result — see `refresh.ts`.
 */
export async function fetchAllCards(): Promise<RawYgoCard[]> {
  const res = await fetch(YGOPRODECK_ENDPOINT);
  if (!res.ok) {
    throw new Error(`YGOPRODeck returned ${res.status}`);
  }
  const body = (await res.json()) as RawYgoResponse;
  return body.data;
}
