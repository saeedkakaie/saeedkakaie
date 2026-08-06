# -*- coding: utf-8 -*-
"""
موتور عارضه‌یابی و پاکسازی بانک کالای فعلی.

این ماژول مستقیماً از اسکریپت تایید‌شده‌ی «پاکسازی_بانک_کالا.py» (اجراشده روی
۷۳٬۵۸۷ ردیف داده‌ی واقعی هلدینگ) استخراج شده و به‌صورت کتابخانه‌ای قابل‌فراخوانی
از سرویس FastAPI درآمده — منطق الگوریتم‌ها بدون تغییر باقی مانده است.
"""
import re
from collections import defaultdict

import pandas as pd

# ---------------------------------------------------------------
# نرمال‌سازی متن فارسی/عربی (طبق سند فنی، بخش ۳)
# ---------------------------------------------------------------
AR_YE, FA_YE = 'ي', 'ی'
AR_KE, FA_KE = 'ك', 'ک'
AR_HEH, FA_HEH = 'ة', 'ه'
FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
ASCII_DIGITS = '0123456789'
DIGIT_MAP = {ord(f): a for f, a in zip(FA_DIGITS, ASCII_DIGITS)}
DIGIT_MAP.update({ord(f): a for f, a in zip(AR_DIGITS, ASCII_DIGITS)})

REQUIRED_COLUMNS = {'پلنت', 'Material Group', 'کد کالا', 'شرح کالا', 'واحد'}


def normalize(s):
    if not isinstance(s, str):
        return ''
    s = s.translate(DIGIT_MAP)
    s = s.replace(AR_YE, FA_YE).replace(AR_KE, FA_KE).replace(AR_HEH, FA_HEH)
    s = s.replace('ـ', '')
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def full_clean(s):
    """نسخه‌ی کامل پاکسازی شرح کالا -- برای فیلد «شرح نهایی پیشنهادی»."""
    if not isinstance(s, str):
        return ''
    s = s.translate(DIGIT_MAP)
    s = s.replace(AR_YE, FA_YE).replace(AR_KE, FA_KE).replace(AR_HEH, FA_HEH)
    s = s.replace('ـ', '')
    s = s.replace('"', '')
    s = re.sub(r',(\d)', r'.\1', s)
    s = re.sub(r'\s+', ' ', s).strip()
    if s.startswith('(') and s.count('(') > s.count(')'):
        s = s[1:].strip()
    s = re.sub(r'^[\-\*]\s+', '', s)
    return s


def loose_key(s):
    """کلید نرم: فقط شناسایی تفاوت‌های فاصله‌گذاری/نشانه‌ای؛ نقطه‌ی اعشاری حفظ می‌شود."""
    s = normalize(s).lower()
    s = re.sub(r'(?<=\d)\.(?=\d)', '§DECPOINT§', s)
    s = re.sub(r'[^0-9a-zA-Zآ-ی§DECPOINT]', '', s)
    return s.replace('§DECPOINT§', '.')


def has_quote_issue(s):
    if not isinstance(s, str):
        return False
    return s.count('"') % 2 == 1 or s.startswith('"') or s.strip().endswith('"')


def pick_golden_code(codes, plants_per_code):
    """کدی که در بیشترین پلنت استفاده شده؛ در تساوی، کوچک‌ترین کد."""
    return sorted(codes, key=lambda c: (-plants_per_code.get(c, 0), str(c)))[0]


