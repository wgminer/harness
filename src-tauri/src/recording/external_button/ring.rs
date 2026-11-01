//! Voice PE LED ring: what it shows for each recording phase, and the task that
//! keeps it in step for one connection.

use std::time::Duration;

use esphome_client::types::LightCommandRequest;
use esphome_client::EspHomeClientWriteStream;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

/// Effect name from the firmware's `led_ring` light.
const PULSE: &str = "Pulse";
/// Steps of red brightness while recording; more would only add light commands.
pub(super) const LEVEL_STEPS: u8 = 8;
/// How long the green success flash stays before the ring goes back to ready.
pub(super) const SUCCESS_FLASH: Duration = Duration::from_millis(700);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Ring {
    Off,
    Ready,
    /// `level` is 0..=LEVEL_STEPS, following the voice.
    Recording {
        level: u8,
    },
    Processing,
    Success,
}

/// Applies a phase change. The return to ready after a take waits out the
/// success flash, which goes back to ready on its own.
pub(super) fn set_phase(current: &mut Ring, next: Ring) -> bool {
    if *current == next || (*current == Ring::Success && next == Ring::Ready) {
        return false;
    }
    *current = next;
    true
}

/// Applies a voice level, which only matters while recording.
pub(super) fn set_level(current: &mut Ring, peak: f32) -> bool {
    let Ring::Recording { level } = current else {
        return false;
    };
    let next = level_step(peak);
    if *level == next {
        return false;
    }
    *level = next;
    true
}

/// Square root so quiet speech still moves the ring; normal speech peaks
/// around 0.1 to 0.4 and reaches the top steps.
fn level_step(peak: f32) -> u8 {
    let scaled = peak.max(0.0).sqrt() * 1.6 * f32::from(LEVEL_STEPS);
    scaled.round().min(f32::from(LEVEL_STEPS)) as u8
}

/// Sends the ring's look whenever it changes, until the connection ends. When
/// the button is switched off in Settings the ring is left dark.
pub(super) async fn drive(
    writer: EspHomeClientWriteStream,
    key: u32,
    mut ring: watch::Receiver<Ring>,
    cancel: CancellationToken,
    ended: CancellationToken,
) {
    loop {
        let look = *ring.borrow_and_update();
        if writer.try_write(command(key, look)).await.is_err() {
            return;
        }
        tokio::select! {
            // Checked first because the connection ends at the same moment.
            biased;
            _ = cancel.cancelled() => {
                let _ = writer.try_write(command(key, Ring::Off)).await;
                return;
            }
            _ = ended.cancelled() => return,
            changed = ring.changed() => {
                if changed.is_err() {
                    return;
                }
            }
        }
    }
}

pub(super) fn command(key: u32, ring: Ring) -> LightCommandRequest {
    let ([red, green, blue], brightness, effect) = match ring {
        Ring::Off => {
            return LightCommandRequest {
                key,
                has_state: true,
                state: false,
                ..Default::default()
            }
        }
        Ring::Ready => ([1.0, 1.0, 1.0], 0.15, "None"),
        Ring::Recording { level } => (
            [1.0, 0.0, 0.0],
            0.2 + 0.8 * f32::from(level) / f32::from(LEVEL_STEPS),
            "None",
        ),
        Ring::Processing => ([1.0, 0.7, 0.0], 0.7, PULSE),
        Ring::Success => ([0.0, 1.0, 0.1], 0.9, "None"),
    };
    LightCommandRequest {
        key,
        has_state: true,
        state: true,
        has_brightness: true,
        brightness,
        has_rgb: true,
        red,
        green,
        blue,
        has_effect: true,
        effect: effect.to_string(),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_only_sets_state() {
        let off = command(7, Ring::Off);
        assert!(off.has_state && !off.state);
        assert!(!off.has_rgb && !off.has_effect);
    }

    #[test]
    fn pulses_only_while_processing() {
        assert_eq!(command(7, Ring::Processing).effect, PULSE);
        assert_eq!(command(7, Ring::Recording { level: 3 }).effect, "None");
        assert_eq!(command(7, Ring::Ready).effect, "None");
    }

    #[test]
    fn louder_voice_is_brighter_red() {
        let quiet = command(7, Ring::Recording { level: 0 });
        let loud = command(7, Ring::Recording { level: LEVEL_STEPS });
        assert!(loud.brightness > quiet.brightness);
        assert!((loud.brightness - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn level_steps_are_clamped() {
        assert_eq!(level_step(0.0), 0);
        assert_eq!(level_step(1.0), LEVEL_STEPS);
        assert!(level_step(0.05) > 0);
    }

    #[test]
    fn level_is_ignored_unless_recording() {
        let mut ring = Ring::Processing;
        assert!(!set_level(&mut ring, 0.5));
        let mut ring = Ring::Recording { level: 0 };
        assert!(set_level(&mut ring, 0.5));
        assert!(!set_level(&mut ring, 0.5));
    }

    #[test]
    fn success_flash_is_not_cut_short_by_ready() {
        let mut ring = Ring::Success;
        assert!(!set_phase(&mut ring, Ring::Ready));
        assert!(set_phase(&mut ring, Ring::Recording { level: 0 }));
    }
}
