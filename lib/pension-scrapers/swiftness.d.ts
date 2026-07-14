import { type Page } from 'puppeteer';
import { BasePensionScraper } from './base-pension-scraper';
import type { PensionHoldingOutput } from './interface';
export declare function numOrNull(v: unknown): number | null;
/**
 * Maps a single `savingProductsDetails[i]` object (from the Swiftness
 * `getSavingProductsDetails` API) to findash's `PensionHoldingInput` shape.
 * See docs/superpowers/specs/2026-07-13-swiftness-api-discovery.md for the field mapping.
 *
 * `track` (investment track) has no clean field in this API response — first cut sends ''.
 */
export declare function normalizeHolding(p: Record<string, unknown>): PensionHoldingOutput;
export declare class SwiftnessPensionScraper extends BasePensionScraper {
    protected fetchPension(page: Page, credentials: Record<string, unknown>): Promise<{
        holdings: PensionHoldingOutput[];
        asOfDate: string;
    }>;
}
