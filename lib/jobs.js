/** 岗位集合的合并、清理、筛选与 CSV 导出（纯函数） */
import { localDate, formatSalaryText } from './parse.js';

const DAY = 86400e3;

/**
 * 合并新抓取结果
 * @param {Record<string, object>} existing
 * @param {object[]} incoming 已打分、带 id
 * @returns {{jobs:Record<string,object>, added:number, updated:number}}
 */
export function mergeJobs(existing, incoming, now = Date.now()) {
  const jobs = { ...(existing || {}) };
  const today = localDate(now);
  let added = 0;
  let updated = 0;
  for (const job of incoming || []) {
    if (!job || !job.id) continue;
    const prev = jobs[job.id];
    if (prev) {
      jobs[job.id] = {
        ...prev,
        ...job,
        firstSeen: prev.firstSeen,
        firstSeenDate: prev.firstSeenDate,
        status: prev.status || 'new',
        note: prev.note || ''
      };
      updated++;
    } else {
      jobs[job.id] = {
        ...job,
        status: 'new',
        firstSeen: now,
        firstSeenDate: today,
        lastSeen: now,
        lastSeenDate: today
      };
      added++;
    }
  }
  return { jobs, added, updated };
}

/** 清理多天未再出现的岗位，防止无限膨胀 */
export function pruneJobs(jobs, days = 60, now = Date.now()) {
  const out = {};
  const cutoff = now - days * DAY;
  let removed = 0;
  for (const [id, job] of Object.entries(jobs || {})) {
    const seen = job.lastSeen || job.firstSeen || 0;
    if (job.status === 'saved' || job.status === 'applied' || seen >= cutoff) {
      out[id] = job;
    } else {
      removed++;
    }
  }
  return { jobs: out, removed };
}

export function isToday(job, today = localDate()) {
  return job && job.firstSeenDate === today;
}

/**
 * @param {object[]} jobs
 * @param {{scope?:string, q?:string, includeIgnored?:boolean}} opts
 */
export function filterJobs(jobs, opts = {}) {
  const { scope = 'today', q = '', includeIgnored = false } = opts;
  const today = localDate();
  const query = q.trim().toLowerCase();
  return jobs
    .filter(job => {
      if (job.status === 'ignored' && !includeIgnored && scope !== 'ignored') return false;
      if (scope === 'today' && !isToday(job, today)) return false;
      if (scope === 'strong' && job.tier !== 'strong') return false;
      if (scope === 'good' && job.tier !== 'good') return false;
      if (scope === 'saved' && job.status !== 'saved') return false;
      if (scope === 'ignored' && job.status !== 'ignored') return false;
      if (scope === 'all' && job.tier === 'excluded') return false;
      if (query) {
        const hay = `${job.title} ${job.company} ${job.city} ${(job.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.firstSeen || 0) - (a.firstSeen || 0));
}

/** 今日概览 */
export function summarize(jobs, today = localDate()) {
  const list = Object.values(jobs || {});
  const todayJobs = list.filter(j => j.firstSeenDate === today);
  const strong = todayJobs.filter(j => j.tier === 'strong');
  return {
    total: list.length,
    today: todayJobs.length,
    todayStrong: strong.length,
    todayGood: todayJobs.filter(j => j.tier === 'good').length,
    saved: list.filter(j => j.status === 'saved').length,
    ignored: list.filter(j => j.status === 'ignored').length,
    applied: list.filter(j => j.status === 'applied').length
  };
}

const CSV_COLUMNS = [
  ['站点', j => j.siteName || j.site],
  ['职位', j => j.title],
  ['公司', j => j.company],
  ['薪资', j => formatSalaryText(j)],
  ['城市', j => j.city],
  ['经验', j => j.experience],
  ['学历', j => j.education],
  ['标签', j => (j.tags || []).join(' / ')],
  ['匹配分', j => j.score],
  ['推荐理由', j => (j.reasons || []).join('；')],
  ['状态', j => statusText(j.status)],
  ['首次发现', j => new Date(j.firstSeen || Date.now()).toLocaleString('zh-CN')],
  ['链接', j => j.url]
];

function statusText(s) {
  return { new: '未处理', saved: '已收藏', ignored: '已忽略', applied: '已投递' }[s] || '未处理';
}

function csvCell(v) {
  const s = v == null ? '' : String(v).replace(/\r?\n/g, ' ');
  if (/[",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(jobs) {
  const rows = [CSV_COLUMNS.map(c => c[0]).join(',')];
  for (const job of jobs) {
    rows.push(CSV_COLUMNS.map(c => csvCell(c[1](job))).join(','));
  }
  return rows.join('\r\n');
}
