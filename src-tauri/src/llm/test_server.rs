//! A one-connection-per-response HTTP stub for exercising the genai paths offline.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub(super) struct Reply {
    pub status: u16,
    pub content_type: &'static str,
    pub body: String,
}

impl Reply {
    pub fn sse(events: &[Value]) -> Self {
        let body = events
            .iter()
            .map(|event| {
                format!(
                    "event: {}\ndata: {}\n\n",
                    event["type"].as_str().unwrap_or(""),
                    event
                )
            })
            .collect();
        Self { status: 200, content_type: "text/event-stream", body }
    }

    /// Chat Completions-style SSE: data lines only, then `[DONE]`.
    pub fn sse_data(chunks: &[Value]) -> Self {
        let mut body: String = chunks.iter().map(|chunk| format!("data: {chunk}\n\n")).collect();
        body.push_str("data: [DONE]\n\n");
        Self { status: 200, content_type: "text/event-stream", body }
    }

    pub fn json(status: u16, body: Value) -> Self {
        Self { status, content_type: "application/json", body: body.to_string() }
    }
}

/// `response.completed` with the fields genai needs to accept it.
pub(super) fn completed(output: Value) -> Value {
    json!({ "type": "response.completed", "response": {
        "id": "resp_1", "status": "completed", "model": "test-model", "output": output
    } })
}

/// Serves `replies` in order and records each request body. Returns the base URL.
pub(super) async fn serve(replies: Vec<Reply>) -> (String, Arc<Mutex<Vec<Value>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}/v1/", listener.local_addr().unwrap());
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let recorded = bodies.clone();
    tokio::spawn(async move {
        for reply in replies {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let body = read_request_body(&mut socket).await;
            recorded
                .lock()
                .unwrap()
                .push(serde_json::from_slice(&body).unwrap_or(Value::Null));
            let head = format!(
                "HTTP/1.1 {} X\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                reply.status,
                reply.content_type,
                reply.body.len()
            );
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(reply.body.as_bytes()).await;
            let _ = socket.shutdown().await;
        }
    });
    (base_url, bodies)
}

async fn read_request_body(socket: &mut tokio::net::TcpStream) -> Vec<u8> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = socket.read(&mut chunk).await.unwrap_or(0);
        if n == 0 {
            return Vec::new();
        }
        buf.extend_from_slice(&chunk[..n]);
        let Some(header_end) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
            continue;
        };
        let head = String::from_utf8_lossy(&buf[..header_end]).to_lowercase();
        let length = head
            .lines()
            .find_map(|line| line.strip_prefix("content-length:"))
            .and_then(|v| v.trim().parse::<usize>().ok())
            .unwrap_or(0);
        let start = header_end + 4;
        while buf.len() < start + length {
            let n = socket.read(&mut chunk).await.unwrap_or(0);
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        return buf[start..(start + length).min(buf.len())].to_vec();
    }
}
