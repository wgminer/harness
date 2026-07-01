const GRID = 4;

export function snapToGrid(px: number): number {
  return Math.round(px / GRID) * GRID;
}
