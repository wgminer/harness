pub mod canonical_json;
pub mod chat;
pub mod coding;
pub mod commands;
pub mod credentials;
pub mod customization;
pub mod env_util;
pub mod memory;
pub mod images;
pub mod notes;
pub mod openai;
pub mod paths;
pub mod recording;
pub mod settings;
pub mod state;
pub mod storage;
pub mod sync;
pub mod system;
pub mod tasks;
pub mod ui_session;
pub mod updater;
pub mod weather;

use state::AppState;
use notes::sticky::persist_open_sticky_windows;
use sync::register_sync_state;
use tauri::{LogicalSize, Manager, RunEvent};

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
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_min_size(Some(LogicalSize::new(800.0, 600.0)));
            }

            let app_state = AppState::new();
            let sync_runtime = register_sync_state(app_state.clone());
            let recording_runtime = recording::init_recording_runtime(app_state.clone());
            let global_recording_runtime =
                recording::global::init_global_recording_runtime(app_state.clone());
            let updater_runtime = updater::init_updater_runtime();
            app.manage(updater_runtime.clone());

            tauri::async_runtime::block_on(async {
                let _ = sync_runtime.init().await;
                let _ = memory::prune_empty_conversations(&app_state).await;
                recording::global::register_global_recording(
                    app.handle().clone(),
                    global_recording_runtime.clone(),
                    &app_state.write_chains,
                )
                .await;
                notes::sticky::restore_sticky_windows(&app.handle(), &app_state).await;
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

            let image_generation_runtime = images::init_image_generation_runtime();
            app.manage(image_generation_runtime);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_get_version,
            commands::app::env_is_harness_dev,
            commands::app::env_is_harness_e2e,
            commands::app::env_is_stub_images,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_get_system_prompt_preview,
            commands::credentials::credentials_get_status,
            commands::credentials::credentials_get_secrets_for_settings,
            commands::credentials::credentials_set_open_ai_api_key,
            commands::credentials::credentials_set_tavily_api_key,
            commands::credentials::credentials_set_r2_secret_access_key,
            commands::memory::memory_create_conversation,
            commands::memory::memory_set_conversation_chat_mode,
            commands::memory::memory_get_conversation,
            commands::memory::memory_list_conversations,
            commands::memory::memory_delete_conversation,
            commands::memory::memory_get_messages,
            commands::memory::memory_append_message,
            commands::memory::memory_get_user_memory,
            commands::memory::memory_set_user_memory,
            commands::memory::memory_delete_user_memory_key,
            commands::memory::memory_search_conversations,
            commands::memory::memory_import_from_chat_gpt_folder,
            commands::memory::memory_preview_claude_import,
            commands::memory::memory_confirm_claude_import,
            commands::memory::memory_import_llm_context,
            commands::memory::memory_open_app_data_folder,
            commands::memory::memory_get_data_status,
            commands::memory::memory_cleanup_legacy_memory,
            commands::memory::memory_set_conversation_title,
            commands::memory::memory_mark_voice_dictation_session,
            commands::memory::memory_link_dictation_recording,
            commands::memory::memory_get_conversation_recordings,
            commands::tasks::tasks_list,
            commands::tasks::tasks_create,
            commands::tasks::tasks_update,
            commands::tasks::tasks_delete,
            commands::tasks::tasks_clear_completed,
            commands::chat::chat_send,
            commands::chat::chat_polish_last_user,
            commands::chat::chat_generate_reply,
            commands::chat::chat_ensure_dictation_reply_action,
            commands::chat::chat_get_context_preview,
            commands::chat::chat_stop,
            commands::chat::chat_resolve_gated_tool,
            commands::chat::chat_get_active_turn,
            commands::ui::ui_session_get,
            commands::ui::ui_session_set,
            commands::ui::customization_get_layout_options,
            commands::ui::customization_set_layout,
            commands::coding::coding_get_scope,
            commands::coding::coding_pick_project_folder,
            commands::coding::coding_get_self_scope,
            commands::coding::coding_set_scope,
            commands::coding::coding_self_scope_available,
            commands::notes::notes_list,
            commands::notes::notes_create,
            commands::notes::notes_read,
            commands::notes::notes_save,
            commands::notes::notes_delete,
            commands::notes::notes_show_in_folder,
            commands::notes::notes_propose_edit,
            commands::notes::notes_spell_check,
            commands::images::search_lookup_image,
            commands::images::images_list,
            commands::images::images_create,
            commands::images::images_read,
            commands::images::images_delete,
            commands::images::images_generate,
            commands::images::images_cancel,
            commands::images::images_set_active_version,
            commands::images::images_delete_version,
            commands::images::images_copy_to_clipboard,
            commands::images::images_reveal_in_finder,
            system::system_get_platform,
            system::system_macos_accessibility_trusted,
            system::system_request_accessibility_prompt,
            system::system_open_accessibility_settings,
            system::system_open_microphone_settings,
            system::system_open_speech_recognition_settings,
            system::system_show_in_folder,
            sync::sync_get_status,
            sync::sync_run_now,
            sync::sync_test_connection,
            sync::sync_set_r2_secret_access_key,
            sync::sync_set_r2_config,
            recording::recording_request_microphone_access,
            recording::recording_microphone_permission_status,
            recording::recording_stage_dropped_audio,
            recording::recording_save_wav,
            recording::recording_show_in_folder,
            recording::recording_export_wav,
            recording::recording_open_folder,
            recording::recording_count_files,
            recording::recording_archive_stats,
            recording::recording_cancel_transcription,
            recording::recording_transcribe,
            recording::recording_paste_text,
            recording::global::recording_signal_frontend_ready,
            recording::global::recording_get_global_status,
            recording::global::recording_retry_global_transcription,
            recording::global::recording_cancel_global_transcription,
            recording::global::recording_cancel_global_session,
            recording::global::recording_stop_global_recording,
            recording::global::e2e_inject_fn_event,
            updater::updater_check,
            updater::updater_get_status,
            updater::updater_download_and_install,
            weather::weather_get_current,
            notes::print::notes_print,
            commands::notes::notes_open_sticky,
            commands::notes::notes_set_sticky_pinned,
            commands::notes::notes_set_sticky_title,
            commands::notes::notes_pop_in_sticky,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                persist_open_sticky_windows(app);
            }
        });
}
