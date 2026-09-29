import { useState } from "react";
import { SettingsGroup } from "./SettingsGroup";

type InstallState =
  | { kind: "idle" }
  | { kind: "installing" }
  | { kind: "done"; path: string; onPath: boolean }
  | { kind: "error"; message: string };

/** Installs the `harness <path>` shell command. */
export function CliInstallSection() {
  const [state, setState] = useState<InstallState>({ kind: "idle" });

  const install = async () => {
    setState({ kind: "installing" });
    try {
      const result = await window.harness.files.installCli();
      setState({ kind: "done", ...result });
    } catch (err) {
      setState({ kind: "error", message: String(err) });
    }
  };

  return (
    <SettingsGroup
      title="Command line"
      description={
        <>
          Open files from the terminal with <code>harness notes.md</code>. Markdown and text files
          open in their own editor window and save in place.
        </>
      }
    >
      <div className="cli-install">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void install()}
          disabled={state.kind === "installing"}
          data-testid="settings-install-cli"
        >
          {state.kind === "done" ? "Reinstall harness command" : "Install harness command"}
        </button>
        {state.kind === "done" ? (
          <p className="cli-install__result">
            Installed at <code>{state.path}</code>.
            {state.onPath ? null : " Add its folder to your PATH to use it."}
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p className="cli-install__result cli-install__result--error">{state.message}</p>
        ) : null}
      </div>
    </SettingsGroup>
  );
}
