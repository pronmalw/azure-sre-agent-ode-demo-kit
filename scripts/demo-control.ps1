<#
.SYNOPSIS
    Demo control for the Contoso Retail SRE Agent demo kit.

.DESCRIPTION
    Wraps the chaos, ops and verification endpoints so a demo can be driven
    from one command instead of a handful of curl calls.

.EXAMPLE
    .\demo-control.ps1 status
    .\demo-control.ps1 baseline
    .\demo-control.ps1 scenario hotPartition
    .\demo-control.ps1 allon
    .\demo-control.ps1 reset
    .\demo-control.ps1 verify
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'baseline', 'scenario', 'allon', 'reset', 'verify', 'loadstart', 'loadstop', 'list')]
    [string]$Action = 'status',

    [Parameter(Position = 1)]
    [string]$Name,

    [string]$BaseUrl = 'http://48.207.241.23',

    # Seconds to wait after a change before reading telemetry back.
    [int]$SettleSeconds = 60
)

$ErrorActionPreference = 'Stop'

$Toggles = @(
    'hotPartition', 'metadataThrottling', 'multipleClients', 'crossPartitionQuery',
    'largeDocument', 'missingIndexing', 'pointReadMisuse', 'highCpu',
    'sqlSlowQuery', 'sqlConnectionPressure', 'vpnConnectivityIssue'
)

# Scenarios whose effect is proven by infrastructure telemetry rather than by
# the application declaring its own state. Lead a demo with these.
$StronglyEvidenced = @('hotPartition', 'highCpu', 'sqlSlowQuery', 'vpnConnectivityIssue')

# vpnConnectivityIssue drives a real IPsec re-key through ARM. Breaking or
# healing it is slow and the reading is cached for 15s on top of that.
$SlowToggles = @('vpnConnectivityIssue')

function Invoke-Api {
    param([string]$Method, [string]$Path, [int]$TimeoutSec = 120)
    try {
        return Invoke-RestMethod -Method $Method -Uri "$BaseUrl$Path" -TimeoutSec $TimeoutSec
    } catch {
        Write-Host "  ! $Method $Path failed: $($_.Exception.Message)" -ForegroundColor Red
        throw
    }
}

function Write-Banner {
    param([string]$Text)
    Write-Host ''
    Write-Host ('=' * 66) -ForegroundColor DarkCyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ('=' * 66) -ForegroundColor DarkCyan
}

