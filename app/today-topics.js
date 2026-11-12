import { esc, icon } from './utils.js';

export function renderTopicChips(topics, selected, { overflow = true } = {}) {
  const options = [{id:'', name:'全部主题'}, ...topics];
  const button = (option, type) => {
    const id = String(option.id);
    const active = id === String(selected);
    const inPopover = type === 'option';
    return `<button type="button" class="today-topic-${type}" data-topic="${esc(id)}" aria-pressed="${active}"${inPopover?'':` title="${esc(option.name)}"`}>
      <span>${esc(option.name)}</span>${inPopover && active ? icon('topic-selected') : ''}
    </button>`;
  };
  return `<div class="today-topics" role="group" aria-label="主题筛选">
    ${options.map(option => button(option, 'chip')).join('')}
    ${overflow ? `<button type="button" class="today-topic-more" popovertarget="today-topic-popover" aria-controls="today-topic-popover" aria-expanded="false" hidden>
      <span>更多 ${topics.length}</span>${icon('topic-more-down')}${icon('topic-more-up')}
    </button>
    <div class="today-topic-popover" id="today-topic-popover" popover="auto" role="region" aria-label="更多主题">
      <label class="search">${icon('search')}<input class="input" type="search" placeholder="搜索主题" aria-label="搜索主题" autofocus></label>
      <div class="today-topic-options" tabindex="0" aria-label="主题选项">
        ${options.map(option => button(option, 'option')).join('')}
        <p class="today-topic-empty muted small" hidden>没有匹配的主题</p>
      </div>
    </div>` : ''}
  </div>`;
}

export function bindTopicChips(group, onSelect) {
  const popover = group.querySelector('.today-topic-popover');
  group.addEventListener('click', async event => {
    const button = event.target.closest('button[data-topic]');
    if (!button) return;
    if (popover?.matches(':popover-open')) popover.hidePopover();
    await onSelect(button.dataset.topic);
    document.querySelector('.today-topics .today-topic-chip[aria-pressed="true"]')?.focus({preventScroll:true});
  });
  if (!popover) return;

  const chips = [...group.querySelectorAll('.today-topic-chip')];
  const more = group.querySelector('.today-topic-more');
  const search = popover.querySelector('input');
  const list = popover.querySelector('.today-topic-options');
  const options = [...list.querySelectorAll('.today-topic-option')];
  const noMatches = list.querySelector('.today-topic-empty');
  const probe = document.createElement('div');
  probe.className = 'today-topic-probe';
  probe.inert = true;
  probe.setAttribute('aria-hidden', 'true');
  for (const button of [...chips, more]) {
    const clone = button.cloneNode(true);
    clone.hidden = false;
    clone.removeAttribute('popovertarget');
    probe.append(clone);
  }
  group.append(probe);

  function positionPopover() {
    const anchor = group.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(anchor.width, window.innerWidth - 2 * margin);
    const below = window.innerHeight - anchor.bottom - 2 * margin;
    const above = anchor.top - 2 * margin;
    const openAbove = below < 220 && above > below;
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`;
    popover.style.top = openAbove ? 'auto' : `${anchor.bottom + margin}px`;
    popover.style.bottom = openAbove ? `${window.innerHeight - anchor.top + margin}px` : 'auto';
    popover.style.setProperty('--topic-popover-height', `${Math.max(1, openAbove ? above : below)}px`);
  }
  function repositionOpenPopover() {
    if (popover.matches(':popover-open')) positionPopover();
  }

  function arrange() {
    const width = group.clientWidth;
    const gap = parseFloat(getComputedStyle(group).columnGap) || 0;
    const widths = [...probe.children].map(node => node.getBoundingClientRect().width);
    const moreWidth = widths.pop();
    const all = chips.map((_, i) => i);
    function fits(indices, reserveMore = false) {
      const sizes = indices.map(i => widths[i]);
      if (reserveMore) sizes.push(moreWidth);
      let rows = 1, used = 0;
      for (const size of sizes) {
        if (used && used + gap + size > width + 0.5) {
          rows++;
          used = size;
        } else used += (used ? gap : 0) + size;
      }
      return rows <= 2;
    }

    let visible = all;
    if (!fits(all)) {
      const active = chips.findIndex(chip => chip.getAttribute('aria-pressed') === 'true');
      visible = active > 0 ? [0, active] : [0];
      if (active > 0 && !fits(visible, true)) visible = [active];
      for (const i of all) {
        if (visible.includes(i)) continue;
        const candidate = [...visible, i].sort((a, b) => a - b);
        if (fits(candidate, true)) visible = candidate;
      }
    }
    chips.forEach((chip, i) => { chip.hidden = !visible.includes(i); });
    const hidden = chips.length - visible.length;
    more.hidden = hidden === 0;
    more.firstElementChild.textContent = `更多 ${hidden}`;
    more.setAttribute('aria-label', `更多主题，${hidden} 个未展开`);
    if (popover.matches(':popover-open')) {
      if (more.hidden) popover.hidePopover();
      else positionPopover();
    }
  }

  function searchTopics() {
    const query = search.value.trim().toLocaleLowerCase();
    let matches = 0;
    for (const option of options) {
      option.hidden = !option.textContent.toLocaleLowerCase().includes(query);
      if (!option.hidden) matches++;
    }
    noMatches.hidden = matches > 0;
    list.scrollTop = 0;
  }

  popover.addEventListener('beforetoggle', event => {
    if (event.newState === 'open') {
      search.value = '';
      searchTopics();
      positionPopover();
    }
    more.setAttribute('aria-expanded', String(event.newState === 'open'));
  });
  search.addEventListener('input', searchTopics);
  let lastWidth;
  const observer = new ResizeObserver(() => {
    if (lastWidth === group.clientWidth) return;
    lastWidth = group.clientWidth;
    arrange();
  });
  arrange();
  lastWidth = group.clientWidth;
  observer.observe(group);
  window.addEventListener('resize', repositionOpenPopover);
  window.addEventListener('scroll', repositionOpenPopover, {passive:true});
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', repositionOpenPopover);
    window.removeEventListener('scroll', repositionOpenPopover);
  };
}
