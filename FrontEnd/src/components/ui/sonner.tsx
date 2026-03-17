import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      duration={10_000}
      expand={false}
      offset={16}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:w-auto group-[.toaster]:min-h-0 group-[.toaster]:max-w-[420px] group-[.toaster]:rounded-md group-[.toaster]:border-border group-[.toaster]:bg-background/95 group-[.toaster]:px-3 group-[.toaster]:py-2 group-[.toaster]:text-foreground group-[.toaster]:shadow-lg backdrop-blur",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
