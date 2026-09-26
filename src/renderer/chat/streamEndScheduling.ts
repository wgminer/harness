/** Yield the main thread so IPC handlers (e.g. Fn stop) can run before stream-end UI work. */
export function scheduleAfterStreamEndSync(work: () => void): void {
  setTimeout(work, 0);
}
