/** 远程岗位识别：区分「明确远程」「疑似远程」「不是远程」 */

const STRONG = /(远程办公|远程工作|可远程|支持远程|接受远程|全职远程|完全远程|纯线上|线上办公|居家办公|在家办公|异地办公|不限地点|全球远程|remote(?:\s*(?:work|job|position))?|work\s*from\s*home|wfh)/i;

/** “远程审计室”“远程汽车”这类词不是远程岗位 */
const FALSE = /远程(审计|监控|医疗|会诊|教育|培训|运维|支持|桌面|协助|诊断|操控|银行|柜台|汽车|新能源|面试|复试|笔试|入职)/;

const TITLE_STRONG = /[（(【\[]\s*远程\s*[）)】\]]|远程[·\-—]|[·\-—]远程|远程$/;

export function classifyRemote(job) {
  const tags = Array.isArray(job.tags) ? job.tags : [];
  const text = [job.title || '', ...tags, job.company || '', job.jd || ''].join(' ');

  if (FALSE.test(text)) return 'no';
  if (STRONG.test(text)) return 'yes';
  if (TITLE_STRONG.test(job.title || '')) return 'yes';
  if (tags.some(t => /^(远程|远程办公|可远程|全职远程)$/.test(String(t).trim()))) return 'yes';
  if (/远程/.test(text)) return 'maybe';
  return 'no';
}


/** 岗位名/标签是否与画像关键词相关（远程搜索会带回大量跨行业岗位，用它兜底） */
export function matchesKeywords(job, keywords) {
  const text = `${job.title || ''} ${(Array.isArray(job.tags) ? job.tags : []).join(' ')}`.toLowerCase();
  for (const raw of keywords || []) {
    const k = String(raw || '').toLowerCase().trim();
    if (!k) continue;
    if (text.includes(k)) return true;
    // 中文长关键词取前两个字作为领域词：量化研究员 → 量化
    const core = k.slice(0, 2);
    if (/[\u4e00-\u9fa5]/.test(core) && core.length >= 2 && text.includes(core)) return true;
  }
  return false;
}
