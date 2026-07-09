/*
 * Custom layout directives the assistant can use in chat messages.
 *
 * The grammar is `:::name{attr="val"}` for blocks and `:name[label]{attr=val}` inline,
 * powered by `remark-directive`. A small remark transform (`remarkDirectiveToHast`) maps
 * each known directive name onto a custom-element hast node (`md-tip`, `md-option`, …)
 * which `react-markdown` then dispatches to the component map exported here.
 *
 * Nesting rule (the only foot-gun): a container's outer fence must use MORE colons
 * than any container it wraps. So `:::options` needs to wrap `:::option` with
 * `::::options` … `::::`. The system prompt teaches this.
 */
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Lightbulb,
} from "lucide-react";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";

/**
 * Directives we render. Anything not in this set falls back to plain prose
 * so a typo from the model never breaks the bubble.
 */
const KNOWN_DIRECTIVES = new Set([
  "tip",
  "note",
  "warning",
  "danger",
  "details",
  "chip",
  "link",
  "options",
  "option",
  "slides",
  "slide",
]);

/**
 * remark transform: rewrite directive nodes into hast custom elements so
 * `react-markdown`'s `components` map can pick them up by tag name. Unknown
 * directives degrade to a passthrough span/div so their content still renders.
 */
export const remarkDirectiveToHast: Plugin<[], Root> = () => (tree) => {
  visit(tree, (node) => {
    if (
      node.type !== "textDirective" &&
      node.type !== "leafDirective" &&
      node.type !== "containerDirective"
    ) {
      return;
    }
    const directive = node as {
      type: string;
      name?: string;
      attributes?: Record<string, string | null | undefined> | null;
      data?: { hName?: string; hProperties?: Record<string, unknown> };
    };
    const name = String(directive.name ?? "").toLowerCase();
    const data = directive.data ?? (directive.data = {});
    if (!KNOWN_DIRECTIVES.has(name)) {
      data.hName = directive.type === "textDirective" ? "span" : "div";
      data.hProperties = { "data-unknown-directive": name || "unknown" };
      return;
    }
    data.hName = `md-${name}`;
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(directive.attributes ?? {})) {
      attrs[key] = value == null ? "" : String(value);
    }
    data.hProperties = attrs;
  });
};

interface CommonProps {
  children?: ReactNode;
}

export interface MarkdownInteractionContextValue {
  onOptionSelect?: (label: string) => void | Promise<void>;
}

export const MarkdownInteractionContext = createContext<MarkdownInteractionContextValue>({});

