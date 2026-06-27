/**
 * Cloudflare R2 remote backup (S3-compatible API).
 * Stores `bundle.json.gz` + `manifest.json` under a configurable prefix.
 */

import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "stream";

export const BUNDLE_OBJECT_NAME = "bundle.json.gz";
export const MANIFEST_OBJECT_NAME = "manifest.json";

export interface BackupManifest {
  version: number;
  revision: string;
  contentRevision?: string;
  updatedAt: number;
  bundleHash: string;
}

export interface R2Config {
  accountId: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function normalizeR2Prefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, "");
  if (!trimmed) return "harness/";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function r2Endpoint(accountId: string): string {
  return `https://${accountId.trim()}.r2.cloudflarestorage.com`;
}

function objectKey(prefix: string, name: string): string {
  return `${normalizeR2Prefix(prefix)}${name}`;
}

async function streamToBuffer(body: Readable | ReadableStream | Blob | undefined): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  if (typeof (body as ReadableStream).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
  const nodeStream = body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of nodeStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class RemoteBackupStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: R2Config) {
    this.bucket = config.bucket.trim();
    this.prefix = normalizeR2Prefix(config.prefix);
    this.client = new S3Client({
      region: "auto",
      endpoint: r2Endpoint(config.accountId),
      credentials: {
        accessKeyId: config.accessKeyId.trim(),
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  manifestKey(): string {
    return objectKey(this.prefix, MANIFEST_OBJECT_NAME);
  }

  bundleKey(): string {
    return objectKey(this.prefix, BUNDLE_OBJECT_NAME);
  }

  async readManifest(): Promise<BackupManifest | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.manifestKey(),
        }),
      );
      const bytes = await streamToBuffer(response.Body as Readable);
      const raw = JSON.parse(bytes.toString("utf-8")) as Partial<BackupManifest>;
      if (
        typeof raw.revision === "string" &&
        typeof raw.updatedAt === "number" &&
        typeof raw.bundleHash === "string" &&
        typeof raw.version === "number"
      ) {
        return {
          version: raw.version,
          revision: raw.revision,
          contentRevision: typeof raw.contentRevision === "string" ? raw.contentRevision : undefined,
          updatedAt: raw.updatedAt,
          bundleHash: raw.bundleHash,
        };
      }
      return null;
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (name === "NoSuchKey" || status === 404) return null;
      throw err;
    }
  }

  async readBundle(): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.bundleKey(),
      }),
    );
    return streamToBuffer(response.Body as Readable);
  }

  async writeBundleAndManifest(params: {
    bundleBytes: Buffer;
    manifest: BackupManifest;
  }): Promise<void> {
    const { bundleBytes, manifest } = params;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.bundleKey(),
        Body: bundleBytes,
        ContentType: "application/gzip",
      }),
    );
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.manifestKey(),
        Body: Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
        ContentType: "application/json",
      }),
    );
  }

  async testConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      try {
        await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: this.manifestKey() }),
        );
      } catch (err: unknown) {
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status !== 404) throw err;
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function isR2ConfigComplete(
  sync: { accountId?: string; bucket?: string; prefix?: string; accessKeyId?: string } | undefined,
  hasSecret: boolean,
): boolean {
  if (!sync || !hasSecret) return false;
  return Boolean(
    sync.accountId?.trim() &&
      sync.bucket?.trim() &&
      sync.accessKeyId?.trim(),
  );
}
