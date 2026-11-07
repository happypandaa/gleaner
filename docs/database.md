# 拾闻数据库约定

数据库为应用根目录的 `data/main.sqlite`，附件根目录为 `data/attachments/`。当前 `schema_version` 是 **2**。建表和升级的可执行定义在 [`app/schema.js`](../app/schema.js)，由 [`app/db.js`](../app/db.js) 在应用首次打开时通过熊猫小抽屉 SDK 原子执行。

本文是 AI 日常运行时的表结构依据；更新流程和禁止事项见根目录 [`AGENTS.md`](../AGENTS.md)。数据库或表不存在时，先让用户在熊猫小抽屉里打开拾闻，不要自行初始化。

## 通用规则

- 所有日期时间使用带时区的 ISO 8601 文本，例如 `2026-11-06T08:12:00+08:00` 或 `2026-11-06T00:12:00.000Z`。不同偏移的时间比较使用 `julianday()`，不要按时间文本字典序比较。历史日期筛选按当前设备的本地日边界解释。
- `id` 均为 `INTEGER PRIMARY KEY`，插入时省略，由 SQLite 分配。外键由平台连接启用。
- `0`/`1` 表示布尔值。以下注明“默认”的字段可在 `INSERT` 时省略。
- SQL 值必须使用参数绑定或可靠的 SQL 值编码，网页文字、用户备注不能拼接成 SQL。
- AI 每次连接设置 `.timeout 5000`；开始状态单独提交，搜索、下载、缩图在事务外完成，最终内容、请求、偏好、运行状态在一个短事务中提交。禁止修改日志模式、执行 `VACUUM`、删除 WAL/SHM 文件或替换数据库。
- `data/` 不进 Git。代码版本不能代替用户数据备份。

## `meta`：应用写入

| 列 | 类型及约束 | 含义 |
| --- | --- | --- |
| `key` | TEXT PRIMARY KEY NOT NULL | 当前使用 `schema_version` |
| `value` | TEXT NOT NULL | 当前版本值为字符串 `2` |

程序按迁移版本顺序执行，成功后在同一事务里更新版本号。读取到高于应用支持的版本时停止初始化并提示更新应用，不能降级、清库或重新建库。

## `topics`：AI 按用户要求建立，双方可改

| 列 | 类型及约束 | 含义 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY | 主题 ID |
| `name` | TEXT NOT NULL，去空白后非空 | 主题名称 |
| `description` | TEXT NOT NULL，去空白后非空 | 用户原话：关心什么 |
| `keywords` | TEXT NOT NULL，默认 `[]` | JSON 字符串数组，检查 JSON 有效且为数组 |
| `sources` | TEXT NOT NULL，默认空串 | 优先来源，自由文本 |
| `excludes` | TEXT NOT NULL，默认空串 | 不要的内容，自由文本 |
| `extra_fields` | TEXT NOT NULL，默认空串 | 需要额外记录的信息，自由文本 |
| `max_items` | INTEGER NOT NULL，默认 6，1–20 | 每次最多收集多少条 |
| `view` | TEXT NOT NULL，默认 `list` | 对应 `app/views/index.js` 的展示方式 ID |
| `enabled` | INTEGER NOT NULL，默认 1，限 0/1 | 是否开启 |
| `sort_order` | INTEGER NOT NULL，默认 0 | 显示顺序 |
| `created_at` | TEXT NOT NULL，默认当前 UTC 时间 | 创建时间 |
| `updated_at` | TEXT NOT NULL，默认当前 UTC 时间 | 最近修改时间，同时作为修改时的版本检查 |
| `updated_by` | TEXT NOT NULL，默认 `app`，限 `app`/`agent` | 最近一次是谁改的：`app` 为用户在拾闻里修改，`agent` 为 AI 按用户在对话中的要求修改（版本 2 新增） |

写入规则：

- **AI** 只在用户于对话中明确要求时新建、修改、暂停或删除主题，日常更新只读。新建时 `created_at` 与 `updated_at` 写同一时间，`updated_by = 'agent'`。
- **应用** 不新建主题，只修改已有主题的设置、开启状态和顺序，或删除主题；修改时写 `updated_by = 'app'`。
- 双方修改都带 `WHERE id = ? AND updated_at = ?`。影响行数为 0 表示对方刚改过：应用提示用户刷新后再改，AI 重新读取并和用户确认。任何一方都不覆盖对方较新的修改。
- 主题内容以表中当前数据为准，AI 不按对话记忆恢复用户删除、暂停或改过的设置。AI 更新时发现 `updated_by = 'app'` 且晚于上一次成功运行，会以新设置为准，清理冲突的 `learned`。

