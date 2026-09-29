import { Switch } from "@/components/ui/switch";
import SettingRow from "./SettingRow";

interface GeneralSettingsProps {
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
  showLineNumbers: boolean;
  setShowLineNumbers: (enabled: boolean) => void;
}

export default function GeneralSettings({
  vimEnabled,
  setVimEnabled,
  showLineNumbers,
  setShowLineNumbers,
}: GeneralSettingsProps) {
  return (
    <div className="divide-y divide-zinc-800">
      <SettingRow title="Vim Mode" description="Enable Vim keybindings for the editor">
        <Switch checked={vimEnabled} onCheckedChange={setVimEnabled} />
      </SettingRow>
      <SettingRow title="Line Numbers" description="Show line numbers in the editor gutter">
        <Switch checked={showLineNumbers} onCheckedChange={setShowLineNumbers} />
      </SettingRow>
    </div>
  );
}
