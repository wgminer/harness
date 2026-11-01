//! Voice PE microphone over the ESPHome API. The firmware's "Mic stream"
//! switch starts its voice assistant component, which asks the client to begin
//! and then sends 16 kHz mono 16-bit audio as `VoiceAssistantAudio` messages.
//! Harness answers as a bare recorder: no pipeline, no reply audio.

use esphome_client::error::ClientError;
use esphome_client::types::{SubscribeVoiceAssistantRequest, SwitchCommandRequest};
use esphome_client::EspHomeClientWriteStream;

pub(super) const SAMPLE_RATE: u32 = 16_000;
/// `VOICE_ASSISTANT_SUBSCRIBE_API_AUDIO`: audio over the API rather than UDP.
const SUBSCRIBE_API_AUDIO: u32 = 1;

pub(super) async fn start(
    writer: &EspHomeClientWriteStream,
    switch_key: u32,
) -> Result<(), ClientError> {
    writer
        .try_write(SubscribeVoiceAssistantRequest {
            subscribe: true,
            flags: SUBSCRIBE_API_AUDIO,
        })
        .await?;
    writer
        .try_write(SwitchCommandRequest {
            key: switch_key,
            state: true,
            ..Default::default()
        })
        .await
}

/// Unsubscribes too, so another computer can take the mic.
pub(super) async fn stop(
    writer: &EspHomeClientWriteStream,
    switch_key: u32,
) -> Result<(), ClientError> {
    writer
        .try_write(SwitchCommandRequest {
            key: switch_key,
            state: false,
            ..Default::default()
        })
        .await?;
    writer
        .try_write(SubscribeVoiceAssistantRequest {
            subscribe: false,
            flags: 0,
        })
        .await
}

/// Little-endian 16-bit PCM to samples in -1..1. A trailing odd byte is dropped.
pub(super) fn decode_pcm16(data: &[u8]) -> Vec<f32> {
    data.chunks_exact(2)
        .map(|b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 32768.0)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_little_endian_pcm() {
        let samples = decode_pcm16(&[0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x01]);
        assert_eq!(samples.len(), 3);
        assert_eq!(samples[0], 0.0);
        assert!((samples[1] - 1.0).abs() < 0.001);
        assert_eq!(samples[2], -1.0);
    }
}
