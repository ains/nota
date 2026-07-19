import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import { registerIpcHandlers } from "./ipcHandlers";
import { registerDemucsIpc } from "./demucsCli";
import { IPC } from "../shared/ipc";

// The lookahead scheduler must keep ticking when the window is occluded or the
// user switches to a score PDF — otherwise synth playback stalls mid-take.
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
// AudioContext must run without a user gesture (transport is app-driven).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow: BrowserWindow | null = null;
// Project bundles macOS asks us to open (double-click in Finder). Paths that
// arrive before the renderer is ready are queued and drained on first mount.
const pendingOpenPaths: string[] = [];
let rendererReady = false;

function deliverOpenPath(path: string): void {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.projectOpened, path);
  } else {
    pendingOpenPaths.push(path);
  }
}

// Registered at module load so it catches the open-file event macOS fires at
// launch when the app is started by opening a .nota package.
app.on("open-file", (event, path) => {
  event.preventDefault();
  deliverOpenPath(path);
});

ipcMain.handle(IPC.consumeOpenPath, (): string[] => {
  rendererReady = true;
  return pendingOpenPaths.splice(0);
});

function createWindow(): void {
  // A fresh renderer must re-announce itself before we push live opens to it.
  rendererReady = false;
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Web MIDI is permission-gated in Chromium; without BOTH handlers,
  // navigator.requestMIDIAccess() rejects silently in Electron.
  // Chromium gates ALL Web MIDI access behind 'midiSysex' (even
  // requestMIDIAccess({ sysex: false })), so both names must be allowed.
  win.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === "midi" || permission === "midiSysex") {
        callback(true);
      } else {
        callback(false);
      }
    },
  );

  win.webContents.session.setPermissionCheckHandler(
    (_webContents, permission) => {
      if (permission === "midi" || permission === "midiSysex") {
        return true;
      }
      return false;
    },
  );

  win.on("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.ains.nota");

  // Packaged macOS builds get the icon from the bundled .icns, but in dev the
  // dock falls back to the default Electron icon unless we set it explicitly.
  if (process.platform === "darwin" && is.dev) {
    app.dock?.setIcon(icon);
  }

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerIpcHandlers();
  registerDemucsIpc();

  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
