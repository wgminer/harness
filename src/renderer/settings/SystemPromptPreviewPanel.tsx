import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { SystemPromptPreview } from "../../shared/types";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";

type PreviewPlatform = "desktop" | "ios";

type LayerKind = "shared" | "platform" | "memory" | "recent" | "temporal";

interface PromptLayer {
  id: LayerKind;
  title: string;
  source: string;
  body: string;
  optional: boolean;
  meta?: string;
}

function formatSize(text: string): string {
  const chars = text.length;
  if (chars === 0) return "0 chars";
  if (chars < 1000) return `${chars} chars`;
  return `${(chars / 1000).toFixed(chars < 10_000 ? 1 : 0)}k chars`;
}

function PromptLayerCard({
  layer,
  index,
  defaultOpen,
}: {
  layer: PromptLayer;
  index: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const headingId = useId();
  const empty = layer.body.trim().length === 0;
  const skipped = layer.optional && empty;

  return (
    <div
      className={`settings-prompt-layer${skipped ? " settings-prompt-layer--skipped" : ""}${open ? " settings-prompt-layer--open" : ""}`}
      data-layer={layer.id}
      data-testid={`settings-system-prompt-layer-${layer.id}`}
    >
      <button
        type="button"
        className="settings-prompt-layer__header"
        id={headingId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="settings-prompt-layer__index" aria-hidden>
          {index + 1}
        </span>
        <span className="settings-prompt-layer__titles">
          <span className="settings-prompt-layer__title">{layer.title}</span>
          <span className="settings-prompt-layer__source">{layer.source}</span>
        </span>
        <span className="settings-prompt-layer__meta">
          {skipped ? (
            <span className="settings-prompt-layer__badge settings-prompt-layer__badge--empty">
              skipped
            </span>
          ) : (
            <>
              {layer.meta ? (
                <span className="settings-prompt-layer__badge">{layer.meta}</span>
              ) : null}
              <span className="settings-prompt-layer__badge settings-prompt-layer__badge--size">
                {formatSize(layer.body)}
              </span>
            </>
          )}
          <ChevronRight
            size={14}
            strokeWidth={2}
            className={`settings-prompt-layer__caret${open ? " settings-prompt-layer__caret--open" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        hidden={!open}
        className="settings-prompt-layer__body"
      >
        {skipped ? (
          <p className="settings-prompt-layer__empty">
            Nothing to inject for this layer right now.
          </p>
        ) : (
          <pre
            className="settings-prompt-layer__pre"
            aria-label={`${layer.title} content`}
          >
            {layer.body}
          </pre>
        )}
      </div>
    </div>
  );
}

export function SystemPromptPreviewPanel({
  collapsible = false,
  defaultOpen = true,
}: {
  collapsible?: boolean;
  defaultOpen?: boolean;
} = {}) {
  const [platform, setPlatform] = useState<PreviewPlatform>("desktop");
  const [preview, setPreview] = useState<SystemPromptPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAssembled, setShowAssembled] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const assembledPanelId = useId();
  const assembledHeadingId = useId();
  const toolsPanelId = useId();
  const toolsHeadingId = useId();

  const loadPreview = useCallback(async (nextPlatform: PreviewPlatform) => {
    if (!window.harness?.settings?.getSystemPromptPreview) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.harness.settings.getSystemPromptPreview(nextPlatform);
      setPreview(result);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Could not load system prompt preview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreview(platform);
  }, [loadPreview, platform]);

  const layers = useMemo((): PromptLayer[] => {
    if (!preview) return [];
    const platformLabel = platform === "ios" ? "iOS" : "Desktop";
    return [
      {
        id: "shared",
        title: "Shared instructions",
        source: "settings · systemPrompt.shared",
        body: preview.shared,
        optional: false,
      },
      {
        id: "platform",
        title: `${platformLabel} overlay`,
        source: `settings · systemPrompt.${platform}`,
        body: preview.platformOverlay,
        optional: false,
      },
      {
        id: "memory",
        title: "Memory facts",
        source: "runtime · selected facts",
        body: preview.memoryBlock,
        optional: true,
        meta:
          preview.selectedFacts.length > 0
            ? `${preview.selectedFacts.length} fact${preview.selectedFacts.length === 1 ? "" : "s"}`
            : undefined,
      },
      {
        id: "recent",
        title: "Recent conversations",
        source: "runtime · chat index",
        body: preview.recentConversationsBlock,
        optional: true,
      },
      {
        id: "temporal",
        title: "Temporal context",
        source: "runtime · local clock",
        body: preview.temporalContext,
        optional: false,
      },
    ];
  }, [platform, preview]);

  const includedCount = layers.filter(
    (layer) => !(layer.optional && layer.body.trim().length === 0),
  ).length;

  return (
    <SettingsGroup
      title="System prompt"
      description="How the chat system message is stacked — tool schemas ride alongside it on the request, not inside the text."
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      <div
        className="settings-system-prompt-toggle"
        role="tablist"
        aria-label="System prompt platform preview"
      >
        <button
          type="button"
          role="tab"
          className={`settings-system-prompt-toggle__btn${platform === "desktop" ? " settings-system-prompt-toggle__btn--active" : ""}`}
          aria-selected={platform === "desktop"}
          data-testid="settings-system-prompt-desktop"
          onClick={() => setPlatform("desktop")}
        >
          Desktop
        </button>
        <button
          type="button"
          role="tab"
          className={`settings-system-prompt-toggle__btn${platform === "ios" ? " settings-system-prompt-toggle__btn--active" : ""}`}
          aria-selected={platform === "ios"}
          data-testid="settings-system-prompt-ios"
          onClick={() => setPlatform("ios")}
        >
          iOS
        </button>
      </div>

      {loading && <SettingsHint flush>Loading preview…</SettingsHint>}
      {error && <SettingsHint flush>{error}</SettingsHint>}

      {preview && !loading && (
        <>
          <p className="settings-prompt-summary">
            {includedCount} of {layers.length} prompt layers · {formatSize(preview.assembledPrompt)}{" "}
            text · {preview.tools.length} tool schema
            {preview.tools.length === 1 ? "" : "s"}
          </p>

          <div className="settings-prompt-stack" role="list" aria-label="System prompt layers">
            {layers.map((layer, index) => (
              <div key={layer.id} className="settings-prompt-stack__item" role="listitem">
                {index > 0 ? (
                  <div className="settings-prompt-stack__connector" aria-hidden>
                    <span className="settings-prompt-stack__plus">+</span>
                  </div>
                ) : null}
                <PromptLayerCard layer={layer} index={index} defaultOpen={false} />
              </div>
            ))}

            <div className="settings-prompt-stack__item" role="listitem">
              <div className="settings-prompt-stack__connector" aria-hidden>
                <span className="settings-prompt-stack__plus">=</span>
              </div>
              <div
                className={`settings-prompt-layer${showAssembled ? " settings-prompt-layer--open" : ""}`}
                data-testid="settings-system-prompt-layer-assembled"
              >
                <button
                  type="button"
                  className="settings-prompt-layer__header"
                  id={assembledHeadingId}
                  aria-expanded={showAssembled}
                  aria-controls={assembledPanelId}
                  data-testid="settings-system-prompt-assembled-toggle"
                  onClick={() => setShowAssembled((value) => !value)}
                >
                  <span className="settings-prompt-layer__index" aria-hidden>
                    {layers.length + 1}
                  </span>
                  <span className="settings-prompt-layer__titles">
                    <span className="settings-prompt-layer__title">Full assembled prompt</span>
                    <span className="settings-prompt-layer__source">
                      Concatenated in order above, sent as the system message
                    </span>
                  </span>
                  <span className="settings-prompt-layer__meta">
                    <span className="settings-prompt-layer__badge settings-prompt-layer__badge--size">
                      {formatSize(preview.assembledPrompt)}
                    </span>
                    <ChevronRight
                      size={14}
                      strokeWidth={2}
                      className={`settings-prompt-layer__caret${showAssembled ? " settings-prompt-layer__caret--open" : ""}`}
                      aria-hidden
                    />
                  </span>
                </button>
                <div
                  id={assembledPanelId}
                  role="region"
                  aria-labelledby={assembledHeadingId}
                  hidden={!showAssembled}
                  className="settings-prompt-layer__body"
                >
                  <textarea
                    readOnly
                    value={preview.assembledPrompt}
                    className="app-modal-input app-modal-input--multiline settings-system-prompt-preview"
                    rows={16}
                    aria-label="Full assembled system prompt"
                    data-testid="settings-system-prompt-assembled"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="settings-prompt-stack settings-prompt-stack--tools" aria-label="Request tools">
            <div className="settings-prompt-stack__item">
              <div className="settings-prompt-stack__connector" aria-hidden>
                <span className="settings-prompt-stack__plus">+</span>
              </div>
              <div
                className={`settings-prompt-layer${showTools ? " settings-prompt-layer--open" : ""}`}
                data-testid="settings-system-prompt-layer-tools"
              >
                <button
                  type="button"
                  className="settings-prompt-layer__header"
                  id={toolsHeadingId}
                  aria-expanded={showTools}
                  aria-controls={toolsPanelId}
                  data-testid="settings-system-prompt-tools-toggle"
                  onClick={() => setShowTools((value) => !value)}
                >
                  <span className="settings-prompt-layer__index" aria-hidden>
                    {layers.length + 2}
                  </span>
                  <span className="settings-prompt-layer__titles">
                    <span className="settings-prompt-layer__title">Tool schemas</span>
                    <span className="settings-prompt-layer__source">
                      request · tools[] from resources/contracts/tools.json — not inside the prompt text
                    </span>
                  </span>
                  <span className="settings-prompt-layer__meta">
                    <span className="settings-prompt-layer__badge">
                      {preview.tools.length} tool{preview.tools.length === 1 ? "" : "s"}
                    </span>
                    <ChevronRight
                      size={14}
                      strokeWidth={2}
                      className={`settings-prompt-layer__caret${showTools ? " settings-prompt-layer__caret--open" : ""}`}
                      aria-hidden
                    />
                  </span>
                </button>
                <div
                  id={toolsPanelId}
                  role="region"
                  aria-labelledby={toolsHeadingId}
                  hidden={!showTools}
                  className="settings-prompt-layer__body"
                >
                  {preview.tools.length > 0 ? (
                    <ul className="settings-prompt-tools">
                      {preview.tools.map((tool) => (
                        <li key={tool.name} className="settings-prompt-tools__item">
                          <code className="settings-prompt-tools__name">{tool.name}</code>
                          {tool.description ? (
                            <span className="settings-prompt-tools__desc">{tool.description}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="settings-prompt-layer__empty">No tools attached for this platform.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </SettingsGroup>
  );
}
