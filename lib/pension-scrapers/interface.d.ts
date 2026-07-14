export type PensionHoldingOutput = {
    productType: string;
    managingCompany: string;
    policyNumber: string;
    balanceIls: number;
    feeFromBalancePct: number;
    feeFromDepositPct: number;
    track: string;
    status: string;
    yieldPct: number | null;
    monthlyDepositIls: number | null;
    projectedPensionIls: number | null;
    coverage: Record<string, unknown> | null;
};
export type PensionScrapingResult = {
    success: true;
    holdings: PensionHoldingOutput[];
    asOfDate: string;
} | {
    success: false;
    errorType: string;
    errorMessage: string;
};
export interface PensionScraper {
    scrape(credentials: Record<string, unknown>): Promise<PensionScrapingResult>;
}
