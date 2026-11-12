import type { ServicePath, ServiceTypeRoute } from "@good-shepherd-insights/payload-plugin-services";
import { resolveTokens, servicePath } from "@good-shepherd-insights/payload-plugin-services/render";
import { absolutizePageMediaUrls, cmsOrigin, PAGE_SLUG_PATTERN, type Page, type PageSection } from "./payload";

// Pages from payload-plugin-services: entries of owner-defined types (e.g.
// services, service areas) and pairs of them (e.g. a service in an area).
// Every URL, and whether it may be indexed, comes from the CMS.

type Place = { name?: string; label?: string; kind?: string; county?: string; geoid?: string; state?: string };
type Doc = { id: number | string; slug?: string; title: string; sections?: PageSection[]; place?: Place; meta?: { title?: string | null; description?: string | null }; [field: string]: unknown };

export type ServiceIndex = { types: ServiceTypeRoute[]; paths: ServicePath[] };

/** A real place served by a page, for the Service structured data. */
export type AreaServed = { name: string; kind?: string; county?: string; geoid?: string };

export type ServicePage = {
  page: Page;
  /** Meta description (empty: none). The page's title is its meta title, else its title. */
  description?: string;
  /** Search engines must not index it ("noindex, follow", left out of the sitemap). */
  noindex: boolean;
  /** For a service in an area: the Service structured data. */
  service?: { name: string; serviceType: string; areaServed: AreaServed };
};

async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${cmsOrigin}${path}`);
  if (res.status === 404) return null; // CMS without the services plugin
  if (!res.ok) throw new Error(`Failed to fetch ${path} from Payload: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// One fetch per build; the dev server lives across CMS edits, so it always fetches fresh.
let cachedIndex: Promise<ServiceIndex> | undefined;
export function getServiceIndex(): Promise<ServiceIndex> {
  const load = async (): Promise<ServiceIndex> => ({
    types: (await fetchJson<ServiceTypeRoute[]>("/api/payload-plugin-services/types")) ?? [],
    paths: (await fetchJson<ServicePath[]>("/api/payload-plugin-services/paths")) ?? [],
  });
  if (import.meta.env.DEV) return load();
  cachedIndex ??= load();
  return cachedIndex;
}

const displayName = (doc: Doc) => doc.place?.name || doc.title;
const prefixOf = (index: ServiceIndex, slug: string) => index.types.find((t) => t.slug === slug)?.pathPrefix ?? "";
const pathOf = (index: ServiceIndex, collection: string, doc: Doc) => (doc.slug ? servicePath(prefixOf(index, collection), doc.slug) : "");
const asDoc = (value: unknown): Doc | null => (value && typeof value === "object" ? (value as Doc) : null);

/** Turns a CMS document of a services type (or a pair) into a renderable page. */
export function toServicePage(collection: string, doc: Doc, index: ServiceIndex): ServicePage {
  const type = index.types.find((t) => t.slug === collection);
  let context: Record<string, unknown> = { ...doc, name: displayName(doc), path: pathOf(index, collection, doc) };
  let service: ServicePage["service"];
  let noindex = false;

  if (type?.kind === "combination" && type.parent && type.child && type.tokens) {
    const parent = asDoc(doc.parent);
    const child = asDoc(doc.child);
    const parentContext = parent && { ...parent, name: displayName(parent), path: pathOf(index, type.parent, parent) };
    const childContext = child && { ...child, name: displayName(child), path: pathOf(index, type.child, child) };
    context = { ...context, [type.tokens.parent]: parentContext, [type.tokens.child]: childContext };
    noindex = doc.index !== true;
    if (parent && child) {
      service = {
        name: doc.title,
        serviceType: child.title,
        areaServed: { name: parent.place?.label || displayName(parent), kind: parent.place?.kind, county: parent.place?.county, geoid: parent.place?.geoid },
      };
    }
  }

  const sections = localizeServiceLinks(resolveTokens(doc.sections ?? [], context), collection, doc, index);
  const title = resolveTokens(doc.meta?.title || doc.title, context);
  const description = doc.meta?.description ? resolveTokens(doc.meta.description, context) : undefined;
  const page: Page = { id: doc.id, slug: doc.slug ?? String(doc.id), title, metadata: { titleTemplate: "{title}" }, sections: [...sections, ...linkSections(collection, doc, index)] };
  return { page: absolutizePageMediaUrls(page), description, noindex, service };
}

