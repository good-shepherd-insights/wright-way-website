import { cmsOrigin, type PageSection } from "./payload";

// Reviews from payload-plugin-reviews. A reviews section either picks them or
// shows them automatically; one that does neither keeps its typed ones.

type Photo = { url: string; alt: string; width: number | null; height: number | null };
type PoolReview = {
  id: string | number;
  mergedIds?: (string | number)[];
  author: string;
  text: string | null;
  rating: number | null;
  date: string | null;
  platform: string | null;
  location: string | null;
  service: string | null;
  ownerReply: string | null;
  photos: Photo[];
};

// As many as the section's row holds.
const AUTOMATIC_COUNT = 3;

async function fetchPool(locale: string): Promise<PoolReview[]> {
  const pool: PoolReview[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ limit: "100", page: String(page), locale });
    const res = await fetch(`${cmsOrigin}/api/payload-plugin-reviews/reviews?${params}`);
    if (res.status === 404) return pool; // CMS without the reviews plugin
    if (!res.ok) throw new Error(`Failed to fetch reviews from Payload: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { docs: PoolReview[]; hasNextPage: boolean };
    pool.push(...data.docs);
    if (!data.hasNextPage) return pool;
  }
}

// Kept briefly: a build reads it for many pages, while on-request pages and
// the dev server live across CMS edits.
const TTL = 60 * 1000;
const cached = new Map<string, { at: number; pool: Promise<PoolReview[]> }>();
function getPool(locale: string): Promise<PoolReview[]> {
  const known = cached.get(locale);
  if (known && Date.now() - known.at < TTL) return known.pool;
  const pool = fetchPool(locale);
  pool.catch(() => cached.delete(locale));
  cached.set(locale, { at: Date.now(), pool });
  return pool;
}

const normal = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function pick(picks: unknown, pool: PoolReview[]): PoolReview[] {
  const byId = new Map(pool.flatMap((review) => [review.id, ...(review.mergedIds ?? [])].map((id) => [String(id), review] as const)));
  const ids = (Array.isArray(picks) ? picks : []).map((ref) => String(ref && typeof ref === "object" ? (ref as { id: unknown }).id : ref));
  return [...new Set(ids.map((id) => byId.get(id)).filter((review) => review !== undefined))];
}

/** Reviews about one of the page's subjects (its service, its place) first, then the rest. */
function automatic(subjects: string[], pool: PoolReview[]): PoolReview[] {
  const wanted = subjects.map(normal).filter(Boolean);
  const about = (review: PoolReview) =>
    [normal(review.service), normal(review.location)].some((value) => value !== "" && wanted.some((subject) => value.includes(subject) || subject.includes(value)));
  return [...pool.filter(about), ...pool.filter((review) => !about(review))].slice(0, AUTOMATIC_COUNT);
}

// "{platform} review · {date}": a part whose value is missing is left out.
function labelOf(pattern: unknown, review: PoolReview, locale: string): string {
  const date = review.date ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(review.date)) : "";
  const values: Record<string, string> = { platform: review.platform ?? "", date };
  const parts = (typeof pattern === "string" && pattern.trim() ? pattern : "{platform} · {date}").split(" · ");
  return parts
    .filter((part) => [...part.matchAll(/\{(platform|date)\}/g)].every(([, name]) => values[name]))
    .map((part) => part.replace(/\{(platform|date)\}/g, (_, name: string) => values[name]))
    .join(" · ");
}

const quoted = (text: string) => (/^["\u201c]/.test(text) ? text : `\u201c${text}\u201d`);

const toItem = (review: PoolReview, pattern: unknown, locale: string) => ({
  author: review.author,
  rating: review.rating,
  text: quoted(review.text ?? ""),
  dateLabel: labelOf(pattern, review, locale),
  location: review.location,
  service: review.service,
  photo: review.photos[0] ?? null,
  ownerReply: review.ownerReply,
});

/** Fills each reviews section from the collection. `subjects`: what the page is about. */
export async function withReviews(sections: PageSection[], locale: string, subjects: string[] = []): Promise<PageSection[]> {
  if (!sections.some((section) => section.blockType === "reviews" && section.show)) return sections;
  let pool: PoolReview[];
  try {
    pool = await getPool(locale);
  } catch (error) {
    // Typed reviews stand in; without them, fail the build rather than publish an empty section.
    const covered = sections.every((section) => section.blockType !== "reviews" || !section.show || (Array.isArray(section.reviews) && section.reviews.length > 0));
    if (!covered) throw error;
    console.error(error);
    return sections;
  }
  return sections.map((section) => {
    if (section.blockType !== "reviews" || !section.show) return section;
    const found = (section.show === "pick" ? pick(section.picks, pool) : automatic(subjects, pool)).filter((review) => review.text);
    return found.length ? { ...section, reviews: found.map((review) => toItem(review, section.sourceLabel, locale)) } : section;
  });
}
