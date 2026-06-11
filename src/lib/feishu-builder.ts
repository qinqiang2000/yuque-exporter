import path from 'path';
import filenamify from 'filenamify';
import { FeishuSDK, WikiNode } from './feishu-sdk.js';
import { blocksToMarkdown } from './feishu-blocks-to-md.js';
import { writeFile, readJSON, exists, logger } from './utils.js';
import { config } from '../config.js';
import type { FeishuCrawlResult } from './feishu-crawler.js';
function getMetaDir() {
  return path.join(config.metaDir, 'feishu');
}

function getEditTimeMapPath(spaceId: string) {
  return path.join(getMetaDir(), `nodes-edit-time-${spaceId}.json`);
}

function getManifestPath(spaceId: string) {
  return path.join(getMetaDir(), `manifest-${spaceId}.json`);
}

async function loadOldEditTimeMap(spaceId: string): Promise<Record<string, string>> {
  const p = getEditTimeMapPath(spaceId);
  if (await exists(p)) return readJSON(p);
  return {};
}

async function loadOldManifest(spaceId: string): Promise<string[]> {
  const p = getManifestPath(spaceId);
  if (await exists(p)) return readJSON(p);
  return [];
}

function buildPathMap(nodes: WikiNode[]): Map<string, string> {
  const nodeMap = new Map<string, WikiNode>();
  for (const n of nodes) nodeMap.set(n.node_token, n);

  const pathMap = new Map<string, string>();
  const titleCountMap = new Map<string, number>();

  function getFilePath(node: WikiNode): string {
    if (pathMap.has(node.node_token)) return pathMap.get(node.node_token)!;

    const title = filenamify(node.title || 'untitled', { replacement: '_' });
    let filePath: string;

    if (!node.parent_node_token) {
      filePath = title;
    } else {
      const parent = nodeMap.get(node.parent_node_token);
      const parentPath = parent ? getFilePath(parent) : '';
      const key = `${node.parent_node_token}/${title}`;
      const count = titleCountMap.get(key) || 0;
      titleCountMap.set(key, count + 1);
      const name = count > 0 ? `${title}_${count}` : title;
      filePath = parentPath ? path.join(parentPath, name) : name;
    }

    pathMap.set(node.node_token, filePath);
    return filePath;
  }

  for (const node of nodes) getFilePath(node);
  return pathMap;
}

// download feishu://media/<token> images and attachments, replace with relative paths
async function downloadMediaInContent(
  content: string,
  docFilePath: string,
  sdk: FeishuSDK,
): Promise<string> {
  const mediaRegex = /!\[([^\]]*)\]\(feishu:\/\/media\/([^)]+)\)/g;
  const matches = [...content.matchAll(mediaRegex)];
  if (matches.length === 0) return content;

  const assetsDir = path.join(config.outputDir, 'assets', path.dirname(docFilePath));
  let result = content;

  for (const match of matches) {
    const [full, alt, mediaToken] = match;
    if (!mediaToken) continue;

    const destPathBase = path.join(assetsDir, mediaToken);

    try {
      // check if already downloaded with any extension
      const { readdir } = await import('fs/promises');
      let actualPath: string | undefined;
      try {
        const files = await readdir(assetsDir);
        const existing = files.find(f => f.startsWith(mediaToken + '.'));
        if (existing) actualPath = path.join(assetsDir, existing);
      } catch {
        // assetsDir doesn't exist yet, will be created on download
      }

      if (!actualPath) {
        actualPath = await sdk.downloadMedia(mediaToken, `${destPathBase}.png`);
      }

      const relPath = path.relative(
        path.join(config.outputDir, path.dirname(docFilePath)),
        actualPath,
      );
      result = result.replace(full, `![${alt}](${relPath})`);
    } catch (err: any) {
      logger.warn(`[Feishu] Failed to download media ${mediaToken}: ${err.message}`);
    }
  }

  return result;
}