// On a parent entry's page (e.g. a service area), a link to a child entry
// (e.g. /services/junk-removal) goes to their published pair page instead
// (e.g. /service-areas/frederick/junk-removal). Without a published pair
// page the link stays on the child's own page, so it never breaks.
function localizeServiceLinks(sections: PageSection[], collection: string, doc: Doc, index: ServiceIndex): PageSection[] {
  const swap = new Map<string, string>();
  for (const type of index.types) {
    if (type.kind !== "combination" || type.parent !== collection || !type.child) continue;
    const childPath = new Map(index.paths.filter((p) => p.kind === "entry" && p.collection === type.child).map((p) => [String(p.id), p.path]));
    for (const pair of index.paths) {
      if (pair.kind !== "combination" || pair.collection !== type.slug || String(pair.parent) !== String(doc.id)) continue;
      const from = childPath.get(String(pair.child));
      if (from) swap.set(from, pair.path);
    }
  }
  if (swap.size === 0) return sections;
  const trim = (href: string) => (href.length > 1 ? href.replace(/\/+$/, "") : href);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "string" && /href$/i.test(key) && swap.has(trim(item)) ? swap.get(trim(item)) : walk(item),
      ]),
    );
  };
  return sections.map((section) => walk(section) as PageSection);
}

// Lists linking an entry to its published pair pages, under the headings set
// in the pair type's globals (no heading: no list).
function linkSections(collection: string, doc: Doc, index: ServiceIndex): PageSection[] {
  const sections: PageSection[] = [];
  for (const type of index.types) {
    if (type.kind !== "combination" || !type.tokens || !type.links) continue;
    const side = type.parent === collection ? "parent" : type.child === collection ? "child" : null;
    const heading = side && type.links[side];
    if (!side || !heading) continue;
    const links = index.paths
      .filter((p) => p.kind === "combination" && p.collection === type.slug && String(p[side]) === String(doc.id))
      .slice(0, 40)
      .map((p) => ({ label: p.title, href: p.path }));
    if (links.length === 0) continue;
    const context = { [type.tokens[side]]: { ...doc, name: displayName(doc) } };
    sections.push({ blockType: "linkList", heading: resolveTokens(heading, context), layout: "grid", tone: "white", links });
  }
  return sections;
}

/** A published page of a services type, fetched fresh (the route only lists paths). */
export async function getServicePage(collection: string, id: string, locale: string): Promise<ServicePage | null> {
  if (!PAGE_SLUG_PATTERN.test(collection) || !PAGE_SLUG_PATTERN.test(locale) || !/^[A-Za-z0-9-]+$/.test(id)) return null;
  const index = await getServiceIndex();
  const params = new URLSearchParams({ depth: "1", locale, "fallback-locale": "none" });
  const doc = await fetchJson<Doc>(`/api/${collection}/${encodeURIComponent(id)}?${params}`);
  return doc ? toServicePage(collection, doc, index) : null;
}

/**
 * A page at a type's URL prefix (e.g. /service-areas) is that type's hub: it
 * gets a list of every published entry of the type under the heading set in
 * the type's globals, before its closing contact section.
 */
export async function withHubLinks(page: Page): Promise<Page> {
  const index = await getServiceIndex();
  const lists: PageSection[] = [];
  for (const type of index.types) {
    if (type.kind !== "type" || !type.hubLinksHeading || !type.pathPrefix || type.pathPrefix !== page.slug) continue;
    const links = index.paths
      .filter((p) => p.kind === "entry" && p.collection === type.slug)
      .slice(0, 40)
      .map((p) => ({ label: p.title, href: p.path }));
    if (links.length) lists.push({ blockType: "linkList", heading: type.hubLinksHeading, layout: "grid", tone: "white", links });
  }
  if (lists.length === 0) return page;
  const sections = [...page.sections];
  const last = sections[sections.length - 1];
  sections.splice(last?.blockType === "contactUs" ? sections.length - 1 : sections.length, 0, ...lists);
  return { ...page, sections };
}

/**
 * A navbar with a service areas menu (areasHref = a type's hub, e.g.
 * /service-areas) lists that type's published entries in it.
 */
export function withNavbarAreas(section: PageSection, index: ServiceIndex): PageSection {
  if (section.blockType !== "navbar" || typeof section.areasHref !== "string") return section;
  const prefix = section.areasHref.replace(/^\/+|\/+$/g, "");
  const type = index.types.find((t) => t.kind === "type" && t.pathPrefix === prefix);
  if (!type) return section;
  const areaLinks = index.paths
    .filter((p) => p.kind === "entry" && p.collection === type.slug)
    .slice(0, 40)
    .map((p) => ({ label: p.title, href: p.path }));
  return { ...section, areaLinks };
}
