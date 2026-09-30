import { useEffect, useRef, useState, type ReactNode } from "react";

interface WorkspaceHeaderProps {
  title: string;
  className?: string;
  innerClassName?: string;
  titleRowClassName?: string;
  titleClassName?: string;
  actions?: ReactNode;
  /** Second row under the title (e.g. a tab bar); spans the content width. */
  children?: ReactNode;
}

function joinClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Sticky page header; shows a divider once the scroll container moves past its top. */
export function WorkspaceHeader({
  title,
  className,
  innerClassName,
  titleRowClassName,
  titleClassName,
  actions,
  children,
}: WorkspaceHeaderProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} className="workspace-header-sentinel" aria-hidden />
      <header
        className={joinClassNames(
          "workspace-header",
          stuck && "workspace-header--stuck",
          children != null && "workspace-header--with-sub",
          className,
        )}
      >
        <div className={joinClassNames("workspace-header-inner", innerClassName)}>
          <div className={joinClassNames("workspace-header-title-row", titleRowClassName)}>
            <h1 className={joinClassNames("workspace-title", titleClassName)}>{title}</h1>
          </div>
          {actions != null && <div className="workspace-header-actions">{actions}</div>}
        </div>
        {children != null && <div className="workspace-header-sub">{children}</div>}
      </header>
    </>
  );
}
