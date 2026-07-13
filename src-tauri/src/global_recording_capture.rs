//! Native microphone capture for global Fn dictation (macOS cpal).

use std::sync::{Arc, Mutex};

pub const TARGET_SAMPLE_RATE: u32 = 44100;
pub const SILENT_AUDIO_PEAK_THRESHOLD: f32 = 0.0001;

pub const NO_AUDIO_CAPTURED_MESSAGE: &str =
    "No audio captured. Click in Harness once to enable the microphone, then try Fn again.";

pub struct NativeCapture {
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    stream: Option<cpal::Stream>,
}

pub fn peak_amplitude(samples: &[f32]) -> f32 {
    samples.iter().map(|s| s.abs()).fold(0.0_f32, f32::max)
}

pub fn is_silent_audio(samples: &[f32]) -> bool {
    samples.is_empty() || peak_amplitude(samples) < SILENT_AUDIO_PEAK_THRESHOLD
}

pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let data_bytes = samples.len() * 2;
    let mut buf = vec![0_u8; 44 + data_bytes];

    fn write_str(dst: &mut [u8], s: &str) {
        for (i, b) in s.bytes().enumerate() {
            dst[i] = b;
        }
    }

    write_str(&mut buf[0..4], "RIFF");
    buf[4..8].copy_from_slice(&(36_u32 + data_bytes as u32).to_le_bytes());
    write_str(&mut buf[8..12], "WAVE");
    write_str(&mut buf[12..16], "fmt ");
    buf[16..20].copy_from_slice(&16_u32.to_le_bytes());
    buf[20..22].copy_from_slice(&1_u16.to_le_bytes());
    buf[22..24].copy_from_slice(&1_u16.to_le_bytes());
    buf[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    buf[28..32].copy_from_slice(&(sample_rate * 2).to_le_bytes());
    buf[32..34].copy_from_slice(&2_u16.to_le_bytes());
    buf[34..36].copy_from_slice(&16_u16.to_le_bytes());
    write_str(&mut buf[36..40], "data");
    buf[40..44].copy_from_slice(&(data_bytes as u32).to_le_bytes());

    let mut off = 44;
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let int_sample = if clamped < 0.0 {
            (clamped * 32768.0) as i16
        } else {
            (clamped * 32767.0) as i16
        };
        buf[off..off + 2].copy_from_slice(&int_sample.to_le_bytes());
        off += 2;
    }
    buf
}

fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let out_len = ((samples.len() as u64) * (to_rate as u64) / (from_rate as u64)) as usize;
    let mut out = Vec::with_capacity(out_len.max(1));
    for i in 0..out_len {
        let src_pos = (i as f64) * (from_rate as f64) / (to_rate as f64);
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = samples.get(idx).copied().unwrap_or(0.0);
        let b = samples.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

impl NativeCapture {
    pub fn start() -> Result<Self, String> {
        if !cfg!(target_os = "macos") {
            return Err("Native capture is only available on macOS.".into());
        }

        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No microphone input device found.".to_string())?;

        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get microphone config: {e}"))?;

        let sample_rate = config.sample_rate();
        let channels = config.channels() as usize;
        let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
        let samples_cb = samples.clone();

        let err_fn = |err: cpal::Error| stream_error_callback(err);
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                let stream_config: cpal::StreamConfig = config.clone().into();
                device.build_input_stream(
                    stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        append_samples(&samples_cb, data, channels);
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let stream_config: cpal::StreamConfig = config.clone().into();
                device.build_input_stream(
                    stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let floats: Vec<f32> =
                            data.iter().map(|&s| s as f32 / 32768.0).collect();
                        append_samples(&samples_cb, &floats, channels);
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let stream_config: cpal::StreamConfig = config.clone().into();
                device.build_input_stream(
                    stream_config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        let floats: Vec<f32> = data
                            .iter()
                            .map(|&s| (s as f32 - 32768.0) / 32768.0)
                            .collect();
                        append_samples(&samples_cb, &floats, channels);
                    },
                    err_fn,
                    None,
                )
            }
            other => return Err(format!("Unsupported microphone sample format: {other:?}")),
        }
        .map_err(|e| format!("Failed to open microphone: {e}"))?;

        stream
            .play()
            .map_err(|e| format!("Failed to start microphone capture: {e}"))?;

        eprintln!(
            "[Harness:recording] native capture started ({sample_rate} Hz, {channels} ch)"
        );

        Ok(Self {
            samples,
            sample_rate,
            stream: Some(stream),
        })
    }

    pub fn stop(mut self) -> Result<Vec<u8>, String> {
        self.stream = None;
        let samples = self.samples.lock().map_err(|e| e.to_string())?.clone();
        let peak = peak_amplitude(&samples);
        eprintln!(
            "[Harness:recording] capture stopped ({} samples, peak {peak:.6})",
            samples.len()
        );
        if is_silent_audio(&samples) {
            return Err(NO_AUDIO_CAPTURED_MESSAGE.into());
        }
        let mono = if self.sample_rate == TARGET_SAMPLE_RATE {
            samples
        } else {
            resample_linear(&samples, self.sample_rate, TARGET_SAMPLE_RATE)
        };
        Ok(encode_wav(&mono, TARGET_SAMPLE_RATE))
    }

    pub fn cancel(mut self) {
        self.stream = None;
        eprintln!("[Harness:recording] capture cancelled");
    }
}

fn append_samples(samples: &Arc<Mutex<Vec<f32>>>, data: &[f32], channels: usize) {
    let Ok(mut buf) = samples.lock() else {
        return;
    };
    if channels <= 1 {
        buf.extend_from_slice(data);
        return;
    }
    for frame in data.chunks(channels) {
        let sum: f32 = frame.iter().sum();
        buf.push(sum / channels as f32);
    }
}

fn stream_error_callback(err: cpal::Error) {
    eprintln!("[Harness:recording] capture stream error: {err}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_detection() {
        assert!(is_silent_audio(&[]));
        assert!(is_silent_audio(&[0.0, 0.00001, -0.00001]));
        assert!(!is_silent_audio(&[0.001]));
    }

    #[test]
    fn wav_header_length() {
        let wav = encode_wav(&[0.0, 0.5, -0.5], TARGET_SAMPLE_RATE);
        assert_eq!(wav.len(), 44 + 3 * 2);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
    }

    #[test]
    fn resample_preserves_non_empty() {
        let samples = vec![0.0, 1.0, 0.0, -1.0];
        let out = resample_linear(&samples, 48000, 44100);
        assert!(!out.is_empty());
    }
}
