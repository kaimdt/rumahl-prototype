// Self-Evolution Planner - Multi-step planning engine for ORA's self-improvement
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::tools::{EvolutionTool, ToolOutput};
use crate::providers::{AIProvider, ChatMessage, ChatResponse};

/// A single step in an evolution plan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionStep {
    pub id: String,
    pub description: String,
    pub tool_name: String,
    pub params: serde_json::Value,
    #[serde(default)]
    pub depends_on: Vec<String>,  // IDs of steps this one depends on
    #[serde(default)]
    pub estimated_tokens: u32,
    #[serde(default)]
    pub status: StepStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum StepStatus {
    #[default]
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl std::fmt::Display for StepStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Running => write!(f, "running"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Skipped => write!(f, "skipped"),
        }
    }
}

/// A complete evolution plan with multiple steps
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionPlan {
    pub id: String,
    pub title: String,
    pub description: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub steps: Vec<EvolutionStep>,
    #[serde(default)]
    pub status: PlanStatus,
    #[serde(default)]
    pub current_step: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum PlanStatus {
    #[default]
    Draft,
    Executing,
    Completed,
    Failed,
    Cancelled,
}

impl std::fmt::Display for PlanStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Draft => write!(f, "draft"),
            Self::Executing => write!(f, "executing"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Result of executing a single step
#[derive(Debug, Clone, Serialize)]
pub struct StepResult {
    pub step_id: String,
    pub success: bool,
    pub output: String,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub tokens_used: Option<u32>,
}

/// The Self-Evolution Planner - generates and executes multi-step improvement plans
pub struct SelfEvolutionPlanner {
    provider: Box<dyn AIProvider>,
    tools: Vec<Box<dyn EvolutionTool>>,
    project_root: String,
}

impl SelfEvolutionPlanner {
    pub fn new(
        provider: Box<dyn AIProvider>,
        tools: Vec<Box<dyn EvolutionTool>>,
        project_root: impl Into<String>,
    ) -> Self {
        Self {
            provider,
            tools,
            project_root: project_root.into(),
        }
    }

    /// Generate an evolution plan based on a user request or reflection findings
    pub async fn generate_plan(
        &self,
        goal: &str,
        context: Option<String>,
    ) -> Result<EvolutionPlan, String> {
        let tool_descriptions: Vec<String> = self.tools.iter()
            .map(|t| format!("- {}: {}", t.name(), t.description()))
            .collect();

        let system_prompt = format!(
            r#"You are ORA's Self-Evolution Planner. Your job is to create detailed, executable plans for improving the ORA codebase.

Available tools:
{}

Plan generation rules:
1. Break complex goals into small, atomic steps (each step uses one tool)
2. Each step must specify exact parameters in JSON format
3. Define dependencies between steps when order matters
4. Estimate token usage for each step
5. Include verification steps after code changes
6. Always include a final review/compile step

Output format: Return ONLY valid JSON matching this schema:
{{
  "title": "Short descriptive title",
  "description": "Detailed explanation of the plan",
  "steps": [
    {{
      "id": "step_1",
      "description": "What this step does",
      "tool_name": "read_file|write_file|code_diff|git_ops|...",
      "params": {{"param1": "value1"}},
      "depends_on": [],
      "estimated_tokens": 500
    }}
  ]
}}"#,
            tool_descriptions.join("\n")
        );

        let user_message = if let Some(ctx) = context {
            format!("Goal: {}\n\nContext:\n{}", goal, ctx)
        } else {
            format!("Goal: {}", goal)
        };

        let response = self.provider.chat(
            vec![ChatMessage { role: "user".to_string(), content: user_message }],
            Some(system_prompt),
        ).await.map_err(|e| e.to_string())?;

        // Parse the JSON plan from the AI response
        let plan_json: serde_json::Value = serde_json::from_str(&response.message)
            .map_err(|e| format!("Failed to parse generated plan as JSON: {}", e))?;

        let title = plan_json["title"].as_str().unwrap_or("Untitled Plan").to_string();
        let description = plan_json["description"].as_str()
            .unwrap_or("").to_string();
        
        let steps_value = &plan_json["steps"];
        let steps: Vec<EvolutionStep> = serde_json::from_value(steps_value.clone())
            .map_err(|e| format!("Failed to parse plan steps: {}", e))?;

        Ok(EvolutionPlan {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            description,
            created_at: chrono::Utc::now(),
            steps,
            status: PlanStatus::Draft,
            current_step: None,
        })
    }

    /// Execute a plan step by step, respecting dependencies
    pub async fn execute_plan(
        &self,
        plan: &mut EvolutionPlan,
        on_progress: impl Fn(&StepResult) + Send + Sync + Clone,
    ) -> Result<Vec<StepResult>, String> {
        plan.status = PlanStatus::Executing;

        let mut results = Vec::new();
        let mut completed_steps: std::collections::HashSet<String> = 
            std::collections::HashSet::new();

        // Topological sort of steps based on dependencies
        let step_order = self.resolve_step_order(&plan.steps)?;

        for (idx, step_id) in step_order.iter().enumerate() {
            plan.current_step = Some(idx);

            let step = plan.steps.iter_mut()
                .find(|s| s.id == *step_id)
                .ok_or_else(|| format!("Step '{}' not found", step_id))?;

            // Check dependencies are met
            for dep in &step.depends_on {
                if !completed_steps.contains(dep.as_str()) {
                    return Err(format!(
                        "Cannot execute step '{}': dependency '{}' not completed",
                        step.id, dep
                    ));
                }
            }

            // Find the right tool
            let tool = self.tools.iter()
                .find(|t| t.name() == step.tool_name)
                .ok_or_else(|| format!("Unknown tool: {}", step.tool_name))?;

            // Execute the step
            step.status = StepStatus::Running;
            
            let output_result = tool.execute(&step.params).await;

            let result = match output_result {
                Ok(output) => {
                    step.status = StepStatus::Completed;
                    completed_steps.insert(step.id.clone());
                    
                    StepResult {
                        step_id: step.id.clone(),
                        success: true,
                        output: output.output,
                        summary: output.summary,
                        error: None,
                        tokens_used: None,
                    }
                }
                Err(e) => {
                    step.status = StepStatus::Failed;
                    
                    StepResult {
                        step_id: step.id.clone(),
                        success: false,
                        output: String::new(),
                        summary: Some(format!("Step failed")),
                        error: Some(e),
                        tokens_used: None,
                    }
                }
            };

            (on_progress)(&result);
            results.push(result);

            // Stop on failure unless step is marked as optional
            if step.status == StepStatus::Failed {
                plan.status = PlanStatus::Failed;
                return Ok(results);
            }
        }

        plan.status = PlanStatus::Completed;
        Ok(results)
    }

    /// Resolve execution order based on dependencies (topological sort)
    fn resolve_step_order(&self, steps: &[EvolutionStep]) -> Result<Vec<String>, String> {
        let mut order = Vec::new();
        let mut visited = std::collections::HashSet::new();
        let mut in_stack = std::collections::HashSet::new();

        fn dfs(
            step_id: &str,
            steps: &[EvolutionStep],
            order: &mut Vec<String>,
            visited: &mut std::collections::HashSet<String>,
            in_stack: &mut std::collections::HashSet<String>,
        ) -> Result<(), String> {
            if in_stack.contains(step_id) {
                return Err(format!("Circular dependency detected involving '{}'", step_id));
            }
            if visited.contains(step_id) {
                return Ok(());
            }

            in_stack.insert(step_id.to_string());

            let step = steps.iter().find(|s| s.id == *step_id)
                .ok_or_else(|| format!("Step '{}' not found", step_id))?;

            for dep in &step.depends_on {
                dfs(dep, steps, order, visited, in_stack)?;
            }

            in_stack.remove(step_id);
            visited.insert(step_id.to_string());
            order.push(step_id.to_string());

            Ok(())
        }

        for step in steps {
            if !visited.contains(&step.id) {
                dfs(&step.id, steps, &mut order, &mut visited, &mut in_stack)?;
            }
        }

        Ok(order)
    }

    /// Generate a plan and execute it in one call
    pub async fn plan_and_execute(
        &self,
        goal: &str,
        context: Option<String>,
        on_progress: impl Fn(&StepResult) + Send + Sync + Clone,
    ) -> Result<(EvolutionPlan, Vec<StepResult>), String> {
        let mut plan = self.generate_plan(goal, context).await?;
        let results = self.execute_plan(&mut plan, on_progress).await?;
        Ok((plan.clone(), results))
    }

    /// Get a summary of available tools for the AI to reference
    pub fn get_tool_catalog(&self) -> serde_json::Value {
        serde_json::json!({
            "tools": self.tools.iter().map(|t| {
                serde_json::json!({
                    "name": t.name(),
                    "description": t.description(),
                })
            }).collect::<Vec<_>>(),
            "project_root": self.project_root,
        })
    }
}
