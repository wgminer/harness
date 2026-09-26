import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, ListFilter } from "lucide-react";
import { useDismissible } from "../hooks/useDismissible";
import {
  SIDEBAR_LIBRARY_FILTERS,
  SIDEBAR_LIST_SORT_MODES,
  sidebarLibraryFilterLabel,
  sidebarListSortModeLabel,
  type SidebarLibraryFilter,
  type SidebarListSortMode,
} from "./sidebarUtils";

type Submenu = "show" | "group";

interface SidebarListMenuProps {
  filter: SidebarLibraryFilter;
  onFilterChange: (filter: SidebarLibraryFilter) => void;
  sortMode: SidebarListSortMode;
  onSortModeChange: (mode: SidebarListSortMode) => void;
}

/** Sidebar list options: Show (item kind) and Group by, each as a flyout submenu. */
export function SidebarListMenu({
  filter,
  onFilterChange,
  sortMode,
  onSortModeChange,
}: SidebarListMenuProps) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = () => {
    setOpen(false);
    setSubmenu(null);
  };

  useDismissible({ open, onDismiss: close, refs: [triggerRef, menuRef], pointerEvent: "mousedown" });

  // The list scrolls (and clips), so the menu is fixed-positioned under the trigger.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

  const filtered = filter !== "all";

  const renderRow = (key: Submenu, label: string, value: string) => (
    <div
      className="sidebar-list-menu__row-wrap"
      onMouseEnter={() => setSubmenu(key)}
    >
      <button
        type="button"
        className={`sidebar-list-menu__item${submenu === key ? " sidebar-list-menu__item--open" : ""}`}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={submenu === key}
        data-testid={`sidebar-list-menu-${key}`}
        onClick={() => setSubmenu((s) => (s === key ? null : key))}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setSubmenu(key);
          if (e.key === "ArrowLeft") setSubmenu(null);
        }}
      >
        <span>{label}</span>
        <span className="sidebar-list-menu__value">
          {value}
          <ChevronRight size={14} aria-hidden />
        </span>
      </button>
      {submenu === key ? (
        <div className="sidebar-list-menu sidebar-list-menu--sub" role="menu" aria-label={label}>
          {key === "show"
            ? SIDEBAR_LIBRARY_FILTERS.map(({ value: v, label: l }) => (
                <OptionItem
                  key={v}
                  label={l}
                  selected={filter === v}
                  testId={`sidebar-filter-${v}`}
                  onSelect={() => {
                    onFilterChange(v);
                    close();
                  }}
                />
              ))
            : SIDEBAR_LIST_SORT_MODES.map(({ value: v, label: l }) => (
                <OptionItem
                  key={v}
                  label={l}
                  selected={sortMode === v}
                  testId={`sidebar-group-${v}`}
                  onSelect={() => {
                    onSortModeChange(v);
                    close();
                  }}
                />
              ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={[
          "btn btn-icon sidebar-group-sort-toggle",
          filtered ? "sidebar-group-sort-toggle--active" : "",
          open ? "sidebar-group-sort-toggle--open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="sidebar-list-sort-toggle"
        aria-label="List options"
        aria-haspopup="menu"
        aria-expanded={open}
        title={filtered ? `Showing ${sidebarLibraryFilterLabel(filter).toLowerCase()}` : "List options"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <ListFilter size={10} aria-hidden />
      </button>
      {open && position ? (
        <div
          ref={menuRef}
          className="sidebar-list-menu"
          role="menu"
          aria-label="List options"
          style={{ top: position.top, left: position.left }}
        >
          {renderRow("show", "Show", sidebarLibraryFilterLabel(filter))}
          <div className="sidebar-list-menu__divider" role="separator" />
          {renderRow("group", "Group by", sidebarListSortModeLabel(sortMode))}
        </div>
      ) : null}
    </>
  );
}

function OptionItem({
  label,
  selected,
  testId,
  onSelect,
}: {
  label: string;
  selected: boolean;
  testId: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="sidebar-list-menu__item"
      role="menuitemradio"
      aria-checked={selected}
      data-testid={testId}
      onClick={onSelect}
    >
      <span>{label}</span>
      {selected ? <Check size={14} className="sidebar-list-menu__check" aria-hidden /> : null}
    </button>
  );
}
