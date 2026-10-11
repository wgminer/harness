//! Loopback listener that lets an external button stand in for the Fn key.
//!
//! Off unless `HARNESS_EXTERNAL_TRIGGER_PORT` is set. A client connects to
//! 127.0.0.1 on that port and sends newline-terminated `down` / `up` edges,
//! which take the same path as Fn edges from `fn_tap`.

use std::sync::Arc;

use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::env_util::external_trigger_port;
use crate::recording::global::{dispatch_fn_edge, GlobalRecordingRuntime};

pub fn start(app: AppHandle, runtime: Arc<GlobalRecordingRuntime>) {
    let Some(port) = external_trigger_port() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => listener,
            Err(e) => {
                eprintln!("[Harness:recording] external trigger could not bind {port}: {e}");
                return;
            }
        };
        eprintln!("[Harness:recording] external trigger listening on 127.0.0.1:{port}");
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            tauri::async_runtime::spawn(read_edges(stream, app.clone(), runtime.clone()));
        }
    });
}

async fn read_edges(stream: TcpStream, app: AppHandle, runtime: Arc<GlobalRecordingRuntime>) {
    let mut lines = BufReader::new(stream).lines();
    let mut pressed = false;
    while let Ok(Some(line)) = lines.next_line().await {
        let phase = line.trim();
        if phase != "down" && phase != "up" {
            continue;
        }
        pressed = phase == "down";
        dispatch_fn_edge(&app, &runtime, phase, now_ms()).await;
    }
    // A client that drops while held must not leave the session stuck recording.
    if pressed {
        dispatch_fn_edge(&app, &runtime, "up", now_ms()).await;
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
