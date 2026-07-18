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
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  AlertOctagon,
  AlertTriangle,
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
};
