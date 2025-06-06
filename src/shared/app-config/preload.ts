import { contextBridge, ipcRenderer } from "electron";


async function syncConfig() {
    return await ipcRenderer.invoke("@shared/app-config/sync-app-config");
}

function setConfig(config: any) {
    return ipcRenderer.send("@shared/app-config/set-app-config", config);
}

function reset() {
    return ipcRenderer.send("@shared/app-config/reset");
}

function onConfigUpdate(callback: (patch: any) => void) {
    ipcRenderer.on("@shared/app-config/update-app-config", (_event, patch) => {
        callback(patch);
    });
}


const mod = {
    syncConfig,
    setConfig,
    onConfigUpdate,
    reset,
}

contextBridge.exposeInMainWorld("@shared/app-config", mod);

