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
  // A page that offers no picture of its own: take one of what is on screen now, so the save is not left bare.
  // This is the browser the owner is looking at, so it works where a site turns Stash's server away.
  let shot = "";
  if (!d.i && !d.s) {
    try {
      const full = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
      const bmp = await createImageBitmap(await (await fetch(full)).blob());
      const w = Math.min(1200, bmp.width), h = Math.round((bmp.height * w) / bmp.width);
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d").drawImage(bmp, 0, 0, w, h);
      const small = await c.convertToBlob({ type: "image/jpeg", quality: 0.72 });
      const bytes = new Uint8Array(await small.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      shot = btoa(bin);
    } catch {
      // No picture, then. The save still goes ahead.
    }
  }
  const { key } = await chrome.storage.local.get("key");
  const e = encodeURIComponent;
  const url = `${STASH}/#${key ? "k=" + e(key) + "&" : ""}save=${e(d.u)}${d.i ? "&img=" + e(d.i) : ""}${d.s ? "&q=" + e(d.s) + "&t=" + e(d.t) : ""}${shot ? "&shot=" + e(shot) : ""}`;
  const made = await chrome.tabs.create({ url, index: tab.index + 1 });
  if (!key && made.id) learnKey(made.id);
});
