import { Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { useUi, type Theme } from "@/stores/ui";

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const AppearanceCard = () => {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  return (
    <Card className="max-w-[760px]" title="Appearance" description="System follows your device. This only changes the admin, not your public status page.">
      <Tabs aria-label="Theme" value={theme} onValueChange={(v) => setTheme(v as Theme)} items={THEMES} />
    </Card>
  );
};
