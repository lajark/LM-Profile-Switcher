//! System tray (M3-003). Renders the sidecar's `tray.menu` data spec (ADR-0001:
//! Rust is a dumb renderer — every label, status line, disabled state and the
//! busy/idle split is decided in TypeScript). The latest spec is cached; while
//! an activation is in flight the *busy* half is swapped in locally, so a long
//! (300s capped) apply never round-trips a blocked stdio queue just to redraw
//! the menu. Closing the main window hides it (supervisor + tray stay alive);
//! the tray `quit` item is the one real exit, which shuts the sidecar down
//! through the same ExitRequested branch as before.
//!
//! Action ids are the stable contract: `apply:<profileId>` / `unload` / `open`
//! / `quit`. Menu events arrive on the main thread, so every menu rebuild is
//! deferred onto the async runtime first (`TrayIcon::set_menu` marshals back to
//! the main thread internally — calling it from the main thread would block
//! waiting on itself).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Listener, Manager};

use crate::sidecar;

const TRAY_ID: &str = "lmps-tray";
const MAIN_WINDOW: &str = "main";
const APPLY_TIMEOUT: Duration = Duration::from_secs(300);
const UNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const STATUS_EVENT: &str = "sidecar://status";

/// The stable action an item id names. `apply:<profileId>` carries the target;
/// everything else is one of the fixed commands (mirrors handlers.ts).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayAction {
    Apply(String),
    Unload,
    Open,
    Quit,
    Noop,
}

impl TrayAction {
    pub fn parse(id: &str) -> Self {
        if let Some(profile) = id.strip_prefix("apply:") {
            if !profile.is_empty() {
                return Self::Apply(profile.to_owned());
            }
        }
        match id {
            "unload" => Self::Unload,
            "open" => Self::Open,
            "quit" => Self::Quit,
            _ => Self::Noop,
        }
    }
}

/// `tray.menu` payload, mirrored from the sidecar spec (handlers.ts).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct TrayMenuSpec {
    pub locale: String,
    pub idle: Vec<SpecItem>,
    pub busy: Vec<SpecItem>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SpecItem {
    /// Always present on the wire; defaults keep an odd payload non-fatal.
    #[serde(default)]
    pub id: String,
    pub label: String,
    #[serde(rename = "kind")]
    pub kind: SpecKind,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub checked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpecKind {
    Separator,
    Status,
    Item,
}

/// The renderable projection of one spec item. Kept as data so the mapping is
/// unit-testable; `plan_to_menu` is the only place native types appear.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderItem {
    pub id: String,
    pub is_separator: bool,
    pub label: String,
    pub enabled: bool,
    pub checked: bool,
}

/// Map a spec half (idle or busy) to render rows. Status rows are informational
/// and always inert; checked items become native check rows so the current
/// profile is visibly marked.
pub fn spec_to_plan(items: &[SpecItem]) -> Vec<RenderItem> {
    items
        .iter()
        .map(|item| RenderItem {
            id: item.id.clone(),
            is_separator: item.kind == SpecKind::Separator,
            label: item.label.clone(),
            enabled: item.kind != SpecKind::Status && !item.disabled,
            checked: item.kind == SpecKind::Item && item.checked,
        })
        .collect()
}

/// Minimum usable menu before the first spec arrives (sidecar still booting).
pub fn placeholder_plan() -> Vec<RenderItem> {
    vec![
        RenderItem {
            id: "open".into(),
            is_separator: false,
            label: "Open".into(),
            enabled: true,
            checked: false,
        },
        RenderItem {
            id: "quit".into(),
            is_separator: false,
            label: "Quit".into(),
            enabled: true,
            checked: false,
        },
    ]
}

/// Which half of the spec the shell renders for the current state (pure).
pub fn choose_spec_half<'a>(spec: &'a TrayMenuSpec, busy: bool) -> &'a [SpecItem] {
    if busy {
        &spec.busy
    } else {
        &spec.idle
    }
}

