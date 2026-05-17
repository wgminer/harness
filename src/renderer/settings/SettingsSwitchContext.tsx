import { createContext, useContext, type ReactNode } from "react";

const SettingsSwitchContext = createContext(false);

export function SettingsSwitchProvider({
  animationsReady,
  children,
}: {
  animationsReady: boolean;
  children: ReactNode;
}) {
  return (
    <SettingsSwitchContext.Provider value={animationsReady}>{children}</SettingsSwitchContext.Provider>
  );
}

export function useSettingsSwitchAnimationsReady(): boolean {
  return useContext(SettingsSwitchContext);
}
