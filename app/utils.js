export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
export function runStatus(latest, success) {
  if (!latest) return {text:'还没有连接 AI',tone:'muted',detail:'先写主题，再连接你的 AI'};
  if (latest.status === 'running') return Date.now()-new Date(latest.started_at).getTime()<3600000
    ? {text:'AI 正在更新…',tone:'ok',detail:latest.agent || '稍后刷新查看结果'}
    : {text:'上次更新可能中断了',tone:'warn',detail:'请检查 AI 工具中的任务'};
  if (latest.status === 'failed') return {text:'上次更新失败',tone:'bad',detail:latest.message || '请检查 AI 工具中的任务'};
  const stamp = success?.finished_at || success?.started_at;
  if (!stamp) return {text:'还没有成功更新',tone:'warn',detail:'请检查 AI 工具中的任务'};
  if (Date.now()-new Date(stamp).getTime()>26*3600000) return {text:`已经 ${Math.max(1,Math.floor((Date.now()-new Date(stamp).getTime())/86400000))} 天没有更新`,tone:'warn',detail:'请检查 AI 工具里的定时任务'};
  return {text:`${relative(stamp)} 已更新`,tone:'ok',detail:[success.agent,success.schedule].filter(Boolean).join(' · ') || '内容已保存在本机'};
}
export function safeLink(value) {
  try {const url=new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch {return '';}
}
export const empty = (title, text='') => `<div class="empty"><span class="empty-symbol" aria-hidden="true">拾</span><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
