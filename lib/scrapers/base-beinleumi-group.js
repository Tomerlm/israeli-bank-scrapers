"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clickAccountSelectorGetAccountIds = clickAccountSelectorGetAccountIds;
exports.createLoginFields = createLoginFields;
exports.default = void 0;
exports.getPossibleLoginResults = getPossibleLoginResults;
exports.selectAccountFromDropdown = selectAccountFromDropdown;
exports.waitForPostLogin = waitForPostLogin;
var _moment = _interopRequireDefault(require("moment"));
var _constants = require("../constants");
var _elementsInteractions = require("../helpers/elements-interactions");
var _navigation = require("../helpers/navigation");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const DATE_FORMAT = 'DD/MM/YYYY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא נמצאו נתונים בנושא המבוקש';
const DATE_COLUMN_CLASS_COMPLETED = 'date first';
const DATE_COLUMN_CLASS_PENDING = 'first date';
const DESCRIPTION_COLUMN_CLASS_COMPLETED = 'reference wrap_normal';
const DESCRIPTION_COLUMN_CLASS_PENDING = 'details wrap_normal';
const REFERENCE_COLUMN_CLASS = 'details';
const DEBIT_COLUMN_CLASS = 'debit';
const CREDIT_COLUMN_CLASS = 'credit';
const ERROR_MESSAGE_CLASS = 'NO_DATA';
const ACCOUNTS_NUMBER = 'div.fibi_account span.acc_num';
const CLOSE_SEARCH_BY_DATES_BUTTON_CLASS = 'ui-datepicker-close';
const SHOW_SEARCH_BY_DATES_BUTTON_VALUE = 'הצג';
const COMPLETED_TRANSACTIONS_TABLE = 'table#dataTable077';
const PENDING_TRANSACTIONS_TABLE = 'table#dataTable023';
const NEXT_PAGE_LINK = 'a#Npage.paging';
const CURRENT_BALANCE = '.main_balance';
const IFRAME_NAME = 'iframe-old-pages';
const ELEMENT_RENDER_TIMEOUT_MS = 10000;
function getPossibleLoginResults() {
  const urls = {};
  urls[_baseScraperWithBrowser.LoginResults.Success] = [/fibi.*accountSummary/,
  // New UI pattern
  /Resources\/PortalNG\/shell/,
  // New UI pattern
  /FibiMenu\/Online/ // Old UI pattern
  ];
  urls[_baseScraperWithBrowser.LoginResults.InvalidPassword] = [/FibiMenu\/Marketing\/Private\/Home/];
  return urls;
}
function createLoginFields(credentials) {
  return [{
    selector: '#username',
    value: credentials.username
  }, {
    selector: '#password',
    value: credentials.password
  }];
}
function getAmountData(amountStr) {
  let amountStrCopy = amountStr.replace(_constants.SHEKEL_CURRENCY_SYMBOL, '');
  amountStrCopy = amountStrCopy.replaceAll(',', '');
  return parseFloat(amountStrCopy);
}
function getTxnAmount(txn) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}
function convertTransactions(txns, options) {
  return txns.map(txn => {
    const convertedDate = (0, _moment.default)(txn.date, DATE_FORMAT).toISOString();
    const convertedAmount = getTxnAmount(txn);
    const result = {
      type: _transactions2.TransactionTypes.Normal,
      identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
      date: convertedDate,
      processedDate: convertedDate,
      originalAmount: convertedAmount,
      originalCurrency: _constants.SHEKEL_CURRENCY,
      chargedAmount: convertedAmount,
      status: txn.status,
      description: txn.description,
      memo: txn.memo
    };
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(txn);
    }
    return result;
  });
}
function getTransactionDate(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionDescription(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionReference(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[REFERENCE_COLUMN_CLASS]] || '').trim();
}
function getTransactionDebit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[DEBIT_COLUMN_CLASS]] || '').trim();
}
function getTransactionCredit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[CREDIT_COLUMN_CLASS]] || '').trim();
}
function extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes) {
  const tds = txnRow.innerTds;
  const item = {
    status: transactionStatus,
    date: getTransactionDate(tds, transactionStatus, transactionsColsTypes),
    description: getTransactionDescription(tds, transactionStatus, transactionsColsTypes),
    reference: getTransactionReference(tds, transactionsColsTypes),
    debit: getTransactionDebit(tds, transactionsColsTypes),
    credit: getTransactionCredit(tds, transactionsColsTypes)
  };
  return item;
}
async function getTransactionsColsTypeClasses(page, tableLocator) {
  const result = {};
  const typeClassesObjs = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr:first-of-type td`, null, tds => {
    return tds.map((td, index) => ({
      colClass: td.getAttribute('class'),
      index
    }));
  });
  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) {
      result[typeClassObj.colClass] = typeClassObj.index;
    }
  }
  return result;
}
function extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes) {
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') {
    txns.push(txn);
  }
}
async function extractTransactions(page, tableLocator, transactionStatus) {
  const txns = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page, tableLocator);
  const transactionsRows = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr`, [], trs => {
    return trs.map(tr => ({
      innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText)
    }));
  });
  for (const txnRow of transactionsRows) {
    extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes);
  }
  return txns;
}
async function isNoTransactionInDateRangeError(page) {
  const hasErrorInfoElement = await (0, _elementsInteractions.elementPresentOnPage)(page, `.${ERROR_MESSAGE_CLASS}`);
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(`.${ERROR_MESSAGE_CLASS}`, errorElement => {
      return errorElement.innerText;
    });
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}
async function searchByDates(page, startDate) {
  await (0, _elementsInteractions.clickButton)(page, 'a#tabHeader4');
  await (0, _elementsInteractions.waitUntilElementFound)(page, 'div#fibi_dates');
  await (0, _elementsInteractions.fillInput)(page, 'input#fromDate', startDate.format(DATE_FORMAT));
  await (0, _elementsInteractions.clickButton)(page, `button[class*=${CLOSE_SEARCH_BY_DATES_BUTTON_CLASS}]`);
  await (0, _elementsInteractions.clickButton)(page, `input[value=${SHOW_SEARCH_BY_DATES_BUTTON_VALUE}]`);
  await (0, _navigation.waitForNavigation)(page);
}
async function getAccountNumber(page) {
  // Wait until the account number element is present in the DOM
  await (0, _elementsInteractions.waitUntilElementFound)(page, ACCOUNTS_NUMBER, true, ELEMENT_RENDER_TIMEOUT_MS);
  const selectedSnifAccount = await page.$eval(ACCOUNTS_NUMBER, option => {
    return option.innerText;
  });
  return selectedSnifAccount.replace('/', '_').trim();
}
async function checkIfHasNextPage(page) {
  return (0, _elementsInteractions.elementPresentOnPage)(page, NEXT_PAGE_LINK);
}
async function navigateToNextPage(page) {
  await (0, _elementsInteractions.clickButton)(page, NEXT_PAGE_LINK);
  await (0, _navigation.waitForNavigation)(page);
}

/* Couldn't reproduce scenario with multiple pages of pending transactions - Should support if exists such case.
   needToPaginate is false if scraping pending transactions */
async function scrapeTransactions(page, tableLocator, transactionStatus, needToPaginate, options) {
  const txns = [];
  let hasNextPage = false;
  do {
    const currentPageTxns = await extractTransactions(page, tableLocator, transactionStatus);
    txns.push(...currentPageTxns);
    if (needToPaginate) {
      hasNextPage = await checkIfHasNextPage(page);
      if (hasNextPage) {
        await navigateToNextPage(page);
      }
    }
  } while (hasNextPage);
  return convertTransactions(txns, options);
}
async function getAccountTransactions(page, options) {
  await Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, "div[id*='divTable']", false), (0, _elementsInteractions.waitUntilElementFound)(page, `.${ERROR_MESSAGE_CLASS}`, false)]);
  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }
  const pendingTxns = await scrapeTransactions(page, PENDING_TRANSACTIONS_TABLE, _transactions2.TransactionStatuses.Pending, false, options);
  const completedTxns = await scrapeTransactions(page, COMPLETED_TRANSACTIONS_TABLE, _transactions2.TransactionStatuses.Completed, true, options);
  const txns = [...pendingTxns, ...completedTxns];
  return txns;
}
async function getCurrentBalance(page) {
  // Use a short non-throwing poll: if .main_balance doesn't appear in the
  // timeout window (bank may have changed their UI), return undefined gracefully
  // so the rest of the scrape (transactions) can still proceed.
  const balanceElement = await page.waitForSelector(CURRENT_BALANCE, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS
  }).catch(() => null);
  if (!balanceElement) {
    return undefined;
  }
  const balanceStr = await balanceElement.evaluate(el => el.innerText);
  return getAmountData(balanceStr);
}

