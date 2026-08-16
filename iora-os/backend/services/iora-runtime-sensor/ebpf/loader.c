// SPDX-License-Identifier: GPL-2.0
/*
 * iora-runtime-sensor-ebpf-loader — observation-only CO-RE loader.
 *
 * Loads runtime.bpf.o (ring-buffer capture of process lifecycle and
 * connect attempts/results), consumes the ring buffer and forwards every
 * event as one JSON line to iora-runtime-sensor over its Unix socket.
 *
 * Privilege model (Security Foundation baseline, runtime_sensor_privileged
 * _exception): this is the ONLY component allowed to hold CAP_BPF and
 * CAP_PERFMON. It performs no host mutations: no process signals, no
 * firewall, no Docker, no systemd. It never execs anything.
 *
 * Enrichment limits: connect tracepoints do not expose the socket fd, so
 * the protocol is reported as "tcp" (UDP datagrams use sendto and are not
 * captured) and socket_cookie is reported as 0 (unknown).
 */

#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <bpf/libbpf.h>
#include <bpf/ringbuf.h>

#include "runtime_event.h"

static volatile sig_atomic_t g_stop = 0;
static void on_signal(int sig) { g_stop = 1; (void)sig; }

static const char *g_sock_path = "/run/iora/runtime-sensor/ebpf-events.sock";
static int g_sock_fd = -1;

static void socket_close(void)
{
	if (g_sock_fd >= 0) {
		close(g_sock_fd);
		g_sock_fd = -1;
	}
}

static int socket_connect(void)
{
	struct sockaddr_un addr;
	int fd;

	fd = socket(AF_UNIX, SOCK_STREAM, 0);
	if (fd < 0)
		return -1;
	memset(&addr, 0, sizeof(addr));
	addr.sun_family = AF_UNIX;
	strncpy(addr.sun_path, g_sock_path, sizeof(addr.sun_path) - 1);
	if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
		close(fd);
		return -1;
	}
	return fd;
}

static void socket_send(const char *line, size_t len)
{
	size_t off = 0;

	if (g_sock_fd < 0)
		g_sock_fd = socket_connect();
	if (g_sock_fd < 0)
		return; /* sensor not up yet; reconnect on the next event */
	while (off < len) {
		ssize_t n = write(g_sock_fd, line + off, len - off);
		if (n > 0) {
			off += (size_t)n;
			continue;
		}
		if (n < 0 && errno == EINTR)
			continue;
		socket_close();
		return;
	}
	if (write(g_sock_fd, "\n", 1) < 0)
		socket_close();
}

/* JSON string escaping: quotes, backslash and control characters. */
static void escape_json(char *out, size_t outsz, const char *in)
{
	size_t o = 0;
	while (*in && o + 6 < outsz) {
		unsigned char c = (unsigned char)*in;
		if (c == '"' || c == '\\') {
			out[o++] = '\\';
			out[o++] = (char)c;
		} else if (c < 0x20) {
			o += (size_t)snprintf(out + o, outsz - o, "\\u%04x", c);
		} else {
			out[o++] = (char)c;
		}
		in++;
	}
	out[o] = '\0';
}

static const char *class_name(__u32 type)
{
	switch (type) {
	case EVENT_START:
		return "process_start";
	case EVENT_EXEC:
		return "process_exec";
	case EVENT_EXIT:
		return "process_exit";
	case EVENT_CONNECT_ATTEMPT:
		return "connection_attempt";
	case EVENT_CONNECT_RESULT:
		return "connection_result";
	default:
		return "unknown";
	}
}

