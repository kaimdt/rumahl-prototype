//! WebDAV interface for IORA Files.
//!
//! Provides standard WebDAV protocol access to the IORA file storage,
//! compatible with Windows Explorer, macOS Finder, and mobile file managers.
//!
//! Supported WebDAV methods:
//! - PROPFIND (directory listing)
//! - GET (download file)
//! - PUT (upload file)
//! - DELETE (remove file)
//! - MKCOL (create directory)
//! - MOVE (rename/move)
//! - COPY (duplicate)
//! - OPTIONS (capabilities)

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;

pub async fn webdav_handler_root(
    state: State<Arc<crate::AppState>>,
    method: Method,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    handle_webdav(&state, &method, "/", &headers, body).await
}

pub async fn webdav_handler(
    state: State<Arc<crate::AppState>>,
    Path(path): Path<String>,
    method: Method,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    handle_webdav(&state, &method, &path, &headers, body).await
}

async fn handle_webdav(
    state: &crate::AppState,
    method: &Method,
    path: &str,
    headers: &HeaderMap,
    body: Body,
) -> Response {
    let token = match extract_token(headers) {
        Some(t) => t,
        None => {
            return Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .header("WWW-Authenticate", "Basic realm=\"IORA WebDAV\"")
                .body(Body::from("Authentication required"))
                .unwrap();
        }
    };

    match method.as_str() {
        "OPTIONS" => webdav_options().await,
        "PROPFIND" => webdav_propfind(state, path, &token, headers).await,
        "GET" => webdav_get(state, path, &token).await,
        "PUT" => webdav_put(state, path, &token, body).await,
        "DELETE" => webdav_delete(state, path, &token).await,
        "MKCOL" => webdav_mkcol(state, path, &token).await,
        "MOVE" => webdav_move(state, path, &token, headers).await,
        "COPY" => webdav_copy(state, path, &token, headers).await,
        _ => Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .body(Body::from("Method not allowed"))
            .unwrap(),
    }
}

async fn webdav_options() -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header("Allow", "OPTIONS, GET, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY")
        .header("DAV", "1, 2")
        .header("MS-Author-Via", "DAV")
        .body(Body::empty())
        .unwrap()
}

async fn webdav_propfind(
    state: &crate::AppState,
    path: &str,
    token: &str,
    headers: &HeaderMap,
) -> Response {
    let depth = headers
        .get("Depth")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("1");

    // Fetch file listing from iora-files
    let url = format!("{}/api/files?folder_path={}", state.iora_files_url, path);
    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    let files: serde_json::Value = match resp {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or(serde_json::json!({"files": []})),
        _ => serde_json::json!({"files": []}),
    };

    let file_list = files["files"].as_array().cloned().unwrap_or_default();

    // Build WebDAV XML response
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"utf-8\" ?>\n");
    xml.push_str("<D:multistatus xmlns:D=\"DAV:\">\n");

    // Current directory entry
    xml.push_str(&format!(
        "  <D:response>\n    <D:href>/webdav/{}</D:href>\n    <D:propstat>\n      <D:prop>\n        <D:resourcetype><D:collection/></D:resourcetype>\n        <D:displayname>{}</D:displayname>\n      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n  </D:response>\n",
        path,
        path.split('/').next_back().unwrap_or("IORA Files"),
    ));

    // Child entries
    if depth != "0" {
        for file in &file_list {
            let name = file["original_name"].as_str().unwrap_or("unnamed");
            let is_folder = file["is_folder"].as_bool().unwrap_or(false);
            let size = file["size_bytes"].as_i64().unwrap_or(0);
            let mime = file["mime_type"].as_str().unwrap_or("application/octet-stream");
            let modified = file["updated_at"].as_str().unwrap_or("");
            let _file_id = file["id"].as_str().unwrap_or("");

            let href = if path.is_empty() || path == "/" {
                format!("/webdav/{}", name)
            } else {
                format!("/webdav/{}/{}", path.trim_end_matches('/'), name)
            };

            xml.push_str("  <D:response>\n");
            xml.push_str(&format!("    <D:href>{}</D:href>\n", href));
            xml.push_str("    <D:propstat>\n      <D:prop>\n");

            if is_folder {
                xml.push_str("        <D:resourcetype><D:collection/></D:resourcetype>\n");
            } else {
                xml.push_str("        <D:resourcetype/>\n");
                xml.push_str(&format!("        <D:getcontentlength>{}</D:getcontentlength>\n", size));
                xml.push_str(&format!("        <D:getcontenttype>{}</D:getcontenttype>\n", mime));
            }

            xml.push_str(&format!("        <D:displayname>{}</D:displayname>\n", name));
            if !modified.is_empty() {
                xml.push_str(&format!("        <D:getlastmodified>{}</D:getlastmodified>\n", modified));
            }

            xml.push_str("      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n  </D:response>\n");
        }
    }

    xml.push_str("</D:multistatus>\n");

    Response::builder()
        .status(StatusCode::MULTI_STATUS)
        .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .body(Body::from(xml))
        .unwrap()
}

