fn main() {
    // Load .env file if it exists (for compile-time configuration)
    if let Err(e) = dotenvy::dotenv() {
        println!("cargo:warning=No .env file found ({}), using defaults", e);
    }

    // Read environment variables and set them as compile-time constants
    // These will be baked into the binary at compile time

    let rumahl_home_url =
        std::env::var("rumahl_HOME_URL").unwrap_or_else(|_| "http://localhost:3001".to_string());
    println!("cargo:rustc-env=rumahl_HOME_URL_DEFAULT={}", rumahl_home_url);

    let lm_studio_url =
        std::env::var("LM_STUDIO_URL").unwrap_or_else(|_| "http://localhost:1234".to_string());
    println!("cargo:rustc-env=LM_STUDIO_URL_DEFAULT={}", lm_studio_url);

    let rumahl_backend_url =
        std::env::var("rumahl_BACKEND_URL").unwrap_or_else(|_| "http://localhost:8092".to_string());
    println!(
        "cargo:rustc-env=rumahl_BACKEND_URL_DEFAULT={}",
        rumahl_backend_url
    );

    let proxy_port = std::env::var("PROXY_PORT").unwrap_or_else(|_| "11435".to_string());
    println!("cargo:rustc-env=PROXY_PORT_DEFAULT={}", proxy_port);

    let health_poll_interval =
        std::env::var("HEALTH_POLL_INTERVAL_SECS").unwrap_or_else(|_| "30".to_string());
    println!(
        "cargo:rustc-env=HEALTH_POLL_INTERVAL_DEFAULT={}",
        health_poll_interval
    );

    let ha_update_interval =
        std::env::var("HA_UPDATE_INTERVAL_SECS").unwrap_or_else(|_| "60".to_string());
    println!(
        "cargo:rustc-env=HA_UPDATE_INTERVAL_DEFAULT={}",
        ha_update_interval
    );

    tauri_build::build()
}
