use axum::{
    extract::{Path, State, WebSocketUpgrade},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{info, warn};

mod ha_client;
mod websocket;
mod db;
mod auth;

use ha_client::HomeAssistantClient;
use db::{init_db, DbPool, repositories::ConfigRepository};

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub ha_client: Arc<HomeAssistantClient>,
    pub ws_manager: Arc<websocket::WebSocketManager>,
    pub db_pool: DbPool,
    pub config_repo: Arc<ConfigRepository>,
}

/// Entity state from Home Assistant
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityState {
    pub entity_id: String,
    pub state: String,
    pub attributes: serde_json::Value,
    pub last_changed: String,
    pub last_updated: String,
}

/// Service call request
#[derive(Debug, Deserialize)]
pub struct ServiceCallRequest {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// Error response
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(self)).into_response()
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    // Load environment variables
    dotenv::dotenv().ok();

    // Get Home Assistant configuration
    let ha_url = std::env::var("HA_URL")
        .unwrap_or_else(|_| "http://homeassistant.local:8123".to_string());
    let ha_token = std::env::var("HA_TOKEN")
        .expect("HA_TOKEN environment variable must be set");

    // Get database configuration
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite:./data/ha-dashboard.db".to_string());

    info!("Starting Home Assistant Dashboard Backend");
    info!("Home Assistant URL: {}", ha_url);
    info!("Database URL: {}", database_url);

    // Initialize database
    let db_pool = init_db(&database_url).await?;

    // Initialize Home Assistant client
    let ha_client = Arc::new(HomeAssistantClient::new(ha_url, ha_token));

    // Initialize WebSocket manager
    let ws_manager = Arc::new(websocket::WebSocketManager::new());

    // Initialize configuration repository
    let config_repo = Arc::new(ConfigRepository::new(db_pool.clone()));

    // Create application state
    let state = AppState {
        ha_client: ha_client.clone(),
        ws_manager: ws_manager.clone(),
        db_pool,
        config_repo,
    };

    // Start background task to poll Home Assistant
    tokio::spawn(poll_home_assistant(
        ha_client.clone(),
        ws_manager.clone(),
    ));

    // Build router
    let app = Router::new()
        // Health check
        .route("/health", get(health_check))
        // Authentication API
        .route("/api/auth/register", post(auth_register))
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/verify", get(auth_verify))
        // Home Assistant API proxy
        .route("/api/states", get(get_states))
        .route("/api/states/:entity_id", get(get_state))
        .route(
            "/api/services/:domain/:service",
            post(call_service),
        )
        // Configuration API
        .route("/api/config/users", post(create_user))
        .route("/api/config/users/:username", get(get_user))
        .route("/api/config/devices", post(register_device))
        .route("/api/config/devices/:device_id", get(get_device_info))
        .route("/api/config/devices/:device_id/heartbeat", post(device_heartbeat))
        .route("/api/config/profiles", post(create_profile))
        .route("/api/config/profiles/:profile_id", get(get_profile_data))
        .route("/api/config/profiles/:profile_id/pages", post(save_pages))
        .route("/api/config/profiles/:profile_id/theme", post(save_theme_settings))
        .route("/api/config/profiles/:profile_id/background", post(save_background_config))
        .route("/api/config/preferences/:user_id", post(save_user_preference))
        .route("/api/config/preferences/:user_id", get(get_user_preferences))
        .route("/api/config/sync/changes", get(get_sync_changes))
        // WebSocket endpoint
        .route("/ws", get(websocket_handler))
        // CORS layer
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        // Tracing layer
        .layer(TraceLayer::new_for_http())
        // Add state
        .with_state(state);

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3001));
    info!("Backend server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Health check endpoint
async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

/// Get all entity states
async fn get_states(
    State(state): State<AppState>,
) -> Result<Json<Vec<EntityState>>, ErrorResponse> {
    match state.ha_client.get_states().await {
        Ok(states) => Ok(Json(states)),
        Err(e) => {
            warn!("Failed to get states: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to get states: {}", e),
            })
        }
    }
}

