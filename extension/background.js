/**
 * Sync Pinned Tabs - Background Script
 *
 * Uses browser.storage.sync to keep pinned tabs in sync across devices
 * (including Firefox for Android – no browser.windows dependency).
 *
 * On install / browser start:
 *   1. If sync storage already has pinned tabs, apply them locally.
 *   2. Otherwise, push the current local pinned tabs to sync storage.
 *
 * Changes are propagated reactively via browser.storage.onChanged, so no
 * polling alarm is required.
 */

// How long (ms) to keep isSyncing=true after the last tab operation fires,
// so that the resulting onUpdated/onRemoved events are still in-flight
// when we clear the flag and do not re-trigger a redundant push.
const SYNC_SETTLE_MS = 200;

// Guard: set to true while applying a remote change so that the resulting
// tab events don't immediately overwrite sync storage with an intermediate state.
let isSyncing = false;

// IDs of tabs we know to be pinned, kept in sync with onUpdated/onRemoved.
// Used to skip onRemoved events for non-pinned tabs.
const pinnedTabIds = new Set();

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the URLs of all pinned tabs across every open window, de-duplicated.
 * Uses browser.tabs.query so it works on Firefox for Android (no windows API).
 * @returns {Promise<string[]>}
 */
async function getLocalPinnedUrls() {
  const tabs = await browser.tabs.query({ pinned: true });
  const seen = new Set();
  const urls = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) {
      seen.add(tab.url);
      urls.push(tab.url);
    }
  }
  return urls;
}

/**
 * Open missing pinned tabs and close extra ones to match the supplied URL list.
 * Sets isSyncing=true for the duration so that the resulting tab events do not
 * trigger a redundant push back to sync storage.
 * Returns immediately (without touching isSyncing) when no changes are needed.
 *
 * @param {string[]} urls
 */
async function applyPinnedUrls(urls) {
  const currentPinned = await browser.tabs.query({ pinned: true });
  const currentUrls = new Set(currentPinned.map((t) => t.url));
  const targetUrls = new Set(urls);

  const toAdd = urls.filter((url) => !currentUrls.has(url));
  const toClose = currentPinned
    .filter((t) => !targetUrls.has(t.url))
    .map((t) => t.id);

  // Nothing to do – return without touching isSyncing so tab events still fire.
  if (toAdd.length === 0 && toClose.length === 0) return;

  isSyncing = true;
  try {
    await Promise.all(
      toAdd.map((url) => browser.tabs.create({ url, pinned: true, active: false }))
    );
    if (toClose.length > 0) {
      await browser.tabs.remove(toClose);
    }
  } finally {
    setTimeout(() => {
      isSyncing = false;
    }, SYNC_SETTLE_MS);
  }
}

// ── sync logic ────────────────────────────────────────────────────────────────

/**
 * Push the current local pinned tabs to sync storage.
 * Skipped while a remote sync is being applied (isSyncing guard).
 */
async function pushLocalToSync() {
  if (isSyncing) return;
  const urls = await getLocalPinnedUrls();
  await browser.storage.sync.set({ pinnedTabs: urls });
  await browser.storage.local.set({ lastModified: new Date().toISOString() });
  console.log("Sync Pinned Tabs: saved", urls.length, "tab(s) to sync storage");
}

/**
 * Initialise on install/startup:
 *   • If sync storage has tabs, apply them locally.
 *   • Otherwise, push the local state so other devices can pick it up.
 */
async function init() {
  // Seed pinnedTabIds from the current browser state.
  const currentPinned = await browser.tabs.query({ pinned: true });
  currentPinned.forEach((t) => pinnedTabIds.add(t.id));

  const data = await browser.storage.sync.get("pinnedTabs");
  const syncedUrls = data.pinnedTabs;

  if (Array.isArray(syncedUrls) && syncedUrls.length > 0) {
    console.log(
      "Sync Pinned Tabs: found",
      syncedUrls.length,
      "tab(s) in sync storage, applying locally"
    );
    await applyPinnedUrls(syncedUrls);
    await browser.storage.local.set({ lastModified: new Date().toISOString() });
  } else {
    console.log(
      "Sync Pinned Tabs: no synced tabs found, uploading local state"
    );
    await pushLocalToSync();
  }
}

// ── event listeners ───────────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(init);
browser.runtime.onStartup.addListener(init);

// React to changes pushed by another device via Firefox Sync.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.pinnedTabs) return;
  const newUrls = changes.pinnedTabs.newValue || [];
  console.log(
    "Sync Pinned Tabs: remote change detected, applying",
    newUrls.length,
    "tab(s)"
  );
  applyPinnedUrls(newUrls).then(() => {
    return browser.storage.local.set({ lastModified: new Date().toISOString() });
  });
});

// Keep pinnedTabIds up to date and push to sync whenever pinned state changes.
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!("pinned" in changeInfo)) return;
  if (changeInfo.pinned) {
    pinnedTabIds.add(tabId);
  } else {
    pinnedTabIds.delete(tabId);
  }
  pushLocalToSync();
});

// Save when a pinned tab is closed directly (without unpinning first).
// Skip the push for non-pinned tabs to avoid unnecessary sync operations.
browser.tabs.onRemoved.addListener((tabId) => {
  if (!pinnedTabIds.has(tabId)) return;
  pinnedTabIds.delete(tabId);
  // Slight delay to ensure the tab is no longer returned by browser.tabs.query.
  setTimeout(pushLocalToSync, 50);
});

// Allow the popup to trigger a manual sync.
browser.runtime.onMessage.addListener((message) => {
  if (message && message.action === "sync") {
    return init();
  }
});

