import { spawn } from 'child_process';
import 'dotenv/config';
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  MenuItem,
  Notification,
  powerSaveBlocker,
  Tray,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import started from 'electron-squirrel-startup';
import path from 'node:path';
import { startGoosed } from './goosed';
import { getBinaryPath } from './utils/binaryPath';
import { loadShellEnv } from './utils/loadEnv';
import log from './utils/logger';
import { addRecentDir, loadRecentDirs } from './utils/recentDirs';
import {
  createEnvironmentMenu,
  EnvToggles,
  loadSettings,
  saveSettings,
  updateEnvironmentVariables,
} from './utils/settings';
const { exec } = require('child_process');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) app.quit();

// Configure auto updater
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Handle auto-updater events
autoUpdater.on('checking-for-update', () => {
  log.info('Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  log.info('Update available:', info);
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Available',
    message: 'A new version of Goose is available. Would you like to download it now?',
    buttons: ['Yes', 'No'],
    defaultId: 0
  }).then(({ response }) => {
    if (response === 0) {
      autoUpdater.downloadUpdate();
    }
  });
});

autoUpdater.on('update-not-available', (info) => {
  log.info('Update not available:', info);
});

autoUpdater.on('error', (err) => {
  log.error('Error in auto-updater:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  let message = `Download speed: ${progressObj.bytesPerSecond}`;
  message = `${message} - Downloaded ${progressObj.percent}%`;
  message = `${message} (${progressObj.transferred}/${progressObj.total})`;
  log.info(message);
});

autoUpdater.on('update-downloaded', (info) => {
  log.info('Update downloaded:', info);
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: 'A new version has been downloaded. Restart Goose to apply the updates.',
    buttons: ['Restart', 'Later'],
    defaultId: 0
  }).then(({ response }) => {
    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

// Triggered when the user opens "goose://..." links
app.on('open-url', async (event, url) => {
  event.preventDefault();
  console.log('open-url:', url);

  const recentDirs = loadRecentDirs();
  const openDir = recentDirs.length > 0 ? recentDirs[0] : null;

  // Create the new Chat window
  const newWindow = await createChat(app, undefined, openDir);

  newWindow.webContents.once('did-finish-load', () => {
    newWindow.webContents.send('add-extension', url);
  });
});

declare var MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare var MAIN_WINDOW_VITE_NAME: string;

// State for environment variable toggles
let envToggles: EnvToggles = loadSettings().envToggles;

// Parse command line arguments
const parseArgs = () => {
  const args = process.argv.slice(2); // Remove first two elements (electron and script path)
  let dirPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && i + 1 < args.length) {
      dirPath = args[i + 1];
      break;
    }
  }

  return { dirPath };
};

const getGooseProvider = () => {
  loadShellEnv(app.isPackaged);
  //{env-macro-start}//
  //needed when goose is bundled for a specific provider
  //{env-macro-end}//
  return process.env.GOOSE_PROVIDER;
};

const generateSecretKey = () => {
  const crypto = require('crypto');
  let key = crypto.randomBytes(32).toString('hex');
  process.env.GOOSE_SERVER__SECRET_KEY = key;
  return key;
};

let appConfig = {
  GOOSE_PROVIDER: getGooseProvider(),
  GOOSE_API_HOST: 'http://127.0.0.1',
  GOOSE_PORT: 0,
  GOOSE_WORKING_DIR: '',
  secretKey: generateSecretKey(),
};

const createLauncher = () => {
  const launcherWindow = new BrowserWindow({
    width: 600,
    height: 60,
    frame: false,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [JSON.stringify(appConfig)],
      partition: 'persist:goose',
    },
    skipTaskbar: true,
    alwaysOnTop: true,
  });

  // Center on screen
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const windowBounds = launcherWindow.getBounds();

  launcherWindow.setPosition(
    Math.round(width / 2 - windowBounds.width / 2),
    Math.round(height / 3 - windowBounds.height / 2)
  );

  // Load launcher window content
  const launcherParams = '?window=launcher#/launcher';
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    launcherWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}${launcherParams}`);
  } else {
    launcherWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html${launcherParams}`)
    );
  }

  // Destroy window when it loses focus
  launcherWindow.on('blur', () => {
    launcherWindow.destroy();
  });
};

// Track windows by ID
let windowCounter = 0;
const windowMap = new Map<number, BrowserWindow>();

