import { buildPageGraph, type PageGraphInput } from "@good-shepherd-insights/website-components/core";
import type { SiteGlobals } from "../payload";

// The page's JSON-LD graph (WebSite, the business, WebPage, what the page's
// sections say, and a Service node on service pages), built by the shared
// components package, so the CMS's SEO tab previews exactly this. Business
// facts come from the site global's `business` group (empty fields are left
// out); the website never names a component.
export function buildSiteGraph({
  site,
  ...page
}: Omit<PageGraphInput, "site"> & { site: SiteGlobals }) {
  const image = site.business?.image;
  return buildPageGraph({
    ...page,
    site: {
      name: site.brand.logoAlt ?? "",
      logo: site.brand.logo ? { url: site.brand.logo.url, width: site.brand.logo.width, height: site.brand.logo.height } : null,
      business: site.business
        ? { ...site.business, image: image && typeof image === "object" ? { url: image.url, alt: image.alt, width: image.width, height: image.height } : null }
        : null,
    },
  });
}
