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

// Manifest type for tracking generated files
interface Manifest {
  files: string[];      // Relative paths to all generated files
  directories: string[]; // Relative paths to all generated directories
}

async function updateDocsPublishedAt(namespace: string, publishedAtMap: Record<number, string>) {
  const filePath = path.join(config.metaDir, namespace, 'docs-published-at.json');
  await writeFile(filePath, publishedAtMap);
  logger.info(`Updated published timestamps for ${namespace}`);
}

// TODO: support inputs so only build the specified repos
export async function build(crawlResults?: Array<{ namespace: string; newDocsPublishedAtMap: Record<number, string> }>) {
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

  // Load previous manifest for cleanup comparison
  const oldManifest = await loadManifest();

  // Load previous doc-to-filepath mapping to detect renames
  const oldDocFilePaths = await loadDocFilePaths();

  // convert meta to tree
  const tree = await buildTree(repos);

  // Track current doc-to-filepath mapping for saving later
  const newDocFilePaths: Record<string, string> = {};

  // Track all generated files and directories for manifest
  const newManifestFiles = new Set<string>();
  const newManifestDirectories = new Set<string>();

  // travel tree to build docs
  const tasks: (() => Promise<void>)[] = [];
  for (const { node } of tree) {
    switch (node.type) {
      case 'TITLE':
        newManifestDirectories.add(node.filePath);
        tasks.push(() => mkdir(path.join(config.outputDir, node.filePath)));
        break;

      case 'UNCREATED_DOC':
        newManifestFiles.add(`${node.filePath}.md`);
        tasks.push(() => writeFile(path.join(config.outputDir, `${node.filePath}.md`), ''));
        break;

      case 'LINK':
        newManifestFiles.add(`${node.filePath}.md`);
        tasks.push(() => writeFile(path.join(config.outputDir, `${node.filePath}.md`), node.url));
        break;

      case 'DRAFT_DOC':
      case 'DOC':
        newManifestFiles.add(`${node.filePath}.md`);

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

  // Build new manifest
  const newManifest: Manifest = {
    files: Array.from(newManifestFiles).sort(),
    directories: Array.from(newManifestDirectories).sort(),
  };

  // Clean up deleted files by comparing manifests
  // Skip if --clean was used since directory was already emptied
  if (!config.clean && oldManifest) {
    logger.info('Cleaning up deleted files...');
    await cleanDeletedFiles(config.outputDir, oldManifest, newManifest);
  } else if (config.clean) {
    logger.info('Skipping deleted file cleanup (--clean was used)');
  }

  // Save the new manifest
  await saveManifest(newManifest);

  // Save the new doc-to-filepath mapping
  await saveDocFilePaths(newDocFilePaths);

  // Update published timestamps after build completes successfully
  if (crawlResults && crawlResults.length > 0) {
    logger.info('Updating published timestamps...');
    for (const result of crawlResults) {
      await updateDocsPublishedAt(result.namespace, result.newDocsPublishedAtMap);
    }
  }

  logger.info('Build completed.');
}

async function loadManifest(): Promise<Manifest | null> {
  const manifestPath = path.join(config.metaDir, 'manifest.json');
  try {
    return await readJSON(manifestPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // Manifest doesn't exist yet (first run)
      return null;
    }
    throw err;
  }
}

async function saveManifest(manifest: Manifest): Promise<void> {
  const manifestPath = path.join(config.metaDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  logger.info(`Saved manifest to ${manifestPath}`);
}

async function cleanDeletedFiles(outputDir: string, oldManifest: Manifest, newManifest: Manifest): Promise<void> {
  const oldFiles = new Set(oldManifest.files);
  const newFiles = new Set(newManifest.files);

  // Delete files that exist in old manifest but not in new manifest
  for (const file of oldFiles) {
    if (!newFiles.has(file)) {
      const fullPath = path.join(outputDir, file);
      if (await fs.pathExists(fullPath)) {
        logger.info(`Deleted: ${file}`);
        await fs.remove(fullPath);
      }
    }
  }

  // Clean up empty directories (from deep to shallow)
  await cleanEmptyDirectories(outputDir, oldManifest.directories, newManifest.directories);
}

async function cleanEmptyDirectories(
  outputDir: string,
  oldDirs: string[],
  newDirs: string[]
): Promise<void> {
  const oldDirSet = new Set(oldDirs);
  const newDirSet = new Set(newDirs);

  // Find directories that were in old manifest but not in new
  const deletedDirs = [...oldDirSet].filter(dir => !newDirSet.has(dir));

  // Sort by path depth descending (deeper paths first)
  deletedDirs.sort((a, b) => b.split('/').length - a.split('/').length);

  for (const dir of deletedDirs) {
    const fullPath = path.join(outputDir, dir);
    if (await fs.pathExists(fullPath)) {
      const contents = await fs.readdir(fullPath);
      if (contents.length === 0) {
        logger.info(`Deleted empty directory: ${dir}`);
        await fs.remove(fullPath);
      }
    }
  }

  // Also check parent directories of deleted files that might now be empty
  // Scan for any empty directories not in the new manifest
  const allDirs = await fg('**/', {
    cwd: outputDir,
    onlyDirectories: true,
    ignore: ['.meta/**', '.temp/**', 'assets/**'],
    dot: false,
  });

  // Sort by depth descending
  allDirs.sort((a, b) => b.split('/').length - a.split('/').length);

  for (const dir of allDirs) {
    // Remove trailing slash if present
    const cleanDir = dir.replace(/\/$/, '');
    if (!newDirSet.has(cleanDir)) {
      const fullPath = path.join(outputDir, cleanDir);
      if (await fs.pathExists(fullPath)) {
        const contents = await fs.readdir(fullPath);
        if (contents.length === 0) {
          logger.info(`Deleted empty directory: ${cleanDir}`);
          await fs.remove(fullPath);
        }
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
