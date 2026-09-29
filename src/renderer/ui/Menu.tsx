import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { MENU_GAP_PX, placeMenu, type MenuPlacement, type MenuPosition } from "./menuPlacement";

/** Open menus, innermost last. Escape and outside clicks only act on the top one. */
const openMenus: HTMLElement[] = [];

/** Whether the latest user input was a key press, so keyboard opens focus the first item. */
let lastInputWasKeyboard = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (lastInputWasKeyboard = true), true);
  window.addEventListener("pointerdown", () => (lastInputWasKeyboard = false), true);
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Exit animation length; the portal unmounts after it (or immediately under reduced motion). */
const EXIT_MS = 90;
/** Pause after picking a radio/checkbox so the check lands before the menu fades. */
const CONFIRM_MS = 120;
const TYPEAHEAD_RESET_MS = 500;

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

interface MenuContextValue {
  close: () => void;
}

const MenuContext = createContext<MenuContextValue>({ close: () => {} });

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  /** Element the menu positions against; clicks on it do not count as outside clicks. */
  anchorRef: RefObject<HTMLElement | null>;
  placement?: MenuPlacement;
  gap?: number;
  /** Accessible name for the menu. */
  label: string;
  className?: string;
  /** Nested flyout: ArrowLeft closes it and returns focus to its row. */
  submenu?: boolean;
  testId?: string;
  children: ReactNode;
}

/**
 * Fixed-position, portaled dropdown menu with keyboard navigation, focus return,
 * viewport flipping, and a short enter/exit animation.
 */
export function Menu({
  open,
  onClose,
  anchorRef,
  placement = "bottom-start",
  gap = MENU_GAP_PX,
  label,
  className,
  submenu = false,
  testId,
  children,
}: MenuProps) {
  const [mounted, setMounted] = useState(open);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const typeahead = useRef({ text: "", at: 0 });

  // Stay mounted through the exit animation.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS + 40);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) setPosition(null);
  }, [mounted]);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    setPosition(
      placeMenu(
        anchor.getBoundingClientRect(),
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
        gap,
      ),
    );
  }, [anchorRef, placement, gap]);

  // Measure before paint, then follow the anchor through scrolls and resizes.
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, mounted, updatePosition]);

  // Focus in on open; hand focus back to the anchor on close if it was inside.
  useEffect(() => {
    const menu = menuRef.current;
    const anchor = anchorRef.current;
    if (!open || !mounted || !menu) return;
    if (lastInputWasKeyboard) {
      menu.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
    } else {
      menu.focus({ preventScroll: true });
    }
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body || menu.contains(active)) {
        anchor?.focus({ preventScroll: true });
      }
    };
  }, [open, mounted, anchorRef]);

  // Escape, Tab-away, and outside clicks close the topmost menu only.
  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !mounted || !menu) return;
    openMenus.push(menu);
    const isTop = () => openMenus[openMenus.length - 1] === menu;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isTop()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCloseRef.current();
    };
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target || anchorRef.current?.contains(target)) return;
      const depth = openMenus.indexOf(menu);
      if (openMenus.slice(depth).some((m) => m.contains(target))) return;
      onCloseRef.current();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onPointerDown, true);
      const index = openMenus.indexOf(menu);
      if (index >= 0) openMenus.splice(index, 1);
    };
  }, [open, mounted, anchorRef]);

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []).filter(
      (el) => !(el as HTMLButtonElement).disabled,
    );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus({ preventScroll: true });
    // Portaled content still bubbles through React ancestors (e.g. the composer's Shift+Tab), so
    // keys the menu handles stop here; everything else (app shortcuts) passes through.
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    switch (e.key) {
      case "ArrowDown":
        handled();
        focusAt(index < 0 ? 0 : index + 1);
        return;
      case "ArrowUp":
        handled();
        focusAt(index < 0 ? list.length - 1 : index - 1);
        return;
      case "Home":
        handled();
        focusAt(0);
        return;
      case "End":
        handled();
        focusAt(list.length - 1);
        return;
      case "ArrowLeft":
        if (submenu) {
          handled();
          onCloseRef.current();
        }
        return;
      case "Tab":
        handled();
        onCloseRef.current();
        return;
    }

    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== " ") {
      const now = Date.now();
      const buffer = typeahead.current;
      buffer.text = now - buffer.at > TYPEAHEAD_RESET_MS ? e.key.toLowerCase() : buffer.text + e.key.toLowerCase();
      buffer.at = now;
      const ordered = [...list.slice(index + 1), ...list.slice(0, index + 1)];
      const match =
        ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(buffer.text)) ??
        ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (match) {
        handled();
        match.focus({ preventScroll: true });
      }
    }
  };

  // Pointer and keyboard share one highlight: hovering an item focuses it.
  const onMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(ITEM_SELECTOR);
    if (item && item !== document.activeElement && !(item as HTMLButtonElement).disabled) {
      item.focus({ preventScroll: true });
    }
  };

  const close = useCallback(() => onCloseRef.current(), []);

  if (!mounted) return null;

  return createPortal(
    <MenuContext.Provider value={{ close }}>
      <div
        ref={menuRef}
        className={["ui-menu", className].filter(Boolean).join(" ")}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        data-state={open ? "open" : "closed"}
        data-side={position?.side ?? "bottom"}
        data-testid={testId}
        style={
          position
            ? { top: position.top, left: position.left }
            : { top: 0, left: 0, visibility: "hidden" }
        }
        onKeyDown={onKeyDown}
        onMouseMove={onMouseMove}
      >
        {children}
      </div>
    </MenuContext.Provider>,
    document.body,
  );
}

