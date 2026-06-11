import type { Block, BlockElement } from './feishu-sdk.js';

// block_type 常量
const BLOCK_TYPE = {
  PAGE: 1,
  TEXT: 2,
  HEADING1: 3,
  HEADING2: 4,
  HEADING3: 5,
  HEADING4: 6,
  HEADING5: 7,
  HEADING6: 8,
  HEADING7: 9,
  HEADING8: 10,
  HEADING9: 11,
  BULLET: 12,
  ORDERED: 13,
  CODE: 14,
  QUOTE: 15,
  TODO: 17,
  DIVIDER: 22,
  FILE: 23,
  IMAGE: 27,
  TABLE: 31,
  TABLE_CELL: 32,
  CALLOUT: 41,
};

const CODE_LANGUAGE: Record<number, string> = {
  1: 'abap', 2: 'ada', 3: 'apache', 4: 'apex', 5: 'apiblueprint',
  6: 'applescript', 7: 'bash', 8: 'clike', 9: 'c', 10: 'csharp',
  11: 'cpp', 12: 'coffeescript', 13: 'css', 14: 'dart', 15: 'diff',
  16: 'django', 17: 'dockerfile', 18: 'erlang', 19: 'fortran', 20: 'fsharp',
  21: 'go', 22: 'groovy', 23: 'html', 24: 'htmlbars', 25: 'http',
  26: 'haskell', 27: 'json', 28: 'java', 29: 'javascript', 30: 'julia',
  31: 'kotlin', 32: 'latex', 33: 'lisp', 34: 'logo', 35: 'lua',
  36: 'matlab', 37: 'makefile', 38: 'markdown', 39: 'nginx', 40: 'objectivec',
  41: 'ocaml', 42: 'php', 43: 'perl', 44: 'powershell', 45: 'prolog',
  46: 'protobuf', 47: 'python', 48: 'r', 49: 'ruby', 50: 'rust',
  51: 'scala', 52: 'scss', 53: 'shell', 54: 'sql', 55: 'swift',
  56: 'typescript', 57: 'thrift', 58: 'toml', 59: 'vbscript', 60: 'visualbasic',
  61: 'xml', 62: 'yaml', 63: 'java', 64: 'csharp', 65: 'c',
};

function renderElements(elements: BlockElement[]): string {
  return elements.map(el => {
    if (el.mention_doc) {
      return `[${el.mention_doc.title}](${el.mention_doc.url})`;
    }
    if (!el.text_run) return '';
    const { content, text_element_style: s } = el.text_run;
    if (!content) return '';
    let text = content;
    if (s.inline_code) return `\`${text}\``;
    if (s.link?.url) {
      const url = decodeURIComponent(s.link.url);
      text = `[${text}](${url})`;
    }
    if (s.bold) text = `**${text}**`;
    if (s.italic) text = `*${text}*`;
    if (s.strikethrough) text = `~~${text}~~`;
    return text;
  }).join('');
}

function renderHeading(block: Block, level: number): string {
  const key = `heading${level}` as keyof Block;
  const data = block[key] as { elements: BlockElement[] } | undefined;
  if (!data) return '';
  return `${'#'.repeat(level)} ${renderElements(data.elements)}\n\n`;
}

