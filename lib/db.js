/** 持久化：~/.dsh-job-lasso/store.json（单文件，原子写） */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const DATA_DIR = path.join(os.homedir(), '.dsh-job-lasso');
const FILE = path.join(DATA_DIR, 'store.json');

export const DEFAULT_CONFIG = {
  city: '上海',
  keywords: ['量化研究员', '量化开发'],
  salaryMin: 30,
  salaryMax: 60,
  experienceYears: 3,
  education: '硕士',
  skills: ['Python', '因子', '回测', 'CTA', '机器学习', 'C++'],
  exclude: ['外包', '驻场', '销售', '实习'],
  companyBlacklist: [],
  strictCity: true,
  remoteOnly: true,
  sites: { boss: true, liepin: true, lagou: false, eleduck: true, linkedin: true, v2ex: true },
  scheduleEnabled: true,
  scheduleTime: '09:30',
  maxKeywords: 2,
  dailyLimit: 80,
  strongThreshold: 82,
  goodThreshold: 66
};

export function withConfig(config) {
  const c = config && typeof config === 'object' ? config : {};
  const merged = { ...DEFAULT_CONFIG, ...c };
  merged.sites = { ...DEFAULT_CONFIG.sites, ...(c.sites || {}) };
  merged.keywords = Array.isArray(c.keywords) ? c.keywords : DEFAULT_CONFIG.keywords;
  merged.skills = Array.isArray(c.skills) ? c.skills : DEFAULT_CONFIG.skills;
  merged.exclude = Array.isArray(c.exclude) ? c.exclude : DEFAULT_CONFIG.exclude;
  merged.companyBlacklist = Array.isArray(c.companyBlacklist) ? c.companyBlacklist : [];
  return merged;
}

export function emptyDb() {
  return {
    version: 1,
    config: withConfig(),
    jobs: {},
    runtime: {
      running: false,
      startedAt: null,
      lastRunAt: null,
      lastRunDate: '',
      progress: { done: 0, total: 0, site: '', keyword: '' },
      result: null,
      error: ''
    },
    logs: [],
    siteStatus: {}
  };
}

function normalizeDb(raw) {
  const base = emptyDb();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    config: withConfig(raw.config),
    jobs: raw.jobs && typeof raw.jobs === 'object' ? raw.jobs : {},
    runtime: { ...base.runtime, ...(raw.runtime || {}) },
    logs: Array.isArray(raw.logs) ? raw.logs.slice(0, 120) : [],
    siteStatus: raw.siteStatus && typeof raw.siteStatus === 'object' ? raw.siteStatus : {}
  };
}

export async function loadDb() {
  try {
    const text = await readFile(FILE, 'utf8');
    return normalizeDb(JSON.parse(text));
  } catch {
    return emptyDb();
  }
}

let chain = Promise.resolve();

/** 串行化写盘，避免并发请求互相覆盖 */
export function saveDb(db) {
  const snapshot = JSON.stringify(db, null, 1);
  chain = chain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, snapshot, 'utf8');
    await rename(tmp, FILE);
  });
  return chain;
}
