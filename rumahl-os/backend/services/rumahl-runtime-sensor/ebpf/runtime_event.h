/* SPDX-License-Identifier: GPL-2.0
 * Shared wire format between the observation-only eBPF capture program
 * (runtime.bpf.c) and the userspace ring-buffer consumer (loader.c).
 *
 * Field order and types are ABI: the kernel program reserves exactly this
 * layout and the loader serializes it. Keep in sync with
 * rumahl-runtime-sensor/src/event.rs (KernelEvent JSON contract).
 */
#ifndef RUMAHL_RUNTIME_EVENT_H
#define RUMAHL_RUNTIME_EVENT_H

#include <linux/types.h>

#define EVENT_START 1
#define EVENT_EXEC 2
#define EVENT_EXIT 3
#define EVENT_CONNECT_ATTEMPT 4
#define EVENT_CONNECT_RESULT 5

struct runtime_event {
	__u64 monotonic_ns, process_start_time_ns, cgroup_id, network_namespace, socket_cookie;
	__u32 event_type, pid, ppid, uid, gid, exec_generation;
	__s32 result_errno;
	__u16 address_family, local_port, remote_port;
	__u8 protocol, local_address[16], remote_address[16];
	char command_name[16], executable[256];
};

#endif /* RUMAHL_RUNTIME_EVENT_H */
