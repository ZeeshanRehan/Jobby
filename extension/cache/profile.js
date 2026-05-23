// ─── Profile Cache ────────────────────────────────────────────────────────────
const PROFILE_KEY = "jobby_profile";

async function refreshProfile() {
  const res = await fetch(`${API_BASE}/profile`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  const data = await res.json();
  await chrome.storage.local.set({ [PROFILE_KEY]: { ...data, fetchedAt: Date.now() } });
  return data;
}

async function getProfile() {
  const stored = await chrome.storage.local.get(PROFILE_KEY);
  if (stored[PROFILE_KEY]) return stored[PROFILE_KEY];
  return refreshProfile();
}




async function checkVersion() {
  const stored = await chrome.storage.local.get(PROFILE_KEY);
  const cached = stored[PROFILE_KEY];
  if (!cached) {
    await refreshProfile();
    return;
  }
  const res = await fetch(`${API_BASE}/profile/version`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) return;
  const { version } = await res.json();
  if (version !== cached.version) await refreshProfile();
}
