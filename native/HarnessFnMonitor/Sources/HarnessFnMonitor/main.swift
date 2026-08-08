import ApplicationServices
import AppKit
import Darwin
import Foundation

/// kVK_Function — labeled Fn / Globe on Apple keyboards
private let kVK_Function: Int64 = 63

private var gFnPressed = false
private var gEventTap: CFMachPort?

private func emitLine(phase: String, ms: Int64) {
  let obj: [String: Any] = ["t": "fn", "phase": phase, "ms": ms]
  guard let data = try? JSONSerialization.data(withJSONObject: obj),
        let line = String(data: data, encoding: .utf8)
  else {
    return
  }
  fputs(line + "\n", stdout)
  fflush(stdout)
}

/// Called from CGEventTap — must remain a top-level function for C callback bridging.
func harnessCgEventCallback(
  proxy: CGEventTapProxy,
  type: CGEventType,
  event: CGEvent,
  refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let tap = gEventTap {
      CGEvent.tapEnable(tap: tap, enable: true)
    }
    return Unmanaged.passUnretained(event)
  }

  guard type == .flagsChanged else { return Unmanaged.passUnretained(event) }

  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  guard keyCode == kVK_Function else { return Unmanaged.passUnretained(event) }

  let flags = event.flags
  // Globe: CGEvent `maskSecondaryFn`. Some layouts expose Fn via AppKit-style `.function` bits.
  let nsCompat = NSEvent.ModifierFlags(rawValue: UInt(event.flags.rawValue))
  let fnDown =
    flags.contains(.maskSecondaryFn) || nsCompat.intersection(.deviceIndependentFlagsMask).contains(.function)

  let ms = Int64(Date().timeIntervalSince1970 * 1000)
  if fnDown && !gFnPressed {
    gFnPressed = true
    emitLine(phase: "down", ms: ms)
  } else if !fnDown && gFnPressed {
    gFnPressed = false
    emitLine(phase: "up", ms: ms)
  }
  return Unmanaged.passUnretained(event)
}

@main
enum Main {
  static func main() {
    // Prompt once for *this* executable (the helper) if not already trusted.
    if !AXIsProcessTrustedWithOptions(nil) {
      let promptOpts: [String: Any] = [
        kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true,
      ]
      _ = AXIsProcessTrustedWithOptions(promptOpts as CFDictionary)
    }

    let flagsMask = 1 << CGEventType.flagsChanged.rawValue
    guard let eventTap = CGEvent.tapCreate(
      tap: .cgSessionEventTap,
      place: .headInsertEventTap,
      options: .defaultTap,
      eventsOfInterest: CGEventMask(flagsMask),
      callback: harnessCgEventCallback,
      userInfo: nil
    ) else {
      fputs(
        "HarnessFnMonitor: CGEvent.tapCreate failed — enable Accessibility for Harness (and HarnessFnMonitor if listed separately), then restart the app.\n",
        stderr
      )
      exit(1)
    }

    gEventTap = eventTap
    let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
    CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
    CGEvent.tapEnable(tap: eventTap, enable: true)
    CFRunLoopRun()
  }
}