# ---------------------------------------------------------------
# نگاشت ۶۸ گروه خام -> ۱۸ گروه استاندارد (سند فنی، بخش ۴)
# ---------------------------------------------------------------
GROUP_MAPPING = {
    'IT': 'IT', 'اقلام مصرفی IT': 'IT',
    'آزمایشگاه': 'آزمایشگاه', 'مواد و اقلام آزمایشگ': 'آزمایشگاه', 'تجهیزات آزمایشگاهی': 'آزمایشگاه',
    'ابزارآلات ویراق آلات': 'ابزارآلات و یراق‌آلات',
    'ابزاردقیق': 'ابزاردقیق',
    'اقلام اداری': 'اقلام اداری', 'تبلیغات': 'اقلام اداری', 'چاپ و تکثیر': 'اقلام اداری',
    'اثاثیه اداری': 'اقلام اداری', 'تری': 'اقلام اداری', 'خدماتی': 'اقلام اداری',
    'ضایعات غیرتولیدی': 'اقلام اداری', 'نول': 'اقلام اداری',
    'اقلام خوراکی': 'اقلام خوراکی', 'لوازم پذیرایی': 'اقلام خوراکی',
    'البسه': 'البسه',
    'اموال اداری': 'اموال و تجهیزات ثابت', 'اموال فنی': 'اموال و تجهیزات ثابت',
    'اموال IT': 'اموال و تجهیزات ثابت',
    'HSE': 'ایمنی و بهداشت (HSE)', 'بهداشتی': 'ایمنی و بهداشت (HSE)', 'ایمنی': 'ایمنی و بهداشت (HSE)',
    'ایمنی بهداشت': 'ایمنی و بهداشت (HSE)', 'تجهیزات ایمنی': 'ایمنی و بهداشت (HSE)',
    'برق و الکترونیک': 'برق و الکترونیک',
    'تاسیسات': 'تاسیسات',
    'تولید و بسته بندی': 'تولید و بسته‌بندی', 'اقلام بسته بندی': 'تولید و بسته‌بندی',
    'سلفون': 'تولید و بسته‌بندی', 'کارتن': 'تولید و بسته‌بندی', 'شلف ردی': 'تولید و بسته‌بندی',
    'جعبه': 'تولید و بسته‌بندی',
    'شیمیایی': 'شیمیایی',
    'عمران': 'عمران',
    'لوله و اتصالات': 'لوله و اتصالات', 'لوله و اتصالات - برق': 'لوله و اتصالات',
    'مقاطع و فلزات': 'مقاطع و فلزات', 'آهن آلات': 'مقاطع و فلزات',
    'افزودنی ها و آنزیمها': 'مواد اولیه غذایی', 'طعم دهنده': 'مواد اولیه غذایی',
    'فراورده میوه وخشکبار': 'مواد اولیه غذایی', 'فراورده کاکائویی': 'مواد اولیه غذایی',
    'شورتنینگ': 'مواد اولیه غذایی', 'مواد یوتیلیتی و تصفی': 'مواد اولیه غذایی',
    'رنگ خوراکی': 'مواد اولیه غذایی', 'امولسیفایر': 'مواد اولیه غذایی', 'سمپل/نمونه': 'مواد اولیه غذایی',
    'شیرین کننده،مشتق قند': 'مواد اولیه غذایی', 'ادویه جات': 'مواد اولیه غذایی',
    'استابیلایزر': 'مواد اولیه غذایی', 'فراورده غلات': 'مواد اولیه غذایی', 'حجم دهنده': 'مواد اولیه غذایی',
    'فیلینگ': 'مواد اولیه غذایی', 'کود': 'مواد اولیه غذایی', 'فراورده تخم مرغ': 'مواد اولیه غذایی',
    'فراورده لبنی': 'مواد اولیه غذایی', 'پودر ها': 'مواد اولیه غذایی', 'روغن': 'مواد اولیه غذایی',
    'شکلات': 'مواد اولیه غذایی', 'گندم': 'مواد اولیه غذایی', 'نگهدارنده': 'مواد اولیه غذایی',
    'ذرت': 'مواد اولیه غذایی', 'نشاسته ذرت': 'مواد اولیه غذایی',
    'مکانیک': 'مکانیک', 'اتصالات مکانیک': 'مکانیک',
}

STANDARD_GROUPS = sorted(set(GROUP_MAPPING.values()))


def map_group(raw_group):
    if not isinstance(raw_group, str) or not raw_group.strip():
        return ''
    key = raw_group.strip()
    return GROUP_MAPPING.get(key, key)


