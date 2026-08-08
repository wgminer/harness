/** Distance from the library edge that starts contributing peek (px). */
export const LIBRARY_PEEK_ZONE_PX = 220;

/**
 * Cap on proximity peek, as a 0–1 fraction of dock travel.
 * Prefer {@link LIBRARY_PEEK_MAX_PX} when tuning.
 */
export const LIBRARY_PEEK_MAX = 0.72;

/**
 * Dock slide travel in px — matches `.sidebar-dock` transform
 * `translateX((±100% + 8px) * …)` with width `sidebar (70×4) + space-3 (3×4)`.
 */
export const LIBRARY_DOCK_TRAVEL_PX = 70 * 4 + 3 * 4 + 8;

/** Cap on proximity peek, in visible px of dock travel. Full open is hover on the dock. */
export const LIBRARY_PEEK_MAX_PX = Math.round(LIBRARY_PEEK_MAX * LIBRARY_DOCK_TRAVEL_PX);

/** How far past the target the spring display may travel (visible bounce). */
export const LIBRARY_PEEK_OVERSHOOT = 0.14;

/** Spring stiffness (higher = snappier). */
export const LIBRARY_PEEK_STIFFNESS = 320;

/** Spring damping (lower = more bounce). */
export const LIBRARY_PEEK_DAMPING = 16;

/** CSS open duration when hover/pin fully opens the dock (ms). */
export const LIBRARY_LATCH_DURATION_MS = 420;

/** Delay before unpinned hover-open closes after pointer leave (ms). */
export const LIBRARY_HOVER_CLOSE_DELAY_MS = 220;

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
  /** How many px of the dock may stick out during proximity peek. */
  peekMaxPx: number;
  zonePx: number;
  latchDurationMs: number;
  hoverCloseDelayMs: number;
};

export const DEFAULT_LIBRARY_PEEK_TUNING: LibraryPeekTuning = {
  stiffness: LIBRARY_PEEK_STIFFNESS,
  damping: LIBRARY_PEEK_DAMPING,
  overshoot: LIBRARY_PEEK_OVERSHOOT,
  peekMaxPx: LIBRARY_PEEK_MAX_PX,
  zonePx: LIBRARY_PEEK_ZONE_PX,
  latchDurationMs: LIBRARY_LATCH_DURATION_MS,
  hoverCloseDelayMs: LIBRARY_HOVER_CLOSE_DELAY_MS,
};

/** Convert visible peek px → 0–1 fraction used by the spring / CSS. */
export function libraryPeekMaxFraction(
  peekMaxPx: number,
  travelPx = LIBRARY_DOCK_TRAVEL_PX,
): number {
  if (travelPx <= 0) return 0;
  return Math.min(1, Math.max(0, peekMaxPx / travelPx));
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
 * Sticky "moving toward" intent for peek gating.
 * Clears outside the peek zone; ignores jitter smaller than epsilon.
 */
export function updateLibraryPeekTowardIntent(input: {
  distance: number;
  deltaX: number;
  side: LibrarySidebarSide;
  previousToward: boolean;
  zonePx?: number;
  epsilonPx?: number;
}): boolean {
  const zonePx = input.zonePx ?? LIBRARY_PEEK_ZONE_PX;
  const epsilonPx = input.epsilonPx ?? LIBRARY_PEEK_DIRECTION_EPSILON_PX;
  if (input.distance > zonePx) return false;
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
