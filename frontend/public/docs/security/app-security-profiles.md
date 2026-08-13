# App Security Profiles 2.3

The machine-readable schema is shipped as `/usr/share/iora/security/profile-v1.schema.json`. `iora-runtime-policy` loads versioned `ora.security-profile.v1` documents from `/etc/iora/security-profiles`. Profiles describe expected behavior for ORA apps and system services; they never contain or execute enforcement actions.

Rules cover processes, executable path prefixes and hashes, inbound/outbound network behavior, sensitive filesystem reads/writes/execution, shells, interpreters, execution from `/tmp`, and child-process depth. Each behavior is classified as `expected`, `allowed`, `unusual`, or `forbidden`. Learning observations remain `observed` and validation rejects any learned profile that attempts to mark behavior trusted.

Profile sources are merged in ascending authority: `learned`, `built_in`, verified signed `app_manifest`, then `administrator`. App-manifest profiles without a verified signature reference are rejected. Higher-authority rules replace only matching lower-authority rules. Thus learned behavior cannot override a manifest, built-in profile, or administrator decision.

Every source profile is immutable by `(subject, source, version)`. Evaluation uses a profile snapshot containing a unique snapshot ID and references to every contributing profile ID and version. Historical detection results therefore remain explainable after later profile changes.

The in-memory profile registry is bounded to 4,096 immutable versions. Observation learning storage is bounded to 16,384 records and reports dropped observations. Observation ingestion never promotes observations into trusted rules automatically.
