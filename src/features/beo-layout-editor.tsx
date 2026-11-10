import { useEffect, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { ANNOTATED_GROUP, type BeoArea, type BeoView } from "../../shared/beo";
import { Button } from "../components/shared";
import { attachmentsApi, uploadAttachment } from "../services/attachments";
import { beoApi } from "../services/beo";

// The layout annotation screen (FLOW-147, ADR-20). Excalidraw (MIT) loads only
// here, through React.lazy in beo-areas.tsx, so it stays out of the main bundle
// (AC3). The area's uploaded plan is the background; the annotations are saved as
// a JSON scene (elements only: the plan itself is re-read from its attachment),
// and a rendered PNG is uploaded to the area, which is what the BEO and print show.

const PLAN_FILE_ID = "layout-plan";

// The few members of Excalidraw's imperative API this screen uses.
type Api = {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
};

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The plan couldn't be read."));
    reader.readAsDataURL(blob);
  });

const sizeOf = (url: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("The plan couldn't be opened."));
    image.src = url;
  });

type Loaded = {
  elements: unknown[];
  files: Record<string, unknown>;
};

export default function LayoutEditor({
  eventId,
  area,
  onSaved,
  onClose,
}: {
  eventId: string;
  area: BeoArea;
  onSaved: (view: BeoView) => void;
  onClose: () => void;
}) {
  const api = useRef<Api | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const list = await attachmentsApi.list("beo_area", area.id);
      const plan = list.find((file) => file.group === "image" && file.kind === "photo");
      if (!plan?.urls.display) throw new Error("Add an image of this area first, then annotate it.");
      const dataURL = await asDataUrl(await (await fetch(plan.urls.display)).blob());
      const files = {
        [PLAN_FILE_ID]: { id: PLAN_FILE_ID, mimeType: "image/jpeg", dataURL, created: Date.now() },
      };
      const saved = area.hasScene ? (await beoApi.scene(eventId, area.id)).scene : null;
      const savedElements = saved && Array.isArray(saved.elements) ? (saved.elements as unknown[]) : null;
      if (savedElements) return { elements: savedElements, files };
      const { width, height } = await sizeOf(dataURL);
      // Fit the plan into a 1200-wide canvas.
      const scale = Math.min(1, 1200 / width);
      const elements = convertToExcalidrawElements([
        {
          type: "image",
          x: 0,
          y: 0,
          width: width * scale,
          height: height * scale,
          fileId: PLAN_FILE_ID,
          status: "saved",
        } as never,
      ]) as unknown[];
      return { elements, files };
    })().then(
      (result) => live && setLoaded(result),
      (e: unknown) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [area.id, area.hasScene, eventId]);

  const save = async () => {
    const current = api.current;
    if (!current) return;
    setError("");
    setSaving(true);
    try {
      const elements = current.getSceneElements();
      const blob = await exportToBlob({
        elements: elements as never,
        appState: { ...current.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" } as never,
        files: current.getFiles() as never,
        mimeType: "image/png",
      });
      const before = (await attachmentsApi.list("beo_area", area.id)).filter((file) => file.group === ANNOTATED_GROUP);
      await uploadAttachment(new File([blob], `${area.name} layout.png`, { type: "image/png" }), {
        recordType: "beo_area",
        recordId: area.id,
        group: ANNOTATED_GROUP,
      });
      const view = await beoApi.saveScene(eventId, area.id, { elements: elements as unknown[] });
      // The new PNG is in place; only now drop the previous ones.
      await Promise.all(before.map((file) => attachmentsApi.archive(file.id)));
      onSaved(view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="beo-layout-editor" role="dialog" aria-label={`Annotate ${area.name}`}>
      <div className="page-actions">
        <strong>Annotate {area.name}</strong>
        <Button onClick={() => void save()} disabled={!loaded || saving}>
          {saving ? "Saving…" : "Save annotation"}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {loaded ? (
        <div className="beo-excalidraw">
          <Excalidraw
            initialData={
              {
                elements: loaded.elements,
                files: loaded.files,
                appState: { viewBackgroundColor: "#ffffff" },
                scrollToContent: true,
              } as never
            }
            excalidrawAPI={(instance) => {
              api.current = instance as unknown as Api;
            }}
          />
        </div>
      ) : (
        !error && <p className="muted">Loading the plan…</p>
      )}
    </div>
  );
}
