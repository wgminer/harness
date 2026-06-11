import AVFoundation

@MainActor
final class RecordingPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published private(set) var playingRecordingId: String?

    private var player: AVAudioPlayer?

    func toggle(_ recording: VoiceRecording) {
        if playingRecordingId == recording.id {
            stop()
            return
        }
        stop()
        do {
            let audioPlayer = try AVAudioPlayer(contentsOf: recording.url)
            audioPlayer.delegate = self
            audioPlayer.play()
            player = audioPlayer
            playingRecordingId = recording.id
        } catch {
            stop()
        }
    }

    func stop() {
        player?.stop()
        player = nil
        playingRecordingId = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            if self.player === player {
                stop()
            }
        }
    }
}