删除主题时只删除主题本身，其内容的 `topic_id` 通过外键 `ON DELETE SET NULL` 置空，历史、收藏、备注仍保留，界面显示“已删除的主题”。主题专属的 `learned` 通过外键级联删除，避免误变成全局偏好。

## `items`：按列分工

**AI 只新增内容，不能修改旧内容或用户列。** 只使用 `INSERT` 或 `INSERT OR IGNORE`，禁止 `REPLACE`、`INSERT OR REPLACE` 和删除内容。相同 `url` 的插入会被唯一约束阻止或忽略，旧行和用户反馈保留。

| AI 内容列 | 类型及约束 | 含义 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY | 内容 ID |
| `run_id` | INTEGER，可空，外键 `runs.id` | 写入这条内容的运行记录；删除运行记录时置空 |
| `topic_id` | INTEGER，可空，外键 `topics.id` | 所属主题；删除主题时置空 |
| `title` | TEXT NOT NULL | 标题，必须有实际文字 |
| `url` | TEXT NOT NULL UNIQUE | 原文链接，去重依据 |
| `source` | TEXT，可空 | 来源名称 |
| `published_at` | TEXT，可空 | 原文发布时间，不确定时留空 |
| `summary` | TEXT NOT NULL | 2–4 句中文摘要 |
| `reason` | TEXT，可空 | 一句话说明为什么推荐给用户 |
| `importance` | INTEGER NOT NULL，默认 2，范围 1–3 | 1 一般，2 值得看，3 重要 |
| `image_path` | TEXT，可空 | 相对附件根的本机缩略图路径 |
| `image_url` | TEXT，可空 | 原图 HTTPS 地址，备用 |
| `extra` | TEXT NOT NULL，默认 `{}`，检查 `json_valid` | JSON 对象，值全部为字符串，键名使用 `extra_fields` 中的原词；查不到的键不写 |
| `collected_at` | TEXT NOT NULL | 收集写入时间 |

| 仅应用可写的用户列 | 类型及约束 | 含义 |
| --- | --- | --- |
| `is_read` | INTEGER NOT NULL，默认 0，限 0/1 | 是否已读 |
| `is_starred` | INTEGER NOT NULL，默认 0，限 0/1 | 是否收藏 |
| `starred_at` | TEXT，可空 | 收藏时间，取消收藏时置空 |
| `is_dismissed` | INTEGER NOT NULL，默认 0，限 0/1 | 是否不感兴趣 |
| `dismiss_reason` | TEXT，可空 | 仅限“和主题无关”“来源不可靠”“内容太旧”“重复了” |
| `note` | TEXT NOT NULL，默认空串 | 用户备注，AI 需读取 |
| `user_updated_at` | TEXT，可空 | 用户最近操作时间 |

索引为 `collected_at`、`topic_id`、`is_starred` 和 `run_id`。界面只更新用户列；两个内容列例外是删除主题时置空 `topic_id`，以及配图清理时置空 `image_path`。

读取时还校验 `extra` 必须是对象且值全为字符串，以及标题、摘要、链接非空。格式不合规的内容跳过并计数，不改写或删除原行；列表按有效内容分页，每页最多 50 条。

## `runs`：AI 写入

| 列 | 类型及约束 | 含义 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY | 运行 ID |
| `started_at` | TEXT NOT NULL | 开始时间 |
| `finished_at` | TEXT，可空 | 结束时间 |
| `agent` | TEXT，可空 | AI 工具名称，例如 `Codex` |
| `trigger` | TEXT NOT NULL，默认 `manual` | 仅限 `setup`、`scheduled`、`manual` |
| `status` | TEXT NOT NULL，默认 `running` | 仅限 `running`、`done`、`partial`、`failed` |
| `schedule` | TEXT，可空 | AI 自报的定时安排，没有则留空 |
| `added` | INTEGER NOT NULL，默认 0，非负 | 真正新增的内容数 |
| `skipped` | INTEGER NOT NULL，默认 0，非负 | 因链接重复等跳过的条数 |
| `images_saved` | INTEGER NOT NULL，默认 0，非负 | 本机配图成功数量 |
| `images_failed` | INTEGER NOT NULL，默认 0，非负 | 配图下载或缩图失败数量 |
| `digest` | TEXT，可空 | 1–3 句今日要点 |
| `message` | TEXT，可空 | 给用户看的失败或部分完成说明 |

