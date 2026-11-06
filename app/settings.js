import { esc, date, relative, copy, runStatus } from './utils.js';

const RUN_LABELS = { running: '更新中', done: '完成', partial: '部分完成', failed: '失败' };
const TRIGGER_LABELS = { setup: '设置', scheduled: '定时', manual: '手动' };
const RUN_TONES = { running: 'info', done: 'ok', partial: 'warn', failed: 'bad' };

function rows(result) {
  return Array.isArray(result) ? result : (result?.rows || []);
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function chosenTime(app) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(app.state.scheduleTime || '')
    ? app.state.scheduleTime : '08:00';
}

function projectPath(app) {
  return typeof app.context?.projectRoot === 'string' ? app.context.projectRoot.trim() : '';
}

function setupPrompt(app) {
  const path = projectPath(app) || '拾闻所在的文件夹';
  return `请在这个文件夹里工作：${path}。先读其中的 AGENTS.md。然后：1. 马上按 AGENTS.md 更新一次简报，运行记录的 trigger 填 setup；2. 帮我建一个每天 ${chosenTime(app)} 运行的定时任务，工作目录设为这个文件夹，任务内容是“按 AGENTS.md 更新简报”，并把定时安排写进运行记录的 schedule。如果你不支持定时任务，直接告诉我。`;
}

function manualPrompt(app) {
  return `请在 ${projectPath(app) || '拾闻所在的文件夹'} 里按 AGENTS.md 更新一次简报。`;
}

function pathControls(app) {
  const path = projectPath(app);
  return path ? `<div class="path-line"><span class="small muted">应用文件夹：${esc(path)}</span><button type="button" class="btn link small" data-copy-path>复制路径</button></div>` : '';
}

function setupPanel(app, { onboarding = false } = {}) {
  return `<section class="card pad setup-panel">
    <div class="head"><strong>${onboarding ? '连接你的 AI' : '每天自动更新'}</strong>${onboarding ? '' : '<span class="pill info">推荐</span>'}</div>
    <p class="muted">把下面的话粘贴到你常用的 AI 工具（Claude、Codex、WorkBuddy 等）并发送。它会马上更新一次，再帮你设置每天更新。</p>
    <label class="time-control">每天 <input class="input" type="time" step="60" value="${esc(chosenTime(app))}" data-schedule-time aria-label="每天更新时间"></label>
    <pre class="prompt" data-setup-prompt>${esc(setupPrompt(app))}</pre>
    ${pathControls(app)}
    <div class="actions"><button type="button" class="btn primary" data-copy-setup>复制设置提示词</button></div>
    <p class="small muted" data-copy-status role="status"${app.state.setupCopied ? '' : ' hidden'}>${onboarding ? '等待 AI 第一次运行…在你的 AI 工具里粘贴发送，完成后回到这里。' : '已复制。在你的 AI 工具里粘贴发送，完成后回到这里刷新。'}</p>
  </section>`;
}

function pageHeader(title, description, action = '') {
  return `<div class="head"><div><h1>${title}</h1>${description ? `<p class="muted">${description}</p>` : ''}</div><div class="tools">${action}<button type="button" class="btn" data-settings-refresh>↻ 刷新</button></div></div>`;
}

function keywordText(value) {
  if (Array.isArray(value)) return value.join('、');
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(word => typeof word === 'string').join('、') : '';
  } catch {
    return '';
  }
}

function newTopic(topics) {
  return { name: '', description: '', keywords: [], sources: '', excludes: '', extra_fields: '', max_items: 6, view: 'list', enabled: 1, sort_order: Math.max(-1, ...topics.map(topic => Number(topic.sort_order) || 0)) + 1 };
}

