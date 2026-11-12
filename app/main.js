import * as db from './db.js';
import { esc, date, day, relative, copy, lastUpdate, safeLink, empty, icon } from './utils.js';
import { views, getView } from './views/index.js';
import { renderSettingsPage } from './settings.js';
import { cleanupImages } from './cleanup.js';
import { openGuide, prompts } from './guide.js';
import { bindTodayTopics, renderTodayTopics } from './today-topics.js';

const main = document.querySelector('#main');
const pages = ['today','all','favorites','topics','records'];
const pageFrom = hash => hash==='updates' ? 'records' : pages.includes(hash) ? hash : 'today';
const state = { page:pageFrom(location.hash.slice(1)), filters:{}, selectedId:null, invalidCount:0, newCount:0 };
const app = { db, views, state, context:{}, navigate, refresh:() => render(), notify };
let rendering = 0, knownItemId = null, initialized = false, toastTimer;
let unbindContent;
const drafts = new Map();
let noteSave = Promise.resolve();

function notify(message, type='info') {
  const el=document.querySelector('#toast'); el.textContent=message; el.className=type; el.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{el.hidden=true;},4200);
}
function errorMessage(error) {
  if (error?.code === 'SQL_BUSY' || /locked/i.test(error?.message || '')) return 'AI 可能正在保存内容，请稍后重试';
  return '暂时读不到数据，请稍后重试';
}
async function persistNotes() {
  for (const [id, text] of drafts) {
    await db.setItemUser(id,{note:text});
    if (drafts.get(id)===text) drafts.delete(id);
  }
}
async function navigate(page) {
  page=pageFrom(page);
  try {await noteSave; await persistNotes();} catch {notify('备注还没保存成功，请稍后重试','bad');return;}
  if (main.dataset.dirty==='true' && !confirm('主题的修改还没有保存，确定离开吗？')) return;
  delete main.dataset.dirty;
  state.page=page;state.selectedId=null;
  if (location.hash!==`#${page}`) history.replaceState(null,'',`#${page}`);
  await render({resetListScroll:true});
}
async function action(button, fn) {
  if (button?.disabled) return;
  if (button) button.disabled=true;
  try {await noteSave;await persistNotes();await fn();}
  catch(error) {console.error(error);notify(errorMessage(error),'bad');}
  finally {if(button?.isConnected)button.disabled=false;}
}
function filters() {
  return state.filters[state.page] ||= {search:'',topicId:'',status:'all',order:state.page==='favorites'?'starred':'newest',range:'',from:'',to:'',limit:50,notesOnly:false};
}
function picture(item, className='') {
  if(!item.image_path && !item.image_url) return '';
  return `<img class="${className}" data-image-id="${item.id}" data-image-path="${esc(item.image_path || '')}" data-image-url="${esc(item.image_url || '')}" alt="" hidden>`;
}
function thumb(item, small=false, hero=false) {
  const source=String(item.source || '闻');
  const color=['blue','sage','sand','violet'][Math.abs([...source].reduce((s,c)=>s+c.charCodeAt(0),0))%4];
  return `<div class="${hero?'hero':'thumb'} ${small?'s':''} ${color}" aria-hidden="true"><span>${esc(source.slice(0,1))}</span>${picture(item)}</div>`;
}
async function hydrateImages(root) {
  await Promise.all([...root.querySelectorAll('img[data-image-id]')].map(async img=>{
    const remote=img.dataset.imageUrl.startsWith('https://') ? safeLink(img.dataset.imageUrl) : '';
    let fallback=false;
    const container=img.closest('[data-image-container]');
    img.onload=()=>{img.hidden=false;if(container)container.hidden=false;};
    img.onerror=()=>{if(remote && !fallback){fallback=true;img.src=remote;}else{img.hidden=true;}};
    try {
      if(img.dataset.imagePath) img.src=await window.panda.files.url(img.dataset.imagePath);
      else if(remote){fallback=true;img.src=remote;}
    }catch {if(remote){fallback=true;img.src=remote;}}
  }));
}
function highlight(text, search) {
  if(!search) return esc(text);
  const value=String(text || ''), q=search.toLocaleLowerCase();
  let start=0, out='', index;
  while((index=value.toLocaleLowerCase().indexOf(q,start))>=0){out+=esc(value.slice(start,index))+`<mark>${esc(value.slice(index,index+q.length))}</mark>`;start=index+q.length;}
  return out+esc(value.slice(start));
}
function extraTags(item, limit=3) {
  return `<span class="extra">${Object.entries(item.extra || {}).filter(([key])=>key!=='配图类型').slice(0,limit).map(([key,value])=>`<span>${esc(key)} <b>${esc(value)}</b></span>`).join('')}</span>`;
}
function row(item, selectedId=state.selectedId) {
  if(item.is_dismissed && filters().status!=='dismissed') return `<div class="dismissed"><button class="dismissed-title" data-open="${item.id}">已忽略 · ${esc(item.title)}</button><button class="btn link" data-undo="${item.id}">撤销</button></div>`;
  const selected=selectedId===item.id;
  const title=`<span class="title ${item.is_read?'':'unread'}">${highlight(item.title,filters().search)}</span>`;
  const unread=item.is_read?'':'<i class="unread-dot" aria-hidden="true"></i>';
  const source=esc(item.source || '未知来源');
  const open=`<button class="row ${selected?'on':''}" data-open="${item.id}" aria-pressed="${selected}">`;
  if(state.page==='today'){
    const photo=['照片','插图'].includes(item.extra?.['配图类型'])?picture(item):'';
    return `${open}<span class="body"><span class="today-title-line">${unread}${item.is_read?'':'<span class="sr">未读</span>'}${title}</span>
      ${extraTags(item)}<span class="meta">${source}</span></span>
      ${photo?`<span class="today-photo" data-image-container hidden>${photo}</span>`:''}
      ${item.is_starred?`<span class="today-row-end">${icon('star-fill')}<span class="sr">已收藏</span></span>`:''}</button>`;
  }
  return `${open}
    ${thumb(item,state.page==='all')}<span class="body">${title}
    ${state.page==='all'?`<span class="row-summary">${highlight(item.summary,filters().search)}</span>`:''}${extraTags(item)}
    <span class="meta">${unread}<span class="tag">${esc(item.topic_name || '已删除的主题')}</span>${source} · ${esc(relative(item.published_at || item.collected_at))}${item.is_starred?'<span class="star-mark">★</span>':''}</span></span>
  </button>`;
}
function groupItems(items, selectedId=state.selectedId) {
  const groups=new Map();
  for(const item of items){const key=state.page==='all'?`${day(item.collected_at)}:${item.topic_id ?? ''}`:String(item.topic_id ?? '');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  return [...groups.values()].map(group=>{
    const first=group[0], name=first.topic_name || '已删除的主题';
    const label=state.page==='all'?`${esc(date(first.collected_at,{hour:undefined,minute:undefined}))} · `:'';
    const contents=`<div class="group-head"><strong>${label}${esc(name)}</strong><span>${group.length} 条</span></div>${getView(first.topic_view).render(group,{renderRow:item=>row(item,selectedId),esc})}`;
    return state.page==='today'?`<section class="today-topic-group" aria-label="${esc(name)}">${contents}</section>`:contents;
  }).join('');
}
async function reader(item) {
  const today=state.page==='today', readerClass=`card read-col${today?' today-reader':''}`;
  if(!item) return `<article id="reader" class="${readerClass}">${empty('选一条，慢慢看','在左侧选择内容，查看摘要、留下备注。')}</article>`;
  const requests=await db.requests(item.id);
  const url=safeLink(item.url);
  const name=item.topic_name || '已删除的主题';
  const stamp=today?(item.published_at?date(item.published_at,{hour:undefined,minute:undefined}):''):relative(item.published_at || item.collected_at);
  const heading=`<h2>${esc(item.title)}</h2><span class="muted small">${esc(item.source || '未知来源')}${stamp?` · ${esc(stamp)}`:''}</span>`;
  const starLabel=item.is_starred?'已收藏':'收藏';
  const starButton=today?`<button class="btn ${item.is_starred?'star':''}" data-star="${item.id}" aria-pressed="${Boolean(item.is_starred)}">${icon(item.is_starred?'reader-star-fill':'star-nav')}${starLabel}</button>`:`<button class="btn ${item.is_starred?'star':'primary'}" data-star="${item.id}">${item.is_starred?'★':'☆'} ${starLabel}</button>`;
  const controls=today?`<div class="today-reader-controls">${starButton}</div>`:'<button class="btn close-reader link" data-close-reader aria-label="关闭阅读面板">关闭 ×</button>';
  const original=url?`<a class="btn ${today?'primary':''}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${today?`${icon('external')}打开原文`:'打开原文 ↗'}</a>`:'';
  const copyLink=`<button class="btn" data-copy-url="${item.id}">${today?icon('copy'):''}复制链接</button>`;
  const dismiss=`<button class="btn${today?' link':''}" data-dismiss="${item.id}">${item.is_dismissed?'撤销忽略':'不感兴趣'}</button>`;
  const summary=`<p class="summary">${esc(item.summary)}</p>`;
  const pending=new Set(requests.filter(r=>r.status==='pending').map(r=>r.kind));
  const research=(kind,label)=>`<button class="btn" data-request="${kind}" ${pending.has(kind)?'disabled':''}>${today&&kind==='deep_dive'?icon('deep-dive'):''}${pending.has(kind)?'已请求 · 等待 AI 处理':label}</button>`;
  const researchActions=research('deep_dive','让 AI 深入了解')+research('similar','找类似的');
  const results=requests.map(r=>`<div class="request-result"><strong>${r.kind==='deep_dive'?'深入了解':'找类似的'} <span class="pill ${r.status==='failed'?'bad':r.status==='done'?'ok':'info'}">${r.status==='done'?'已完成':r.status==='failed'?'未完成':'等待 AI 处理'}</span></strong><p>${esc(r.result || r.text || 'AI 下次更新时会处理，完成后结果显示在这里。')}</p></div>`).join('');
  const media=today?picture(item,'today-media-image'):'';
  const mediaLabel=item.extra?.['配图类型']==='截图'?'原文截图':'原文配图';
  const actions=today
    ? `${original}${copyLink}${dismiss}<span class="today-action-divider" aria-hidden="true"></span><div class="today-ai-actions">${researchActions}<small class="muted">下次更新简报时处理</small></div>`
    : `${starButton}${dismiss}${original}${copyLink}`;
  return `<article id="reader" class="${readerClass}" data-reader-item="${item.id}" aria-label="阅读内容">
    <div class="reader-top"><span class="eyebrow">${esc(name)}</span>${controls}</div>
    ${today?`<div class="today-reader-heading">${heading}</div>`:`${thumb(item,false,true)}${heading}${extraTags(item,99)}`}
    ${today?`<section class="today-summary"><strong>摘要</strong>${summary}</section>${extraTags(item,99)}`:summary}
    ${item.reason?`<p class="reason">${today?'<strong>为什么给你</strong>':'为什么给你：'}${esc(item.reason)}</p>`:''}
    <div class="reader-actions${today?' today-reader-actions':''}">${actions}</div>
    ${item.is_dismissed?`<div class="dismiss-reasons"><span class="muted small">不感兴趣的原因（选填）</span><div class="chips">${['和主题无关','来源不可靠','内容太旧','重复了'].map(reason=>`<button class="chip ${item.dismiss_reason===reason?'on':''}" data-reason="${esc(reason)}" data-id="${item.id}">${esc(reason)}</button>`).join('')}</div></div>`:''}
    <label class="field note-field"><span>我的备注 <span class="muted small" id="note-state">${today?'AI 下次更新时会参考':'· AI 下次更新时会看到'}</span></span><textarea class="input" id="item-note" data-id="${item.id}" rows="3" maxlength="10000" placeholder="${today?'记下你的想法…':'写下你的想法，AI 下次收集时会参考'}">${esc(drafts.has(item.id)?drafts.get(item.id):item.note || '')}</textarea></label>
    ${!today||results?`<section class="request-section" aria-label="AI 请求">${today?'':`<div class="reader-actions">${researchActions}</div>`}${results}</section>`:''}
    ${media?`<details class="today-media" data-image-container hidden><summary><span class="today-media-label">${icon('picture')}${mediaLabel}<small class="muted">1 张</small></span><span class="today-media-chevron">${icon('media-chevron')}</span></summary>${media}</details>`:''}
  </article>`;
}
async function dateBars(f) {
  const start=new Date();start.setDate(start.getDate()-13);start.setHours(0,0,0,0);
  const counts=await db.query("SELECT date(collected_at,'localtime') AS day, COUNT(*) AS count FROM items WHERE julianday(collected_at) >= julianday(?) GROUP BY date(collected_at,'localtime')",[start.toISOString()]);
  const max=Math.max(1,...counts.map(c=>Number(c.count)));
  return `<div class="date-bars" aria-label="最近十四天的内容量">${Array.from({length:14},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);const key=day(d), count=Number(counts.find(c=>c.day===key)?.count || 0);return `<button class="date-bar ${f.from && key>=f.from && key<=(f.to || f.from)?'on':''}" data-day="${key}" aria-label="${key}，${count} 条"><span>${count || '·'}</span><i style="height:${Math.max(3,count/max*25)}px"></i><small>${d.getMonth()+1}/${d.getDate()}</small></button>`;}).join('')}</div>`;
}
function titlebar(title, description='') {
  return `<header class="head"><div><h1>${esc(title)}</h1>${description?`<span class="muted small">${esc(description)}</span>`:''}</div><div class="tools"><button class="btn" data-refresh aria-label="刷新内容">↻ 刷新</button></div></header>`;
}
function briefingStatus(latest, run, today) {
  if (!latest || latest.status === 'running' || latest.status === 'failed') return lastUpdate(latest, latest);
  const checkedAt = latest.finished_at || latest.started_at;
  if (day(checkedAt) !== today) return {text:'今天还没更新',tone:'muted'};
  if (latest.id === run?.id) return null;
  if (latest.status === 'partial') return {text:'今天更新部分完成',tone:'warn',detail:latest.message};
  if (latest.message === '还没有开启的主题') return {text:latest.message,tone:'muted'};
  if (latest.added > 0) return lastUpdate(latest, latest);
  return {text:`${relative(checkedAt)} 已检查 · 暂无新增`,tone:'ok',detail:latest.message};
}
function todayHeader(run, stats, latest) {
  const today=day();
  const completedAt=run?.finished_at || run?.started_at;
  const title=run ? (day(completedAt)===today ? '今日简报' : '最新简报') : '简报';
  const status=briefingStatus(latest,run,today);
  const reload='重新载入已收录的内容';
  return `<header class="head today-head"><div class="today-heading"><h1>${title}</h1>${run?`<p class="today-date"><time datetime="${esc(completedAt)}">${esc(date(completedAt))}</time> 更新 · ${stats.total} 条 · ${stats.unread} 未读</p>`:''}</div><div class="tools">
    ${run?`<button class="btn" data-mark-read ${Number(stats.unread)===0?'disabled':''}>${icon('check')}全部标为已读</button>`:''}
    <div class="today-update">
      ${status?`<a class="today-update-status" href="#records"${status.detail?` title="${esc(status.detail)}"`:''}><span class="dot ${esc(status.tone)}" aria-hidden="true"></span>${esc(status.text)}</a>`:''}
      <button class="btn" data-refresh aria-label="${reload}" title="${reload}">${icon('refresh')}重新载入</button>
    </div>
  </div></header>`;
}
function searchField(value, placeholder, today=false) {
  return `<label class="search">${today?icon('search'):'<span aria-hidden="true">⌕</span>'}<input class="input" id="search" type="search" value="${esc(value)}" placeholder="${placeholder}" aria-label="${today?'搜索资讯':'搜索内容'}"></label>`;
}
function topicFilter(topics, selected) {
  return `<label class="sr" for="topic-filter">主题</label><select id="topic-filter" class="input"><option value="">全部主题</option>${topics.map(t=>`<option value="${t.id}" ${String(t.id)===String(selected)?'selected':''}>${esc(t.name)}</option>`).join('')}<option value="deleted" ${selected==='deleted'?'selected':''}>已删除的主题</option></select>`;
}
async function contentPage(topics, run, latest) {
  const f=filters(), isToday=state.page==='today', favorites=state.page==='favorites';
  let result={items:[],total:0,invalidCount:0};
  if (!isToday || run) {
    for(let offset=0;offset<f.limit;offset+=50){
      const chunk=await db.listItems({...f,limit:50,offset,runId:isToday?run?.id:undefined,status:favorites?'starred':f.status,searchScope:favorites?'favorites':undefined});
      result={...chunk,items:[...result.items,...chunk.items]};
      if(result.items.length>=chunk.total || chunk.items.length<50)break;
    }
  }
  state.invalidCount=result.invalidCount;
  if(isToday)state.newCount=0;
  const selected=state.selectedId ? await db.item(state.selectedId) : null;
  // Previewing the first article does not mark it as read.
  const preview=isToday&&window.innerWidth>760?result.items.find(item=>!item.is_dismissed):null;
  const current=isToday&&selected?.run_id!==run?.id?preview:selected || preview;
  const stats=isToday&&run?await db.briefingStats(run.id):{total:0,unread:0,deleted:0};
  let html=isToday?todayHeader(run,stats,latest):titlebar(favorites?'收藏':'全部内容',`${result.total} 条`);
  if(!isToday) html+=`<section class="filter-panel card pad"><div class="filter-line">${searchField(f.search,favorites?'搜索收藏的标题和备注':'搜索标题、摘要、备注')}
    ${topicFilter(topics,f.topicId)}
    ${!favorites?`<label class="sr" for="status-filter">状态</label><select id="status-filter" class="input">${[['all','全部状态'],['unread','未读'],['starred','收藏'],['dismissed','已忽略']].map(([v,n])=>`<option value="${v}" ${f.status===v?'selected':''}>${n}</option>`).join('')}</select>`:''}
    ${favorites?`<label class="check"><input id="notes-only" type="checkbox" ${f.notesOnly?'checked':''}>有备注</label><div class="view-switch"><button class="btn ${state.favoriteList?'':'active'}" data-layout="grid" aria-label="卡片视图">▦</button><button class="btn ${state.favoriteList?'active':''}" data-layout="list" aria-label="列表视图">☰</button></div>`:''}
    <label class="sr" for="sort-order">排序</label><select class="input" id="sort-order">${(favorites?[['starred','最近收藏'],['published','发布时间']]:[['newest','最新在前'],['oldest','最早在前']]).map(([v,n])=>`<option value="${v}" ${f.order===v?'selected':''}>${n}</option>`).join('')}</select></div>
    ${!favorites?`<div class="filter-line date-filters"><span class="muted small">收集日期</span>${[['today','今天'],['7','近 7 天'],['30','近 30 天'],['custom','自定义']].map(([v,n])=>`<button class="chip ${f.range===v?'on':''}" data-range="${v}">${n}</button>`).join('')}${f.range==='custom'?`<input type="date" id="from-date" class="input" value="${esc(f.from)}" aria-label="开始日期"><span class="muted">至</span><input type="date" id="to-date" class="input" value="${esc(f.to)}" aria-label="结束日期">`:''}</div>${await dateBars(f)}`:''}
  </section>`;
  const activeFilters=[f.search&&['search',`搜索：${f.search}`],f.topicId&&['topicId',`主题：${topics.find(t=>String(t.id)===String(f.topicId))?.name || '已删除的主题'}`],f.status!=='all'&&!favorites&&['status',`状态：${{unread:'未读',starred:'收藏',dismissed:'已忽略'}[f.status]}`],f.from&&['range',`${f.from} 至 ${f.to || '现在'}`],f.notesOnly&&['notesOnly','有备注']].filter(Boolean);
  const filterTags=activeFilters.length?`<div class="active-filters">${activeFilters.map(([key,label])=>`<button class="filter-tag" data-clear="${key}">${esc(label)} ×</button>`).join('')}<button class="btn link" data-clear="all">清除全部</button><span class="muted small">${result.total} 条结果</span></div>`:'';
  if(!isToday)html+=filterTags;
  const noRun=isToday&&!run;
  const emptyList=()=>empty(noRun?'还没有内容':'这里还没有内容',noRun?'拾闻的内容由你的 AI 收集。把下面这句话发给你的 AI，再告诉它你想关注什么。':favorites&&!activeFilters.length?'阅读时点一下收藏，把值得再看的内容留下。':'试试调整搜索词或筛选条件。');
  const bind=root=>bindContent(root,current,run);
  if(noRun) {
    html+=`<section class="card">${emptyList()}<div class="start-box"><pre class="prompt">${esc(prompts.start(app))}</pre><div class="guide-actions">${canOpenAi()?'<button class="btn primary small" data-open-ai-start>交给我的 AI</button><button class="btn small" data-copy-start>复制</button>':'<button class="btn primary small" data-copy-start>复制</button>'}<button class="btn link small" data-ai-guide="start">更多说明</button></div></div></section>`;
    return {html,bind};
  }
  const more=result.total>result.items.length?`<div class="load-more"><button class="btn" data-load-more>再加载 50 条</button><span class="muted small">已显示 ${result.items.length} / ${result.total}</span></div>`:'';
  if(isToday) {
    const choices=stats.deleted>0||f.topicId==='deleted'?[...topics,{id:'deleted',name:'已删除的主题'}]:topics;
    html+=`<div class="split today-split"><section class="card list-col today-list" aria-label="内容列表">
      <div class="today-filters">${searchField(f.search,'搜索资讯',true)}${renderTodayTopics(choices,f.topicId)}</div>
      <div class="today-list-scroll" tabindex="0" role="region" aria-label="资讯条目">${result.items.length?groupItems(result.items,current?.id):emptyList()}${more}</div>
    </section>${await reader(current)}</div>`;
    return {html,bind};
  }
  if(!result.items.length) {
    const placeholder=`<section class="card">${emptyList()}</section>`;
    html+=current?`<div class="split">${placeholder}${await reader(current)}</div>`:placeholder;
    return {html,bind};
  }
  if(favorites&&!state.favoriteList) {
    html+=`<div class="favorites-layout ${current?'with-reader':''}"><section><div class="favorites-grid">${result.items.map(item=>`<button class="favorite-card card" data-open="${item.id}">${thumb(item,false,true)}<div class="favorite-body"><span class="eyebrow">${esc(item.topic_name || '已删除的主题')}</span><strong>${highlight(item.title,f.search)}</strong><span class="muted small">${esc(item.source || '未知来源')} · ${esc(date(item.published_at || item.collected_at,{hour:undefined,minute:undefined}))}</span>${item.note?`<p class="favorite-note">${highlight(item.note,f.search)}</p>`:''}<span class="muted small">★ 收藏于 ${esc(relative(item.starred_at))}</span></div></button>`).join('')}</div>${more}</section>${current?await reader(current):''}</div>`;
  }else html+=`<div class="split"><section class="card list-col" aria-label="内容列表">${groupItems(result.items)}${more}</section>${await reader(current)}</div>`;
  return {html,bind};
}
function bindContent(root,current,run) {
  const f=filters();
  const update=async(patch)=>{Object.assign(f,patch,{limit:50});state.selectedId=null;await render({resetListScroll:true});};
  const topics=root.querySelector('.today-topics');
  let searchTimer;
  root.querySelector('#search')?.addEventListener('input',event=>{
    clearTimeout(searchTimer); const value=event.target.value, caret=event.target.selectionStart;
    searchTimer=setTimeout(async()=>{if(!event.target.isConnected)return;await update({search:value});const input=main.querySelector('#search');if(input){input.focus();if(input.type!=='search') input.setSelectionRange(caret,caret);}},280);
  });
  for(const [id,key] of [['topic-filter','topicId'],['status-filter','status'],['sort-order','order'],['from-date','from'],['to-date','to']]) root.querySelector(`#${id}`)?.addEventListener('change',e=>update({[key]:e.target.value}));
  root.querySelector('#notes-only')?.addEventListener('change',e=>update({notesOnly:e.target.checked}));
  root.querySelectorAll('[data-layout]').forEach(el=>el.onclick=()=>{state.favoriteList=el.dataset.layout==='list';render();});
  root.querySelectorAll('[data-range]').forEach(el=>el.onclick=()=>{const range=el.dataset.range;const start=new Date();if(range!=='custom')start.setDate(start.getDate()-(range==='today'?0:Number(range)-1));update({range,from:range==='custom'?'':day(start),to:range==='custom'?'':day()});});
  root.querySelectorAll('[data-day]').forEach(el=>el.onclick=()=>update({range:'custom',from:el.dataset.day,to:el.dataset.day}));
  root.querySelectorAll('[data-clear]').forEach(el=>el.onclick=()=>{const key=el.dataset.clear;return update(key==='all'?{search:'',topicId:'',status:'all',range:'',from:'',to:'',notesOnly:false}:key==='range'?{range:'',from:'',to:''}:{[key]:key==='status'?'all':key==='notesOnly'?false:''});});
  root.querySelector('[data-load-more]')?.addEventListener('click',()=>{f.limit+=50;render();});
  root.querySelector('[data-mark-read]')?.addEventListener('click',e=>action(e.currentTarget,async()=>{await db.markRead(run.id);await render();}));
  root.querySelectorAll('[data-open]').forEach(el=>el.onclick=()=>action(el,async()=>{const id=Number(el.dataset.open);await db.setItemUser(id,{is_read:1});state.selectedId=id;await render();if(window.innerWidth<=760)main.querySelector('#reader')?.scrollIntoView({block:'start'});}));
  root.querySelector('[data-close-reader]')?.addEventListener('click',()=>{state.selectedId=null;render();});
  root.querySelectorAll('[data-undo]').forEach(el=>el.onclick=()=>action(el,async()=>{await db.setItemUser(Number(el.dataset.undo),{is_dismissed:0,dismiss_reason:null});await render();}));
  root.querySelector('[data-star]')?.addEventListener('click',e=>{const button=e.currentTarget;return action(button,async()=>{const item=await db.item(Number(button.dataset.star));await db.setItemUser(item.id,{is_starred:item.is_starred?0:1});await render();});});
  root.querySelector('[data-dismiss]')?.addEventListener('click',e=>action(e.currentTarget,async()=>{const item=await db.item(Number(e.target.dataset.dismiss));await db.setItemUser(item.id,{is_dismissed:item.is_dismissed?0:1,dismiss_reason:null});await render();}));
  root.querySelectorAll('[data-reason]').forEach(el=>el.onclick=()=>action(el,async()=>{await db.setItemUser(Number(el.dataset.id),{dismiss_reason:el.dataset.reason});await render();}));
  root.querySelector('[data-copy-url]')?.addEventListener('click',e=>{const button=e.currentTarget;return action(button,async()=>{const item=await db.item(Number(button.dataset.copyUrl));await copy(item.url);notify('链接已复制');});});
  const note=root.querySelector('#item-note');
  note?.addEventListener('input',()=>{drafts.set(Number(note.dataset.id),note.value);root.querySelector('#note-state').textContent='· 正在编辑，离开输入框后保存';});
  note?.addEventListener('blur',()=>{noteSave=persistNotes().then(()=>{if(note.isConnected)root.querySelector('#note-state').textContent='· 已保存，AI 下次更新时会看到';}).catch(error=>{console.error(error);if(note.isConnected)root.querySelector('#note-state').textContent='· 保存失败，请稍后重试';notify('备注还没保存成功，请稍后重试','bad');});});
  root.querySelectorAll('[data-request]').forEach(el=>el.onclick=()=>{
    const itemId=current.id,kind=el.dataset.request,dialog=document.querySelector('#request-dialog');
    dialog.querySelector('#request-title').textContent=kind==='deep_dive'?'让 AI 深入了解':'让 AI 找类似的';
    dialog.querySelector('textarea').value='';dialog.returnValue='';
    dialog.onclose=()=>{if(dialog.returnValue==='submit')action(el,async()=>{await db.request(itemId,kind,dialog.querySelector('textarea').value.trim());notify('已记下。下次在 AI 对话里说“更新简报”时，AI 会处理');await render();});};
    dialog.showModal();
  });
  if(topics)return bindTodayTopics(topics,topicId=>update({topicId}));
}
async function render({automatic=false,resetListScroll=false}={}) {
  if (!initialized) return;
  if(main.dataset.dirty==='true' || (automatic && (drafts.size || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)))) {
    if(!automatic)notify('请先保存正在编辑的内容');return;
  }
  const token=++rendering,scroll=window.scrollY;
  main.setAttribute('aria-busy','true');
  try {
    await noteSave;await persistNotes();
    const [topics,{latest,briefing},maxRows]=await Promise.all([db.topics(),db.briefingRuns(),db.query('SELECT MAX(id) AS id FROM items')]);
    if(token!==rendering)return;
    const maxId=Number(maxRows[0]?.id || 0);
    if(knownItemId!==null && maxId>knownItemId && state.page!=='today'){
      const count=await db.query('SELECT COUNT(*) AS count FROM items WHERE id > ?',[knownItemId]);state.newCount+=Number(count[0]?.count || 0);
    }
    knownItemId=maxId;
    const status=lastUpdate(latest,latest);
    document.querySelector('#sidebar-status').innerHTML=`<b><span class="dot ${esc(status.tone)}"></span>${esc(status.text)}</b>${status.detail?`<span>${esc(status.detail)}</span>`:''}`;
    document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('on',a.dataset.page===state.page);if(a.dataset.page===state.page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    if(state.page==='records')state.invalidCount=(await db.listItems({limit:1})).invalidCount;
    const output=['topics','records'].includes(state.page)?await renderSettingsPage(state.page,app):await contentPage(topics,briefing,latest);
    if(token!==rendering || main.dataset.dirty==='true' || (automatic&&(drafts.size || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))))return;
    const listScroll=resetListScroll?0:main.querySelector('.today-list-scroll')?.scrollTop ?? 0;
    const previousReader=main.querySelector('.today-reader[data-reader-item]');
    const readerScroll=previousReader?.scrollTop ?? 0;
    const mediaOpen=previousReader?.querySelector('.today-media')?.open;
    main.classList.toggle('today-page',state.page==='today');
    unbindContent?.();
    main.innerHTML=output.html;
    const dispose=output.bind?.(main);
    unbindContent=typeof dispose==='function'?dispose:undefined;
    const list=main.querySelector('.today-list-scroll');
    if(list)list.scrollTop=listScroll;
    const nextReader=main.querySelector('.today-reader[data-reader-item]');
    if(nextReader&&nextReader.dataset.readerItem===previousReader?.dataset.readerItem){
      nextReader.scrollTop=readerScroll;
      const media=nextReader.querySelector('.today-media');
      if(media&&mediaOpen)media.open=true;
    }
    main.querySelectorAll('[data-refresh]').forEach(el=>el.onclick=()=>action(el,async()=>{await render();notify(state.page==='today'?'已重新载入':'已刷新');}));
    main.querySelector('[data-retry]')?.addEventListener('click',()=>render());
    const badge=document.querySelector('#new-count');badge.textContent=state.newCount?`+${state.newCount}`:'';
    hydrateImages(main).catch(console.error);
    window.scrollTo(0,scroll);
  }catch(error){
    console.error(error);
    if(token!==rendering)return;
    const old=main.querySelector('.read-error');old?.remove();
    const alert=document.createElement('div');alert.className='notice read-error';alert.setAttribute('role','alert');
    alert.innerHTML=`<span>${esc(errorMessage(error))}</span><button class="btn" data-retry>重试</button>`;
    alert.querySelector('button').onclick=()=>render();main.prepend(alert);
  }finally {if(token===rendering)main.setAttribute('aria-busy','false');}
}
// The platform opens the user's own AI tool on this folder with the text
// prefilled; older platforms only support copying.
function canOpenAi(){return Boolean(window.panda?.ai?.open) && Array.isArray(app.context?.capabilities) && app.context.capabilities.includes('ai.open');}
function openAi(text){
  window.panda.ai.open(text).then(()=>notify('已请求打开你的 AI 工具，按它的提示发送'),error=>{
    console.error(error);
    copy(text).then(()=>notify('没能直接打开 AI 工具，文字已复制，请发给你的 AI','bad'),()=>notify(error?.message || '没能打开 AI 工具，请复制文字后发给你的 AI','bad'));
  });
}
// Startup failures are shown as they are. Gleaner does not try to repair data or code itself;
// the user hands the message to their AI.
function bootDetail(error) {
  const text=String(error?.message || error || '未知错误').trim();
  return [text,error?.code&&`代码：${error.code}`].filter(Boolean).join('\n');
}
function showBootError(error) {
  if(error?.code==='SQL_BUSY' || /locked/i.test(error?.message || '')){
    main.innerHTML=`<section class="card">${empty('数据正被占用','AI 可能正在写入内容，等几秒再试。')}<div class="empty-action"><button id="boot-retry" class="btn primary">重试</button></div></section>`;
  }else{
    const detail=bootDetail(error);
    main.innerHTML=`<section class="card pad boot-error"><strong>拾闻打不开</strong><p class="muted">已有内容不会因此丢失。把下面的信息复制给你的 AI，请它看看拾闻哪里出了问题；改好后重新打开拾闻。</p><pre class="prompt">${esc(`拾闻打不开，下面是出错信息：\n${detail}`)}</pre><div class="guide-actions"><button id="boot-copy" class="btn primary small">复制</button><button id="boot-retry" class="btn small">重试</button></div></section>`;
    main.querySelector('#boot-copy').onclick=()=>copy(`拾闻打不开，下面是出错信息：\n${detail}`).then(()=>notify('已复制，请发给你的 AI'),()=>notify('暂时无法复制，请选中文字后手动复制','bad'));
  }
  main.querySelector('#boot-retry').onclick=boot;main.setAttribute('aria-busy','false');
}
async function boot() {
  if(!window.panda){main.innerHTML=`<section class="card">${empty('请在熊猫小抽屉里打开拾闻','在「添加应用 → 本机文件夹」中选择拾闻所在的文件夹。')}</section>`;main.setAttribute('aria-busy','false');return;}
  try {
    app.context=await window.panda.context.get();await db.init();initialized=true;await render();
    cleanupImages().catch(error=>console.warn('配图清理暂未完成',error));
  }catch(error){console.error(error);showBootError(error);}
}
document.addEventListener('click',e=>{const guide=e.target.closest('[data-ai-guide]');if(guide){e.preventDefault();openGuide(app);}
  if(e.target.closest('[data-open-ai-start]'))openAi(prompts.start(app));
  if(e.target.closest('[data-copy-start]'))copy(prompts.start(app)).then(()=>notify('已复制，请在你的 AI 工具里粘贴发送'),()=>notify('暂时无法复制，请选中文字后手动复制','bad'));});
document.querySelector('.nav').addEventListener('click',e=>{const link=e.target.closest('a[href^="#"]');if(link){e.preventDefault();navigate(link.hash.slice(1));}});
main.addEventListener('click',e=>{const link=e.target.closest('a[href^="#"]');if(link){e.preventDefault();navigate(link.hash.slice(1));}});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
window.addEventListener('focus',()=>render({automatic:true}));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')render({automatic:true});});
boot();
