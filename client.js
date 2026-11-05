/**
 * 捞职 JobLasso · DSH Client 插件
 * 侧边栏一个入口 + 主面板页面：今日岗位、筛选、收藏、设置、登录、导出。
 */
window.__ModuleLoader__.load({
  id: 'dsh-job-lasso',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback, useMemo } = React;
    const h = React.createElement;

    const API = '/job-lasso/api';
    const SITE_NAMES = {
      boss: 'BOSS直聘',
      liepin: '猎聘',
      lagou: '拉勾',
      eleduck: '电鸭社区',
      linkedin: 'LinkedIn 领英',
      v2ex: 'V2EX 酷工作'
    };

    async function api(path, options) {
      const res = await fetch(API + path, {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        ...options
      });
      let data = null;
      try { data = await res.json(); } catch { /* ignore */ }
      if (!res.ok || (data && data.ok === false)) {
        throw new Error((data && data.error) || `请求失败（${res.status}）`);
      }
      return data;
    }

    function todayStr() {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function timeAgo(ts) {
      if (!ts) return '';
      const diff = Date.now() - ts;
      if (diff < 60e3) return '刚刚';
      if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
      if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
      return `${Math.floor(diff / 86400e3)} 天前`;
    }

    function salaryText(job) {
      if (job.salaryText) return job.salaryText;
      if (job.salaryMin != null && job.salaryMax != null) return `${job.salaryMin}-${job.salaryMax}K`;
      if (job.salaryMin != null) return `${job.salaryMin}K+`;
      return '薪资未知';
    }

    function scoreColor(tier) {
      if (tier === 'strong') return 'var(--dsw-alias-state-success-primary)';
      if (tier === 'good') return 'var(--dsw-alias-brand-primary)';
      return 'var(--dsw-alias-state-idle-primary)';
    }

    /* ------------------------------ 侧边栏图标 ------------------------------ */

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 18;
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true,
        style: { display: 'block' }
      },
        h('circle', { cx: 10.5, cy: 10.5, r: 6.3 }),
        h('path', { d: 'M15.1 15.1 21 21', strokeWidth: 2.2, strokeLinecap: 'round' })
      );
    }

    /* ------------------------------ 小组件 ------------------------------ */

    function Stat(props) {
      return h('div', { className: 'jls-stat' },
        h('b', { style: props.accent ? { color: props.accent } : undefined }, String(props.value)),
        h('span', null, props.label)
      );
    }

    function Chip(props) {
      return h('button', {
        className: `jls-chip${props.active ? ' on' : ''}`,
        onClick: props.onClick,
        type: 'button'
      }, props.label);
    }

    function Toast({ text }) {
      if (!text) return null;
      return h('div', { className: 'jls-toast', role: 'status' }, text);
    }

    /* ------------------------------ 岗位卡片 ------------------------------ */

    function JobCard({ job, onStatus, onOpen }) {
      const color = scoreColor(job.tier);
      const pct = Math.max(4, Math.min(100, job.score || 0));
      return h('article', { className: 'jls-job' },
        h('div', { className: 'jls-job-top' },
          h('div', {
            className: 'jls-score',
            style: { background: `conic-gradient(${color} ${pct}%, var(--dsw-alias-border-l1) 0)` }
          }, h('i', { style: { color } }, String(job.score ?? '-'))),
          h('div', { style: { minWidth: 0, flex: 1 } },
            h('div', { className: 'jls-job-line' },
              h('span', { className: 'jls-job-title', title: job.title }, job.title),
              job.remote === 'yes'
                ? h('span', { className: 'jls-remote' }, '远程')
                : job.remote === 'maybe'
                  ? h('span', { className: 'jls-remote maybe' }, '疑似远程')
                  : null,
              h('span', { className: 'jls-salary' }, salaryText(job))
            ),
            h('div', { className: 'jls-meta' },
              [job.company, job.city, job.experience, job.education].filter(Boolean).join(' · ') || '—'
            )
          )
        ),
        Array.isArray(job.reasons) && job.reasons.length
          ? h('div', { className: 'jls-reasons' },
              job.reasons.slice(0, 3).map((r, i) => h('span', { className: 'jls-reason', key: i }, r)))
          : null,
        h('div', { className: 'jls-job-actions' },
          h('span', { className: 'jls-site' }, job.siteName || SITE_NAMES[job.site] || job.site),
          h('span', { style: { flex: 1 } }),
          h('button', {
            className: 'jls-link', type: 'button',
            onClick: () => onOpen(job),
            disabled: !job.url
          }, '打开 ↗'),
          h('button', {
            className: 'jls-link', type: 'button',
            onClick: () => onStatus(job, job.status === 'saved' ? 'new' : 'saved')
          }, job.status === 'saved' ? '★ 已收藏' : '☆ 收藏'),
          h('button', {
            className: 'jls-link muted', type: 'button',
            onClick: () => onStatus(job, job.status === 'ignored' ? 'new' : 'ignored')
          }, job.status === 'ignored' ? '恢复' : '忽略')
        )
      );
    }

    /* ------------------------------ 设置 ------------------------------ */

    function toForm(config) {
      return {
        ...config,
        keywordsText: (config.keywords || []).join(', '),
        skillsText: (config.skills || []).join(', '),
        excludeText: (config.exclude || []).join(', '),
        blacklistText: (config.companyBlacklist || []).join(', ')
      };
    }

    function splitList(text) {
      return String(text || '')
        .split(/[,，、;；\n]/)
        .map(s => s.trim())
        .filter(Boolean);
    }

    function Settings({ state, onSave, onBack, onClear, onLogin }) {
      const [form, setForm] = useState(() => toForm(state.config));
      const [saving, setSaving] = useState(false);
      const [message, setMessage] = useState('');
      const cities = state.cities || [];

      const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

      const save = async () => {
        setSaving(true);
        setMessage('');
        try {
          await onSave({
            ...form,
            keywords: splitList(form.keywordsText),
            skills: splitList(form.skillsText),
            exclude: splitList(form.excludeText),
            companyBlacklist: splitList(form.blacklistText),
            salaryMin: Number(form.salaryMin) || 0,
            salaryMax: Number(form.salaryMax) || 0,
            experienceYears: Number(form.experienceYears) || 0,
            maxKeywords: Math.max(1, Math.min(5, Number(form.maxKeywords) || 2)),
            dailyLimit: Math.max(10, Math.min(300, Number(form.dailyLimit) || 80)),
            strongThreshold: Math.max(1, Math.min(100, Number(form.strongThreshold) || 82)),
            goodThreshold: Math.max(1, Math.min(100, Number(form.goodThreshold) || 66))
          });
          setMessage('已保存');
        } catch (e) {
          setMessage(e.message);
        } finally {
          setSaving(false);
        }
      };

      const field = (label, key, props = {}) => h('div', { className: 'jls-field' },
        h('label', null, label),
        h('input', {
          className: 'jls-input',
          value: form[key] ?? '',
          onChange: e => set(key, e.target.value),
          ...props
        })
      );

      return h('div', null,
        h('div', { className: 'jls-subhead' },
          h('button', { className: 'jls-btn', type: 'button', onClick: onBack }, '← 返回'),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'jls-btn primary', type: 'button', onClick: save, disabled: saving }, saving ? '保存中…' : '保存设置')
        ),
        message ? h('p', { className: 'jls-note' }, message) : null,

        h('div', { className: 'jls-settings' },
          h('section', { className: 'jls-card' },
            h('h3', null, '求职画像'),
            h('div', { className: 'jls-row' },
              h('div', { className: 'jls-field' },
                h('label', null, '目标城市'),
                h('select', {
                  className: 'jls-input',
                  value: form.city,
                  onChange: e => set('city', e.target.value)
                }, cities.map(c => h('option', { key: c, value: c }, c)))
              ),
              h('div', { className: 'jls-field' },
                h('label', null, '工作年限'),
                h('input', {
                  className: 'jls-input', type: 'number', min: 0, max: 30,
                  value: form.experienceYears,
                  onChange: e => set('experienceYears', e.target.value)
                })
              )
            ),
            field('岗位关键词（逗号分隔，最多抓 3 个）', 'keywordsText'),
            h('div', { className: 'jls-row' },
              field('期望月薪下限（K）', 'salaryMin', { type: 'number' }),
              field('期望月薪上限（K）', 'salaryMax', { type: 'number' })
            ),
            field('技能关键词', 'skillsText'),
            field('排除词', 'excludeText'),
            field('公司黑名单', 'blacklistText'),
            h('label', { className: 'jls-check' },
              h('input', {
                type: 'checkbox', checked: !!form.remoteOnly,
                onChange: e => set('remoteOnly', e.target.checked)
              }),
              '只看远程岗位（按全国搜索，自动过滤非远程）'
            ),
            h('label', { className: 'jls-check' },
              h('input', {
                type: 'checkbox', checked: !!form.strictCity,
                onChange: e => set('strictCity', e.target.checked)
              }),
              '严格按城市过滤（远程模式下不生效）'
            )
          ),

          h('section', { className: 'jls-card' },
            h('h3', null, '抓取'),
            h('label', { className: 'jls-check' },
              h('input', {
                type: 'checkbox', checked: !!form.scheduleEnabled,
                onChange: e => set('scheduleEnabled', e.target.checked)
              }),
              '每天自动抓'
            ),
            h('div', { className: 'jls-row' },
              h('div', { className: 'jls-field' },
                h('label', null, '每天时间'),
                h('input', {
                  className: 'jls-input', type: 'time', value: form.scheduleTime,
                  onChange: e => set('scheduleTime', e.target.value)
                })
              ),
              h('div', { className: 'jls-field' },
                h('label', null, '每天抓几个关键词'),
                h('input', {
                  className: 'jls-input', type: 'number', min: 1, max: 3,
                  value: form.maxKeywords,
                  onChange: e => set('maxKeywords', e.target.value)
                })
              )
            ),
            h('div', { className: 'jls-row' },
              field('单日最多收录', 'dailyLimit', { type: 'number' }),
              field('强匹配分数线', 'strongThreshold', { type: 'number' })
            ),
            field('值得看分数线', 'goodThreshold', { type: 'number' }),
            h('h3', { style: { marginTop: 18 } }, '站点'),
            Object.keys(SITE_NAMES).map(site => h('div', { className: 'jls-site-row', key: site },
              h('label', { className: 'jls-check', style: { margin: 0 } },
                h('input', {
                  type: 'checkbox',
                  checked: !!(form.sites && form.sites[site]),
                  onChange: e => set('sites', { ...(form.sites || {}), [site]: e.target.checked })
                }),
                SITE_NAMES[site]
              ),
              state.siteStatus && state.siteStatus[site] && !state.siteStatus[site].ok
                ? h('span', { className: 'jls-warn-text jls-site-note' }, state.siteStatus[site].message || '未就绪')
                : null,
              (site === 'boss' || site === 'lagou')
                ? h('button', {
                    className: 'jls-link', type: 'button',
                    onClick: () => onLogin(site)
                  }, site === 'boss' ? '登录 BOSS' : '登录拉勾')
                : null
            )),
            h('p', { className: 'jls-hint' },
              'BOSS / 拉勾需要先在弹出窗口里登录（拉勾还有滑块验证）；登录态保存在 ',
              h('code', null, state.dataDir),
              ' 下的独立 Chrome 配置里，不读取你日常浏览器的数据。电鸭 / LinkedIn / V2EX 免登录。'
            )
          ),

          h('section', { className: 'jls-card', style: { gridColumn: '1 / -1' } },
            h('h3', null, '最近日志'),
            h('ul', { className: 'jls-logs' },
              (state.logs || []).slice(0, 30).map((item, i) => h('li', { key: i },
                h('time', null, new Date(item.t).toLocaleTimeString('zh-CN', { hour12: false })),
                h('span', { className: item.level === 'error' ? 'jls-err' : item.level === 'warn' ? 'jls-warn-text' : '' }, item.message)
              ))
            ),
            h('div', { className: 'jls-danger' },
              h('button', { className: 'jls-link danger', type: 'button', onClick: onClear }, '清空已捞岗位')
            )
          )
        )
      );
    }

    /* ------------------------------ 页面 ------------------------------ */

    function Page() {
      const [state, setState] = useState(null);
      const [loadError, setLoadError] = useState('');
      const [view, setView] = useState('jobs');
      const [scope, setScope] = useState('today');
      const [query, setQuery] = useState('');
      const [busy, setBusy] = useState('');
      const [toast, setToast] = useState('');

      const refresh = useCallback(async () => {
        try {
          const next = await api('/state');
          setState(next);
          setLoadError('');
        } catch (e) {
          setLoadError(e.message);
        }
      }, []);

      useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 3000);
        return () => clearInterval(timer);
      }, [refresh]);

      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(''), 3000);
        return () => clearTimeout(timer);
      }, [toast]);

      const run = async () => {
        setBusy('run');
        try {
          await api('/run', { method: 'POST' });
          setToast('开始抓取，Chrome 会在后台打开，约 1 分钟');
          await refresh();
        } catch (e) {
          setToast(e.message);
        } finally {
          setBusy('');
        }
      };

      const login = async (site) => {
        setBusy('login');
        try {
          await api('/login', { method: 'POST', body: JSON.stringify({ site }) });
          setToast('已打开登录窗口，扫码登录后点「完成登录」');
        } catch (e) {
          setToast(e.message);
        } finally {
          setBusy('');
        }
      };

      const finishLogin = async () => {
        setBusy('login');
        try {
          await api('/login/close', { method: 'POST' });
          setToast('已关闭登录窗口，正在重新抓取验证登录…');
          await api('/run', { method: 'POST' });
          await refresh();
        } catch (e) {
          setToast(e.message);
        } finally {
          setBusy('');
        }
      };

      const setStatus = async (job, status) => {
        try {
          await api('/status', { method: 'POST', body: JSON.stringify({ id: job.id, status }) });
          setState(prev => prev ? {
            ...prev,
            jobs: prev.jobs.map(j => j.id === job.id ? { ...j, status } : j)
          } : prev);
          refresh();
        } catch (e) {
          setToast(e.message);
        }
      };

      const openJob = (job) => {
        if (job.url) window.open(job.url, '_blank', 'noopener');
      };

      const saveConfig = async (config) => {
        await api('/config', { method: 'POST', body: JSON.stringify(config) });
        await refresh();
      };

      const clearJobs = async () => {
        if (!window.confirm('确定清空所有已捞岗位？收藏也会一起清掉。')) return;
        await api('/clear', { method: 'POST' });
        setToast('已清空');
        await refresh();
      };

      if (!state) {
        return h('div', { className: 'jls-root' },
          h('style', null, STYLES),
          h('div', { className: 'jls-empty' }, loadError || '正在连接捞职服务…')
        );
      }

      const jobs = state.jobs || [];
      const today = todayStr();
      const visible = jobs.filter(j => !j.excluded && !(state.config.remoteOnly && j.remote === 'no'));
      const counts = {
        today: visible.filter(j => j.firstSeenDate === today && j.status !== 'ignored').length,
        strong: visible.filter(j => j.tier === 'strong' && j.status !== 'ignored').length,
        good: visible.filter(j => j.tier === 'good' && j.status !== 'ignored').length,
        saved: visible.filter(j => j.status === 'saved').length,
        ignored: visible.filter(j => j.status === 'ignored').length
      };

      const filtered = jobs.filter(job => {
        if (job.excluded) return false;
        if (state.config.remoteOnly && job.remote === 'no') return false;
        if (job.status === 'ignored' && scope !== 'ignored') return false;
        if (scope === 'today' && job.firstSeenDate !== today) return false;
        if (scope === 'strong' && job.tier !== 'strong') return false;
        if (scope === 'good' && job.tier !== 'good') return false;
        if (scope === 'saved' && job.status !== 'saved') return false;
        if (scope === 'ignored' && job.status !== 'ignored') return false;
        if (query) {
          const hay = `${job.title} ${job.company} ${job.city} ${(job.tags || []).join(' ')}`.toLowerCase();
          if (!hay.includes(query.toLowerCase())) return false;
        }
        return true;
      });

      const running = state.runtime && state.runtime.running;
      const progress = (state.runtime && state.runtime.progress) || {};
      const bossStatus = state.siteStatus && state.siteStatus.boss;

      const header = h('header', { className: 'jls-head' },
        h('div', null,
          h('h1', null, '捞职'),
          h('p', { className: 'jls-sub' },
            `每天 ${state.config.scheduleTime} 自动抓 · ${state.config.remoteOnly ? '远程优先 · ' : ''}${state.chrome ? 'Chrome 已就绪' : '未找到 Chrome'}`,
            state.runtime && state.runtime.lastRunAt ? ` · 上次 ${timeAgo(state.runtime.lastRunAt)}` : ''
          )
        ),
        h('div', { className: 'jls-actions' },
          h('button', {
            className: 'jls-btn', type: 'button', onClick: () => login('boss'), disabled: !!busy || running
          }, '登录 BOSS'),
          h('button', {
            className: 'jls-btn', type: 'button', onClick: finishLogin, disabled: !!busy || running
          }, '完成登录'),
          h('button', {
            className: 'jls-btn primary', type: 'button', onClick: run, disabled: !!busy || running
          }, running ? `抓取中 ${progress.done || 0}/${progress.total || 0}` : '立即捞一次'),
          h('button', {
            className: 'jls-btn', type: 'button', onClick: () => setView(view === 'settings' ? 'jobs' : 'settings')
          }, view === 'settings' ? '看岗位' : '设置')
        )
      );

      if (view === 'settings') {
        return h('div', { className: 'jls-root' },
          h('style', null, STYLES),
          h('div', { className: 'jls-wrap' },
            header,
            h(Settings, {
              state,
              onSave: saveConfig,
              onBack: () => setView('jobs'),
              onClear: clearJobs,
              onLogin: login
            }),
            h(Toast, { text: toast })
          )
        );
      }

      return h('div', { className: 'jls-root' },
        h('style', null, STYLES),
        h('div', { className: 'jls-wrap' },
          header,

          h('div', { className: 'jls-stats' },
            h(Stat, { label: '今日新岗位', value: counts.today }),
            h(Stat, { label: '强匹配', value: counts.strong, accent: 'var(--dsw-alias-state-success-primary)' }),
            h(Stat, { label: '累计', value: visible.length }),
            h(Stat, { label: '已收藏', value: counts.saved })
          ),

          bossStatus && !bossStatus.ok
            ? h('div', { className: 'jls-banner' },
                h('span', null, `BOSS直聘：${bossStatus.message || '未就绪'}`),
                h('button', { className: 'jls-btn', type: 'button', onClick: () => login('boss') }, '去登录')
              )
            : null,

          state.runtime && state.runtime.error
            ? h('div', { className: 'jls-banner warn' }, state.runtime.error)
            : null,

          h('div', { className: 'jls-toolbar' },
            h('div', { className: 'jls-chips' },
              h(Chip, { label: `今日 ${counts.today}`, active: scope === 'today', onClick: () => setScope('today') }),
              h(Chip, { label: `强匹配 ${counts.strong}`, active: scope === 'strong', onClick: () => setScope('strong') }),
              h(Chip, { label: `值得看 ${counts.good}`, active: scope === 'good', onClick: () => setScope('good') }),
              h(Chip, { label: `收藏 ${counts.saved}`, active: scope === 'saved', onClick: () => setScope('saved') }),
              h(Chip, { label: `已忽略 ${counts.ignored}`, active: scope === 'ignored', onClick: () => setScope('ignored') })
            ),
            h('input', {
              className: 'jls-input jls-search',
              placeholder: '搜职位 / 公司',
              value: query,
              onChange: e => setQuery(e.target.value)
            }),
            h('a', {
              className: 'jls-link',
              href: `${API}/export?scope=today`,
              target: '_blank',
              rel: 'noreferrer'
            }, '导出今日 CSV')
          ),

          running
            ? h('div', { className: 'jls-progress' },
                `正在抓：${progress.site || '准备中'} · ${progress.keyword || ''}（${progress.done || 0}/${progress.total || 0}）`)
            : null,

          h('div', null,
            filtered.length
              ? filtered.map(job => h(JobCard, {
                  key: job.id,
                  job,
                  onStatus: setStatus,
                  onOpen: openJob
                }))
              : h('div', { className: 'jls-empty' },
                  running
                    ? '正在抓取，稍等片刻…'
                    : query
                      ? '没有匹配的岗位'
                      : scope === 'today'
                        ? state.config.remoteOnly
                          ? '今天还没有捞到明确远程的岗位。点右上角「立即捞一次」；想放宽范围可以在设置里关掉「只看远程」。'
                          : '今天还没有捞到岗位。点右上角「立即捞一次」，或在设置里确认站点和关键词。'
                        : '这个筛选下暂时没有岗位'
                )
          ),

          h(Toast, { text: toast })
        )
      );
    }

    const STYLES = `
      .jls-root {
        height: 100%;
        min-height: 100%;
        overflow: auto;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: 13px/1.55 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
      }
      .jls-wrap { max-width: 1060px; margin: 0 auto; padding: 26px 28px 72px; }
      .jls-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .jls-head h1 { margin: 0; font-size: 22px; letter-spacing: .3px; }
      .jls-sub { margin: 5px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .jls-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .jls-btn {
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        border-radius: 8px; padding: 7px 12px; font-size: 12.5px; cursor: pointer;
        transition: border-color .15s, background .15s;
      }
      .jls-btn:hover { border-color: var(--dsw-alias-border-l2); }
      .jls-btn:disabled { opacity: .5; cursor: default; }
      /* 主题里的 brand-primary 在部分深色主题下是浅色，白字会看不见；
         这里用「主文字色当底、背景色当字」，两种主题都保证对比度。 */
      .jls-btn.primary {
        background: var(--dsw-alias-label-primary);
        border-color: transparent;
        color: var(--dsw-alias-bg-base);
        font-weight: 600;
      }
      .jls-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 22px 0 16px; }
      .jls-stat {
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px; padding: 12px 14px;
      }
      .jls-stat b { font-size: 22px; line-height: 1.2; }
      .jls-stat span { display: block; color: var(--dsw-alias-label-secondary); font-size: 11px; margin-top: 3px; }
      .jls-banner {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l1);
        border-left: 3px solid var(--dsw-alias-state-warn-primary);
        border-radius: 10px; padding: 10px 14px; margin-bottom: 12px;
        color: var(--dsw-alias-label-secondary); font-size: 12.5px;
      }
      .jls-banner.warn { border-left-color: var(--dsw-alias-state-error-primary); }
      .jls-toolbar { display: flex; align-items: center; gap: 10px; margin: 4px 0 14px; flex-wrap: wrap; }
      .jls-chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .jls-chip {
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent; color: var(--dsw-alias-label-secondary);
        border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer;
      }
      .jls-chip.on { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); border-color: transparent; }
      .jls-input {
        background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-primary);
        border-radius: 8px; padding: 7px 10px; font-size: 13px;
        outline: none; box-sizing: border-box;
      }
      .jls-input:focus { border-color: var(--dsw-alias-brand-primary); }
      .jls-search { margin-left: auto; width: 200px; }
      .jls-job {
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px; padding: 14px 16px 12px; margin-bottom: 10px;
      }
      .jls-job:hover { border-color: var(--dsw-alias-border-l2); }
      .jls-job-top { display: flex; gap: 12px; align-items: flex-start; }
      .jls-score {
        flex: 0 0 42px; width: 42px; height: 42px; border-radius: 50%;
        display: grid; place-items: center;
      }
      .jls-score i {
        width: 34px; height: 34px; border-radius: 50%;
        background: var(--dsw-alias-bg-layer-1);
        display: grid; place-items: center;
        font-style: normal; font-weight: 700; font-size: 12px;
      }
      .jls-job-line { display: flex; align-items: baseline; gap: 10px; }
      .jls-job-title { font-size: 14.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .jls-salary { color: var(--dsw-alias-state-error-primary); font-weight: 600; font-size: 13px; white-space: nowrap; }
      .jls-remote {
        flex: 0 0 auto;
        font-size: 10.5px; font-weight: 600;
        color: var(--dsw-alias-state-success-primary);
        border: 1px solid var(--dsw-alias-state-success-primary);
        border-radius: 5px; padding: 0 5px; line-height: 17px;
      }
      .jls-remote.maybe {
        color: var(--dsw-alias-label-secondary);
        border-color: var(--dsw-alias-border-l2);
        font-weight: 500;
      }
      .jls-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 3px; }
      .jls-reasons { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
      .jls-reason {
        font-size: 11px; color: var(--dsw-alias-brand-primary);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
        border-radius: 6px; padding: 2px 7px;
      }
      .jls-job-actions {
        display: flex; align-items: center; gap: 12px;
        margin-top: 10px; padding-top: 8px;
        border-top: 1px dashed var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary); font-size: 11.5px;
      }
      .jls-site { border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; padding: 1px 6px; font-size: 10.5px; }
      .jls-link {
        background: none; border: 0; padding: 0; cursor: pointer;
        color: var(--dsw-alias-brand-primary); font-size: 12px; text-decoration: none;
      }
      .jls-link:hover { text-decoration: underline; }
      .jls-link.muted { color: var(--dsw-alias-label-secondary); }
      .jls-link.danger { color: var(--dsw-alias-state-error-primary); }
      .jls-progress {
        background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px; padding: 7px 12px; margin-bottom: 12px;
        color: var(--dsw-alias-label-secondary); font-size: 12px;
      }
      .jls-empty { text-align: center; padding: 64px 20px; color: var(--dsw-alias-label-secondary); }
      .jls-settings { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
      .jls-card {
        background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px; padding: 16px 16px 8px;
      }
      .jls-card h3 { margin: 0 0 14px; font-size: 14px; }
      .jls-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
      .jls-field label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .jls-field .jls-input, .jls-field select { width: 100%; }
      .jls-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .jls-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin: 6px 0 10px; cursor: pointer; }
      .jls-site-row { display: flex; align-items: center; gap: 10px; padding: 3px 0; }
      .jls-site-note { font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .jls-check input { accent-color: var(--dsw-alias-brand-primary); }
      .jls-hint { color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.7; }
      .jls-hint code { background: var(--dsw-alias-bg-layer-2); padding: 1px 4px; border-radius: 4px; }
      .jls-subhead { display: flex; align-items: center; gap: 10px; margin-top: 18px; }
      .jls-note { color: var(--dsw-alias-state-success-primary); font-size: 12px; }
      .jls-logs { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow: auto; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
      .jls-logs li { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px dashed var(--dsw-alias-border-l1); }
      .jls-logs li:last-child { border-bottom: 0; }
      .jls-logs time { color: var(--dsw-alias-label-secondary); opacity: .7; flex: 0 0 auto; }
      .jls-err { color: var(--dsw-alias-state-error-primary); }
      .jls-warn-text { color: var(--dsw-alias-state-warn-primary); }
      .jls-danger { display: flex; justify-content: flex-end; margin-top: 12px; }
      .jls-toast {
        position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
        background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px; padding: 8px 14px; font-size: 12.5px; z-index: 20;
      }
      @media (max-width: 760px) {
        .jls-settings { grid-template-columns: 1fr; }
        .jls-stats { grid-template-columns: 1fr 1fr; }
        .jls-search { width: 100%; margin-left: 0; }
      }
    `;

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'job-lasso',
          order: 20,
          label: '捞职'
        }, PanelIcon));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'job-lasso'
        }, Page));
      }
    };
  }
});
