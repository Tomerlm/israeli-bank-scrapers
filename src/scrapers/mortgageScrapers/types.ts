/**
 * Type definitions for mortgage scraper output
 */

export interface MortgageTrack {
  trackType: string
  originalLoanAmountIls: number
  outstandingPrincipalIls: number
  monthlyPaymentIls: number
  interestRatePercent: number
  remainingTermMonths: number | null
  linkage: string
  asOfDate: string // ISO date YYYY-MM-DD
}

export interface MortgageAccount {
  lender: string
  currency: string
  tracks: MortgageTrack[]
  asOfDate: string // ISO date YYYY-MM-DD
}
