mod sidecar;
mod tray;

use tauri::Manager;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// M3-001 desktop shell: hosts the webview, supervises the lmps-sidecar child
/// over the stdio JSON-RPC channel (ADR-0003) and bridges the minimal
/// verification-page commands. No business logic lives in Rust (ADR-0001); the
/// supervisor only forwards frames between the webview and the sidecar.
///
/// M3-003 adds the system tray: closing the window hides it (the app keeps the
/// sidecar supervisor and the tray becomes the home), the tray menu is rendered
/// opaquely from the sidecar spec, and Quit is the one real exit — the
/// ExitRequested branch shuts the sidecar down with a bounded wait so no orphan
/// process survives, exactly as before the tray existed.
pub fn run() {
    let (supervisor, cmd_rx, shutdown_tx) = sidecar::SupervisorHandle::new();
    let status = supervisor.status_handle();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(supervisor)
        .invoke_handler(tauri::generate_handler![
            sidecar::sidecar_status,
            sidecar::sidecar_rpc,
            sidecar::sidecar_probe,
            sidecar::sidecar_hardware,
            sidecar::sidecar_sdk_info,
            sidecar::sidecar_locale_set,
            sidecar::sidecar_locale_get,
            sidecar::sidecar_cancel,
        ])
        .on_window_event(|window, event| {
            // Close hides to the tray (M3-003): the window lives until tray
            // Quit, so the app keeps running and Open brings it back.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let status = status.clone();
            tauri::async_runtime::spawn(async move {
                sidecar::supervisor_main(handle, cmd_rx, status, shutdown_tx).await;
            });
            let tray = tray::TrayController::new(app.handle().clone());
            app.manage(tray);
            // The attach listener may fire before/after the supervisor connects;
            // refresh is triggered by the sidecar's connected event, tray clicks,
            // and post-action refreshes, so the menu self-heals.
            if let Err(error) = tray::attach(app.handle()) {
                eprintln!("[tray] attach failed: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("LMPS desktop: failed to build the Tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                // A stray exit (e.g. the OS asking the app to terminate while the
                // window is hidden) is deflected — the tray is the home. Only the
                // tray's explicit Quit (quitting=true) lets the app exit, and it
                // shuts the sidecar down so no orphan survives.
                let quitting = app_handle
                    .try_state::<tray::TrayController>()
                    .map(|state| state.is_quitting())
                    .unwrap_or(false);
                if !quitting {
                    api.prevent_exit();
                } else if let Some(supervisor) = app_handle.try_state::<sidecar::SupervisorHandle>() {
                    supervisor.shutdown_now();
                }
            }
        });
}