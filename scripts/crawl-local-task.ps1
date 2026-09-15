# Registers (or re-registers) the Windows Task Scheduler entry that runs scripts/crawl-local.ts
# for ISSTA from this machine - the site serves Vercel's address a page without its cards, so
# the catalog is refreshed from an Israeli connection instead (see crawlFrom in
# lib/services/competitor-scrapers/types.ts).
#
#   powershell -ExecutionPolicy Bypass -File scripts/crawl-local-task.ps1 [-Time 03:30] [-Remove]
#
# Runs DAILY (not every 3 days): the script itself checks whether ISSTA is due (72h since the
# last real run) and exits at once otherwise. A daily trigger with "start when available" is
# what survives a machine that is off some days - a missed day runs as soon as the machine is
# back on, and the due check turns that into "every ~3 days" without a stateful schedule.
# The task runs as the current user, only while logged on (locked is fine), only with network,
# capped at 15 minutes, and never in parallel with itself. Output lands in
# %LOCALAPPDATA%\MYT\crawl-logs\issta.log; Task Scheduler's "Last Run Result" is the exit code
# (0 = ok / not due, 1 = blocked / error / crash).
param(
  [string]$Time = "03:30",
  [string]$TaskName = "MYT price-light ISSTA crawl",
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
$log = Join-Path $logDir "issta.log"

# The task creates the log directory ITSELF, every run: a directory made by whoever runs this
# registration may not exist for the task's process (a sandboxed shell, e.g. Claude Code's, writes
# AppData\Local into an overlay the real process cannot see - the task then exits 1 on the
# redirect before the script ever starts). The chain is grouped so the log also catches a failing
# `cd` or a missing npx, not only the script's own output.
$cmd = "(if not exist `"$logDir`" mkdir `"$logDir`") && (cd /d `"$repo`" && `"$npx`" tsx --env-file=.env.local scripts/crawl-local.ts issta) >> `"$log`" 2>&1"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $cmd"
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "registered '$TaskName': daily at $Time (catches up after off days), log $log"
