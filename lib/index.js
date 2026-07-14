"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "BasePensionScraper", {
  enumerable: true,
  get: function () {
    return _basePensionScraper.BasePensionScraper;
  }
});
Object.defineProperty(exports, "BasePortfolioScraper", {
  enumerable: true,
  get: function () {
    return _basePortfolioScraper.BasePortfolioScraper;
  }
});
Object.defineProperty(exports, "CompanyTypes", {
  enumerable: true,
  get: function () {
    return _definitions.CompanyTypes;
  }
});
Object.defineProperty(exports, "OneZeroScraper", {
  enumerable: true,
  get: function () {
    return _oneZero.default;
  }
});
Object.defineProperty(exports, "PENSION_SCRAPERS", {
  enumerable: true,
  get: function () {
    return _pensionDefinitions.PENSION_SCRAPERS;
  }
});
Object.defineProperty(exports, "PORTFOLIO_SCRAPERS", {
  enumerable: true,
  get: function () {
    return _portfolioDefinitions.PORTFOLIO_SCRAPERS;
  }
});
Object.defineProperty(exports, "PensionCompanyTypes", {
  enumerable: true,
  get: function () {
    return _pensionDefinitions.PensionCompanyTypes;
  }
});
Object.defineProperty(exports, "PortfolioCompanyTypes", {
  enumerable: true,
  get: function () {
    return _portfolioDefinitions.PortfolioCompanyTypes;
  }
});
Object.defineProperty(exports, "SCRAPERS", {
  enumerable: true,
  get: function () {
    return _definitions.SCRAPERS;
  }
});
Object.defineProperty(exports, "ScaperLoginResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperLoginResult;
  }
});
Object.defineProperty(exports, "ScaperScrapingResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperScrapingResult;
  }
});
Object.defineProperty(exports, "Scraper", {
  enumerable: true,
  get: function () {
    return _interface.Scraper;
  }
});
Object.defineProperty(exports, "ScraperCredentials", {
  enumerable: true,
  get: function () {
    return _interface.ScraperCredentials;
  }
});
Object.defineProperty(exports, "ScraperLoginResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperLoginResult;
  }
});
Object.defineProperty(exports, "ScraperOptions", {
  enumerable: true,
  get: function () {
    return _interface.ScraperOptions;
  }
});
Object.defineProperty(exports, "ScraperScrapingResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperScrapingResult;
  }
});
Object.defineProperty(exports, "createPensionScraper", {
  enumerable: true,
  get: function () {
    return _factory3.createPensionScraper;
  }
});
Object.defineProperty(exports, "createPortfolioScraper", {
  enumerable: true,
  get: function () {
    return _factory2.createPortfolioScraper;
  }
});
Object.defineProperty(exports, "createScraper", {
  enumerable: true,
  get: function () {
    return _factory.default;
  }
});
exports.getPuppeteerConfig = getPuppeteerConfig;
var _definitions = require("./definitions");
var _factory = _interopRequireDefault(require("./scrapers/factory"));
var _interface = require("./scrapers/interface");
var _oneZero = _interopRequireDefault(require("./scrapers/one-zero"));
var _portfolioDefinitions = require("./portfolio-definitions");
var _factory2 = require("./portfolio-scrapers/factory");
var _basePortfolioScraper = require("./portfolio-scrapers/base-portfolio-scraper");
var _pensionDefinitions = require("./pension-definitions");
var _factory3 = require("./pension-scrapers/factory");
var _basePensionScraper = require("./pension-scrapers/base-pension-scraper");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Note: the typo ScaperScrapingResult & ScraperLoginResult (sic) are exported here for backward compatibility

