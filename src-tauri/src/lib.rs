pub mod assistant_tools;
pub mod chat;
pub mod commands;
pub mod conversation_title;
pub mod credentials;
pub mod customization;
pub mod env_util;
pub mod file_tools;
pub mod fn_monitor;
pub mod global_recording;
pub mod global_recording_effects;
pub mod global_recording_session;
pub mod import;
pub mod memory;
pub mod memory_compile;
pub mod memory_import;
pub mod note_print;
pub mod notes;
pub mod openai;
pub mod paths;
pub mod plans;
pub mod recent_conversations;
pub mod recording;
pub mod remote_store;
pub mod settings;
pub mod system_prompt;
pub mod storage;
pub mod sync;
pub mod sync_bundle;
pub mod sync_merge;
pub mod system;
pub mod tasks;
pub mod ui_session;
pub mod updater;

use memory::AppState;
use sync::register_sync_state;
use tauri::Manager;

use crate::chat::ChatController;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let user_data = env_util::user_data_dir();
    eprintln!("[Harness] userData = {}", user_data.display());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .setup(|app| {
            let app_state = AppState::new();
            let sync_runtime = register_sync_state(app_state.clone());
            let recording_runtime = recording::init_recording_runtime(app_state.clone());
            let global_recording_runtime = global_recording::init_global_recording_runtime();
            let updater_runtime = updater::init_updater_runtime();
            app.manage(updater_runtime.clone());

            tauri::async_runtime::block_on(async {
                let _ = sync_runtime.init().await;
                let _ = memory::prune_empty_conversations(&app_state).await;
                global_recording::register_global_recording(
                    app.handle().clone(),
                    global_recording_runtime.clone(),
                    &app_state.write_chains,
                )
                .await;
            });

            let handle = app.handle().clone();
            let chat_controller = ChatController::new(handle.clone(), app_state.clone());

            app.manage(app_state);
            app.manage(chat_controller);
            app.manage(sync_runtime.clone());
            app.manage(recording_runtime);
            app.manage(global_recording_runtime.clone());

            sync::start_sync_background(sync_runtime, handle.clone());
            updater::start_update_check(&handle, updater_runtime);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_get_version,
            commands::env_is_harness_dev,
            commands::env_is_harness_e2e,
            commands::window_get_size,
            commands::window_toggle_size,
            commands::settings_get,
            commands::settings_set,
            commands::settings_get_system_prompt_preview,
            commands::credentials_get_status,
            commands::credentials_get_secrets_for_settings,
            commands::credentials_set_open_ai_api_key,
            commands::credentials_set_tavily_api_key,
            commands::credentials_set_r2_secret_access_key,
            commands::memory_create_conversation,
            commands::memory_get_conversation,
            commands::memory_list_conversations,
            commands::memory_delete_conversation,
            commands::memory_get_messages,
            commands::memory_append_message,
            commands::memory_get_user_memory,
            commands::memory_set_user_memory,
            commands::memory_delete_user_memory_key,
            commands::memory_search_conversations,
            commands::memory_import_from_chat_gpt_folder,
            commands::memory_import_from_claude_folder,
            commands::memory_import_llm_context,
            commands::memory_run_compile_now,
            commands::memory_get_compile_status,
            commands::memory_open_app_data_folder,
            commands::memory_get_data_status,
            commands::memory_cleanup_legacy_memory,
            commands::memory_set_conversation_title,
            commands::memory_mark_voice_dictation_session,
            commands::plans_list,
            commands::plans_create,
            commands::plans_update,
            commands::plans_delete,
            commands::plans_add_conversation,
            commands::plans_remove_conversation,
            commands::tasks_list,
            commands::tasks_create,
            commands::tasks_update,
            commands::tasks_delete,
            commands::tasks_clear_completed,
            commands::chat_send,
            commands::chat_polish_last_user,
            commands::chat_generate_reply,
            commands::chat_stop,
            commands::chat_resolve_gated_tool,
            commands::ui_session_get,
            commands::ui_session_set,
            commands::customization_get_layout_options,
            commands::customization_set_layout,
            commands::file_tools_get_allowed_roots,
            commands::notes_list,
            commands::notes_create,
            commands::notes_read,
            commands::notes_save,
            commands::notes_delete,
            commands::notes_show_in_folder,
            commands::notes_propose_edit,
            commands::notes_spell_check,
            system::system_get_platform,
            system::system_macos_accessibility_trusted,
            system::system_request_accessibility_prompt,
            system::system_open_accessibility_settings,
            sync::sync_get_status,
            sync::sync_run_now,
            sync::sync_test_connection,
            sync::sync_set_r2_secret_access_key,
            sync::sync_set_r2_config,
            recording::recording_request_microphone_access,
            recording::recording_save_wav,
            recording::recording_show_in_folder,
            recording::recording_export_wav,
            recording::recording_open_folder,
            recording::recording_cancel_transcription,
            recording::recording_transcribe,
            recording::recording_paste_text,
            global_recording::recording_set_global_enabled,
            global_recording::recording_done,
            global_recording::recording_start_failed,
            global_recording::recording_signal_frontend_ready,
            global_recording::recording_get_global_status,
            global_recording::e2e_inject_fn_event,
            updater::updater_check,
            updater::updater_get_status,
            updater::updater_download_and_install,
            note_print::notes_print,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
