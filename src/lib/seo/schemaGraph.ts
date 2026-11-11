import type { SiteGlobals } from "../payload";
import { buildSchemaIds } from "./ids";
import { buildGraph } from "./graph";
import { buildOrganizationSchema, buildWebsiteSchema } from "./organization";
import { buildWebPageSchema } from "./webpage";
import { buildSectionNodes } from "./sections";
import type { PageSection } from "../payload";

// Site nodes (WebSite, Organization, WebPage) plus nodes derived from the
// page's own blocks (BreadcrumbList, FAQPage, Service + areaServed) — see
// sections.ts. The home page has no breadcrumb block, so it gets none.
export function buildSiteGraph({
  page,
  canonical,
  baseUrl,
  title,
  description,
  locale,
  sections = [],
}: {
  page: SiteGlobals;
  canonical: string;
  baseUrl: string;
  title: string;
  description: string;
  locale: string;
  sections?: PageSection[];
}) {
  const ids = buildSchemaIds(canonical, baseUrl);

  return buildGraph([
    buildWebsiteSchema(page, ids),
    buildOrganizationSchema(page, ids),
    buildWebPageSchema({ ids, name: title, description, inLanguage: locale }),
    ...buildSectionNodes(sections, ids, title),
  ]);
}