// Selectors verified against live fibi.co.il OTP page.
const OTP_SEND_SMS_SELECTOR = '#sendSms';
const OTP_INPUT_SELECTOR = '#codeinput';
const OTP_SUBMIT_SELECTOR = '.otpSubmitButton';
async function handleOtpChallenge(page, otpCodeRetriever) {
  // Click "שלח" to trigger the SMS to the user's registered phone
  await (0, _elementsInteractions.clickButton)(page, OTP_SEND_SMS_SELECTOR);
  // Wait for the OTP input to animate into the DOM (fadeInDown animation)
  await (0, _elementsInteractions.waitUntilElementFound)(page, OTP_INPUT_SELECTOR, true);
  // Suspend until the caller provides the code (user reads SMS and submits via UI)
  const otpCode = await otpCodeRetriever();
  await (0, _elementsInteractions.fillInput)(page, OTP_INPUT_SELECTOR, otpCode);
  await (0, _elementsInteractions.clickButton)(page, OTP_SUBMIT_SELECTOR);
  // Wait for the post-login dashboard to appear after successful OTP
  await Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', false), (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num', true), (0, _elementsInteractions.waitUntilElementFound)(page, '#matafLogoutLink', true), (0, _elementsInteractions.waitUntilElementFound)(page, '#validationMsg', true)]);
}
async function waitForPostLogin(page, otpCodeRetriever) {
  if (otpCodeRetriever) {
    // Race the OTP challenge page against the success page selectors.
    // The dashboard-detection branches use a long timeout so they don't reject
    // while the OTP retriever is paused waiting for the user to supply the code.
    // (handleOtpChallenge has its own inner wait for dashboard elements after submit.)
    const NO_OTP_TIMEOUT_MS = 180_000;
    await Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, OTP_SEND_SMS_SELECTOR, true).then(() => handleOtpChallenge(page, otpCodeRetriever)), (0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', false, NO_OTP_TIMEOUT_MS), (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num', true, NO_OTP_TIMEOUT_MS), (0, _elementsInteractions.waitUntilElementFound)(page, '#matafLogoutLink', true, NO_OTP_TIMEOUT_MS), (0, _elementsInteractions.waitUntilElementFound)(page, '#validationMsg', true, NO_OTP_TIMEOUT_MS)]);
  } else {
    await Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', false),
    // New UI
    (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num', true),
    // New UI
    (0, _elementsInteractions.waitUntilElementFound)(page, '#matafLogoutLink', true),
    // Old UI
    (0, _elementsInteractions.waitUntilElementFound)(page, '#validationMsg', true) // Old UI
    ]);
  }
}
async function fetchAccountData(page, startDate, options) {
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  await searchByDates(page, startDate);
  const txns = await getAccountTransactions(page, options);
  return {
    accountNumber,
    txns,
    balance
  };
}
async function getAccountIdsOldUI(page) {
  return page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    if (!options) return [];
    return Array.from(options, option => option.value);
  });
}

/**
 * Ensures the account dropdown is open, then returns the available account labels.
 *
 * This method:
 * - Checks if the dropdown is already open.
 * - If not open, clicks the account selector to open it.
 * - Waits for the dropdown to render.
 * - Extracts and returns the list of available account labels.
 *
 * Graceful handling:
 * - If any error occurs (e.g., selectors not found, timing issues, UI version changes),
 *   the function returns an empty list.
 *
 * @param page Puppeteer Page object.
 * @returns An array of available account labels (e.g., ["127 | XXXX1", "127 | XXXX2"]),
 *          or an empty array if something goes wrong.
 */
