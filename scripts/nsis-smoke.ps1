param(
  [Parameter(Mandatory=$true)][ValidateSet('Inspect','Install','Uninstall')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Workspace,
  [Parameter(Mandatory=$true)][string]$InstallTarget,
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$AppGuid,
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')][string]$ApplicationVersion
)
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath($Workspace).TrimEnd('\')
$scratchPath = [IO.Path]::GetFullPath([IO.Path]::Combine($workspacePath, '.native-smoke')).TrimEnd('\')
$installPath = [IO.Path]::GetFullPath($InstallTarget).TrimEnd('\')
$expectedPath = [IO.Path]::Combine($scratchPath, 'installed-app')
if ($installPath -ne $expectedPath -or -not $installPath.StartsWith($scratchPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer test target is outside its fixed workspace scratch directory.' }
foreach ($path in @($scratchPath, $installPath)) {
  if (Test-Path -LiteralPath $path) {
    $entry = Get-Item -LiteralPath $path -Force
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Installer test target/ancestor is a junction or symbolic link; refusing.' }
  }
}
$setupPath = [IO.Path]::GetFullPath($InstallerPath)
$expectedSetup = [IO.Path]::Combine($workspacePath, 'dist', ('Slice Man Setup ' + $ApplicationVersion + '.exe'))
if ($setupPath -ne $expectedSetup) { throw 'Unexpected NSIS installer path.' }
if ($Mode -eq 'Install' -and -not (Test-Path -LiteralPath $setupPath -PathType Leaf)) { throw 'NSIS installer missing; build the current version first.' }
if ($AppGuid -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Invalid application registry GUID.' }
$registryRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Slice Man.lnk'),
  (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Slice Man.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Slice Man.lnk'),
  (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Slice Man.lnk')
)
function Get-ExistingInstallation {
  $found = @()
  foreach ($root in $registryRoots) {
    if (Test-Path -LiteralPath $root) {
      foreach ($key in Get-ChildItem -LiteralPath $root) {
        $item = Get-ItemProperty -LiteralPath $key.PSPath
        if ($key.PSChildName -eq $AppGuid -or $item.DisplayName -match '^Slice Man($|\s)' -or $item.InstallLocation -match '(?i)slice[ -]?man') {
          $found += [pscustomobject]@{ Key=$key.PSPath; DisplayName=$item.DisplayName; InstallLocation=$item.InstallLocation; UninstallString=$item.UninstallString }
        }
      }
    }
  }
  foreach ($registryParent in @('HKCU:\Software\', 'HKCU:\Software\WOW6432Node\', 'HKLM:\Software\', 'HKLM:\Software\WOW6432Node\')) {
    $key = $registryParent + $AppGuid
    if (Test-Path -LiteralPath $key) {
      $item = Get-ItemProperty -LiteralPath $key
      if (-not ($found | Where-Object InstallLocation -EQ $item.InstallLocation)) {
        $found += [pscustomobject]@{ Key=$key; DisplayName='Slice Man installation registry'; InstallLocation=$item.InstallLocation; UninstallString=$null }
      }
    }
  }
  return $found
}
function Start-SilentProcess([string]$Path, [string[]]$Arguments) {
  $child = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  if (-not $child.WaitForExit(180000)) { $child.Kill(); throw 'Silent installer/uninstaller exceeded the 180-second bound.' }
  $child.Refresh()
  return $child.ExitCode
}
if ($Mode -eq 'Inspect' -or $Mode -eq 'Install') {
  $existing = @(Get-ExistingInstallation)
  $collisions = @($shortcutPaths | Where-Object { Test-Path -LiteralPath $_ })
  $running = @(Get-Process -Name 'Slice Man' -ErrorAction SilentlyContinue | Select-Object Id,ProcessName)
  if ($existing.Count -gt 0 -or $collisions.Count -gt 0 -or $running.Count -gt 0) {
    [pscustomobject]@{ status='skipped'; reason='Existing Slice Man installation/registry/shortcut/process would be affected; left untouched.'; existing=$existing; shortcutCollisions=$collisions; runningProcesses=$running } | ConvertTo-Json -Depth 5 -Compress
    exit 0
  }
  if (Test-Path -LiteralPath $installPath) {
    [pscustomobject]@{ status='skipped'; reason='Fixed scratch installation target already exists; left untouched.'; target=$installPath } | ConvertTo-Json -Compress
    exit 0
  }
  if ($Mode -eq 'Inspect') {
    [pscustomobject]@{ status='safe'; target=$installPath; existing=$existing; shortcutCollisions=$collisions } | ConvertTo-Json -Depth 5 -Compress
    exit 0
  }
  # NSIS /D must be last and must not be quoted; it consumes the remainder,
  # including spaces. Both paths have been resolved and validated above.
  $code = Start-SilentProcess $setupPath @('/S', '/currentuser', ('/D=' + $installPath))
  [pscustomobject]@{ status= $(if ($code -eq 0) { 'installed' } else { 'failed' }); exitCode=$code; target=$installPath; executableExists=(Test-Path -LiteralPath (Join-Path $installPath 'Slice Man.exe')); registered=@(Get-ExistingInstallation) } | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
if ($Mode -eq 'Uninstall') {
  $existing = @(Get-ExistingInstallation)
  foreach ($entry in $existing) {
    if ($entry.InstallLocation) {
      if ([IO.Path]::GetFullPath($entry.InstallLocation).TrimEnd('\') -ne $installPath) { throw 'Uninstall registry points outside the verified scratch directory; refusing.' }
    } elseif ($entry.UninstallString -match '^"([^"]+)"(?:\s|$)') {
      # NSIS's uninstall entry need not contain InstallLocation; its separate
      # installation key does. Validate the quoted executable without executing
      # any registry-supplied arguments or commands.
      if ([IO.Path]::GetFullPath($Matches[1]) -ne (Join-Path $installPath 'Uninstall Slice Man.exe')) { throw 'Registered uninstaller points outside the verified scratch directory; refusing.' }
    } else { throw 'Uninstall registration has no verifiable scratch location; refusing.' }
  }
  $uninstaller = Join-Path $installPath 'Uninstall Slice Man.exe'
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Scratch uninstaller missing; refusing fallback cleanup.' }
  $code = Start-SilentProcess $uninstaller @('/S', '/currentuser', ('_?=' + $installPath))
  if ($code -ne 0) { throw ('Uninstaller failed with code ' + $code) }
  $after = @(Get-ExistingInstallation)
  if ($after.Count -gt 0 -or (Test-Path -LiteralPath (Join-Path $installPath 'Slice Man.exe'))) { throw 'Uninstaller left its app registration/executable behind.' }
  # The original uninstaller may remain locked until its process exits. Only
  # this exact checked test target is eligible for remaining-file removal.
  if (Test-Path -LiteralPath $installPath) {
    $resolved = (Resolve-Path -LiteralPath $installPath).ProviderPath.TrimEnd('\')
    if ($resolved -ne $expectedPath -or -not $resolved.StartsWith($scratchPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup target validation failed.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
  $leftovers = @($shortcutPaths | Where-Object { Test-Path -LiteralPath $_ })
  if ($leftovers.Count -gt 0) { throw 'Uninstall left newly created shortcuts behind; no unrelated shortcut was deleted.' }
  [pscustomobject]@{ status='uninstalled'; exitCode=$code; target=$installPath; targetRemoved=(-not (Test-Path -LiteralPath $installPath)); registryRemoved=($after.Count -eq 0); shortcutsRemoved=($leftovers.Count -eq 0) } | ConvertTo-Json -Depth 5 -Compress
}
