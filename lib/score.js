/**
 * 匹配打分：纯函数，不依赖 chrome API。
 */
import { cityMatches, educationRank } from './parse.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * @param {object} job 已归一化的岗位（title/company/city/tags/salaryMin/salaryMax/expMin/expMax/education/hrActive）
 * @param {object} profile 求职画像
 * @returns {{score:number, reasons:string[], excluded:boolean, excludeReason:string, tier:string}}
 */
export function scoreJob(job, profile) {
  const p = profile || {};
  const reasons = [];
  let score = 40;
  let excluded = false;
  let excludeReason = '';

  const title = String(job.title || '');
  const company = String(job.company || '');
  const tags = Array.isArray(job.tags) ? job.tags : [];
  const hay = [title, company, ...tags, job.jd || ''].join(' ').toLowerCase();

  // ---------- 排除项 ----------
  const excludeWords = (p.exclude || []).filter(Boolean);
  const hitExclude = excludeWords.find(w => hay.includes(String(w).toLowerCase()));
  const blackCompany = (p.companyBlacklist || []).filter(Boolean).find(w =>
    company.toLowerCase().includes(String(w).toLowerCase())
  );
  if (hitExclude) {
    excluded = true;
    excludeReason = `命中排除词「${hitExclude}」`;
    score -= 45;
  }
  if (blackCompany) {
    excluded = true;
    excludeReason = `公司黑名单「${blackCompany}」`;
    score -= 60;
  }

  // ---------- 岗位关键词 ----------
  const kws = (p.keywords || []).filter(Boolean);
  const titleHits = kws.filter(k => title.toLowerCase().includes(String(k).toLowerCase()));
  if (titleHits.length) {
    score += 16 + Math.min(titleHits.length - 1, 2) * 3;
    reasons.push(`职位名命中「${titleHits.slice(0, 2).join('、')}」`);
  } else {
    const bodyHit = kws.find(k => hay.includes(String(k).toLowerCase()));
    if (bodyHit) {
      score += 6;
      reasons.push(`描述提到「${bodyHit}」`);
    } else if (kws.length) {
      score -= 6;
    }
  }

  // ---------- 技能 ----------
  const skills = (p.skills || []).filter(Boolean);
  const skillHits = skills.filter(s => hay.includes(String(s).toLowerCase()));
  if (skillHits.length) {
    score += Math.min(skillHits.length * 4, 12);
    reasons.push(`技能命中 ${skillHits.slice(0, 3).join('、')}`);
  }

  // ---------- 薪资 ----------
  const wantMin = Number(p.salaryMin) || 0;
  const wantMax = Number(p.salaryMax) || 0;
  const jobMin = job.salaryMin != null ? Number(job.salaryMin) : null;
  const jobMax = job.salaryMax != null ? Number(job.salaryMax) : jobMin;
  if (jobMin != null && wantMin) {
    const top = jobMax != null ? jobMax : jobMin;
    if (top >= wantMin) {
      const lowOk = jobMin >= wantMin * 0.85;
      score += lowOk ? 10 : 5;
      reasons.push(`薪资 ${formatRange(jobMin, jobMax)} 覆盖期望 ${wantMin}-${wantMax || '∞'}K`);
    } else {
      const gap = wantMin - top;
      if (gap <= 5) score -= 10;
      else score -= 16;
      reasons.push(`薪资 ${formatRange(jobMin, jobMax)} 低于期望`);
    }
    if (wantMax && jobMin > wantMax * 1.5) score += 3; // 高出预期很多，仍值得看
  }
  if (job.salaryMonths && job.salaryMonths >= 14) score += 2;

  // ---------- 城市 ----------
  if (job.city) {
    if (cityMatches(job.city, p.city)) {
      score += 6;
      if (p.city && p.city !== '全国') reasons.push(`同城 · ${job.city}`);
    } else {
      score -= 22;
      reasons.push(`城市不符（${job.city}）`);
    }
  }

  // ---------- 经验 / 学历 ----------
  const years = Number(p.experienceYears);
  if (Number.isFinite(years) && job.expMin != null) {
    const lo = Number(job.expMin);
    const hi = job.expMax != null ? Number(job.expMax) : 99;
    if (lo <= years + 1 && hi >= years - 1) {
      score += 4;
      if (hi < 99) reasons.push(`经验 ${lo}-${hi} 年对得上`);
    } else if (lo > years + 1) {
      score -= 10;
      reasons.push(`经验门槛 ${lo} 年+，偏高`);
    } else if (hi < years - 2) {
      score -= 6;
      reasons.push('职级可能偏低');
    }
  }

  if (job.education && p.education) {
    const need = educationRank(job.education);
    const mine = educationRank(p.education);
    if (need > mine) {
      score -= 12;
      reasons.push(`学历要求 ${job.education}`);
    }
  }

  // ---------- 远程 ----------
  if (job.remote === 'yes') {
    score += 18;
    reasons.push('明确远程岗位');
  } else if (job.remote === 'maybe') {
    score += 6;
    reasons.push('疑似远程，需确认');
  } else if (p.remoteOnly) {
    score -= 30;
  }

  // ---------- 活跃度 ----------
  if (job.hrActive && /刚刚|今日|本周|今日活跃/.test(job.hrActive)) {
    score += 2;
    reasons.push(job.hrActive.includes('刚刚') ? 'HR 刚刚活跃' : 'HR 近期活跃');
  }

  score = clamp(Math.round(score), 0, 100);

  let tier = 'low';
  if (excluded) tier = 'excluded';
  else if (score >= (Number(p.strongThreshold) || 78)) tier = 'strong';
  else if (score >= (Number(p.goodThreshold) || 62)) tier = 'good';

  return {
    score,
    reasons: [...new Set(reasons)].slice(0, 5),
    excluded,
    excludeReason,
    tier
  };
}

function formatRange(min, max) {
  if (max == null || max === min) return `${min}K`;
  return `${min}-${max}K`;
}