async fn webdav_get(state: &crate::AppState, path: &str, token: &str) -> Response {
    // Extract file ID from path (for now, use the filename to search)
    let filename = path.split('/').next_back().unwrap_or("");

    let url = format!("{}/api/files?search={}", state.iora_files_url, filename);
    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    let files: serde_json::Value = match resp {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or(serde_json::json!({"files": []})),
        _ => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("File not found"))
                .unwrap();
        }
    };

    let file_list = files["files"].as_array().cloned().unwrap_or_default();
    let file = match file_list.first() {
        Some(f) => f,
        None => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("File not found"))
                .unwrap();
        }
    };

    let file_id = file["id"].as_str().unwrap_or("");
    let download_url = format!("{}/api/files/{}/download", state.iora_files_url, file_id);

    let download_resp = state
        .http_client
        .get(&download_url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match download_resp {
        Ok(r) if r.status().is_success() => {
            let content_type = r
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            let bytes = r.bytes().await.unwrap_or_default();

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .body(Body::from(bytes.to_vec()))
                .unwrap()
        }
        _ => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("File not found"))
            .unwrap(),
    }
}

async fn webdav_put(state: &crate::AppState, path: &str, token: &str, body: Body) -> Response {
    let filename = path.split('/').next_back().unwrap_or("unnamed");

    let body_bytes = match axum::body::to_bytes(body, 512 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from(format!("Body read error: {}", e)))
                .unwrap();
        }
    };

    // Upload via multipart to iora-files
    let part = reqwest::multipart::Part::bytes(body_bytes.to_vec())
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")
        .unwrap_or_else(|_| reqwest::multipart::Part::bytes(body_bytes.to_vec()));

    let form = reqwest::multipart::Form::new().part("file", part);

    let resp = state
        .http_client
        .post(format!("{}/api/files/upload", state.iora_files_url))
        .header("Authorization", format!("Bearer {}", token))
        .multipart(form)
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => Response::builder()
            .status(StatusCode::CREATED)
            .body(Body::empty())
            .unwrap(),
        Ok(r) => Response::builder()
            .status(StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR))
            .body(Body::from("Upload failed"))
            .unwrap(),
        Err(e) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from(format!("Upload error: {}", e)))
            .unwrap(),
    }
}

async fn webdav_delete(state: &crate::AppState, path: &str, token: &str) -> Response {
    let filename = path.split('/').next_back().unwrap_or("");

    let url = format!("{}/api/files?search={}", state.iora_files_url, filename);
    let resp = state.http_client.get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send().await;

    let files: serde_json::Value = match resp {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => return Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("Not found")).unwrap(),
    };

    if let Some(file) = files["files"].as_array().and_then(|a| a.first()) {
        let file_id = file["id"].as_str().unwrap_or("");
        let _ = state.http_client
            .delete(format!("{}/api/files/{}", state.iora_files_url, file_id))
            .header("Authorization", format!("Bearer {}", token))
            .send().await;
    }

    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .unwrap()
}

async fn webdav_mkcol(state: &crate::AppState, path: &str, token: &str) -> Response {
    let folder_name = path.split('/').next_back().unwrap_or("New Folder");

    let body = serde_json::json!({ "name": folder_name });

    let resp = state.http_client
        .post(format!("{}/api/files/folders", state.iora_files_url))
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send().await;

    match resp {
        Ok(r) if r.status().is_success() => Response::builder()
            .status(StatusCode::CREATED)
            .body(Body::empty())
            .unwrap(),
        _ => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("Failed to create folder"))
            .unwrap(),
    }
}

