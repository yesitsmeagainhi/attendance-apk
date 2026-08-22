<#
.SYNOPSIS
  Reports which Android devices adb can see, and why a plugged-in phone might be missing.

.DESCRIPTION
  Checks three layers, because they fail differently:
    1. adb          - can we talk to the device?
    2. device state - connected but 'unauthorized' (prompt not accepted) or 'offline'?
    3. Windows PnP  - does the OS see a phone at all? If not, the fault is the
                      cable or USB mode, not adb or USB debugging.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\check-devices.ps1

.EXAMPLE
  # Wait until a physical phone appears, then continue
  powershell -ExecutionPolicy Bypass -File scripts\check-devices.ps1 -WaitForPhysical
#>
[CmdletBinding()]
param(
    # Block until a non-emulator device is connected and authorized.
    [switch]$WaitForPhysical,
    # How long to wait, in seconds, when -WaitForPhysical is used.
    [int]$TimeoutSeconds = 180,
    # Path to adb, if it is not in the default SDK location.
    [string]$Adb = 'C:\Android\sdk\platform-tools\adb.exe'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Adb)) {
    Write-Host "adb not found at $Adb" -ForegroundColor Red
    Write-Host "Pass -Adb <path>, or install platform-tools." -ForegroundColor Yellow
    exit 2
}

function Get-Devices {
    # `adb devices` prints "<serial>\t<state>" after a header line.
    $out = & $Adb devices 2>$null
    $rows = @()
    foreach ($line in $out) {
        if ($line -match '^(\S+)\s+(device|unauthorized|offline|no permissions.*)$') {
            $serial = $Matches[1]
            $state = $Matches[2]
            $rows += [pscustomobject]@{
                Serial     = $serial
                State      = $state
                IsEmulator = $serial -like 'emulator-*'
            }
        }
    }
    return $rows
}

function Get-DeviceInfo($serial) {
    $prop = { param($k) (& $Adb -s $serial shell getprop $k 2>$null) -join '' }
    [pscustomobject]@{
        Brand   = (& $prop 'ro.product.brand').Trim()
        Model   = (& $prop 'ro.product.model').Trim()
        Android = (& $prop 'ro.build.version.release').Trim()
        Sdk     = (& $prop 'ro.build.version.sdk').Trim()
    }
}

function Show-Report {
    $devices = Get-Devices

    if ($devices.Count -eq 0) {
        Write-Host "No devices visible to adb." -ForegroundColor Red
    }

    foreach ($d in $devices) {
        switch ($d.State) {
            'device' {
                $i = Get-DeviceInfo $d.Serial
                $kind = if ($d.IsEmulator) { 'emulator' } else { 'PHYSICAL' }
                $colour = if ($d.IsEmulator) { 'Gray' } else { 'Green' }
                Write-Host ("  [{0}] {1,-22} {2} {3} - Android {4} (API {5})" -f
                    $kind, $d.Serial, $i.Brand, $i.Model, $i.Android, $i.Sdk) -ForegroundColor $colour
            }
            'unauthorized' {
                Write-Host ("  [BLOCKED]  {0}" -f $d.Serial) -ForegroundColor Yellow
                Write-Host "             Accept the 'Allow USB debugging?' prompt on the phone." -ForegroundColor Yellow
            }
            'offline' {
                Write-Host ("  [OFFLINE]  {0}" -f $d.Serial) -ForegroundColor Yellow
                Write-Host "             Unplug and replug, or run: adb kill-server; adb start-server" -ForegroundColor Yellow
            }
            default {
                Write-Host ("  [{0}] {1}" -f $d.State, $d.Serial) -ForegroundColor Yellow
            }
        }
    }

    return $devices
}

Write-Host "`nDevices adb can see" -ForegroundColor Cyan
Write-Host "-------------------"
$devices = Show-Report

$physical = @($devices | Where-Object { -not $_.IsEmulator -and $_.State -eq 'device' })

# If adb sees no phone, find out whether Windows sees one. That single check
# separates "USB debugging is off" from "the cable carries no data".
if ($physical.Count -eq 0) {
    Write-Host "`nIs a phone visible to Windows at all?" -ForegroundColor Cyan
    Write-Host "-------------------------------------"

    $pnp = @()
    try {
        $pnp = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Class -in @('AndroidUsbDeviceClass', 'WPD') -or
                $_.FriendlyName -match 'Android|ADB|Samsung|Xiaomi|Redmi|POCO|OnePlus|Realme|Vivo|Oppo|Motorola|Pixel|Nothing'
            }
    } catch { }

    if ($pnp.Count -gt 0) {
        foreach ($p in $pnp) {
            Write-Host ("  {0,-8} {1}" -f $p.Status, $p.FriendlyName) -ForegroundColor Yellow
        }
        Write-Host "`n  Windows sees a phone but adb does not." -ForegroundColor Yellow
        Write-Host "  -> Enable Developer options (tap Build number 7x), then USB debugging."
        Write-Host "  -> Set the USB mode to 'File transfer / MTP', not 'Charging only'."
    } else {
        Write-Host "  Nothing. Windows detects no phone on USB." -ForegroundColor Red
        Write-Host "`n  The fault is below adb, so USB debugging settings are not the cause:" -ForegroundColor Yellow
        Write-Host "  -> Try a different cable. Many bundled cables are charge-only."
        Write-Host "  -> Try another USB port, ideally directly on the machine."
        Write-Host "  -> On the phone, set USB mode to 'File transfer / MTP'."
        Write-Host "  -> Or use wireless: Developer options > Wireless debugging > Pair with code,"
        Write-Host "     then: adb pair <ip>:<port>   and   adb connect <ip>:<port>"
    }
}

if ($WaitForPhysical -and $physical.Count -eq 0) {
    Write-Host "`nWaiting for a physical device (timeout ${TimeoutSeconds}s)..." -ForegroundColor Cyan
    $waited = 0
    while ($waited -lt $TimeoutSeconds) {
        Start-Sleep -Seconds 3
        $waited += 3
        $found = @(Get-Devices | Where-Object { -not $_.IsEmulator -and $_.State -eq 'device' })
        if ($found.Count -gt 0) {
            Write-Host "`nConnected:" -ForegroundColor Green
            Show-Report | Out-Null
            exit 0
        }
    }
    Write-Host "Timed out after ${TimeoutSeconds}s - still no physical device." -ForegroundColor Red
    exit 1
}

Write-Host ""
if ($physical.Count -gt 0) {
    Write-Host ("Ready: {0} physical device(s) connected." -f $physical.Count) -ForegroundColor Green
    exit 0
} else {
    Write-Host "No physical device connected (emulator only)." -ForegroundColor Yellow
    exit 1
}