function topicForm(topic, views) {
  const available = views?.length ? [...views] : [{ id: 'list', name: '列表' }];
  if (!available.some(view => view.id === topic.view)) available.push({ id: topic.view, name: '当前方式暂不可用（使用列表显示）' });
  return `<form class="card pad topic-editor" data-topic-form>
    <div class="head"><h2>${topic.id ? '编辑主题' : '添加主题'}</h2><label class="check-label"><input type="checkbox" name="enabled"${Number(topic.enabled) === 1 ? ' checked' : ''}> 开启这个主题</label></div>
    <div class="form-grid">
      <div class="field full-width"><label for="topic-name">主题名称</label><input class="input" id="topic-name" name="name" required value="${esc(topic.name)}" placeholder="比如：AI 工具动态"></div>
      <div class="field"><label for="topic-max">每次最多几条</label><input class="input" id="topic-max" name="max_items" type="number" min="1" max="20" step="1" required value="${count(topic.max_items) || 6}"></div>
      <div class="field"><label for="topic-order">显示顺序</label><input class="input" id="topic-order" name="sort_order" type="number" step="1" required value="${Number.isFinite(Number(topic.sort_order)) ? Number(topic.sort_order) : 0}"><span class="small muted">数字越小越靠前。</span></div>
      <div class="field full-width"><label for="topic-description">我关心什么</label><textarea class="input" id="topic-description" name="description" rows="3" required placeholder="用平常说话的方式告诉 AI，你想了解什么。">${esc(topic.description)}</textarea><span class="small muted">尽量写清你关注的范围，以及什么信息对你有用。</span></div>
      <div class="field full-width"><label for="topic-keywords">关键词</label><input class="input" id="topic-keywords" name="keywords" value="${esc(keywordText(topic.keywords))}" placeholder="比如：桌面 agent、定时任务、实际用法"><span class="small muted">用顿号或逗号分开，可留空。</span></div>
      <div class="field"><label for="topic-sources">优先的来源</label><input class="input" id="topic-sources" name="sources" value="${esc(topic.sources)}" placeholder="比如：官方公告、开发者社区"></div>
      <div class="field"><label for="topic-excludes">不要的内容</label><input class="input" id="topic-excludes" name="excludes" value="${esc(topic.excludes)}" placeholder="比如：融资消息、重复报道"></div>
      <div class="field full-width"><label for="topic-extra">额外记录</label><input class="input" id="topic-extra" name="extra_fields" value="${esc(topic.extra_fields)}" placeholder="比如：车型、现价、降价金额、优惠截止日期"><span class="small muted">想让 AI 每条都记下的信息，用顿号分开，会显示成标签。</span></div>
      <div class="field full-width"><label for="topic-view">展示方式</label><select class="input" id="topic-view" name="view">${available.map(view => `<option value="${esc(view.id)}"${view.id === topic.view ? ' selected' : ''}>${esc(view.name)}</option>`).join('')}</select><span class="small muted">想换个样子？用「按你的想法改」告诉 AI，比如“车价主题做成对比表”，新的方式会出现在这里。</span></div>
    </div>
    <div class="actions">${topic.id ? '<button type="button" class="btn danger" data-delete-topic>删除主题</button>' : ''}<span class="spacer"></span><button type="button" class="btn" data-cancel-topic>取消修改</button><button type="submit" class="btn primary">保存主题</button></div>
    <p class="small muted" data-topic-dirty hidden>有尚未保存的修改。</p>
  </form>`;
}

function learnedPanel(learned) {
  return `<section class="card pad learned-panel"><div class="head"><h2>AI 从你的反馈里学到的</h2><span class="small muted">AI 写入，你可以删除</span></div>
    <div data-learned-list>${learned.length ? learned.map(entry => `<div class="learned-entry" data-learned-entry><div>${entry.topic_id == null ? '<span class="tag">适用于所有主题</span> ' : ''}${esc(entry.text)}</div><button type="button" class="btn link small" data-delete-learned="${count(entry.id)}" aria-label="删除这条偏好">删除</button></div>`).join('') : '<p class="muted">还没有记录。收藏、标记不感兴趣或写下备注，AI 下次更新时会参考。</p>'}</div>
  </section>`;
}

