import path from 'path';

import type { Link, Text } from 'mdast';
import { remark } from 'remark';
import { selectAll } from 'unist-util-select';
import yaml from 'yaml';
import fg from 'fast-glob';

import { TreeNode } from './types.js';
import { readJSON, download, getRedirectLink, logger, exists } from './utils.js';
import { config } from '../config.js';

interface LakesheetData {
  version: string;
  data: {
    id: string;
    name: string;
    rowCount: number;
    colCount: number;
    table: string[][];
  }[];
}

function convertLakesheetToMarkdown(bodySheet: string): string {
  try {
    const sheetData: LakesheetData = JSON.parse(bodySheet);

    if (!sheetData.data || sheetData.data.length === 0) {
      return '';
    }

    // Convert each sheet to markdown
    const markdownSections = sheetData.data.map(sheet => {
      if (!sheet.table || sheet.table.length === 0) {
        return '';
      }

      const lines: string[] = [];

      // Add sheet name if there are multiple sheets
      if (sheetData.data.length > 1) {
        lines.push(`## ${sheet.name}\n`);
      }

      // Generate markdown table
      sheet.table.forEach((row, rowIndex) => {
        // Escape pipe characters in cells and handle empty cells
        const cells = row.map(cell => (cell || '').replace(/\|/g, '\\|'));
        lines.push(`| ${cells.join(' | ')} |`);

        // Add separator after first row (header row)
        if (rowIndex === 0) {
          const separator = row.map(() => '---');
          lines.push(`| ${separator.join(' | ')} |`);
        }
      });

      return lines.join('\n');
    });

    return markdownSections.filter(s => s).join('\n\n');
  } catch (error) {
    logger.warn(`[WARN] Failed to parse lakesheet data: ${error.message}`);
    return '';
  }
}

// Lazy load the published dates map to avoid errors when metadata doesn't exist yet
let docsPublishedAtMap: Record<number, string> = {};
async function loadDocsPublishedAtMap() {
  if (Object.keys(docsPublishedAtMap).length > 0) return;
  const docsPublishedAtPath = await fg('**/docs-published-at.json', { cwd: config.metaDir, deep: 3 });
  if (docsPublishedAtPath.length > 0) {
    const fullPath = path.join(config.metaDir, docsPublishedAtPath[0]);
    logger.info(`[DEBUG] Loading published-at map from: ${fullPath}`);
    docsPublishedAtMap = await readJSON(fullPath);
    logger.info(`[DEBUG] Loaded ${Object.keys(docsPublishedAtMap).length} entries`);
  } else {
    logger.warn('[DEBUG] No docs-published-at.json found!');
  }
}

interface Options {
  doc: TreeNode;
  mapping: Record<string, TreeNode>;
}

