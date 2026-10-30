/*
 * Imported by the generated service worker (astro.config.mjs →
 * workbox.importScripts).
 *
 * Until 2026-08-27 this site's worker answered every navigation under "/"
 * with the homepage (vite-plugin-pwa's default navigateFallback). Sibling
 * apps served from the same domain, such as the game guides or watchboard,
 * showed this homepage instead of themselves. The current worker no longer
 * does that, but a tab the old worker already answered keeps showing the
 * homepage until the visitor reloads it by hand.
 *
 * When a new worker activates, reload every open tab whose top-level folder
 * has nothing in this site's precache: those pages belong to another app,
 * and the reload fetches them from the network.
 */
const PRECACHE_PREFIX = "workbox-precache";

const topFolder = (url) => new URL(url).pathname.split("/")[1];

async function ownFolders() {
  const names = (await caches.keys()).filter((n) => n.startsWith(PRECACHE_PREFIX));
  const folders = new Set();
  for (const name of names) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) folders.add(topFolder(request.url));
  }
  return folders;
}

async function reloadForeignTabs() {
  await self.clients.claim();
  const own = await ownFolders();
  const tabs = await self.clients.matchAll({ type: "window" });
  for (const tab of tabs) {
    const folder = topFolder(tab.url);
    if (folder && !own.has(folder)) tab.navigate(tab.url).catch(() => {});
  }
}

self.addEventListener("activate", (event) => event.waitUntil(reloadForeignTabs()));
