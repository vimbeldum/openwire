//! Klipy GIF API integration
//!
//! Provides GIF search and retrieval via the Klipy API.
//! API Docs: https://docs.klipy.com/guide/gif/overview.html

#![allow(dead_code)]

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const KLIPY_API_BASE: &str = "https://api.klipy.com";

/// Klipy API client
pub struct KlipyClient {
    app_key: String,
    client: reqwest::Client,
}

impl KlipyClient {
    /// Create a new Klipy client
    pub fn new(app_key: String) -> Self {
        Self {
            app_key,
            client: reqwest::Client::new(),
        }
    }

    /// Search for GIFs
    pub async fn search(&self, query: &str, limit: u32) -> Result<Vec<Gif>> {
        // Klipy API: api/v1/{app_key}/gifs/search?q={query}&per_page={limit}&customer_id=...
        let url = format!("{}/api/v1/{}/gifs/search", KLIPY_API_BASE, self.app_key);
        let per_page = limit.max(8); // Klipy minimum is 8

        let response = self
            .client
            .get(&url)
            .query(&[
                ("q", query),
                ("per_page", &per_page.to_string()),
                ("customer_id", "openwire-default"),
                ("format_filter", "gif"),
            ])
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            return Err(anyhow::anyhow!("Klipy API error: {} - {}", status, body));
        }

        self.parse_response(&body)
    }

    /// Get trending GIFs
    pub async fn trending(&self, limit: u32) -> Result<Vec<Gif>> {
        let url = format!("{}/api/v1/{}/gifs/trending", KLIPY_API_BASE, self.app_key);

        let response = self
            .client
            .get(&url)
            .query(&[("per_page", &limit.to_string())])
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            return Err(anyhow::anyhow!("Klipy API error: {} - {}", status, body));
        }

        self.parse_response(&body)
    }

    /// Parse Klipy API response - handles all known formats
    fn parse_response(&self, body: &str) -> Result<Vec<Gif>> {
        tracing::debug!("Klipy raw response: {}", &body[..body.len().min(500)]);

        let json: Value = serde_json::from_str(body).map_err(|e| {
            tracing::error!("Failed to parse Klipy JSON: {}. Body: {}", e, body);
            anyhow::anyhow!("Failed to parse Klipy JSON: {}", e)
        })?;

        // Try to find the array of items — Klipy uses different response formats:
        // 1. {"data": [...]}                          — array of items
        // 2. {"data": {"items": [...]}}               — nested items array
        // 3. {"data": {"results": [...]}}             — nested results array
        // 4. {"results": [...]}                       — top-level results
        // 5. Top-level array [...]                    — bare array

        let items_array = json.get("data")
            .and_then(|d| {
                if d.is_array() {
                    Some(d)
                } else if d.is_object() {
                    // Try nested arrays: items, results, gifs
                    d.get("items")
                        .or_else(|| d.get("results"))
                        .or_else(|| d.get("gifs"))
                        .filter(|v| v.is_array())
                }
                else { None }
            })
            .or_else(|| json.get("results").filter(|v| v.is_array()))
            .or_else(|| json.get("items").filter(|v| v.is_array()))
            .or_else(|| if json.is_array() { Some(&json) } else { None });

        let gifs: Vec<Gif> = if let Some(arr) = items_array {
            // Parse from a JSON array
            arr.as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|v| {
                    // Skip ads
                    if v.get("type").and_then(|t| t.as_str()) == Some("ad") {
                        return None;
                    }
                    let id = v.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let title = v.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
                    // Try multiple URL field names
                    let url = v.get("original_url")
                        .or_else(|| v.get("url"))
                        .or_else(|| v.get("itemurl"))
                        .or_else(|| v.get("content_url"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let preview_url = v.get("preview_url")
                        .or_else(|| v.get("preview"))
                        .or_else(|| v.get("thumbnail"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    if id.is_empty() && url.is_none() {
                        return None;
                    }
                    Some(Gif { id, title, url, preview_url, media_formats: None })
                })
                .collect()
        } else if let Some(data) = json.get("data").filter(|d| d.is_object()) {
            // Handle map format: {"data": {"id1": {...}, "id2": {...}}}
            data.as_object()
                .unwrap()
                .values()
                .filter_map(|v| {
                    if !v.is_object() { return None; }
                    let id = v.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let title = v.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let url = v.get("original_url")
                        .or_else(|| v.get("url"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let preview_url = v.get("preview_url")
                        .or_else(|| v.get("preview"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    Some(Gif { id, title, url, preview_url, media_formats: None })
                })
                .collect()
        } else {
            tracing::error!("Unrecognized Klipy response format: {}", &body[..body.len().min(200)]);
            return Err(anyhow::anyhow!(
                "Failed to parse Klipy response. Unrecognized format."
            ));
        };

        Ok(gifs)
    }
}

/// A GIF from Klipy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gif {
    /// GIF ID
    pub id: String,
    /// GIF title
    pub title: Option<String>,
    /// Original URL
    pub url: Option<String>,
    /// Preview/small URL
    pub preview_url: Option<String>,
    /// Media formats (for future use)
    pub media_formats: Option<MediaFormats>,
}

impl Gif {
    /// Get the best URL for sharing
    pub fn share_url(&self) -> Option<&str> {
        self.url.as_deref()
    }

    /// Get the preview URL
    pub fn preview_url(&self) -> Option<&str> {
        self.preview_url.as_deref()
    }
}

/// Media format variants
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaFormats {
    /// Full GIF
    pub gif: Option<MediaFormat>,
    /// Preview/thumbnail
    pub preview: Option<MediaFormat>,
    /// Small version
    pub tiny: Option<MediaFormat>,
}

/// A specific media format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaFormat {
    /// URL to the media
    pub url: String,
    /// Dimensions
    pub dims: Option<Vec<u32>>,
    /// File size in bytes
    pub size: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gif_url_extraction() {
        let gif = Gif {
            id: "test123".to_string(),
            title: Some("Test GIF".to_string()),
            url: Some("https://example.com/test.gif".to_string()),
            preview_url: Some("https://example.com/test-preview.gif".to_string()),
            media_formats: None,
        };

        assert_eq!(gif.share_url(), Some("https://example.com/test.gif"));
        assert_eq!(
            gif.preview_url(),
            Some("https://example.com/test-preview.gif")
        );
    }
}
