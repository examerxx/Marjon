// Переупорядочивание блоков чека: чистая утилита без сетевых вызовов.
// Общая для настроек клиентского чека и кухонного чека (2 потребителя).
// Поведение сохранено байт-в-байт из прежних локальных копий в страницах.
export function moveBlock(blocks, block, direction) {
  const index = blocks.indexOf(block);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= blocks.length) return blocks;
  const next = [...blocks];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

// Единый источник порядка блоков для редактора И для превью/ESC-POS: берём
// сохранённый порядок (template.blocks), оставляя только известные ключи в их
// сохранённой последовательности, затем дописываем любые канонические блоки,
// которых нет в сохранённом порядке (частичный/устаревший шаблон не теряет
// известные блоки). Неизвестные ключи будущих версий безопасно игнорируются.
export function orderedBlocks(blocks, canonical) {
  const known = new Set(canonical);
  const seen = new Set();
  const result = [];
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (known.has(block) && !seen.has(block)) {
        result.push(block);
        seen.add(block);
      }
    }
  }
  for (const block of canonical) {
    if (!seen.has(block)) result.push(block);
  }
  return result;
}
