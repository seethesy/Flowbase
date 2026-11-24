import { useEffect, useState } from "react";

// A menu PDF's cover (FLOW-301 AC1): page 1 drawn as an image, and the page
// count. pdf.js loads only when a Menus card first needs it, so it stays out of
// the first load; the file is read from its signed download URL.
export type MenuCover = { image: string; pages: number };

// One render per document version (its URL is signed, so it changes each load).
const covers = new Map<string, Promise<MenuCover>>();
const coverWidth = 320;

async function renderCover(url: string): Promise<MenuCover> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const pdf = await pdfjs.getDocument({ url }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: coverWidth / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available.");
    await page.render({ canvasContext: context, viewport }).promise;
    return { image: canvas.toDataURL("image/png"), pages: pdf.numPages };
  } finally {
    void pdf.destroy();
  }
}

export function menuCover(versionId: string, url: string): Promise<MenuCover> {
  let cover = covers.get(versionId);
  if (!cover) {
    cover = renderCover(url);
    // A failed render (a missing file, no network) is tried again next time.
    cover.catch(() => covers.delete(versionId));
    covers.set(versionId, cover);
  }
  return cover;
}

// The cover of the version, or null while it renders or if it can't be read; the
// card keeps its drawn cover then.
export function useMenuCover(version: { id: string; url: string | null } | undefined): MenuCover | null {
  const [cover, setCover] = useState<MenuCover | null>(null);
  const id = version?.id;
  const url = version?.url ?? null;
  useEffect(() => {
    setCover(null);
    if (!id || !url) return;
    let current = true;
    menuCover(id, url).then((next) => { if (current) setCover(next); }, () => {});
    return () => { current = false; };
  }, [id, url]);
  return cover;
}
