// Mirrors SiteGlobals / Pages from the Payload backend's generated
// payload-types.ts, narrowed to what the page consumes. getSiteGlobals
// fetches with depth=2 so curated component relationships resolve to their
// full documents (with nested media at full depth).

export interface Media {
  url: string;
  alt: string;
  width: number;
  height: number;
}

// A curated entry resolves (depth=2) to the full Components document;
// `sections` is the renderable content inside it.
export type CuratedComponent = {
  component: { id: string | number; sections?: PageSection[] | null } | number | null;
};

function curatedSections(entry: CuratedComponent): PageSection[] {
  const resolved = entry.component;
  if (!resolved || typeof resolved !== "object") return [];
  return resolved.sections ?? [];
}

export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

// The site global's `business` group (CMS Site Globals → Business): facts
// published as the business's structured data. Every field is optional.
export interface Business {
  schemaType?: "LocalBusiness" | "HomeAndConstructionBusiness" | "ProfessionalService" | "Organization" | null;
  description?: string | null;
  telephone?: string | null;
  email?: string | null;
  address?: {
    streetAddress?: string | null;
    addressLocality?: string | null;
    addressRegion?: string | null;
    postalCode?: string | null;
    addressCountry?: string | null;
  };
  hours?: { days: Weekday[]; opens: string; closes: string; id?: string | null }[] | null;
  sameAs?: { url: string; id?: string | null }[] | null;
  priceRange?: string | null;
  image?: Media | string | null;
}

export interface SiteGlobals {
  brand: { logo?: Media; logoAlt?: string; favicon?: Media; ogImage?: Media };
  business?: Business;
  components: CuratedComponent[];
}

export type PageSection = {
  blockType: string;
  [key: string]: unknown;
};

export type Page = {
  id: string | number;
  slug: string;
  title: string;
  // description: meta description; empty or absent, none is published.
  metadata: { titleTemplate: string; description?: string | null };
  sections: PageSection[];
  // Global components (SiteGlobals.components, by their Sections document
  // id) to hide on this page only — everything else there still renders.
  hiddenGlobalComponents?: (string | number)[];
};

function requiredEnv(name: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[name] ?? process.env[name];
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) throw new Error(`Missing required environment variable: ${name}`);
  return trimmed;
}

