import { useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { TopBar } from "@/components/TopBar";
import { ComingSoonPage } from "@/components/ComingSoonPage";
import { PortfolioPage } from "@/pages/PortfolioPage";
import { TradingPage } from "@/pages/TradingPage";
import { RebalancePage } from "@/pages/RebalancePage";
import { AutomationPage } from "@/pages/AutomationPage";
import { AsicMinersPage } from "@/pages/AsicMinersPage";
import { NicehashPage } from "@/pages/NicehashPage";

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
  settings: {
    title: "Settings",
    description: "Extended settings and account controls are coming soon.",
  },
};

const Index = () => {
  const [currentPage, setCurrentPage] = useState("portfolio");

  const renderPage = () => {
    switch (currentPage) {
      case "portfolio":
        return <PortfolioPage />;
      case "trading":
        return <TradingPage />;
      case "rebalance":
        return <RebalancePage />;
      case "automation":
        return <AutomationPage />;
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
    <div className="flex h-screen bg-background overflow-hidden">
      <AppSidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto">{renderPage()}</main>
      </div>
    </div>
  );
};

export default Index;