/// Get single entity state
async fn get_state(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
) -> Result<Json<EntityState>, ErrorResponse> {
    match state.ha_client.get_state(&entity_id).await {
        Ok(Some(entity)) => Ok(Json(entity)),
        Ok(None) => Err(ErrorResponse {
            error: format!("Entity {} not found", entity_id),
        }),
        Err(e) => {
            warn!("Failed to get state for {}: {}", entity_id, e);
            Err(ErrorResponse {
                error: format!("Failed to get state: {}", e),
            })
        }
    }
}

/// Call Home Assistant service
async fn call_service(
    State(state): State<AppState>,
    Path((domain, service)): Path<(String, String)>,
    Json(request): Json<ServiceCallRequest>,
) -> Result<StatusCode, ErrorResponse> {
    match state
        .ha_client
        .call_service(&domain, &service, request.data)
        .await
    {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            warn!("Failed to call service {}.{}: {}", domain, service, e);
            Err(ErrorResponse {
                error: format!("Failed to call service: {}", e),
            })
        }
    }
}

/// WebSocket handler
async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| websocket::handle_socket(socket, state.ws_manager))
}

// Configuration API handlers

/// Create a new user
async fn create_user(
    State(state): State<AppState>,
    Json(request): Json<db::models::CreateUserRequest>,
) -> Result<Json<db::models::User>, ErrorResponse> {
    match state.config_repo.create_user(request).await {
        Ok(user) => Ok(Json(user)),
        Err(e) => {
            warn!("Failed to create user: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to create user: {}", e),
            })
        }
    }
}

/// Get user by username
async fn get_user(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Json<db::models::User>, ErrorResponse> {
    match state.config_repo.get_user_by_username(&username).await {
        Ok(Some(user)) => Ok(Json(user)),
        Ok(None) => Err(ErrorResponse {
            error: format!("User {} not found", username),
        }),
        Err(e) => {
            warn!("Failed to get user: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to get user: {}", e),
            })
        }
    }
}

/// Register a new device
async fn register_device(
    State(state): State<AppState>,
    Json(request): Json<db::models::RegisterDeviceRequest>,
) -> Result<Json<db::models::Device>, ErrorResponse> {
    match state.config_repo.register_device(request).await {
        Ok(device) => Ok(Json(device)),
        Err(e) => {
            warn!("Failed to register device: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to register device: {}", e),
            })
        }
    }
}

/// Get device information
async fn get_device_info(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
) -> Result<Json<db::models::Device>, ErrorResponse> {
    match state.config_repo.get_device(&device_id).await {
        Ok(Some(device)) => Ok(Json(device)),
        Ok(None) => Err(ErrorResponse {
            error: format!("Device {} not found", device_id),
        }),
        Err(e) => {
            warn!("Failed to get device: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to get device: {}", e),
            })
        }
    }
}

/// Device heartbeat to update last_seen
async fn device_heartbeat(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
) -> Result<StatusCode, ErrorResponse> {
    match state.config_repo.update_device_last_seen(&device_id).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            warn!("Failed to update device heartbeat: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to update device heartbeat: {}", e),
            })
        }
    }
}

/// Create a configuration profile
async fn create_profile(
    State(state): State<AppState>,
    Json(request): Json<db::models::CreateProfileRequest>,
) -> Result<Json<db::models::ConfigurationProfile>, ErrorResponse> {
    match state.config_repo.create_profile(request).await {
        Ok(profile) => Ok(Json(profile)),
        Err(e) => {
            warn!("Failed to create profile: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to create profile: {}", e),
            })
        }
    }
}

/// Get profile with all data
async fn get_profile_data(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
) -> Result<Json<db::models::ProfileWithData>, ErrorResponse> {
    match state.config_repo.get_profile_with_data(&profile_id).await {
        Ok(Some(data)) => Ok(Json(data)),
        Ok(None) => Err(ErrorResponse {
            error: format!("Profile {} not found", profile_id),
        }),
        Err(e) => {
            warn!("Failed to get profile data: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to get profile data: {}", e),
            })
        }
    }
}

/// Save pages configuration
async fn save_pages(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(pages): Json<Vec<db::models::SavePageRequest>>,
) -> Result<StatusCode, ErrorResponse> {
    match state.config_repo.save_pages(&profile_id, pages).await {
        Ok(_) => {
            // Record sync metadata
            let _ = state.config_repo.record_change("pages", &profile_id, "UPDATE", None).await;
            Ok(StatusCode::OK)
        }
        Err(e) => {
            warn!("Failed to save pages: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to save pages: {}", e),
            })
        }
    }
}

