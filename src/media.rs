//! Media support for OpenWire
//!
//! Provides image handling capabilities:
//! - Image loading and display
//! - ASCII art fallback for terminals without image support
//! - Image metadata extraction

#![allow(dead_code)]

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Supported image formats
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Gif,
    Bmp,
    WebP,
}

impl ImageFormat {
    /// Detect format from file extension
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "gif" => Some(Self::Gif),
            "bmp" => Some(Self::Bmp),
            "webp" => Some(Self::WebP),
            _ => None,
        }
    }

    /// Get MIME type
    pub fn mime_type(&self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Bmp => "image/bmp",
            Self::WebP => "image/webp",
        }
    }
}

/// Image metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageMeta {
    /// Original filename
    pub filename: String,
    /// Image format
    pub format: ImageFormat,
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// File size in bytes
    pub size: usize,
}

/// An image message for transfer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageMessage {
    /// Image metadata
    pub meta: ImageMeta,
    /// Image data (encoded in original format)
    pub data: Vec<u8>,
    /// Sender's public key for signature verification
    pub sender_public_key: Vec<u8>,
    /// Timestamp
    pub timestamp: u64,
    /// Signature over metadata + data
    pub signature: Vec<u8>,
}

impl ImageMessage {
    /// Create a new image message
    pub fn new(
        identity: &crate::crypto::Identity,
        filename: String,
        format: ImageFormat,
        data: Vec<u8>,
    ) -> Result<Self> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        // Get dimensions (we'll estimate if image crate isn't available)
        let (width, height) = estimate_dimensions(&data, &format);

        let meta = ImageMeta {
            filename,
            format,
            width,
            height,
            size: data.len(),
        };

        // Sign: filename || format || size || timestamp || data
        let mut sign_data = Vec::new();
        sign_data.extend_from_slice(meta.filename.as_bytes());
        sign_data.extend_from_slice(&[meta.format as u8]);
        sign_data.extend_from_slice(&meta.size.to_le_bytes());
        sign_data.extend_from_slice(&timestamp.to_le_bytes());
        sign_data.extend_from_slice(&data);

        let signature = identity.sign(&sign_data)?;

        Ok(Self {
            meta,
            data,
            sender_public_key: identity.public_key().to_vec(),
            timestamp,
            signature: signature.to_bytes().to_vec(),
        })
    }

    /// Verify the image signature
    pub fn verify(&self) -> Result<()> {
        if self.sender_public_key.len() != 32 {
            return Err(anyhow::anyhow!("Invalid sender public key length"));
        }

        let mut pub_key_bytes = [0u8; 32];
        pub_key_bytes.copy_from_slice(&self.sender_public_key);

        if self.signature.len() != 64 {
            return Err(anyhow::anyhow!("Invalid signature length"));
        }

        let mut sig_bytes = [0u8; 64];
        sig_bytes.copy_from_slice(&self.signature);

        let mut sign_data = Vec::new();
        sign_data.extend_from_slice(self.meta.filename.as_bytes());
        sign_data.extend_from_slice(&[self.meta.format as u8]);
        sign_data.extend_from_slice(&self.meta.size.to_le_bytes());
        sign_data.extend_from_slice(&self.timestamp.to_le_bytes());
        sign_data.extend_from_slice(&self.data);

        crate::crypto::verify_with_key(
            &sign_data,
            &ed25519_dalek::Signature::from_bytes(&sig_bytes),
            &pub_key_bytes,
        )
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        Ok(serde_json::from_slice(data)?)
    }
}

/// Estimate image dimensions without decoding
/// This is a simple heuristic based on file size and format
fn estimate_dimensions(data: &[u8], format: &ImageFormat) -> (u32, u32) {
    // Try to parse basic image headers
    match format {
        ImageFormat::Png => parse_png_dimensions(data),
        ImageFormat::Jpeg => parse_jpeg_dimensions(data),
        ImageFormat::Gif => parse_gif_dimensions(data),
        _ => {
            // Fallback: estimate based on file size
            let pixels = (data.len() as f64 * 0.3) as u32;
            let side = (pixels as f64).sqrt() as u32;
            (side, side)
        }
    }
}

/// Parse PNG dimensions from header
fn parse_png_dimensions(data: &[u8]) -> (u32, u32) {
    if data.len() < 24 {
        return (100, 100);
    }
    // PNG IHDR is at bytes 16-24 after signature
    let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
    let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
    (width, height)
}

