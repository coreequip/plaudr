use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// Ereignis an die WebView: Raum verlassen (höchstens 1 s), dann selbst mit exit(0) beenden.
/// Nur ein Ereignisname im Tauri-Bus, kein Deep-Link: ein Link plaudr://quit von außen ist ungültig.
const QUIT_EVENT: &str = "plaudr://quit";
/// Argument des Autostarts: Fenster bleibt verborgen, plaudr läuft im Tray.
const HIDDEN_ARG: &str = "--hidden";
/// Antwortet die WebView nicht, beendet die App nach dieser Zeit trotzdem.
const QUIT_FALLBACK: Duration = Duration::from_secs(3);
/// Beim Abmelden des Systems bleibt der WebView so viel Zeit für das Verlassen.
const LEAVE_ON_TERMINATE: Duration = Duration::from_millis(1000);
#[cfg(target_os = "macos")]
const QUIT_MENU_ID: &str = "plaudr-quit";

/// Gesetzt, sobald die App selbst beendet (exit aus der WebView oder der Rückfall).
static EXITING: AtomicBool = AtomicBool::new(false);
static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Bittet die WebView, den Raum zu verlassen und zu beenden; nach QUIT_FALLBACK beendet Rust selbst.
fn request_quit(app: &AppHandle) {
    if QUIT_REQUESTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit(QUIT_EVENT, ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_FALLBACK);
        app.exit(0);
    });
}

/// Abmelden des Systems oder „Beenden“ im Dock: nicht aufzuhalten. Die WebView läuft in einem eigenen
/// Prozess weiter; sie bekommt das Ereignis und kurz Zeit, den Raum zu verlassen, solange dies hier wartet.
fn on_terminate(app: &AppHandle) {
    if !EXITING.swap(true, Ordering::SeqCst) && !QUIT_REQUESTED.load(Ordering::SeqCst) {
        let _ = app.emit(QUIT_EVENT, ());
        std::thread::sleep(LEAVE_ON_TERMINATE);
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Zuerst: Eine zweite Instanz (Doppelstart, unter Windows jeder plaudr://-Link) reicht ihre
        // Argumente samt Link an diese weiter und beendet sich, bevor sie ein Fenster oder die Identität
        // anfasst. Der Link kommt über das Deep-Link-Plugin in der WebView an; hier nur nach vorn holen,
        // außer beim Autostart (--hidden), der im Tray bleiben soll.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if !argv.iter().any(|a| a == HIDDEN_ARG) {
                show_main(app);
            }
        }))
        // plaudr://-Links; ausgewertet wird in der WebView (platform/desktop.ts, deep-link.ts).
        .plugin(tauri_plugin_deep_link::init())
        // Beim Anmelden starten (im Tray): Der Autostart übergibt --hidden.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        // Sicherungsdatei über den nativen Speichern- und Öffnen-Dialog. Lesen und schreiben darf die
        // WebView nur die Datei, die im Dialog gewählt wurde (der Dialog gibt genau sie frei).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Globale Push-to-Talk-Taste; belegt und abgemeldet wird sie vom Web-Code (platform/desktop.ts).
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Updates: geprüft und installiert wird aus der WebView (platform/updater.ts), nie im Gespräch.
        // Unter Windows beendet der NSIS-Installer die App ohne RunEvent::Exit; den Raum verlässt die
        // WebView daher vor dem Installieren selbst.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // exit(0) aus der WebView, nachdem sie den Raum verlassen hat; relaunch() nach einem Update.
        .plugin(tauri_plugin_process::init());

    // macOS: Cmd+Q beendet sonst sofort (terminate:), ohne dass die WebView den Raum verlassen kann.
    // Das Standardmenü bleibt, nur sein „Beenden“ wird ein eigener Eintrag, der über die WebView läuft.
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app| {
            use tauri::menu::{Menu, MenuItem, MenuItemKind};
            let menu = Menu::default(app)?;
            if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
                // Nur den vordefinierten „Quit …“ ersetzen; ändert Tauri das Standardmenü, bleibt es unangetastet.
                let items = app_menu.items()?;
                let quit = items.iter().position(|i| match i {
                    MenuItemKind::Predefined(p) => p.text().is_ok_and(|t| t.starts_with("Quit")),
                    _ => false,
                });
                let Some(pos) = quit else {
                    return Ok(menu);
                };
                app_menu.remove_at(pos)?;
                app_menu.insert(
                    &MenuItem::with_id(
                        app,
                        QUIT_MENU_ID,
                        "plaudr beenden",
                        true,
                        Some("CmdOrCtrl+Q"),
                    )?,
                    pos,
                )?;
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == QUIT_MENU_ID {
                request_quit(app);
            }
        });

    builder
        .setup(|app| {
            // Das Fenster startet unsichtbar. Mit --hidden (Autostart) bleibt es so,
            // sonst wird es gezeigt, sobald die App bereit ist.
            let hidden = std::env::args().any(|a| a == HIDDEN_ARG);
            // Unter Windows trägt sonst nur der Installer das Schema ein; so findet ein Link auch die
            // ausgepackte plaudr.exe, und nach einem Umzug zeigt der Eintrag wieder auf die richtige Datei.
            #[cfg(windows)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("[plaudr] plaudr://-Schema nicht registrierbar: {err}");
                }
            }
            if !hidden {
                if let Some(window) = app.get_webview_window("main") {
                    window.show()?;
                    // Fokus ist nur eine Bitte an das System; scheitert er, läuft die App trotzdem.
                    let _ = window.set_focus();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("plaudr konnte nicht gestartet werden")
        .run(|app, event| match event {
            // Vom Programm selbst (exit aus der WebView oder Rückfall): durchlassen.
            RunEvent::ExitRequested { code: Some(_), .. } => {
                EXITING.store(true, Ordering::SeqCst);
            }
            // Von außen, etwa wenn das letzte Fenster wirklich zerstört wurde: erst den Raum verlassen.
            RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
                request_quit(app);
            }
            RunEvent::Exit => on_terminate(app),
            // macOS: Klick aufs Dock-Symbol, während das Fenster im Tray ist.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => show_main(app),
            _ => {}
        });
}