/// Save theme settings
async fn save_theme_settings(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(request): Json<db::models::SaveThemeRequest>,
) -> Result<Json<db::models::ThemeSettings>, ErrorResponse> {
    match state.config_repo.save_theme(&profile_id, request).await {
        Ok(theme) => {
            // Record sync metadata
            let _ = state.config_repo.record_change("theme_settings", &profile_id, "UPDATE", None).await;
            Ok(Json(theme))
        }
        Err(e) => {
            warn!("Failed to save theme: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to save theme: {}", e),
            })
        }
    }
}

/// Save background configuration
async fn save_background_config(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(request): Json<db::models::SaveBackgroundRequest>,
) -> Result<Json<db::models::BackgroundConfig>, ErrorResponse> {
    match state.config_repo.save_background(&profile_id, request).await {
        Ok(background) => {
            // Record sync metadata
            let _ = state.config_repo.record_change("background_configs", &profile_id, "UPDATE", None).await;
            Ok(Json(background))
        }
        Err(e) => {
            warn!("Failed to save background: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to save background: {}", e),
            })
        }
    }
}

/// Save user preference
async fn save_user_preference(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(request): Json<db::models::SavePreferenceRequest>,
) -> Result<Json<db::models::UserPreference>, ErrorResponse> {
    match state.config_repo.save_preference(&user_id, None, request).await {
        Ok(pref) => {
            // Record sync metadata
            let _ = state.config_repo.record_change("user_preferences", &user_id, "UPDATE", None).await;
            Ok(Json(pref))
        }
        Err(e) => {
            warn!("Failed to save preference: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to save preference: {}", e),
            })
        }
    }
}

/// Get all user preferences
async fn get_user_preferences(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<Vec<db::models::UserPreference>>, ErrorResponse> {
    match state.config_repo.get_all_preferences(&user_id, None).await {
        Ok(prefs) => Ok(Json(prefs)),
        Err(e) => {
            warn!("Failed to get preferences: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to get preferences: {}", e),
            })
        }
    }
}

#[derive(Debug, Deserialize)]
struct SyncQuery {
    since: Option<String>,
}

/// Get sync changes since a timestamp
async fn get_sync_changes(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<SyncQuery>,
) -> Result<Json<Vec<db::models::SyncMetadata>>, ErrorResponse> {
    let since = query.since.unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

    match state.config_repo.get_changes_since(&since).await {
        Ok(changes) => Ok(Json(changes)),
        Err(e) => {
            warn!("Failed to get sync changes: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to get sync changes: {}", e),
            })
        }
    }
}

// Authentication API handlers

/// Register a new user
async fn auth_register(
    State(state): State<AppState>,
    Json(request): Json<db::models::RegisterRequest>,
) -> Result<Json<db::models::AuthResponse>, ErrorResponse> {
    // Validate password length
    if request.password.len() < 8 {
        return Err(ErrorResponse {
            error: "Password must be at least 8 characters".to_string(),
        });
    }

    // Check if username already exists
    match state.config_repo.get_user_by_username(&request.username).await {
        Ok(Some(_)) => {
            return Err(ErrorResponse {
                error: "Username already exists".to_string(),
            });
        }
        Ok(None) => {}
        Err(e) => {
            warn!("Failed to check existing user: {}", e);
            return Err(ErrorResponse {
                error: "Failed to register user".to_string(),
            });
        }
    }

    // Hash the password
    let password_hash = match auth::hash_password(&request.password) {
        Ok(hash) => hash,
        Err(e) => {
            warn!("Failed to hash password: {}", e);
            return Err(ErrorResponse {
                error: "Failed to register user".to_string(),
            });
        }
    };

    // Create user with password
    let user_id = uuid::Uuid::new_v4().to_string();
    let query_result = sqlx::query(
        "INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)"
    )
    .bind(&user_id)
    .bind(&request.username)
    .bind(&request.display_name)
    .bind(&password_hash)
    .execute(&state.db_pool)
    .await;

    if let Err(e) = query_result {
        warn!("Failed to create user: {}", e);
        return Err(ErrorResponse {
            error: "Failed to register user".to_string(),
        });
    }

    // Fetch the created user
    let user = match state.config_repo.get_user_by_username(&request.username).await {
        Ok(Some(user)) => user,
        _ => {
            return Err(ErrorResponse {
                error: "Failed to register user".to_string(),
            });
        }
    };

    // Generate JWT token
    let token = match auth::generate_token(&user.id, &user.username) {
        Ok(token) => token,
        Err(e) => {
            warn!("Failed to generate token: {}", e);
            return Err(ErrorResponse {
                error: "Failed to generate authentication token".to_string(),
            });
        }
    };

    Ok(Json(db::models::AuthResponse { token, user }))
}

