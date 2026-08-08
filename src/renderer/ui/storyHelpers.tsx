import type { CSSProperties, ReactNode } from "react";

export const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-3)",
};

export const stackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  width: "100%",
  maxWidth: 720,
};

export const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  marginBottom: "var(--space-5)",
};

export const labelStyle: CSSProperties = {
  fontSize: "var(--font-size-ui)",
  color: "var(--fg-muted)",
  fontFamily: "var(--font-family-mono)",
};

export function Section({
  title,
  children,
  stack = false,
}: {
  title: string;
  children: ReactNode;
  stack?: boolean;
}) {
  return (
    <section style={sectionStyle}>
      <div style={labelStyle}>{title}</div>
      <div style={stack ? stackStyle : rowStyle}>{children}</div>
    </section>
  );
}

/** Markdown directive / message prose styles are scoped under these wrappers. */
export function MessageContent({
  children,
  assistant = true,
}: {
  children: ReactNode;
  assistant?: boolean;
}) {
  return (
    <div className={`message-block${assistant ? " assistant" : ""}`}>
      <div className="content">{children}</div>
    </div>
  );
}

export function SettingsFrame({ children }: { children: ReactNode }) {
  return (
    <div className="settings-page" style={{ maxWidth: 640 }}>
      <div className="settings-group">
        <div className="settings-group__content">{children}</div>
      </div>
    </div>
  );
}