export function blocksToMarkdown(blocks: Block[]): string {
  const blockMap = new Map<string, Block>();
  for (const b of blocks) blockMap.set(b.block_id, b);

  const rendered = new Set<string>();
  const lines: string[] = [];

  function renderBlock(block: Block, indent = 0): void {
    if (rendered.has(block.block_id)) return;
    rendered.add(block.block_id);

    const prefix = '  '.repeat(indent);

    switch (block.block_type) {
      case BLOCK_TYPE.PAGE:
        // skip page title, render children
        break;

      case BLOCK_TYPE.TEXT: {
        const text = renderElements(block.text?.elements || []);
        lines.push(text ? `${prefix}${text}\n` : '');
        break;
      }

      case BLOCK_TYPE.HEADING1: lines.push(renderHeading(block, 1)); break;
      case BLOCK_TYPE.HEADING2: lines.push(renderHeading(block, 2)); break;
      case BLOCK_TYPE.HEADING3: lines.push(renderHeading(block, 3)); break;
      case BLOCK_TYPE.HEADING4: lines.push(renderHeading(block, 4)); break;
      case BLOCK_TYPE.HEADING5: lines.push(renderHeading(block, 5)); break;
      case BLOCK_TYPE.HEADING6: lines.push(renderHeading(block, 6)); break;
      case BLOCK_TYPE.HEADING7: lines.push(renderHeading(block, 7)); break;
      case BLOCK_TYPE.HEADING8: lines.push(renderHeading(block, 8)); break;
      case BLOCK_TYPE.HEADING9: lines.push(renderHeading(block, 9)); break;

      case BLOCK_TYPE.BULLET: {
        const text = renderElements(block.bullet?.elements || []);
        lines.push(`${prefix}- ${text}`);
        if (block.children?.length) {
          for (const childId of block.children) {
            const child = blockMap.get(childId);
            if (child) renderBlock(child, indent + 1);
          }
        }
        if (indent === 0) lines.push('');
        return; // children already handled
      }

      case BLOCK_TYPE.ORDERED: {
        const text = renderElements(block.ordered?.elements || []);
        lines.push(`${prefix}1. ${text}`);
        if (block.children?.length) {
          for (const childId of block.children) {
            const child = blockMap.get(childId);
            if (child) renderBlock(child, indent + 1);
          }
        }
        if (indent === 0) lines.push('');
        return;
      }

      case BLOCK_TYPE.CODE: {
        const lang = CODE_LANGUAGE[block.code?.style?.language || 0] || '';
        const text = renderElements(block.code?.elements || []);
        lines.push(`\`\`\`${lang}\n${text}\n\`\`\`\n`);
        break;
      }

      case BLOCK_TYPE.QUOTE: {
        const text = renderElements(block.quote?.elements || []);
        lines.push(`> ${text}\n`);
        break;
      }

      case BLOCK_TYPE.TODO: {
        const text = renderElements(block.todo?.elements || []);
        const check = block.todo?.done ? '[x]' : '[ ]';
        lines.push(`- ${check} ${text}`);
        if (indent === 0) lines.push('');
        break;
      }

      case BLOCK_TYPE.DIVIDER:
        lines.push('---\n');
        break;

      case BLOCK_TYPE.IMAGE:
        if (block.image?.token) {
          lines.push(`![image](feishu://media/${block.image.token})\n`);
        }
        break;

      case BLOCK_TYPE.FILE:
        if (block.file?.token) {
          const name = block.file.name || block.file.token;
          lines.push(`[${name}](feishu://file/${block.file.token}/${encodeURIComponent(name)})\n`);
        }
        break;

      case BLOCK_TYPE.CALLOUT: {
        // render children into a temporary buffer, then prefix each line with >
        const savedLength = lines.length;
        if (block.children?.length) {
          for (const childId of block.children) {
            const child = blockMap.get(childId);
            if (child) renderBlock(child, indent);
          }
        }
        const childLines = lines.splice(savedLength);
        const quoted = childLines.map(l => l ? `> ${l}` : '>').join('\n');
        if (quoted) lines.push(quoted + '\n');
        return;
      }

      case BLOCK_TYPE.TABLE:
      case BLOCK_TYPE.TABLE_CELL:
        // tables handled separately via renderTable
        return;

      default:
        break;
    }

    // render children (except bullet/ordered which handle their own children)
    if (block.children?.length && block.block_type !== BLOCK_TYPE.BULLET && block.block_type !== BLOCK_TYPE.ORDERED) {
      // check if this is a table
      if (block.block_type === BLOCK_TYPE.TABLE) {
        renderTable(block, blockMap, lines);
        for (const childId of block.children) rendered.add(childId);
      } else {
        for (const childId of block.children) {
          const child = blockMap.get(childId);
          if (child) renderBlock(child, indent);
        }
      }
    }
  }

  // find root (page block)
  const root = blocks.find(b => b.block_type === BLOCK_TYPE.PAGE);
  if (!root) return '';

  // render children of page block
  for (const childId of root.children || []) {
    const child = blockMap.get(childId);
    if (child) renderBlock(child);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderTable(tableBlock: Block, blockMap: Map<string, Block>, lines: string[]): void {
  const { row_size, column_size } = tableBlock.table?.property || { row_size: 0, column_size: 0 };
  if (!row_size || !column_size) return;

  const cellIds = tableBlock.table?.cells || [];
  const rows: string[][] = [];

  for (let r = 0; r < row_size; r++) {
    const row: string[] = [];
    for (let c = 0; c < column_size; c++) {
      const cellId = cellIds[r * column_size + c];
      const cell = blockMap.get(cellId);
      if (!cell) { row.push(''); continue; }
      // collect text from cell's children
      const cellText = (cell.children || []).map(childId => {
        const child = blockMap.get(childId);
        if (!child) return '';
        const textBlock = child.text || child.heading1 || child.heading2 || child.heading3;
        return textBlock ? renderElements(textBlock.elements) : '';
      }).filter(Boolean).join(' ');
      row.push(cellText.replace(/\|/g, '\\|'));
    }
    rows.push(row);
  }

  if (rows.length === 0) return;

  lines.push(`| ${rows[0].join(' | ')} |`);
  lines.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
  for (let r = 1; r < rows.length; r++) {
    lines.push(`| ${rows[r].join(' | ')} |`);
  }
  lines.push('');
}
