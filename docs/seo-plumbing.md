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
| robots meta | always `index, follow` (astro-seo default; no noindex/nofollow set anywhere) | Frontend (policy, not content) |

**Gap:** description and social-image rows previously mapped to
`hero.subhead`/`hero.image`/`footer.tagline` — fields that belonged to the
removed tenant section set and exist in neither schema. `PageView.astro`
passes `page.title` as the description and the brand logo as the social
image; when a project registers its own blocks it should map its own
description/social-image fields here.

## JSON-LD graph (src/lib/seo/*.ts, rendered in Layout.astro)

| Node | Field | Source | Owner |
|---|---|---|---|
| WebSite | name | `brand.logoAlt` | Payload: SiteGlobals.brand.logoAlt |
| WebSite | url | site origin | Frontend |
| Organization | name | `brand.logoAlt` | Payload: SiteGlobals.brand.logoAlt |
| Organization | logo | `brand.logo.url` + width/height | Payload: SiteGlobals.brand.logo |
| WebPage | name | page title (see metadata table) | Payload (see title row) |
| WebPage | url / inLanguage | computed | Frontend (routing) |

**Gap:** the WebSite/Organization/WebPage `description` fields previously
sourced `hero.subhead`/`footer.tagline` (removed tenant fields); the
builders currently emit no description until a project supplies its own.

Everything else comes from the page's sections: each component in
`@good-shepherd-insights/website-components` that maps to schema.org exports
`jsonLd` (BreadcrumbList, FAQPage, service description/areas/audiences/real
prices, `makesOffer` service lists, `primaryImageOfPage`), and
`schemaGraph.ts` merges them via `collectJsonLd` without naming any
component. Pages from payload-plugin-services get a Service node holding
the service facts (`mainEntity` of the WebPage); on other pages only the
areas served are kept, on the Organization. Placeholder content produces
nothing.

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
- **Organization address / contact / social profiles (`sameAs`).** No
  fields exist in the site global for a mailing address, phone, email, or
  social media profile URLs. Adding an `organization` group (address
  sub-fields, `email`, `telephone`, a repeatable `socialLinks` array of
  URLs) would let `src/lib/seo/organization.ts`'s
  `buildOrganizationSchema` emit `address`, `email`, `telephone`, and
  `sameAs` — all currently correctly absent, not fabricated.

## Explicitly out of scope for this pass

The former silent fallback to a hardcoded content snapshot was already
removed: the build now fails loudly when the CMS is unreachable or returns
invalid data (see "Locale discovery" above).

## Verifying this map stays accurate

The template ships no tenant acceptance scripts or SEO tests. Verify the
metadata map by building the site (`CMS_ORIGIN=<your CMS URL> npm run build`)
and inspecting the rendered `dist/**/*.html` output.