/// Login an existing user
async fn auth_login(
    State(state): State<AppState>,
    Json(request): Json<db::models::LoginRequest>,
) -> Result<Json<db::models::AuthResponse>, ErrorResponse> {
    // Get user by username
    let user = match state.config_repo.get_user_by_username(&request.username).await {
        Ok(Some(user)) => user,
        Ok(None) => {
            return Err(ErrorResponse {
                error: "Invalid username or password".to_string(),
            });
        }
        Err(e) => {
            warn!("Failed to get user: {}", e);
            return Err(ErrorResponse {
                error: "Login failed".to_string(),
            });
        }
    };

    // Check if user has a password set
    let password_hash = match &user.password_hash {
        Some(hash) => hash,
        None => {
            return Err(ErrorResponse {
                error: "User has no password set. Please register.".to_string(),
            });
        }
    };

    // Verify password
    let is_valid = match auth::verify_password(&request.password, password_hash) {
        Ok(valid) => valid,
        Err(e) => {
            warn!("Failed to verify password: {}", e);
            return Err(ErrorResponse {
                error: "Login failed".to_string(),
            });
        }
    };

    if !is_valid {
        return Err(ErrorResponse {
            error: "Invalid username or password".to_string(),
        });
    }

    // Generate JWT token
    let token = match auth::generate_token(&user.id, &user.username) {
        Ok(token) => token,
        Err(e) => {
            warn!("Failed to generate token: {}", e);
            return Err(ErrorResponse {
                error: "Failed to generate authentication token".to_string(),
            });
        }
    };

    Ok(Json(db::models::AuthResponse { token, user }))
}

/// Verify a JWT token
async fn auth_verify(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<db::models::User>, ErrorResponse> {
    // Extract token from Authorization header
    let token = match headers.get(header::AUTHORIZATION) {
        Some(value) => match value.to_str() {
            Ok(header_value) => {
                if let Some(token) = header_value.strip_prefix("Bearer ") {
                    token
                } else {
                    return Err(ErrorResponse {
                        error: "Invalid authorization header format".to_string(),
                    });
                }
            }
            Err(_) => {
                return Err(ErrorResponse {
                    error: "Invalid authorization header".to_string(),
                });
            }
        },
        None => {
            return Err(ErrorResponse {
                error: "No authorization header provided".to_string(),
            });
        }
    };

    // Verify token
    let claims = match auth::verify_token(token) {
        Ok(claims) => claims,
        Err(e) => {
            warn!("Token verification failed: {}", e);
            return Err(ErrorResponse {
                error: "Invalid or expired token".to_string(),
            });
        }
    };

    // Get user from database
    let user = match state.config_repo.get_user_by_username(&claims.username).await {
        Ok(Some(user)) => user,
        Ok(None) => {
            return Err(ErrorResponse {
                error: "User not found".to_string(),
            });
        }
        Err(e) => {
            warn!("Failed to get user: {}", e);
            return Err(ErrorResponse {
                error: "Failed to verify token".to_string(),
            });
        }
    };

    Ok(Json(user))
}

/// Background task to poll Home Assistant and broadcast updates
async fn poll_home_assistant(
    ha_client: Arc<HomeAssistantClient>,
    ws_manager: Arc<websocket::WebSocketManager>,
) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));

    loop {
        interval.tick().await;

        match ha_client.get_states().await {
            Ok(states) => {
                ws_manager.broadcast_states(states).await;
            }
            Err(e) => {
                warn!("Failed to poll Home Assistant: {}", e);
            }
        }
    }
}
