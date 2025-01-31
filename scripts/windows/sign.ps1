# Code Signing Script for Windows
param (
    [Parameter(Mandatory=$true)]
    [string]$FilePath,
    
    [Parameter(Mandatory=$true)]
    [string]$CertPath,
    
    [Parameter(Mandatory=$true)]
    [string]$CertPassword
)

$ErrorActionPreference = "Stop"

# Timestamp server URL
$timestampServer = "http://timestamp.digicert.com"

# Sign the file
try {
    $signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22000.0\x64\signtool.exe"
    
    if (!(Test-Path $signtool)) {
        Write-Host "SignTool not found. Installing Windows SDK..."
        choco install -y windows-sdk-10-version-2004-all
    }
    
    Write-Host "Signing $FilePath..."
    & $signtool sign /f $CertPath /p $CertPassword /fd SHA256 /tr $timestampServer /td SHA256 /v $FilePath
    
    if ($LASTEXITCODE -ne 0) {
        throw "Signing failed with exit code $LASTEXITCODE"
    }
    
    Write-Host "Successfully signed $FilePath"
}
catch {
    Write-Host "Failed to sign file: $_"
    exit 1
}