const createChat = async (app, query?: string, dir?: string, version?: string) => {
  try {
    log.info('Creating chat window...');
    const env = version ? { GOOSE_AGENT_VERSION: version } : {};

    // Apply current environment settings before creating chat
    updateEnvironmentVariables(envToggles);

    const [port, working_dir, goosedProcess] = await startGoosed(app, dir);
    appConfig.GOOSE_PORT = port;

    // Create the browser window.
    const chatWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        additionalArguments: [JSON.stringify(appConfig)],
        partition: 'persist:goose',
        contextIsolation: true,
        nodeIntegration: true
      },
      show: false,
    });

    // Assign window ID and track it
    const windowId = windowCounter++;
    windowMap.set(windowId, chatWindow);

    chatWindow.once('ready-to-show', () => {
      log.info('Chat window ready to show');
      chatWindow.show();
    });

    // Handle window errors
    chatWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log.error('Window failed to load:', errorDescription);
      dialog.showErrorBox('Error', `Failed to load application: ${errorDescription}`);
    });

    const chatParams = query ? `?q=${encodeURIComponent(query)}` : '';
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      await chatWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}${chatParams}`);
    } else {
      await chatWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html${chatParams}`)
      );
    }

    return [chatWindow, goosedProcess];
  } catch (error) {
    log.error('Error creating chat window:', error);
    dialog.showErrorBox('Error', `Failed to create application window: ${error.message}`);
    throw error;
  }
};

const createTray = () => {
  const isDev = process.env.NODE_ENV === 'development';
  let iconPath: string;

  if (isDev) {
    iconPath = path.join(process.cwd(), 'src', 'images', 'iconTemplate.png');
  } else {
    iconPath = path.join(process.resourcesPath, 'images', 'iconTemplate.png');
  }

  const tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Window', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setToolTip('Goose');
  tray.setContextMenu(contextMenu);
};

const showWindow = () => {
  const windows = BrowserWindow.getAllWindows();

  if (windows.length === 0) {
    log.info('No windows are currently open.');
    return;
  }

  // Define the initial offset values
  const initialOffsetX = 30;
  const initialOffsetY = 30;

  // Iterate over all windows
  windows.forEach((win, index) => {
    const currentBounds = win.getBounds();
    const newX = currentBounds.x + initialOffsetX * index;
    const newY = currentBounds.y + initialOffsetY * index;

    win.setBounds({
      x: newX,
      y: newY,
      width: currentBounds.width,
      height: currentBounds.height,
    });

    if (!win.isVisible()) {
      win.show();
    }

    win.focus();
  });
};

const buildRecentFilesMenu = () => {
  const recentDirs = loadRecentDirs();
  return recentDirs.map((dir) => ({
    label: dir,
    click: () => {
      createChat(app, undefined, dir);
    },
  }));
};

const openDirectoryDialog = async (replaceWindow: boolean = false) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    addRecentDir(result.filePaths[0]);
    if (replaceWindow) {
      BrowserWindow.getFocusedWindow().close();
    }
    createChat(app, undefined, result.filePaths[0]);
  }
};

// Global error handler
const handleFatalError = (error: Error) => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send('fatal-error', error.message || 'An unexpected error occurred');
  });
};

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  handleFatalError(error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
  handleFatalError(error instanceof Error ? error : new Error(String(error)));
});

