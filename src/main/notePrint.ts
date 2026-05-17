import { BrowserWindow } from "electron";

export async function printHtml(html: string, jobName?: string): Promise<{ success: boolean }> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const success = await new Promise<boolean>((resolve) => {
      win.webContents.print(
        {
          silent: false,
          printBackground: true,
          ...(jobName ? { documentName: jobName } : {}),
        },
        (printed, failureReason) => {
          if (!printed && failureReason) {
            console.warn("[notePrint]", failureReason);
          }
          resolve(printed);
        },
      );
    });
    return { success };
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}
