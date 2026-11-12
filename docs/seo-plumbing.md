# SEO Plumbing — CMS Field Map

Purpose: for a CMS editor or future developer, trace every piece of
rendered SEO output back to exactly which Payload field produces it (or
which frontend-owned config value produces it, if not CMS content). No
orphaned frontend fields without a CMS source, no CMS fields nothing reads.

## Metadata (astro-seo `<SEO>` component, src/layouts/Layout.astro)

| Output | Source | Owner |
|---|---|---|
| `<title>` | `metadata.titleTemplate` with `{title}` replaced by `page.title` | Payload: Page.metadata.titleTemplate, Page.title |
| canonical / og:url | computed from `astro.config.mjs`'s `site` + current route path | Frontend (routing, not content) |
| hreflang alternates (x-default + one per locale) | `astro:i18n`'s `getAbsoluteLocaleUrlList()`/`toCodes()`, reading `i18n` from `astro:config/client` — no locale ever hardcoded here, see "Locale discovery" below for where that config value actually comes from | Frontend (routing, not content) |
| og:title / twitter:title | same as `<title>` | Payload (see title row) |
| favicon | `brand.favicon.url` | Payload: SiteGlobals.brand.favicon |
| meta description / og:description / twitter:description | pages: `metadata.description`; services plugin pages: `meta.description` with its `{field}` placeholders filled (`src/lib/services.ts`). Empty or absent: all three tags are omitted (astro-seo skips an empty description); the title is never used in its place | Payload: Page.metadata.description, services `meta.description` |
| robots meta | `index, follow` (astro-seo default), except `noindex, follow` on services plugin pair pages not set to index and on `/preview` | Payload: pair page `index` checkbox |

Services plugin pages take their `<title>` from `meta.title` (placeholders
filled), or the entry's title when it is empty.

## JSON-LD graph (src/lib/seo/schemaGraph.ts, rendered in Layout.astro)

`schemaGraph.ts` is a thin call to `buildPageGraph` from
`@good-shepherd-insights/website-components/core`. The CMS's SEO tab
(every page and services plugin collection) calls the same function on the
same data, so it shows exactly the JSON-LD this site publishes.
`PageView.astro` passes it the page's canonical URL, title, description,
locale, its sections plus the sitewide component sections it does not
hide, and, for services plugin pages, `isServicePage` and the pair's
`service`.

| Node | Field | Source | Owner |
|---|---|---|---|
| WebSite | name | `brand.logoAlt` | Payload: SiteGlobals.brand.logoAlt |
| WebSite | url | site origin | Frontend |
| business (`@id` …`#organization`) | @type | `business.schemaType`; empty: `Organization` | Payload: SiteGlobals.business |
| business | name / logo | `brand.logoAlt` / `brand.logo.url` + width/height | Payload: SiteGlobals.brand |
| business | description, telephone, email, address (PostalAddress), openingHoursSpecification, sameAs, priceRange, image (ImageObject) | the `business` group (Site Globals → Business tab); `business.image.url` is made absolute against the CMS in `payload.ts` like other media | Payload: SiteGlobals.business |
| WebPage | name | page title (see metadata table) | Payload (see title row) |
| WebPage | description | the meta description (see metadata table); absent when none is set | Payload |
| WebPage | url / inLanguage | computed | Frontend (routing) |

Empty business fields, and placeholder text (`[…]`, Lorem ipsum, TBD,
Coming soon and the like), are left out, not published.

Everything else comes from the page's sections: each component in
`@good-shepherd-insights/website-components` that maps to schema.org exports
`jsonLd` (BreadcrumbList, FAQPage, service description/areas/audiences/real
prices, `makesOffer` service lists, `primaryImageOfPage`), and
`buildPageGraph` merges them without the website naming any component.
Pages from payload-plugin-services get a Service node holding the service
facts (`mainEntity` of the WebPage); on other pages only the areas served
are kept, on the business node. Placeholder content produces nothing.

