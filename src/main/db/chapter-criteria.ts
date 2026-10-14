import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { chapterCriterionSchema, criterionLibrarySchema, saveCriterionInputSchema, criterionIdentitySchema, selectCriterionInputSchema, type ChapterCriterion, type CriterionLibrary } from '../../shared/chapter-export-contracts';
import type { ChapterCriterionSnapshot } from '../../shared/chapter-contracts';
import { AppError } from '../lib/errors';

const rowSchema = z.object({ payload: z.string() });
export class ChapterCriteriaRepository {
  constructor(private readonly sqlite: Database.Database) {
    sqlite.transaction(() => {
      const marker = sqlite.prepare('SELECT value FROM chapter_settings WHERE key=?').get('seeded');
      if (marker) return;
      for (const [name, instructions] of [
        ['核心信息', '选取核心论点、重要解释、结论和有实际价值的信息。省略寒暄、重复和无内容的等待。每段应保留理解所需上下文。'],
        ['有趣内容', '选取幽默、有趣、出人意料的交流和故事，保留必要铺垫与结果；省略沉默、重复和普通寒暄。'],
        ['精彩片段', '选取精彩表现、情绪高潮、关键转折与值得分享的片段，保留事件完整性，避免孤立断句。'],
      ]) this.insert(name ?? '', instructions ?? '');
      sqlite.prepare('INSERT INTO chapter_settings(key,value) VALUES (?,?)').run('seeded', '1');
    })();
  }
  private insert(name: string, instructions: string): ChapterCriterion {
    const item = chapterCriterionSchema.parse({ id: randomUUID(), revision: 1, name, instructions, createdAt: Date.now(), updatedAt: Date.now() });
    this.sqlite.prepare('INSERT INTO chapter_criteria(id,payload) VALUES (?,?)').run(item.id, JSON.stringify(item));
    return item;
  }
  list(): CriterionLibrary {
    const items = this.sqlite.prepare('SELECT payload FROM chapter_criteria ORDER BY rowid').all().map((row) => chapterCriterionSchema.parse(JSON.parse(rowSchema.parse(row).payload)));
    const selected = this.sqlite.prepare('SELECT value FROM chapter_settings WHERE key=?').get('selected');
    const selectedId = selected ? z.object({ value: z.string() }).parse(selected).value : undefined;
    return criterionLibrarySchema.parse({ items, selectedId: items.some((item) => item.id === selectedId) ? selectedId : undefined });
  }
  snapshot(id: string): ChapterCriterionSnapshot {
    const item = this.list().items.find((entry) => entry.id === id);
    if (!item) throw new AppError('CRITERION_MISSING', '请选择有效的自定义切分标准');
    const { createdAt: _created, updatedAt: _updated, ...snapshot } = item;
    return snapshot;
  }
  save(raw: unknown): CriterionLibrary {
    const input = saveCriterionInputSchema.parse(raw);
    this.sqlite.transaction(() => {
      if (!input.id) {
        if (input.revision !== undefined) throw new AppError('CRITERION_INVALID', '新标准不能包含旧版本');
        if (this.list().items.length >= 100) throw new AppError('CRITERION_LIMIT', '最多保存 100 个切分标准');
        this.insert(input.name, input.instructions);
      } else {
        const current = this.snapshot(input.id);
        if (current.revision !== input.revision) throw new AppError('STALE_REVISION', '标准已变化，请重新打开后编辑');
        const full = this.list().items.find((item) => item.id === input.id);
        if (!full) throw new AppError('CRITERION_MISSING', '标准已删除');
        const item = { ...full, name: input.name, instructions: input.instructions, revision: current.revision + 1, updatedAt: Date.now() };
        this.sqlite.prepare('UPDATE chapter_criteria SET payload=? WHERE id=?').run(JSON.stringify(item), input.id);
      }
    })();
    return this.list();
  }
  copy(raw: unknown): CriterionLibrary {
    const input = criterionIdentitySchema.parse(raw);
    const current = this.snapshot(input.id);
    if (current.revision !== input.revision) throw new AppError('STALE_REVISION', '标准已变化，请刷新');
    return this.save({ name: `${current.name.slice(0, 115)} 副本`, instructions: current.instructions });
  }
  remove(raw: unknown): CriterionLibrary {
    const input = criterionIdentitySchema.parse(raw);
    this.sqlite.transaction(() => {
      if (this.snapshot(input.id).revision !== input.revision) throw new AppError('STALE_REVISION', '标准已变化，请刷新');
      this.sqlite.prepare('DELETE FROM chapter_criteria WHERE id=?').run(input.id);
      const selected = this.list().selectedId;
      if (!selected) this.sqlite.prepare('DELETE FROM chapter_settings WHERE key=?').run('selected');
    })();
    return this.list();
  }
  select(raw: unknown): CriterionLibrary {
    const input = selectCriterionInputSchema.parse(raw);
    if (input.id) {
      this.snapshot(input.id);
      this.sqlite.prepare('INSERT INTO chapter_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('selected', input.id);
    } else this.sqlite.prepare('DELETE FROM chapter_settings WHERE key=?').run('selected');
    return this.list();
  }
}
