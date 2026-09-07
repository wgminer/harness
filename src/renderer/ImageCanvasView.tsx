import { useEffect, useRef, useState } from "react";
import {
  ClipboardCopy,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  PenLine,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import {
  IMAGE_BACKGROUND_OPTIONS,
  IMAGE_DEFAULTS,
  IMAGE_OUTPUT_FORMAT_OPTIONS,
  IMAGE_RENDER_MODE_OPTIONS,
  IMAGE_SHAPE_OPTIONS,
  backgroundAllowedForFormat,
  formatImageSize,
  imageRenderModeFromSettings,
  parseImageSize,
  qualityForRenderMode,
  shapeFromSize,
  sizeForShape,
  validateImageSize,
  type ImageRenderMode,
  type ImageShape,
} from "../shared/imageOptions";
import type {
  GeneratedImage,
  ImageBackground,
  ImageOperation,
  ImageOutputFormat,
  ImageSize,
  ImageVersion,
} from "../shared/images";
import {
  displayVersionLabel,
  getDisplayImageTitle,
  imageVersionById,
  isLeafVersion,
  orderedImageVersions,
  parentVersionId,
} from "../shared/images";
import { IMAGE_MARKER_PROMPT_PREFIX, buildMarkerAdjustPrompt } from "../shared/imageMarkerPrompt";

type GenerateStatus =
  | { kind: "idle" }
  | { kind: "loading"; operation: ImageOperation }
  | { kind: "error"; message: string; operation: ImageOperation | null };

type MarkerPoint = { x: number; y: number };
type MarkerStroke = MarkerPoint[];

export interface ImageCanvasViewProps {
  imageId: string | null;
  onImageUpdated: (image: GeneratedImage) => void;
  /** Remove a library entry from parent state (after local delete). */
  onImageRemoved?: (imageId: string) => void;
  /** Fires while generate/adjust is in flight so the sidebar can show a spinner. */
  onImageActivityChange?: (imageId: string, active: boolean) => void;
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : "";
}

async function versionPreviewUrl(
  image: GeneratedImage,
  version: ImageVersion,
): Promise<string | null> {
  if (!version.fileName) return null;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  if (image.absolutePath && version.id === image.activeVersionId) {
    return convertFileSrc(image.absolutePath);
  }
  if (image.absolutePath) {
    return convertFileSrc(`${dirname(image.absolutePath)}/${version.fileName}`);
  }
  return null;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

function promptSnippet(prompt: string, max = 48): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trimEnd()}…`;
}

function stripMarkerPrefix(prompt: string): string {
  if (prompt.startsWith(IMAGE_MARKER_PROMPT_PREFIX)) {
    return prompt.slice(IMAGE_MARKER_PROMPT_PREFIX.length).trim();
  }
  return prompt.trim();
}

function versionHasMarker(version: ImageVersion): boolean {
  return version.prompt.startsWith(IMAGE_MARKER_PROMPT_PREFIX);
}

function isCancelledMessage(message: string): boolean {
  return message.toLowerCase().includes("cancelled");
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function loadingLabel(operation: ImageOperation): string {
  if (operation === "adjust") return "Adjusting…";
  return "Generating…";
}

export function ImageCanvasView({
  imageId,
  onImageUpdated,
  onImageRemoved,
  onImageActivityChange,
}: ImageCanvasViewProps) {
  const [image, setImage] = useState<GeneratedImage | null>(null);
  const [prompt, setPrompt] = useState("");
  const [shape, setShape] = useState<ImageShape>(IMAGE_DEFAULTS.shape);
  const [size, setSize] = useState<ImageSize>(IMAGE_DEFAULTS.size);
  const [customWidth, setCustomWidth] = useState(1280);
  const [customHeight, setCustomHeight] = useState(720);
  const [mode, setMode] = useState<ImageRenderMode>(IMAGE_DEFAULTS.mode);
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>(IMAGE_DEFAULTS.outputFormat);
  const [background, setBackground] = useState<ImageBackground>(IMAGE_DEFAULTS.background);
  const [status, setStatus] = useState<GenerateStatus>({ kind: "idle" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [versionUrls, setVersionUrls] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stubImages, setStubImages] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markerStrokes, setMarkerStrokes] = useState<MarkerStroke[]>([]);
  const [peekParent, setPeekParent] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** Guards against double Enter / click before React re-renders `status`. */
  const generateInFlightRef = useRef(false);
  const markerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageElRef = useRef<HTMLImageElement | null>(null);
  const statusRef = useRef(status);
  const activityIdRef = useRef<string | null>(null);
  const drawingStrokeRef = useRef<MarkerStroke | null>(null);
  const lastOperationRef = useRef<ImageOperation>("new");
  statusRef.current = status;

  useEffect(() => {
    let cancelled = false;
    void window.harness.env.isStubImages().then((on) => {
      if (!cancelled) setStubImages(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (activityIdRef.current) {
        onImageActivityChange?.(activityIdRef.current, false);
        activityIdRef.current = null;
      }
    };
  }, [onImageActivityChange]);

  const setActivity = (id: string | null, active: boolean) => {
    if (activityIdRef.current && activityIdRef.current !== id) {
      onImageActivityChange?.(activityIdRef.current, false);
    }
    activityIdRef.current = active && id ? id : null;
    if (id) onImageActivityChange?.(id, active);
  };

  const applyImageState = (next: GeneratedImage, options?: { clearPrompt?: boolean }) => {
    setImage(next);
    const nextShape = shapeFromSize(next.size);
    setShape(nextShape);
    if (nextShape === "custom") {
      const parsed = parseImageSize(next.size);
      if (parsed) {
        setCustomWidth(parsed.width);
        setCustomHeight(parsed.height);
        setSize(formatImageSize(parsed.width, parsed.height));
      } else {
        setSize(next.size || IMAGE_DEFAULTS.size);
      }
    } else {
      setSize(sizeForShape(nextShape));
    }
    setMode(imageRenderModeFromSettings(next.quality));
    setOutputFormat(next.outputFormat || IMAGE_DEFAULTS.outputFormat);
    setBackground(backgroundAllowedForFormat(next.outputFormat, next.background));
    if (options?.clearPrompt || next.hasFile) {
      setPrompt("");
    } else {
      setPrompt(next.prompt);
    }
  };

  const setPreviewFromImage = async (next: GeneratedImage) => {
    const active = imageVersionById(next, next.activeVersionId);
    if (active) {
      setPreviewUrl(await versionPreviewUrl(next, active));
    } else if (next.absolutePath) {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      setPreviewUrl(convertFileSrc(next.absolutePath));
    } else {
      setPreviewUrl(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (statusRef.current.kind === "loading") return;

      if (!imageId) {
        setImage(null);
        setPrompt("");
        setShape(IMAGE_DEFAULTS.shape);
        setSize(IMAGE_DEFAULTS.size);
        setCustomWidth(1280);
        setCustomHeight(720);
        setMode(IMAGE_DEFAULTS.mode);
        setOutputFormat(IMAGE_DEFAULTS.outputFormat);
        setBackground(IMAGE_DEFAULTS.background);
        setPreviewUrl(null);
        setVersionUrls(new Map());
        setLoadError(null);
        setStatus({ kind: "idle" });
        setMarking(false);
        setMarkerStrokes([]);
        requestAnimationFrame(() => promptRef.current?.focus());
        return;
      }
      setLoadError(null);
      setStatus({ kind: "idle" });
      try {
        const next = await window.harness.images.read(imageId);
        if (cancelled) return;
        if (!next) {
          setImage(null);
          setLoadError("Image not found.");
          setPreviewUrl(null);
          setVersionUrls(new Map());
          return;
        }
        applyImageState(next, { clearPrompt: true });
        await setPreviewFromImage(next);
        requestAnimationFrame(() => promptRef.current?.focus());
      } catch (e) {
        if (!cancelled) {
          setLoadError(String(e));
          setImage(null);
          setPreviewUrl(null);
          setVersionUrls(new Map());
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  useEffect(() => {
    if (!image) {
      setVersionUrls(new Map());
      return;
    }
    const current = image;
    let cancelled = false;
    async function loadUrls() {
      const map = new Map<string, string>();
      for (const version of orderedImageVersions(current)) {
        const url = await versionPreviewUrl(current, version);
        if (url) map.set(version.id, url);
      }
      if (!cancelled) setVersionUrls(map);
    }
    void loadUrls();
    return () => {
      cancelled = true;
    };
  }, [image]);

  useEffect(() => {
    const canvas = markerCanvasRef.current;
    const img = imageElRef.current;
    if (!canvas || !img || !marking) return;

    const syncCanvas = () => {
      const rect = img.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 16;
      ctx.strokeStyle = "rgba(255, 48, 48, 0.55)";
      for (const stroke of markerStrokes) {
        if (stroke.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x * w, stroke[0].y * h);
        for (let i = 1; i < stroke.length; i += 1) {
          ctx.lineTo(stroke[i].x * w, stroke[i].y * h);
        }
        ctx.stroke();
      }
      const current = drawingStrokeRef.current;
      if (current && current.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(current[0].x * w, current[0].y * h);
        for (let i = 1; i < current.length; i += 1) {
          ctx.lineTo(current[i].x * w, current[i].y * h);
        }
        ctx.stroke();
      }
    };

    syncCanvas();
    const observer = new ResizeObserver(syncCanvas);
    observer.observe(img);
    return () => observer.disconnect();
  }, [marking, markerStrokes, previewUrl, peekParent]);

  const effectiveSize = shape === "custom" ? formatImageSize(customWidth, customHeight) : size;
  const effectiveBackground = backgroundAllowedForFormat(outputFormat, background);
  const sizeError = validateImageSize(effectiveSize);
  const orderedVersions = image ? orderedImageVersions(image) : [];
  const activeParentId = image ? parentVersionId(image, image.activeVersionId) : null;
  const hasImage = Boolean(image?.hasFile);
  const hasMarks = markerStrokes.length > 0;
  const showMarkerLabel = hasMarks || (marking && hasImage);

  const parentPeekUrl =
    peekParent && activeParentId ? (versionUrls.get(activeParentId) ?? null) : null;
  const stageImageUrl = parentPeekUrl ?? previewUrl;

  const cleanupDraft = async (draftId: string) => {
    try {
      await window.harness.images.delete(draftId);
    } catch {
      // Best effort — parent may still list the orphan until manual refresh.
    }
    onImageRemoved?.(draftId);
  };

  const runGenerate = async (operation: ImageOperation) => {
    if (status.kind === "loading" || generateInFlightRef.current) return;
    const trimmed = prompt.trim();
    const usingMarker = operation === "adjust" && hasMarks;
    if (!usingMarker && !trimmed) return;

    const invalid = validateImageSize(effectiveSize);
    if (invalid) {
      setStatus({ kind: "error", message: invalid, operation });
      return;
    }

    generateInFlightRef.current = true;
    lastOperationRef.current = operation;
    setStatus({ kind: "loading", operation });
    const hadFileAtStart = Boolean(image?.hasFile);
    let targetId = imageId ?? image?.id ?? null;
    let createdDraft = false;
    const promptForApi = usingMarker ? buildMarkerAdjustPrompt(trimmed) : trimmed;

    try {
      if (!targetId) {
        const draft = await window.harness.images.create({
          prompt: promptForApi,
          size: effectiveSize,
          quality: qualityForRenderMode(mode),
          background: effectiveBackground,
          outputFormat,
        });
        targetId = draft.id;
        createdDraft = true;
        applyImageState(draft);
        onImageUpdated(draft);
      }
      setActivity(targetId, true);

      let extraImageDataUrls: string[] | undefined;
      if (usingMarker && previewUrl) {
        extraImageDataUrls = [await buildAnnotatedDataUrl(previewUrl, markerStrokes)];
      }

      const result = await window.harness.images.generate({
        imageId: targetId,
        operation: hadFileAtStart ? operation : "new",
        prompt: promptForApi,
        size: effectiveSize,
        quality: qualityForRenderMode(mode),
        background: effectiveBackground,
        outputFormat,
        extraImageDataUrls,
      });
      applyImageState(result);
      if (result.hasFile) {
        setPrompt("");
        if (usingMarker) setMarkerStrokes([]);
      }
      await setPreviewFromImage(result);
      onImageUpdated(result);
      setStatus({ kind: "idle" });
      setActivity(result.id, false);
    } catch (e) {
      const message = String(e);
      if (isCancelledMessage(message)) {
        setStatus({ kind: "idle" });
      } else {
        setStatus({ kind: "error", message, operation });
      }
      if (targetId) setActivity(targetId, false);
      if (createdDraft && targetId) {
        await cleanupDraft(targetId);
      }
    } finally {
      generateInFlightRef.current = false;
    }
  };

  const generate = () => runGenerate(hasImage ? "adjust" : "new");

  const dismissError = () => setStatus({ kind: "idle" });

  const cancelLoading = async () => {
    const id = imageId ?? image?.id;
    if (!id) {
      setStatus({ kind: "idle" });
      return;
    }
    try {
      await window.harness.images.cancel(id);
    } catch {
      setStatus({ kind: "idle" });
    }
  };

  const goToVersion = async (versionId: string) => {
    if (!imageId || !image || status.kind === "loading") return;
    if (versionId === image.activeVersionId) return;
    try {
      const result = await window.harness.images.setActiveVersion(imageId, versionId);
      applyImageState(result, { clearPrompt: true });
      await setPreviewFromImage(result);
      onImageUpdated(result);
      requestAnimationFrame(() => promptRef.current?.focus());
    } catch (e) {
      const message = String(e);
      if (!isCancelledMessage(message)) {
        setStatus({ kind: "error", message, operation: null });
      }
    }
  };

  const deleteActiveVersion = async () => {
    if (!imageId || !image || status.kind === "loading") return;
    if (!isLeafVersion(image, image.activeVersionId)) return;
    try {
      const result = await window.harness.images.deleteVersion(imageId, image.activeVersionId);
      applyImageState(result, { clearPrompt: true });
      await setPreviewFromImage(result);
      onImageUpdated(result);
    } catch (e) {
      setStatus({ kind: "error", message: String(e), operation: null });
    }
  };

  const deleteVersion = async (versionId: string) => {
    if (!imageId || !image || status.kind === "loading") return;
    if (!isLeafVersion(image, versionId)) return;
    try {
      const result = await window.harness.images.deleteVersion(imageId, versionId);
      applyImageState(result, { clearPrompt: true });
      await setPreviewFromImage(result);
      onImageUpdated(result);
    } catch (e) {
      setStatus({ kind: "error", message: String(e), operation: null });
    }
  };

  const stepVersion = (delta: -1 | 1) => {
    if (!image || orderedVersions.length === 0) return;
    const idx = orderedVersions.findIndex((v) => v.id === image.activeVersionId);
    const next = orderedVersions[idx + delta];
    if (next) void goToVersion(next.id);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const inEditable = isEditableTarget(e.target);
      const inTextarea = e.target instanceof HTMLTextAreaElement;

      if (e.key === " " && !inTextarea) {
        e.preventDefault();
        setPeekParent(true);
        return;
      }
      if (e.key === "\\") {
        e.preventDefault();
        setPeekParent(true);
        return;
      }

      if (e.key === "Escape") {
        if (marking) {
          e.preventDefault();
          setMarking(false);
          return;
        }
        if (statusRef.current.kind === "loading") {
          e.preventDefault();
          void cancelLoading();
          return;
        }
        if (inTextarea) {
          e.preventDefault();
          promptRef.current?.blur();
        }
        return;
      }

      if (inEditable) return;

      if ((e.key === "m" || e.key === "M") && hasImage) {
        e.preventDefault();
        setMarking((on) => !on);
        return;
      }

      if (e.key === "Backspace") {
        e.preventDefault();
        void deleteActiveVersion();
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepVersion(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        stepVersion(1);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "\\") {
        setPeekParent(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [hasImage, image, orderedVersions.length]);

  const markerPointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): MarkerPoint => {
    const canvas = markerCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onMarkerPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!marking) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingStrokeRef.current = [markerPointFromEvent(e)];
    setMarkerStrokes((prev) => [...prev, drawingStrokeRef.current!]);
  };

  const onMarkerPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!marking || !drawingStrokeRef.current) return;
    drawingStrokeRef.current.push(markerPointFromEvent(e));
    setMarkerStrokes((prev) => {
      const next = [...prev];
      next[next.length - 1] = [...drawingStrokeRef.current!];
      return next;
    });
  };

  const onMarkerPointerUp = () => {
    drawingStrokeRef.current = null;
  };

  if (loadError) {
    return (
      <div className="workspace-page image-canvas">
        <div className="image-canvas__empty">
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  const buttonLabel = hasImage ? "Adjust" : "Generate";
  const loading = status.kind === "loading";
  const showStageOverlay =
    (loading && Boolean(stageImageUrl)) ||
    (status.kind === "error" && Boolean(stageImageUrl) && !isCancelledMessage(status.message));
  const overlayMessage =
    status.kind === "error" ? status.message : loading ? loadingLabel(status.operation) : "";
  const canSubmit = !loading && !sizeError && (hasMarks || prompt.trim().length > 0);

  return (
    <div className="workspace-page image-canvas" data-testid="image-canvas">
      <div className="image-canvas__stage-wrap">
        {hasImage ? (
          <div className="image-canvas__stage-toolbar">
            <button
              type="button"
              className={`btn btn-ghost btn-sm image-canvas__toolbar-btn${marking ? " image-canvas__toolbar-btn--active" : ""}`}
              onClick={() => setMarking((on) => !on)}
              aria-pressed={marking}
            >
              <PenLine size={14} aria-hidden />
              Marker
            </button>
            {marking ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm image-canvas__toolbar-btn"
                onClick={() => setMarkerStrokes([])}
                disabled={!hasMarks}
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              className={`btn btn-ghost btn-sm image-canvas__toolbar-btn${peekParent ? " image-canvas__toolbar-btn--active" : ""}`}
              onMouseDown={() => setPeekParent(true)}
              onMouseUp={() => setPeekParent(false)}
              onMouseLeave={() => setPeekParent(false)}
              disabled={!activeParentId}
              title="Hold to compare with parent version"
            >
              Before
            </button>
            <div className="image-canvas__toolbar-spacer" />
            <button
              type="button"
              className="btn btn-ghost btn-sm image-canvas__toolbar-btn"
              onClick={() => imageId && void window.harness.images.copyToClipboard(imageId)}
              disabled={!imageId || !hasImage}
              title="Copy to clipboard"
            >
              <ClipboardCopy size={14} aria-hidden />
              Copy
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm image-canvas__toolbar-btn"
              onClick={() => imageId && void window.harness.images.revealInFinder(imageId)}
              disabled={!imageId || !hasImage}
              title="Reveal in Finder"
            >
              <FolderOpen size={14} aria-hidden />
              Reveal
            </button>
          </div>
        ) : null}

        <div className="image-canvas__stage" ref={stageRef}>
          {loading && !stageImageUrl ? (
            <div className="image-canvas__placeholder" aria-busy="true">
              <Loader2 size={28} className="image-canvas__spinner" aria-hidden />
              <p>{status.kind === "loading" ? loadingLabel(status.operation) : "Generating…"}</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void cancelLoading()}
              >
                Cancel
              </button>
            </div>
          ) : status.kind === "error" && !stageImageUrl ? (
            <div className="image-canvas__placeholder" role="alert">
              <p>{status.message}</p>
              <div className="image-canvas__overlay-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void runGenerate(status.operation ?? lastOperationRef.current)}
                >
                  Retry
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={dismissError}>
                  Dismiss
                </button>
              </div>
            </div>
          ) : stageImageUrl ? (
            <div
              className={`image-canvas__preview${loading ? " image-canvas__preview--dimmed" : ""}${peekParent ? " image-canvas__preview--peek" : ""}`}
            >
              <img
                ref={imageElRef}
                className="image-canvas__image"
                src={stageImageUrl}
                alt={getDisplayImageTitle(image?.title)}
              />
              {marking && hasImage && !peekParent ? (
                <canvas
                  ref={markerCanvasRef}
                  className="image-canvas__marker-canvas"
                  aria-label="Mark changes on image"
                  onPointerDown={onMarkerPointerDown}
                  onPointerMove={onMarkerPointerMove}
                  onPointerUp={onMarkerPointerUp}
                  onPointerCancel={onMarkerPointerUp}
                />
              ) : null}
            </div>
          ) : (
            <div className="image-canvas__placeholder">
              <ImageIcon size={36} aria-hidden />
              <p>Describe an image in the panel, then generate.</p>
            </div>
          )}
          {showStageOverlay ? (
            <div className="image-canvas__overlay" role="status">
              {status.kind === "error" ? (
                <>
                  <p className="image-canvas__overlay-message">{overlayMessage}</p>
                  <div className="image-canvas__overlay-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() =>
                        void runGenerate(status.operation ?? lastOperationRef.current)
                      }
                    >
                      Retry
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={dismissError}>
                      Dismiss
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Loader2 size={24} className="image-canvas__spinner" aria-hidden />
                  <p className="image-canvas__overlay-message">{overlayMessage}</p>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void cancelLoading()}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>

        {orderedVersions.length > 0 && image ? (
          <nav className="image-canvas__filmstrip" aria-label="Image versions">
            <ul className="image-canvas__filmstrip-list">
              {orderedVersions.map((version) => {
                const isActive = version.id === image.activeVersionId;
                const isParentHighlight = version.id === activeParentId;
                const thumbUrl = versionUrls.get(version.id);
                const parentId = parentVersionId(image, version.id);
                const parentLabel = parentId ? displayVersionLabel(image, parentId) : null;
                const hoverTitle = [
                  displayVersionLabel(image, version.id),
                  parentLabel ? `from ${parentLabel}` : null,
                  version.prompt ? promptSnippet(version.prompt, 80) : null,
                  formatRelativeTime(version.createdAt),
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <li
                    key={version.id}
                    className={`image-canvas__filmstrip-item${isActive ? " image-canvas__filmstrip-item--active" : ""}${isParentHighlight ? " image-canvas__filmstrip-item--parent" : ""}`}
                  >
                    <button
                      type="button"
                      className="image-canvas__filmstrip-thumb"
                      onClick={() => void goToVersion(version.id)}
                      disabled={loading}
                      aria-current={isActive ? "true" : undefined}
                      title={hoverTitle}
                    >
                      {thumbUrl ? (
                        <img src={thumbUrl} alt="" className="image-canvas__filmstrip-image" />
                      ) : (
                        <span className="image-canvas__filmstrip-placeholder" aria-hidden />
                      )}
                      <span className="image-canvas__filmstrip-badge">
                        {version.kind === "finalize" ? (
                          <Star size={10} className="image-canvas__filmstrip-star" aria-hidden />
                        ) : null}
                        {displayVersionLabel(image, version.id)}
                        {versionHasMarker(version) ? (
                          <PenLine
                            size={10}
                            className="image-canvas__filmstrip-marker"
                            aria-hidden
                          />
                        ) : null}
                      </span>
                    </button>
                    {isLeafVersion(image, version.id) ? (
                      <button
                        type="button"
                        className="image-canvas__filmstrip-delete"
                        onClick={() => void deleteVersion(version.id)}
                        disabled={loading}
                        aria-label={`Delete ${displayVersionLabel(image, version.id)}`}
                        title="Delete version"
                      >
                        <X size={12} aria-hidden />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
      </div>

      <aside className="image-canvas__panel" aria-label="Image controls">
        <div className="image-canvas__panel-body">
          {stubImages ? (
            <p className="image-canvas__stub-banner" role="status">
              Stub images on — colored PNGs, no OpenAI. Use the filmstrip to browse v1, v2, … and
              the marker tool to highlight edit regions.
            </p>
          ) : null}
          {hasImage && image ? (
            <ul className="image-canvas__prompt-list" aria-label="Version prompts">
              {orderedImageVersions(image).map((version) => {
                const versionPrompt = stripMarkerPrefix(version.prompt);
                const snippet = promptSnippet(versionPrompt);
                const parentId = version.parentId ?? null;
                const isActive = version.id === image.activeVersionId;
                return (
                  <li
                    key={version.id}
                    className={`image-canvas__prompt-item${isActive ? " image-canvas__prompt-item--active" : ""}`}
                  >
                    <button
                      type="button"
                      className="image-canvas__prompt-row"
                      title={versionPrompt ? "Reuse this prompt" : undefined}
                      disabled={!versionPrompt}
                      onClick={() => {
                        setPrompt(versionPrompt);
                        promptRef.current?.focus();
                      }}
                    >
                      <span>{displayVersionLabel(image, version.id)}</span>
                      {parentId ? (
                        <>
                          <span aria-hidden> · </span>
                          <span>from {displayVersionLabel(image, parentId)}</span>
                        </>
                      ) : null}
                      {snippet ? (
                        <>
                          <span aria-hidden> · </span>
                          <span className="image-canvas__prompt-snippet">
                            &lsquo;{snippet}&rsquo;
                          </span>
                        </>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="image-canvas__option-group">
            <span className="image-canvas__label">Quality</span>
            <div className="image-canvas__segmented" role="group" aria-label="Quality">
              {IMAGE_RENDER_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`image-canvas__segment${mode === option.value ? " image-canvas__segment--active" : ""}`}
                  onClick={() => setMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="image-canvas__option-group">
            <span className="image-canvas__label">Shape</span>
            <div
              className="image-canvas__segmented image-canvas__segmented--grid"
              role="group"
              aria-label="Shape"
            >
              {IMAGE_SHAPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`image-canvas__segment${shape === option.value ? " image-canvas__segment--active" : ""}`}
                  onClick={() => {
                    setShape(option.value);
                    if (option.value !== "custom" && option.size) {
                      setSize(option.size);
                    } else if (option.value === "custom") {
                      setSize(formatImageSize(customWidth, customHeight));
                    }
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {shape === "custom" ? (
            <div className="image-canvas__size-row">
              <label className="image-canvas__field image-canvas__field--inline">
                <span className="image-canvas__label">Width</span>
                <input
                  type="number"
                  className="image-canvas__number"
                  min={16}
                  max={3840}
                  step={16}
                  value={customWidth}
                  onChange={(e) => setCustomWidth(Number(e.target.value) || 0)}
                />
              </label>
              <span className="image-canvas__size-x" aria-hidden>
                ×
              </span>
              <label className="image-canvas__field image-canvas__field--inline">
                <span className="image-canvas__label">Height</span>
                <input
                  type="number"
                  className="image-canvas__number"
                  min={16}
                  max={3840}
                  step={16}
                  value={customHeight}
                  onChange={(e) => setCustomHeight(Number(e.target.value) || 0)}
                />
              </label>
            </div>
          ) : null}
          {sizeError ? <p className="image-canvas__error">{sizeError}</p> : null}

          <div className="image-canvas__option-group">
            <span className="image-canvas__label">File type</span>
            <div className="image-canvas__segmented" role="group" aria-label="File type">
              {IMAGE_OUTPUT_FORMAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`image-canvas__segment${outputFormat === option.value ? " image-canvas__segment--active" : ""}`}
                  onClick={() => {
                    setOutputFormat(option.value);
                    setBackground(backgroundAllowedForFormat(option.value, background));
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="image-canvas__option-group">
            <span className="image-canvas__label">Transparency</span>
            <div className="image-canvas__segmented" role="group" aria-label="Transparency">
              {IMAGE_BACKGROUND_OPTIONS.map((option) => {
                const disabled = option.value === "transparent" && outputFormat === "jpeg";
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`image-canvas__segment${effectiveBackground === option.value ? " image-canvas__segment--active" : ""}`}
                    disabled={disabled}
                    title={disabled ? "JPEG does not support transparency" : undefined}
                    onClick={() => setBackground(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="image-canvas__compose">
            <label className="image-canvas__field">
              <span className="image-canvas__label">
                {showMarkerLabel ? "Changes (marked area)" : hasImage ? "Changes" : "Prompt"}
              </span>
              <textarea
                ref={promptRef}
                className="image-canvas__textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  const nativeEvent = e.nativeEvent as KeyboardEvent;
                  const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
                  if (nativeEvent.isComposing || e.repeat) return;
                  if (e.key === "Enter" && !hasModifier) {
                    e.preventDefault();
                    void generate();
                  }
                }}
                rows={5}
                placeholder={hasImage ? "Describe changes…" : "Describe the image to generate"}
              />
            </label>

            <button
              type="button"
              className="btn btn-primary image-canvas__generate"
              onClick={() => void generate()}
              disabled={!canSubmit}
            >
              <RefreshCw
                size={14}
                className={loading ? "image-canvas__spinner" : undefined}
                aria-hidden
              />
              {buttonLabel}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

async function buildAnnotatedDataUrl(previewUrl: string, strokes: MarkerStroke[]): Promise<string> {
  // Asset-protocol URLs taint a canvas if drawn via <img src>; fetch→blob→object URL
  // keeps toDataURL() allowed (same pattern as audioAttach staging).
  const response = await fetch(previewUrl);
  if (!response.ok) {
    throw new Error("Could not load image for marker export.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare marker canvas.");
    ctx.drawImage(img, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(12, Math.round(Math.min(canvas.width, canvas.height) * 0.02));
    ctx.strokeStyle = "rgba(255, 48, 48, 0.75)";
    for (const stroke of strokes) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
      for (let i = 1; i < stroke.length; i += 1) {
        ctx.lineTo(stroke[i].x * canvas.width, stroke[i].y * canvas.height);
      }
      ctx.stroke();
    }
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for marker export."));
    img.src = url;
  });
}
