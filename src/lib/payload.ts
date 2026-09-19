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

export interface SiteGlobals {
  brand: { logo?: Media; logoAlt?: string; favicon?: Media };
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
  metadata: { titleTemplate: string };
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

  return absolutizeSiteChromeUrls(await res.json());
}

function absolutizePageMediaUrls(page: Page): Page {
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
