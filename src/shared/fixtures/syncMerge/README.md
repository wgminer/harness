# Sync-merge canonical JSON fixtures

Golden outputs for cross-platform sync-merge serialization parity.

**Canonical format:** 2-space pretty-print (or compact for dedup stamps), object keys sorted lexicographically at every nesting level, no trailing newline.

**Consumers:**
- TypeScript: `src/shared/syncMerge.test.ts`, `src/shared/canonicalJson.test.ts`
- Rust: `src-tauri/src/sync_merge.rs` (`include_str!` on `*.expected.*` files)
- Swift: `ios/HarnessMobileTests/SyncMergeTests.swift` (inline expected strings — update when fixtures change)

**Migration note:** Adopting this format changes revision hashes once. Devices must re-pull after upgrading.