async fn webdav_move(state: &crate::AppState, path: &str, token: &str, headers: &HeaderMap) -> Response {
    let destination = headers.get("Destination").and_then(|v| v.to_str().ok());
    let Some(destination) = destination else {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Missing Destination header"))
            .unwrap();
    };

    let filename = path.split('/').next_back().unwrap_or("");
    // Strip protocol/host from Destination URL if present
    let dest_path = destination
        .splitn(4, '/')
        .nth(3)
        .map(|s| format!("/{}", s))
        .unwrap_or_else(|| destination.to_string());
    let new_name = dest_path.split('/').next_back().unwrap_or(filename);

    if filename == new_name {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .unwrap();
    }

    // Look up file by name
    let url = format!("{}/api/files?search={}", state.iora_files_url, filename);
    let resp = state.http_client.get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send().await;

    let files: serde_json::Value = match resp {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Source file not found"))
            .unwrap(),
    };

    let Some(file_id) = files["files"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|f| f["id"].as_str())
    else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Source file not found"))
            .unwrap();
    };

    let body = serde_json::json!({ "new_name": new_name });
    let rename_url = format!("{}/api/files/{}/rename", state.iora_files_url, file_id);
    let resp = state.http_client
        .put(&rename_url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => Response::builder()
            .status(StatusCode::CREATED)
            .body(Body::empty())
            .unwrap(),
        Ok(r) => Response::builder()
            .status(StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR))
            .body(Body::from("Move failed"))
            .unwrap(),
        Err(e) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from(format!("Move error: {}", e)))
            .unwrap(),
    }
}

async fn webdav_copy(state: &crate::AppState, path: &str, token: &str, headers: &HeaderMap) -> Response {
    let destination = match headers.get("Destination").and_then(|v| v.to_str().ok()) {
        Some(d) => d,
        None => return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Missing Destination header"))
            .unwrap(),
    };

    let filename = path.split('/').next_back().unwrap_or("");
    let dest_path = destination
        .splitn(4, '/')
        .nth(3)
        .map(|s| format!("/{}", s))
        .unwrap_or_else(|| destination.to_string());
    let new_name = dest_path.split('/').next_back().unwrap_or(filename);

    // Find source file
    let url = format!("{}/api/files?search={}", state.iora_files_url, filename);
    let resp = state.http_client.get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send().await;
    let files: serde_json::Value = match resp {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => return Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("Source file not found")).unwrap(),
    };
    let Some(file_id) = files["files"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|f| f["id"].as_str())
    else {
        return Response::builder().status(StatusCode::NOT_FOUND).body(Body::from("Source file not found")).unwrap();
    };

    // Download original
    let download_url = format!("{}/api/files/{}/download", state.iora_files_url, file_id);
    let dl = state.http_client.get(&download_url)
        .header("Authorization", format!("Bearer {}", token))
        .send().await;
    let bytes = match dl {
        Ok(r) if r.status().is_success() => match r.bytes().await {
            Ok(b) => b,
            Err(e) => return Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Body::from(format!("Download error: {}", e))).unwrap(),
        },
        _ => return Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Body::from("Failed to download source")).unwrap(),
    };

    // Re-upload under new name
    let part = reqwest::multipart::Part::bytes(bytes.to_vec()).file_name(new_name.to_string());
    let form = reqwest::multipart::Form::new().part("file", part);
    let upload_url = format!("{}/api/files/upload", state.iora_files_url);
    let resp = state.http_client
        .post(&upload_url)
        .header("Authorization", format!("Bearer {}", token))
        .multipart(form)
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => Response::builder()
            .status(StatusCode::CREATED)
            .body(Body::empty())
            .unwrap(),
        Ok(r) => Response::builder()
            .status(StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR))
            .body(Body::from("Copy failed"))
            .unwrap(),
        Err(e) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from(format!("Copy error: {}", e)))
            .unwrap(),
    }
}

fn extract_token(headers: &HeaderMap) -> Option<String> {
    // Support both Bearer token and Basic auth
    if let Some(auth) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            return Some(token.to_string());
        }
        // Basic auth: decode and try to use password as token
        if let Some(encoded) = auth.strip_prefix("Basic ") {
            if let Ok(decoded) = base64_decode(encoded) {
                if let Some((_user, pass)) = decoded.split_once(':') {
                    return Some(pass.to_string());
                }
            }
        }
    }
    None
}

fn base64_decode(input: &str) -> Result<String, ()> {
    // Simple base64 decode using standard library approach
    use std::str;
    let bytes = base64_decode_bytes(input).map_err(|_| ())?;
    str::from_utf8(&bytes).map(|s| s.to_string()).map_err(|_| ())
}

fn base64_decode_bytes(input: &str) -> Result<Vec<u8>, ()> {
    // Minimal base64 decoder
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u32;

    for &byte in input.as_bytes() {
        if byte == b'=' {
            break;
        }
        let val = table.iter().position(|&b| b == byte).ok_or(())? as u32;
        buffer = (buffer << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }

    Ok(output)
}
