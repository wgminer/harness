//! Deterministic placeholder PNGs for `HARNESS_STUB_IMAGES` runs.

pub(super) fn crc32_ieee(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            let mask = if crc & 1 != 0 { 0xffff_ffff } else { 0 };
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

pub(super) fn png_chunk(tag: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + data.len());
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(tag);
    out.extend_from_slice(data);
    let mut crc_data = Vec::with_capacity(4 + data.len());
    crc_data.extend_from_slice(tag);
    crc_data.extend_from_slice(data);
    out.extend_from_slice(&crc32_ieee(&crc_data).to_be_bytes());
    out
}

/// Deterministic stub PNG (solid color from prompt) for branch-logic testing without OpenAI.
pub fn stub_image_png(prompt: &str, kind: &str) -> Vec<u8> {
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::hash::{Hash, Hasher};
    use std::io::Write;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    prompt.hash(&mut hasher);
    kind.hash(&mut hasher);
    let h = hasher.finish();
    let r = ((h >> 16) & 0xff) as u8;
    let g = ((h >> 8) & 0xff) as u8;
    let b = (h & 0xff) as u8;
    // Keep channels away from pure black so the stage isn't empty-looking.
    let (r, g, b) = (r.max(40), g.max(40), b.max(40));

    const W: u32 = 64;
    const H: u32 = 64;
    let mut raw = Vec::with_capacity(((W * 3 + 1) * H) as usize);
    for row in 0..H {
        raw.push(0); // filter None
        for col in 0..W {
            // Light band so successive stubs are visually distinct even if hues collide.
            let band = if row < 8 { 40u8.wrapping_mul((col % 7) as u8) } else { 0 };
            raw.push(r.wrapping_add(band));
            raw.push(g.wrapping_add(band / 2));
            raw.push(b.wrapping_add((kind.len() as u8).wrapping_mul(3)));
        }
    }
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(&raw).expect("stub png zlib write");
    let compressed = encoder.finish().expect("stub png zlib finish");

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&W.to_be_bytes());
    ihdr.extend_from_slice(&H.to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]); // 8-bit RGB

    let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    png.extend(png_chunk(b"IHDR", &ihdr));
    png.extend(png_chunk(b"IDAT", &compressed));
    png.extend(png_chunk(b"IEND", &[]));
    png
}
