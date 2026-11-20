// Same job as the "Save to Stash" bookmark button, for browsers with no bookmarks bar (Arc).
// It reads the page only when the button or shortcut is pressed, and sends nothing anywhere but Stash.
const STASH = "https://stash-gamma-jet.vercel.app";

// Stash saves without asking only when the request carries the owner's private share key.
// The extension learns that key from Stash itself the first time it is used, and keeps it on this computer.
async function learnKey(tabId) {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.documentElement.dataset.sk || "" });
      if (r?.result) { await chrome.storage.local.set({ key: r.result }); return; }
    } catch {
      return; // the tab was closed or moved elsewhere
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  let d = { u: tab.url || "", s: "", i: "", t: tab.title || "" };
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        u: location.href,
        s: String(getSelection()).trim().slice(0, 4000),
        i: document.querySelector('meta[property="og:image"]')?.content || document.querySelector("video[poster]")?.poster || "",
        t: document.title.slice(0, 200),
      }),
    });
    if (r?.result) d = r.result;
  } catch {
    // Some pages do not allow reading. The address alone is still saved.
  }
  if (!/^https?:/.test(d.u)) return;
  const { key } = await chrome.storage.local.get("key");
  const e = encodeURIComponent;
  const url = `${STASH}/#${key ? "k=" + e(key) + "&" : ""}save=${e(d.u)}${d.i ? "&img=" + e(d.i) : ""}${d.s ? "&q=" + e(d.s) + "&t=" + e(d.t) : ""}`;
  const made = await chrome.tabs.create({ url, index: tab.index + 1 });
  if (!key && made.id) learnKey(made.id);
});
