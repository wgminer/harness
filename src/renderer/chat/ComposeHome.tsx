import { useEffect, useState } from "react";
import {
  homeHeaderQuoteAttribution,
  homeHeaderQuoteNote,
  nextHomeHeaderQuote,
  type HomeHeaderQuote,
} from "../../shared/headerQuote";

/** Mounts only on empty compose — draws once per visit from the shuffle bag. */
export function ComposeHeaderQuote() {
  const [quote] = useState<HomeHeaderQuote>(() => nextHomeHeaderQuote());
  const attribution = homeHeaderQuoteAttribution(quote);
  const note = homeHeaderQuoteNote(quote);
  return (
    <span className="tooltip new-chat-quote-tooltip">
      <p className="new-chat-quote">{`“${quote.full}”`}</p>
      <span className="tooltip__label">
        {attribution ? <span className="new-chat-quote-tooltip__attr">{attribution}</span> : null}
        {note ? <span>{note}</span> : null}
      </span>
    </span>
  );
}

const WEB_VERSION_SUFFIX = "-web";

/** `v0.10.1 · dev` under the Vite dev server, `v0.10.1 · web` in the browser shell, bare when installed. */
function formatComposeVersion(version: string | null): string {
  if (!version) return "";
  if (version.endsWith(WEB_VERSION_SUFFIX)) {
    return `v${version.slice(0, -WEB_VERSION_SUFFIX.length)} · web`;
  }
  const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  return isDev ? `v${version} · dev` : `v${version}`;
}

/** App version in the bottom-right corner of the compose splash. */
export function ComposeCornerMeta() {
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    window.harness.app.getVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  return (
    <p className="new-chat-corner new-chat-corner--bottom-right" aria-hidden="true">
      {formatComposeVersion(appVersion)}
    </p>
  );
}
