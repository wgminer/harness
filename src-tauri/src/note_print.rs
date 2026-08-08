use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub async fn print_html(
    app: &AppHandle,
    html: &str,
    job_name: Option<&str>,
) -> Result<bool, String> {
    let label = format!("note-print-{}", uuid::Uuid::new_v4());
    let data_url = format!(
        "data:text/html;charset=utf-8,{}",
        urlencoding::encode(html)
    );
    let parsed_url = data_url
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed_url))
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    let job = job_name.unwrap_or("Harness Note");
    let script = format!(
        r#"
        (async () => {{
          document.title = {job:?};
          await new Promise((resolve) => {{
            window.addEventListener('afterprint', () => resolve(true), {{ once: true }});
            window.print();
            setTimeout(() => resolve(false), 30000);
          }});
        }})();
        "#
    );

    window.eval(&script).map_err(|e| e.to_string())?;

    // Allow the print dialog to open before tearing down the hidden window.
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn notes_print(
    app: AppHandle,
    html: String,
    job_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let success = print_html(&app, &html, job_name.as_deref()).await?;
    Ok(serde_json::json!({ "success": success }))
}
