/** Only focus the composer after a turn when Harness already has document focus. */
export function shouldFocusComposerAfterTurn(documentHasFocus: boolean): boolean {
  return documentHasFocus;
}
