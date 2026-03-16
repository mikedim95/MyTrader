import { Lock } from "lucide-react";

interface ComingSoonPageProps {
  title: string;
  description?: string;
}

export function ComingSoonPage({ title, description }: ComingSoonPageProps) {
  return (
    <div className="p-4 md:p-6">
      <div className="max-w-3xl rounded-lg border border-border bg-card p-6 md:p-8 animate-fade-up">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          Coming Soon
        </div>
        <h2 className="mt-4 text-xl font-mono font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {description ?? "This area is intentionally inactive while we focus on the core release."}
        </p>
      </div>
    </div>
  );
}