async function act(app, button, task, failure = '暂时没有保存成功，请重试。') {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  const controls = [...(button?.closest('form')?.elements || [])].filter(control => !control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try {
    await task();
  } catch (error) {
    console.error(error);
    app.notify(failure, 'bad');
  } finally {
    controls.forEach(control => { if (control.isConnected) control.disabled = false; });
    if (button?.isConnected) button.disabled = false;
  }
}

function bindCommon(root, app) {
  root.querySelectorAll('[data-settings-refresh]').forEach(button => {
    button.addEventListener('click', () => act(app, button, () => app.refresh(), '暂时读不到数据，请重试。'));
  });
  root.querySelectorAll('[data-go-page]').forEach(button => {
    button.addEventListener('click', () => app.navigate(button.dataset.goPage));
  });
  root.querySelectorAll('[data-copy-path]').forEach(button => {
    button.addEventListener('click', () => act(app, button, async () => {
      await copy(projectPath(app));
      app.notify('已复制应用文件夹路径');
    }, '暂时无法复制，请选择文件夹路径后手动复制。'));
  });
  root.querySelectorAll('[data-schedule-time]').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.value || !input.checkValidity()) return;
      app.state.scheduleTime = input.value;
      root.querySelectorAll('[data-setup-prompt]').forEach(prompt => { prompt.textContent = setupPrompt(app); });
    });
  });
  root.querySelectorAll('[data-copy-setup]').forEach(button => {
    button.addEventListener('click', () => act(app, button, async () => {
      await copy(setupPrompt(app));
      app.state.setupCopied = true;
      root.querySelectorAll('[data-copy-status]').forEach(status => { status.hidden = false; });
      app.notify('已复制，请在你的 AI 工具里粘贴发送');
    }, '暂时无法复制，请选择提示词后手动复制。'));
  });
  root.querySelectorAll('[data-copy-manual]').forEach(button => {
    button.addEventListener('click', () => act(app, button, async () => {
      await copy(manualPrompt(app));
      app.notify('已复制，请在你的 AI 工具里粘贴发送');
    }, '暂时无法复制，请选择提示词后手动复制。'));
  });
}

function bindSample(root, app, topics) {
  root.querySelectorAll('[data-create-sample]').forEach(button => {
    button.addEventListener('click', () => act(app, button, async () => {
      if (root.dataset.dirty === 'true' && !window.confirm('当前修改还没有保存，要用示例主题开始吗？')) return;
      const topic = await app.db.saveTopic({ ...newTopic(topics), name: 'AI 工具动态', description: '桌面 agent、AI 编程工具的新功能和实际用法。', keywords: ['桌面 agent', 'AI 编程工具'], sources: '官方公告、开发者社区' });
      app.state.topicId = topic.id;
      delete root.dataset.dirty;
      app.notify('已添加“AI 工具动态”，可以随时修改');
      await app.refresh();
    }));
  });
}

