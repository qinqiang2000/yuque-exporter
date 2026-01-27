import path from 'path';
import PQueue from 'p-queue';
import yaml from 'yaml';
import fg from 'fast-glob';

import { SDK } from './sdk.js';
import { logger, writeFile, readJSON } from './utils.js';
import { config } from '../config.js';

// Lazy initialize task queue based on config
let taskQueue: PQueue;
function getTaskQueue() {
  if (!taskQueue) {
    taskQueue = new PQueue({ concurrency: config.concurrency });
  }
  return taskQueue;
}

// Lazy initialize SDK to avoid requiring token during module import
let sdk: SDK;
function getSDK() {
  if (!sdk) {
    const { host, token, userAgent, timeout, maxRetries, retryDelay } = config;
    sdk = new SDK({ token, host, userAgent, timeout, maxRetries, retryDelay });
  }
  return sdk;
}

export async function crawl(inputs?: string[], updateTimestamps = false) {
  logger.info('Start crawling...');

  // if inputs is empty, crawl all repos of the user which associated with the token
  if (!inputs || inputs.length === 0) inputs = [ '' ];

  // find target repos
  const repoList = new Set<string>();
  for (const input of inputs) {
    const [ user, repo, extra ] = input.split('/');
    if (extra) {
      logger.warn(`invalid url paths: ${input}`);
      continue;
    } else if (repo) {
      // fetch a repo with namespace
      repoList.add(`${user}/${repo}`);
    } else {
      const userInfo = await getSDK().getUser(user);
      const login = userInfo.login;
      await saveToStorage(`${login}/user.json`, userInfo);

      // fetch all repos with user name
      const repos = await getSDK().getRepos(login);
      await saveToStorage(`${login}/repos.json`, repos);
      for (const repo of repos) {
        if (repo.type === 'Book') {
          repoList.add(repo.namespace);
        }
      }
    }
  }
  logger.info(`Find repos to crawl: ${[ '', ...repoList ].join('\n  - ')}\n`);

  // crawl repos
  const crawlResults = [];
  for (const namespace of repoList) {
    const result = await crawlRepo(namespace);
    crawlResults.push(result);

    // If running standalone crawl, update timestamps immediately
    if (updateTimestamps) {
      await saveToStorage(`${result.namespace}/docs-published-at.json`, result.newDocsPublishedAtMap);
    }
  }

  return crawlResults;
}

export async function crawlRepo(namespace: string) {
  // crawl repo detail/docs/toc
  const { host, metaDir } = config;
  logger.success(`Crawling repo detail: ${host}/${namespace}`);
  const repo = await getSDK().getRepoDetail(namespace);
  const toc = yaml.parse(repo.toc_yml);
  logger.info('Fetching document list...');
  const docList = await getSDK().getDocs(namespace, (loaded, total) => {
    process.stdout.write(`\r  Loading documents: ${loaded}/${total}`);
  });
  if (docList.length > 0) {
    process.stdout.write('\n'); // New line after progress
  }
  logger.success(`Loaded ${docList.length} documents`);
  const docsPublishedAtKey = 'docs-published-at';

  // Read the old published_at map BEFORE overwriting it
  const docsPublishedAtPath = await fg(`**/${namespace}/docs-published-at.json`, { cwd: metaDir, deep: 3 });
  let docsPublishedAtMap: Record<number, string> = {};
  if (docsPublishedAtPath.length > 0) {
    docsPublishedAtMap = await readJSON(path.join(metaDir, docsPublishedAtPath[0]));
  }

  await saveToStorage(`${namespace}/repo.json`, repo);
  await saveToStorage(`${namespace}/toc.json`, toc);
  await saveToStorage(`${namespace}/docs.json`, docList);

  // Create new timestamp map but don't persist yet (will be updated after build completes)
  const newDocsPublishedAtMap = Object.fromEntries(
    [ ...docList.entries() ].map(([ _index, doc ]) => [ doc.id, doc.published_at ]),
  );

  // crawl repo docs
  // throw new Error(JSON.stringify(docsPublishedAtMap));
  const docChangedList = docList
    .filter(doc => typeof docsPublishedAtMap[doc.id] === 'undefined' || docsPublishedAtMap[doc.id] !== doc.published_at);
  let docs = [];
  if (docChangedList.length) {
    logger.info(`Fetching ${docChangedList.length} changed documents with concurrency: ${config.concurrency}`);
    docs = await getTaskQueue().addAll(docChangedList.map(doc => {
      return async () => {
        logger.success(` - [${doc.title}](${host}/${namespace}/${doc.slug})`);
        const docDetail = await getSDK().getDocDetail(namespace, doc.slug);
        await saveToStorage(`${namespace}/docs/${doc.slug}.json`, docDetail);
      };
    }));
  } else {
    logger.info('Stop crawling, nothing new');
  }

  logger.log('');

  return { repo, toc, docList, docs, namespace, newDocsPublishedAtMap };
}

async function saveToStorage(filePath: string, content) {
  await writeFile(path.join(config.metaDir, filePath), content);
}
