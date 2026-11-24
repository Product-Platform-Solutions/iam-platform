// Scrum bot for the IAM Platform board.
//
// Does the product owner and scrum master upkeep so nobody has to:
//   - keeps every issue on the GitHub Projects board with Status, Priority, Estimate,
//     Start date, Target date and Iteration filled in
//   - re-plans the roadmap from measured velocity and the dependency graph
//   - rolls dates and estimates up from stories to epics and phases
//   - closes stories, epics and phases when all their children are closed
//   - keeps milestone due dates in step and closes finished milestones
//   - applies the definition of ready (needs-refinement, needs-breakdown, blocked)
//   - writes the board health and sprint report, posts sprint reviews and project status updates
//
// Issue bodies hold the planning data ("**Planning**" table, or the issue form fields).
// Nothing here needs editing for day-to-day work.
//
// Env: GH_TOKEN, PROJECT_ID, GITHUB_REPOSITORY. Optional: DRY_RUN=1 (no writes),
// FIXTURE=<dir> (offline test: reads issues.json, branches.json, pulls.json, deps.json).

import fs from 'node:fs';

const TOKEN = process.env.GH_TOKEN;
const PROJECT_ID = process.env.PROJECT_ID;
const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || 'Product-Platform-Solutions/iam-platform').split('/');
const DRY = process.env.DRY_RUN === '1';
const FIX = process.env.FIXTURE;
const CONFIG = JSON.parse(fs.readFileSync(new URL('../roadmap/config.json', import.meta.url)));
const BASELINE = JSON.parse(fs.readFileSync(new URL('../roadmap/plan.json', import.meta.url)));

const errors = [];
const changes = [];
const note = (msg) => { changes.push(msg); console.log(msg); };

// ---------- dates (India time, where the owner works) ----------
const ist = new Date(Date.now() + 5.5 * 3600e3);
const TODAY = ist.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const maxD = (...ds) => ds.filter(Boolean).sort().pop();
const minD = (...ds) => ds.filter(Boolean).sort()[0];

// ---------- GitHub access ----------
async function rest(method, path, body) {
  if (FIX && method === 'GET') return null;
  if ((DRY || FIX) && method !== 'GET') { note(`[dry] ${method} ${path}`); return {}; }
  const r = await fetch(`https://api.github.com/${path}`, {
    method, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? {} : r.json();
}
async function restAll(path) {
  const out = []; let url = `https://api.github.com/${path}${path.includes('?') ? '&' : '?'}per_page=100`;
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
    out.push(...await r.json());
    const next = /<([^>]+)>;\s*rel="next"/.exec(r.headers.get('link') || '');
    url = next ? next[1] : null;
  }
  return out;
}
async function gql(query, variables) {
  if (FIX || !PROJECT_ID) return null;
  if (DRY && /^\s*mutation/.test(query)) { note('[dry] graphql mutation'); return null; }
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors.map(e => e.message).join('; '));
  return j.data;
}
const fixture = (name) => JSON.parse(fs.readFileSync(`${FIX}/${name}`, 'utf8'));

// ---------- load ----------
const LEVEL = { Initiative: 'initiative', Epic: 'epic', Story: 'story', Spike: 'story', Task: 'task', Bug: 'task', 'Sub-task': 'subtask' };
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const REPORT_LABEL = 'board-report';

