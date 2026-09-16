$ErrorActionPreference = "Stop"

$logPath = Join-Path $PSScriptRoot "repair-wsl.log"
Start-Transcript -Path $logPath -Force

try {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "This repair must run as Administrator."
    }

    Write-Host "Repairing 64-bit Windows Installer registration..."
    Start-Process -FilePath "C:\Windows\System32\msiexec.exe" -ArgumentList "/unregister" -Wait
    Start-Process -FilePath "C:\Windows\System32\msiexec.exe" -ArgumentList "/regserver" -Wait

    if (Test-Path "C:\Windows\SysWOW64\msiexec.exe") {
        Write-Host "Repairing 32-bit Windows Installer registration..."
        Start-Process -FilePath "C:\Windows\SysWOW64\msiexec.exe" -ArgumentList "/unregister" -Wait
        Start-Process -FilePath "C:\Windows\SysWOW64\msiexec.exe" -ArgumentList "/regserver" -Wait
    }

    Write-Host "Starting Windows Installer service..."
    Start-Service -Name msiserver

    Write-Host "Enabling Windows Subsystem for Linux..."
    & dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
    if ($LASTEXITCODE -notin 0, 3010) { throw "WSL feature enable failed with exit code $LASTEXITCODE." }

    Write-Host "Enabling Virtual Machine Platform..."
    & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
    if ($LASTEXITCODE -notin 0, 3010) { throw "Virtual Machine Platform enable failed with exit code $LASTEXITCODE." }

    Write-Host "Installing the WSL package without a Linux distribution..."
    & wsl.exe --install --no-distribution --web-download
    $wslExitCode = $LASTEXITCODE
    Write-Host "WSL install command exit code: $wslExitCode"

    if ($wslExitCode -ne 0) {
        throw "WSL package installation failed with exit code $wslExitCode."
    }

    Write-Host "WSL repair completed. Restart Windows to finish enabling virtualization components."
}
finally {
    Stop-Transcript
}
