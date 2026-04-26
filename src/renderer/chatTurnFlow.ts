export function calculateBottomSpacerPx(args: {
  viewportHeight: number;
  composerHeight: number;
  userHeight: number;
  assistantHeight: number;
}): number {
  const { viewportHeight, composerHeight, userHeight, assistantHeight } = args;
  return Math.max(0, viewportHeight - composerHeight - userHeight - assistantHeight);
}

export function shouldAutoScrollUserMessage(existingUserMessageCount: number): boolean {
  return existingUserMessageCount > 0;
}

export function computeScrollTopForMessage(args: {
  scrollTop: number;
  messageTopInContainer: number;
  topOffset: number;
}): number {
  const { scrollTop, messageTopInContainer, topOffset } = args;
  return Math.max(0, scrollTop + messageTopInContainer - topOffset);
}

export function isAlignedToTopOffset(args: {
  messageTopInContainer: number;
  topOffset: number;
  tolerancePx: number;
}): boolean {
  const { messageTopInContainer, topOffset, tolerancePx } = args;
  return Math.abs(messageTopInContainer - topOffset) <= tolerancePx;
}

export function shouldApplyTurnUpdate(args: {
  activeTurnId: number | null;
  expectedTurnId: number;
  aborted: boolean;
}): boolean {
  if (args.aborted) return false;
  return args.activeTurnId === args.expectedTurnId;
}
