use s3::bucket::Bucket;
use s3::creds::Credentials;
use s3::region::Region;
use serde::{Deserialize, Serialize};

pub const BUNDLE_OBJECT_NAME: &str = "bundle.json.gz";
pub const MANIFEST_OBJECT_NAME: &str = "manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub version: i32,
    pub revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_revision: Option<String>,
    pub updated_at: i64,
    pub bundle_hash: String,
}

#[derive(Debug, Clone)]
pub struct R2Config {
    pub account_id: String,
    pub bucket: String,
    pub prefix: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

pub fn normalize_r2_prefix(prefix: &str) -> String {
    let trimmed = prefix.trim().trim_start_matches('/');
    if trimmed.is_empty() {
        return "harness/".into();
    }
    if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{trimmed}/")
    }
}

pub fn r2_endpoint(account_id: &str) -> String {
    format!("https://{}.r2.cloudflarestorage.com", account_id.trim())
}

fn object_key(prefix: &str, name: &str) -> String {
    format!("{}{name}", normalize_r2_prefix(prefix))
}

pub struct RemoteBackupStore {
    bucket: Bucket,
    prefix: String,
}

impl RemoteBackupStore {
    pub fn new(config: R2Config) -> Result<Self, String> {
        let endpoint = r2_endpoint(&config.account_id);
        let region = Region::Custom {
            region: "auto".into(),
            endpoint,
        };
        let credentials = Credentials::new(
            Some(config.access_key_id.trim()),
            Some(config.secret_access_key.as_str()),
            None,
            None,
            None,
        )
        .map_err(|e| e.to_string())?;

        let bucket = Bucket::new(config.bucket.trim(), region, credentials)
            .map_err(|e| e.to_string())?
            .with_path_style();

        Ok(Self {
            bucket: *bucket,
            prefix: normalize_r2_prefix(&config.prefix),
        })
    }

    pub fn manifest_key(&self) -> String {
        object_key(&self.prefix, MANIFEST_OBJECT_NAME)
    }

    pub fn bundle_key(&self) -> String {
        object_key(&self.prefix, BUNDLE_OBJECT_NAME)
    }

    pub async fn read_manifest(&self) -> Result<Option<BackupManifest>, String> {
        match self.bucket.get_object(&self.manifest_key()).await {
            Ok(data) => {
                let raw: serde_json::Value =
                    serde_json::from_slice(data.as_slice()).map_err(|e| e.to_string())?;
                if raw.get("revision").and_then(|v| v.as_str()).is_some()
                    && raw.get("updatedAt").and_then(|v| v.as_i64()).is_some()
                    && raw.get("bundleHash").and_then(|v| v.as_str()).is_some()
                    && raw.get("version").and_then(|v| v.as_i64()).is_some()
                {
                    Ok(Some(BackupManifest {
                        version: raw["version"].as_i64().unwrap_or(0) as i32,
                        revision: raw["revision"].as_str().unwrap_or_default().to_string(),
                        content_revision: raw
                            .get("contentRevision")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        updated_at: raw["updatedAt"].as_i64().unwrap_or(0),
                        bundle_hash: raw["bundleHash"].as_str().unwrap_or_default().to_string(),
                    }))
                } else {
                    Ok(None)
                }
            }
            Err(err) => {
                let msg = err.to_string();
                if msg.contains("404") || msg.contains("NoSuchKey") {
                    Ok(None)
                } else {
                    Err(msg)
                }
            }
        }
    }

    pub async fn read_bundle(&self) -> Result<Vec<u8>, String> {
        self.bucket
            .get_object(&self.bundle_key())
            .await
            .map(|data| data.to_vec())
            .map_err(|e| e.to_string())
    }

    pub async fn write_bundle_and_manifest(
        &self,
        bundle_bytes: &[u8],
        manifest: &BackupManifest,
    ) -> Result<(), String> {
        self.bucket
            .put_object_with_content_type(
                &self.bundle_key(),
                bundle_bytes,
                "application/gzip",
            )
            .await
            .map_err(|e| e.to_string())?;

        let manifest_json =
            serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
        self.bucket
            .put_object_with_content_type(
                &self.manifest_key(),
                manifest_json.as_bytes(),
                "application/json",
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn test_connection(&self) -> Result<(), String> {
        self.bucket
            .head_object(&self.manifest_key())
            .await
            .map(|_| ())
            .or_else(|err| {
                let msg = err.to_string();
                if msg.contains("404") || msg.contains("NoSuchKey") {
                    Ok(())
                } else {
                    Err(msg)
                }
            })
    }
}

pub fn is_r2_config_complete(sync: Option<&serde_json::Value>, has_secret: bool) -> bool {
    if !has_secret {
        return false;
    }
    let Some(sync) = sync else {
        return false;
    };
    let account_id = sync
        .get("accountId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let bucket = sync
        .get("bucket")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let access_key_id = sync
        .get("accessKeyId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    account_id.is_some() && bucket.is_some() && access_key_id.is_some()
}
