import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aria", {
  getBackendPort: (): Promise<number> =>
    ipcRenderer.invoke("get-backend-port"),

  keytarGet: (service: string, account: string): Promise<string | null> =>
    ipcRenderer.invoke("keytar-get", service, account),

  keytarSet: (service: string, account: string, password: string): Promise<void> =>
    ipcRenderer.invoke("keytar-set", service, account, password),

  keytarDelete: (service: string, account: string): Promise<void> =>
    ipcRenderer.invoke("keytar-delete", service, account),

  openResearcherPanel: (password: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("open-researcher-panel", password),

  setResearcherPassword: (pw: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("set-researcher-password", pw),

  saveExport: (data: string): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke("save-export", data),

  onResearcherShortcut: (cb: () => void) => {
    ipcRenderer.on("researcher-shortcut", cb);
    return () => ipcRenderer.removeListener("researcher-shortcut", cb);
  },
});
