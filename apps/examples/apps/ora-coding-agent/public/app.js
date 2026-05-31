'use strict';

// ORA Coding Agent — front-end (vanilla JS, no build step).
// Talks to the app's own REST API and streams live agent activity via SSE.

const els = {
  taskList: document.getElementById('taskList'),
  statusLine: document.getElementById('statusLine'),
  newTaskBtn: document.getElementById('newTaskBtn'),
  newTaskView: document.getElementById('newTaskView'),
  taskDetailView: document.getElementById('taskDetailView'),
  taskForm: document.getElementById('taskForm'),
  formError: document.getElementById('formError'),
  providerSelect: document.getElementById('providerSelect'),
  modelInput: document.getElementById('modelInput'),
  mentionHint: document.getElementById('mentionHint'),
  detailTitle: document.getElementById('detailTitle'),
  detailMeta: document.getElementById('detailMeta'),
  detailStatus: document.getElementById('detailStatus'),
  detailPrompt: document.getElementById('detailPrompt'),
  detailResult: document.getElementById('detailResult'),
  logs: document.getElementById('logs'),
  cancelBtn: document.getElementById('cancelBtn'),
};

let state = { config: null, tasks: [], selected: null, es: null };

const api = (path, opts) => fetch(`api${path}`, opts).then(async (r) => {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
});

async function loadConfig() {
  state.config = await api('/config');
  els.mentionHint.textContent = `@${state.config.botMention}`;
  els.providerSelect.innerHTML = state.config.providers
    .map((p) => `<option value="${p}"${p === state.config.defaultProvider ? ' selected' : ''}>${p}</option>`)
    .join('');
  els.modelInput.value = state.config.defaultModel || '';
  const gh = state.config.githubConfigured ? 'GitHub App connected' : 'GitHub App not configured';
  els.statusLine.textContent = `${gh} · runner: ${state.config.runnerMode}`;
}

async function loadTasks() {
  const { tasks } = await api('/tasks');
  state.tasks = tasks;
  renderTaskList();
}

function renderTaskList() {
  els.taskList.innerHTML = state.tasks
    .map(
      (t) => `
      <li class="task-item ${state.selected === t.id ? 'active' : ''}" data-id="${t.id}">
        <div class="ti-title">${escapeHtml(t.title)}</div>
        <div class="ti-sub">
          <span class="badge ${t.status}">${t.status}</span>
          <span>${t.source === 'github' ? 'GitHub' : 'Manual'}</span>
          <span>· ${timeAgo(t.createdAt)}</span>
        </div>
      </li>`,
    )
    .join('');
  els.taskList.querySelectorAll('.task-item').forEach((el) =>
    el.addEventListener('click', () => openTask(el.dataset.id)),
  );
}

function showNewTask() {
  state.selected = null;
  closeStream();
  els.taskDetailView.classList.add('hidden');
  els.newTaskView.classList.remove('hidden');
  renderTaskList();
}

async function openTask(id) {
  state.selected = id;
  els.newTaskView.classList.add('hidden');
  els.taskDetailView.classList.remove('hidden');
  renderTaskList();

  const { task } = await api(`/tasks/${id}`);
  els.detailTitle.textContent = task.title;
  const repo = task.repoFullName ? `${task.repoFullName}` : 'no repo';
  const pr = task.prNumber ? ` · PR #${task.prNumber}` : '';
  els.detailMeta.textContent = `${repo}${pr} · branch ${task.workBranch} · ${task.provider}/${task.model}`;
  els.detailPrompt.textContent = task.prompt || '(no prompt)';
  setStatus(task);
  renderResult(task);
  els.logs.innerHTML = '';
  streamLogs(id);
}

function setStatus(task) {
  els.detailStatus.className = `badge ${task.status}`;
  els.detailStatus.textContent = task.status;
  const cancellable = task.status === 'queued' || task.status === 'running';
  els.cancelBtn.classList.toggle('hidden', !cancellable);
}