function parsePlanning(body = '') {
  const out = {};
  const t = /\*\*Planning\*\*\s*\n\|([^\n]+)\|\s*\n\|[-| :]+\|\s*\n\|([^\n]+)\|/.exec(body);
  if (t) {
    const h = t[1].split('|').map(s => s.trim().toLowerCase()), v = t[2].split('|').map(s => s.trim());
    h.forEach((k, i) => {
      if (k === 'priority' && PRIORITIES.includes(v[i].toLowerCase())) out.priority = v[i].toLowerCase();
      if (k === 'estimate') { const n = parseInt(v[i], 10); if (n > 0) out.points = n; }
      if (k === 'start' && /^\d{4}-\d\d-\d\d$/.test(v[i])) out.start = v[i];
      if (k === 'target' && /^\d{4}-\d\d-\d\d$/.test(v[i])) out.target = v[i];
    });
  }
  const fp = /###\s*Priority\s*\n+\s*(\w+)/i.exec(body);
  if (!out.priority && fp && PRIORITIES.includes(fp[1].toLowerCase())) out.priority = fp[1].toLowerCase();
  const fe = /###\s*Estimate[^\n]*\n+\s*(\d+)/i.exec(body);
  if (!out.points && fe) out.points = parseInt(fe[1], 10);
  return out;
}
function hasAcceptanceCriteria(body = '') { return /acceptance criteria\**\s*\n+\s*- \[[ x]\]\s*\S/i.test(body); }
function planningTable(i) {
  const P = (i.priority || 'medium').replace(/^./, c => c.toUpperCase());
  const est = i.points ? `${i.points} points` : '-';
  if (i.level === 'initiative') return `**Planning**\n| Start | Target | Estimate | Epics |\n|---|---|---|---|\n| ${i.start || '-'} | ${i.target || '-'} | ${est} | ${i.children.length} |`;
  if (i.level === 'epic') return `**Planning**\n| Priority | Estimate | Start | Target | Stories |\n|---|---|---|---|---|\n| ${P} | ${est} | ${i.start || '-'} | ${i.target || '-'} | ${i.children.length} |`;
  return `**Planning**\n| Priority | Estimate | Start | Target |\n|---|---|---|---|\n| ${P} | ${est} | ${i.start || '-'} | ${i.target || '-'} |`;
}
function withPlanning(body = '', table) {
  const re = /\*\*Planning\*\*\s*\n\|[^\n]+\|\s*\n\|[-| :]+\|\s*\n\|[^\n]+\|/;
  return re.test(body) ? body.replace(re, table) : `${body.trimEnd()}\n\n${table}`;
}

