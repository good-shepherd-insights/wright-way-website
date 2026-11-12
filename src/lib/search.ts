import { getPages, type Page, type PageSection } from "./payload";
import { getServiceIndex, getServicePage, withHubLinks } from "./services";

// Site search over every published page: CMS pages and payload-plugin-services
// pages (services, service areas, services in areas). Each FAQ question is
// also its own result. The index is built from the CMS on first use and kept
// for a few minutes; publishing in the CMS redeploys the site anyway.

type Doc = { title: string; href: string; path: string[]; text: string };
// The search results block's result shape (components' search-results/shared.ts).
type SearchResult = {
  title: string;
  href: string;
  path: string[];
  excerpt: { before: string; match: string; after: string; truncatedStart: boolean; truncatedEnd: boolean };
};

// Field names that hold links, ids or settings, not words a visitor reads.
const SKIP = new Set(["id", "createdAt", "updatedAt", "blockType", "blockName", "href", "url", "action", "searchAction", "formAction", "tone", "layout", "style", "mapQuery", "mapEmbedUrl", "mapLinkHref", "phoneHref", "textAlign", "overlayColor", "headingSize", "filename", "mimeType"]);

function words(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    if (text && !/^(https?:|tel:|mailto:|\/|#)/.test(text)) out.push(text);
  } else if (Array.isArray(value)) {
    for (const item of value) words(item, out);
  } else if (value && typeof value === "object") {
    // Uploaded media (file records) are not page text.
    if ("filename" in value || "mimeType" in value) return out;
    for (const [key, item] of Object.entries(value)) if (!SKIP.has(key)) words(item, out);
  }
  return out;
}

// Crumbs between Home and the page itself, from the page's breadcrumb block.
function crumbs(sections: PageSection[]): string[] {
  const items = (sections.find((s) => s.blockType === "breadcrumb")?.items ?? []) as { label?: string }[];
  return items.slice(1, -1).map((i) => i.label ?? "").filter(Boolean);
}

function docsFor(page: Page, href: string): Doc[] {
  const sections = page.sections.filter((s) => s.blockType !== "searchResults");
  const path = crumbs(sections);
  // The breadcrumb is shown as the result's path, not searched as text.
  const text = words(sections.filter((s) => s.blockType !== "breadcrumb")).join(" · ");
  const docs: Doc[] = [{ title: page.title, href, path, text }];
  for (const section of sections) {
    if (section.blockType !== "faqAccordion") continue;
    for (const item of (section.items ?? []) as { question?: string; answer?: string }[]) {
      if (item.question && item.answer) docs.push({ title: item.question, href, path: [...path, page.title], text: item.answer });
    }
  }
  return docs;
}

async function buildIndex(locale: string): Promise<Doc[]> {
  const pages = await getPages(locale);
  const pageDocs = await Promise.all(
    pages
      .filter((page) => !page.sections.some((s) => s.blockType === "searchResults"))
      .map(async (page) => docsFor(await withHubLinks(page), page.slug === "home" ? "/" : `/${page.slug}`)),
  );
  const index = await getServiceIndex();
  const serviceDocs = await Promise.all(
    index.paths.map(async (p) => {
      const found = await getServicePage(p.collection, String(p.id), locale);
      return found && !found.noindex ? docsFor(found.page, p.path) : [];
    }),
  );
  return [...pageDocs.flat(), ...serviceDocs.flat()];
}

const TTL = 5 * 60 * 1000;
let cached: { at: number; locale: string; docs: Promise<Doc[]> } | undefined;
function getIndex(locale: string): Promise<Doc[]> {
  if (!cached || cached.locale !== locale || Date.now() - cached.at > TTL) {
    cached = { at: Date.now(), locale, docs: buildIndex(locale) };
    cached.docs.catch(() => (cached = undefined));
  }
  return cached.docs;
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

function excerpt(text: string, terms: string[]): SearchResult["excerpt"] {
  const lower = text.toLowerCase();
  let at = -1;
  let term = "";
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) { at = i; term = t; }
  }
  if (at < 0) {
    const cut = text.length > 160;
    return { before: "", match: "", after: cut ? text.slice(0, 160) : text, truncatedStart: false, truncatedEnd: cut };
  }
  const start = Math.max(0, at - 70);
  const end = Math.min(text.length, at + term.length + 110);
  return {
    before: text.slice(start, at),
    match: text.slice(at, at + term.length),
    after: text.slice(at + term.length, end),
    truncatedStart: start > 0,
    truncatedEnd: end < text.length,
  };
}

/** Pages and FAQ answers containing every word of the query, best first. */
export async function searchSite(query: string, locale: string): Promise<{ total: number; results: SearchResult[] }> {
  const q = normalize(query.trim()).slice(0, 100);
  const terms = [...new Set(q.split(" ").filter((t) => t.length > 1))];
  if (terms.length === 0) return { total: 0, results: [] };
  const scored = (await getIndex(locale))
    .map((doc) => {
      const title = normalize(doc.title);
      const body = normalize(doc.text);
      if (!terms.every((t) => title.includes(t) || body.includes(t))) return null;
      let score = 0;
      if (title.includes(q)) score += 20;
      if (body.includes(q)) score += 5;
      for (const t of terms) score += (title.includes(t) ? 4 : 0) + (body.includes(t) ? 1 : 0);
      // More mentions rank higher (capped, so long pages don't swamp short answers).
      score += Math.min(body.split(q).length - 1, 5);
      return { doc, score };
    })
    .filter((x): x is { doc: Doc; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    // The same FAQ on several pages is one result (its first, best-ranked page).
    .filter((x, i, all) => all.findIndex((y) => y.doc.title === x.doc.title && y.doc.text === x.doc.text) === i);
  return {
    total: scored.length,
    results: scored.slice(0, 50).map(({ doc }) => ({ title: doc.title, href: doc.href, path: doc.path, excerpt: excerpt(doc.text, [q, ...terms]) })),
  };
}