# ---------------------------------------------------------------
# قواعد تطابق با استاندارد نگارش جدید (سند فنی، بخش ۵)
# ---------------------------------------------------------------
def check_new_rule_compliance(desc_raw):
    """بررسی می‌کند شرح فعلی با ۱۰ قاعده‌ی نگارش استاندارد جدید همخوانی دارد یا نه.
    خروجی: لیست دلایل عدم‌تطابق (خالی یعنی منطبق است)."""
    reasons = []
    if not isinstance(desc_raw, str) or not desc_raw.strip():
        return ['شرح خالی است']

    if any(ch in desc_raw for ch in (AR_YE, AR_KE, AR_HEH)):
        reasons.append('حروف عربی غیراستاندارد (ي/ك/ة) به‌جای فارسی (ی/ک/ه)')
    if any(ch in desc_raw for ch in FA_DIGITS + AR_DIGITS):
        reasons.append('ارقام فارسی/عربی به‌جای ارقام لاتین')
    if has_quote_issue(desc_raw):
        reasons.append('نقل‌قول ناقص/اضافه در متن')
    if ',' in desc_raw and re.search(r'\d,\d', desc_raw):
        reasons.append('کاما به‌جای نقطه‌ی اعشاری در عدد فنی')
    if re.search(r'\s{2,}', desc_raw):
        reasons.append('فاصله‌گذاری غیراستاندارد (فاصله‌ی تکراری)')
    if re.search(r'[^\s]{1}[،,]\S', desc_raw):
        pass  # جای رشد آینده؛ فعلاً بدون خطا
    if desc_raw.strip().startswith(('-', '*', '(')):
        reasons.append('کاراکتر ابتدایی نامتعارف (-، * یا «(»)')
    if len(desc_raw.strip()) > 40:
        reasons.append('طول شرح بیش از ۴۰ کاراکتر (فیلد شرح کوتاه SAP)')
    if re.search(r'[a-zA-Z][آ-ی]|[آ-ی][a-zA-Z]', desc_raw.replace(' ', '')):
        # حروف فارسی و لاتین چسبیده به هم بدون فاصله - نشانه‌ی فاصله‌گذاری خراب
        reasons.append('چسبیدگی حروف فارسی/لاتین یا عدد بدون فاصله')
    return reasons


