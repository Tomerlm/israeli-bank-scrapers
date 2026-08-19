export type PortfolioPosition = {
  identifier: string;
  name: string;
  quantity: number;
  price: number;
  currency: string;
  avgCost?: number;
  unrealizedPnl?: number;
};

export type PortfolioCash = {
  currency: string;
  amount: number;
};

export type PortfolioDeposit = {
  identifier: string;
  name: string;
  currency: string;
  principal: number;
  currentValue: number;
  maturityDate?: string;
  openDate?: string;
  interestRatePercent?: number;
  linkage?: string;
};

export type PortfolioScrapingResult =
  | { success: true; positions: PortfolioPosition[]; cash: PortfolioCash[]; deposits?: PortfolioDeposit[]; asOfDate: string }
  | { success: false; errorType: string; errorMessage: string };

export interface PortfolioScraper {
  scrape(credentials: Record<string, unknown>): Promise<PortfolioScrapingResult>;
}
