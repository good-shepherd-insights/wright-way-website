import type { PageSection } from "../payload";
import type { SchemaIds } from "./ids";

// JSON-LD nodes derived from a page's own CMS blocks, by blockType. Every
// value comes from block fields — nothing about a specific town, service or
// business is written here, so any page built from these blocks gets the
// matching markup automatically. Unknown blocks are ignored.

const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object") : [];
const find = (sections: PageSection[], type: string) => sections.find((s) => s.blockType === type);

// breadcrumb → BreadcrumbList. The last crumb (no href) is the current page.
function breadcrumbs(sections: PageSection[], ids: SchemaIds) {
  const items = list(find(sections, "breadcrumb")?.items).filter((i) => text(i.label));
  if (items.length < 2) return undefined;
  return {
    "@type": "BreadcrumbList",
    "@id": `${ids.canonical}#breadcrumb`,
    itemListElement: items.map((i, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: i.label,
      item: text(i.href) ? new URL(i.href, ids.baseUrl).toString() : ids.canonical,
    })),
  };
}

// faqAccordion → FAQPage (all FAQ blocks on the page, in order).
function faq(sections: PageSection[], ids: SchemaIds) {
  const items = sections
    .filter((s) => s.blockType === "faqAccordion")
    .flatMap((s) => list(s.items))
    .filter((i) => text(i.question) && text(i.answer));
  if (items.length === 0) return undefined;
  return {
    "@type": "FAQPage",
    "@id": `${ids.canonical}#faq`,
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
}

// coverageMap → Service offered by the Organization in the mapped place.
// No review/rating markup: Google ignores self-serving reviews for a
// business's own LocalBusiness/Organization (Search Central, 2019).
function areaService(sections: PageSection[], ids: SchemaIds, pageTitle: string) {
  const map = find(sections, "coverageMap");
  if (!map || !text(map.mapQuery)) return undefined;
  const neighborhoods = list(map.neighborhoods).map((n) => n.name).filter(text);
  const zips = list(map.zipCodes).map((z) => z.code).filter(text);
  return {
    "@type": "Service",
    "@id": `${ids.canonical}#service`,
    name: pageTitle,
    provider: { "@id": ids.organization },
    areaServed: [
      { "@type": "Place", name: map.mapQuery },
      ...neighborhoods.map((name) => ({ "@type": "Place", name, containedInPlace: { "@type": "Place", name: map.mapQuery } })),
      ...zips.map((postalCode) => ({ "@type": "PostalAddress", postalCode })),
    ],
    url: ids.canonical,
  };
}

export function buildSectionNodes(sections: PageSection[], ids: SchemaIds, pageTitle: string) {
  return [breadcrumbs(sections, ids), faq(sections, ids), areaService(sections, ids, pageTitle)];
}
