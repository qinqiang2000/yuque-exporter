import path from 'path';
import PQueue from 'p-queue';
import fg from 'fast-glob';
import fs from 'fs-extra';

import type { Repository, TreeNode } from './types.js';
import { logger, mkdir, readJSON, writeFile } from './utils.js';
import { buildDoc } from './doc.js';
import { buildTree } from './tree.js';
import { config } from '../config.js';

const taskQueue = new PQueue({ concurrency: 10 });

// TODO: support inputs so only build the specified repos
export async function build() {
  logger.info('Start building...');

  // Clean output directory if requested (but preserve .meta directory)
  if (config.clean) {
    logger.info(`Cleaning output directory: ${config.outputDir}`);
    const items = await fs.readdir(config.outputDir).catch(() => []);
    for (const item of items) {
      // Skip .meta directory
      if (item === '.meta') continue;
      const itemPath = path.join(config.outputDir, item);
      await fs.remove(itemPath);
      logger.info(`  Removed: ${item}`);
    }
  }

  const repos = await listRepos();
  if (repos.length === 0) {
    logger.warn(`No repos found at ${config.metaDir}`);
    return;
  }

  // Load previous doc-to-filepath mapping to detect renames
  const oldDocFilePaths = await loadDocFilePaths();

  // convert meta to tree
  const tree = await buildTree(repos);

  // Track current doc-to-filepath mapping for saving later
  const newDocFilePaths: Record<string, string> = {};

  // Track all expected file paths for orphan cleanup
  const expectedPaths = new Set<string>();

  // travel tree to build docs
  const tasks: (() => Promise<void>)[] = [];
  for (const { node } of tree) {
    const fullPath = path.join(config.outputDir, node.filePath);

    switch (node.type) {
      case 'TITLE':
        expectedPaths.add(fullPath);
        tasks.push(() => mkdir(fullPath));
        break;

      case 'UNCREATED_DOC':
        expectedPaths.add(`${fullPath}.md`);
        tasks.push(() => writeFile(`${fullPath}.md`, ''));
        break;

      case 'LINK':
        expectedPaths.add(`${fullPath}.md`);
        tasks.push(() => writeFile(`${fullPath}.md`, node.url));
        break;

      case 'DRAFT_DOC':
      case 'DOC':
        expectedPaths.add(`${fullPath}.md`);
        // Also track assets directory for this doc (centralized in root)
        const assetsDir = path.join(config.outputDir, 'assets', node.url);
        expectedPaths.add(assetsDir);

        // Track doc ID to filepath mapping for rename detection
        const docKey = `${node.namespace}/${node.url}`;
        newDocFilePaths[docKey] = `${node.filePath}.md`;

        // Check if this doc was renamed (filepath changed but same doc ID)
        const oldFilePath = oldDocFilePaths[docKey];
        if (oldFilePath && oldFilePath !== `${node.filePath}.md`) {
          const oldFullPath = path.join(config.outputDir, oldFilePath);
          tasks.push(async () => {
            if (await fs.pathExists(oldFullPath)) {
              logger.info(`Removing renamed file: ${oldFullPath}`);
              await fs.remove(oldFullPath);
            }
          });
        }

        tasks.push(async () => {
          const doc = await buildDoc(node, tree.docs);
          if (doc !== null) {
            const docFullPath = path.join(config.outputDir, `${doc.filePath}.md`);
            logger.success(`Building doc: ${docFullPath}`);
            await writeFile(docFullPath, doc.content);
          }
        });
        break;

      case 'REPO':
      default:
        break;
    }
  }

  // TODO: only warn when error
  await taskQueue.addAll(tasks);

  // Clean up orphaned files (files that exist but are not in expectedPaths)
  // Skip if --clean was used since directory was already emptied
  if (!config.clean) {
    logger.info('Cleaning up orphaned files...');
    await cleanOrphanedFiles(config.outputDir, expectedPaths);
  } else {
    logger.info('Skipping orphaned file cleanup (--clean was used)');
  }

  // Save the new doc-to-filepath mapping
  await saveDocFilePaths(newDocFilePaths);

  logger.info('Build completed.');
}

async function cleanOrphanedFiles(outputDir: string, expectedPaths: Set<string>) {
  // Find all files and directories in output (excluding .meta and assets)
  const allFiles = await fg('**/*', {
    cwd: outputDir,
    onlyFiles: false,
    ignore: ['.meta/**', '.temp/**'],
    dot: false,
    markDirectories: true,
  });

  // Sort by path length descending so we process deeper paths first
  // This ensures we can delete empty directories after their contents
  allFiles.sort((a, b) => b.length - a.length);

  for (const relativePath of allFiles) {
    const fullPath = path.join(outputDir, relativePath);

    // Skip if this path or any parent is expected
    let isExpected = false;
    for (const expected of expectedPaths) {
      if (fullPath === expected || fullPath.startsWith(expected + '/') || expected.startsWith(fullPath + '/')) {
        isExpected = true;
        break;
      }
    }

    // Skip assets directories (they are managed by doc building)
    // Check both subdirectory assets (xxx/assets/) and root assets (assets/)
    if (relativePath.includes('/assets/') || relativePath.startsWith('assets/')) {
      continue;
    }

    if (!isExpected) {
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;

      if (stat.isDirectory()) {
        // Only delete empty directories
        const contents = await fs.readdir(fullPath);
        if (contents.length === 0) {
          logger.info(`Deleting orphaned directory: ${fullPath}`);
          await fs.remove(fullPath);
        }
      } else {
        logger.info(`Deleting orphaned file: ${fullPath}`);
        await fs.remove(fullPath);
      }
    }
  }
}

async function listRepos(): Promise<Repository[]> {
  const repos = [];
  const reposPath = await fg('**/repo.json', { cwd: config.metaDir, deep: 3 });
  for (const repoPath of reposPath) {
    const repoInfo: Repository = await readJSON(path.join(config.metaDir, repoPath));
    if (repoInfo.type === 'Book') {
      repos.push(repoInfo);
    }
  }
  return repos;
}

async function loadDocFilePaths(): Promise<Record<string, string>> {
  const mappingPath = path.join(config.metaDir, 'docs-filepath.json');
  try {
    return await readJSON(mappingPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet, return empty mapping
      return {};
    }
    throw err;
  }
}

async function saveDocFilePaths(mapping: Record<string, string>): Promise<void> {
  const mappingPath = path.join(config.metaDir, 'docs-filepath.json');
  await writeFile(mappingPath, JSON.stringify(mapping, null, 2));
  logger.info(`Saved doc-filepath mapping to ${mappingPath}`);
}
