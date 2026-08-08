import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, RefreshCw } from "lucide-react";
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
  ImageOutputFormat,
  ImageSize,
  ImageVersion,
} from "../shared/images";
import {
  getDisplayImageTitle,
  imageVersionChildren,
  imageVersionLabel,
} from "../shared/images";

type GenerateStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string };

export interface ImageCanvasViewProps {
  imageId: string | null;
  onImageUpdated: (image: GeneratedImage) => void;
}

function VersionTreeNode({
  versions,
  version,
  activeVersionId,
  disabled,
  onSelect,
}: {
  versions: ImageVersion[];
  version: ImageVersion;
  activeVersionId: string;
  disabled: boolean;
  onSelect: (versionId: string) => void;
}) {
  const children = imageVersionChildren(versions, version.id);
  const isActive = version.id === activeVersionId;
  return (
    <li className="image-canvas__tree-node">
      <button
        type="button"
        className={`image-canvas__tree-chip${isActive ? " image-canvas__tree-chip--active" : ""}`}
        onClick={() => onSelect(version.id)}
        disabled={disabled || isActive}
        aria-current={isActive ? "true" : undefined}
        title={version.prompt || imageVersionLabel(version)}
      >
        {imageVersionLabel(version)}
      </button>
      {children.length > 0 ? (
        <ul className="image-canvas__tree-children">
          {children.map((child) => (
            <VersionTreeNode
              key={child.id}
              versions={versions}
              version={child}
              activeVersionId={activeVersionId}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ImageCanvasView({ imageId, onImageUpdated }: ImageCanvasViewProps) {
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stubImages, setStubImages] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.harness.env.isStubImages().then((on) => {
      if (!cancelled) setStubImages(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyImageState = (next: GeneratedImage) => {
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
    if (next.hasFile) {
      setPrompt("");
    } else {
      setPrompt(next.prompt);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
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
        setLoadError(null);
        setStatus({ kind: "idle" });
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
          return;
        }
        applyImageState(next);
        if (next.absolutePath) {
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          if (!cancelled) setPreviewUrl(convertFileSrc(next.absolutePath));
        } else {
          setPreviewUrl(null);
        }
        requestAnimationFrame(() => promptRef.current?.focus());
      } catch (e) {
        if (!cancelled) {
          setLoadError(String(e));
          setImage(null);
          setPreviewUrl(null);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  const effectiveSize = shape === "custom" ? formatImageSize(customWidth, customHeight) : size;
  const effectiveBackground = backgroundAllowedForFormat(outputFormat, background);
  const sizeError = validateImageSize(effectiveSize);
  const modeHint =
    IMAGE_RENDER_MODE_OPTIONS.find((option) => option.value === mode)?.hint ?? null;
  const versions = image?.versions ?? [];
  const roots = imageVersionChildren(versions, null);
  const hasImage = Boolean(image?.hasFile);

  const setPreviewFromImage = async (next: GeneratedImage) => {
    if (next.absolutePath) {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      setPreviewUrl(convertFileSrc(next.absolutePath));
    } else {
      setPreviewUrl(null);
    }
  };

  const generate = async () => {
    if (status.kind === "loading") return;
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const invalid = validateImageSize(effectiveSize);
    if (invalid) {
      setStatus({ kind: "error", message: invalid });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const result = await window.harness.images.generate({
        imageId: imageId ?? undefined,
        operation: hasImage ? "adjust" : "new",
        prompt: trimmed,
        size: effectiveSize,
        quality: qualityForRenderMode(mode),
        background: effectiveBackground,
        outputFormat,
      });
      applyImageState(result);
      if (result.hasFile) {
        setPrompt("");
      }
      await setPreviewFromImage(result);
      onImageUpdated(result);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  };

  const goToVersion = async (versionId: string) => {
    if (!imageId || !image || status.kind === "loading") return;
    if (versionId === image.activeVersionId) return;
    setStatus({ kind: "loading" });
    try {
      const result = await window.harness.images.setActiveVersion(imageId, versionId);
      applyImageState(result);
      await setPreviewFromImage(result);
      onImageUpdated(result);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
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

  return (
    <div className="workspace-page image-canvas" data-testid="image-canvas">
      <div className="image-canvas__stage-wrap">
        <div className="image-canvas__stage">
          {status.kind === "loading" && !previewUrl ? (
            <div className="image-canvas__placeholder" aria-busy="true">
              <Loader2 size={28} className="image-canvas__spinner" aria-hidden />
              <p>
                {hasImage
                  ? "Adjusting…"
                  : mode === "draft"
                    ? "Generating draft…"
                    : "Generating final…"}
              </p>
            </div>
          ) : previewUrl ? (
            <img
              className="image-canvas__image"
              src={previewUrl}
              alt={getDisplayImageTitle(image?.title)}
            />
          ) : (
            <div className="image-canvas__placeholder">
              <ImageIcon size={36} aria-hidden />
              <p>Describe an image in the panel, then generate.</p>
            </div>
          )}
        </div>
        {versions.length > 0 ? (
          <nav className="image-canvas__tree" aria-label="Image version branches">
            <ul className="image-canvas__tree-roots">
              {roots.map((root) => (
                <VersionTreeNode
                  key={root.id}
                  versions={versions}
                  version={root}
                  activeVersionId={image?.activeVersionId ?? ""}
                  disabled={status.kind === "loading"}
                  onSelect={(id) => void goToVersion(id)}
                />
              ))}
            </ul>
          </nav>
        ) : null}
      </div>

      <aside className="image-canvas__panel" aria-label="Image controls">
        <header className="image-canvas__panel-header">
          <h2 className="image-canvas__panel-title">
            {image ? getDisplayImageTitle(image.title) : "New image"}
          </h2>
          {stubImages ? (
            <p className="image-canvas__stub-banner" role="status">
              Stub images on — colored PNGs, no OpenAI. Tip continues A; adjust from a node with a
              child forks B/C.
            </p>
          ) : null}
        </header>

        <div className="image-canvas__panel-body">
          <label className="image-canvas__field">
            <span className="image-canvas__label">{hasImage ? "Changes" : "Prompt"}</span>
            <textarea
              ref={promptRef}
              className="image-canvas__textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  return;
                }
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
            {modeHint ? <p className="image-canvas__hint">{modeHint}</p> : null}
          </div>

          <div className="image-canvas__option-group">
            <span className="image-canvas__label">Shape</span>
            <div className="image-canvas__segmented" role="group" aria-label="Shape">
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
                const disabled =
                  option.value === "transparent" && outputFormat === "jpeg";
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`image-canvas__segment${effectiveBackground === option.value ? " image-canvas__segment--active" : ""}`}
                    disabled={disabled}
                    title={
                      disabled ? "JPEG does not support transparency" : undefined
                    }
                    onClick={() => setBackground(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {status.kind === "error" ? (
            <p className="image-canvas__error">{status.message}</p>
          ) : null}
        </div>

        <div className="image-canvas__panel-footer">
          <button
            type="button"
            className="btn btn-primary image-canvas__generate"
            onClick={() => void generate()}
            disabled={status.kind === "loading" || !prompt.trim() || Boolean(sizeError)}
          >
            <RefreshCw
              size={14}
              className={status.kind === "loading" ? "image-canvas__spinner" : undefined}
              aria-hidden
            />
            {buttonLabel}
          </button>
        </div>
      </aside>
    </div>
  );
}
