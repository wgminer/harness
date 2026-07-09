use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio::time::{interval, sleep};

use crate::credentials::{set_credential, CredentialKey};
use crate::credentials::resolve_r2_secret_access_key;
use crate::memory::AppState;
use crate::paths::{get_local_data_dir, get_local_data_sync_dir};
use crate::remote_store::{is_r2_config_complete, BackupManifest, R2Config, RemoteBackupStore};
use crate::settings::{get_settings, set_settings};
use crate::storage::{atomic_write_utf8, file_exists};
use crate::sync_bundle::{
    apply_merged_files, backup_scoped_files, build_bundle, compute_content_revision_from_bundle,
    compute_local_max_mtime, compute_revision, extract_bundle, hash_bundle_bytes, list_scoped_files,
    parse_bundle, DEFAULT_SYNC_SCOPES, USER_CONTENT_SYNC_SCOPES,
};
use base64::Engine;
use crate::sync_merge::{
    build_default_merge_choices, build_merged_file_map, build_sync_conflict_review, SyncConflictReview,
    SyncFileChoice,
};
use crate::env_util::is_harness_e2e;

const STATE_FILE: &str = "state.json";
const LOCAL_BACKUP_DIR: &str = "backups";
const MANIFEST_VERSION: i32 = 1;
const POLL_INTERVAL_MS: u64 = 30_000;
const SYNC_DEBOUNCE_MS: u64 = 2_500;
const SYNC_SUPPRESS_MS: u64 = 3_000;

