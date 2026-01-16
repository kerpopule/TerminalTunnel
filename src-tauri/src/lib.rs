use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::sync::atomic::{AtomicBool, Ordering};
use std::io::{BufRead, BufReader};
use std::thread;
use std::net::TcpStream;
use std::time::Duration;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{
    AppHandle, Manager, Runtime,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter,
};
use regex::Regex;
use tauri_plugin_updater::UpdaterExt;
use serde::Serialize;
use tauri_plugin_dialog::{Dialog, FileDialogBuilder};

// ...

#[tauri::command]
async fn request_folder_access<R: Runtime>(
    app: AppHandle<R>,
    _path: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let dialog_plugin_state = app.state::<Dialog<R>>();
    FileDialogBuilder::new(dialog_plugin_state.inner().clone())
        .pick_folder(move |path| {
            tx.send(path).unwrap();
        });

    // This will block until the user has selected a folder or cancelled the dialog
    match rx.recv().unwrap() {
        Some(path) => {
            let path_str = path.to_string();
            log::info!("User granted access to folder: {}", path_str);
            Ok(Some(path_str))
        }
        None => {
            log::info!("User cancelled folder picker");
            Ok(None)
        }
    }
}

// Global state for managing processes
struct AppState {
    server_process: Mutex<Option<Child>>,
    tunnel_process: Mutex<Option<Child>>,
    sidecar_process: Mutex<Option<Child>>,
    tunnel_url: Arc<Mutex<Option<String>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            server_process: Mutex::new(None),
            tunnel_process: Mutex::new(None),
            sidecar_process: Mutex::new(None),
            tunnel_url: Arc::new(Mutex::new(None)),
        }
    }
}

fn resolve_lsof_path() -> Option<PathBuf> {
    let candidates = ["/usr/sbin/lsof", "/usr/bin/lsof"];
    for path in candidates {
        if Path::new(path).exists() {
            return Some(PathBuf::from(path));
        }
    }
    None
}

