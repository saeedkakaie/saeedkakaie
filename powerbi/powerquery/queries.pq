// =====================================================================================
//  IBP گروه زر — Power Query (M)
//  هر بخش «Query: نام» را در Power BI Desktop به‌صورت یک Blank Query با همان نام بسازید
//  (Home ← Get Data ← Blank Query ← Advanced Editor) و متن را جای‌گذاری کنید.
//  منبع: پوشه‌ای با CSVهای خروجی (data و خروجی اسکریپت پایتون). در محیط واقعی به‌جای CSV
//  می‌توانید همین ستون‌ها را از SQL Server یا ERP بخوانید؛ فقط گام «Source» عوض می‌شود.
// =====================================================================================


// ===== Query: DataFolder  (پارامتر: Manage Parameters ← New، نوع Text) =====
"C:\IBP\data" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]


// ===== Query: OutputFolder  (پارامتر: پوشه خروجی اسکریپت پایتون ibp_pbi.py) =====
"C:\IBP\out" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]


// ===== Query: fnCsv  (تابع خواندن CSV با UTF-8) =====
(folder as text, name as text) as table =>
let
    Source = Csv.Document(File.Contents(folder & "\" & name & ".csv"), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true])
in
    Promoted


// ===== Query: fnKey  (کلید یکتای چندشرکتی: کد شرکت | شناسه) =====
(company as any, id as any) as text => Text.From(company) & "|" & Text.From(id)


// ===== Query: fnGregorianToJalali  (تاریخ میلادی ← رکورد سال/ماه/روز شمسی؛ هم‌خوان با برنامه ۲۰۱۰ تا ۲۰۴۵) =====
(d as date) as record =>
let
    gy = Date.Year(d), gm = Date.Month(d), gd = Date.Day(d),
    gdm = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334},
    gy2 = if gm > 2 then gy + 1 else gy,
    days0 = 355666 + 365 * gy + Number.IntegerDivide(gy2 + 3, 4) - Number.IntegerDivide(gy2 + 99, 100)
            + Number.IntegerDivide(gy2 + 399, 400) + gd + gdm{gm - 1},
    jy1 = -1595 + 33 * Number.IntegerDivide(days0, 12053),
    days1 = Number.Mod(days0, 12053),
    jy2 = jy1 + 4 * Number.IntegerDivide(days1, 1461),
    days2 = Number.Mod(days1, 1461),
    jy3 = if days2 > 365 then jy2 + Number.IntegerDivide(days2 - 1, 365) else jy2,
    days3 = if days2 > 365 then Number.Mod(days2 - 1, 365) else days2,
    jm = if days3 < 186 then 1 + Number.IntegerDivide(days3, 31) else 7 + Number.IntegerDivide(days3 - 186, 30),
    jd = if days3 < 186 then 1 + Number.Mod(days3, 31) else 1 + Number.Mod(days3 - 186, 30)
in
    [JYear = jy3, JMonth = jm, JDay = jd, PeriodKey = jy3 * 100 + jm]


// ===== Query: Period  (تقویم ماهانه شمسی با شدت رمضان و دهه محرم) =====
let
    Src = fnCsv(DataFolder, "calendar_lunar"),
    Typed = Table.TransformColumnTypes(Src, {{"PeriodKey", Int64.Type}, {"JYear", Int64.Type}, {"JMonth", Int64.Type}, {"MonthName", type text},
        {"Days", Int64.Type}, {"RamadanDays", Int64.Type}, {"MuharramDays", Int64.Type}, {"RamadanIntensity", type number},
        {"MuharramIntensity", type number}, {"GregorianStart", type date}}, "en-US"),
    // شماره پیوسته ماه برای پنجره‌های زمانی (۱۲ ماه اخیر، ماه قبل، ...) بدون نیاز به توابع زمانی میلادی
    MonthIndex = Table.AddColumn(Typed, "MonthIndex", each [JYear] * 12 + [JMonth], Int64.Type),
    Label = Table.AddColumn(MonthIndex, "Label", each [MonthName] & " " & Text.From([JYear]), type text),
    Short = Table.AddColumn(Label, "ShortLabel", each Text.Start([MonthName], 3) & " " & Text.End(Text.From([JYear]), 2), type text)
in
    Short


// ===== Query: Settings  (تنظیمات هر شرکت؛ کلید-مقدار) =====
let
    Src = fnCsv(DataFolder, "settings"),
    Pivot = Table.Pivot(Src, List.Distinct(Src[key]), "key", "value")
in
    Pivot


// ===== Query: Company =====
let
    Src = fnCsv(DataFolder, "companies"),
    WithSettings = Table.NestedJoin(Src, {"CompanyCode"}, Settings, {"CompanyCode"}, "S", JoinKind.LeftOuter),
    Expanded = Table.ExpandTableColumn(WithSettings, "S", {"cyclePeriod", "priceInflation", "costInflation", "holdingRate", "overtimePremium", "dpoDays",
        "serviceLevelTarget", "forecastAccuracyTarget", "frozenMonths", "excessMonths", "utilizationWarn", "utilizationMax", "abcA", "abcB", "xyzX", "xyzY",
        "horizonMonths", "displayScale"}),
    Typed = Table.TransformColumnTypes(Expanded, {{"cyclePeriod", Int64.Type}, {"priceInflation", type number}, {"costInflation", type number},
        {"holdingRate", type number}, {"overtimePremium", type number}, {"dpoDays", type number}, {"serviceLevelTarget", type number},
        {"forecastAccuracyTarget", type number}, {"frozenMonths", Int64.Type}, {"excessMonths", type number}, {"utilizationWarn", type number},
        {"utilizationMax", type number}, {"abcA", type number}, {"abcB", type number}, {"xyzX", type number}, {"xyzY", type number},
        {"horizonMonths", Int64.Type}, {"displayScale", type number}}, "en-US"),
    // مقادیر پیش‌فرض برنامه برای تنظیمات خالی
    Fill = Table.TransformColumns(Typed, {
        {"priceInflation", each if _ = null then 0.025 else _, type number}, {"costInflation", each if _ = null then 0.02 else _, type number},
        {"holdingRate", each if _ = null then 0.015 else _, type number}, {"overtimePremium", each if _ = null then 0.5 else _, type number},
        {"dpoDays", each if _ = null then 45 else _, type number}, {"serviceLevelTarget", each if _ = null then 0.95 else _, type number},
        {"forecastAccuracyTarget", each if _ = null then 0.8 else _, type number}, {"excessMonths", each if _ = null then 3 else _, type number},
        {"utilizationWarn", each if _ = null then 0.85 else _, type number}, {"utilizationMax", each if _ = null then 1 else _, type number},
        {"abcA", each if _ = null then 0.8 else _, type number}, {"abcB", each if _ = null then 0.95 else _, type number},
        {"xyzX", each if _ = null then 0.2 else _, type number}, {"xyzY", each if _ = null then 0.5 else _, type number}}),
    CycleIndex = Table.AddColumn(Fill, "CycleIndex", each Number.IntegerDivide([cyclePeriod], 100) * 12 + Number.Mod([cyclePeriod], 100), Int64.Type),
    // تخفیف میانگین کانال‌ها، وزن‌دار با تعداد مشتری هر کانال (برای تبدیل پیش‌بینی به مبلغ)
    Cust = Table.Group(fnCsv(DataFolder, "customers"), {"CompanyCode", "channelId"}, {{"n", each Table.RowCount(_), Int64.Type}}),
    Ch = Table.TransformColumnTypes(fnCsv(DataFolder, "channels"), {{"discount", type number}}, "en-US"),
    CustCh = Table.ExpandTableColumn(Table.NestedJoin(Cust, {"CompanyCode", "channelId"}, Ch, {"CompanyCode", "id"}, "c", JoinKind.LeftOuter), "c", {"discount"}),
    Disc = Table.Group(CustCh, {"CompanyCode"}, {{"AvgDiscount", each List.Sum(List.Transform(Table.ToRecords(_), (r) => r[n] * (if r[discount] = null then 0 else r[discount]))) / List.Sum([n]), type number}}),
    WithDisc = Table.ExpandTableColumn(Table.NestedJoin(CycleIndex, {"CompanyCode"}, Disc, {"CompanyCode"}, "d", JoinKind.LeftOuter), "d", {"AvgDiscount"})
in
    WithDisc


// ===== Query: Family =====
let
    Src = fnCsv(DataFolder, "families"),
    Key = Table.AddColumn(Src, "FamilyKey", each fnKey([CompanyCode], [id]), type text),
    Keep = Table.SelectColumns(Key, {"FamilyKey", "CompanyCode", "code", "name", "color"}, MissingField.UseNull)
in
    Keep


// ===== Query: Product =====
let
    Src = fnCsv(DataFolder, "products"),
    Typed = Table.TransformColumnTypes(Src, {{"unitWeightKg", type number}, {"unitPrice", type number}, {"unitCost", type number},
        {"safetyStockDays", type number}, {"batchSize", type number}, {"shelfLifeDays", type number}}, "en-US"),
    Key = Table.AddColumn(Typed, "ProductKey", each fnKey([CompanyCode], [id]), type text),
    Fam = Table.AddColumn(Key, "FamilyKey", each fnKey([CompanyCode], [familyId]), type text),
    IsIC = Table.AddColumn(Fam, "Intercompany", each [intercompany] = "1" or [intercompany] = "true", type logical),
    IsActive = Table.AddColumn(IsIC, "IsActive", each ([active] = null or [active] = "" or [active] = "1" or [active] = "true") and [lifecycle] <> "توقف", type logical),
    Keep = Table.SelectColumns(IsActive, {"ProductKey", "CompanyCode", "id", "code", "name", "FamilyKey", "plantId", "uom", "unitWeightKg", "unitPrice",
        "unitCost", "lifecycle", "abc", "safetyStockDays", "batchSize", "shelfLifeDays", "Intercompany", "IsActive", "phaseOutDate"}, MissingField.UseNull)
in
    Keep


// ===== Query: Channel =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "channels"), {{"discount", type number}}, "en-US"),
    Key = Table.AddColumn(Src, "ChannelKey", each fnKey([CompanyCode], [id]), type text)
in
    Table.SelectColumns(Key, {"ChannelKey", "CompanyCode", "code", "name", "discount", "internal"}, MissingField.UseNull)


// ===== Query: Region =====
let
    Src = fnCsv(DataFolder, "regions"),
    Key = Table.AddColumn(Src, "RegionKey", each fnKey([CompanyCode], [id]), type text)
in
    Table.SelectColumns(Key, {"RegionKey", "CompanyCode", "code", "name"}, MissingField.UseNull)


// ===== Query: Customer =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "customers"), {{"paymentDays", type number}, {"creditLimit", type number}}, "en-US"),
    Key = Table.AddColumn(Src, "CustomerKey", each fnKey([CompanyCode], [id]), type text),
    Ch = Table.AddColumn(Key, "ChannelKey", each fnKey([CompanyCode], [channelId]), type text),
    Rg = Table.AddColumn(Ch, "RegionKey", each fnKey([CompanyCode], [regionId]), type text)
in
    Table.SelectColumns(Rg, {"CustomerKey", "CompanyCode", "code", "name", "ChannelKey", "RegionKey", "tier", "paymentDays"}, MissingField.UseNull)


// ===== Query: Resource  (ظرفیت ساعتی ماهانه = شیفت × ساعت شیفت × روز کاری کارخانه × راندمان) =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "resources"), {{"shifts", type number}, {"hoursPerShift", type number}, {"efficiency", type number}, {"costPerHour", type number}}, "en-US"),
    Plants = Table.TransformColumnTypes(fnCsv(DataFolder, "plants"), {{"workingDays", type number}}, "en-US"),
    J = Table.ExpandTableColumn(Table.NestedJoin(Src, {"CompanyCode", "plantId"}, Plants, {"CompanyCode", "id"}, "p", JoinKind.LeftOuter), "p", {"workingDays"}),
    Cap = Table.AddColumn(J, "CapacityHours", each
        (if [shifts] = null or [shifts] = 0 then 1 else [shifts]) * (if [hoursPerShift] = null or [hoursPerShift] = 0 then 8 else [hoursPerShift])
        * (if [workingDays] = null or [workingDays] = 0 then 25 else [workingDays]) * (if [efficiency] = null or [efficiency] = 0 then 1 else [efficiency]), type number),
    Key = Table.AddColumn(Cap, "ResourceKey", each fnKey([CompanyCode], [id]), type text)
in
    Table.SelectColumns(Key, {"ResourceKey", "CompanyCode", "code", "name", "type", "shifts", "hoursPerShift", "workingDays", "efficiency", "costPerHour", "CapacityHours"}, MissingField.UseNull)


// ===== Query: Supplier =====
let
    Src = fnCsv(DataFolder, "suppliers"),
    Key = Table.AddColumn(Src, "SupplierKey", each fnKey([CompanyCode], [id]), type text),
    Imp = Table.AddColumn(Key, "IsImport", each [isImport] = "1" or [isImport] = "true", type logical)
in
    Table.SelectColumns(Imp, {"SupplierKey", "CompanyCode", "code", "name", "leadTimeDays", "IsImport"}, MissingField.UseNull)


// ===== Query: Material =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "materials"), {{"unitCost", type number}, {"leadTimeDays", type number}, {"moq", type number}, {"safetyStockDays", type number}}, "en-US"),
    Key = Table.AddColumn(Src, "MaterialKey", each fnKey([CompanyCode], [id]), type text),
    Sup = Table.AddColumn(Key, "SupplierKey", each if [supplierId] = null or [supplierId] = "" then null else fnKey([CompanyCode], [supplierId]), type text),
    J = Table.ExpandTableColumn(Table.NestedJoin(Sup, {"SupplierKey"}, Supplier, {"SupplierKey"}, "s", JoinKind.LeftOuter), "s", {"IsImport"}),
    // منشأ هزینه مواد برای سود و زیان: درون‌گروهی / وارداتی / داخلی
    Origin = Table.AddColumn(J, "CostOrigin", each if [internalCompany] <> null and [internalCompany] <> "" then "IC" else if [IsImport] = true then "Import" else "Domestic", type text)
in
    Table.SelectColumns(Origin, {"MaterialKey", "CompanyCode", "code", "name", "type", "uom", "unitCost", "SupplierKey", "internalCompany", "internalProductCode",
        "leadTimeDays", "moq", "safetyStockDays", "CostOrigin"}, MissingField.UseNull)


// ===== Query: Routing  (مسیر اصلی = اولویت ۱؛ برای RCCP مسیر اولویت ۱ با بیشترین نرخ) =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "routings"), {{"unitsPerHour", type number}, {"setupHours", type number}, {"priority", type number}}, "en-US"),
    Pr = Table.TransformColumns(Src, {{"priority", each if _ = null or _ = 0 then 1 else _, type number}}),
    Key = Table.AddColumn(Table.AddColumn(Pr, "ProductKey", each fnKey([CompanyCode], [productId]), type text), "ResourceKey", each fnKey([CompanyCode], [resourceId]), type text),
    Valid = Table.SelectRows(Key, each [unitsPerHour] <> null and [unitsPerHour] > 0),
    MaxUph = Table.Group(Table.SelectRows(Valid, each [priority] = 1), {"ProductKey"}, {{"MaxUph", each List.Max([unitsPerHour]), type number}}),
    J = Table.ExpandTableColumn(Table.NestedJoin(Valid, {"ProductKey"}, MaxUph, {"ProductKey"}, "m", JoinKind.LeftOuter), "m", {"MaxUph"}),
    Rccp = Table.AddColumn(J, "IsPrimaryRCCP", each [priority] = 1 and [unitsPerHour] = [MaxUph], type logical)
in
    Table.SelectColumns(Rccp, {"ProductKey", "ResourceKey", "CompanyCode", "unitsPerHour", "setupHours", "priority", "IsPrimaryRCCP"}, MissingField.UseNull)


// ===== Query: BOM =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "bom"), {{"qtyPer", type number}, {"scrap", type number}}, "en-US"),
    Key = Table.AddColumn(Table.AddColumn(Src, "ProductKey", each fnKey([CompanyCode], [productId]), type text), "MaterialKey", each fnKey([CompanyCode], [materialId]), type text),
    Gross = Table.AddColumn(Key, "QtyWithScrap", each [qtyPer] * (1 + (if [scrap] = null then 0 else [scrap])), type number)
in
    Table.SelectColumns(Gross, {"ProductKey", "MaterialKey", "CompanyCode", "qtyPer", "scrap", "QtyWithScrap"}, MissingField.UseNull)


// ===== Query: Sales  (فروش واقعی؛ بهای تمام‌شده دوره‌های گذشته با تورم قیمت به گذشته برده می‌شود) =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "salesActuals"), {{"period", Int64.Type}, {"qty", type number}, {"revenue", type number}}, "en-US"),
    Key = Table.AddColumn(Table.AddColumn(Src, "ProductKey", each fnKey([CompanyCode], [productId]), type text), "CustomerKey", each fnKey([CompanyCode], [customerId]), type text),
    P = Table.ExpandTableColumn(Table.NestedJoin(Key, {"ProductKey"}, Product, {"ProductKey"}, "p", JoinKind.LeftOuter), "p", {"unitWeightKg", "unitCost"}),
    C = Table.ExpandTableColumn(Table.NestedJoin(P, {"CompanyCode"}, Company, {"CompanyCode"}, "c", JoinKind.LeftOuter), "c", {"CycleIndex", "priceInflation"}),
    Idx = Table.AddColumn(C, "PeriodIndex", each Number.IntegerDivide([period], 100) * 12 + Number.Mod([period], 100), Int64.Type),
    Tons = Table.AddColumn(Idx, "Tons", each [qty] * (if [unitWeightKg] = null then 0 else [unitWeightKg]) / 1000, type number),
    Cost = Table.AddColumn(Tons, "CostDeflated", each [qty] * (if [unitCost] = null then 0 else [unitCost]) * Number.Power(1 + [priceInflation], [PeriodIndex] - [CycleIndex]), type number),
    Gross = Table.AddColumn(Cost, "Gross", each [revenue] - [CostDeflated], type number)
in
    Table.SelectColumns(Gross, {"CompanyCode", "period", "PeriodIndex", "ProductKey", "CustomerKey", "qty", "revenue", "Tons", "CostDeflated", "Gross"}, MissingField.UseNull)


// ===== Query: Forecast  (همه نسخه‌ها و چرخه‌ها؛ Lag = فاصله ماه پیش‌بینی از ماه چرخه) =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "forecasts"), {{"cycle", Int64.Type}, {"period", Int64.Type}, {"qty", type number}, {"lo", type number}, {"hi", type number}}, "en-US"),
    // پیش‌بینی آماری تازه از اسکریپت پایتون (اگر اجرا شده باشد) جایگزین نسخه آماری همان چرخه می‌شود
    Stat = try Table.TransformColumnTypes(fnCsv(OutputFolder, "FactStatForecast"), {{"cycle", Int64.Type}, {"period", Int64.Type}, {"qty", type number}, {"lo", type number}, {"hi", type number}}, "en-US") otherwise null,
    Merged = if Stat = null then Src else Table.Combine({Table.SelectRows(Src, each not ([version] = "آماری" and List.Contains(List.Distinct(Stat[cycle]), [cycle]))), Stat}),
    Key = Table.AddColumn(Merged, "ProductKey", each fnKey([CompanyCode], [productId]), type text),
    P = Table.ExpandTableColumn(Table.NestedJoin(Key, {"ProductKey"}, Product, {"ProductKey"}, "p", JoinKind.LeftOuter), "p", {"unitWeightKg", "unitPrice"}),
    C = Table.ExpandTableColumn(Table.NestedJoin(P, {"CompanyCode"}, Company, {"CompanyCode"}, "c", JoinKind.LeftOuter), "c", {"CycleIndex", "cyclePeriod", "priceInflation", "AvgDiscount"}),
    PIdx = Table.AddColumn(C, "PeriodIndex", each Number.IntegerDivide([period], 100) * 12 + Number.Mod([period], 100), Int64.Type),
    CIdx = Table.AddColumn(PIdx, "ForecastCycleIndex", each Number.IntegerDivide([cycle], 100) * 12 + Number.Mod([cycle], 100), Int64.Type),
    Lag = Table.AddColumn(CIdx, "Lag", each [PeriodIndex] - [ForecastCycleIndex], Int64.Type),
    Cur = Table.AddColumn(Lag, "IsCurrentCycle", each [cycle] = [cyclePeriod], type logical),
    Tons = Table.AddColumn(Cur, "Tons", each [qty] * (if [unitWeightKg] = null then 0 else [unitWeightKg]) / 1000, type number),
    // مبلغ برآوردی = مقدار × قیمت پایه × (۱+تورم قیمت)^(فاصله از چرخه جاری شرکت) × (۱ − تخفیف میانگین)
    Rev = Table.AddColumn(Tons, "RevenueEst", each [qty] * (if [unitPrice] = null then 0 else [unitPrice]) * Number.Power(1 + [priceInflation], [PeriodIndex] - [CycleIndex]) * (1 - (if [AvgDiscount] = null then 0 else [AvgDiscount])), type number)
in
    Table.SelectColumns(Rev, {"CompanyCode", "version", "cycle", "period", "PeriodIndex", "Lag", "IsCurrentCycle", "ProductKey", "qty", "lo", "hi", "method", "Tons", "RevenueEst"}, MissingField.UseNull)


// ===== Query: Accuracy  (دانه: شرکت × محصول × ماه × نسخه؛ پیش‌بینی lag-1 در برابر فروش واقعی) =====
//  اجماعی/آماری: پیش‌بینی چرخه ماه قبل برای همان ماه. در ماه‌هایی که آن نسخه پیش‌بینی lag-1 دارد، محصولی که
//  فروش داشته ولی پیش‌بینی نداشته با پیش‌بینی صفر، و محصولی که پیش‌بینی داشته ولی فروش نداشته با فروش صفر حساب می‌شود.
//  ساده (naive): فروش ماه قبل به‌عنوان پیش‌بینی (معیار مبنای FVA).
let
    Act = Table.Group(Sales, {"CompanyCode", "ProductKey", "period", "PeriodIndex"}, {{"Actual", each List.Sum([qty]), type number}}),
    Lag1 = Table.SelectRows(Forecast, each [Lag] = 1),
    ForVersion = (v as text) as table =>
        let
            Fc = Table.Group(Table.SelectRows(Lag1, each [version] = v), {"CompanyCode", "ProductKey", "period", "PeriodIndex"}, {{"Forecast", each List.Sum([qty]), type number}}),
            Months = Table.Distinct(Table.SelectColumns(Fc, {"CompanyCode", "period"}, MissingField.UseNull)),
            ActIn = Table.Join(Act, {"CompanyCode", "period"}, Table.RenameColumns(Months, {{"CompanyCode", "mc"}, {"period", "mp"}}), {"mc", "mp"}, JoinKind.Inner),
            Keys = Table.Distinct(Table.Combine({Table.SelectColumns(ActIn, {"CompanyCode", "ProductKey", "period", "PeriodIndex"}, MissingField.UseNull), Table.SelectColumns(Fc, {"CompanyCode", "ProductKey", "period", "PeriodIndex"}, MissingField.UseNull)})),
            WithA = Table.ExpandTableColumn(Table.NestedJoin(Keys, {"CompanyCode", "ProductKey", "period"}, Act, {"CompanyCode", "ProductKey", "period"}, "a", JoinKind.LeftOuter), "a", {"Actual"}),
            WithF = Table.ExpandTableColumn(Table.NestedJoin(WithA, {"CompanyCode", "ProductKey", "period"}, Fc, {"CompanyCode", "ProductKey", "period"}, "f", JoinKind.LeftOuter), "f", {"Forecast"}),
            Zero = Table.TransformColumns(WithF, {{"Actual", each if _ = null then 0 else _, type number}, {"Forecast", each if _ = null then 0 else _, type number}})
        in
            Table.AddColumn(Zero, "version", each v, type text),
    Prev = Table.TransformColumns(Table.SelectColumns(Act, {"CompanyCode", "ProductKey", "PeriodIndex", "Actual"}, MissingField.UseNull), {{"PeriodIndex", each _ + 1, Int64.Type}}),
    Naive0 = Table.ExpandTableColumn(Table.NestedJoin(Act, {"CompanyCode", "ProductKey", "PeriodIndex"}, Prev, {"CompanyCode", "ProductKey", "PeriodIndex"}, "n", JoinKind.LeftOuter), "n", {"Actual"}, {"Forecast"}),
    Naive = Table.AddColumn(Table.TransformColumns(Naive0, {{"Forecast", each if _ = null then 0 else _, type number}}), "version", each "ساده", type text),
    All = Table.Combine({ForVersion("اجماعی"), ForVersion("آماری"), Naive}),
    Typed = Table.TransformColumnTypes(All, {{"Actual", type number}, {"Forecast", type number}, {"PeriodIndex", Int64.Type}, {"period", Int64.Type}})
in
    Typed


// ===== Query: Budget =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "budgets"), {{"period", Int64.Type}, {"qty", type number}, {"revenue", type number}}, "en-US"),
    Key = Table.AddColumn(Src, "ProductKey", each fnKey([CompanyCode], [productId]), type text),
    P = Table.ExpandTableColumn(Table.NestedJoin(Key, {"ProductKey"}, Product, {"ProductKey"}, "p", JoinKind.LeftOuter), "p", {"unitWeightKg"}),
    Tons = Table.AddColumn(P, "Tons", each [qty] * (if [unitWeightKg] = null then 0 else [unitWeightKg]) / 1000, type number)
in
    Table.SelectColumns(Tons, {"CompanyCode", "period", "ProductKey", "qty", "revenue", "Tons"}, MissingField.UseNull)


// ===== Query: Inventory =====
let
    Src = Table.TransformColumnTypes(fnCsv(DataFolder, "inventory"), {{"qty", type number}}, "en-US"),
    Key = Table.AddColumn(Src, "ProductKey", each fnKey([CompanyCode], [productId]), type text)
in
    Table.Group(Key, {"CompanyCode", "ProductKey"}, {{"OnHand", each List.Sum([qty]), type number}})


// ===== Query: Plan  (خروجی پایتون FactPlan + ستون‌های سود و زیان) =====
let
    Src = Table.TransformColumnTypes(fnCsv(OutputFolder, "FactPlan"), {{"period", Int64.Type}, {"demand", type number}, {"safetyStock", type number},
        {"production", type number}, {"prebuild", type number}, {"overtime", type number}, {"alt", type number}, {"inventoryEnd", type number},
        {"shortage", type number}, {"relError", type number}, {"openingInventory", type number}}, "en-US"),
    Key = Table.AddColumn(Src, "ProductKey", each fnKey([CompanyCode], [productId]), type text),
    P = Table.ExpandTableColumn(Table.NestedJoin(Key, {"ProductKey"}, Product, {"ProductKey"}, "p", JoinKind.LeftOuter), "p", {"unitPrice", "unitCost", "unitWeightKg"}),
    C = Table.ExpandTableColumn(Table.NestedJoin(P, {"CompanyCode"}, Company, {"CompanyCode"}, "c", JoinKind.LeftOuter), "c", {"CycleIndex", "priceInflation", "costInflation", "holdingRate", "AvgDiscount"}),
    U = Table.ExpandTableColumn(Table.NestedJoin(C, {"ProductKey"}, UnitCost, {"ProductKey"}, "u", JoinKind.LeftOuter), "u", {"matDom", "matImp", "matIc", "conv", "overhead"}),
    B = Table.ExpandTableColumn(Table.NestedJoin(U, {"ProductKey", "period"}, Budget, {"ProductKey", "period"}, "b", JoinKind.LeftOuter), "b", {"qty", "revenue"}, {"BudgetQty", "BudgetRevenue"}),
    Idx = Table.AddColumn(B, "PeriodIndex", each Number.IntegerDivide([period], 100) * 12 + Number.Mod([period], 100), Int64.Type),
    MonthNo = Table.AddColumn(Idx, "MonthNo", each [PeriodIndex] - [CycleIndex], Int64.Type),   // ۰ = ماه چرخه
    Sold = Table.AddColumn(MonthNo, "Sold", each List.Max({0, [demand] - [shortage]}), type number),
    Price = Table.AddColumn(Sold, "PriceNet", each [unitPrice] * Number.Power(1 + [priceInflation], [MonthNo]) * (1 - [AvgDiscount]), type number),
    Infl = Table.AddColumn(Price, "CostInfl", each Number.Power(1 + [costInflation], [MonthNo]), type number),
    Hold = Table.AddColumn(Infl, "HoldingCost", each [inventoryEnd] * [unitCost] * [CostInfl] * [holdingRate], type number),
    HasB = Table.AddColumn(Hold, "HasBudgetRow", each if [BudgetQty] <> null then 1 else 0, Int64.Type),
    BudPrice = Table.AddColumn(HasB, "BudgetPrice", each if [BudgetQty] <> null and [BudgetQty] <> 0 then [BudgetRevenue] / [BudgetQty] else null, type number),
    BudCogs = Table.AddColumn(BudPrice, "BudgetCogs", each if [BudgetQty] = null then 0 else [BudgetQty] * [unitCost] * [CostInfl], type number)
in
    BudCogs


// ===== Query: UnitCost  (خروجی پایتون FactUnitCost: مواد داخلی/وارداتی/درون‌گروهی، تبدیل، سربار) =====
let
    Src = Table.TransformColumnTypes(fnCsv(OutputFolder, "FactUnitCost"), {{"matDom", type number}, {"matImp", type number}, {"matIc", type number}, {"conv", type number}, {"overhead", type number}, {"std", type number}}, "en-US"),
    Key = Table.AddColumn(Src, "ProductKey", each fnKey([CompanyCode], [productId]), type text)
in
    Key


// ===== Query: ResourceLoad  (خروجی پایتون) =====
let
    Src = Table.TransformColumnTypes(fnCsv(OutputFolder, "FactResourceLoad"), {{"period", Int64.Type}, {"capacityHours", type number}, {"hours", type number}, {"overtimeHours", type number}, {"utilization", type number}}, "en-US"),
    Key = Table.AddColumn(Src, "ResourceKey", each fnKey([CompanyCode], [resourceId]), type text),
    Util0 = Table.TransformColumns(Key, {{"utilization", each if _ = null then 0 else _, type number}}),
    C = Table.ExpandTableColumn(Table.NestedJoin(Util0, {"CompanyCode"}, Company, {"CompanyCode"}, "c", JoinKind.LeftOuter), "c", {"CycleIndex", "costInflation", "overtimePremium"}),
    MonthNo = Table.AddColumn(C, "MonthNo", each Number.IntegerDivide([period], 100) * 12 + Number.Mod([period], 100) - [CycleIndex], Int64.Type),
    Infl = Table.AddColumn(MonthNo, "CostInfl", each Number.Power(1 + [costInflation], [MonthNo]), type number)
in
    Infl


// ===== Query: MRP  (خروجی پایتون) =====
let
    Src = Table.TransformColumnTypes(fnCsv(OutputFolder, "FactMRP"), {{"period", Int64.Type}, {"gross", type number}, {"net", type number}, {"plannedReceipt", type number},
        {"plannedRelease", type number}, {"projected", type number}, {"safetyStock", type number}, {"leadMonths", Int64.Type}}, "en-US"),
    Key = Table.AddColumn(Src, "MaterialKey", each fnKey([CompanyCode], [materialId]), type text),
    M = Table.ExpandTableColumn(Table.NestedJoin(Key, {"MaterialKey"}, Material, {"MaterialKey"}, "m", JoinKind.LeftOuter), "m", {"unitCost", "uom", "CostOrigin"}),
    // تن برای جریان‌های درون‌گروهی
    Tons = Table.AddColumn(M, "ReceiptTons", each if [uom] = "کیلوگرم" then [plannedReceipt] / 1000 else if [uom] = "تن" then [plannedReceipt] else 0, type number)
in
    Tons


// ===== Query: ForecastMetrics / Scenario / PnLCheck  (خروجی پایتون؛ همان الگو) =====
//  ForecastMetrics = fnCsv(OutputFolder, "FactForecastMetrics")  + ProductKey
//  Scenario        = fnCsv(OutputFolder, "FactScenario")
//  PnLCheck        = fnCsv(OutputFolder, "FactPnL")   (برای کنترل اعداد DAX با محاسبه پایتون)


// ===== Query: Actions / CycleSteps / Adjustments  (جدول‌های فرایند؛ بدون محاسبه) =====
//  Actions    = fnCsv(DataFolder, "actions")
//  CycleSteps = fnCsv(DataFolder, "cycleSteps")
//  Adjustments= fnCsv(DataFolder, "demandAdjustments")


// ===== Query: UnitSelector  (جدول کمکی بی‌ارتباط برای تغییر واحد نمایش) =====
#table(type table [Unit = text, Order = Int64.Type], {{"مقدار", 1}, {"تن", 2}, {"مبلغ", 3}})
