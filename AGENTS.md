# 拾闻：给 AI 的运行规则

拾闻是用户的资讯简报应用。你负责按用户的主题收集内容并写入数据库；拾闻负责展示和记录用户反馈。应用根目录也是你的工作目录。表结构和字段含义以 [docs/database.md](docs/database.md) 为准。

## 你可能被要求做的三类事

1. **更新简报**：用户说“更新简报”，或定时任务触发时，按下面的更新流程做。
2. **处理请求**：更新流程第 4 步会处理，不需要另起一套流程。
3. **修改拾闻本身**：用户说“把列表改成卡片”“车价主题做成对比表”等，这是改程序。先读 `docs/design.md`、`docs/database.md`；展示方式另读 `docs/views.md`，按熊猫小抽屉平台说明的修改流程做。表结构有变化时，同时修改程序里的升级逻辑和 `docs/database.md`，只加列、加表；删除或清空数据前先说明影响并取得用户同意。

用户没有明确要求时，不要改 `app/`、`panda.json`、`AGENTS.md`、`docs/` 里的任何文件。不要把日常更新当成修改应用。需要安装 Node.js 开发依赖时使用 pnpm；本应用本身没有依赖安装和构建步骤。

## 更新流程

0. **先确认数据库已存在**。先执行 `test -f data/main.sqlite`；不存在就不要连接，避免 `sqlite3` 意外创建空库。存在后，用只读连接检查 `topics` 表：

   ```sh
   sqlite3 -readonly -cmd ".timeout 5000" data/main.sqlite "SELECT name FROM sqlite_master WHERE type='table' AND name='topics';"
   ```

   数据库或表不存在，说明用户尚未完成首次打开：不要自己建库建表，告诉用户先在熊猫小抽屉里打开一次拾闻，然后结束。打开后仍缺失时，报告问题，不自行修表。继续前先读 `docs/database.md`。
1. **每次连接先设置等待时间**：

   ```sh
   sqlite3 -cmd ".timeout 5000" data/main.sqlite
   ```

   SQL 值必须使用参数绑定或可靠的 SQL 值编码，不能把网页正文、标题或用户输入直接拼接成可执行 SQL。时间使用带时区的 ISO 8601 文本。
2. **开始**：在 `runs` 单独插入一行并立即提交。`status='running'`；`trigger` 在定时任务填 `scheduled`，用户当面叫你填 `manual`，第一次设置试跑填 `setup`；`agent` 填你的工具名，`schedule` 填实际定时安排，没有就留空。记下这行的 `id`。不要仅因用户复制了提示词就声称定时任务设置成功。
3. **读取**：只读查询，不开写事务。读取：
   - 开启的主题：`SELECT * FROM topics WHERE enabled = 1 ORDER BY sort_order, id`。
   - 最近 30 天的反馈：收藏、不感兴趣（含原因）、有备注的内容，以及标题、来源、链接。按用户反馈时间 `user_updated_at` 判断最近，不遗漏旧内容上的新反馈。
   - `learned` 表。
   - 最近 30 天已有的链接，用于去重；最终仍以 `items.url` 的唯一约束为准。
   - 待处理请求：`SELECT * FROM requests WHERE status = 'pending'`，及相关内容。

   不读取全部历史；只有用户明确要求回顾历史时，才扩大只读查询范围。
4. **处理请求**：这一步不写数据库。`deep_dive` 围绕原内容查更多资料，结论整理成纯文本 `result`；`similar` 把找到的内容作为新内容准备好，在 `result` 里列出标题。处理不了的请求记下原因，留到第 7 步标为 `failed`。不要提前把请求标为完成。
5. **按主题收集内容**：这一步不写数据库。
   - 每个主题不超过它的 `max_items` 条，宁缺毋滥。
   - 遵守 `description`、`excludes`、`sources`，参考用户反馈和 `learned`。
   - 跳过已有链接和明显重复的内容。
   - `summary` 用中文写 2–4 句，说清这条内容讲了什么；`reason` 用一句话说明为什么推给这位用户。
   - 主题的 `extra_fields` 不为空时，把查到的信息放入 `extra` 对象，键名用其中的原词，值一律是字符串；查不到的键不写。
6. **配图**：这一步不写数据库。下载原文配图，用 `sips -Z 640` 缩至最长边不超过 640 像素，保存为 JPEG，放到 `data/attachments/images/YYYY-MM/<链接哈希>.jpg`。链接哈希取该条原文链接 SHA-1 的前 16 位十六进制，可用 `shasum` 计算。下载时尚无内容 id，不能依赖 id 命名。准备相对附件根的 `image_path`（`images/YYYY-MM/…jpg`）和原图地址 `image_url`。下载或缩图失败时，`image_path` 留空，只保留 `image_url`，计入 `images_failed`。
7. **写入**：收集和下载全部完成后，用一个短事务，几秒内完成：

   ```sql
   BEGIN IMMEDIATE;
   -- INSERT OR IGNORE 新内容；更新请求结果、learned、runs 最终状态。
   COMMIT;
   ```

   依次完成：
   - 用 `INSERT OR IGNORE` 写入第 4、5 步准备好的新内容，显式列出 AI 内容列，不写用户列；将本次 `run_id` 和主题关联好。
   - 更新已处理请求的 `status`、`result`、`run_id`、`finished_at`。成功为 `done`，失败为 `failed` 并说明原因。
   - 根据最近反馈更新 `learned`，每个主题最多 10 条，一句话一条。可以修改或删除自己写的偏好行。
   - 更新第 2 步那行 `runs` 的 `finished_at`、`status`、各项计数、`digest` 和 `message`。全部完成为 `done`，部分主题失败为 `partial`，什么也没写成为 `failed`。`added` 是实际新增条数，`skipped` 是因重复跳过的条数。`digest` 用中文写 1–3 句今日要点，有问题时在 `message` 说明原因。
   - 提交事务。事务里只执行写库语句，不做搜索、下载、缩图或其他耗时操作。
8. **写入失败时**：先确认事务已回滚，再单独把第 2 步那行 `runs` 更新为 `failed`，在 `message` 写原因。已下载的配图可保留，同一链接下次可复用。结果不明时先核对实际结果，不盲目重放写入。

## 写入规则（必须遵守）

- 写库只在三个时刻：开始记录单独提交；全部准备好后，以一个短事务提交内容、请求结果、偏好和运行最终状态；失败时单独标记运行记录。搜索、下载、缩图期间**不持有写事务**。界面每次保存最多等 5 秒，长事务会让用户收藏、备注保存失败。
- 新增内容只用 `INSERT` 或 `INSERT OR IGNORE`。**禁止 `INSERT OR REPLACE`、`REPLACE`、`DELETE FROM items`**，不得替换、清空数据库。
- 不修改 `items` 的用户列：`is_read`、`is_starred`、`starred_at`、`is_dismissed`、`dismiss_reason`、`note`、`user_updated_at`。
- 不修改 `topics` 表。主题由用户在拾闻里设置。
- 日常更新不改表结构，不执行 `PRAGMA journal_mode`、`VACUUM`，不删除 `main.sqlite-wal`、`main.sqlite-shm`。
- 配图只写进 `data/attachments/images/`；不在 `data/` 其他位置建文件，不生成中间 JSON 文件。用户数据库和附件不提交到 Git。
- 数据库报“被锁”时，等几秒重试，不删除任何文件。结果不明时先检查，不自动重放整次写入。
- 拾闻不会接收外部写库事件。完成后提醒用户回到拾闻刷新；窗口重新获得焦点时也会刷新。
