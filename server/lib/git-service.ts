import path from "node:path";
import fs from "fs-extra";
import { simpleGit, type SimpleGit } from "simple-git";
import { APP_PATHS } from "./env.js";

function ignoreGitDir(src: string): boolean {
  return !src.includes(`${path.sep}.git${path.sep}`) && !src.endsWith(`${path.sep}.git`);
}

export class GitService {
  private mirrorPath(instanceId: string): string {
    return path.join(APP_PATHS.reposDir, instanceId, "mirror");
  }

  private git(pathName: string): SimpleGit {
    return simpleGit(pathName);
  }

  private async ensureMirrorInitialized(instanceId: string): Promise<string> {
    const mirror = this.mirrorPath(instanceId);
    await fs.ensureDir(mirror);
    const gitDir = path.join(mirror, ".git");
    if (!(await fs.pathExists(gitDir))) {
      await this.git(mirror).init();
    }
    return mirror;
  }

  async clone(instanceId: string, repoUrl: string, branch?: string): Promise<void> {
    const mirror = this.mirrorPath(instanceId);
    await fs.remove(mirror);
    await fs.ensureDir(path.dirname(mirror));
    const git = this.git(path.dirname(mirror));
    const args = branch ? ["--branch", branch] : [];
    await git.clone(repoUrl, mirror, args);
  }

  async syncInstanceToMirror(instanceId: string, instanceRootPath: string): Promise<string> {
    const mirror = await this.ensureMirrorInitialized(instanceId);
    const gitDir = path.join(mirror, ".git");

    const entries = await fs.readdir(mirror);
    for (const entry of entries) {
      if (entry === ".git") {
        continue;
      }
      await fs.remove(path.join(mirror, entry));
    }

    await fs.copy(instanceRootPath, mirror, {
      overwrite: true,
      filter: (src) => ignoreGitDir(src)
    });

    if (await fs.pathExists(gitDir)) {
      await fs.ensureDir(gitDir);
    }
    return mirror;
  }

  async syncMirrorToInstance(instanceId: string, instanceRootPath: string): Promise<void> {
    const mirror = this.mirrorPath(instanceId);
    if (!(await fs.pathExists(path.join(mirror, ".git")))) {
      throw new Error("镜像仓库不存在，请先 clone");
    }
    await fs.copy(mirror, instanceRootPath, {
      overwrite: true,
      filter: (src) => ignoreGitDir(src)
    });
  }

  async commit(instanceId: string, instanceRootPath: string, message: string): Promise<string> {
    const mirror = await this.syncInstanceToMirror(instanceId, instanceRootPath);
    const git = this.git(mirror);
    await git.add("./*");
    const status = await git.status();
    if (status.isClean()) {
      return "无变更可提交";
    }
    const result = await git.commit(message || `update ${new Date().toISOString()}`);
    return result.commit;
  }

  async pull(instanceId: string, instanceRootPath: string): Promise<string> {
    const mirror = this.mirrorPath(instanceId);
    const git = this.git(mirror);
    const result = await git.pull();
    await this.syncMirrorToInstance(instanceId, instanceRootPath);
    return result.summary.changes.toString();
  }

  async push(instanceId: string, instanceRootPath: string, message?: string): Promise<void> {
    await this.commit(instanceId, instanceRootPath, message || "sync before push");
    const mirror = this.mirrorPath(instanceId);
    await this.git(mirror).push();
  }
}
