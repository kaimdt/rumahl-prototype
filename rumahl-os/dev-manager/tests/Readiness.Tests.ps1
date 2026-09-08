$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here "..\Readiness.psm1") -Force

Describe "rumahl readiness classification" {
    It "never reports Ready from a running process alone" {
        Get-rumahlLifecycle -Checks @{ Process=$true; Qmp=$false } | Should -Be "Starting"
    }

    It "waits for QGA before considering the VM booted" {
        Get-rumahlLifecycle -Checks @{ Process=$true; Qmp=$true; Qga=$false } | Should -Be "Booting"
    }

    It "reports degraded when internal health passes but host health fails" {
        $checks = @{ Process=$true; Qmp=$true; Qga=$true; Boot=$true; Systemd=$true; Network=$true; Dependencies=$true; Services=$true; InternalHome=$true; ExternalHome=$false; Sync=$true; Watcher=$true }
        Get-rumahlLifecycle -Checks $checks | Should -Be "Degraded"
        (Get-rumahlHomeDiagnosis -InternalHealthy $true -ExternalHealthy $false).Code | Should -Be "network-path"
    }

    It "reports Ready only after every required check passes" {
        $checks = @{ Process=$true; Qmp=$true; Qga=$true; Boot=$true; Systemd=$true; Network=$true; Dependencies=$true; Services=$true; InternalHome=$true; ExternalHome=$true; Sync=$true; Watcher=$true }
        Get-rumahlLifecycle -Checks $checks | Should -Be "Ready"
    }
}