async function topicsPage(app) {
  const topics = rows(await app.db.topics());
  let selected;
  if (app.state.topicId !== 'new') selected = topics.find(topic => String(topic.id) === String(app.state.topicId)) || topics[0];
  if (selected) app.state.topicId = selected.id;
  const topic = selected || newTopic(topics);
  const learned = rows(await app.db.learned(topic.id ?? null));
  return {
    html: `${pageHeader('主题', '告诉 AI 你关心什么。每次更新前，AI 会先读这里的设置和你的反馈。', '<button type="button" class="btn primary" data-new-topic>添加主题</button>')}
      ${topics.length ? '' : '<div class="card pad empty"><h2>先写一个你关心的主题</h2><p class="muted">可以直接填写下面的表单，也可以用示例主题开始。</p><button type="button" class="btn" data-create-sample>用示例主题开始</button></div>'}
      <div class="settings-split"><aside class="card topic-list" aria-label="主题列表">${topics.length ? topics.map(entry => `<button type="button" class="topic-choice${entry.id === topic.id ? ' on' : ''}" data-topic-id="${count(entry.id)}"${entry.id === topic.id ? ' aria-current="true"' : ''}><span class="topic-choice-head"><strong>${esc(entry.name)}</strong><span class="pill ${Number(entry.enabled) === 1 ? 'ok' : 'muted'}">${Number(entry.enabled) === 1 ? '开启' : '已暂停'}</span></span><span class="topic-description">${esc(entry.description)}</span><span class="small muted">最近一次 ${count(entry.latest_count)} 条 · 收藏 ${count(entry.starred_count)}</span></button>`).join('') : '<p class="pad muted">还没有主题</p>'}</aside><div class="topic-detail">${topicForm(topic, app.views)}${learnedPanel(learned)}</div></div>`,
    bind(root) {
      bindCommon(root, app);
      bindSample(root, app, topics);
      const form = root.querySelector('[data-topic-form]');
      const markDirty = () => {
        root.dataset.dirty = 'true';
        form.querySelector('[data-topic-dirty]').hidden = false;
      };
      form.addEventListener('input', markDirty);
      form.addEventListener('change', markDirty);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const fields = new FormData(form);
        const name = String(fields.get('name') || '').trim();
        const description = String(fields.get('description') || '').trim();
        if (!name || !description) {
          app.notify('请填写主题名称和你关心的内容', 'bad');
          form.elements.namedItem(name ? 'description' : 'name').focus();
          return;
        }
        const button = form.querySelector('[type="submit"]');
        act(app, button, async () => {
          const saved = await app.db.saveTopic({ ...topic, name, description,
            keywords: [...new Set(String(fields.get('keywords') || '').split(/[、,，;；\n]/).map(word => word.trim()).filter(Boolean))],
            sources: String(fields.get('sources') || '').trim(), excludes: String(fields.get('excludes') || '').trim(), extra_fields: String(fields.get('extra_fields') || '').trim(),
            max_items: Number(fields.get('max_items')), sort_order: Number(fields.get('sort_order')), view: String(fields.get('view') || 'list'), enabled: fields.has('enabled') ? 1 : 0 });
          app.state.topicId = saved.id;
          delete root.dataset.dirty;
          app.notify('主题已保存，AI 下次更新时会读取');
          await app.refresh();
        });
      });
      root.querySelector('[data-cancel-topic]').addEventListener('click', () => {
        form.reset();
        delete root.dataset.dirty;
        form.querySelector('[data-topic-dirty]').hidden = true;
      });
      const selectTopic = async id => {
        if (root.dataset.dirty === 'true' && !window.confirm('当前修改还没有保存，要放弃修改吗？')) return;
        app.state.topicId = id;
        delete root.dataset.dirty;
        await app.refresh();
      };
      root.querySelector('[data-new-topic]').addEventListener('click', event => act(app, event.currentTarget, () => selectTopic('new')));
      root.querySelectorAll('[data-topic-id]').forEach(button => {
        button.addEventListener('click', () => {
          if (String(button.dataset.topicId) === String(topic.id)) return;
          act(app, button, () => selectTopic(Number(button.dataset.topicId)));
        });
      });
      root.querySelector('[data-delete-topic]')?.addEventListener('click', event => act(app, event.currentTarget, async () => {
        if (!window.confirm(`删除“${topic.name}”这个主题？\n这个主题的历史内容会保留，收藏和备注也会保留。`)) return;
        await app.db.deleteTopic(topic.id);
        delete app.state.topicId;
        delete root.dataset.dirty;
        app.notify('主题已删除，历史内容已保留');
        await app.refresh();
      }));
      root.querySelectorAll('[data-delete-learned]').forEach(button => {
        button.addEventListener('click', () => act(app, button, async () => {
          await app.db.deleteLearned(Number(button.dataset.deleteLearned));
          button.closest('[data-learned-entry]').remove();
          const list = root.querySelector('[data-learned-list]');
          if (!list.querySelector('[data-learned-entry]')) list.innerHTML = '<p class="muted">还没有记录。收藏、标记不感兴趣或写下备注，AI 下次更新时会参考。</p>';
          app.notify('已删除这条偏好');
        }));
      });
    }
  };
}

async function latestSuccess(db, setupOnly = false) {
  const result = await db.query(`SELECT * FROM runs WHERE status IN ('done', 'partial')${setupOnly ? " AND trigger = 'setup'" : ''} ORDER BY julianday(started_at) DESC, id DESC LIMIT 1`, [], 1);
  return rows(result)[0] || null;
}

function timeMarkup(value) {
  return value ? `<time datetime="${esc(value)}" title="${esc(date(value))}">${esc(relative(value))}</time>` : '时间未填写';
}

