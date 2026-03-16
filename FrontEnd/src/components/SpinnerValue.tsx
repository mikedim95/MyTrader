import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SpinnerValueProps {
  loading: boolean;
  value?: ReactNode;
  placeholder?: ReactNode;
  className?: string;
  spinnerClassName?: string;
}

export function SpinnerValue({
  loading,
  value,
  placeholder = "--",
  className,
  spinnerClassName,
}: SpinnerValueProps) {
  if (loading) {
    return <Skeleton className={cn("inline-block h-[1em] w-[8ch] align-middle", className, spinnerClassName)} />;
  }

  return <span className={className}>{value ?? placeholder}</span>;
}