/// Native menu construction from a plan (the only tauri::menu-dependent step).
fn plan_to_menu(app: &AppHandle, plan: &[RenderItem]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::with_id(app, "lmps-tray-menu")?;
    for item in plan {
        if item.is_separator {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        } else if item.checked {
            menu.append(
                &CheckMenuItemBuilder::with_id(&item.id, &item.label)
                    .checked(true)
                    .enabled(item.enabled)
                    .build(app)?,
            )?;
        } else {
            menu.append(
                &MenuItemBuilder::with_id(&item.id, &item.label)
                    .enabled(item.enabled)
                    .build(app)?,
            )?;
        }
    }
    Ok(menu)
}

/// Shared tray state: the latest spec cache, the in-flight flag choosing the
/// busy half, and whether a real quit was requested (deflects stray
/// ExitRequested from hiding the whole app with the tray).
pub struct TrayController {
    app: AppHandle,
    spec: Mutex<Option<TrayMenuSpec>>,
    busy: AtomicBool,
    quitting: AtomicBool,
}

impl TrayController {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            spec: Mutex::new(None),
            busy: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
        }
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    /// Rebuild the native menu from the cached spec. Must run off the main
    /// thread (set_menu marshals to it and blocks the caller).
    fn render(&self) {
        let spec = match self.spec.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => {
                eprintln!("[tray] spec lock poisoned");
                return;
            }
        };
        let busy = self.busy.load(Ordering::SeqCst);
        let plan = match &spec {
            Some(spec) => spec_to_plan(choose_spec_half(spec, busy)),
            None => placeholder_plan(),
        };
        if let Some(tray) = self.app.tray_by_id(TRAY_ID) {
            match plan_to_menu(&self.app, &plan) {
                Ok(menu) => {
                    if let Err(error) = tray.set_menu(Some(menu)) {
                        eprintln!("[tray] set_menu failed: {error}");
                    }
                }
                Err(error) => eprintln!("[tray] menu build failed: {error}"),
            }
        }
    }

    /// Fetch a fresh `tray.menu` spec and re-render (post-action, sidecar
    /// connected event, or a click so externally-applied CLI changes surface).
    pub fn refresh_async(&self) {
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            let frame = app
                .state::<sidecar::SupervisorHandle>()
                .rpc("tray.menu", Value::Null)
                .await;
            let controller = app.state::<TrayController>();
            match frame {
                Ok(value) => match serde_json::from_value::<TrayMenuSpec>(value) {
                    Ok(spec) => {
                        if let Ok(mut guard) = controller.spec.lock() {
                            *guard = Some(spec);
                        }
                    }
                    Err(error) => eprintln!("[tray] tray.menu payload mismatch: {error}"),
                },
                Err(error) => eprintln!("[tray] tray.menu refresh failed: {error}"),
            }
            controller.render();
        });
    }

    pub fn on_menu_event(&self, event: &tauri::menu::MenuEvent) {
        match TrayAction::parse(event.id().as_ref()) {
            TrayAction::Noop => {}
            TrayAction::Open => self.open_window(),
            TrayAction::Quit => self.request_quit(),
            TrayAction::Unload => self.run_unload(),
            TrayAction::Apply(profile) => self.run_apply(&profile),
        }
    }

    fn open_window(&self) {
        if let Some(window) = self.app.get_webview_window(MAIN_WINDOW) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    /// The one real exit path: mark the quit so ExitRequested shuts the sidecar
    /// down instead of deflecting, then let the event loop close the app.
    fn request_quit(&self) {
        self.quitting.store(true, Ordering::SeqCst);
        self.app.exit(0);
    }

    fn run_apply(&self, profile: &str) {
        if self.busy.swap(true, Ordering::SeqCst) {
            // Another activation owns the flag; its task clears it and refreshes.
            return;
        }
        let app = self.app.clone();
        let profile = profile.to_owned();
        tauri::async_runtime::spawn(async move {
            // Busy half is rendered locally from the cached spec first, so the
            // menu swaps to "Working…" even though this RPC may run for minutes
            // and block the stdio queue.
            app.state::<TrayController>().render();
            let result = app
                .state::<sidecar::SupervisorHandle>()
                .rpc_with_timeout(
                    "activation.apply",
                    json!({ "id": profile }),
                    Some(APPLY_TIMEOUT),
                )
                .await;
            let controller = app.state::<TrayController>();
            controller.busy.store(false, Ordering::SeqCst);
            if let Err(error) = &result {
                eprintln!("[tray] activation.apply failed: {error}");
            }
            controller.render();
            controller.refresh_async();
        });
    }

    fn run_unload(&self) {
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            let result = app
                .state::<sidecar::SupervisorHandle>()
                .rpc_with_timeout("activation.unload", Value::Null, Some(UNLOAD_TIMEOUT))
                .await;
            if let Err(error) = &result {
                eprintln!("[tray] activation.unload failed: {error}");
            }
            app.state::<TrayController>().refresh_async();
        });
    }
}