# ---------------------------------------------------------------
# موتور اصلی تحلیل (ورودی: DataFrame با ستون‌های استاندارد)
# ---------------------------------------------------------------
def analyze_legacy(df: pd.DataFrame):
    df = df.copy()
    df['desc_norm'] = df['شرح کالا'].apply(normalize)
    df['desc_full_clean'] = df['شرح کالا'].apply(full_clean)
    df['desc_loose'] = df['شرح کالا'].apply(loose_key)
    df['group_mapped'] = df['Material Group'].apply(map_group)

    # واحد ناهماهنگ بین پلنت‌ها برای همان کد
    codes_multi_unit = set(df.groupby('کد کالا')['واحد'].nunique().pipe(lambda s: s[s > 1]).index)

    # تکرار دقیق: desc_full_clean یکسان، کد متفاوت
    desc_code_count = df.groupby('desc_full_clean')['کد کالا'].nunique()
    dup_desc_idx = set(desc_code_count[desc_code_count > 1].index)

    # تکرار نرم: فقط با loose_key پیدا می‌شود
    loose_code_count = df.groupby('desc_loose')['کد کالا'].nunique()
    dup_loose_idx = set(loose_code_count[loose_code_count > 1].index)

    clusters = []  # دیکشنری‌های خام کلاستر
    code_to_golden = {}
    desc_to_cluster_idx = {}

    for desc, grp in df[df['desc_full_clean'].isin(dup_desc_idx)].groupby('desc_full_clean'):
        codes = sorted(grp['کد کالا'].unique().tolist(), key=str)
        plants_per_code = grp.groupby('کد کالا')['پلنت'].nunique().to_dict()
        golden = pick_golden_code(codes, plants_per_code)
        groups = sorted(set(g for g in grp['group_mapped'].unique() if g))
        units = sorted(set(grp['واحد'].dropna().unique().tolist()))
        idx = len(clusters)
        clusters.append({
            'kind': 'exact',
            'normalized_desc': desc,
            'codes': codes,
            'golden_code': golden,
            'group_conflict': len(groups) > 1,
            'unit_conflict': len(units) > 1,
        })
        for c in codes:
            code_to_golden[c] = golden
        desc_to_cluster_idx[('exact', desc)] = idx

    for lk, grp in df[df['desc_loose'].isin(dup_loose_idx)].groupby('desc_loose'):
        codes = sorted(grp['کد کالا'].unique().tolist(), key=str)
        if len(codes) < 2:
            continue
        # اگر همه‌ی این کدها از قبل در همان خوشه‌ی دقیق پوشش داده شده‌اند، رد شو
        if grp['desc_full_clean'].nunique() == 1 and grp['desc_full_clean'].iloc[0] in dup_desc_idx:
            continue
        plants_per_code = grp.groupby('کد کالا')['پلنت'].nunique().to_dict()
        golden = pick_golden_code(codes, plants_per_code)
        groups = sorted(set(g for g in grp['group_mapped'].unique() if g))
        units = sorted(set(grp['واحد'].dropna().unique().tolist()))
        idx = len(clusters)
        clusters.append({
            'kind': 'loose',
            'normalized_desc': lk,
            'codes': codes,
            'golden_code': golden,
            'group_conflict': len(groups) > 1,
            'unit_conflict': len(units) > 1,
        })
        for c in codes:
            code_to_golden.setdefault(c, golden)
        desc_to_cluster_idx[('loose', lk)] = idx

    records = []
    for _, r in df.iterrows():
        reasons = check_new_rule_compliance(r['شرح کالا'])
        code = r['کد کالا']
        cluster_idx = desc_to_cluster_idx.get(('exact', r['desc_full_clean']))
        if cluster_idx is None:
            cluster_idx = desc_to_cluster_idx.get(('loose', r['desc_loose']))
        records.append({
            'plant': r.get('پلنت', ''),
            'material_group_raw': r.get('Material Group', ''),
            'material_group_mapped': r['group_mapped'],
            'code': str(code),
            'description_raw': r['شرح کالا'],
            'description_normalized': r['desc_full_clean'],
            'unit': r.get('واحد', ''),
            'quote_issue': has_quote_issue(r['شرح کالا']),
            'needs_text_normalization': r['شرح کالا'] != r['desc_full_clean'],
            'group_missing': not bool(str(r.get('Material Group', '')).strip()) or pd.isna(r.get('Material Group')),
            'unit_conflict': code in codes_multi_unit,
            'duplicate_exact': r['desc_full_clean'] in dup_desc_idx,
            'duplicate_loose': (cluster_idx is not None) and clusters[cluster_idx]['kind'] == 'loose',
            'non_compliant_new_rule': len(reasons) > 0,
            'non_compliance_reasons': reasons,
            'cluster_idx': cluster_idx,
            'suggested_final_code': code_to_golden.get(code, str(code)),
        })

    kpi = {
        'کل ردیف‌ها': len(df),
        'کد کالای یکتا': int(df['کد کالا'].nunique()),
        'خوشه تکرار دقیق': sum(1 for c in clusters if c['kind'] == 'exact'),
        'خوشه تکرار نرم (فرمتی)': sum(1 for c in clusters if c['kind'] == 'loose'),
        'خوشه با ناهماهنگی گروه': sum(1 for c in clusters if c['group_conflict']),
        'کد با ناهماهنگی واحد بین پلنت‌ها': len(codes_multi_unit),
        'ردیف با خرابی نقل‌قول': int(df['شرح کالا'].apply(has_quote_issue).sum()),
        'ردیف نیازمند نرمال‌سازی متن': int((df['شرح کالا'] != df['desc_full_clean']).sum()),
        'ردیف با گروه خالی': int(df['Material Group'].isna().sum() + (df['Material Group'].astype(str).str.strip() == '').sum()),
        'ردیف ناسازگار با استاندارد نگارش جدید': sum(1 for r in records if r['non_compliant_new_rule']),
    }

    return {'kpi': kpi, 'clusters': clusters, 'records': records}


def read_input_dataframe(path_or_buffer):
    df = pd.read_excel(path_or_buffer)
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f'ستون‌های زیر در فایل ورودی یافت نشد: {missing}')
    return df
