import { migrations, SCHEMA_VERSION } from './schema.js';

function sdk() {
  const platform = globalThis.panda || globalThis.window?.panda;
  if (!platform?.db) throw new Error('请在熊猫小抽屉里打开拾闻。');
  return platform.db;
}

export async function query(sql, params = [], maxRows = 1000) {
  return (await sdk().execute({ sql, params, options: { maxRows } })).rows;
}

export function execute(sql, params = []) {
  return sdk().execute({ sql, params });
}

export function transaction(statements) {
  return sdk().transaction({ statements });
}

export async function init() {
  const hasMeta = await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'", [], 1);
  const rows = hasMeta.length ? await query("SELECT value FROM meta WHERE key = 'schema_version'", [], 1) : [];
  const version = rows.length ? Number(rows[0].value) : 0;
  if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) {
    throw new Error(`数据库的表结构版本是 ${rows[0]?.value ?? '未知'}，拾闻程序只支持到 ${SCHEMA_VERSION}。可能是拾闻的代码被改回了旧版本，而数据已经升级过。`);
  }
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    await transaction([
      ...migration.statements.map(sql => ({ sql })),
      {
        sql: `INSERT INTO meta(key, value) VALUES ('schema_version', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        params: [String(migration.version)],
      },
    ]);
  }
}

const itemSelect = `SELECT i.*, COALESCE(t.name, '已删除的主题') AS topic_name,
  COALESCE(t.view, 'list') AS topic_view FROM items i LEFT JOIN topics t ON t.id = i.topic_id`;

// CASE also keeps legacy invalid JSON from being passed to json_each().
const validItem = `(typeof(i.title) = 'text' AND length(trim(i.title)) > 0
  AND typeof(i.summary) = 'text' AND length(trim(i.summary)) > 0
  AND typeof(i.url) = 'text' AND length(trim(i.url)) > 0
  AND CASE WHEN json_valid(i.extra) THEN
    json_type(i.extra) = 'object'
    AND NOT EXISTS (SELECT 1 FROM json_each(i.extra) WHERE type != 'text')
    ELSE 0 END)`;

function parseItem(row) {
  if (!row) return null;
  try {
    const extra = JSON.parse(row.extra);
    if (!extra || Array.isArray(extra) || typeof extra !== 'object'
      || Object.values(extra).some(value => typeof value !== 'string')
      || !row.title?.trim() || !row.summary?.trim() || !row.url?.trim()) return null;
    return { ...row, extra };
  } catch {
    return null;
  }
}

function parseTopic(row) {
  if (!row) return null;
  let keywords;
  try { keywords = JSON.parse(row.keywords); } catch { keywords = []; }
  return { ...row, keywords: Array.isArray(keywords) ? keywords.filter(value => typeof value === 'string') : [] };
}

export async function topics() {
  const rows = await query(`SELECT t.*,
    (SELECT count(*) FROM items i WHERE i.topic_id = t.id) AS item_count,
    (SELECT count(*) FROM items i WHERE i.topic_id = t.id AND i.is_starred = 1) AS starred_count,
    (SELECT count(*) FROM items i WHERE i.topic_id = t.id AND i.run_id =
      (SELECT id FROM runs WHERE status IN ('done', 'partial') ORDER BY julianday(started_at) DESC, id DESC LIMIT 1)) AS latest_count
    FROM topics t ORDER BY t.sort_order, t.id`);
  return rows.map(parseTopic);
}

function idValue(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('找不到这条记录，请刷新后重试。');
  return id;
}

// Topics are created by the user's AI. The app only edits existing topics, and only when the row
// is still the version the user opened, so an AI change made meanwhile is never overwritten.
export async function updateTopic(id, input, expectedUpdatedAt) {
  const old = (await query('SELECT * FROM topics WHERE id = ?', [idValue(id)], 1))[0];
  if (!old) throw new Error('这个主题已经不存在，请刷新后重试。');
  const topic = { ...old, ...input };
  const name = String(topic.name || '').trim();
  const description = String(topic.description || '').trim();
  if (!name || !description) throw new Error('请填写主题名称和你关心的内容。');
  const maxItems = Number(topic.max_items ?? 6);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20) throw new Error('每次条数请填写 1 到 20 的整数。');
  let keywords = topic.keywords ?? [];
  if (typeof keywords === 'string') {
    try { keywords = JSON.parse(keywords); } catch { keywords = keywords.split(/[,，\n]/); }
  }
  if (!Array.isArray(keywords) || keywords.some(value => typeof value !== 'string')) throw new Error('请用文字填写关键词。');
  keywords = [...new Set(keywords.map(value => value.trim()).filter(Boolean))];
  const enabled = Number(topic.enabled ?? 1);
  if (![0, 1].includes(enabled)) throw new Error('主题状态无效，请刷新后重试。');
  const sortOrder = Number(topic.sort_order ?? 0);
  if (!Number.isFinite(sortOrder)) throw new Error('主题顺序无效。');
  const fields = ['name', 'description', 'keywords', 'sources', 'excludes', 'extra_fields', 'max_items', 'view', 'enabled', 'sort_order', 'updated_at', 'updated_by'];
  const values = [name, description, JSON.stringify(keywords), String(topic.sources || ''), String(topic.excludes || ''),
    String(topic.extra_fields || ''), maxItems, String(topic.view || 'list'), enabled, sortOrder, new Date().toISOString(), 'app'];
  const rows = await query(`UPDATE topics SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE id = ? AND updated_at = ? RETURNING *`,
    [...values, old.id, String(expectedUpdatedAt ?? old.updated_at)], 1);
  if (!rows.length) {
    const error = new Error('这个主题刚被你的 AI 修改过。请记下你的修改，刷新后再改。');
    error.code = 'TOPIC_CHANGED';
    throw error;
  }
  return parseTopic(rows[0]);
}

export function deleteTopic(id) {
  // foreign_keys=ON is established by the platform on every connection.
  return execute('DELETE FROM topics WHERE id = ?', [idValue(id)]);
}

export function learned(topicId) {
  return topicId == null
    ? query('SELECT * FROM learned WHERE topic_id IS NULL ORDER BY julianday(updated_at) DESC, id DESC')
    : query('SELECT * FROM learned WHERE topic_id = ? OR topic_id IS NULL ORDER BY topic_id IS NOT NULL DESC, julianday(updated_at) DESC, id DESC', [idValue(topicId)]);
}

export function deleteLearned(id) {
  return execute('DELETE FROM learned WHERE id = ?', [idValue(id)]);
}

const userColumns = new Set(['is_read', 'is_starred', 'starred_at', 'is_dismissed', 'dismiss_reason', 'note', 'user_updated_at']);
export async function setItemUser(id, input) {
  if (Object.keys(input).some(key => !userColumns.has(key))) throw new Error('这项内容只能由 AI 更新。');
  if (!Object.keys(input).length) return item(id);
  const patch = { ...input };
  for (const key of ['is_read', 'is_starred', 'is_dismissed']) {
    if (!(key in patch)) continue;
    patch[key] = Number(patch[key]);
    if (![0, 1].includes(patch[key])) throw new Error('标记无效，请刷新后重试。');
  }
  if ('note' in patch) patch.note = String(patch.note ?? '');
  const now = new Date().toISOString();
  if ('is_starred' in patch) patch.starred_at = patch.is_starred ? now : null;
  if (patch.is_dismissed === 0) patch.dismiss_reason = null;
  patch.user_updated_at = now;
  const fields = Object.keys(patch);
  await execute(`UPDATE items SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE id = ?`, [...fields.map(field => patch[field]), idValue(id)]);
  return item(id);
}

export function markRead(runId) {
  return execute('UPDATE items SET is_read = 1, user_updated_at = ? WHERE run_id = ? AND is_read = 0', [new Date().toISOString(), idValue(runId)]);
}

export async function item(id) {
  return parseItem((await query(`${itemSelect} WHERE i.id = ?`, [idValue(id)], 1))[0]);
}

export function requests(itemId) {
  return query('SELECT * FROM requests WHERE item_id = ? ORDER BY id DESC LIMIT 50', [idValue(itemId)], 50);
}

export async function request(itemId, kind, text = '') {
  if (!['deep_dive', 'similar'].includes(kind)) throw new Error('请求方式无效。');
  const id = idValue(itemId);
  await execute('INSERT OR IGNORE INTO requests (item_id, kind, text, created_at) VALUES (?, ?, ?, ?)', [id, kind, String(text || ''), new Date().toISOString()]);
  return (await query("SELECT * FROM requests WHERE item_id = ? AND kind = ? AND status = 'pending'", [id, kind], 1))[0];
}

function pageInteger(value, fallback, maximum) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 0) return fallback;
  return Math.min(number, maximum);
}

export function runs(limit = 30, offset = 0) {
  return query('SELECT * FROM runs ORDER BY julianday(started_at) DESC, id DESC LIMIT ? OFFSET ?',
    [Math.max(1, pageInteger(limit, 30, 1000)), pageInteger(offset, 0, Number.MAX_SAFE_INTEGER)]);
}

export async function latestRun() {
  return (await runs(1))[0] || null;
}

export async function todayRun() {
  return (await query("SELECT * FROM runs WHERE status IN ('done', 'partial') ORDER BY julianday(started_at) DESC, id DESC LIMIT 1", [], 1))[0] || null;
}

export async function briefingStats(runId) {
  return (await query(`SELECT COUNT(*) AS total,
    COUNT(CASE WHEN i.is_read = 0 AND i.is_dismissed = 0 THEN 1 END) AS unread,
    COUNT(CASE WHEN i.topic_id IS NULL THEN 1 END) AS deleted
    FROM items i WHERE i.run_id = ? AND ${validItem}`, [idValue(runId)], 1))[0];
}

function localDay(value, after = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效的日期。');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('请选择有效的日期。');
  if (after) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export async function listItems(filters = {}) {
  const where = [];
  const params = [];
  if (filters.runId != null) { where.push('i.run_id = ?'); params.push(idValue(filters.runId)); }
  if (filters.topicId === 'deleted') where.push('i.topic_id IS NULL');
  else if (filters.topicId != null && filters.topicId !== '') { where.push('i.topic_id = ?'); params.push(idValue(filters.topicId)); }
  if (filters.status === 'unread') where.push('i.is_read = 0 AND i.is_dismissed = 0');
  if (filters.status === 'starred') where.push('i.is_starred = 1');
  if (filters.status === 'dismissed') where.push('i.is_dismissed = 1');
  if (filters.notesOnly) where.push("length(trim(COALESCE(i.note, ''))) > 0");
  if (filters.search?.trim()) {
    const text = `%${filters.search.trim().replace(/[\\%_]/g, char => `\\${char}`)}%`;
    if (filters.searchScope === 'favorites') {
      where.push("(i.title LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\')");
      params.push(text, text);
    } else {
      where.push("(i.title LIKE ? ESCAPE '\\' OR i.summary LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\')");
      params.push(text, text, text);
    }
  }
  if (filters.from) { where.push('julianday(i.collected_at) >= julianday(?)'); params.push(localDay(filters.from)); }
  if (filters.to) { where.push('julianday(i.collected_at) < julianday(?)'); params.push(localDay(filters.to, true)); }
  const conditions = where.length ? where.join(' AND ') : '1';
  const counts = (await query(`SELECT
    COALESCE(SUM(CASE WHEN ${validItem} THEN 1 ELSE 0 END), 0) AS total,
    COALESCE(SUM(CASE WHEN ${validItem} THEN 0 ELSE 1 END), 0) AS invalid_count
    FROM items i WHERE ${conditions}`, params, 1))[0];
  const order = filters.order === 'oldest' ? 'julianday(i.collected_at) ASC, i.id ASC'
    : filters.order === 'starred' ? 'julianday(i.starred_at) DESC, i.id DESC'
      : filters.order === 'published' ? 'julianday(COALESCE(i.published_at, i.collected_at)) DESC, i.id DESC'
        : 'julianday(i.collected_at) DESC, i.id DESC';
  const limit = Math.max(1, pageInteger(filters.limit, 50, 50));
  const offset = pageInteger(filters.offset, 0, Number.MAX_SAFE_INTEGER);
  const rows = await query(`${itemSelect} WHERE ${conditions} AND ${validItem} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset], limit);
  return { items: rows.map(parseItem).filter(Boolean), total: Number(counts.total), invalidCount: Number(counts.invalid_count) };
}
