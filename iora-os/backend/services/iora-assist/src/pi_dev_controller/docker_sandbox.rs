// Docker Sandbox for pi.dev Execution
// Manages isolated Docker containers with bollard 0.16 API

use std::collections::HashMap;
use std::time::Duration;

use bollard::container::{
    Config as ContainerConfig, CreateContainerOptions,
    RemoveContainerOptions, StartContainerOptions, StopContainerOptions,
};
use bollard::models::{
    HostConfig as BollardHostConfig, RestartPolicy, RestartPolicyNameEnum,
};
use bollard::Docker;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use super::security_monitor::SecurityPolicy;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub image: String,
    pub workspace_path: String,
    pub sandbox_base: String,
    pub api_key: String,
    pub cpu_limit: Option<String>,
    pub memory_limit: Option<String>,
    pub network_enabled: bool,
    pub allowed_domains: Vec<String>,
    pub session_timeout_secs: u64,
    pub plugin_packages: Vec<String>,
    pub security_policy: SecurityPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxStatus {
    pub running: bool,
    pub container_id: Option<String>,
    pub uptime_seconds: Option<u64>,
    pub cpu_usage_percent: Option<f64>,
    pub memory_usage_mb: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerMetrics {
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub network_rx_bytes: u64,
    pub network_tx_bytes: u64,
}

pub struct DockerSandbox {
    docker: Docker,
}

impl DockerSandbox {
    pub fn new() -> Self {
        let docker = Docker::connect_with_local_defaults()
            .expect("Failed to connect to Docker daemon");
        Self { docker }
    }

    pub async fn create_container(&self, config: &SandboxConfig) -> Result<String, String> {
        self.ensure_image(&config.image).await?;

        let container_name = format!(
            "iora-pidev-{}",
            uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("session")
        );

        let workspace_bind = format!("{}:/workspace:rw", config.workspace_path);
        let sandbox_bind = format!("{}:/sandbox:rw", config.sandbox_base);

        let env_vars: Vec<String> = vec![
            format!("API_KEY={}", config.api_key),
            "WORKSPACE_DIR=/workspace".to_string(),
            "SANDBOX_DIR=/sandbox".to_string(),
            format!("SESSION_TIMEOUT={}", config.session_timeout_secs),
            format!("NETWORK_ENABLED={}", config.network_enabled),
            format!("SECURITY_LEVEL={}", config.security_policy.level),
            format!("PLUGINS={}", config.plugin_packages.join(",")),
            "PIDEV_MODE=agent".to_string(),
            "IORA_MANAGED=true".to_string(),
        ];

        // Plugin install + pi.dev startup command
        //
        // When `IORA_PI_EXTENSION_PATH` is set on the host, the IORA bridge
        // extension is mounted read-only into the container and loaded via
        // `pi -e`, giving interactive sessions LocalUp-style live monitoring and
        // remote control. When unset, behaviour is unchanged.
        let mut binds = vec![workspace_bind, sandbox_bind];
        let ext_flag = match std::env::var("IORA_PI_EXTENSION_PATH") {
            Ok(host_path) if !host_path.trim().is_empty() => {
                binds.push(format!("{}:/opt/iora/iora-bridge.ts:ro", host_path));
                " -e /opt/iora/iora-bridge.ts".to_string()
            }
            _ => String::new(),
        };

        let start_cmd = if config.plugin_packages.is_empty() {
            format!("exec npx pi serve --port 3000 --host 0.0.0.0{}", ext_flag)
        } else {
            format!(
                "for pkg in {}; do npx pi install $pkg 2>/dev/null || true; done && exec npx pi serve --port 3000 --host 0.0.0.0{}",
                config.plugin_packages.join(" "),
                ext_flag
            )
        };

        let memory_bytes = config.memory_limit.as_ref()
            .and_then(|m| parse_memory(m));
        let nano_cpus = config.cpu_limit.as_ref()
            .and_then(|c| parse_cpu(c));

        let host_config = BollardHostConfig {
            binds: Some(binds),
            memory: memory_bytes,
            nano_cpus,
            cap_drop: Some(vec!["ALL".to_string()]),
            cap_add: Some(vec![
                "CHOWN".to_string(), "DAC_OVERRIDE".to_string(),
                "FOWNER".to_string(), "FSETID".to_string(),
            ]),
            network_mode: Some(if config.network_enabled { "bridge".to_string() } else { "none".to_string() }),
            auto_remove: Some(true),
            restart_policy: Some(RestartPolicy {
                name: Some(RestartPolicyNameEnum::NO),
                maximum_retry_count: Some(0),
            }),
            ..Default::default()
        };

        let container_config = ContainerConfig {
            image: Some(config.image.clone()),
            env: Some(env_vars),
            host_config: Some(host_config),
            working_dir: Some("/workspace".to_string()),
            cmd: Some(vec!["/bin/sh".to_string(), "-c".to_string(), start_cmd]),
            ..Default::default()
        };

        let create_opts = CreateContainerOptions {
            name: container_name.clone(),
            platform: None,
        };

        let container = self.docker
            .create_container(Some(create_opts), container_config)
            .await
            .map_err(|e| format!("Failed to create container: {}", e))?;

        let cid = container.id.clone();
        info!("Created Docker container {} ({})", container_name, cid);

        self.docker
            .start_container(&cid, None::<StartContainerOptions<&str>>)
            .await
            .map_err(|e| format!("Failed to start container: {}", e))?;

        info!("Started pi.dev container {}", cid);

        // Wait briefly for startup
        tokio::time::sleep(Duration::from_secs(15)).await;

        Ok(cid)
    }

    pub async fn stop_container(&self, container_id: &str) -> Result<(), String> {
        let opts = StopContainerOptions { t: 30 };
        self.docker
            .stop_container(container_id, Some(opts))
            .await
            .map_err(|e| format!("Failed to stop: {}", e))?;
        info!("Stopped container {}", container_id);
        Ok(())
    }

    pub async fn destroy_container(&self, container_id: &str) -> Result<(), String> {
        let opts = RemoveContainerOptions { force: true, ..Default::default() };
        self.docker
            .remove_container(container_id, Some(opts))
            .await
            .map_err(|e| format!("Failed to remove: {}", e))?;
        Ok(())
    }

    pub async fn container_status(&self, container_id: &str) -> Result<SandboxStatus, String> {
        let inspect = self.docker
            .inspect_container(container_id, None)
            .await
            .map_err(|e| format!("Inspect failed: {}", e))?;

        let state = inspect.state.unwrap_or_default();
        let running = state.running.unwrap_or(false);

        Ok(SandboxStatus {
            running,
            container_id: Some(container_id.to_string()),
            uptime_seconds: None,
            cpu_usage_percent: None,
            memory_usage_mb: None,
            error: state.error,
        })
    }

    pub async fn container_metrics(&self, _container_id: &str) -> Result<ContainerMetrics, String> {
        Ok(ContainerMetrics { cpu_percent: 0.0, memory_mb: 0.0, network_rx_bytes: 0, network_tx_bytes: 0 })
    }

    pub async fn exec_in_container(
        &self,
        container_id: &str,
        command: Vec<&str>,
    ) -> Result<String, String> {
        use bollard::exec::{CreateExecOptions, StartExecResults};

        let exec = self.docker
            .create_exec(container_id, CreateExecOptions {
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                cmd: Some(command),
                ..Default::default()
            })
            .await
            .map_err(|e| format!("Exec create failed: {}", e))?;

        let output = self.docker
            .start_exec(&exec.id, None)
            .await
            .map_err(|e| format!("Exec start failed: {}", e))?;

        match output {
            StartExecResults::Attached { mut output, .. } => {
                let mut result = String::new();
                while let Some(Ok(msg)) = output.next().await {
                    result.push_str(&msg.to_string());
                }
                Ok(result)
            }
            _ => Ok("exec started (detached)".to_string()),
        }
    }

    /// Run a one-shot pi.dev agent task inside an existing session container
    /// using the real `pi --mode json` CLI. The agent runs headless and emits
    /// JSON-Lines events on stdout; each complete line is forwarded through
    /// `line_tx` for parsing by the controller. Returns the exec exit code when
    /// known (`None` if it could not be determined).
    pub async fn run_pi_task(
        &self,
        container_id: &str,
        prompt: &str,
        provider: Option<&str>,
        model: Option<&str>,
        line_tx: tokio::sync::mpsc::UnboundedSender<String>,
    ) -> Result<Option<i64>, String> {
        use bollard::exec::{CreateExecOptions, StartExecResults};

        // Build: pi --mode json --no-session [--provider X] [--model Y] "<prompt>"
        let mut cmd: Vec<String> = vec![
            "pi".to_string(),
            "--mode".to_string(),
            "json".to_string(),
            "--no-session".to_string(),
        ];
        if let Some(p) = provider {
            cmd.push("--provider".to_string());
            cmd.push(p.to_string());
        }
        if let Some(m) = model {
            cmd.push("--model".to_string());
            cmd.push(m.to_string());
        }
        cmd.push(prompt.to_string());

        let exec = self
            .docker
            .create_exec(
                container_id,
                CreateExecOptions {
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    working_dir: Some("/workspace".to_string()),
                    env: Some(vec![
                        "PI_OFFLINE=1".to_string(),
                        "PI_SKIP_VERSION_CHECK=1".to_string(),
                    ]),
                    cmd: Some(cmd),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| format!("Exec create failed: {}", e))?;

        let output = self
            .docker
            .start_exec(&exec.id, None)
            .await
            .map_err(|e| format!("Exec start failed: {}", e))?;

        if let StartExecResults::Attached { mut output, .. } = output {
            let mut buf = String::new();
            while let Some(item) = output.next().await {
                match item {
                    Ok(msg) => {
                        buf.push_str(&msg.to_string());
                        // Drain complete, newline-terminated lines.
                        while let Some(idx) = buf.find('\n') {
                            let line: String = buf.drain(..=idx).collect();
                            let trimmed = line.trim_end_matches(['\n', '\r']).to_string();
                            if !trimmed.is_empty() && line_tx.send(trimmed).is_err() {
                                // Receiver dropped — stop reading.
                                return Ok(None);
                            }
                        }
                    }
                    Err(e) => {
                        warn!("pi exec stream error: {}", e);
                        break;
                    }
                }
            }
            // Flush any trailing partial line.
            let rest = buf.trim().to_string();
            if !rest.is_empty() {
                let _ = line_tx.send(rest);
            }
        }

        // Resolve the exit code of the pi process.
        let code = self
            .docker
            .inspect_exec(&exec.id)
            .await
            .ok()
            .and_then(|i| i.exit_code);
        Ok(code)
    }

    async fn ensure_image(&self, image: &str) -> Result<(), String> {
        use bollard::image::ListImagesOptions;

        let mut filters: HashMap<&str, Vec<&str>> = HashMap::new();
        filters.insert("reference", vec![image]);

        let images = self.docker
            .list_images(Some(ListImagesOptions::<&str> {
                filters,
                ..Default::default()
            }))
            .await
            .map_err(|e| format!("List images failed: {}", e))?;

        if !images.is_empty() { return Ok(()); }

        info!("Pulling Docker image: {}", image);
        let mut stream = self.docker.create_image(
            Some(bollard::image::CreateImageOptions {
                from_image: image,
                ..Default::default()
            }),
            None,
            None,
        );

        while let Some(result) = stream.next().await {
            if let Err(e) = result {
                return Err(format!("Pull failed: {}", e));
            }
        }

        Ok(())
    }
}

fn parse_memory(mem: &str) -> Option<i64> {
    let mem = mem.to_lowercase().replace("gb", "g").replace("mb", "m").replace("kb", "k");
    if let Some(v) = mem.strip_suffix('g') {
        v.parse::<f64>().ok().map(|v| (v * 1024.0 * 1024.0 * 1024.0) as i64)
    } else if let Some(v) = mem.strip_suffix('m') {
        v.parse::<f64>().ok().map(|v| (v * 1024.0 * 1024.0) as i64)
    } else if let Some(v) = mem.strip_suffix('k') {
        v.parse::<f64>().ok().map(|v| (v * 1024.0) as i64)
    } else {
        mem.parse::<i64>().ok()
    }
}

fn parse_cpu(cpu: &str) -> Option<i64> {
    cpu.parse::<f64>().ok().map(|v| (v * 1_000_000_000.0) as i64)
}
