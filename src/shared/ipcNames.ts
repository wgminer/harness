/**
 * Split a camelCase segment into lowercase words, keeping acronym/digit runs
 * together ("setOpenAIApiKey" -> ["set","open","ai","api","key"],
 * "isHarnessE2E" -> ["is","harness","e2e"]).
 */
function words(part: string): string[] {
  return part
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([0-9])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(" ");
}

/**
 * `namespace:methodName` IPC name → Rust command name. Tauri matches
 * the invoke name against the snake_case Rust fn identifier verbatim
 * (`#[command(rename_all = "camelCase")]` only renames arguments).
 */
export function tauriCommandName(name: string): string {
  return name.split(":").flatMap(words).join("_");
}

/** `namespace:eventName` → kebab-case event name emitted by Rust. */
export function tauriEventName(name: string): string {
  return name.split(":").flatMap(words).join("-");
}
