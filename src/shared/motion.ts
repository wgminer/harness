/** Hold after check/strikethrough before the TV-off exit. */
export const TASK_COMPLETE_HOLD_MS = 2000;

/** TV-off collapse animation; keep in sync with `--motion-duration-emphasis` in CSS. */
export const TASK_COMPLETE_TV_MS = 360;

/** Full completion sequence (hold + TV-off). */
export const TASK_COMPLETE_MS = TASK_COMPLETE_HOLD_MS + TASK_COMPLETE_TV_MS;
