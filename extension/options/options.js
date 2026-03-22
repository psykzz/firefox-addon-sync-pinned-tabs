const DEFAULT_SERVER_BASE = "https://firefox.neeko.psykzz.com";

const serverUrlInput = document.getElementById("server-url");
const saveBtn = document.getElementById("save-btn");
const saveStatus = document.getElementById("save-status");
const activeServer = document.getElementById("active-server");

async function loadSettings() {
  const result = await browser.storage.local.get("serverBase");
  serverUrlInput.value = result.serverBase || "";
  activeServer.textContent = result.serverBase || DEFAULT_SERVER_BASE;
}

saveBtn.addEventListener("click", async () => {
  const raw = serverUrlInput.value.trim();

  // Remove trailing slash before validation so URLs like "https://example.com/"
  // and "https://example.com" are treated identically.
  const value = raw.replace(/\/$/, "");

  // Validate: must be a valid http/https URL or empty (use default)
  if (value !== "") {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        saveStatus.textContent = "URL must use http or https.";
        return;
      }
    } catch {
      saveStatus.textContent = "Please enter a valid URL.";
      return;
    }
    await browser.storage.local.set({ serverBase: value });
    activeServer.textContent = value;
  } else {
    await browser.storage.local.remove("serverBase");
    activeServer.textContent = DEFAULT_SERVER_BASE;
  }

  saveStatus.textContent = "Saved!";
  setTimeout(() => {
    saveStatus.textContent = "";
  }, 2000);
});

loadSettings();
