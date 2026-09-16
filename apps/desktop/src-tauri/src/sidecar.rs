//! Production sidecar supervisor (M3-001). Owns the lmps-sidecar child over the
//! stdio JSON-RPC channel adopted in ADR-0003: spawns it through the shell
//! plugin, performs the per-session token handshake, routes RPC requests from
//! the webview to the child and replies back, restarts a dead child with
//! exponential backoff, and kills it on shutdown so no orphan survives.
//!
//! No business logic lives in Rust (ADR-0001): the supervisor only forwards
//! frames. The actor pattern (tokio mpsc command channel) keeps `CommandChild`
//! owned by one task so no reference ever crosses an await point.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::async_runtime::Receiver;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{mpsc, oneshot, RwLock};

const SIDECAR: &str = "lmps-sidecar";
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const RPC_TIMEOUT: Duration = Duration::from_secs(60);
/// Status broadcast channel (webview + tray listen on the same event).
pub const STATUS_EVENT: &str = "sidecar://status";
const INITIAL_BACKOFF: Duration = Duration::from_millis(500);
const MAX_BACKOFF: Duration = Duration::from_secs(5);
const MAX_RESPAWN_FAILURES: u32 = 3;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SidecarStatus {
    Starting,
    Connected,
    Disconnected,
    AuthFailed,
}

impl SidecarStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Connected => "connected",
            Self::Disconnected => "disconnected",
            Self::AuthFailed => "auth-failed",
        }
    }
}

// ---------------------------------------------------------------------------
// Command channel
// ---------------------------------------------------------------------------

pub(crate) enum SupervisorCmd {
    /// Single-shot RPC: the supervisor assigns nothing; `rpc_id` was allocated
    /// by the caller and is echoed back so replies route to `reply`. The wait
    /// cap lives caller-side (`tokio::time::timeout` in `rpc_inner`), so the
    /// short-circuiting dispatcher here only forwards the frame.
    Rpc {
        rpc_id: u64,
        method: String,
        params: Value,
        reply: oneshot::Sender<Result<Value, String>>,
    },
    Cancel { rpc_id: u64 },
    /// Best-effort shutdown: kill the child, then signal `shutdown_tx` (std)
    /// so the sync `SupervisorHandle::shutdown_now` can unblock.
    Shutdown,
}

/// Sync command handle owned by Tauri managed state. `Sync`: the std shutdown
/// receiver is wrapped in a `Mutex` (a bare `std::sync::mpsc::Receiver` is not
/// `Sync` and so cannot live inside `tauri::State`).
pub struct SupervisorHandle {
    cmd_tx: mpsc::Sender<SupervisorCmd>,
    status: Arc<RwLock<SidecarStatus>>,
    next_id: AtomicU64,
    shutdown_rx: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl SupervisorHandle {
    pub fn new() -> (Self, mpsc::Receiver<SupervisorCmd>, std::sync::mpsc::Sender<()>) {
        let (cmd_tx, cmd_rx) = mpsc::channel(64);
        let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel();
        let handle = Self {
            cmd_tx,
            status: Arc::new(RwLock::new(SidecarStatus::Starting)),
            next_id: AtomicU64::new(1),
            shutdown_rx: Mutex::new(shutdown_rx),
        };
        (handle, cmd_rx, shutdown_tx)
    }

    pub fn status_handle(&self) -> Arc<RwLock<SidecarStatus>> {
        self.status.clone()
    }

    /// Fire-and-forget cancel frame for an in-flight RPC (M3-002 long ops; the
    /// minimal slice has nothing this long, the wire just stays exercised).
    pub async fn cancel(&self, rpc_id: u64) -> Result<(), String> {
        self.cmd_tx
            .send(SupervisorCmd::Cancel { rpc_id })
            .await
            .map_err(|_| "sidecar supervisor unavailable".to_owned())
    }

    /// Default 60 s cap (keeps probe/hardware/locale calls uniformly bounded).
    pub async fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
        self.rpc_inner(method, params, Some(RPC_TIMEOUT)).await
    }

