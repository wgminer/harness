import { resolve } from "node:path";

export interface AppConfig {
  port: number;
  apiSecretKey: string;
  dbPath: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(raw: string | undefined): number {
  const fallback = 3000;
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseLogLevel(raw: string | undefined): AppConfig["logLevel"] {
  const valid = new Set<AppConfig["logLevel"]>(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
  if (!raw) return "info";
  return valid.has(raw as AppConfig["logLevel"]) ? (raw as AppConfig["logLevel"]) : "info";
}

export function getConfig(): AppConfig {
  return {
    port: parsePort(process.env.PORT),
    apiSecretKey: requiredEnv("API_SECRET_KEY"),
    dbPath: resolve(process.env.DB_PATH?.trim() || "./data/personal-api.sqlite"),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
  };
}
