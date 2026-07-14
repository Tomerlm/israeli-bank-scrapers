"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _moment = _interopRequireDefault(require("moment"));
var _debug = require("../helpers/debug");
var _elementsInteractions = require("../helpers/elements-interactions");
var _fetch = require("../helpers/fetch");
var _navigation = require("../helpers/navigation");
var _storage = require("../helpers/storage");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const apiHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin: 'https://digital-web.cal-online.co.il',
  Referer: 'https://digital-web.cal-online.co.il',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty'
};
const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails';
const FRAMES_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus';
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests';
const SSO_AUTHORIZATION_REQUEST_ENDPOINT = 'https://connect.cal-online.co.il/col-rest/calconnect/authentication/SSO';
const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';
const ChangePasswordMessage = 'להחליף סיסמה';
const ChangePasswordSubtitle = 'הגיע הזמן לסיסמה חדשה';
const ChangePasswordUrl = '/change-password';
const debug = (0, _debug.getDebug)('visa-cal');
var TrnTypeCode = /*#__PURE__*/function (TrnTypeCode) {
  TrnTypeCode["regular"] = "5";
  TrnTypeCode["credit"] = "6";
  TrnTypeCode["installments"] = "8";
  TrnTypeCode["standingOrder"] = "9";
  return TrnTypeCode;
}(TrnTypeCode || {});
function isAuthModule(result) {
  return Boolean(result?.auth?.calConnectToken && String(result.auth.calConnectToken).trim());
}
function authModuleOrUndefined(result) {
  return isAuthModule(result) ? result : undefined;
}
function isPending(transaction) {
  return transaction.debCrdDate === undefined; // an arbitrary field that only appears in a completed transaction
}
function isCardTransactionDetails(result) {
  return result.result !== undefined;
}
function isCardPendingTransactionDetails(result) {
  return result.result !== undefined;
}
async function getLoginFrame(page) {
  let frame = null;
  debug('wait until login frame found');
  await (0, _waiting.waitUntil)(() => {
    frame = page.frames().find(f => f.url().includes('connect')) || null;
    return Promise.resolve(!!frame);
  }, 'wait for iframe with login form', 10000, 1000);
  if (!frame) {
    debug('failed to find login frame for 10 seconds');
    throw new Error('failed to extract login iframe');
  }
  return frame;
}
async function hasInvalidPasswordError(page) {
  const frame = await getLoginFrame(page);
  const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, 'div.general-error > div');
  const errorMessage = errorFound ? await (0, _elementsInteractions.pageEval)(frame, 'div.general-error > div', '', item => {
    return item.innerText;
  }) : '';
  return errorMessage === InvalidPasswordMessage;
}
async function hasChangePasswordForm(page) {
  // Check if any frame navigated to the change-password route
  const changePasswordFrame = page.frames().find(f => {
    const url = f.url();
    return url.includes('connect.cal-online.co.il') && url.includes(ChangePasswordUrl);
  });
  if (changePasswordFrame) {
    return true;
  }
  try {
    const frame = await getLoginFrame(page);

    // Check for the change-password Angular component
    if (await (0, _elementsInteractions.elementPresentOnPage)(frame, 'change-password')) {
      return true;
    }

    // Check for the change password title element
    if (await (0, _elementsInteractions.elementPresentOnPage)(frame, '.change-password-title')) {
      return true;
    }

    // Check for the change password subtitle text
    if (await (0, _elementsInteractions.elementPresentOnPage)(frame, '.change-password-subtitle')) {
      const subtitleText = await (0, _elementsInteractions.pageEval)(frame, '.change-password-subtitle', '', item => {
        return item.innerText.trim();
      });
      if (subtitleText.includes(ChangePasswordSubtitle)) {
        return true;
      }
    }

    // Legacy: check for the old .err-desc based change password message
    const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, '.err-desc');
    if (errorFound) {
      const errText = await (0, _elementsInteractions.pageEval)(frame, '.err-desc', '', item => {
        return item.innerText.trim();
      });
      return errText.includes(ChangePasswordMessage);
    }
  } catch (e) {
    debug('failed to check change password form in login frame: %s', e.message);
  }
  return false;
}
function getPossibleLoginResults() {
  debug('return possible login results');
  const urls = {
    [_baseScraperWithBrowser.LoginResults.Success]: [/dashboard/i],
    [_baseScraperWithBrowser.LoginResults.InvalidPassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasInvalidPasswordError(page);
    }],
    // [LoginResults.AccountBlocked]: [], // TODO add when reaching this scenario
    [_baseScraperWithBrowser.LoginResults.ChangePassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasChangePasswordForm(page);
    }]
  };
  return urls;
}
function createLoginFields(credentials) {
  debug('create login fields for username and password');
  return [{
    selector: '[formcontrolname="userName"]',
    value: credentials.username
  }, {
    selector: '[formcontrolname="password"]',
    value: credentials.password
  }];
}
function convertParsedDataToTransactions(data, pendingData, options) {
  const pendingTransactions = pendingData?.result ? pendingData.result.cardsList.flatMap(card => card.authDetalisList) : [];
  const bankAccounts = data.flatMap(monthData => monthData.result.bankAccounts);
  const regularDebitDays = bankAccounts.flatMap(accounts => accounts.debitDates);
  const immediateDebitDays = bankAccounts.flatMap(accounts => accounts.immidiateDebits.debitDays);
  const completedTransactions = [...regularDebitDays, ...immediateDebitDays].flatMap(debitDate => debitDate.transactions);
  const all = [...pendingTransactions, ...completedTransactions];
  return all.map(transaction => {
    const numOfPayments = isPending(transaction) ? transaction.numberOfPayments : transaction.numOfPayments;
    const installments = numOfPayments ? {
      number: isPending(transaction) ? 1 : transaction.curPaymentNum,
      total: numOfPayments
    } : undefined;
    const date = (0, _moment.default)(transaction.trnPurchaseDate);
    const chargedAmount = (isPending(transaction) ? transaction.trnAmt : transaction.amtBeforeConvAndIndex) * -1;
    const originalAmount = transaction.trnAmt * (transaction.trnTypeCode === TrnTypeCode.credit ? 1 : -1);
    const result = {
      identifier: !isPending(transaction) ? transaction.trnIntId : undefined,
      type: [TrnTypeCode.regular, TrnTypeCode.standingOrder].includes(transaction.trnTypeCode) ? _transactions2.TransactionTypes.Normal : _transactions2.TransactionTypes.Installments,
      status: isPending(transaction) ? _transactions2.TransactionStatuses.Pending : _transactions2.TransactionStatuses.Completed,
      date: installments ? date.add(installments.number - 1, 'month').toISOString() : date.toISOString(),
      processedDate: isPending(transaction) ? date.toISOString() : new Date(transaction.debCrdDate).toISOString(),
      originalAmount,
      originalCurrency: transaction.trnCurrencySymbol,
      chargedAmount,
      chargedCurrency: !isPending(transaction) ? transaction.debCrdCurrencySymbol : undefined,
      description: transaction.merchantName,
      memo: transaction.transTypeCommentDetails.toString(),
      category: transaction.branchCodeDesc
    };
    if (installments) {
      result.installments = installments;
    }
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(transaction);
    }
    return result;
  });
}
class VisaCalScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  authorization = undefined;
  openLoginPopup = async () => {
    debug('open login popup, wait until login button available');
    await (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn', true);
    debug('click on the login button');
    await (0, _elementsInteractions.clickButton)(this.page, '#ccLoginDesktopBtn');
    debug('get the frame that holds the login');
    const frame = await getLoginFrame(this.page);
    debug('wait until the password login tab header is available');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, '#regular-login');
    debug('navigate to the password login tab');
    await (0, _elementsInteractions.clickButton)(frame, '#regular-login');
    debug('wait until the password login tab is active');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, 'regular-login');
    return frame;
  };
  async getCards() {
    const initData = await (0, _waiting.waitUntil)(() => (0, _storage.getFromSessionStorage)(this.page, 'init'), 'get init data in session storage', 10000, 1000);
    if (!initData) {
      throw new Error('could not find "init" data in session storage');
    }
    return initData?.result.cards.map(({
      cardUniqueId,
      last4Digits
    }) => ({
      cardUniqueId,
      last4Digits
    }));
  }
  async getAuthorizationHeader() {
    if (!this.authorization) {
      debug('fetching authorization header');
      const authModule = await (0, _waiting.waitUntil)(async () => authModuleOrUndefined(await (0, _storage.getFromSessionStorage)(this.page, 'auth-module')), 'get authorization header with valid token in session storage', 10_000, 50);
      return `CALAuthScheme ${authModule.auth.calConnectToken}`;
    }
    return this.authorization;
  }
  async getXSiteId() {
    /*
      I don't know if the constant below will change in the feature.
      If so, use the next code:
       return this.page.evaluate(() => new Ut().xSiteId);
       To get the classname search for 'xSiteId' in the page source
      class Ut {
        constructor(_e, on, yn) {
            this.store = _e,
            this.config = on,
            this.eventBusService = yn,
            this.xSiteId = "09031987-273E-2311-906C-8AF85B17C8D9",
    */
    return Promise.resolve('09031987-273E-2311-906C-8AF85B17C8D9');
  }
  getLoginOptions(credentials) {
    this.authRequestPromise = this.page.waitForRequest(SSO_AUTHORIZATION_REQUEST_ENDPOINT, {
      timeout: 10_000
    }).catch(e => {
      debug('error while waiting for the token request', e);
      return undefined;
    });
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: async () => {
        try {
          await (0, _navigation.waitForNavigation)(this.page);
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('site-tutorial')) {
            await (0, _elementsInteractions.clickButton)(this.page, 'button.btn-close');
          }
          const request = await this.authRequestPromise;
          this.authorization = String(request?.headers().authorization || '').trim();
        } catch (e) {
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('dashboard')) return;
          const requiresChangePassword = await hasChangePasswordForm(this.page);
          if (requiresChangePassword) return;
          throw e;
        }
      },
      userAgent: apiHeaders['User-Agent']
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));
    debug(`fetch transactions starting ${startMoment.format()}`);
    const [cards, xSiteId, Authorization] = await Promise.all([this.getCards(), this.getXSiteId(), this.getAuthorizationHeader()]);
    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    debug('fetch frames (misgarot) of cards');
    const frames = await (0, _fetch.fetchPost)(FRAMES_REQUEST_ENDPOINT, {
      cardsForFrameData: cards.map(({
        cardUniqueId
      }) => ({
        cardUniqueId
      }))
    }, {
      Authorization,
      'X-Site-Id': xSiteId,
      'Content-Type': 'application/json',
      ...apiHeaders
    });
    const accounts = await Promise.all(cards.map(async card => {
      const finalMonthToFetchMoment = (0, _moment.default)().add(futureMonthsToScrape, 'month');
      const months = finalMonthToFetchMoment.diff(startMoment, 'months');
      const allMonthsData = [];
      const frame = frames.result?.bankIssuedCards?.cardLevelFrames?.find(f => f.cardUniqueId === card.cardUniqueId);
      debug(`fetch pending transactions for card ${card.cardUniqueId}`);
      let pendingData = await (0, _fetch.fetchPost)(PENDING_TRANSACTIONS_REQUEST_ENDPOINT, {
        cardUniqueIDArray: [card.cardUniqueId]
      }, {
        Authorization,
        'X-Site-Id': xSiteId,
        'Content-Type': 'application/json',
        ...apiHeaders
      });
      debug(`fetch completed transactions for card ${card.cardUniqueId}`);
      for (let i = 0; i <= months; i++) {
        const month = finalMonthToFetchMoment.clone().subtract(i, 'months');
        const monthData = await (0, _fetch.fetchPost)(TRANSACTIONS_REQUEST_ENDPOINT, {
          cardUniqueId: card.cardUniqueId,
          month: month.format('M'),
          year: month.format('YYYY')
        }, {
          Authorization,
          'X-Site-Id': xSiteId,
          'Content-Type': 'application/json',
          ...apiHeaders
        });
        if (monthData?.statusCode !== 1) throw new Error(`failed to fetch transactions for card ${card.last4Digits}. Message: ${monthData?.title || ''}`);
        if (!isCardTransactionDetails(monthData)) {
          throw new Error('monthData is not of type CardTransactionDetails');
        }
        allMonthsData.push(monthData);
      }
      if (pendingData?.statusCode !== 1 && pendingData?.statusCode !== 96) {
        debug(`failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData?.title || ''}`);
        pendingData = null;
      } else if (!isCardPendingTransactionDetails(pendingData)) {
        debug('pendingData is not of type CardTransactionDetails');
        pendingData = null;
      }
      const transactions = convertParsedDataToTransactions(allMonthsData, pendingData, this.options);
      debug('filter out old transactions');
      const txns = this.options.outputData?.enableTransactionsFilterByDate ?? true ? (0, _transactions.filterOldTransactions)(transactions, (0, _moment.default)(startDate), this.options.combineInstallments || false) : transactions;
      return {
        txns,
        balance: frame?.nextTotalDebit != null ? -frame.nextTotalDebit : undefined,
        accountNumber: card.last4Digits
      };
    }));
    debug('return the scraped accounts');
    debug(JSON.stringify(accounts, null, 2));
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = VisaCalScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfZGVidWciLCJfZWxlbWVudHNJbnRlcmFjdGlvbnMiLCJfZmV0Y2giLCJfbmF2aWdhdGlvbiIsIl9zdG9yYWdlIiwiX3RyYW5zYWN0aW9ucyIsIl93YWl0aW5nIiwiX3RyYW5zYWN0aW9uczIiLCJfYmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsImFwaUhlYWRlcnMiLCJPcmlnaW4iLCJSZWZlcmVyIiwiTE9HSU5fVVJMIiwiVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQiLCJGUkFNRVNfUkVRVUVTVF9FTkRQT0lOVCIsIlBFTkRJTkdfVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQiLCJTU09fQVVUSE9SSVpBVElPTl9SRVFVRVNUX0VORFBPSU5UIiwiSW52YWxpZFBhc3N3b3JkTWVzc2FnZSIsIkNoYW5nZVBhc3N3b3JkTWVzc2FnZSIsIkNoYW5nZVBhc3N3b3JkU3VidGl0bGUiLCJDaGFuZ2VQYXNzd29yZFVybCIsImRlYnVnIiwiZ2V0RGVidWciLCJUcm5UeXBlQ29kZSIsImlzQXV0aE1vZHVsZSIsInJlc3VsdCIsIkJvb2xlYW4iLCJhdXRoIiwiY2FsQ29ubmVjdFRva2VuIiwiU3RyaW5nIiwidHJpbSIsImF1dGhNb2R1bGVPclVuZGVmaW5lZCIsInVuZGVmaW5lZCIsImlzUGVuZGluZyIsInRyYW5zYWN0aW9uIiwiZGViQ3JkRGF0ZSIsImlzQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyIsImlzQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMiLCJnZXRMb2dpbkZyYW1lIiwicGFnZSIsImZyYW1lIiwid2FpdFVudGlsIiwiZnJhbWVzIiwiZmluZCIsImYiLCJ1cmwiLCJpbmNsdWRlcyIsIlByb21pc2UiLCJyZXNvbHZlIiwiRXJyb3IiLCJoYXNJbnZhbGlkUGFzc3dvcmRFcnJvciIsImVycm9yRm91bmQiLCJlbGVtZW50UHJlc2VudE9uUGFnZSIsImVycm9yTWVzc2FnZSIsInBhZ2VFdmFsIiwiaXRlbSIsImlubmVyVGV4dCIsImhhc0NoYW5nZVBhc3N3b3JkRm9ybSIsImNoYW5nZVBhc3N3b3JkRnJhbWUiLCJzdWJ0aXRsZVRleHQiLCJlcnJUZXh0IiwibWVzc2FnZSIsImdldFBvc3NpYmxlTG9naW5SZXN1bHRzIiwidXJscyIsIkxvZ2luUmVzdWx0cyIsIlN1Y2Nlc3MiLCJJbnZhbGlkUGFzc3dvcmQiLCJvcHRpb25zIiwiQ2hhbmdlUGFzc3dvcmQiLCJjcmVhdGVMb2dpbkZpZWxkcyIsImNyZWRlbnRpYWxzIiwic2VsZWN0b3IiLCJ2YWx1ZSIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJjb252ZXJ0UGFyc2VkRGF0YVRvVHJhbnNhY3Rpb25zIiwiZGF0YSIsInBlbmRpbmdEYXRhIiwicGVuZGluZ1RyYW5zYWN0aW9ucyIsImNhcmRzTGlzdCIsImZsYXRNYXAiLCJjYXJkIiwiYXV0aERldGFsaXNMaXN0IiwiYmFua0FjY291bnRzIiwibW9udGhEYXRhIiwicmVndWxhckRlYml0RGF5cyIsImFjY291bnRzIiwiZGViaXREYXRlcyIsImltbWVkaWF0ZURlYml0RGF5cyIsImltbWlkaWF0ZURlYml0cyIsImRlYml0RGF5cyIsImNvbXBsZXRlZFRyYW5zYWN0aW9ucyIsImRlYml0RGF0ZSIsInRyYW5zYWN0aW9ucyIsImFsbCIsIm1hcCIsIm51bU9mUGF5bWVudHMiLCJudW1iZXJPZlBheW1lbnRzIiwiaW5zdGFsbG1lbnRzIiwibnVtYmVyIiwiY3VyUGF5bWVudE51bSIsInRvdGFsIiwiZGF0ZSIsIm1vbWVudCIsInRyblB1cmNoYXNlRGF0ZSIsImNoYXJnZWRBbW91bnQiLCJ0cm5BbXQiLCJhbXRCZWZvcmVDb252QW5kSW5kZXgiLCJvcmlnaW5hbEFtb3VudCIsInRyblR5cGVDb2RlIiwiY3JlZGl0IiwiaWRlbnRpZmllciIsInRybkludElkIiwidHlwZSIsInJlZ3VsYXIiLCJzdGFuZGluZ09yZGVyIiwiVHJhbnNhY3Rpb25UeXBlcyIsIk5vcm1hbCIsIkluc3RhbGxtZW50cyIsInN0YXR1cyIsIlRyYW5zYWN0aW9uU3RhdHVzZXMiLCJQZW5kaW5nIiwiQ29tcGxldGVkIiwiYWRkIiwidG9JU09TdHJpbmciLCJwcm9jZXNzZWREYXRlIiwiRGF0ZSIsIm9yaWdpbmFsQ3VycmVuY3kiLCJ0cm5DdXJyZW5jeVN5bWJvbCIsImNoYXJnZWRDdXJyZW5jeSIsImRlYkNyZEN1cnJlbmN5U3ltYm9sIiwiZGVzY3JpcHRpb24iLCJtZXJjaGFudE5hbWUiLCJtZW1vIiwidHJhbnNUeXBlQ29tbWVudERldGFpbHMiLCJ0b1N0cmluZyIsImNhdGVnb3J5IiwiYnJhbmNoQ29kZURlc2MiLCJpbmNsdWRlUmF3VHJhbnNhY3Rpb24iLCJyYXdUcmFuc2FjdGlvbiIsImdldFJhd1RyYW5zYWN0aW9uIiwiVmlzYUNhbFNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiYXV0aG9yaXphdGlvbiIsIm9wZW5Mb2dpblBvcHVwIiwid2FpdFVudGlsRWxlbWVudEZvdW5kIiwiY2xpY2tCdXR0b24iLCJnZXRDYXJkcyIsImluaXREYXRhIiwiZ2V0RnJvbVNlc3Npb25TdG9yYWdlIiwiY2FyZHMiLCJjYXJkVW5pcXVlSWQiLCJsYXN0NERpZ2l0cyIsImdldEF1dGhvcml6YXRpb25IZWFkZXIiLCJhdXRoTW9kdWxlIiwiZ2V0WFNpdGVJZCIsImdldExvZ2luT3B0aW9ucyIsImF1dGhSZXF1ZXN0UHJvbWlzZSIsIndhaXRGb3JSZXF1ZXN0IiwidGltZW91dCIsImNhdGNoIiwibG9naW5VcmwiLCJmaWVsZHMiLCJzdWJtaXRCdXR0b25TZWxlY3RvciIsInBvc3NpYmxlUmVzdWx0cyIsImNoZWNrUmVhZGluZXNzIiwicHJlQWN0aW9uIiwicG9zdEFjdGlvbiIsIndhaXRGb3JOYXZpZ2F0aW9uIiwiY3VycmVudFVybCIsImdldEN1cnJlbnRVcmwiLCJlbmRzV2l0aCIsInJlcXVlc3QiLCJoZWFkZXJzIiwicmVxdWlyZXNDaGFuZ2VQYXNzd29yZCIsInVzZXJBZ2VudCIsImZldGNoRGF0YSIsImRlZmF1bHRTdGFydE1vbWVudCIsInN1YnRyYWN0Iiwic3RhcnREYXRlIiwidG9EYXRlIiwic3RhcnRNb21lbnQiLCJtYXgiLCJmb3JtYXQiLCJ4U2l0ZUlkIiwiQXV0aG9yaXphdGlvbiIsImZ1dHVyZU1vbnRoc1RvU2NyYXBlIiwiZmV0Y2hQb3N0IiwiY2FyZHNGb3JGcmFtZURhdGEiLCJmaW5hbE1vbnRoVG9GZXRjaE1vbWVudCIsIm1vbnRocyIsImRpZmYiLCJhbGxNb250aHNEYXRhIiwiYmFua0lzc3VlZENhcmRzIiwiY2FyZExldmVsRnJhbWVzIiwiY2FyZFVuaXF1ZUlEQXJyYXkiLCJpIiwibW9udGgiLCJjbG9uZSIsInllYXIiLCJzdGF0dXNDb2RlIiwidGl0bGUiLCJwdXNoIiwidHhucyIsIm91dHB1dERhdGEiLCJlbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUiLCJmaWx0ZXJPbGRUcmFuc2FjdGlvbnMiLCJjb21iaW5lSW5zdGFsbG1lbnRzIiwiYmFsYW5jZSIsIm5leHRUb3RhbERlYml0IiwiYWNjb3VudE51bWJlciIsIkpTT04iLCJzdHJpbmdpZnkiLCJzdWNjZXNzIiwiX2RlZmF1bHQiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL3NjcmFwZXJzL3Zpc2EtY2FsLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcbmltcG9ydCB7IHR5cGUgSFRUUFJlcXVlc3QsIHR5cGUgRnJhbWUsIHR5cGUgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBnZXREZWJ1ZyB9IGZyb20gJy4uL2hlbHBlcnMvZGVidWcnO1xuaW1wb3J0IHsgY2xpY2tCdXR0b24sIGVsZW1lbnRQcmVzZW50T25QYWdlLCBwYWdlRXZhbCwgd2FpdFVudGlsRWxlbWVudEZvdW5kIH0gZnJvbSAnLi4vaGVscGVycy9lbGVtZW50cy1pbnRlcmFjdGlvbnMnO1xuaW1wb3J0IHsgZmV0Y2hQb3N0IH0gZnJvbSAnLi4vaGVscGVycy9mZXRjaCc7XG5pbXBvcnQgeyBnZXRDdXJyZW50VXJsLCB3YWl0Rm9yTmF2aWdhdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvbmF2aWdhdGlvbic7XG5pbXBvcnQgeyBnZXRGcm9tU2Vzc2lvblN0b3JhZ2UgfSBmcm9tICcuLi9oZWxwZXJzL3N0b3JhZ2UnO1xuaW1wb3J0IHsgZmlsdGVyT2xkVHJhbnNhY3Rpb25zLCBnZXRSYXdUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IHdhaXRVbnRpbCB9IGZyb20gJy4uL2hlbHBlcnMvd2FpdGluZyc7XG5pbXBvcnQgeyBUcmFuc2FjdGlvblN0YXR1c2VzLCBUcmFuc2FjdGlvblR5cGVzLCB0eXBlIFRyYW5zYWN0aW9uLCB0eXBlIFRyYW5zYWN0aW9uc0FjY291bnQgfSBmcm9tICcuLi90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgQmFzZVNjcmFwZXJXaXRoQnJvd3NlciwgTG9naW5SZXN1bHRzLCB0eXBlIExvZ2luT3B0aW9ucyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJTY3JhcGluZ1Jlc3VsdCwgdHlwZSBTY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vaW50ZXJmYWNlJztcblxuY29uc3QgYXBpSGVhZGVycyA9IHtcbiAgJ1VzZXItQWdlbnQnOlxuICAgICdNb3ppbGxhLzUuMCAoTWFjaW50b3NoOyBJbnRlbCBNYWMgT1MgWCAxMF8xNV83KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTQyLjAuMC4wIFNhZmFyaS81MzcuMzYnLFxuICBPcmlnaW46ICdodHRwczovL2RpZ2l0YWwtd2ViLmNhbC1vbmxpbmUuY28uaWwnLFxuICBSZWZlcmVyOiAnaHR0cHM6Ly9kaWdpdGFsLXdlYi5jYWwtb25saW5lLmNvLmlsJyxcbiAgJ0FjY2VwdC1MYW5ndWFnZSc6ICdoZS1JTCxoZTtxPTAuOSxlbi1VUztxPTAuOCxlbjtxPTAuNycsXG4gICdTZWMtRmV0Y2gtU2l0ZSc6ICdzYW1lLXNpdGUnLFxuICAnU2VjLUZldGNoLU1vZGUnOiAnY29ycycsXG4gICdTZWMtRmV0Y2gtRGVzdCc6ICdlbXB0eScsXG59O1xuY29uc3QgTE9HSU5fVVJMID0gJ2h0dHBzOi8vd3d3LmNhbC1vbmxpbmUuY28uaWwvJztcbmNvbnN0IFRSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5UID1cbiAgJ2h0dHBzOi8vYXBpLmNhbC1vbmxpbmUuY28uaWwvVHJhbnNhY3Rpb25zL2FwaS90cmFuc2FjdGlvbnNEZXRhaWxzL2dldENhcmRUcmFuc2FjdGlvbnNEZXRhaWxzJztcbmNvbnN0IEZSQU1FU19SRVFVRVNUX0VORFBPSU5UID0gJ2h0dHBzOi8vYXBpLmNhbC1vbmxpbmUuY28uaWwvRnJhbWVzL2FwaS9GcmFtZXMvR2V0RnJhbWVTdGF0dXMnO1xuY29uc3QgUEVORElOR19UUkFOU0FDVElPTlNfUkVRVUVTVF9FTkRQT0lOVCA9XG4gICdodHRwczovL2FwaS5jYWwtb25saW5lLmNvLmlsL1RyYW5zYWN0aW9ucy9hcGkvYXBwcm92YWxzL2dldENsZWFyYW5jZVJlcXVlc3RzJztcbmNvbnN0IFNTT19BVVRIT1JJWkFUSU9OX1JFUVVFU1RfRU5EUE9JTlQgPSAnaHR0cHM6Ly9jb25uZWN0LmNhbC1vbmxpbmUuY28uaWwvY29sLXJlc3QvY2FsY29ubmVjdC9hdXRoZW50aWNhdGlvbi9TU08nO1xuXG5jb25zdCBJbnZhbGlkUGFzc3dvcmRNZXNzYWdlID0gJ9ep150g15TXntep16rXntepINeQ15Ug15TXodeZ16HXnteUINep15TXldeW16DXlSDXqdeS15XXmdeZ150nO1xuY29uc3QgQ2hhbmdlUGFzc3dvcmRNZXNzYWdlID0gJ9ec15TXl9ec15nXoyDXodeZ16HXnteUJztcbmNvbnN0IENoYW5nZVBhc3N3b3JkU3VidGl0bGUgPSAn15TXkteZ16Ig15TXltee158g15zXodeZ16HXnteUINeX15PXqdeUJztcbmNvbnN0IENoYW5nZVBhc3N3b3JkVXJsID0gJy9jaGFuZ2UtcGFzc3dvcmQnO1xuXG5jb25zdCBkZWJ1ZyA9IGdldERlYnVnKCd2aXNhLWNhbCcpO1xuXG5lbnVtIFRyblR5cGVDb2RlIHtcbiAgcmVndWxhciA9ICc1JyxcbiAgY3JlZGl0ID0gJzYnLFxuICBpbnN0YWxsbWVudHMgPSAnOCcsXG4gIHN0YW5kaW5nT3JkZXIgPSAnOScsXG59XG5cbmludGVyZmFjZSBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICBhbXRCZWZvcmVDb252QW5kSW5kZXg6IG51bWJlcjtcbiAgYnJhbmNoQ29kZURlc2M6IHN0cmluZztcbiAgY2FzaEFjY01hbmFnZXJOYW1lOiBudWxsO1xuICBjYXNoQWNjb3VudE1hbmFnZXI6IG51bGw7XG4gIGNhc2hBY2NvdW50VHJuQW10OiBudW1iZXI7XG4gIGNoYXJnZUV4dGVybmFsVG9DYXJkQ29tbWVudDogc3RyaW5nO1xuICBjb21tZW50czogW107XG4gIGN1clBheW1lbnROdW06IG51bWJlcjtcbiAgZGViQ3JkQ3VycmVuY3lTeW1ib2w6IEN1cnJlbmN5U3ltYm9sO1xuICBkZWJDcmREYXRlOiBzdHJpbmc7XG4gIGRlYml0U3ByZWFkSW5kOiBib29sZWFuO1xuICBkaXNjb3VudEFtb3VudDogdW5rbm93bjtcbiAgZGlzY291bnRSZWFzb246IHVua25vd247XG4gIGltbWVkaWF0ZUNvbW1lbnRzOiBbXTtcbiAgaXNJbW1lZGlhdGVDb21tZW50SW5kOiBib29sZWFuO1xuICBpc0ltbWVkaWF0ZUhIS0luZDogYm9vbGVhbjtcbiAgaXNNYXJnYXJpdGE6IGJvb2xlYW47XG4gIGlzU3ByZWFkUGF5bWVuc3RBYnJvYWQ6IGJvb2xlYW47XG4gIGxpbmtlZENvbW1lbnRzOiBbXTtcbiAgbWVyY2hhbnRBZGRyZXNzOiBzdHJpbmc7XG4gIG1lcmNoYW50TmFtZTogc3RyaW5nO1xuICBtZXJjaGFudFBob25lTm86IHN0cmluZztcbiAgbnVtT2ZQYXltZW50czogbnVtYmVyO1xuICBvbkdvaW5nVHJhbnNhY3Rpb25zQ29tbWVudDogc3RyaW5nO1xuICByZWZ1bmRJbmQ6IGJvb2xlYW47XG4gIHJvdW5kaW5nQW1vdW50OiB1bmtub3duO1xuICByb3VuZGluZ1JlYXNvbjogdW5rbm93bjtcbiAgdG9rZW5JbmQ6IDA7XG4gIHRva2VuTnVtYmVyUGFydDQ6ICcnO1xuICB0cmFuc0NhcmRQcmVzZW50SW5kOiBib29sZWFuO1xuICB0cmFuc1R5cGVDb21tZW50RGV0YWlsczogW107XG4gIHRybkFtdDogbnVtYmVyO1xuICB0cm5DdXJyZW5jeVN5bWJvbDogQ3VycmVuY3lTeW1ib2w7XG4gIHRybkV4YWNXYXk6IG51bWJlcjtcbiAgdHJuSW50SWQ6IHN0cmluZztcbiAgdHJuTnVtYXJldG9yOiBudW1iZXI7XG4gIHRyblB1cmNoYXNlRGF0ZTogc3RyaW5nO1xuICB0cm5UeXBlOiBzdHJpbmc7XG4gIHRyblR5cGVDb2RlOiBUcm5UeXBlQ29kZTtcbiAgd2FsbGV0UHJvdmlkZXJDb2RlOiAwO1xuICB3YWxsZXRQcm92aWRlckRlc2M6ICcnO1xuICBlYXJseVBheW1lbnRJbmQ6IGJvb2xlYW47XG59XG5pbnRlcmZhY2UgU2NyYXBlZFBlbmRpbmdUcmFuc2FjdGlvbiB7XG4gIG1lcmNoYW50SUQ6IHN0cmluZztcbiAgbWVyY2hhbnROYW1lOiBzdHJpbmc7XG4gIHRyblB1cmNoYXNlRGF0ZTogc3RyaW5nO1xuICB3YWxsZXRUcmFuSW5kOiBudW1iZXI7XG4gIHRyYW5zYWN0aW9uc09yaWdpbjogbnVtYmVyO1xuICB0cm5BbXQ6IG51bWJlcjtcbiAgdHBhQXBwcm92YWxBbW91bnQ6IHVua25vd247XG4gIHRybkN1cnJlbmN5U3ltYm9sOiBDdXJyZW5jeVN5bWJvbDtcbiAgdHJuVHlwZUNvZGU6IFRyblR5cGVDb2RlO1xuICB0cm5UeXBlOiBzdHJpbmc7XG4gIGJyYW5jaENvZGVEZXNjOiBzdHJpbmc7XG4gIHRyYW5zQ2FyZFByZXNlbnRJbmQ6IGJvb2xlYW47XG4gIGo1SW5kaWNhdG9yOiBzdHJpbmc7XG4gIG51bWJlck9mUGF5bWVudHM6IG51bWJlcjtcbiAgZmlyc3RQYXltZW50QW1vdW50OiBudW1iZXI7XG4gIHRyYW5zVHlwZUNvbW1lbnREZXRhaWxzOiBbXTtcbn1cbmludGVyZmFjZSBJbml0UmVzcG9uc2Uge1xuICByZXN1bHQ6IHtcbiAgICBjYXJkczoge1xuICAgICAgY2FyZFVuaXF1ZUlkOiBzdHJpbmc7XG4gICAgICBsYXN0NERpZ2l0czogc3RyaW5nO1xuICAgICAgW2tleTogc3RyaW5nXTogdW5rbm93bjtcbiAgICB9W107XG4gIH07XG59XG50eXBlIEN1cnJlbmN5U3ltYm9sID0gc3RyaW5nO1xuaW50ZXJmYWNlIENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvciB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcbn1cbmludGVyZmFjZSBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzIGV4dGVuZHMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yIHtcbiAgcmVzdWx0OiB7XG4gICAgYmFua0FjY291bnRzOiB7XG4gICAgICBiYW5rQWNjb3VudE51bTogc3RyaW5nO1xuICAgICAgYmFua05hbWU6IHN0cmluZztcbiAgICAgIGNob2ljZUV4dGVybmFsVHJhbnNhY3Rpb25zOiBhbnk7XG4gICAgICBjdXJyZW50QmFua0FjY291bnRJbmQ6IGJvb2xlYW47XG4gICAgICBkZWJpdERhdGVzOiB7XG4gICAgICAgIGJhc2tldEFtb3VudENvbW1lbnQ6IHVua25vd247XG4gICAgICAgIGNob2ljZUhIS0RlYml0OiBudW1iZXI7XG4gICAgICAgIGRhdGU6IHN0cmluZztcbiAgICAgICAgZGViaXRSZWFzb246IHVua25vd247XG4gICAgICAgIGZpeERlYml0QW1vdW50OiBudW1iZXI7XG4gICAgICAgIGZyb21QdXJjaGFzZURhdGU6IHN0cmluZztcbiAgICAgICAgaXNDaG9pY2VSZXBhaW1lbnQ6IGJvb2xlYW47XG4gICAgICAgIHRvUHVyY2hhc2VEYXRlOiBzdHJpbmc7XG4gICAgICAgIHRvdGFsQmFza2V0QW1vdW50OiBudW1iZXI7XG4gICAgICAgIHRvdGFsRGViaXRzOiB7XG4gICAgICAgICAgY3VycmVuY3lTeW1ib2w6IEN1cnJlbmN5U3ltYm9sO1xuICAgICAgICAgIGFtb3VudDogbnVtYmVyO1xuICAgICAgICB9W107XG4gICAgICAgIHRyYW5zYWN0aW9uczogU2NyYXBlZFRyYW5zYWN0aW9uW107XG4gICAgICB9W107XG4gICAgICBpbW1pZGlhdGVEZWJpdHM6IHsgdG90YWxEZWJpdHM6IFtdOyBkZWJpdERheXM6IFtdIH07XG4gICAgfVtdO1xuICAgIGJsb2NrZWRDYXJkSW5kOiBib29sZWFuO1xuICB9O1xuICBzdGF0dXNDb2RlOiAxO1xuICBzdGF0dXNEZXNjcmlwdGlvbjogc3RyaW5nO1xuICBzdGF0dXNUaXRsZTogc3RyaW5nO1xufVxuaW50ZXJmYWNlIENhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzIGV4dGVuZHMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yIHtcbiAgcmVzdWx0OiB7XG4gICAgY2FyZHNMaXN0OiB7XG4gICAgICBjYXJkVW5pcXVlSUQ6IHN0cmluZztcbiAgICAgIGF1dGhEZXRhbGlzTGlzdDogU2NyYXBlZFBlbmRpbmdUcmFuc2FjdGlvbltdO1xuICAgIH1bXTtcbiAgfTtcbiAgc3RhdHVzQ29kZTogMTtcbiAgc3RhdHVzRGVzY3JpcHRpb246IHN0cmluZztcbiAgc3RhdHVzVGl0bGU6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIENhcmRMZXZlbEZyYW1lIHtcbiAgY2FyZFVuaXF1ZUlkOiBzdHJpbmc7XG4gIG5leHRUb3RhbERlYml0PzogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgRnJhbWVzUmVzcG9uc2Uge1xuICByZXN1bHQ/OiB7XG4gICAgYmFua0lzc3VlZENhcmRzPzoge1xuICAgICAgY2FyZExldmVsRnJhbWVzPzogQ2FyZExldmVsRnJhbWVbXTtcbiAgICB9O1xuICB9O1xufVxuXG5pbnRlcmZhY2UgQXV0aE1vZHVsZSB7XG4gIGF1dGg6IHtcbiAgICBjYWxDb25uZWN0VG9rZW46IHN0cmluZyB8IG51bGw7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGlzQXV0aE1vZHVsZShyZXN1bHQ6IGFueSk6IHJlc3VsdCBpcyBBdXRoTW9kdWxlIHtcbiAgcmV0dXJuIEJvb2xlYW4ocmVzdWx0Py5hdXRoPy5jYWxDb25uZWN0VG9rZW4gJiYgU3RyaW5nKHJlc3VsdC5hdXRoLmNhbENvbm5lY3RUb2tlbikudHJpbSgpKTtcbn1cblxuZnVuY3Rpb24gYXV0aE1vZHVsZU9yVW5kZWZpbmVkKHJlc3VsdDogYW55KTogQXV0aE1vZHVsZSB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBpc0F1dGhNb2R1bGUocmVzdWx0KSA/IHJlc3VsdCA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gaXNQZW5kaW5nKFxuICB0cmFuc2FjdGlvbjogU2NyYXBlZFRyYW5zYWN0aW9uIHwgU2NyYXBlZFBlbmRpbmdUcmFuc2FjdGlvbixcbik6IHRyYW5zYWN0aW9uIGlzIFNjcmFwZWRQZW5kaW5nVHJhbnNhY3Rpb24ge1xuICByZXR1cm4gKHRyYW5zYWN0aW9uIGFzIFNjcmFwZWRUcmFuc2FjdGlvbikuZGViQ3JkRGF0ZSA9PT0gdW5kZWZpbmVkOyAvLyBhbiBhcmJpdHJhcnkgZmllbGQgdGhhdCBvbmx5IGFwcGVhcnMgaW4gYSBjb21wbGV0ZWQgdHJhbnNhY3Rpb25cbn1cblxuZnVuY3Rpb24gaXNDYXJkVHJhbnNhY3Rpb25EZXRhaWxzKFxuICByZXN1bHQ6IENhcmRUcmFuc2FjdGlvbkRldGFpbHMgfCBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzRXJyb3IsXG4pOiByZXN1bHQgaXMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyB7XG4gIHJldHVybiAocmVzdWx0IGFzIENhcmRUcmFuc2FjdGlvbkRldGFpbHMpLnJlc3VsdCAhPT0gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0NhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzKFxuICByZXN1bHQ6IENhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzIHwgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yLFxuKTogcmVzdWx0IGlzIENhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzIHtcbiAgcmV0dXJuIChyZXN1bHQgYXMgQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMpLnJlc3VsdCAhPT0gdW5kZWZpbmVkO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRMb2dpbkZyYW1lKHBhZ2U6IFBhZ2UpIHtcbiAgbGV0IGZyYW1lOiBGcmFtZSB8IG51bGwgPSBudWxsO1xuICBkZWJ1Zygnd2FpdCB1bnRpbCBsb2dpbiBmcmFtZSBmb3VuZCcpO1xuICBhd2FpdCB3YWl0VW50aWwoXG4gICAgKCkgPT4ge1xuICAgICAgZnJhbWUgPSBwYWdlLmZyYW1lcygpLmZpbmQoZiA9PiBmLnVybCgpLmluY2x1ZGVzKCdjb25uZWN0JykpIHx8IG51bGw7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCEhZnJhbWUpO1xuICAgIH0sXG4gICAgJ3dhaXQgZm9yIGlmcmFtZSB3aXRoIGxvZ2luIGZvcm0nLFxuICAgIDEwMDAwLFxuICAgIDEwMDAsXG4gICk7XG5cbiAgaWYgKCFmcmFtZSkge1xuICAgIGRlYnVnKCdmYWlsZWQgdG8gZmluZCBsb2dpbiBmcmFtZSBmb3IgMTAgc2Vjb25kcycpO1xuICAgIHRocm93IG5ldyBFcnJvcignZmFpbGVkIHRvIGV4dHJhY3QgbG9naW4gaWZyYW1lJyk7XG4gIH1cblxuICByZXR1cm4gZnJhbWU7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhc0ludmFsaWRQYXNzd29yZEVycm9yKHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRMb2dpbkZyYW1lKHBhZ2UpO1xuICBjb25zdCBlcnJvckZvdW5kID0gYXdhaXQgZWxlbWVudFByZXNlbnRPblBhZ2UoZnJhbWUsICdkaXYuZ2VuZXJhbC1lcnJvciA+IGRpdicpO1xuICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvckZvdW5kXG4gICAgPyBhd2FpdCBwYWdlRXZhbChmcmFtZSwgJ2Rpdi5nZW5lcmFsLWVycm9yID4gZGl2JywgJycsIGl0ZW0gPT4ge1xuICAgICAgICByZXR1cm4gKGl0ZW0gYXMgSFRNTERpdkVsZW1lbnQpLmlubmVyVGV4dDtcbiAgICAgIH0pXG4gICAgOiAnJztcbiAgcmV0dXJuIGVycm9yTWVzc2FnZSA9PT0gSW52YWxpZFBhc3N3b3JkTWVzc2FnZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFzQ2hhbmdlUGFzc3dvcmRGb3JtKHBhZ2U6IFBhZ2UpIHtcbiAgLy8gQ2hlY2sgaWYgYW55IGZyYW1lIG5hdmlnYXRlZCB0byB0aGUgY2hhbmdlLXBhc3N3b3JkIHJvdXRlXG4gIGNvbnN0IGNoYW5nZVBhc3N3b3JkRnJhbWUgPSBwYWdlLmZyYW1lcygpLmZpbmQoZiA9PiB7XG4gICAgY29uc3QgdXJsID0gZi51cmwoKTtcbiAgICByZXR1cm4gdXJsLmluY2x1ZGVzKCdjb25uZWN0LmNhbC1vbmxpbmUuY28uaWwnKSAmJiB1cmwuaW5jbHVkZXMoQ2hhbmdlUGFzc3dvcmRVcmwpO1xuICB9KTtcbiAgaWYgKGNoYW5nZVBhc3N3b3JkRnJhbWUpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRMb2dpbkZyYW1lKHBhZ2UpO1xuXG4gICAgLy8gQ2hlY2sgZm9yIHRoZSBjaGFuZ2UtcGFzc3dvcmQgQW5ndWxhciBjb21wb25lbnRcbiAgICBpZiAoYXdhaXQgZWxlbWVudFByZXNlbnRPblBhZ2UoZnJhbWUsICdjaGFuZ2UtcGFzc3dvcmQnKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgZm9yIHRoZSBjaGFuZ2UgcGFzc3dvcmQgdGl0bGUgZWxlbWVudFxuICAgIGlmIChhd2FpdCBlbGVtZW50UHJlc2VudE9uUGFnZShmcmFtZSwgJy5jaGFuZ2UtcGFzc3dvcmQtdGl0bGUnKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgZm9yIHRoZSBjaGFuZ2UgcGFzc3dvcmQgc3VidGl0bGUgdGV4dFxuICAgIGlmIChhd2FpdCBlbGVtZW50UHJlc2VudE9uUGFnZShmcmFtZSwgJy5jaGFuZ2UtcGFzc3dvcmQtc3VidGl0bGUnKSkge1xuICAgICAgY29uc3Qgc3VidGl0bGVUZXh0ID0gYXdhaXQgcGFnZUV2YWwoZnJhbWUsICcuY2hhbmdlLXBhc3N3b3JkLXN1YnRpdGxlJywgJycsIGl0ZW0gPT4ge1xuICAgICAgICByZXR1cm4gKGl0ZW0gYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dC50cmltKCk7XG4gICAgICB9KTtcbiAgICAgIGlmIChzdWJ0aXRsZVRleHQuaW5jbHVkZXMoQ2hhbmdlUGFzc3dvcmRTdWJ0aXRsZSkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTGVnYWN5OiBjaGVjayBmb3IgdGhlIG9sZCAuZXJyLWRlc2MgYmFzZWQgY2hhbmdlIHBhc3N3b3JkIG1lc3NhZ2VcbiAgICBjb25zdCBlcnJvckZvdW5kID0gYXdhaXQgZWxlbWVudFByZXNlbnRPblBhZ2UoZnJhbWUsICcuZXJyLWRlc2MnKTtcbiAgICBpZiAoZXJyb3JGb3VuZCkge1xuICAgICAgY29uc3QgZXJyVGV4dCA9IGF3YWl0IHBhZ2VFdmFsKGZyYW1lLCAnLmVyci1kZXNjJywgJycsIGl0ZW0gPT4ge1xuICAgICAgICByZXR1cm4gKGl0ZW0gYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dC50cmltKCk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybiBlcnJUZXh0LmluY2x1ZGVzKENoYW5nZVBhc3N3b3JkTWVzc2FnZSk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgZGVidWcoJ2ZhaWxlZCB0byBjaGVjayBjaGFuZ2UgcGFzc3dvcmQgZm9ybSBpbiBsb2dpbiBmcmFtZTogJXMnLCAoZSBhcyBFcnJvcikubWVzc2FnZSk7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpIHtcbiAgZGVidWcoJ3JldHVybiBwb3NzaWJsZSBsb2dpbiByZXN1bHRzJyk7XG4gIGNvbnN0IHVybHM6IExvZ2luT3B0aW9uc1sncG9zc2libGVSZXN1bHRzJ10gPSB7XG4gICAgW0xvZ2luUmVzdWx0cy5TdWNjZXNzXTogWy9kYXNoYm9hcmQvaV0sXG4gICAgW0xvZ2luUmVzdWx0cy5JbnZhbGlkUGFzc3dvcmRdOiBbXG4gICAgICBhc3luYyAob3B0aW9ucz86IHsgcGFnZT86IFBhZ2UgfSkgPT4ge1xuICAgICAgICBjb25zdCBwYWdlID0gb3B0aW9ucz8ucGFnZTtcbiAgICAgICAgaWYgKCFwYWdlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBoYXNJbnZhbGlkUGFzc3dvcmRFcnJvcihwYWdlKTtcbiAgICAgIH0sXG4gICAgXSxcbiAgICAvLyBbTG9naW5SZXN1bHRzLkFjY291bnRCbG9ja2VkXTogW10sIC8vIFRPRE8gYWRkIHdoZW4gcmVhY2hpbmcgdGhpcyBzY2VuYXJpb1xuICAgIFtMb2dpblJlc3VsdHMuQ2hhbmdlUGFzc3dvcmRdOiBbXG4gICAgICBhc3luYyAob3B0aW9ucz86IHsgcGFnZT86IFBhZ2UgfSkgPT4ge1xuICAgICAgICBjb25zdCBwYWdlID0gb3B0aW9ucz8ucGFnZTtcbiAgICAgICAgaWYgKCFwYWdlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBoYXNDaGFuZ2VQYXNzd29yZEZvcm0ocGFnZSk7XG4gICAgICB9LFxuICAgIF0sXG4gIH07XG4gIHJldHVybiB1cmxzO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcbiAgZGVidWcoJ2NyZWF0ZSBsb2dpbiBmaWVsZHMgZm9yIHVzZXJuYW1lIGFuZCBwYXNzd29yZCcpO1xuICByZXR1cm4gW1xuICAgIHsgc2VsZWN0b3I6ICdbZm9ybWNvbnRyb2xuYW1lPVwidXNlck5hbWVcIl0nLCB2YWx1ZTogY3JlZGVudGlhbHMudXNlcm5hbWUgfSxcbiAgICB7IHNlbGVjdG9yOiAnW2Zvcm1jb250cm9sbmFtZT1cInBhc3N3b3JkXCJdJywgdmFsdWU6IGNyZWRlbnRpYWxzLnBhc3N3b3JkIH0sXG4gIF07XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRQYXJzZWREYXRhVG9UcmFuc2FjdGlvbnMoXG4gIGRhdGE6IENhcmRUcmFuc2FjdGlvbkRldGFpbHNbXSxcbiAgcGVuZGluZ0RhdGE/OiBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyB8IG51bGwsXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbik6IFRyYW5zYWN0aW9uW10ge1xuICBjb25zdCBwZW5kaW5nVHJhbnNhY3Rpb25zID0gcGVuZGluZ0RhdGE/LnJlc3VsdFxuICAgID8gcGVuZGluZ0RhdGEucmVzdWx0LmNhcmRzTGlzdC5mbGF0TWFwKGNhcmQgPT4gY2FyZC5hdXRoRGV0YWxpc0xpc3QpXG4gICAgOiBbXTtcblxuICBjb25zdCBiYW5rQWNjb3VudHMgPSBkYXRhLmZsYXRNYXAobW9udGhEYXRhID0+IG1vbnRoRGF0YS5yZXN1bHQuYmFua0FjY291bnRzKTtcbiAgY29uc3QgcmVndWxhckRlYml0RGF5cyA9IGJhbmtBY2NvdW50cy5mbGF0TWFwKGFjY291bnRzID0+IGFjY291bnRzLmRlYml0RGF0ZXMpO1xuICBjb25zdCBpbW1lZGlhdGVEZWJpdERheXMgPSBiYW5rQWNjb3VudHMuZmxhdE1hcChhY2NvdW50cyA9PiBhY2NvdW50cy5pbW1pZGlhdGVEZWJpdHMuZGViaXREYXlzKTtcbiAgY29uc3QgY29tcGxldGVkVHJhbnNhY3Rpb25zID0gWy4uLnJlZ3VsYXJEZWJpdERheXMsIC4uLmltbWVkaWF0ZURlYml0RGF5c10uZmxhdE1hcChcbiAgICBkZWJpdERhdGUgPT4gZGViaXREYXRlLnRyYW5zYWN0aW9ucyxcbiAgKTtcblxuICBjb25zdCBhbGw6IChTY3JhcGVkVHJhbnNhY3Rpb24gfCBTY3JhcGVkUGVuZGluZ1RyYW5zYWN0aW9uKVtdID0gWy4uLnBlbmRpbmdUcmFuc2FjdGlvbnMsIC4uLmNvbXBsZXRlZFRyYW5zYWN0aW9uc107XG5cbiAgcmV0dXJuIGFsbC5tYXAodHJhbnNhY3Rpb24gPT4ge1xuICAgIGNvbnN0IG51bU9mUGF5bWVudHMgPSBpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gdHJhbnNhY3Rpb24ubnVtYmVyT2ZQYXltZW50cyA6IHRyYW5zYWN0aW9uLm51bU9mUGF5bWVudHM7XG4gICAgY29uc3QgaW5zdGFsbG1lbnRzID0gbnVtT2ZQYXltZW50c1xuICAgICAgPyB7XG4gICAgICAgICAgbnVtYmVyOiBpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gMSA6IHRyYW5zYWN0aW9uLmN1clBheW1lbnROdW0sXG4gICAgICAgICAgdG90YWw6IG51bU9mUGF5bWVudHMsXG4gICAgICAgIH1cbiAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgY29uc3QgZGF0ZSA9IG1vbWVudCh0cmFuc2FjdGlvbi50cm5QdXJjaGFzZURhdGUpO1xuXG4gICAgY29uc3QgY2hhcmdlZEFtb3VudCA9IChpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gdHJhbnNhY3Rpb24udHJuQW10IDogdHJhbnNhY3Rpb24uYW10QmVmb3JlQ29udkFuZEluZGV4KSAqIC0xO1xuICAgIGNvbnN0IG9yaWdpbmFsQW1vdW50ID0gdHJhbnNhY3Rpb24udHJuQW10ICogKHRyYW5zYWN0aW9uLnRyblR5cGVDb2RlID09PSBUcm5UeXBlQ29kZS5jcmVkaXQgPyAxIDogLTEpO1xuXG4gICAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbiA9IHtcbiAgICAgIGlkZW50aWZpZXI6ICFpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gdHJhbnNhY3Rpb24udHJuSW50SWQgOiB1bmRlZmluZWQsXG4gICAgICB0eXBlOiBbVHJuVHlwZUNvZGUucmVndWxhciwgVHJuVHlwZUNvZGUuc3RhbmRpbmdPcmRlcl0uaW5jbHVkZXModHJhbnNhY3Rpb24udHJuVHlwZUNvZGUpXG4gICAgICAgID8gVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWxcbiAgICAgICAgOiBUcmFuc2FjdGlvblR5cGVzLkluc3RhbGxtZW50cyxcbiAgICAgIHN0YXR1czogaXNQZW5kaW5nKHRyYW5zYWN0aW9uKSA/IFRyYW5zYWN0aW9uU3RhdHVzZXMuUGVuZGluZyA6IFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxuICAgICAgZGF0ZTogaW5zdGFsbG1lbnRzID8gZGF0ZS5hZGQoaW5zdGFsbG1lbnRzLm51bWJlciAtIDEsICdtb250aCcpLnRvSVNPU3RyaW5nKCkgOiBkYXRlLnRvSVNPU3RyaW5nKCksXG4gICAgICBwcm9jZXNzZWREYXRlOiBpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gZGF0ZS50b0lTT1N0cmluZygpIDogbmV3IERhdGUodHJhbnNhY3Rpb24uZGViQ3JkRGF0ZSkudG9JU09TdHJpbmcoKSxcbiAgICAgIG9yaWdpbmFsQW1vdW50LFxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogdHJhbnNhY3Rpb24udHJuQ3VycmVuY3lTeW1ib2wsXG4gICAgICBjaGFyZ2VkQW1vdW50LFxuICAgICAgY2hhcmdlZEN1cnJlbmN5OiAhaXNQZW5kaW5nKHRyYW5zYWN0aW9uKSA/IHRyYW5zYWN0aW9uLmRlYkNyZEN1cnJlbmN5U3ltYm9sIDogdW5kZWZpbmVkLFxuICAgICAgZGVzY3JpcHRpb246IHRyYW5zYWN0aW9uLm1lcmNoYW50TmFtZSxcbiAgICAgIG1lbW86IHRyYW5zYWN0aW9uLnRyYW5zVHlwZUNvbW1lbnREZXRhaWxzLnRvU3RyaW5nKCksXG4gICAgICBjYXRlZ29yeTogdHJhbnNhY3Rpb24uYnJhbmNoQ29kZURlc2MsXG4gICAgfTtcblxuICAgIGlmIChpbnN0YWxsbWVudHMpIHtcbiAgICAgIHJlc3VsdC5pbnN0YWxsbWVudHMgPSBpbnN0YWxsbWVudHM7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnM/LmluY2x1ZGVSYXdUcmFuc2FjdGlvbikge1xuICAgICAgcmVzdWx0LnJhd1RyYW5zYWN0aW9uID0gZ2V0UmF3VHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0pO1xufVxuXG50eXBlIFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzID0geyB1c2VybmFtZTogc3RyaW5nOyBwYXNzd29yZDogc3RyaW5nIH07XG5cbmNsYXNzIFZpc2FDYWxTY3JhcGVyIGV4dGVuZHMgQmFzZVNjcmFwZXJXaXRoQnJvd3NlcjxTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscz4ge1xuICBwcml2YXRlIGF1dGhvcml6YXRpb246IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcblxuICBwcml2YXRlIGF1dGhSZXF1ZXN0UHJvbWlzZTogUHJvbWlzZTxIVFRQUmVxdWVzdCB8IHVuZGVmaW5lZD4gfCB1bmRlZmluZWQ7XG5cbiAgb3BlbkxvZ2luUG9wdXAgPSBhc3luYyAoKSA9PiB7XG4gICAgZGVidWcoJ29wZW4gbG9naW4gcG9wdXAsIHdhaXQgdW50aWwgbG9naW4gYnV0dG9uIGF2YWlsYWJsZScpO1xuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZCh0aGlzLnBhZ2UsICcjY2NMb2dpbkRlc2t0b3BCdG4nLCB0cnVlKTtcbiAgICBkZWJ1ZygnY2xpY2sgb24gdGhlIGxvZ2luIGJ1dHRvbicpO1xuICAgIGF3YWl0IGNsaWNrQnV0dG9uKHRoaXMucGFnZSwgJyNjY0xvZ2luRGVza3RvcEJ0bicpO1xuICAgIGRlYnVnKCdnZXQgdGhlIGZyYW1lIHRoYXQgaG9sZHMgdGhlIGxvZ2luJyk7XG4gICAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRMb2dpbkZyYW1lKHRoaXMucGFnZSk7XG4gICAgZGVidWcoJ3dhaXQgdW50aWwgdGhlIHBhc3N3b3JkIGxvZ2luIHRhYiBoZWFkZXIgaXMgYXZhaWxhYmxlJyk7XG4gICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKGZyYW1lLCAnI3JlZ3VsYXItbG9naW4nKTtcbiAgICBkZWJ1ZygnbmF2aWdhdGUgdG8gdGhlIHBhc3N3b3JkIGxvZ2luIHRhYicpO1xuICAgIGF3YWl0IGNsaWNrQnV0dG9uKGZyYW1lLCAnI3JlZ3VsYXItbG9naW4nKTtcbiAgICBkZWJ1Zygnd2FpdCB1bnRpbCB0aGUgcGFzc3dvcmQgbG9naW4gdGFiIGlzIGFjdGl2ZScpO1xuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChmcmFtZSwgJ3JlZ3VsYXItbG9naW4nKTtcblxuICAgIHJldHVybiBmcmFtZTtcbiAgfTtcblxuICBhc3luYyBnZXRDYXJkcygpIHtcbiAgICBjb25zdCBpbml0RGF0YSA9IGF3YWl0IHdhaXRVbnRpbChcbiAgICAgICgpID0+IGdldEZyb21TZXNzaW9uU3RvcmFnZTxJbml0UmVzcG9uc2U+KHRoaXMucGFnZSwgJ2luaXQnKSxcbiAgICAgICdnZXQgaW5pdCBkYXRhIGluIHNlc3Npb24gc3RvcmFnZScsXG4gICAgICAxMDAwMCxcbiAgICAgIDEwMDAsXG4gICAgKTtcbiAgICBpZiAoIWluaXREYXRhKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvdWxkIG5vdCBmaW5kIFwiaW5pdFwiIGRhdGEgaW4gc2Vzc2lvbiBzdG9yYWdlJyk7XG4gICAgfVxuICAgIHJldHVybiBpbml0RGF0YT8ucmVzdWx0LmNhcmRzLm1hcCgoeyBjYXJkVW5pcXVlSWQsIGxhc3Q0RGlnaXRzIH0pID0+ICh7IGNhcmRVbmlxdWVJZCwgbGFzdDREaWdpdHMgfSkpO1xuICB9XG5cbiAgYXN5bmMgZ2V0QXV0aG9yaXphdGlvbkhlYWRlcigpIHtcbiAgICBpZiAoIXRoaXMuYXV0aG9yaXphdGlvbikge1xuICAgICAgZGVidWcoJ2ZldGNoaW5nIGF1dGhvcml6YXRpb24gaGVhZGVyJyk7XG4gICAgICBjb25zdCBhdXRoTW9kdWxlID0gYXdhaXQgd2FpdFVudGlsKFxuICAgICAgICBhc3luYyAoKSA9PiBhdXRoTW9kdWxlT3JVbmRlZmluZWQoYXdhaXQgZ2V0RnJvbVNlc3Npb25TdG9yYWdlPEF1dGhNb2R1bGU+KHRoaXMucGFnZSwgJ2F1dGgtbW9kdWxlJykpLFxuICAgICAgICAnZ2V0IGF1dGhvcml6YXRpb24gaGVhZGVyIHdpdGggdmFsaWQgdG9rZW4gaW4gc2Vzc2lvbiBzdG9yYWdlJyxcbiAgICAgICAgMTBfMDAwLFxuICAgICAgICA1MCxcbiAgICAgICk7XG4gICAgICByZXR1cm4gYENBTEF1dGhTY2hlbWUgJHthdXRoTW9kdWxlLmF1dGguY2FsQ29ubmVjdFRva2VufWA7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmF1dGhvcml6YXRpb247XG4gIH1cblxuICBhc3luYyBnZXRYU2l0ZUlkKCkge1xuICAgIC8qXG4gICAgICBJIGRvbid0IGtub3cgaWYgdGhlIGNvbnN0YW50IGJlbG93IHdpbGwgY2hhbmdlIGluIHRoZSBmZWF0dXJlLlxuICAgICAgSWYgc28sIHVzZSB0aGUgbmV4dCBjb2RlOlxuXG4gICAgICByZXR1cm4gdGhpcy5wYWdlLmV2YWx1YXRlKCgpID0+IG5ldyBVdCgpLnhTaXRlSWQpO1xuXG4gICAgICBUbyBnZXQgdGhlIGNsYXNzbmFtZSBzZWFyY2ggZm9yICd4U2l0ZUlkJyBpbiB0aGUgcGFnZSBzb3VyY2VcbiAgICAgIGNsYXNzIFV0IHtcbiAgICAgICAgY29uc3RydWN0b3IoX2UsIG9uLCB5bikge1xuICAgICAgICAgICAgdGhpcy5zdG9yZSA9IF9lLFxuICAgICAgICAgICAgdGhpcy5jb25maWcgPSBvbixcbiAgICAgICAgICAgIHRoaXMuZXZlbnRCdXNTZXJ2aWNlID0geW4sXG4gICAgICAgICAgICB0aGlzLnhTaXRlSWQgPSBcIjA5MDMxOTg3LTI3M0UtMjMxMS05MDZDLThBRjg1QjE3QzhEOVwiLFxuICAgICovXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgnMDkwMzE5ODctMjczRS0yMzExLTkwNkMtOEFGODVCMTdDOEQ5Jyk7XG4gIH1cblxuICBnZXRMb2dpbk9wdGlvbnMoY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKTogTG9naW5PcHRpb25zIHtcbiAgICB0aGlzLmF1dGhSZXF1ZXN0UHJvbWlzZSA9IHRoaXMucGFnZVxuICAgICAgLndhaXRGb3JSZXF1ZXN0KFNTT19BVVRIT1JJWkFUSU9OX1JFUVVFU1RfRU5EUE9JTlQsIHsgdGltZW91dDogMTBfMDAwIH0pXG4gICAgICAuY2F0Y2goZSA9PiB7XG4gICAgICAgIGRlYnVnKCdlcnJvciB3aGlsZSB3YWl0aW5nIGZvciB0aGUgdG9rZW4gcmVxdWVzdCcsIGUpO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxvZ2luVXJsOiBgJHtMT0dJTl9VUkx9YCxcbiAgICAgIGZpZWxkczogY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHMpLFxuICAgICAgc3VibWl0QnV0dG9uU2VsZWN0b3I6ICdidXR0b25bdHlwZT1cInN1Ym1pdFwiXScsXG4gICAgICBwb3NzaWJsZVJlc3VsdHM6IGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCksXG4gICAgICBjaGVja1JlYWRpbmVzczogYXN5bmMgKCkgPT4gd2FpdFVudGlsRWxlbWVudEZvdW5kKHRoaXMucGFnZSwgJyNjY0xvZ2luRGVza3RvcEJ0bicpLFxuICAgICAgcHJlQWN0aW9uOiB0aGlzLm9wZW5Mb2dpblBvcHVwLFxuICAgICAgcG9zdEFjdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHdhaXRGb3JOYXZpZ2F0aW9uKHRoaXMucGFnZSk7XG4gICAgICAgICAgY29uc3QgY3VycmVudFVybCA9IGF3YWl0IGdldEN1cnJlbnRVcmwodGhpcy5wYWdlKTtcbiAgICAgICAgICBpZiAoY3VycmVudFVybC5lbmRzV2l0aCgnc2l0ZS10dXRvcmlhbCcpKSB7XG4gICAgICAgICAgICBhd2FpdCBjbGlja0J1dHRvbih0aGlzLnBhZ2UsICdidXR0b24uYnRuLWNsb3NlJyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLmF1dGhSZXF1ZXN0UHJvbWlzZTtcbiAgICAgICAgICB0aGlzLmF1dGhvcml6YXRpb24gPSBTdHJpbmcocmVxdWVzdD8uaGVhZGVycygpLmF1dGhvcml6YXRpb24gfHwgJycpLnRyaW0oKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGNvbnN0IGN1cnJlbnRVcmwgPSBhd2FpdCBnZXRDdXJyZW50VXJsKHRoaXMucGFnZSk7XG4gICAgICAgICAgaWYgKGN1cnJlbnRVcmwuZW5kc1dpdGgoJ2Rhc2hib2FyZCcpKSByZXR1cm47XG4gICAgICAgICAgY29uc3QgcmVxdWlyZXNDaGFuZ2VQYXNzd29yZCA9IGF3YWl0IGhhc0NoYW5nZVBhc3N3b3JkRm9ybSh0aGlzLnBhZ2UpO1xuICAgICAgICAgIGlmIChyZXF1aXJlc0NoYW5nZVBhc3N3b3JkKSByZXR1cm47XG4gICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHVzZXJBZ2VudDogYXBpSGVhZGVyc1snVXNlci1BZ2VudCddLFxuICAgIH07XG4gIH1cblxuICBhc3luYyBmZXRjaERhdGEoKTogUHJvbWlzZTxTY3JhcGVyU2NyYXBpbmdSZXN1bHQ+IHtcbiAgICBjb25zdCBkZWZhdWx0U3RhcnRNb21lbnQgPSBtb21lbnQoKS5zdWJ0cmFjdCgxLCAneWVhcnMnKS5zdWJ0cmFjdCg2LCAnbW9udGhzJykuYWRkKDEsICdkYXknKTtcbiAgICBjb25zdCBzdGFydERhdGUgPSB0aGlzLm9wdGlvbnMuc3RhcnREYXRlIHx8IGRlZmF1bHRTdGFydE1vbWVudC50b0RhdGUoKTtcbiAgICBjb25zdCBzdGFydE1vbWVudCA9IG1vbWVudC5tYXgoZGVmYXVsdFN0YXJ0TW9tZW50LCBtb21lbnQoc3RhcnREYXRlKSk7XG4gICAgZGVidWcoYGZldGNoIHRyYW5zYWN0aW9ucyBzdGFydGluZyAke3N0YXJ0TW9tZW50LmZvcm1hdCgpfWApO1xuXG4gICAgY29uc3QgW2NhcmRzLCB4U2l0ZUlkLCBBdXRob3JpemF0aW9uXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIHRoaXMuZ2V0Q2FyZHMoKSxcbiAgICAgIHRoaXMuZ2V0WFNpdGVJZCgpLFxuICAgICAgdGhpcy5nZXRBdXRob3JpemF0aW9uSGVhZGVyKCksXG4gICAgXSk7XG5cbiAgICBjb25zdCBmdXR1cmVNb250aHNUb1NjcmFwZSA9IHRoaXMub3B0aW9ucy5mdXR1cmVNb250aHNUb1NjcmFwZSA/PyAxO1xuXG4gICAgZGVidWcoJ2ZldGNoIGZyYW1lcyAobWlzZ2Fyb3QpIG9mIGNhcmRzJyk7XG4gICAgY29uc3QgZnJhbWVzID0gYXdhaXQgZmV0Y2hQb3N0PEZyYW1lc1Jlc3BvbnNlPihcbiAgICAgIEZSQU1FU19SRVFVRVNUX0VORFBPSU5ULFxuICAgICAgeyBjYXJkc0ZvckZyYW1lRGF0YTogY2FyZHMubWFwKCh7IGNhcmRVbmlxdWVJZCB9KSA9PiAoeyBjYXJkVW5pcXVlSWQgfSkpIH0sXG4gICAgICB7XG4gICAgICAgIEF1dGhvcml6YXRpb24sXG4gICAgICAgICdYLVNpdGUtSWQnOiB4U2l0ZUlkLFxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAuLi5hcGlIZWFkZXJzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgY29uc3QgYWNjb3VudHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgIGNhcmRzLm1hcChhc3luYyBjYXJkID0+IHtcbiAgICAgICAgY29uc3QgZmluYWxNb250aFRvRmV0Y2hNb21lbnQgPSBtb21lbnQoKS5hZGQoZnV0dXJlTW9udGhzVG9TY3JhcGUsICdtb250aCcpO1xuICAgICAgICBjb25zdCBtb250aHMgPSBmaW5hbE1vbnRoVG9GZXRjaE1vbWVudC5kaWZmKHN0YXJ0TW9tZW50LCAnbW9udGhzJyk7XG4gICAgICAgIGNvbnN0IGFsbE1vbnRoc0RhdGE6IENhcmRUcmFuc2FjdGlvbkRldGFpbHNbXSA9IFtdO1xuICAgICAgICBjb25zdCBmcmFtZSA9IGZyYW1lcy5yZXN1bHQ/LmJhbmtJc3N1ZWRDYXJkcz8uY2FyZExldmVsRnJhbWVzPy5maW5kKFxuICAgICAgICAgIChmOiBDYXJkTGV2ZWxGcmFtZSkgPT4gZi5jYXJkVW5pcXVlSWQgPT09IGNhcmQuY2FyZFVuaXF1ZUlkLFxuICAgICAgICApO1xuXG4gICAgICAgIGRlYnVnKGBmZXRjaCBwZW5kaW5nIHRyYW5zYWN0aW9ucyBmb3IgY2FyZCAke2NhcmQuY2FyZFVuaXF1ZUlkfWApO1xuICAgICAgICBsZXQgcGVuZGluZ0RhdGEgPSBhd2FpdCBmZXRjaFBvc3QoXG4gICAgICAgICAgUEVORElOR19UUkFOU0FDVElPTlNfUkVRVUVTVF9FTkRQT0lOVCxcbiAgICAgICAgICB7IGNhcmRVbmlxdWVJREFycmF5OiBbY2FyZC5jYXJkVW5pcXVlSWRdIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgQXV0aG9yaXphdGlvbixcbiAgICAgICAgICAgICdYLVNpdGUtSWQnOiB4U2l0ZUlkLFxuICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIC4uLmFwaUhlYWRlcnMsXG4gICAgICAgICAgfSxcbiAgICAgICAgKTtcblxuICAgICAgICBkZWJ1ZyhgZmV0Y2ggY29tcGxldGVkIHRyYW5zYWN0aW9ucyBmb3IgY2FyZCAke2NhcmQuY2FyZFVuaXF1ZUlkfWApO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSBtb250aHM7IGkrKykge1xuICAgICAgICAgIGNvbnN0IG1vbnRoID0gZmluYWxNb250aFRvRmV0Y2hNb21lbnQuY2xvbmUoKS5zdWJ0cmFjdChpLCAnbW9udGhzJyk7XG4gICAgICAgICAgY29uc3QgbW9udGhEYXRhID0gYXdhaXQgZmV0Y2hQb3N0KFxuICAgICAgICAgICAgVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQsXG4gICAgICAgICAgICB7IGNhcmRVbmlxdWVJZDogY2FyZC5jYXJkVW5pcXVlSWQsIG1vbnRoOiBtb250aC5mb3JtYXQoJ00nKSwgeWVhcjogbW9udGguZm9ybWF0KCdZWVlZJykgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgQXV0aG9yaXphdGlvbixcbiAgICAgICAgICAgICAgJ1gtU2l0ZS1JZCc6IHhTaXRlSWQsXG4gICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICAgIC4uLmFwaUhlYWRlcnMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICk7XG5cbiAgICAgICAgICBpZiAobW9udGhEYXRhPy5zdGF0dXNDb2RlICE9PSAxKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICBgZmFpbGVkIHRvIGZldGNoIHRyYW5zYWN0aW9ucyBmb3IgY2FyZCAke2NhcmQubGFzdDREaWdpdHN9LiBNZXNzYWdlOiAke21vbnRoRGF0YT8udGl0bGUgfHwgJyd9YCxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICBpZiAoIWlzQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyhtb250aERhdGEpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ21vbnRoRGF0YSBpcyBub3Qgb2YgdHlwZSBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzJyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYWxsTW9udGhzRGF0YS5wdXNoKG1vbnRoRGF0YSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocGVuZGluZ0RhdGE/LnN0YXR1c0NvZGUgIT09IDEgJiYgcGVuZGluZ0RhdGE/LnN0YXR1c0NvZGUgIT09IDk2KSB7XG4gICAgICAgICAgZGVidWcoXG4gICAgICAgICAgICBgZmFpbGVkIHRvIGZldGNoIHBlbmRpbmcgdHJhbnNhY3Rpb25zIGZvciBjYXJkICR7Y2FyZC5sYXN0NERpZ2l0c30uIE1lc3NhZ2U6ICR7cGVuZGluZ0RhdGE/LnRpdGxlIHx8ICcnfWAsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBwZW5kaW5nRGF0YSA9IG51bGw7XG4gICAgICAgIH0gZWxzZSBpZiAoIWlzQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMocGVuZGluZ0RhdGEpKSB7XG4gICAgICAgICAgZGVidWcoJ3BlbmRpbmdEYXRhIGlzIG5vdCBvZiB0eXBlIENhcmRUcmFuc2FjdGlvbkRldGFpbHMnKTtcbiAgICAgICAgICBwZW5kaW5nRGF0YSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0cmFuc2FjdGlvbnMgPSBjb252ZXJ0UGFyc2VkRGF0YVRvVHJhbnNhY3Rpb25zKGFsbE1vbnRoc0RhdGEsIHBlbmRpbmdEYXRhLCB0aGlzLm9wdGlvbnMpO1xuXG4gICAgICAgIGRlYnVnKCdmaWx0ZXIgb3V0IG9sZCB0cmFuc2FjdGlvbnMnKTtcbiAgICAgICAgY29uc3QgdHhucyA9XG4gICAgICAgICAgKHRoaXMub3B0aW9ucy5vdXRwdXREYXRhPy5lbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUgPz8gdHJ1ZSlcbiAgICAgICAgICAgID8gZmlsdGVyT2xkVHJhbnNhY3Rpb25zKHRyYW5zYWN0aW9ucywgbW9tZW50KHN0YXJ0RGF0ZSksIHRoaXMub3B0aW9ucy5jb21iaW5lSW5zdGFsbG1lbnRzIHx8IGZhbHNlKVxuICAgICAgICAgICAgOiB0cmFuc2FjdGlvbnM7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0eG5zLFxuICAgICAgICAgIGJhbGFuY2U6IGZyYW1lPy5uZXh0VG90YWxEZWJpdCAhPSBudWxsID8gLWZyYW1lLm5leHRUb3RhbERlYml0IDogdW5kZWZpbmVkLFxuICAgICAgICAgIGFjY291bnROdW1iZXI6IGNhcmQubGFzdDREaWdpdHMsXG4gICAgICAgIH0gYXMgVHJhbnNhY3Rpb25zQWNjb3VudDtcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBkZWJ1ZygncmV0dXJuIHRoZSBzY3JhcGVkIGFjY291bnRzJyk7XG5cbiAgICBkZWJ1ZyhKU09OLnN0cmluZ2lmeShhY2NvdW50cywgbnVsbCwgMikpO1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgYWNjb3VudHMsXG4gICAgfTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBWaXNhQ2FsU2NyYXBlcjtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsSUFBQUEsT0FBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUMsTUFBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUscUJBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLE1BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLFdBQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLFFBQUEsR0FBQUwsT0FBQTtBQUNBLElBQUFNLGFBQUEsR0FBQU4sT0FBQTtBQUNBLElBQUFPLFFBQUEsR0FBQVAsT0FBQTtBQUNBLElBQUFRLGNBQUEsR0FBQVIsT0FBQTtBQUNBLElBQUFTLHVCQUFBLEdBQUFULE9BQUE7QUFBc0csU0FBQUQsdUJBQUFXLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFDLFVBQUEsR0FBQUQsQ0FBQSxLQUFBRSxPQUFBLEVBQUFGLENBQUE7QUFHdEcsTUFBTUcsVUFBVSxHQUFHO0VBQ2pCLFlBQVksRUFDVix1SEFBdUg7RUFDekhDLE1BQU0sRUFBRSxzQ0FBc0M7RUFDOUNDLE9BQU8sRUFBRSxzQ0FBc0M7RUFDL0MsaUJBQWlCLEVBQUUscUNBQXFDO0VBQ3hELGdCQUFnQixFQUFFLFdBQVc7RUFDN0IsZ0JBQWdCLEVBQUUsTUFBTTtFQUN4QixnQkFBZ0IsRUFBRTtBQUNwQixDQUFDO0FBQ0QsTUFBTUMsU0FBUyxHQUFHLCtCQUErQjtBQUNqRCxNQUFNQyw2QkFBNkIsR0FDakMsOEZBQThGO0FBQ2hHLE1BQU1DLHVCQUF1QixHQUFHLCtEQUErRDtBQUMvRixNQUFNQyxxQ0FBcUMsR0FDekMsOEVBQThFO0FBQ2hGLE1BQU1DLGtDQUFrQyxHQUFHLHlFQUF5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