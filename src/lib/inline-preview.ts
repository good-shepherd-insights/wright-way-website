import { ready, isLivePreviewEvent, mergeData, type CollectionPopulationRequestHandler } from "@payloadcms/live-preview";
import { resolveTokens } from "@good-shepherd-insights/payload-plugin-services/render";
import type { SiteGlobals, Page } from "./payload";

// Frontend half of the click-to-edit bridge (see the CMS repo's src/admin/InlinePreviewBridge.tsx
// for the admin-side half). Only ever runs when this page is embedded inside
// Payload's own Live Preview iframe/popup — a normal site visit never reaches
// this code path.
//
// Two independent things happen here, both driven by data attributes:
//  - `data-inline-edit="a.b.c"` elements: editable text, two-way. Typing goes
//    into the admin's form for the open page (as if typed in its sidebar);
//    the editor saves it with Save draft / Publish.
//  - `data-inline-image="a.b.c"` elements (an <img> or an element with a
//    background photo): clicking opens the CMS media picker for that image
//    field; the new image shows here once picked.
//  - `data-live-sync-*="a.b.c"` elements: read-only, one-way (admin -> page).

type JSONValue = unknown;

function getPath(obj: JSONValue, path: string): JSONValue {
  return path
    .split(".")
    .reduce<JSONValue>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, JSONValue>)[key] : undefined,
      obj,
    );
}

interface InlinePreviewOptions {
  serverURL: string;
  initialData: SiteGlobals | Page;
  locale: string;
  globalSlug: string;
  // "globals", "pages" or a service type (payload-plugin-services).
  collection?: string;
  // A previewed global whose sections the page shows (a service type's globals).
  documentGlobal?: string;
  initialGlobalData?: SiteGlobals;
}

