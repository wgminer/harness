import Foundation

/// Loads the cross-language tool-calling schema from the bundled `resources/contracts/tools.json`
/// (the same file `src-tauri/src/openai.rs::tool_definitions()` `include_str!`s on desktop).
/// iOS supports a subset of desktop's tools, so callers filter this by name rather than
/// hand-writing their own copies of the OpenAI `function.parameters` schemas.
enum SharedToolDefinitions {
    /// All tool definitions from the shared JSON, in file order. Loaded once and cached.
    static let all: [[String: Any]] = loadAll()

    /// Definitions whose `function.name` is in `names`, in `all`'s original order.
    static func filtered(names: Set<String>) -> [[String: Any]] {
        all.filter { def in
            guard let function = def["function"] as? [String: Any],
                  let name = function["name"] as? String
            else { return false }
            return names.contains(name)
        }
    }

    private static func loadAll() -> [[String: Any]] {
        guard let url = Bundle.main.url(forResource: "tools", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            assertionFailure("resources/contracts/tools.json failed to load or parse from the app bundle")
            return []
        }
        return parsed
    }
}