    /// Long-running calls (benchmark.run) pass their own cap in milliseconds.
    pub async fn rpc_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout_ms: Option<Duration>,
    ) -> Result<Value, String> {
        self.rpc_inner(method, params, timeout_ms).await
    }

    async fn rpc_inner(
        &self,
        method: &str,
        params: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, String> {
        let rpc_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(SupervisorCmd::Rpc {
                rpc_id,
                method: method.to_owned(),
                params,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "sidecar supervisor unavailable".to_owned())?;
        let frame = match timeout.unwrap_or(RPC_TIMEOUT) {
            cap if cap.is_zero() => reply_rx.await,
            cap => tokio::time::timeout(cap, reply_rx).await.map_err(|_| {
                format!("sidecar RPC {method} timed out")
            })?,
        }
        .map_err(|_| "sidecar closed before the reply arrived".to_owned())??;
        if let Some(error) = frame.get("error") {
            let code = error.get("code").and_then(Value::as_str).unwrap_or("RPC_ERROR");
            let message = error.get("message").and_then(Value::as_str).unwrap_or("sidecar error");
            return Err(format!("{code}: {message}"));
        }
        Ok(frame.get("result").cloned().unwrap_or(Value::Null))
    }

    pub async fn current_status(&self) -> String {
        self.status.read().await.as_str().to_owned()
    }

    /// Synchronous best-effort shutdown for the Tauri `ExitRequested` event.
    /// Blocks at most 3 s for the supervisor to kill the child so the desktop
    /// never leaves an orphan sidecar process behind.
    pub fn shutdown_now(&self) {
        let _ = self.cmd_tx.try_send(SupervisorCmd::Shutdown);
        if let Ok(rx) = self.shutdown_rx.lock() {
            let _ = rx.recv_timeout(Duration::from_secs(3));
        }
    }
}

// ---------------------------------------------------------------------------
// Low-level frame helpers (lifted from the M0-006 spike, token prefix changed)
// ---------------------------------------------------------------------------

fn session_token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let mut hasher = DefaultHasher::new();
    (nanos, pid).hash(&mut hasher);
    format!("lmps-desktop-{:016x}", hasher.finish())
}

/// Serialize a value as one JSON line and write it to the sidecar stdin.
/// `CommandChild::write` is synchronous (internal write_all).
fn write_frame(child: &mut CommandChild, value: &Value) -> Result<(), String> {
    let line = serde_json::to_string(value).map_err(|e| format!("encode: {e}"))?;
    child
        .write(format!("{line}\n").as_bytes())
        .map_err(|e| format!("stdin write: {e}"))
}

#[derive(Default)]
struct LineBuffer {
    pending: Vec<u8>,
}

impl LineBuffer {
    /// Feed raw bytes; return the complete newline-terminated lines they produce.
    fn push(&mut self, bytes: Vec<u8>) -> Vec<String> {
        self.pending.extend_from_slice(&bytes);
        let mut out = Vec::new();
        loop {
            let Some(pos) = self.pending.iter().position(|b| *b == b'\n') else {
                break;
            };
            let mut line: Vec<u8> = self.pending.drain(..=pos).collect();
            line.pop(); // trailing \n
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            out.push(String::from_utf8_lossy(&line).into_owned());
        }
        out
    }
}

/// Wait for the next JSON frame on the sidecar stdout. Non-JSON lines are
/// treated as noise and skipped; stderr bytes are surfaced on our stderr.
async fn wait_line(
    rx: &mut Receiver<CommandEvent>,
    buf: &mut LineBuffer,
    deadline: Duration,
) -> Result<Value, String> {
    let started = Instant::now();
    loop {
        let remaining = deadline.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return Err(format!("no sidecar frame within {deadline:?}"));
        }
        match tokio::time::timeout(remaining, rx.recv()).await {
            Err(_) => return Err(format!("no sidecar frame within {deadline:?}")),
            Ok(None) => return Err("sidecar pipe closed".into()),
            Ok(Some(CommandEvent::Stdout(bytes))) => {
                for line in buf.push(bytes) {
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        return Ok(value);
                    }
                }
            }
            Ok(Some(CommandEvent::Stderr(bytes))) => {
                eprintln!("[sidecar stderr] {}", String::from_utf8_lossy(&bytes).trim_end());
            }
            Ok(Some(CommandEvent::Error(error))) => return Err(format!("sidecar error: {error}")),
            Ok(Some(CommandEvent::Terminated(payload))) => {
                return Err(format!("sidecar terminated prematurely: {payload:?}"));
            }
            Ok(Some(_)) => {}
        }
    }
}

