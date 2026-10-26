# Deploy the game from this computer to the Linux server: `npm run deploy`.
# Checks and builds locally, copies the release over SSH, then deploy/remote-deploy.sh swaps it in on the
# server (with a data backup and automatic rollback). See deploy/README.md.
param(
  # Defaults to the server's Tailscale address, then its home-network address.
  [string]$Server = $env:MURIM_DEPLOY_HOST,
  [string]$User = 'ray',
  [string]$Key = (Join-Path $env:USERPROFILE '.ssh\murim_server'),
  [switch]$SkipTests,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step([string]$msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Fail([string]$msg) { Write-Host "`nDEPLOY STOPPED: $msg" -ForegroundColor Red; exit 1 }
function Check([string]$what) { if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit $LASTEXITCODE). Nothing was changed on the server." } }

$sshOpts = @('-i', $Key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8')
if (-not (Test-Path $Key)) { Fail "SSH key not found at $Key" }

# ---- 1. find the server ------------------------------------------------------------------
Step 'Finding the server'
$candidates = if ($Server) { @($Server) } else { @('100.86.175.108', '192.168.1.17') }
$target = $null
foreach ($c in $candidates) {
  ssh @sshOpts "$User@$c" 'true' 2>$null
  if ($LASTEXITCODE -eq 0) { $target = $c; break }
  Write-Host "  ${c}: no answer"
}
if (-not $target) { Fail 'cannot reach the server over SSH (is it on, and is Tailscale connected?)' }
Write-Host "  using $target"

# ---- 2. checks ---------------------------------------------------------------------------
if (-not $SkipChecks) {
  Step 'Type check'
  npm run typecheck
  Check 'type check'
  if (-not $SkipTests) {
    Step 'Tests'
    npm test
    Check 'tests'
  }
}

# ---- 3. build ----------------------------------------------------------------------------
Step 'Building'
npm run build
Check 'build'
if (-not (Test-Path 'dist\server.mjs') -or -not (Test-Path 'dist\client\index.html')) { Fail 'build output is incomplete' }

# ---- 4. pack -----------------------------------------------------------------------------
Step 'Packing the release'
$commit = (git -c safe.directory=* rev-parse --short HEAD 2>$null)
if (-not $commit) { $commit = 'nogit' }
$dirty = if (git -c safe.directory=* status --porcelain 2>$null) { '-dirty' } else { '' }
$release = "$commit$dirty $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$stage = Join-Path $env:TEMP 'murim-release'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
Copy-Item dist (Join-Path $stage 'dist') -Recurse
Copy-Item package.json, package-lock.json $stage
Copy-Item deploy (Join-Path $stage 'deploy') -Recurse
[IO.File]::WriteAllText((Join-Path $stage 'RELEASE'), $release)
$tar = Join-Path $env:TEMP 'murim-release.tar'
if (Test-Path $tar) { Remove-Item $tar -Force }
tar -cf $tar -C $stage .
Check 'packing'
Write-Host ("  release {0}, {1:N1} MB" -f $release, ((Get-Item $tar).Length / 1MB))

# ---- 5. upload and run the server side ---------------------------------------------------
Step 'Uploading'
scp @sshOpts $tar "$User@${target}:/tmp/murim-release.tar"
Check 'upload'

Step 'Deploying on the server'
# Upload the script as a file with Unix line endings (piping it through PowerShell adds a stray carriage return).
$script = Join-Path $env:TEMP 'murim-remote-deploy.sh'
$text = (Get-Content (Join-Path $root 'deploy\remote-deploy.sh') -Raw) -replace "`r", ''
[IO.File]::WriteAllText($script, $text, (New-Object System.Text.UTF8Encoding($false)))
scp @sshOpts $script "$User@${target}:/tmp/murim-remote-deploy.sh"
Check 'uploading the deploy script'
ssh @sshOpts "$User@$target" 'bash /tmp/murim-remote-deploy.sh /tmp/murim-release.tar; code=$?; rm -f /tmp/murim-remote-deploy.sh; exit $code'
if ($LASTEXITCODE -ne 0) { Fail 'the server reported a problem (see the [server] lines above; it rolled back if it could)' }

Write-Host "`nDone. Game: http://${target}:3000" -ForegroundColor Green
