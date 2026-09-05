/**
 * SQLite 数据库单例：播放记录与事件历史的持久化存储。
 * 数据库文件与配置同目录 data/vtuber.db（测试实例自动隔离）。
 * 同步 API（better-sqlite3），与现有代码风格一致。
 */
import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

export interface PlayHistoryRow {
  id?: number
  queue_id: string
  title: string
  artist: string
  source: string
  song_id: string
  duration: number
  cover: string
  user_id: string
  user_name: string
  requested_at: number
  started_at: number
  ended_at: number | null
  status: string | null
}

export interface EventHistoryRow {
  id?: number
  type: string
  timestamp: number
  room_id: string
  user_uid: string | null
  user_name: string | null
  user_face: string | null
  data: string
}

export interface TraceRow {
  id: number
  ts: number
  source: string
  reason: string
  decision: string
  events_count: number
  system_prompt: string
  user_prompt: string
  model: string
  response: string
  tool_calls: string
  outputs: string
  silent_reason: string | null
  error: string | null
  duration_ms: number
}

export class VtuberDatabase {
  private db: Database.Database | null = null
  private _playHistoryPath = ''

  get playHistoryPath(): string {
    return this._playHistoryPath
  }

  open(dbPath: string): void {
    if (this.db) return
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this._playHistoryPath = dbPath
    this.createTables()
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  private createTables(): void {
    const d = this.db!
    d.exec(`
      CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        artist TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        song_id TEXT NOT NULL DEFAULT '',
        duration INTEGER NOT NULL DEFAULT 0,
        cover TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        user_name TEXT NOT NULL DEFAULT '',
        requested_at INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL DEFAULT 0,
        ended_at INTEGER,
        status TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ph_started ON play_history(started_at DESC);

      CREATE TABLE IF NOT EXISTS event_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        room_id TEXT NOT NULL DEFAULT '',
        user_uid TEXT,
        user_name TEXT,
        user_face TEXT,
        data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_eh_ts ON event_history(timestamp DESC);

      CREATE TABLE IF NOT EXISTS llm_trace (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL DEFAULT '',
        events_count INTEGER NOT NULL DEFAULT 0,
        system_prompt TEXT NOT NULL DEFAULT '',
        user_prompt TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        response TEXT NOT NULL DEFAULT '',
        tool_calls TEXT NOT NULL DEFAULT '[]',
        outputs TEXT NOT NULL DEFAULT '[]',
        silent_reason TEXT,
        error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_trace_ts ON llm_trace(ts DESC);
    `)
  }

  // ==================== 播放记录 ====================

  insertPlayHistory(row: Omit<PlayHistoryRow, 'id'>): number {
    const d = this.db!
    const result = d.prepare(`
      INSERT INTO play_history (queue_id, title, artist, source, song_id, duration, cover, user_id, user_name, requested_at, started_at, ended_at, status)
      VALUES (@queue_id, @title, @artist, @source, @song_id, @duration, @cover, @user_id, @user_name, @requested_at, @started_at, @ended_at, @status)
    `).run(row)
    return Number(result.lastInsertRowid)
  }

  /** 归档最近一条进行中记录（ended_at IS NULL） */
  archiveOpenPlayHistory(status: string, endedAt: number): void {
    this.db!.prepare(`
      UPDATE play_history SET ended_at = ?, status = ?
      WHERE id = (SELECT id FROM play_history WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1)
    `).run(endedAt, status)
  }

  /** 插入已完结的记录（开播失败的"失败"记录） */
  insertFailedPlayHistory(row: Omit<PlayHistoryRow, 'id'>): number {
    return this.insertPlayHistory(row)
  }

  getPlayHistory(limit = 100, before?: number): PlayHistoryRow[] {
    const d = this.db!
    if (before !== undefined) {
      return d.prepare(`
        SELECT * FROM play_history WHERE started_at < ? ORDER BY started_at DESC LIMIT ?
      `).all(before, limit) as PlayHistoryRow[]
    }
    return d.prepare(`
      SELECT * FROM play_history ORDER BY started_at DESC LIMIT ?
    `).all(limit) as PlayHistoryRow[]
  }

  getPlayHistoryCount(): number {
    return (this.db!.prepare('SELECT COUNT(*) as c FROM play_history').get() as { c: number }).c
  }

  deleteOldPlayHistory(days: number): number {
    if (days <= 0) return 0
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const result = this.db!.prepare('DELETE FROM play_history WHERE started_at < ?').run(cutoff)
    return result.changes
  }

  // ==================== 事件历史 ====================

  insertEventHistory(row: Omit<EventHistoryRow, 'id'>): number {
    const result = this.db!.prepare(`
      INSERT INTO event_history (type, timestamp, room_id, user_uid, user_name, user_face, data)
      VALUES (@type, @timestamp, @room_id, @user_uid, @user_name, @user_face, @data)
    `).run(row)
    return Number(result.lastInsertRowid)
  }

  getEventHistory(limit = 100, before?: number): EventHistoryRow[] {
    const d = this.db!
    if (before !== undefined) {
      return d.prepare(`
        SELECT * FROM event_history WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?
      `).all(before, limit) as EventHistoryRow[]
    }
    return d.prepare(`
      SELECT * FROM event_history ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as EventHistoryRow[]
  }

  getEventHistoryCount(): number {
    return (this.db!.prepare('SELECT COUNT(*) as c FROM event_history').get() as { c: number }).c
  }

  deleteOldEventHistory(days: number): number {
    if (days <= 0) return 0
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const result = this.db!.prepare('DELETE FROM event_history WHERE timestamp < ?').run(cutoff)
    return result.changes
  }

  // ==================== LLM 运行日志 ====================

  insertTrace(row: Omit<TraceRow, 'id'>): number {
    const result = this.db!.prepare(`
      INSERT INTO llm_trace (ts, source, reason, decision, events_count, system_prompt, user_prompt, model, response, tool_calls, outputs, silent_reason, error, duration_ms)
      VALUES (@ts, @source, @reason, @decision, @events_count, @system_prompt, @user_prompt, @model, @response, @tool_calls, @outputs, @silent_reason, @error, @duration_ms)
    `).run(row)
    return Number(result.lastInsertRowid)
  }

  getTraces(limit = 50, offset = 0, source?: string): TraceRow[] {
    const d = this.db!
    if (source) {
      return d.prepare(`
        SELECT * FROM llm_trace WHERE source = ? ORDER BY ts DESC LIMIT ? OFFSET ?
      `).all(source, limit, offset) as TraceRow[]
    }
    return d.prepare(`
      SELECT * FROM llm_trace ORDER BY ts DESC LIMIT ? OFFSET ?
    `).all(limit, offset) as TraceRow[]
  }

  getTraceCount(source?: string): number {
    if (source) {
      return (this.db!.prepare('SELECT COUNT(*) as c FROM llm_trace WHERE source = ?').get(source) as { c: number }).c
    }
    return (this.db!.prepare('SELECT COUNT(*) as c FROM llm_trace').get() as { c: number }).c
  }

  clearTraces(): void {
    this.db!.prepare('DELETE FROM llm_trace').run()
  }

  deleteOldTraces(days: number): number {
    if (days <= 0) return 0
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const result = this.db!.prepare('DELETE FROM llm_trace WHERE ts < ?').run(cutoff)
    return result.changes
  }

  // ==================== JSON → SQLite 迁移 ====================

  /** 旧 play-history.json → play_history 表；完成后重命名 .bak */
  migratePlayHistoryJson(jsonPath: string): number {
    if (!fs.existsSync(jsonPath)) return 0
    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8')
      const records = JSON.parse(raw) as Array<{
        id?: string; title?: string; artist?: string; source?: string; songId?: string
        duration?: number; cover?: string; userId?: string; userName?: string
        requestedAt?: number; startedAt?: number; endedAt?: number; status?: string
      }>
      if (!Array.isArray(records) || !records.length) return 0
      const insert = this.db!.prepare(`
        INSERT INTO play_history (queue_id, title, artist, source, song_id, duration, cover, user_id, user_name, requested_at, started_at, ended_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const tx = this.db!.transaction((rows: typeof records) => {
        for (const r of rows) {
          insert.run(
            String(r.id ?? ''), String(r.title ?? ''), String(r.artist ?? ''),
            String(r.source ?? ''), String(r.songId ?? ''), Number(r.duration ?? 0),
            String(r.cover ?? ''), String(r.userId ?? ''), String(r.userName ?? ''),
            Number(r.requestedAt ?? 0), Number(r.startedAt ?? 0),
            r.endedAt !== undefined ? Number(r.endedAt) : null,
            r.status ?? null,
          )
        }
      })
      tx(records)
      // 迁移完成，重命名原文件
      fs.renameSync(jsonPath, jsonPath + '.bak')
      console.log(`[database] 播放记录迁移完成：${records.length} 条 JSON → SQLite（原文件重命名为 .bak）`)
      return records.length
    } catch (err) {
      console.warn('[database] 播放记录 JSON 迁移失败（保留原文件）:', err)
      return 0
    }
  }
}