开始时插入 `running` 并立即提交；结果短事务中一起更新最终状态、结束时间和计数。写入失败先确认回滚，再单独把这条记录标为 `failed`。不要为了显示“成功”而创建虚假定时安排。

“今日”显示最近一次 `done` 或 `partial` 的运行内容，按开始时间与 ID 排序。最新一次失败不会覆盖上一次可读简报；更新状态仍根据最新运行显示失败原因。

## `requests`：应用提请求，AI 填结果

| 列 | 写入方 | 类型及约束、含义 |
| --- | --- | --- |
| `id` | 应用 | INTEGER PRIMARY KEY |
| `kind` | 应用 | TEXT NOT NULL，仅限 `deep_dive`（深入了解）、`similar`（找类似的） |
| `item_id` | 应用 | INTEGER NOT NULL，外键 `items.id` |
| `text` | 应用 | TEXT，可空，用户补充说明 |
| `created_at` | 应用 | TEXT NOT NULL，默认当前 UTC 时间 |
| `status` | AI | TEXT NOT NULL，默认 `pending`，仅限 `pending`、`done`、`failed` |
| `result` | AI | TEXT，可空，纯文本结果或失败原因 |
| `run_id` | AI | INTEGER，可空，外键 `runs.id`，删除运行记录时置空 |
| `finished_at` | AI | TEXT，可空，处理完成时间 |

有 `item_id` 索引；部分唯一索引保证同一内容、同一种请求最多只有一个 `pending`，防止连续点击重复请求。完成后用户仍可发起新请求，旧结果保留。找类似的所获新内容另插入 `items`，并在 `result` 列出标题。AI 处理结果和新内容在同一短事务中提交。

## `learned`：AI 写，应用只能删除

| 列 | 类型及约束 | 含义 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY | 偏好 ID |
| `topic_id` | INTEGER，可空，外键 `topics.id` | 空表示全局偏好；删除主题时其专属偏好级联删除 |
| `text` | TEXT NOT NULL，去空白后非空 | 一句话描述偏好 |
| `updated_at` | TEXT NOT NULL，默认当前 UTC 时间 | 最近更新时间 |

AI 可修改、删除自己写入的偏好，每主题最多 10 条（由运行规则约束）。主题页面同时展示该主题和全局偏好，用户可以逐条删除；AI 下次根据最新反馈重新判断，不应无条件恢复已删除偏好。

## 配图文件

配图在写库之前下载并缩成最长边不超过 640 像素的 JPEG。用原文链接 `items.url` 的 UTF-8 字节计算 SHA-1，取前 16 位小写十六进制作为文件名：

```text
data/attachments/images/YYYY-MM/<链接哈希>.jpg
image_path = images/YYYY-MM/<链接哈希>.jpg
```

`image_url` 同时保存原图 HTTPS 地址。下载失败则 `image_path` 留空。显示顺序是本机图片、原图 HTTPS 地址、来源名称首字色块；本机文件不存在时静默回退。文件写入与 SQL 不是同一个事务，写库失败后已经下载的配图可留给下次复用。

启动后的后台清理仅针对超过 180 天且未收藏内容的本机配图，每批最多 50 条，只处理上述哈希文件路径，文字永久保留。先以短事务认领并清除仍符合条件的路径引用，再检查共享引用，无引用才删除文件；删除失败恢复引用。收藏在认领前写入时保留配图，共享收藏引用也会保留文件。清理不阻塞界面。

## 后续升级

只加表、加列或索引，保留用户已有数据。修改 `app/schema.js`，追加下一版本迁移，同步修改本文；程序启动依次执行迁移并在事务内递增版本。AI 日常更新不做迁移。必须删除或清空用户数据时，先说明范围和影响并取得用户同意。
