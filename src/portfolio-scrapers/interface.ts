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

export type PortfolioScrapingResult =
  | { success: true; positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }
  | { success: false; errorType: string; errorMessage: string };

export interface PortfolioScraper {
  scrape(credentials: Record<string, unknown>): Promise<PortfolioScrapingResult>;
}
