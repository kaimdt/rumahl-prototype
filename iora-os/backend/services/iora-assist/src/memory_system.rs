// ORA Memory System – Persistent learning across sessions
// Stores: Codebase knowledge, User preferences, Error patterns, Project facts

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::info;

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    /// Unique ID
    pub id: String,
    /// Category: codebase, preference, error, fact, pattern, lesson
    pub category: MemoryCategory,
    /// Key for retrieval
    pub key: String,
    /// The actual memory content
    pub content: String,
    /// Importance score (0.0 - 1.0), higher = more important
    pub importance: f32,
    /// How many times this memory was accessed
    pub access_count: u32,
    /// When was it last accessed
    pub last_accessed: DateTime<Utc>,
    /// When was it created
    pub created_at: DateTime<Utc>,
    /// Related memory IDs
    pub related: Vec<String>,
    /// Source: agent, user, system, learned
    pub source: String,
    /// Embedding vector for semantic search (simplified: keyword tags)
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MemoryCategory {
    CodebaseKnowledge,
    UserPreference,
    ErrorPattern,
    ProjectFact,
    LearnedLesson,
    AgentBehavior,
}

impl MemoryCategory {
    pub fn as_str(&self) -> &str {
        match self {
            Self::CodebaseKnowledge => "codebase",
            Self::UserPreference => "preference",
            Self::ErrorPattern => "error",
            Self::ProjectFact => "fact",
            Self::LearnedLesson => "lesson",
            Self::AgentBehavior => "behavior",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryQuery {
    pub query: String,
    pub category: Option<MemoryCategory>,
    pub min_importance: Option<f32>,
    pub max_results: usize,
    pub tags: Option<Vec<String>>,
}

// ─── Memory Store ──────────────────────────────────────────────────────────

pub struct MemoryStore {
    memories: RwLock<HashMap<String, Memory>>,
    // Inverted index: tag → memory IDs
    tag_index: RwLock<HashMap<String, Vec<String>>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self {
            memories: RwLock::new(HashMap::new()),
            tag_index: RwLock::new(HashMap::new()),
        }
    }

    /// Store a new memory
    pub fn store(&self, mut memory: Memory) -> String {
        let id = memory.id.clone();
        let now = Utc::now();
        memory.created_at = now;
        memory.last_accessed = now;

        // Update tag index
        {
            let mut index = self.tag_index.write();
            for tag in &memory.tags {
                index.entry(tag.clone()).or_default().push(id.clone());
            }
        }

        self.memories.write().insert(id.clone(), memory);
        id
    }

    /// Retrieve memories matching a query (keyword-based search)
    pub fn query(&self, query: &MemoryQuery) -> Vec<Memory> {
        let memories = self.memories.read();
        let query_lower = query.query.to_lowercase();
        let query_words: Vec<&str> = query_lower.split_whitespace().collect();

        let mut results: Vec<Memory> = memories
            .values()
            .filter(|m| {
                // Category filter
                if let Some(ref cat) = query.category {
                    if m.category != *cat { return false; }
                }
                // Importance filter
                if let Some(min_imp) = query.min_importance {
                    if m.importance < min_imp { return false; }
                }
                // Tag filter
                if let Some(ref tags) = query.tags {
                    if !tags.iter().any(|t| m.tags.contains(t)) { return false; }
                }
                // Keyword match
                let content_lower = m.content.to_lowercase();
                query_words.iter().any(|w| content_lower.contains(w))
                    || query_words.iter().any(|w| m.key.to_lowercase().contains(w))
            })
            .cloned()
            .collect();

        // Sort by relevance: importance * (1 + access_count / 10)
        results.sort_by(|a, b| {
            let score_a = a.importance * (1.0 + a.access_count as f32 / 10.0);
            let score_b = b.importance * (1.0 + b.access_count as f32 / 10.0);
            score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
        });

        results.truncate(query.max_results);

        // Update access counts
        for m in &results {
            if let Some(mem) = self.memories.write().get_mut(&m.id) {
                mem.access_count += 1;
                mem.last_accessed = Utc::now();
            }
        }

        results
    }

    /// Extract memories from an agent's response
    /// Detects patterns like "I learned that...", "Note to self:", etc.
    pub fn extract_from_response(&self, agent_id: &str, response: &str) -> Vec<String> {
        let mut new_ids = Vec::new();
        let indicators = [
            "I learned that", "Note:", "IMPORTANT:", "Remember:",
            "Key insight:", "Pattern detected:", "Best practice:",
            "Architecture note:", "LESSON:",
        ];

        for line in response.lines() {
            for indicator in &indicators {
                if line.to_lowercase().contains(&indicator.to_lowercase()) {
                    let content = line.trim().to_string();
                    if content.len() > 10 {
                        // Extract tags from content
                        let tags: Vec<String> = content
                            .split_whitespace()
                            .filter(|w| w.starts_with('#') || w.len() > 5)
                            .map(|w| w.trim_matches('#').to_lowercase())
                            .take(5)
                            .collect();

                        let memory = Memory {
                            id: uuid::Uuid::new_v4().to_string(),
                            category: MemoryCategory::LearnedLesson,
                            key: format!("auto-{}", uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("mem")),
                            content: content.clone(),
                            importance: 0.6,
                            access_count: 0,
                            last_accessed: Utc::now(),
                            created_at: Utc::now(),
                            related: vec![],
                            source: format!("agent:{}", agent_id),
                            tags,
                        };

                        let id = self.store(memory);
                        new_ids.push(id);
                        info!("MemoryStore: Auto-extracted memory '{}'", &content[..60.min(content.len())]);
                    }
                }
            }
        }

        new_ids
    }

    /// Learn from a failure/loop detection
    pub fn learn_from_failure(&self, agent_id: &str, task: &str, error_pattern: &[String]) {
        let memory = Memory {
            id: uuid::Uuid::new_v4().to_string(),
            category: MemoryCategory::ErrorPattern,
            key: format!("error-{}", agent_id),
            content: format!(
                "When attempting task '{}', the following pattern failed: {}. AVOID this approach.",
                task,
                error_pattern.join(" → ")
            ),
            importance: 0.8,
            access_count: 0,
            last_accessed: Utc::now(),
            created_at: Utc::now(),
            related: vec![],
            source: format!("agent:{}", agent_id),
            tags: vec!["error".into(), "anti-pattern".into()],
        };
        self.store(memory);
    }

    /// Get the most important memories for context injection
    pub fn get_context_memories(&self, query: &str, limit: usize) -> Vec<Memory> {
        self.query(&MemoryQuery {
            query: query.to_string(),
            category: None,
            min_importance: Some(0.5),
            max_results: limit,
            tags: None,
        })
    }

    /// Build a context string from relevant memories
    pub fn build_context(&self, query: &str, limit: usize) -> String {
        let memories = self.get_context_memories(query, limit);
        if memories.is_empty() {
            return String::new();
        }

        let mut ctx = String::from("## Relevant Memories\n\n");
        for m in &memories {
            ctx.push_str(&format!("- [{}] {}\n", m.category.as_str(), m.content));
        }
        ctx
    }

    pub fn get_all(&self) -> Vec<Memory> {
        self.memories.read().values().cloned().collect()
    }

    pub fn delete(&self, id: &str) {
        self.memories.write().remove(id);
    }

    pub fn clear(&self) {
        self.memories.write().clear();
        self.tag_index.write().clear();
    }

    pub fn count(&self) -> usize {
        self.memories.read().len()
    }
}
