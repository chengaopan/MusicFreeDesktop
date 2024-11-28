import {app, BrowserWindow, nativeImage, screen} from "electron";
import getResourcePath from "@/common/main/get-resource-path";
import {IWindowEvents, IWindowManager} from "@/types/main/window-manager";
import {localPluginName, PlayerState, ResourceName} from "@/common/constant";
import voidCallback from "@/common/void-callback";
import ThumbBarUtil from "@/common/main/thumb-bar-util";
import EventEmitter from "eventemitter3";
import WindowDrag from "@shared/window-drag/main";
import AppConfig from "@shared/app-config/main";
import messageBus from "@shared/message-bus/main";


// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Webpack
// plugin that tells the Electron app where to look for the Webpack-bundled app code (depending on
// whether you're running in development or production).

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const LRC_WINDOW_WEBPACK_ENTRY: string;
declare const LRC_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const MINIMODE_WINDOW_WEBPACK_ENTRY: string;
declare const MINIMODE_WINDOW_PRELOAD_WEBPACK_ENTRY: string;


class WindowManager implements IWindowManager {
    private static mainWindow: BrowserWindow | null = null;
    private static lrcWindow: BrowserWindow | null = null;
    private static miniModeWindow: BrowserWindow | null = null;

    private ee: EventEmitter = new EventEmitter();

    getMainWindow(): BrowserWindow {
        return WindowManager.mainWindow;
    }

    get mainWindow() {
        return WindowManager.mainWindow;
    }

    get lyricWindow() {
        return WindowManager.lrcWindow;
    }

    get miniModeWindow() {
        return WindowManager.miniModeWindow;
    }

    getExtensionWindows(): BrowserWindow[] {
        const extWindows = [];
        if (WindowManager.lrcWindow) {
            extWindows.push(WindowManager.lrcWindow);
        }
        if (WindowManager.miniModeWindow) {
            extWindows.push(WindowManager.miniModeWindow);
        }
        return extWindows;
    }

    getAllWindows(): BrowserWindow[] {
        const windows = [];
        if (WindowManager.mainWindow) {
            windows.push(WindowManager.mainWindow);
        }
        if (WindowManager.lrcWindow) {
            windows.push(WindowManager.lrcWindow);
        }
        if (WindowManager.miniModeWindow) {
            windows.push(WindowManager.miniModeWindow);
        }
        return windows;
    }

    private emit<T extends keyof IWindowEvents>(event: T, data: IWindowEvents[T]) {
        this.ee.emit(event, data);
    }

    public on<T extends keyof IWindowEvents>(event: T, listener: (data: IWindowEvents[T]) => void) {
        this.ee.on(event, listener);
    }

    /**************************** Main Window ***************************/
    private createMainWindow() {
        // 1. 创建主窗口
        const mainWindow = new BrowserWindow({
            height: 700,
            width: 1050,
            webPreferences: {
                preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
                nodeIntegration: true,
                nodeIntegrationInWorker: true,
                webSecurity: false,
                sandbox: false,
                webviewTag: true,
            },
            resizable: false,
            frame: false,
            icon: nativeImage.createFromPath(getResourcePath(ResourceName.LOGO_IMAGE)),
        });

        // 2. 加载主界面
        const initUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
        initUrl.hash = `/main/musicsheet/${localPluginName}/favorite`;
        mainWindow.loadURL(initUrl.toString()).then(voidCallback);

        // 3. 开发者工具
        if (!app.isPackaged) {
            mainWindow.on("ready-to-show", () => {
                mainWindow.webContents.openDevTools();
            });
        }

        // 4. 主窗口http hack逻辑
        mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
            (details, callback) => {
                /** hack headers */
                try {
                    const url = new URL(details.url);
                    const setHeadersOptions = url.searchParams.get("_setHeaders");
                    if (!setHeadersOptions) {
                        throw new Error("No Need To Hack");
                    }
                    const originalRequestHeaders = details.requestHeaders ?? {};
                    let requestHeaders: Record<string, string> = {};
                    if (setHeadersOptions) {
                        const decodedHeaders = JSON.parse(
                            decodeURIComponent(setHeadersOptions)
                        );
                        for (const k in originalRequestHeaders) {
                            requestHeaders[k.toLowerCase()] = originalRequestHeaders[k];
                        }
                        for (const k in decodedHeaders) {
                            requestHeaders[k.toLowerCase()] = decodedHeaders[k];
                        }
                    } else {
                        requestHeaders = details.requestHeaders;
                    }
                    callback({
                        requestHeaders,
                    });
                } catch {
                    callback({
                        requestHeaders: details.requestHeaders,
                    });
                }
            }
        );

