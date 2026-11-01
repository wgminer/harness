import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_CHAT_PROVIDER,
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  normalizeChatProvider,
  type ChatProviderId,
} from "../../shared/chatProviders";
import type { Settings } from "../../shared/types";

type ModelSettings = NonNullable<Settings["model"]>;

/** System > Connections > Chat model: provider choice, local endpoint, and the Anthropic key. Saves on its own. */
export function useModelSettings({ onSaved }: { onSaved?: () => void }) {
  const [provider, setProvider] = useState<ChatProviderId>(DEFAULT_CHAT_PROVIDER);
  const [localBaseUrl, setLocalBaseUrl] = useState(DEFAULT_LOCAL_BASE_URL);
  const [localModel, setLocalModel] = useState(DEFAULT_LOCAL_MODEL);
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [settings, secrets] = await Promise.all([
        window.harness.settings.get() as Promise<Settings>,
        window.harness.credentials.getSecretsForSettings(),
      ]);
      if (cancelled) return;
      setProvider(normalizeChatProvider(settings.model?.provider));
      setLocalBaseUrl(settings.model?.localBaseUrl || DEFAULT_LOCAL_BASE_URL);
      setLocalModel(settings.model?.localModel || DEFAULT_LOCAL_MODEL);
      setAnthropicApiKey(secrets.anthropicApiKey ?? "");
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveModel = useCallback(
    async (next: ModelSettings) => {
      await window.harness.settings.set({ model: next });
      onSaved?.();
    },
    [onSaved],
  );

  const current = useCallback(
    (): ModelSettings => ({
      provider,
      localBaseUrl: localBaseUrl.trim() || DEFAULT_LOCAL_BASE_URL,
      localModel: localModel.trim() || DEFAULT_LOCAL_MODEL,
    }),
    [provider, localBaseUrl, localModel],
  );

  const selectProvider = useCallback(
    (id: ChatProviderId) => {
      setProvider(id);
      void saveModel({ ...current(), provider: id });
    },
    [current, saveModel],
  );

  const saveLocal = useCallback(() => {
    const next = current();
    setLocalBaseUrl(next.localBaseUrl);
    setLocalModel(next.localModel);
    void saveModel(next);
  }, [current, saveModel]);

  const saveAnthropicApiKey = useCallback(async () => {
    await window.harness.credentials.setAnthropicApiKey(anthropicApiKey.trim());
    onSaved?.();
  }, [anthropicApiKey, onSaved]);

  return {
    loaded,
    provider,
    selectProvider,
    localBaseUrl,
    setLocalBaseUrl,
    localModel,
    setLocalModel,
    saveLocal,
    anthropicApiKey,
    setAnthropicApiKey,
    saveAnthropicApiKey,
  };
}
