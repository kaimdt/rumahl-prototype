use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use chrono::Utc;

#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "iora-backup",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

#[get("/api/backup/config")]
async fn get_config() -> impl Responder {
    not_implemented("get_config")
}

#[post("/api/backup/config")]
async fn update_config(_req: web::Json<serde_json::Value>) -> impl Responder {
    not_implemented("update_config")
}

#[post("/api/backup/create")]
async fn create_backup(_req: web::Json<serde_json::Value>) -> impl Responder {
    not_implemented("create_backup")
}

#[get("/api/backup/list")]
async fn list_backups() -> impl Responder {
    not_implemented("list_backups")
}

#[post("/api/backup/restore")]
async fn restore_backup(_req: web::Json<serde_json::Value>) -> impl Responder {
    not_implemented("restore_backup")
}

#[post("/api/backup/pre-update")]
async fn pre_update_backup() -> impl Responder {
    not_implemented("pre_update_backup")
}

fn not_implemented(action: &str) -> HttpResponse {
    HttpResponse::NotImplemented().json(serde_json::json!({
        "error": "not_implemented",
        "message": format!("The backup action '{}' is not yet implemented in this version.", action)
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .service(health)
            .service(get_config)
            .service(update_config)
            .service(create_backup)
            .service(list_backups)
            .service(restore_backup)
            .service(pre_update_backup)
    })
    .bind(("0.0.0.0", 8084))?
    .run()
    .await
}
