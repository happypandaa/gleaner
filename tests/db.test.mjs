import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as db from '../app/db.js';
import { cleanupImages } from '../app/cleanup.js';

process.env.TZ = 'Asia/Shanghai';
let connection;

function executeStatement({ sql, params = [], options = {} }) {
  const statement = connection.prepare(sql);
  const hasRows = statement.columns().length > 0;
  const rows = hasRows ? statement.all(...params).map(row => ({ ...row })) : [];
  const result = hasRows ? connection.prepare('SELECT changes() AS changes, last_insert_rowid() AS id').get() : statement.run(...params);
  if (rows.length > (options.maxRows ?? 1000)) throw new Error('SQL row budget exceeded');
  return { rows, columns: hasRows ? statement.columns().map(column => ({ name: column.name })) : [],
    changes: result.changes, lastInsertRowid: result.lastInsertRowid ?? result.id, changed: Boolean(result.changes) };
}

beforeEach(() => {
  connection = new DatabaseSync(':memory:');
  connection.exec('PRAGMA foreign_keys = ON');
  globalThis.panda = { db: {
    async execute(input) { return executeStatement(input); },
    async transaction({ statements }) {
      connection.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(executeStatement);
        connection.exec('COMMIT');
        return results;
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
  } };
});

afterEach(() => {
  connection.close();
  delete globalThis.panda;
  delete globalThis.window;
});

// Topics are created by the user's AI in conversation, as AGENTS.md describes.
async function topic(overrides = {}) {
  const now = '2026-11-06T08:00:00.000Z';
  const values = { name: 'AI 工具动态', description: '关注能用上的工具变化', keywords: '["工具"]', created_at: now, updated_at: now, updated_by: 'agent', ...overrides };
  const keys = Object.keys(values);
  const row = (await db.query(`INSERT INTO topics(${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING id`, Object.values(values)))[0];
  return (await db.topics()).find(entry => entry.id === row.id);
}

async function run(overrides = {}) {
  const values = { started_at: '2026-11-06T08:00:00+08:00', status: 'done', trigger: 'setup', ...overrides };
  return (await db.query('INSERT INTO runs(started_at, status, trigger) VALUES (?, ?, ?) RETURNING *', Object.values(values)))[0];
}

async function insertItem(overrides = {}) {
  const values = { title: '值得看的工具变化', url: 'https://example.com/article', summary: '这条内容讲了什么。以及它的用途。',
    collected_at: '2026-11-06T08:00:00+08:00', extra: '{}', ...overrides };
  const keys = Object.keys(values);
  return (await db.query(`INSERT INTO items(${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING *`, Object.values(values)))[0];
}

test('initialization creates the complete version once and preserves existing content', async () => {
  await db.init();
  const tables = await db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  assert.deepEqual(tables.map(row => row.name), ['items', 'learned', 'meta', 'requests', 'runs', 'topics']);
  assert.equal((await db.query("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value, '2');
  const saved = await topic();
  await insertItem({ topic_id: saved.id });
  await db.init();
  assert.equal((await db.listItems()).total, 1);
  assert.equal((await db.topics())[0].id, saved.id);
  assert.deepEqual((await db.topics())[0].keywords, ['工具']);
});

test('version 1 databases upgrade in place and keep their topics as app-edited', async () => {
  const { migrations } = await import('../app/schema.js');
  for (const sql of migrations[0].statements) await db.execute(sql);
  await db.execute("INSERT INTO meta(key, value) VALUES ('schema_version', '1')");
  await db.execute("INSERT INTO topics(name, description) VALUES ('车价', '关注降价')");
  await db.init();
  assert.equal((await db.query("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value, '2');
  const [kept] = await db.topics();
  assert.equal(kept.name, '车价');
  assert.equal(kept.updated_by, 'app');
  await assert.rejects(db.execute("UPDATE topics SET updated_by = 'someone' WHERE id = ?", [kept.id]), /CHECK/);
});

test('app edits mark the topic as user-changed and never overwrite a newer AI change', async () => {
  await db.init();
  const opened = await topic();
  const saved = await db.updateTopic(opened.id, { description: '只看能直接上手的工具', enabled: 0 }, opened.updated_at);
  assert.equal(saved.updated_by, 'app');
  assert.equal(saved.enabled, 0);
  assert.equal(saved.name, opened.name);
  assert.notEqual(saved.updated_at, opened.updated_at);
  // The AI edits the topic (as the user asked in conversation) while the app still shows the old version.
  await db.execute("UPDATE topics SET description = 'AI 改过的描述', updated_by = 'agent', updated_at = ? WHERE id = ? AND updated_at = ?",
    ['2026-11-07T09:00:00.000Z', saved.id, saved.updated_at]);
  await assert.rejects(db.updateTopic(saved.id, { description: '旧页面里的修改' }, saved.updated_at), error => error.code === 'TOPIC_CHANGED');
  const current = (await db.topics())[0];
  assert.equal(current.description, 'AI 改过的描述');
  assert.equal(current.updated_by, 'agent');
  await assert.rejects(db.updateTopic(current.id, { max_items: 21 }, current.updated_at), /1 到 20/);
  await assert.rejects(db.updateTopic(9999, { name: '不存在' }), /不存在/);
});

test('failed initialization rolls back every schema statement and version marker', async () => {
  const original = globalThis.panda.db.transaction;
  globalThis.panda.db.transaction = input => original({ statements: [...input.statements, { sql: 'INSERT INTO missing_table VALUES (1)' }] });
  await assert.rejects(db.init());
  assert.equal((await db.query("SELECT name FROM sqlite_master WHERE type = 'table'")).length, 0);
});

test('newer database versions are rejected without changing their data', async () => {
  await db.init();
  await db.execute("UPDATE meta SET value = '3' WHERE key = 'schema_version'");
  await assert.rejects(db.init(), /更新版本/);
  assert.equal((await db.query("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value, '3');
});

test('user changes stay in user columns and duplicate AI inserts preserve them', async () => {
  await db.init();
  const original = await insertItem();
  await db.setItemUser(original.id, { is_read: 1, is_starred: true, note: "留意 '下一次' 更新" });
  await db.execute('INSERT OR IGNORE INTO items(title, url, summary, collected_at) VALUES (?, ?, ?, ?)',
    ['重复内容', original.url, '另一份摘要', original.collected_at]);
  const saved = await db.item(original.id);
  assert.equal(saved.title, original.title);
  assert.equal(saved.is_read, 1);
  assert.equal(saved.is_starred, 1);
  assert.equal(saved.note, "留意 '下一次' 更新");
  assert.ok(saved.starred_at);
  await assert.rejects(db.setItemUser(original.id, { title: '越权修改', note: '同时修改' }), /只能由 AI/);
  assert.equal((await db.item(original.id)).note, saved.note);
  await db.setItemUser(original.id, { is_starred: 0, is_dismissed: 1, dismiss_reason: '内容太旧' });
  assert.equal((await db.item(original.id)).starred_at, null);
  await db.setItemUser(original.id, { is_dismissed: 0 });
  assert.equal((await db.item(original.id)).dismiss_reason, null);
});

test('deleting a topic retains all history and feedback without making its learned preferences global', async () => {
  await db.init();
  const saved = await topic();
  const original = await insertItem({ topic_id: saved.id, note: '保留备注', is_starred: 1 });
  await db.execute('INSERT INTO learned(topic_id, text) VALUES (?, ?)', [saved.id, '不要融资消息']);
  await db.execute('INSERT INTO learned(text) VALUES (?)', ['优先原始来源']);
  await db.deleteTopic(saved.id);
  const retained = await db.item(original.id);
  assert.equal(retained.topic_id, null);
  assert.equal(retained.topic_name, '已删除的主题');
  assert.equal(retained.note, '保留备注');
  assert.equal(retained.is_starred, 1);
  assert.deepEqual((await db.learned()).map(row => row.text), ['优先原始来源']);
});

test('schema checks reject corrupt JSON, invalid importance, invalid reasons and invalid topic limits', async () => {
  await db.init();
  await assert.rejects(insertItem({ extra: '{invalid}' }));
  await assert.rejects(insertItem({ importance: 4 }));
  await assert.rejects(insertItem({ dismiss_reason: '自定义非法原因' }));
  await assert.rejects(topic({ max_items: 21 }), /CHECK/);
  await assert.rejects(topic({ updated_by: 'robot' }), /CHECK/);
  assert.equal((await db.listItems()).total, 0);
});

test('listing filters local date boundaries, escapes search text and pages without reading all history', async () => {
  await db.init();
  const saved = await topic();
  await insertItem({ url: 'https://example.com/yesterday', collected_at: '2026-11-05T15:59:59Z' });
  const target = await insertItem({ topic_id: saved.id, title: "100%_ '工具'", collected_at: '2026-11-05T16:00:00Z', note: '有备注', is_starred: 1 });
  await insertItem({ url: 'https://example.com/tomorrow', collected_at: '2026-11-06T16:00:00Z' });
  const filtered = await db.listItems({ from: '2026-11-06', to: '2026-11-06', topicId: saved.id, search: "%_ '工具'", notesOnly: true, status: 'starred' });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].id, target.id);
  await db.transaction(Array.from({ length: 55 }, (_, index) => ({
    sql: 'INSERT INTO items(title, url, summary, collected_at) VALUES (?, ?, ?, ?)',
    params: [`条目 ${index}`, `https://example.com/page-${index}`, '这是中文摘要。', '2026-11-06T12:00:00+08:00'],
  })));
  const first = await db.listItems({ from: '2026-11-06', to: '2026-11-06' });
  const second = await db.listItems({ from: '2026-11-06', to: '2026-11-06', offset: 50 });
  assert.equal(first.total, 56);
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 6);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 56);
});

test('malformed extra shapes and values are skipped, counted, and do not consume page positions', async () => {
  await db.init();
  await insertItem({ url: 'https://example.com/invalid-array', extra: '[]' });
  await insertItem({ url: 'https://example.com/invalid-value', extra: '{"现价": 159800}' });
  const valid = await insertItem({ extra: '{"现价":"15.98 万"}' });
  const result = await db.listItems({ limit: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.invalidCount, 2);
  assert.equal(result.items[0].id, valid.id);
  assert.deepEqual(result.items[0].extra, { 现价: '15.98 万' });
  assert.equal(await db.item(valid.id - 1), null);
});

test('requests deduplicate only while pending and keep prior results', async () => {
  await db.init();
  const original = await insertItem();
  const a = await db.request(original.id, 'deep_dive', '看看原始资料');
  const b = await db.request(original.id, 'deep_dive', '重复点击');
  assert.equal(a.id, b.id);
  assert.equal((await db.requests(original.id)).length, 1);
  await db.execute("UPDATE requests SET status = 'done', result = ? WHERE id = ?", ['已经核实。', a.id]);
  const c = await db.request(original.id, 'deep_dive');
  assert.notEqual(c.id, a.id);
  assert.equal((await db.requests(original.id)).find(row => row.id === a.id).result, '已经核实。');
});

test('run state remains visible until an atomic result transaction succeeds', async () => {
  await db.init();
  const first = await run();
  const pending = await run({ started_at: '2026-11-07T08:00:00+08:00', status: 'running' });
  assert.equal((await db.latestRun()).id, pending.id);
  assert.equal((await db.todayRun()).id, first.id);
  await assert.rejects(db.transaction([
    { sql: 'INSERT INTO items(title, url, summary, collected_at, run_id) VALUES (?, ?, ?, ?, ?)', params: ['内容', 'https://example.com/result', '摘要', pending.started_at, pending.id] },
    { sql: "UPDATE runs SET status = 'invalid' WHERE id = ?", params: [pending.id] },
  ]));
  assert.equal((await db.listItems()).total, 0);
  assert.equal((await db.latestRun()).status, 'running');
  await db.execute("UPDATE runs SET status = 'failed', message = ? WHERE id = ?", ['写入失败，已回滚。', pending.id]);
  assert.equal((await db.latestRun()).status, 'failed');
  assert.equal((await db.todayRun()).id, first.id);
});

test('marking a run read affects that run only', async () => {
  await db.init();
  const first = await run();
  const second = await run({ started_at: '2026-11-07T08:00:00+08:00' });
  const a = await insertItem({ run_id: first.id });
  const b = await insertItem({ run_id: second.id, url: 'https://example.com/second' });
  await db.markRead(second.id);
  assert.equal((await db.item(a.id)).is_read, 0);
  assert.equal((await db.item(b.id)).is_read, 1);
});

function installFiles(remove) {
  globalThis.window = { panda: { files: { remove } } };
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

test('image cleanup preserves old favorite and recent thumbnails', async () => {
  await db.init();
  const favorite = await insertItem({
    image_path: 'images/2026-01/0123456789abcdef.jpg',
    collected_at: daysAgo(181), is_starred: 1,
  });
  const recent = await insertItem({
    url: 'https://example.com/recent', image_path: 'images/2026-11/fedcba9876543210.jpg',
    collected_at: daysAgo(179),
  });
  const removed = [];
  installFiles(async path => { removed.push(path); return { removed: true, path }; });
  await cleanupImages();
  assert.deepEqual(removed, []);
  assert.equal((await db.item(favorite.id)).image_path, favorite.image_path);
  assert.equal((await db.item(recent.id)).image_path, recent.image_path);
});

test('image cleanup removes only the expired thumbnail and retains all text and user feedback', async () => {
  await db.init();
  const original = await insertItem({
    image_path: 'images/2026-01/0123456789abcdef.jpg', image_url: 'https://example.com/image.jpg',
    collected_at: daysAgo(181), is_read: 1, is_dismissed: 1, dismiss_reason: '内容太旧',
    note: '清理图片后也要保留这条备注', user_updated_at: new Date().toISOString(),
  });
  const removed = [];
  installFiles(async path => { removed.push(path); return { removed: true, path }; });
  await cleanupImages();
  assert.deepEqual(removed, [original.image_path]);
  const retained = (await db.query('SELECT * FROM items WHERE id = ?', [original.id]))[0];
  assert.deepEqual(retained, { ...original, image_path: null });
  assert.equal((await db.listItems()).total, 1);
});

test('image cleanup never removes a shared file still referenced by a favorite', async () => {
  await db.init();
  const path = 'images/2026-01/0123456789abcdef.jpg';
  const old = await insertItem({ image_path: path, collected_at: daysAgo(181) });
  const favorite = await insertItem({
    url: 'https://example.com/favorite', image_path: path, collected_at: daysAgo(182), is_starred: 1,
  });
  const removed = [];
  installFiles(async value => { removed.push(value); return { removed: true, path: value }; });
  await cleanupImages();
  assert.deepEqual(removed, []);
  assert.equal((await db.item(old.id)).image_path, null);
  assert.equal((await db.item(favorite.id)).image_path, path);
  assert.equal((await db.listItems()).total, 2);
});

test('image cleanup restores the reference after file removal fails', async t => {
  await db.init();
  const original = await insertItem({
    image_path: 'images/2026-01/0123456789abcdef.jpg', collected_at: daysAgo(181), note: '保留反馈',
  });
  t.mock.method(console, 'warn', () => {});
  let attempts = 0;
  installFiles(async path => {
    attempts += 1;
    assert.equal(path, original.image_path);
    assert.equal((await db.item(original.id)).image_path, null);
    throw new Error('暂时不能访问附件');
  });
  await cleanupImages();
  assert.equal(attempts, 1);
  assert.deepEqual((await db.query('SELECT * FROM items WHERE id = ?', [original.id]))[0], original);
});

test('a favorite saved after candidate lookup wins before image cleanup claims its reference', async () => {
  await db.init();
  const original = await insertItem({ image_path: 'images/2026-01/0123456789abcdef.jpg', collected_at: daysAgo(181) });
  const transact = globalThis.panda.db.transaction;
  globalThis.panda.db.transaction = async input => {
    await db.setItemUser(original.id, { is_starred: 1 });
    return transact(input);
  };
  const removed = [];
  installFiles(async path => { removed.push(path); return { removed: true, path }; });
  await cleanupImages();
  assert.deepEqual(removed, []);
  assert.equal((await db.item(original.id)).image_path, original.image_path);
  assert.equal((await db.item(original.id)).is_starred, 1);
});
