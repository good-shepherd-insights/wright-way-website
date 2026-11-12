// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

// .env files are not loaded automatically inside astro.config.mjs — Vite only
// applies that to application code. Per the Astro docs, load them explicitly:
// https://docs.astro.build/en/guides/environment-variables/#in-the-astro-config-file
const env = loadEnv(process.env.NODE_ENV ?? '', process.cwd(), '');

/** @param {string} name */
function requiredEnv(name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** @param {string} name */
function requiredOrigin(name) {
  const value = requiredEnv(name);
  const url = new URL(value);
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an origin without a path, query, or hash`);
  }
  return url.origin;
}

/** @param {string} cmsOrigin
 *  @returns {Promise<{ locales: string[], defaultLocale: string }>} */
async function discoverLocales(cmsOrigin) {
  const res = await fetch(`${cmsOrigin}/api/locales`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Failed to discover locales from Payload: ${res.status} ${res.statusText}`);
  const data = /** @type {{ locales?: { code?: string }[], defaultLocale?: string }} */ (await res.json());
  const locales = Array.isArray(data?.locales)
    ? data.locales
        .map((entry) => (typeof entry?.code === 'string' && entry.code.length > 0 ? entry.code : undefined))
        .filter((code) => typeof code === 'string')
    : [];
  if (locales.length === 0) throw new Error('Payload returned no locales.');
  if (typeof data?.defaultLocale !== 'string' || !locales.includes(data.defaultLocale)) {
    throw new Error('Payload returned an invalid default locale.');
  }
  return { locales, defaultLocale: data.defaultLocale };
}

const cmsOrigin = requiredOrigin('CMS_ORIGIN');
const siteOrigin = requiredOrigin('SITE_ORIGIN');
const { locales, defaultLocale } = await discoverLocales(cmsOrigin);

/** Paths the CMS marks as not indexed (payload-plugin-services); left out of the sitemap.
 *  @param {string} cmsOrigin
 *  @returns {Promise<Set<string>>} */
async function discoverNoindexPaths(cmsOrigin) {
  const res = await fetch(`${cmsOrigin}/api/payload-plugin-services/paths`, { signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return new Set(); // CMS without the services plugin
  if (!res.ok) throw new Error(`Failed to read page paths from Payload: ${res.status} ${res.statusText}`);
  const paths = /** @type {{ path: string, index: boolean }[]} */ (await res.json());
  return new Set(paths.filter((p) => !p.index).map((p) => p.path));
}
const noindexPaths = await discoverNoindexPaths(cmsOrigin);

// https://astro.build/config
export default defineConfig({
  site: siteOrigin,
  adapter: vercel(),
  i18n: {
    locales,
    defaultLocale,
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations: [
    sitemap({
      // Not indexed in the CMS, or the editors' on-request preview route.
      filter: (page) => {
        const path = new URL(page).pathname.replace(/\/$/, '');
        return path !== '/preview' && !noindexPaths.has(path);
      },
      i18n: {
        defaultLocale,
        locales: Object.fromEntries(locales.map((locale) => [locale, locale])),
      },
    }),
    // Required to render SectionRenderer from @good-shepherd-insights/website-components,
    // which is a React component - Astro has no built-in renderer for React JSX.
    react(),
  ],
  vite: {
    // The components package imports its own styles.css files. Vite treats
    // node_modules packages as external SSR modules by default, leaving those
    // imports to Node, which can't load .css ("Unknown file extension .css").
    // Bundling the package lets Vite handle the CSS. It's installed under an
    // alias, so match both the import name and the published package name.
    resolve: {
      noExternal: ['@good-shepherd-insights/website-components', '@good-shepherd-insights/wright-way-components'],
    },
    server: {
      allowedHosts: ['wrightway-website.goodshepherdinsights.com'],
    },
  },
});
