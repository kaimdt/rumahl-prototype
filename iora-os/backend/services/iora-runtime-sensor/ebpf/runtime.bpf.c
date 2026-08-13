// SPDX-License-Identifier: GPL-2.0
// Observation-only CO-RE capture: lifecycle plus connect attempts/results.
#include "vmlinux.h"
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

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

struct pending_connect { struct runtime_event event; };
struct { __uint(type,BPF_MAP_TYPE_RINGBUF); __uint(max_entries,1<<22); } events SEC(".maps");
struct { __uint(type,BPF_MAP_TYPE_LRU_HASH); __uint(max_entries,8192); __type(key,__u64); __type(value,struct pending_connect); } connects SEC(".maps");
struct { __uint(type,BPF_MAP_TYPE_LRU_HASH); __uint(max_entries,32768); __type(key,__u32); __type(value,__u32); } exec_generations SEC(".maps");

static __always_inline void fill(struct runtime_event *event,__u32 type){
    __u64 pid_tgid=bpf_get_current_pid_tgid(),uid_gid=bpf_get_current_uid_gid();
    struct task_struct *task=(struct task_struct *)bpf_get_current_task_btf();
    __builtin_memset(event,0,sizeof(*event));event->event_type=type;event->pid=pid_tgid>>32;event->uid=uid_gid;event->gid=uid_gid>>32;
    event->ppid=BPF_CORE_READ(task,real_parent,tgid);event->process_start_time_ns=BPF_CORE_READ(task,start_boottime);event->monotonic_ns=bpf_ktime_get_ns();event->cgroup_id=bpf_get_current_cgroup_id();
    struct nsproxy *ns=BPF_CORE_READ(task,nsproxy);struct net *net=BPF_CORE_READ(ns,net_ns);event->network_namespace=BPF_CORE_READ(net,ns.inum);
    __u32 *generation=bpf_map_lookup_elem(&exec_generations,&event->pid);if(generation)event->exec_generation=*generation;
    bpf_get_current_comm(event->command_name,sizeof(event->command_name));
}
static __always_inline void submit(__u32 type){struct runtime_event *event=bpf_ringbuf_reserve(&events,sizeof(*event),0);if(!event)return;fill(event,type);bpf_ringbuf_submit(event,0);}

SEC("tracepoint/sched/sched_process_fork")
int process_start(struct trace_event_raw_sched_process_fork *ctx){struct runtime_event *event=bpf_ringbuf_reserve(&events,sizeof(*event),0);if(!event)return 0;fill(event,EVENT_START);event->pid=ctx->child_pid;event->ppid=ctx->parent_pid;event->process_start_time_ns=event->monotonic_ns;bpf_ringbuf_submit(event,0);return 0;}
SEC("tracepoint/sched/sched_process_exec")
int process_exec(struct trace_event_raw_sched_process_exec *ctx){struct runtime_event *event=bpf_ringbuf_reserve(&events,sizeof(*event),0);if(!event)return 0;fill(event,EVENT_EXEC);__u32 next=event->exec_generation+1;bpf_map_update_elem(&exec_generations,&event->pid,&next,BPF_ANY);event->exec_generation=next;const char *filename=(const char *)ctx+(ctx->__data_loc_filename&0xffff);bpf_probe_read_kernel_str(event->executable,sizeof(event->executable),filename);bpf_ringbuf_submit(event,0);return 0;}
SEC("tracepoint/sched/sched_process_exit")
int process_exit(void *ctx){__u32 pid=bpf_get_current_pid_tgid()>>32;submit(EVENT_EXIT);bpf_map_delete_elem(&exec_generations,&pid);return 0;}

SEC("tracepoint/syscalls/sys_enter_connect")
int connect_enter(struct trace_event_raw_sys_enter *ctx){__u64 key=bpf_get_current_pid_tgid();struct pending_connect pending={};fill(&pending.event,EVENT_CONNECT_ATTEMPT);struct sockaddr *address=(struct sockaddr *)ctx->args[1];bpf_probe_read_user(&pending.event.address_family,sizeof(__u16),&address->sa_family);if(pending.event.address_family==AF_INET){struct sockaddr_in value={};bpf_probe_read_user(&value,sizeof(value),address);pending.event.remote_port=value.sin_port;__builtin_memcpy(pending.event.remote_address,&value.sin_addr,4);}else if(pending.event.address_family==AF_INET6){struct sockaddr_in6 value={};bpf_probe_read_user(&value,sizeof(value),address);pending.event.remote_port=value.sin6_port;__builtin_memcpy(pending.event.remote_address,&value.sin6_addr,16);}/* Protocol and socket cookie are resolved by the loader from the socket fd. */bpf_map_update_elem(&connects,&key,&pending,BPF_ANY);struct runtime_event *out=bpf_ringbuf_reserve(&events,sizeof(*out),0);if(out){__builtin_memcpy(out,&pending.event,sizeof(*out));bpf_ringbuf_submit(out,0);}return 0;}
SEC("tracepoint/syscalls/sys_exit_connect")
int connect_exit(struct trace_event_raw_sys_exit *ctx){__u64 key=bpf_get_current_pid_tgid();struct pending_connect *pending=bpf_map_lookup_elem(&connects,&key);if(!pending)return 0;struct runtime_event *out=bpf_ringbuf_reserve(&events,sizeof(*out),0);if(out){__builtin_memcpy(out,&pending->event,sizeof(*out));out->event_type=EVENT_CONNECT_RESULT;out->monotonic_ns=bpf_ktime_get_ns();out->result_errno=ctx->ret<0?-ctx->ret:0;bpf_ringbuf_submit(out,0);}bpf_map_delete_elem(&connects,&key);return 0;}
char LICENSE[] SEC("license")="GPL";
