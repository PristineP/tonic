#ifndef HC_ATOMICS_H
#define HC_ATOMICS_H

#include <stdint.h>

/// Minimal acquire/release atomics for the lock-free single-producer/single-consumer
/// queues that connect the UI thread with the real-time audio thread.

static inline int64_t hc_load_acquire(const int64_t *p) {
    return __atomic_load_n(p, __ATOMIC_ACQUIRE);
}

static inline void hc_store_release(int64_t *p, int64_t v) {
    __atomic_store_n(p, v, __ATOMIC_RELEASE);
}

#endif