async function updatesPage(app) {
  const limit = Math.max(30, count(app.state.runLimit) || 30);
  const [latest, success, chunks] = await Promise.all([
    app.db.latestRun(), latestSuccess(app.db),
    Promise.all(Array.from({ length: Math.ceil(limit / 30) }, (_, index) => app.db.runs(30, index * 30)))
  ]);
  const runs = chunks.flatMap(rows);
  const status = runStatus(latest, success);
  const schedule = latest?.schedule || runs.find(run => run.schedule)?.schedule || success?.schedule || '';
  const hasMore = rows(chunks[chunks.length - 1]).length === 30;
  const invalid = count(app.state.invalidCount);
  return {
    html: `${pageHeader('更新与记录', '内容由你的 AI 在它自己的软件里更新，拾闻显示状态和记录。')}
      <section class="card pad status-banner ${esc(status.tone)}" role="status"><strong>${esc(status.text)}</strong>${status.detail ? `<p>${esc(status.detail)}</p>` : ''}${latest?.status === 'failed' && latest.message && latest.message !== status.detail ? `<p>${esc(latest.message)}</p>` : ''}</section>
      ${invalid ? `<p class="notice warn">有 ${invalid} 条内容格式不对，已跳过。可以让 AI 检查最近写入的内容。</p>` : ''}
      <section class="card pad stats-grid">
        <div class="stat"><span class="small muted">上次更新</span><strong>${latest ? `${timeMarkup(latest.finished_at || latest.started_at)} · ${esc(RUN_LABELS[latest.status] || '状态待确认')}` : '还没有运行记录'}</strong><span class="small muted">${latest ? `${esc(latest.agent || 'AI 工具未注明')} · 新增 ${count(latest.added)} 条` : '把设置提示词发给你的 AI，即可开始。'}</span></div>
        <div class="stat"><span class="small muted">自动更新</span><strong>${esc(schedule || '尚未记录定时安排')}</strong><span class="small muted">${schedule ? '由你的 AI 工具中的定时任务运行' : '请在 AI 工具里设置，拾闻不安排定时任务。'}</span></div>
        <div class="stat"><span class="small muted">配图</span><strong>保存在本机</strong><span class="small muted">只存缩略图；下载失败时尝试显示原图。</span></div>
      </section>
      <div class="step-grid">${setupPanel(app)}<section class="card pad setup-panel"><h2>现在手动更新一次</h2><p class="muted">把下面的话发给你的 AI 工具。也可以直接在 AI 工具里说“更新简报”。</p><pre class="prompt">${esc(manualPrompt(app))}</pre>${pathControls(app)}<div class="actions"><button type="button" class="btn" data-copy-manual>复制手动更新提示词</button></div></section></div>
      <section class="card runs-panel"><div class="head pad"><h2>运行记录</h2><span class="small muted">AI 每次运行都留一条</span></div>${runs.length ? `<div class="table-wrap"><table><thead><tr><th>时间</th><th>AI 工具</th><th>方式</th><th>结果</th><th>状态</th></tr></thead><tbody>${runs.map(run => `<tr><td>${timeMarkup(run.finished_at || run.started_at)}</td><td>${esc(run.agent || '未注明')}</td><td>${esc(TRIGGER_LABELS[run.trigger] || '未注明')}</td><td><span>新增 ${count(run.added)} 条，跳过重复 ${count(run.skipped)} 条，配图 ${count(run.images_saved)} 张${count(run.images_failed) ? `，${count(run.images_failed)} 张配图下载失败` : ''}</span>${run.message ? `<p class="small muted run-message">${esc(run.message)}</p>` : ''}</td><td><span class="pill ${esc(RUN_TONES[run.status] || 'muted')}">${esc(RUN_LABELS[run.status] || '待确认')}</span></td></tr>`).join('')}</tbody></table></div>${hasMore ? '<div class="pad"><button type="button" class="btn" data-more-runs>再加载 30 条</button></div>' : ''}` : '<div class="empty pad"><p class="muted">还没有运行记录。把上面的设置提示词发给你的 AI，完成后回到这里刷新。</p></div>'}</section>`,
    bind(root) {
      bindCommon(root, app);
      root.querySelector('[data-more-runs]')?.addEventListener('click', event => act(app, event.currentTarget, async () => {
        app.state.runLimit = limit + 30;
        await app.refresh();
      }, '暂时读不到更多记录，请重试。'));
    }
  };
}

