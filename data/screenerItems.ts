// Stockbit screener column IDs.  These magic numbers are the API's item identifiers,
// and the inline label on each says what that column returns.
export enum ITEMS {
    // === PRICE & MARKET ===
    PRICE = 2661,
    MARKET_CAP = 2895, // Enterprise Value
    SHARES_OUTSTANDING = 1572,
    HIGH_52W = 1570,
    LOW_52W = 1571,
    RETURNS_3M = 1565, // 3 Month Price Returns (%)
    RETURNS_YTD = 1569, // Year to Date Price Returns (%)
    SPLIT_FACTOR = 2918, // Latest Split Factor (From 2008)

    // === VALUATION ===
    PE_RATIO_Q = 1482, // PE Ratio (Quarter)
    PE_RATIO_TTM = 1483, // PE Ratio (TTM)
    PBV_ANNUAL = 1515, // Price to Tang. Book Value (Annual)
    PBV_Q = 1516, // Price to Tang. Book Value (Quarter)
    PS_Q = 1476, // Price to Sales (Quarter)
    EV_EBIT_TTM = 2897, // EV to EBIT (TTM)
    EARNINGS_YIELD_TTM = 2898, // Earnings Yield (TTM) (%)

    // === EARNINGS ===
    EPS_Q = 1474, // EPS (Quarter)
    EPS_ANNUAL = 1475, // EPS (Annual)
    EPS_GROWTH_QOQ = 1470, // EPS (Quarter YoY Growth)
    EPS_GROWTH_YTD = 1472, // EPS (YTD YoY Growth)

    // === PROFITABILITY ===
    ROA_Q = 860,
    ROA_YTD = 861,
    ROA_TTM = 1460,
    ROE_TTM = 1461,
    ROCE_ANNUAL = 865, // Return on Capital Employed
    ROCE_YTD = 867,
    GROSS_MARGIN_Q = 1561, // Gross Profit Margin (Quarter) (%)
    OP_MARGIN_ANNUAL = 3196, // Operating Profit Margin (Annual) (%)

    // === REVENUE & INCOME ===
    REVENUE_YTD = 2996,
    REVENUE_TTM = 2997,
    REVENUE_GROWTH_QOQ = 2992, // (%)
    REVENUE_GROWTH_YTD = 2994, // (%)
    REVENUE_GROWTH_3Y = 2995, // (%)
    REVENUE_GROWTH_ANNUAL = 3206, // (%)
    GROSS_PROFIT_Q = 3005,
    GROSS_PROFIT_ANNUAL = 3114,
    GROSS_PROFIT_GROWTH_QOQ = 3008,
    GROSS_PROFIT_GROWTH_ANNUAL = 3208,
    OP_INCOME_Q = 3019, // Income From Operations
    OP_INCOME_TTM = 3021,
    OP_INCOME_GROWTH_QOQ = 3022,
    OP_INCOME_GROWTH_ANNUAL = 3210,
    NET_INCOME_TTM = 3063,
    NET_INCOME_GROWTH_QOQ = 3064,
    NET_INCOME_GROWTH_YTD = 3065,
    EBIT_TTM = 1556,

    // === BALANCE SHEET ===
    BOOK_VALUE_Q = 1490,
    BOOK_VALUE_ANNUAL = 1489,
    TANGIBLE_BV = 3105,
    TANGIBLE_BVPS_ANNUAL = 1495, // Tang. Book Value Per Share
    TOTAL_CURRENT_ASSETS = 3076,
    TOTAL_NON_CURRENT_ASSETS = 3091,
    TOTAL_LIABILITIES_Q = 1560,
    TOTAL_DEBT_Q = 1486,
    SHORT_TERM_DEBT_Q = 1520,
    LONG_TERM_DEBT_Q = 1524,
    NET_DEBT_ANNUAL = 1487,
    WORKING_CAPITAL_Q = 1518,

