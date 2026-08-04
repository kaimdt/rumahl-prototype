Set-StrictMode -Version Latest

function Invoke-IoraTcpJson {
    param([int]$Port, [string[]]$Messages, [switch]$QmpHandshake, [int]$TimeoutSeconds = 8)
    $client = $null
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $connect = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne(2000)) { return $null }
        $client.EndConnect($connect)
        $stream = $client.GetStream()
        $stream.ReadTimeout = $TimeoutSeconds * 1000
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8)
        $writer = [System.IO.StreamWriter]::new($stream, [System.Text.Encoding]::UTF8)
        $writer.NewLine = "`n"; $writer.AutoFlush = $true
        if ($QmpHandshake) {
            [void]$reader.ReadLine()
            $writer.WriteLine('{"execute":"qmp_capabilities"}')
            [void]$reader.ReadLine()
        }
        $response = $null
        foreach ($message in $Messages) { $writer.WriteLine($message); $response = $reader.ReadLine() }
        return $response
    } catch { return $null } finally { if ($client) { $client.Dispose() } }
}

function Invoke-IoraQmp {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Command)
    Invoke-IoraTcpJson -Port ([int]$State.qmpPort) -Messages @($Command) -QmpHandshake
}

function Test-IoraQmp {
    param([Parameter(Mandatory)]$State)
    $response = Invoke-IoraQmp -State $State -Command '{"execute":"query-status"}'
    return [bool]($response -and $response -match '"return"')
}

function Invoke-IoraQgaJson {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Json, [int]$TimeoutSeconds = 10)
    Invoke-IoraTcpJson -Port ([int]$State.qgaPort) -Messages @($Json) -TimeoutSeconds $TimeoutSeconds
}

function Test-IoraQga {
    param([Parameter(Mandatory)]$State)
    $response = Invoke-IoraQgaJson -State $State -Json '{"execute":"guest-ping"}'
    return [bool]($response -and $response -match '"return"')
}

function Invoke-IoraQgaExec {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Command, [int]$TimeoutSeconds = 60)
    $encodedCommand = $Command | ConvertTo-Json -Compress
    $start = Invoke-IoraQgaJson -State $State -Json ('{"execute":"guest-exec","arguments":{"path":"/bin/sh","arg":["-c",' + $encodedCommand + '],"capture-output":true}}')
    try { $guestPid = ($start | ConvertFrom-Json).return.pid } catch { return $null }
    if (-not $guestPid) { return $null }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 350
        $status = Invoke-IoraQgaJson -State $State -Json ('{"execute":"guest-exec-status","arguments":{"pid":' + $guestPid + '}}')
        try { $result = $status | ConvertFrom-Json } catch { continue }
        $exitProperty = $result.return.PSObject.Properties["exitcode"]
        if ($null -eq $exitProperty) { continue }
        $exitCode = [int]$exitProperty.Value
        $stdout = ""; $stderr = ""
        $outProperty = $result.return.PSObject.Properties["out-data"]
        $errProperty = $result.return.PSObject.Properties["err-data"]
        if ($outProperty -and $outProperty.Value) { $stdout = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($outProperty.Value)) }
        if ($errProperty -and $errProperty.Value) { $stderr = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($errProperty.Value)) }
        return [pscustomobject]@{ ExitCode = $exitCode; StdOut = $stdout; StdErr = $stderr }
    }
    return $null
}

function Get-IoraGuestIp {
    param([Parameter(Mandatory)]$State)
    $result = Invoke-IoraQgaExec -State $State -Command "ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1" -TimeoutSeconds 8
    if ($result -and $result.StdOut -match '(?<![0-9])((?:[0-9]{1,3}\.){3}[0-9]{1,3})(?![0-9])') { return $Matches[1] }
    return $null
}

Export-ModuleMember -Function Invoke-IoraQmp, Test-IoraQmp, Invoke-IoraQgaJson, Test-IoraQga, Invoke-IoraQgaExec, Get-IoraGuestIp
