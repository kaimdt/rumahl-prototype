$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here "..\VmLifecycle.psm1") -Force

Describe "IORA VM manager settings" {
    It "persists VM resources and network mode independently of dev-local parameters" {
        $path = Join-Path $TestDrive "dev-manager-settings.json"
        $settings = Get-IoraManagerSettings -Path $path
        $settings.networkMode = "bridge"
        $settings.ram = "12GB"
        $settings.cpuCount = 6
        $settings.autoWatcher = $false
        $settings.autoSync = $false
        Save-IoraManagerSettings -Settings $settings -Path $path

        $loaded = Get-IoraManagerSettings -Path $path
        $loaded.networkMode | Should -Be "bridge"
        $loaded.ram | Should -Be "12GB"
        $loaded.cpuCount | Should -Be 6
        $loaded.autoWatcher | Should -BeFalse
        $loaded.autoSync | Should -BeFalse
    }
}