export function initInlinePreview({ serverURL, initialData, locale, globalSlug, collection = "globals", documentGlobal, initialGlobalData }: InlinePreviewOptions) {
  const embedded = window.parent !== window || Boolean(window.opener);
  if (!embedded) return;

  let resolvedServerURL = serverURL;
  try {
    if (document.referrer) resolvedServerURL = new URL(document.referrer).origin;
  } catch {
    resolvedServerURL = serverURL;
  }

  // Fixed UI chrome, not CMS content: tells the editor when edits stop working.
  const showPreviewError = (message: string) => {
    let bar = document.querySelector<HTMLElement>("[data-preview-error]");
    if (!bar) {
      bar = document.createElement("div");
      bar.dataset.previewError = "";
      bar.setAttribute("role", "alert");
      Object.assign(bar.style, { position: "fixed", inset: "0 0 auto 0", zIndex: "2147483647", padding: "12px 16px", background: "#b00020", color: "#fff", font: "600 14px/1.4 system-ui" });
      document.body.prepend(bar);
    }
    bar.textContent = message;
  };
  const EXPIRED = "Your CMS session has expired. The preview is no longer updating. Reload it in the CMS.";
  const isAuthFailure = (status: number) => status === 401 || status === 403;

  // The editor's token, handed over by the CMS admin (InlinePreviewBridge).
  // This page is on another domain, so the CMS session cookie is never sent;
  // every CMS call authenticates with this header instead. Only accepted from
  // the parent window at the CMS origin, and kept in memory only.
  let token: string | undefined;
  let gotFirstToken!: () => void;
  const firstToken = new Promise<void>((resolve) => (gotFirstToken = resolve));
  const authHeaders = async () => {
    await firstToken;
    return { Authorization: `JWT ${token}` };
  };
  const handleAuth = (event: MessageEvent<{ type?: string; token?: string }>) => {
    const parentWindow = window.parent !== window ? window.parent : window.opener;
    if (event.source !== parentWindow || event.origin !== resolvedServerURL) return;
    if (event.data?.type !== "payload-preview-auth" || typeof event.data.token !== "string") return;
    token = event.data.token;
    gotFirstToken();
  };
  window.addEventListener("message", handleAuth);
  // mergeData's default request handler relies on the cookie; send the header instead.
  const requestHandler: CollectionPopulationRequestHandler = async ({ apiPath, data, endpoint, serverURL: base }) => {
    const res = await fetch(`${base}${apiPath}/${endpoint}`, {
      method: "POST",
      headers: { ...(await authHeaders()), "Content-Type": "application/json", "X-Payload-HTTP-Method-Override": "GET" },
      body: JSON.stringify(data),
    });
    if (isAuthFailure(res.status)) showPreviewError(EXPIRED);
    return res;
  };

  let liveData: SiteGlobals | Page = initialData;
  let globalData = initialGlobalData;
  const editTimers = new Map<string, number>();
  // Sections belong to the page; components resolve against the site global's data.
  const globalFor = (path: string) => (path.startsWith("sections.") ? liveData : globalData ?? liveData);
  // Component-owned edit paths are authored as
  // components.N.component.M.<field> (N = curation row, M = section index in
  // the resolved document). The depth-resolved global data stores the
  // document's sections at components.N.component.sections.M, so the path is
  // rewritten to match the data for reads and saves.
  const unwrapComponentPath = (path: string) => path.replace(/^components\.(\d+)\.component\.(\d+)\./, "components.$1.component.sections.$2.");
  // Service entries' sections may hold {field} placeholders, filled from the entry.
  const getLiveValue = (path: string) => {
    const value = getPath(globalFor(path), unwrapComponentPath(path));
    return typeof value === "string" && path.startsWith("sections.") ? resolveTokens(value, liveData as Record<string, unknown>) : value;
  };

  const patchDOM = () => {
    document.querySelectorAll<HTMLElement>("[data-inline-edit]").forEach((el) => {
      if (el === document.activeElement) return;
      const path = el.dataset.inlineEdit!;
      const value = getLiveValue(path);
      if (typeof value === "string" && el.textContent !== value) el.textContent = value;
    });

    document.querySelectorAll<HTMLElement>("[data-inline-image]").forEach((el) => {
      const value = getLiveValue(`${el.dataset.inlineImage}.url`);
      if (typeof value !== "string") return;
      const url = new URL(value, resolvedServerURL).toString();
      if (el instanceof HTMLImageElement) {
        if (el.src !== url) el.src = url;
      } else {
        el.style.backgroundImage = `url(${url})`;
      }
    });

    document.querySelectorAll<HTMLElement>("[data-live-sync-bg]").forEach((el) => {
      const value = getLiveValue(el.dataset.liveSyncBg!);
      // Payload returns media `url` relative to its own origin — must not
      // resolve against this page's origin (same bug class as the
      // server-side fetch in lib/payload.ts, here on the client instead).
      if (typeof value === "string") {
        el.style.backgroundImage = `url(${new URL(value, resolvedServerURL)})`;
      }
    });

    document.querySelectorAll<HTMLImageElement>("[data-live-sync-src]").forEach((el) => {
      const value = getLiveValue(el.dataset.liveSyncSrc!);
      if (typeof value === "string") {
        el.src = new URL(value, resolvedServerURL).toString();
      }
    });

    document.querySelectorAll<HTMLElement>("[data-live-sync-alt]").forEach((el) => {
      const value = getLiveValue(el.dataset.liveSyncAlt!);
      if (typeof value === "string") {
        if (el instanceof HTMLImageElement) el.alt = value;
        else el.setAttribute("aria-label", value);
      }
    });

    document.querySelectorAll<HTMLAnchorElement>("[data-live-sync-href]").forEach((el) => {
      const value = getLiveValue(el.dataset.liveSyncHref!);
      if (typeof value === "string") el.href = value;
    });
  };

  // @payloadcms/live-preview's subscribe()/handleMessage() share ONE
  // module-level cache (_payloadLivePreview.previousData) across every
  // subscribe() call on the page, and each subscribe() call resets it. Two
  // simultaneous subscriptions here (page + global) clobbered each other's
  // cache, so a page-edit broadcast could get merged against stale global
  // data with no `.id`.
  // Fixed by driving the merge manually with the package's stateless pieces
  // (isLivePreviewEvent, mergeData) against our own two local caches
  // (liveData, globalData) instead of the package's shared one.
  const handleLivePreviewData = async (event: MessageEvent) => {
    if (!isLivePreviewEvent(event, resolvedServerURL)) return;
    const { collectionSlug, globalSlug: incomingGlobalSlug, data } = event.data as {
      collectionSlug?: string;
      globalSlug?: string;
      data?: Partial<SiteGlobals | Page>;
    };
    if (!data) return;

    if (collection !== "globals" && collectionSlug === collection) {
      liveData = await mergeData({ serverURL: resolvedServerURL, collectionSlug, depth: 1, incomingData: data, initialData: liveData, locale, requestHandler });
      patchDOM();
    }

    if (documentGlobal && incomingGlobalSlug === documentGlobal) {
      liveData = await mergeData({ serverURL: resolvedServerURL, globalSlug: incomingGlobalSlug, depth: 1, incomingData: data, initialData: liveData, locale, requestHandler });
      patchDOM();
    }

    if (globalData && incomingGlobalSlug === globalSlug) {
      globalData = await mergeData({ serverURL: resolvedServerURL, globalSlug: incomingGlobalSlug, depth: 1, incomingData: data as Partial<SiteGlobals>, initialData: globalData, locale, requestHandler });
      patchDOM();
    }
  };

  window.addEventListener("message", handleLivePreviewData);

  const handlePayloadPreview = (event: MessageEvent<{ type?: string; collectionSlug?: string; data?: SiteGlobals | Page; globalSlug?: string }>) => {
    const parentWindow = window.parent !== window ? window.parent : window.opener;
    if (event.source !== parentWindow || event.data?.type !== "payload-live-preview" || !event.data.data) return;
    if (collection !== "globals" && event.data.collectionSlug === collection) {
      liveData = event.data.data;
      patchDOM();
    }
    if (documentGlobal && event.data.globalSlug === documentGlobal) {
      liveData = event.data.data;
      patchDOM();
    }
    if (collection === "globals" && event.data.globalSlug === globalSlug) {
      liveData = event.data.data;
      patchDOM();
    }
  };
  window.addEventListener("message", handlePayloadPreview);

  // Only fields of the page open in the admin are editable, and an edit goes
  // into that page's admin form. Navbar/footer text belongs to other documents
  // (global components) and is edited by opening those.
  const isPageField = (path: string) => (collection !== "globals" || Boolean(documentGlobal)) && path.startsWith("sections.");
  const sendToForm = (path: string, value: string) => {
    const parentWindow = window.parent !== window ? window.parent : window.opener;
    parentWindow?.postMessage({ type: "payload-inline-edit", path, value }, resolvedServerURL);
  };

  document.querySelectorAll<HTMLElement>("[data-inline-edit]").forEach((el) => {
    if (!isPageField(el.dataset.inlineEdit!)) return;
    el.contentEditable = "true";
    el.spellcheck = true;
  });

  document.querySelectorAll<HTMLElement>("[data-inline-image]").forEach((el) => {
    if (!isPageField(el.dataset.inlineImage!)) return;
    el.style.cursor = "pointer";
    el.title = "Click to change image";
  });

  // A click on a page image (not on text or a link inside it) opens the CMS
  // media picker for that image field.
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-inline-edit], a, button")) return;
    const image = target.closest<HTMLElement>("[data-inline-image]");
    const path = image?.dataset.inlineImage;
    if (!path || !isPageField(path)) return;
    event.preventDefault();
    const parentWindow = window.parent !== window ? window.parent : window.opener;
    parentWindow?.postMessage({ type: "payload-inline-image", path }, resolvedServerURL);
  });

  // Editable spans can sit inside <a> — without this, clicking to place a
  // cursor navigates away instead.
  document.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-inline-edit]");
    if (target?.isContentEditable) event.preventDefault();
  });

  document.addEventListener("input", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-inline-edit]");
    if (!target?.isContentEditable) return;
    const path = target.dataset.inlineEdit!;

    const existing = editTimers.get(path);
    if (existing) window.clearTimeout(existing);

    const timer = window.setTimeout(() => {
      editTimers.delete(path);
      sendToForm(path, target.textContent ?? "");
    }, 500);
    editTimers.set(path, timer);
  });

  ready({ serverURL: resolvedServerURL });

  return () => {
    window.removeEventListener("message", handleAuth);
    window.removeEventListener("message", handleLivePreviewData);
    window.removeEventListener("message", handlePayloadPreview);
  };
}