// download feishu://file/<token>/<name> attachments, replace with relative paths
async function downloadFilesInContent(
  content: string,
  docFilePath: string,
  sdk: FeishuSDK,
): Promise<string> {
  const fileRegex = /\[([^\]]*)\]\(feishu:\/\/file\/([^/]+)\/([^)\s][^)]*)\)/g;
  const matches = [...content.matchAll(fileRegex)];
  if (matches.length === 0) return content;

  const assetsDir = path.join(config.outputDir, 'assets', path.dirname(docFilePath));
  let result = content;

  for (const match of matches) {
    const [full, , fileToken, encodedName] = match;
    if (!fileToken) continue;
    const fileName = decodeURIComponent(encodedName);
    const destPath = path.join(assetsDir, fileName);

    try {
      if (!await exists(destPath)) {
        if (config.feishuCookie) {
          await sdk.downloadFileWithCookie(fileToken, destPath, config.feishuCookie);
        } else {
          await sdk.downloadFile(fileToken, destPath);
        }
      }
      const relPath = path.relative(
        path.join(config.outputDir, path.dirname(docFilePath)),
        destPath,
      );
      result = result.replace(full, `[${fileName}](${relPath})`);
    } catch (err: any) {
      logger.warn(`[Feishu] Failed to download file ${fileToken} (${fileName}): ${err.message}`);
    }
  }

  return result;
}

export async function feishuBuild(crawlResult: FeishuCrawlResult): Promise<void> {
  const { nodes, newEditTimeMap, spaceName, spaceId } = crawlResult;
  const oldEditTimeMap = await loadOldEditTimeMap(spaceId);
  const oldManifest = await loadOldManifest(spaceId);

  const sdk = new FeishuSDK({ appId: config.feishuAppId, appSecret: config.feishuAppSecret });
  await sdk.authorize();

  const spaceDir = filenamify(spaceName, { replacement: '_' });
  const pathMap = buildPathMap(nodes);
  const newManifest: string[] = [];

  for (const node of nodes) {
    const nodeFilePath = pathMap.get(node.node_token);
    if (!nodeFilePath) continue;

    if (node.obj_type !== 'docx' && node.obj_type !== 'doc') continue;

    const filePath = path.join(spaceDir, nodeFilePath);
    const mdPath = path.join(config.outputDir, `${filePath}.md`);
    newManifest.push(`${filePath}.md`);

    // skip if unchanged and file exists
    if (
      oldEditTimeMap[node.node_token] === node.obj_edit_time &&
      await exists(mdPath)
    ) {
      logger.info(`[Feishu] Skipping unchanged: ${node.title}`);
      continue;
    }

    const blocksPath = path.join(getMetaDir(), 'docs', `${node.node_token}.json`);
    if (!await exists(blocksPath)) {
      logger.warn(`[Feishu] Blocks not found for: ${node.title}, skipping`);
      continue;
    }

    const blocks = await readJSON(blocksPath);
    let markdown = blocksToMarkdown(blocks);

    // download images and attachments
    markdown = await downloadMediaInContent(markdown, filePath, sdk);
    markdown = await downloadFilesInContent(markdown, filePath, sdk);

    const feishuUrl = node.url || `https://icn1dae2f6c3.feishu.cn/wiki/${node.node_token}`;
    const content = `[${node.title}](${feishuUrl})\n---\n\n${markdown}\n`;

    await writeFile(mdPath, content);
    logger.info(`[Feishu] Built: ${filePath}.md`);
  }

  // delete files removed from wiki
  const newManifestSet = new Set(newManifest);
  for (const oldFile of oldManifest) {
    if (!newManifestSet.has(oldFile)) {
      const fullPath = path.join(config.outputDir, oldFile);
      if (await exists(fullPath)) {
        const { rm } = await import('./utils.js');
        await rm(fullPath);
        logger.info(`[Feishu] Deleted: ${oldFile}`);
      }
    }
  }

  // save manifest and edit time map
  await writeFile(getManifestPath(spaceId), newManifest);
  await writeFile(getEditTimeMapPath(spaceId), newEditTimeMap);

  logger.info(`[Feishu] Build complete. ${newManifest.length} files.`);
}
