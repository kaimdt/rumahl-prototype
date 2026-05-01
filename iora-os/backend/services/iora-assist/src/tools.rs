use sqlx::Row;
// Tool Execution Framework for ORA AI
// Provides internet search, web scraping, and other external tool integrations

use headless_chrome::{Browser, LaunchOptions, Tab};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ToolType {
    Search,
    WebScrape,
    Screenshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRequest {
    pub tool_type: ToolType,
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub data: serde_json::Value,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebPage {
    pub url: String,
    pub title: String,
    pub content: String,
    pub screenshot: Option<String>, // Base64 encoded
}

pub struct ToolExecutor {
    browser: Option<Arc<Browser>>,
}

impl ToolExecutor {
    pub fn new() -> Self {
        Self { browser: None }
    }

    /// Initialize headless Chrome browser
    pub fn init_browser(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let options = LaunchOptions::default_builder()
            .headless(true)
            .build()
            .map_err(|e| format!("Failed to build launch options: {}", e))?;

        let browser = Browser::new(options)
            .map_err(|e| format!("Failed to launch browser: {}", e))?;

        self.browser = Some(Arc::new(browser));
        tracing::info!("Headless Chrome browser initialized");
        Ok(())
    }

    /// Execute a tool request
    pub async fn execute(&self, request: ToolRequest) -> ToolResult {
        match request.tool_type {
            ToolType::Search => self.search(request.params).await,
            ToolType::WebScrape => self.scrape_web(request.params).await,
            ToolType::Screenshot => self.take_screenshot(request.params).await,
        }
    }

    /// Search the internet using DuckDuckGo
    async fn search(&self, params: serde_json::Value) -> ToolResult {
        let query = match params.get("query").and_then(|q| q.as_str()) {
            Some(q) => q,
            None => {
                return ToolResult {
                    success: false,
                    data: serde_json::json!({}),
                    error: Some("Missing query parameter".to_string()),
                };
            }
        };

        let max_results = params
            .get("max_results")
            .and_then(|m| m.as_u64())
            .unwrap_or(5) as usize;

        // Use DuckDuckGo HTML search (no API key required)
        let search_url = format!(
            "https://html.duckduckgo.com/html/?q={}",
            urlencoding::encode(query)
        );

        match self.fetch_and_parse(&search_url).await {
            Ok(page) => {
                let results = self.parse_duckduckgo_results(&page.content, max_results);
                ToolResult {
                    success: true,
                    data: serde_json::json!({
                        "query": query,
                        "results": results,
                    }),
                    error: None,
                }
            }
            Err(e) => ToolResult {
                success: false,
                data: serde_json::json!({}),
                error: Some(format!("Search failed: {}", e)),
            },
        }
    }

    /// Scrape a web page
    async fn scrape_web(&self, params: serde_json::Value) -> ToolResult {
        let url = match params.get("url").and_then(|u| u.as_str()) {
            Some(u) => u,
            None => {
                return ToolResult {
                    success: false,
                    data: serde_json::json!({}),
                    error: Some("Missing url parameter".to_string()),
                };
            }
        };

        let include_screenshot = params
            .get("screenshot")
            .and_then(|s| s.as_bool())
            .unwrap_or(false);

        match self.fetch_and_parse_with_chrome(url, include_screenshot).await {
            Ok(page) => ToolResult {
                success: true,
                data: serde_json::to_value(&page).unwrap_or_default(),
                error: None,
            },
            Err(e) => ToolResult {
                success: false,
                data: serde_json::json!({}),
                error: Some(format!("Web scraping failed: {}", e)),
            },
        }
    }

    /// Take a screenshot of a web page
    async fn take_screenshot(&self, params: serde_json::Value) -> ToolResult {
        let url = match params.get("url").and_then(|u| u.as_str()) {
            Some(u) => u,
            None => {
                return ToolResult {
                    success: false,
                    data: serde_json::json!({}),
                    error: Some("Missing url parameter".to_string()),
                };
            }
        };

        match self.capture_screenshot(url).await {
            Ok(screenshot_base64) => ToolResult {
                success: true,
                data: serde_json::json!({
                    "url": url,
                    "screenshot": screenshot_base64,
                }),
                error: None,
            },
            Err(e) => ToolResult {
                success: false,
                data: serde_json::json!({}),
                error: Some(format!("Screenshot failed: {}", e)),
            },
        }
    }

    /// Fetch and parse a web page using reqwest (simple HTTP fetch)
    async fn fetch_and_parse(
        &self,
        url: &str,
    ) -> Result<WebPage, Box<dyn std::error::Error + Send + Sync>> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (compatible; ORA-AI-Bot/1.0)")
            .build()?;

        let response = client.get(url).send().await?;
        let html = response.text().await?;

        let document = Html::parse_document(&html);
        let title = document
            .select(&Selector::parse("title").unwrap())
            .next()
            .map(|el| el.inner_html())
            .unwrap_or_else(|| "Untitled".to_string());

        // Extract readable text content. Strategy:
        //  1. Strip well-known boilerplate elements (script/style/nav/header/footer/aside/form/iframe).
        //  2. Prefer the first <article> / <main> if present (these usually contain the
        //     primary content on modern sites).
        //  3. Fall back to a body-wide selection of headings, paragraphs and list items.
        //  4. Drop blank lines and lines shorter than 2 chars.
        let content = extract_readable_text(&document);

        Ok(WebPage {
            url: url.to_string(),
            title,
            content: content.trim().to_string(),
            screenshot: None,
        })
    }

    /// Fetch and parse a web page using headless Chrome
    async fn fetch_and_parse_with_chrome(
        &self,
        url: &str,
        include_screenshot: bool,
    ) -> Result<WebPage, Box<dyn std::error::Error + Send + Sync>> {
        let browser = self
            .browser
            .as_ref()
            .ok_or("Browser not initialized")?
            .clone();

        let url = url.to_string(); // Convert to owned String
        let handle = tokio::task::spawn_blocking(move || -> Result<WebPage, String> {
            let tab = browser.new_tab().map_err(|e| e.to_string())?;

            tab.navigate_to(&url).map_err(|e| e.to_string())?;
            tab.wait_until_navigated().map_err(|e| e.to_string())?;

            // Wait for content to load
            std::thread::sleep(Duration::from_secs(2));

            let title = tab
                .get_title()
                .unwrap_or_else(|_| "Untitled".to_string());

            let content = tab
                .get_content()
                .map_err(|e| e.to_string())?;

            // Parse HTML to extract text content using the same readability heuristic.
            let document = Html::parse_document(&content);
            let text_content = extract_readable_text(&document);

            let screenshot = if include_screenshot {
                tab.capture_screenshot(
                    headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption::Png,
                    None,
                    None,
                    true,
                )
                .ok()
                .map(|data| base64::encode(&data))
            } else {
                None
            };

            Ok(WebPage {
                url: url.to_string(),
                title,
                content: text_content.trim().to_string(),
                screenshot,
            })
        });

        handle
            .await
            .map_err(|e| format!("Task join error: {}", e))?
            .map_err(|e| e.into())
    }

    /// Capture a screenshot of a URL
    async fn capture_screenshot(
        &self,
        url: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let browser = self
            .browser
            .as_ref()
            .ok_or("Browser not initialized")?
            .clone();

        let url = url.to_string();
        let handle = tokio::task::spawn_blocking(move || -> Result<String, String> {
            let tab = browser.new_tab().map_err(|e| e.to_string())?;

            tab.navigate_to(&url).map_err(|e| e.to_string())?;
            tab.wait_until_navigated().map_err(|e| e.to_string())?;

            // Wait for page to render
            std::thread::sleep(Duration::from_secs(2));

            let screenshot_data = tab
                .capture_screenshot(
                    headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption::Png,
                    None,
                    None,
                    true,
                )
                .map_err(|e| e.to_string())?;

            Ok(base64::encode(&screenshot_data))
        });

        handle
            .await
            .map_err(|e| format!("Task join error: {}", e))?
            .map_err(|e| e.into())
    }

    /// Parse DuckDuckGo HTML search results
    fn parse_duckduckgo_results(&self, html: &str, max_results: usize) -> Vec<SearchResult> {
        let document = Html::parse_document(html);
        let mut results = Vec::new();

        // DuckDuckGo HTML result selectors
        if let Ok(result_selector) = Selector::parse(".result") {
            for element in document.select(&result_selector).take(max_results) {
                let title = element
                    .select(&Selector::parse(".result__title").unwrap())
                    .next()
                    .map(|el| el.text().collect::<Vec<_>>().join(""))
                    .unwrap_or_default();

                let url = element
                    .select(&Selector::parse(".result__url").unwrap())
                    .next()
                    .map(|el| el.text().collect::<Vec<_>>().join(""))
                    .unwrap_or_default();

                let snippet = element
                    .select(&Selector::parse(".result__snippet").unwrap())
                    .next()
                    .map(|el| el.text().collect::<Vec<_>>().join(""))
                    .unwrap_or_default();

                if !title.is_empty() && !url.is_empty() {
                    results.push(SearchResult {
                        title: title.trim().to_string(),
                        url: url.trim().to_string(),
                        snippet: snippet.trim().to_string(),
                    });
                }
            }
        }

        results
    }
}

impl Default for ToolExecutor {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract readable text from a parsed HTML document, stripping boilerplate
/// (scripts, navigation, footers, etc.) and preferring `<article>` / `<main>`
/// when present. This is a lightweight, dependency-free implementation of the
/// readability pattern: it does not score nodes by content-density, but it
/// reliably removes the most common boilerplate and works well for most blog
/// posts, news articles and documentation pages.
fn extract_readable_text(document: &Html) -> String {
    use std::collections::HashSet;

    // Tags whose textual content should always be discarded.
    let blacklist: HashSet<&str> = [
        "script", "style", "noscript", "template", "iframe", "form", "svg",
        "header", "footer", "nav", "aside",
    ]
    .into_iter()
    .collect();

    // Try to find the primary content container first.
    let primary_selectors = [
        "article", "main", "[role=main]", "[itemprop=articleBody]",
    ];
    let mut root_html: Option<String> = None;
    for sel in &primary_selectors {
        if let Ok(selector) = Selector::parse(sel) {
            if let Some(el) = document.select(&selector).next() {
                root_html = Some(el.html());
                break;
            }
        }
    }

    let scope_doc = root_html
        .as_deref()
        .map(Html::parse_fragment)
        .unwrap_or_else(|| Html::parse_document(&document.root_element().html()));

    // Within the chosen scope, iterate over content-bearing elements while
    // filtering out anything inside a blacklisted ancestor.
    let content_selector = match Selector::parse("h1, h2, h3, h4, p, li, blockquote, pre") {
        Ok(s) => s,
        Err(_) => return String::new(),
    };

    let mut buf = String::new();
    for el in scope_doc.select(&content_selector) {
        // Skip if any ancestor is blacklisted.
        let mut skip = false;
        for ancestor in el.ancestors().filter_map(scraper::ElementRef::wrap) {
            let name = ancestor.value().name();
            if blacklist.contains(name) {
                skip = true;
                break;
            }
        }
        if skip { continue; }

        let text: String = el.text().collect::<Vec<_>>().join(" ");
        let trimmed = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if trimmed.len() < 2 {
            continue;
        }
        buf.push_str(&trimmed);
        buf.push('\n');
    }

    buf.trim().to_string()
}
