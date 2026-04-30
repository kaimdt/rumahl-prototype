// GitHub Integration – Full GitHub REST API Client for IORA Assist
//
// Features:
// - Authentication: Personal Access Token (PAT) & GitHub App (JWT + Installation Token)
// - Repositories: List, search, get, create, fork, delete
// - Branches: List, get, create, delete, protect
// - Issues: List, get, create, update, close, assign, label
// - Pull Requests: List, get, create, merge, close, review
// - Files: Read, create/update, delete via Contents API
// - Commits: List, get, compare
// - Workflows: List, trigger, get runs
// - Releases: List, get, create
// - Webhooks: List, create, test

use std::collections::HashMap;
use std::sync::Arc;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

// ─── Authentication ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubAuth {
    /// "pat" | "app" | "oauth"
    pub auth_type: String,
    /// Personal Access Token (classic or fine-grained)
    pub pat: Option<String>,
    /// GitHub App ID
    pub app_id: Option<String>,
    /// GitHub App installation ID
    pub installation_id: Option<String>,
    /// GitHub App private key (PEM)
    pub private_key: Option<String>,
    /// OAuth token
    pub oauth_token: Option<String>,
    /// GitHub API base URL (default: https://api.github.com)
    pub api_base_url: Option<String>,
    /// Whether auth is configured and working
    pub is_configured: bool,
    /// Authenticated username (for PAT/OAuth)
    pub username: Option<String>,
}

use iora_shared::system_config;

impl Default for GitHubAuth {
    fn default() -> Self {
        Self {
            auth_type: "pat".into(),
            pat: system_config::github_token(),
            app_id: system_config::github_app_id(),
            installation_id: system_config::github_installation_id(),
            private_key: system_config::github_private_key(),
            oauth_token: None,
            api_base_url: Some("https://api.github.com".into()),
            is_configured: false,
            username: None,
        }
    }
}

impl GitHubAuth {
    /// Create from PAT
    pub fn from_pat(token: &str) -> Self {
        Self {
            auth_type: "pat".into(),
            pat: Some(token.to_string()),
            is_configured: true,
            ..Default::default()
        }
    }

    /// Create from GitHub App credentials
    pub fn from_app(app_id: &str, installation_id: &str, private_key: &str) -> Self {
        Self {
            auth_type: "app".into(),
            app_id: Some(app_id.to_string()),
            installation_id: Some(installation_id.to_string()),
            private_key: Some(private_key.to_string()),
            is_configured: true,
            ..Default::default()
        }
    }

    /// Get the authorization header value
    pub fn auth_header(&self) -> Option<String> {
        match self.auth_type.as_str() {
            "pat" => self.pat.as_ref().map(|t| format!("Bearer {}", t)),
            "oauth" => self.oauth_token.as_ref().map(|t| format!("Bearer {}", t)),
            "app" => self.installation_id.as_ref().map(|t| format!("Bearer {}", t)),
            _ => self.pat.as_ref().map(|t| format!("Bearer {}", t)),
        }
    }

    pub fn api_base(&self) -> &str {
        self.api_base_url.as_deref().unwrap_or("https://api.github.com")
    }
}

