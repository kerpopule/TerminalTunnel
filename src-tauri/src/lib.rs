use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader};
use std::thread;
use tauri::{
    AppHandle, Manager, Runtime,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter,
};
use regex::Regex;
use tauri_plugin_updater::UpdaterExt;
use serde::Serialize;

// Global state for managing processes
struct AppState {
    server_process: Mutex<Option<Child>>,
    tunnel_process: Mutex<Option<Child>>,
    tunnel_url: Arc<Mutex<Option<String>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            server_process: Mutex::new(None),
            tunnel_process: Mutex::new(None),
            tunnel_url: Arc::new(Mutex::new(None)),
        }
    }
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

    // Find project root
    let project_root = find_project_root()
        .ok_or("Could not find project root directory")?;

    log::info!("Starting server from project root: {:?}", project_root);

    // Emit starting status
    let _ = app.emit("server-status", "starting");

    // Start the Node.js server
    let child = Command::new("npm")
        .args(["run", "dev:server"])
        .current_dir(&project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

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

    let mut child = Command::new(&cloudflared_path)
        .args([
            "tunnel",
            "--url", "http://localhost:5173",
            "--no-autoupdate",
            "--protocol", "quic",
        ])
        .env_remove("TUNNEL_TOKEN")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    log::info!("Tunnel process spawned");

    // Parse tunnel URL from stderr (cloudflared outputs there)
    let stderr = child.stderr.take().expect("Failed to capture stderr");
    let app_handle = app.clone();
    let tunnel_url = Arc::clone(&state.tunnel_url);

    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        let url_regex = Regex::new(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com").unwrap();

        for line in reader.lines().map_while(Result::ok) {
            log::info!("cloudflared: {}", line);

            if let Some(captures) = url_regex.find(&line) {
                let url = captures.as_str().to_string();
                log::info!("Tunnel URL found: {}", url);

                // Store the URL
                if let Ok(mut guard) = tunnel_url.lock() {
                    *guard = Some(url.clone());
                }

                // Emit to frontend
                let _ = app_handle.emit("tunnel-url", url.clone());
                let _ = app_handle.emit("tunnel-status", "connected");
            }
        }
    });

    *tunnel = Some(child);

    Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_tunnel_url,
            is_server_running,
            restart_server,
            stop_server,
            restart_tunnel,
            copy_tunnel_url,
            get_app_version,
            check_for_updates,
            install_update,
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

            // Create system tray with template icon for macOS menubar
            let menu = create_tray_menu(app.handle())?;

            // Use default window icon with template mode for macOS menubar
            // icon_as_template(true) renders it as a silhouette (black/white) automatically
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
                                // Use clipboard API via frontend
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
                            // Cleanup processes before quitting
                            let state = app.state::<AppState>();
                            stop_server_internal(&state);
                            stop_tunnel_internal(&state);
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

            // Start server and tunnel on app launch
            let app_handle = app.handle().clone();

            // Spawn initialization in background to not block app startup
            thread::spawn(move || {
                log::info!("Starting initialization sequence...");

                // Clean up any orphaned processes from previous runs
                #[cfg(unix)]
                {
                    log::info!("Cleaning up orphaned processes...");
                    // Kill any existing dev:server processes
                    let _ = Command::new("pkill")
                        .args(["-f", "npm run dev:server"])
                        .status();
                    // Kill any existing cloudflared tunnel processes
                    let _ = Command::new("pkill")
                        .args(["-f", "cloudflared tunnel"])
                        .status();
                    // Brief pause to let processes terminate
                    thread::sleep(std::time::Duration::from_millis(500));
                }

                // Small delay to ensure app is fully initialized
                thread::sleep(std::time::Duration::from_millis(500));

                let state = app_handle.state::<AppState>();

                // Start server
                log::info!("Starting server...");
                match start_server_internal(&app_handle, &state) {
                    Ok(_) => log::info!("Server started successfully"),
                    Err(e) => {
                        log::error!("Failed to start server: {}", e);
                        let _ = app_handle.emit("server-status", format!("error: {}", e));
                    }
                }

                // Wait for server to be ready before starting tunnel
                thread::sleep(std::time::Duration::from_secs(2));

                // Start tunnel
                log::info!("Starting tunnel...");
                match start_tunnel_internal(&app_handle, &state) {
                    Ok(_) => log::info!("Tunnel started successfully"),
                    Err(e) => {
                        log::error!("Failed to start tunnel: {}", e);
                        let _ = app_handle.emit("tunnel-status", format!("error: {}", e));
                    }
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
