use async_trait::async_trait;
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use tracing::{error, info};

#[derive(Error, Debug)]
pub enum RemoteStorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("FTP error: {0}")]
    Ftp(String),

    #[error("WebDAV error: {0}")]
    WebDav(String),

    #[error("S3 error: {0}")]
    S3(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("Upload failed: {0}")]
    UploadFailed(String),

    #[error("Download failed: {0}")]
    DownloadFailed(String),
}

pub type Result<T> = std::result::Result<T, RemoteStorageError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RemoteStorageConfig {
    #[serde(rename = "ftp")]
    Ftp {
        host: String,
        port: u16,
        username: String,
        password: String,
        path: String,
        #[serde(default)]
        use_tls: bool,
    },
    #[serde(rename = "webdav")]
    WebDav {
        url: String,
        username: String,
        password: String,
        path: String,
    },
    #[serde(rename = "s3")]
    S3 {
        endpoint: Option<String>,
        region: String,
        bucket: String,
        access_key: String,
        secret_key: String,
        path: String,
    },
}

#[async_trait]
pub trait RemoteStorageBackend: Send + Sync {
    async fn upload(&self, local_path: &Path, remote_path: &str) -> Result<()>;
    async fn download(&self, remote_path: &str, local_path: &Path) -> Result<()>;
    async fn list(&self, path: &str) -> Result<Vec<String>>;
    async fn delete(&self, remote_path: &str) -> Result<()>;
    async fn exists(&self, remote_path: &str) -> Result<bool>;
}

// ─── FTP Backend ────────────────────────────────────────────────────────────

pub struct FtpBackend {
    host: String,
    port: u16,
    username: String,
    password: String,
    base_path: String,
    use_tls: bool,
}

impl FtpBackend {
    pub fn new(
        host: String,
        port: u16,
        username: String,
        password: String,
        base_path: String,
        use_tls: bool,
    ) -> Self {
        Self {
            host,
            port,
            username,
            password,
            base_path,
            use_tls,
        }
    }

    async fn connect(&self) -> Result<suppaftp::AsyncFtpStream> {
        use suppaftp::AsyncFtpStream;

        let addr = format!("{}:{}", self.host, self.port);
        let mut ftp_stream = AsyncFtpStream::connect(&addr)
            .await
            .map_err(|e| RemoteStorageError::Ftp(e.to_string()))?;

        // Login
        ftp_stream
            .login(&self.username, &self.password)
            .await
            .map_err(|e| RemoteStorageError::Ftp(e.to_string()))?;

        // Change to base directory
        if !self.base_path.is_empty() {
            ftp_stream
                .cwd(&self.base_path)
                .await
                .map_err(|e| RemoteStorageError::Ftp(e.to_string()))?;
        }

        Ok(ftp_stream)
    }
}

#[async_trait]
impl RemoteStorageBackend for FtpBackend {
    async fn upload(&self, local_path: &Path, remote_path: &str) -> Result<()> {
        info!("Uploading to FTP: {} -> {}", local_path.display(), remote_path);

        let mut ftp = self.connect().await?;

        // Read file
        let mut file = File::open(local_path).await?;
        let mut contents = Vec::new();
        file.read_to_end(&mut contents).await?;

        // Upload file
        ftp.put_file(remote_path, &mut contents.as_slice())
            .await
            .map_err(|e| RemoteStorageError::Ftp(e.to_string()))?;

        // Disconnect
        let _ = ftp.quit().await;

        info!("FTP upload completed: {}", remote_path);
        Ok(())
    }

    async fn download(&self, remote_path: &str, local_path: &Path) -> Result<()> {
        info!("Downloading from FTP: {} -> {}", remote_path, local_path.display());

        let mut ftp = self.connect().await?;

        // Download file
        let cursor = ftp
            .retr_as_buffer(remote_path)
            .await
            .map_err(|e| RemoteStorageError::Ftp(e.to_string()))?;

        // Write to local file
        tokio::fs::write(local_path, cursor.into_inner()).await?;

        // Disconnect
        let _ = ftp.quit().await;

        info!("FTP download completed: {}", local_path.display());
        Ok(())
    }

    async fn list(&self, path: &str) -> Result<Vec<String>> {
        let mut ftp = self.connect().await?;

        let entries = ftp
            .list(Some(path))
            .await
            .map_err(|e| RemoteStorageError::Ftp(e.to_string()))?;

        let _ = ftp.quit().await;

        Ok(entries)
    }

    async fn delete(&self, remote_path: &str) -> Result<()> {
        let mut ftp = self.connect().await?;

        ftp.rm(remote_path)
            .await
            .map_err(|e| RemoteStorageError::Ftp(e.to_string()))?;

        let _ = ftp.quit().await;

        Ok(())
    }