/// Build the tray icon and attach it to the app. The Tauri tray manager retains
/// the icon by id, so the handle may be dropped. A placeholder menu keeps the
/// tray usable until the sidecar is up; the supervisor's connected event then
/// asks for the first real spec.
pub fn attach(app: &AppHandle) -> tauri::Result<()> {
    // Embed the small-size raster in dev and packaged builds; missing assets fail compilation.
    let icon = tauri::include_image!("icons/app-32.png");

    let template = tauri::menu::Menu::new(app)?;
    template.append(
        &MenuItemBuilder::with_id("open", "Open").build(app)?,
    )?;
    template.append(
        &MenuItemBuilder::with_id("quit", "Quit").build(app)?,
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&template)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Some(controller) = app.try_state::<TrayController>() {
                controller.on_menu_event(&event);
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click refreshes the menu so CLI-side activations surface too.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(controller) = tray.app_handle().try_state::<TrayController>() {
                    controller.refresh_async();
                }
            }
        })
        .build(app)?;

    let handle = app.clone();
    // The listener id (u32) is intentionally not kept: the listener lives for
    // the app's lifetime, exactly like the tray itself.
    app.listen_any(STATUS_EVENT, move |event| {
        // The supervisor emits the status name as a JSON string payload.
        if serde_json::from_str::<String>(event.payload()).ok().as_deref() == Some("connected") {
            if let Some(controller) = handle.try_state::<TrayController>() {
                controller.refresh_async();
            }
        }
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, label: &str, kind: SpecKind) -> SpecItem {
        SpecItem {
            id: id.into(),
            label: label.into(),
            kind,
            disabled: false,
            checked: false,
        }
    }

    #[test]
    fn parse_action_contract() {
        assert_eq!(
            TrayAction::parse("apply:alpha"),
            TrayAction::Apply("alpha".into())
        );
        assert_eq!(TrayAction::parse("unload"), TrayAction::Unload);
        assert_eq!(TrayAction::parse("open"), TrayAction::Open);
        assert_eq!(TrayAction::parse("quit"), TrayAction::Quit);
        // Status/section rows carry ids that are NOT actions.
        assert_eq!(TrayAction::parse("status"), TrayAction::Noop);
        assert_eq!(TrayAction::parse("section-recent"), TrayAction::Noop);
        assert_eq!(TrayAction::parse("apply:"), TrayAction::Noop);
    }

    #[test]
    fn plan_contract_status_rows_are_inert() {
        let plan = spec_to_plan(&[
            item("status", "Current: alpha", SpecKind::Status),
            item("sep-status", "", SpecKind::Separator),
            item("open", "Open window", SpecKind::Item),
        ]);
        assert_eq!(plan.len(), 3);
        assert!(!plan[0].enabled, "status rows are informational");
        assert!(plan[1].is_separator);
        assert!(plan[2].enabled);
    }

    #[test]
    fn checked_and_disabled_items_flow_into_the_plan() {
        let mut apply = item("apply:alpha", "Alpha", SpecKind::Item);
        apply.disabled = true;
        apply.checked = true;
        let plan = spec_to_plan(&[apply]);
        assert!(!plan[0].enabled);
        assert!(plan[0].checked);
    }

    #[test]
    fn busy_half_is_selected_while_in_flight() {
        let spec = TrayMenuSpec {
            locale: "en".into(),
            idle: vec![item("status", "Current: alpha", SpecKind::Status)],
            busy: vec![item("status", "Working…", SpecKind::Status)],
        };
        assert_eq!(choose_spec_half(&spec, false)[0].label, "Current: alpha");
        assert_eq!(choose_spec_half(&spec, true)[0].label, "Working…");
    }
}