use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub language: String,
    pub aspect_ratio: String,
    pub preferred_quality: String,
    pub parental_control_enabled: bool,
    pub parental_control_pin: String,
    pub hardware_acceleration: bool,
    pub subtitle_color: String,
    pub subtitle_size: String,
    pub buffer_size_seconds: u32,
}

#[cfg(test)]
mod tests {
    use super::first_hls_uri;

    #[test]
    fn reads_first_variant_and_first_media_segment() {
        let master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\n720p/index.m3u8\n";
        let media = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment-01.ts\n";
        assert_eq!(first_hls_uri(master).as_deref(), Some("720p/index.m3u8"));
        assert_eq!(first_hls_uri(media).as_deref(), Some("segment-01.ts"));
        assert_eq!(first_hls_uri("#EXTM3U\n#EXT-X-ENDLIST\n"), None);
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "es".to_string(),
            aspect_ratio: "auto".to_string(),
            preferred_quality: "1080p".to_string(),
            parental_control_enabled: false,
            parental_control_pin: "0000".to_string(),
            hardware_acceleration: true,
            subtitle_color: "white".to_string(),
            subtitle_size: "normal".to_string(),
            buffer_size_seconds: 15,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteItem {
    pub id: String,
    pub title: String,
    pub category: String,
    pub logo: Option<String>,
    pub stream_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: String,
    pub title: String,
    pub category: String,
    pub logo: Option<String>,
    pub stream_url: String,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub last_watched: u64,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub parent_title: Option<String>,
    #[serde(default)]
    pub season_id: Option<String>,
    #[serde(default)]
    pub season_num: Option<u32>,
    #[serde(default)]
    pub episode_num: Option<u32>,
}

pub struct AppState {
    pub data_dir: PathBuf,
    pub settings: Mutex<Settings>,
    pub favorites: Mutex<Vec<FavoriteItem>>,
    pub history: Mutex<Vec<HistoryItem>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCheck {
    pub ok: bool,
    pub status: Option<u16>,
    pub reason: String,
    pub is_hls: bool,
}

fn channel_check(
    ok: bool,
    status: Option<u16>,
    reason: impl Into<String>,
    is_hls: bool,
) -> ChannelCheck {
    ChannelCheck {
        ok,
        status,
        reason: reason.into(),
        is_hls,
    }
}

fn channel_check_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("SwordTV/1.1 (macOS; IPTV channel review)")
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .expect("valid IPTV review client configuration")
    })
}

