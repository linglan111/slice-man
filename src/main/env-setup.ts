import { app } from "electron";
import { isAbsolute } from "node:path";
export const isE2e = !app.isPackaged && process.env.APP_E2E === "1";
if (isE2e) {
  const path = process.env.APP_E2E_USER_DATA;
  if (!path || !isAbsolute(path))
    throw new Error(
      "APP_E2E_USER_DATA must be an absolute isolated test directory",
    );
  app.setPath("userData", path);
} else if (!app.isPackaged)
  app.setPath("userData", `${app.getPath("userData")}-dev`);
