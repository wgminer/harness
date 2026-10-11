//! Coding turns run through Pi (`pi --mode rpc`).
//!
//! Pi owns the agent loop, the tools, and the session history; Harness sends
//! the prompt and renders Pi's JSONL event stream. One child process per turn,
//! resumed by session id (the conversation id).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::openai::OpenAIError;
use crate::paths::get_app_state_dir;

const PI_SESSION_DIR: &str = "pi-sessions";
/// How long Pi gets to wind down after an abort before the child is killed.
const ABORT_GRACE: Duration = Duration::from_millis(if cfg!(test) { 200 } else { 5000 });
/// Tool output kept on the synced message record; full output stays in Pi's session file.
const OUTPUT_TAIL_CHARS: usize = 2000;

#[derive(Debug, PartialEq)]
pub enum PiEvent {
    Text(String),
    Reasoning(String),
    /// A finished tool call, named and shaped for the existing tool card.
    Tool { name: String, payload: Value },
    /// A dialog from a Pi extension that needs an answer before Pi continues.
    Dialog { id: String },
    /// Pi has no more automatic work for this prompt.
    Settled { error: Option<String> },
}

/// Folds Pi's session events into the pieces a Harness turn renders.
#[derive(Default)]
pub struct PiTurnState {
    has_text: bool,
    break_pending: bool,
    tool_args: HashMap<String, Value>,
    last_error: Option<String>,
}