async fn read_response_prefix(
    response: &mut reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(limit.min(4096));
    while bytes.len() < limit {
        let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? else {
            break;
        };
        let remaining = limit - bytes.len();
        bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
    Ok(bytes)
}

async fn fetch_channel_prefix(
    url: &reqwest::Url,
    limit: usize,
) -> Result<(reqwest::StatusCode, String, Vec<u8>, reqwest::Url), String> {
    let mut response = channel_check_client()
        .get(url.clone())
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let final_url = response.url().clone();
    let bytes = read_response_prefix(&mut response, limit).await?;
    Ok((status, content_type, bytes, final_url))
}

fn is_html_response(content_type: &str, bytes: &[u8]) -> bool {
    content_type.contains("text/html")
        || String::from_utf8_lossy(bytes)
            .trim_start()
            .to_ascii_lowercase()
            .starts_with("<!doctype html")
        || String::from_utf8_lossy(bytes)
            .trim_start()
            .to_ascii_lowercase()
            .starts_with("<html")
}

fn first_hls_uri(playlist: &str) -> Option<String> {
    let lines: Vec<&str> = playlist
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if let Some(index) = lines
        .iter()
        .position(|line| line.starts_with("#EXT-X-STREAM-INF"))
    {
        return lines
            .iter()
            .skip(index + 1)
            .find(|line| !line.starts_with('#'))
            .map(|line| (*line).to_string());
    }
    lines
        .iter()
        .find(|line| !line.starts_with('#'))
        .map(|line| (*line).to_string())
}

async fn check_channel_stream(url: reqwest::Url, depth: u8) -> ChannelCheck {
    let (status, content_type, bytes, final_url) = match fetch_channel_prefix(&url, 65_536).await {
        Ok(response) => response,
        Err(reason) => return channel_check(false, None, reason, false),
    };
    let is_hls = url.path().to_ascii_lowercase().ends_with(".m3u8")
        || content_type.contains("mpegurl")
        || String::from_utf8_lossy(&bytes)
            .trim_start()
            .starts_with("#EXTM3U");
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return channel_check(
            false,
            Some(status.as_u16()),
            format!("HTTP {}", status.as_u16()),
            is_hls,
        );
    }
    if bytes.is_empty() || is_html_response(&content_type, &bytes) {
        return channel_check(
            false,
            Some(status.as_u16()),
            "La dirección no entregó una señal de video válida",
            is_hls,
        );
    }

    if is_hls {
        let playlist = String::from_utf8_lossy(&bytes);
        let Some(next_uri) = first_hls_uri(&playlist) else {
            return channel_check(
                false,
                Some(status.as_u16()),
                "La lista HLS no contiene variantes ni segmentos",
                true,
            );
        };
        let next_url = match final_url.join(&next_uri) {
            Ok(url) if matches!(url.scheme(), "http" | "https") => url,
            _ => {
                return channel_check(
                    false,
                    Some(status.as_u16()),
                    "La lista HLS contiene una dirección de segmento inválida",
                    true,
                )
            }
        };
        if depth >= 2 {
            let (segment_status, segment_type, segment, _) =
                match fetch_channel_prefix(&next_url, 1024).await {
                    Ok(response) => response,
                    Err(reason) => {
                        return channel_check(false, Some(status.as_u16()), reason, true)
                    }
                };
            let segment_ok = segment_status.is_success()
                || segment_status == reqwest::StatusCode::PARTIAL_CONTENT;
            if !segment_ok || segment.is_empty() || is_html_response(&segment_type, &segment) {
                return channel_check(
                    false,
                    Some(segment_status.as_u16()),
                    "No se pudo leer el primer segmento HLS",
                    true,
                );
            }
            return channel_check(
                true,
                Some(segment_status.as_u16()),
                "Manifiesto y primer segmento responden",
                true,
            );
        }
        let mut result = Box::pin(check_channel_stream(next_url, depth + 1)).await;
        result.is_hls = true;
        return result;
    }

    channel_check(
        true,
        Some(status.as_u16()),
        "La dirección entrega datos de video",
        false,
    )
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        fs::create_dir_all(&data_dir).ok();

        let settings_file = data_dir.join("settings.json");
        let settings = if let Ok(content) = fs::read_to_string(&settings_file) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Settings::default()
        };

        let fav_file = data_dir.join("favorites.json");
        let favorites = if let Ok(content) = fs::read_to_string(&fav_file) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        };

        let hist_file = data_dir.join("history.json");
        let history = if let Ok(content) = fs::read_to_string(&hist_file) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        };

        Self {
            data_dir,
            settings: Mutex::new(settings),
            favorites: Mutex::new(favorites),
            history: Mutex::new(history),
        }
    }

    pub fn save_settings_to_disk(&self) {
        if let Ok(settings) = self.settings.lock() {
            let path = self.data_dir.join("settings.json");
            if let Ok(json) = serde_json::to_string_pretty(&*settings) {
                let _ = fs::write(path, json);
            }
        }
    }

    pub fn save_favorites_to_disk(&self) {
        if let Ok(favs) = self.favorites.lock() {
            let path = self.data_dir.join("favorites.json");
            if let Ok(json) = serde_json::to_string_pretty(&*favs) {
                let _ = fs::write(path, json);
            }
        }
    }

    pub fn save_history_to_disk(&self) {
        if let Ok(hist) = self.history.lock() {
            let path = self.data_dir.join("history.json");
            if let Ok(json) = serde_json::to_string_pretty(&*hist) {
                let _ = fs::write(path, json);
            }
        }
    }
}

pub mod cmd {
    use super::*;

