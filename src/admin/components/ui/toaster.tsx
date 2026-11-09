import { Toaster as Sonner } from "sonner";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useUi } from "@/stores/ui";

export const Toaster = () => {
  const theme = useUi((s) => s.theme);
  return (
    <Sonner
      position="bottom-right"
      closeButton
      theme={theme}
      icons={{
        success: <CircleCheck size={16} className="text-up-text" aria-hidden />,
        error: <CircleAlert size={16} className="text-down-text" aria-hidden />,
      }}
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !border !border-border !bg-surface !text-text !shadow-lg !font-sans",
          title: "!text-sm !font-medium",
          description: "!text-xs !text-muted",
          closeButton: "!border-border !bg-surface !text-muted",
        },
      }}
    />
  );
};