struct Running {
    rx: Receiver<CommandEvent>,
    child: CommandChild,
    buf: LineBuffer,
}

#[derive(Debug)]
enum StartupError {
    /// Process-level failure: resolve, spawn, ready line or auth-frame timeout.
    Start(String),
    /// The peer refused or mis-answered the session token handshake.
    Auth(String),
}

/// Spawn the sidecar and complete the stdio handshake. The LM Studio token
/// (SECRET) is passed only into the child's environment when the desktop itself
/// was launched with it; it is never logged or written to a frame.
async fn try_startup(app: &AppHandle) -> Result<Running, StartupError> {
    let token = session_token();
    let mut command = app
        .shell()
        .sidecar(SIDECAR)
        .map_err(|e| StartupError::Start(format!("sidecar resolve: {e}")))?;
    command = command
        .args(["stdio", token.as_str()])
        .env("LMPS_SIDECAR_TRANSPORT", "stdio");
    if let Ok(url) = std::env::var("LMPS_LM_URL") {
        command = command.env("LMPS_LM_URL", url);
    }
    if let Ok(lm_token) = std::env::var("LMPS_LM_TOKEN") {
        command = command.env("LMPS_LM_TOKEN", lm_token);
    }
    // Documented adapter switches: LMPS_ADAPTER=mock drives the deterministic
    // benchmark demo; LMPS_LMS_BIN picks the `lms` CLI for the CLI adapter.
    // LMPS_HOME redirects the data root, which keeps automated shell tests in
    // a throwaway directory instead of the operator's real profile store.
    for key in [
        "LMPS_ADAPTER",
        "LMPS_LMS_BIN",
        "LMPS_LM_BIN",
        "LMPS_HOME",
        // Mock-only deterministic failure controls used by shell acceptance.
        "LMPS_E2E_MOCK_HEALTHCHECK_FAIL_MODEL",
        "LMPS_E2E_MOCK_BENCHMARK_FAIL_MODEL",
        "LMPS_E2E_MOCK_BENCHMARK_GAP_MS",
    ] {
        if let Ok(value) = std::env::var(key) {
            command = command.env(key, value);
        }
    }

    let (mut rx, mut child) = command
        .spawn()
        .map_err(|e| StartupError::Start(format!("sidecar spawn: {e}")))?;
    let mut buf = LineBuffer::default();
    let ready = wait_line(&mut rx, &mut buf, READY_TIMEOUT)
        .await
        .map_err(StartupError::Start)?;
    if ready["event"] != "ready" {
        return Err(StartupError::Start(format!("unexpected first frame: {ready}")));
    }

    write_frame(&mut child, &json!({ "jsonrpc": "2.0", "auth": true, "token": token }))
        .map_err(StartupError::Start)?;
    let auth = wait_line(&mut rx, &mut buf, READY_TIMEOUT)
        .await
        .map_err(StartupError::Start)?;
    if auth.get("error").is_some() {
        return Err(StartupError::Auth(format!("auth refused: {auth}")));
    }
    if auth.get("result").and_then(|r| r.get("authenticated")) != Some(&Value::Bool(true)) {
        return Err(StartupError::Auth(format!("auth unexpected reply: {auth}")));
    }
    Ok(Running { rx, child, buf })
}

/// Route one decoded JSON frame to its pending requester, if any.
fn route_frame(frame: &Value, pending: &mut HashMap<u64, oneshot::Sender<Result<Value, String>>>) {
    if let Some(rpc_id) = frame.get("id").and_then(Value::as_u64) {
        if let Some(reply) = pending.remove(&rpc_id) {
            let _ = reply.send(Ok(frame.clone()));
        }
    }
}

