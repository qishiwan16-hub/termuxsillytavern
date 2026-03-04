import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";

const exec = promisify(execCallback);

async function processList(): Promise<string> {
  if (process.platform === "win32") {
    const { stdout } = await exec("wmic process get CommandLine");
    return stdout;
  }
  const { stdout } = await exec("ps -A -o args");
  return stdout;
}

export async function isSillyTavernRunning(): Promise<boolean> {
  try {
    const output = (await processList()).toLowerCase();
    return output.includes("sillytavern");
  } catch {
    return false;
  }
}

export async function isInstanceLikelyRunning(rootPath: string): Promise<boolean> {
  const markerPath = `${rootPath}/.st-running`;
  if (await fs.pathExists(markerPath)) {
    return true;
  }
  return isSillyTavernRunning();
}