/// Parse JPEG dimensions (simplified)
fn parse_jpeg_dimensions(data: &[u8]) -> (u32, u32) {
    // Simplified JPEG parsing - just estimate
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return (100, 100);
    }
    // Look for SOF markers (0xFFC0, 0xFFC2, etc.)
    for i in 0..data.len().saturating_sub(9) {
        if data[i] == 0xFF && (data[i + 1] & 0xF0) == 0xC0 && (data[i + 1] & 0x0F) != 0 {
            let height = u16::from_be_bytes([data[i + 5], data[i + 6]]) as u32;
            let width = u16::from_be_bytes([data[i + 7], data[i + 8]]) as u32;
            if width > 0 && height > 0 {
                return (width, height);
            }
        }
    }
    (100, 100)
}

/// Parse GIF dimensions from header
fn parse_gif_dimensions(data: &[u8]) -> (u32, u32) {
    if data.len() < 10 {
        return (100, 100);
    }
    // GIF dimensions are at bytes 6-9 (little-endian)
    let width = u16::from_le_bytes([data[6], data[7]]) as u32;
    let height = u16::from_le_bytes([data[8], data[9]]) as u32;
    (width, height)
}

/// Generate ASCII art from image data (simple block-based)
pub fn generate_ascii_art(width: u32, height: u32, _data: &[u8]) -> String {
    // Simple placeholder ASCII art
    let chars = ['█', '▓', '▒', '░', ' '];
    let mut result = String::new();

    // Create a simple frame
    let display_width = (width as usize / 8).clamp(10, 40);
    let display_height = (height as usize / 16).clamp(5, 20);

    result.push('┌');
    for _ in 0..display_width {
        result.push('─');
    }
    result.push_str("┐\n");

    for y in 0..display_height {
        result.push('│');
        for x in 0..display_width {
            // Create a gradient pattern for visual effect
            let idx = (x + y) % chars.len();
            result.push(chars[idx]);
        }
        result.push_str("│\n");
    }

    result.push('└');
    for _ in 0..display_width {
        result.push('─');
    }
    result.push('┘');

    result
}

#[cfg(feature = "image-support")]
pub mod image_support {
    use super::*;
    use image::{DynamicImage, ImageReader};
    use ratatui_image::picker::Picker;
    use std::io::Cursor;

    /// Load an image from bytes
    pub fn load_image(data: &[u8]) -> Result<DynamicImage> {
        let reader = ImageReader::new(Cursor::new(data)).with_guessed_format()?;
        Ok(reader.decode()?)
    }

    /// Get actual image dimensions
    pub fn get_dimensions(data: &[u8]) -> Result<(u32, u32)> {
        let img = load_image(data)?;
        Ok((img.width(), img.height()))
    }

    /// Create a picker for the terminal
    pub fn create_picker() -> Result<Picker> {
        let mut picker = Picker::from_termios().map_err(|e| anyhow::anyhow!("{e}"))?;
        picker.guess_protocol();
        Ok(picker)
    }

    /// Check if the terminal supports image display
    pub fn supports_images() -> bool {
        Picker::from_termios().is_ok()
    }
}

#[cfg(not(feature = "image-support"))]
pub mod image_support {
    use super::*;

    /// Load an image from bytes (stub)
    pub fn load_image(_data: &[u8]) -> Result<()> {
        Err(anyhow::anyhow!(
            "Image support not compiled in. Rebuild with --features image-support"
        ))
    }

    /// Get actual image dimensions (stub)
    pub fn get_dimensions(_data: &[u8]) -> Result<(u32, u32)> {
        Err(anyhow::anyhow!("Image support not available"))
    }

    /// Create a picker for the terminal (stub)
    pub fn create_picker() -> Result<()> {
        Err(anyhow::anyhow!("Image support not available"))
    }

    /// Check if the terminal supports image display (stub)
    pub fn supports_images() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_format_detection() {
        assert_eq!(ImageFormat::from_extension("png"), Some(ImageFormat::Png));
        assert_eq!(ImageFormat::from_extension("jpg"), Some(ImageFormat::Jpeg));
        assert_eq!(ImageFormat::from_extension("gif"), Some(ImageFormat::Gif));
        assert_eq!(ImageFormat::from_extension("unknown"), None);
    }

    #[test]
    fn test_mime_types() {
        assert_eq!(ImageFormat::Png.mime_type(), "image/png");
        assert_eq!(ImageFormat::Jpeg.mime_type(), "image/jpeg");
    }

    #[test]
    fn test_ascii_art_generation() {
        let art = generate_ascii_art(100, 100, &[]);
        assert!(art.contains('┌'));
        assert!(art.contains('└'));
    }
}
