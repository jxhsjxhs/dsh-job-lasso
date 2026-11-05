/**
 * 站点抓取：用本机 Chrome 的 --dump-dom 拿到渲染后的 DOM，再用正则解析岗位卡片。
 * 不依赖第三方库；登录态保存在插件自己的 Chrome profile 里。
 */
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cityCode } from './cities.js';

export const SITES = {
  boss: {
    key: 'boss',
    name: 'BOSS直聘',
    kind: 'browser',
    login: 'https://www.zhipin.com/web/geek/job',
    home: 'https://www.zhipin.com'
  },
  liepin: {
    key: 'liepin',
    name: '猎聘',
    kind: 'browser',
    login: 'https://www.liepin.com/user/login/',
    home: 'https://www.liepin.com'
  },
  lagou: {
    key: 'lagou',
    name: '拉勾',
    kind: 'browser',
    login: 'https://www.lagou.com/wn/zhaopin',
    home: 'https://www.lagou.com/'
  },
  eleduck: {
    key: 'eleduck',
    name: '电鸭社区',
    kind: 'feed',
    home: 'https://eleduck.com'
  },
  linkedin: {
    key: 'linkedin',
    name: 'LinkedIn 领英',
    kind: 'feed',
    home: 'https://www.linkedin.com/jobs/'
  },
  v2ex: {
    key: 'v2ex',
    name: 'V2EX 酷工作',
    kind: 'feed',
    home: 'https://www.v2ex.com/go/jobs'
  }
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

export function detectChrome() {
  for (const p of CHROME_CANDIDATES) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function chromeProfileDir(dataDir, site = 'boss') {
  const allowed = ['boss', 'liepin', 'lagou', 'linkedin', 'eleduck'];
  const safe = allowed.includes(site) ? site : 'boss';
  return path.join(dataDir, `chrome-profile-${safe}`);
}

export function buildSearchUrl(site, keyword, city) {
  const kw = encodeURIComponent(keyword);
  if (site === 'boss') {
    return `https://www.zhipin.com/web/geek/job?query=${kw}&city=${cityCode(city, 'boss') || '100010000'}`;
  }
  if (site === 'lagou') {
    return `https://www.lagou.com/wn/zhaopin?kd=${kw}&city=${encodeURIComponent(city || '全国')}`;
  }
  const code = cityCode(city, 'liepin');
  return `https://www.liepin.com/zhaopin/?key=${kw}${code ? `&dqs=${code}` : ''}`;
}

function baseArgs(dataDir, site) {
  return [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--hide-scrollbars',
    '--window-size=1400,1000',
    '--lang=zh-CN',
    `--user-data-dir=${chromeProfileDir(dataDir, site)}`,
    '--profile-directory=Default',
    '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'
  ];
}

/** 杀掉使用本插件 profile 的 Chrome（避免 profile 被占用） */
export async function killProfileChrome(dataDir, site = 'boss') {
  const dir = chromeProfileDir(dataDir, site);
  await new Promise(resolve => {
    execFile('pkill', ['-f', dir], () => resolve());
  });
  await new Promise(r => setTimeout(r, 400));
}

/** 打开可见的登录窗口 */
export async function openLoginWindow(site, dataDir) {
  const chrome = detectChrome();
  if (!chrome) throw new Error('没有找到 Chrome，请先安装 Google Chrome');
  await killProfileChrome(dataDir, site);
  const url = SITES[site]?.login || SITES.boss.login;
  const child = spawn(chrome, [...baseArgs(dataDir, site), url], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return { pid: child.pid, url };
}

/** 用无头 Chrome 渲染页面并导出 DOM */
export async function dumpDom(url, dataDir, site = 'boss', { timeoutMs = 75000 } = {}) {
  const chrome = detectChrome();
  if (!chrome) throw new Error('没有找到 Chrome，请先安装 Google Chrome');
  const extra = site === 'boss'
    ? ['--timeout=25000']
    : ['--virtual-time-budget=15000'];
  const args = [
    '--headless=new',
    ...baseArgs(dataDir, site),
    ...extra,
    '--run-all-compositor-stages-before-draw',
    '--dump-dom',
    url
  ];
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e);
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`Chrome 抓取超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (!out) {
        reject(new Error(`Chrome 没有返回页面（exit ${code}）：${err.slice(0, 300)}`));
        return;
      }
      resolve(out);
    });
  });
}

/* ------------------------------ 解析工具 ------------------------------ */

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function matchText(block, re) {
  const m = block.match(re);
  return m ? stripTags(m[1]) : '';
}

const CITY_RE = /^(北京|上海|广州|深圳|杭州|成都|南京|武汉|苏州|天津|重庆|西安|长沙|郑州|青岛|济南|合肥|厦门|福州|宁波|东莞|佛山|无锡|大连|沈阳|昆明|哈尔滨|长春|石家庄|太原|南昌|贵阳|南宁|珠海|香港|全国)([·\-\s].*)?$/;
const EXP_RE = /^\d+\s*[-~—到]\s*\d+\s*年$|^\d+\s*年以上$|^经验不限$|^应届|^在校/;
const EDU_RE = /^(博士|硕士|本科|大专|中专|高中|学历不限)$/;
const ACTIVE_RE = /(刚刚|今日|本周|本月|\d日内|当前)\s*(活跃|在线)|当前在线/;

function cleanTitle(t) {
  return String(t || '')
    .replace(/\s+/g, ' ')
    .replace(/(\d+(?:\.\d+)?\s*[-~]\s*\d+(?:\.\d+)?\s*[kK].*)$/i, '')
    .trim()
    .slice(0, 80);
}

/** BOSS直聘：li.job-card-wrapper */
export function parseBoss(html) {
  const starts = [...html.matchAll(/<li[^>]*class="[^"]*job-card-wrapper[^"]*"[^>]*>/g)].map(m => m.index);
  const jobs = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : Math.min(html.length, start + 8000);
    const block = html.slice(start, end);

    const href = (block.match(/href="([^"]*\/job_detail\/[^"]+)"/) || [])[1] || '';
    const jobId = (href.match(/job_detail\/([^/.?]+)\.html/) || [])[1] || '';
    const title = cleanTitle(
      matchText(block, /class="[^"]*job-name[^"]*"[^>]*>([\s\S]*?)<\/span>/) ||
      matchText(block, /class="[^"]*job-title[^"]*"[^>]*>([\s\S]*?)<\/span>/)
    );
    const salaryText = matchText(block, /class="[^"]*job-salary[^"]*"[^>]*>([\s\S]*?)<\/span>/).replace(/\s+/g, '');
    const company = matchText(block, /class="[^"]*company-name[^"]*"[^>]*>([\s\S]*?)<\/(?:h3|a)>/) ||
      matchText(block, /class="[^"]*company-info[^"]*"[^>]*>[\s\S]{0,200}?<h3[^>]*>([\s\S]*?)<\/h3>/);

    const tags = [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
      .map(m => stripTags(m[1]))
      .filter(t => t && t.length <= 20 && !/^\d+$/.test(t));

    const areaText = tags.find(t => CITY_RE.test(t)) || '';
    const expTag = tags.find(t => EXP_RE.test(t)) || (block.match(/\d+\s*[-~—到]\s*\d+\s*年|经验不限|应届/) || [''])[0];
    const eduTag = tags.find(t => EDU_RE.test(t)) || (block.match(/博士|硕士|本科|大专/) || [''])[0];
    const active = block.match(ACTIVE_RE);

    if (!title) continue;
    jobs.push({
      site: 'boss',
      siteName: 'BOSS直聘',
      url: href ? new URL(decodeEntities(href), 'https://www.zhipin.com').href.split('?')[0] : '',
      jobId,
      title,
      company,
      salaryText,
      areaText,
      experience: expTag,
      education: eduTag,
      tags: [...new Set(tags)].slice(0, 6),
      hrActive: active ? active[0].replace(/\s+/g, '') : ''
    });
  }
  return jobs;
}

/** 猎聘：div[class*="jobCardPcContainer"] */
export function parseLiepin(html) {
  const starts = [...html.matchAll(/<div[^>]*class="[^"]*jobCardPcContainer[^"]*"[^>]*>/g)].map(m => m.index);
  const jobs = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : Math.min(html.length, start + 12000);
    const block = html.slice(start, end);

    const href = (block.match(/href="([^"]*(?:\/job\/|\/a\/)\d+\.shtml[^"]*)"/) || [])[1] || '';
    const jobId = (href.match(/\/(?:job|a)\/(\d+)\.shtml/) || [])[1] || '';
    const title = cleanTitle(
      matchText(block, /class="[^"]*jobTitleBox[^"]*"[^>]*>[\s\S]{0,600}?<div[^>]*class="ellipsis-1"[^>]*>([^<]*)<\/div>/) ||
      matchText(block, /title="([^"]{2,60})"/)
    );
    const salaryText = (block.match(/(\d+(?:\.\d+)?\s*[-~]\s*\d+(?:\.\d+)?\s*[kK](?:·\d+薪)?)/) || [])[1] || '';
    const company = matchText(block, /class="[^"]*companyName[^"]*"[^>]*>([^<]*)</);
    const cityText = matchText(block, /class="[^"]*jobTitleBox[^"]*"[\s\S]{0,900}?<span class="ellipsis-1"[^>]*>([^<]*)<\/span>/);
    const expTag = (block.match(/经验不限|\d+\s*[-~—到]\s*\d+\s*年|\d+\s*年以上|应届/) || [''])[0];
    const eduTag = (block.match(/博士|硕士|本科|大专/) || [''])[0];

    const industry = matchText(block, /class="[^"]*ak12U[^"]*"[^>]*>\s*<span>([^<]*)<\/span>/);
    const size = matchText(block, /class="[^"]*ak12U[^"]*"[^>]*>[\s\S]{0,300}?<span>([^<]*人)<\/span>/);
    const active = block.match(ACTIVE_RE);

    if (!title) continue;
    jobs.push({
      site: 'liepin',
      siteName: '猎聘',
      url: href ? decodeEntities(href).split('?')[0] : '',
      jobId,
      title,
      company,
      salaryText: salaryText.replace(/\s+/g, ''),
      areaText: cityText,
      experience: expTag,
      education: eduTag,
      tags: [industry, size].filter(Boolean),
      hrActive: active ? active[0].replace(/\s+/g, '') : ''
    });
  }
  return jobs;
}

/** BOSS 搜索接口（页面登录态下由 Chrome 直接请求，返回 JSON） */
export function bossApiUrl(keyword, city) {
  const kw = encodeURIComponent(keyword);
  const code = cityCode(city, 'boss') || '100010000';
  return `https://www.zhipin.com/wapi/zpgeek/search/joblist.json?scene=1&query=${kw}&city=${code}&page=1&pageSize=30`;
}

/** 从 Chrome 渲染 JSON 的页面里取出并解析 */
export function parseBossApi(html) {
  const text = decodeEntities(String(html).replace(/<[^>]*>/g, ''));
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { jobs: [], error: '没有返回 JSON' };
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { jobs: [], error: 'JSON 解析失败' };
  }
  if (data.code !== 0) {
    return { jobs: [], error: data.message || `接口返回 code ${data.code}`, code: data.code };
  }
  const list = (data.zpData && data.zpData.jobList) || [];
  const jobs = list.map(item => {
    const tags = [...(item.skills || []), ...(item.jobLabels || [])].filter(Boolean);
    return {
      site: 'boss',
      siteName: 'BOSS直聘',
      url: item.encryptJobId ? `https://www.zhipin.com/job_detail/${item.encryptJobId}.html` : '',
      jobId: item.encryptJobId || '',
      title: stripTags(item.jobName || ''),
      company: stripTags(item.companyName || item.brandName || ''),
      salaryText: stripTags(item.salaryDesc || '').replace(/\s+/g, ''),
      areaText: [item.cityName, item.areaDistrict].filter(Boolean).join('·'),
      experience: item.jobExperience || '',
      education: item.jobDegree || '',
      tags: [...new Set(tags)].slice(0, 6),
      hrActive: item.bossActiveTimeDesc || ''
    };
  }).filter(j => j.title);
  return { jobs, error: '' };
}

/** 拉勾：WAF 较严，用通用链接解析兜底 */
export function parseLagou(html) {
  const jobs = [];
  const seen = new Set();
  const re = /<a[^>]+href="([^"]*?\/(?:wn\/)?job\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const url = decodeEntities(m[1]);
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const inner = m[3];
    const windowText = stripTags(inner);
    if (!windowText) continue;
    const after = stripTags(html.slice(m.index, m.index + 3500));
    const salary = (after.match(/\d+(?:\.\d+)?\s*[-~—]\s*\d+(?:\.\d+)?\s*[kK](?:·\d+薪)?/) || [''])[0];
    const tags = [...inner.matchAll(/<(?:span|li)[^>]*>([\s\S]*?)<\/(?:span|li)>/g)]
      .map(x => stripTags(x[1]))
      .filter(t => t && t.length <= 18);
    const company = (after.match(/(?:公司|企业)[^\n]{0,30}/) || [''])[0];
    jobs.push({
      site: 'lagou',
      siteName: '拉勾',
      url: url.split('?')[0],
      jobId: id,
      title: cleanTitle(windowText.split(' ').slice(0, 6).join(' ')),
      company,
      salaryText: salary.replace(/\s+/g, ''),
      areaText: '',
      experience: (after.match(/\d+\s*[-~—]\s*\d+\s*年|经验不限|应届/) || [''])[0],
      education: (after.match(/博士|硕士|本科|大专/) || [''])[0],
      tags: [...new Set(tags)].slice(0, 6),
      hrActive: ''
    });
  }
  return jobs;
}

