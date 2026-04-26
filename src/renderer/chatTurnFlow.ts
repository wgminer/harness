export function shouldApplyTurnUpdate(args: {
  activeTurnId: number | null;
  expectedTurnId: number;
  aborted: boolean;
}): boolean {
  if (args.aborted) return false;
  return args.activeTurnId === args.expectedTurnId;
}