pub const RIG_PAGE_TITLE: &str = "System";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncProvider {
    #[serde(rename = "s3Backup")]
    S3Backup,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncDirection {
    Push,
    Pull,
    Noop,
    Merge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncDecision {
    Push,
    Pull,
    Noop,
    Conflict,
    Merge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub provider: SyncProvider,
    pub configured: bool,
    pub account_id: Option<String>,
    pub bucket: Option<String>,
    pub prefix: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
    pub last_action: Option<SyncDirection>,
    pub last_synced_revision: Option<String>,
    pub remote_revision: Option<String>,
    pub status_line: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub ok: bool,
    pub status: SyncStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_warning: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    last_attempt_at: Option<i64>,
    last_success_at: Option<i64>,
    last_error: Option<String>,
    last_action: Option<SyncDirection>,
    last_synced_revision: Option<String>,
    last_synced_content_revision: Option<String>,
    remote_revision: Option<String>,
}

pub struct SyncRuntime {
    app_state: AppState,
    persisted: Mutex<PersistedState>,
    in_flight: Mutex<Option<tokio::sync::oneshot::Receiver<SyncResult>>>,
    poll_in_flight: Mutex<bool>,
    suppress_until: Mutex<i64>,
    last_observed_remote_revision: Mutex<Option<String>>,
    schedule_generation: Mutex<u64>,
}

impl SyncRuntime {
    pub fn new(app_state: AppState) -> Self {
        Self {
            app_state,
            persisted: Mutex::new(PersistedState::default()),
            in_flight: Mutex::new(None),
            poll_in_flight: Mutex::new(false),
            suppress_until: Mutex::new(0),
            last_observed_remote_revision: Mutex::new(None),
            schedule_generation: Mutex::new(0),
        }
    }

    pub async fn init(&self) -> Result<(), std::io::Error> {
        let loaded = load_state(&self.app_state).await?;
        *self.persisted.lock().await = loaded;
        Ok(())
    }
}

pub fn sync_result_changed_local_data(result: &SyncResult) -> bool {
    if !result.ok {
        return false;
    }
    matches!(
        result.status.last_action,
        Some(SyncDirection::Pull) | Some(SyncDirection::Merge)
    )
}

pub fn decide_sync_action(params: DecideSyncActionParams) -> SyncDecision {
    let DecideSyncActionParams {
        local_revision,
        remote_revision,
        last_synced_revision,
        remote_updated_at,
        local_max_mtime_ms,
    } = params;

    let Some(remote_revision) = remote_revision else {
        return SyncDecision::Push;
    };
    if local_revision == remote_revision {
        return SyncDecision::Noop;
    }

    if let Some(last_synced) = &last_synced_revision {
        if local_revision == *last_synced {
            return SyncDecision::Pull;
        }
        if remote_revision == *last_synced {
            return SyncDecision::Push;
        }
        return SyncDecision::Conflict;
    }

    if let Some(remote_updated_at) = remote_updated_at {
        if local_max_mtime_ms > remote_updated_at {
            return SyncDecision::Conflict;
        }
    }
    SyncDecision::Pull
}

pub struct DecideSyncActionParams<'a> {
    pub local_revision: &'a str,
    pub remote_revision: Option<&'a str>,
    pub last_synced_revision: Option<&'a str>,
    pub remote_updated_at: Option<i64>,
    pub local_max_mtime_ms: i64,
}

pub fn format_sync_status_line(input: FormatSyncStatusLineInput) -> Option<String> {
    if !input.configured {
        return Some("Connect R2 in Settings → Data to enable sync.".into());
    }
    if input.is_syncing {
        return Some("Syncing…".into());
    }
    if let Some(err) = input.last_error.filter(|s| !s.is_empty()) {
        return Some(err);
    }
    if let Some(last_success_at) = input.last_success_at {
        let ago_sec = ((chrono::Utc::now().timestamp_millis() - last_success_at).max(0) / 1000) as i64;
        let ago = if ago_sec < 60 {
            format!("{ago_sec}s ago")
        } else if ago_sec < 3600 {
            format!("{}m ago", (ago_sec + 30) / 60)
        } else {
            format!("{}h ago", (ago_sec + 1800) / 3600)
        };
        return Some(match input.last_action {
            Some(SyncDirection::Pull) => format!("Pulled remote changes · synced {ago}"),
            Some(SyncDirection::Push) => format!("Pushed local changes · synced {ago}"),
            Some(SyncDirection::Merge) => format!("Merged changes · synced {ago}"),
            _ => format!("Synced {ago}"),
        });
    }
    Some("No sync completed yet.".into())
}

pub struct FormatSyncStatusLineInput {
    pub configured: bool,
    pub is_syncing: bool,
    pub last_success_at: Option<i64>,
    pub last_action: Option<SyncDirection>,
    pub last_error: Option<String>,
}

fn state_path() -> PathBuf {
    get_local_data_sync_dir().join(STATE_FILE)
}

fn local_backups_root() -> PathBuf {
    get_local_data_sync_dir().join(LOCAL_BACKUP_DIR)
}

async fn load_state(_app_state: &AppState) -> Result<PersistedState, std::io::Error> {
    let path = state_path();
    if !file_exists(&path).await {
        return Ok(PersistedState::default());
    }
    let raw = tokio::fs::read_to_string(&path).await?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
    Ok(PersistedState {
        last_attempt_at: parsed
            .get("lastAttemptAt")
            .and_then(|v| v.as_i64()),
        last_success_at: parsed
            .get("lastSuccessAt")
            .and_then(|v| v.as_i64()),
        last_error: parsed
            .get("lastError")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        last_action: parsed
            .get("lastAction")
            .and_then(|v| v.as_str())
            .and_then(|s| match s {
                "push" => Some(SyncDirection::Push),
                "pull" => Some(SyncDirection::Pull),
                "noop" => Some(SyncDirection::Noop),
                "merge" => Some(SyncDirection::Merge),
                _ => None,
            }),
        last_synced_revision: parsed
            .get("lastSyncedRevision")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        last_synced_content_revision: parsed
            .get("lastSyncedContentRevision")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        remote_revision: parsed
            .get("remoteRevision")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

async fn save_state(app_state: &AppState, state: &PersistedState) -> Result<(), std::io::Error> {
    let pretty = serde_json::to_string_pretty(state)?;
    atomic_write_utf8(&app_state.write_chains, &state_path(), &pretty).await
}

async fn build_remote_store(app_state: &AppState) -> Result<Option<RemoteBackupStore>, String> {
    let settings = get_settings(&app_state.write_chains).await;
    let secret = resolve_r2_secret_access_key().await;
    let has_secret = !secret.trim().is_empty();
    if !is_r2_config_complete(settings.get("sync"), has_secret) {
        return Ok(None);
    }
    let sync = settings.get("sync").cloned().unwrap_or_default();
    Ok(Some(RemoteBackupStore::new(R2Config {
            account_id: sync
                .get("accountId")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            bucket: sync
                .get("bucket")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            prefix: sync
                .get("prefix")
                .and_then(|v| v.as_str())
                .unwrap_or("harness/")
                .to_string(),
            access_key_id: sync
                .get("accessKeyId")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            secret_access_key: secret,
        })?))
}

struct SyncConfigStatus {
    configured: bool,
    account_id: Option<String>,
    bucket: Option<String>,
    prefix: Option<String>,
    config_error: Option<String>,
}

async fn get_sync_config_status(app_state: &AppState) -> SyncConfigStatus {
    let settings = get_settings(&app_state.write_chains).await;
    let secret = resolve_r2_secret_access_key().await;
    let sync = settings.get("sync");
    let account_id = sync
        .and_then(|v| v.get("accountId"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let bucket = sync
        .and_then(|v| v.get("bucket"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let prefix = sync
        .and_then(|v| v.get("prefix"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let configured = is_r2_config_complete(sync, !secret.trim().is_empty());
    let mut config_error = None;
    if account_id.is_some() || bucket.is_some() || sync.and_then(|s| s.get("accessKeyId")).is_some()
    {
        if !configured {
            config_error = Some(
                "Complete R2 account ID, bucket, access key ID, and secret access key.".into(),
            );
        }
    }
    SyncConfigStatus {
        configured,
        account_id,
        bucket,
        prefix,
        config_error,
    }
}

fn build_status(state: &PersistedState, config: &SyncConfigStatus) -> SyncStatus {
    let last_error = state
        .last_error
        .clone()
        .or_else(|| config.config_error.clone());
    SyncStatus {
        provider: SyncProvider::S3Backup,
        configured: config.configured,
        account_id: config.account_id.clone(),
        bucket: config.bucket.clone(),
        prefix: config.prefix.clone(),
        last_attempt_at: state.last_attempt_at,
        last_success_at: state.last_success_at,
        last_error: last_error.clone(),
        last_action: state.last_action,
        last_synced_revision: state.last_synced_revision.clone(),
        remote_revision: state.remote_revision.clone(),
        status_line: format_sync_status_line(FormatSyncStatusLineInput {
            configured: config.configured,
            is_syncing: false,
            last_success_at: state.last_success_at,
            last_action: state.last_action,
            last_error,
        }),
    }
}

async fn read_remote_content_revision(
    store: &RemoteBackupStore,
    manifest: &BackupManifest,
) -> Result<String, String> {
    if let Some(content_revision) = &manifest.content_revision {
        return Ok(content_revision.clone());
    }
    let bytes = store.read_bundle().await?;
    let doc = parse_bundle(&bytes)?;
    Ok(compute_content_revision_from_bundle(&doc))
}

async fn load_local_scoped_file_map() -> Result<HashMap<String, Vec<u8>>, std::io::Error> {
    let local_data_dir = get_local_data_dir();
    let files = list_scoped_files(&local_data_dir, DEFAULT_SYNC_SCOPES).await?;
    let mut out = HashMap::new();
    for rel in files {
        out.insert(rel.clone(), tokio::fs::read(local_data_dir.join(&rel)).await?);
    }
    Ok(out)
}

async fn load_remote_scoped_file_map(
    store: &RemoteBackupStore,
    manifest: &BackupManifest,
) -> Result<HashMap<String, Vec<u8>>, String> {
    let bytes = store.read_bundle().await?;
    let actual_hash = hash_bundle_bytes(&bytes);
    if actual_hash != manifest.bundle_hash {
        return Err("Remote bundle hash does not match its manifest.".into());
    }
    let doc = parse_bundle(&bytes)?;
    let mut out = HashMap::new();
    for entry in doc.entries {
        let data = base64::engine::general_purpose::STANDARD
            .decode(&entry.contents)
            .map_err(|e| e.to_string())?;
        out.insert(entry.path, data);
    }
    Ok(out)
}

fn merge_warning_from_review(review: &SyncConflictReview) -> Option<String> {
    let skipped: Vec<_> = review
        .files
        .iter()
        .filter(|file| {
            file.kind == crate::sync_merge::SyncFileChangeKind::Conflict && !file.supports_merge
        })
        .collect();
    if skipped.is_empty() {
        return None;
    }
    let labels = skipped
        .iter()
        .map(|file| file.label.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    Some(format!(
        "Some files could not be merged ({labels}); this device's copies were kept."
    ))
}

async fn suppress_sync_schedule(runtime: &SyncRuntime, ms: u64) {
    let until = chrono::Utc::now().timestamp_millis() + ms as i64;
    *runtime.suppress_until.lock().await = until;
}

async fn merge_conflict_resolution(
    runtime: &SyncRuntime,
    store: &RemoteBackupStore,
    remote_manifest: &BackupManifest,
    choices: &HashMap<String, SyncFileChoice>,
    now: i64,
) -> Result<(), String> {
    suppress_sync_schedule(runtime, SYNC_SUPPRESS_MS).await;
    let local_files = load_local_scoped_file_map()
        .await
        .map_err(|e| e.to_string())?;
    let remote_files = load_remote_scoped_file_map(store, remote_manifest).await?;
    let merged_files = build_merged_file_map(&local_files, &remote_files, choices);
    let local_data = get_local_data_dir();
    let backup_snapshot_dir = local_backups_root().join(now.to_string());
    backup_scoped_files(&local_data, &backup_snapshot_dir, DEFAULT_SYNC_SCOPES)
        .await
        .map_err(|e| e.to_string())?;
    apply_merged_files(&local_data, &merged_files, DEFAULT_SYNC_SCOPES)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn push_local_to_remote(
    store: &RemoteBackupStore,
    local_revision: &str,
    now: i64,
) -> Result<String, String> {
    let local_data = get_local_data_dir();
    let built = build_bundle(&local_data, DEFAULT_SYNC_SCOPES)
        .await
        .map_err(|e| e.to_string())?;
    let content_revision = compute_revision(&local_data, USER_CONTENT_SYNC_SCOPES)
        .await
        .map_err(|e| e.to_string())?;
    let manifest = BackupManifest {
        version: MANIFEST_VERSION,
        revision: local_revision.to_string(),
        content_revision: Some(content_revision),
        updated_at: now,
        bundle_hash: built.bundle_hash.clone(),
    };
    store
        .write_bundle_and_manifest(&built.bytes, &manifest)
        .await?;
    Ok(built.bundle_hash)
}

async fn pull_remote_into_local(
    runtime: &SyncRuntime,
    store: &RemoteBackupStore,
    manifest: &BackupManifest,
    now: i64,
) -> Result<usize, String> {
    suppress_sync_schedule(runtime, SYNC_SUPPRESS_MS).await;
    let bytes = store.read_bundle().await?;
    let actual_hash = hash_bundle_bytes(&bytes);
    if actual_hash != manifest.bundle_hash {
        return Err("Remote bundle hash does not match its manifest.".into());
    }
    let doc = parse_bundle(&bytes)?;
    let backup_snapshot_dir = local_backups_root().join(now.to_string());
    let local_data = get_local_data_dir();
    backup_scoped_files(&local_data, &backup_snapshot_dir, DEFAULT_SYNC_SCOPES)
        .await
        .map_err(|e| e.to_string())?;
    extract_bundle(&local_data, &doc, DEFAULT_SYNC_SCOPES)
        .await
        .map_err(|e| e.to_string())
}

async fn auto_merge_and_push(
    runtime: &SyncRuntime,
    store: &RemoteBackupStore,
    remote_manifest: &BackupManifest,
    now: i64,
) -> Result<Option<String>, String> {
    let local_files = load_local_scoped_file_map()
        .await
        .map_err(|e| e.to_string())?;
    let remote_files = load_remote_scoped_file_map(store, remote_manifest).await?;
    let review = build_sync_conflict_review(&local_files, &remote_files);
    let choices = build_default_merge_choices(&review);
    merge_conflict_resolution(runtime, store, remote_manifest, &choices, now).await?;
    let merge_warning = merge_warning_from_review(&review);
    let local_revision = compute_revision(&get_local_data_dir(), DEFAULT_SYNC_SCOPES)
        .await
        .map_err(|e| e.to_string())?;
    push_local_to_remote(store, &local_revision, now).await?;
    Ok(merge_warning)
}

async fn resolve_sync_decision(
    local_revision: &str,
    local_content_revision: &str,
    remote_manifest: &BackupManifest,
    remote_content_revision: &str,
    last_synced_revision: Option<&str>,
    last_synced_content_revision: Option<&str>,
    local_max_mtime_ms: i64,
) -> Result<SyncDecision, String> {
    if local_revision == remote_manifest.revision {
        return Ok(SyncDecision::Noop);
    }

    let content_decision = decide_sync_action(DecideSyncActionParams {
        local_revision: local_content_revision,
        remote_revision: Some(remote_content_revision),
        last_synced_revision: last_synced_content_revision.or(last_synced_revision),
        remote_updated_at: Some(remote_manifest.updated_at),
        local_max_mtime_ms,
    });

    if content_decision != SyncDecision::Noop {
        return Ok(content_decision);
    }

    Ok(decide_sync_action(DecideSyncActionParams {
        local_revision,
        remote_revision: Some(&remote_manifest.revision),
        last_synced_revision,
        remote_updated_at: Some(remote_manifest.updated_at),
        local_max_mtime_ms: 0,
    }))
}

async fn run_sync_now_inner(runtime: &SyncRuntime) -> SyncResult {
    let now = chrono::Utc::now().timestamp_millis();
    let config = get_sync_config_status(&runtime.app_state).await;
    let mut state = runtime.persisted.lock().await.clone();
    state.last_attempt_at = Some(now);
    state.last_error = None;

    if !config.configured {
        state.last_error = Some(
            config
                .config_error
                .clone()
                .unwrap_or_else(|| format!("Configure R2 sync in {RIG_PAGE_TITLE}.")),
        );
        let _ = save_state(&runtime.app_state, &state).await;
        *runtime.persisted.lock().await = state.clone();
        return SyncResult {
            ok: false,
            status: build_status(&state, &config),
            merge_warning: None,
        };
    }

    let Some(store) = build_remote_store(&runtime.app_state).await.ok().flatten() else {
        state.last_error = Some("R2 credentials are incomplete.".into());
        let _ = save_state(&runtime.app_state, &state).await;
        *runtime.persisted.lock().await = state.clone();
        return SyncResult {
            ok: false,
            status: build_status(&state, &config),
            merge_warning: None,
        };
    };

    let result: Result<SyncResult, String> = async {
        let remote_manifest = store.read_manifest().await?;
        let local_data = get_local_data_dir();
        let local_revision = compute_revision(&local_data, DEFAULT_SYNC_SCOPES)
            .await
            .map_err(|e| e.to_string())?;
        let local_content_revision = compute_revision(&local_data, USER_CONTENT_SYNC_SCOPES)
            .await
            .map_err(|e| e.to_string())?;

        if remote_manifest.is_none() {
            push_local_to_remote(&store, &local_revision, now).await?;
            state.last_success_at = Some(now);
            state.last_action = Some(SyncDirection::Push);
            state.last_synced_revision = Some(local_revision.clone());
            state.last_synced_content_revision = Some(local_content_revision.clone());
            state.remote_revision = Some(local_revision);
            save_state(&runtime.app_state, &state).await.map_err(|e| e.to_string())?;
            *runtime.persisted.lock().await = state.clone();
            return Ok(SyncResult {
                ok: true,
                status: build_status(&state, &config),
                merge_warning: None,
            });
        }

        let remote_manifest = remote_manifest.unwrap();
        state.remote_revision = Some(remote_manifest.revision.clone());

        let local_max_mtime_ms = compute_local_max_mtime(&local_data, USER_CONTENT_SYNC_SCOPES)
            .await
            .map_err(|e| e.to_string())?;
        let remote_content_revision =
            read_remote_content_revision(&store, &remote_manifest).await?;
        let decision = resolve_sync_decision(
            &local_revision,
            &local_content_revision,
            &remote_manifest,
            &remote_content_revision,
            state.last_synced_revision.as_deref(),
            state.last_synced_content_revision.as_deref(),
            local_max_mtime_ms,
        )
        .await?;

        if matches!(decision, SyncDecision::Conflict | SyncDecision::Merge) {
            let merge_warning = auto_merge_and_push(runtime, &store, &remote_manifest, now).await?;
            let merged_revision = compute_revision(&local_data, DEFAULT_SYNC_SCOPES)
                .await
                .map_err(|e| e.to_string())?;
            let merged_content_revision =
                compute_revision(&local_data, USER_CONTENT_SYNC_SCOPES)
                    .await
                    .map_err(|e| e.to_string())?;
            state.last_success_at = Some(now);
            state.last_action = Some(SyncDirection::Merge);
            state.last_synced_revision = Some(merged_revision.clone());
            state.last_synced_content_revision = Some(merged_content_revision);
            state.remote_revision = Some(merged_revision);
            state.last_error = None;
            save_state(&runtime.app_state, &state).await.map_err(|e| e.to_string())?;
            *runtime.persisted.lock().await = state.clone();
            return Ok(SyncResult {
                ok: true,
                status: build_status(&state, &config),
                merge_warning,
            });
        }

        match decision {
            SyncDecision::Noop => {
                state.last_success_at = Some(now);
                state.last_action = Some(SyncDirection::Noop);
                state.last_synced_revision = Some(local_revision.clone());
                state.last_synced_content_revision = Some(local_content_revision);
                state.remote_revision = Some(remote_manifest.revision);
                state.last_error = None;
            }
            SyncDecision::Pull => {
                pull_remote_into_local(runtime, &store, &remote_manifest, now).await?;
                state.last_success_at = Some(now);
                state.last_action = Some(SyncDirection::Pull);
                state.last_synced_revision = Some(remote_manifest.revision.clone());
                state.last_synced_content_revision = Some(remote_content_revision);
                state.remote_revision = Some(remote_manifest.revision);
                state.last_error = None;
            }
            SyncDecision::Push => {
                push_local_to_remote(&store, &local_revision, now).await?;
                state.last_success_at = Some(now);
                state.last_action = Some(SyncDirection::Push);
                state.last_synced_revision = Some(local_revision.clone());
                state.last_synced_content_revision = Some(local_content_revision);
                state.remote_revision = Some(local_revision);
                state.last_error = None;
            }
            SyncDecision::Conflict | SyncDecision::Merge => unreachable!(),
        }
        save_state(&runtime.app_state, &state).await.map_err(|e| e.to_string())?;
        *runtime.persisted.lock().await = state.clone();
        Ok(SyncResult {
            ok: true,
            status: build_status(&state, &config),
            merge_warning: None,
        })
    }
    .await;

    match result {
        Ok(r) => r,
        Err(err) => {
            state.last_error = Some(err);
            let _ = save_state(&runtime.app_state, &state).await;
            *runtime.persisted.lock().await = state.clone();
            SyncResult {
                ok: false,
                status: build_status(&state, &config),
                merge_warning: None,
            }
        }
    }
}

pub async fn run_sync_now(runtime: &SyncRuntime, app: &AppHandle) -> SyncResult {
    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let mut guard = runtime.in_flight.lock().await;
        if guard.is_some() {
            drop(guard);
            // Wait for existing sync - simplified: run inline if already in flight
            return run_sync_now_inner(runtime).await;
        }
        *guard = Some(rx);
    }

    let result = run_sync_now_inner(runtime).await;
    *runtime.in_flight.lock().await = None;
    let _ = tx.send(result.clone());

    if sync_result_changed_local_data(&result) {
        let _ = app.emit("sync-changed", ());
    }
    if let Some(rev) = &result.status.remote_revision {
        *runtime.last_observed_remote_revision.lock().await = Some(rev.clone());
    }
    result
}

pub async fn get_sync_status(runtime: &SyncRuntime) -> SyncStatus {
    let state = runtime.persisted.lock().await.clone();
    let config = get_sync_config_status(&runtime.app_state).await;
    build_status(&state, &config)
}

pub async fn schedule_sync_after_local_change(runtime: Arc<SyncRuntime>, app: AppHandle) {
    if is_harness_e2e() {
        return;
    }
    let now = chrono::Utc::now().timestamp_millis();
    if now < *runtime.suppress_until.lock().await {
        return;
    }
    let mut gen = runtime.schedule_generation.lock().await;
    *gen += 1;
    let my_gen = *gen;
    drop(gen);
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(SYNC_DEBOUNCE_MS)).await;
        if *runtime.schedule_generation.lock().await != my_gen {
            return;
        }
        let _ = run_sync_now(&runtime, &app).await;
    });
}

async fn poll_remote_manifest(runtime: &SyncRuntime, app: &AppHandle) {
    let Ok(Some(store)) = build_remote_store(&runtime.app_state).await else {
        return;
    };
    let Ok(manifest) = store.read_manifest().await else {
        return;
    };
    let remote_revision = manifest.as_ref().map(|m| m.revision.clone());
    let state = runtime.persisted.lock().await.clone();

    if let Some(rev) = &remote_revision {
        let mut last = runtime.last_observed_remote_revision.lock().await;
        if last.as_ref() != Some(rev) {
            let prev = last.clone();
            *last = Some(rev.clone());
            if prev.is_some() && Some(rev) != state.last_synced_revision.as_ref() {
                let mut next = state.clone();
                next.remote_revision = Some(rev.clone());
                next.last_error = None;
                let _ = save_state(&runtime.app_state, &next).await;
                *runtime.persisted.lock().await = next;
                let _ = app.emit("sync-changed", ());
                let _ = run_sync_now(runtime, app).await;
                return;
            }
        }
    }

    if remote_revision != state.remote_revision {
        let mut next = state.clone();
        next.remote_revision = remote_revision;
        let _ = save_state(&runtime.app_state, &next).await;
        *runtime.persisted.lock().await = next;
        let _ = app.emit("sync-changed", ());
    }
}

pub fn start_sync_background(runtime: Arc<SyncRuntime>, app: AppHandle) {
    if is_harness_e2e() {
        return;
    }

    let runtime_poll = runtime.clone();
    let app_poll = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(Duration::from_millis(POLL_INTERVAL_MS));
        loop {
            ticker.tick().await;
            if *runtime_poll.poll_in_flight.lock().await {
                continue;
            }
            *runtime_poll.poll_in_flight.lock().await = true;
            poll_remote_manifest(&runtime_poll, &app_poll).await;
            *runtime_poll.poll_in_flight.lock().await = false;
        }
    });

    let runtime_watch = runtime.clone();
    let app_watch = app.clone();
    tauri::async_runtime::spawn(async move {
        let local_data = get_local_data_dir();
        let watched = [
            local_data.join("app-state"),
            local_data.join("settings"),
        ];
        let mut last_revision = compute_revision(&local_data, DEFAULT_SYNC_SCOPES)
            .await
            .unwrap_or_default();
        let mut ticker = interval(Duration::from_secs(2));
        loop {
            ticker.tick().await;
            let Ok(rev) = compute_revision(&local_data, DEFAULT_SYNC_SCOPES).await else {
                continue;
            };
            if rev != last_revision {
                let changed = watched.iter().any(|p| p.exists());
                if changed {
                    last_revision = rev;
                    schedule_sync_after_local_change(runtime_watch.clone(), app_watch.clone()).await;
                }
            }
        }
    });
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct R2ConfigPartial {
    pub account_id: Option<String>,
    pub bucket: Option<String>,
    pub prefix: Option<String>,
    pub access_key_id: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sync_get_status(runtime: State<'_, Arc<SyncRuntime>>) -> Result<SyncStatus, String> {
    Ok(get_sync_status(&runtime).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sync_run_now(
    runtime: State<'_, Arc<SyncRuntime>>,
    app: AppHandle,
) -> Result<SyncResult, String> {
    Ok(run_sync_now(&runtime, &app).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sync_test_connection(runtime: State<'_, Arc<SyncRuntime>>) -> Result<serde_json::Value, String> {
    let Some(store) = build_remote_store(&runtime.app_state).await.map_err(|e| e.to_string())?
    else {
        return Ok(serde_json::json!({
            "ok": false,
            "error": "R2 settings or secret access key is incomplete."
        }));
    };
    match store.test_connection().await {
        Ok(()) => Ok(serde_json::json!({ "ok": true })),
        Err(err) => Ok(serde_json::json!({ "ok": false, "error": err })),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sync_set_r2_secret_access_key(secret: String) -> Result<(), String> {
    set_credential(CredentialKey::R2SecretAccessKey, &secret).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sync_set_r2_config(
    runtime: State<'_, Arc<SyncRuntime>>,
    partial: R2ConfigPartial,
) -> Result<SyncStatus, String> {
    let current = get_settings(&runtime.app_state.write_chains).await;
    let current_sync = current.get("sync").cloned().unwrap_or_default();
    let next_sync = serde_json::json!({
        "accountId": partial.account_id.unwrap_or_else(|| current_sync.get("accountId").and_then(|v| v.as_str()).unwrap_or("").to_string()),
        "bucket": partial.bucket.unwrap_or_else(|| current_sync.get("bucket").and_then(|v| v.as_str()).unwrap_or("").to_string()),
        "prefix": partial.prefix.unwrap_or_else(|| current_sync.get("prefix").and_then(|v| v.as_str()).unwrap_or("harness/").to_string()),
        "accessKeyId": partial.access_key_id.unwrap_or_else(|| current_sync.get("accessKeyId").and_then(|v| v.as_str()).unwrap_or("").to_string()),
    });
    set_settings(
        &runtime.app_state.write_chains,
        &serde_json::json!({ "sync": next_sync }),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(get_sync_status(&runtime).await)
}

pub fn register_sync_state(app_state: AppState) -> Arc<SyncRuntime> {
    Arc::new(SyncRuntime::new(app_state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decide_pull_when_local_matches_last_synced() {
        let decision = decide_sync_action(DecideSyncActionParams {
            local_revision: "a",
            remote_revision: Some("b"),
            last_synced_revision: Some("a"),
            remote_updated_at: Some(100),
            local_max_mtime_ms: 0,
        });
        assert_eq!(decision, SyncDecision::Pull);
    }

    #[test]
    fn decide_push_when_remote_matches_last_synced() {
        let decision = decide_sync_action(DecideSyncActionParams {
            local_revision: "a",
            remote_revision: Some("b"),
            last_synced_revision: Some("b"),
            remote_updated_at: Some(100),
            local_max_mtime_ms: 0,
        });
        assert_eq!(decision, SyncDecision::Push);
    }
}
