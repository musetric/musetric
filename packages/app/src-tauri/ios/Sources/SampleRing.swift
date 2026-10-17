import AVFoundation
import os

final class SampleRing {
  private let capacity: Int
  private let samples: UnsafeMutablePointer<Float>
  private let lock: UnsafeMutablePointer<os_unfair_lock>
  private let tickSeconds: Double
  private var written = 0
  private var consumed = 0
  private var expectedSeconds = -1.0

  init(capacity: Int) {
    self.capacity = capacity
    samples = UnsafeMutablePointer<Float>.allocate(capacity: capacity)
    samples.initialize(repeating: 0, count: capacity)
    lock = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1)
    lock.initialize(to: os_unfair_lock())
    var timebase = mach_timebase_info_data_t()
    mach_timebase_info(&timebase)
    tickSeconds = Double(timebase.numer) / Double(timebase.denom) / 1_000_000_000
  }

  deinit {
    samples.deallocate()
    lock.deallocate()
  }

  func reset() {
    os_unfair_lock_lock(lock)
    written = 0
    consumed = 0
    expectedSeconds = -1
    os_unfair_lock_unlock(lock)
  }

  func write(
    _ list: UnsafePointer<AudioBufferList>, frameCount: Int, timestamp: AudioTimeStamp,
    rate: Double
  ) {
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: list))
    guard frameCount > 0, let data = buffers.first?.mData?.assumingMemoryBound(to: Float.self)
    else {
      return
    }
    os_unfair_lock_lock(lock)
    if timestamp.mFlags.contains(.hostTimeValid) {
      let seconds = Double(timestamp.mHostTime) * tickSeconds
      if expectedSeconds >= 0 {
        let gap = Int(((seconds - expectedSeconds) * rate).rounded())
        if gap > frameCount / 2 {
          append(nil, count: min(gap, capacity / 2))
        }
      }
      expectedSeconds = seconds + Double(frameCount) / rate
    }
    append(data, count: frameCount)
    os_unfair_lock_unlock(lock)
  }

  func read(into target: UnsafeMutablePointer<Float>, limit: Int) -> (count: Int, skipped: Int) {
    os_unfair_lock_lock(lock)
    defer { os_unfair_lock_unlock(lock) }
    var skipped = 0
    if written - consumed > capacity {
      skipped = written - consumed - capacity
      consumed += skipped
    }
    let count = min(limit, written - consumed)
    for offset in 0..<count {
      target[offset] = samples[(consumed + offset) & (capacity - 1)]
    }
    consumed += count
    return (count, skipped)
  }

  private func append(_ data: UnsafePointer<Float>?, count: Int) {
    for offset in 0..<count {
      samples[(written + offset) & (capacity - 1)] = data?[offset] ?? 0
    }
    written += count
  }
}
