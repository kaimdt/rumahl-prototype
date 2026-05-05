use axum::{
    extract::Path,
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::{Path as FsPath, PathBuf};
use tokio::fs;
use tracing::{error, warn};

#[derive(Debug, Serialize, Deserialize)]
pub struct DocsConfig {
    title: String,
    description: String,
    navigation: Vec<DocsSection>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocsSection {
    section: String,
    icon: String,
    items: Vec<DocsItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocsItem {
    title: String,
    path: String,
    #[serde(default)]
    highlight: bool,
}

#[derive(Debug, Serialize)]
pub struct DocContent {
    path: String,
    content: String,
    title: String,
}

/// Get the documentation configuration
///
/// Resolution order:
///   1. Read `docs/docs-config.json` from the working directory if it
///      exists (operator-supplied / mounted bundle).
///   2. Fall back to a small embedded baseline so the Documentation page
///      always renders something instead of hanging on the loading
///      spinner forever on shipped images that don't bundle the docs.
pub async fn get_docs_config() -> Json<DocsConfig> {
    // Check multiple locations for docs-config.json
    let search_paths = vec![
        PathBuf::from("/opt/iora/docs/docs-config.json"),  // IORA OS production
        PathBuf::from("docs/docs-config.json"),              // Development / fallback
    ];

    for docs_path in &search_paths {
        if let Ok(content) = fs::read_to_string(docs_path).await {
            if let Ok(config) = serde_json::from_str::<DocsConfig>(&content) {
                return Json(config);
            }
        }
    }

    Json(embedded_fallback_config())
}

fn embedded_fallback_config() -> DocsConfig {
    DocsConfig {
        title: "IORA OS Dokumentation".to_string(),
        description: "Eingebettete Basisdokumentation für IORA OS".to_string(),
        navigation: vec![
            DocsSection {
                section: "Erste Schritte".to_string(),
                icon: "Rocket".to_string(),
                items: vec![
                    DocsItem {
                        title: "Willkommen".to_string(),
                        path: "embedded/welcome.md".to_string(),
                        highlight: true,
                    },
                    DocsItem {
                        title: "Dashboard im Überblick".to_string(),
                        path: "embedded/dashboard.md".to_string(),
                        highlight: false,
                    },
                ],
            },
            DocsSection {
                section: "Administration".to_string(),
                icon: "ShieldCheck".to_string(),
                items: vec![
                    DocsItem {
                        title: "Admin Panel".to_string(),
                        path: "embedded/admin.md".to_string(),
                        highlight: false,
                    },
                    DocsItem {
                        title: "Globale Konfiguration".to_string(),
                        path: "embedded/global-config.md".to_string(),
                        highlight: false,
                    },
                    DocsItem {
                        title: "Dienste & Infrastruktur".to_string(),
                        path: "embedded/services.md".to_string(),
                        highlight: false,
                    },
                ],
            },
            DocsSection {
                section: "Entwickler".to_string(),
                icon: "Code".to_string(),
                items: vec![
                    DocsItem {
                        title: "Developer Mode".to_string(),
                        path: "embedded/developer-mode.md".to_string(),
                        highlight: false,
                    },
                    DocsItem {
                        title: "API Referenz".to_string(),
                        path: "embedded/api.md".to_string(),
                        highlight: false,
                    },
                ],
            },
        ],
    }
}

fn embedded_doc(path: &str) -> Option<(&'static str, &'static str)> {
    match path {
        "embedded/welcome.md" => Some((
            "Willkommen bei IORA OS",
            include_str!("../docs_embedded/welcome.md"),
        )),
        "embedded/dashboard.md" => Some((
            "Dashboard im Überblick",
            include_str!("../docs_embedded/dashboard.md"),
        )),
        "embedded/admin.md" => Some((
            "Admin Panel",
            include_str!("../docs_embedded/admin.md"),
        )),
        "embedded/global-config.md" => Some((
            "Globale Konfiguration",
            include_str!("../docs_embedded/global-config.md"),
        )),
        "embedded/services.md" => Some((
            "Dienste & Infrastruktur",
            include_str!("../docs_embedded/services.md"),
        )),
        "embedded/developer-mode.md" => Some((
            "Developer Mode",
            include_str!("../docs_embedded/developer-mode.md"),
        )),
        "embedded/api.md" => Some((
            "API Referenz",
            include_str!("../docs_embedded/api.md"),
        )),
        _ => None,
    }
}

/// Get a specific documentation file
pub async fn get_doc_file(
    Path(doc_path): Path<String>,
) -> Result<Json<DocContent>, (StatusCode, String)> {
    // Sanitize the path to prevent directory traversal
    let doc_path = doc_path.replace("..", "");

    // 1. Embedded fallback docs (always available, even on stripped images).
    if let Some((title, content)) = embedded_doc(&doc_path) {
        return Ok(Json(DocContent {
            path: doc_path,
            content: content.to_string(),
            title: title.to_string(),
        }));
    }

    // 2. Try filesystem docs — check both locations
    let search_bases = vec!["/opt/iora/docs", "docs"];

    for base in &search_bases {
        let full_path = PathBuf::from(base).join(&doc_path);

        // Check if file exists
        if let Ok(content) = fs::read_to_string(&full_path).await {
            let title = content
                .lines()
                .find(|line| line.starts_with("# "))
                .map(|line| line.trim_start_matches("# ").to_string())
                .unwrap_or_else(|| doc_path.clone());

            return Ok(Json(DocContent {
                path: doc_path,
                content,
                title,
            }));
        }
    }

    // Not found
    Err((StatusCode::NOT_FOUND, "Document not found".to_string()))
}

/// List all available documentation files
pub async fn list_docs() -> Result<Json<Vec<String>>, (StatusCode, String)> {
    let search_dirs = vec!["/opt/iora/docs", "docs"];

    for docs_dir_str in &search_dirs {
        let docs_dir = PathBuf::from(docs_dir_str);
        if docs_dir.exists() {
            match collect_markdown_files(&docs_dir, &docs_dir).await {
                Ok(files) if !files.is_empty() => return Ok(Json(files)),
                _ => continue,
            }
        }
    }

    // No docs directory found
    Ok(Json(vec![]))
}

/// Iteratively collect all markdown files in a directory (avoids E0733 from recursive async).
async fn collect_markdown_files(dir: &FsPath, base: &FsPath) -> std::io::Result<Vec<String>> {
    let mut files = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![dir.to_path_buf()];

    while let Some(current) = stack.pop() {
        let mut entries = fs::read_dir(&current).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();

            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|s| s.to_str()) == Some("md") {
                if let Ok(rel_path) = path.strip_prefix(base) {
                    if let Some(path_str) = rel_path.to_str() {
                        files.push(path_str.to_string());
                    }
                }
            }
        }
    }

    Ok(files)
}