## Sitemap / robots

| Output | Source |
|---|---|
| `sitemap-index.xml` / `sitemap-0.xml` | generated entirely by the `@astrojs/sitemap` integration from the actual build output + `astro.config.mjs`'s `i18n.locales` — no manually maintained route list |
| `robots.txt` | hand-written (`src/pages/robots.txt.ts`), Sitemap: line derived from `site` (Astro build config), not a separately hardcoded domain string |

## Locale discovery — how the site knows which languages exist

Payload is the only source of truth for the locale list; nothing below is a
manually maintained array.

1. **`GET /api/locales`** — a small custom Payload endpoint
   (cms-template's `src/payload.config.ts`, root-level
   `endpoints`) that returns `{ locales, defaultLocale }` from
   `config.localization` straight from server memory. No database query —
   this is Payload's own extensibility model (a real endpoint reading
   `req.payload.config`), not a side effect inferred from document content.
2. **`astro.config.mjs`** fetches that endpoint at build time (top-level
   `await`, which Astro's config loader supports) and feeds the resulting
   code list into both `i18n.locales` and `@astrojs/sitemap`'s `i18n.locales`
   map — one fetch, two consumers. A missing or misconfigured CMS breaks the
   build loudly (missing `CMS_ORIGIN`, non-200 response, empty locale list,
   or invalid default locale all throw); there is no fallback locale list.
3. **`src/pages/[locale]/index.astro`** — a dynamic route whose
   `getStaticPaths()` reads that same resolved `i18n.locales` (via
   `astro:config/client`) and generates one real page per non-default
   locale. The default locale still lives at the static `src/pages/
   index.astro` — `prefixDefaultLocale:false` means `/` is unprefixed, which
   a generic `[locale]`-prefixed route can't produce, so that one file is an
   intentional, permanent exception, not leftover hardcoding.
4. **`src/lib/locales.ts` / `getLocales()`** — the runtime counterpart of
   the same `/api/locales` endpoint (same fetch, same source). There is no
   shipped language-switcher UI; a project building its own nav should
   compute its locale links from `getLocales()` + Astro's
   `getRelativeLocaleUrl` — no per-locale branching is needed anywhere.

### Accessibility labels (CMS-sourced UI strings)

`accessibility.skipToContentLabel`, `accessibility.menuLabel`, and
`accessibility.languageSwitchAriaLabelTemplate` (this last one contains a
literal `{language}` placeholder, replaced with the target locale's own
`label` from `/api/locales`) are real `localized: true` Payload fields on
the site global — not frontend constants. `PageView.astro` renders the skip
link with an empty-string fallback for the optional label; every real API
response already has a value, translated or Payload's own automatic
default-locale fallback (`localization.fallback: true`, Payload's own
default) for locales not yet translated.

## Content/data gaps — fields that don't exist in Payload yet

These are NOT bugs in the frontend pipe. The frontend is ready to render
them the moment the field exists; until then they're correctly omitted
(the JSON-LD graph builder strips undefined/empty fields rather than
fabricating placeholder values, per the skill: "do not fabricate
content-specific facts in code").

- **Dedicated social-share image.** Currently the brand logo is used for
  og:image/twitter:image. A `metadata.socialImage` field on the Payload
  site global (same `Media` upload shape as any project image) would let
  an editor pick a purpose-built share image without changing page content.
  Wiring change needed if added: swap the social-image source in
  `src/components/PageView.astro`.

## Explicitly out of scope for this pass

The former silent fallback to a hardcoded content snapshot was already
removed: the build now fails loudly when the CMS is unreachable or returns
invalid data (see "Locale discovery" above).

## Verifying this map stays accurate

The template ships no tenant acceptance scripts or SEO tests. Verify the
metadata map by building the site (`CMS_ORIGIN=<your CMS URL> npm run build`)
and inspecting the rendered `dist/**/*.html` output.