fn kill_port_listener(port: u16) {
    let Some(lsof_path) = resolve_lsof_path() else {
        log::warn!("lsof not found; skipping port {} cleanup", port);
        return;
    };

    let output = Command::new(lsof_path)
        .args([format!("-tiTCP:{}", port), "-sTCP:LISTEN".to_string()])
        .output();

    let output = match output {
        Ok(output) => output,
        Err(err) => {
            log::warn!("Failed to run lsof for port {}: {}", port, err);
            return;
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pids: Vec<&str> = stdout.lines().filter(|line| !line.trim().is_empty()).collect();
    if pids.is_empty() {
        return;
    }

    for pid in pids {
        let status = Command::new("kill").args(["-9", pid]).status();
        if let Err(err) = status {
            log::warn!("Failed to kill pid {} on port {}: {}", pid, port, err);
        } else {
            log::info!("Killed pid {} on port {}", pid, port);
        }
    }
}

// Check if server is healthy by polling the /health endpoint
fn wait_for_server_health(max_attempts: u32, delay_ms: u64) -> bool {
    use std::io::{Read, Write};

    for attempt in 1..=max_attempts {
        log::info!("Health check attempt {}/{}", attempt, max_attempts);

        // Try to connect and send HTTP request
        match TcpStream::connect_timeout(
            &"127.0.0.1:3456".parse().unwrap(),
            Duration::from_millis(1000),
        ) {
            Ok(mut stream) => {
                // Set read timeout
                let _ = stream.set_read_timeout(Some(Duration::from_millis(2000)));

                // Send HTTP GET request
                let request = "GET /health HTTP/1.1\r\nHost: localhost:3456\r\nConnection: close\r\n\r\n";
                if stream.write_all(request.as_bytes()).is_ok() {
                    let mut response = String::new();
                    if stream.read_to_string(&mut response).is_ok() {
                        // Check for 200 OK response
                        if response.contains("200 OK") && response.contains("status") {
                            log::info!("Server health check passed on attempt {}", attempt);
                            return true;
                        }
                    }
                }
            }
            Err(e) => {
                log::debug!("Health check connection failed: {}", e);
            }
        }

        if attempt < max_attempts {
            thread::sleep(Duration::from_millis(delay_ms));
        }
    }

    log::warn!("Server health check failed after {} attempts", max_attempts);
    false
}

// Tauri commands exposed to frontend
#[tauri::command]
fn get_tunnel_url(state: tauri::State<AppState>) -> Option<String> {
    state.tunnel_url.lock().unwrap().clone()
}

#[tauri::command]
fn is_server_running(state: tauri::State<AppState>) -> bool {
    state.server_process.lock().unwrap().is_some()
}

#[tauri::command]
fn restart_server(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    stop_server_internal(&state);
    start_server_internal(&app, &state).map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_server(state: tauri::State<AppState>) -> Result<(), String> {
    stop_server_internal(&state);
    Ok(())
}

#[tauri::command]
fn start_tunnel(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    start_tunnel_internal(&app, &state).map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_tunnel(state: tauri::State<AppState>) -> Result<(), String> {
    stop_tunnel_internal(&state);
    Ok(())
}

#[tauri::command]
fn restart_tunnel(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    stop_tunnel_internal(&state);
    start_tunnel_internal(&app, &state).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_tunnel_url(state: tauri::State<AppState>) -> Result<String, String> {
    state.tunnel_url.lock().unwrap()
        .clone()
        .ok_or_else(|| "No tunnel URL available".to_string())
}

// Update info structure for frontend
#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn is_claude_code_installed() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let settings_path = std::path::Path::new(&home).join(".claude").join("settings.json");
    settings_path.exists()
}

#[tauri::command]
fn is_claude_mem_installed() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let worker_path = std::path::Path::new(&home)
        .join(".claude-mem")
        .join("plugin")
        .join("scripts")
        .join("worker-service.cjs");
    worker_path.exists()
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            log::info!("Update available: {}", update.version);
            Ok(Some(UpdateInfo {
                version: update.version.clone(),
                current_version: env!("CARGO_PKG_VERSION").to_string(),
                body: update.body.clone(),
            }))
        }
        Ok(None) => {
            log::info!("No update available");
            Ok(None)
        }
        Err(e) => {
            log::error!("Failed to check for updates: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            log::info!("Downloading update: {}", update.version);

            // Emit download progress events
            let app_handle = app.clone();
            let mut downloaded: usize = 0;

            update.download_and_install(
                |chunk_length, content_length| {
                    downloaded += chunk_length;
                    let progress = if let Some(total) = content_length {
                        (downloaded as f64 / total as f64 * 100.0) as u32
                    } else {
                        0
                    };
                    let _ = app_handle.emit("update-download-progress", progress);
                },
                || {
                    log::info!("Download finished, installing...");
                    let _ = app_handle.emit("update-installing", true);
                },
            ).await.map_err(|e| e.to_string())?;

            log::info!("Update installed, restarting...");
            app.restart();
        }
        Ok(None) => {
            Err("No update available".to_string())
        }
        Err(e) => {
            Err(e.to_string())
        }
    }
}

// Find the project root directory
fn find_project_root() -> Option<std::path::PathBuf> {
    // In dev mode, CARGO_MANIFEST_DIR points to src-tauri
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = std::path::PathBuf::from(manifest_dir);
        // Go up one level to project root
        if let Some(parent) = manifest_path.parent() {
            if parent.join("package.json").exists() {
                return Some(parent.to_path_buf());
            }
        }
    }

    // Try current directory
    if let Ok(current_dir) = std::env::current_dir() {
        // Check if we're in the project root
        if current_dir.join("package.json").exists() {
            return Some(current_dir);
        }

        // Check if we're in src-tauri
        if current_dir.ends_with("src-tauri") {
            if let Some(parent) = current_dir.parent() {
                if parent.join("package.json").exists() {
                    return Some(parent.to_path_buf());
                }
            }
        }

        // Check parent directories
        let mut dir = current_dir.as_path();
        while let Some(parent) = dir.parent() {
            if parent.join("package.json").exists() && parent.join("server").exists() {
                return Some(parent.to_path_buf());
            }
            dir = parent;
        }
    }

    None
}

// Internal functions
fn start_server_internal(app: &AppHandle, state: &AppState) -> Result<(), Box<dyn std::error::Error>> {
    let mut server = state.server_process.lock().unwrap();

    if server.is_some() {
        log::info!("Server already running");
        return Ok(()); // Already running
    }

    // Emit starting status
    let _ = app.emit("server-status", "starting");

    // Check if we're running in production (bundled app) or development
    let is_production = !cfg!(debug_assertions);

    let child = if is_production {
        // Start PTY sidecar in production before the server
        if !cfg!(debug_assertions) {
            if let Err(err) = start_sidecar_internal(app, state) {
                log::error!("Failed to start PTY sidecar: {}", err);
            }
        }

        // Production mode: Use bundled Node.js and server
        let resource_dir = app.path().resource_dir()
            .map_err(|e| format!("Could not get resource dir: {}", e))?;

        let node_path = resource_dir.join("bin").join("node");
        let server_path = resource_dir.join("server").join("server.js");

        // Check if bundled resources exist
        if !node_path.exists() {
            return Err(format!("Bundled Node.js not found at {:?}", node_path).into());
        }
        if !server_path.exists() {
            return Err(format!("Bundled server not found at {:?}", server_path).into());
        }

        log::info!("Starting bundled server with Node.js at {:?}", node_path);

        // Set environment for node-pty to find its native module
        let pty_binary_path = resource_dir
            .join("server")
            .join("node_modules")
            .join("node-pty")
            .join("build")
            .join("Release")
            .join("pty.node");

        let mut cmd = Command::new(&node_path);
        cmd
            .arg(&server_path)
            .env("NODE_ENV", "production")
            .env("PORT", "3456")
            .env("NODE_PTY_BINARY", &pty_binary_path)
            .env_remove("npm_config_prefix")
            .env_remove("NPM_CONFIG_PREFIX")
            .env_remove("npm_config_userconfig")
            .env_remove("NPM_CONFIG_USERCONFIG")
            .env_remove("npm_config_globalconfig")
            .env_remove("NPM_CONFIG_GLOBALCONFIG")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if std::env::var("PTY_BACKEND").is_err() {
            cmd.env("PTY_BACKEND", "sidecar");
        }
        if std::env::var("PTY_SIDECAR_URL").is_err() {
            cmd.env("PTY_SIDECAR_URL", "http://127.0.0.1:3457");
        }
        if std::env::var("SERVER_LOG").is_err() {
            let log_dir = default_log_dir();
            let _ = fs::create_dir_all(&log_dir);
            cmd.env("SERVER_LOG", log_dir.join("server.log"));
        }
        if std::env::var("PTY_SIDECAR_LOG").is_err() {
            let log_dir = default_log_dir();
            let _ = fs::create_dir_all(&log_dir);
            cmd.env("PTY_SIDECAR_LOG", log_dir.join("pty-sidecar.log"));
        }

        cmd.spawn()?
    } else {
        // Development mode: Use npm run dev:server
        let project_root = find_project_root()
            .ok_or("Could not find project root directory")?;

        log::info!("Starting dev server from project root: {:?}", project_root);

        let mut cmd = Command::new("npm");
        cmd
            .args(["run", "dev:server"])
            .current_dir(&project_root)
            .env("MT_FORCE_RESTART", "1")
            .env_remove("npm_config_prefix")
            .env_remove("NPM_CONFIG_PREFIX")
            .env_remove("npm_config_userconfig")
            .env_remove("NPM_CONFIG_USERCONFIG")
            .env_remove("npm_config_globalconfig")
            .env_remove("NPM_CONFIG_GLOBALCONFIG")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if std::env::var("PTY_BACKEND").is_err() {
            cmd.env("PTY_BACKEND", "sidecar");
        }
        if std::env::var("PTY_SIDECAR_URL").is_err() {
            cmd.env("PTY_SIDECAR_URL", "http://127.0.0.1:3457");
        }
        if std::env::var("SERVER_LOG").is_err() {
            let log_dir = default_log_dir();
            let _ = fs::create_dir_all(&log_dir);
            cmd.env("SERVER_LOG", log_dir.join("server.log"));
        }
        if std::env::var("PTY_SIDECAR_LOG").is_err() {
            let log_dir = default_log_dir();
            let _ = fs::create_dir_all(&log_dir);
            cmd.env("PTY_SIDECAR_LOG", log_dir.join("pty-sidecar.log"));
        }

        cmd.spawn()?
    };

    *server = Some(child);

    // Emit event to frontend
    let _ = app.emit("server-status", "running");
    log::info!("Server started successfully");

    Ok(())
}

fn stop_server_internal(state: &AppState) {
    let mut server = state.server_process.lock().unwrap();
    if let Some(mut child) = server.take() {
        // Get the PID before killing
        let pid = child.id();
        log::info!("Stopping server process (PID: {})", pid);

        // Kill all child processes first on Unix
        #[cfg(unix)]
        {
            let _ = Command::new("pkill")
                .args(["-P", &pid.to_string()])
                .status();
        }

        // Then kill the main process
        let _ = child.kill();
        let _ = child.wait();
        log::info!("Server process stopped");
    }

    stop_sidecar_internal(state);
}

fn start_sidecar_internal(app: &AppHandle, state: &AppState) -> Result<(), Box<dyn std::error::Error>> {
    let mut sidecar = state.sidecar_process.lock().unwrap();

    if sidecar.is_some() {
        log::info!("PTY sidecar already running");
        return Ok(());
    }

    let child = if cfg!(debug_assertions) {
        let project_root = find_project_root()
            .ok_or("Could not find project root directory")?;
        let sidecar_path = project_root.join("pty-sidecar.cjs");

        if !sidecar_path.exists() {
            return Err(format!("PTY sidecar script not found at {:?}", sidecar_path).into());
        }

        let log_dir = default_log_dir();
        let _ = fs::create_dir_all(&log_dir);
        let log_path = log_dir.join("pty-sidecar.log");
        log::info!("Starting PTY sidecar in development (log: {:?})", log_path);

        let bundled_node = project_root.join("src-tauri").join("bin").join("node");
        let mut cmd = if bundled_node.exists() {
            Command::new(&bundled_node)
        } else {
            Command::new("node")
        };

        cmd
            .arg(&sidecar_path)
            .current_dir(&project_root)
            .env("NODE_ENV", "development")
            .env("PTY_SIDECAR_LOG", &log_path)
            .env("PTY_SIDECAR_HOST", "127.0.0.1")
            .env("PTY_SIDECAR_PORT", "3457")
            .env_remove("npm_config_prefix")
            .env_remove("NPM_CONFIG_PREFIX")
            .env_remove("npm_config_userconfig")
            .env_remove("NPM_CONFIG_USERCONFIG")
            .env_remove("npm_config_globalconfig")
            .env_remove("NPM_CONFIG_GLOBALCONFIG")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?
    } else {
        let resource_dir = app.path().resource_dir()
            .map_err(|e| format!("Could not get resource dir: {}", e))?;

        let node_path = resource_dir.join("bin").join("node");
        let sidecar_path = resource_dir.join("pty-sidecar.cjs");
        let server_node_modules = resource_dir.join("server").join("node_modules");

        if !node_path.exists() {
            return Err(format!("Bundled Node.js not found at {:?}", node_path).into());
        }
        if !sidecar_path.exists() {
            return Err(format!("PTY sidecar script not found at {:?}", sidecar_path).into());
        }

        let log_dir = default_log_dir();
        let _ = fs::create_dir_all(&log_dir);
        let log_path = log_dir.join("pty-sidecar.log");

        log::info!("Starting PTY sidecar with Node.js at {:?} (log: {:?})", node_path, log_path);

        Command::new(&node_path)
            .arg(&sidecar_path)
            .current_dir(resource_dir.join("server"))
            .env("NODE_ENV", "production")
            .env("NODE_PATH", server_node_modules)
            .env("PTY_SIDECAR_LOG", &log_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?
    };

    *sidecar = Some(child);
    log::info!("PTY sidecar process spawned");
    Ok(())
}

fn stop_sidecar_internal(state: &AppState) {
    let mut sidecar = state.sidecar_process.lock().unwrap();
    if let Some(mut child) = sidecar.take() {
        let pid = child.id();
        log::info!("Stopping PTY sidecar process (PID: {})", pid);

        #[cfg(unix)]
        {
            let _ = Command::new("pkill")
                .args(["-P", &pid.to_string()])
                .status();
        }

        let _ = child.kill();
        let _ = child.wait();
        log::info!("PTY sidecar process stopped");
    }
}

fn default_log_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join("Library")
        .join("Logs")
        .join("Terminal Tunnel")
}

fn start_tunnel_internal(app: &AppHandle, state: &AppState) -> Result<(), Box<dyn std::error::Error>> {
    let mut tunnel = state.tunnel_process.lock().unwrap();

    if tunnel.is_some() {
        log::info!("Tunnel already running");
        return Ok(()); // Already running
    }

    // Emit starting status
    let _ = app.emit("tunnel-status", "starting");

    // Check if cloudflared is available - try multiple locations
    let cloudflared_path = {
        // 1. Try bundled binary in resource dir
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir.join("bin").join("cloudflared");
            if bundled.exists() {
                log::info!("Using bundled cloudflared: {:?}", bundled);
                bundled.to_string_lossy().to_string()
            } else {
                log::info!("Bundled cloudflared not found at {:?}", bundled);
                "cloudflared".to_string()
            }
        } else {
            // 2. Try project bin directory in dev mode
            if let Some(project_root) = find_project_root() {
                let dev_bundled = project_root.join("src-tauri").join("bin").join("cloudflared");
                if dev_bundled.exists() {
                    log::info!("Using dev cloudflared: {:?}", dev_bundled);
                    dev_bundled.to_string_lossy().to_string()
                } else {
                    log::info!("Dev cloudflared not found at {:?}, using PATH", dev_bundled);
                    "cloudflared".to_string()
                }
            } else {
                // 3. Fall back to PATH
                "cloudflared".to_string()
            }
        }
    };

    log::info!("Starting tunnel with: {}", cloudflared_path);

    // Tunnel to the server in both dev and prod.
    // In dev, the server proxies the UI to Vite for remote access stability.
    let tunnel_port: u16 = 3456;
    let tunnel_url = format!("http://127.0.0.1:{}", tunnel_port);

    log::info!("Tunnel pointing to: {}", tunnel_url);

    let mut child = Command::new(&cloudflared_path)
        .args([
            "tunnel",
            "--url", &tunnel_url,
            "--no-autoupdate",
            "--protocol", "http2",
        ])
        .env_remove("TUNNEL_TOKEN")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    log::info!("Tunnel process spawned (PID: {})", child.id());

    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");
    let app_handle_clone = app.clone();
    let tunnel_url_state = Arc::clone(&state.tunnel_url);
    let (ready_tx, ready_rx) = mpsc::channel::<bool>();
    let found = Arc::new(AtomicBool::new(false));
    let url_regex = Arc::new(Regex::new(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com").unwrap());

    let spawn_reader = |reader: Box<dyn BufRead + Send>, tx: mpsc::Sender<bool>, app_handle: AppHandle, state: Arc<Mutex<Option<String>>>, found: Arc<AtomicBool>, url_regex: Arc<Regex>| {
        thread::spawn(move || {
            for line in reader.lines().map_while(Result::ok) {
                log::info!("cloudflared: {}", line);

                if !found.load(Ordering::Relaxed) {
                    if let Some(captures) = url_regex.find(&line) {
                        let url_str = captures.as_str().to_string();
                        log::info!("Tunnel URL found: {}", url_str);

                        if let Ok(mut guard) = state.lock() {
                            *guard = Some(url_str.clone());
                        }

                        let _ = app_handle.emit("tunnel-url", url_str.clone());
                        let _ = app_handle.emit("tunnel-status", "connected");
                        found.store(true, Ordering::Relaxed);
                        let _ = tx.send(true);
                    }
                }

                if line.contains("QuickTunnel") {
                    log::warn!("QuickTunnel warning: {}", line);
                    let _ = app_handle.emit("tunnel-status", format!("error: {}", line));
                }
            }
        })
    };

    let _stdout_thread = spawn_reader(
        Box::new(BufReader::new(stdout)),
        ready_tx.clone(),
        app_handle_clone.clone(),
        Arc::clone(&tunnel_url_state),
        Arc::clone(&found),
        Arc::clone(&url_regex),
    );
    let _stderr_thread = spawn_reader(
        Box::new(BufReader::new(stderr)),
        ready_tx,
        app_handle_clone,
        tunnel_url_state,
        found,
        url_regex,
    );

    match ready_rx.recv_timeout(Duration::from_secs(40)) {
        Ok(true) => {
            *tunnel = Some(child);
            Ok(())
        }
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = app.emit("tunnel-status", "error: cloudflared failed to establish a tunnel");
            Err("cloudflared failed to establish a tunnel".into())
        }
    }
}

fn stop_tunnel_internal(state: &AppState) {
    let mut tunnel = state.tunnel_process.lock().unwrap();
    if let Some(mut child) = tunnel.take() {
        let pid = child.id();
        log::info!("Stopping tunnel process (PID: {})", pid);

        // Kill child processes first
        #[cfg(unix)]
        {
            let _ = Command::new("pkill")
                .args(["-P", &pid.to_string()])
                .status();
        }

        let _ = child.kill();
        let _ = child.wait();
        log::info!("Tunnel process stopped");
    }

    // Clear the URL
    if let Ok(mut url) = state.tunnel_url.lock() {
        *url = None;
    }
}

// Tray menu creation - commented out as menubar icon is not needed
// Keep function for potential future use
/*
fn create_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
    let copy_url = MenuItem::with_id(app, "copy_url", "Copy Tunnel URL", true, None::<&str>)?;
    let separator1 = MenuItem::with_id(app, "sep1", "─────────────", false, None::<&str>)?;
    let restart_server = MenuItem::with_id(app, "restart_server", "Restart Server", true, None::<&str>)?;
    let restart_tunnel = MenuItem::with_id(app, "restart_tunnel", "Restart Tunnel", true, None::<&str>)?;
    let separator2 = MenuItem::with_id(app, "sep2", "─────────────", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[
        &show,
        &copy_url,
        &separator1,
        &restart_server,
        &restart_tunnel,
        &separator2,
        &quit,
    ])?;

    Ok(menu)
}
*/

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_tunnel_url,
            is_server_running,
            restart_server,
            stop_server,
            start_tunnel,
            stop_tunnel,
            restart_tunnel,
            copy_tunnel_url,
            get_app_version,
            check_for_updates,
            install_update,
            is_claude_code_installed,
            is_claude_mem_installed,
            request_folder_access,
        ])
        .setup(|app| {
            // Setup logging in debug mode
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Tray icon setup - commented out as menubar icon is not needed
            // Window is still accessible via dock icon
            /*
            let menu = create_tray_menu(app.handle())?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "copy_url" => {
                            let state = app.state::<AppState>();
                            let url = state.tunnel_url.lock().unwrap().clone();
                            if let Some(url) = url {
                                let _ = app.emit("copy-to-clipboard", url);
                            }
                        }
                        "restart_server" => {
                            let state = app.state::<AppState>();
                            stop_server_internal(&state);
                            let _ = start_server_internal(app, &state);
                        }
                        "restart_tunnel" => {
                            let state = app.state::<AppState>();
                            stop_tunnel_internal(&state);
                            let _ = start_tunnel_internal(app, &state);
                        }
                        "quit" => {
                            let state = app.state::<AppState>();
                            stop_server_internal(&state);
                            stop_tunnel_internal(&state);
                            stop_sidecar_internal(&state);
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            */

            // Start server and tunnel on app launch
            let app_handle = app.handle().clone();

            // Spawn initialization in background to not block app startup
            thread::spawn(move || {
                log::info!("Starting initialization sequence...");

                // Clean up any orphaned processes from previous runs
                #[cfg(unix)]
                {
                    log::info!("Cleaning up orphaned processes...");
                    // Kill any existing cloudflared tunnel processes (both dev and prod)
                    let _ = Command::new("pkill")
                        .args(["-f", "cloudflared tunnel"])
                        .status();

                    // In development mode, also clean up npm processes
                    if cfg!(debug_assertions) {
                        let _ = Command::new("pkill")
                            .args(["-f", "npm run dev:server"])
                            .status();
                        // Only clear the sidecar port here; the dev client manages Vite.
                        kill_port_listener(3457);
                    }
                    // Brief pause to let processes terminate
                    thread::sleep(std::time::Duration::from_millis(500));
                }

                // Small delay to ensure app is fully initialized
                thread::sleep(std::time::Duration::from_millis(500));

                let state = app_handle.state::<AppState>();

                let external_server = std::env::var("MT_EXTERNAL_SERVER").ok().as_deref() == Some("1");

                if external_server {
                    log::info!("External server enabled; skipping internal server start");
                } else {
                    // Start server
                    log::info!("Starting server...");
                    match start_server_internal(&app_handle, &state) {
                        Ok(_) => log::info!("Server process spawned"),
                        Err(e) => {
                            log::error!("Failed to start server: {}", e);
                            let _ = app_handle.emit("server-status", format!("error: {}", e));
                            return; // Don't continue if server failed to spawn
                        }
                    }
                }

                // Wait for server to be ready (health check with retries)
                // 10 attempts, 500ms between each = up to 5 seconds total
                log::info!("Waiting for server to be ready...");
                let server_ready = wait_for_server_health(10, 500);

                if !server_ready {
                    log::error!("Server failed to become ready - health check timed out");
                    let _ = app_handle.emit("server-status", "error: Server failed to start");
                    // Continue anyway - user may want to retry or the server may still start
                }

                 // Navigate webview to the correct frontend URL
                 // Development: Vite dev server on 5173
                 // Production: bundled server on 3456 (serves the React app + API)
                 if let Some(window) = app_handle.get_webview_window("main") {
                     if cfg!(debug_assertions) {
                         log::info!("Navigating webview to http://127.0.0.1:3456");
                         let _ = window.eval("window.location.replace('http://127.0.0.1:3456')");
                     } else if server_ready {
                         log::info!("Navigating webview to http://localhost:3456");
                         let _ = window.eval("window.location.replace('http://localhost:3456')");
                     }
                 }

                // Only start tunnel if server is ready
                if server_ready {
                    // Start tunnel
                    log::info!("Starting tunnel...");
                    match start_tunnel_internal(&app_handle, &state) {
                        Ok(_) => log::info!("Tunnel started successfully"),
                        Err(e) => {
                            log::error!("Failed to start tunnel: {}", e);
                            let _ = app_handle.emit("tunnel-status", format!("error: {}", e));
                        }
                    }
                } else {
                    log::warn!("Skipping tunnel start - server not ready");
                    let _ = app_handle.emit("tunnel-status", "error: Server not ready");
                }

                log::info!("Initialization sequence complete");
            });

            // Handle window close to hide instead of quit
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
