import Foundation

/// Coarse chat stream flushes — thresholds from bundled `resources/contracts/chatStreamBatch.json`.
struct ChatStreamBatchPolicy: Equatable {
    var minChars: Int
    var maxHoldMs: Int
    var newlineMinChars: Int

    static let defaults = ChatStreamBatchPolicy.loadContractDefaults()

    private static func loadContractDefaults() -> ChatStreamBatchPolicy {
        guard let url = Bundle.main.url(forResource: "chatStreamBatch", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let minChars = json["minChars"] as? Int, minChars > 0,
              let maxHoldMs = json["maxHoldMs"] as? Int, maxHoldMs > 0,
              let newlineMinChars = json["newlineMinChars"] as? Int, newlineMinChars > 0
        else {
            assertionFailure("resources/contracts/chatStreamBatch.json failed to load or parse from the app bundle")
            return ChatStreamBatchPolicy(minChars: 150, maxHoldMs: 350, newlineMinChars: 40)
        }
        return ChatStreamBatchPolicy(
            minChars: minChars,
            maxHoldMs: maxHoldMs,
            newlineMinChars: newlineMinChars
        )
    }
}

/// Accumulates token deltas and yields larger UI chunks.
struct StreamTextBatcher {
    private var buffer = ""
    private var bufferStartedAt: ContinuousClock.Instant?
    private let policy: ChatStreamBatchPolicy
    private let clock: ContinuousClock

    init(policy: ChatStreamBatchPolicy = .defaults, clock: ContinuousClock = ContinuousClock()) {
        self.policy = policy
        self.clock = clock
    }

    mutating func push(_ chunk: String) -> String? {
        guard !chunk.isEmpty else { return nil }
        if buffer.isEmpty {
            bufferStartedAt = clock.now
        }
        buffer += chunk
        return maybeFlush(force: false)
    }

    mutating func flush() -> String? {
        maybeFlush(force: true)
    }

    var pending: String { buffer }

    private mutating func maybeFlush(force: Bool) -> String? {
        guard !buffer.isEmpty else { return nil }
        if force { return takeAll() }

        let charLen = buffer.count
        let heldLong: Bool = {
            guard let started = bufferStartedAt else { return false }
            return clock.now - started >= .milliseconds(policy.maxHoldMs)
        }()

        if let nl = buffer.lastIndex(of: "\n") {
            let prefix = String(buffer[...nl])
            if prefix.count >= policy.newlineMinChars {
                buffer = String(buffer[buffer.index(after: nl)...])
                bufferStartedAt = buffer.isEmpty ? nil : clock.now
                return prefix
            }
        }

        if charLen >= policy.minChars || heldLong {
            return takeAll()
        }
        return nil
    }

    private mutating func takeAll() -> String {
        let out = buffer
        buffer = ""
        bufferStartedAt = nil
        return out
    }
}
