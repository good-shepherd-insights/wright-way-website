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
  service,
}: {
  page: SiteGlobals;
  canonical: string;
  baseUrl: string;
  title: string;
  description: string;
  locale: string;
  sections?: PageSection[];
  // A service in a real place (payload-plugin-services pair page).
  service?: { name: string; serviceType: string; areaServed: { name: string; kind?: string; county?: string; geoid?: string } };
}) {
  const ids = buildSchemaIds(canonical, baseUrl);

  return buildGraph([
    buildWebsiteSchema(page, ids),
    buildOrganizationSchema(page, ids),
    buildWebPageSchema({ ids, name: title, description, inLanguage: locale }),
    // A page's own Service (a service in a place) replaces one derived from its blocks.
    ...buildSectionNodes(sections, ids, title).filter((node) => !(service && node && (node as { "@type"?: string })["@type"] === "Service")),
    service && {
      "@type": "Service",
      "@id": `${ids.canonical}#service`,
      name: service.name,
      serviceType: service.serviceType,
      provider: { "@id": ids.organization },
      url: ids.canonical,
      areaServed: {
        "@type": service.areaServed.kind === "county" ? "AdministrativeArea" : service.areaServed.kind === "city" ? "City" : "Place",
        name: service.areaServed.name,
        ...(service.areaServed.county && service.areaServed.kind !== "county"
          ? { containedInPlace: { "@type": "AdministrativeArea", name: service.areaServed.county } }
          : {}),
        ...(service.areaServed.geoid ? { identifier: { "@type": "PropertyValue", propertyID: "US Census GEOID", value: service.areaServed.geoid } } : {}),
      },
    },
  ]);
}
