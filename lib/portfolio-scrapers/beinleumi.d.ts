import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';
export declare class BeinleumiPortfolioScraper extends BasePortfolioScraper {
    protected fetchPortfolio(page: Page, credentials: Record<string, unknown>): Promise<{
        positions: PortfolioPosition[];
        cash: PortfolioCash[];
        asOfDate: string;
    }>;
    private login;
    /**
     * Extracts holdings from the classic securities-portfolio portlet.
     *
     * We must NOT navigate the top window to PORTFOLIO_URL: FIBI now wraps everything in a
     * Angular "PortalNG" shell whose SSO token exchange races on hard navigations, 401s, and
     * bounces the tab to the public marketing site (whose cookieCleaner then wipes the
     * session). Instead we stay on the post-login shell page and inject a same-origin iframe
     * pointing at the classic portlet URL — the iframe renders the portlet (running its JS,
     * which populates the #table322 DataTable) without ever moving the top frame.
     */
    private extractPortfolio;
    /**
     * Reads the current עו"ש checking balance and returns it as ILS portfolio cash.
     *
     * Uses the same same-origin-iframe technique as extractPortfolio: we must NOT navigate the
     * top frame (FIBI's PortalNG SSO exchange races on hard navigations and bounces the tab to
     * the public site, whose cookieCleaner wipes the session). Best-effort: any failure returns
     * [] so the portfolio scrape still succeeds on its positions alone.
     */
    private extractCash;
}