function Show-Status {
    $ops = Invoke-Api GET '/api/ops'
    $t = $ops.telemetrySnapshot

    Write-Host ''
    Write-Host '  Load generator : ' -NoNewline
    if ($ops.loadGenerator.running) {
        Write-Host "RUNNING at $($ops.loadGenerator.rps) rps" -ForegroundColor Green
    } else {
        Write-Host 'STOPPED   <-- SQL and VPN signals will read zero' -ForegroundColor Red
    }

    Write-Host '  Active toggles : ' -NoNewline
    if ($t.activeToggles.Count -eq 0) {
        Write-Host 'none (healthy)' -ForegroundColor Green
    } else {
        Write-Host "$($t.activeToggles.Count) -> $($t.activeToggles -join ', ')" -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '  Measured telemetry' -ForegroundColor White

    $rows = @(
        @{ n = 'p99 latency';      v = $t.latencyP99Ms;              u = 'ms'; bad = { param($x) $x -ge 200 } }
        @{ n = 'p50 latency';      v = $t.latencyP50Ms;              u = 'ms'; bad = { param($x) $x -ge 100 } }
        @{ n = 'Cosmos 429s';      v = $t.cosmos429Count;            u = '';   bad = { param($x) $x -gt 0 } }
        @{ n = 'RU usage';         v = $t.ruUsage;                   u = 'RU'; bad = { param($x) $x -ge 50 } }
        @{ n = 'Host CPU';         v = $t.hostCpuPercent;            u = '%';  bad = { param($x) $x -ge 30 } }
        @{ n = 'SQL latency';      v = $t.sqlQueryLatencyMs;         u = 'ms'; bad = { param($x) $x -ge 200 } }
        @{ n = 'SQL errors';       v = $t.sqlErrorCount;             u = '';   bad = { param($x) $x -gt 0 } }
        @{ n = 'Packet loss';      v = $t.networkPacketLossPercent;  u = '%';  bad = { param($x) $x -gt 0 } }
        @{ n = 'Checkout success'; v = $t.checkoutSuccessRate;       u = '';   bad = { param($x) $x -lt 1 } }
    )

    foreach ($r in $rows) {
        $isBad = & $r.bad $r.v
        $colour = if ($isBad) { 'Yellow' } else { 'Green' }
        Write-Host ('    {0,-18} {1,10} {2}' -f $r.n, $r.v, $r.u) -ForegroundColor $colour
    }

    Write-Host ('    {0,-18} {1,10}' -f 'VPN tunnel', $t.vpnTunnelStatus) -ForegroundColor $(
        if ($t.vpnTunnelStatus -eq 'connected') { 'Green' } else { 'Yellow' })
    Write-Host ''
    Write-Host "  Snapshot taken $($t.timestamp)" -ForegroundColor DarkGray
}

function Wait-Settle {
    param([int]$Seconds, [string]$Because)
    Write-Host ''
    Write-Host "  Waiting ${Seconds}s $Because" -ForegroundColor DarkGray
    for ($i = $Seconds; $i -gt 0; $i -= 5) {
        Write-Host ('    {0,3}s remaining' -f $i) -NoNewline -ForegroundColor DarkGray
        Write-Host "`r" -NoNewline
        Start-Sleep -Seconds ([Math]::Min(5, $i))
    }
    Write-Host '                      '
}

switch ($Action) {

    'list' {
        Write-Banner 'Available scenarios'
        foreach ($t in $Toggles) {
            $tag = if ($StronglyEvidenced -contains $t) { '[strong evidence]' } else { '[self-reported]' }
            $colour = if ($StronglyEvidenced -contains $t) { 'Green' } else { 'DarkGray' }
            $slow = if ($SlowToggles -contains $t) { '  (slow: allow 2-4 min)' } else { '' }
            Write-Host ('  {0,-24} {1}{2}' -f $t, $tag, $slow) -ForegroundColor $colour
        }
        Write-Host ''
        Write-Host '  Lead your demo with the four strongly evidenced scenarios.' -ForegroundColor Cyan
        Write-Host '  They survive the question "how would the agent know without being told?"' -ForegroundColor Cyan
    }

    'status' {
        Write-Banner 'Current state'
        Show-Status
    }

    'loadstart' {
        Write-Banner 'Starting load generator'
        Invoke-Api POST '/api/ops/load/start' | Out-Null
        Write-Host '  Load generator started at 12 rps.' -ForegroundColor Green
    }

    'loadstop' {
        Write-Banner 'Stopping load generator'
        Invoke-Api POST '/api/ops/load/stop' | Out-Null
        Write-Host '  Load generator stopped.' -ForegroundColor Yellow
    }

    'reset' {
        Write-Banner 'Resetting to healthy'
        Write-Host '  Clearing all chaos toggles...' -ForegroundColor White
        Write-Host '  (if the VPN was broken this re-keys the tunnel and can take 2-4 min)' -ForegroundColor DarkGray
        Invoke-Api POST '/api/chaos/reset' -TimeoutSec 300 | Out-Null
        Write-Host '  All toggles cleared.' -ForegroundColor Green
        Wait-Settle -Seconds $SettleSeconds -Because 'for telemetry to return to baseline'
        Show-Status
    }

    'baseline' {
        Write-Banner 'Preparing a clean baseline'
        Write-Host '  1/3 clearing chaos toggles...' -ForegroundColor White
        Invoke-Api POST '/api/chaos/reset' -TimeoutSec 300 | Out-Null
        Write-Host '  2/3 starting load generator...' -ForegroundColor White
        Invoke-Api POST '/api/ops/load/start' | Out-Null
        Write-Host '  3/3 letting the system settle...' -ForegroundColor White
        Wait-Settle -Seconds $SettleSeconds -Because 'so the "before" picture is real'
        Show-Status
        Write-Host ''
        Write-Host '  This is your "before" screenshot. Take it now.' -ForegroundColor Cyan
    }

    'scenario' {
        if (-not $Name) { throw "Specify a scenario name. Run: .\demo-control.ps1 list" }
        if ($Toggles -notcontains $Name) { throw "Unknown scenario '$Name'. Run: .\demo-control.ps1 list" }

        Write-Banner "Scenario: $Name"

        Write-Host '  Clearing any previous chaos so this scenario stands alone...' -ForegroundColor White
        Invoke-Api POST '/api/chaos/reset' -TimeoutSec 300 | Out-Null

        $ops = Invoke-Api GET '/api/ops'
        if (-not $ops.loadGenerator.running) {
            Write-Host '  Load generator was off. Starting it.' -ForegroundColor Yellow
            Invoke-Api POST '/api/ops/load/start' | Out-Null
        }

        Write-Host "  Enabling $Name..." -ForegroundColor White
        Invoke-Api POST "/api/chaos/$Name/on" -TimeoutSec 300 | Out-Null

        $wait = if ($SlowToggles -contains $Name) { [Math]::Max($SettleSeconds, 180) } else { $SettleSeconds }
        Wait-Settle -Seconds $wait -Because 'for the fault to show up in telemetry'

        Show-Status

        if ($StronglyEvidenced -contains $Name) {
            Write-Host ''
            Write-Host '  This scenario has independent infrastructure evidence.' -ForegroundColor Green
            Write-Host '  Safe to claim the agent detected it without being told.' -ForegroundColor Green
        } else {
            Write-Host ''
            Write-Host '  Note: this scenario is corroborated mainly by the application' -ForegroundColor DarkYellow
            Write-Host '  reporting its own state. Aggregate RU will rise, but the specific' -ForegroundColor DarkYellow
            Write-Host '  anti-pattern is identified from the declared toggle. Say so if asked.' -ForegroundColor DarkYellow
        }
    }

    'allon' {
        Write-Banner 'Enabling all 11 scenarios (full mixed incident)'
        $ops = Invoke-Api GET '/api/ops'
        if (-not $ops.loadGenerator.running) {
            Write-Host '  Starting load generator first...' -ForegroundColor Yellow
            Invoke-Api POST '/api/ops/load/start' | Out-Null
        }

        foreach ($t in $Toggles) {
            Write-Host ("  enabling {0,-24}" -f $t) -NoNewline -ForegroundColor White
            try {
                Invoke-Api POST "/api/chaos/$t/on" -TimeoutSec 300 | Out-Null
                Write-Host 'ok' -ForegroundColor Green
            } catch {
                Write-Host 'FAILED' -ForegroundColor Red
            }
        }

        Wait-Settle -Seconds ([Math]::Max($SettleSeconds, 120)) -Because 'for all faults to register (VPN is the slow one)'
        Show-Status
        Write-Host ''
        Write-Host '  Now run the triage prompt in the Azure SRE Agent.' -ForegroundColor Cyan
        Write-Host '  See docs/sre-agent-demo-prompt.md' -ForegroundColor Cyan
    }

    'verify' {
        Write-Banner 'Recovery verification'
        $result = Invoke-Api POST '/api/sre-agent/verify-recovery' -TimeoutSec 120
        Write-Host ''
        foreach ($c in $result.checks) {
            $mark = if ($c.pass) { 'PASS' } else { 'FAIL' }
            $colour = if ($c.pass) { 'Green' } else { 'Red' }
            Write-Host ('  [{0}] {1}' -f $mark, $c.criterion) -ForegroundColor $colour
        }
        Write-Host ''
        if ($result.recovered) {
            Write-Host '  RECOVERED - all checks pass.' -ForegroundColor Green
        } else {
            $failed = ($result.checks | Where-Object { -not $_.pass }).Count
            Write-Host "  NOT RECOVERED - $failed check(s) still failing." -ForegroundColor Yellow
            Write-Host '  If you just reset, wait 60s and run verify again.' -ForegroundColor DarkGray
            Write-Host '  The VPN in particular can take 2-4 minutes to re-establish.' -ForegroundColor DarkGray
        }
    }
}

Write-Host ''