export async function buildDoc(doc: TreeNode, mapping: Record<string, TreeNode>) {
  await loadDocsPublishedAtMap();
  const docPath = path.join(config.metaDir, doc.namespace, 'docs', `${doc.url}.json`);

  // Handle missing doc files gracefully (e.g., deleted docs still in TOC, or no access)
  let docDetail;
  try {
    docDetail = await readJSON(docPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      logger.warn(`[WARN] Doc file not found: ${docPath}, skipping...`);
      return null;
    }
    throw err;
  }

  // Only skip if published_at unchanged AND the markdown file already exists
  const cachedPublishedAt = docsPublishedAtMap[docDetail.id];
  const currentPublishedAt = docDetail.published_at;
  const publishedAtMatches = typeof cachedPublishedAt !== 'undefined' && cachedPublishedAt === currentPublishedAt;

  if (publishedAtMatches) {
    const mdPath = path.join(config.outputDir, `${doc.filePath}.md`);
    if (await exists(mdPath)) {
      // File exists and hasn't changed, skip rebuilding
      logger.info(`Skipping unchanged: ${doc.title}`);
      return null;
    }
  }
  // Handle different document formats
  let bodyContent = '';

  // Check if it's a lakesheet (table) document
  if (docDetail.format === 'lakesheet' && docDetail.body_sheet) {
    bodyContent = convertLakesheetToMarkdown(docDetail.body_sheet);
  } else {
    // Handle regular documents
    bodyContent = docDetail.body || docDetail.body_lake || '';

    // Warn about empty documents
    if (!bodyContent) {
      logger.warn(`[WARN] Document "${doc.title}" (${doc.url}) has no content. Format: ${docDetail.format}`);
    }
  }

  const content = await remark()
    .data('settings', { bullet: '-', listItemIndent: 'one' })
    .use([
      [ replaceHTML ],
      [ relativeLink, { doc, mapping }],
      [ downloadAsset, { doc, mapping }],
    ])
    .process(bodyContent);

  doc.content = frontmatter(doc) + content.toString();

  // FIXME: remark will transform `*` to `\*`
  doc.content = doc.content.replaceAll('\\*', '*');

  // Remove <font> tags (including escaped \<font>) but keep the text content
  doc.content = doc.content.replace(/\\?<font[^>]*>([\s\S]*?)<\/font>/gi, '$1');

  // Skip empty documents that have children (directory-like docs)
  // These docs serve as folders in Yuque and their .md files are not meaningful
  if (doc.children && doc.children.length > 0) {
    const contentWithoutFrontmatter = doc.content.replace(/^---[\s\S]*?---\s*/m, '').trim();
    // Consider a doc "empty" if it has less than 50 characters of actual content
    if (!contentWithoutFrontmatter || contentWithoutFrontmatter.length < 50) {
      logger.info(`[INFO] Skipping empty directory-document: ${doc.title} (has ${doc.children.length} children)`);
      return null;
    }
  }

  return doc;
}

function frontmatter(doc) {
  const frontMatter = yaml.stringify({
    title: doc.title,
    url: `${config.host}/${doc.namespace}/${doc.url}`,
    // slug: doc.slug,
    // public: doc.public,
    // status: doc.status,
    // description: doc.description,
  });
  return `---\n${frontMatter}---\n\n`;
}

function replaceHTML() {
  return tree => {
    const htmlNodes = selectAll('html', tree) as Text[];
    for (const node of htmlNodes) {
      if (node.value === '<br />' || node.value === '<br/>') {
        node.type = 'text';
        node.value = '\n';
      }
    }
  };
}

function relativeLink({ doc, mapping }: Options) {
  return async tree => {
    const links = selectAll('link', tree) as Link[];
    for (const node of links) {
      if (!isYuqueDocLink(node.url)) continue;

      // 语雀分享链接功能已下线，替换为 302 后的地址
      if (node.url.startsWith(`${config.host}/docs/share/`)) {
        node.url = await getRedirectLink(node.url, config.host);
      }

      // 语雀链接有多种显示方式，其中一种会插入该参数，会导致点击后的页面缺少头部导航
      node.url = node.url.replace('view=doc_embed', '');

      const { pathname } = new URL(node.url);
      const targetNode = mapping[pathname.substring(1)];
      if (!targetNode) {
        console.warn(`[WARN] ${node.url}, ${pathname.substring(1)} not found`);
      } else {
        node.url = path.relative(path.dirname(doc.filePath), targetNode.filePath) + '.md';
      }
    }
  };
}

function isYuqueDocLink(url?: string) {
  if (!url) return false;
  if (!url.startsWith(config.host)) return false;
  if (url.startsWith(config.host + '/attachments/')) return false;
  return true;
}

function downloadAsset(opts: Options) {
  return async tree => {
    const docFilePath = opts.doc.filePath;
    // Place all assets in the root 'assets' directory for centralized access
    const assetsDir = 'assets';

    // FIXME: 语雀附件现在不允许直接访问，需要登录后才能下载，这里先跳过。
    // const assetNodes = selectAll(`image[url^=http], link[url^=${host}/attachments/]`, tree) as Link[];
    const assetNodes = selectAll('image[url^=http]', tree) as Link[];
    for (const node of assetNodes) {
      const assetName = `${opts.doc.url}/${new URL(node.url).pathname.split('/').pop()}`;
      const filePath = path.join(assetsDir, assetName);
      await download(node.url, path.join(config.outputDir, filePath), { headers: { 'User-Agent': config.userAgent } });
      node.url = path.relative(path.dirname(docFilePath), filePath);
    }
  };
}
