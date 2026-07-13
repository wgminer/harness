import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, RefreshCw } from "lucide-react";
import {
  IMAGE_BACKGROUND_OPTIONS,
  IMAGE_DEFAULTS,
  IMAGE_OUTPUT_FORMAT_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_PRESETS,
  backgroundAllowedForFormat,
  formatImageSize,
  isImageSizePreset,
  parseImageSize,
  sizeFromLegacyAspect,
  validateImageSize,
} from "../shared/imageOptions";
import type {
  GeneratedImage,
  ImageBackground,
  ImageOutputFormat,
  ImageQuality,
  ImageSize,
} from "../shared/images";
import { getDisplayImageTitle } from "../shared/images";

type GenerateStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string };

export interface ImageCanvasViewProps {
  imageId: string | null;
  onImageUpdated: (image: GeneratedImage) => void;
}

function resolveInitialSize(raw: string | undefined): ImageSize {
  if (!raw) return IMAGE_DEFAULTS.size;
  if (isImageSizePreset(raw) || parseImageSize(raw)) return raw;
  return sizeFromLegacyAspect(raw);
}

export function ImageCanvasView({ imageId, onImageUpdated }: ImageCanvasViewProps) {
  const [image, setImage] = useState<GeneratedImage | null>(null);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageSize>(IMAGE_DEFAULTS.size);
  const [customWidth, setCustomWidth] = useState(IMAGE_DEFAULTS.customWidth);
  const [customHeight, setCustomHeight] = useState(IMAGE_DEFAULTS.customHeight);
  const [customMode, setCustomMode] = useState(false);
  const [quality, setQuality] = useState<ImageQuality>(IMAGE_DEFAULTS.quality);
  const [background, setBackground] = useState<ImageBackground>(IMAGE_DEFAULTS.background);
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>(IMAGE_DEFAULTS.outputFormat);
  const [status, setStatus] = useState<GenerateStatus>({ kind: "idle" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const applySizeState = (nextSize: ImageSize) => {
    const resolved = resolveInitialSize(nextSize);
    const parsed = parseImageSize(resolved);
    if (parsed && !isImageSizePreset(resolved)) {
      setCustomMode(true);
      setCustomWidth(parsed.width);
      setCustomHeight(parsed.height);
      setSize(formatImageSize(parsed.width, parsed.height));
      return;
    }
    setCustomMode(false);
    setSize(resolved === "auto" || isImageSizePreset(resolved) ? resolved : IMAGE_DEFAULTS.size);
    if (parsed) {
      setCustomWidth(parsed.width);
      setCustomHeight(parsed.height);
    } else {
      setCustomWidth(IMAGE_DEFAULTS.customWidth);
      setCustomHeight(IMAGE_DEFAULTS.customHeight);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!imageId) {
        setImage(null);
        setPrompt("");
        applySizeState(IMAGE_DEFAULTS.size);
        setQuality(IMAGE_DEFAULTS.quality);
        setBackground(IMAGE_DEFAULTS.background);
        setOutputFormat(IMAGE_DEFAULTS.outputFormat);
        setPreviewUrl(null);
        setLoadError(null);
        setStatus({ kind: "idle" });
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
        setImage(next);
        setPrompt(next.prompt);
        applySizeState(next.size || IMAGE_DEFAULTS.size);
        setQuality((next.quality as ImageQuality) || IMAGE_DEFAULTS.quality);
        setBackground((next.background as ImageBackground) || IMAGE_DEFAULTS.background);
        setOutputFormat((next.outputFormat as ImageOutputFormat) || IMAGE_DEFAULTS.outputFormat);
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

  const effectiveBackground = backgroundAllowedForFormat(outputFormat, background);
  const effectiveSize = customMode ? formatImageSize(customWidth, customHeight) : size;
  const sizeError = validateImageSize(effectiveSize);

  const selectPreset = (value: ImageSize) => {
    setCustomMode(false);
    setSize(value);
    const parsed = parseImageSize(value);
    if (parsed) {
      setCustomWidth(parsed.width);
      setCustomHeight(parsed.height);
    }
  };

  const enterCustomMode = () => {
    setCustomMode(true);
    const parsed = parseImageSize(size);
    if (parsed) {
      setCustomWidth(parsed.width);
      setCustomHeight(parsed.height);
    }
  };

  const generate = async () => {
    if (!imageId || status.kind === "loading") return;
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const nextSize = customMode ? formatImageSize(customWidth, customHeight) : size;
    const invalid = validateImageSize(nextSize);
    if (invalid) {
      setStatus({ kind: "error", message: invalid });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const result = await window.harness.images.generate({
        imageId,
        prompt: trimmed,
        size: nextSize,
        quality,
        background: effectiveBackground,
        outputFormat,
      });
      setImage(result);
      setPrompt(result.prompt);
      applySizeState(result.size || nextSize);
      setQuality((result.quality as ImageQuality) || quality);
      setBackground((result.background as ImageBackground) || effectiveBackground);
      setOutputFormat((result.outputFormat as ImageOutputFormat) || outputFormat);
      if (result.absolutePath) {
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        setPreviewUrl(convertFileSrc(result.absolutePath));
      }
      onImageUpdated(result);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  };

  if (!imageId) {
    return (
      <div className="workspace-page image-canvas">
        <div className="image-canvas__empty">
          <p>Select an image from the sidebar, or create one with New → New image.</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="workspace-page image-canvas">
        <div className="image-canvas__empty">
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-page image-canvas" data-testid="image-canvas">
      <div className="image-canvas__stage">
        {status.kind === "loading" ? (
          <div className="image-canvas__placeholder" aria-busy="true">
            <Loader2 size={28} className="image-canvas__spinner" aria-hidden />
            <p>Generating…</p>
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

      <aside className="image-canvas__panel" aria-label="Image controls">
        <header className="image-canvas__panel-header">
          <h2 className="image-canvas__panel-title">
            {image ? getDisplayImageTitle(image.title) : "Image"}
          </h2>
        </header>

        <div className="image-canvas__panel-body">
          <label className="image-canvas__field">
            <span className="image-canvas__label">Prompt</span>
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
              placeholder="Describe the image to generate"
            />
          </label>

          <div className="image-canvas__option-group">
            <span className="image-canvas__label">Size</span>
            <div className="image-canvas__segmented">
              {IMAGE_SIZE_PRESETS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`image-canvas__segment${!customMode && size === option.value ? " image-canvas__segment--active" : ""}`}
                  onClick={() => selectPreset(option.value)}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                className={`image-canvas__segment${customMode ? " image-canvas__segment--active" : ""}`}
                onClick={enterCustomMode}
              >
                Custom
              </button>
            </div>
            {customMode ? (
              <div className="image-canvas__custom-size">
                <label className="image-canvas__custom-field">
                  <span className="image-canvas__custom-label">W</span>
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
                <span className="image-canvas__custom-sep" aria-hidden>
                  ×
                </span>
                <label className="image-canvas__custom-field">
                  <span className="image-canvas__custom-label">H</span>
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
            {customMode && sizeError ? (
              <p className="image-canvas__hint">{sizeError}</p>
            ) : null}
          </div>

          <div className="image-canvas__option-group">
            <span className="image-canvas__label">Quality</span>
            <div className="image-canvas__segmented">
              {IMAGE_QUALITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`image-canvas__segment${quality === option.value ? " image-canvas__segment--active" : ""}`}
                  onClick={() => setQuality(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="image-canvas__option-group">
            <span className="image-canvas__label">Background</span>
            <div className="image-canvas__segmented">
              {IMAGE_BACKGROUND_OPTIONS.map((option) => {
                const disabled = outputFormat === "jpeg" && option.value === "transparent";
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`image-canvas__segment${effectiveBackground === option.value ? " image-canvas__segment--active" : ""}`}
                    onClick={() => setBackground(option.value)}
                    disabled={disabled}
                    title={disabled ? "JPEG cannot be transparent" : undefined}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="image-canvas__option-group">
            <span className="image-canvas__label">Format</span>
            <div className="image-canvas__segmented">
              {IMAGE_OUTPUT_FORMAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`image-canvas__segment${outputFormat === option.value ? " image-canvas__segment--active" : ""}`}
                  onClick={() => setOutputFormat(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {status.kind === "error" ? (
            <p className="image-canvas__error">{status.message}</p>
          ) : null}

          <button
            type="button"
            className="btn image-canvas__generate"
            onClick={() => void generate()}
            disabled={status.kind === "loading" || !prompt.trim() || Boolean(sizeError)}
          >
            <RefreshCw
              size={14}
              className={status.kind === "loading" ? "image-canvas__spinner" : undefined}
              aria-hidden
            />
            {previewUrl ? "Regenerate" : "Generate"}
          </button>
        </div>
      </aside>
    </div>
  );
}
