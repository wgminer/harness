//! Native recording cues (start / stop / done / cancel), synthesized and played via cpal.
//!
//! Played from Rust so cues are not delayed when the webview is backgrounded or throttled.
//! Each cue runs on its own short-lived thread and never blocks the caller.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Chime {
    Start,
    Stop,
    Done,
    Cancel,
}

impl Chime {
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "start" => Some(Self::Start),
            "stop" => Some(Self::Stop),
            "done" => Some(Self::Done),
            "cancel" => Some(Self::Cancel),
            _ => None,
        }
    }

    /// (frequency Hz, duration seconds) pairs, played back to back.
    fn notes(self) -> &'static [(f32, f32)] {
        match self {
            Self::Start => &[(660.0, 0.08), (880.0, 0.12)],
            Self::Stop => &[(550.0, 0.08), (440.0, 0.15)],
            Self::Done => &[(784.0, 0.07), (988.0, 0.07), (1319.0, 0.16)],
            Self::Cancel => &[(330.0, 0.06), (220.0, 0.18)],
        }
    }
}

const PEAK_GAIN: f32 = 0.18;
/// Short fade-in so each note starts without a click.
const ATTACK_SECS: f32 = 0.005;
/// Exponential decay floor, matching the old Web Audio ramp to 0.001.
const DECAY_FLOOR: f32 = 0.001;

/// Render a cue as mono f32 samples at `sample_rate`.
pub fn render(chime: Chime, sample_rate: u32) -> Vec<f32> {
    let sr = sample_rate as f32;
    let mut out = Vec::new();
    for &(freq, dur) in chime.notes() {
        let n = (dur * sr) as usize;
        let attack = ((ATTACK_SECS * sr) as usize).max(1);
        for i in 0..n {
            let t = i as f32 / sr;
            let decay = PEAK_GAIN * (DECAY_FLOOR / PEAK_GAIN).powf(t / dur);
            let ramp = (i as f32 / attack as f32).min(1.0);
            out.push((2.0 * std::f32::consts::PI * freq * t).sin() * decay * ramp);
        }
    }
    out
}

/// Play a cue on the default output device without blocking.
pub fn play(chime: Chime) {
    let spawned = std::thread::Builder::new()
        .name("harness-chime".into())
        .spawn(move || {
            if let Err(err) = play_blocking(chime) {
                eprintln!("[Harness:recording] chime {chime:?} failed: {err}");
            }
        });
    if let Err(err) = spawned {
        eprintln!("[Harness:recording] chime thread failed: {err}");
    }
}

/// Play a cue and return once it has finished.
pub fn play_blocking(chime: Chime) -> Result<(), String> {
    if crate::env_util::is_harness_e2e() {
        return Ok(());
    }
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "no output device".to_string())?;
    let config = device
        .default_output_config()
        .map_err(|e| format!("output config: {e}"))?;
    let sample_rate = config.sample_rate();
    let channels = config.channels() as usize;
    let samples = Arc::new(render(chime, sample_rate));
    let total = samples.len();
    let cursor = Arc::new(AtomicUsize::new(0));
    let stream_config: cpal::StreamConfig = config.clone().into();
    let err_fn = |err: cpal::Error| eprintln!("[Harness:recording] chime stream error: {err}");

    macro_rules! build {
        ($t:ty, $convert:expr) => {{
            let samples = samples.clone();
            let cursor = cursor.clone();
            device.build_output_stream(
                stream_config,
                move |data: &mut [$t], _: &cpal::OutputCallbackInfo| {
                    for frame in data.chunks_mut(channels) {
                        let i = cursor.fetch_add(1, Ordering::Relaxed);
                        let s = samples.get(i).copied().unwrap_or(0.0);
                        let v: $t = $convert(s);
                        frame.fill(v);
                    }
                },
                err_fn,
                None,
            )
        }};
    }

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => build!(f32, |s: f32| s),
        cpal::SampleFormat::I16 => build!(i16, |s: f32| (s * 32767.0) as i16),
        cpal::SampleFormat::U16 => build!(u16, |s: f32| ((s * 32767.0) + 32768.0) as u16),
        other => return Err(format!("unsupported output format {other:?}")),
    }
    .map_err(|e| format!("open output: {e}"))?;

    stream.play().map_err(|e| format!("start output: {e}"))?;
    let duration = Duration::from_secs_f32(total as f32 / sample_rate as f32);
    // Tail pad lets the device drain its buffer before the stream drops.
    std::thread::sleep(duration + Duration::from_millis(80));
    drop(stream);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_kinds() {
        assert_eq!(Chime::parse("start"), Some(Chime::Start));
        assert_eq!(Chime::parse("done"), Some(Chime::Done));
        assert_eq!(Chime::parse("nope"), None);
    }

    #[test]
    fn render_length_and_bounds() {
        let samples = render(Chime::Start, 48000);
        assert_eq!(samples.len(), (0.08 * 48000.0) as usize + (0.12 * 48000.0) as usize);
        assert!(samples.iter().all(|s| s.abs() <= PEAK_GAIN));
        // Fade-in: first sample is silent.
        assert_eq!(samples[0], 0.0);
    }
}