function joinClass(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function CalloutBase({
  variant,
  children,
}: {
  variant: "tip" | "note" | "warning" | "danger";
  children?: ReactNode;
}) {
  const meta = CALLOUT_META[variant];
  const Icon = meta.icon;
  return (
    <aside className={joinClass("md-callout", `md-callout--${variant}`)} role="note">
      <span className="md-callout__icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <div className="md-callout__body">
        <div className="md-callout__title">{meta.label}</div>
        <div className="md-callout__content">{children}</div>
      </div>
    </aside>
  );
}

const CALLOUT_META = {
  tip: { label: "Tip", icon: Lightbulb },
  note: { label: "Note", icon: Info },
  warning: { label: "Warning", icon: AlertTriangle },
  danger: { label: "Danger", icon: AlertOctagon },
} as const;

const MdTip = ({ children }: CommonProps) => <CalloutBase variant="tip">{children}</CalloutBase>;
const MdNote = ({ children }: CommonProps) => <CalloutBase variant="note">{children}</CalloutBase>;
const MdWarning = ({ children }: CommonProps) => (
  <CalloutBase variant="warning">{children}</CalloutBase>
);
const MdDanger = ({ children }: CommonProps) => <CalloutBase variant="danger">{children}</CalloutBase>;

function MdDetails({ summary, children }: CommonProps & { summary?: string }) {
  return (
    <details className="md-details">
      <summary className="md-details__summary">{summary || "Details"}</summary>
      <div className="md-details__body">{children}</div>
    </details>
  );
}

const CHIP_TONES = new Set(["info", "warn", "danger", "success", "neutral"]);

function MdChip({ tone, children }: CommonProps & { tone?: string }) {
  const t = tone && CHIP_TONES.has(tone) ? tone : "neutral";
  return <span className={joinClass("md-chip", `md-chip--${t}`)}>{children}</span>;
}

function safeHostname(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function MdLink({
  url,
  title,
  desc,
  site,
}: {
  url?: string;
  title?: string;
  desc?: string;
  site?: string;
}) {
  if (!url) return null;
  const host = safeHostname(url);
  if (!host) return null;
  const heading = title?.trim() || host;
  const source = site?.trim() || host;
  return (
    <a
      className="md-link-card"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
    >
      <span className="md-link-card__site">
        <span className="md-link-card__site-text">{source}</span>
        <ExternalLink size={12} aria-hidden />
      </span>
      <span className="md-link-card__title">{heading}</span>
      {desc ? <span className="md-link-card__desc">{desc}</span> : null}
    </a>
  );
}

function MdOptions({ children }: CommonProps) {
  return <div className="md-options">{children}</div>;
}

function MdOption({ title }: { title?: string }) {
  const { onOptionSelect } = useContext(MarkdownInteractionContext);
  const label = title?.trim() || "Option";
  if (onOptionSelect) {
    return (
      <button
        type="button"
        className="btn md-option-btn"
        onClick={() => void onOptionSelect(label)}
      >
        {label}
      </button>
    );
  }
  return <span className="btn md-option-btn md-option-btn--static">{label}</span>;
}
(MdOption as ComponentType & { displayName?: string }).displayName = "MdOption";

const SLIDE_LAYOUTS = new Set(["title", "bullets", "quote", "blank"]);

function MdSlides({ children }: CommonProps) {
  const slides = useMemo(
    () =>
      Children.toArray(children).filter(
        (c) => isValidElement(c) && (c.type as { displayName?: string }).displayName === "MdSlide",
      ),
    [children],
  );
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(slides.length - 1, 0));
  const prev = useCallback(
    () => setIndex((i) => Math.max(0, i - 1)),
    [],
  );
  const next = useCallback(
    () => setIndex((i) => Math.min(slides.length - 1, i + 1)),
    [slides.length],
  );

  if (slides.length === 0) return null;
  const showNav = slides.length > 1;
  return (
    <section
      className="md-slides"
      role="group"
      aria-roledescription="carousel"
      aria-label="Slide deck"
    >
      <div className="md-slides__stage">{slides[safeIndex]}</div>
      {showNav ? (
        <nav className="md-slides__nav" aria-label="Slide navigation">
          <button
            type="button"
            className="md-slides__btn"
            onClick={prev}
            disabled={safeIndex === 0}
            aria-label="Previous slide"
          >
            <ChevronLeft size={14} aria-hidden />
          </button>
          <span className="md-slides__dots" role="tablist" aria-label="Slides">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === safeIndex}
                aria-label={`Go to slide ${i + 1}`}
                className={joinClass(
                  "md-slides__dot",
                  i === safeIndex && "md-slides__dot--active",
                )}
                onClick={() => setIndex(i)}
              />
            ))}
          </span>
          <span className="md-slides__count">
            {safeIndex + 1} / {slides.length}
          </span>
          <button
            type="button"
            className="md-slides__btn"
            onClick={next}
            disabled={safeIndex === slides.length - 1}
            aria-label="Next slide"
          >
            <ChevronRight size={14} aria-hidden />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function MdSlide({
  layout,
  title,
  subtitle,
  attribution,
  children,
}: CommonProps & {
  layout?: string;
  title?: string;
  subtitle?: string;
  attribution?: string;
}) {
  const kind = layout && SLIDE_LAYOUTS.has(layout) ? layout : "blank";
  return (
    <article
      className={joinClass("md-slide", `md-slide--${kind}`)}
      data-slide-layout={kind}
    >
      {kind === "title" ? (
        <div className="md-slide__title-block">
          <h2 className="md-slide__title-text">{title}</h2>
          {subtitle ? <p className="md-slide__subtitle">{subtitle}</p> : null}
        </div>
      ) : kind === "quote" ? (
        <blockquote className="md-slide__quote">
          <div className="md-slide__quote-mark" aria-hidden="true">
            &ldquo;
          </div>
          <div className="md-slide__quote-body">{children}</div>
          {attribution ? (
            <footer className="md-slide__quote-attr">{attribution}</footer>
          ) : null}
        </blockquote>
      ) : (
        <>
          {title ? <header className="md-slide__header">{title}</header> : null}
          <div className={joinClass("md-slide__body", `md-slide__body--${kind}`)}>
            {children}
          </div>
        </>
      )}
    </article>
  );
}
(MdSlide as ComponentType & { displayName?: string }).displayName = "MdSlide";

/**
 * Lazy-loaded mermaid renderer. We intercept fenced ```mermaid blocks at the
 * `pre` component level (see `chatHelpers.tsx`) and hand the source string here.
 */
export function MermaidBlock({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(
    `md-mermaid-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`,
  );
  const trimmed = source.replace(/^\n+|\n+$/g, "");

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    if (!trimmed) return;
    (async () => {
      try {
        const mod = await import("mermaid");
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(idRef.current, trimmed);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg.split("\n")[0].slice(0, 200));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trimmed]);

  if (error) {
    return (
      <div className="md-mermaid md-mermaid--error">
        <div className="md-mermaid__error" role="alert">
          Diagram error: {error}
        </div>
        <pre>
          <code>{trimmed}</code>
        </pre>
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="md-mermaid md-mermaid--loading" ref={containerRef}>
        Rendering diagram&hellip;
      </div>
    );
  }
  return (
    <div
      className="md-mermaid"
      ref={containerRef}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Mapping consumed by `react-markdown`'s `components` prop. Cast through
 * `unknown` because TS only models standard HTML tags here, not our `md-*`
 * custom elements.
 */
export const directiveComponents: Record<string, ComponentType<Record<string, unknown>>> = {
  "md-tip": MdTip as ComponentType<Record<string, unknown>>,
  "md-note": MdNote as ComponentType<Record<string, unknown>>,
  "md-warning": MdWarning as ComponentType<Record<string, unknown>>,
  "md-danger": MdDanger as ComponentType<Record<string, unknown>>,
  "md-details": MdDetails as ComponentType<Record<string, unknown>>,
  "md-chip": MdChip as ComponentType<Record<string, unknown>>,
  "md-link": MdLink as ComponentType<Record<string, unknown>>,
  "md-options": MdOptions as ComponentType<Record<string, unknown>>,
  "md-option": MdOption as ComponentType<Record<string, unknown>>,
  "md-slides": MdSlides as ComponentType<Record<string, unknown>>,
  "md-slide": MdSlide as ComponentType<Record<string, unknown>>,
};
