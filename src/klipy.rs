//! Klipy GIF API integration
//!
//! Provides GIF search and retrieval via the Klipy API.
//! API Docs: https://docs.klipy.co/guide/gif/overview.html

#![allow(dead_code)]

use anyhow::Result;
use serde::{Deserialize, Serialize};

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
        // Klipy API: api/v1/{app_key}/gifs/search?q={query}&per_page={limit}
        let url = format!("{}/api/v1/{}/gifs/search", KLIPY_API_BASE, self.app_key);

        let response = self
            .client
            .get(&url)
            .query(&[("q", query), ("per_page", &limit.to_string())])
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            return Err(anyhow::anyhow!("Klipy API error: {} - {}", status, body));
        }

        // Try to parse the response
        let result: Result<KlipySearchResponse, _> = serde_json::from_str(&body);
        match result {
            Ok(parsed) => {
                let gifs: Vec<Gif> = parsed
                    .data
                    .into_iter()
                    .filter(|item| item.r#type == "gif")
                    .map(|item| Gif {
                        id: item.id,
                        title: item.title,
                        url: item.original_url,
                        preview_url: item.preview_url,
                        media_formats: None,
                    })
                    .collect();
                Ok(gifs)
            }
            Err(e) => {
                tracing::error!("Failed to parse Klipy response: {}. Body: {}", e, body);
                Err(anyhow::anyhow!(
                    "Failed to parse Klipy response. Error: {}",
                    e
                ))
            }
        }
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

        let result: Result<KlipySearchResponse, _> = serde_json::from_str(&body);
        match result {
            Ok(parsed) => {
                let gifs: Vec<Gif> = parsed
                    .data
                    .into_iter()
                    .filter(|item| item.r#type == "gif")
                    .map(|item| Gif {
                        id: item.id,
                        title: item.title,
                        url: item.original_url,
                        preview_url: item.preview_url,
                        media_formats: None,
                    })
                    .collect();
                Ok(gifs)
            }
            Err(e) => {
                tracing::error!("Failed to parse Klipy response: {}. Body: {}", e, body);
                Err(anyhow::anyhow!(
                    "Failed to parse Klipy response. Error: {}",
                    e
                ))
            }
        }
    }
}

/// Klipy API search response
#[derive(Debug, Clone, Serialize, Deserialize)]
struct KlipySearchResponse {
    /// List of items (GIFs, ads, etc.)
    data: Vec<KlipyItem>,
}

/// An item from Klipy API response
#[derive(Debug, Clone, Serialize, Deserialize)]
struct KlipyItem {
    /// Type (gif, ad, etc.)
    r#type: String,
    /// Item ID
    id: String,
    /// Title
    title: Option<String>,
    /// Slug
    slug: Option<String>,
    /// Original URL
    original_url: Option<String>,
    /// Preview URL
    preview_url: Option<String>,
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
