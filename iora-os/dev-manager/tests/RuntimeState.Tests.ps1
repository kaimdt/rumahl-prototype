$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here "..\RuntimeState.psm1") -Force

Describe "IORA runtime state" {
    It "uses a forwarded SSH port for Slirp" {
        $state = [pscustomobject](New-IoraRuntimeState -CachePath $TestDrive)
        $state.sshPort = 2244
        $connection = Get-IoraConnection -State $state
        $connection.Host | Should -Be "127.0.0.1"
        $connection.SshPort | Should -Be 2244
    }

    It "always uses port 22 with the current bridge IP" {
        $state = [pscustomobject](New-IoraRuntimeState -CachePath $TestDrive)
        $state.networkMode = "bridge"
        $state.vmHost = "192.168.1.84"
        $state.sshPort = 2222
        $connection = Get-IoraConnection -State $state
        $connection.Host | Should -Be "192.168.1.84"
        $connection.SshPort | Should -Be 22
    }

    It "round-trips the persisted runtime state" {
        $path = Join-Path $TestDrive "runtime-state.json"
        $state = [pscustomobject](New-IoraRuntimeState -CachePath $TestDrive)
        $state.networkMode = "bridge"; $state.vmHost = "10.0.0.42"; $state.qgaPort = 8110
        Save-IoraRuntimeState -State $state -Path $path
        $loaded = Read-IoraRuntimeState -Path $path
        $loaded.vmHost | Should -Be "10.0.0.42"
        $loaded.qgaPort | Should -Be 8110
    }
}