fn fail_all(pending: &mut HashMap<u64, oneshot::Sender<Result<Value, String>>>, reason: &str) {
    for (_, reply) in pending.drain() {
        let _ = reply.send(Err(reason.to_owned()));
    }
}

async fn set_status(app: &AppHandle, status: &RwLock<SidecarStatus>, value: SidecarStatus) {
    *status.write().await = value;
    let _ = app.emit(STATUS_EVENT, value.as_str());
}

/// Serve RPC while the child is alive. Returns `true` when the supervisor
/// should exit (shutdown requested or every commanding state dropped), `false`
/// when the child terminated on its own and a respawn is needed.
async fn run_loop(
    cmd_rx: &mut mpsc::Receiver<SupervisorCmd>,
    shutdown_tx: &std::sync::mpsc::Sender<()>,
    mut running: Running,
) -> bool {
    let mut pending: HashMap<u64, oneshot::Sender<Result<Value, String>>> = HashMap::new();
    loop {
        tokio::select! {
            biased;
            cmd = cmd_rx.recv() => {
                match cmd {
                    None => {
                        // Every commanding state was dropped: app teardown.
                        let _ = running.child.kill();
                        fail_all(&mut pending, "sidecar supervisor shutting down");
                        let _ = shutdown_tx.send(());
                        return true;
                    }
                    Some(SupervisorCmd::Rpc { rpc_id, method, params, reply }) => {
                        let request = json!({
                            "jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params
                        });
                        if write_frame(&mut running.child, &request).is_err() {
                            let _ = reply.send(Err("sidecar stdin write failed".to_owned()));
                            continue;
                        }
                        pending.insert(rpc_id, reply);
                    }
                    Some(SupervisorCmd::Cancel { rpc_id }) => {
                        let _ = write_frame(
                            &mut running.child,
                            &json!({ "jsonrpc": "2.0", "method": "cancel", "params": { "id": rpc_id } }),
                        );
                    }
                    Some(SupervisorCmd::Shutdown) => {
                        let _ = running.child.kill();
                        fail_all(&mut pending, "sidecar supervisor shutting down");
                        let _ = shutdown_tx.send(());
                        return true;
                    }
                }
            }
            event = running.rx.recv() => {
                match event {
                    Some(CommandEvent::Stdout(bytes)) => {
                        for line in running.buf.push(bytes) {
                            if let Ok(frame) = serde_json::from_str::<Value>(&line) {
                                route_frame(&frame, &mut pending);
                            }
                        }
                    }
                    Some(CommandEvent::Stderr(bytes)) => {
                        eprintln!("[sidecar stderr] {}", String::from_utf8_lossy(&bytes).trim_end());
                    }
                    Some(CommandEvent::Error(error)) => {
                        eprintln!("[sidecar error] {error}");
                    }
                    Some(CommandEvent::Terminated(payload)) => {
                        fail_all(&mut pending, "sidecar terminated");
                        eprintln!("[sidecar] terminated {payload:?}");
                        return false;
                    }
                    None => {
                        fail_all(&mut pending, "sidecar pipe closed");
                        return false;
                    }
                    _ => {}
                }
            }
        }
    }
}

/// After a failed attempt, wait `backoff` for the next respawn while still
/// answering commands (RPC replies get an immediate error). Returns `true` on
/// shutdown so the caller can exit cleanly.
async fn wait_before_respawn(
    cmd_rx: &mut mpsc::Receiver<SupervisorCmd>,
    shutdown_tx: &std::sync::mpsc::Sender<()>,
    backoff: Duration,
) -> bool {
    let sleep = tokio::time::sleep(backoff);
    tokio::pin!(sleep);
    loop {
        tokio::select! {
            _ = &mut sleep => return false,
            cmd = cmd_rx.recv() => {
                match cmd {
                    None => return true,
                    Some(SupervisorCmd::Shutdown) => {
                        let _ = shutdown_tx.send(());
                        return true;
                    }
                    Some(SupervisorCmd::Rpc { reply, .. }) => {
                        let _ = reply.send(Err("sidecar unavailable".to_owned()));
                    }
                    Some(SupervisorCmd::Cancel { .. }) => {}
                }
            }
        }
    }
}

