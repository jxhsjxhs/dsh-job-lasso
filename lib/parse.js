/**
 * 纯函数工具：薪资 / 经验 / 城市 / 时间 / 哈希。
 * 不依赖 chrome API，可在 Node 中直接测试。
 */

const CN_NUM = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function toNumber(s) {
  if (s == null) return NaN;
  s = String(s).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return NaN;
}

/** 统一全角字符，压缩空白 */
export function clean(s) {
  return String(s == null ? '' : s)
    .replace(/\u00a0|\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * 解析薪资文本 → 月薪 K 区间
 * 支持：30-50K·14薪 / 20K-40K / 15-25千 / 1.5-2万 / 20-30万/年 / 200-300元/天 / 30K以上
 * @returns {{min:number|null,max:number|null,months:number|null,unit:string,raw:string}}
 */
export function parseSalary(input) {
  const raw = clean(input).replace(/\s+/g, '');
  const out = { min: null, max: null, months: null, unit: '', raw: clean(input) };
  if (!raw) return out;

  const monthMatch = raw.match(/(\d{2})薪/);
  if (monthMatch) out.months = Number(monthMatch[1]);

  if (/面议|保密|薪资面议/.test(raw)) return out;

  let unit = 'K';
  let factor = 1; // 数字 → 月薪 K 的系数
  if (/万\/年|万每年|万元\/年/.test(raw)) { unit = '万/年'; factor = 10 / 12; }
  else if (/元\/天|元每天|天/.test(raw) && /元/.test(raw)) { unit = '元/天'; factor = 21.75 / 1000; }
  else if (/元\/月/.test(raw)) { unit = '元/月'; factor = 1 / 1000; }
  else if (/万/.test(raw)) { unit = '万/月'; factor = 10; }
  else if (/千/.test(raw)) { unit = '千'; factor = 1; }
  else if (/[kK]/.test(raw)) { unit = 'K'; factor = 1; }
  out.unit = unit;

  const nums = (raw.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => Number.isFinite(n));
  // 去掉 14薪 里的 14
  const salaryNums = nums.filter(n => !(out.months && n === out.months && /薪/.test(raw)));
  if (!salaryNums.length) return out;

  if (salaryNums.length >= 2) {
    let a = salaryNums[0] * factor;
    let b = salaryNums[1] * factor;
    // 处理 "1.5-2万" 这种小数
    if (a > b) [a, b] = [b, a];
    out.min = round1(a);
    out.max = round1(b);
  } else {
    out.min = round1(salaryNums[0] * factor);
    out.max = null;
  }
  if (out.min != null && out.min <= 0) out.min = null;
  if (out.max != null && out.max <= 0) out.max = null;
  return out;
}

function round1(n) {
  return Math.round(n * 10 + 1e-9) / 10;
}

/**
 * 解析经验要求 → 年区间
 * 3-5年 / 1-3年 / 5年以上 / 经验不限 / 应届 / 3年以内
 */
export function parseExperience(input) {
  const s = clean(input);
  if (!s) return null;
  if (/不限|无经验|经验不限/.test(s)) return { min: 0, max: 99, raw: s };
  if (/应届|在校/.test(s)) return { min: 0, max: 1, raw: s };
  let m = s.match(/(\d+)\s*[-~—到]\s*(\d+)\s*年/);
  if (m) return { min: Number(m[1]), max: Number(m[2]), raw: s };
  m = s.match(/(\d+)\s*年(?:以上|及以上|\+)/);
  if (m) return { min: Number(m[1]), max: 99, raw: s };
  m = s.match(/(\d+)\s*年以内/);
  if (m) return { min: 0, max: Number(m[1]), raw: s };
  m = s.match(/(\d+)\s*年/);
  if (m) return { min: Number(m[1]), max: Number(m[1]), raw: s };
  return null;
}

/** "上海·浦东新区" / "上海-浦东" → { city:'上海', district:'浦东新区' } */
export function splitCity(input) {
  const s = clean(input);
  if (!s) return { city: '', district: '' };
  const m = s.match(/^(.+?)[·\-—\s]\s*(.+)$/);
  const city = (m ? m[1] : s).replace(/市$/, '').trim();
  const district = m ? m[2].trim() : '';
  return { city, district };
}

export function cityMatches(jobCity, targetCity) {
  if (!targetCity || targetCity === '全国') return true;
  if (!jobCity) return true; // 未知城市不直接淘汰，交给人工判断
  const a = String(jobCity).replace(/市$/, '');
  const b = String(targetCity).replace(/市$/, '');
  return a.includes(b) || b.includes(a);
}

export function parseEducation(input) {
  const s = clean(input);
  const m = s.match(/博士|硕士|本科|大专|中专|高中|学历不限/);
  return m ? m[0] : '';
}

const EDU_RANK = { 学历不限: 0, 高中: 1, 中专: 1, 大专: 2, 本科: 3, 硕士: 4, 博士: 5 };

export function educationRank(edu) {
  return EDU_RANK[edu] ?? 0;
}

export function hashString(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 本地日期 YYYY-MM-DD（不受 UTC 影响） */
export function localDate(ts = Date.now()) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function localTime(ts = Date.now()) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatSalaryText(job) {
  if (job.salaryText) return job.salaryText;
  if (job.salaryMin != null && job.salaryMax != null) return `${job.salaryMin}-${job.salaryMax}K`;
  if (job.salaryMin != null) return `${job.salaryMin}K+`;
  return '薪资未知';
}

/** 相对时间："3 分钟前" */
export function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
  return `${Math.floor(diff / 86400e3)} 天前`;
}

/** 从职位 URL 提取站内 ID（BOSS /job_detail/xxx.html，猎聘 /job/123.shtml） */
export function jobIdFromUrl(url) {
  if (!url) return '';
  let m = url.match(/job_detail\/([^/?#.]+)\.html/);
  if (m) return m[1];
  m = url.match(/\/job\/([^/?#.]+)\.s?html/);
  if (m) return m[1];
  m = url.match(/[?&]jobId=([^&#]+)/);
  if (m) return m[1];
  return '';
}
