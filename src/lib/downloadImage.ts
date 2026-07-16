import { toPng } from "html-to-image";

function sanitizeFilename(name: string): string {
  return name.trim().replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "-").slice(0, 60) || "board";
}

// Third-party image CDNs we embed (AniList, RAWG, anyone's pasted URL) mostly
// don't send CORS headers, so drawing them into a canvas taints it and the
// final toDataURL() throws — html-to-image reports this as a bare Event, not
// a helpful error. Route those images through our own same-origin proxy just
// for the snapshot (swap src, capture, restore) so the browser never sees
// them as cross-origin in the first place.
async function withProxiedImages<T>(root: HTMLElement, fn: () => Promise<T>): Promise<T> {
  const imgs = [...root.querySelectorAll("img")].filter((img) => {
    try {
      return new URL(img.src, location.href).origin !== location.origin;
    } catch {
      return false;
    }
  });
  const originalSrcs = imgs.map((img) => img.src);
  imgs.forEach((img) => {
    img.src = `/api/img?u=${encodeURIComponent(img.src)}`;
  });
  try {
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
      )
    );
    return await fn();
  } finally {
    imgs.forEach((img, i) => {
      img.src = originalSrcs[i];
    });
  }
}

export async function downloadElementAsImage(el: HTMLElement, roomName: string) {
  const work = withProxiedImages(el, () => toPng(el, {
    backgroundColor: getComputedStyle(document.body).getPropertyValue("--bg") || "#0d0e12",
    pixelRatio: 2,
    // Google Fonts sends Access-Control-Allow-Origin: * on its CSS response,
    // but the browser only honors that for reading cssRules if the <link> tag
    // itself was loaded with crossorigin="anonymous" (see index.html) — without
    // it, html-to-image's @font-face embedding hit a SecurityError and hung
    // instead of failing cleanly. With crossorigin set, real font embedding
    // works and the exported image matches the site's actual fonts.
    filter: (node) => {
      // skip ephemeral overlays (remote cursors/drag ghosts) — they're not part of the "result"
      if (node instanceof HTMLElement) {
        return !node.classList?.contains("cursor") && !node.classList?.contains("ghost--remote") && !node.classList?.contains("no-export");
      }
      return true;
    },
  }));
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timed out generating the image")), 15000)
  );
  const dataUrl = await Promise.race([work, timeout]);
  const link = document.createElement("a");
  link.download = `${sanitizeFilename(roomName)}-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = dataUrl;
  link.click();
}
