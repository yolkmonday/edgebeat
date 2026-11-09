import { useSettings } from "@/api/use-settings";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiTokensCard } from "@/features/settings/ApiTokensCard";
import { AppearanceCard } from "@/features/settings/AppearanceCard";
import { BackupCard } from "@/features/settings/BackupCard";
import { GeneralSettingsForm } from "@/features/settings/GeneralSettingsForm";

export default function SettingsPage() {
  const settings = useSettings();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />
      {settings.isPending ? (
        <Skeleton className="h-[480px] max-w-[760px]" />
      ) : settings.isError ? (
        <EmptyState
          illustration="error"
          title="Couldn't load settings"
          body="Check your connection and try again."
          actions={<Button variant="secondary" onClick={() => void settings.refetch()}>Try again</Button>}
        />
      ) : (
        <GeneralSettingsForm settings={settings.data} />
      )}
      <AppearanceCard />
      <ApiTokensCard />
      <BackupCard />
    </div>
  );
}
