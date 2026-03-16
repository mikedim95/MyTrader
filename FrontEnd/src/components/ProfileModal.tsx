import { X, LogOut, Settings, User, Shield } from "lucide-react";
import type { AppSession } from "@/types/api";
import { cn } from "@/lib/utils";

interface ProfileModalProps {
  session: AppSession;
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  onNavigate: (page: string) => void;
}

function getUserInitials(username: string): string {
  return username
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";
}

export function ProfileModal({ session, open, onClose, onLogout, onNavigate }: ProfileModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 animate-overlay-fade" onClick={onClose}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
      <div className="flex items-start justify-end p-4 md:p-6">
        <div
          className="relative mt-14 w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl animate-fade-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Profile header */}
          <div className="p-6 pb-4 border-b border-border">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/30">
                <span className="text-lg font-mono font-semibold text-primary">
                  {getUserInitials(session.username)}
                </span>
              </div>
              <div>
                <div className="text-base font-mono font-semibold text-foreground">{session.username}</div>
                <div className="text-sm text-muted-foreground mt-0.5">Logged in</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-3 space-y-1">
            <button
              onClick={() => { onNavigate("settings"); onClose(); }}
              className="w-full flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-mono text-foreground transition hover:bg-secondary/60"
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
              Settings
            </button>
            <button
              className="w-full flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-mono text-muted-foreground cursor-not-allowed opacity-50"
              disabled
            >
              <User className="h-4 w-4" />
              Edit Profile
              <span className="ml-auto text-[10px] uppercase tracking-wider">Soon</span>
            </button>
            <button
              className="w-full flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-mono text-muted-foreground cursor-not-allowed opacity-50"
              disabled
            >
              <Shield className="h-4 w-4" />
              Security
              <span className="ml-auto text-[10px] uppercase tracking-wider">Soon</span>
            </button>
          </div>

          <div className="border-t border-border p-3">
            <button
              onClick={() => { onLogout(); onClose(); }}
              className="w-full flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-mono text-negative transition hover:bg-negative/10"
            >
              <LogOut className="h-4 w-4" />
              Log Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
