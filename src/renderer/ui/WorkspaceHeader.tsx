import { useEffect, useRef, useState, type ReactNode } from "react";

interface WorkspaceHeaderProps {
  /** Accessible name only; the app titlebar already names the page. */
  title: string;
  className?: string;
  innerClassName?: string;
  actions?: ReactNode;
  /** Centered row (e.g. a tab bar); spans the content width. */
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
        aria-label={title}
        className={joinClassNames(
          "workspace-header",
          stuck && "workspace-header--stuck",
          className,
        )}
      >
        {actions != null && (
          <div className={joinClassNames("workspace-header-inner", innerClassName)}>
            <div className="workspace-header-actions">{actions}</div>
          </div>
        )}
        {children != null && <div className="workspace-header-sub">{children}</div>}
      </header>
    </>
  );
}
