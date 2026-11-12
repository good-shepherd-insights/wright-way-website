import { collectJsonLd } from "@good-shepherd-insights/website-components/core";
import type { SiteGlobals } from "../payload";
import { buildSchemaIds } from "./ids";
import { buildGraph } from "./graph";
import { buildOrganizationSchema, buildWebsiteSchema } from "./organization";
import { buildWebPageSchema } from "./webpage";

type AreaServed = { name: string; kind?: string; county?: string; geoid?: string };

// A real place from the CMS's Census lookup (a service in an area).
function censusPlace(area: AreaServed) {
  return {
    "@type": area.kind === "county" ? "AdministrativeArea" : area.kind === "city" ? "City" : "Place",
    name: area.name,
    ...(area.county && area.kind !== "county" ? { containedInPlace: { "@type": "AdministrativeArea", name: area.county } } : {}),
    ...(area.geoid ? { identifier: { "@type": "PropertyValue", propertyID: "US Census GEOID", value: area.geoid } } : {}),
  };
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

// Site nodes (WebSite, Organization, WebPage) plus what the page's own
// sections say, mapped by each component (collectJsonLd). The website never
// names a component. A page about a service (any payload-plugin-services
// page) gets a Service node holding the sections' service facts; on any
// other page only the areas served are kept, on the business.
export function buildSiteGraph({
  page,
  canonical,
  baseUrl,
  title,
  description,
  locale,
  sections = [],
  isServicePage = false,
  service,
}: {
  page: SiteGlobals;
  canonical: string;
  baseUrl: string;
  title: string;
  description: string;
  locale: string;
  sections?: unknown[];
  isServicePage?: boolean;
  // A service in a real place (payload-plugin-services pair page).
  service?: { name: string; serviceType: string; areaServed: AreaServed };
}) {
  const ids = buildSchemaIds(canonical, baseUrl);
  const serviceId = `${ids.canonical}#service`;
  const collected = collectJsonLd(sections, {
    canonical: ids.canonical,
    baseUrl: ids.baseUrl,
    title,
    ids: { website: ids.website, business: ids.organization, webpage: ids.webPage, service: serviceId },
  });

  const hasService = Boolean(service) || isServicePage;
  const business = {
    ...buildOrganizationSchema(page, ids),
    ...collected.business,
    ...(!hasService && collected.service.areaServed ? { areaServed: collected.service.areaServed } : {}),
  };
  const serviceNode: Record<string, unknown> | undefined = hasService
    ? {
        "@type": "Service",
        "@id": serviceId,
        name: service?.name ?? title,
        ...(service ? { serviceType: service.serviceType } : {}),
        provider: { "@id": ids.organization },
        url: ids.canonical,
        ...collected.service,
        areaServed: [...(service ? [censusPlace(service.areaServed)] : []), ...list(collected.service.areaServed)],
      }
    : undefined;

  if (serviceNode && list(serviceNode.areaServed).length === 0) delete serviceNode.areaServed;

  return buildGraph([
    buildWebsiteSchema(page, ids),
    business,
    {
      ...buildWebPageSchema({ ids, name: title, description, inLanguage: locale }),
      ...collected.page,
      ...(serviceNode ? { mainEntity: { "@id": serviceId } } : {}),
    },
    ...collected.nodes,
    serviceNode,
  ]);
}
