// Continuous Evolution Scheduler - runs self-evolution cycles in the background
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tokio::sync::RwLock;

use super::evolution_cycle::SelfEvolutionOrchestrator;
use super::EvolutionConfig;

/// State of the background scheduler
pub enum SchedulerState {
    Running,
    Paused,
    Stopped,
}

/// Background scheduler that periodically runs self-evolution cycles
pub struct EvolutionScheduler {
    orchestrator: Arc<SelfEvolutionOrchestrator>,
    config: EvolutionConfig,
    state: Arc<RwLock<SchedulerState>>,
}

impl EvolutionScheduler {
    pub fn new(
        orchestrator: Arc<SelfEvolutionOrchestrator>,
        config: EvolutionConfig,
    ) -> Self {
        Self {
            orchestrator,
            config,
            state: Arc::new(RwLock::new(SchedulerState::Stopped)),
        }
    }

    /// Start the scheduler in a background tokio task
    pub async fn start(self) {
        *self.state.write().await = SchedulerState::Running;
        let state = self.state.clone();
        let orchestrator = self.orchestrator.clone();
        let interval_hours = self.config.evolution_interval_minutes as u64;

        tokio::spawn(async move {
            tracing::info!(
                "Evolution scheduler started (interval: {} minutes)",
                interval_hours
            );

            // Run immediately on first start
            match orchestrator.run_cycle().await {
                Ok(cycle) => {
                    tracing::info!("Initial evolution cycle completed: {} phases", cycle.phase_results.len());
                }
                Err(e) => {
                    tracing::warn!("Initial evolution cycle failed: {}", e);
                }
            }

            // Then run periodically
            loop {
                match *state.read().await {
                    SchedulerState::Running => {
                        sleep(Duration::from_secs(interval_hours * 60)).await;

                        match *state.read().await {
                            SchedulerState::Running => {
                                tracing::info!("Starting scheduled evolution cycle");
                                match orchestrator.run_cycle().await {
                                    Ok(cycle) => {
                                        tracing::info!(
                                            "Evolution cycle completed: {} phases, {} actions",
                                            cycle.phase_results.len(),
                                            cycle.phase_results.iter().map(|p| p.actions_taken.len()).sum::<usize>()
                                        );
                                    }
                                    Err(e) => {
                                        tracing::error!("Evolution cycle failed: {}", e);
                                    }
                                }
                            }
                            _ => {
                                sleep(Duration::from_secs(10)).await;
                                continue;
                            }
                        }
                    }
                    SchedulerState::Paused => {
                        sleep(Duration::from_secs(30)).await;
                    }
                    SchedulerState::Stopped => {
                        tracing::info!("Evolution scheduler stopped");
                        break;
                    }
                }
            }
        });
    }

    /// Pause the scheduler
    pub async fn pause(&self) {
        *self.state.write().await = SchedulerState::Paused;
        tracing::info!("Evolution scheduler paused");
    }

    /// Resume the scheduler
    pub async fn resume(&self) {
        *self.state.write().await = SchedulerState::Running;
        tracing::info!("Evolution scheduler resumed");
    }

    /// Stop the scheduler
    pub async fn stop(&self) {
        *self.state.write().await = SchedulerState::Stopped;
        tracing::info!("Evolution scheduler stopped");
    }

    /// Check if the scheduler is running
    pub async fn is_running(&self) -> bool {
        matches!(*self.state.read().await, SchedulerState::Running)
    }
}
