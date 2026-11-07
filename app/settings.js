import { esc, date, relative, lastUpdate } from './utils.js';

const RUN_LABELS = { running: '更新中', done: '完成', partial: '部分完成', failed: '未完成' };
const TRIGGER_LABELS = { setup: '首次', scheduled: '定时', manual: '手动' };
const RUN_TONES = { running: 'info', done: 'ok', partial: 'warn', failed: 'bad' };

function rows(result) {
  return Array.isArray(result) ? result : (result?.rows || []);
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
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

function provenance(topic) {
  const when = relative(topic.updated_at);
  if (topic.updated_by === 'agent') {
    return topic.created_at === topic.updated_at ? `AI 按你的要求创建 · ${when}` : `AI 按你的要求修改 · ${when}`;
  }
  return `你在 ${when} 修改过`;
}

function topicForm(topic, views) {
  const available = views?.length ? [...views] : [{ id: 'list', name: '列表' }];
  if (!available.some(view => view.id === topic.view)) available.push({ id: topic.view, name: '当前方式暂不可用（使用列表显示）' });
  return `<form class="card pad topic-editor" data-topic-form>
    <div class="head"><div><h2>${esc(topic.name)}</h2><span class="small muted">${esc(provenance(topic))}</span></div><label class="check-label"><input type="checkbox" name="enabled"${Number(topic.enabled) === 1 ? ' checked' : ''}> 开启这个主题</label></div>
    <div class="form-grid">
      <div class="field full-width"><label for="topic-name">主题名称</label><input class="input" id="topic-name" name="name" required value="${esc(topic.name)}"></div>
      <div class="field"><label for="topic-max">每次最多几条</label><input class="input" id="topic-max" name="max_items" type="number" min="1" max="20" step="1" required value="${count(topic.max_items) || 6}"></div>
      <div class="field"><label for="topic-order">显示顺序</label><input class="input" id="topic-order" name="sort_order" type="number" step="1" required value="${Number.isFinite(Number(topic.sort_order)) ? Number(topic.sort_order) : 0}"><span class="small muted">数字越小越靠前。</span></div>
      <div class="field full-width"><label for="topic-description">我关心什么</label><textarea class="input" id="topic-description" name="description" rows="3" required>${esc(topic.description)}</textarea><span class="small muted">尽量写清你关注的范围，以及什么信息对你有用。</span></div>
      <div class="field full-width"><label for="topic-keywords">关键词</label><input class="input" id="topic-keywords" name="keywords" value="${esc(keywordText(topic.keywords))}"><span class="small muted">用顿号或逗号分开，可留空。</span></div>
      <div class="field"><label for="topic-sources">优先的来源</label><input class="input" id="topic-sources" name="sources" value="${esc(topic.sources)}"></div>
      <div class="field"><label for="topic-excludes">不要的内容</label><input class="input" id="topic-excludes" name="excludes" value="${esc(topic.excludes)}"></div>
      <div class="field full-width"><label for="topic-extra">额外记录</label><input class="input" id="topic-extra" name="extra_fields" value="${esc(topic.extra_fields)}"><span class="small muted">想让 AI 每条都记下的信息，用顿号分开，会显示成标签。</span></div>
      <div class="field full-width"><label for="topic-view">展示方式</label><select class="input" id="topic-view" name="view">${available.map(view => `<option value="${esc(view.id)}"${view.id === topic.view ? ' selected' : ''}>${esc(view.name)}</option>`).join('')}</select><span class="small muted">想换个样子？用「按你的想法改」告诉 AI，比如“车价主题做成对比表”，新的方式会出现在这里。</span></div>
    </div>
    <div class="actions"><button type="button" class="btn danger" data-delete-topic>删除主题</button><span class="spacer"></span><button type="button" class="btn" data-cancel-topic>取消修改</button><button type="submit" class="btn primary">保存修改</button></div>
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
    app.notify(error?.code === 'TOPIC_CHANGED' ? error.message : failure, 'bad');
  } finally {
    controls.forEach(control => { if (control.isConnected) control.disabled = false; });
    if (button?.isConnected) button.disabled = false;
  }
}

function bindCommon(root, app) {
  root.querySelectorAll('[data-settings-refresh]').forEach(button => {
    button.addEventListener('click', () => act(app, button, () => app.refresh(), '暂时读不到数据，请重试。'));
  });
}

async function topicsPage(app) {
  const topics = rows(await app.db.topics());
  const askAi = '<button type="button" class="btn link" data-ai-guide="start">想关注新的内容？告诉你的 AI</button>';
  const header = pageHeader('主题', '主题由你的 AI 按你的描述建立。你可以在这里调整，AI 下次更新时按新的设置收集。', askAi);
  if (!topics.length) {
    return {
      html: `${header}<section class="card pad empty"><span class="empty-symbol" aria-hidden="true">拾</span><strong>主题由你的 AI 帮你建立</strong><p>告诉它你想关注什么就行。</p><button type="button" class="btn link" data-ai-guide="start">在 AI 里使用拾闻 →</button></section>`,
      bind: root => bindCommon(root, app),
    };
  }
  const topic = topics.find(entry => String(entry.id) === String(app.state.topicId)) || topics[0];
  app.state.topicId = topic.id;
  const learned = rows(await app.db.learned(topic.id));
  return {
    html: `${header}
      <div class="settings-split"><aside class="card topic-list" aria-label="主题列表">${topics.map(entry => `<button type="button" class="topic-choice${entry.id === topic.id ? ' on' : ''}" data-topic-id="${count(entry.id)}"${entry.id === topic.id ? ' aria-current="true"' : ''}><span class="topic-choice-head"><strong>${esc(entry.name)}</strong><span class="pill ${Number(entry.enabled) === 1 ? 'ok' : 'muted'}">${Number(entry.enabled) === 1 ? '开启' : '已暂停'}</span></span><span class="topic-description">${esc(entry.description)}</span><span class="small muted">最近一次 ${count(entry.latest_count)} 条 · 收藏 ${count(entry.starred_count)}</span></button>`).join('')}</aside><div class="topic-detail">${topicForm(topic, app.views)}${learnedPanel(learned)}</div></div>`,
    bind(root) {
      bindCommon(root, app);
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
          const saved = await app.db.updateTopic(topic.id, { name, description,
            keywords: [...new Set(String(fields.get('keywords') || '').split(/[、,，;；\n]/).map(word => word.trim()).filter(Boolean))],
            sources: String(fields.get('sources') || '').trim(), excludes: String(fields.get('excludes') || '').trim(), extra_fields: String(fields.get('extra_fields') || '').trim(),
            max_items: Number(fields.get('max_items')), sort_order: Number(fields.get('sort_order')), view: String(fields.get('view') || 'list'), enabled: fields.has('enabled') ? 1 : 0 },
          topic.updated_at);
          app.state.topicId = saved.id;
          delete root.dataset.dirty;
          app.notify('已保存，AI 下次更新时按新的设置收集');
          await app.refresh();
        });
      });
      root.querySelector('[data-cancel-topic]').addEventListener('click', () => {
        form.reset();
        delete root.dataset.dirty;
        form.querySelector('[data-topic-dirty]').hidden = true;
      });
      root.querySelectorAll('[data-topic-id]').forEach(button => {
        button.addEventListener('click', () => {
          if (String(button.dataset.topicId) === String(topic.id)) return;
          act(app, button, async () => {
            if (root.dataset.dirty === 'true' && !window.confirm('当前修改还没有保存，要放弃修改吗？')) return;
            app.state.topicId = Number(button.dataset.topicId);
            delete root.dataset.dirty;
            await app.refresh();
          });
        });
      });
      root.querySelector('[data-delete-topic]').addEventListener('click', event => act(app, event.currentTarget, async () => {
        if (!window.confirm(`删除“${topic.name}”这个主题？\n历史内容、收藏和备注会保留；AI 为这个主题学到的偏好会一并删除。\n以后想再关注，告诉你的 AI 即可。`)) return;
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

async function latestSuccess(db) {
  const result = await db.query("SELECT * FROM runs WHERE status IN ('done', 'partial') ORDER BY julianday(started_at) DESC, id DESC LIMIT 1", [], 1);
  return rows(result)[0] || null;
}

function timeMarkup(value) {
  return value ? `<time datetime="${esc(value)}" title="${esc(date(value))}">${esc(relative(value))}</time>` : '时间未填写';
}

async function recordsPage(app) {
  const limit = Math.max(30, count(app.state.runLimit) || 30);
  const [latest, success, chunks] = await Promise.all([
    app.db.latestRun(), latestSuccess(app.db),
    Promise.all(Array.from({ length: Math.ceil(limit / 30) }, (_, index) => app.db.runs(30, index * 30)))
  ]);
  const runs = chunks.flatMap(rows);
  const status = lastUpdate(latest, success);
  const hasMore = rows(chunks[chunks.length - 1]).length === 30;
  const invalid = count(app.state.invalidCount);
  const notice = ['info', 'warn', 'bad'].includes(status.tone) ? `<p class="notice ${status.tone === 'info' ? '' : esc(status.tone)}">${esc(status.text)}${status.detail ? `：${esc(status.detail)}` : ''}</p>` : '';
  return {
    html: `${pageHeader('记录', 'AI 每次更新都会在这里留下一条记录。', '<button type="button" class="btn link" data-ai-guide="daily">想让 AI 每天自动更新？</button>')}
      ${notice}
      ${invalid ? `<p class="notice warn">有 ${invalid} 条内容格式不对，已跳过。可以让 AI 检查最近写入的内容。</p>` : ''}
      <section class="card runs-panel">${runs.length ? `<div class="table-wrap"><table><thead><tr><th>时间</th><th>AI 工具</th><th>方式</th><th>结果</th><th>状态</th></tr></thead><tbody>${runs.map(run => `<tr><td>${timeMarkup(run.finished_at || run.started_at)}</td><td>${esc(run.agent || '未注明')}</td><td>${esc(TRIGGER_LABELS[run.trigger] || '未注明')}${run.schedule ? `<p class="small muted">${esc(run.schedule)}</p>` : ''}</td><td><span>新增 ${count(run.added)} 条，跳过重复 ${count(run.skipped)} 条，配图 ${count(run.images_saved)} 张${count(run.images_failed) ? `，${count(run.images_failed)} 张配图下载失败` : ''}</span>${run.message ? `<p class="small muted run-message">${esc(run.message)}</p>` : ''}</td><td><span class="pill ${esc(RUN_TONES[run.status] || 'muted')}">${esc(RUN_LABELS[run.status] || '待确认')}</span></td></tr>`).join('')}</tbody></table></div>${hasMore ? '<div class="pad"><button type="button" class="btn" data-more-runs>再加载 30 条</button></div>' : ''}` : '<div class="empty pad"><strong>还没有记录</strong><p>AI 第一次更新后，记录会出现在这里。</p><button type="button" class="btn link" data-ai-guide="start">在 AI 里使用拾闻 →</button></div>'}</section>`,
    bind(root) {
      bindCommon(root, app);
      root.querySelector('[data-more-runs]')?.addEventListener('click', event => act(app, event.currentTarget, async () => {
        app.state.runLimit = limit + 30;
        await app.refresh();
      }, '暂时读不到更多记录，请重试。'));
    }
  };
}

export async function renderSettingsPage(page, app) {
  if (page === 'topics') return topicsPage(app);
  if (page === 'records') return recordsPage(app);
  throw new Error('未知的设置页面');
}
