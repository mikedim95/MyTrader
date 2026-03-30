import { Activity, Link2 } from "lucide-react";
import { GroupedPane, type GroupedPaneTab } from "@/components/GroupedPane";
import { ExchangeConnectionsPage } from "@/pages/ExchangeConnectionsPage";
import { ExchangeIntelligencePage } from "@/pages/ExchangeIntelligencePage";
import type { PortfolioAccountType } from "@/types/api";

export type ExchangesHubTab = "connections" | "market-intel";

interface ExchangesHubPageProps {
  activeTab: ExchangesHubTab;
  accountType: PortfolioAccountType;
  onTabChange: (tab: ExchangesHubTab) => void;
}

const EXCHANGES_TABS: GroupedPaneTab<ExchangesHubTab>[] = [
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "market-intel", label: "Market Intel", icon: Activity },
];

export function ExchangesHubPage({ activeTab, accountType, onTabChange }: ExchangesHubPageProps) {
  return (
    <GroupedPane
      title="Exchanges"
      description="Keep venue setup, market comparison, and current holdings in one place. Connect Crypto.com privately here, while Kraken, Coinbase, and Crypto.com stay visible together for public market checks."
      tabs={EXCHANGES_TABS}
      activeTab={activeTab}
      onTabChange={onTabChange}
    >
      {activeTab === "connections" ? <ExchangeConnectionsPage /> : <ExchangeIntelligencePage accountType={accountType} embedded />}
    </GroupedPane>
  );
}
