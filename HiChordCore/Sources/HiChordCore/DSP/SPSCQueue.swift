internal import CHiChordAtomics

/// A wait-free single-producer / single-consumer ring buffer for trivially copyable values.
///
/// Used to pass commands from the UI thread to the audio thread (and events back) without
/// locks or allocation on the real-time thread.
public final class SPSCQueue<Element> {
    private let capacity: Int
    private let storage: UnsafeMutablePointer<Element>
    private let head: UnsafeMutablePointer<Int64> // next slot to write (producer)
    private let tail: UnsafeMutablePointer<Int64> // next slot to read (consumer)

    public init(capacity: Int) {
        precondition(_isPOD(Element.self), "SPSCQueue only supports trivially copyable elements")
        self.capacity = capacity
        storage = .allocate(capacity: capacity)
        head = .allocate(capacity: 1)
        tail = .allocate(capacity: 1)
        head.initialize(to: 0)
        tail.initialize(to: 0)
    }

    deinit {
        storage.deallocate()
        head.deallocate()
        tail.deallocate()
    }

    /// Producer side. Returns false if the queue is full.
    @discardableResult
    public func push(_ value: Element) -> Bool {
        let h = head.pointee // only the producer writes head
        let t = hc_load_acquire(tail)
        if h - t >= Int64(capacity) { return false }
        (storage + Int(h % Int64(capacity))).initialize(to: value)
        hc_store_release(head, h + 1)
        return true
    }

    /// Consumer side.
    public func pop() -> Element? {
        let t = tail.pointee // only the consumer writes tail
        let h = hc_load_acquire(head)
        if t >= h { return nil }
        let value = (storage + Int(t % Int64(capacity))).move()
        hc_store_release(tail, t + 1)
        return value
    }

    public var isEmpty: Bool { hc_load_acquire(tail) >= hc_load_acquire(head) }
}
