use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
use uuid::Uuid;

pub const PROFILE_SCHEMA: &str = "ora.security-profile.v1";
pub const PROFILE_STORE_CAPACITY: usize = 4_096;
pub const OBSERVATION_CAPACITY: usize = 16_384;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ProfileSource {
    Learned,
    BuiltIn,
    AppManifest,
    Administrator,
}
impl ProfileSource {
    pub fn priority(self) -> u8 {
        match self {
            Self::Learned => 10,
            Self::BuiltIn => 20,
            Self::AppManifest => 30,
            Self::Administrator => 40,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Disposition {
    Observed,
    Expected,
    Allowed,
    Unusual,
    Forbidden,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessRule {
    pub name: String,
    pub disposition: Disposition,
    #[serde(default)]
    pub executable_hashes: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutableRule {
    pub path_prefix: String,
    pub disposition: Disposition,
    #[serde(default)]
    pub sha256: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkRule {
    pub direction: NetworkDirection,
    pub protocol: String,
    pub port: Option<u16>,
    pub destination: Option<String>,
    pub disposition: Disposition,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkDirection {
    Inbound,
    Outbound,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FilesystemRule {
    pub operation: FilesystemOperation,
    pub path_prefix: String,
    pub disposition: Disposition,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilesystemOperation {
    Read,
    Write,
    Execute,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RuntimeRules {
    pub shell_execution: Option<Disposition>,
    pub interpreter_execution: Option<Disposition>,
    pub executable_from_tmp: Option<Disposition>,
    pub child_process_depth: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecurityProfile {
    pub schema_version: String,
    pub profile_id: Uuid,
    pub profile_version: u64,
    pub subject_type: String,
    pub subject_id: String,
    pub source: ProfileSource,
    pub source_reference: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub processes: Vec<ProcessRule>,
    #[serde(default)]
    pub executables: Vec<ExecutableRule>,
    #[serde(default)]
    pub network: Vec<NetworkRule>,
    #[serde(default)]
    pub filesystem: Vec<FilesystemRule>,
    #[serde(default)]
    pub runtime: RuntimeRules,
}
impl SecurityProfile {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != PROFILE_SCHEMA {
            return Err("unsupported profile schema".into());
        }
        if self.profile_version == 0 || self.subject_id.trim().is_empty() {
            return Err("profile version and subject are required".into());
        }
        if !matches!(self.subject_type.as_str(), "app" | "system_service") {
            return Err("profile subject type must be app or system_service".into());
        }
        if self.source == ProfileSource::AppManifest
            && !self
                .source_reference
                .as_deref()
                .is_some_and(|reference| reference.starts_with("signature:"))
        {
            return Err("app manifest profiles require a verified signature reference".into());
        }
        if self.source == ProfileSource::Learned
            && self
                .dispositions()
                .any(|value| value != Disposition::Observed)
        {
            return Err("learned profiles may only contain observed behavior".into());
        }
        Ok(())
    }
    fn dispositions(&self) -> impl Iterator<Item = Disposition> + '_ {
        self.processes
            .iter()
            .map(|r| r.disposition)
            .chain(self.executables.iter().map(|r| r.disposition))
            .chain(self.network.iter().map(|r| r.disposition))
            .chain(self.filesystem.iter().map(|r| r.disposition))
            .chain(self.runtime.shell_execution)
            .chain(self.runtime.interpreter_execution)
            .chain(self.runtime.executable_from_tmp)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSnapshot {
    pub snapshot_id: Uuid,
    pub subject_id: String,
    pub component_versions: Vec<ProfileReference>,
    pub effective: SecurityProfile,
    pub resolved_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileReference {
    pub profile_id: Uuid,
    pub profile_version: u64,
    pub source: ProfileSource,
}

#[derive(Default)]
pub struct ProfileStore {
    profiles: HashMap<String, BTreeMap<(u8, u64), SecurityProfile>>,
    order: VecDeque<(String, (u8, u64))>,
}
impl ProfileStore {
    pub fn insert(&mut self, profile: SecurityProfile) -> Result<(), String> {
        profile.validate()?;
        let key = (profile.source.priority(), profile.profile_version);
        let subject = profile.subject_id.clone();
        if self
            .profiles
            .get(&subject)
            .and_then(|p| p.get(&key))
            .is_some()
        {
            return Err("immutable profile version already exists".into());
        }
        while self.order.len() >= PROFILE_STORE_CAPACITY {
            if let Some((old_subject, old_key)) = self.order.pop_front() {
                if let Some(items) = self.profiles.get_mut(&old_subject) {
                    items.remove(&old_key);
                }
            }
        }
        self.order.push_back((subject.clone(), key));
        self.profiles
            .entry(subject)
            .or_default()
            .insert(key, profile);
        Ok(())
    }
    pub fn snapshot(&self, subject: &str) -> Option<ProfileSnapshot> {
        let items = self.profiles.get(subject)?;
        let mut ordered: Vec<_> = items.values().collect();
        ordered.sort_by_key(|p| p.source.priority());
        let mut effective = (*ordered.first()?).clone();
        let mut refs = Vec::new();
        for profile in ordered {
            refs.push(ProfileReference {
                profile_id: profile.profile_id,
                profile_version: profile.profile_version,
                source: profile.source,
            });
            merge(&mut effective, profile);
        }
        effective.profile_id = Uuid::new_v4();
        effective.profile_version = refs.iter().map(|r| r.profile_version).max().unwrap_or(1);
        effective.source = refs
            .last()
            .map(|r| r.source)
            .unwrap_or(ProfileSource::BuiltIn);
        Some(ProfileSnapshot {
            snapshot_id: Uuid::new_v4(),
            subject_id: subject.into(),
            component_versions: refs,
            effective,
            resolved_at: Utc::now().to_rfc3339(),
        })
    }
}
fn merge(target: &mut SecurityProfile, source: &SecurityProfile) {
    for rule in &source.processes {
        replace(&mut target.processes, rule.clone(), |r| r.name.clone())
    }
    for rule in &source.executables {
        replace(&mut target.executables, rule.clone(), |r| {
            r.path_prefix.clone()
        })
    }
    for rule in &source.network {
        replace(&mut target.network, rule.clone(), |r| {
            format!(
                "{:?}:{}:{:?}:{:?}",
                r.direction, r.protocol, r.port, r.destination
            )
        })
    }
    for rule in &source.filesystem {
        replace(&mut target.filesystem, rule.clone(), |r| {
            format!("{:?}:{}", r.operation, r.path_prefix)
        })
    }
    if source.runtime.shell_execution.is_some() {
        target.runtime.shell_execution = source.runtime.shell_execution
    }
    if source.runtime.interpreter_execution.is_some() {
        target.runtime.interpreter_execution = source.runtime.interpreter_execution
    }
    if source.runtime.executable_from_tmp.is_some() {
        target.runtime.executable_from_tmp = source.runtime.executable_from_tmp
    }
    if source.runtime.child_process_depth.is_some() {
        target.runtime.child_process_depth = source.runtime.child_process_depth
    }
}
fn replace<T, F, K>(items: &mut Vec<T>, value: T, key: F)
where
    F: Fn(&T) -> K,
    K: PartialEq,
{
    let wanted = key(&value);
    if let Some(index) = items.iter().position(|item| key(item) == wanted) {
        items[index] = value
    } else {
        items.push(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub event_id: Uuid,
    pub subject_id: String,
    pub behavior_key: String,
    pub observed_at: String,
    pub identity_confidence: String,
}
#[derive(Default)]
pub struct ObservationStore {
    pub values: VecDeque<Observation>,
    pub dropped: u64,
}
impl ObservationStore {
    pub fn record(&mut self, value: Observation) {
        while self.values.len() >= OBSERVATION_CAPACITY {
            self.values.pop_front();
            self.dropped += 1
        }
        self.values.push_back(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(source: ProfileSource, version: u64, disposition: Disposition) -> SecurityProfile {
        SecurityProfile {
            schema_version: PROFILE_SCHEMA.into(),
            profile_id: Uuid::new_v4(),
            profile_version: version,
            subject_type: "app".into(),
            subject_id: "nextcloud".into(),
            source,
            source_reference: None,
            created_at: Utc::now().to_rfc3339(),
            processes: vec![ProcessRule {
                name: "php-fpm".into(),
                disposition,
                executable_hashes: vec![],
            }],
            executables: vec![],
            network: vec![],
            filesystem: vec![],
            runtime: RuntimeRules::default(),
        }
    }
    #[test]
    fn administrator_overrides_lower_sources() {
        let mut s = ProfileStore::default();
        s.insert(p(ProfileSource::BuiltIn, 1, Disposition::Expected))
            .unwrap();
        s.insert(p(ProfileSource::Administrator, 2, Disposition::Forbidden))
            .unwrap();
        assert_eq!(
            s.snapshot("nextcloud").unwrap().effective.processes[0].disposition,
            Disposition::Forbidden
        )
    }
    #[test]
    fn versions_are_immutable() {
        let mut s = ProfileStore::default();
        let profile = p(ProfileSource::BuiltIn, 1, Disposition::Expected);
        s.insert(profile.clone()).unwrap();
        assert!(s.insert(profile).is_err())
    }
    #[test]
    fn learned_cannot_become_trusted() {
        let mut profile = p(ProfileSource::Learned, 1, Disposition::Expected);
        assert!(profile.validate().is_err());
        profile.processes[0].disposition = Disposition::Observed;
        assert!(profile.validate().is_ok())
    }
    #[test]
    fn unsigned_app_manifest_is_rejected() {
        let mut profile = p(ProfileSource::AppManifest, 1, Disposition::Expected);
        assert!(profile.validate().is_err());
        profile.source_reference = Some("signature:verified-manifest-digest".into());
        assert!(profile.validate().is_ok());
    }
}
