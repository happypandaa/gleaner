import { esc, copy } from './utils.js';

// "在 AI 里使用拾闻": the only place prompts live. Gleaner never knows whether a prompt was sent,
// so every prompt is safe to send again (AGENTS.md makes 「开始使用」 idempotent).

function projectPath(app) {
  return typeof app.context?.projectRoot === 'string' ? app.context.projectRoot.trim() : '';
}

function folder(app) {
  return projectPath(app) || '拾闻所在的文件夹';
}

function dailyTime(app) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(app.state.dailyTime || '') ? app.state.dailyTime : '08:00';
}

export const prompts = {
  start: app => `请在 ${folder(app)} 工作，先读 AGENTS.md，再按其中「开始使用」和我一起设置拾闻。`,
  manual: app => `请在 ${folder(app)} 按 AGENTS.md 更新一次简报。`,
  daily: app => `请在 ${folder(app)} 帮我建一个每天 ${dailyTime(app)} 运行的定时任务，工作目录设为这个文件夹，任务内容是“按 AGENTS.md 更新简报”。如果你不支持定时任务，直接告诉我。`,
};

function block(app, id, title, note, extra = '') {
  return `<section class="guide-section" data-guide-section="${id}">
    <h3>${title}</h3>${extra}
    <pre class="prompt" data-guide-prompt="${id}">${esc(prompts[id](app))}</pre>
    <div class="guide-actions"><button type="button" class="btn primary small" data-guide-copy="${id}">复制</button>${note ? `<span class="small muted">${note}</span>` : ''}</div>
  </section>`;
}

function body(app) {
  const path = projectPath(app);
  return `<div class="guide-head"><h2 id="ai-guide-title">在 AI 里使用拾闻</h2><button type="button" class="btn link" data-guide-close aria-label="关闭">关闭 ×</button></div>
    <p class="muted">拾闻不自带 AI。内容由你常用的 AI 工具（Claude、Codex、WorkBuddy 等）收集，复制下面的话发给它即可。</p>
    ${block(app, 'start', '开始使用 · 新增或调整主题', '已经发过、设置好的，不用再发。换了 AI 工具或对话丢失时，再发一次即可。')}
    ${block(app, 'manual', '现在更新一次', '也可以直接对 AI 说“更新简报”。')}
    ${block(app, 'daily', '每天自动更新（可选）', '不想设置也没关系，想看新内容时让 AI 更新一次就行。',
      `<p class="small muted">可以让 AI 工具设一个每天运行的定时任务。到点时电脑需要开着、没有睡眠，AI 工具的应用也要在运行；错过时间后，有的工具会在开机后补一次，有的会跳过。</p>
      <label class="time-control">每天 <input class="input" type="time" step="60" value="${esc(dailyTime(app))}" data-guide-time aria-label="每天更新时间"></label>`)}
    ${path ? `<div class="path-line"><span class="small muted">应用文件夹：${esc(path)}</span><button type="button" class="btn link small" data-guide-copy-path>复制路径</button></div>` : ''}`;
}

export function openGuide(app, section = 'start') {
  const dialog = document.querySelector('#ai-guide');
  if (!dialog) return;
  dialog.innerHTML = body(app);
  const copyText = async (text, done) => {
    try { await copy(text); app.notify(done); }
    catch { app.notify('暂时无法复制，请选中文字后手动复制', 'bad'); }
  };
  dialog.querySelectorAll('[data-guide-copy]').forEach(button => {
    button.addEventListener('click', () => copyText(prompts[button.dataset.guideCopy](app), '已复制，请在你的 AI 工具里粘贴发送'));
  });
  dialog.querySelector('[data-guide-copy-path]')?.addEventListener('click', () => copyText(projectPath(app), '已复制应用文件夹路径'));
  dialog.querySelector('[data-guide-time]')?.addEventListener('change', event => {
    if (!event.target.value || !event.target.checkValidity()) return;
    app.state.dailyTime = event.target.value;
    dialog.querySelector('[data-guide-prompt="daily"]').textContent = prompts.daily(app);
  });
  dialog.querySelector('[data-guide-close]').addEventListener('click', () => dialog.close());
  if (!dialog.open) dialog.showModal();
  const target = dialog.querySelector(`[data-guide-section="${section}"]`);
  target?.classList.add('focus');
  target?.scrollIntoView({ block: 'nearest' });
}
