/**
 * 捞职 JobLasso · DSH Host 插件
 * 定时用本机 Chrome 抓取 BOSS直聘 / 猎聘 的搜索结果，按画像打分入库，
 * 并通过 /job-lasso/api 提供给 Web 页面；数据存放于 ~/.dsh-job-lasso/。
 */
import { loadDb, saveDb, withConfig, DATA_DIR } from './lib/db.js';
import {
  crawlKeyword, crawlFeed, SITES, detectChrome, openLoginWindow, killProfileChrome
} from './lib/crawler.js';
import { scoreJob } from './lib/score.js';
import {
  parseSalary, parseExperience, splitCity, parseEducation, cityMatches,
  localDate, hashString, clean
} from './lib/parse.js';
import { mergeJobs, pruneJobs, filterJobs, toCSV, summarize } from './lib/jobs.js';
import { CITY_NAMES } from './lib/cities.js';
import { classifyRemote, matchesKeywords } from './lib/remote.js';

export const inject = ['webServer'];

const API_PREFIX = '/job-lasso/api';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function apply(ctx) {
  let db = null;
  let running = false;

  async function getDb() {
    if (!db) db = await loadDb();
    return db;
  }

  function log(level, message) {
    if (!db) return;
    db.logs.unshift({ t: Date.now(), level, message });
    db.logs = db.logs.slice(0, 120);
  }

  function persist() {
    return saveDb(db);
  }

  /* ------------------------------ 归一化与抓取 ------------------------------ */

  function normalizeJob(raw, cfg, now) {
    if (!raw || !raw.title) return null;
    const { city, district } = splitCity(raw.areaText || '');
    const salary = parseSalary(raw.salaryText || '');
    const exp = parseExperience(raw.experience || '');
    const education = raw.education || parseEducation((raw.tags || []).join(' '));
    const id = `${raw.site}:${raw.jobId || hashString(`${raw.title}|${raw.company}|${city}`)}`;

    const job = {
      id,
      site: raw.site,
      siteName: raw.siteName || (SITES[raw.site] ? SITES[raw.site].name : raw.site),
      title: clean(raw.title).slice(0, 80),
      company: clean(raw.company).slice(0, 60),
      url: raw.url || '',
      city,
      district,
      areaText: raw.areaText || '',
      salaryText: raw.salaryText || '',
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryMonths: salary.months,
      experience: exp ? exp.raw : '',
      expMin: exp ? exp.min : null,
      expMax: exp ? exp.max : null,
      education,
      tags: (raw.tags || []).slice(0, 6),
      hrActive: raw.hrActive || '',
      lastSeen: now,
      lastSeenDate: localDate(now)
    };

    job.remote = raw.remoteHint === 'yes' ? 'yes' : classifyRemote(job);
    const scored = scoreJob(job, cfg);
    Object.assign(job, {
      score: scored.score,
      reasons: scored.reasons,
      tier: scored.tier,
      excluded: scored.excluded,
      excludeReason: scored.excludeReason
    });
    return job;
  }

  async function runCrawl(trigger = 'manual') {
    if (running) return { ok: false, error: '正在抓取中' };
    const d = await getDb();
    const cfg = d.config;
    const chrome = detectChrome();

    const allSites = Object.keys(SITES).filter(k => cfg.sites[k]);
    const keywords = (cfg.keywords || []).filter(Boolean).slice(0, Math.max(1, Number(cfg.maxKeywords) || 2));
    if (!allSites.length || !keywords.length) {
      d.runtime.error = '没有启用站点或关键词';
      await persist();
      return { ok: false, error: d.runtime.error };
    }

    // 远程模式用领域词搜（量化研究员 → 量化 + 远程），召回比整串职位名好得多；
    // 多个关键词共用同一个领域词时只搜一次，既省时间也降低 BOSS 风控概率。
    const coreOf = keyword => {
      const k = String(keyword).trim();
      return /[\u4e00-\u9fa5]/.test(k) && k.length > 2 ? k.slice(0, 2) : k;
    };
    const tasks = [];
    const seenQueries = new Set();
    for (const keyword of keywords) {
      const query = cfg.remoteOnly ? `${coreOf(keyword)} 远程` : keyword;
      if (seenQueries.has(query)) continue;
      seenQueries.add(query);
      tasks.push({ keyword, query });
    }

    const feedSites = allSites.filter(k => SITES[k].kind === 'feed');
    const browserSites = allSites.filter(k => SITES[k].kind !== 'feed');

    running = true;
    const startedAt = Date.now();
    const perSiteTasks = site => (site === 'boss' ? tasks.slice(0, 2) : tasks);
    const total = feedSites.length + browserSites.reduce((n, site) => n + perSiteTasks(site).length, 0);
    d.runtime = {
      ...d.runtime,
      running: true,
      startedAt,
      progress: { done: 0, total, site: '', keyword: '' },
      error: '',
      result: null
    };
    await persist();
    log('info', `开始抓取：${allSites.map(s => SITES[s].name).join(' / ')}`);

    // 只清理浏览器类站点的 profile，公开 API 源不需要 Chrome
    for (const site of browserSites) {
      try { await killProfileChrome(DATA_DIR, site); } catch { /* ignore */ }
    }

    const collected = new Map();
    const errors = [];
    let fetched = 0;
    let filtered = 0;
    let done = 0;

    const ingest = (site, rawJobs) => {
      let kept = 0;
      for (const raw of rawJobs) {
        const job = normalizeJob(raw, cfg, Date.now());
        if (!job) continue;
        if (job.excluded) { filtered++; continue; }
        if (cfg.remoteOnly && !matchesKeywords(job, cfg.keywords)) { filtered++; continue; }
        if (cfg.remoteOnly && job.remote === 'no') { filtered++; continue; }
        if (!cfg.remoteOnly && cfg.strictCity && job.city && !cityMatches(job.city, cfg.city)) { filtered++; continue; }
        const prev = collected.get(job.id);
        if (!prev || job.score > prev.score) collected.set(job.id, job);
        kept++;
      }
      return kept;
    };

    try {
      // 免登录公开源：电鸭 / LinkedIn / V2EX，不依赖 Chrome
      for (const site of feedSites) {
        d.runtime.progress = { done, total, site: SITES[site].name, keyword: '最新' };
        await persist();
        let result;
        try {
          result = await crawlFeed(site, cfg.keywords, DATA_DIR);
        } catch (e) {
          const message = e && e.message ? e.message : String(e);
          errors.push(`${SITES[site].name}：${message}`);
          d.siteStatus[site] = { ok: false, cards: 0, message, at: Date.now() };
          log('error', `${SITES[site].name} 拉取失败：${message}`);
          done++;
          continue;
        }
        fetched += result.jobs.length;
        const kept = ingest(site, result.jobs);
        d.siteStatus[site] = {
          ok: kept > 0,
          cards: result.jobs.length,
          kept,
          message: kept > 0 ? '' : '源站最新列表里没有匹配关键词的岗位',
          at: Date.now()
        };
        log(kept > 0 ? 'info' : 'warn', `${SITES[site].name}：拉取 ${result.jobs.length} 条，匹配 ${kept} 条`);
        done++;
        await persist();
      }

      for (const site of browserSites) {
        if (!chrome) {
          d.siteStatus[site] = { ok: false, cards: 0, message: '没有找到 Chrome', at: Date.now() };
          errors.push(`${SITES[site].name}：没有找到 Chrome`);
          continue;
        }
        const siteState = d.siteStatus[site];
        if (siteState && siteState.riskUntil && siteState.riskUntil > Date.now()) {
          const mins = Math.ceil((siteState.riskUntil - Date.now()) / 60000);
          errors.push(`${SITES[site].name} 风控冷却中，约 ${mins} 分钟后再试`);
          log('warn', `${SITES[site].name} 风控冷却中，跳过`);
          continue;
        }
        if (site === 'boss' && siteState && siteState.lastRequestAt && Date.now() - siteState.lastRequestAt < 3 * 60 * 1000) {
          const wait = Math.ceil((3 * 60 * 1000 - (Date.now() - siteState.lastRequestAt)) / 1000);
          errors.push(`BOSS 刚请求过，${wait} 秒内不重复抓`);
          log('warn', `BOSS 请求过于频繁，${wait} 秒后再试`);
          continue;
        }
        for (const task of perSiteTasks(site)) {
          if (Date.now() - startedAt > 8 * 60 * 1000) {
            errors.push('本次超过 8 分钟，提前结束');
            break;
          }
          d.runtime.progress = { done, total, site: SITES[site].name, keyword: task.keyword };
          await persist();

          const searchCity = cfg.remoteOnly ? '全国' : cfg.city;
          let result;
          try {
            result = await crawlKeyword({ site, keyword: task.query, city: searchCity, dataDir: DATA_DIR });
          } catch (e) {
            const message = e && e.message ? e.message : String(e);
            errors.push(`${SITES[site].name} · ${task.keyword}：${message}`);
            d.siteStatus[site] = { ok: false, cards: 0, message, at: Date.now() };
            log('error', `${SITES[site].name} · ${task.keyword} 抓取失败：${message}`);
            done++;
            continue;
          }

          fetched += result.jobs.length;
          const kept = ingest(site, result.jobs);
          const diag = result.diag || {};
          const ok = kept > 0;
          const isBoss = site === 'boss';
          d.siteStatus[site] = {
            ...(d.siteStatus[site] || {}),
            ok,
            cards: result.jobs.length,
            kept,
            message: ok ? '' : (diag.apiCode === 37
              ? 'BOSS 返回环境异常（可能未登录或触发风控）：确认登录后再试，或等 10 分钟'
              : diag.waf
                ? '拉勾返回滑块验证页：点「设置 → 拉勾 登录」在弹出窗口里过验证后再试'
                : diag.loginRequired || diag.redirectedHome || diag.hasLoginWall
                  ? `${SITES[site].name} 未登录或登录已失效，点「登录」扫码后再试`
                  : '页面没有解析到岗位，可能改版或需要验证'),
            at: Date.now()
          };
          if (isBoss) d.siteStatus[site].lastRequestAt = Date.now();
          if (diag.apiCode === 37) {
            const hits = (d.siteStatus[site].riskHits || 0) + 1;
            const minutes = Math.min(10 * 2 ** (hits - 1), 60);
            d.siteStatus[site].riskHits = hits;
            d.siteStatus[site].riskUntil = Date.now() + minutes * 60 * 1000;
            errors.push(`${SITES[site].name} 触发风控，已暂停 ${minutes} 分钟`);
          } else if (ok) {
            d.siteStatus[site].riskHits = 0;
            d.siteStatus[site].riskUntil = 0;
          }

          log(ok ? 'info' : 'warn',
            `${SITES[site].name} · ${task.query}：解析 ${result.jobs.length} 条，匹配 ${kept} 条`);
          done++;
          d.runtime.progress = { done, total, site: SITES[site].name, keyword: task.keyword };
          await persist();

          if (diag.apiCode === 37) break;
          if (collected.size >= (Number(cfg.dailyLimit) || 80)) break;
          // BOSS 的 37 基本是“短时间连续请求”触发的：一次只允许 2 个查询，间隔 25–35 秒
          await sleep(isBoss ? 25000 + Math.random() * 10000 : 1800 + Math.random() * 1200);
        }
      }

      const incoming = [...collected.values()].slice(0, Number(cfg.dailyLimit) || 80);
      const merged = mergeJobs(d.jobs, incoming, Date.now());
      d.jobs = pruneJobs(merged.jobs, 60).jobs;

      // 远程模式下清掉旧的非远程 / 不相关岗位，避免历史数据把列表撑乱（收藏保留）
      if (cfg.remoteOnly) {
        for (const [id, job] of Object.entries(d.jobs)) {
          if (job.status === 'saved' || job.status === 'applied') continue;
          const remote = classifyRemote(job);
          job.remote = remote;
          const nonChineseLinkedin = job.site === 'linkedin' && !/[\u4e00-\u9fa5]/.test(`${job.title} ${job.company}`);
          if (remote === 'no' || nonChineseLinkedin || !matchesKeywords(job, cfg.keywords)) delete d.jobs[id];
        }
      }
      d.runtime = {
        ...d.runtime,
        running: false,
        lastRunAt: Date.now(),
        lastRunDate: localDate(),
        progress: { done: total, total, site: '', keyword: '' },
        result: {
          added: merged.added,
          fetched,
          strong: incoming.filter(j => j.tier === 'strong').length,
          filtered,
          errors
        },
        error: errors.join('；')
      };
      await persist();
      log('info', `完成：新增 ${merged.added} 条，强匹配 ${incoming.filter(j => j.tier === 'strong').length} 条`);
      return { ok: true, result: d.runtime.result };
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      d.runtime = { ...d.runtime, running: false, error: message, lastRunDate: localDate() };
      errors.push(message);
      log('error', `抓取异常：${message}`);
      await persist();
      return { ok: false, error: message };
    } finally {
      running = false;
    }
  }

  /* ------------------------------ 状态 ------------------------------ */

  function statePayload() {
    for (const job of Object.values(db.jobs)) {
      if (!job.remote) job.remote = classifyRemote(job);
    }
    const jobs = Object.values(db.jobs)
      .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.firstSeen || 0) - (a.firstSeen || 0));
    return {
      ok: true,
      config: db.config,
      jobs,
      runtime: db.runtime,
      logs: db.logs.slice(0, 60),
      siteStatus: db.siteStatus,
      summary: summarize(db.jobs),
      chrome: detectChrome(),
      dataDir: DATA_DIR,
      cities: CITY_NAMES
    };
  }

  /* ------------------------------ HTTP ------------------------------ */

  function json(res, data, code = 200) {
    const body = JSON.stringify(data);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  }

  async function readJson(req) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1_000_000) throw new Error('请求过大');
    }
    if (!raw) return {};
    return JSON.parse(raw);
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const sub = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '') || '/';

    try {
      await getDb();

      if (req.method === 'GET' && (sub === '/state' || sub === '/')) {
        return json(res, statePayload());
      }

      if (req.method === 'POST' && sub === '/run') {
        if (running) return json(res, { ok: false, error: '正在抓取中' }, 409);
        runCrawl('manual').catch(() => {});
        return json(res, { ok: true, started: true });
      }

      if (req.method === 'POST' && sub === '/config') {
        const body = await readJson(req);
        const allowed = [
          'city', 'keywords', 'salaryMin', 'salaryMax', 'experienceYears', 'education',
          'skills', 'exclude', 'companyBlacklist', 'strictCity', 'sites',
          'scheduleEnabled', 'scheduleTime', 'maxKeywords', 'dailyLimit',
          'strongThreshold', 'goodThreshold'
        ];
        const patch = {};
        for (const key of allowed) {
          if (body[key] !== undefined) patch[key] = body[key];
        }
        db.config = withConfig({
          ...db.config,
          ...patch,
          sites: { ...db.config.sites, ...(patch.sites || {}) }
        });
        // 画像变了就按新规则重算所有已存岗位，避免分数与设置不一致
        for (const job of Object.values(db.jobs)) {
          job.remote = classifyRemote(job);
          const scored = scoreJob(job, db.config);
          Object.assign(job, {
            score: scored.score,
            reasons: scored.reasons,
            tier: scored.tier,
            excluded: scored.excluded,
            excludeReason: scored.excludeReason
          });
        }
        await persist();
        log('info', '配置已更新');
        return json(res, { ok: true, config: db.config });
      }

      if (req.method === 'POST' && sub === '/status') {
        const body = await readJson(req);
        if (!db.jobs[body.id]) return json(res, { ok: false, error: '岗位不存在' }, 404);
        if (!['new', 'saved', 'ignored', 'applied'].includes(body.status)) {
          return json(res, { ok: false, error: '状态非法' }, 400);
        }
        db.jobs[body.id].status = body.status;
        await persist();
        return json(res, { ok: true });
      }

      if (req.method === 'POST' && sub === '/login') {
        if (running) return json(res, { ok: false, error: '抓取中，稍后再登录' }, 409);
        const body = await readJson(req);
        const site = ['boss', 'liepin', 'lagou'].includes(body.site) ? body.site : 'boss';
        const opened = await openLoginWindow(site, DATA_DIR);
        log('info', `已打开 ${SITES[site].name} 登录窗口，扫码登录后点「完成登录」`);
        await persist();
        return json(res, { ok: true, site, pid: opened.pid });
      }

      if (req.method === 'POST' && sub === '/login/close') {
        for (const key of ['boss', 'liepin', 'lagou']) {
          await killProfileChrome(DATA_DIR, key);
        }
        // 登录窗口关掉后，上一次“未登录”的结论已经过期，先清掉再让页面重新验证
        db.siteStatus = {};
        if (db.runtime.error) db.runtime.error = '';
        log('info', '登录窗口已关闭，正在重新验证登录状态');
        await persist();
        return json(res, { ok: true });
      }

      if (req.method === 'POST' && sub === '/clear') {
        db.jobs = {};
        await persist();
        return json(res, { ok: true });
      }

      if (req.method === 'GET' && sub === '/export') {
        const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'today';
        const list = scope === 'all'
          ? Object.values(db.jobs)
          : filterJobs(Object.values(db.jobs), { scope: 'today', includeIgnored: true });
        const csv = '\uFEFF' + toCSV(list);
        const name = `捞职-${scope === 'all' ? '全部' : '今日'}-${localDate()}.csv`;
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          'Cache-Control': 'no-store'
        });
        res.end(csv);
        return;
      }

      return json(res, { ok: false, error: 'not found' }, 404);
    } catch (e) {
      return json(res, { ok: false, error: e && e.message ? e.message : String(e) }, 500);
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: handle
  }));

  /* ------------------------------ 定时 ------------------------------ */

  async function checkSchedule() {
    const d = await getDb();
    if (running || !d.config.scheduleEnabled) return;
    const today = localDate();
    if (d.runtime.lastRunDate === today) return;
    const [hh, mm] = String(d.config.scheduleTime || '09:30').split(':').map(Number);
    const due = new Date();
    due.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 30, 0, 0);
    if (Date.now() >= due.getTime()) {
      log('info', '到点，开始每日抓取');
      await runCrawl('schedule');
    }
  }

  ctx.effect(() => {
    const timer = setInterval(() => {
      checkSchedule().catch(e => ctx.logger?.warn?.(e));
    }, 30_000);
    checkSchedule().catch(() => {});
    return () => clearInterval(timer);
  });
}
