# Registers (or re-registers) the Windows Task Scheduler entry that runs scripts/crawl-local.ts
# for every `crawlFrom: "local"` site from this machine - ISSTA (serves Vercel's address a page
# without its cards) and, since 2026-09-28, LiveEvents (its concerts board answers Vercel with no
# rows) - so those catalogs are refreshed from an Israeli connection instead (see crawlFrom in
# lib/services/competitor-scrapers/types.ts). The sites run one after the other in the same task,
# each with its own log; one failing never stops the next.
#
#   powershell -ExecutionPolicy Bypass -File scripts/crawl-local-task.ps1 [-Time 03:30] [-Remove]
#
# Runs DAILY: the script itself checks whether each site is due (its intervalHours since the
# last real run) and otherwise spends the day on a details pass or exits at once. A daily trigger with "start when available" is
# what survives a machine that is off some days - a missed day runs as soon as the machine is
# back on, and the due check turns that into "every ~3 days" without a stateful schedule.
# The task runs as the current user, only while logged on (locked is fine), only with network,
# capped at 30 minutes, and never in parallel with itself. Output lands in
# %LOCALAPPDATA%\MYT\crawl-logs\<site>.log; Task Scheduler's "Last Run Result" is the LAST site's
# exit code (0 = ok / not due, 1 = blocked / error / crash) - read each site's log for the rest.
param(
  [string]$Time = "03:30",
  [string]$TaskName = "MYT price-light local crawl",
  [string[]]$Sites = @("issta", "liveevents"),
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "removed task '$TaskName'"
  exit 0
}

$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo ".env.local"))) { throw "no .env.local in $repo - the crawl needs the Supabase service key" }
$npx = (Get-Command npx.cmd -ErrorAction Stop).Source   # resolved now: the task's PATH is not this shell's
$logDir = Join-Path $env:LOCALAPPDATA "MYT\crawl-logs"
New-Item -ItemType Directory -Force $logDir | Out-Null

# The task creates the log directory ITSELF, every run: a directory made by whoever runs this
# registration may not exist for the task's process (a sandboxed shell, e.g. Claude Code's, writes
# AppData\Local into an overlay the real process cannot see - the task then exits 1 on the
# redirect before the script ever starts). The chain is grouped so the log also catches a failing
# `cd` or a missing npx, not only the script's own output.
# `&` between sites, not `&&`: one site failing must not skip the next.
$runs = ($Sites | ForEach-Object {
  "(cd /d `"$repo`" && `"$npx`" tsx --env-file=.env.local scripts/crawl-local.ts $_) >> `"$(Join-Path $logDir "$_.log")`" 2>&1"
}) -join " & "
$cmd = "(if not exist `"$logDir`" mkdir `"$logDir`") & $runs"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $cmd"
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# The task was ISSTA-only until 2026-09-28 under another name - drop it, or both would run.
$legacy = "MYT price-light ISSTA crawl"
if ($TaskName -ne $legacy -and (Get-ScheduledTask -TaskName $legacy -ErrorAction SilentlyContinue)) {
  Unregister-ScheduledTask -TaskName $legacy -Confirm:$false
  Write-Host "removed legacy task '$legacy'"
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "registered '$TaskName': daily at $Time (catches up after off days), sites $($Sites -join ', '), logs in $logDir"
