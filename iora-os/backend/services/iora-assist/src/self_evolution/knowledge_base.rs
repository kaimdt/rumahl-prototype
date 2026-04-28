// Knowledge Base - ORA stores and retrieves learned patterns and best practices
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// A knowledge entry storing a learned pattern or best practice
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeEntry {
    pub id: uuid::Uuid,
    pub topic: String,
    pub content: String,
    pub source: String,          // reflection, evolution_cycle, user_feedback, manual
    pub tags: Vec<String>,
    pub confidence: f64,         // 0.0 to 1.0, how confident ORA is in this knowledge
    pub times_applied: u32,      // how often this knowledge was successfully applied
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Engine for storing and retrieving learned knowledge
pub struct KnowledgeBase {
    db_pool: PgPool,
}

impl KnowledgeBase {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }

    /// Store a new knowledge entry
    pub async fn store(&self, topic: &str, content: &str, source: &str, tags: &[String]) -> Result<KnowledgeEntry, String> {
        let id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO knowledge_base (id, topic, content, source, tags, confidence, times_applied, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, 0.5, 0, NOW(), NOW())"
        )
        .bind(id)
        .bind(topic)
        .bind(content)
        .bind(source)
        .bind(tags)
        .execute(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

        Ok(KnowledgeEntry {
            id,
            topic: topic.to_string(),
            content: content.to_string(),
            source: source.to_string(),
            tags: tags.to_vec(),
            confidence: 0.5,
            times_applied: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
    }

    /// Search knowledge base for relevant entries
    pub async fn search(&self, query: &str, limit: i64) -> Result<Vec<KnowledgeEntry>, String> {
        let rows = sqlx::query_as::<_, (uuid::Uuid, String, String, String, Vec<String>, f64, i32, DateTime<Utc>, DateTime<Utc>)>(
            "SELECT id, topic, content, source, tags, confidence, times_applied, created_at, updated_at \
             FROM knowledge_base \
             WHERE to_tsvector('english', content || ' ' || topic) @@ plainto_tsquery('english', $1) \
             OR topic ILIKE $2 OR content ILIKE $2 \
             ORDER BY confidence DESC, times_applied DESC \
             LIMIT $3"
        )
        .bind(query)
        .bind(format!("%{}%", query))
        .bind(limit)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

        Ok(rows.into_iter().map(|r| KnowledgeEntry {
            id: r.0,
            topic: r.1,
            content: r.2,
            source: r.3,
            tags: r.4,
            confidence: r.5,
            times_applied: r.6 as u32,
            created_at: r.7,
            updated_at: r.8,
        }).collect())
    }

    /// Increase confidence when knowledge is successfully applied
    pub async fn record_application(&self, id: uuid::Uuid) -> Result<(), String> {
        sqlx::query(
            "UPDATE knowledge_base SET times_applied = times_applied + 1, \
             confidence = LEAST(1.0, confidence + 0.05), updated_at = NOW() WHERE id = $1"
        )
        .bind(id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
        Ok(())
    }

    /// Decrease confidence when knowledge leads to failure
    pub async fn record_failure(&self, id: uuid::Uuid) -> Result<(), String> {
        sqlx::query(
            "UPDATE knowledge_base SET confidence = GREATEST(0.0, confidence - 0.1), updated_at = NOW() WHERE id = $1"
        )
        .bind(id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
        Ok(())
    }

    /// Get knowledge by topic
    pub async fn get_by_topic(&self, topic: &str) -> Result<Vec<KnowledgeEntry>, String> {
        let rows = sqlx::query_as::<_, (uuid::Uuid, String, String, String, Vec<String>, f64, i32, DateTime<Utc>, DateTime<Utc>)>(
            "SELECT id, topic, content, source, tags, confidence, times_applied, created_at, updated_at \
             FROM knowledge_base WHERE topic = $1 ORDER BY confidence DESC LIMIT 20"
        )
        .bind(topic)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

        Ok(rows.into_iter().map(|r| KnowledgeEntry {
            id: r.0,
            topic: r.1,
            content: r.2,
            source: r.3,
            tags: r.4,
            confidence: r.5,
            times_applied: r.6 as u32,
            created_at: r.7,
            updated_at: r.8,
        }).collect())
    }
}
