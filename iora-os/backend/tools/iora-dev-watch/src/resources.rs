//! VM resource monitoring with live ASCII graphs and resource management.
//!
//! Collects CPU, RAM, and disk usage from the VM via SSH (/proc/stat,
//! /proc/meminfo, df) and renders Unicode block-character bar charts.
//!
//! Resource adjustment: detects the current QEMU allocation and generates
//! the appropriate IORA_DEV_RAM/IORA_DEV_CPUS environment-variable commands
//! for the next dev-local.sh run.
#![allow(dead_code)]

use anyhow::{Context, Result};
use std::collections::VecDeque;

// ═══════════════════════════════════════════════════════════════════════════
// Data structures
// ═══════════════════════════════════════════════════════════════════════════

/// Current VM resource snapshot.
#[derive(Debug, Clone, Default)]
pub struct ResourceData {
    pub cpu_percent: f64,
    pub cpu_cores_used: u32,
    pub cpu_cores_total: u32,
    pub load_1m: f64,
    pub load_5m: f64,
    pub load_15m: f64,
    pub ram_used_bytes: u64,
    pub ram_total_bytes: u64,
    pub ram_available_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub disk_mount: String,
    pub uptime_seconds: u64,
    /// Raw /proc/stat first line for delta calculation.
    cpu_raw: Option<CpuTick>,
}

#[derive(Debug, Clone, Default)]
struct CpuTick {
    user: u64,
    nice: u64,
    system: u64,
    idle: u64,
    iowait: u64,
    irq: u64,
    softirq: u64,
    steal: u64,
}

/// Current QEMU VM allocation (detected from host process).
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct VmAllocation {
    pub ram_mb: u64,
    pub cpu_cores: u32,
    pub disk_size_bytes: u64,
    pub disk_path: Option<String>,
}

/// Resource history ring-buffer for trend graphs.
pub struct ResourceHistory {
    pub cpu: VecDeque<f64>,
    pub ram: VecDeque<f64>,
    max_len: usize,
}

impl ResourceHistory {
    pub fn new(max_len: usize) -> Self {
        Self {
            cpu: VecDeque::with_capacity(max_len),
            ram: VecDeque::with_capacity(max_len),
            max_len,
        }
    }