    async fn exists(&self, remote_path: &str) -> Result<bool> {
        let mut ftp = self.connect().await?;

        let result = ftp.size(remote_path).await.is_ok();

        let _ = ftp.quit().await;

        Ok(result)
    }
}

// ─── WebDAV Backend ─────────────────────────────────────────────────────────

pub struct WebDavBackend {
    client: reqwest::Client,
    base_url: String,
    username: String,
    password: String,
    base_path: String,
}

impl WebDavBackend {
    pub fn new(url: String, username: String, password: String, base_path: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .unwrap();

        Self {
            client,
            base_url: url,
            username,
            password,
            base_path,
        }
    }

    fn get_full_url(&self, path: &str) -> String {
        format!("{}/{}/{}", self.base_url.trim_end_matches('/'), self.base_path.trim_matches('/'), path.trim_start_matches('/'))
    }
}

#[async_trait]
impl RemoteStorageBackend for WebDavBackend {
    async fn upload(&self, local_path: &Path, remote_path: &str) -> Result<()> {
        info!("Uploading to WebDAV: {} -> {}", local_path.display(), remote_path);

        let url = self.get_full_url(remote_path);

        // Read file
        let mut file = File::open(local_path).await?;
        let mut contents = Vec::new();
        file.read_to_end(&mut contents).await?;

        // Upload via PUT request
        let response = self
            .client
            .put(&url)
            .basic_auth(&self.username, Some(&self.password))
            .body(contents)
            .send()
            .await
            .map_err(|e| RemoteStorageError::WebDav(e.to_string()))?;

        if !response.status().is_success() {
            return Err(RemoteStorageError::WebDav(format!(
                "Upload failed with status: {}",
                response.status()
            )));
        }

        info!("WebDAV upload completed: {}", remote_path);
        Ok(())
    }

    async fn download(&self, remote_path: &str, local_path: &Path) -> Result<()> {
        info!("Downloading from WebDAV: {} -> {}", remote_path, local_path.display());

        let url = self.get_full_url(remote_path);

        // Download via GET request
        let response = self
            .client
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| RemoteStorageError::WebDav(e.to_string()))?;

