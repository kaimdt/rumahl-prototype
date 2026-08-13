//! Source-level defense-in-depth checks complementing the helper's unit tests.
//! These deliberately fail if a future change introduces a shell interpreter
//! or a generic executable/argument field into the privileged protocol.

#[test]
fn privileged_helper_has_no_shell_escape_surface() {
    let source = include_str!("../src/main.rs");
    let production = source.split("#[cfg(test)]").next().unwrap();
    for forbidden in ["/bin/sh", "sh -c", "bash -c", "Command::new(binary)"] {
        if forbidden == "Command::new(binary)" {
            // The sole generic runner is private and receives binaries only
            // from closed match arms. It must never be exposed in Request.
            assert!(!production.contains("enum Request {\n    Exec"));
        } else {
            assert!(!production.contains(forbidden), "forbidden shell surface: {forbidden}");
        }
    }
    assert!(source.contains("deny_unknown_fields"));
    assert!(source.contains("peer_cred"));
    assert!(source.contains("O_NOFOLLOW"));
    assert!(source.contains("MAX_CONCURRENT_SCANS"));
    assert!(source.contains("SCAN_TIMEOUT"));
    assert!(source.contains("--max-recursion=16"));
    assert!(source.contains("--max-scansize=256M"));
    assert!(source.contains("/usr/bin/docker\", &[\"stop\""), "container isolation must cover host and custom networks");
}

#[test]
fn firewall_policy_cannot_flush_other_tables() {
    let source = include_str!("../../../../board/iora/post-build.sh");
    let baseline = source.split("firewall.nft\" <<'NFT'").nth(1).unwrap().split("\nNFT").next().unwrap();
    assert!(baseline.contains("hook forward priority -10; policy drop"));
    assert!(baseline.contains("docker*"));
    assert!(baseline.contains("ip6 saddr @blocked_v6"));
    assert!(!baseline.contains("flush ruleset"));
    assert!(source.contains("tcp dport 8126"), "lockdown must preserve rate-limited administrative recovery");
    assert!(source.contains("iora-security:x:919:919"), "security service needs a dedicated UID");
    assert!(source.contains("write_iora_service \"iora-security\" \"8095\" \"iora-security\""));
    assert!(source.contains("reserved security UID 919 is already assigned"));
}