// Add file/directory selection handler
ipcMain.handle('select-file-or-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'openDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('check-ollama', async () => {
  try {
    return new Promise((resolve, reject) => {
      // Run `ps` and filter for "ollama"
      exec('ps aux | grep -iw "[o]llama"', (error, stdout, stderr) => {
        if (error) {
          console.error('Error executing ps command:', error);
          return resolve(false); // Process is not running
        }

        if (stderr) {
          console.error('Standard error output from ps command:', stderr);
          return resolve(false); // Process is not running
        }

        console.log('Raw stdout from ps command:', stdout);

        // Trim and check if output contains a match
        const trimmedOutput = stdout.trim();
        console.log('Trimmed stdout:', trimmedOutput);

        const isRunning = trimmedOutput.length > 0; // True if there's any output
        resolve(isRunning); // Resolve true if running, false otherwise
      });
    });
  } catch (err) {
    console.error('Error checking for Ollama:', err);
    return false; // Return false on error
  }
});

app.whenReady().then(async () => {
  // Parse command line arguments
  const { dirPath } = parseArgs();

  createTray();
  const recentDirs = loadRecentDirs();
  let openDir = dirPath || (recentDirs.length > 0 ? recentDirs[0] : null);
  createChat(app, undefined, openDir);

  // Show launcher input on key combo
  globalShortcut.register('Control+Alt+Command+G', createLauncher);

  // Get the existing menu
  const menu = Menu.getApplicationMenu();

  // Add Environment menu items to View menu
  const viewMenu = menu.items.find((item) => item.label === 'View');
  if (viewMenu) {
    viewMenu.submenu.append(new MenuItem({ type: 'separator' }));
    viewMenu.submenu.append(
      new MenuItem({
        label: 'Environment',
        submenu: Menu.buildFromTemplate(
          createEnvironmentMenu(envToggles, (newToggles) => {
            envToggles = newToggles;
            saveSettings({ envToggles: newToggles });
            updateEnvironmentVariables(newToggles);
          })
        ),
      })
    );
  }

  const fileMenu = menu?.items.find((item) => item.label === 'File');

  // open goose to specific dir and set that as its working space
  fileMenu.submenu.append(
    new MenuItem({
      label: 'Open Directory...',
      accelerator: 'CmdOrCtrl+O',
      click() {
        openDirectoryDialog();
      },
    })
  );

  // Add Recent Files submenu
  const recentFilesSubmenu = buildRecentFilesMenu();
  if (recentFilesSubmenu.length > 0) {
    fileMenu.submenu.append(new MenuItem({ type: 'separator' }));
    fileMenu.submenu.append(
      new MenuItem({
        label: 'Recent Directories',
        submenu: recentFilesSubmenu,
      })
    );
  }

  // Add menu items to File menu
  if (fileMenu && fileMenu.submenu) {
    fileMenu.submenu.append(
      new MenuItem({
        label: 'New Chat Window',
        accelerator: 'CmdOrCtrl+N',
        click() {
          ipcMain.emit('create-chat-window');
        },
      })
    );

    // Register global shortcut for Install MCP Extension
    globalShortcut.register('Shift+Command+Y', () => {
      const defaultUrl =
        'goose://extension?cmd=npx&arg=-y&arg=%40modelcontextprotocol%2Fserver-github&id=github&name=GitHub&description=Repository%20management%2C%20file%20operations%2C%20and%20GitHub%20API%20integration&env=GITHUB_TOKEN%3DGitHub%20personal%20access%20token';

      const result = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Install', 'Edit URL', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Install MCP Extension',
        message: 'Install MCP Extension',
        detail: `Current extension URL:\n\n${defaultUrl}`,
      });

      if (result === 0) {
        // User clicked Install
        const mockEvent = {
          preventDefault: () => {
            console.log('Default handling prevented.');
          },
        };
        app.emit('open-url', mockEvent, defaultUrl);
      } else if (result === 1) {
        // User clicked Edit URL
        // Create a simple input dialog
        const win = new BrowserWindow({
          width: 800,
          height: 120,
          frame: false,
          transparent: false,
          resizable: false,
          minimizable: false,
          maximizable: false,
          parent: BrowserWindow.getFocusedWindow(),
          modal: true,
          show: false,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
          },
        });

        win.loadURL(`data:text/html,
        <html>
          <body style="margin: 20px; font-family: system-ui;">
            <input type="text" id="url" value="${defaultUrl}" style="width: 100%; padding: 8px; margin-bottom: 10px;">
            <div style="text-align: right;">
              <button onclick="window.close()" style="margin-right: 10px;">Cancel</button>
              <button onclick="submit()" style="min-width: 80px;">Install</button>
            </div>
            <script>
              function submit() {
                require('electron').ipcRenderer.send('install-extension-url', document.getElementById('url').value);
              }
              // Handle Enter key
              document.getElementById('url').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') submit();
              });
              // Focus the input
              document.getElementById('url').focus();
              document.getElementById('url').select();
            </script>
          </body>
        </html>
      `);

        win.once('ready-to-show', () => {
          win.show();
        });

        // Handle the URL submission
        ipcMain.once('install-extension-url', (event, url) => {
          win.close();
          const mockEvent = {
            preventDefault: () => {
              console.log('Default handling prevented.');
            },
          };
          if (url && url.trim()) {
            app.emit('open-url', mockEvent, url);
          }
        });
      }
    });
  }

  Menu.setApplicationMenu(menu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createChat(app);
    }
  });

  ipcMain.on('create-chat-window', (_, query, dir, version) => {
    createChat(app, query, dir, version);
  });

  ipcMain.on('directory-chooser', (_, replace: boolean = false) => {
    openDirectoryDialog(replace);
  });

  ipcMain.on('notify', (event, data) => {
    console.log('NOTIFY', data);
    new Notification({ title: data.title, body: data.body }).show();
  });

  ipcMain.on('logInfo', (_, info) => {
    log.info('from renderer:', info);
  });

  ipcMain.on('reload-app', () => {
    app.relaunch();
    app.exit(0);
  });

  let powerSaveBlockerId: number | null = null;

  ipcMain.handle('start-power-save-blocker', () => {
    log.info('Starting power save blocker...');
    if (powerSaveBlockerId === null) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      log.info('Started power save blocker');
      return true;
    }
    return false;
  });

  ipcMain.handle('stop-power-save-blocker', () => {
    log.info('Stopping power save blocker...');
    if (powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
      log.info('Stopped power save blocker');
      return true;
    }
    return false;
  });

  // Handle binary path requests
  ipcMain.handle('get-binary-path', (event, binaryName) => {
    return getBinaryPath(app, binaryName);
  });

  // Handle metadata fetching from main process
  ipcMain.handle('fetch-metadata', async (_, url) => {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Goose/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      console.error('Error fetching metadata:', error);
      throw error;
    }
  });

  ipcMain.on('open-in-chrome', (_, url) => {
    // On macOS, use the 'open' command with Chrome
    if (process.platform === 'darwin') {
      spawn('open', ['-a', 'Google Chrome', url]);
    } else if (process.platform === 'win32') {
      // On Windows, start is built-in command of cmd.exe
      spawn('cmd.exe', ['/c', 'start', '', 'chrome', url]);
    } else {
      // On Linux, use xdg-open with chrome
      spawn('xdg-open', [url]);
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
