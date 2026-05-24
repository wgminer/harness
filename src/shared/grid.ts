/** Base layout grid unit (px). All spacing, radii, and fixed dimensions snap to multiples. */
export const GRID = 4;

export function snapToGrid(px: number): number {
  return Math.round(px / GRID) * GRID;
}

/** Spacing token value: `space(3)` => `"12px"`. */
export function space(n: number): string {
  return `${n * GRID}px`;
}

/** Snap a desired line height (px) to the 4px grid, never below `fontSizePx`. */
export function lineHeightForFont(fontSizePx: number, desiredPx?: number): number {
  const target = desiredPx ?? fontSizePx * 1.5;
  return Math.max(snapToGrid(target), snapToGrid(fontSizePx));
}