        if !response.status().is_success() {
            return Err(RemoteStorageError::WebDav(format!(
                "Download failed with status: {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| RemoteStorageError::WebDav(e.to_string()))?;

        // Write to local file
        tokio::fs::write(local_path, bytes).await?;

        info!("WebDAV download completed: {}", local_path.display());
        Ok(())
    }

    async fn list(&self, path: &str) -> Result<Vec<String>> {
        let url = self.get_full_url(path);

        let propfind_body = r#"<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
  </D:prop>
</D:propfind>"#;

        let response = self
            .client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .body(propfind_body)
            .send()
            .await
            .map_err(|e| RemoteStorageError::WebDav(e.to_string()))?;

        if !response.status().is_success() {
            return Err(RemoteStorageError::WebDav(format!(
                "List failed with status: {}",
                response.status()
            )));
        }

        // Parse XML response (simplified - would need proper XML parsing in production)
        let text = response
            .text()
            .await
            .map_err(|e| RemoteStorageError::WebDav(e.to_string()))?;

        // For now, return empty list (would need proper XML parsing)
        Ok(vec![])
    }

    async fn delete(&self, remote_path: &str) -> Result<()> {
        let url = self.get_full_url(remote_path);

        let response = self
            .client
            .delete(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| RemoteStorageError::WebDav(e.to_string()))?;

        if !response.status().is_success() {
            return Err(RemoteStorageError::WebDav(format!(
                "Delete failed with status: {}",
                response.status()
            )));
        }

        Ok(())
    }

    async fn exists(&self, remote_path: &str) -> Result<bool> {
        let url = self.get_full_url(remote_path);

        let response = self
            .client
            .head(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| RemoteStorageError::WebDav(e.to_string()))?;

        Ok(response.status().is_success())
    }
}

// ─── S3 Backend ─────────────────────────────────────────────────────────────

pub struct S3Backend {
    region: rusoto_core::Region,
    bucket: String,
    base_path: String,
    client: rusoto_s3::S3Client,
}

impl S3Backend {
    pub fn new(
        endpoint: Option<String>,
        region: String,
        bucket: String,
        access_key: String,
        secret_key: String,
        base_path: String,
    ) -> Self {
        use rusoto_core::credential::StaticProvider;
        use rusoto_core::HttpClient;
        use rusoto_core::Region;

        let credentials = StaticProvider::new_minimal(access_key, secret_key);

        let region = if let Some(endpoint) = endpoint {
            Region::Custom {
                name: region,
                endpoint,
            }
        } else {
            region.parse().unwrap_or(Region::UsEast1)
        };

        let client = rusoto_s3::S3Client::new_with(
            HttpClient::new().unwrap(),
            credentials,
            region.clone(),
        );

        Self {
            region,
            bucket,
            base_path,
            client,
        }
    }

    fn get_full_key(&self, path: &str) -> String {
        format!("{}/{}", self.base_path.trim_matches('/'), path.trim_start_matches('/'))
    }
}

#[async_trait]
impl RemoteStorageBackend for S3Backend {
    async fn upload(&self, local_path: &Path, remote_path: &str) -> Result<()> {
        use rusoto_s3::{PutObjectRequest, S3};

        info!("Uploading to S3: {} -> {}", local_path.display(), remote_path);

        let key = self.get_full_key(remote_path);

        // Read file
        let mut file = File::open(local_path).await?;
        let mut contents = Vec::new();
        file.read_to_end(&mut contents).await?;

        // Upload to S3
        let put_request = PutObjectRequest {
            bucket: self.bucket.clone(),
            key: key.clone(),
            body: Some(contents.into()),
            ..Default::default()
        };

        self.client
            .put_object(put_request)
            .await
            .map_err(|e| RemoteStorageError::S3(e.to_string()))?;

        info!("S3 upload completed: {}", key);
        Ok(())
    }

    async fn download(&self, remote_path: &str, local_path: &Path) -> Result<()> {
        use rusoto_s3::{GetObjectRequest, S3};
        use tokio::io::AsyncWriteExt;

        info!("Downloading from S3: {} -> {}", remote_path, local_path.display());

        let key = self.get_full_key(remote_path);

        // Download from S3
        let get_request = GetObjectRequest {
            bucket: self.bucket.clone(),
            key: key.clone(),
            ..Default::default()
        };

        let result = self
            .client
            .get_object(get_request)
            .await
            .map_err(|e| RemoteStorageError::S3(e.to_string()))?;

        // Write to local file
        if let Some(body) = result.body {
            use futures::StreamExt;
            let mut stream = body;
            let mut file = File::create(local_path).await?;

            while let Some(chunk) = stream.next().await {
                let bytes = chunk.map_err(|e| RemoteStorageError::S3(e.to_string()))?;
                file.write_all(&bytes).await?;
            }

            file.flush().await?;
        }

        info!("S3 download completed: {}", local_path.display());
        Ok(())
    }

    async fn list(&self, path: &str) -> Result<Vec<String>> {
        use rusoto_s3::{ListObjectsV2Request, S3};

        let prefix = self.get_full_key(path);

        let list_request = ListObjectsV2Request {
            bucket: self.bucket.clone(),
            prefix: Some(prefix),
            ..Default::default()
        };

        let result = self
            .client
            .list_objects_v2(list_request)
            .await
            .map_err(|e| RemoteStorageError::S3(e.to_string()))?;

        let keys = result
            .contents
            .unwrap_or_default()
            .into_iter()
            .filter_map(|obj| obj.key)
            .collect();

        Ok(keys)
    }

    async fn delete(&self, remote_path: &str) -> Result<()> {
        use rusoto_s3::{DeleteObjectRequest, S3};

        let key = self.get_full_key(remote_path);

        let delete_request = DeleteObjectRequest {
            bucket: self.bucket.clone(),
            key: key.clone(),
            ..Default::default()
        };

        self.client
            .delete_object(delete_request)
            .await
            .map_err(|e| RemoteStorageError::S3(e.to_string()))?;

        Ok(())
    }

    async fn exists(&self, remote_path: &str) -> Result<bool> {
        use rusoto_s3::{HeadObjectRequest, S3};

        let key = self.get_full_key(remote_path);

        let head_request = HeadObjectRequest {
            bucket: self.bucket.clone(),
            key: key.clone(),
            ..Default::default()
        };

        Ok(self.client.head_object(head_request).await.is_ok())
    }
}

/// Create remote storage backend from configuration
pub fn create_backend(config: &RemoteStorageConfig) -> Result<Box<dyn RemoteStorageBackend>> {
    match config {
        RemoteStorageConfig::Ftp {
            host,
            port,
            username,
            password,
            path,
            use_tls,
        } => Ok(Box::new(FtpBackend::new(
            host.clone(),
            *port,
            username.clone(),
            password.clone(),
            path.clone(),
            *use_tls,
        ))),
        RemoteStorageConfig::WebDav {
            url,
            username,
            password,
            path,
        } => Ok(Box::new(WebDavBackend::new(
            url.clone(),
            username.clone(),
            password.clone(),
            path.clone(),
        ))),
        RemoteStorageConfig::S3 {
            endpoint,
            region,
            bucket,
            access_key,
            secret_key,
            path,
        } => Ok(Box::new(S3Backend::new(
            endpoint.clone(),
            region.clone(),
            bucket.clone(),
            access_key.clone(),
            secret_key.clone(),
            path.clone(),
        ))),
    }
}
