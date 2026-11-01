import { useState } from "react";
import { SettingsPanelBlock, SettingsRow } from "./SettingsPanel";

type InstallState =
  | { kind: "idle" }
  | { kind: "installing" }
  | { kind: "done"; path: string; onPath: boolean }
  | { kind: "error"; message: string };

/** Panel row that installs the `harness <path>` shell command. */
export function CliInstallRow() {
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
    <>
      <SettingsRow
        label="Command line"
        description={
          <>
            Open files from the terminal with <code>harness notes.md</code>. They open in their own
            editor window and save in place.
          </>
        }
      >
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void install()}
          disabled={state.kind === "installing"}
          data-testid="settings-install-cli"
        >
          {state.kind === "done" ? "Reinstall" : "Install"}
        </button>
      </SettingsRow>
      {state.kind === "done" ? (
        <SettingsPanelBlock>
          <p className="settings-row__desc">
            Installed at <code>{state.path}</code>.
            {state.onPath ? null : " Add its folder to your PATH to use it."}
          </p>
        </SettingsPanelBlock>
      ) : null}
      {state.kind === "error" ? (
        <SettingsPanelBlock>
          <p className="settings-inline-error">{state.message}</p>
        </SettingsPanelBlock>
      ) : null}
    </>
  );
}
