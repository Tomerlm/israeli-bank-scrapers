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
Object.defineProperty(exports, "createBeinleumiMortgageScraper", {
  enumerable: true,
  get: function () {
    return _beinleumi.createBeinleumiMortgageScraper;
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
var _beinleumi = require("./scrapers/mortgageScrapers/beinleumi");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Note: the typo ScaperScrapingResult & ScraperLoginResult (sic) are exported here for backward compatibility

function getPuppeteerConfig() {
  return {
    chromiumRevision: '1250580'
  }; // https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-core-v22.5.0
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZGVmaW5pdGlvbnMiLCJyZXF1aXJlIiwiX2ZhY3RvcnkiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX2ludGVyZmFjZSIsIl9vbmVaZXJvIiwiX3BvcnRmb2xpb0RlZmluaXRpb25zIiwiX2ZhY3RvcnkyIiwiX2Jhc2VQb3J0Zm9saW9TY3JhcGVyIiwiX3BlbnNpb25EZWZpbml0aW9ucyIsIl9mYWN0b3J5MyIsIl9iYXNlUGVuc2lvblNjcmFwZXIiLCJfYmVpbmxldW1pIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiZ2V0UHVwcGV0ZWVyQ29uZmlnIiwiY2hyb21pdW1SZXZpc2lvbiJdLCJzb3VyY2VzIjpbIi4uL3NyYy9pbmRleC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgeyBDb21wYW55VHlwZXMsIFNDUkFQRVJTIH0gZnJvbSAnLi9kZWZpbml0aW9ucyc7XG5leHBvcnQgeyBkZWZhdWx0IGFzIGNyZWF0ZVNjcmFwZXIgfSBmcm9tICcuL3NjcmFwZXJzL2ZhY3RvcnknO1xuXG4vLyBOb3RlOiB0aGUgdHlwbyBTY2FwZXJTY3JhcGluZ1Jlc3VsdCAmIFNjcmFwZXJMb2dpblJlc3VsdCAoc2ljKSBhcmUgZXhwb3J0ZWQgaGVyZSBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuZXhwb3J0IHtcbiAgU2NyYXBlckxvZ2luUmVzdWx0IGFzIFNjYXBlckxvZ2luUmVzdWx0LFxuICBTY3JhcGVyU2NyYXBpbmdSZXN1bHQgYXMgU2NhcGVyU2NyYXBpbmdSZXN1bHQsXG4gIFNjcmFwZXIsXG4gIFNjcmFwZXJDcmVkZW50aWFscyxcbiAgU2NyYXBlckxvZ2luUmVzdWx0LFxuICBTY3JhcGVyT3B0aW9ucyxcbiAgU2NyYXBlclNjcmFwaW5nUmVzdWx0LFxufSBmcm9tICcuL3NjcmFwZXJzL2ludGVyZmFjZSc7XG5cbmV4cG9ydCB7IGRlZmF1bHQgYXMgT25lWmVyb1NjcmFwZXIgfSBmcm9tICcuL3NjcmFwZXJzL29uZS16ZXJvJztcblxuZXhwb3J0IGZ1bmN0aW9uIGdldFB1cHBldGVlckNvbmZpZygpIHtcbiAgcmV0dXJuIHsgY2hyb21pdW1SZXZpc2lvbjogJzEyNTA1ODAnIH07IC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9wdXBwZXRlZXIvcHVwcGV0ZWVyL3JlbGVhc2VzL3RhZy9wdXBwZXRlZXItY29yZS12MjIuNS4wXG59XG5cbmV4cG9ydCB7IFBvcnRmb2xpb0NvbXBhbnlUeXBlcywgUE9SVEZPTElPX1NDUkFQRVJTIH0gZnJvbSAnLi9wb3J0Zm9saW8tZGVmaW5pdGlvbnMnO1xuZXhwb3J0IHsgY3JlYXRlUG9ydGZvbGlvU2NyYXBlciB9IGZyb20gJy4vcG9ydGZvbGlvLXNjcmFwZXJzL2ZhY3RvcnknO1xuZXhwb3J0IHR5cGUge1xuICBQb3J0Zm9saW9TY3JhcGVyLFxuICBQb3J0Zm9saW9TY3JhcGluZ1Jlc3VsdCxcbiAgUG9ydGZvbGlvUG9zaXRpb24sXG4gIFBvcnRmb2xpb0Nhc2gsXG4gIFBvcnRmb2xpb0RlcG9zaXQsXG59IGZyb20gJy4vcG9ydGZvbGlvLXNjcmFwZXJzL2ludGVyZmFjZSc7XG5leHBvcnQgeyBCYXNlUG9ydGZvbGlvU2NyYXBlciB9IGZyb20gJy4vcG9ydGZvbGlvLXNjcmFwZXJzL2Jhc2UtcG9ydGZvbGlvLXNjcmFwZXInO1xuZXhwb3J0IHR5cGUgeyBCYXNlUG9ydGZvbGlvU2NyYXBlck9wdGlvbnMgfSBmcm9tICcuL3BvcnRmb2xpby1zY3JhcGVycy9iYXNlLXBvcnRmb2xpby1zY3JhcGVyJztcbmV4cG9ydCB0eXBlIHsgUG9ydGZvbGlvU2NyYXBlck9wdGlvbnMgfSBmcm9tICcuL3BvcnRmb2xpby1zY3JhcGVycy9mYWN0b3J5JztcblxuZXhwb3J0IHsgUGVuc2lvbkNvbXBhbnlUeXBlcywgUEVOU0lPTl9TQ1JBUEVSUyB9IGZyb20gJy4vcGVuc2lvbi1kZWZpbml0aW9ucyc7XG5leHBvcnQgeyBjcmVhdGVQZW5zaW9uU2NyYXBlciB9IGZyb20gJy4vcGVuc2lvbi1zY3JhcGVycy9mYWN0b3J5JztcbmV4cG9ydCB0eXBlIHsgUGVuc2lvblNjcmFwZXIsIFBlbnNpb25Ib2xkaW5nT3V0cHV0LCBQZW5zaW9uU2NyYXBpbmdSZXN1bHQgfSBmcm9tICcuL3BlbnNpb24tc2NyYXBlcnMvaW50ZXJmYWNlJztcbmV4cG9ydCB7IEJhc2VQZW5zaW9uU2NyYXBlciB9IGZyb20gJy4vcGVuc2lvbi1zY3JhcGVycy9iYXNlLXBlbnNpb24tc2NyYXBlcic7XG5leHBvcnQgdHlwZSB7IEJhc2VQZW5zaW9uU2NyYXBlck9wdGlvbnMgfSBmcm9tICcuL3BlbnNpb24tc2NyYXBlcnMvYmFzZS1wZW5zaW9uLXNjcmFwZXInO1xuZXhwb3J0IHR5cGUgeyBQZW5zaW9uU2NyYXBlck9wdGlvbnMgfSBmcm9tICcuL3BlbnNpb24tc2NyYXBlcnMvZmFjdG9yeSc7XG5cbmV4cG9ydCB0eXBlIHsgTW9ydGdhZ2VBY2NvdW50LCBNb3J0Z2FnZVRyYWNrIH0gZnJvbSAnLi9zY3JhcGVycy9tb3J0Z2FnZVNjcmFwZXJzL3R5cGVzJztcbmV4cG9ydCB7IGNyZWF0ZUJlaW5sZXVtaU1vcnRnYWdlU2NyYXBlciB9IGZyb20gJy4vc2NyYXBlcnMvbW9ydGdhZ2VTY3JhcGVycy9iZWlubGV1bWknO1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxJQUFBQSxZQUFBLEdBQUFDLE9BQUE7QUFDQSxJQUFBQyxRQUFBLEdBQUFDLHNCQUFBLENBQUFGLE9BQUE7QUFHQSxJQUFBRyxVQUFBLEdBQUFILE9BQUE7QUFVQSxJQUFBSSxRQUFBLEdBQUFGLHNCQUFBLENBQUFGLE9BQUE7QUFNQSxJQUFBSyxxQkFBQSxHQUFBTCxPQUFBO0FBQ0EsSUFBQU0sU0FBQSxHQUFBTixPQUFBO0FBUUEsSUFBQU8scUJBQUEsR0FBQVAsT0FBQTtBQUlBLElBQUFRLG1CQUFBLEdBQUFSLE9BQUE7QUFDQSxJQUFBUyxTQUFBLEdBQUFULE9BQUE7QUFFQSxJQUFBVSxtQkFBQSxHQUFBVixPQUFBO0FBS0EsSUFBQVcsVUFBQSxHQUFBWCxPQUFBO0FBQXVGLFNBQUFFLHVCQUFBVSxDQUFBLFdBQUFBLENBQUEsSUFBQUEsQ0FBQSxDQUFBQyxVQUFBLEdBQUFELENBQUEsS0FBQUUsT0FBQSxFQUFBRixDQUFBO0FBdEN2Rjs7QUFhTyxTQUFTRyxrQkFBa0JBLENBQUEsRUFBRztFQUNuQyxPQUFPO0lBQUVDLGdCQUFnQixFQUFFO0VBQVUsQ0FBQyxDQUFDLENBQUM7QUFDMUMiLCJpZ25vcmVMaXN0IjpbXX0=