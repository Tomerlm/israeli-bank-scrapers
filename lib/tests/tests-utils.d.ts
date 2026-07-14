/// <reference types="jest" />
import { type TransactionsAccount } from '../transactions';
export declare function getTestsConfig(): Record<string, any>;
export declare function maybeTestCompanyAPI(scraperId: string, filter?: (config: any) => boolean): jest.It;
export declare function extendAsyncTimeout(timeout?: number): void;
export declare function exportTransactions(fileName: string, accounts: TransactionsAccount[]): void;