async function load() {
  const raw = FIX ? fixture('issues.json') : await restAll(`repos/${OWNER}/${REPO}/issues?state=all`);
  const branches = FIX ? fixture('branches.json') : await restAll(`repos/${OWNER}/${REPO}/branches`);
  const pulls = FIX ? fixture('pulls.json') : await restAll(`repos/${OWNER}/${REPO}/pulls?state=open`);
  const items = new Map();
  for (const x of raw) {
    if (x.pull_request) continue;
    const level = LEVEL[x.type?.name];
    const isReport = x.labels.some(l => l.name === REPORT_LABEL);
    items.set(x.number, {
      n: x.number, id: x.id, nodeId: x.node_id, title: x.title, body: x.body || '', state: x.state,
      stateReason: x.state_reason, closedAt: x.closed_at?.slice(0, 10), updatedAt: x.updated_at?.slice(0, 10),
      level, isReport, typeName: x.type?.name, labels: new Set(x.labels.map(l => l.name)),
      milestone: x.milestone && { number: x.milestone.number, title: x.milestone.title, due: x.milestone.due_on?.slice(0, 10), state: x.milestone.state, open: x.milestone.open_issues },
      parent: x.parent_issue_url ? Number(x.parent_issue_url.split('/').pop()) : null,
      blockedByCount: x.issue_dependencies_summary?.total_blocked_by || 0,
      children: [], blockedBy: [], ...parsePlanning(x.body || ''),
    });
  }
  for (const i of items.values()) if (i.parent && items.has(i.parent)) items.get(i.parent).children.push(i.n);
  const deps = FIX ? fixture('deps.json') : null;
  for (const i of items.values()) {
    if (i.state !== 'open' || !i.blockedByCount) continue;
    i.blockedBy = deps ? (deps[i.n] || []) : (await restAll(`repos/${OWNER}/${REPO}/issues/${i.n}/dependencies/blocked_by`)).map(b => b.number);
  }
  const branchFor = new Set(), reviewFor = new Set();
  for (const b of branches) { const m = /^(?:feat|fix|chore)\/(\d+)\b/.exec(b.name); if (m) branchFor.add(Number(m[1])); }
  for (const p of pulls) {
    const m = /^(?:feat|fix|chore)\/(\d+)\b/.exec(p.head.ref); if (m) reviewFor.add(Number(m[1]));
    for (const c of (p.body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) reviewFor.add(Number(c[1]));
  }
  return { items, branchFor, reviewFor, pulls };
}

// ---------- planning ----------
const phaseIndex = (i) => { const m = /^P(\d+)/.exec(i.milestone?.title || ''); return m ? Number(m[1]) : 99; };
const isWork = (i) => i.level === 'story' || i.level === 'task';
const isOpen = (i) => i.state === 'open';

function velocity(items) {
  const done = [...items.values()].filter(i => i.level === 'story' && i.state === 'closed' && i.stateReason === 'completed' && i.points && i.closedAt);
  const first = done.map(i => i.closedAt).sort()[0];
  const window = CONFIG.velocityWindowDays;
  const recent = done.filter(i => daysBetween(i.closedAt, TODAY) < window);
  const pts = recent.reduce((a, i) => a + i.points, 0);
  if (!first || daysBetween(first, TODAY) < CONFIG.minDaysBeforeMeasuring) return { value: CONFIG.defaultVelocity, measured: false, recentPoints: pts };
  const days = Math.min(window, daysBetween(first, TODAY) + 1);
  const v = Math.round((pts / days) * 7 * 10) / 10;
  return { value: Math.min(CONFIG.maxVelocity, Math.max(CONFIG.minVelocity, v)), measured: true, recentPoints: pts };
}

function schedule(items, vel, state) {
  // closed work keeps its real dates
  for (const i of items.values()) if (isWork(i) && !isOpen(i) && i.closedAt) { i.target = i.closedAt; i.start = minD(i.start, i.closedAt); }
  const open = [...items.values()].filter(i => isWork(i) && isOpen(i) && i.points);
  const started = (i) => state.reviewFor.has(i.n) || state.branchFor.has(i.n);
  const key = (i) => [started(i) ? 0 : 1, phaseIndex(i), i.start || '9999', i.n];
  const cmp = (a, b) => { const x = key(a), y = key(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1; return 0; };
  // dependency-aware order: repeatedly take the first item whose open blockers are already placed
  const pending = open.sort(cmp), placed = new Set(), order = [];
  const openSet = new Set(open.map(i => i.n));
  while (pending.length) {
    let idx = pending.findIndex(i => i.blockedBy.every(b => !openSet.has(b) || placed.has(b)));
    if (idx < 0) { idx = 0; errors.push(`Dependency cycle near #${pending[0].n}; scheduled it anyway.`); }
    const [i] = pending.splice(idx, 1); placed.add(i.n); order.push(i);
  }
  let cursor = TODAY;
  for (const i of order) {
    const dur = Math.max(1, Math.ceil(i.points * 7 / vel.value));
    const after = maxD(...i.blockedBy.map(b => items.get(b)).filter(b => b && isOpen(b)).map(b => addDays(b.target, 1)));
    const s = started(i) ? minD(i.start || TODAY, TODAY) : maxD(cursor, after);
    i.start = s; i.target = addDays(maxD(s, cursor), dur - 1); cursor = addDays(i.target, 1);
  }
  // sub-tasks follow their story
  for (const i of items.values()) if (i.level === 'subtask' && items.has(i.parent)) { const p = items.get(i.parent); i.start = p.start; i.target = p.target; i.priority = p.priority; }
  // roll-ups: epics from stories, initiatives from epics
  for (const lvl of ['epic', 'initiative']) for (const i of items.values()) {
    if (i.level !== lvl || !i.children.length) continue;
    const kids = i.children.map(n => items.get(n)).filter(k => k && k.stateReason !== 'not_planned');
    if (!kids.length) continue;
    i.start = minD(...kids.map(k => k.start)); i.target = maxD(...kids.map(k => k.target));
    i.points = kids.reduce((a, k) => a + (k.points || 0), 0);
    const openKids = kids.filter(isOpen);
    if (lvl === 'epic' && openKids.length) i.priority = PRIORITIES.find(p => openKids.some(k => k.priority === p)) || i.priority;
  }
}

function statusOf(i, items, state, sprint) {
  if (i.state === 'closed') return 'Done';
  if (i.level === 'initiative' || i.level === 'epic') {
    const desc = (x) => x.children.flatMap(n => { const k = items.get(n); return k ? [k, ...desc(k)] : []; });
    return desc(i).some(k => k.state === 'closed' || state.branchFor.has(k.n) || state.reviewFor.has(k.n)) ? 'In progress' : 'Backlog';
  }
  if (state.reviewFor.has(i.n)) return 'In review';
  if (state.branchFor.has(i.n)) return 'In progress';
  if (i.level === 'subtask') { const p = items.get(i.parent); return p && (state.branchFor.has(p.n) || state.reviewFor.has(p.n)) ? 'Ready' : 'Backlog'; }
  const blocked = i.blockedBy.some(b => items.get(b)?.state === 'open');
  const horizon = sprint.next ? sprint.next.end : addDays(TODAY, 14);
  return readyIssues(i, items).length === 0 && !blocked && i.start && i.start <= horizon ? 'Ready' : 'Backlog';
}
function readyIssues(i, items) {
  const out = [];
  if (i.level !== 'story') return out;
  if (!i.points) out.push('no estimate');
  if (!i.priority) out.push('no priority');
  if (!/As an? .+, I want .+/i.test(i.body)) out.push('no user story');
  if (!hasAcceptanceCriteria(i.body)) out.push('no acceptance criteria');
  return out;
}

// ---------- project board ----------
async function loadBoard() {
  const f = await gql(`query($id: ID!) { node(id: $id) { ... on ProjectV2 { title fields(first: 50) { nodes {
      ... on ProjectV2FieldCommon { id name dataType }
      ... on ProjectV2SingleSelectField { options { id name } }
      ... on ProjectV2IterationField { configuration { iterations { id title startDate duration } completedIterations { id title startDate duration } } } } } } } }`, { id: PROJECT_ID });
  if (!f) return null;
  const fields = f.node.fields.nodes.filter(Boolean);
  const items = new Map(); let after = null;
  do {
    const d = await gql(`query($id: ID!, $after: String) { node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id content { ... on Issue { number repository { name } } ... on PullRequest { number repository { name } } }
          fieldValues(first: 20) { nodes {
            ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2FieldCommon { name } } } } } } } } } }`, { id: PROJECT_ID, after });
    const page = d.node.items;
    for (const it of page.nodes) {
      if (!it.content || it.content.repository?.name !== REPO) continue;
      const vals = {};
      for (const v of it.fieldValues.nodes) if (v?.field) vals[v.field.name] = v.optionId ?? v.date ?? v.number ?? v.iterationId;
      items.set(it.content.number, { id: it.id, vals });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return { fields, items };
}
async function ensureField(board, name, dataType) {
  let f = board.fields.find(x => x.name === name);
  if (f) return f;
  const r = await gql(`mutation($p: ID!, $n: String!, $t: ProjectV2CustomFieldType!) { createProjectV2Field(input: { projectId: $p, name: $n, dataType: $t }) { projectV2Field { ... on ProjectV2FieldCommon { id name dataType } } } }`, { p: PROJECT_ID, n: name, t: dataType });
  f = r?.createProjectV2Field.projectV2Field; if (f) { board.fields.push(f); note(`created board field ${name}`); }
  return f;
}
async function setField(itemId, field, value, current) {
  if (!field) return;
  const same = value === null ? current === undefined : String(current) === String(Object.values(value)[0]);
  if (same) return;
  if (value === null) await gql(`mutation($p: ID!, $i: ID!, $f: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f }) { projectV2Item { id } } }`, { p: PROJECT_ID, i: itemId, f: field.id });
  else await gql(`mutation($p: ID!, $i: ID!, $f: ID!, $v: ProjectV2FieldValue!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: $v }) { projectV2Item { id } } }`, { p: PROJECT_ID, i: itemId, f: field.id, v: value });
  board.writes = (board.writes || 0) + 1;
}
let board = null;

function sprints(boardRef) {
  const f = boardRef?.fields.find(x => x.configuration);
  const all = f ? [...f.configuration.completedIterations, ...f.configuration.iterations]
    .map(s => ({ id: s.id, title: s.title, start: s.startDate, end: addDays(s.startDate, s.duration - 1) })).sort((a, b) => a.start < b.start ? -1 : 1) : [];
  const idx = all.findIndex(s => s.start <= TODAY && TODAY <= s.end);
  return { field: f, all, current: all[idx], next: idx >= 0 ? all[idx + 1] : all.find(s => s.start > TODAY), previous: idx > 0 ? all[idx - 1] : null };
}

// ---------- main ----------
async function main() {
  const state = await load();
  const { items } = state;
  const vel = velocity(items);
  schedule(items, vel, state);
  board = await loadBoard().catch(e => { errors.push(`Board read failed: ${e.message}`); return null; });
  const sprint = sprints(board);

  // 1. labels the bot manages
  const managed = { 'needs-refinement': ['d4c5f9', 'Story is missing an estimate, priority, user story or acceptance criteria'],
    'needs-breakdown': ['fef2c0', 'Story starts within four weeks and has no sub-tasks yet'],
    'blocked': ['b60205', 'Work has started but a blocking issue is still open'],
    [REPORT_LABEL]: ['0e8a16', 'Automated board health report'] };
  if (!FIX) {
    const have = new Set((await restAll(`repos/${OWNER}/${REPO}/labels`)).map(l => l.name));
    for (const [name, [color, description]] of Object.entries(managed)) if (!have.has(name)) await rest('POST', `repos/${OWNER}/${REPO}/labels`, { name, color, description });
  }

  // 2. per-issue upkeep: hierarchy from issue forms, milestone, planning table, labels
  for (const i of items.values()) {
    if (!i.level || i.isReport) continue;
    try {
      const ref = /###\s*(?:Epic|Story|Parent)\s*\n+\s*#?(\d+)/i.exec(i.body);
      if (!i.parent && ref && items.has(Number(ref[1])) && i.state === 'open') {
        const parent = items.get(Number(ref[1]));
        await rest('POST', `repos/${OWNER}/${REPO}/issues/${parent.n}/sub_issues`, { sub_issue_id: i.id });
        i.parent = parent.n; parent.children.push(i.n); note(`linked #${i.n} under #${parent.n}`);
      }
      const par = i.parent && items.get(i.parent);
      if (!i.milestone && par?.milestone && i.state === 'open') {
        await rest('PATCH', `repos/${OWNER}/${REPO}/issues/${i.n}`, { milestone: par.milestone.number });
        i.milestone = par.milestone; note(`milestone for #${i.n}`);
      }
      if (['story', 'epic', 'initiative'].includes(i.level) || (i.level === 'task' && i.points)) {
        const body = withPlanning(i.body, planningTable(i));
        if (body !== i.body && i.state === 'open') { await rest('PATCH', `repos/${OWNER}/${REPO}/issues/${i.n}`, { body }); note(`planning updated #${i.n}`); }
      }
      if (i.state !== 'open') continue;
      const want = new Set();
      if (readyIssues(i, items).length) want.add('needs-refinement');
      if (i.level === 'story' && !i.children.length && i.start && i.start <= addDays(TODAY, 28)) want.add('needs-breakdown');
      if ((state.branchFor.has(i.n) || state.reviewFor.has(i.n)) && i.blockedBy.some(b => items.get(b)?.state === 'open')) want.add('blocked');
      for (const l of ['needs-refinement', 'needs-breakdown', 'blocked']) {
        if (want.has(l) && !i.labels.has(l)) { await rest('POST', `repos/${OWNER}/${REPO}/issues/${i.n}/labels`, { labels: [l] }); i.labels.add(l); note(`+${l} #${i.n}`); }
        if (!want.has(l) && i.labels.has(l)) { await rest('DELETE', `repos/${OWNER}/${REPO}/issues/${i.n}/labels/${l}`); i.labels.delete(l); note(`-${l} #${i.n}`); }
      }
    } catch (e) { errors.push(`#${i.n}: ${e.message}`); }
  }

  // 3. close parents whose children are all closed (deepest first)
  for (const lvl of ['story', 'epic', 'initiative']) for (const i of items.values()) {
    if (i.level !== lvl || i.state !== 'open' || !i.children.length) continue;
    const kids = i.children.map(n => items.get(n)).filter(Boolean);
    if (kids.every(k => k.state === 'closed')) {
      try {
        await rest('POST', `repos/${OWNER}/${REPO}/issues/${i.n}/comments`, { body: `All ${kids.length} child issues are closed, so this ${i.typeName?.toLowerCase() || 'issue'} is complete. Closed automatically by the scrum bot.` });
        await rest('PATCH', `repos/${OWNER}/${REPO}/issues/${i.n}`, { state: 'closed', state_reason: 'completed' });
        i.state = 'closed'; i.stateReason = 'completed'; i.closedAt = TODAY; note(`closed #${i.n}`);
      } catch (e) { errors.push(`close #${i.n}: ${e.message}`); }
    }
  }

  // 4. milestones follow their phase
  const phases = [...items.values()].filter(i => i.level === 'initiative' && i.milestone).sort((a, b) => phaseIndex(a) - phaseIndex(b));
  for (const p of phases) {
    try {
      const m = p.milestone, openLeft = [...items.values()].some(i => i.milestone?.number === m.number && i.state === 'open');
      const upd = {};
      if (p.target && m.due !== p.target) upd.due_on = `${p.target}T23:59:59Z`;
      if (!openLeft && m.state === 'open') upd.state = 'closed';
      if (openLeft && m.state === 'closed') upd.state = 'open';
      if (Object.keys(upd).length) { await rest('PATCH', `repos/${OWNER}/${REPO}/milestones/${m.number}`, upd); note(`milestone ${m.title} ${JSON.stringify(upd)}`); }
    } catch (e) { errors.push(`milestone ${p.milestone.title}: ${e.message}`); }
  }

  // 5. the board
  let boardWrites = 0;
  if (board) {
    try {
      const F = {
        status: board.fields.find(f => f.name === 'Status'), priority: board.fields.find(f => f.name === 'Priority' && f.options),
        start: await ensureField(board, 'Start date', 'DATE'), target: await ensureField(board, 'Target date', 'DATE'),
        estimate: await ensureField(board, 'Estimate', 'NUMBER'), iteration: sprint.field,
      };
      const opt = (field, name) => field?.options?.find(o => o.name.toLowerCase().replace(/[^a-z]/g, '') === name.toLowerCase().replace(/[^a-z]/g, ''))?.id;
      for (const name of ['Backlog', 'Ready', 'In progress', 'In review', 'Done']) if (!opt(F.status, name)) errors.push(`Status option "${name}" is missing on the board.`);
      for (const name of ['Critical', 'High', 'Medium', 'Low']) if (!opt(F.priority, name)) errors.push(`Priority option "${name}" is missing on the board.`);
      for (const i of items.values()) {
        if (!i.level) continue;
        let it = board.items.get(i.n);
        if (i.isReport) { if (it) await gql(`mutation($p: ID!, $i: ID!) { deleteProjectV2Item(input: { projectId: $p, itemId: $i }) { deletedItemId } }`, { p: PROJECT_ID, i: it.id }); continue; }
        if (i.stateReason === 'not_planned') continue;
        if (!it) {
          const r = await gql(`mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }`, { p: PROJECT_ID, c: i.nodeId });
          if (!r) continue; it = { id: r.addProjectV2ItemById.item.id, vals: {} }; note(`added #${i.n} to board`);
        }
        const st = opt(F.status, statusOf(i, items, state, sprint));
        if (st) await setField(it.id, F.status, { singleSelectOptionId: st }, it.vals.Status);
        const pr = i.priority && opt(F.priority, i.priority);
        if (pr) await setField(it.id, F.priority, { singleSelectOptionId: pr }, it.vals.Priority);
        if (i.start) await setField(it.id, F.start, { date: i.start }, it.vals['Start date']);
        if (i.target) await setField(it.id, F.target, { date: i.target }, it.vals['Target date']);
        if (i.points && i.level !== 'subtask') await setField(it.id, F.estimate, { number: i.points }, it.vals.Estimate);
        if (F.iteration && ['story', 'task', 'subtask'].includes(i.level) && i.start) {
          const ref = i.state === 'closed' ? i.closedAt : (i.start < TODAY && sprint.current ? TODAY : i.start);
          const sp = sprint.all.find(s => s.start <= ref && ref <= s.end);
          if (sp) await setField(it.id, F.iteration, { iterationId: sp.id }, it.vals[F.iteration.name]);
        }
      }
      boardWrites = board.writes || 0;
    } catch (e) { errors.push(`Board update failed: ${e.message}`); }
  }

  // 6. report, sprint review, project status update
  await report(items, state, vel, sprint, phases, boardWrites);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
}

function sprintStories(items, s) {
  return [...items.values()].filter(i => isWork(i) && i.points && i.stateReason !== 'not_planned' && (
    (i.state === 'closed' && i.closedAt >= s.start && i.closedAt <= s.end) ||
    (i.state === 'open' && ((i.start >= s.start && i.start <= s.end) || (s.start <= TODAY && TODAY <= s.end && i.start < TODAY)))));
}

async function report(items, state, vel, sprint, phases, boardWrites) {
  const all = [...items.values()].filter(i => i.level && !i.isReport && i.stateReason !== 'not_planned');
  const stories = all.filter(i => i.level === 'story');
  const ptsTotal = stories.reduce((a, i) => a + (i.points || 0), 0), ptsDone = stories.filter(i => i.state === 'closed').reduce((a, i) => a + (i.points || 0), 0);
  const finish = maxD(...phases.map(p => p.target));
  const baseFinish = BASELINE.phases[BASELINE.phases.length - 1].target;
  const slip = finish && baseFinish ? daysBetween(baseFinish, finish) : 0;
  const health = slip <= CONFIG.onTrackSlipDays ? 'ON_TRACK' : slip <= CONFIG.atRiskSlipDays ? 'AT_RISK' : 'OFF_TRACK';
  const healthText = { ON_TRACK: 'On track', AT_RISK: 'At risk', OFF_TRACK: 'Off track' }[health];
  const cur = sprint.current;
  const inSprint = cur ? sprintStories(items, cur) : [];
  const spDone = inSprint.filter(i => i.state === 'closed').reduce((a, i) => a + i.points, 0), spAll = inSprint.reduce((a, i) => a + i.points, 0);
  const epicNames = [...new Set(inSprint.map(i => items.get(i.parent)?.title).filter(Boolean))];
  const goal = epicNames.length ? `Finish ${epicNames.slice(0, 2).join(' and ')}` : 'No stories scheduled';
  const attention = (label) => all.filter(i => i.state === 'open' && i.labels.has(label)).map(i => `#${i.n}`);
  const stale = all.filter(i => i.state === 'open' && (state.branchFor.has(i.n) || state.reviewFor.has(i.n)) && i.updatedAt && daysBetween(i.updatedAt, TODAY) > CONFIG.staleDays).map(i => `#${i.n}`);
  const line = (xs) => xs.length ? xs.slice(0, 15).join(', ') + (xs.length > 15 ? ` and ${xs.length - 15} more` : '') : 'none';
  const phaseRows = phases.map(p => {
    const b = BASELINE.phases.find(x => x.key === (/^P\d+/.exec(p.milestone.title) || [])[0]);
    const d = b ? daysBetween(b.target, p.target) : 0;
    const kids = p.children.map(n => items.get(n)).filter(Boolean);
    return `| ${p.milestone.title} | ${p.state === 'closed' ? 'Done' : kids.some(k => k.state === 'closed') ? 'In progress' : 'Not started'} | ${p.start} | ${p.target} | ${b ? b.target : '-'} | ${d > 0 ? '+' + d + ' days' : d < 0 ? d + ' days' : 'on plan'} | #${p.n} |`;
  });
  const marker = `<!-- scrum-bot ${JSON.stringify({ health, sprint: cur?.id || null, date: TODAY })} -->`;
  const body = [marker,
    `**${healthText}.** Forecast finish ${finish} against the baseline ${baseFinish}${slip ? ` (${slip > 0 ? '+' : ''}${slip} days)` : ''}. ${ptsDone} of ${ptsTotal} story points done (${Math.round(100 * ptsDone / Math.max(ptsTotal, 1))}%).`,
    `Updated ${TODAY} by the scrum bot. Velocity ${vel.value} points a week (${vel.measured ? 'measured' : 'planned, until two weeks of finished work exist'}).`,
    '', '## Current sprint',
    cur ? `**${cur.title}**, ${cur.start} to ${cur.end}. Goal: ${goal}.\n\n${spDone} of ${spAll} points done, ${Math.max(0, daysBetween(TODAY, cur.end) + 1)} days left.` : 'No iteration covers today. Add iterations in the board settings.',
    '', '| Story | Points | Status |', '|---|---|---|',
    ...inSprint.sort((a, b) => (a.start || '').localeCompare(b.start || '')).map(i => `| #${i.n} | ${i.points} | ${i.state === 'closed' ? 'Done' : statusOf(i, items, state, sprint)} |`),
    '', '## Roadmap forecast',
    '| Phase | State | Start | Forecast | Baseline | Variance | Issue |', '|---|---|---|---|---|---|---|', ...phaseRows,
    '', '## Needs attention',
    `- Blocked: ${line(attention('blocked'))}`,
    `- Needs refinement: ${line(attention('needs-refinement'))}`,
    `- Needs breakdown into sub-tasks: ${line(attention('needs-breakdown'))}`,
    `- In progress with no activity for ${CONFIG.staleDays} days: ${line(stale)}`,
    '', '## Automation log',
    errors.length ? errors.map(e => `- Error: ${e}`).join('\n') : '- No errors.',
    `- ${changes.length} issue changes and ${boardWrites} board field updates in this run.`,
  ].join('\n');

  if (FIX) { fs.writeFileSync(`${FIX}/report.md`, body); return; }
  const reports = await restAll(`repos/${OWNER}/${REPO}/issues?state=open&labels=${REPORT_LABEL}`);
  let rep = reports[0];
  const prev = rep ? JSON.parse((/<!-- scrum-bot (.*?) -->/.exec(rep.body || '') || [, '{}'])[1]) : {};
  if (!rep) rep = await rest('POST', `repos/${OWNER}/${REPO}/issues`, { title: 'Board health and sprint report', body, labels: [REPORT_LABEL], type: 'Task' });
  else if (rep.body !== body) await rest('PATCH', `repos/${OWNER}/${REPO}/issues/${rep.number}`, { body });

  // sprint review when a new sprint has begun
  if (rep?.number && cur && prev.sprint && prev.sprint !== cur.id && sprint.previous) {
    const s = sprint.previous, done = sprintStories(items, s).filter(i => i.state === 'closed'), carried = sprintStories(items, s).filter(i => i.state === 'open');
    await rest('POST', `repos/${OWNER}/${REPO}/issues/${rep.number}/comments`, { body: `## Sprint review: ${s.title} (${s.start} to ${s.end})\n\nCompleted ${done.length} stories, ${done.reduce((a, i) => a + i.points, 0)} points: ${line(done.map(i => '#' + i.n))}.\nCarried over: ${line(carried.map(i => '#' + i.n))}.\nVelocity now ${vel.value} points a week. Next sprint goal: ${goal}.` });
    note('posted sprint review');
  }
  // project status update: on a change of health, a new sprint, or weekly on Mondays
  const monday = new Date(TODAY + 'T00:00:00Z').getUTCDay() === 1;
  if (board && (prev.health !== health || prev.sprint !== (cur?.id || null) || (monday && prev.date !== TODAY))) {
    try {
      await gql(`mutation($p: ID!, $b: String!, $s: Date, $t: Date, $st: ProjectV2StatusUpdateStatus) { createProjectV2StatusUpdate(input: { projectId: $p, body: $b, startDate: $s, targetDate: $t, status: $st }) { statusUpdate { id } } }`,
        { p: PROJECT_ID, b: `${healthText}. ${cur ? `${cur.title} goal: ${goal}. ` : ''}${ptsDone} of ${ptsTotal} points done; forecast finish ${finish} (baseline ${baseFinish}). Full report: #${rep.number}.`, s: phases[0]?.start, t: finish, st: health });
      note('posted project status update');
    } catch (e) { errors.push(`Status update failed: ${e.message}`); }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
