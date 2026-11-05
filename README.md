# 捞职 JobLasso · dsh-job-lasso

> 中文说明见 [README.zh.md](README.zh.md)。

I built this because I was job hunting.

Every morning: open BOSS直聘, open 猎聘, open LinkedIn, type the same keywords, switch cities, tick “remote”, scroll, apply, wait. Then do it again the next day. Remote roles are scattered across sites, and many are only marked by the word 远程 somewhere in the title, so manual searching never really ends.

JobLasso does that loop for me. Once a day it searches the job boards I enable, keeps the remote roles, scores every posting against a saved profile, and puts the ones worth reading in a Harness sidebar panel. It does not apply for me and does not message recruiters. It just removes the repetitive part, so I can spend the time on my resume and interviews.

## What it does

- Searches BOSS直聘, 猎聘, 拉勾 (experimental), 电鸭社区, LinkedIn 领英 and V2EX 酷工作 once a day.
- Remote-first: the query always carries 远程, and non-remote postings are filtered out.
- Scores each job against role keywords, skills, expected salary, experience, education, exclusion words and a company blacklist.
- Shows results as today / strong matches / worth a look / saved / ignored, with CSV export.
- Keeps everything local: no account upload, no cloud service, no bundled credentials.

## Install

```sh
dsh plugin add github:jxhsjxhs/dsh-job-lasso
```

Use a specific profile if needed:

```sh
dsh plugin --profile web add github:jxhsjxhs/dsh-job-lasso
```

Reload Harness after installation, then open **捞职** in the sidebar.

## Requirements

- DeepSeek Harness with the Web UI.
- Google Chrome (or Chromium / Edge) installed locally. The plugin launches its own Chrome profile; it does not touch the browser you use every day.
- A BOSS直聘 account for BOSS results. 猎聘, 电鸭, LinkedIn and V2EX work without login.

## First run

1. Open **捞职 → 设置**, fill in role keywords, expected salary and skills, and choose the sources.
2. For BOSS (and optionally 拉勾), click **登录 BOSS** / **登录拉勾**, scan the QR code in the Chrome window, then click **完成登录**.
3. Click **立即捞一次**. The first run usually takes 30–90 seconds because every keyword opens a headless browser page.

## Sources

| Source | Access | Login | Notes |
| --- | --- | --- | --- |
| BOSS直聘 | headless Chrome + search API | required | Rate-limited; repeated requests trigger `code 37` and a cooldown |
| 猎聘 | headless Chrome | not required | Main source of remote postings |
| 拉勾 | headless Chrome | required + slider | Experimental: Aliyun WAF often blocks headless browsers |
| 电鸭社区 | public API | not required | Chinese remote / freelance jobs |
| LinkedIn 领英 | guest search API via Chrome | not required | `location=China`, remote filter, Chinese title/company only |
| V2EX 酷工作 | public API | not required | Latest 10 topics |

## Scoring

| Signal | Effect |
| --- | --- |
| Explicit remote | +18 |
| Likely remote | +6 |
| Non-remote (remote mode) | excluded |
| Role keyword in title | +16, more for multiple hits |
| Skill match | +4 each, up to +12 |
| Salary covers expectation | +10; below expectation −10 to −16 |
| Experience fits | +4; too senior −10 |
| Education requirement above profile | −12 |
| Exclusion word / company blacklist | excluded |

Default thresholds: strong ≥ 82, worth a look ≥ 66. Changing the profile re-scores stored jobs.

## Data and privacy

- Jobs, profile and logs live in `~/.dsh-job-lasso/store.json`.
- Browser login state lives in `~/.dsh-job-lasso/chrome-profile-*`; it is created locally and is not part of this repository.
- The plugin sends no data to any third party. It only opens the job sites you enable.
- No cookies, tokens or personal files are committed here; `store.json`, `chrome-profile*` and `.env` are ignored.

## Limitations

- Remote jobs are scarce; 5–20 results a day is normal.
- BOSS rate-limits bursts: at most two queries per run with a 25–35 second gap, and a cooldown after `code 37`.
- 拉勾 sits behind an Aliyun WAF that usually blocks headless Chrome.
- LinkedIn cards and some sources do not expose salary; those rows show “salary unknown”.
- The plugin reads search result pages, not full job descriptions; JD text is not scored.
- Scheduling is in-process: it only runs while Harness is running.

## License

MIT
