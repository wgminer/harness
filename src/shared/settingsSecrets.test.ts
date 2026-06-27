import { describe, expect, it } from "vitest";
import { redactSettingsJsonBytes, stripSettingsSecrets } from "./settingsSecrets";

describe("settingsSecrets", () => {
  it("strips api keys from settings objects", () => {
    const stripped = stripSettingsSecrets({
      version: 1,
      openai: { apiKey: "sk-test" },
      search: { tavilyApiKey: "tvly-test" },
      sync: { accountId: "acc", bucket: "b", prefix: "harness/", accessKeyId: "key" },
    });
    expect(stripped.openai).toBeUndefined();
    expect(stripped.search).toBeUndefined();
    expect((stripped.sync as { accountId: string }).accountId).toBe("acc");
  });

  it("redacts secrets from settings.json bytes", () => {
    const raw = Buffer.from(
      JSON.stringify({ openai: { apiKey: "secret" }, weather: { defaultZip: "12528" } }),
      "utf-8",
    );
    const redacted = JSON.parse(redactSettingsJsonBytes(raw).toString("utf-8")) as Record<string, unknown>;
    expect((redacted.openai as Record<string, unknown> | undefined)?.apiKey).toBeUndefined();
    expect((redacted.weather as { defaultZip: string }).defaultZip).toBe("12528");
  });
});
