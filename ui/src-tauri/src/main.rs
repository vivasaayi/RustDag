#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

#[tauri::command]
fn ping() -> &'static str {
  "pong"
}

fn spawn_workflow_engine() {
    let addr: SocketAddr = "127.0.0.1:9091".parse().expect("valid socket addr");
    if TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok() {
        println!("Workflow engine already running at {}", addr);
        return;
    }

    let candidates = [
        concat!(env!("CARGO_MANIFEST_DIR"), "/bin/llm-dag"),
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/debug/llm-dag"),
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/release/llm-dag"),
    ];

    for bin in candidates {
        if Path::new(bin).exists() {
            println!("Starting workflow engine: {}", bin);
            let _ = Command::new(bin).spawn();
            return;
        }
    }

    println!("No workflow engine binary found; expected one of:");
    for bin in candidates {
        println!("  - {}", bin);
    }

    #[cfg(debug_assertions)]
    {
        let workspace_root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
        println!("Trying dev fallback: cargo run -p llm-dag (cwd: {})", workspace_root);
        let _ = Command::new("cargo")
            .arg("run")
            .arg("-p")
            .arg("llm-dag")
            .current_dir(workspace_root)
            .spawn();
    }
}

fn main() {
    // spawn backend if available
    let binpath = concat!(env!("CARGO_MANIFEST_DIR"), "/bin/backend");
    let jarpath = concat!(env!("CARGO_MANIFEST_DIR"), "/bin/backend.jar");
    let jrepath = concat!(env!("CARGO_MANIFEST_DIR"), "/bin/jre/bin/java");
    if Path::new(binpath).exists() {
        println!("Found backend binary: {}", binpath);
        let _ = Command::new(binpath)
            .arg("--port")
            .arg("7000")
            .spawn();
    } else if Path::new(jarpath).exists() {
        println!("Found backend jar: {}", jarpath);
        if Path::new(jrepath).exists() {
            println!("Using bundled JRE: {}", jrepath);
            let _ = Command::new(jrepath)
                .arg("-jar")
                .arg(jarpath)
                .arg("--port")
                .arg("7000")
                .spawn();
        } else {
            println!("Using system java");
            let _ = Command::new("java")
                .arg("-jar")
                .arg(jarpath)
                .arg("--port")
                .arg("7000")
                .spawn();
        }
    } else {
        println!("No backend binary found at {}. Skipping spawn.", binpath);
    }

    spawn_workflow_engine();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("Failed to start Tauri");
}
