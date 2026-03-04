import crypto from "node:crypto";
import fs from "fs-extra";
import { APP_PATHS } from "./env.js";

interface SecurityConfig {
  enabled: boolean;
  iterations: number;
  salt?: string;
  passwordHash?: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionInfo {
  token: string;
  createdAt: number;
  expiresAt: number;
}

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
const DEFAULT_ITERATIONS = 210_000;
const MIN_PASSWORD_LENGTH = 6;

function nowIso(): string {
  return new Date().toISOString();
}

function hashPassword(password: string, salt: string, iterations: number): string {
  return crypto.pbkdf2Sync(password, salt, iterations, 64, "sha512").toString("hex");
}

export class AuthService {
  private config: SecurityConfig = {
    enabled: false,
    iterations: DEFAULT_ITERATIONS,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  private sessions = new Map<string, SessionInfo>();

  async init(): Promise<void> {
    await fs.ensureFile(APP_PATHS.securityFile);
    const content = await fs.readFile(APP_PATHS.securityFile, "utf8").catch(() => "");
    if (!content.trim()) {
      await this.persist();
      return;
    }
    const parsed = (await fs.readJson(APP_PATHS.securityFile)) as Partial<SecurityConfig>;
    this.config = {
      enabled: Boolean(parsed.enabled),
      iterations: parsed.iterations ?? DEFAULT_ITERATIONS,
      salt: parsed.salt,
      passwordHash: parsed.passwordHash,
      createdAt: parsed.createdAt ?? nowIso(),
      updatedAt: parsed.updatedAt ?? nowIso()
    };
  }

  private async persist(): Promise<void> {
    await fs.writeJson(APP_PATHS.securityFile, this.config, { spaces: 2 });
  }

  private ensurePasswordRules(password: string): void {
    if (password.trim().length < MIN_PASSWORD_LENGTH) {
      throw new Error(`密码长度至少 ${MIN_PASSWORD_LENGTH} 位`);
    }
  }

  status(): { enabled: boolean; passwordConfigured: boolean } {
    return {
      enabled: this.config.enabled,
      passwordConfigured: Boolean(this.config.passwordHash && this.config.salt)
    };
  }

  async setupPassword(password: string): Promise<void> {
    this.ensurePasswordRules(password);
    const salt = crypto.randomBytes(24).toString("hex");
    this.config.salt = salt;
    this.config.passwordHash = hashPassword(password, salt, this.config.iterations);
    this.config.enabled = true;
    this.config.updatedAt = nowIso();
    await this.persist();
    this.sessions.clear();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.config.enabled = enabled;
    this.config.updatedAt = nowIso();
    await this.persist();
    if (!enabled) {
      this.sessions.clear();
    }
  }

  private verifyPassword(password: string): boolean {
    if (!this.config.passwordHash || !this.config.salt) {
      return false;
    }
    const digest = hashPassword(password, this.config.salt, this.config.iterations);
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(this.config.passwordHash));
  }

  async login(password: string): Promise<string> {
    if (!this.status().passwordConfigured) {
      throw new Error("未配置访问密码");
    }
    if (!this.verifyPassword(password)) {
      throw new Error("密码错误");
    }
    const now = Date.now();
    const token = crypto.randomUUID();
    this.sessions.set(token, {
      token,
      createdAt: now,
      expiresAt: now + TOKEN_TTL_MS
    });
    return token;
  }

  logout(token?: string): void {
    if (!token) {
      return;
    }
    this.sessions.delete(token);
  }

  isRequestAuthorized(token?: string): boolean {
    if (!this.config.enabled) {
      return true;
    }
    if (!token) {
      return false;
    }
    const session = this.sessions.get(token);
    if (!session) {
      return false;
    }
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    session.expiresAt = Date.now() + TOKEN_TTL_MS;
    this.sessions.set(token, session);
    return true;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (!this.verifyPassword(currentPassword)) {
      throw new Error("当前密码错误");
    }
    this.ensurePasswordRules(newPassword);
    const salt = crypto.randomBytes(24).toString("hex");
    this.config.salt = salt;
    this.config.passwordHash = hashPassword(newPassword, salt, this.config.iterations);
    this.config.updatedAt = nowIso();
    await this.persist();
    this.sessions.clear();
  }
}
