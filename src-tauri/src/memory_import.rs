use std::path::Path;

use crate::credentials::resolve_openai_api_key;
use crate::memory::{get_memory_dir, AppState};
use crate::memory_facts::{merge_facts, parse_facts_response, DistilledFact, MemoryCompileLlm};
use crate::openai::{chat_completion_json, openai_transcript_cleanup_model};

pub const LLM_CONTEXT_IMPORT_CHAR_LIMIT: usize = 80_000;
const RIG_PAGE_TITLE: &str = "System";

const IMPORT_SYSTEM_PROMPT: &str = "You are importing a structured memory export from another AI assistant into a personal workspace user-fact store.\
 Each fact uses a short lowercase snake_case key (max 40 chars) and a one-line value (max 200 chars).\
 Extract durable facts from every section of the export. Preserve verbatim wording in values when it captures instructions, preferences, or quoted evidence.\
 Use distinct keys per fact (e.g. preferred_name, profession, interest_climbing, instruction_never_use_em_dashes).\
 Include dates in values when the export provides them.\
 Do not invent facts that are not supported by the export.\
 Output strict JSON with this exact shape and nothing else:\
 { \"facts\": [ { \"key\": \"snake_case_label\", \"value\": \"one-line detail\" } ] }\
 If nothing usable is present, output { \"facts\": [] }.";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmContextImportResult {
    pub added: usize,
    pub updated: usize,
    pub truncated: bool,
    pub import_source: Option<String>,
}

struct OpenAiImportDistiller {
    api_key: String,
}

#[async_trait::async_trait]
impl MemoryCompileLlm for OpenAiImportDistiller {
    async fn distill(&self, export_text: &str) -> Result<Vec<DistilledFact>, String> {
        let raw = chat_completion_json(
            &self.api_key,
            &openai_transcript_cleanup_model(),
            IMPORT_SYSTEM_PROMPT,
            export_text,
            2500,
            90,
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(parse_facts_response(&raw))
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

fn source_fact(source: &str) -> DistilledFact {
    DistilledFact {
        key: "context_import_source".into(),
        value: source.to_string(),
    }
}

pub fn create_openai_import_distiller(api_key: impl Into<String>) -> Box<dyn MemoryCompileLlm> {
    Box::new(OpenAiImportDistiller {
        api_key: api_key.into(),
    })
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
    let mut facts = llm.distill(&text).await?;
    if let Some(source) = &import_source {
        facts.retain(|f| f.key.to_lowercase() != "context_import_source");
        facts.push(source_fact(source));
    }

    let existing = crate::memory::get_user_memory_in(state, memory_dir)
        .await
        .map_err(|e| e.to_string())?;
    let (merged, added, updated) = merge_facts(&existing, &facts);
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
    let api_key = resolve_openai_api_key().await.trim().to_string();
    if api_key.is_empty() {
        return None;
    }
    Some(create_openai_import_distiller(api_key))
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
            "Add an OpenAI API key in {RIG_PAGE_TITLE} before importing context."
        )));
    };
    let memory_dir = get_memory_dir();
    match import_llm_context_in(state, &memory_dir, llm.as_ref(), trimmed).await {
        Ok(result) => {
            if result.added == 0 && result.updated == 0 {
                Ok(Err(
                    "No facts could be extracted from that export. Check the format and try again."
                        .into(),
                ))
            } else {
                Ok(Ok(result))
            }
        }
        Err(message) => Ok(Err(message)),
    }
}
