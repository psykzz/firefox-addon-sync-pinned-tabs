/**
 * Sync Pinned Tabs - Background Script
 *
 * On install / browser start:
 *   1. Load the stored identity (userId) and last-sync timestamp.
 *   2. If no userId, register with the server to get one.
 *   3. Fetch the remote tab-list and compare last-modified dates.
 *   4. Apply whichever side (local or remote) is newer.
 *
 * A periodic alarm re-runs the sync every SYNC_INTERVAL_MINUTES minutes.
 */

const SERVER_BASE = "https://sync-pinned-tabs.example.com";
const SYNC_INTERVAL_MINUTES = 15;

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Persist a key/value pair in extension storage.
 * @param {string} key
 * @param {*} value
 */
async function store(key, value) {
  await browser.storage.local.set({ [key]: value });
}

/**
 * Read a value from extension storage.
 * @param {string} key
 * @returns {Promise<*>}
 */
async function load(key) {
  const result = await browser.storage.local.get(key);
  return result[key];
}

/**
 * Return the pinned tabs in every open window as a plain array of objects.
 * @returns {Promise<Array<{url: string, title: string}>>}
 */
async function getLocalPinnedTabs() {
  const tabs = await browser.tabs.query({ pinned: true });
  return tabs.map((t) => ({ url: t.url, title: t.title || "" }));
}

/**
 * Replace the currently-pinned tabs with the supplied list.
 * We open each URL in a new pinned tab, then close the ones that were already
 * pinned but are no longer in the list.
 *
 * @param {Array<{url: string, title: string}>} remoteTabs
 */
async function applyRemoteTabs(remoteTabs) {
  const currentPinned = await browser.tabs.query({ pinned: true });
  const currentUrls = new Set(currentPinned.map((t) => t.url));
  const remoteUrls = new Set(remoteTabs.map((t) => t.url));

  // Open tabs that are remote but not local
  for (const tab of remoteTabs) {
    if (!currentUrls.has(tab.url)) {
      await browser.tabs.create({ url: tab.url, pinned: true, active: false });
    }
  }

  // Close tabs that are local but not remote
  const toClose = currentPinned
    .filter((t) => !remoteUrls.has(t.url))
    .map((t) => t.id);
  if (toClose.length > 0) {
    await browser.tabs.remove(toClose);
  }
}

// ── server communication ──────────────────────────────────────────────────────

/**
 * Register a new profile on the server.
 * @returns {Promise<string>} The assigned profile ID.
 */
async function registerProfile() {
  const response = await fetch(`${SERVER_BASE}/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`Failed to register profile: ${response.status}`);
  }
  const data = await response.json();
  return data.id;
}

/**
 * Fetch the remote pinned-tab list for a profile.
 * @param {string} profileId
 * @returns {Promise<{tabs: Array<{url: string, title: string}>, last_modified: string|null}>}
 */
async function fetchRemoteTabs(profileId) {
  const response = await fetch(`${SERVER_BASE}/profiles/${profileId}/tabs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch remote tabs: ${response.status}`);
  }
  return response.json();
}

/**
 * Push the local pinned-tab list to the server.
 * @param {string} profileId
 * @param {Array<{url: string, title: string}>} tabs
 * @param {string} lastModified  ISO-8601 timestamp of the local last-modified time.
 */
async function pushTabs(profileId, tabs, lastModified) {
  const response = await fetch(`${SERVER_BASE}/profiles/${profileId}/tabs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabs, last_modified: lastModified }),
  });
  if (!response.ok) {
    throw new Error(`Failed to push tabs: ${response.status}`);
  }
}

// ── sync logic ────────────────────────────────────────────────────────────────

/**
 * Perform a full sync cycle:
 *   • Register if needed.
 *   • Compare local vs remote last-modified.
 *   • Apply the newer side.
 */
async function sync() {
  let profileId = await load("profileId");

  // ── 1. Register if this is the first run ──
  if (!profileId) {
    try {
      profileId = await registerProfile();
      await store("profileId", profileId);
      console.log("Sync Pinned Tabs: registered new profile", profileId);
    } catch (err) {
      console.error("Sync Pinned Tabs: registration failed", err);
      return;
    }
  }

  // ── 2. Fetch remote state ──
  let remote;
  try {
    remote = await fetchRemoteTabs(profileId);
  } catch (err) {
    console.error("Sync Pinned Tabs: fetch failed", err);
    return;
  }

  // ── 3. Compare timestamps ──
  const localLastModified = (await load("lastModified")) || null;
  const remoteLastModified = remote.last_modified || null;

  const localIsNewer =
    !remoteLastModified ||
    (localLastModified &&
      new Date(localLastModified) > new Date(remoteLastModified));

  if (localIsNewer) {
    // Push local tabs to server
    try {
      const localTabs = await getLocalPinnedTabs();
      const now = new Date().toISOString();
      await pushTabs(profileId, localTabs, now);
      await store("lastModified", now);
      console.log("Sync Pinned Tabs: pushed local tabs to server");
    } catch (err) {
      console.error("Sync Pinned Tabs: push failed", err);
    }
  } else {
    // Apply remote tabs locally
    try {
      await applyRemoteTabs(remote.tabs || []);
      await store("lastModified", remoteLastModified);
      console.log("Sync Pinned Tabs: applied remote tabs");
    } catch (err) {
      console.error("Sync Pinned Tabs: apply failed", err);
    }
  }
}

// ── event listeners ───────────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(async () => {
  await sync();
  browser.alarms.create("syncPinnedTabs", {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });
});

browser.runtime.onStartup.addListener(async () => {
  await sync();
  // Recreate the alarm in case it was cleared.
  browser.alarms.create("syncPinnedTabs", {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "syncPinnedTabs") {
    sync();
  }
});

// Re-sync whenever a tab is pinned or unpinned.
browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if ("pinned" in changeInfo) {
    sync();
  }
});

// Allow the popup to trigger a manual sync.
browser.runtime.onMessage.addListener((message) => {
  if (message && message.action === "sync") {
    return sync();
  }
});