impl PiTurnState {
    pub fn apply(&mut self, record: &Value) -> Vec<PiEvent> {
        let str_at = |key: &str| record.get(key).and_then(|v| v.as_str()).unwrap_or("");
        match str_at("type") {
            "message_start" => {
                if message_role(record) == "assistant" {
                    // Text after a tool round reads as a new paragraph, not a run-on.
                    self.break_pending = self.has_text;
                    self.last_error = None;
                }
                Vec::new()
            }
            "message_update" => {
                let Some(event) = record.get("assistantMessageEvent") else {
                    return Vec::new();
                };
                let delta = event.get("delta").and_then(|v| v.as_str()).unwrap_or("");
                if delta.is_empty() {
                    return Vec::new();
                }
                match event.get("type").and_then(|v| v.as_str()) {
                    Some("text_delta") => {
                        let mut out = Vec::new();
                        if self.break_pending {
                            self.break_pending = false;
                            out.push(PiEvent::Text("\n\n".into()));
                        }
                        self.has_text = true;
                        out.push(PiEvent::Text(delta.to_string()));
                        out
                    }
                    Some("thinking_delta") => vec![PiEvent::Reasoning(delta.to_string())],
                    _ => Vec::new(),
                }
            }
            "message_end" => {
                let message = record.get("message");
                let stop = message
                    .and_then(|m| m.get("stopReason"))
                    .and_then(|v| v.as_str());
                if message_role(record) == "assistant" && stop == Some("error") {
                    let detail = message
                        .and_then(|m| m.get("errorMessage"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("The model request failed.");
                    self.last_error = Some(detail.to_string());
                }
                Vec::new()
            }
            "tool_execution_start" => {
                if let Some(args) = record.get("args") {
                    self.tool_args
                        .insert(str_at("toolCallId").to_string(), args.clone());
                }
                Vec::new()
            }
            "tool_execution_end" => {
                let args = self
                    .tool_args
                    .remove(str_at("toolCallId"))
                    .unwrap_or_else(|| json!({}));
                vec![PiEvent::Tool {
                    name: harness_tool_name(str_at("toolName")),
                    payload: tool_payload(&args, record),
                }]
            }
            "response" => {
                let failed = record.get("success").and_then(|v| v.as_bool()) == Some(false);
                if failed && str_at("command") == "prompt" {
                    let detail = match str_at("error") {
                        "" => "Pi rejected the prompt.",
                        other => other,
                    };
                    return vec![PiEvent::Settled {
                        error: Some(detail.to_string()),
                    }];
                }
                Vec::new()
            }
            "extension_ui_request" => {
                let is_dialog = matches!(str_at("method"), "select" | "confirm" | "input" | "editor");
                match (is_dialog, str_at("id")) {
                    (true, id) if !id.is_empty() => vec![PiEvent::Dialog { id: id.to_string() }],
                    _ => Vec::new(),
                }
            }
            "agent_settled" => vec![PiEvent::Settled {
                error: self.last_error.take(),
            }],
            _ => Vec::new(),
        }
    }
}

fn message_role(record: &Value) -> &str {
    record
        .get("message")
        .and_then(|m| m.get("role"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

/// Pi's tool names mapped onto the coding tool names the chat UI already labels.
fn harness_tool_name(pi_name: &str) -> String {
    match pi_name {
        "read" => "ws_read",
        "edit" => "ws_edit",
        "write" => "ws_write",
        "bash" => "run_command",
        "grep" | "find" => "ws_search",
        "ls" => "ws_list_tree",
        other => other,
    }
    .to_string()
}

fn tool_payload(args: &Value, end: &Value) -> Value {
    let mut payload = serde_json::Map::new();
    for key in ["path", "command", "pattern"] {
        if let Some(value) = args.get(key).and_then(|v| v.as_str()) {
            payload.insert(key.into(), json!(value));
        }
    }
    payload.insert(
        "isError".into(),
        json!(end.get("isError").and_then(|v| v.as_bool()).unwrap_or(false)),
    );
    if let Some(ms) = end.get("durationMs").and_then(|v| v.as_f64()) {
        payload.insert("durationMs".into(), json!(ms.round() as u64));
    }
    let output = result_text(end.get("result"));
    if !output.is_empty() {
        payload.insert("outputTail".into(), json!(tail_chars(&output, OUTPUT_TAIL_CHARS)));
    }
    Value::Object(payload)
}

fn result_text(result: Option<&Value>) -> String {
    let Some(blocks) = result.and_then(|r| r.get("content")).and_then(|c| c.as_array()) else {
        return String::new();
    };
    blocks
        .iter()
        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn tail_chars(text: &str, max: usize) -> String {
    let count = text.chars().count();
    if count <= max {
        return text.to_string();
    }
    text.chars().skip(count - max).collect()
}

/// Folders searched for `pi` and handed to it as PATH. A GUI app launched from
/// Finder gets a bare PATH, so the usual install locations are added.
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|raw| std::env::split_paths(&raw).collect())
        .unwrap_or_default();
    let mut extra = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(home) = dirs::home_dir() {
        extra.push(home.join(".npm-global/bin"));
        extra.push(home.join(".local/bin"));
        extra.push(home.join(".bun/bin"));
    }
    for dir in extra {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

/// `HARNESS_PI_BIN` wins; otherwise the first `pi` on the search path.
pub fn find_pi_binary() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("HARNESS_PI_BIN") {
        let path = PathBuf::from(explicit);
        return path.is_file().then_some(path);
    }
    search_dirs()
        .into_iter()
        .map(|dir| dir.join("pi"))
        .find(|candidate| candidate.is_file())
}

pub struct PiTurn<'a> {
    pub root: &'a Path,
    pub conversation_id: &'a str,
    pub prompt: &'a str,
    pub api_key: &'a str,
    pub model: &'a str,
}

/// Run one prompt through Pi and stream it back. Returns the assistant text;
/// a stopped turn returns what was written so far.
pub async fn run_turn<F, R, T>(
    turn: PiTurn<'_>,
    on_text: F,
    on_reasoning: R,
    on_tool: T,
    cancel: &CancellationToken,
) -> Result<String, OpenAIError>
where
    F: FnMut(&str),
    R: FnMut(&str),
    T: FnMut(String, Value),
{
    let binary = find_pi_binary().ok_or_else(|| {
        OpenAIError::Api(
            "Pi is not installed. Run `npm install -g @earendil-works/pi-coding-agent`, \
             or set HARNESS_PI_BIN to the pi executable."
                .into(),
        )
    })?;
    let session_dir = get_app_state_dir().join(PI_SESSION_DIR);
    run_turn_with(&binary, &session_dir, turn, on_text, on_reasoning, on_tool, cancel).await
}

async fn run_turn_with<F, R, T>(
    binary: &Path,
    session_dir: &Path,
    turn: PiTurn<'_>,
    mut on_text: F,
    mut on_reasoning: R,
    mut on_tool: T,
    cancel: &CancellationToken,
) -> Result<String, OpenAIError>
where
    F: FnMut(&str),
    R: FnMut(&str),
    T: FnMut(String, Value),
{
    std::fs::create_dir_all(session_dir)
        .map_err(|e| OpenAIError::Api(format!("Could not create the Pi session folder: {e}")))?;

    let mut cmd = Command::new(binary);
    cmd.args(["--mode", "rpc", "--no-approve"])
        .arg("--session-dir")
        .arg(session_dir)
        .args(["--session-id", turn.conversation_id])
        .args(["--model", &format!("openai/{}", turn.model)])
        .args(["--thinking", crate::openai::CHAT_REASONING_EFFORT])
        .current_dir(turn.root)
        .env("OPENAI_API_KEY", turn.api_key)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Ok(path) = std::env::join_paths(search_dirs()) {
        cmd.env("PATH", path);
    }
    // Pi needs the OpenAI key; the other app secrets stay out of its tools' reach.
    for key in [
        "VITE_OPENAI_API_KEY",
        "TAVILY_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "R2_SECRET_ACCESS_KEY",
    ] {
        cmd.env_remove(key);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| OpenAIError::Api(format!("Could not start Pi: {e}")))?;
    let mut stdin = child.stdin.take();
    let stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text).await;
        text
    });

    let prompt = json!({ "id": "prompt", "type": "prompt", "message": turn.prompt });
    send_record(&mut stdin, &prompt)
        .await
        .map_err(|e| OpenAIError::Api(format!("Could not reach Pi: {e}")))?;

    let mut state = PiTurnState::default();
    let mut content = String::new();
    let mut outcome: Option<Option<String>> = None;
    let mut abort_deadline: Option<tokio::time::Instant> = None;
    // Split on LF only; Pi's JSON strings may hold other Unicode line separators.
    let mut records = BufReader::new(stdout).split(b'\n');

    while outcome.is_none() {
        let deadline = abort_deadline.unwrap_or_else(|| tokio::time::Instant::now() + ABORT_GRACE);
        tokio::select! {
            _ = cancel.cancelled(), if abort_deadline.is_none() => {
                let _ = send_record(&mut stdin, &json!({ "type": "abort" })).await;
                abort_deadline = Some(tokio::time::Instant::now() + ABORT_GRACE);
            }
            _ = tokio::time::sleep_until(deadline), if abort_deadline.is_some() => break,
            next = records.next_segment() => {
                let Ok(Some(raw)) = next else { break };
                let Ok(record) = serde_json::from_slice::<Value>(&raw) else { continue };
                for event in state.apply(&record) {
                    match event {
                        PiEvent::Text(delta) => {
                            content.push_str(&delta);
                            on_text(&delta);
                        }
                        PiEvent::Reasoning(delta) => on_reasoning(&delta),
                        PiEvent::Tool { name, payload } => on_tool(name, payload),
                        PiEvent::Dialog { id } => {
                            // No approval UI is wired to Pi yet; decline so Pi never hangs.
                            let reply = json!({
                                "type": "extension_ui_response",
                                "id": id,
                                "cancelled": true
                            });
                            let _ = send_record(&mut stdin, &reply).await;
                        }
                        PiEvent::Settled { error } => outcome = Some(error),
                    }
                }
            }
        }
    }

    // Closing stdin asks Pi to shut down in an orderly way.
    drop(stdin);
    let unresponsive = outcome.is_none() && abort_deadline.is_some();
    if unresponsive || tokio::time::timeout(ABORT_GRACE, child.wait()).await.is_err() {
        let _ = child.kill().await;
    }

    if cancel.is_cancelled() {
        return Ok(content);
    }
    match outcome {
        Some(None) => Ok(content),
        Some(Some(error)) => Err(OpenAIError::Api(error)),
        None => {
            let stderr_text = stderr_task.await.unwrap_or_default();
            let detail = tail_chars(stderr_text.trim(), 600);
            Err(OpenAIError::Api(if detail.is_empty() {
                "Pi exited before finishing the turn.".into()
            } else {
                format!("Pi exited before finishing the turn: {detail}")
            }))
        }
    }
}

async fn send_record(
    stdin: &mut Option<tokio::process::ChildStdin>,
    record: &Value,
) -> std::io::Result<()> {
    let Some(pipe) = stdin.as_mut() else {
        return Ok(());
    };
    let mut line = record.to_string();
    line.push('\n');
    pipe.write_all(line.as_bytes()).await?;
    pipe.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply_all(records: &[Value]) -> Vec<PiEvent> {
        let mut state = PiTurnState::default();
        records.iter().flat_map(|r| state.apply(r)).collect()
    }

    fn text_delta(delta: &str) -> Value {
        json!({
            "type": "message_update",
            "assistantMessageEvent": { "type": "text_delta", "contentIndex": 0, "delta": delta }
        })
    }

    fn assistant_start() -> Value {
        json!({ "type": "message_start", "message": { "role": "assistant", "content": [] } })
    }

    #[test]
    fn streams_text_and_thinking_deltas() {
        let events = apply_all(&[
            assistant_start(),
            json!({
                "type": "message_update",
                "assistantMessageEvent": { "type": "thinking_delta", "contentIndex": 0, "delta": "hm" }
            }),
            text_delta("Hello "),
            text_delta("there"),
        ]);
        assert_eq!(
            events,
            vec![
                PiEvent::Reasoning("hm".into()),
                PiEvent::Text("Hello ".into()),
                PiEvent::Text("there".into()),
            ]
        );
    }

    #[test]
    fn separates_text_written_after_a_tool_round() {
        let events = apply_all(&[
            assistant_start(),
            text_delta("Reading."),
            assistant_start(),
            text_delta("Done."),
        ]);
        assert_eq!(
            events,
            vec![
                PiEvent::Text("Reading.".into()),
                PiEvent::Text("\n\n".into()),
                PiEvent::Text("Done.".into()),
            ]
        );
    }

    #[test]
    fn maps_tool_calls_to_harness_names_with_args_and_output() {
        let events = apply_all(&[
            json!({
                "type": "tool_execution_start",
                "toolCallId": "call_1",
                "toolName": "bash",
                "args": { "command": "npm test" }
            }),
            json!({
                "type": "tool_execution_end",
                "toolCallId": "call_1",
                "toolName": "bash",
                "result": { "content": [{ "type": "text", "text": "2 failed" }], "details": {} },
                "isError": true,
                "durationMs": 1234.4
            }),
        ]);
        assert_eq!(
            events,
            vec![PiEvent::Tool {
                name: "run_command".into(),
                payload: json!({
                    "command": "npm test",
                    "isError": true,
                    "durationMs": 1234,
                    "outputTail": "2 failed"
                }),
            }]
        );
    }

    #[test]
    fn keeps_only_the_tail_of_long_output() {
        let long = "x".repeat(OUTPUT_TAIL_CHARS + 50) + "END";
        assert_eq!(tail_chars(&long, OUTPUT_TAIL_CHARS).chars().count(), OUTPUT_TAIL_CHARS);
        assert!(tail_chars(&long, OUTPUT_TAIL_CHARS).ends_with("END"));
    }

    #[test]
    fn settles_with_the_error_only_when_no_retry_recovered() {
        let failed = json!({
            "type": "message_end",
            "message": { "role": "assistant", "stopReason": "error", "errorMessage": "401" }
        });
        let settled = json!({ "type": "agent_settled", "aborted": false });

        let events = apply_all(&[assistant_start(), failed.clone(), settled.clone()]);
        assert_eq!(events, vec![PiEvent::Settled { error: Some("401".into()) }]);

        let recovered = apply_all(&[
            assistant_start(),
            failed,
            assistant_start(),
            text_delta("ok"),
            settled,
        ]);
        assert_eq!(
            recovered,
            vec![PiEvent::Text("ok".into()), PiEvent::Settled { error: None }]
        );
    }

    #[test]
    fn rejected_prompt_settles_with_its_error() {
        let events = apply_all(&[json!({
            "id": "prompt",
            "type": "response",
            "command": "prompt",
            "success": false,
            "error": "No model selected"
        })]);
        assert_eq!(
            events,
            vec![PiEvent::Settled { error: Some("No model selected".into()) }]
        );
    }

    #[test]
    fn only_blocking_dialogs_need_an_answer() {
        let events = apply_all(&[
            json!({ "type": "extension_ui_request", "id": "a", "method": "notify" }),
            json!({ "type": "extension_ui_request", "id": "b", "method": "confirm" }),
        ]);
        assert_eq!(events, vec![PiEvent::Dialog { id: "b".into() }]);
    }

    /// A stand-in `pi` that replays canned records, then waits for stdin to close.
    #[cfg(unix)]
    fn fake_pi(dir: &Path, records: &[Value], hang: bool) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let lines: String = records.iter().map(|r| format!("{r}\n")).collect();
        std::fs::write(dir.join("records.jsonl"), lines).unwrap();
        let tail = if hang { "sleep 60" } else { "cat > /dev/null" };
        let script = format!(
            "#!/bin/sh\nread -r prompt\necho \"$prompt\" > \"{0}/prompt.json\"\ncat \"{0}/records.jsonl\"\n{tail}\n",
            dir.display()
        );
        let path = dir.join("pi");
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    fn turn(root: &Path) -> PiTurn<'_> {
        PiTurn {
            root,
            conversation_id: "conv-1",
            prompt: "list the files",
            api_key: "test-key",
            model: "test-model",
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runs_a_turn_against_a_pi_process() {
        let dir = tempfile::tempdir().unwrap();
        let binary = fake_pi(
            dir.path(),
            &[
                assistant_start(),
                text_delta("Looking."),
                json!({
                    "type": "tool_execution_start",
                    "toolCallId": "c1",
                    "toolName": "read",
                    "args": { "path": "a.txt" }
                }),
                json!({
                    "type": "tool_execution_end",
                    "toolCallId": "c1",
                    "toolName": "read",
                    "result": { "content": [{ "type": "text", "text": "hi" }] },
                    "isError": false
                }),
                assistant_start(),
                text_delta("One file."),
                json!({ "type": "agent_settled", "aborted": false }),
            ],
            false,
        );
        let mut tools = Vec::new();
        let result = run_turn_with(
            &binary,
            &dir.path().join("sessions"),
            turn(dir.path()),
            |_| {},
            |_| {},
            |name, payload| tools.push((name, payload)),
            &CancellationToken::new(),
        )
        .await;

        assert_eq!(result.unwrap(), "Looking.\n\nOne file.");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].0, "ws_read");
        assert_eq!(tools[0].1["path"], "a.txt");
        let sent: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("prompt.json")).unwrap())
                .unwrap();
        assert_eq!(sent["type"], "prompt");
        assert_eq!(sent["message"], "list the files");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reports_a_pi_process_that_exits_early() {
        let dir = tempfile::tempdir().unwrap();
        let binary = fake_pi(dir.path(), &[assistant_start(), text_delta("partial")], false);
        // Replace the trailing wait so the process exits without settling.
        let script = std::fs::read_to_string(&binary)
            .unwrap()
            .replace("cat > /dev/null", "echo 'boom' >&2");
        std::fs::write(&binary, script).unwrap();

        let result = run_turn_with(
            &binary,
            &dir.path().join("sessions"),
            turn(dir.path()),
            |_| {},
            |_| {},
            |_, _| {},
            &CancellationToken::new(),
        )
        .await;
        let message = result.unwrap_err().to_string();
        assert!(message.contains("exited before finishing"), "{message}");
        assert!(message.contains("boom"), "{message}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stopping_a_turn_keeps_the_text_so_far() {
        let dir = tempfile::tempdir().unwrap();
        let binary = fake_pi(dir.path(), &[assistant_start(), text_delta("half")], true);
        let cancel = CancellationToken::new();
        let stopper = cancel.clone();
        let seen = std::cell::Cell::new(false);
        let result = run_turn_with(
            &binary,
            &dir.path().join("sessions"),
            turn(dir.path()),
            |_| {
                if !seen.replace(true) {
                    stopper.cancel();
                }
            },
            |_| {},
            |_, _| {},
            &cancel,
        )
        .await;
        assert_eq!(result.unwrap(), "half");
    }
}
