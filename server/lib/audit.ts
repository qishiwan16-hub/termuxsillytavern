import fs from "fs-extra";
import { APP_PATHS } from "./env.js";

function now(): string {
  return new Date().toISOString();
}

export async function appendAuditLog(
  action: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await fs.ensureFile(APP_PATHS.auditLogFile);
  const line = JSON.stringify({
    time: now(),
    action,
    ...detail
  });
  await fs.appendFile(APP_PATHS.auditLogFile, `${line}\n`, "utf8");
}
