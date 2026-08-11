/** Distance from the library edge that starts contributing peek (px). */
export const LIBRARY_PEEK_ZONE_PX = 220;

/**
 * Cap on proximity peek as a 0–1 fraction of dock travel.
 * Runtime tuning prefers {@link LIBRARY_PEEK_MAX_SCREEN_RATIO} instead.
 */
export const LIBRARY_PEEK_MAX = 0.72;

/**
 * Dock slide travel in px — matches `.sidebar-dock` transform
 * `translateX((±100% + 8px) * …)` with width `sidebar (70×4) + space-3 (3×4)`.
 */
export const LIBRARY_DOCK_TRAVEL_PX = 70 * 4 + 3 * 4 + 8;

/**
 * Cap on proximity peek as a fraction of viewport width.
 * Converted to dock-travel fraction at runtime via {@link libraryPeekMaxFraction}.
 */
export const LIBRARY_PEEK_MAX_SCREEN_RATIO = 0.065;

/** How far past the target the spring display may travel (visible bounce). */
export const LIBRARY_PEEK_OVERSHOOT = 0.14;

/** Spring stiffness (higher = snappier). */
export const LIBRARY_PEEK_STIFFNESS = 320;

/** Spring damping (lower = more bounce). */
export const LIBRARY_PEEK_DAMPING = 16;

/** CSS open duration when hover/pin fully opens the dock (ms). */
export const LIBRARY_LATCH_DURATION_MS = 420;

/** Delay before unpinned hover-open closes after pointer leave (ms). */
export const LIBRARY_HOVER_CLOSE_DELAY_MS = 0;

/**
 * Keep hover-open / peek alive while the pointer is parked on the library
 * frame edge. Latch CSS easing overshoots past translateX(0), which can drop
 * hit-testing off a cursor at x≈0; OS edge clamping also flips deltaX.
 */
export const LIBRARY_EDGE_HOLD_PX = 16;

/** Ignore sub-pixel jitter when deciding pointer direction. */
export const LIBRARY_PEEK_DIRECTION_EPSILON_PX = 0.5;

export type LibrarySidebarSide = "left" | "right";

export type LibraryPeekSpring = {
  value: number;
  velocity: number;
};

export type LibraryPeekSpringParams = {
  stiffness: number;
  damping: number;
  overshoot: number;
  /** Proximity peek cap as 0–1 of dock travel (spring / CSS). */
  peekMax: number;
};

export type LibraryPeekTuning = {
  stiffness: number;
  damping: number;
  overshoot: number;
  /** How far the dock may stick out during proximity peek, as a fraction of viewport width. */
  peekMaxScreenRatio: number;
  zonePx: number;
  latchDurationMs: number;
  hoverCloseDelayMs: number;
};

export const DEFAULT_LIBRARY_PEEK_TUNING: LibraryPeekTuning = {
  stiffness: LIBRARY_PEEK_STIFFNESS,
  damping: LIBRARY_PEEK_DAMPING,
  overshoot: LIBRARY_PEEK_OVERSHOOT,
  peekMaxScreenRatio: LIBRARY_PEEK_MAX_SCREEN_RATIO,
  zonePx: LIBRARY_PEEK_ZONE_PX,
  latchDurationMs: LIBRARY_LATCH_DURATION_MS,
  hoverCloseDelayMs: LIBRARY_HOVER_CLOSE_DELAY_MS,
};

/**
 * Convert a viewport-width ratio → 0–1 dock-travel fraction used by the spring / CSS.
 * Capped at full dock open.
 */
export function libraryPeekMaxFraction(
  screenRatio: number,
  viewportWidth: number,
  travelPx = LIBRARY_DOCK_TRAVEL_PX,
): number {
  if (travelPx <= 0 || viewportWidth <= 0) return 0;
  const peekPx = Math.max(0, screenRatio) * viewportWidth;
  return Math.min(1, peekPx / travelPx);
}

export type LibraryPeekTargetInput = {
  x: number;
  viewportWidth: number;
  side: LibrarySidebarSide;
  zonePx?: number;
  peekMax?: number;
  /**
   * When false, suppress peek — cursor is not moving toward the library edge.
   * Omit / true keeps proximity behavior (tests and pinned paths).
   */
  movingToward?: boolean;
};

export function libraryEdgeDistance(
  x: number,
  viewportWidth: number,
  side: LibrarySidebarSide,
): number {
  if (side === "left") return Math.max(0, x);
  return Math.max(0, viewportWidth - x);
}