        // 5. 更新thumbbar
        ThumbBarUtil.setThumbBarButtons(mainWindow, false);
        WindowManager.mainWindow = mainWindow;

        // 6. 发出信号
        this.emit("WindowCreated", {
            windowName: "main",
            browserWindow: mainWindow
        });
    }

    public showMainWindow() {
        if (!WindowManager.mainWindow) {
            this.createMainWindow();
        }

        const mainWindow = WindowManager.mainWindow;

        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        } else if (mainWindow.isVisible()) {
            mainWindow.focus();
        } else {
            mainWindow.show();
        }
        mainWindow.moveTop();
        mainWindow.setSkipTaskbar(false);

        if (process.platform === "win32") {
            const appState = messageBus.getAppState();
            ThumbBarUtil.setThumbBarButtons(mainWindow, appState.playerState === PlayerState.Playing);
        }
    }

    public closeMainWindow() {
        WindowManager.mainWindow.close();
        WindowManager.mainWindow = null;
    }

    /**************************** Lyric Window ***************************/
    private createLyricWindow() {
        const width = 920;
        const height = 160;
        const initPosition = AppConfig.getConfig("private.lyricWindowPosition");
        const lyricWindow = new BrowserWindow({
            height,
            width,
            x: initPosition?.x,
            y: initPosition?.y,
            transparent: true,
            webPreferences: {
                preload: LRC_WINDOW_PRELOAD_WEBPACK_ENTRY,
                nodeIntegration: true,
                webSecurity: false,
                sandbox: false,
            },
            resizable: false,
            frame: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            icon: nativeImage.createFromPath(getResourcePath(ResourceName.LOGO_IMAGE)),
        });

        // and load the index.html of the app.
        lyricWindow.loadURL(LRC_WINDOW_WEBPACK_ENTRY);

        if (!app.isPackaged) {
            // Open the DevTools.
            lyricWindow.webContents.openDevTools();
        }

        // 设置窗口可拖拽
        WindowDrag.setWindowDraggable(lyricWindow, {
            width,
            height,
            onDragEnd(point) {
                AppConfig.setConfig({
                    "private.lyricWindowPosition": point
                });
            }
        });

        // 初始化设置
        lyricWindow.once("ready-to-show", async () => {
            const position = AppConfig.getConfig("private.lyricWindowPosition");
            if (position) {
                this.normalizeWindowPosition(lyricWindow, position, async (position) => {
                    AppConfig.setConfig({
                        "private.lyricWindowPosition": position
                    });
                });
            }

            const lockState = AppConfig.getConfig("lyric.lockLyric");

            if (lockState) {
                lyricWindow.setIgnoreMouseEvents(true, {
                    forward: true,
                });
            }
        });

        if (process.platform === "darwin") {
            // @ts-ignore ignore error in windows legacy
            lyricWindow.invalidateShadow();
        }

        WindowManager.lrcWindow = lyricWindow;
        this.emit("WindowCreated", {
            windowName: "lyric",
            browserWindow: lyricWindow
        });
    }


    public showLyricWindow() {
        if (!WindowManager.lrcWindow) {
            this.createLyricWindow();
        }

        const lrcWindow = WindowManager.lrcWindow;

        lrcWindow.show();
        AppConfig.setConfig({
            "lyric.enableDesktopLyric": true
        });

    }

    public closeLyricWindow() {
        WindowManager.lrcWindow?.close();
        WindowManager.lrcWindow = null;
        AppConfig.setConfig({
            "lyric.enableDesktopLyric": false
        });
    }

    /**************************** MiniMode Window ***************************/
    private createMiniModeWindow() {
        // Create the browser window.
        const width = 340;
        const height = 72;
        const initPosition = AppConfig.getConfig("private.minimodeWindowPosition");

        const miniWindow = new BrowserWindow({
            height,
            width,
            x: initPosition?.x,
            y: initPosition?.y,
            webPreferences: {
                preload: MINIMODE_WINDOW_PRELOAD_WEBPACK_ENTRY,
                nodeIntegration: true,
                nodeIntegrationInWorker: true,
                webSecurity: false,
                sandbox: false,
            },
            resizable: false,
            frame: false,
            skipTaskbar: true,
            alwaysOnTop: true,
        });

        // and load the index.html of the app.
        const initUrl = new URL(MINIMODE_WINDOW_WEBPACK_ENTRY);
        miniWindow.loadURL(initUrl.toString());

        if (!app.isPackaged) {
            miniWindow.on("ready-to-show", () => {
                // Open the DevTools.
                miniWindow.webContents.openDevTools();
            });
        }

        WindowDrag.setWindowDraggable(miniWindow, {
            width,
            height,
            onDragEnd(point) {
                AppConfig.setConfig({
                    "private.minimodeWindowPosition": point
                });
            }
        });

        miniWindow.once("ready-to-show", () => {
            const position = AppConfig.getConfig("private.minimodeWindowPosition");
            if (position) {
                this.normalizeWindowPosition(miniWindow, position, async (position) => {
                    AppConfig.setConfig({
                        "private.minimodeWindowPosition": position
                    });
                });
            }

        })
        WindowManager.miniModeWindow = miniWindow;
        this.emit("WindowCreated", {
            windowName: "minimode",
            browserWindow: miniWindow
        })
    }

    public showMiniModeWindow() {
        if (!WindowManager.miniModeWindow) {
            this.createMiniModeWindow();
        }

        const miniWindow = WindowManager.miniModeWindow;

        if (miniWindow.isMinimized()) {
            miniWindow.restore();
        } else if (miniWindow.isVisible()) {
            miniWindow.focus();
        } else {
            miniWindow.show();
        }
        miniWindow.moveTop();
        miniWindow.setSkipTaskbar(false);
        AppConfig.setConfig({
            "private.minimode": true
        });
    }


    public closeMiniModeWindow() {
        WindowManager.miniModeWindow?.close();
        WindowManager.miniModeWindow = null;
        AppConfig.setConfig({
            "private.minimode": false
        });
    }

    private normalizeWindowPosition(window: BrowserWindow, position: ICommon.IPoint, onNormalized: (position: ICommon.IPoint) => void) {
        const currentDisplayBounds =
            screen.getDisplayNearestPoint(position).bounds;
        const windowBounds = window.getBounds();
        // 如果完全在是窗外，重置位置
        const [left, top, right, bottom] = [
            position.x,
            position.y,
            position.x + windowBounds.width,
            position.y + windowBounds.height,
        ];
        let needMakeup = false;
        if (left > currentDisplayBounds.x + currentDisplayBounds.width) {
            position.x =
                currentDisplayBounds.x + currentDisplayBounds.width - windowBounds.width;
            needMakeup = true;
        } else if (right < currentDisplayBounds.x) {
            position.x = currentDisplayBounds.x;
            needMakeup = true;
        }
        if (top > currentDisplayBounds.y + currentDisplayBounds.height) {
            position.y =
                currentDisplayBounds.y + currentDisplayBounds.height - windowBounds.height;
            needMakeup = true;
        } else if (bottom < currentDisplayBounds.y) {
            position.y = currentDisplayBounds.y;
            needMakeup = true;
        }
        window.setPosition(position.x, position.y, false);
        if (needMakeup) {
            onNormalized(position);
        }
    }
}


export default new WindowManager();
