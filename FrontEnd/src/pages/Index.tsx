import { useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { SettingsModal } from "@/components/SettingsModal";
import { TopBar } from "@/components/TopBar";
import { ProfileModal } from "@/components/ProfileModal";
import { ComingSoonPage } from "@/components/ComingSoonPage";
import { PortfolioPage } from "@/pages/PortfolioPage";
import { ExchangesHubPage, type ExchangesHubTab } from "@/pages/ExchangesHubPage";
import { ExecutionSimulatorPage } from "@/pages/ExecutionSimulatorPage";
import { AsicMinersPage } from "@/pages/AsicMinersPage";
import { IntelligenceHubPage, type IntelligenceHubTab } from "@/pages/IntelligenceHubPage";
import { NicehashPage } from "@/pages/NicehashPage";
import { StrategiesHubPage, type StrategiesHubTab } from "@/pages/StrategiesHubPage";
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
  const [exchangesTab, setExchangesTab] = useState<ExchangesHubTab>("connections");
  const [strategiesTab, setStrategiesTab] = useState<StrategiesHubTab>("bots");
  const [intelligenceTab, setIntelligenceTab] = useState<IntelligenceHubTab>("decision-intelligence");

  const handleNavigate = (page: string) => {
    switch (page) {
      case "rebalance":
      case "bots":
        setStrategiesTab("bots");
        setCurrentPage("strategies");
        return;
      case "automation":
        setStrategiesTab("automation");
        setCurrentPage("strategies");
        return;
      case "strategies":
        setCurrentPage("strategies");
        return;
      case "decision-intelligence":
      case "signal-review":
      case "btc-news":
        setIntelligenceTab(page);
        setCurrentPage("intelligence");
        return;
      case "intelligence":
        setCurrentPage("intelligence");
        return;
      default:
        setCurrentPage(page);
    }
  };

  const renderPage = () => {
    switch (currentPage) {
      case "portfolio":
        return (
          <PortfolioPage
            accountType={accountType}
            onOpenExchangeConnections={() => {
              setExchangesTab("connections");
              setCurrentPage("exchange-intelligence");
            }}
            onOpenExchangeMarket={() => {
              setExchangesTab("market-intel");
              setCurrentPage("exchange-intelligence");
            }}
          />
        );
      case "exchange-intelligence":
        return <ExchangesHubPage accountType={accountType} activeTab={exchangesTab} onTabChange={setExchangesTab} />;
      case "execution-simulator":
        return <ExecutionSimulatorPage />;
      case "rebalance":
      case "bots":
      case "automation":
      case "strategies":
        return (
          <StrategiesHubPage
            accountType={accountType}
            activeTab={strategiesTab}
            onTabChange={setStrategiesTab}
          />
        );
      case "decision-intelligence":
      case "signal-review":
      case "btc-news":
      case "intelligence":
        return (
          <IntelligenceHubPage
            accountType={accountType}
            activeTab={intelligenceTab}
            onTabChange={setIntelligenceTab}
          />
        );
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
      <AppSidebar currentPage={currentPage} onNavigate={handleNavigate} />
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