/** True when `deltaX` is toward the library edge for `side`. */
export function isPointerMovingTowardLibrary(
  deltaX: number,
  side: LibrarySidebarSide,
): boolean {
  if (side === "left") return deltaX < 0;
  return deltaX > 0;
}

/**
 * True when the pointer is parked on the library side of the app frame.
 * Uses frame bounds (not the transformed dock) so latch overshoot cannot
 * clear hover keep-alive.
 */
export function isPointerInLibraryEdgeKeepAlive(input: {
  clientX: number;
  side: LibrarySidebarSide;
  frameLeft: number;
  frameRight: number;
  holdPx?: number;
}): boolean {
  const holdPx = input.holdPx ?? LIBRARY_EDGE_HOLD_PX;
  if (input.side === "left") {
    return input.clientX <= input.frameLeft + holdPx;
  }
  return input.clientX >= input.frameRight - holdPx;
}

/**
 * Sticky "moving toward" intent for peek gating.
 * Clears outside the peek zone; ignores jitter smaller than epsilon.
 * Stays true while parked on the edge so clamp jitter cannot collapse peek.
 */
export function updateLibraryPeekTowardIntent(input: {
  distance: number;
  deltaX: number;
  side: LibrarySidebarSide;
  previousToward: boolean;
  zonePx?: number;
  epsilonPx?: number;
  edgeHoldPx?: number;
}): boolean {
  const zonePx = input.zonePx ?? LIBRARY_PEEK_ZONE_PX;
  const epsilonPx = input.epsilonPx ?? LIBRARY_PEEK_DIRECTION_EPSILON_PX;
  const edgeHoldPx = input.edgeHoldPx ?? LIBRARY_EDGE_HOLD_PX;
  if (input.distance > zonePx) return false;
  if (input.distance <= edgeHoldPx) return true;
  if (Math.abs(input.deltaX) < epsilonPx) return input.previousToward;
  return isPointerMovingTowardLibrary(input.deltaX, input.side);
}

/**
 * Map edge distance → peek target in [0, peekMax].
 * Smoothstep so early approach is subtle.
 */
export function peekFromDistance(
  distance: number,
  zonePx = LIBRARY_PEEK_ZONE_PX,
  peekMax = LIBRARY_PEEK_MAX,
): number {
  if (zonePx <= 0) return peekMax;
  const t = 1 - Math.min(1, Math.max(0, distance) / zonePx);
  const smooth = t * t * (3 - 2 * t);
  return smooth * peekMax;
}

/** Proximity peek target — full open is dock hover, not edge latch. */
export function computeLibraryPeekTarget(input: LibraryPeekTargetInput): number {
  if (input.movingToward === false) return 0;
  const zonePx = input.zonePx ?? LIBRARY_PEEK_ZONE_PX;
  const peekMax = input.peekMax ?? LIBRARY_PEEK_MAX;
  const distance = libraryEdgeDistance(input.x, input.viewportWidth, input.side);
  return peekFromDistance(distance, zonePx, peekMax);
}

export function initialLibraryPeekSpring(value = 0): LibraryPeekSpring {
  return { value, velocity: 0 };
}

export function libraryPeekSpringSettled(
  spring: LibraryPeekSpring,
  target: number,
  epsilon = 0.0015,
): boolean {
  return Math.abs(spring.value - target) < epsilon && Math.abs(spring.velocity) < epsilon;
}

/**
 * Underdamped spring step toward `target`.
 * `dtSeconds` should be clamped (e.g. ≤ 1/30) by the caller.
 */
export function stepLibraryPeekSpring(
  spring: LibraryPeekSpring,
  target: number,
  dtSeconds: number,
  params?: Partial<LibraryPeekSpringParams>,
): LibraryPeekSpring {
  const stiffness = params?.stiffness ?? LIBRARY_PEEK_STIFFNESS;
  const damping = params?.damping ?? LIBRARY_PEEK_DAMPING;
  const overshoot = params?.overshoot ?? LIBRARY_PEEK_OVERSHOOT;
  const peekMax = params?.peekMax ?? LIBRARY_PEEK_MAX;
  const accel = stiffness * (target - spring.value) - damping * spring.velocity;
  const velocity = spring.velocity + accel * dtSeconds;
  let value = spring.value + velocity * dtSeconds;

  const max = peekMax + overshoot;
  if (value < 0) {
    value = 0;
    return { value, velocity: Math.max(0, velocity) };
  }
  if (target < 1 && value > max) {
    value = max;
    return { value, velocity: Math.min(0, velocity) };
  }
  if (value > 1) {
    value = 1;
    return { value, velocity: Math.min(0, velocity) };
  }
  return { value, velocity };
}
