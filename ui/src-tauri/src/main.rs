#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn ping() -> &'static str {
  "pong"
}

fn main() {
    // spawn backend if available
    let binpath = concat!(env!("CARGO_MANIFEST_DIR"), "/bin/backend");
    let jarpath = concat!(env!("CARGO_MANIFEST_DIR"), "/bin/backend.jar");
    let jrepath = concat!(env!("CARGO_MANIFEST_DIR"), "/bin/jre/bin/java");
    if std::path::Path::new(binpath).exists() {
        println!("Found backend binary: {}", binpath);
        let _ = std::process::Command::new(binpath)
            .arg("--port")
            .arg("7000")
            .spawn();
    } else if std::path::Path::new(jarpath).exists() {
        println!("Found backend jar: {}", jarpath);
        if std::path::Path::new(jrepath).exists() {
            println!("Using bundled JRE: {}", jrepath);
            let _ = std::process::Command::new(jrepath)
                .arg("-jar")
                .arg(jarpath)
                .arg("--port")
                .arg("7000")
                .spawn();
        } else {
            println!("Using system java");
            let _ = std::process::Command::new("java")
                .arg("-jar")
                .arg(jarpath)
                .arg("--port")
                .arg("7000")
                .spawn();
        }
    } else {
        println!("No backend binary found at {}. Skipping spawn.", binpath);
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("Failed to start Tauri");
}
