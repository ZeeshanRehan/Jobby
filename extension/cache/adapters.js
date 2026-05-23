// ─── Adapters Cache ───────────────────────────────────────────────────────────
const ADAPTERS_KEY = "jobby_adapters";

async function refreshAdapters() {
  const res = await fetch(`${API_BASE}/adapters/list`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) throw new Error(`Adapters fetch failed: ${res.status}`);
  const list = await res.json();
  await chrome.storage.local.set({ [ADAPTERS_KEY]: { list, fetchedAt: Date.now() } });
  return list;
}

async function getAdapters() {
  const stored = await chrome.storage.local.get(ADAPTERS_KEY);
  if (stored[ADAPTERS_KEY]) return stored[ADAPTERS_KEY].list;
  return refreshAdapters();
}

// Reads cached adapters and returns the matching entry for a given URL
async function findAdapterForUrl(url) {
  const stored = await chrome.storage.local.get(ADAPTERS_KEY);
  const cached = stored[ADAPTERS_KEY];
  if (!cached) return null;
  return cached.list.find((a) => a.detect.some((pattern) => url.includes(pattern))) || null;
}

async function checkAdapterVersions() {
  const stored = await chrome.storage.local.get(ADAPTERS_KEY);
  const cached = stored[ADAPTERS_KEY];
  if (!cached) {
    await refreshAdapters();
    return;
  }
  const res = await fetch(`${API_BASE}/adapters/list`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) return;
  const freshList = await res.json();
  const cachedVersionMap = Object.fromEntries(cached.list.map((a) => [a.platform, a.version]));
  const hasChange =
    freshList.length !== cached.list.length ||
    freshList.some((a) => cachedVersionMap[a.platform] !== a.version);
  if (hasChange) {
    await chrome.storage.local.set({ [ADAPTERS_KEY]: { list: freshList, fetchedAt: Date.now() } });
  }
}
