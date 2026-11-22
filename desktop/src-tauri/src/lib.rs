use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Das Fenster startet unsichtbar. Mit --hidden (Autostart) bleibt es so,
            // sonst wird es gezeigt, sobald die App bereit ist.
            let hidden = std::env::args().any(|a| a == "--hidden");
            if !hidden {
                if let Some(window) = app.get_webview_window("main") {
                    window.show()?;
                    // Fokus ist nur eine Bitte an das System; scheitert er, läuft die App trotzdem.
                    let _ = window.set_focus();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("plaudr konnte nicht gestartet werden");
}
