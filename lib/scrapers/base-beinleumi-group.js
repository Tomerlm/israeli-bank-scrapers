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
  // Wait for the post-login dashboard to appear after successful OTP.
  // Promise.any (not race): the dashboard renders exactly one of these markers;
  // the others never appear and would otherwise reject the whole wait on timeout.
  await Promise.any([(0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', false), (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num', true), (0, _elementsInteractions.waitUntilElementFound)(page, '#matafLogoutLink', true), (0, _elementsInteractions.waitUntilElementFound)(page, '#validationMsg', true)]);
}
async function waitForPostLogin(page, otpCodeRetriever) {
  if (otpCodeRetriever) {
    // Detect whichever page follows login: the OTP challenge (#sendSms) OR, if no
    // 2FA is required this session, one of the dashboard markers.
    //
    // Promise.any (NOT race): with `race`, the FIRST branch to *settle* wins — and
    // waitUntilElementFound REJECTS on timeout. So a losing branch timing out would
    // abort the whole login, even while the OTP branch is legitimately paused waiting
    // for the user to type the code. Two real prod failures came from exactly this:
    // the #sendSms branch's default 30s reject killed clean no-OTP logins, and the
    // 180s dashboard branches rejected mid-OTP (before the 5-min user window closed).
    // Promise.any ignores rejections and settles on the first FULFILLMENT, so the OTP
    // branch can stay pending as long as the user needs; it only rejects if ALL fail.
    const DETECT_TIMEOUT_MS = 180_000;
    await Promise.any([(0, _elementsInteractions.waitUntilElementFound)(page, OTP_SEND_SMS_SELECTOR, true, DETECT_TIMEOUT_MS).then(() => handleOtpChallenge(page, otpCodeRetriever)), (0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', false, DETECT_TIMEOUT_MS), (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num', true, DETECT_TIMEOUT_MS), (0, _elementsInteractions.waitUntilElementFound)(page, '#matafLogoutLink', true, DETECT_TIMEOUT_MS), (0, _elementsInteractions.waitUntilElementFound)(page, '#validationMsg', true, DETECT_TIMEOUT_MS)]);
  } else {
    // Same reasoning: exactly one dashboard marker renders; the others time out and
    // must not abort the wait. Promise.any settles on the one that appears.
    await Promise.any([(0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', false),
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2VsZW1lbnRzSW50ZXJhY3Rpb25zIiwiX25hdmlnYXRpb24iLCJfdHJhbnNhY3Rpb25zIiwiX3dhaXRpbmciLCJfdHJhbnNhY3Rpb25zMiIsIl9iYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiREFURV9GT1JNQVQiLCJOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQiLCJEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURUQiLCJEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCIsIkRFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiUkVGRVJFTkNFX0NPTFVNTl9DTEFTUyIsIkRFQklUX0NPTFVNTl9DTEFTUyIsIkNSRURJVF9DT0xVTU5fQ0xBU1MiLCJFUlJPUl9NRVNTQUdFX0NMQVNTIiwiQUNDT1VOVFNfTlVNQkVSIiwiQ0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTUyIsIlNIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRSIsIkNPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUiLCJQRU5ESU5HX1RSQU5TQUNUSU9OU19UQUJMRSIsIk5FWFRfUEFHRV9MSU5LIiwiQ1VSUkVOVF9CQUxBTkNFIiwiSUZSQU1FX05BTUUiLCJFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TIiwiZ2V0UG9zc2libGVMb2dpblJlc3VsdHMiLCJ1cmxzIiwiTG9naW5SZXN1bHRzIiwiU3VjY2VzcyIsIkludmFsaWRQYXNzd29yZCIsImNyZWF0ZUxvZ2luRmllbGRzIiwiY3JlZGVudGlhbHMiLCJzZWxlY3RvciIsInZhbHVlIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsImdldEFtb3VudERhdGEiLCJhbW91bnRTdHIiLCJhbW91bnRTdHJDb3B5IiwicmVwbGFjZSIsIlNIRUtFTF9DVVJSRU5DWV9TWU1CT0wiLCJyZXBsYWNlQWxsIiwicGFyc2VGbG9hdCIsImdldFR4bkFtb3VudCIsInR4biIsImNyZWRpdCIsImRlYml0IiwiTnVtYmVyIiwiaXNOYU4iLCJjb252ZXJ0VHJhbnNhY3Rpb25zIiwidHhucyIsIm9wdGlvbnMiLCJtYXAiLCJjb252ZXJ0ZWREYXRlIiwibW9tZW50IiwiZGF0ZSIsInRvSVNPU3RyaW5nIiwiY29udmVydGVkQW1vdW50IiwicmVzdWx0IiwidHlwZSIsIlRyYW5zYWN0aW9uVHlwZXMiLCJOb3JtYWwiLCJpZGVudGlmaWVyIiwicmVmZXJlbmNlIiwicGFyc2VJbnQiLCJ1bmRlZmluZWQiLCJwcm9jZXNzZWREYXRlIiwib3JpZ2luYWxBbW91bnQiLCJvcmlnaW5hbEN1cnJlbmN5IiwiU0hFS0VMX0NVUlJFTkNZIiwiY2hhcmdlZEFtb3VudCIsInN0YXR1cyIsImRlc2NyaXB0aW9uIiwibWVtbyIsImluY2x1ZGVSYXdUcmFuc2FjdGlvbiIsInJhd1RyYW5zYWN0aW9uIiwiZ2V0UmF3VHJhbnNhY3Rpb24iLCJnZXRUcmFuc2FjdGlvbkRhdGUiLCJ0ZHMiLCJ0cmFuc2FjdGlvblR5cGUiLCJ0cmFuc2FjdGlvbnNDb2xzVHlwZXMiLCJ0cmltIiwiZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbiIsImdldFRyYW5zYWN0aW9uUmVmZXJlbmNlIiwiZ2V0VHJhbnNhY3Rpb25EZWJpdCIsImdldFRyYW5zYWN0aW9uQ3JlZGl0IiwiZXh0cmFjdFRyYW5zYWN0aW9uRGV0YWlscyIsInR4blJvdyIsInRyYW5zYWN0aW9uU3RhdHVzIiwiaW5uZXJUZHMiLCJpdGVtIiwiZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzIiwicGFnZSIsInRhYmxlTG9jYXRvciIsInR5cGVDbGFzc2VzT2JqcyIsInBhZ2VFdmFsQWxsIiwidGQiLCJpbmRleCIsImNvbENsYXNzIiwiZ2V0QXR0cmlidXRlIiwidHlwZUNsYXNzT2JqIiwiZXh0cmFjdFRyYW5zYWN0aW9uIiwicHVzaCIsImV4dHJhY3RUcmFuc2FjdGlvbnMiLCJ0cmFuc2FjdGlvbnNSb3dzIiwidHJzIiwidHIiLCJBcnJheSIsImZyb20iLCJnZXRFbGVtZW50c0J5VGFnTmFtZSIsImlubmVyVGV4dCIsImlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IiLCJoYXNFcnJvckluZm9FbGVtZW50IiwiZWxlbWVudFByZXNlbnRPblBhZ2UiLCJlcnJvclRleHQiLCIkZXZhbCIsImVycm9yRWxlbWVudCIsInNlYXJjaEJ5RGF0ZXMiLCJzdGFydERhdGUiLCJjbGlja0J1dHRvbiIsIndhaXRVbnRpbEVsZW1lbnRGb3VuZCIsImZpbGxJbnB1dCIsImZvcm1hdCIsIndhaXRGb3JOYXZpZ2F0aW9uIiwiZ2V0QWNjb3VudE51bWJlciIsInNlbGVjdGVkU25pZkFjY291bnQiLCJvcHRpb24iLCJjaGVja0lmSGFzTmV4dFBhZ2UiLCJuYXZpZ2F0ZVRvTmV4dFBhZ2UiLCJzY3JhcGVUcmFuc2FjdGlvbnMiLCJuZWVkVG9QYWdpbmF0ZSIsImhhc05leHRQYWdlIiwiY3VycmVudFBhZ2VUeG5zIiwiZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyIsIlByb21pc2UiLCJyYWNlIiwibm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvciIsInBlbmRpbmdUeG5zIiwiVHJhbnNhY3Rpb25TdGF0dXNlcyIsIlBlbmRpbmciLCJjb21wbGV0ZWRUeG5zIiwiQ29tcGxldGVkIiwiZ2V0Q3VycmVudEJhbGFuY2UiLCJiYWxhbmNlRWxlbWVudCIsIndhaXRGb3JTZWxlY3RvciIsInZpc2libGUiLCJ0aW1lb3V0IiwiY2F0Y2giLCJiYWxhbmNlU3RyIiwiZXZhbHVhdGUiLCJlbCIsIk9UUF9TRU5EX1NNU19TRUxFQ1RPUiIsIk9UUF9JTlBVVF9TRUxFQ1RPUiIsIk9UUF9TVUJNSVRfU0VMRUNUT1IiLCJoYW5kbGVPdHBDaGFsbGVuZ2UiLCJvdHBDb2RlUmV0cmlldmVyIiwib3RwQ29kZSIsImFueSIsIndhaXRGb3JQb3N0TG9naW4iLCJERVRFQ1RfVElNRU9VVF9NUyIsInRoZW4iLCJmZXRjaEFjY291bnREYXRhIiwiYWNjb3VudE51bWJlciIsImJhbGFuY2UiLCJnZXRBY2NvdW50SWRzT2xkVUkiLCJzZWxlY3RFbGVtZW50IiwiZG9jdW1lbnQiLCJnZXRFbGVtZW50QnlJZCIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMiLCJhY2NvdW50U2VsZWN0b3IiLCJkcm9wZG93blBhbmVsU2VsZWN0b3IiLCJvcHRpb25TZWxlY3RvciIsImRyb3Bkb3duVmlzaWJsZSIsIndpbmRvdyIsImdldENvbXB1dGVkU3R5bGUiLCJkaXNwbGF5Iiwib2Zmc2V0UGFyZW50IiwiYWNjb3VudExhYmVscyIsIiQkZXZhbCIsInRleHRDb250ZW50IiwiZmlsdGVyIiwibGFiZWwiLCJlcnJvciIsImdldEFjY291bnRJZHNCb3RoVUlzIiwiYWNjb3VudHNJZHMiLCJsZW5ndGgiLCJzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duIiwiYWNjb3VudExhYmVsIiwiYXZhaWxhYmxlQWNjb3VudHMiLCJpbmNsdWRlcyIsImFjY291bnRPcHRpb25zIiwiJCQiLCJ0ZXh0Iiwib3B0aW9uSGFuZGxlIiwiZXZhbHVhdGVIYW5kbGUiLCJjbGljayIsImdldFRyYW5zYWN0aW9uc0ZyYW1lIiwiYXR0ZW1wdCIsInNsZWVwIiwiZnJhbWVzIiwidGFyZ2V0RnJhbWUiLCJmaW5kIiwiZiIsIm5hbWUiLCJzZWxlY3RBY2NvdW50Qm90aFVJcyIsImFjY291bnRJZCIsImFjY291bnRTZWxlY3RlZCIsInNlbGVjdCIsImZldGNoQWNjb3VudERhdGFCb3RoVUlzIiwiZnJhbWUiLCJ0YXJnZXRQYWdlIiwiZmV0Y2hBY2NvdW50cyIsImFjY291bnREYXRhIiwiYWNjb3VudHMiLCJCZWlubGV1bWlHcm91cEJhc2VTY3JhcGVyIiwiQmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsIkJBU0VfVVJMIiwiTE9HSU5fVVJMIiwiVFJBTlNBQ1RJT05TX1VSTCIsImdldExvZ2luT3B0aW9ucyIsImxvZ2luVXJsIiwiZmllbGRzIiwic3VibWl0QnV0dG9uU2VsZWN0b3IiLCJwb3N0QWN0aW9uIiwicG9zc2libGVSZXN1bHRzIiwicHJlQWN0aW9uIiwiZmV0Y2hEYXRhIiwiZGVmYXVsdFN0YXJ0TW9tZW50Iiwic3VidHJhY3QiLCJhZGQiLCJzdGFydE1vbWVudExpbWl0IiwieWVhciIsInRvRGF0ZSIsInN0YXJ0TW9tZW50IiwibWF4IiwibmF2aWdhdGVUbyIsInN1Y2Nlc3MiLCJfZGVmYXVsdCIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvc2NyYXBlcnMvYmFzZS1iZWlubGV1bWktZ3JvdXAudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IG1vbWVudCwgeyB0eXBlIE1vbWVudCB9IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgeyB0eXBlIEZyYW1lLCB0eXBlIFBhZ2UgfSBmcm9tICdwdXBwZXRlZXInO1xuaW1wb3J0IHsgU0hFS0VMX0NVUlJFTkNZLCBTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MIH0gZnJvbSAnLi4vY29uc3RhbnRzJztcbmltcG9ydCB7XG4gIGNsaWNrQnV0dG9uLFxuICBlbGVtZW50UHJlc2VudE9uUGFnZSxcbiAgZmlsbElucHV0LFxuICBwYWdlRXZhbEFsbCxcbiAgd2FpdFVudGlsRWxlbWVudEZvdW5kLFxufSBmcm9tICcuLi9oZWxwZXJzL2VsZW1lbnRzLWludGVyYWN0aW9ucyc7XG5pbXBvcnQgeyB3YWl0Rm9yTmF2aWdhdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvbmF2aWdhdGlvbic7XG5pbXBvcnQgeyBnZXRSYXdUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IHNsZWVwIH0gZnJvbSAnLi4vaGVscGVycy93YWl0aW5nJztcbmltcG9ydCB7IFRyYW5zYWN0aW9uU3RhdHVzZXMsIFRyYW5zYWN0aW9uVHlwZXMsIHR5cGUgVHJhbnNhY3Rpb24sIHR5cGUgVHJhbnNhY3Rpb25zQWNjb3VudCB9IGZyb20gJy4uL3RyYW5zYWN0aW9ucyc7XG5pbXBvcnQgeyBCYXNlU2NyYXBlcldpdGhCcm93c2VyLCBMb2dpblJlc3VsdHMsIHR5cGUgUG9zc2libGVMb2dpblJlc3VsdHMgfSBmcm9tICcuL2Jhc2Utc2NyYXBlci13aXRoLWJyb3dzZXInO1xuaW1wb3J0IHsgdHlwZSBTY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vaW50ZXJmYWNlJztcblxuY29uc3QgREFURV9GT1JNQVQgPSAnREQvTU0vWVlZWSc7XG5jb25zdCBOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQgPSAn15zXkCDXoNee16bXkNeVINeg16rXldeg15nXnSDXkdeg15XXqdeQINeU157XkdeV16fXqSc7XG5jb25zdCBEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURUQgPSAnZGF0ZSBmaXJzdCc7XG5jb25zdCBEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HID0gJ2ZpcnN0IGRhdGUnO1xuY29uc3QgREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCA9ICdyZWZlcmVuY2Ugd3JhcF9ub3JtYWwnO1xuY29uc3QgREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX1BFTkRJTkcgPSAnZGV0YWlscyB3cmFwX25vcm1hbCc7XG5jb25zdCBSRUZFUkVOQ0VfQ09MVU1OX0NMQVNTID0gJ2RldGFpbHMnO1xuY29uc3QgREVCSVRfQ09MVU1OX0NMQVNTID0gJ2RlYml0JztcbmNvbnN0IENSRURJVF9DT0xVTU5fQ0xBU1MgPSAnY3JlZGl0JztcbmNvbnN0IEVSUk9SX01FU1NBR0VfQ0xBU1MgPSAnTk9fREFUQSc7XG5jb25zdCBBQ0NPVU5UU19OVU1CRVIgPSAnZGl2LmZpYmlfYWNjb3VudCBzcGFuLmFjY19udW0nO1xuY29uc3QgQ0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTUyA9ICd1aS1kYXRlcGlja2VyLWNsb3NlJztcbmNvbnN0IFNIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRSA9ICfXlNem15InO1xuY29uc3QgQ09NUExFVEVEX1RSQU5TQUNUSU9OU19UQUJMRSA9ICd0YWJsZSNkYXRhVGFibGUwNzcnO1xuY29uc3QgUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUgPSAndGFibGUjZGF0YVRhYmxlMDIzJztcbmNvbnN0IE5FWFRfUEFHRV9MSU5LID0gJ2EjTnBhZ2UucGFnaW5nJztcbmNvbnN0IENVUlJFTlRfQkFMQU5DRSA9ICcubWFpbl9iYWxhbmNlJztcbmNvbnN0IElGUkFNRV9OQU1FID0gJ2lmcmFtZS1vbGQtcGFnZXMnO1xuY29uc3QgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyA9IDEwMDAwO1xuXG50eXBlIFRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG50eXBlIFRyYW5zYWN0aW9uc1RyVGRzID0gc3RyaW5nW107XG50eXBlIFRyYW5zYWN0aW9uc1RyID0geyBpbm5lclRkczogVHJhbnNhY3Rpb25zVHJUZHMgfTtcblxuaW50ZXJmYWNlIFNjcmFwZWRUcmFuc2FjdGlvbiB7XG4gIHJlZmVyZW5jZTogc3RyaW5nO1xuICBkYXRlOiBzdHJpbmc7XG4gIGNyZWRpdDogc3RyaW5nO1xuICBkZWJpdDogc3RyaW5nO1xuICBtZW1vPzogc3RyaW5nO1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICBzdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpOiBQb3NzaWJsZUxvZ2luUmVzdWx0cyB7XG4gIGNvbnN0IHVybHM6IFBvc3NpYmxlTG9naW5SZXN1bHRzID0ge307XG4gIHVybHNbTG9naW5SZXN1bHRzLlN1Y2Nlc3NdID0gW1xuICAgIC9maWJpLiphY2NvdW50U3VtbWFyeS8sIC8vIE5ldyBVSSBwYXR0ZXJuXG4gICAgL1Jlc291cmNlc1xcL1BvcnRhbE5HXFwvc2hlbGwvLCAvLyBOZXcgVUkgcGF0dGVyblxuICAgIC9GaWJpTWVudVxcL09ubGluZS8sIC8vIE9sZCBVSSBwYXR0ZXJuXG4gIF07XG4gIHVybHNbTG9naW5SZXN1bHRzLkludmFsaWRQYXNzd29yZF0gPSBbL0ZpYmlNZW51XFwvTWFya2V0aW5nXFwvUHJpdmF0ZVxcL0hvbWUvXTtcbiAgcmV0dXJuIHVybHM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcbiAgcmV0dXJuIFtcbiAgICB7IHNlbGVjdG9yOiAnI3VzZXJuYW1lJywgdmFsdWU6IGNyZWRlbnRpYWxzLnVzZXJuYW1lIH0sXG4gICAgeyBzZWxlY3RvcjogJyNwYXNzd29yZCcsIHZhbHVlOiBjcmVkZW50aWFscy5wYXNzd29yZCB9LFxuICBdO1xufVxuXG5mdW5jdGlvbiBnZXRBbW91bnREYXRhKGFtb3VudFN0cjogc3RyaW5nKSB7XG4gIGxldCBhbW91bnRTdHJDb3B5ID0gYW1vdW50U3RyLnJlcGxhY2UoU0hFS0VMX0NVUlJFTkNZX1NZTUJPTCwgJycpO1xuICBhbW91bnRTdHJDb3B5ID0gYW1vdW50U3RyQ29weS5yZXBsYWNlQWxsKCcsJywgJycpO1xuICByZXR1cm4gcGFyc2VGbG9hdChhbW91bnRTdHJDb3B5KTtcbn1cblxuZnVuY3Rpb24gZ2V0VHhuQW1vdW50KHR4bjogU2NyYXBlZFRyYW5zYWN0aW9uKSB7XG4gIGNvbnN0IGNyZWRpdCA9IGdldEFtb3VudERhdGEodHhuLmNyZWRpdCk7XG4gIGNvbnN0IGRlYml0ID0gZ2V0QW1vdW50RGF0YSh0eG4uZGViaXQpO1xuICByZXR1cm4gKE51bWJlci5pc05hTihjcmVkaXQpID8gMCA6IGNyZWRpdCkgLSAoTnVtYmVyLmlzTmFOKGRlYml0KSA/IDAgOiBkZWJpdCk7XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRUcmFuc2FjdGlvbnModHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyk6IFRyYW5zYWN0aW9uW10ge1xuICByZXR1cm4gdHhucy5tYXAoKHR4bik6IFRyYW5zYWN0aW9uID0+IHtcbiAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbW9tZW50KHR4bi5kYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBjb252ZXJ0ZWRBbW91bnQgPSBnZXRUeG5BbW91bnQodHhuKTtcbiAgICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uID0ge1xuICAgICAgdHlwZTogVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWwsXG4gICAgICBpZGVudGlmaWVyOiB0eG4ucmVmZXJlbmNlID8gcGFyc2VJbnQodHhuLnJlZmVyZW5jZSwgMTApIDogdW5kZWZpbmVkLFxuICAgICAgZGF0ZTogY29udmVydGVkRGF0ZSxcbiAgICAgIHByb2Nlc3NlZERhdGU6IGNvbnZlcnRlZERhdGUsXG4gICAgICBvcmlnaW5hbEFtb3VudDogY29udmVydGVkQW1vdW50LFxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogU0hFS0VMX0NVUlJFTkNZLFxuICAgICAgY2hhcmdlZEFtb3VudDogY29udmVydGVkQW1vdW50LFxuICAgICAgc3RhdHVzOiB0eG4uc3RhdHVzLFxuICAgICAgZGVzY3JpcHRpb246IHR4bi5kZXNjcmlwdGlvbixcbiAgICAgIG1lbW86IHR4bi5tZW1vLFxuICAgIH07XG5cbiAgICBpZiAob3B0aW9ucz8uaW5jbHVkZVJhd1RyYW5zYWN0aW9uKSB7XG4gICAgICByZXN1bHQucmF3VHJhbnNhY3Rpb24gPSBnZXRSYXdUcmFuc2FjdGlvbih0eG4pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRhdGUoXG4gIHRkczogVHJhbnNhY3Rpb25zVHJUZHMsXG4gIHRyYW5zYWN0aW9uVHlwZTogc3RyaW5nLFxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcbikge1xuICBpZiAodHJhbnNhY3Rpb25UeXBlID09PSAnY29tcGxldGVkJykge1xuICAgIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURURdXSB8fCAnJykudHJpbSgpO1xuICB9XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbihcbiAgdGRzOiBUcmFuc2FjdGlvbnNUclRkcyxcbiAgdHJhbnNhY3Rpb25UeXBlOiBzdHJpbmcsXG4gIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzLFxuKSB7XG4gIGlmICh0cmFuc2FjdGlvblR5cGUgPT09ICdjb21wbGV0ZWQnKSB7XG4gICAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19DT01QTEVURURdXSB8fCAnJykudHJpbSgpO1xuICB9XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfUEVORElOR11dIHx8ICcnKS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uUmVmZXJlbmNlKHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tSRUZFUkVOQ0VfQ09MVU1OX0NMQVNTXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EZWJpdCh0ZHM6IFRyYW5zYWN0aW9uc1RyVGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcykge1xuICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREVCSVRfQ09MVU1OX0NMQVNTXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25DcmVkaXQodGRzOiBUcmFuc2FjdGlvbnNUclRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMpIHtcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0NSRURJVF9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzKFxuICB0eG5Sb3c6IFRyYW5zYWN0aW9uc1RyLFxuICB0cmFuc2FjdGlvblN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcyxcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXG4pOiBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICBjb25zdCB0ZHMgPSB0eG5Sb3cuaW5uZXJUZHM7XG4gIGNvbnN0IGl0ZW0gPSB7XG4gICAgc3RhdHVzOiB0cmFuc2FjdGlvblN0YXR1cyxcbiAgICBkYXRlOiBnZXRUcmFuc2FjdGlvbkRhdGUodGRzLCB0cmFuc2FjdGlvblN0YXR1cywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcbiAgICBkZXNjcmlwdGlvbjogZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbih0ZHMsIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIHJlZmVyZW5jZTogZ2V0VHJhbnNhY3Rpb25SZWZlcmVuY2UodGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIGRlYml0OiBnZXRUcmFuc2FjdGlvbkRlYml0KHRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcbiAgICBjcmVkaXQ6IGdldFRyYW5zYWN0aW9uQ3JlZGl0KHRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcbiAgfTtcblxuICByZXR1cm4gaXRlbTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzKFxuICBwYWdlOiBQYWdlIHwgRnJhbWUsXG4gIHRhYmxlTG9jYXRvcjogc3RyaW5nLFxuKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNDb2xzVHlwZXM+IHtcbiAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMgPSB7fTtcbiAgY29uc3QgdHlwZUNsYXNzZXNPYmpzID0gYXdhaXQgcGFnZUV2YWxBbGwocGFnZSwgYCR7dGFibGVMb2NhdG9yfSB0Ym9keSB0cjpmaXJzdC1vZi10eXBlIHRkYCwgbnVsbCwgdGRzID0+IHtcbiAgICByZXR1cm4gdGRzLm1hcCgodGQsIGluZGV4KSA9PiAoe1xuICAgICAgY29sQ2xhc3M6IHRkLmdldEF0dHJpYnV0ZSgnY2xhc3MnKSxcbiAgICAgIGluZGV4LFxuICAgIH0pKTtcbiAgfSk7XG5cbiAgZm9yIChjb25zdCB0eXBlQ2xhc3NPYmogb2YgdHlwZUNsYXNzZXNPYmpzKSB7XG4gICAgaWYgKHR5cGVDbGFzc09iai5jb2xDbGFzcykge1xuICAgICAgcmVzdWx0W3R5cGVDbGFzc09iai5jb2xDbGFzc10gPSB0eXBlQ2xhc3NPYmouaW5kZXg7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RUcmFuc2FjdGlvbihcbiAgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sXG4gIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLFxuICB0eG5Sb3c6IFRyYW5zYWN0aW9uc1RyLFxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcbikge1xuICBjb25zdCB0eG4gPSBleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzKHR4blJvdywgdHJhbnNhY3Rpb25TdGF0dXMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyk7XG4gIGlmICh0eG4uZGF0ZSAhPT0gJycpIHtcbiAgICB0eG5zLnB1c2godHhuKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb25zKHBhZ2U6IFBhZ2UgfCBGcmFtZSwgdGFibGVMb2NhdG9yOiBzdHJpbmcsIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzKSB7XG4gIGNvbnN0IHR4bnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdID0gW107XG4gIGNvbnN0IHRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IGF3YWl0IGdldFRyYW5zYWN0aW9uc0NvbHNUeXBlQ2xhc3NlcyhwYWdlLCB0YWJsZUxvY2F0b3IpO1xuXG4gIGNvbnN0IHRyYW5zYWN0aW9uc1Jvd3MgPSBhd2FpdCBwYWdlRXZhbEFsbDxUcmFuc2FjdGlvbnNUcltdPihwYWdlLCBgJHt0YWJsZUxvY2F0b3J9IHRib2R5IHRyYCwgW10sIHRycyA9PiB7XG4gICAgcmV0dXJuIHRycy5tYXAodHIgPT4gKHtcbiAgICAgIGlubmVyVGRzOiBBcnJheS5mcm9tKHRyLmdldEVsZW1lbnRzQnlUYWdOYW1lKCd0ZCcpKS5tYXAodGQgPT4gdGQuaW5uZXJUZXh0KSxcbiAgICB9KSk7XG4gIH0pO1xuXG4gIGZvciAoY29uc3QgdHhuUm93IG9mIHRyYW5zYWN0aW9uc1Jvd3MpIHtcbiAgICBleHRyYWN0VHJhbnNhY3Rpb24odHhucywgdHJhbnNhY3Rpb25TdGF0dXMsIHR4blJvdywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKTtcbiAgfVxuICByZXR1cm4gdHhucztcbn1cblxuYXN5bmMgZnVuY3Rpb24gaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvcihwYWdlOiBQYWdlIHwgRnJhbWUpIHtcbiAgY29uc3QgaGFzRXJyb3JJbmZvRWxlbWVudCA9IGF3YWl0IGVsZW1lbnRQcmVzZW50T25QYWdlKHBhZ2UsIGAuJHtFUlJPUl9NRVNTQUdFX0NMQVNTfWApO1xuICBpZiAoaGFzRXJyb3JJbmZvRWxlbWVudCkge1xuICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IHBhZ2UuJGV2YWwoYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCwgZXJyb3JFbGVtZW50ID0+IHtcbiAgICAgIHJldHVybiAoZXJyb3JFbGVtZW50IGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQ7XG4gICAgfSk7XG4gICAgcmV0dXJuIGVycm9yVGV4dC50cmltKCkgPT09IE5PX1RSQU5TQUNUSU9OX0lOX0RBVEVfUkFOR0VfVEVYVDtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNlYXJjaEJ5RGF0ZXMocGFnZTogUGFnZSB8IEZyYW1lLCBzdGFydERhdGU6IE1vbWVudCkge1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCAnYSN0YWJIZWFkZXI0Jyk7XG4gIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnZGl2I2ZpYmlfZGF0ZXMnKTtcbiAgYXdhaXQgZmlsbElucHV0KHBhZ2UsICdpbnB1dCNmcm9tRGF0ZScsIHN0YXJ0RGF0ZS5mb3JtYXQoREFURV9GT1JNQVQpKTtcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgYGJ1dHRvbltjbGFzcyo9JHtDTE9TRV9TRUFSQ0hfQllfREFURVNfQlVUVE9OX0NMQVNTfV1gKTtcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgYGlucHV0W3ZhbHVlPSR7U0hPV19TRUFSQ0hfQllfREFURVNfQlVUVE9OX1ZBTFVFfV1gKTtcbiAgYXdhaXQgd2FpdEZvck5hdmlnYXRpb24ocGFnZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnROdW1iZXIocGFnZTogUGFnZSB8IEZyYW1lKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgLy8gV2FpdCB1bnRpbCB0aGUgYWNjb3VudCBudW1iZXIgZWxlbWVudCBpcyBwcmVzZW50IGluIHRoZSBET01cbiAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIEFDQ09VTlRTX05VTUJFUiwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG5cbiAgY29uc3Qgc2VsZWN0ZWRTbmlmQWNjb3VudCA9IGF3YWl0IHBhZ2UuJGV2YWwoQUNDT1VOVFNfTlVNQkVSLCBvcHRpb24gPT4ge1xuICAgIHJldHVybiAob3B0aW9uIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQ7XG4gIH0pO1xuXG4gIHJldHVybiBzZWxlY3RlZFNuaWZBY2NvdW50LnJlcGxhY2UoJy8nLCAnXycpLnRyaW0oKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2hlY2tJZkhhc05leHRQYWdlKHBhZ2U6IFBhZ2UgfCBGcmFtZSkge1xuICByZXR1cm4gZWxlbWVudFByZXNlbnRPblBhZ2UocGFnZSwgTkVYVF9QQUdFX0xJTkspO1xufVxuXG5hc3luYyBmdW5jdGlvbiBuYXZpZ2F0ZVRvTmV4dFBhZ2UocGFnZTogUGFnZSB8IEZyYW1lKSB7XG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIE5FWFRfUEFHRV9MSU5LKTtcbiAgYXdhaXQgd2FpdEZvck5hdmlnYXRpb24ocGFnZSk7XG59XG5cbi8qIENvdWxkbid0IHJlcHJvZHVjZSBzY2VuYXJpbyB3aXRoIG11bHRpcGxlIHBhZ2VzIG9mIHBlbmRpbmcgdHJhbnNhY3Rpb25zIC0gU2hvdWxkIHN1cHBvcnQgaWYgZXhpc3RzIHN1Y2ggY2FzZS5cbiAgIG5lZWRUb1BhZ2luYXRlIGlzIGZhbHNlIGlmIHNjcmFwaW5nIHBlbmRpbmcgdHJhbnNhY3Rpb25zICovXG5hc3luYyBmdW5jdGlvbiBzY3JhcGVUcmFuc2FjdGlvbnMoXG4gIHBhZ2U6IFBhZ2UgfCBGcmFtZSxcbiAgdGFibGVMb2NhdG9yOiBzdHJpbmcsXG4gIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLFxuICBuZWVkVG9QYWdpbmF0ZTogYm9vbGVhbixcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKSB7XG4gIGNvbnN0IHR4bnMgPSBbXTtcbiAgbGV0IGhhc05leHRQYWdlID0gZmFsc2U7XG5cbiAgZG8ge1xuICAgIGNvbnN0IGN1cnJlbnRQYWdlVHhucyA9IGF3YWl0IGV4dHJhY3RUcmFuc2FjdGlvbnMocGFnZSwgdGFibGVMb2NhdG9yLCB0cmFuc2FjdGlvblN0YXR1cyk7XG4gICAgdHhucy5wdXNoKC4uLmN1cnJlbnRQYWdlVHhucyk7XG4gICAgaWYgKG5lZWRUb1BhZ2luYXRlKSB7XG4gICAgICBoYXNOZXh0UGFnZSA9IGF3YWl0IGNoZWNrSWZIYXNOZXh0UGFnZShwYWdlKTtcbiAgICAgIGlmIChoYXNOZXh0UGFnZSkge1xuICAgICAgICBhd2FpdCBuYXZpZ2F0ZVRvTmV4dFBhZ2UocGFnZSk7XG4gICAgICB9XG4gICAgfVxuICB9IHdoaWxlIChoYXNOZXh0UGFnZSk7XG5cbiAgcmV0dXJuIGNvbnZlcnRUcmFuc2FjdGlvbnModHhucywgb3B0aW9ucyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnRUcmFuc2FjdGlvbnMocGFnZTogUGFnZSB8IEZyYW1lLCBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMpIHtcbiAgYXdhaXQgUHJvbWlzZS5yYWNlKFtcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgXCJkaXZbaWQqPSdkaXZUYWJsZSddXCIsIGZhbHNlKSxcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCwgZmFsc2UpLFxuICBdKTtcblxuICBjb25zdCBub1RyYW5zYWN0aW9uSW5SYW5nZUVycm9yID0gYXdhaXQgaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvcihwYWdlKTtcbiAgaWYgKG5vVHJhbnNhY3Rpb25JblJhbmdlRXJyb3IpIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCBwZW5kaW5nVHhucyA9IGF3YWl0IHNjcmFwZVRyYW5zYWN0aW9ucyhcbiAgICBwYWdlLFxuICAgIFBFTkRJTkdfVFJBTlNBQ1RJT05TX1RBQkxFLFxuICAgIFRyYW5zYWN0aW9uU3RhdHVzZXMuUGVuZGluZyxcbiAgICBmYWxzZSxcbiAgICBvcHRpb25zLFxuICApO1xuICBjb25zdCBjb21wbGV0ZWRUeG5zID0gYXdhaXQgc2NyYXBlVHJhbnNhY3Rpb25zKFxuICAgIHBhZ2UsXG4gICAgQ09NUExFVEVEX1RSQU5TQUNUSU9OU19UQUJMRSxcbiAgICBUcmFuc2FjdGlvblN0YXR1c2VzLkNvbXBsZXRlZCxcbiAgICB0cnVlLFxuICAgIG9wdGlvbnMsXG4gICk7XG4gIGNvbnN0IHR4bnMgPSBbLi4ucGVuZGluZ1R4bnMsIC4uLmNvbXBsZXRlZFR4bnNdO1xuICByZXR1cm4gdHhucztcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Q3VycmVudEJhbGFuY2UocGFnZTogUGFnZSB8IEZyYW1lKTogUHJvbWlzZTxudW1iZXIgfCB1bmRlZmluZWQ+IHtcbiAgLy8gVXNlIGEgc2hvcnQgbm9uLXRocm93aW5nIHBvbGw6IGlmIC5tYWluX2JhbGFuY2UgZG9lc24ndCBhcHBlYXIgaW4gdGhlXG4gIC8vIHRpbWVvdXQgd2luZG93IChiYW5rIG1heSBoYXZlIGNoYW5nZWQgdGhlaXIgVUkpLCByZXR1cm4gdW5kZWZpbmVkIGdyYWNlZnVsbHlcbiAgLy8gc28gdGhlIHJlc3Qgb2YgdGhlIHNjcmFwZSAodHJhbnNhY3Rpb25zKSBjYW4gc3RpbGwgcHJvY2VlZC5cbiAgY29uc3QgYmFsYW5jZUVsZW1lbnQgPSBhd2FpdCBwYWdlXG4gICAgLndhaXRGb3JTZWxlY3RvcihDVVJSRU5UX0JBTEFOQ0UsIHsgdmlzaWJsZTogdHJ1ZSwgdGltZW91dDogRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyB9KVxuICAgIC5jYXRjaCgoKSA9PiBudWxsKTtcbiAgaWYgKCFiYWxhbmNlRWxlbWVudCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBiYWxhbmNlU3RyID0gYXdhaXQgYmFsYW5jZUVsZW1lbnQuZXZhbHVhdGUoZWwgPT4gKGVsIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQpO1xuICByZXR1cm4gZ2V0QW1vdW50RGF0YShiYWxhbmNlU3RyKTtcbn1cblxuLy8gU2VsZWN0b3JzIHZlcmlmaWVkIGFnYWluc3QgbGl2ZSBmaWJpLmNvLmlsIE9UUCBwYWdlLlxuY29uc3QgT1RQX1NFTkRfU01TX1NFTEVDVE9SID0gJyNzZW5kU21zJztcbmNvbnN0IE9UUF9JTlBVVF9TRUxFQ1RPUiA9ICcjY29kZWlucHV0JztcbmNvbnN0IE9UUF9TVUJNSVRfU0VMRUNUT1IgPSAnLm90cFN1Ym1pdEJ1dHRvbic7XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZU90cENoYWxsZW5nZShwYWdlOiBQYWdlLCBvdHBDb2RlUmV0cmlldmVyOiAoKSA9PiBQcm9taXNlPHN0cmluZz4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gQ2xpY2sgXCLXqdec15dcIiB0byB0cmlnZ2VyIHRoZSBTTVMgdG8gdGhlIHVzZXIncyByZWdpc3RlcmVkIHBob25lXG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIE9UUF9TRU5EX1NNU19TRUxFQ1RPUik7XG4gIC8vIFdhaXQgZm9yIHRoZSBPVFAgaW5wdXQgdG8gYW5pbWF0ZSBpbnRvIHRoZSBET00gKGZhZGVJbkRvd24gYW5pbWF0aW9uKVxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgT1RQX0lOUFVUX1NFTEVDVE9SLCB0cnVlKTtcbiAgLy8gU3VzcGVuZCB1bnRpbCB0aGUgY2FsbGVyIHByb3ZpZGVzIHRoZSBjb2RlICh1c2VyIHJlYWRzIFNNUyBhbmQgc3VibWl0cyB2aWEgVUkpXG4gIGNvbnN0IG90cENvZGUgPSBhd2FpdCBvdHBDb2RlUmV0cmlldmVyKCk7XG4gIGF3YWl0IGZpbGxJbnB1dChwYWdlLCBPVFBfSU5QVVRfU0VMRUNUT1IsIG90cENvZGUpO1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBPVFBfU1VCTUlUX1NFTEVDVE9SKTtcbiAgLy8gV2FpdCBmb3IgdGhlIHBvc3QtbG9naW4gZGFzaGJvYXJkIHRvIGFwcGVhciBhZnRlciBzdWNjZXNzZnVsIE9UUC5cbiAgLy8gUHJvbWlzZS5hbnkgKG5vdCByYWNlKTogdGhlIGRhc2hib2FyZCByZW5kZXJzIGV4YWN0bHkgb25lIG9mIHRoZXNlIG1hcmtlcnM7XG4gIC8vIHRoZSBvdGhlcnMgbmV2ZXIgYXBwZWFyIGFuZCB3b3VsZCBvdGhlcndpc2UgcmVqZWN0IHRoZSB3aG9sZSB3YWl0IG9uIHRpbWVvdXQuXG4gIGF3YWl0IFByb21pc2UuYW55KFtcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNjYXJkLWhlYWRlcicsIGZhbHNlKSxcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bScsIHRydWUpLFxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI21hdGFmTG9nb3V0TGluaycsIHRydWUpLFxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI3ZhbGlkYXRpb25Nc2cnLCB0cnVlKSxcbiAgXSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3YWl0Rm9yUG9zdExvZ2luKHBhZ2U6IFBhZ2UsIG90cENvZGVSZXRyaWV2ZXI/OiAoKSA9PiBQcm9taXNlPHN0cmluZz4pIHtcbiAgaWYgKG90cENvZGVSZXRyaWV2ZXIpIHtcbiAgICAvLyBEZXRlY3Qgd2hpY2hldmVyIHBhZ2UgZm9sbG93cyBsb2dpbjogdGhlIE9UUCBjaGFsbGVuZ2UgKCNzZW5kU21zKSBPUiwgaWYgbm9cbiAgICAvLyAyRkEgaXMgcmVxdWlyZWQgdGhpcyBzZXNzaW9uLCBvbmUgb2YgdGhlIGRhc2hib2FyZCBtYXJrZXJzLlxuICAgIC8vXG4gICAgLy8gUHJvbWlzZS5hbnkgKE5PVCByYWNlKTogd2l0aCBgcmFjZWAsIHRoZSBGSVJTVCBicmFuY2ggdG8gKnNldHRsZSogd2lucyDigJQgYW5kXG4gICAgLy8gd2FpdFVudGlsRWxlbWVudEZvdW5kIFJFSkVDVFMgb24gdGltZW91dC4gU28gYSBsb3NpbmcgYnJhbmNoIHRpbWluZyBvdXQgd291bGRcbiAgICAvLyBhYm9ydCB0aGUgd2hvbGUgbG9naW4sIGV2ZW4gd2hpbGUgdGhlIE9UUCBicmFuY2ggaXMgbGVnaXRpbWF0ZWx5IHBhdXNlZCB3YWl0aW5nXG4gICAgLy8gZm9yIHRoZSB1c2VyIHRvIHR5cGUgdGhlIGNvZGUuIFR3byByZWFsIHByb2QgZmFpbHVyZXMgY2FtZSBmcm9tIGV4YWN0bHkgdGhpczpcbiAgICAvLyB0aGUgI3NlbmRTbXMgYnJhbmNoJ3MgZGVmYXVsdCAzMHMgcmVqZWN0IGtpbGxlZCBjbGVhbiBuby1PVFAgbG9naW5zLCBhbmQgdGhlXG4gICAgLy8gMTgwcyBkYXNoYm9hcmQgYnJhbmNoZXMgcmVqZWN0ZWQgbWlkLU9UUCAoYmVmb3JlIHRoZSA1LW1pbiB1c2VyIHdpbmRvdyBjbG9zZWQpLlxuICAgIC8vIFByb21pc2UuYW55IGlnbm9yZXMgcmVqZWN0aW9ucyBhbmQgc2V0dGxlcyBvbiB0aGUgZmlyc3QgRlVMRklMTE1FTlQsIHNvIHRoZSBPVFBcbiAgICAvLyBicmFuY2ggY2FuIHN0YXkgcGVuZGluZyBhcyBsb25nIGFzIHRoZSB1c2VyIG5lZWRzOyBpdCBvbmx5IHJlamVjdHMgaWYgQUxMIGZhaWwuXG4gICAgY29uc3QgREVURUNUX1RJTUVPVVRfTVMgPSAxODBfMDAwO1xuICAgIGF3YWl0IFByb21pc2UuYW55KFtcbiAgICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBPVFBfU0VORF9TTVNfU0VMRUNUT1IsIHRydWUsIERFVEVDVF9USU1FT1VUX01TKS50aGVuKCgpID0+IGhhbmRsZU90cENoYWxsZW5nZShwYWdlLCBvdHBDb2RlUmV0cmlldmVyKSksXG4gICAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNjYXJkLWhlYWRlcicsIGZhbHNlLCBERVRFQ1RfVElNRU9VVF9NUyksXG4gICAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bScsIHRydWUsIERFVEVDVF9USU1FT1VUX01TKSxcbiAgICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI21hdGFmTG9nb3V0TGluaycsIHRydWUsIERFVEVDVF9USU1FT1VUX01TKSxcbiAgICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI3ZhbGlkYXRpb25Nc2cnLCB0cnVlLCBERVRFQ1RfVElNRU9VVF9NUyksXG4gICAgXSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gU2FtZSByZWFzb25pbmc6IGV4YWN0bHkgb25lIGRhc2hib2FyZCBtYXJrZXIgcmVuZGVyczsgdGhlIG90aGVycyB0aW1lIG91dCBhbmRcbiAgICAvLyBtdXN0IG5vdCBhYm9ydCB0aGUgd2FpdC4gUHJvbWlzZS5hbnkgc2V0dGxlcyBvbiB0aGUgb25lIHRoYXQgYXBwZWFycy5cbiAgICBhd2FpdCBQcm9taXNlLmFueShbXG4gICAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNjYXJkLWhlYWRlcicsIGZhbHNlKSwgLy8gTmV3IFVJXG4gICAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bScsIHRydWUpLCAvLyBOZXcgVUlcbiAgICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI21hdGFmTG9nb3V0TGluaycsIHRydWUpLCAvLyBPbGQgVUlcbiAgICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI3ZhbGlkYXRpb25Nc2cnLCB0cnVlKSwgLy8gT2xkIFVJXG4gICAgXSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50RGF0YShwYWdlOiBQYWdlIHwgRnJhbWUsIHN0YXJ0RGF0ZTogTW9tZW50LCBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMpIHtcbiAgY29uc3QgYWNjb3VudE51bWJlciA9IGF3YWl0IGdldEFjY291bnROdW1iZXIocGFnZSk7XG4gIGNvbnN0IGJhbGFuY2UgPSBhd2FpdCBnZXRDdXJyZW50QmFsYW5jZShwYWdlKTtcbiAgYXdhaXQgc2VhcmNoQnlEYXRlcyhwYWdlLCBzdGFydERhdGUpO1xuICBjb25zdCB0eG5zID0gYXdhaXQgZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyhwYWdlLCBvcHRpb25zKTtcblxuICByZXR1cm4ge1xuICAgIGFjY291bnROdW1iZXIsXG4gICAgdHhucyxcbiAgICBiYWxhbmNlLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBY2NvdW50SWRzT2xkVUkocGFnZTogUGFnZSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgcmV0dXJuIHBhZ2UuZXZhbHVhdGUoKCkgPT4ge1xuICAgIGNvbnN0IHNlbGVjdEVsZW1lbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWNjb3VudF9udW1fc2VsZWN0Jyk7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHNlbGVjdEVsZW1lbnQgPyBzZWxlY3RFbGVtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ29wdGlvbicpIDogW107XG4gICAgaWYgKCFvcHRpb25zKSByZXR1cm4gW107XG4gICAgcmV0dXJuIEFycmF5LmZyb20ob3B0aW9ucywgb3B0aW9uID0+IG9wdGlvbi52YWx1ZSk7XG4gIH0pO1xufVxuXG4vKipcbiAqIEVuc3VyZXMgdGhlIGFjY291bnQgZHJvcGRvd24gaXMgb3BlbiwgdGhlbiByZXR1cm5zIHRoZSBhdmFpbGFibGUgYWNjb3VudCBsYWJlbHMuXG4gKlxuICogVGhpcyBtZXRob2Q6XG4gKiAtIENoZWNrcyBpZiB0aGUgZHJvcGRvd24gaXMgYWxyZWFkeSBvcGVuLlxuICogLSBJZiBub3Qgb3BlbiwgY2xpY2tzIHRoZSBhY2NvdW50IHNlbGVjdG9yIHRvIG9wZW4gaXQuXG4gKiAtIFdhaXRzIGZvciB0aGUgZHJvcGRvd24gdG8gcmVuZGVyLlxuICogLSBFeHRyYWN0cyBhbmQgcmV0dXJucyB0aGUgbGlzdCBvZiBhdmFpbGFibGUgYWNjb3VudCBsYWJlbHMuXG4gKlxuICogR3JhY2VmdWwgaGFuZGxpbmc6XG4gKiAtIElmIGFueSBlcnJvciBvY2N1cnMgKGUuZy4sIHNlbGVjdG9ycyBub3QgZm91bmQsIHRpbWluZyBpc3N1ZXMsIFVJIHZlcnNpb24gY2hhbmdlcyksXG4gKiAgIHRoZSBmdW5jdGlvbiByZXR1cm5zIGFuIGVtcHR5IGxpc3QuXG4gKlxuICogQHBhcmFtIHBhZ2UgUHVwcGV0ZWVyIFBhZ2Ugb2JqZWN0LlxuICogQHJldHVybnMgQW4gYXJyYXkgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzIChlLmcuLCBbXCIxMjcgfCBYWFhYMVwiLCBcIjEyNyB8IFhYWFgyXCJdKSxcbiAqICAgICAgICAgIG9yIGFuIGVtcHR5IGFycmF5IGlmIHNvbWV0aGluZyBnb2VzIHdyb25nLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2xpY2tBY2NvdW50U2VsZWN0b3JHZXRBY2NvdW50SWRzKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgYWNjb3VudFNlbGVjdG9yID0gJ2Rpdi5jdXJyZW50LWFjY291bnQnOyAvLyBEaXJlY3Qgc2VsZWN0b3IgdG8gY2xpY2thYmxlIGVsZW1lbnRcbiAgICBjb25zdCBkcm9wZG93blBhbmVsU2VsZWN0b3IgPSAnZGl2Lm1hdC1tZGMtYXV0b2NvbXBsZXRlLXBhbmVsLmFjY291bnQtc2VsZWN0LWRkJzsgLy8gVGhlIGRyb3Bkb3duIGxpc3QgYm94XG4gICAgY29uc3Qgb3B0aW9uU2VsZWN0b3IgPSAnbWF0LW9wdGlvbiAubWRjLWxpc3QtaXRlbV9fcHJpbWFyeS10ZXh0JzsgLy8gQWNjb3VudCBvcHRpb24gbGFiZWxzXG5cbiAgICAvLyBDaGVjayBpZiBkcm9wZG93biBpcyBhbHJlYWR5IG9wZW5cbiAgICBjb25zdCBkcm9wZG93blZpc2libGUgPSBhd2FpdCBwYWdlXG4gICAgICAuJGV2YWwoZHJvcGRvd25QYW5lbFNlbGVjdG9yLCBlbCA9PiB7XG4gICAgICAgIHJldHVybiBlbCAmJiB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShlbCkuZGlzcGxheSAhPT0gJ25vbmUnICYmIGVsLm9mZnNldFBhcmVudCAhPT0gbnVsbDtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKCkgPT4gZmFsc2UpOyAvLyBjYXRjaCBpZiBkcm9wZG93biBpcyBub3QgaW4gdGhlIERPTSB5ZXRcblxuICAgIGlmICghZHJvcGRvd25WaXNpYmxlKSB7XG4gICAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgYWNjb3VudFNlbGVjdG9yLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcblxuICAgICAgLy8gQ2xpY2sgdGhlIGFjY291bnQgc2VsZWN0b3IgdG8gb3BlbiB0aGUgZHJvcGRvd25cbiAgICAgIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIGFjY291bnRTZWxlY3Rvcik7XG5cbiAgICAgIC8vIFdhaXQgZm9yIHRoZSBkcm9wZG93biB0byBvcGVuXG4gICAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgZHJvcGRvd25QYW5lbFNlbGVjdG9yLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IGFjY291bnQgbGFiZWxzIGZyb20gdGhlIGRyb3Bkb3duIG9wdGlvbnNcbiAgICBjb25zdCBhY2NvdW50TGFiZWxzID0gYXdhaXQgcGFnZS4kJGV2YWwob3B0aW9uU2VsZWN0b3IsIG9wdGlvbnMgPT4ge1xuICAgICAgcmV0dXJuIG9wdGlvbnMubWFwKG9wdGlvbiA9PiBvcHRpb24udGV4dENvbnRlbnQ/LnRyaW0oKSB8fCAnJykuZmlsdGVyKGxhYmVsID0+IGxhYmVsICE9PSAnJyk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gYWNjb3VudExhYmVscztcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4gW107IC8vIEdyYWNlZnVsIGZhbGxiYWNrXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudElkc0JvdGhVSXMocGFnZTogUGFnZSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgbGV0IGFjY291bnRzSWRzOiBzdHJpbmdbXSA9IGF3YWl0IGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlKTtcbiAgaWYgKGFjY291bnRzSWRzLmxlbmd0aCA9PT0gMCkge1xuICAgIGFjY291bnRzSWRzID0gYXdhaXQgZ2V0QWNjb3VudElkc09sZFVJKHBhZ2UpO1xuICB9XG4gIHJldHVybiBhY2NvdW50c0lkcztcbn1cblxuLyoqXG4gKiBTZWxlY3RzIGFuIGFjY291bnQgZnJvbSB0aGUgZHJvcGRvd24gYmFzZWQgb24gdGhlIHByb3ZpZGVkIGFjY291bnQgbGFiZWwuXG4gKlxuICogVGhpcyBtZXRob2Q6XG4gKiAtIENsaWNrcyB0aGUgYWNjb3VudCBzZWxlY3RvciBidXR0b24gdG8gb3BlbiB0aGUgZHJvcGRvd24uXG4gKiAtIFJldHJpZXZlcyB0aGUgbGlzdCBvZiBhdmFpbGFibGUgYWNjb3VudCBsYWJlbHMuXG4gKiAtIENoZWNrcyBpZiB0aGUgcHJvdmlkZWQgYWNjb3VudCBsYWJlbCBleGlzdHMgaW4gdGhlIGxpc3QuXG4gKiAtIEZpbmRzIGFuZCBjbGlja3MgdGhlIG1hdGNoaW5nIGFjY291bnQgb3B0aW9uIGlmIGZvdW5kLlxuICpcbiAqIEBwYXJhbSBwYWdlIFB1cHBldGVlciBQYWdlIG9iamVjdC5cbiAqIEBwYXJhbSBhY2NvdW50TGFiZWwgVGhlIHRleHQgb2YgdGhlIGFjY291bnQgdG8gc2VsZWN0IChlLmcuLCBcIjEyNyB8IFhYWFhYXCIpLlxuICogQHJldHVybnMgVHJ1ZSBpZiB0aGUgYWNjb3VudCBvcHRpb24gd2FzIGZvdW5kIGFuZCBjbGlja2VkOyBmYWxzZSBvdGhlcndpc2UuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duKHBhZ2U6IFBhZ2UsIGFjY291bnRMYWJlbDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIC8vIENhbGwgY2xpY2tBY2NvdW50U2VsZWN0b3IgdG8gZ2V0IHRoZSBhdmFpbGFibGUgYWNjb3VudHMgYW5kIG9wZW4gdGhlIGRyb3Bkb3duXG4gIGNvbnN0IGF2YWlsYWJsZUFjY291bnRzID0gYXdhaXQgY2xpY2tBY2NvdW50U2VsZWN0b3JHZXRBY2NvdW50SWRzKHBhZ2UpO1xuXG4gIC8vIENoZWNrIGlmIHRoZSBhY2NvdW50IGxhYmVsIGV4aXN0cyBpbiB0aGUgYXZhaWxhYmxlIGFjY291bnRzXG4gIGlmICghYXZhaWxhYmxlQWNjb3VudHMuaW5jbHVkZXMoYWNjb3VudExhYmVsKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIFdhaXQgZm9yIHRoZSBkcm9wZG93biBvcHRpb25zIHRvIGJlIHJlbmRlcmVkXG4gIGNvbnN0IG9wdGlvblNlbGVjdG9yID0gJ21hdC1vcHRpb24gLm1kYy1saXN0LWl0ZW1fX3ByaW1hcnktdGV4dCc7XG4gIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBvcHRpb25TZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG5cbiAgLy8gUXVlcnkgYWxsIG1hdGNoaW5nIG9wdGlvbnNcbiAgY29uc3QgYWNjb3VudE9wdGlvbnMgPSBhd2FpdCBwYWdlLiQkKG9wdGlvblNlbGVjdG9yKTtcblxuICAvLyBGaW5kIGFuZCBjbGljayB0aGUgb3B0aW9uIG1hdGNoaW5nIHRoZSBhY2NvdW50TGFiZWxcbiAgZm9yIChjb25zdCBvcHRpb24gb2YgYWNjb3VudE9wdGlvbnMpIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShlbCA9PiBlbC50ZXh0Q29udGVudD8udHJpbSgpLCBvcHRpb24pO1xuXG4gICAgaWYgKHRleHQgPT09IGFjY291bnRMYWJlbCkge1xuICAgICAgY29uc3Qgb3B0aW9uSGFuZGxlID0gYXdhaXQgb3B0aW9uLmV2YWx1YXRlSGFuZGxlKGVsID0+IGVsIGFzIEhUTUxFbGVtZW50KTtcbiAgICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoKGVsOiBIVE1MRWxlbWVudCkgPT4gZWwuY2xpY2soKSwgb3B0aW9uSGFuZGxlKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25zRnJhbWUocGFnZTogUGFnZSk6IFByb21pc2U8RnJhbWUgfCBudWxsPiB7XG4gIC8vIFRyeSBhIGZldyB0aW1lcyB0byBmaW5kIHRoZSBpZnJhbWUsIGFzIGl0IG1pZ2h0IG5vdCBiZSBpbW1lZGlhdGVseSBhdmFpbGFibGVcbiAgZm9yIChsZXQgYXR0ZW1wdCA9IDA7IGF0dGVtcHQgPCAzOyBhdHRlbXB0KyspIHtcbiAgICBhd2FpdCBzbGVlcCgyMDAwKTtcbiAgICBjb25zdCBmcmFtZXMgPSBwYWdlLmZyYW1lcygpO1xuICAgIGNvbnN0IHRhcmdldEZyYW1lID0gZnJhbWVzLmZpbmQoZiA9PiBmLm5hbWUoKSA9PT0gSUZSQU1FX05BTUUpO1xuXG4gICAgaWYgKHRhcmdldEZyYW1lKSB7XG4gICAgICByZXR1cm4gdGFyZ2V0RnJhbWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNlbGVjdEFjY291bnRCb3RoVUlzKHBhZ2U6IFBhZ2UsIGFjY291bnRJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGFjY291bnRTZWxlY3RlZCA9IGF3YWl0IHNlbGVjdEFjY291bnRGcm9tRHJvcGRvd24ocGFnZSwgYWNjb3VudElkKTtcbiAgaWYgKCFhY2NvdW50U2VsZWN0ZWQpIHtcbiAgICAvLyBPbGQgVUkgZm9ybWF0XG4gICAgYXdhaXQgcGFnZS5zZWxlY3QoJyNhY2NvdW50X251bV9zZWxlY3QnLCBhY2NvdW50SWQpO1xuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2FjY291bnRfbnVtX3NlbGVjdCcsIHRydWUpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWNjb3VudERhdGFCb3RoVUlzKFxuICBwYWdlOiBQYWdlLFxuICBzdGFydERhdGU6IE1vbWVudCxcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50PiB7XG4gIC8vIFRyeSB0byBnZXQgdGhlIGlmcmFtZSBmb3IgdGhlIG5ldyBVSVxuICBjb25zdCBmcmFtZSA9IGF3YWl0IGdldFRyYW5zYWN0aW9uc0ZyYW1lKHBhZ2UpO1xuXG4gIC8vIFVzZSB0aGUgZnJhbWUgaWYgYXZhaWxhYmxlIChuZXcgVUkpLCBvdGhlcndpc2UgdXNlIHRoZSBwYWdlIGRpcmVjdGx5IChvbGQgVUkpXG4gIGNvbnN0IHRhcmdldFBhZ2UgPSBmcmFtZSB8fCBwYWdlO1xuICByZXR1cm4gZmV0Y2hBY2NvdW50RGF0YSh0YXJnZXRQYWdlLCBzdGFydERhdGUsIG9wdGlvbnMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFjY291bnRzKHBhZ2U6IFBhZ2UsIHN0YXJ0RGF0ZTogTW9tZW50LCBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMpOiBQcm9taXNlPFRyYW5zYWN0aW9uc0FjY291bnRbXT4ge1xuICBjb25zdCBhY2NvdW50c0lkcyA9IGF3YWl0IGdldEFjY291bnRJZHNCb3RoVUlzKHBhZ2UpO1xuXG4gIGlmIChhY2NvdW50c0lkcy5sZW5ndGggPT09IDApIHtcbiAgICAvLyBJbiBjYXNlIGFjY291bnRzSWRzIGNvdWxkIG5vIGJlIHBhcnNlZCBqdXN0IHJldHVybiB0aGUgdHJhbnNhY3Rpb25zIG9mIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgYWNjb3VudFxuICAgIGNvbnN0IGFjY291bnREYXRhID0gYXdhaXQgZmV0Y2hBY2NvdW50RGF0YUJvdGhVSXMocGFnZSwgc3RhcnREYXRlLCBvcHRpb25zKTtcbiAgICByZXR1cm4gW2FjY291bnREYXRhXTtcbiAgfVxuXG4gIGNvbnN0IGFjY291bnRzOiBUcmFuc2FjdGlvbnNBY2NvdW50W10gPSBbXTtcbiAgZm9yIChjb25zdCBhY2NvdW50SWQgb2YgYWNjb3VudHNJZHMpIHtcbiAgICBhd2FpdCBzZWxlY3RBY2NvdW50Qm90aFVJcyhwYWdlLCBhY2NvdW50SWQpO1xuICAgIGNvbnN0IGFjY291bnREYXRhID0gYXdhaXQgZmV0Y2hBY2NvdW50RGF0YUJvdGhVSXMocGFnZSwgc3RhcnREYXRlLCBvcHRpb25zKTtcbiAgICBhY2NvdW50cy5wdXNoKGFjY291bnREYXRhKTtcbiAgfVxuXG4gIHJldHVybiBhY2NvdW50cztcbn1cblxudHlwZSBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyA9IHtcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgb3RwQ29kZVJldHJpZXZlcj86ICgpID0+IFByb21pc2U8c3RyaW5nPjtcbn07XG5cbmNsYXNzIEJlaW5sZXVtaUdyb3VwQmFzZVNjcmFwZXIgZXh0ZW5kcyBCYXNlU2NyYXBlcldpdGhCcm93c2VyPFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzPiB7XG4gIEJBU0VfVVJMID0gJyc7XG5cbiAgTE9HSU5fVVJMID0gJyc7XG5cbiAgVFJBTlNBQ1RJT05TX1VSTCA9ICcnO1xuXG4gIGdldExvZ2luT3B0aW9ucyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbG9naW5Vcmw6IGAke3RoaXMuTE9HSU5fVVJMfWAsXG4gICAgICBmaWVsZHM6IGNyZWF0ZUxvZ2luRmllbGRzKGNyZWRlbnRpYWxzKSxcbiAgICAgIHN1Ym1pdEJ1dHRvblNlbGVjdG9yOiAnI2NvbnRpbnVlQnRuJyxcbiAgICAgIHBvc3RBY3Rpb246IGFzeW5jICgpID0+IHdhaXRGb3JQb3N0TG9naW4odGhpcy5wYWdlLCBjcmVkZW50aWFscy5vdHBDb2RlUmV0cmlldmVyKSxcbiAgICAgIHBvc3NpYmxlUmVzdWx0czogZ2V0UG9zc2libGVMb2dpblJlc3VsdHMoKSxcbiAgICAgIC8vIEhBQ0s6IEZvciBzb21lIHJlYXNvbiwgdGhvdWdoIHRoZSBsb2dpbiBidXR0b24gKCNjb250aW51ZUJ0bikgaXMgcHJlc2VudCBhbmQgdmlzaWJsZSwgdGhlIGNsaWNrIGFjdGlvbiBkb2VzIG5vdCBwZXJmb3JtLlxuICAgICAgLy8gQWRkaW5nIHRoaXMgZGVsYXkgZml4ZXMgdGhlIGlzc3VlLlxuICAgICAgcHJlQWN0aW9uOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHNsZWVwKDEwMDApO1xuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hEYXRhKCkge1xuICAgIGNvbnN0IGRlZmF1bHRTdGFydE1vbWVudCA9IG1vbWVudCgpLnN1YnRyYWN0KDEsICd5ZWFycycpLmFkZCgxLCAnZGF5Jyk7XG4gICAgY29uc3Qgc3RhcnRNb21lbnRMaW1pdCA9IG1vbWVudCh7IHllYXI6IDE2MDAgfSk7XG4gICAgY29uc3Qgc3RhcnREYXRlID0gdGhpcy5vcHRpb25zLnN0YXJ0RGF0ZSB8fCBkZWZhdWx0U3RhcnRNb21lbnQudG9EYXRlKCk7XG4gICAgY29uc3Qgc3RhcnRNb21lbnQgPSBtb21lbnQubWF4KHN0YXJ0TW9tZW50TGltaXQsIG1vbWVudChzdGFydERhdGUpKTtcblxuICAgIGF3YWl0IHRoaXMubmF2aWdhdGVUbyh0aGlzLlRSQU5TQUNUSU9OU19VUkwpO1xuXG4gICAgY29uc3QgYWNjb3VudHMgPSBhd2FpdCBmZXRjaEFjY291bnRzKHRoaXMucGFnZSwgc3RhcnRNb21lbnQsIHRoaXMub3B0aW9ucyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGFjY291bnRzLFxuICAgIH07XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgQmVpbmxldW1pR3JvdXBCYXNlU2NyYXBlcjtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFBQSxJQUFBQSxPQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFFQSxJQUFBQyxVQUFBLEdBQUFELE9BQUE7QUFDQSxJQUFBRSxxQkFBQSxHQUFBRixPQUFBO0FBT0EsSUFBQUcsV0FBQSxHQUFBSCxPQUFBO0FBQ0EsSUFBQUksYUFBQSxHQUFBSixPQUFBO0FBQ0EsSUFBQUssUUFBQSxHQUFBTCxPQUFBO0FBQ0EsSUFBQU0sY0FBQSxHQUFBTixPQUFBO0FBQ0EsSUFBQU8sdUJBQUEsR0FBQVAsT0FBQTtBQUE4RyxTQUFBRCx1QkFBQVMsQ0FB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