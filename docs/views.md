# 主题展示方式

默认展示方式是「列表」。主题的 `view` 保存展示方式 id，注册信息在 `app/views/index.js`。今日和全部页按主题分组后调用对应方式；阅读面板、收藏、搜索与用户操作仍由通用页面负责。未登记的 id 自动回退到列表。

## 先用额外记录

多数主题无需改程序。用户在主题的「额外记录」里写希望看到的信息，例如“车型、现价、降价金额、优惠截止日期”。AI 按这些原词把字符串值写入 `items.extra`，通用列表展示最多三个标签，阅读面板展示完整信息。缺失值省略，不猜数值。

## 新增展示方式

先读 `docs/design.md`、`docs/database.md`，确认用户要求的是修改应用。关闭拾闻窗口、保存代码版本后：

1. 在 `app/views/` 新增一个 ES 模块，导出渲染函数。
2. 在 `app/views/index.js` 导入它，并在 `views` 数组中新增 `{ id, name, render }`。
3. 重新打开拾闻，在对应主题选择新展示方式并保存。

无需改通用页面，也无需修改数据库结构。登记结构如下：

```js
import { render as renderList } from './list.js';
import { render as renderCompact } from './compact.js';

export const views = [
  { id: 'list', name: '列表', render: renderList },
  { id: 'compact', name: '紧凑列表', render: renderCompact },
];

export function getView(id) {
  return views.find(view => view.id === id) || views[0];
}
```

上例的 `compact` 仅演示扩展步骤，首版不自带这个文件。

## 渲染接口

```js
render(items, context) => htmlString
```

- `items`：当前主题、当前筛选和分页中的内容数组。`extra` 已解析为对象，值为字符串；不能假设所有字段都存在。
- `context.renderRow(item)`：返回通用内容行，保留阅读选择、未读、收藏、忽略和图片等通用行为。
- `context.esc(value)`：将文本转义后安全插入 HTML。所有来自数据库、用户和 AI 的文本都必须转义，不能作为原始 HTML 或事件属性执行。
- 返回值只描述当前分组内容，不包含页面导航、通用阅读面板或数据读写。不要在渲染函数里联网或写库。

例如新增 `app/views/compact.js`，复用内容行即可验证登记机制：

```js
export function render(items, context) {
  return `<div class="custom-compact">${items.map(item =>
    context.renderRow(item)
  ).join('')}</div>`;
}
```

专用表格可从 `item.extra` 读取所需列。打开内容仍应沿用通用行的选择标记和页面委托事件；实现前查看 `app/views/list.js` 以及通用页面实际约定，保留同样的内容 id 标记。对已忽略条目复用 `context.renderRow(item)`，确保撤销行为可用。阅读面板始终使用原内容 id，不复制用户状态到另一份数据。

## 数据结构变化

展示方式通常只读取 `items.extra`，不需要新表或新列。确需正式数字列等结构时，按顺序修改程序里的升级逻辑、递增 `meta.schema_version`、更新 `docs/database.md`，必要时同步 `AGENTS.md`。只加列、加表；不得为定制删除、清空或覆盖现有内容、收藏和备注。删除或清空数据必须先说明影响并取得用户同意。

车价对比表是后续定制示范，草图见 `docs/design/07-car-generic.html` 和 `08-car-custom.html`，首版不登记、不内置。