async fn drain_commands(
    cmd_rx: &mut mpsc::Receiver<SupervisorCmd>,
    shutdown_tx: &std::sync::mpsc::Sender<()>,
) {
    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            SupervisorCmd::Shutdown => {
                let _ = shutdown_tx.send(());
                return;
            }
            SupervisorCmd::Rpc { reply, .. } => {
                let _ = reply.send(Err("sidecar unavailable (auth failed)".to_owned()));
            }
            SupervisorCmd::Cancel { .. } => {}
        }
    }
}

/// Supervisor entry: start the sidecar, then keep it alive. Respawn uses a
/// fresh token per spawn (the child reads it from argv and keeps no state),
/// exponential backoff (500ms → 1s → 2s → cap 5s) and gives up after
/// `MAX_RESPAWN_FAILURES` consecutive failures. An auth refusal retries once
/// with a fresh token and then stays `auth-failed` with the badge visible.
pub async fn supervisor_main(
    app: AppHandle,
    mut cmd_rx: mpsc::Receiver<SupervisorCmd>,
    status: Arc<RwLock<SidecarStatus>>,
    shutdown_tx: std::sync::mpsc::Sender<()>,
) {
    let mut failures = 0u32;
    let mut backoff = INITIAL_BACKOFF;
    loop {
        set_status(&app, &status, SidecarStatus::Starting).await;
        match try_startup(&app).await {
            Ok(running) => {
                failures = 0;
                backoff = INITIAL_BACKOFF;
                set_status(&app, &status, SidecarStatus::Connected).await;
                let shutting_down = run_loop(&mut cmd_rx, &shutdown_tx, running).await;
                if shutting_down {
                    return;
                }
                set_status(&app, &status, SidecarStatus::Disconnected).await;
            }
            Err(StartupError::Auth(reason)) => {
                eprintln!("[sidecar] auth refused: {reason}");
                set_status(&app, &status, SidecarStatus::AuthFailed).await;
                // One retry with a fresh token, then stop looping.
                set_status(&app, &status, SidecarStatus::Starting).await;
                match try_startup(&app).await {
                    Ok(running) => {
                        failures = 0;
                        backoff = INITIAL_BACKOFF;
                        set_status(&app, &status, SidecarStatus::Connected).await;
                        let shutting_down = run_loop(&mut cmd_rx, &shutdown_tx, running).await;
                        if shutting_down {
                            return;
                        }
                        set_status(&app, &status, SidecarStatus::Disconnected).await;
                    }
                    Err(reason) => {
                        eprintln!("[sidecar] auth failed again: {reason:?}");
                        set_status(&app, &status, SidecarStatus::AuthFailed).await;
                        drain_commands(&mut cmd_rx, &shutdown_tx).await;
                        return;
                    }
                }
            }
            Err(StartupError::Start(reason)) => {
                eprintln!("[sidecar] start failed: {reason}");
                set_status(&app, &status, SidecarStatus::Disconnected).await;
            }
        }

        failures += 1;
        if failures >= MAX_RESPAWN_FAILURES {
            eprintln!("[sidecar] respawn gave up after {failures} consecutive failures");
            drain_commands(&mut cmd_rx, &shutdown_tx).await;
            return;
        }
        let shutting_down = wait_before_respawn(&mut cmd_rx, &shutdown_tx, backoff).await;
        if shutting_down {
            return;
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

// ---------------------------------------------------------------------------
// Tauri commands (webview-invokeable)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn sidecar_status(state: tauri::State<'_, SupervisorHandle>) -> Result<String, String> {
    Ok(state.current_status().await)
}

#[tauri::command]
pub async fn sidecar_rpc(
    state: tauri::State<'_, SupervisorHandle>,
    method: String,
    params: Option<Value>,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    state
        .rpc_with_timeout(
            &method,
            params.unwrap_or(Value::Null),
            timeout_ms.map(Duration::from_millis),
        )
        .await
}

#[tauri::command]
pub async fn sidecar_probe(state: tauri::State<'_, SupervisorHandle>) -> Result<Value, String> {
    state.rpc("probeCapabilities", Value::Null).await
}

#[tauri::command]
pub async fn sidecar_hardware(state: tauri::State<'_, SupervisorHandle>) -> Result<Value, String> {
    state.rpc("hardware", Value::Null).await
}

#[tauri::command]
pub async fn sidecar_sdk_info(state: tauri::State<'_, SupervisorHandle>) -> Result<Value, String> {
    state.rpc("sdkInfo", Value::Null).await
}

#[tauri::command]
pub async fn sidecar_locale_set(
    state: tauri::State<'_, SupervisorHandle>,
    locale: String,
) -> Result<(), String> {
    let _ = state.rpc("settings.setLocale", json!({ "locale": locale })).await?;
    Ok(())
}

#[tauri::command]
pub async fn sidecar_locale_get(
    state: tauri::State<'_, SupervisorHandle>,
) -> Result<Option<String>, String> {
    let frame = state.rpc("settings.getLocale", Value::Null).await?;
    Ok(frame.get("locale").and_then(Value::as_str).map(str::to_owned))
}

#[tauri::command]
pub async fn sidecar_cancel(
    state: tauri::State<'_, SupervisorHandle>,
    id: u64,
) -> Result<(), String> {
    state.cancel(id).await
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_buffer_splits_frames_and_crlf() {
        let mut buf = LineBuffer::default();
        // A partial line is held until the newline arrives.
        let held = buf.push(b"{\"a\":1}".to_vec());
        assert!(held.is_empty());
        // CRLF endings are stripped and complete lines come out in order.
        let lines = buf.push(b"\r\n{\"b\":2}\n".to_vec());
        assert_eq!(lines, vec!["{\"a\":1}", "{\"b\":2}"]);
        assert!(buf.pending.is_empty());
        // A lone CR without LF is not a terminator.
        buf.push(vec![0x0d]);
        assert_eq!(buf.pending, vec![0x0d]);
        // The following LF completes it; CRLF is stripped, leaving an empty line.
        let line = buf.push(b"\n".to_vec());
        assert_eq!(line, vec![""]);
        assert!(buf.pending.is_empty());
    }

    #[test]
    fn session_token_is_unique_and_shaped() {
        let a = session_token();
        let b = session_token();
        assert_ne!(a, b, "two sessions must mint different tokens");
        let prefix = "lmps-desktop-";
        assert!(a.starts_with(prefix));
        assert_eq!(a.len(), prefix.len() + 16);
        assert!(
            a[prefix.len()..].chars().all(|c| c.is_ascii_hexdigit()),
            "suffix must be hex: {a}"
        );
    }

    #[test]
    fn route_frame_delivers_exactly_once_and_ignores_unknown_ids() {
        let (tx, rx) = oneshot::channel();
        let mut pending: HashMap<u64, oneshot::Sender<Result<Value, String>>> = HashMap::new();
        pending.insert(7u64, tx);

        // Frames for unknown ids are ignored, pending stays intact.
        route_frame(&json!({"jsonrpc":"2.0","id":999,"result":1}), &mut pending);
        assert_eq!(pending.len(), 1);
        // Notifications (no id) are ignored too.
        route_frame(&json!({"jsonrpc":"2.0","method":"ping"}), &mut pending);
        assert_eq!(pending.len(), 1);

        route_frame(&json!({"jsonrpc":"2.0","id":7,"result":1}), &mut pending);
        assert_eq!(pending.len(), 0, "the pending entry is consumed");
        let delivered = rx.blocking_recv().expect("channel alive").expect("rpc ok");
        assert_eq!(delivered["result"], 1);

        // A late frame for an already-served id is dropped without panicking.
        route_frame(&json!({"jsonrpc":"2.0","id":7,"result":2}), &mut pending);
        assert_eq!(pending.len(), 0);
    }
}