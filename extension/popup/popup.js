const statusEl = document.getElementById("status");
const syncBtn = document.getElementById("sync-btn");

async function render() {
  const result = await browser.storage.local.get("lastModified");
  const lastModified = result.lastModified;

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

render();