    pub fn push(&mut self, cpu: f64, ram: f64) {
        if self.cpu.len() >= self.max_len {
            self.cpu.pop_front();
        }
        if self.ram.len() >= self.max_len {
            self.ram.pop_front();
        }
        self.cpu.push_back(cpu);
        self.ram.push_back(ram);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Data collection (via SSH exec on the VM)
// ═══════════════════════════════════════════════════════════════════════════

/// Run a single SSH command and return stdout.
pub async fn ssh_collect(
    host: &str,
    port: u16,
    ssh_key: &std::path::Path,
    cmd: &str,
) -> Result<String> {
    let mut command = tokio::process::Command::new("ssh");
    command
        .args(ssh_args(host, port, ssh_key))
        .arg(cmd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = command.output().await.context("ssh resource collection")?;

    if !output.status.success() {
        anyhow::bail!("ssh exited with {}", output.status);
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn ssh_args(host: &str, port: u16, ssh_key: &std::path::Path) -> Vec<String> {
    vec![
        "-o".into(),
        "StrictHostKeyChecking=no".into(),
        "-o".into(),
        "UserKnownHostsFile=/dev/null".into(),
        "-o".into(),
        "IdentitiesOnly=yes".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=5".into(),
        "-o".into(),
        "LogLevel=ERROR".into(),
        "-i".into(),
        ssh_key.to_string_lossy().to_string(),
        "-p".into(),
        port.to_string(),
        format!("root@{host}"),
    ]
}

/// Collect a full resource snapshot from the VM.
/// Uses a single batched SSH call to minimize overhead.
pub async fn collect_resources(
    host: &str,
    port: u16,
    ssh_key: &std::path::Path,
    prev: Option<&ResourceData>,
) -> Result<ResourceData> {
    // Single SSH call: cat all files, pipe through a script that outputs
    // delimited fields. Much faster than 3 separate SSH connections.
    // The `---` marker MUST come before df so the df line never lands in the
    // /proc parse loop (it contains '/' which would confuse the loadavg
    // heuristic and produce huge bogus load values).
    let script = r#"
cat /proc/stat /proc/meminfo /proc/uptime /proc/loadavg 2>/dev/null
echo "---"
df -B1 / 2>/dev/null | tail -1
"#;

    let raw = ssh_collect(host, port, ssh_key, script).await?;

    let mut data = ResourceData::default();

    // Parse /proc/stat (first line: cpu  user nice system idle iowait irq softirq steal)
    // Parse /proc/meminfo
    // Parse uptime + loadavg
    // Parse df output

    let parts: Vec<&str> = raw.split("---").collect();
    let proc_text = parts.first().unwrap_or(&"");

    let mut mem_total: u64;
    let mut mem_avail: u64;

    for line in proc_text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // CPU line: "cpu  user nice system idle iowait irq softirq steal ..."
        if line.starts_with("cpu ") {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() >= 8 {
                let tick = CpuTick {
                    user: fields[1].parse().unwrap_or(0),
                    nice: fields[2].parse().unwrap_or(0),
                    system: fields[3].parse().unwrap_or(0),
                    idle: fields[4].parse().unwrap_or(0),
                    iowait: fields[5].parse().unwrap_or(0),
                    irq: fields[6].parse().unwrap_or(0),
                    softirq: fields[7].parse().unwrap_or(0),
                    steal: fields.get(8).and_then(|v| v.parse().ok()).unwrap_or(0),
                };

                // Compute CPU % from delta against previous sample
                if let Some(prev_data) = prev.and_then(|p| p.cpu_raw.as_ref()) {
                    let prev_total = prev_data.user
                        + prev_data.nice
                        + prev_data.system
                        + prev_data.idle
                        + prev_data.iowait
                        + prev_data.irq
                        + prev_data.softirq
                        + prev_data.steal;
                    let cur_total = tick.user
                        + tick.nice
                        + tick.system
                        + tick.idle
                        + tick.iowait
                        + tick.irq
                        + tick.softirq
                        + tick.steal;

                    let total_delta = cur_total.saturating_sub(prev_total);
                    let idle_delta = tick.idle.saturating_sub(prev_data.idle);

                    if total_delta > 0 {
                        data.cpu_percent = ((total_delta - idle_delta) as f64 / total_delta as f64
                            * 100.0)
                            .clamp(0.0, 100.0);
                    }
                }

                data.cpu_raw = Some(tick);
            }
        }

        // Count CPU cores (cpu0, cpu1, ... lines)
        if line.starts_with("cpu") && line.chars().nth(3).is_some_and(|c| c.is_ascii_digit()) {
            data.cpu_cores_total += 1;
        }

        // MemTotal
        if line.starts_with("MemTotal:") {
            mem_total = parse_kb_field(line);
            data.ram_total_bytes = mem_total * 1024;
        }
        // MemAvailable
        if line.starts_with("MemAvailable:") {
            mem_avail = parse_kb_field(line);
            data.ram_available_bytes = mem_avail * 1024;
        }

        // Uptime (single line: "12345.67 98765.43")
        if line.contains('.') && !line.contains(':') && line.split_whitespace().count() == 2 {
            if let Some(up) = line.split_whitespace().next() {
                data.uptime_seconds = up.parse::<f64>().unwrap_or(0.0) as u64;
            }
        }

        // Load average (single line: "1.23 0.89 0.67 3/456 12345").
        // Distinguish from df by requiring the first three fields to parse
        // as small floats (load averages are typically < 1000).
        if line.contains('/') && line.split_whitespace().count() >= 5 {
            let fields: Vec<&str> = line.split_whitespace().collect();
            let f0: Option<f64> = fields[0].parse().ok();
            let f1: Option<f64> = fields[1].parse().ok();
            let f2: Option<f64> = fields[2].parse().ok();
            if let (Some(a), Some(b), Some(c)) = (f0, f1, f2) {
                if a < 10_000.0 && b < 10_000.0 && c < 10_000.0 {
                    data.load_1m = a;
                    data.load_5m = b;
                    data.load_15m = c;
                }
            }
        }
    }

    // Parse df output (last part): "Filesystem 1K-blocks Used Available Use% Mounted on"
    // We used -B1 so it's in bytes
    if let Some(df_line) = parts.get(1) {
        let df_line = df_line.trim();
        if !df_line.is_empty() {
            let fields: Vec<&str> = df_line.split_whitespace().collect();
            if fields.len() >= 6 {
                data.disk_total_bytes = fields[1].parse().unwrap_or(0);
                data.disk_used_bytes = fields[2].parse().unwrap_or(0);
                data.disk_mount = fields[5].to_string();
            }
        }
    }

    // Compute RAM used
    if data.ram_total_bytes > 0 {
        data.ram_used_bytes = data
            .ram_total_bytes
            .saturating_sub(data.ram_available_bytes);
    }

    // Compute active cores from loadavg (approximate)
    data.cpu_cores_used = (data.load_1m.round() as u32).min(data.cpu_cores_total.max(1));

    Ok(data)
}

fn parse_kb_field(line: &str) -> u64 {
    line.split_whitespace()
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

// ═══════════════════════════════════════════════════════════════════════════
// ASCII graph rendering
// ═══════════════════════════════════════════════════════════════════════════

/// Render a horizontal bar graph using Unicode block characters.
/// `percent`: 0.0 - 100.0
/// `width`: number of character cells for the bar
/// Returns something like "████████░░░░░░░░"
pub fn render_bar(percent: f64, width: usize) -> String {
    let pct = percent.clamp(0.0, 100.0);
    let fill = (pct / 100.0 * width as f64).round() as usize;
    let fill = fill.min(width);

    let mut s = String::with_capacity(width * 3); // UTF-8: 3 bytes per char
    for _ in 0..fill {
        s.push('█');
    }
    for _ in fill..width {
        s.push('░');
    }
    s
}

/// Render a mini sparkline from history data.
/// Each value is 0.0-100.0. Uses Unicode block gradient.
pub fn render_sparkline(values: &VecDeque<f64>, width: usize) -> String {
    if values.is_empty() {
        return "░".repeat(width);
    }
    // Downsample to fit width
    let step = (values.len() as f64 / width as f64).max(1.0);
    let blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    let mut s = String::with_capacity(width * 3);

    for i in 0..width {
        let idx = (i as f64 * step) as usize;
        let val = values.get(idx).copied().unwrap_or(0.0).clamp(0.0, 100.0);
        let level = ((val / 100.0) * 8.0).round() as usize;
        s.push_str(blocks[level.min(8)]);
    }
    s
}

/// Format bytes as human-readable string.
pub fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.1}G", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1}M", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.1}K", bytes as f64 / 1024.0)
    } else {
        format!("{}B", bytes)
    }
}

/// Format uptime in seconds to a human-readable string.
pub fn format_uptime(seconds: u64) -> String {
    let days = seconds / 86400;
    let hours = (seconds % 86400) / 3600;
    let mins = (seconds % 3600) / 60;
    if days > 0 {
        format!("{}d {}h {}m", days, hours, mins)
    } else if hours > 0 {
        format!("{}h {}m", hours, mins)
    } else {
        format!("{}m", mins)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Resource adjustment (VM allocation management)
// ═══════════════════════════════════════════════════════════════════════════

/// Detect the current VM allocation from the QEMU process.
/// Parses `ps` output to find the QEMU command line.
#[allow(dead_code)]
pub async fn detect_vm_allocation(
    host: &str,
    port: u16,
    ssh_key: &std::path::Path,
) -> Result<VmAllocation> {
    // On the VM: detect total RAM and disk
    let script = r#"
cat /proc/meminfo | grep MemTotal
df -B1 / | tail -1
nproc
echo "---QEMU---"
# Try to find QEMU disk path from the VM side (looking at /dev/vda or /dev/sda)
lsblk -b -n -o SIZE,NAME,MOUNTPOINT 2>/dev/null | head -5
"#;
    let raw = ssh_collect(host, port, ssh_key, script).await?;
    let parts: Vec<&str> = raw.split("---QEMU---").collect();
    let proc_text = parts.first().unwrap_or(&"");

    let mut alloc = VmAllocation::default();

    for line in proc_text.lines() {
        if line.starts_with("MemTotal:") {
            alloc.ram_mb = parse_kb_field(line) / 1024;
        }
        if line.starts_with("MemAvailable:") {
            // already handled
        }
    }

    // Parse nproc
    if let Some(cpu_line) = proc_text.lines().find(|l| l.trim().parse::<u32>().is_ok()) {
        alloc.cpu_cores = cpu_line.trim().parse().unwrap_or(0);
    }

    // Parse df output
    if let Some(df_line) = parts.get(1).and_then(|p| p.lines().next()) {
        let fields: Vec<&str> = df_line.split_whitespace().collect();
        if fields.len() >= 2 {
            alloc.disk_size_bytes = fields[1].parse().unwrap_or(0);
        }
    }

    Ok(alloc)
}

/// Generate the command line to reconfigure VM resources.
/// Returns a command string the user can run (or we could execute it).
#[allow(dead_code)]
pub fn resize_command(
    current: &VmAllocation,
    new_ram_mb: u64,
    new_cpu_cores: u32,
    new_disk_gb: u64,
) -> Vec<String> {
    let mut cmds: Vec<String> = Vec::new();

    if new_ram_mb != current.ram_mb {
        cmds.push(format!(
            "# Set new RAM size (requires VM restart):\nIORA_DEV_RAM={}M ./dev-local.sh --reboot",
            new_ram_mb
        ));
    }
    if new_cpu_cores != current.cpu_cores {
        cmds.push(format!(
            "# Set new CPU cores (requires VM restart):\nIORA_DEV_CPUS={} ./dev-local.sh --reboot",
            new_cpu_cores
        ));
    }
    if new_disk_gb > 0 && new_disk_gb != current.disk_size_bytes / 1_073_741_824 {
        let current_gb = current.disk_size_bytes / 1_073_741_824;
        if new_disk_gb > current_gb {
            cmds.push(format!(
                "# Resize disk from {}G to {}G:\nqemu-img resize {} +{}G\n# Then in the VM:\nsudo resize2fs /dev/vda3  # or find the right partition with: lsblk",
                current_gb, new_disk_gb,
                current.disk_path.as_deref().unwrap_or("<disk-path>"),
                new_disk_gb - current_gb
            ));
        }
    }

    cmds
}

/// Quick single-command resource summary for the header/tooltip.
/// Returns a one-line summary string.
#[allow(dead_code)]
pub fn summary_line(data: &ResourceData) -> String {
    format!(
        "CPU {:.0}%  RAM {}  Disk {}  ↑{}",
        data.cpu_percent,
        format_bytes(data.ram_used_bytes),
        format_bytes(data.disk_used_bytes),
        format_uptime(data.uptime_seconds),
    )
}