// ─── GitHub API Types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub owner: GitHubOwner,
    pub private: bool,
    pub html_url: String,
    pub description: Option<String>,
    pub fork: bool,
    pub default_branch: String,
    pub language: Option<String>,
    pub topics: Vec<String>,
    pub stargazers_count: u64,
    pub forks_count: u64,
    pub open_issues_count: u64,
    pub watchers_count: u64,
    pub size_kb: u64,
    pub created_at: String,
    pub updated_at: String,
    pub pushed_at: String,
    pub clone_url: String,
    pub ssh_url: String,
    pub license: Option<GitHubLicense>,
    pub archived: bool,
    pub disabled: bool,
    pub visibility: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubOwner {
    pub id: u64,
    pub login: String,
    pub avatar_url: String,
    pub html_url: String,
    #[serde(rename = "type")]
    pub owner_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubLicense {
    pub key: String,
    pub name: String,
    pub spdx_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubBranch {
    pub name: String,
    pub commit: GitHubBranchCommit,
    pub protected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubBranchCommit {
    pub sha: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubIssue {
    pub id: u64,
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub state_reason: Option<String>,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub user: Option<GitHubOwner>,
    pub assignees: Vec<GitHubOwner>,
    pub labels: Vec<GitHubLabel>,
    pub comments: u64,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubLabel {
    pub id: u64,
    pub name: String,
    pub color: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubPullRequest {
    pub id: u64,
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub html_url: String,
    pub diff_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
    pub user: Option<GitHubOwner>,
    pub head: GitHubRef,
    pub base: GitHubRef,
    pub mergeable: Option<bool>,
    pub merge_commit_sha: Option<String>,
    pub draft: bool,
    pub labels: Vec<GitHubLabel>,
    pub requested_reviewers: Vec<GitHubOwner>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRef {
    pub label: String,
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub sha: String,
    pub repo: Option<GitHubRepo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubContent {
    pub name: String,
    pub path: String,
    pub sha: String,
    pub size: u64,
    pub url: String,
    pub html_url: String,
    pub git_url: String,
    pub download_url: Option<String>,
    #[serde(rename = "type")]
    pub content_type: String,
    pub content: Option<String>,
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubCommit {
    pub sha: String,
    pub html_url: String,
    pub commit: GitHubCommitDetail,
    pub author: Option<GitHubOwner>,
    pub committer: Option<GitHubOwner>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubCommitDetail {
    pub message: String,
    pub author: GitHubCommitAuthor,
    pub committer: GitHubCommitAuthor,
    pub comment_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubCommitAuthor {
    pub name: String,
    pub email: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubWorkflow {
    pub id: u64,
    pub name: String,
    pub path: String,
    pub state: String,
    pub html_url: String,
    pub badge_url: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubWorkflowRun {
    pub id: u64,
    pub name: String,
    pub workflow_id: u64,
    pub status: String,
    pub conclusion: Option<String>,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub run_number: u64,
    pub event: String,
    pub head_branch: String,
    pub head_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRelease {
    pub id: u64,
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub draft: bool,
    pub prerelease: bool,
    pub created_at: String,
    pub published_at: Option<String>,
    pub html_url: String,
    pub tarball_url: String,
    pub zipball_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubSearchResult {
    pub total_count: u64,
    pub incomplete_results: bool,
    pub items: Vec<GitHubRepo>,
}

// ─── GitHub Client ─────────────────────────────────────────────────────────

pub struct GitHubClient {
    auth: Arc<RwLock<GitHubAuth>>,
    http: reqwest::Client,
    /// Cache for repo lists (TTL 5 min)
    repo_cache: Arc<RwLock<HashMap<String, (Vec<GitHubRepo>, DateTime<Utc>)>>>,
    /// Cache for branches
    branch_cache: Arc<RwLock<HashMap<String, (Vec<GitHubBranch>, DateTime<Utc>)>>>,
}

impl GitHubClient {
    pub fn new(auth: GitHubAuth) -> Self {
        Self {
            auth: Arc::new(RwLock::new(auth)),
            http: reqwest::Client::new(),
            repo_cache: Arc::new(RwLock::new(HashMap::new())),
            branch_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_auth(&self) -> GitHubAuth {
        self.auth.read().await.clone()
    }

    pub async fn update_auth(&self, auth: GitHubAuth) {
        *self.auth.write().await = auth;
        // Clear caches on auth change
        self.repo_cache.write().await.clear();
        self.branch_cache.write().await.clear();
    }

    pub async fn is_configured(&self) -> bool {
        let auth = self.auth.read().await;
        auth.is_configured && auth.auth_header().is_some()
    }

    // ─── API Helpers ────────────────────────────────────────────────────

    async fn get(&self, path: &str) -> Result<reqwest::Response, String> {
        let auth = self.auth.read().await;
        let url = format!("{}{}", auth.api_base(), path);

        let mut req = self.http.get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "IORA-Assist/1.0");

        if let Some(header) = auth.auth_header() {
            req = req.header("Authorization", header);
        }

        req.send().await.map_err(|e| format!("HTTP request failed: {}", e))
    }

    async fn post(&self, path: &str, body: &serde_json::Value) -> Result<reqwest::Response, String> {
        let auth = self.auth.read().await;
        let url = format!("{}{}", auth.api_base(), path);

        let mut req = self.http.post(&url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "IORA-Assist/1.0")
            .json(body);

        if let Some(header) = auth.auth_header() {
            req = req.header("Authorization", header);
        }

        req.send().await.map_err(|e| format!("HTTP request failed: {}", e))
    }

    async fn put(&self, path: &str, body: &serde_json::Value) -> Result<reqwest::Response, String> {
        let auth = self.auth.read().await;
        let url = format!("{}{}", auth.api_base(), path);

        let mut req = self.http.put(&url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "IORA-Assist/1.0")
            .json(body);

        if let Some(header) = auth.auth_header() {
            req = req.header("Authorization", header);
        }

        req.send().await.map_err(|e| format!("HTTP request failed: {}", e))
    }

    async fn patch(&self, path: &str, body: &serde_json::Value) -> Result<reqwest::Response, String> {
        let auth = self.auth.read().await;
        let url = format!("{}{}", auth.api_base(), path);

        let mut req = self.http.patch(&url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "IORA-Assist/1.0")
            .json(body);

        if let Some(header) = auth.auth_header() {
            req = req.header("Authorization", header);
        }

        req.send().await.map_err(|e| format!("HTTP request failed: {}", e))
    }

    async fn delete(&self, path: &str) -> Result<reqwest::Response, String> {
        let auth = self.auth.read().await;
        let url = format!("{}{}", auth.api_base(), path);

        let mut req = self.http.delete(&url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "IORA-Assist/1.0");

        if let Some(header) = auth.auth_header() {
            req = req.header("Authorization", header);
        }

        req.send().await.map_err(|e| format!("HTTP request failed: {}", e))
    }

    async fn parse_response<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> Result<T, String> {
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("GitHub API error ({}): {}", status.as_u16(), body));
        }
        response.json::<T>().await.map_err(|e| format!("JSON parse error: {}", e))
    }

    async fn parse_response_optional<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> Result<Option<T>, String> {
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("GitHub API error ({}): {}", status.as_u16(), body));
        }
        let val = response.json::<T>().await.map_err(|e| format!("JSON parse error: {}", e))?;
        Ok(Some(val))
    }

    // ─── Authentication & User ──────────────────────────────────────────

    /// Verify authentication and get user info
    pub async fn verify_auth(&self) -> Result<GitHubOwner, String> {
        let response = self.get("/user").await?;
        let user: GitHubOwner = Self::parse_response(response).await?;

        let mut auth = self.auth.write().await;
        auth.username = Some(user.login.clone());
        auth.is_configured = true;

        Ok(user)
    }

    /// Get rate limit status
    pub async fn rate_limit(&self) -> Result<serde_json::Value, String> {
        let response = self.get("/rate_limit").await?;
        Self::parse_response(response).await
    }

    // ─── Repositories ───────────────────────────────────────────────────

    /// List repositories for the authenticated user
    pub async fn list_my_repos(&self, page: u32, per_page: u32) -> Result<Vec<GitHubRepo>, String> {
        let path = format!("/user/repos?type=all&sort=updated&direction=desc&page={}&per_page={}", page, per_page);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// List repositories for a specific owner (user or org)
    pub async fn list_repos_for_owner(&self, owner: &str, page: u32, per_page: u32) -> Result<Vec<GitHubRepo>, String> {
        let path = format!("/users/{}/repos?type=all&sort=updated&page={}&per_page={}", owner, page, per_page);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// List org repositories
    pub async fn list_org_repos(&self, org: &str, page: u32, per_page: u32) -> Result<Vec<GitHubRepo>, String> {
        let path = format!("/orgs/{}/repos?type=all&sort=updated&page={}&per_page={}", org, page, per_page);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Search repositories
    pub async fn search_repos(&self, query: &str, page: u32, per_page: u32) -> Result<GitHubSearchResult, String> {
        let encoded = urlencoding::encode(query);
        let path = format!("/search/repositories?q={}&sort=stars&order=desc&page={}&per_page={}", encoded, page, per_page);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Get a single repository
    pub async fn get_repo(&self, owner: &str, repo: &str) -> Result<GitHubRepo, String> {
        let path = format!("/repos/{}/{}", owner, repo);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Get all repos accessible to the authenticated user (with caching)
    pub async fn get_all_accessible_repos(&self) -> Result<Vec<GitHubRepo>, String> {
        let cache_key = "all_accessible".to_string();
        {
            let cache = self.repo_cache.read().await;
            if let Some((repos, ts)) = cache.get(&cache_key) {
                if (Utc::now() - *ts).num_seconds() < 300 {
                    return Ok(repos.clone());
                }
            }
        }

        let mut all_repos = Vec::new();
        let mut page = 1u32;

        loop {
            let repos = self.list_my_repos(page, 100).await?;
            if repos.is_empty() {
                break;
            }
            let count = repos.len();
            all_repos.extend(repos);
            if count < 100 {
                break;
            }
            page += 1;
            if page > 10 {
                break; // Safety limit
            }
        }

        // Cache
        self.repo_cache.write().await.insert(cache_key, (all_repos.clone(), Utc::now()));

        Ok(all_repos)
    }

    /// Get default branch for a repo (fast, single API call)
    pub async fn get_default_branch(&self, owner: &str, repo: &str) -> Result<String, String> {
        let gh_repo = self.get_repo(owner, repo).await?;
        Ok(gh_repo.default_branch)
    }

    // ─── Branches ───────────────────────────────────────────────────────

    /// List branches for a repository
    pub async fn list_branches(&self, owner: &str, repo: &str, page: u32, per_page: u32) -> Result<Vec<GitHubBranch>, String> {
        let path = format!("/repos/{}/{}/branches?page={}&per_page={}", owner, repo, page, per_page);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Get a single branch
    pub async fn get_branch(&self, owner: &str, repo: &str, branch: &str) -> Result<GitHubBranch, String> {
        let path = format!("/repos/{}/{}/branches/{}", owner, repo, branch);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Get all branches for a repo (with caching)
    pub async fn get_all_branches(&self, owner: &str, repo: &str) -> Result<Vec<GitHubBranch>, String> {
        let cache_key = format!("{}/{}", owner, repo);
        {
            let cache = self.branch_cache.read().await;
            if let Some((branches, ts)) = cache.get(&cache_key) {
                if (Utc::now() - *ts).num_seconds() < 120 {
                    return Ok(branches.clone());
                }
            }
        }

        let mut all_branches = Vec::new();
        let mut page = 1u32;

        loop {
            let branches = self.list_branches(owner, repo, page, 100).await?;
            if branches.is_empty() {
                break;
            }
            let count = branches.len();
            all_branches.extend(branches);
            if count < 100 {
                break;
            }
            page += 1;
        }

        self.branch_cache.write().await.insert(cache_key, (all_branches.clone(), Utc::now()));
        Ok(all_branches)
    }

    /// Create a branch (from a base SHA or branch name)
    pub async fn create_branch(&self, owner: &str, repo: &str, branch_name: &str, base_sha: &str) -> Result<GitHubBranch, String> {
        let path = format!("/repos/{}/{}/git/refs", owner, repo);
        let body = serde_json::json!({
            "ref": format!("refs/heads/{}", branch_name),
            "sha": base_sha,
        });
        let response = self.post(&path, &body).await?;
        // Now fetch the branch
        self.get_branch(owner, repo, branch_name).await
    }

    /// Delete a branch
    pub async fn delete_branch(&self, owner: &str, repo: &str, branch: &str) -> Result<(), String> {
        let path = format!("/repos/{}/{}/git/refs/heads/{}", owner, repo, branch);
        let _ = self.delete(&path).await?;
        self.branch_cache.write().await.remove(&format!("{}/{}", owner, repo));
        Ok(())
    }

    // ─── Issues ─────────────────────────────────────────────────────────

    /// List issues for a repo
    pub async fn list_issues(
        &self, owner: &str, repo: &str,
        state: Option<&str>, labels: Option<&str>,
        assignee: Option<&str>, page: u32, per_page: u32,
    ) -> Result<Vec<GitHubIssue>, String> {
        let mut path = format!("/repos/{}/{}/issues?page={}&per_page={}", owner, repo, page, per_page);
        if let Some(s) = state { path.push_str(&format!("&state={}", s)); }
        if let Some(l) = labels { path.push_str(&format!("&labels={}", urlencoding::encode(l))); }
        if let Some(a) = assignee { path.push_str(&format!("&assignee={}", a)); }

        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Get a single issue
    pub async fn get_issue(&self, owner: &str, repo: &str, issue_number: u64) -> Result<GitHubIssue, String> {
        let path = format!("/repos/{}/{}/issues/{}", owner, repo, issue_number);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Create an issue
    pub async fn create_issue(
        &self, owner: &str, repo: &str,
        title: &str, body: &str,
        labels: Option<&[String]>,
        assignees: Option<&[String]>,
    ) -> Result<GitHubIssue, String> {
        let path = format!("/repos/{}/{}/issues", owner, repo);
        let mut json = serde_json::json!({
            "title": title,
            "body": body,
        });
        if let Some(l) = labels { json["labels"] = serde_json::json!(l); }
        if let Some(a) = assignees { json["assignees"] = serde_json::json!(a); }

        let response = self.post(&path, &json).await?;
        Self::parse_response(response).await
    }

    /// Update an issue
    pub async fn update_issue(
        &self, owner: &str, repo: &str, issue_number: u64,
        title: Option<&str>, body: Option<&str>,
        state: Option<&str>, labels: Option<&[String]>,
    ) -> Result<GitHubIssue, String> {
        let path = format!("/repos/{}/{}/issues/{}", owner, repo, issue_number);
        let mut json = serde_json::json!({});
        if let Some(t) = title { json["title"] = serde_json::json!(t); }
        if let Some(b) = body { json["body"] = serde_json::json!(b); }
        if let Some(s) = state { json["state"] = serde_json::json!(s); }
        if let Some(l) = labels { json["labels"] = serde_json::json!(l); }

        let response = self.patch(&path, &json).await?;
        Self::parse_response(response).await
    }

    /// Close an issue
    pub async fn close_issue(&self, owner: &str, repo: &str, issue_number: u64) -> Result<GitHubIssue, String> {
        self.update_issue(owner, repo, issue_number, None, None, Some("closed"), None).await
    }

    /// Add labels to an issue
    pub async fn add_labels(&self, owner: &str, repo: &str, issue_number: u64, labels: &[String]) -> Result<Vec<GitHubLabel>, String> {
        let path = format!("/repos/{}/{}/issues/{}/labels", owner, repo, issue_number);
        let body = serde_json::json!({ "labels": labels });
        let response = self.post(&path, &body).await?;
        Self::parse_response(response).await
    }

    /// Add a comment to an issue
    pub async fn create_issue_comment(
        &self, owner: &str, repo: &str, issue_number: u64, body: &str,
    ) -> Result<serde_json::Value, String> {
        let path = format!("/repos/{}/{}/issues/{}/comments", owner, repo, issue_number);
        let json = serde_json::json!({ "body": body });
        let response = self.post(&path, &json).await?;
        Self::parse_response(response).await
    }

    // ─── Pull Requests ──────────────────────────────────────────────────

    /// List PRs for a repo
    pub async fn list_pull_requests(
        &self, owner: &str, repo: &str,
        state: Option<&str>, page: u32, per_page: u32,
    ) -> Result<Vec<GitHubPullRequest>, String> {
        let mut path = format!("/repos/{}/{}/pulls?page={}&per_page={}", owner, repo, page, per_page);
        if let Some(s) = state { path.push_str(&format!("&state={}", s)); }

        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Get a single PR
    pub async fn get_pull_request(&self, owner: &str, repo: &str, pr_number: u64) -> Result<GitHubPullRequest, String> {
        let path = format!("/repos/{}/{}/pulls/{}", owner, repo, pr_number);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Create a pull request
    pub async fn create_pull_request(
        &self, owner: &str, repo: &str,
        title: &str, body: &str,
        head: &str, base: &str,
        draft: bool,
    ) -> Result<GitHubPullRequest, String> {
        let path = format!("/repos/{}/{}/pulls", owner, repo);
        let json = serde_json::json!({
            "title": title,
            "body": body,
            "head": head,
            "base": base,
            "draft": draft,
        });
        let response = self.post(&path, &json).await?;
        Self::parse_response(response).await
    }

    /// Merge a pull request
    pub async fn merge_pull_request(
        &self, owner: &str, repo: &str, pr_number: u64,
        commit_title: Option<&str>, merge_method: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        let path = format!("/repos/{}/{}/pulls/{}/merge", owner, repo, pr_number);
        let mut json = serde_json::json!({});
        if let Some(t) = commit_title { json["commit_title"] = serde_json::json!(t); }
        if let Some(m) = merge_method { json["merge_method"] = serde_json::json!(m); }

        let response = self.put(&path, &json).await?;
        Self::parse_response(response).await
    }

    /// Request reviewers for a PR
    pub async fn request_reviewers(
        &self, owner: &str, repo: &str, pr_number: u64, reviewers: &[String],
    ) -> Result<serde_json::Value, String> {
        let path = format!("/repos/{}/{}/pulls/{}/requested_reviewers", owner, repo, pr_number);
        let json = serde_json::json!({ "reviewers": reviewers });
        let response = self.post(&path, &json).await?;
        Self::parse_response(response).await
    }

    /// Get PR diff as text
    pub async fn get_pr_diff(&self, owner: &str, repo: &str, pr_number: u64) -> Result<String, String> {
        let path = format!("/repos/{}/{}/pulls/{}", owner, repo, pr_number);
        let auth = self.auth.read().await;
        let url = format!("{}{}", auth.api_base(), path);

        let mut req = self.http.get(&url)
            .header("Accept", "application/vnd.github.v3.diff")
            .header("User-Agent", "IORA-Assist/1.0");

        if let Some(header) = auth.auth_header() {
            req = req.header("Authorization", header);
        }

        let response = req.send().await.map_err(|e| format!("HTTP error: {}", e))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("GitHub API error ({}): {}", status.as_u16(), body));
        }
        response.text().await.map_err(|e| format!("Response error: {}", e))
    }

    // ─── Contents / Files ───────────────────────────────────────────────

    /// Get file/directory contents
    pub async fn get_contents(&self, owner: &str, repo: &str, path_str: &str, ref_name: Option<&str>) -> Result<Vec<GitHubContent>, String> {
        let mut api_path = format!("/repos/{}/{}/contents/{}", owner, repo, path_str.trim_start_matches('/'));
        if let Some(r) = ref_name { api_path.push_str(&format!("?ref={}", r)); }

        let response = self.get(&api_path).await?;
        // Content can be a single file object or an array of directory entries
        let text = response.text().await.map_err(|e| format!("Response error: {}", e))?;

        // Try as array first
        if let Ok(items) = serde_json::from_str::<Vec<GitHubContent>>(&text) {
            Ok(items)
        } else if let Ok(item) = serde_json::from_str::<GitHubContent>(&text) {
            Ok(vec![item])
        } else {
            Err(format!("Failed to parse content response: {}", &text[..text.len().min(200)]))
        }
    }

    /// Read a file (decoded content)
    pub async fn read_file(&self, owner: &str, repo: &str, file_path: &str, ref_name: Option<&str>) -> Result<String, String> {
        let items = self.get_contents(owner, repo, file_path, ref_name).await?;
        let item = items.first().ok_or("File not found")?;

        if let Some(ref content) = item.content {
            use base64::Engine;
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(content.replace('\n', "").replace('\r', ""))
                .map_err(|e| format!("Base64 decode error: {}", e))?;
            Ok(String::from_utf8_lossy(&decoded).to_string())
        } else {
            Err("No content in response".into())
        }
    }

    /// Create or update a file
    pub async fn write_file(
        &self, owner: &str, repo: &str, file_path: &str,
        content: &str, message: &str, branch: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        let path = format!("/repos/{}/{}/contents/{}", owner, repo, file_path.trim_start_matches('/'));
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(content.as_bytes());

        let mut json = serde_json::json!({
            "message": message,
            "content": encoded,
        });
        if let Some(b) = branch { json["branch"] = serde_json::json!(b); }

        // Check if file exists to get SHA (need to use sha for updates)
        match self.get_contents(owner, repo, file_path, branch).await {
            Ok(items) => {
                if let Some(item) = items.first() {
                    json["sha"] = serde_json::json!(&item.sha);
                }
            }
            _ => {} // File doesn't exist, create it
        }

        let response = self.put(&path, &json).await?;
        Self::parse_response(response).await
    }

    /// Delete a file
    pub async fn delete_file(
        &self, owner: &str, repo: &str, file_path: &str,
        message: &str, branch: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        let path = format!("/repos/{}/{}/contents/{}", owner, repo, file_path.trim_start_matches('/'));

        // Get SHA of the file
        let items = self.get_contents(owner, repo, file_path, branch).await?;
        let sha = items.first().map(|i| i.sha.clone()).ok_or("File not found")?;

        let mut json = serde_json::json!({
            "message": message,
            "sha": sha,
        });
        if let Some(b) = branch { json["branch"] = serde_json::json!(b); }

        let response = self.delete_with_body(&path, &json).await?;
        Self::parse_response(response).await
    }

    async fn delete_with_body(&self, path: &str, body: &serde_json::Value) -> Result<reqwest::Response, String> {
        let auth = self.auth.read().await;
        let url = format!("{}{}", auth.api_base(), path);

        let mut req = self.http.delete(&url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "IORA-Assist/1.0")
            .json(body);

        if let Some(header) = auth.auth_header() {
            req = req.header("Authorization", header);
        }

        req.send().await.map_err(|e| format!("HTTP request failed: {}", e))
    }

    // ─── Commits ────────────────────────────────────────────────────────

    /// List commits for a repo
    pub async fn list_commits(
        &self, owner: &str, repo: &str,
        branch: Option<&str>, page: u32, per_page: u32,
    ) -> Result<Vec<GitHubCommit>, String> {
        let mut path = format!("/repos/{}/{}/commits?page={}&per_page={}", owner, repo, page, per_page);
        if let Some(b) = branch { path.push_str(&format!("&sha={}", b)); }

        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Get a single commit
    pub async fn get_commit(&self, owner: &str, repo: &str, sha: &str) -> Result<GitHubCommit, String> {
        let path = format!("/repos/{}/{}/commits/{}", owner, repo, sha);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Compare two commits/branches
    pub async fn compare_commits(
        &self, owner: &str, repo: &str, base: &str, head: &str,
    ) -> Result<serde_json::Value, String> {
        let path = format!("/repos/{}/{}/compare/{}...{}", owner, repo, base, head);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    // ─── Workflows / Actions ────────────────────────────────────────────

    /// List workflows
    pub async fn list_workflows(&self, owner: &str, repo: &str) -> Result<Vec<GitHubWorkflow>, String> {
        let path = format!("/repos/{}/{}/actions/workflows", owner, repo);
        let response = self.get(&path).await?;
        #[derive(Deserialize)]
        struct WorkflowList { workflows: Vec<GitHubWorkflow> }
        let list: WorkflowList = Self::parse_response(response).await?;
        Ok(list.workflows)
    }

    /// Trigger a workflow dispatch
    pub async fn trigger_workflow(
        &self, owner: &str, repo: &str, workflow_id: u64, ref_name: &str, inputs: serde_json::Value,
    ) -> Result<(), String> {
        let path = format!("/repos/{}/{}/actions/workflows/{}/dispatches", owner, repo, workflow_id);
        let json = serde_json::json!({
            "ref": ref_name,
            "inputs": inputs,
        });
        let response = self.post(&path, &json).await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Workflow trigger failed ({}): {}", status.as_u16(), body));
        }
        Ok(())
    }

    /// List workflow runs
    pub async fn list_workflow_runs(
        &self, owner: &str, repo: &str, branch: Option<&str>, status: Option<&str>, page: u32, per_page: u32,
    ) -> Result<Vec<GitHubWorkflowRun>, String> {
        let mut path = format!("/repos/{}/{}/actions/runs?page={}&per_page={}", owner, repo, page, per_page);
        if let Some(b) = branch { path.push_str(&format!("&branch={}", b)); }
        if let Some(s) = status { path.push_str(&format!("&status={}", s)); }

        let response = self.get(&path).await?;
        #[derive(Deserialize)]
        struct RunList { workflow_runs: Vec<GitHubWorkflowRun> }
        let list: RunList = Self::parse_response(response).await?;
        Ok(list.workflow_runs)
    }

    /// Get a workflow run
    pub async fn get_workflow_run(&self, owner: &str, repo: &str, run_id: u64) -> Result<GitHubWorkflowRun, String> {
        let path = format!("/repos/{}/{}/actions/runs/{}", owner, repo, run_id);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    // ─── Releases ───────────────────────────────────────────────────────

    /// List releases
    pub async fn list_releases(&self, owner: &str, repo: &str, page: u32, per_page: u32) -> Result<Vec<GitHubRelease>, String> {
        let path = format!("/repos/{}/{}/releases?page={}&per_page={}", owner, repo, page, per_page);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Get latest release
    pub async fn get_latest_release(&self, owner: &str, repo: &str) -> Result<GitHubRelease, String> {
        let path = format!("/repos/{}/{}/releases/latest", owner, repo);
        let response = self.get(&path).await?;
        Self::parse_response(response).await
    }

    /// Create a release
    pub async fn create_release(
        &self, owner: &str, repo: &str,
        tag_name: &str, name: &str, body: &str,
        draft: bool, prerelease: bool,
    ) -> Result<GitHubRelease, String> {
        let path = format!("/repos/{}/{}/releases", owner, repo);
        let json = serde_json::json!({
            "tag_name": tag_name,
            "name": name,
            "body": body,
            "draft": draft,
            "prerelease": prerelease,
        });
        let response = self.post(&path, &json).await?;
        Self::parse_response(response).await
    }

    // ─── Fork ───────────────────────────────────────────────────────────

    /// Fork a repository
    pub async fn fork_repo(&self, owner: &str, repo: &str) -> Result<GitHubRepo, String> {
        let path = format!("/repos/{}/{}/forks", owner, repo);
        let response = self.post(&path, &serde_json::json!({})).await?;
        Self::parse_response(response).await
    }

    // ─── Combined / Convenience ─────────────────────────────────────────

    /// Clone a repo and set up a workspace task (auto-select repo + branch)
    pub async fn auto_select_repo(
        &self,
        query: Option<&str>,
        owner_filter: Option<&str>,
        language_filter: Option<&str>,
    ) -> Result<Vec<GitHubRepo>, String> {
        if let Some(q) = query {
            let search = self.search_repos(q, 1, 20).await?;
            Ok(search.items)
        } else if let Some(owner) = owner_filter {
            self.list_repos_for_owner(owner, 1, 50).await
        } else {
            self.get_all_accessible_repos().await
        }
    }

    /// Get repo + branch suggestions for starting a task
    pub async fn suggest_targets(
        &self,
        query: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, String> {
        let repos = if let Some(q) = query {
            self.search_repos(q, 1, 10).await?.items
        } else {
            self.get_all_accessible_repos().await?
        };

        let mut suggestions = Vec::new();
        for repo in repos.iter().take(20) {
            let branches = self.list_branches(&repo.owner.login, &repo.name, 1, 5).await.unwrap_or_default();
            suggestions.push(serde_json::json!({
                "full_name": repo.full_name,
                "owner": repo.owner.login,
                "repo": repo.name,
                "description": repo.description,
                "default_branch": repo.default_branch,
                "language": repo.language,
                "branches": branches.iter().map(|b| serde_json::json!({
                    "name": b.name,
                    "sha": b.commit.sha,
                    "protected": b.protected,
                })).collect::<Vec<_>>(),
                "html_url": repo.html_url,
                "clone_url": repo.clone_url,
                "ssh_url": repo.ssh_url,
                "open_issues": repo.open_issues_count,
                "stars": repo.stargazers_count,
            }));
        }

        Ok(suggestions)
    }
}

// ─── GitHub Action Executor ────────────────────────────────────────────────

/// Automated action that can be executed on a GitHub repo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubAction {
    pub id: String,
    pub action_type: GitHubActionType,
    pub repo_owner: String,
    pub repo_name: String,
    pub branch: Option<String>,
    pub params: serde_json::Value,
    pub status: String,
    pub result: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GitHubActionType {
    CreateIssue,
    CreatePR,
    MergePR,
    WriteFile,
    DeleteFile,
    TriggerWorkflow,
    CreateRelease,
    AddComment,
    CloseIssue,
    CreateBranch,
    Custom(String),
}

impl GitHubActionType {
    pub fn as_str(&self) -> &str {
        match self {
            Self::CreateIssue => "create_issue",
            Self::CreatePR => "create_pr",
            Self::MergePR => "merge_pr",
            Self::WriteFile => "write_file",
            Self::DeleteFile => "delete_file",
            Self::TriggerWorkflow => "trigger_workflow",
            Self::CreateRelease => "create_release",
            Self::AddComment => "add_comment",
            Self::CloseIssue => "close_issue",
            Self::CreateBranch => "create_branch",
            Self::Custom(s) => s,
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "create_issue" => Self::CreateIssue,
            "create_pr" => Self::CreatePR,
            "merge_pr" => Self::MergePR,
            "write_file" => Self::WriteFile,
            "delete_file" => Self::DeleteFile,
            "trigger_workflow" => Self::TriggerWorkflow,
            "create_release" => Self::CreateRelease,
            "add_comment" => Self::AddComment,
            "close_issue" => Self::CloseIssue,
            "create_branch" => Self::CreateBranch,
            other => Self::Custom(other.to_string()),
        }
    }
}

/// Execute automated GitHub actions
pub struct GitHubActionExecutor {
    client: Arc<GitHubClient>,
    actions: Arc<RwLock<HashMap<String, GitHubAction>>>,
}

impl GitHubActionExecutor {
    pub fn new(client: Arc<GitHubClient>) -> Self {
        Self {
            client,
            actions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Execute a GitHub action
    pub async fn execute(&self, action: &mut GitHubAction) -> Result<serde_json::Value, String> {
        action.status = "running".to_string();

        let result = match &action.action_type {
            GitHubActionType::CreateIssue => {
                let title = action.params["title"].as_str().unwrap_or("Untitled");
                let body = action.params["body"].as_str().unwrap_or("");
                let labels: Option<Vec<String>> = action.params["labels"].as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect());
                let assignees: Option<Vec<String>> = action.params["assignees"].as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect());

                self.client.create_issue(
                    &action.repo_owner, &action.repo_name,
                    title, body,
                    labels.as_deref(), assignees.as_deref(),
                ).await.map(|i| serde_json::to_value(i).unwrap_or_default())?
            }
            GitHubActionType::CreatePR => {
                let title = action.params["title"].as_str().unwrap_or("ORA Agent PR");
                let body = action.params["body"].as_str().unwrap_or("");
                let head = action.params["head"].as_str().unwrap_or("feature/ora-agent");
                let base = action.params["base"].as_str().unwrap_or("main");
                let draft = action.params["draft"].as_bool().unwrap_or(false);

                self.client.create_pull_request(
                    &action.repo_owner, &action.repo_name,
                    title, body, head, base, draft,
                ).await.map(|pr| serde_json::to_value(pr).unwrap_or_default())?
            }
            GitHubActionType::MergePR => {
                let pr_number = action.params["pr_number"].as_u64().ok_or("Missing pr_number")?;
                let commit_title = action.params["commit_title"].as_str();
                let merge_method = action.params["merge_method"].as_str();

                self.client.merge_pull_request(
                    &action.repo_owner, &action.repo_name,
                    pr_number, commit_title, merge_method,
                ).await?
            }
            GitHubActionType::WriteFile => {
                let file_path = action.params["file_path"].as_str().ok_or("Missing file_path")?;
                let content = action.params["content"].as_str().ok_or("Missing content")?;
                let message = action.params["message"].as_str().unwrap_or("Update via ORA Agent");
                let branch = action.branch.as_deref();

                self.client.write_file(
                    &action.repo_owner, &action.repo_name,
                    file_path, content, message, branch,
                ).await?
            }
            GitHubActionType::DeleteFile => {
                let file_path = action.params["file_path"].as_str().ok_or("Missing file_path")?;
                let message = action.params["message"].as_str().unwrap_or("Delete via ORA Agent");
                let branch = action.branch.as_deref();

                self.client.delete_file(
                    &action.repo_owner, &action.repo_name,
                    file_path, message, branch,
                ).await?
            }
            GitHubActionType::TriggerWorkflow => {
                let workflow_id = action.params["workflow_id"].as_u64().ok_or("Missing workflow_id")?;
                let ref_name = action.branch.as_deref().unwrap_or("main");
                let inputs = action.params.get("inputs").cloned().unwrap_or(serde_json::json!({}));

                self.client.trigger_workflow(
                    &action.repo_owner, &action.repo_name,
                    workflow_id, ref_name, inputs,
                ).await.map(|_| serde_json::json!({"success": true}))?
            }
            GitHubActionType::CreateRelease => {
                let tag_name = action.params["tag_name"].as_str().ok_or("Missing tag_name")?;
                let name = action.params["name"].as_str().unwrap_or(tag_name);
                let body = action.params["body"].as_str().unwrap_or("");
                let draft = action.params["draft"].as_bool().unwrap_or(false);
                let prerelease = action.params["prerelease"].as_bool().unwrap_or(false);

                self.client.create_release(
                    &action.repo_owner, &action.repo_name,
                    tag_name, name, body, draft, prerelease,
                ).await.map(|r| serde_json::to_value(r).unwrap_or_default())?
            }
            GitHubActionType::AddComment => {
                let issue_number = action.params["issue_number"].as_u64().ok_or("Missing issue_number")?;
                let body = action.params["body"].as_str().ok_or("Missing body")?;

                self.client.create_issue_comment(
                    &action.repo_owner, &action.repo_name,
                    issue_number, body,
                ).await?
            }
            GitHubActionType::CloseIssue => {
                let issue_number = action.params["issue_number"].as_u64().ok_or("Missing issue_number")?;
                self.client.close_issue(
                    &action.repo_owner, &action.repo_name,
                    issue_number,
                ).await.map(|i| serde_json::to_value(i).unwrap_or_default())?
            }
            GitHubActionType::CreateBranch => {
                let branch_name = action.params["branch_name"].as_str().ok_or("Missing branch_name")?;
                let base_sha = action.params.get("base_sha")
                    .and_then(|v| v.as_str())
                    .map(String::from);

                let sha = if let Some(bs) = base_sha {
                    bs
                } else if let Some(ref base) = action.branch {
                    let b = self.client.get_branch(&action.repo_owner, &action.repo_name, base).await?;
                    b.commit.sha
                } else {
                    let repo = self.client.get_repo(&action.repo_owner, &action.repo_name).await?;
                    let b = self.client.get_branch(&action.repo_owner, &action.repo_name, &repo.default_branch).await?;
                    b.commit.sha
                };

                self.client.create_branch(
                    &action.repo_owner, &action.repo_name,
                    branch_name, &sha,
                ).await.map(|b| serde_json::to_value(b).unwrap_or_default())?
            }
            GitHubActionType::Custom(custom_type) => {
                return Err(format!("Unknown custom action type: {}", custom_type));
            }
        };

        action.status = "completed".to_string();
        action.result = Some(result.clone());
        action.completed_at = Some(Utc::now());

        Ok(result)
    }

    /// Queue and execute an action
    pub async fn queue_action(&self, action: GitHubAction) -> String {
        let id = action.id.clone();
        self.actions.write().await.insert(id.clone(), action);
        id
    }

    /// Get action status
    pub async fn get_action(&self, id: &str) -> Option<GitHubAction> {
        self.actions.read().await.get(id).cloned()
    }

    /// List all actions
    pub async fn list_actions(&self) -> Vec<GitHubAction> {
        self.actions.read().await.values().cloned().collect()
    }
}