async function fetchJson(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function salaryInText(text) {
  const m = String(text).match(/\d+(?:\.\d+)?\s*[-~—]\s*\d+(?:\.\d+)?\s*[kK](?:·\d+薪)?|\d+\s*[kK]\s*起/);
  return m ? m[0].replace(/\s+/g, '') : '';
}

/** LinkedIn 访客接口返回的职位卡片 */
export function parseLinkedIn(html) {
  const jobs = [];
  const seen = new Set();
  for (const block of html.split('<li').slice(1)) {
    const urn = block.match(/urn:li:jobPosting:(\d+)/);
    if (!urn) continue;
    const id = urn[1];
    if (seen.has(id)) continue;
    const title = stripTags((block.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || '');
    if (!title) continue;
    const company = stripTags((block.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/) || [])[1] || '');
    const areaText = stripTags((block.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
    const date = (block.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || '';
    // 只保留岗位名或公司名带中文的职位：过滤掉纯英文的海外远程岗
    const cjk = /[\u4e00-\u9fa5]/.test(title + company);
    if (!cjk) continue;
    seen.add(id);
    jobs.push({
      site: 'linkedin',
      siteName: 'LinkedIn 领英',
      url: `https://www.linkedin.com/jobs/view/${id}`,
      jobId: id,
      title,
      company,
      salaryText: salaryInText(title),
      areaText,
      experience: '',
      education: '',
      tags: ['领英', '远程'],
      hrActive: '',
      remoteHint: 'yes',
      postedAt: date
    });
  }
  return jobs;
}

/** 电鸭社区 / LinkedIn / V2EX：公开源，一次拉取后按关键词过滤 */
export async function crawlFeed(site, keywords, _dataDir) {
  const list = [];
  const diag = { site, keyword: (keywords || []).join('/'), cards: 0 };

  if (site === 'eleduck') {
    for (const page of [1, 2, 3]) {
      const data = await fetchJson(`https://svc.eleduck.com/api/v1/posts?category=5&page=${page}`);
      for (const post of data.posts || []) {
        if (post.closed || post.deleted) continue;
        list.push({
          site: 'eleduck',
          siteName: '电鸭社区',
          url: `https://eleduck.com/posts/${post.id}`,
          jobId: post.id,
          title: post.title,
          company: '',
          salaryText: salaryInText(`${post.title} ${post.summary || ''}`),
          areaText: '',
          experience: '',
          education: '',
          tags: [...new Set((post.tags || []).map(t => t.name))].slice(0, 6),
          hrActive: ''
        });
      }
      await new Promise(r => setTimeout(r, 350));
    }
  } else if (site === 'linkedin') {
    const seen = new Set();
    for (const keyword of (keywords || []).slice(0, 2)) {
      for (const start of [0, 10]) {
        const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keyword)}&location=China&f_WT=2&start=${start}`;
        try {
          // LinkedIn 的证书链在 Node 里会 SELF_SIGNED_CERT_IN_CHAIN，改用 Chrome 打开访客接口
          const html = await dumpDom(url, _dataDir, 'linkedin', { timeoutMs: 40000 });
          for (const job of parseLinkedIn(html)) {
            if (seen.has(job.jobId)) continue;
            seen.add(job.jobId);
            list.push(job);
          }
        } catch {
          /* 单个关键词失败不影响其他源 */
        }
        await new Promise(r => setTimeout(r, 800));
      }
    }
  } else if (site === 'v2ex') {
    const data = await fetchJson('https://www.v2ex.com/api/topics/show.json?node_name=jobs');
    for (const topic of Array.isArray(data) ? data : []) {
      const text = `${topic.title || ''} ${topic.content || ''}`;
      list.push({
        site: 'v2ex',
        siteName: 'V2EX 酷工作',
        url: topic.url || '',
        jobId: String(topic.id || ''),
        title: stripTags(topic.title || ''),
        company: '',
        salaryText: salaryInText(stripTags(text)),
        areaText: '',
        experience: '',
        education: '',
        tags: ['V2EX'],
        hrActive: ''
      });
    }
  }

  diag.cards = list.length;
  return { jobs: list, diag };
}

/** 抓一个关键词，返回岗位和诊断信息 */
export async function crawlKeyword({ site, keyword, city, dataDir }) {
  if (site === 'boss') {
    const apiUrl = bossApiUrl(keyword, city);
    const raw = await dumpDom(apiUrl, dataDir, 'boss');
    const parsed = parseBossApi(raw);
    const diag = {
      site,
      keyword,
      url: apiUrl,
      htmlLength: raw.length,
      cards: parsed.jobs.length,
      apiCode: parsed.code,
      apiError: parsed.error,
      hasLoginWall: parsed.code === 37 || parsed.code === 1001,
      redirectedHome: false,
      sample: parsed.error ? stripTags(raw).slice(0, 200) : ''
    };
    if (parsed.jobs.length) return { jobs: parsed.jobs, diag };

    // 明确的未登录/风控码：不再跑 DOM，直接告诉页面去登录
    if (parsed.code === 37) {
      diag.riskControl = true;
      return { jobs: [], diag };
    }
    if (parsed.code === 1001) {
      diag.loginRequired = true;
      return { jobs: [], diag };
    }

    // 其他接口异常时退回搜索页 DOM（登录后页面渲染的列表）
    const pageUrl = buildSearchUrl('boss', keyword, city);
    const html = await dumpDom(pageUrl, dataDir, 'boss');
    const jobs = parseBoss(html);
    diag.pageHtmlLength = html.length;
    diag.cards = jobs.length;
    diag.hasLoginWall = jobs.length === 0 && /登录\/注册|扫码登录|请登录/.test(html);
    diag.redirectedHome = jobs.length === 0 && /<title>BOSS直聘-找工作/.test(html);
    diag.sample = jobs.length ? '' : stripTags(html).slice(0, 200);
    return { jobs, diag };
  }

  const url = buildSearchUrl(site, keyword, city);
  const html = await dumpDom(url, dataDir, site);

  if (site === 'lagou') {
    const waf = /滑动验证|aliyun_waf|验证页面/.test(html);
    const jobs = waf ? [] : parseLagou(html);
    return {
      jobs,
      diag: {
        site,
        keyword,
        url,
        htmlLength: html.length,
        cards: jobs.length,
        waf,
        sample: waf ? '拉勾返回了滑块验证页' : ''
      }
    };
  }

  const jobs = parseLiepin(html);
  const diag = {
    site,
    keyword,
    url,
    htmlLength: html.length,
    cards: jobs.length,
    hasLoginWall: /登录\/注册|扫码登录|请登录/.test(html) && jobs.length === 0,
    redirectedHome: site === 'boss' && /<title>BOSS直聘-找工作/.test(html) && jobs.length === 0,
    sample: jobs.length ? '' : stripTags(html).slice(0, 200)
  };
  return { jobs, diag };
}
