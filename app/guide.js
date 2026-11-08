import { esc, copy } from './utils.js';

// "在 AI 里使用拾闻": the only place prompts live. Gleaner never knows whether a prompt was sent,
// so every prompt is safe to send again (AGENTS.md makes 「开始使用」 idempotent).

function projectPath(app) {
  return typeof app.context?.projectRoot === 'string' ? app.context.projectRoot.trim() : '';
}

function canOpen(app) {
  return Boolean(globalThis.panda?.ai?.open) && Array.isArray(app.context?.capabilities) && app.context.capabilities.includes('ai.open');
}

function folder(app) {
  return projectPath(app) || '拾闻所在的文件夹';
}

export const prompts = {
  start: app => `请在 ${folder(app)} 工作，先读 AGENTS.md，再按其中「开始使用」和我一起设置拾闻。如果你读写不了这个文件夹，先告诉我。`,
};

function block(app, id, title, note, extra = '') {
  return `<section class="guide-section" data-guide-section="${id}">
    <h3>${title}</h3>${extra}
    <pre class="prompt" data-guide-prompt="${id}">${esc(prompts[id](app))}</pre>
    <div class="guide-actions">${canOpen(app) ? `<button type="button" class="btn primary small" data-guide-open="${id}">交给我的 AI</button><button type="button" class="btn small" data-guide-copy="${id}">复制</button>` : `<button type="button" class="btn primary small" data-guide-copy="${id}">复制</button>`}${note ? `<span class="small muted">${note}</span>` : ''}</div>
  </section>`;
}

function body(app) {
  const path = projectPath(app);
  return `<div class="guide-head"><h2 id="ai-guide-title">在 AI 里使用拾闻</h2><button type="button" class="btn link" data-guide-close aria-label="关闭">关闭 ×</button></div>
    <p class="muted">拾闻不自带 AI。内容由你常用的 AI 工具（Claude、Codex、WorkBuddy 等）收集，复制下面这句话发给它，再告诉它你想关注什么。</p>
    ${block(app, 'start', '开始使用 · 新增或调整主题', '已经发过、设置好的，不用再发。')}
    <section class="guide-section guide-faq">
      <h3>常见问题</h3>
      <dl>
        <dt>想看新内容怎么办？</dt><dd>在和 AI 的对话里说“更新简报”。拾闻自己不会去收集，也不会定时更新。</dd>
        <dt>换了 AI 工具，或者对话找不到了？</dt><dd>把上面这句话再发给新的 AI 就行。它会先读拾闻里已有的主题，接着用，不会从头再来。</dd>
        <dt>想改拾闻的样子或功能？</dt><dd>点窗口上方的「按你的想法改」，交给你的 AI 修改。</dd>
      </dl>
    </section>
    ${path ? `<div class="path-line"><span class="small muted">应用文件夹：${esc(path)}</span><button type="button" class="btn link small" data-guide-copy-path>复制路径</button></div>` : ''}`;
}

export function openGuide(app) {
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
  dialog.querySelectorAll('[data-guide-open]').forEach(button => {
    button.addEventListener('click', () => {
      const text = prompts[button.dataset.guideOpen](app);
      globalThis.panda.ai.open(text).then(() => { app.notify('已请求打开你的 AI 工具。检查文字后按发送'); dialog.close(); },
        () => copyText(text, '没能直接打开 AI 工具，文字已复制，请发给你的 AI'));
    });
  });
  dialog.querySelector('[data-guide-copy-path]')?.addEventListener('click', () => copyText(projectPath(app), '已复制应用文件夹路径'));
  dialog.querySelector('[data-guide-close]').addEventListener('click', () => dialog.close());
  if (!dialog.open) dialog.showModal();
}