    // === RATIOS ===
    CURRENT_RATIO_Q = 1498,
    CURRENT_RATIO_YTD = 850,
    QUICK_RATIO_Q = 1500,
    QUICK_RATIO_ANNUAL = 1499,
    DEBT_TO_ASSETS_YTD = 857, // Total Debt/Total Assets
    DEBT_TO_ASSETS_ANNUAL = 1511,
    LT_DEBT_EQUITY_Q = 1504,
    LIABILITIES_EQUITY_ANNUAL = 1575, // Total Liabilities/Equity
    FINANCIAL_LEVERAGE_ANNUAL = 1501,
    INTEREST_COVERAGE_Q = 1480,
    PAYOUT_RATIO = 2916,

    // === EFFICIENCY ===
    ASSET_TURNOVER_Q = 1455,
    ASSET_TURNOVER_TTM = 1459,
    INVENTORY_TURNOVER_Q = 1448,
    INVENTORY_TURNOVER_TTM = 1465,
    RECEIVABLES_TURNOVER_Q = 1445,
    FIXED_ASSETS_TURNOVER_TTM = 1466,
    WORKING_CAPITAL_TURNOVER_Q = 1525,
    DAYS_INVENTORY_Q = 1435,
    CASH_CONVERSION_CYCLE_YTD = 1443,

    // === CASH FLOW ===
    OCF_Q = 2525, // Operating Cash Flow
    OCF_TTM = 2526,
    OCF_ANNUAL = 2527,
    FCF_YTD = 2535, // Free Cash Flow
    FCF_ANNUAL = 2537,
    FCFPS_Q = 2540, // Free Cash Flow Per Share
    CAPEX_ANNUAL = 2533,

    // === COST ===
    COGS_Q = 2998,
    COGS_TTM = 3000,
    OPEX_Q = 3012,
    OPEX_TTM = 3014,
    FINANCE_COST_Q = 3026,
    FINANCE_COST_TTM = 3028,
    TAX_TTM = 3056,

    // === BANDARMOLOGY ===
    BANDAR_TOP3 = 14395, // Top 3
    BANDAR_TOP3_VOLUME = 14396, // Top 3 Volume Movement
    BANDAR_VALUE = 14399, // Bandar Value
    BANDAR_ACCUM_DIST = 14400, // Bandar Accum/Dist
    BANDAR_VALUE_MA10 = 14424, // Bandar Value MA 10
    BANDAR_PREV_VALUE = 14425, // Previous Bandar Value
    BANDAR_VALUE_MA20 = 14426, // Bandar Value MA 20

    // === ADDITIONAL ===
    PRICE_UNADJUSTED = 13118,
    EPS_TTM = 13200, // Current EPS (TTM)
    CONSENSUS_PRICE_HIGH = 13153,
    CONSENSUS_PRICE_MEDIAN = 13154,
    VALUE_MA50 = 16455, // Value MA 50
    CAGR_5Y = 16459, // 5 Year CAGR Price Performance (%)
    CAGR_10Y = 16460, // 10 Year CAGR Price Performance (%)
    PE_STDEV_NEG1_5Y = 16462, // -1 PE Standard Deviation (5 Year)
    PE_STDEV_MEAN_5Y = 16463, // Mean PE Standard Deviation (5 Year)
    MOST_RECENT_QUARTER = 16466,
    PE_RANK_ANNUALIZED = 16468, // Rank (Current PE Ratio Annualised) (%)
    AVG_DIV_YIELD_3Y = 16469, // Average Dividend Yield (3 Year) (%)
    AVG_DIV_YIELD_5Y = 16470, // Average Dividend Yield (5 Year) (%)
    EPS_GROWTH_STREAK = 16475, // EPS Growth Streak (Annual)
    COVARIANCE_3Y = 16493,
    PRICE_TO_CASHFLOW_TTM = 16533, // Current Price To Cashflow (TTM)
    ALL_TIME_LOW = 16547, // All Time Low (Year 2000)
}

export type ScreenerItemKey = keyof typeof ITEMS;
export type ScreenerItemId = (typeof ITEMS)[ScreenerItemKey];
