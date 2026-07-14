import { assertNever } from '../assertNever';
import { PensionCompanyTypes } from '../pension-definitions';
import { type BasePensionScraperOptions } from './base-pension-scraper';
import type { PensionScraper } from './interface';
import { SwiftnessPensionScraper } from './swiftness';

export type PensionScraperOptions = BasePensionScraperOptions & {
  companyId: PensionCompanyTypes;
};

export function createPensionScraper(options: PensionScraperOptions): PensionScraper {
  switch (options.companyId) {
    case PensionCompanyTypes.swiftness:
      return new SwiftnessPensionScraper(options);
    default:
      assertNever(options.companyId, `Unknown pension company: ${options.companyId}`);
  }
}
