import { createBrowserAdapter } from "./browser/browserAdapter";
import { isTauriRuntime } from "./browser/isTauriRuntime";
import { createHarnessAdapter } from "./desktopAdapter";
import { bootApp } from "./bootApp";

const webClient = !isTauriRuntime();
bootApp(webClient ? createBrowserAdapter() : createHarnessAdapter(), { web: webClient });
