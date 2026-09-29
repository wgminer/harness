import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Menu, MenuCheckItem, MenuItem, MenuSeparator } from "../ui/Menu";
import { HEX_SCRAMBLE_HOVER } from "../setup/hexScrambleReveal";
import { useHexScrambleReveal } from "../setup/useHexScrambleReveal";
import {
  SIDEBAR_LIBRARY_FILTERS,
  SIDEBAR_LIST_SORT_MODES,
  sidebarLibraryFilterLabel,
  sidebarListSortModeLabel,
  type SidebarLibraryFilter,
  type SidebarListSortMode,
} from "./sidebarUtils";

type Submenu = "show" | "group";

/** Hover delay before swapping flyouts, so a diagonal path to the open one does not switch it. */
const SUBMENU_SWITCH_DELAY_MS = 120;

interface SidebarListMenuProps {
  /** The list's first group label, which doubles as the menu trigger. */
  label: ReactNode;
  title?: string;
  filter: SidebarLibraryFilter;
  onFilterChange: (filter: SidebarLibraryFilter) => void;
  sortMode: SidebarListSortMode;
  onSortModeChange: (mode: SidebarListSortMode) => void;
}

/** Sidebar list options: Show (item kind) and Group by, each as a flyout submenu. */
export function SidebarListMenu({
  label,
  title,
  filter,
  onFilterChange,
  sortMode,
  onSortModeChange,
}: SidebarListMenuProps) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu | null>(null);
  const [hovered, setHovered] = useState(false);
  const textLabel = typeof label === "string" ? label : "";
  const scramble = useHexScrambleReveal(textLabel, hovered && textLabel !== "", HEX_SCRAMBLE_HOVER);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const showRowRef = useRef<HTMLButtonElement | null>(null);
  const groupRowRef = useRef<HTMLButtonElement | null>(null);
  const switchTimer = useRef<number | undefined>(undefined);

  const close = () => {
    window.clearTimeout(switchTimer.current);
    setOpen(false);
    setSubmenu(null);
  };

  useEffect(() => () => window.clearTimeout(switchTimer.current), []);

  const hoverRow = (key: Submenu) => {
    window.clearTimeout(switchTimer.current);
    if (submenu === null) {
      setSubmenu(key);
      return;
    }
    if (submenu === key) return;
    switchTimer.current = window.setTimeout(() => setSubmenu(key), SUBMENU_SWITCH_DELAY_MS);
  };

  const filtered = filter !== "all";

  const renderRow = (key: Submenu, label: string, value: string) => (
    <MenuItem
      itemRef={key === "show" ? showRowRef : groupRowRef}
      testId={`sidebar-list-menu-${key}`}
      hasSubmenu
      submenuOpen={submenu === key}
      trailing={
        <>
          {value}
          <ChevronRight size={14} aria-hidden />
        </>
      }
      onMouseEnter={() => hoverRow(key)}
      onSelect={() => setSubmenu((s) => (s === key ? null : key))}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setSubmenu(key);
        }
      }}
    >
      {label}
    </MenuItem>
  );

  const renderSubmenu = (key: Submenu) => (
    <Menu
      open={open && submenu === key}
      onClose={() => setSubmenu(null)}
      anchorRef={key === "show" ? showRowRef : groupRowRef}
      placement="right-start"
      gap={6}
      label={key === "show" ? "Show" : "Group by"}
      className="sidebar-list-submenu"
      submenu
      onMouseEnter={() => window.clearTimeout(switchTimer.current)}
    >
      {key === "show"
        ? SIDEBAR_LIBRARY_FILTERS.map(({ value: v, label: l }) => (
            <MenuCheckItem
              key={v}
              checked={filter === v}
              testId={`sidebar-filter-${v}`}
              onSelect={() => onFilterChange(v)}
              onClose={close}
            >
              {l}
            </MenuCheckItem>
          ))
        : SIDEBAR_LIST_SORT_MODES.map(({ value: v, label: l }) => (
            <MenuCheckItem
              key={v}
              checked={sortMode === v}
              testId={`sidebar-group-${v}`}
              onSelect={() => onSortModeChange(v)}
              onClose={close}
            >
              {l}
            </MenuCheckItem>
          ))}
    </Menu>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={[
          "sidebar-list-menu__trigger",
          filtered ? "sidebar-list-menu__trigger--filtered" : "",
          open ? "sidebar-list-menu__trigger--open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="sidebar-list-sort-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? (filtered ? `Showing ${sidebarLibraryFilterLabel(filter).toLowerCase()}` : "List options")}
        onClick={() => (open ? close() : setOpen(true))}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {textLabel ? (
          // The real label holds the width; the scramble overlays it so the chevron stays put.
          <span className="sidebar-list-menu__trigger-label sidebar-list-menu__trigger-label--scramble">
            <span className="sidebar-list-menu__trigger-label-sizer">{textLabel}</span>
            <span className="sidebar-list-menu__trigger-label-glyphs" aria-hidden>
              {scramble.display}
            </span>
          </span>
        ) : (
          <span className="sidebar-list-menu__trigger-label">{label}</span>
        )}
        <ChevronDown size={12} className="sidebar-list-menu__chevron" aria-hidden />
      </button>
      <Menu open={open} onClose={close} anchorRef={triggerRef} label="List options" className="sidebar-list-options-menu">
        {renderRow("show", "Show", sidebarLibraryFilterLabel(filter))}
        <MenuSeparator />
        {renderRow("group", "Group by", sidebarListSortModeLabel(sortMode))}
      </Menu>
      {renderSubmenu("show")}
      {renderSubmenu("group")}
    </>
  );
}
