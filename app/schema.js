// One statement per entry: the platform owns the enclosing transaction.
export const SCHEMA_VERSION = 1;

export const migrations = [{
  version: 1,
  statements: [
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      description TEXT NOT NULL CHECK (length(trim(description)) > 0),
      keywords TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(keywords) AND json_type(keywords) = 'array'),
      sources TEXT NOT NULL DEFAULT '',
      excludes TEXT NOT NULL DEFAULT '',
      extra_fields TEXT NOT NULL DEFAULT '',
      max_items INTEGER NOT NULL DEFAULT 6 CHECK (max_items BETWEEN 1 AND 20),
      view TEXT NOT NULL DEFAULT 'list',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      agent TEXT,
      trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('setup', 'scheduled', 'manual')),
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'partial', 'failed')),
      schedule TEXT,
      added INTEGER NOT NULL DEFAULT 0 CHECK (added >= 0),
      skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped >= 0),
      images_saved INTEGER NOT NULL DEFAULT 0 CHECK (images_saved >= 0),
      images_failed INTEGER NOT NULL DEFAULT 0 CHECK (images_failed >= 0),
      digest TEXT,
      message TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY,
      run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
      topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      source TEXT,
      published_at TEXT,
      summary TEXT NOT NULL,
      reason TEXT,
      importance INTEGER NOT NULL DEFAULT 2 CHECK (importance BETWEEN 1 AND 3),
      image_path TEXT,
      image_url TEXT,
      extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
      collected_at TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
      is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
      starred_at TEXT,
      is_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (is_dismissed IN (0, 1)),
      dismiss_reason TEXT CHECK (dismiss_reason IS NULL OR dismiss_reason IN ('和主题无关', '来源不可靠', '内容太旧', '重复了')),
      note TEXT NOT NULL DEFAULT '',
      user_updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('deep_dive', 'similar')),
      item_id INTEGER NOT NULL REFERENCES items(id),
      text TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
      result TEXT,
      run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
      finished_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS learned (
      id INTEGER PRIMARY KEY,
      topic_id INTEGER REFERENCES topics(id) ON DELETE CASCADE,
      text TEXT NOT NULL CHECK (length(trim(text)) > 0),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    'CREATE INDEX IF NOT EXISTS items_collected_at ON items(collected_at)',
    'CREATE INDEX IF NOT EXISTS items_topic_id ON items(topic_id)',
    'CREATE INDEX IF NOT EXISTS items_is_starred ON items(is_starred)',
    'CREATE INDEX IF NOT EXISTS items_run_id ON items(run_id)',
    'CREATE INDEX IF NOT EXISTS requests_item_id ON requests(item_id)',
    `CREATE UNIQUE INDEX IF NOT EXISTS requests_one_pending ON requests(item_id, kind) WHERE status = 'pending'`,
  ],
}];
