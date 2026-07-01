import Foundation

enum HarnessStorageKeys {
    static let lastSuccessfulSyncAt = "harness.lastSuccessfulSyncAt"
    static let setupNoticeDismissed = "harness.setupNoticeDismissed"
    static let composeDraft = "harness.composeDraft"
    static let threadDrafts = "harness.composerDraftCache"
    static let lastSyncedRevision = "harness.lastSyncedRevision"
    static let lastSyncedContentRevision = "harness.lastSyncedContentRevision"
    static let syncBaselineConversations = "harness.syncBaselineConversations"
    static let importedOpenAIKeyFromSync = "harness.importedOpenAIKeyFromSync"
    static let r2AccountId = "harness.r2.accountId"
    static let r2Bucket = "harness.r2.bucket"
    static let r2Prefix = "harness.r2.prefix"
    static let r2AccessKeyId = "harness.r2.accessKeyId"
}
