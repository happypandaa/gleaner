export function render(items, context) { return items.map(item => context.renderRow(item)).join(''); }
