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

$acl = Get-Acl -LiteralPath $workspace
$acl.SetAccessRuleProtection($true, $true)
foreach ($rule in @($acl.Access)) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -in $broadSids) { $acl.RemoveAccessRuleSpecific($rule) }
}
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($sid in @($current, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
# Specific existing automation/user entries are preserved; only broad groups
# are removed. This does not change ACLs outside the project directory.
Set-Acl -LiteralPath $workspace -AclObject $acl
if (Test-Path -LiteralPath $secretFile) {
  $acl = Get-Acl -LiteralPath $secretFile
  $acl.SetAccessRuleProtection($true, $true)
  foreach ($rule in @($acl.Access)) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -in $broadSids) { $acl.RemoveAccessRuleSpecific($rule) }
  }
  foreach ($sid in @($current, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
  }
  Set-Acl -LiteralPath $secretFile -AclObject $acl
}
