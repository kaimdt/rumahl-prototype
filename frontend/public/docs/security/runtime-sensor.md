# Runtime Sensor 2.1

Runtime Sensor 2.1b is the read-only beginning of Runtime Protection. It emits versioned `ora.runtime.v2` events with boot and sensor generations, PID-reuse-safe process instances, separate fork/exec/exit events, asynchronous executable identity enrichment, and correlated connection attempt/result telemetry. App attribution remains explicitly `unknown` when it cannot be established. Queue loss, critical-event drops, and source disconnection are exposed through health and metrics. All enforcement continues through the existing Security Foundation path.