function requiredOrigin(name: string): string {
  const value = requiredEnv(name);
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an origin without a path, query, or hash`);
  }
  return url.origin;
}

export const cmsOrigin = requiredOrigin("CMS_ORIGIN");
export const globalSlug = requiredEnv("SITE_GLOBAL_SLUG");
export const PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;


function absolutizeSiteChromeUrls(page: SiteGlobals): SiteGlobals {
  // Payload returns media `url` as a path relative to its own origin. Both
  // fields are required in the CMS schema but may still be briefly unset
  // (e.g. a freshly-created SiteGlobals doc before an editor has published
  // brand assets) - degrade gracefully instead of crashing every page.
  if (page.brand?.logo?.url) {
    page.brand.logo.url = new URL(page.brand.logo.url, cmsOrigin).toString();
  }
  if (page.brand?.favicon?.url) {
    page.brand.favicon.url = new URL(page.brand.favicon.url, cmsOrigin).toString();
  }
  if (page.brand?.ogImage?.url) {
    page.brand.ogImage.url = new URL(page.brand.ogImage.url, cmsOrigin).toString();
  }
  const businessImage = page.business?.image;
  if (businessImage && typeof businessImage === "object" && businessImage.url) {
    businessImage.url = new URL(businessImage.url, cmsOrigin).toString();
  }
  for (const entry of page.components ?? []) {
    for (const section of curatedSections(entry)) {
      absolutizeMediaUrls(section);
    }
  }
  return page;
}

export async function getSiteGlobals(locale: string): Promise<SiteGlobals> {
  const res = await fetch(
    `${cmsOrigin}/api/globals/${globalSlug}?depth=2&locale=${locale}`,
  );

  if (!res.ok) {
    throw new Error(
      `Failed to fetch "${globalSlug}" (locale "${locale}") from Payload: ${res.status} ${res.statusText}`,
    );
  }

  const site = await res.json() as SiteGlobals;
  // Anonymous reads only return published content: a never-published site
  // global comes back empty. Say so instead of failing later in rendering.
  if (!Array.isArray(site.components)) {
    throw new Error(`Site global "${globalSlug}" (locale "${locale}") has no published version. Publish it in the CMS.`);
  }
  return absolutizeSiteChromeUrls(site);
}

export function absolutizePageMediaUrls(page: Page): Page {
  for (const section of page.sections) {
    absolutizeMediaUrls(section);
  }
  return page;
}

// Walks an arbitrary block payload and absolutizes every Media-shaped value
// ({ url, alt, width, height }) found at any depth — sections are
// tenant-defined, so no per-blockType knowledge exists here.
function absolutizeMediaUrls(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) absolutizeMediaUrls(entry);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (hasMedia(record)) {
    record.url = new URL(record.url, cmsOrigin).toString();
    return;
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") absolutizeMediaUrls(child);
  }
}

const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const hasMedia = (value: unknown): value is Media => {
  if (!value || typeof value !== "object") return false;
  const media = value as Partial<Media>;
  return hasText(media.url) && typeof media.url === "string" && !media.url.startsWith("http") && typeof media.width === "number" && typeof media.height === "number";
};

function isCompletePage(page: Page): boolean {
  if ((typeof page.id !== "string" && typeof page.id !== "number") || !hasText(page.slug) || !hasText(page.title)) return false;
  if (!page.metadata || page.metadata.titleTemplate !== "{title}") return false;
  const sections = page.sections;
  if (!Array.isArray(sections) || sections.length === 0) return false;
  return sections.every((section) => Boolean(section && hasText(section.blockType)));
}

function hasLocalizedPageData(page: Page): boolean {
  return hasText(page.title) || [page.metadata?.titleTemplate].some(hasText);
}

async function fetchPages(locale: string, slug?: string): Promise<Page[]> {
  if (!PAGE_SLUG_PATTERN.test(locale)) return [];

  const params = new URLSearchParams({ depth: "1", locale, "fallback-locale": "none", limit: "1000" });
  if (slug) params.set("where[slug][equals]", slug);
  const res = await fetch(`${cmsOrigin}/api/pages?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch Pages (locale "${locale}"): ${res.status} ${res.statusText}`);
  const data = await res.json() as { docs?: Page[] };
  const translatedPages = (data.docs ?? []).filter((page) => {
    if (!hasLocalizedPageData(page)) return false;
    if (!hasText(page.title)) throw new Error(`Published Page "${page.slug}" is missing its title for locale "${locale}".`);
    return true;
  });
  for (const page of translatedPages) {
    if (!isCompletePage(page)) {
      throw new Error(`Published Page "${page.slug}" is incomplete for locale "${locale}".`);
    }
  }
  return translatedPages.map(absolutizePageMediaUrls);
}

export async function getPages(locale: string): Promise<Page[]> {
  return fetchPages(locale);
}

export async function getPage(slug: string, locale: string): Promise<Page | null> {
  if (!PAGE_SLUG_PATTERN.test(locale) || !PAGE_SLUG_PATTERN.test(slug) || slug.length > 80) return null;
  return (await fetchPages(locale, slug))[0] ?? null;
}

// Preview only (src/pages/preview.astro): reads the latest draft of one page by
// slug, plus the draft site global (with its global components), with the
// editor's login token that the CMS put in the preview URL. Reports why it
// failed so the editor sees a clear message.
export type PreviewResult =
  // `page` for pages and globals designs; `doc` (raw) for a services collection, built by services.ts.
  | { ok: true; collection?: string; global?: string; locale: string; page?: Page; doc?: Page & Record<string, unknown>; site: SiteGlobals }
  | { ok: false; reason: "expired" | "unavailable" };

export async function getPreview({ collection, id, slug, locale, token }: { collection: string | null; id?: string | null; slug?: string | null; locale: string | null; token: string | null }): Promise<PreviewResult> {
  if (!collection || !PAGE_SLUG_PATTERN.test(collection) || !(slug || (id && /^[A-Za-z0-9-]+$/.test(id))) || !locale || !token) return { ok: false, reason: "expired" };
  const headers = { Authorization: `JWT ${token}` };
  const query = (depth: string) => new URLSearchParams({ draft: "true", depth, locale, "fallback-locale": "none" });
  try {
    // Payload treats an expired or invalid token as anonymous instead of
    // rejecting it, which would silently show published content. Check it first.
    const meRes = await fetch(`${cmsOrigin}/api/users/me`, { headers });
    if (!meRes.ok) return { ok: false, reason: "unavailable" };
    const me = await meRes.json() as { user?: unknown };
    if (!me.user) return { ok: false, reason: "expired" };
    const [pageRes, siteRes] = await Promise.all([
      fetch(`${cmsOrigin}/api/${collection}?${query("1")}&${new URLSearchParams(id ? { "where[id][equals]": id, limit: "1" } : { "where[slug][equals]": slug!, limit: "1" })}`, { headers }),
      fetch(`${cmsOrigin}/api/globals/${globalSlug}?${query("2")}`, { headers }),
    ]);
    if ([pageRes.status, siteRes.status].some((status) => status === 401 || status === 403)) return { ok: false, reason: "expired" };
    if (!pageRes.ok || !siteRes.ok) return { ok: false, reason: "unavailable" };
    const doc = ((await pageRes.json()) as { docs?: Page[] }).docs?.[0];
    if (!doc) return { ok: false, reason: "unavailable" };
    const site = absolutizeSiteChromeUrls(await siteRes.json());
    return collection === "pages"
      ? { ok: true, collection, locale, page: absolutizePageMediaUrls(doc), site }
      : { ok: true, collection, locale, doc: doc as Page & Record<string, unknown>, site };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

// Preview of a service type's globals (its URL prefix and page design): the
// latest draft design rendered as a page, placeholders left as written.
export async function getGlobalPreview(global: string | null, locale: string | null, token: string | null): Promise<PreviewResult> {
  if (!global || !PAGE_SLUG_PATTERN.test(global) || !locale || !token) return { ok: false, reason: "expired" };
  const headers = { Authorization: `JWT ${token}` };
  const query = (depth: string) => new URLSearchParams({ draft: "true", depth, locale, "fallback-locale": "none" });
  try {
    const meRes = await fetch(`${cmsOrigin}/api/users/me`, { headers });
    if (!meRes.ok) return { ok: false, reason: "unavailable" };
    if (!((await meRes.json()) as { user?: unknown }).user) return { ok: false, reason: "expired" };
    const [designRes, siteRes] = await Promise.all([
      fetch(`${cmsOrigin}/api/globals/${global}?${query("1")}`, { headers }),
      fetch(`${cmsOrigin}/api/globals/${globalSlug}?${query("2")}`, { headers }),
    ]);
    if ([designRes.status, siteRes.status].some((status) => status === 401 || status === 403)) return { ok: false, reason: "expired" };
    if (!designRes.ok || !siteRes.ok) return { ok: false, reason: "unavailable" };
    const design = await designRes.json() as { sections?: PageSection[] };
    const page: Page = { id: global, slug: global, title: global, metadata: { titleTemplate: "{title}" }, sections: design.sections ?? [] };
    return { ok: true, global, locale, page: absolutizePageMediaUrls(page), site: absolutizeSiteChromeUrls(await siteRes.json()) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
