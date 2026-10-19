[CmdletBinding(SupportsShouldProcess)]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$secretFile = Join-Path $workspace '.dev.vars'
$broadSids = @('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-32-546')
$targets = @($workspace)
if (Test-Path -LiteralPath $secretFile) { $targets += $secretFile }

# Default execution only reports the exact scope; -Apply is explicit.
foreach ($target in $targets) {
  $acl = Get-Acl -LiteralPath $target
  $broadRules = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -in $broadSids })
  [PSCustomObject]@{ Target = $target; BroadAllowRules = $broadRules.Count; ApplyRequested = [bool]$Apply }
}
if (-not $Apply) { return }
if (-not $PSCmdlet.ShouldProcess($workspace, 'Restrict project inheritance and credential permissions; inherited changes can propagate to children')) { return }

$backupPath = Join-Path $workspace '.data\security-acl-backup.json'
if (Test-Path -LiteralPath $backupPath) { throw 'An ACL backup already exists. Review it before another permission change.' }
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $backupPath)) | Out-Null
$backup = @{}
foreach ($target in $targets) { $backup[$target] = (Get-Acl -LiteralPath $target).Sddl }
$backup | ConvertTo-Json | Set-Content -LiteralPath $backupPath

$icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
function Invoke-AccessChange {
  param([string[]]$Arguments)
  & $icacls @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Windows permission update failed (exit $LASTEXITCODE). Original ACLs are backed up." }
}
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$requiredSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
foreach ($target in $targets) {
  # Persist inherited entries as explicit before removing grants. Removing
  # inherited rules from an in-memory .NET ACL does not remove those entries.
  Invoke-AccessChange -Arguments @($target, '/inheritance:d')
  # /remove:g removes allow entries only; deny and specific account rules remain.
  Invoke-AccessChange -Arguments (@($target, '/remove:g') + @($broadSids | ForEach-Object { '*' + $_ }))
  $inheritance = if ($target -eq $workspace) { '(OI)(CI)' } else { '' }
  $grants = @($requiredSids | ForEach-Object { '*{0}:{1}F' -f $_, $inheritance })
  Invoke-AccessChange -Arguments (@($target, '/grant') + $grants)
}
foreach ($target in $targets) {
  $acl = Get-Acl -LiteralPath $target
  $remaining = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -in $broadSids })
  if (-not $acl.AreAccessRulesProtected -or $remaining.Count -ne 0) { throw "Permission verification failed for $target" }
  foreach ($sid in $requiredSids) {
    $fullAccess = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $sid -and ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl })
    if ($fullAccess.Count -eq 0) { throw "Required account access missing for $target" }
  }
}
