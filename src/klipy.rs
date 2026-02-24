//! Klipy GIF API integration
//!
//! Provides GIF search and retrieval via the Klipy API.

#![allow(dead_code)]

use anyhow::Result;
use serde::{Deserialize, Serialize};

const KLIPY_API_BASE: &str = "https://api.klipy.com/v1";

/// Klipy API client
pub struct KlipyClient {
    api_key: String,
    client: reqwest::Client,
}

impl KlipyClient {
    /// Create a new Klipy client
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
        }
    }

    /// Search for GIFs
    pub async fn search(&self, query: &str, limit: u32) -> Result<Vec<Gif>> {
        let url = format!("{}/gifs/search", KLIPY_API_BASE);

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .query(&[("q", query), ("limit", &limit.to_string())])
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Klipy API error: {} - {}", status, body));
        }

        let result: SearchResponse = response.json().await?;
        Ok(result.data)
    }

    /// Get trending GIFs
    pub async fn trending(&self, limit: u32) -> Result<Vec<Gif>> {
        let url = format!("{}/gifs/trending", KLIPY_API_BASE);

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .query(&[("limit", &limit.to_string())])
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Klipy API error: {} - {}", status, body));
        }

        let result: SearchResponse = response.json().await?;
        Ok(result.data)
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
    /// Media formats
    pub media_formats: Option<MediaFormats>,
}

impl Gif {
    /// Get the best URL for sharing
    pub fn share_url(&self) -> Option<&str> {
        self.media_formats
            .as_ref()
            .and_then(|m| m.gif.as_ref())
            .map(|g| g.url.as_str())
            .or(self.url.as_deref())
    }

    /// Get the preview URL
    pub fn preview_url(&self) -> Option<&str> {
        self.media_formats
            .as_ref()
            .and_then(|m| m.preview.as_ref())
            .map(|g| g.url.as_str())
            .or(self.preview_url.as_deref())
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

/// Search API response
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchResponse {
    /// List of GIFs
    data: Vec<Gif>,
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
