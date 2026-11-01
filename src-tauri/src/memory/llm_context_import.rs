use std::path::Path;

use crate::llm::{Completion, ModelTier, Provider};
use crate::state::AppState;
use crate::memory::get_memory_dir;
use crate::memory::distill::{merge_memories, parse_memories_response, DistilledMemory, MemoryCompileLlm};

pub const LLM_CONTEXT_IMPORT_CHAR_LIMIT: usize = 80_000;
const SETTINGS_PAGE_TITLE: &str = "System";

const IMPORT_SYSTEM_PROMPT: &str = "You are importing a structured memory export from another AI assistant into a personal workspace memory store.\
 Each memory uses a short lowercase snake_case key (max 40 chars) and a one-line value (max 200 chars).\
 Extract durable memories from every section of the export. Preserve verbatim wording in values when it captures instructions, preferences, or quoted evidence.\
 Use distinct keys per memory (e.g. preferred_name, profession, interest_climbing, instruction_never_use_em_dashes).\
 Include dates in values when the export provides them.\
 Do not invent memories that are not supported by the export.\
 Output strict JSON with this exact shape and nothing else:\
 { \"memories\": [ { \"key\": \"snake_case_label\", \"value\": \"one-line detail\" } ] }\
 If nothing usable is present, output { \"memories\": [] }.";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmContextImportResult {
    pub added: usize,
    pub updated: usize,
    pub truncated: bool,
    pub import_source: Option<String>,
}

struct ImportDistiller {
    provider: Provider,
}

#[async_trait::async_trait]
impl MemoryCompileLlm for ImportDistiller {
    async fn distill(&self, export_text: &str) -> Result<Vec<DistilledMemory>, String> {
        let raw = crate::llm::complete(
            &self.provider,
            Completion {
                tier: ModelTier::Cleanup,
                system: IMPORT_SYSTEM_PROMPT,
                user: export_text,
                max_tokens: Some(2500),
                reasoning_effort: crate::openai::SMALL_MODEL_REASONING_EFFORT,
                json: true,
                timeout: std::time::Duration::from_secs(90),
            },
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(parse_memories_response(&raw))
    }
}

pub fn parse_import_source(export_text: &str) -> Option<String> {
    let trimmed = export_text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let last_line = trimmed.lines().last()?.trim();
    let re = regex::Regex::new(r"(?i)^Imported from:\s*(.+)$").ok()?;
    re.captures(last_line)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().trim().to_string())
}

pub fn truncate_export_for_import(export_text: &str) -> (String, bool) {
    let trimmed = export_text.trim().to_string();
    if trimmed.len() <= LLM_CONTEXT_IMPORT_CHAR_LIMIT {
        return (trimmed, false);
    }
    (
        trimmed.chars().take(LLM_CONTEXT_IMPORT_CHAR_LIMIT).collect(),
        true,
    )
}

fn source_memory(source: &str) -> DistilledMemory {
    DistilledMemory {
        key: "context_import_source".into(),
        value: source.to_string(),
    }
}

fn create_import_distiller(provider: Provider) -> Box<dyn MemoryCompileLlm> {
    Box::new(ImportDistiller { provider })
}

pub async fn import_llm_context_in(
    state: &AppState,
    memory_dir: &Path,
    llm: &dyn MemoryCompileLlm,
    export_text: &str,
) -> Result<LlmContextImportResult, String> {
    let (text, truncated) = truncate_export_for_import(export_text);
    if text.is_empty() {
        return Ok(LlmContextImportResult {
            added: 0,
            updated: 0,
            truncated: false,
            import_source: None,
        });
    }

    let import_source = parse_import_source(&text);
    let mut memories = llm.distill(&text).await?;
    if let Some(source) = &import_source {
        memories.retain(|m| m.key.to_lowercase() != "context_import_source");
        memories.push(source_memory(source));
    }

    let existing = crate::memory::get_user_memory_in(state, memory_dir)
        .await
        .map_err(|e| e.to_string())?;
    let (merged, added, updated) = merge_memories(&existing, &memories);
    for (key, value) in &merged {
        if existing.get(key) != Some(value) {
            crate::memory::set_user_memory_in(state, memory_dir, key, value)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(LlmContextImportResult {
        added,
        updated,
        truncated,
        import_source,
    })
}

async fn build_import_llm_from_settings() -> Option<Box<dyn MemoryCompileLlm>> {
    Provider::active().await.ok().map(create_import_distiller)
}

pub async fn run_llm_context_import_now(
    state: &AppState,
    export_text: &str,
) -> Result<Result<LlmContextImportResult, String>, std::io::Error> {
    let trimmed = export_text.trim();
    if trimmed.is_empty() {
        return Ok(Err(
            "Paste an export from another assistant before importing.".into(),
        ));
    }
    let Some(llm) = build_import_llm_from_settings().await else {
        return Ok(Err(format!(
            "Add an OpenAI API key in {SETTINGS_PAGE_TITLE} before importing context."
        )));
    };
    let memory_dir = get_memory_dir();
    match import_llm_context_in(state, &memory_dir, llm.as_ref(), trimmed).await {
        Ok(result) => {
            if result.added == 0 && result.updated == 0 {
                Ok(Err(
                    "No memories could be extracted from that export. Check the format and try again."
                        .into(),
                ))
            } else {
                Ok(Ok(result))
            }
        }
        Err(message) => Ok(Err(message)),
    }
}