static int format_json(char *buf, size_t bufsz, const struct runtime_event *e)
{
	char cmd_esc[64], exe_esc[520], exe_field[520];
	char remote_field[64] = "null", port_field[16] = "null";
	char protocol_field[16] = "null", family_field[16] = "null";
	char errno_field[16] = "null";
	int is_connect = e->event_type == EVENT_CONNECT_ATTEMPT ||
			 e->event_type == EVENT_CONNECT_RESULT;

	escape_json(cmd_esc, sizeof(cmd_esc), e->command_name);
	if (e->executable[0]) {
		escape_json(exe_esc, sizeof(exe_esc), e->executable);
		snprintf(exe_field, sizeof(exe_field), "\"%s\"", exe_esc);
	} else {
		strcpy(exe_field, "null");
	}
	if (is_connect) {
		char remote[INET6_ADDRSTRLEN] = "";
		if (e->address_family == AF_INET &&
		    inet_ntop(AF_INET, e->remote_address, remote, sizeof(remote))) {
			snprintf(remote_field, sizeof(remote_field), "\"%s\"", remote);
			snprintf(port_field, sizeof(port_field), "%u", ntohs(e->remote_port));
			strcpy(protocol_field, "\"tcp\"");
			strcpy(family_field, "\"ipv4\"");
		} else if (e->address_family == AF_INET6 &&
			   inet_ntop(AF_INET6, e->remote_address, remote, sizeof(remote))) {
			snprintf(remote_field, sizeof(remote_field), "\"%s\"", remote);
			snprintf(port_field, sizeof(port_field), "%u", ntohs(e->remote_port));
			strcpy(protocol_field, "\"tcp\"");
			strcpy(family_field, "\"ipv6\"");
		}
		if (e->event_type == EVENT_CONNECT_RESULT)
			snprintf(errno_field, sizeof(errno_field), "%d", e->result_errno);
	}
	return snprintf(
		buf, bufsz,
		"{\"class\":\"%s\",\"monotonic_ns\":%llu,\"pid\":%u,\"ppid\":%u,"
		"\"process_start_time_ns\":%llu,\"exec_generation\":%u,\"uid\":%u,"
		"\"gid\":%u,\"cgroup_id\":%llu,\"command_name\":\"%s\","
		"\"executable\":%s,\"remote_address\":%s,\"remote_port\":%s,"
		"\"local_address\":null,\"local_port\":null,\"protocol\":%s,"
		"\"address_family\":%s,\"network_namespace\":%llu,"
		"\"socket_cookie\":0,\"result_errno\":%s}",
		class_name(e->event_type), (unsigned long long)e->monotonic_ns, e->pid,
		e->ppid, (unsigned long long)e->process_start_time_ns,
		e->exec_generation, e->uid, e->gid,
		(unsigned long long)e->cgroup_id, cmd_esc, exe_field, remote_field,
		port_field, protocol_field, family_field,
		(unsigned long long)e->network_namespace, errno_field);
}

static int handle_event(void *ctx, void *data, size_t size)
{
	char line[1024];
	int len;

	(void)ctx;
	if (size < sizeof(struct runtime_event))
		return 0;
	len = format_json(line, sizeof(line), (const struct runtime_event *)data);
	if (len > 0)
		socket_send(line, (size_t)len);
	return 0;
}

int main(int argc, char **argv)
{
	struct bpf_object *obj = NULL;
	struct bpf_map *map = NULL;
	struct ring_buffer *rb = NULL;
	int err = 1;

	if (argc > 1)
		g_sock_path = argv[1];
	obj = bpf_object__open_file(argv[2], NULL);
	if (!obj) {
		fprintf(stderr, "iora-ebpf-loader: cannot open %s: %s\n",
			argv[2], strerror(errno));
		goto out;
	}
	if (bpf_object__load(obj)) {
		fprintf(stderr, "iora-ebpf-loader: program load failed\n");
		goto out;
	}
	map = bpf_object__find_map_by_name(obj, "events");
	if (!map) {
		fprintf(stderr, "iora-ebpf-loader: ring buffer map 'events' missing\n");
		goto out;
	}
	rb = ring_buffer__new(bpf_map__fd(map), handle_event, NULL, NULL);
	if (!rb) {
		fprintf(stderr, "iora-ebpf-loader: ring buffer setup failed\n");
		goto out;
	}
	signal(SIGTERM, on_signal);
	signal(SIGINT, on_signal);
	fprintf(stderr, "iora-ebpf-loader: ready (socket=%s)\n", g_sock_path);
	while (!g_stop) {
		int polled = ring_buffer__poll(rb, 200);
		if (polled < 0 && polled != -EINTR) {
			fprintf(stderr, "iora-ebpf-loader: poll error: %s\n",
				strerror(-polled));
			sleep(1);
		}
	}
	err = 0;
out:
	ring_buffer__free(rb);
	bpf_object__close(obj);
	return err;
}
