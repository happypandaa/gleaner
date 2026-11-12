export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const icon = name => `<span class="ui-icon-slot"><img class="ui-icon" src="./assets/${name}.svg" alt=""></span>`;
export function date(value, options = {}) {
  if (!value) return '时间未知';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', {month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',...options}).format(d);
}
export function day(value = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function relative(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '时间未知';
  const d = new Date(value), now = new Date();
  if (day(d) === day(now)) return `今天 ${d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})}`;
  return date(value);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const el = document.createElement('textarea');
    el.value = text; el.style.position='fixed'; el.style.opacity='0'; document.body.append(el);
    el.select(); const ok = document.execCommand('copy'); el.remove();
    if (!ok) throw new Error('复制失败，请选中提示词后手动复制');
  }
}
// Describes only what the run records show. The app cannot know whether an AI tool is set up,
// so it never reports a "connected" state or warns about a missing daily update.
export function lastUpdate(latest, success) {
  if (!latest) return {text:'还没有更新记录',tone:'muted',detail:''};
  if (latest.status === 'running') return Date.now()-new Date(latest.started_at).getTime()<3600000
    ? {text:'AI 正在更新…',tone:'info',detail:latest.agent || '完成后刷新查看'}
    : {text:'上次更新可能中断了',tone:'warn',detail:'可以让 AI 再更新一次'};
  if (latest.status === 'failed') return {text:'上次更新没有完成',tone:'bad',detail:latest.message || '可以让 AI 再更新一次'};
  const stamp = success?.finished_at || success?.started_at;
  if (!stamp) return {text:'还没有更新记录',tone:'muted',detail:''};
  return {text:`上次更新：${relative(stamp)}`,tone:'muted',detail:success.agent || ''};
}
export function safeLink(value) {
  try {const url=new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch {return '';}
}
export const empty = (title, text='') => `<div class="empty"><span class="empty-symbol" aria-hidden="true">拾</span><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
