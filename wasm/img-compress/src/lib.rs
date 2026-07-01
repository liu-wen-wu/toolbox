use wasm_bindgen::prelude::*;
use image::load_from_memory;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::webp::WebPEncoder;
use image::GenericImageView;

/// Compress image as JPEG with given quality and optional resize.
/// quality: 1-100 (higher = better quality, larger file)
/// If max_width or max_height is 0, no resizing is done.
#[wasm_bindgen]
pub fn compress_jpeg(input: &[u8], quality: u8, max_width: u32, max_height: u32) -> Result<Vec<u8>, String> {
    let img = load_from_memory(input).map_err(|e| format!("解码失败: {}", e))?;
    let img = maybe_resize(&img, max_width, max_height);
    let mut output = Vec::new();
    let quality = quality.clamp(1, 100);
    let encoder = JpegEncoder::new_with_quality(&mut output, quality);
    img.write_with_encoder(encoder).map_err(|e| format!("JPEG编码失败: {}", e))?;
    Ok(output)
}

/// Compress image as PNG (lossless, best compression).
/// If max_width or max_height is 0, no resizing is done.
#[wasm_bindgen]
pub fn compress_png(input: &[u8], max_width: u32, max_height: u32) -> Result<Vec<u8>, String> {
    let img = load_from_memory(input).map_err(|e| format!("解码失败: {}", e))?;
    let img = maybe_resize(&img, max_width, max_height);
    let mut output = Vec::new();
    let encoder = PngEncoder::new(&mut output);
    img.write_with_encoder(encoder).map_err(|e| format!("PNG编码失败: {}", e))?;
    Ok(output)
}

/// Compress image as WebP with given quality and optional resize.
/// quality: 1-100 (higher = better quality, larger file)
/// If max_width or max_height is 0, no resizing is done.
#[wasm_bindgen]
pub fn compress_webp(input: &[u8], quality: u8, max_width: u32, max_height: u32) -> Result<Vec<u8>, String> {
    let img = load_from_memory(input).map_err(|e| format!("解码失败: {}", e))?;
    let img = maybe_resize(&img, max_width, max_height);
    let mut output = Vec::new();
    let encoder = WebPEncoder::new_lossy(&mut output, quality as f32);
    img.write_with_encoder(encoder).map_err(|e| format!("WebP编码失败: {}", e))?;
    Ok(output)
}

/// Get image basic info: width, height, format
/// Returns JSON string: {"width":W,"height":H,"format":"jpeg|png|gif|webp|bmp"}
#[wasm_bindgen]
pub fn image_info(input: &[u8]) -> Result<String, String> {
    let img = load_from_memory(input).map_err(|e| format!("解码失败: {}", e))?;
    let (w, h) = img.dimensions();
    let fmt = match input {
        d if d.starts_with(&[0xFF, 0xD8]) => "jpeg",
        d if d.starts_with(&[0x89, 0x50, 0x4E, 0x47]) => "png",
        d if d.starts_with(&[0x47, 0x49, 0x46]) => "gif",
        d if d.len() > 12 && &d[0..4] == b"RIFF" && &d[8..12] == b"WEBP" => "webp",
        d if d.starts_with(&[0x42, 0x4D]) => "bmp",
        _ => "unknown",
    };
    Ok(format!(r#"{{"width":{},"height":{},"format":"{}"}}"#, w, h, fmt))
}

fn maybe_resize(img: &image::DynamicImage, max_w: u32, max_h: u32) -> image::DynamicImage {
    let (w, h) = img.dimensions();
    if max_w == 0 && max_h == 0 {
        return img.clone();
    }
    // Calculate new dimensions preserving aspect ratio
    let target_w = if max_w > 0 { max_w } else { w };
    let target_h = if max_h > 0 { max_h } else { h };
    if w <= target_w && h <= target_h {
        return img.clone();
    }
    let ratio = ((target_w as f64) / (w as f64)).min((target_h as f64) / (h as f64));
    let new_w = (w as f64 * ratio).round() as u32;
    let new_h = (h as f64 * ratio).round() as u32;
    // Use Lanczos3 filter for best quality downscaling
    img.resize_exact(new_w.max(1), new_h.max(1), image::imageops::FilterType::Lanczos3)
}