async function onboardingPage(app) {
  const [topicResult, setup, latest] = await Promise.all([app.db.topics(), latestSuccess(app.db, true), app.db.latestRun()]);
  const topics = rows(topicResult);
  const hasTopics = topics.length > 0;
  const setupFailed = latest?.trigger === 'setup' && latest.status === 'failed';
  return {
    html: `${pageHeader('你的 AI 去收集，你在这里看', '拾闻不自带 AI，也不自己上网。内容由你常用的 AI 工具收集；简报、配图和你的反馈都留在这台电脑上。')}
      <ol class="onboarding-steps">
        <li class="step card pad"><span class="step-number${hasTopics ? ' done' : ' current'}">${hasTopics ? '✓' : '1'}</span><div class="step-body"><h2>写一个主题</h2>${hasTopics ? `<p class="muted">已添加${topics.slice(0, 3).map(topic => `“${esc(topic.name)}”`).join('、')}${topics.length > 3 ? `等 ${topics.length} 个主题` : ''}，可以随时修改或再加。</p><button type="button" class="btn" data-go-page="topics">管理主题</button>` : '<p class="muted">用平常说话的方式，告诉 AI 你想了解什么。</p><form data-first-topic-form class="first-topic-form"><div class="field"><label for="first-topic-name">主题名称</label><input class="input" id="first-topic-name" name="name" required placeholder="比如：AI 工具动态"></div><div class="field"><label for="first-topic-description">我关心什么</label><textarea class="input" id="first-topic-description" name="description" rows="3" required placeholder="比如：桌面 agent、AI 编程工具的新功能和实际用法。"></textarea></div><div class="actions"><button type="submit" class="btn primary">保存主题</button><button type="button" class="btn" data-create-sample>用示例主题开始</button></div></form>'}</div></li>
        <li class="step card pad"><span class="step-number${setup ? ' done' : hasTopics ? ' current' : ''}">${setup ? '✓' : '2'}</span><div class="step-body">${setup ? `<h2>连接你的 AI</h2><p class="connection-success">已连接 · ${esc(setup.agent || '你的 AI')}${setup.schedule ? ` · ${esc(setup.schedule)}` : ''}</p><p class="muted">${setup.schedule ? '定时安排由 AI 自报，可以在“更新与记录”里查看。' : 'AI 已完成第一次运行，定时安排尚未记录。可以在“更新与记录”里复制设置提示词。'}</p><button type="button" class="btn" data-go-page="updates">查看更新与记录</button>` : hasTopics ? `${setupPanel(app, { onboarding: true })}${latest?.trigger === 'setup' && latest.status === 'running' ? '<p class="notice">AI 正在更新…完成后回到这里刷新。</p>' : ''}${setupFailed ? `<p class="notice bad">第一次运行没有完成。${esc(latest.message || '请在你的 AI 工具里查看原因，然后重试。')}</p>` : ''}` : '<h2>连接你的 AI</h2><p class="muted">先添加主题，再把设置提示词发给你的 AI 工具。</p>'}</div></li>
        <li class="step card pad"><span class="step-number${setup ? ' current' : ''}">3</span><div class="step-body"><h2>看第一期</h2>${setup ? '<p class="muted">第一次运行已完成，可以开始浏览和收藏了。</p><button type="button" class="btn primary" data-go-page="today">去看今日简报</button>' : '<p class="muted">AI 完成第一次运行后，这里会显示连接状态和“去看今日简报”。复制提示词后，请在 AI 工具里粘贴发送。</p>'}</div></li>
      </ol>`,
    bind(root) {
      bindCommon(root, app);
      bindSample(root, app, topics);
      const form = root.querySelector('[data-first-topic-form]');
      if (!form) return;
      form.addEventListener('input', () => { root.dataset.dirty = 'true'; });
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const fields = new FormData(form);
        const name = String(fields.get('name') || '').trim();
        const description = String(fields.get('description') || '').trim();
        if (!name || !description) {
          app.notify('请填写主题名称和你关心的内容', 'bad');
          form.elements.namedItem(name ? 'description' : 'name').focus();
          return;
        }
        act(app, form.querySelector('[type="submit"]'), async () => {
          const topic = await app.db.saveTopic({ ...newTopic(topics), name, description });
          app.state.topicId = topic.id;
          delete root.dataset.dirty;
          app.notify('主题已保存，接下来连接你的 AI');
          await app.refresh();
        });
      });
    }
  };
}

export async function renderSettingsPage(page, app) {
  if (page === 'topics') return topicsPage(app);
  if (page === 'updates') return updatesPage(app);
  if (page === 'onboarding') return onboardingPage(app);
  throw new Error('未知的设置页面');
}