interface MenuItemBaseProps {
  icon?: ReactNode;
  /** Right-aligned hint, e.g. a keyboard shortcut or current value. */
  trailing?: ReactNode;
  disabled?: boolean;
  title?: string;
  testId?: string;
  children: ReactNode;
}

export interface MenuItemProps extends MenuItemBaseProps {
  onSelect?: () => void;
  danger?: boolean;
  /** Leave the menu open after selecting (e.g. a row that opens a flyout). */
  keepOpen?: boolean;
  /** Flyout trigger props. */
  hasSubmenu?: boolean;
  submenuOpen?: boolean;
  onMouseEnter?: () => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  itemRef?: Ref<HTMLButtonElement>;
}

export function MenuItem({
  icon,
  trailing,
  disabled,
  title,
  testId,
  children,
  onSelect,
  danger,
  keepOpen,
  hasSubmenu,
  submenuOpen,
  onMouseEnter,
  onKeyDown,
  itemRef,
}: MenuItemProps) {
  const { close } = useContext(MenuContext);
  return (
    <button
      ref={itemRef}
      type="button"
      role="menuitem"
      className={[
        "ui-menu__item",
        danger ? "ui-menu__item--danger" : "",
        submenuOpen ? "ui-menu__item--expanded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      title={title}
      data-testid={testId}
      aria-haspopup={hasSubmenu ? "menu" : undefined}
      aria-expanded={hasSubmenu ? Boolean(submenuOpen) : undefined}
      onMouseEnter={onMouseEnter}
      onKeyDown={onKeyDown}
      onClick={() => {
        onSelect?.();
        if (!keepOpen && !hasSubmenu) close();
      }}
    >
      {icon ? (
        <span className="ui-menu__icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="ui-menu__label">{children}</span>
      {trailing != null ? <span className="ui-menu__trailing">{trailing}</span> : null}
    </button>
  );
}

export interface MenuCheckItemProps extends MenuItemBaseProps {
  checked: boolean;
  onSelect: () => void;
  /** `radio` for one-of-many (default), `checkbox` for toggles. */
  kind?: "radio" | "checkbox";
  /** Called after the confirm pause instead of the menu's own close (e.g. to close a whole flyout tree). */
  onClose?: () => void;
}

/** A selectable option; the check animates in, then the menu closes after a short confirm pause. */
export function MenuCheckItem({
  icon,
  trailing,
  disabled,
  title,
  testId,
  children,
  checked,
  onSelect,
  kind = "radio",
  onClose,
}: MenuCheckItemProps) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      role={kind === "radio" ? "menuitemradio" : "menuitemcheckbox"}
      aria-checked={checked}
      className="ui-menu__item"
      disabled={disabled}
      title={title}
      data-testid={testId}
      onClick={() => {
        onSelect();
        const done = onClose ?? close;
        if (prefersReducedMotion()) done();
        else window.setTimeout(done, CONFIRM_MS);
      }}
    >
      {icon ? (
        <span className="ui-menu__icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="ui-menu__label">{children}</span>
      {trailing != null ? <span className="ui-menu__trailing">{trailing}</span> : null}
      <span className="ui-menu__check" data-checked={checked || undefined} aria-hidden>
        <Check size={14} />
      </span>
    </button>
  );
}

export function MenuSeparator() {
  return <div className="ui-menu__separator" role="separator" />;
}

/** Non-interactive block at the top of a menu (e.g. note metadata). */
export function MenuHeader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-menu__header" role="group" aria-label={label}>
      {children}
    </div>
  );
}
