/** Distance from the library edge that starts contributing peek (px). */
export const LIBRARY_PEEK_ZONE_PX = 220;

/** Edge strip that latches full open (px). */
export const LIBRARY_PEEK_HIT_ZONE_PX = 56;

/**
 * Cap on proximity *target* before latch. Spring may briefly overshoot this.
 */
export const LIBRARY_PEEK_MAX = 0.72;

/** How far past the target the spring display may travel (visible bounce). */
export const LIBRARY_PEEK_OVERSHOOT = 0.14;

/** Spring stiffness (higher = snappier). */
export const LIBRARY_PEEK_STIFFNESS = 320;

/** Spring damping (lower = more bounce). */
export const LIBRARY_PEEK_DAMPING = 16;

export type LibrarySidebarSide = "left" | "right";

export type LibraryPeekSpring = {
  value: number;
  velocity: number;
};

export type LibraryPeekTargetInput = {
  x: number;
  viewportWidth: number;
  side: LibrarySidebarSide;
};

export type LibraryPeekTarget = {
  /** Desired peek from proximity alone (no spring). */
  target: number;
  latch: boolean;
};

export function libraryEdgeDistance(
  x: number,
  viewportWidth: number,
  side: LibrarySidebarSide,
): number {
  if (side === "left") return Math.max(0, x);
  return Math.max(0, viewportWidth - x);
}

/**
 * Map edge distance → peek target in [0, LIBRARY_PEEK_MAX].
 * Smoothstep so early approach is subtle.
 */
export function peekFromDistance(distance: number, zonePx = LIBRARY_PEEK_ZONE_PX): number {
  if (zonePx <= 0) return LIBRARY_PEEK_MAX;
  const t = 1 - Math.min(1, Math.max(0, distance) / zonePx);
  const smooth = t * t * (3 - 2 * t);
  return smooth * LIBRARY_PEEK_MAX;
}

/** Proximity target + latch — spring is applied separately. */
export function computeLibraryPeekTarget(input: LibraryPeekTargetInput): LibraryPeekTarget {
  const distance = libraryEdgeDistance(input.x, input.viewportWidth, input.side);
  const latch = distance <= LIBRARY_PEEK_HIT_ZONE_PX;
  return {
    target: latch ? 1 : peekFromDistance(distance),
    latch,
  };
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
): LibraryPeekSpring {
  const stiffness = LIBRARY_PEEK_STIFFNESS;
  const damping = LIBRARY_PEEK_DAMPING;
  const accel = stiffness * (target - spring.value) - damping * spring.velocity;
  const velocity = spring.velocity + accel * dtSeconds;
  let value = spring.value + velocity * dtSeconds;

  const max = LIBRARY_PEEK_MAX + LIBRARY_PEEK_OVERSHOOT;
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
