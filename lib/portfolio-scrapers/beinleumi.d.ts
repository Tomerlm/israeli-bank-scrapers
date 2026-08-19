import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioDeposit, PortfolioPosition } from './interface';
export declare class BeinleumiPortfolioScraper extends BasePortfolioScraper {
    protected fetchPortfolio(page: Page, credentials: Record<string, unknown>): Promise<{
        positions: PortfolioPosition[];
        cash: PortfolioCash[];
        deposits: PortfolioDeposit[];
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
    /**
     * Reads term deposits/savings ("פקדונות וחסכונות") from the modern Angular shell's
     * myDeposits route. Unlike extractPortfolio/extractCash this needs no iframe injection and
     * no DOM scraping at all: post-login FIBI already leaves the top frame on the shell
     * document, so a same-document hash change is enough to trigger the Angular route (verified
     * live — it does not bounce the session the way a hard navigation to a shell URL would), and
     * that route fires exactly one JSON REST call (bff-MyDeposits) with everything we need,
     * including each deposit's own interest rate — no "more details" click required.
     * Best-effort: any failure returns [] so the portfolio scrape still succeeds on its
     * positions/cash alone.
     */
    private extractDeposits;
}