    #[tauri::command]
    pub fn get_settings(state: State<AppState>) -> Result<Settings, String> {
        state
            .settings
            .lock()
            .map(|s| s.clone())
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn save_settings(state: State<AppState>, new_settings: Settings) -> Result<(), String> {
        {
            let mut s = state.settings.lock().map_err(|e| e.to_string())?;
            *s = new_settings;
        }
        state.save_settings_to_disk();
        Ok(())
    }

    #[tauri::command]
    pub fn get_favorites(state: State<AppState>) -> Result<Vec<FavoriteItem>, String> {
        state
            .favorites
            .lock()
            .map(|f| f.clone())
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn toggle_favorite(state: State<AppState>, item: FavoriteItem) -> Result<bool, String> {
        let mut favs = state.favorites.lock().map_err(|e| e.to_string())?;
        let is_fav = if let Some(idx) = favs.iter().position(|f| f.id == item.id) {
            favs.remove(idx);
            false
        } else {
            favs.push(item);
            true
        };
        drop(favs);
        state.save_favorites_to_disk();
        Ok(is_fav)
    }

    #[tauri::command]
    pub fn get_history(state: State<AppState>) -> Result<Vec<HistoryItem>, String> {
        state
            .history
            .lock()
            .map(|h| h.clone())
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn save_history(state: State<AppState>, item: HistoryItem) -> Result<(), String> {
        let mut hist = state.history.lock().map_err(|e| e.to_string())?;
        if let Some(pos) = hist.iter().position(|h| h.id == item.id) {
            hist.remove(pos);
        }
        hist.insert(0, item);
        if hist.len() > 50 {
            hist.truncate(50);
        }
        drop(hist);
        state.save_history_to_disk();
        Ok(())
    }

    #[tauri::command]
    pub fn clear_history(state: State<AppState>) -> Result<(), String> {
        let mut hist = state.history.lock().map_err(|e| e.to_string())?;
        hist.clear();
        drop(hist);
        state.save_history_to_disk();
        Ok(())
    }

    #[tauri::command]
    pub async fn fetch_m3u_content(url: String) -> Result<String, String> {
        let parsed_url =
            reqwest::Url::parse(&url).map_err(|_| "La URL de la lista no es válida".to_string())?;
        if !matches!(parsed_url.scheme(), "http" | "https") {
            return Err("La lista debe usar HTTP o HTTPS".to_string());
        }
        let client = reqwest::Client::builder()
            .user_agent("SwordTV/1.0 (Macintosh; Intel Mac OS X)")
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;

        let mut resp = client
            .get(parsed_url)
            .send()
            .await
            .map_err(|e| format!("Error conectando a {}: {}", url, e))?;

        if !resp.status().is_success() {
            return Err(format!("Respuesta HTTP inválida: {}", resp.status()));
        }

        const MAX_M3U_BYTES: usize = 25 * 1024 * 1024;
        if resp
            .content_length()
            .is_some_and(|size| size > MAX_M3U_BYTES as u64)
        {
            return Err("La lista supera el límite de 25 MB".to_string());
        }
        let bytes = read_response_prefix(&mut resp, MAX_M3U_BYTES + 1).await?;
        if bytes.len() > MAX_M3U_BYTES {
            return Err("La lista supera el límite de 25 MB".to_string());
        }
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    #[tauri::command]
    pub async fn validate_channel_url(url: String) -> ChannelCheck {
        let parsed_url = match reqwest::Url::parse(&url) {
            Ok(url) if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() => url,
            _ => return channel_check(false, None, "La dirección debe usar HTTP o HTTPS", false),
        };
        check_channel_stream(parsed_url, 0).await
    }

    #[tauri::command]
    pub fn export_channels_m3u(content: String, app: AppHandle) -> Result<String, String> {
        if content.len() > 25 * 1024 * 1024 {
            return Err("La lista supera el límite de 25 MB".to_string());
        }
        let documents = app.path().document_dir().map_err(|err| err.to_string())?;
        fs::create_dir_all(&documents).map_err(|err| err.to_string())?;
        let path = documents.join("ListaActual.m3u");
        fs::write(&path, content).map_err(|err| err.to_string())?;
        Ok(path.display().to_string())
    }

    #[tauri::command]
    pub fn toggle_fullscreen(app: AppHandle) -> Result<(), String> {
        if let Some(window) = app.get_webview_window("main") {
            let is_fs = window.is_fullscreen().unwrap_or(false);
            let _ = window.set_fullscreen(!is_fs);
        }
        Ok(())
    }

    #[tauri::command]
    pub fn drag_window(window: tauri::Window) -> Result<(), String> {
        let _ = window.start_dragging();
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                std::env::var_os("LOCALAPPDATA")
                    .map(|local| PathBuf::from(local).join("SwordTV"))
                    .or_else(|| {
                        std::env::var_os("HOME")
                            .map(|home| PathBuf::from(home).join("Library/Application Support/SwordTV"))
                    })
                    .unwrap_or_else(|| std::env::temp_dir().join("SwordTV"))
            });
            fs::create_dir_all(&data_dir)?;
            app.manage(AppState::new(data_dir.clone()));

            let engine_script = app
                .path()
                .resource_dir()
                .ok()
                .map(|dir| dir.join("stremio_engine/engine_server.js"));
            let Some(engine_script) = engine_script.filter(|path| path.is_file()) else {
                log::error!("Bundled Stremio engine script was not found in app resources");
                return Ok(());
            };
            let engine_dir = engine_script
                .parent()
                .unwrap_or(&engine_script)
                .to_path_buf();
            let mut node_candidates = Vec::new();
            if cfg!(target_os = "windows") {
                if let Ok(exe) = std::env::current_exe() {
                    if let Some(dir) = exe.parent() {
                        node_candidates.push(dir.join("node.exe"));
                        node_candidates.push(dir.join("resources/node.exe"));
                    }
                }
                if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                    node_candidates.push(PathBuf::from(local).join("Programs/nodejs/node.exe"));
                }
                if let Some(pf) = std::env::var_os("ProgramFiles") {
                    node_candidates.push(PathBuf::from(pf).join("nodejs/node.exe"));
                }
                node_candidates.push(PathBuf::from("C:/Program Files/nodejs/node.exe"));
                node_candidates.push(PathBuf::from("node.exe"));
            } else {
                if let Some(home) = std::env::var_os("HOME") {
                    let home = PathBuf::from(home);
                    node_candidates.push(home.join(".nodejs/bin/node"));
                    node_candidates.push(home.join(".nvm/current/bin/node"));
                }
                node_candidates.push(PathBuf::from("/opt/homebrew/bin/node"));
                node_candidates.push(PathBuf::from("/usr/local/bin/node"));
                node_candidates.push(PathBuf::from("node"));
            }

            // The engine and its cache live in writable app data; its code ships inside the app bundle.
            std::thread::spawn(move || {
                let is_running = std::net::TcpStream::connect_timeout(
                    &std::net::SocketAddr::from(([127, 0, 0, 1], 11472)),
                    std::time::Duration::from_millis(400),
                )
                .is_ok();

                if !is_running {
                    for node in node_candidates {
                        if node.is_file()
                            || node == PathBuf::from("node")
                            || node == PathBuf::from("node.exe")
                        {
                            let mut cmd = std::process::Command::new(&node);
                            cmd.arg(&engine_script)
                                .current_dir(&engine_dir)
                                .env("SWORDTV_DATA_DIR", &data_dir)
                                .env("SWORDTV_PARENT_PID", std::process::id().to_string())
                                .env("SWORDTV_LOG_FILE", data_dir.join("swordtv_debug.log"))
                                .env("APP_PATH", &data_dir)
                                .env("SETTINGS_PATH", &data_dir)
                                .stdin(std::process::Stdio::null())
                                .stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null());
                            #[cfg(target_os = "windows")]
                            {
                                use std::os::windows::process::CommandExt;
                                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                            }
                            if let Ok(child) = cmd.spawn() {
                                log::info!("Spawned Stremio EngineServer PID {}", child.id());
                                break;
                            }
                        }
                    }
                }
            });

            let quit_i = MenuItem::with_id(app, "quit", "Salir de SwordTV", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Abrir SwordTV", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let tray_icon_bytes = include_bytes!("../icons/tray-icon.png");
            if let Ok(icon_img) = tauri::image::Image::from_bytes(tray_icon_bytes) {
                let _tray = TrayIconBuilder::new()
                    .icon(icon_img)
                    .icon_as_template(true)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { .. } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app);
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd::get_settings,
            cmd::save_settings,
            cmd::get_favorites,
            cmd::toggle_favorite,
            cmd::get_history,
            cmd::save_history,
            cmd::clear_history,
            cmd::fetch_m3u_content,
            cmd::validate_channel_url,
            cmd::export_channels_m3u,
            cmd::toggle_fullscreen,
            cmd::drag_window
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
