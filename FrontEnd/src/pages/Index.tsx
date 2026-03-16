import { useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { SettingsModal } from "@/components/SettingsModal";
import { TopBar } from "@/components/TopBar";
import { ProfileModal } from "@/components/ProfileModal";
import { ComingSoonPage } from "@/components/ComingSoonPage";
import { PortfolioPage } from "@/pages/PortfolioPage";
import { TradingPage } from "@/pages/TradingPage";
import { RebalancePage } from "@/pages/RebalancePage";
import { AutomationPage } from "@/pages/AutomationPage";
import { AsicMinersPage } from "@/pages/AsicMinersPage";
import { NicehashPage } from "@/pages/NicehashPage";
import type { AppSession, PortfolioAccountType } from "@/types/api";

const inactivePageMeta: Record<string, { title: string; description: string }> = {
  dashboard: {
    title: "Dashboard",
    description: "Dashboard widgets and broad analytics are inactive in this initial release.",
  },
  markets: {
    title: "Markets",
    description: "Expanded market scanner and discovery tools are coming soon.",
  },
  orders: {
    title: "Orders",
    description: "Detailed order history and management are coming soon.",
  },
};

interface IndexProps {
  session: AppSession;
  onLogout: () => void;
}

const Index = ({ session, onLogout }: IndexProps) => {
  const [currentPage, setCurrentPage] = useState("portfolio");
  const [accountType, setAccountType] = useState<PortfolioAccountType>("demo");
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const renderPage = () => {
    switch (currentPage) {
      case "portfolio":
        return <PortfolioPage accountType={accountType} />;
      case "trading":
        return <TradingPage accountType={accountType} />;
      case "rebalance":
        return <RebalancePage accountType={accountType} />;
      case "automation":
        return <AutomationPage accountType={accountType} />;
      case "asic-miners":
        return <AsicMinersPage />;
      case "nicehash":
        return <NicehashPage />;
      default: {
        const inactive = inactivePageMeta[currentPage];
        return (
          <ComingSoonPage
            title={inactive?.title ?? "Module"}
            description={inactive?.description ?? "This module is currently inactive."}
          />
        );
      }
    }
  };

  return (
    <div data-account-mode={accountType} className="app-shell flex h-screen bg-background overflow-hidden">
      <AppSidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          accountType={accountType}
          onAccountTypeChange={setAccountType}
          session={session}
          onLogout={onLogout}
          onProfileOpen={() => setProfileOpen(true)}
        />
        <main className="flex-1 overflow-y-auto">
          <div key={currentPage} className="page-enter">
            {renderPage()}
          </div>
        </main>
      </div>
      <ProfileModal
        session={session}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onLogout={onLogout}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

export default Index;