function renderResult(task) {
  if (task.status === 'completed' && task.result && task.result.changed) {
    const r = task.result;
    const prLink = r.prUrl ? `<a href="${r.prUrl}" target="_blank" rel="noopener">${r.prUrl}</a>` : '';
    els.detailResult.innerHTML = `
      <strong>Done.</strong> Pushed branch <code>${escapeHtml(r.branch)}</code>${r.commitSha ? ` (commit <code>${r.commitSha.slice(0, 8)}</code>)` : ''}.
      ${r.filesChanged ? `<br/>Files changed: ${r.filesChanged}` : ''}
      ${prLink ? `<br/>${prLink}` : ''}
      ${r.summary ? `<br/><br/>${escapeHtml(r.summary)}` : ''}`;
    els.detailResult.classList.remove('hidden');
  } else {
    els.detailResult.classList.add('hidden');
  }
}

function streamLogs(id) {
  closeStream();
  const es = new EventSource(`api/tasks/${id}/logs`);
  state.es = es;
  es.onmessage = (e) => appendLog(JSON.parse(e.data));
  es.addEventListener('status', async (e) => {
    const { status } = JSON.parse(e.data);
    if (state.selected === id) {
      const { task } = await api(`/tasks/${id}`);
      setStatus(task);
      renderResult(task);
    }
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status)) {
      closeStream();
      loadTasks();
    }
  });
  es.onerror = () => closeStream();
}

function closeStream() {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
}

function appendLog(line) {
  const div = document.createElement('div');
  let cls = 'log-line';
  let stage = line.type || '';
  let msg = '';
  if (line.type === 'ora') {
    stage = line.stage || 'ora';
    msg = line.msg || '';
    if (line.stage === 'error') cls += ' err';
  } else if (line.type === 'stderr') {
    stage = 'stderr';
    msg = line.text || '';
    cls += ' stderr';
  } else if (line.type === 'ora_result') {
    stage = 'result';
    msg = line.changed ? `Changed ${line.filesChanged || '?'} file(s) on ${line.branch}` : (line.summary || 'No changes');
  } else if (line.type === 'raw') {
    stage = 'log';
    msg = line.text || '';
  } else {
    // pi event
    cls += ' pi';
    stage = line.type;
    msg = summarizePiEvent(line);
  }
  if (!msg) return;
  div.className = cls;
  div.innerHTML = `<span class="lt">${fmtTime(line.ts)}</span><span class="lstage">${escapeHtml(stage)}</span><span class="lmsg">${escapeHtml(msg)}</span>`;
  els.logs.appendChild(div);
  els.logs.scrollTop = els.logs.scrollHeight;
}

function summarizePiEvent(e) {
  switch (e.type) {
    case 'tool_execution_start':
      return `tool: ${e.toolName} ${shortArgs(e.args)}`;
    case 'tool_execution_end':
      return `tool done: ${e.toolName}${e.isError ? ' (error)' : ''}`;
    case 'message_end': {
      const m = e.message;
      if (m && m.role === 'assistant' && Array.isArray(m.content)) {
        const t = m.content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
        return t ? `assistant: ${t.slice(0, 240)}` : '';
      }
      return '';
    }
    case 'agent_start':
      return 'agent started';
    case 'agent_end':
      return 'agent finished';
    default:
      return '';
  }
}

function shortArgs(args) {
  try {
    const s = JSON.stringify(args);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return '';
  }
}

// --- events ----------------------------------------------------------------
els.newTaskBtn.addEventListener('click', showNewTask);

els.taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.formError.textContent = '';
  const fd = new FormData(els.taskForm);
  const body = Object.fromEntries(fd.entries());
  try {
    const { task } = await api('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadTasks();
    openTask(task.id);
  } catch (err) {
    els.formError.textContent = err.message;
  }
});

els.cancelBtn.addEventListener('click', async () => {
  if (!state.selected) return;
  await api(`/tasks/${state.selected}/cancel`, { method: 'POST' });
  await loadTasks();
  openTask(state.selected);
});

// --- helpers ---------------------------------------------------------------
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// --- init ------------------------------------------------------------------
(async function init() {
  try {
    await loadConfig();
    await loadTasks();
    showNewTask();
    setInterval(() => {
      if (!state.es) loadTasks();
    }, 5000);
  } catch (err) {
    els.statusLine.textContent = `Error: ${err.message}`;
  }
})();
