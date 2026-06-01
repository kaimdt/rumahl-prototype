// Virtual Company & AI Briefing System
// Multi-agent orchestration: virtual company with CEO, CTO, Developer, etc.
// AI Briefings: automated weekly meetings, user-called briefings, summaries


use chrono::{DateTime, Utc, Datelike, Timelike, Weekday};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::info;

// ─── Virtual Company ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CompanyRole {
    CEO,
    CTO,
    Developer,
    DataAnalyst,
    QATester,
    DevOps,
    ProductManager,
    SecurityOfficer,
    TechnicalWriter,
    UXDesigner,
}

impl CompanyRole {
    pub fn label(&self) -> &str {
        match self {
            Self::CEO => "CEO – Strategic Lead",
            Self::CTO => "CTO – Technical Lead",
            Self::Developer => "Developer",
            Self::DataAnalyst => "Data Analyst",
            Self::QATester => "QA & Testing",
            Self::DevOps => "DevOps Engineer",
            Self::ProductManager => "Product Manager",
            Self::SecurityOfficer => "Security Officer",
            Self::TechnicalWriter => "Technical Writer",
            Self::UXDesigner => "UX Designer",
        }
    }

    pub fn system_prompt(&self) -> &str {
        match self {
            Self::CEO => "You are the CEO of IORA Virtual Company. Your role: strategic planning, task prioritization, resource allocation. Coordinate all other roles. Make executive decisions. Report directly to the user.",
            Self::CTO => "You are the CTO. Your role: technical architecture, technology choices, code review sign-off. Ensure technical excellence and scalability.",
            Self::Developer => "You are a Developer. Your role: implementation, bug fixes, feature development. Write clean, tested code. Report to the CTO.",
            Self::DataAnalyst => "You are a Data Analyst. Your role: data analysis, insights generation, reporting. Analyze metrics and provide data-driven recommendations.",
            Self::QATester => "You are QA. Your role: testing, quality assurance, bug detection. Write tests, review quality, ensure reliability.",
            Self::DevOps => "You are DevOps. Your role: deployment, infrastructure, CI/CD. Ensure smooth operations and deployments.",
            Self::ProductManager => "You are Product Manager. Your role: feature planning, roadmap, user stories. Prioritize features based on user value.",
            Self::SecurityOfficer => "You are Security Officer. Your role: security audits, vulnerability scanning, compliance. Protect the system.",
            Self::TechnicalWriter => "You are Technical Writer. Your role: documentation, API docs, user guides. Make the system understandable.",
            Self::UXDesigner => "You are UX Designer. Your role: interface design, usability, user experience. Make the system delightful to use.",
        }
    }

