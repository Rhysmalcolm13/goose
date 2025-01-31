# Goose Windows Installer
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

# Configuration
$appName = "Goose"
$publisher = "Goose Team"
$installDir = "$env:LOCALAPPDATA\Programs\$appName"
$downloadUrl = "https://github.com/rhysmalcolm/goose/releases/latest/download/Goose-Setup.exe"
$tempFile = "$env:TEMP\Goose-Setup.exe"

Write-Host "Installing $appName..."

# Check for required dependencies
function Check-Dependency {
    param (
        [string]$Name,
        [string]$Command,
        [string]$InstallCommand
    )
    
    try {
        Invoke-Expression $Command | Out-Null
        Write-Host "$Name is installed."
    }
    catch {
        Write-Host "$Name is not installed. Installing..."
        try {
            Invoke-Expression $InstallCommand
        }
        catch {
            Write-Host "Failed to install $Name. Please install it manually."
            exit 1
        }
    }
}

# Install Chocolatey if not present
if (!(Test-Path "$env:ProgramData\chocolatey\choco.exe")) {
    Write-Host "Installing Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
}

# Check and install dependencies
Check-Dependency "Visual C++ Redistributable" "Get-Command vcruntime140.dll" "choco install -y vcredist140"
Check-Dependency "WebView2 Runtime" "Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction Stop" "choco install -y microsoft-edge-webview2-runtime"

# Download the installer
Write-Host "Downloading $appName installer..."
try {
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($downloadUrl, $tempFile)
}
catch {
    Write-Host "Failed to download installer: $_"
    exit 1
}

# Run the installer
Write-Host "Running installer..."
try {
    Start-Process -FilePath $tempFile -ArgumentList "/S" -Wait
}
catch {
    Write-Host "Installation failed: $_"
    exit 1
}

# Clean up
Remove-Item $tempFile -Force

# Add to PATH if not already present
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
}

# Create file associations
$fileTypes = @(".goose")
foreach ($ext in $fileTypes) {
    New-Item -Path "Registry::HKEY_CURRENT_USER\Software\Classes\$ext" -Force | Out-Null
    Set-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Classes\$ext" -Name "(Default)" -Value "Goose.File"
    
    New-Item -Path "Registry::HKEY_CURRENT_USER\Software\Classes\Goose.File" -Force | Out-Null
    Set-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Classes\Goose.File" -Name "(Default)" -Value "Goose File"
    
    New-Item -Path "Registry::HKEY_CURRENT_USER\Software\Classes\Goose.File\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Classes\Goose.File\shell\open\command" -Name "(Default)" -Value "`"$installDir\Goose.exe`" `"%1`""
}

Write-Host "$appName has been successfully installed!"
