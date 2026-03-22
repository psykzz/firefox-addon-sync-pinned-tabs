const profileIdEl = document.getElementById("profile-id");
const statusEl = document.getElementById("status");
const syncBtn = document.getElementById("sync-btn");
const settingsLink = document.getElementById("settings-link");

async function load(key) {
  const result = await browser.storage.local.get(key);
  return result[key];
}

async function render() {
  const profileId = await load("profileId");
  const lastModified = await load("lastModified");

  if (profileId) {
    profileIdEl.textContent = `Profile ID: ${profileId}`;
  } else {
    profileIdEl.textContent = "No profile yet – sync to register.";
  }

  if (lastModified) {
    statusEl.textContent = `Last synced: ${new Date(lastModified).toLocaleString()}`;
  } else {
    statusEl.textContent = "Not yet synced.";
  }
}

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  statusEl.textContent = "Syncing…";
  try {
    // Trigger sync in the background script and wait for it.
    await browser.runtime.sendMessage({ action: "sync" });
    await render();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    syncBtn.disabled = false;
  }
});

settingsLink.addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

render();