    pub fn emoji(&self) -> &str {
        match self {
            Self::CEO => "CEO", Self::CTO => "CTO", Self::Developer => "DEV",
            Self::DataAnalyst => "DATA", Self::QATester => "QA", Self::DevOps => "OPS",
            Self::ProductManager => "PM", Self::SecurityOfficer => "SEC",
            Self::TechnicalWriter => "DOCS", Self::UXDesigner => "UX",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanyAgent {
    pub id: String,
    pub role: CompanyRole,
    pub name: String,
    pub provider: String,
    pub model: String,
    pub is_active: bool,
    pub tasks_completed: u32,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanyProject {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: ProjectStatus,
    pub assigned_roles: Vec<CompanyRole>,
    pub tasks: Vec<CompanyTask>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProjectStatus { Planning, InProgress, Review, Completed, Archived }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanyTask {
    pub id: String,
    pub title: String,
    pub assigned_to: CompanyRole,
    pub status: TaskState,
    pub priority: u8, // 1-10
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskState { Todo, InProgress, Done, Blocked }

// ─── AI Briefing System ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefingConfig {
    pub enabled: bool,
    pub schedule: BriefingSchedule,
    pub min_complexity_for_briefing: u8, // 1-10, how complex must tasks be to trigger briefing
    pub include_idle_agents: bool,
    pub summary_format: SummaryFormat,
    pub auto_create_tasks: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BriefingSchedule {
    Weekly { day: String, hour: u32 },     // e.g., Monday 09:00
    BiWeekly { day: String, hour: u32 },    // Every 2 weeks
    Daily { hour: u32 },                    // Daily standup
    Manual,                                  // User-triggered only
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SummaryFormat { Detailed, Concise, ActionItems, FullTranscript }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefingSession {
    pub id: String,
    pub title: String,
    pub triggered_by: BriefingTrigger,
    pub agenda: Vec<String>,
    pub participants: Vec<CompanyRole>,
    pub discussion_points: Vec<DiscussionPoint>,
    pub decisions: Vec<String>,
    pub action_items: Vec<ActionItem>,
    pub summary: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub status: BriefingStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BriefingTrigger {
    Scheduled,
    UserCalled { reason: String },
    AutoTriggered { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscussionPoint {
    pub topic: String,
    pub raised_by: CompanyRole,
    pub discussion: String,
    pub resolution: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub description: String,
    pub assigned_to: CompanyRole,
    pub priority: u8,
    pub deadline: Option<DateTime<Utc>>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BriefingStatus { Scheduled, InProgress, Completed, Cancelled }

// ─── Virtual Company Manager ───────────────────────────────────────────────

pub struct VirtualCompany {
    pub name: String,
    pub enabled: RwLock<bool>,
    pub agents: RwLock<Vec<CompanyAgent>>,
    pub projects: RwLock<Vec<CompanyProject>>,
    pub briefing_config: RwLock<BriefingConfig>,
    pub briefing_history: RwLock<Vec<BriefingSession>>,
    pub next_briefing: RwLock<Option<DateTime<Utc>>>,
    pub company_founded: DateTime<Utc>,
}

impl VirtualCompany {
    pub fn new() -> Self {
        let agents = vec![
            CompanyAgent { id: "ceo".into(), role: CompanyRole::CEO, name: "Chief Executive".into(), provider: "anthropic".into(), model: "claude-sonnet".into(), is_active: true, tasks_completed: 0, joined_at: Utc::now() },
            CompanyAgent { id: "cto".into(), role: CompanyRole::CTO, name: "Tech Lead".into(), provider: "pidev".into(), model: "pi-dev".into(), is_active: true, tasks_completed: 0, joined_at: Utc::now() },
            CompanyAgent { id: "dev1".into(), role: CompanyRole::Developer, name: "Senior Dev".into(), provider: "pidev".into(), model: "pi-dev".into(), is_active: true, tasks_completed: 0, joined_at: Utc::now() },
            CompanyAgent { id: "dev2".into(), role: CompanyRole::Developer, name: "Junior Dev".into(), provider: "local".into(), model: "default".into(), is_active: true, tasks_completed: 0, joined_at: Utc::now() },
            CompanyAgent { id: "data".into(), role: CompanyRole::DataAnalyst, name: "Data Expert".into(), provider: "local".into(), model: "default".into(), is_active: true, tasks_completed: 0, joined_at: Utc::now() },
            CompanyAgent { id: "qa".into(), role: CompanyRole::QATester, name: "QA Lead".into(), provider: "pidev".into(), model: "pi-dev".into(), is_active: true, tasks_completed: 0, joined_at: Utc::now() },
            CompanyAgent { id: "devops".into(), role: CompanyRole::DevOps, name: "Infra Lead".into(), provider: "local".into(), model: "default".into(), is_active: true, tasks_completed: 0, joined_at: Utc::now() },
            CompanyAgent { id: "pm".into(), role: CompanyRole::ProductManager, name: "Product Owner".into(), provider: "anthropic".into(), model: "claude-sonnet".into(), is_active: true, tasks_completed: 0, joined_at: Utc::now() },
            CompanyAgent { id: "security".into(), role: CompanyRole::SecurityOfficer, name: "Security Lead".into(), provider: "pidev".into(), model: "pi-dev".into(), is_active: true, tasks_completed: 0, joined_at: Utc::now() },
            CompanyAgent { id: "writer".into(), role: CompanyRole::TechnicalWriter, name: "Docs Lead".into(), provider: "local".into(), model: "default".into(), is_active: false, tasks_completed: 0, joined_at: Utc::now() },
        ];

        let briefing_config = BriefingConfig {
            enabled: true,
            schedule: BriefingSchedule::Weekly { day: "monday".to_string(), hour: 9 },
            min_complexity_for_briefing: 5,
            include_idle_agents: true,
            summary_format: SummaryFormat::Concise,
            auto_create_tasks: true,
        };

        Self {
            name: "IORA Virtual Company".into(),
            enabled: RwLock::new(false), // Disabled by default, user enables
            agents: RwLock::new(agents),
            projects: RwLock::new(Vec::new()),
            briefing_config: RwLock::new(briefing_config),
            briefing_history: RwLock::new(Vec::new()),
            next_briefing: RwLock::new(None),
            company_founded: Utc::now(),
        }
    }

    // ─── Company Management ─────────────────────────────────────────────

    pub fn enable(&self) {
        *self.enabled.write() = true;
        self.schedule_next_briefing();
        info!("Virtual Company ENABLED");
    }

    pub fn disable(&self) {
        *self.enabled.write() = false;
        *self.next_briefing.write() = None;
        info!("Virtual Company DISABLED");
    }

    pub fn is_enabled(&self) -> bool { *self.enabled.read() }

    pub fn get_agents(&self) -> Vec<CompanyAgent> { self.agents.read().clone() }

    pub fn set_agent_active(&self, agent_id: &str, active: bool) {
        if let Some(a) = self.agents.write().iter_mut().find(|a| a.id == agent_id) {
            a.is_active = active;
        }
    }

    pub fn get_active_agents(&self) -> Vec<CompanyAgent> {
        self.agents.read().iter().filter(|a| a.is_active).cloned().collect()
    }

    // ─── Project Management ──────────────────────────────────────────────

    pub fn create_project(&self, name: &str, description: &str) -> CompanyProject {
        let project = CompanyProject {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            description: description.to_string(),
            status: ProjectStatus::Planning,
            assigned_roles: vec![CompanyRole::Developer, CompanyRole::QATester],
            tasks: Vec::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        self.projects.write().push(project.clone());
        project
    }

    pub fn add_task(&self, project_id: &str, title: &str, role: CompanyRole, priority: u8) -> Option<CompanyTask> {
        let task = CompanyTask {
            id: uuid::Uuid::new_v4().to_string(),
            title: title.to_string(),
            assigned_to: role,
            status: TaskState::Todo,
            priority,
            created_at: Utc::now(),
        };
        if let Some(p) = self.projects.write().iter_mut().find(|p| p.id == project_id) {
            p.tasks.push(task.clone());
            p.updated_at = Utc::now();
            Some(task)
        } else {
            None
        }
    }

    pub fn get_projects(&self) -> Vec<CompanyProject> { self.projects.read().clone() }
    pub fn get_active_projects(&self) -> Vec<CompanyProject> {
        self.projects.read().iter().filter(|p| p.status != ProjectStatus::Completed && p.status != ProjectStatus::Archived).cloned().collect()
    }

    /// Check if there are active tasks that warrant a briefing
    pub fn has_active_work(&self) -> bool {
        let projects = self.projects.read();
        if projects.is_empty() { return false; }
        projects.iter().any(|p| p.tasks.iter().any(|t| t.status == TaskState::Todo || t.status == TaskState::InProgress))
    }

    pub fn get_active_task_count(&self) -> usize {
        self.projects.read().iter().flat_map(|p| &p.tasks).filter(|t| t.status != TaskState::Done).count()
    }

    pub fn get_max_task_priority(&self) -> u8 {
        self.projects.read().iter().flat_map(|p| &p.tasks).filter(|t| t.status != TaskState::Done).map(|t| t.priority).max().unwrap_or(0)
    }

    // ─── Briefing System ─────────────────────────────────────────────────

    pub fn schedule_next_briefing(&self) {
        let next = self.calculate_next_briefing();
        *self.next_briefing.write() = next;
        if let Some(dt) = next {
            info!("Next briefing scheduled: {}", dt);
        }
    }

    fn calculate_next_briefing(&self) -> Option<DateTime<Utc>> {
        let config = self.briefing_config.read();
        if !config.enabled { return None; }

        let now = Utc::now();
        match &config.schedule {
            BriefingSchedule::Weekly { day, hour } => {
                let target_weekday = day_str_to_weekday(day);
                let mut next = now;
                // Find next occurrence of target day
                for _ in 0..7 {
                    if next.weekday() == target_weekday && next.hour() <= *hour {
                        let result = next.with_hour(*hour)?.with_minute(0)?.with_second(0)?;
                        if result > now { return Some(result); }
                    }
                    next = next + chrono::Duration::days(1);
                }
                None
            }
            BriefingSchedule::BiWeekly { day, hour } => {
                let target = day_str_to_weekday(day);
                let next_week = now + chrono::Duration::weeks(1);
                let result = next_week.with_hour(*hour)?.with_minute(0)?;
                while result.weekday() != target {
                    let r = result + chrono::Duration::days(1);
                    if r.weekday() == target { return Some(r); }
                }
                Some(result)
            }
            BriefingSchedule::Daily { hour } => {
                let mut next = now.with_hour(*hour)?.with_minute(0)?;
                if next <= now { next = next + chrono::Duration::days(1); }
                Some(next)
            }
            BriefingSchedule::Manual => None,
        }
    }

    /// Start a briefing session – called by scheduler or user
    pub fn start_briefing(&self, trigger: BriefingTrigger) -> Option<BriefingSession> {
        if !self.is_enabled() { return None; }

        // Only brief if there's active work (unless user-called)
        if !self.has_active_work() && !matches!(trigger, BriefingTrigger::UserCalled { .. }) {
            info!("No active tasks – skipping briefing");
            return None;
        }

        let active_agents = self.get_active_agents();
        if active_agents.is_empty() {
            info!("No active agents – skipping briefing");
            return None;
        }

        // Build agenda
        let agenda = self.build_agenda();

        // Determine participants based on active projects
        let participants: Vec<CompanyRole> = {
            let projects = self.projects.read();
            let mut roles: Vec<CompanyRole> = projects.iter()
                .filter(|p| p.status != ProjectStatus::Completed)
                .flat_map(|p| &p.assigned_roles)
                .cloned()
                .collect();
            roles.sort_by_key(|r| format!("{:?}", r));
            roles.dedup();
            if roles.is_empty() {
                roles.push(CompanyRole::CEO);
                roles.push(CompanyRole::CTO);
            }
            roles
        };

        let title = match &trigger {
            BriefingTrigger::Scheduled => format!("Weekly Briefing – {}", Utc::now().format("%d.%m.%Y")),
            BriefingTrigger::UserCalled { reason } => format!("Ad-Hoc Briefing: {}", reason),
            BriefingTrigger::AutoTriggered { reason } => format!("Auto Briefing: {}", reason),
        };

        let session = BriefingSession {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            triggered_by: trigger,
            agenda,
            participants,
            discussion_points: Vec::new(),
            decisions: Vec::new(),
            action_items: Vec::new(),
            summary: String::new(),
            started_at: Utc::now(),
            ended_at: None,
            status: BriefingStatus::InProgress,
        };

        self.briefing_history.write().push(session.clone());
        info!("Briefing started: {}", session.title);
        Some(session)
    }

    /// Complete a briefing and generate summary
    pub fn complete_briefing(&self, session_id: &str, discussions: Vec<DiscussionPoint>, decisions: Vec<String>, action_items: Vec<ActionItem>) -> Option<BriefingSession> {
        let mut history = self.briefing_history.write();
        let session = history.iter_mut().find(|s| s.id == session_id)?;

        session.discussion_points = discussions;
        session.decisions = decisions.clone();
        session.action_items = action_items.clone();
        session.ended_at = Some(Utc::now());
        session.status = BriefingStatus::Completed;

        // Generate summary
        session.summary = self.generate_summary(session);

        info!("Briefing completed. {} decisions, {} action items", decisions.len(), action_items.len());

        // Schedule next briefing
        self.schedule_next_briefing();

        Some(session.clone())
    }

    fn build_agenda(&self) -> Vec<String> {
        let mut agenda = vec![
            "1. Review of recent accomplishments".to_string(),
            "2. Current project status updates".to_string(),
        ];

        let projects = self.projects.read();
        for p in projects.iter().filter(|p| p.status != ProjectStatus::Completed) {
            let active_tasks: Vec<&CompanyTask> = p.tasks.iter().filter(|t| t.status != TaskState::Done).collect();
            if !active_tasks.is_empty() {
                agenda.push(format!("   • {}: {} active tasks", p.name, active_tasks.len()));
            }
        }

        agenda.push("3. Blockers and impediments".to_string());
        agenda.push("4. Upcoming priorities (next week)".to_string());
        agenda.push("5. Resource allocation & assignments".to_string());
        agenda.push("6. Any other business".to_string());

        agenda
    }

    fn generate_summary(&self, session: &BriefingSession) -> String {
        let config = self.briefing_config.read();
        match config.summary_format {
            SummaryFormat::Concise => {
                let mut s = format!("# Briefing Summary: {}\n\n", session.title);
                s.push_str(&format!("**Participants:** {}\n\n", session.participants.iter().map(|r| format!("{} {}", r.emoji(), r.label())).collect::<Vec<_>>().join(", ")));

                if !session.decisions.is_empty() {
                    s.push_str("## 🎯 Decisions\n");
                    for d in &session.decisions { s.push_str(&format!("- {}\n", d)); }
                }

                if !session.action_items.is_empty() {
                    s.push_str("\n## Action Items\n");
                    for a in &session.action_items {
                        s.push_str(&format!("- [{}] {} {} (Prio {})\n",
                            a.status, a.assigned_to.emoji(), a.description, a.priority));
                    }
                }

                s
            }
            SummaryFormat::Detailed => {
                let mut s = format!("# Detailed Briefing: {}\n\n", session.title);
                s.push_str("## Discussion\n");
                for dp in &session.discussion_points {
                    s.push_str(&format!("### {} (raised by {} {})\n{}\n", dp.topic, dp.raised_by.emoji(), dp.raised_by.label(), dp.discussion));
                }
                s.push_str("\n## Decisions\n");
                for d in &session.decisions { s.push_str(&format!("- {}\n", d)); }
                s.push_str("\n## Next Steps\n");
                for a in &session.action_items {
                    s.push_str(&format!("- {} {} ({} priority)\n", a.assigned_to.emoji(), a.description, a.priority));
                }
                s
            }
            SummaryFormat::ActionItems => {
                let mut s = format!("# Action Items from {}\n\n", session.title);
                for a in &session.action_items {
                    s.push_str(&format!("- [ ] **{}** {} (Prio {})", a.assigned_to.label(), a.description, a.priority));
                    if let Some(dl) = a.deadline {
                        s.push_str(&format!(" – Deadline: {}", dl.format("%d.%m.%Y")));
                    }
                    s.push_str("\n");
                }
                s
            }
            SummaryFormat::FullTranscript => {
                let mut s = format!("# Full Briefing Transcript: {}\n\n", session.title);
                for dp in &session.discussion_points {
                    s.push_str(&format!("**[{} {}]:** {}\n\n", dp.raised_by.emoji(), dp.raised_by.label(), dp.discussion));
                }
                s
            }
        }
    }

    // ─── CEO Task Distribution ────────────────────────────────────────────

    /// CEO distributes a user task to the appropriate agents
    pub fn distribute_task(&self, task_description: &str) -> CompanyTask {
        // Determine best role based on keywords
        let role = self.classify_task_to_role(task_description);
        let priority = self.estimate_priority(task_description);

        CompanyTask {
            id: uuid::Uuid::new_v4().to_string(),
            title: task_description.to_string(),
            assigned_to: role,
            status: TaskState::Todo,
            priority,
            created_at: Utc::now(),
        }
    }

    fn classify_task_to_role(&self, desc: &str) -> CompanyRole {
        let d = desc.to_lowercase();
        if d.contains("security") || d.contains("vulnerab") || d.contains("audit") { return CompanyRole::SecurityOfficer; }
        if d.contains("deploy") || d.contains("infra") || d.contains("docker") || d.contains("ci/cd") { return CompanyRole::DevOps; }
        if d.contains("test") || d.contains("qa") || d.contains("quality") { return CompanyRole::QATester; }
        if d.contains("data") || d.contains("analytics") || d.contains("report") || d.contains("metrics") { return CompanyRole::DataAnalyst; }
        if d.contains("doc") || d.contains("readme") || d.contains("guide") { return CompanyRole::TechnicalWriter; }
        if d.contains("ui") || d.contains("ux") || d.contains("design") || d.contains("interface") { return CompanyRole::UXDesigner; }
        if d.contains("architecture") || d.contains("tech") || d.contains("stack") { return CompanyRole::CTO; }
        if d.contains("plan") || d.contains("roadmap") || d.contains("feature") || d.contains("product") { return CompanyRole::ProductManager; }
        if d.contains("strateg") || d.contains("priority") || d.contains("decision") { return CompanyRole::CEO; }
        CompanyRole::Developer // Default
    }

    fn estimate_priority(&self, desc: &str) -> u8 {
        let d = desc.to_lowercase();
        if d.contains("critical") || d.contains("urgent") || d.contains("emergency") || d.contains("crash") || d.contains("security") { return 10; }
        if d.contains("important") || d.contains("high") || d.contains("block") || d.contains("bug") { return 8; }
        if d.contains("soon") || d.contains("medium") { return 5; }
        if d.contains("low") || d.contains("nice") || d.contains("someday") { return 2; }
        5 // Default medium
    }

    pub fn get_briefing_history(&self) -> Vec<BriefingSession> { self.briefing_history.read().clone() }
    pub fn get_briefing_config(&self) -> BriefingConfig { self.briefing_config.read().clone() }
    pub fn update_briefing_config(&self, config: BriefingConfig) {
        *self.briefing_config.write() = config;
        self.schedule_next_briefing();
    }
}

fn day_str_to_weekday(day: &str) -> Weekday {
    match day.to_lowercase().as_str() {
        "monday" | "mon" => Weekday::Mon,
        "tuesday" | "tue" | "tues" => Weekday::Tue,
        "wednesday" | "wed" => Weekday::Wed,
        "thursday" | "thu" | "thur" | "thurs" => Weekday::Thu,
        "friday" | "fri" => Weekday::Fri,
        "saturday" | "sat" => Weekday::Sat,
        "sunday" | "sun" => Weekday::Sun,
        _ => Weekday::Mon,
    }
}