function getPuppeteerConfig() {
  return {
    chromiumRevision: '1250580'
  }; // https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-core-v22.5.0
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZGVmaW5pdGlvbnMiLCJyZXF1aXJlIiwiX2ZhY3RvcnkiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX2ludGVyZmFjZSIsIl9vbmVaZXJvIiwiX3BvcnRmb2xpb0RlZmluaXRpb25zIiwiX2ZhY3RvcnkyIiwiX2Jhc2VQb3J0Zm9saW9TY3JhcGVyIiwiX3BlbnNpb25EZWZpbml0aW9ucyIsIl9mYWN0b3J5MyIsIl9iYXNlUGVuc2lvblNjcmFwZXIiLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJnZXRQdXBwZXRlZXJDb25maWciLCJjaHJvbWl1bVJldmlzaW9uIl0sInNvdXJjZXMiOlsiLi4vc3JjL2luZGV4LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCB7IENvbXBhbnlUeXBlcywgU0NSQVBFUlMgfSBmcm9tICcuL2RlZmluaXRpb25zJztcbmV4cG9ydCB7IGRlZmF1bHQgYXMgY3JlYXRlU2NyYXBlciB9IGZyb20gJy4vc2NyYXBlcnMvZmFjdG9yeSc7XG5cbi8vIE5vdGU6IHRoZSB0eXBvIFNjYXBlclNjcmFwaW5nUmVzdWx0ICYgU2NyYXBlckxvZ2luUmVzdWx0IChzaWMpIGFyZSBleHBvcnRlZCBoZXJlIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG5leHBvcnQge1xuICBTY3JhcGVyTG9naW5SZXN1bHQgYXMgU2NhcGVyTG9naW5SZXN1bHQsXG4gIFNjcmFwZXJTY3JhcGluZ1Jlc3VsdCBhcyBTY2FwZXJTY3JhcGluZ1Jlc3VsdCxcbiAgU2NyYXBlcixcbiAgU2NyYXBlckNyZWRlbnRpYWxzLFxuICBTY3JhcGVyTG9naW5SZXN1bHQsXG4gIFNjcmFwZXJPcHRpb25zLFxuICBTY3JhcGVyU2NyYXBpbmdSZXN1bHQsXG59IGZyb20gJy4vc2NyYXBlcnMvaW50ZXJmYWNlJztcblxuZXhwb3J0IHsgZGVmYXVsdCBhcyBPbmVaZXJvU2NyYXBlciB9IGZyb20gJy4vc2NyYXBlcnMvb25lLXplcm8nO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UHVwcGV0ZWVyQ29uZmlnKCkge1xuICByZXR1cm4geyBjaHJvbWl1bVJldmlzaW9uOiAnMTI1MDU4MCcgfTsgLy8gaHR0cHM6Ly9naXRodWIuY29tL3B1cHBldGVlci9wdXBwZXRlZXIvcmVsZWFzZXMvdGFnL3B1cHBldGVlci1jb3JlLXYyMi41LjBcbn1cblxuZXhwb3J0IHsgUG9ydGZvbGlvQ29tcGFueVR5cGVzLCBQT1JURk9MSU9fU0NSQVBFUlMgfSBmcm9tICcuL3BvcnRmb2xpby1kZWZpbml0aW9ucyc7XG5leHBvcnQgeyBjcmVhdGVQb3J0Zm9saW9TY3JhcGVyIH0gZnJvbSAnLi9wb3J0Zm9saW8tc2NyYXBlcnMvZmFjdG9yeSc7XG5leHBvcnQgdHlwZSB7XG4gIFBvcnRmb2xpb1NjcmFwZXIsXG4gIFBvcnRmb2xpb1NjcmFwaW5nUmVzdWx0LFxuICBQb3J0Zm9saW9Qb3NpdGlvbixcbiAgUG9ydGZvbGlvQ2FzaCxcbn0gZnJvbSAnLi9wb3J0Zm9saW8tc2NyYXBlcnMvaW50ZXJmYWNlJztcbmV4cG9ydCB7IEJhc2VQb3J0Zm9saW9TY3JhcGVyIH0gZnJvbSAnLi9wb3J0Zm9saW8tc2NyYXBlcnMvYmFzZS1wb3J0Zm9saW8tc2NyYXBlcic7XG5leHBvcnQgdHlwZSB7IEJhc2VQb3J0Zm9saW9TY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vcG9ydGZvbGlvLXNjcmFwZXJzL2Jhc2UtcG9ydGZvbGlvLXNjcmFwZXInO1xuZXhwb3J0IHR5cGUgeyBQb3J0Zm9saW9TY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vcG9ydGZvbGlvLXNjcmFwZXJzL2ZhY3RvcnknO1xuXG5leHBvcnQgeyBQZW5zaW9uQ29tcGFueVR5cGVzLCBQRU5TSU9OX1NDUkFQRVJTIH0gZnJvbSAnLi9wZW5zaW9uLWRlZmluaXRpb25zJztcbmV4cG9ydCB7IGNyZWF0ZVBlbnNpb25TY3JhcGVyIH0gZnJvbSAnLi9wZW5zaW9uLXNjcmFwZXJzL2ZhY3RvcnknO1xuZXhwb3J0IHR5cGUgeyBQZW5zaW9uU2NyYXBlciwgUGVuc2lvbkhvbGRpbmdPdXRwdXQsIFBlbnNpb25TY3JhcGluZ1Jlc3VsdCB9IGZyb20gJy4vcGVuc2lvbi1zY3JhcGVycy9pbnRlcmZhY2UnO1xuZXhwb3J0IHsgQmFzZVBlbnNpb25TY3JhcGVyIH0gZnJvbSAnLi9wZW5zaW9uLXNjcmFwZXJzL2Jhc2UtcGVuc2lvbi1zY3JhcGVyJztcbmV4cG9ydCB0eXBlIHsgQmFzZVBlbnNpb25TY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vcGVuc2lvbi1zY3JhcGVycy9iYXNlLXBlbnNpb24tc2NyYXBlcic7XG5leHBvcnQgdHlwZSB7IFBlbnNpb25TY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vcGVuc2lvbi1zY3JhcGVycy9mYWN0b3J5JztcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsSUFBQUEsWUFBQSxHQUFBQyxPQUFBO0FBQ0EsSUFBQUMsUUFBQSxHQUFBQyxzQkFBQSxDQUFBRixPQUFBO0FBR0EsSUFBQUcsVUFBQSxHQUFBSCxPQUFBO0FBVUEsSUFBQUksUUFBQSxHQUFBRixzQkFBQSxDQUFBRixPQUFBO0FBTUEsSUFBQUsscUJBQUEsR0FBQUwsT0FBQTtBQUNBLElBQUFNLFNBQUEsR0FBQU4sT0FBQTtBQU9BLElBQUFPLHFCQUFBLEdBQUFQLE9BQUE7QUFJQSxJQUFBUSxtQkFBQSxHQUFBUixPQUFBO0FBQ0EsSUFBQVMsU0FBQSxHQUFBVCxPQUFBO0FBRUEsSUFBQVUsbUJBQUEsR0FBQVYsT0FBQTtBQUE2RSxTQUFBRSx1QkFBQVMsQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQWhDN0U7O0FBYU8sU0FBU0csa0JBQWtCQSxDQUFBLEVBQUc7RUFDbkMsT0FBTztJQUFFQyxnQkFBZ0IsRUFBRTtFQUFVLENBQUMsQ0FBQyxDQUFDO0FBQzFDIiwiaWdub3JlTGlzdCI6W119