async function clickAccountSelectorGetAccountIds(page) {
  try {
    const accountSelector = 'div.current-account'; // Direct selector to clickable element
    const dropdownPanelSelector = 'div.mat-mdc-autocomplete-panel.account-select-dd'; // The dropdown list box
    const optionSelector = 'mat-option .mdc-list-item__primary-text'; // Account option labels

    // Check if dropdown is already open
    const dropdownVisible = await page.$eval(dropdownPanelSelector, el => {
      return el && window.getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
    }).catch(() => false); // catch if dropdown is not in the DOM yet

    if (!dropdownVisible) {
      await (0, _elementsInteractions.waitUntilElementFound)(page, accountSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

      // Click the account selector to open the dropdown
      await (0, _elementsInteractions.clickButton)(page, accountSelector);

      // Wait for the dropdown to open
      await (0, _elementsInteractions.waitUntilElementFound)(page, dropdownPanelSelector, true, ELEMENT_RENDER_TIMEOUT_MS);
    }

    // Extract account labels from the dropdown options
    const accountLabels = await page.$$eval(optionSelector, options => {
      return options.map(option => option.textContent?.trim() || '').filter(label => label !== '');
    });
    return accountLabels;
  } catch (error) {
    return []; // Graceful fallback
  }
}
async function getAccountIdsBothUIs(page) {
  let accountsIds = await clickAccountSelectorGetAccountIds(page);
  if (accountsIds.length === 0) {
    accountsIds = await getAccountIdsOldUI(page);
  }
  return accountsIds;
}

/**
 * Selects an account from the dropdown based on the provided account label.
 *
 * This method:
 * - Clicks the account selector button to open the dropdown.
 * - Retrieves the list of available account labels.
 * - Checks if the provided account label exists in the list.
 * - Finds and clicks the matching account option if found.
 *
 * @param page Puppeteer Page object.
 * @param accountLabel The text of the account to select (e.g., "127 | XXXXX").
 * @returns True if the account option was found and clicked; false otherwise.
 */
async function selectAccountFromDropdown(page, accountLabel) {
  // Call clickAccountSelector to get the available accounts and open the dropdown
  const availableAccounts = await clickAccountSelectorGetAccountIds(page);

  // Check if the account label exists in the available accounts
  if (!availableAccounts.includes(accountLabel)) {
    return false;
  }

  // Wait for the dropdown options to be rendered
  const optionSelector = 'mat-option .mdc-list-item__primary-text';
  await (0, _elementsInteractions.waitUntilElementFound)(page, optionSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Query all matching options
  const accountOptions = await page.$$(optionSelector);

  // Find and click the option matching the accountLabel
  for (const option of accountOptions) {
    const text = await page.evaluate(el => el.textContent?.trim(), option);
    if (text === accountLabel) {
      const optionHandle = await option.evaluateHandle(el => el);
      await page.evaluate(el => el.click(), optionHandle);
      return true;
    }
  }
  return false;
}
async function getTransactionsFrame(page) {
  // Try a few times to find the iframe, as it might not be immediately available
  for (let attempt = 0; attempt < 3; attempt++) {
    await (0, _waiting.sleep)(2000);
    const frames = page.frames();
    const targetFrame = frames.find(f => f.name() === IFRAME_NAME);
    if (targetFrame) {
      return targetFrame;
    }
  }
  return null;
}
async function selectAccountBothUIs(page, accountId) {
  const accountSelected = await selectAccountFromDropdown(page, accountId);
  if (!accountSelected) {
    // Old UI format
    await page.select('#account_num_select', accountId);
    await (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num_select', true);
  }
}
async function fetchAccountDataBothUIs(page, startDate, options) {
  // Try to get the iframe for the new UI
  const frame = await getTransactionsFrame(page);

  // Use the frame if available (new UI), otherwise use the page directly (old UI)
  const targetPage = frame || page;
  return fetchAccountData(targetPage, startDate, options);
}
async function fetchAccounts(page, startDate, options) {
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) {
    // In case accountsIds could no be parsed just return the transactions of the currently selected account
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    return [accountData];
  }
  const accounts = [];
  for (const accountId of accountsIds) {
    await selectAccountBothUIs(page, accountId);
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    accounts.push(accountData);
  }
  return accounts;
}
class BeinleumiGroupBaseScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  BASE_URL = '';
  LOGIN_URL = '';
  TRANSACTIONS_URL = '';
  getLoginOptions(credentials) {
    return {
      loginUrl: `${this.LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#continueBtn',
      postAction: async () => waitForPostLogin(this.page, credentials.otpCodeRetriever),
      possibleResults: getPossibleLoginResults(),
      // HACK: For some reason, though the login button (#continueBtn) is present and visible, the click action does not perform.
      // Adding this delay fixes the issue.
      preAction: async () => {
        await (0, _waiting.sleep)(1000);
      }
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').add(1, 'day');
    const startMomentLimit = (0, _moment.default)({
      year: 1600
    });
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(startMomentLimit, (0, _moment.default)(startDate));
    await this.navigateTo(this.TRANSACTIONS_URL);
    const accounts = await fetchAccounts(this.page, startMoment, this.options);
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = BeinleumiGroupBaseScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2VsZW1lbnRzSW50ZXJhY3Rpb25zIiwiX25hdmlnYXRpb24iLCJfdHJhbnNhY3Rpb25zIiwiX3dhaXRpbmciLCJfdHJhbnNhY3Rpb25zMiIsIl9iYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiREFURV9GT1JNQVQiLCJOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQiLCJEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURUQiLCJEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCIsIkRFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiUkVGRVJFTkNFX0NPTFVNTl9DTEFTUyIsIkRFQklUX0NPTFVNTl9DTEFTUyIsIkNSRURJVF9DT0xVTU5fQ0xBU1MiLCJFUlJPUl9NRVNTQUdFX0NMQVNTIiwiQUNDT1VOVFNfTlVNQkVSIiwiQ0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTUyIsIlNIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRSIsIkNPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUiLCJQRU5ESU5HX1RSQU5TQUNUSU9OU19UQUJMRSIsIk5FWFRfUEFHRV9MSU5LIiwiQ1VSUkVOVF9CQUxBTkNFIiwiSUZSQU1FX05BTUUiLCJFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TIiwiZ2V0UG9zc2libGVMb2dpblJlc3VsdHMiLCJ1cmxzIiwiTG9naW5SZXN1bHRzIiwiU3VjY2VzcyIsIkludmFsaWRQYXNzd29yZCIsImNyZWF0ZUxvZ2luRmllbGRzIiwiY3JlZGVudGlhbHMiLCJzZWxlY3RvciIsInZhbHVlIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsImdldEFtb3VudERhdGEiLCJhbW91bnRTdHIiLCJhbW91bnRTdHJDb3B5IiwicmVwbGFjZSIsIlNIRUtFTF9DVVJSRU5DWV9TWU1CT0wiLCJyZXBsYWNlQWxsIiwicGFyc2VGbG9hdCIsImdldFR4bkFtb3VudCIsInR4biIsImNyZWRpdCIsImRlYml0IiwiTnVtYmVyIiwiaXNOYU4iLCJjb252ZXJ0VHJhbnNhY3Rpb25zIiwidHhucyIsIm9wdGlvbnMiLCJtYXAiLCJjb252ZXJ0ZWREYXRlIiwibW9tZW50IiwiZGF0ZSIsInRvSVNPU3RyaW5nIiwiY29udmVydGVkQW1vdW50IiwicmVzdWx0IiwidHlwZSIsIlRyYW5zYWN0aW9uVHlwZXMiLCJOb3JtYWwiLCJpZGVudGlmaWVyIiwicmVmZXJlbmNlIiwicGFyc2VJbnQiLCJ1bmRlZmluZWQiLCJwcm9jZXNzZWREYXRlIiwib3JpZ2luYWxBbW91bnQiLCJvcmlnaW5hbEN1cnJlbmN5IiwiU0hFS0VMX0NVUlJFTkNZIiwiY2hhcmdlZEFtb3VudCIsInN0YXR1cyIsImRlc2NyaXB0aW9uIiwibWVtbyIsImluY2x1ZGVSYXdUcmFuc2FjdGlvbiIsInJhd1RyYW5zYWN0aW9uIiwiZ2V0UmF3VHJhbnNhY3Rpb24iLCJnZXRUcmFuc2FjdGlvbkRhdGUiLCJ0ZHMiLCJ0cmFuc2FjdGlvblR5cGUiLCJ0cmFuc2FjdGlvbnNDb2xzVHlwZXMiLCJ0cmltIiwiZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbiIsImdldFRyYW5zYWN0aW9uUmVmZXJlbmNlIiwiZ2V0VHJhbnNhY3Rpb25EZWJpdCIsImdldFRyYW5zYWN0aW9uQ3JlZGl0IiwiZXh0cmFjdFRyYW5zYWN0aW9uRGV0YWlscyIsInR4blJvdyIsInRyYW5zYWN0aW9uU3RhdHVzIiwiaW5uZXJUZHMiLCJpdGVtIiwiZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzIiwicGFnZSIsInRhYmxlTG9jYXRvciIsInR5cGVDbGFzc2VzT2JqcyIsInBhZ2VFdmFsQWxsIiwidGQiLCJpbmRleCIsImNvbENsYXNzIiwiZ2V0QXR0cmlidXRlIiwidHlwZUNsYXNzT2JqIiwiZXh0cmFjdFRyYW5zYWN0aW9uIiwicHVzaCIsImV4dHJhY3RUcmFuc2FjdGlvbnMiLCJ0cmFuc2FjdGlvbnNSb3dzIiwidHJzIiwidHIiLCJBcnJheSIsImZyb20iLCJnZXRFbGVtZW50c0J5VGFnTmFtZSIsImlubmVyVGV4dCIsImlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IiLCJoYXNFcnJvckluZm9FbGVtZW50IiwiZWxlbWVudFByZXNlbnRPblBhZ2UiLCJlcnJvclRleHQiLCIkZXZhbCIsImVycm9yRWxlbWVudCIsInNlYXJjaEJ5RGF0ZXMiLCJzdGFydERhdGUiLCJjbGlja0J1dHRvbiIsIndhaXRVbnRpbEVsZW1lbnRGb3VuZCIsImZpbGxJbnB1dCIsImZvcm1hdCIsIndhaXRGb3JOYXZpZ2F0aW9uIiwiZ2V0QWNjb3VudE51bWJlciIsInNlbGVjdGVkU25pZkFjY291bnQiLCJvcHRpb24iLCJjaGVja0lmSGFzTmV4dFBhZ2UiLCJuYXZpZ2F0ZVRvTmV4dFBhZ2UiLCJzY3JhcGVUcmFuc2FjdGlvbnMiLCJuZWVkVG9QYWdpbmF0ZSIsImhhc05leHRQYWdlIiwiY3VycmVudFBhZ2VUeG5zIiwiZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyIsIlByb21pc2UiLCJyYWNlIiwibm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvciIsInBlbmRpbmdUeG5zIiwiVHJhbnNhY3Rpb25TdGF0dXNlcyIsIlBlbmRpbmciLCJjb21wbGV0ZWRUeG5zIiwiQ29tcGxldGVkIiwiZ2V0Q3VycmVudEJhbGFuY2UiLCJiYWxhbmNlRWxlbWVudCIsIndhaXRGb3JTZWxlY3RvciIsInZpc2libGUiLCJ0aW1lb3V0IiwiY2F0Y2giLCJiYWxhbmNlU3RyIiwiZXZhbHVhdGUiLCJlbCIsIk9UUF9TRU5EX1NNU19TRUxFQ1RPUiIsIk9UUF9JTlBVVF9TRUxFQ1RPUiIsIk9UUF9TVUJNSVRfU0VMRUNUT1IiLCJoYW5kbGVPdHBDaGFsbGVuZ2UiLCJvdHBDb2RlUmV0cmlldmVyIiwib3RwQ29kZSIsIndhaXRGb3JQb3N0TG9naW4iLCJOT19PVFBfVElNRU9VVF9NUyIsInRoZW4iLCJmZXRjaEFjY291bnREYXRhIiwiYWNjb3VudE51bWJlciIsImJhbGFuY2UiLCJnZXRBY2NvdW50SWRzT2xkVUkiLCJzZWxlY3RFbGVtZW50IiwiZG9jdW1lbnQiLCJnZXRFbGVtZW50QnlJZCIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMiLCJhY2NvdW50U2VsZWN0b3IiLCJkcm9wZG93blBhbmVsU2VsZWN0b3IiLCJvcHRpb25TZWxlY3RvciIsImRyb3Bkb3duVmlzaWJsZSIsIndpbmRvdyIsImdldENvbXB1dGVkU3R5bGUiLCJkaXNwbGF5Iiwib2Zmc2V0UGFyZW50IiwiYWNjb3VudExhYmVscyIsIiQkZXZhbCIsInRleHRDb250ZW50IiwiZmlsdGVyIiwibGFiZWwiLCJlcnJvciIsImdldEFjY291bnRJZHNCb3RoVUlzIiwiYWNjb3VudHNJZHMiLCJsZW5ndGgiLCJzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duIiwiYWNjb3VudExhYmVsIiwiYXZhaWxhYmxlQWNjb3VudHMiLCJpbmNsdWRlcyIsImFjY291bnRPcHRpb25zIiwiJCQiLCJ0ZXh0Iiwib3B0aW9uSGFuZGxlIiwiZXZhbHVhdGVIYW5kbGUiLCJjbGljayIsImdldFRyYW5zYWN0aW9uc0ZyYW1lIiwiYXR0ZW1wdCIsInNsZWVwIiwiZnJhbWVzIiwidGFyZ2V0RnJhbWUiLCJmaW5kIiwiZiIsIm5hbWUiLCJzZWxlY3RBY2NvdW50Qm90aFVJcyIsImFjY291bnRJZCIsImFjY291bnRTZWxlY3RlZCIsInNlbGVjdCIsImZldGNoQWNjb3VudERhdGFCb3RoVUlzIiwiZnJhbWUiLCJ0YXJnZXRQYWdlIiwiZmV0Y2hBY2NvdW50cyIsImFjY291bnREYXRhIiwiYWNjb3VudHMiLCJCZWlubGV1bWlHcm91cEJhc2VTY3JhcGVyIiwiQmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsIkJBU0VfVVJMIiwiTE9HSU5fVVJMIiwiVFJBTlNBQ1RJT05TX1VSTCIsImdldExvZ2luT3B0aW9ucyIsImxvZ2luVXJsIiwiZmllbGRzIiwic3VibWl0QnV0dG9uU2VsZWN0b3IiLCJwb3N0QWN0aW9uIiwicG9zc2libGVSZXN1bHRzIiwicHJlQWN0aW9uIiwiZmV0Y2hEYXRhIiwiZGVmYXVsdFN0YXJ0TW9tZW50Iiwic3VidHJhY3QiLCJhZGQiLCJzdGFydE1vbWVudExpbWl0IiwieWVhciIsInRvRGF0ZSIsInN0YXJ0TW9tZW50IiwibWF4IiwibmF2aWdhdGVUbyIsInN1Y2Nlc3MiLCJfZGVmYXVsdCIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvc2NyYXBlcnMvYmFzZS1iZWlubGV1bWktZ3JvdXAudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IG1vbWVudCwgeyB0eXBlIE1vbWVudCB9IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgeyB0eXBlIEZyYW1lLCB0eXBlIFBhZ2UgfSBmcm9tICdwdXBwZXRlZXInO1xuaW1wb3J0IHsgU0hFS0VMX0NVUlJFTkNZLCBTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MIH0gZnJvbSAnLi4vY29uc3RhbnRzJztcbmltcG9ydCB7XG4gIGNsaWNrQnV0dG9uLFxuICBlbGVtZW50UHJlc2VudE9uUGFnZSxcbiAgZmlsbElucHV0LFxuICBwYWdlRXZhbEFsbCxcbiAgd2FpdFVudGlsRWxlbWVudEZvdW5kLFxufSBmcm9tICcuLi9oZWxwZXJzL2VsZW1lbnRzLWludGVyYWN0aW9ucyc7XG5pbXBvcnQgeyB3YWl0Rm9yTmF2aWdhdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvbmF2aWdhdGlvbic7XG5pbXBvcnQgeyBnZXRSYXdUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IHNsZWVwIH0gZnJvbSAnLi4vaGVscGVycy93YWl0aW5nJztcbmltcG9ydCB7IFRyYW5zYWN0aW9uU3RhdHVzZXMsIFRyYW5zYWN0aW9uVHlwZXMsIHR5cGUgVHJhbnNhY3Rpb24sIHR5cGUgVHJhbnNhY3Rpb25zQWNjb3VudCB9IGZyb20gJy4uL3RyYW5zYWN0aW9ucyc7XG5pbXBvcnQgeyBCYXNlU2NyYXBlcldpdGhCcm93c2VyLCBMb2dpblJlc3VsdHMsIHR5cGUgUG9zc2libGVMb2dpblJlc3VsdHMgfSBmcm9tICcuL2Jhc2Utc2NyYXBlci13aXRoLWJyb3dzZXInO1xuaW1wb3J0IHsgdHlwZSBTY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vaW50ZXJmYWNlJztcblxuY29uc3QgREFURV9GT1JNQVQgPSAnREQvTU0vWVlZWSc7XG5jb25zdCBOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQgPSAn15zXkCDXoNee16bXkNeVINeg16rXldeg15nXnSDXkdeg15XXqdeQINeU157XkdeV16fXqSc7XG5jb25zdCBEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURUQgPSAnZGF0ZSBmaXJzdCc7XG5jb25zdCBEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HID0gJ2ZpcnN0IGRhdGUnO1xuY29uc3QgREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCA9ICdyZWZlcmVuY2Ugd3JhcF9ub3JtYWwnO1xuY29uc3QgREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX1BFTkRJTkcgPSAnZGV0YWlscyB3cmFwX25vcm1hbCc7XG5jb25zdCBSRUZFUkVOQ0VfQ09MVU1OX0NMQVNTID0gJ2RldGFpbHMnO1xuY29uc3QgREVCSVRfQ09MVU1OX0NMQVNTID0gJ2RlYml0JztcbmNvbnN0IENSRURJVF9DT0xVTU5fQ0xBU1MgPSAnY3JlZGl0JztcbmNvbnN0IEVSUk9SX01FU1NBR0VfQ0xBU1MgPSAnTk9fREFUQSc7XG5jb25zdCBBQ0NPVU5UU19OVU1CRVIgPSAnZGl2LmZpYmlfYWNjb3VudCBzcGFuLmFjY19udW0nO1xuY29uc3QgQ0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTUyA9ICd1aS1kYXRlcGlja2VyLWNsb3NlJztcbmNvbnN0IFNIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRSA9ICfXlNem15InO1xuY29uc3QgQ09NUExFVEVEX1RSQU5TQUNUSU9OU19UQUJMRSA9ICd0YWJsZSNkYXRhVGFibGUwNzcnO1xuY29uc3QgUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUgPSAndGFibGUjZGF0YVRhYmxlMDIzJztcbmNvbnN0IE5FWFRfUEFHRV9MSU5LID0gJ2EjTnBhZ2UucGFnaW5nJztcbmNvbnN0IENVUlJFTlRfQkFMQU5DRSA9ICcubWFpbl9iYWxhbmNlJztcbmNvbnN0IElGUkFNRV9OQU1FID0gJ2lmcmFtZS1vbGQtcGFnZXMnO1xuY29uc3QgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyA9IDEwMDAwO1xuXG50eXBlIFRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG50eXBlIFRyYW5zYWN0aW9uc1RyVGRzID0gc3RyaW5nW107XG50eXBlIFRyYW5zYWN0aW9uc1RyID0geyBpbm5lclRkczogVHJhbnNhY3Rpb25zVHJUZHMgfTtcblxuaW50ZXJmYWNlIFNjcmFwZWRUcmFuc2FjdGlvbiB7XG4gIHJlZmVyZW5jZTogc3RyaW5nO1xuICBkYXRlOiBzdHJpbmc7XG4gIGNyZWRpdDogc3RyaW5nO1xuICBkZWJpdDogc3RyaW5nO1xuICBtZW1vPzogc3RyaW5nO1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICBzdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpOiBQb3NzaWJsZUxvZ2luUmVzdWx0cyB7XG4gIGNvbnN0IHVybHM6IFBvc3NpYmxlTG9naW5SZXN1bHRzID0ge307XG4gIHVybHNbTG9naW5SZXN1bHRzLlN1Y2Nlc3NdID0gW1xuICAgIC9maWJpLiphY2NvdW50U3VtbWFyeS8sIC8vIE5ldyBVSSBwYXR0ZXJuXG4gICAgL1Jlc291cmNlc1xcL1BvcnRhbE5HXFwvc2hlbGwvLCAvLyBOZXcgVUkgcGF0dGVyblxuICAgIC9GaWJpTWVudVxcL09ubGluZS8sIC8vIE9sZCBVSSBwYXR0ZXJuXG4gIF07XG4gIHVybHNbTG9naW5SZXN1bHRzLkludmFsaWRQYXNzd29yZF0gPSBbL0ZpYmlNZW51XFwvTWFya2V0aW5nXFwvUHJpdmF0ZVxcL0hvbWUvXTtcbiAgcmV0dXJuIHVybHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcbiAgcmV0dXJuIFtcbiAgICB7IHNlbGVjdG9yOiAnI3VzZXJuYW1lJywgdmFsdWU6IGNyZWRlbnRpYWxzLnVzZXJuYW1lIH0sXG4gICAgeyBzZWxlY3RvcjogJyNwYXNzd29yZCcsIHZhbHVlOiBjcmVkZW50aWFscy5wYXNzd29yZCB9LFxuICBdO1xufVxuXG5mdW5jdGlvbiBnZXRBbW91bnREYXRhKGFtb3VudFN0cjogc3RyaW5nKSB7XG4gIGxldCBhbW91bnRTdHJDb3B5ID0gYW1vdW50U3RyLnJlcGxhY2UoU0hFS0VMX0NVUlJFTkNZX1NZTUJPTCwgJycpO1xuICBhbW91bnRTdHJDb3B5ID0gYW1vdW50U3RyQ29weS5yZXBsYWNlQWxsKCcsJywgJycpO1xuICByZXR1cm4gcGFyc2VGbG9hdChhbW91bnRTdHJDb3B5KTtcbn1cblxuZnVuY3Rpb24gZ2V0VHhuQW1vdW50KHR4bjogU2NyYXBlZFRyYW5zYWN0aW9uKSB7XG4gIGNvbnN0IGNyZWRpdCA9IGdldEFtb3VudERhdGEodHhuLmNyZWRpdCk7XG4gIGNvbnN0IGRlYml0ID0gZ2V0QW1vdW50RGF0YSh0eG4uZGViaXQpO1xuICByZXR1cm4gKE51bWJlci5pc05hTihjcmVkaXQpID8gMCA6IGNyZWRpdCkgLSAoTnVtYmVyLmlzTmFOKGRlYml0KSA/IDAgOiBkZWJpdCk7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRUcmFuc2FjdGlvbnModHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyk6IFRyYW5zYWN0aW9uW10ge1xuICByZXR1cm4gdHhucy5tYXAoKHR4bik6IFRyYW5zYWN0aW9uID0+IHtcbiAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbW9tZW50KHR4bi5kYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBjb252ZXJ0ZWRBbW91bnQgPSBnZXRUeG5BbW91bnQodHhuKTtcbiAgICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uID0ge1xuICAgICAgdHlwZTogVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWwsXG4gICAgICBpZGVudGlmaWVyOiB0eG4ucmVmZXJlbmNlID8gcGFyc2VJbnQodHhuLnJlZmVyZW5jZSwgMTApIDogdW5kZWZpbmVkLFxuICAgICAgZGF0ZTogY29udmVydGVkRGF0ZSxcbiAgICAgIHByb2Nlc3NlZERhdGU6IGNvbnZlcnRlZERhdGUsXG4gICAgICBvcmlnaW5hbEFtb3VudDogY29udmVydGVkQW1vdW50LFxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogU0hFS0VMX0NVUlJFTkNZLFxuICAgICAgY2hhcmdlZEFtb3VudDogY29udmVydGVkQW1vdW50LFxuICAgICAgc3RhdHVzOiB0eG4uc3RhdHVzLFxuICAgICAgZGVzY3JpcHRpb246IHR4bi5kZXNjcmlwdGlvbixcbiAgICAgIG1lbW86IHR4bi5tZW1vLFxuICAgIH07XG5cbiAgICBpZiAob3B0aW9ucz8uaW5jbHVkZVJhd1RyYW5zYWN0aW9uKSB7XG4gICAgICByZXN1bHQucmF3VHJhbnNhY3Rpb24gPSBnZXRSYXdUcmFuc2FjdGlvbih0eG4pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRhdGUoXG4gIHRkczogVHJhbnNhY3Rpb25zVHJUZHMsXG4gIHRyYW5zYWN0aW9uVHlwZTogc3RyaW5nLFxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcbikge1xuICBpZiAodHJhbnNhY3Rpb25UeXBlID09PSAnY29tcGxldGVkJykge1xuICAgIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURURdXSB8fCAnJykudHJpbSgpO1xuICB9XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbihcbiAgdGRzOiBUcmFuc2FjdGlvbnNUclRkcyxcbiAgdHJhbnNhY3Rpb25UeXBlOiBzdHJpbmcsXG4gIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzLFxuKSB7XG4gIGlmICh0cmFuc2FjdGlvblR5cGUgPT09ICdjb21wbGV0ZWQnKSB7XG4gICAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19DT01QTEVURURdXSB8fCAnJykudHJpbSgpO1xuICB9XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfUEVORElOR11dIHx8ICcnKS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uUmVmZXJlbmNlKHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tSRUZFUkVOQ0VfQ09MVU1OX0NMQVNTXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EZWJpdCh0ZHM6IFRyYW5zYWN0aW9uc1RyVGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcykge1xuICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREVCSVRfQ09MVU1OX0NMQVNTXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25DcmVkaXQodGRzOiBUcmFuc2FjdGlvbnNUclRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMpIHtcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0NSRURJVF9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzKFxuICB0eG5Sb3c6IFRyYW5zYWN0aW9uc1RyLFxuICB0cmFuc2FjdGlvblN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcyxcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXG4pOiBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICBjb25zdCB0ZHMgPSB0eG5Sb3cuaW5uZXJUZHM7XG4gIGNvbnN0IGl0ZW0gPSB7XG4gICAgc3RhdHVzOiB0cmFuc2FjdGlvblN0YXR1cyxcbiAgICBkYXRlOiBnZXRUcmFuc2FjdGlvbkRhdGUodGRzLCB0cmFuc2FjdGlvblN0YXR1cywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcbiAgICBkZXNjcmlwdGlvbjogZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbih0ZHMsIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIHJlZmVyZW5jZTogZ2V0VHJhbnNhY3Rpb25SZWZlcmVuY2UodGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIGRlYml0OiBnZXRUcmFuc2FjdGlvbkRlYml0KHRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcbiAgICBjcmVkaXQ6IGdldFRyYW5zYWN0aW9uQ3JlZGl0KHRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcbiAgfTtcblxuICByZXR1cm4gaXRlbTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzKFxuICBwYWdlOiBQYWdlIHwgRnJhbWUsXG4gIHRhYmxlTG9jYXRvcjogc3RyaW5nLFxuKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNDb2xzVHlwZXM+IHtcbiAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMgPSB7fTtcbiAgY29uc3QgdHlwZUNsYXNzZXNPYmpzID0gYXdhaXQgcGFnZUV2YWxBbGwocGFnZSwgYCR7dGFibGVMb2NhdG9yfSB0Ym9keSB0cjpmaXJzdC1vZi10eXBlIHRkYCwgbnVsbCwgdGRzID0+IHtcbiAgICByZXR1cm4gdGRzLm1hcCgodGQsIGluZGV4KSA9PiAoe1xuICAgICAgY29sQ2xhc3M6IHRkLmdldEF0dHJpYnV0ZSgnY2xhc3MnKSxcbiAgICAgIGluZGV4LFxuICAgIH0pKTtcbiAgfSk7XG5cbiAgZm9yIChjb25zdCB0eXBlQ2xhc3NPYmogb2YgdHlwZUNsYXNzZXNPYmpzKSB7XG4gICAgaWYgKHR5cGVDbGFzc09iai5jb2xDbGFzcykge1xuICAgICAgcmVzdWx0W3R5cGVDbGFzc09iai5jb2xDbGFzc10gPSB0eXBlQ2xhc3NPYmouaW5kZXg7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RUcmFuc2FjdGlvbihcbiAgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sXG4gIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLFxuICB0eG5Sb3c6IFRyYW5zYWN0aW9uc1RyLFxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcbikge1xuICBjb25zdCB0eG4gPSBleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzKHR4blJvdywgdHJhbnNhY3Rpb25TdGF0dXMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyk7XG4gIGlmICh0eG4uZGF0ZSAhPT0gJycpIHtcbiAgICB0eG5zLnB1c2godHhuKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb25zKHBhZ2U6IFBhZ2UgfCBGcmFtZSwgdGFibGVMb2NhdG9yOiBzdHJpbmcsIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzKSB7XG4gIGNvbnN0IHR4bnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdID0gW107XG4gIGNvbnN0IHRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IGF3YWl0IGdldFRyYW5zYWN0aW9uc0NvbHNUeXBlQ2xhc3NlcyhwYWdlLCB0YWJsZUxvY2F0b3IpO1xuXG4gIGNvbnN0IHRyYW5zYWN0aW9uc1Jvd3MgPSBhd2FpdCBwYWdlRXZhbEFsbDxUcmFuc2FjdGlvbnNUcltdPihwYWdlLCBgJHt0YWJsZUxvY2F0b3J9IHRib2R5IHRyYCwgW10sIHRycyA9PiB7XG4gICAgcmV0dXJuIHRycy5tYXAodHIgPT4gKHtcbiAgICAgIGlubmVyVGRzOiBBcnJheS5mcm9tKHRyLmdldEVsZW1lbnRzQnlUYWdOYW1lKCd0ZCcpKS5tYXAodGQgPT4gdGQuaW5uZXJUZXh0KSxcbiAgICB9KSk7XG4gIH0pO1xuXG4gIGZvciAoY29uc3QgdHhuUm93IG9mIHRyYW5zYWN0aW9uc1Jvd3MpIHtcbiAgICBleHRyYWN0VHJhbnNhY3Rpb24odHhucywgdHJhbnNhY3Rpb25TdGF0dXMsIHR4blJvdywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKTtcbiAgfVxuICByZXR1cm4gdHhucztcbn1cblxuYXN5bmMgZnVuY3Rpb24gaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvcihwYWdlOiBQYWdlIHwgRnJhbWUpIHtcbiAgY29uc3QgaGFzRXJyb3JJbmZvRWxlbWVudCA9IGF3YWl0IGVsZW1lbnRQcmVzZW50T25QYWdlKHBhZ2UsIGAuJHtFUlJPUl9NRVNTQUdFX0NMQVNTfWApO1xuICBpZiAoaGFzRXJyb3JJbmZvRWxlbWVudCkge1xuICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IHBhZ2UuJGV2YWwoYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCwgZXJyb3JFbGVtZW50ID0+IHtcbiAgICAgIHJldHVybiAoZXJyb3JFbGVtZW50IGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQ7XG4gICAgfSk7XG4gICAgcmV0dXJuIGVycm9yVGV4dC50cmltKCkgPT09IE5PX1RSQU5TQUNUSU9OX0lOX0RBVEVfUkFOR0VfVEVYVDtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNlYXJjaEJ5RGF0ZXMocGFnZTogUGFnZSB8IEZyYW1lLCBzdGFydERhdGU6IE1vbWVudCkge1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCAnYSN0YWJIZWFkZXI0Jyk7XG4gIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnZGl2I2ZpYmlfZGF0ZXMnKTtcbiAgYXdhaXQgZmlsbElucHV0KHBhZ2UsICdpbnB1dCNmcm9tRGF0ZScsIHN0YXJ0RGF0ZS5mb3JtYXQoREFURV9GT1JNQVQpKTtcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgYGJ1dHRvbltjbGFzcyo9JHtDTE9TRV9TRUFSQ0hfQllfREFURVNfQlVUVE9OX0NMQVNTfV1gKTtcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgYGlucHV0W3ZhbHVlPSR7U0hPV19TRUFSQ0hfQllfREFURVNfQlVUVE9OX1ZBTFVFfV1gKTtcbiAgYXdhaXQgd2FpdEZvck5hdmlnYXRpb24ocGFnZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnROdW1iZXIocGFnZTogUGFnZSB8IEZyYW1lKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgLy8gV2FpdCB1bnRpbCB0aGUgYWNjb3VudCBudW1iZXIgZWxlbWVudCBpcyBwcmVzZW50IGluIHRoZSBET01cbiAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIEFDQ09VTlRTX05VTUJFUiwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG5cbiAgY29uc3Qgc2VsZWN0ZWRTbmlmQWNjb3VudCA9IGF3YWl0IHBhZ2UuJGV2YWwoQUNDT1VOVFNfTlVNQkVSLCBvcHRpb24gPT4ge1xuICAgIHJldHVybiAob3B0aW9uIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQ7XG4gIH0pO1xuXG4gIHJldHVybiBzZWxlY3RlZFNuaWZBY2NvdW50LnJlcGxhY2UoJy8nLCAnXycpLnRyaW0oKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2hlY2tJZkhhc05leHRQYWdlKHBhZ2U6IFBhZ2UgfCBGcmFtZSkge1xuICByZXR1cm4gZWxlbWVudFByZXNlbnRPblBhZ2UocGFnZSwgTkVYVF9QQUdFX0xJTkspO1xufVxuXG5hc3luYyBmdW5jdGlvbiBuYXZpZ2F0ZVRvTmV4dFBhZ2UocGFnZTogUGFnZSB8IEZyYW1lKSB7XG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIE5FWFRfUEFHRV9MSU5LKTtcbiAgYXdhaXQgd2FpdEZvck5hdmlnYXRpb24ocGFnZSk7XG59XG5cbi8qIENvdWxkbid0IHJlcHJvZHVjZSBzY2VuYXJpbyB3aXRoIG11bHRpcGxlIHBhZ2VzIG9mIHBlbmRpbmcgdHJhbnNhY3Rpb25zIC0gU2hvdWxkIHN1cHBvcnQgaWYgZXhpc3RzIHN1Y2ggY2FzZS5cbiAgIG5lZWRUb1BhZ2luYXRlIGlzIGZhbHNlIGlmIHNjcmFwaW5nIHBlbmRpbmcgdHJhbnNhY3Rpb25zICovXG5hc3luYyBmdW5jdGlvbiBzY3JhcGVUcmFuc2FjdGlvbnMoXG4gIHBhZ2U6IFBhZ2UgfCBGcmFtZSxcbiAgdGFibGVMb2NhdG9yOiBzdHJpbmcsXG4gIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLFxuICBuZWVkVG9QYWdpbmF0ZTogYm9vbGVhbixcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKSB7XG4gIGNvbnN0IHR4bnMgPSBbXTtcbiAgbGV0IGhhc05leHRQYWdlID0gZmFsc2U7XG5cbiAgZG8ge1xuICAgIGNvbnN0IGN1cnJlbnRQYWdlVHhucyA9IGF3YWl0IGV4dHJhY3RUcmFuc2FjdGlvbnMocGFnZSwgdGFibGVMb2NhdG9yLCB0cmFuc2FjdGlvblN0YXR1cyk7XG4gICAgdHhucy5wdXNoKC4uLmN1cnJlbnRQYWdlVHhucyk7XG4gICAgaWYgKG5lZWRUb1BhZ2luYXRlKSB7XG4gICAgICBoYXNOZXh0UGFnZSA9IGF3YWl0IGNoZWNrSWZIYXNOZXh0UGFnZShwYWdlKTtcbiAgICAgIGlmIChoYXNOZXh0UGFnZSkge1xuICAgICAgICBhd2FpdCBuYXZpZ2F0ZVRvTmV4dFBhZ2UocGFnZSk7XG4gICAgICB9XG4gICAgfVxuICB9IHdoaWxlIChoYXNOZXh0UGFnZSk7XG5cbiAgcmV0dXJuIGNvbnZlcnRUcmFuc2FjdGlvbnModHhucywgb3B0aW9ucyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnRUcmFuc2FjdGlvbnMocGFnZTogUGFnZSB8IEZyYW1lLCBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMpIHtcbiAgYXdhaXQgUHJvbWlzZS5yYWNlKFtcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgXCJkaXZbaWQqPSdkaXZUYWJsZSddXCIsIGZhbHNlKSxcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCwgZmFsc2UpLFxuICBdKTtcblxuICBjb25zdCBub1RyYW5zYWN0aW9uSW5SYW5nZUVycm9yID0gYXdhaXQgaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvcihwYWdlKTtcbiAgaWYgKG5vVHJhbnNhY3Rpb25JblJhbmdlRXJyb3IpIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCBwZW5kaW5nVHhucyA9IGF3YWl0IHNjcmFwZVRyYW5zYWN0aW9ucyhcbiAgICBwYWdlLFxuICAgIFBFTkRJTkdfVFJBTlNBQ1RJT05TX1RBQkxFLFxuICAgIFRyYW5zYWN0aW9uU3RhdHVzZXMuUGVuZGluZyxcbiAgICBmYWxzZSxcbiAgICBvcHRpb25zLFxuICApO1xuICBjb25zdCBjb21wbGV0ZWRUeG5zID0gYXdhaXQgc2NyYXBlVHJhbnNhY3Rpb25zKFxuICAgIHBhZ2UsXG4gICAgQ09NUExFVEVEX1RSQU5TQUNUSU9OU19UQUJMRSxcbiAgICBUcmFuc2FjdGlvblN0YXR1c2VzLkNvbXBsZXRlZCxcbiAgICB0cnVlLFxuICAgIG9wdGlvbnMsXG4gICk7XG4gIGNvbnN0IHR4bnMgPSBbLi4ucGVuZGluZ1R4bnMsIC4uLmNvbXBsZXRlZFR4bnNdO1xuICByZXR1cm4gdHhucztcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Q3VycmVudEJhbGFuY2UocGFnZTogUGFnZSB8IEZyYW1lKTogUHJvbWlzZTxudW1iZXIgfCB1bmRlZmluZWQ+IHtcbiAgLy8gVXNlIGEgc2hvcnQgbm9uLXRocm93aW5nIHBvbGw6IGlmIC5tYWluX2JhbGFuY2UgZG9lc24ndCBhcHBlYXIgaW4gdGhlXG4gIC8vIHRpbWVvdXQgd2luZG93IChiYW5rIG1heSBoYXZlIGNoYW5nZWQgdGhlaXIgVUkpLCByZXR1cm4gdW5kZWZpbmVkIGdyYWNlZnVsbHlcbiAgLy8gc28gdGhlIHJlc3Qgb2YgdGhlIHNjcmFwZSAodHJhbnNhY3Rpb25zKSBjYW4gc3RpbGwgcHJvY2VlZC5cbiAgY29uc3QgYmFsYW5jZUVsZW1lbnQgPSBhd2FpdCBwYWdlXG4gICAgLndhaXRGb3JTZWxlY3RvcihDVVJSRU5UX0JBTEFOQ0UsIHsgdmlzaWJsZTogdHJ1ZSwgdGltZW91dDogRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyB9KVxuICAgIC5jYXRjaCgoKSA9PiBudWxsKTtcbiAgaWYgKCFiYWxhbmNlRWxlbWVudCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBiYWxhbmNlU3RyID0gYXdhaXQgYmFsYW5jZUVsZW1lbnQuZXZhbHVhdGUoZWwgPT4gKGVsIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQpO1xuICByZXR1cm4gZ2V0QW1vdW50RGF0YShiYWxhbmNlU3RyKTtcbn1cblxuLy8gU2VsZWN0b3JzIHZlcmlmaWVkIGFnYWluc3QgbGl2ZSBmaWJpLmNvLmlsIE9UUCBwYWdlLlxuY29uc3QgT1RQX1NFTkRfU01TX1NFTEVDVE9SID0gJyNzZW5kU21zJztcbmNvbnN0IE9UUF9JTlBVVF9TRUxFQ1RPUiA9ICcjY29kZWlucHV0JztcbmNvbnN0IE9UUF9TVUJNSVRfU0VMRUNUT1IgPSAnLm90cFN1Ym1pdEJ1dHRvbic7XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZU90cENoYWxsZW5nZShwYWdlOiBQYWdlLCBvdHBDb2RlUmV0cmlldmVyOiAoKSA9PiBQcm9taXNlPHN0cmluZz4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gQ2xpY2sgXCLXqdec15dcIiB0byB0cmlnZ2VyIHRoZSBTTVMgdG8gdGhlIHVzZXIncyByZWdpc3RlcmVkIHBob25lXG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIE9UUF9TRU5EX1NNU19TRUxFQ1RPUik7XG4gIC8vIFdhaXQgZm9yIHRoZSBPVFAgaW5wdXQgdG8gYW5pbWF0ZSBpbnRvIHRoZSBET00gKGZhZGVJbkRvd24gYW5pbWF0aW9uKVxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgT1RQX0lOUFVUX1NFTEVDVE9SLCB0cnVlKTtcbiAgLy8gU3VzcGVuZCB1bnRpbCB0aGUgY2FsbGVyIHByb3ZpZGVzIHRoZSBjb2RlICh1c2VyIHJlYWRzIFNNUyBhbmQgc3VibWl0cyB2aWEgVUkpXG4gIGNvbnN0IG90cENvZGUgPSBhd2FpdCBvdHBDb2RlUmV0cmlldmVyKCk7XG4gIGF3YWl0IGZpbGxJbnB1dChwYWdlLCBPVFBfSU5QVVRfU0VMRUNUT1IsIG90cENvZGUpO1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBPVFBfU1VCTUlUX1NFTEVDVE9SKTtcbiAgLy8gV2FpdCBmb3IgdGhlIHBvc3QtbG9naW4gZGFzaGJvYXJkIHRvIGFwcGVhciBhZnRlciBzdWNjZXNzZnVsIE9UUFxuICBhd2FpdCBQcm9taXNlLnJhY2UoW1xuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2NhcmQtaGVhZGVyJywgZmFsc2UpLFxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2FjY291bnRfbnVtJywgdHJ1ZSksXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjbWF0YWZMb2dvdXRMaW5rJywgdHJ1ZSksXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjdmFsaWRhdGlvbk1zZycsIHRydWUpLFxuICBdKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JQb3N0TG9naW4ocGFnZTogUGFnZSwgb3RwQ29kZVJldHJpZXZlcj86ICgpID0+IFByb21pc2U8c3RyaW5nPikge1xuICBpZiAob3RwQ29kZVJldHJpZXZlcikge1xuICAgIC8vIFJhY2UgdGhlIE9UUCBjaGFsbGVuZ2UgcGFnZSBhZ2FpbnN0IHRoZSBzdWNjZXNzIHBhZ2Ugc2VsZWN0b3JzLlxuICAgIC8vIFRoZSBkYXNoYm9hcmQtZGV0ZWN0aW9uIGJyYW5jaGVzIHVzZSBhIGxvbmcgdGltZW91dCBzbyB0aGV5IGRvbid0IHJlamVjdFxuICAgIC8vIHdoaWxlIHRoZSBPVFAgcmV0cmlldmVyIGlzIHBhdXNlZCB3YWl0aW5nIGZvciB0aGUgdXNlciB0byBzdXBwbHkgdGhlIGNvZGUuXG4gICAgLy8gKGhhbmRsZU90cENoYWxsZW5nZSBoYXMgaXRzIG93biBpbm5lciB3YWl0IGZvciBkYXNoYm9hcmQgZWxlbWVudHMgYWZ0ZXIgc3VibWl0LilcbiAgICBjb25zdCBOT19PVFBfVElNRU9VVF9NUyA9IDE4MF8wMDA7XG4gICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtcbiAgICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBPVFBfU0VORF9TTVNfU0VMRUNUT1IsIHRydWUpLnRoZW4oKCkgPT4gaGFuZGxlT3RwQ2hhbGxlbmdlKHBhZ2UsIG90cENvZGVSZXRyaWV2ZXIpKSxcbiAgICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2NhcmQtaGVhZGVyJywgZmFsc2UsIE5PX09UUF9USU1FT1VUX01TKSxcbiAgICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2FjY291bnRfbnVtJywgdHJ1ZSwgTk9fT1RQX1RJTUVPVVRfTVMpLFxuICAgICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjbWF0YWZMb2dvdXRMaW5rJywgdHJ1ZSwgTk9fT1RQX1RJTUVPVVRfTVMpLFxuICAgICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjdmFsaWRhdGlvbk1zZycsIHRydWUsIE5PX09UUF9USU1FT1VUX01TKSxcbiAgICBdKTtcbiAgfSBlbHNlIHtcbiAgICBhd2FpdCBQcm9taXNlLnJhY2UoW1xuICAgICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjY2FyZC1oZWFkZXInLCBmYWxzZSksIC8vIE5ldyBVSVxuICAgICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjYWNjb3VudF9udW0nLCB0cnVlKSwgLy8gTmV3IFVJXG4gICAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNtYXRhZkxvZ291dExpbmsnLCB0cnVlKSwgLy8gT2xkIFVJXG4gICAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyN2YWxpZGF0aW9uTXNnJywgdHJ1ZSksIC8vIE9sZCBVSVxuICAgIF0pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWNjb3VudERhdGEocGFnZTogUGFnZSB8IEZyYW1lLCBzdGFydERhdGU6IE1vbWVudCwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKSB7XG4gIGNvbnN0IGFjY291bnROdW1iZXIgPSBhd2FpdCBnZXRBY2NvdW50TnVtYmVyKHBhZ2UpO1xuICBjb25zdCBiYWxhbmNlID0gYXdhaXQgZ2V0Q3VycmVudEJhbGFuY2UocGFnZSk7XG4gIGF3YWl0IHNlYXJjaEJ5RGF0ZXMocGFnZSwgc3RhcnREYXRlKTtcbiAgY29uc3QgdHhucyA9IGF3YWl0IGdldEFjY291bnRUcmFuc2FjdGlvbnMocGFnZSwgb3B0aW9ucyk7XG5cbiAgcmV0dXJuIHtcbiAgICBhY2NvdW50TnVtYmVyLFxuICAgIHR4bnMsXG4gICAgYmFsYW5jZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudElkc09sZFVJKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICBjb25zdCBzZWxlY3RFbGVtZW50ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjY291bnRfbnVtX3NlbGVjdCcpO1xuICAgIGNvbnN0IG9wdGlvbnMgPSBzZWxlY3RFbGVtZW50ID8gc2VsZWN0RWxlbWVudC5xdWVyeVNlbGVjdG9yQWxsKCdvcHRpb24nKSA6IFtdO1xuICAgIGlmICghb3B0aW9ucykgcmV0dXJuIFtdO1xuICAgIHJldHVybiBBcnJheS5mcm9tKG9wdGlvbnMsIG9wdGlvbiA9PiBvcHRpb24udmFsdWUpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBFbnN1cmVzIHRoZSBhY2NvdW50IGRyb3Bkb3duIGlzIG9wZW4sIHRoZW4gcmV0dXJucyB0aGUgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICpcbiAqIFRoaXMgbWV0aG9kOlxuICogLSBDaGVja3MgaWYgdGhlIGRyb3Bkb3duIGlzIGFscmVhZHkgb3Blbi5cbiAqIC0gSWYgbm90IG9wZW4sIGNsaWNrcyB0aGUgYWNjb3VudCBzZWxlY3RvciB0byBvcGVuIGl0LlxuICogLSBXYWl0cyBmb3IgdGhlIGRyb3Bkb3duIHRvIHJlbmRlci5cbiAqIC0gRXh0cmFjdHMgYW5kIHJldHVybnMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICpcbiAqIEdyYWNlZnVsIGhhbmRsaW5nOlxuICogLSBJZiBhbnkgZXJyb3Igb2NjdXJzIChlLmcuLCBzZWxlY3RvcnMgbm90IGZvdW5kLCB0aW1pbmcgaXNzdWVzLCBVSSB2ZXJzaW9uIGNoYW5nZXMpLFxuICogICB0aGUgZnVuY3Rpb24gcmV0dXJucyBhbiBlbXB0eSBsaXN0LlxuICpcbiAqIEBwYXJhbSBwYWdlIFB1cHBldGVlciBQYWdlIG9iamVjdC5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIGF2YWlsYWJsZSBhY2NvdW50IGxhYmVscyAoZS5nLiwgW1wiMTI3IHwgWFhYWDFcIiwgXCIxMjcgfCBYWFhYMlwiXSksXG4gKiAgICAgICAgICBvciBhbiBlbXB0eSBhcnJheSBpZiBzb21ldGhpbmcgZ29lcyB3cm9uZy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlOiBQYWdlKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICB0cnkge1xuICAgIGNvbnN0IGFjY291bnRTZWxlY3RvciA9ICdkaXYuY3VycmVudC1hY2NvdW50JzsgLy8gRGlyZWN0IHNlbGVjdG9yIHRvIGNsaWNrYWJsZSBlbGVtZW50XG4gICAgY29uc3QgZHJvcGRvd25QYW5lbFNlbGVjdG9yID0gJ2Rpdi5tYXQtbWRjLWF1dG9jb21wbGV0ZS1wYW5lbC5hY2NvdW50LXNlbGVjdC1kZCc7IC8vIFRoZSBkcm9wZG93biBsaXN0IGJveFxuICAgIGNvbnN0IG9wdGlvblNlbGVjdG9yID0gJ21hdC1vcHRpb24gLm1kYy1saXN0LWl0ZW1fX3ByaW1hcnktdGV4dCc7IC8vIEFjY291bnQgb3B0aW9uIGxhYmVsc1xuXG4gICAgLy8gQ2hlY2sgaWYgZHJvcGRvd24gaXMgYWxyZWFkeSBvcGVuXG4gICAgY29uc3QgZHJvcGRvd25WaXNpYmxlID0gYXdhaXQgcGFnZVxuICAgICAgLiRldmFsKGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgZWwgPT4ge1xuICAgICAgICByZXR1cm4gZWwgJiYgd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpLmRpc3BsYXkgIT09ICdub25lJyAmJiBlbC5vZmZzZXRQYXJlbnQgIT09IG51bGw7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IGZhbHNlKTsgLy8gY2F0Y2ggaWYgZHJvcGRvd24gaXMgbm90IGluIHRoZSBET00geWV0XG5cbiAgICBpZiAoIWRyb3Bkb3duVmlzaWJsZSkge1xuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGFjY291bnRTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG5cbiAgICAgIC8vIENsaWNrIHRoZSBhY2NvdW50IHNlbGVjdG9yIHRvIG9wZW4gdGhlIGRyb3Bkb3duXG4gICAgICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBhY2NvdW50U2VsZWN0b3IpO1xuXG4gICAgICAvLyBXYWl0IGZvciB0aGUgZHJvcGRvd24gdG8gb3BlblxuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBhY2NvdW50IGxhYmVscyBmcm9tIHRoZSBkcm9wZG93biBvcHRpb25zXG4gICAgY29uc3QgYWNjb3VudExhYmVscyA9IGF3YWl0IHBhZ2UuJCRldmFsKG9wdGlvblNlbGVjdG9yLCBvcHRpb25zID0+IHtcbiAgICAgIHJldHVybiBvcHRpb25zLm1hcChvcHRpb24gPT4gb3B0aW9uLnRleHRDb250ZW50Py50cmltKCkgfHwgJycpLmZpbHRlcihsYWJlbCA9PiBsYWJlbCAhPT0gJycpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFjY291bnRMYWJlbHM7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIFtdOyAvLyBHcmFjZWZ1bCBmYWxsYmFja1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnRJZHNCb3RoVUlzKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGxldCBhY2NvdW50c0lkczogc3RyaW5nW10gPSBhd2FpdCBjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMocGFnZSk7XG4gIGlmIChhY2NvdW50c0lkcy5sZW5ndGggPT09IDApIHtcbiAgICBhY2NvdW50c0lkcyA9IGF3YWl0IGdldEFjY291bnRJZHNPbGRVSShwYWdlKTtcbiAgfVxuICByZXR1cm4gYWNjb3VudHNJZHM7XG59XG5cbi8qKlxuICogU2VsZWN0cyBhbiBhY2NvdW50IGZyb20gdGhlIGRyb3Bkb3duIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBhY2NvdW50IGxhYmVsLlxuICpcbiAqIFRoaXMgbWV0aG9kOlxuICogLSBDbGlja3MgdGhlIGFjY291bnQgc2VsZWN0b3IgYnV0dG9uIHRvIG9wZW4gdGhlIGRyb3Bkb3duLlxuICogLSBSZXRyaWV2ZXMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICogLSBDaGVja3MgaWYgdGhlIHByb3ZpZGVkIGFjY291bnQgbGFiZWwgZXhpc3RzIGluIHRoZSBsaXN0LlxuICogLSBGaW5kcyBhbmQgY2xpY2tzIHRoZSBtYXRjaGluZyBhY2NvdW50IG9wdGlvbiBpZiBmb3VuZC5cbiAqXG4gKiBAcGFyYW0gcGFnZSBQdXBwZXRlZXIgUGFnZSBvYmplY3QuXG4gKiBAcGFyYW0gYWNjb3VudExhYmVsIFRoZSB0ZXh0IG9mIHRoZSBhY2NvdW50IHRvIHNlbGVjdCAoZS5nLiwgXCIxMjcgfCBYWFhYWFwiKS5cbiAqIEByZXR1cm5zIFRydWUgaWYgdGhlIGFjY291bnQgb3B0aW9uIHdhcyBmb3VuZCBhbmQgY2xpY2tlZDsgZmFsc2Ugb3RoZXJ3aXNlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VsZWN0QWNjb3VudEZyb21Ecm9wZG93bihwYWdlOiBQYWdlLCBhY2NvdW50TGFiZWw6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAvLyBDYWxsIGNsaWNrQWNjb3VudFNlbGVjdG9yIHRvIGdldCB0aGUgYXZhaWxhYmxlIGFjY291bnRzIGFuZCBvcGVuIHRoZSBkcm9wZG93blxuICBjb25zdCBhdmFpbGFibGVBY2NvdW50cyA9IGF3YWl0IGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlKTtcblxuICAvLyBDaGVjayBpZiB0aGUgYWNjb3VudCBsYWJlbCBleGlzdHMgaW4gdGhlIGF2YWlsYWJsZSBhY2NvdW50c1xuICBpZiAoIWF2YWlsYWJsZUFjY291bnRzLmluY2x1ZGVzKGFjY291bnRMYWJlbCkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBXYWl0IGZvciB0aGUgZHJvcGRvd24gb3B0aW9ucyB0byBiZSByZW5kZXJlZFxuICBjb25zdCBvcHRpb25TZWxlY3RvciA9ICdtYXQtb3B0aW9uIC5tZGMtbGlzdC1pdGVtX19wcmltYXJ5LXRleHQnO1xuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgb3B0aW9uU2VsZWN0b3IsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xuXG4gIC8vIFF1ZXJ5IGFsbCBtYXRjaGluZyBvcHRpb25zXG4gIGNvbnN0IGFjY291bnRPcHRpb25zID0gYXdhaXQgcGFnZS4kJChvcHRpb25TZWxlY3Rvcik7XG5cbiAgLy8gRmluZCBhbmQgY2xpY2sgdGhlIG9wdGlvbiBtYXRjaGluZyB0aGUgYWNjb3VudExhYmVsXG4gIGZvciAoY29uc3Qgb3B0aW9uIG9mIGFjY291bnRPcHRpb25zKSB7XG4gICAgY29uc3QgdGV4dCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoZWwgPT4gZWwudGV4dENvbnRlbnQ/LnRyaW0oKSwgb3B0aW9uKTtcblxuICAgIGlmICh0ZXh0ID09PSBhY2NvdW50TGFiZWwpIHtcbiAgICAgIGNvbnN0IG9wdGlvbkhhbmRsZSA9IGF3YWl0IG9wdGlvbi5ldmFsdWF0ZUhhbmRsZShlbCA9PiBlbCBhcyBIVE1MRWxlbWVudCk7XG4gICAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKChlbDogSFRNTEVsZW1lbnQpID0+IGVsLmNsaWNrKCksIG9wdGlvbkhhbmRsZSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uc0ZyYW1lKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPEZyYW1lIHwgbnVsbD4ge1xuICAvLyBUcnkgYSBmZXcgdGltZXMgdG8gZmluZCB0aGUgaWZyYW1lLCBhcyBpdCBtaWdodCBub3QgYmUgaW1tZWRpYXRlbHkgYXZhaWxhYmxlXG4gIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDwgMzsgYXR0ZW1wdCsrKSB7XG4gICAgYXdhaXQgc2xlZXAoMjAwMCk7XG4gICAgY29uc3QgZnJhbWVzID0gcGFnZS5mcmFtZXMoKTtcbiAgICBjb25zdCB0YXJnZXRGcmFtZSA9IGZyYW1lcy5maW5kKGYgPT4gZi5uYW1lKCkgPT09IElGUkFNRV9OQU1FKTtcblxuICAgIGlmICh0YXJnZXRGcmFtZSkge1xuICAgICAgcmV0dXJuIHRhcmdldEZyYW1lO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZWxlY3RBY2NvdW50Qm90aFVJcyhwYWdlOiBQYWdlLCBhY2NvdW50SWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBhY2NvdW50U2VsZWN0ZWQgPSBhd2FpdCBzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duKHBhZ2UsIGFjY291bnRJZCk7XG4gIGlmICghYWNjb3VudFNlbGVjdGVkKSB7XG4gICAgLy8gT2xkIFVJIGZvcm1hdFxuICAgIGF3YWl0IHBhZ2Uuc2VsZWN0KCcjYWNjb3VudF9udW1fc2VsZWN0JywgYWNjb3VudElkKTtcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bV9zZWxlY3QnLCB0cnVlKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFjY291bnREYXRhQm90aFVJcyhcbiAgcGFnZTogUGFnZSxcbiAgc3RhcnREYXRlOiBNb21lbnQsXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbik6IFByb21pc2U8VHJhbnNhY3Rpb25zQWNjb3VudD4ge1xuICAvLyBUcnkgdG8gZ2V0IHRoZSBpZnJhbWUgZm9yIHRoZSBuZXcgVUlcbiAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRUcmFuc2FjdGlvbnNGcmFtZShwYWdlKTtcblxuICAvLyBVc2UgdGhlIGZyYW1lIGlmIGF2YWlsYWJsZSAobmV3IFVJKSwgb3RoZXJ3aXNlIHVzZSB0aGUgcGFnZSBkaXJlY3RseSAob2xkIFVJKVxuICBjb25zdCB0YXJnZXRQYWdlID0gZnJhbWUgfHwgcGFnZTtcbiAgcmV0dXJuIGZldGNoQWNjb3VudERhdGEodGFyZ2V0UGFnZSwgc3RhcnREYXRlLCBvcHRpb25zKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50cyhwYWdlOiBQYWdlLCBzdGFydERhdGU6IE1vbWVudCwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50W10+IHtcbiAgY29uc3QgYWNjb3VudHNJZHMgPSBhd2FpdCBnZXRBY2NvdW50SWRzQm90aFVJcyhwYWdlKTtcblxuICBpZiAoYWNjb3VudHNJZHMubGVuZ3RoID09PSAwKSB7XG4gICAgLy8gSW4gY2FzZSBhY2NvdW50c0lkcyBjb3VsZCBubyBiZSBwYXJzZWQganVzdCByZXR1cm4gdGhlIHRyYW5zYWN0aW9ucyBvZiB0aGUgY3VycmVudGx5IHNlbGVjdGVkIGFjY291bnRcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSwgb3B0aW9ucyk7XG4gICAgcmV0dXJuIFthY2NvdW50RGF0YV07XG4gIH1cblxuICBjb25zdCBhY2NvdW50czogVHJhbnNhY3Rpb25zQWNjb3VudFtdID0gW107XG4gIGZvciAoY29uc3QgYWNjb3VudElkIG9mIGFjY291bnRzSWRzKSB7XG4gICAgYXdhaXQgc2VsZWN0QWNjb3VudEJvdGhVSXMocGFnZSwgYWNjb3VudElkKTtcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSwgb3B0aW9ucyk7XG4gICAgYWNjb3VudHMucHVzaChhY2NvdW50RGF0YSk7XG4gIH1cblxuICByZXR1cm4gYWNjb3VudHM7XG59XG5cbnR5cGUgU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMgPSB7XG4gIHVzZXJuYW1lOiBzdHJpbmc7XG4gIHBhc3N3b3JkOiBzdHJpbmc7XG4gIG90cENvZGVSZXRyaWV2ZXI/OiAoKSA9PiBQcm9taXNlPHN0cmluZz47XG59O1xuXG5jbGFzcyBCZWlubGV1bWlHcm91cEJhc2VTY3JhcGVyIGV4dGVuZHMgQmFzZVNjcmFwZXJXaXRoQnJvd3NlcjxTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscz4ge1xuICBCQVNFX1VSTCA9ICcnO1xuXG4gIExPR0lOX1VSTCA9ICcnO1xuXG4gIFRSQU5TQUNUSU9OU19VUkwgPSAnJztcblxuICBnZXRMb2dpbk9wdGlvbnMoY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxvZ2luVXJsOiBgJHt0aGlzLkxPR0lOX1VSTH1gLFxuICAgICAgZmllbGRzOiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFscyksXG4gICAgICBzdWJtaXRCdXR0b25TZWxlY3RvcjogJyNjb250aW51ZUJ0bicsXG4gICAgICBwb3N0QWN0aW9uOiBhc3luYyAoKSA9PiB3YWl0Rm9yUG9zdExvZ2luKHRoaXMucGFnZSwgY3JlZGVudGlhbHMub3RwQ29kZVJldHJpZXZlciksXG4gICAgICBwb3NzaWJsZVJlc3VsdHM6IGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCksXG4gICAgICAvLyBIQUNLOiBGb3Igc29tZSByZWFzb24sIHRob3VnaCB0aGUgbG9naW4gYnV0dG9uICgjY29udGludWVCdG4pIGlzIHByZXNlbnQgYW5kIHZpc2libGUsIHRoZSBjbGljayBhY3Rpb24gZG9lcyBub3QgcGVyZm9ybS5cbiAgICAgIC8vIEFkZGluZyB0aGlzIGRlbGF5IGZpeGVzIHRoZSBpc3N1ZS5cbiAgICAgIHByZUFjdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBzbGVlcCgxMDAwKTtcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIGZldGNoRGF0YSgpIHtcbiAgICBjb25zdCBkZWZhdWx0U3RhcnRNb21lbnQgPSBtb21lbnQoKS5zdWJ0cmFjdCgxLCAneWVhcnMnKS5hZGQoMSwgJ2RheScpO1xuICAgIGNvbnN0IHN0YXJ0TW9tZW50TGltaXQgPSBtb21lbnQoeyB5ZWFyOiAxNjAwIH0pO1xuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IHRoaXMub3B0aW9ucy5zdGFydERhdGUgfHwgZGVmYXVsdFN0YXJ0TW9tZW50LnRvRGF0ZSgpO1xuICAgIGNvbnN0IHN0YXJ0TW9tZW50ID0gbW9tZW50Lm1heChzdGFydE1vbWVudExpbWl0LCBtb21lbnQoc3RhcnREYXRlKSk7XG5cbiAgICBhd2FpdCB0aGlzLm5hdmlnYXRlVG8odGhpcy5UUkFOU0FDVElPTlNfVVJMKTtcblxuICAgIGNvbnN0IGFjY291bnRzID0gYXdhaXQgZmV0Y2hBY2NvdW50cyh0aGlzLnBhZ2UsIHN0YXJ0TW9tZW50LCB0aGlzLm9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBhY2NvdW50cyxcbiAgICB9O1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEJlaW5sZXVtaUdyb3VwQmFzZVNjcmFwZXI7XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O0FBQUEsSUFBQUEsT0FBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUMsVUFBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUscUJBQUEsR0FBQUYsT0FBQTtBQU9BLElBQUFHLFdBQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLGFBQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLFFBQUEsR0FBQUwsT0FBQTtBQUNBLElBQUFNLGNBQUEsR0FBQU4sT0FBQTtBQUNBLElBQUFPLHVCQUFBLEdBQUFQLE9BQUE7QUFBOEcs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