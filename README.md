<h1 align="center">
codename goose
</h1>

<p align="center">
  <strong>an open-source, extensible AI agent that goes beyond code suggestions<br>install, execute, edit, and test with any LLM</strong>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0">
    <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg">
  </a>
  <a href="https://discord.gg/7GaTvbDwga">
    <img src="https://img.shields.io/discord/1287729918100246654?logo=discord&logoColor=white&label=Join+Us&color=blueviolet" alt="Discord">
  </a>
  <a href="https://github.com/block/goose/actions/workflows/ci.yml">
     <img src="https://img.shields.io/github/actions/workflow/status/block/goose/ci.yml?branch=main" alt="CI">
  </a>
</p>

Check out our [documentation](https://block.github.io/goose), or to try it out head to the [installation](https://block.github.io/goose/docs/getting-started/installation) instructions!

## Windows Installation

### Option 1: One-Click Installer (Recommended)

1. Download and run the PowerShell installer script:
```powershell
# Run in PowerShell as Administrator
Set-ExecutionPolicy Bypass -Scope Process -Force
iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/rhysmalcolm/goose/main/scripts/windows/install.ps1'))
```

This will:
- Install required dependencies (Visual C++ Runtime, WebView2)
- Download and install the latest version of Goose
- Set up file associations
- Add Goose to your PATH

### Option 2: Manual Installation

1. Download the latest `Goose-Setup.exe` from [GitHub Releases](https://github.com/rhysmalcolm/goose/releases/latest)
2. Run the installer
3. Launch Goose from the Start Menu or desktop shortcut

### System Requirements

- Windows 10/11 (64-bit or ARM64)
- Visual C++ Redistributable 2015-2022
- Microsoft Edge WebView2 Runtime

### Automatic Updates

Goose will automatically check for updates when launched and every hour afterward. When an update is available:
1. You'll be notified with a dialog
2. Choose to download and install now or later
3. Updates are installed automatically when you restart Goose

### Building from Source

To build Goose for Windows:

1. Install prerequisites:
```powershell
# Install Rust
rustup default stable
rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc

# Install build tools
choco install -y llvm --version=17.0.6
choco install -y visualstudio2022buildtools --package-parameters="--add Microsoft.VisualStudio.Component.VC.Tools.ARM64"
```

2. Build the project:
```powershell
# Build Rust components
cargo build --release --target x86_64-pc-windows-msvc  # or aarch64-pc-windows-msvc for ARM64

# Build Electron app
cd ui/desktop
npm install
npm run make
```

The installer will be available at `ui/desktop/out/make/squirrel.windows/x64/Goose-Setup.exe`
