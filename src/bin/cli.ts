#!/usr/bin/env node

// TODO: use yargs or artus-common-bin to refactor it


import { parseArgs } from 'util';
import fs from 'fs/promises';

import { config } from '../config.js';
import { build } from '../lib/builder.js';
import { crawl } from '../lib/crawler.js';
import { feishuCrawl } from '../lib/feishu-crawler.js';
import { feishuBuild } from '../lib/feishu-builder.js';
import { YuqueExporterError } from '../lib/errors.js';
import { logger } from '../lib/utils.js';

const options = {
  token: {
    type: 'string' as const,
    description: 'yuque token',
  },
  host: {
    type: 'string' as const,
    description: 'yuque host',
    default: 'https://www.yuque.com',
  },
  output: {
    type: 'string' as const,
    description: 'output target directory',
    default: './storage',
    short: 'o',
  },
  repo: {
    type: 'string' as const,
    description: 'custom repo directory name',
  },
  clean: {
    type: 'boolean' as const,
    description: 'Whether clean the output target directory',
    default: false,
  },
  'skip-draft': {
    type: 'boolean' as const,
    description: 'Skip draft and uncategorized documents',
    default: true,
  },
  cookie: {
    type: 'string' as const,
    description: 'yuque cookie for downloading attachments (can also use YUQUE_COOKIE env var)',
  },
  'feishu-app-id': {
    type: 'string' as const,
    description: 'feishu app id (can also use FEISHU_APP_ID env var)',
  },
  'feishu-app-secret': {
    type: 'string' as const,
    description: 'feishu app secret (can also use FEISHU_APP_SECRET env var)',
  },
  'feishu-cookie': {
    type: 'string' as const,
    description: 'feishu browser cookie for downloading attachments (can also use FEISHU_COOKIE env var)',
  },
  timeout: {
    type: 'string' as const,
    description: 'Request timeout in milliseconds',
  },
  concurrency: {
    type: 'string' as const,
    description: 'Number of concurrent requests',
    short: 'c',
  },
  'max-retries': {
    type: 'string' as const,
    description: 'Maximum number of retries on failure',
  },
  'retry-delay': {
    type: 'string' as const,
    description: 'Initial delay between retries in milliseconds',
  },
  help: {
    type: 'boolean' as const,
    description: 'Show help',
    short: 'h',
  },
};

const argv = parseArgs({
  options,
  allowPositionals: true,
  args: process.argv.slice(2),
});

if (argv.values.help) {
  const content = await fs.readFile(new URL('./help.md', import.meta.url), 'utf-8');
  console.log(content);
  process.exit(0);
}

console.log(argv);

// set config
const {
  output,
  repo,
  'skip-draft': skipDraft,
  timeout,
  concurrency,
  'max-retries': maxRetries,
  'retry-delay': retryDelay,
  cookie,
  'feishu-app-id': feishuAppId,
  'feishu-app-secret': feishuAppSecret,
  'feishu-cookie': feishuCookie,
  ...restValues
} = argv.values;

Object.assign(config, restValues, {
  outputDir: output || (argv.positionals[0] === 'feishu' ? './data/feishu' : config.outputDir),
  repoDir: repo,
  skipDraft: skipDraft,
  timeout: timeout ? parseInt(timeout, 10) : config.timeout,
  concurrency: concurrency ? parseInt(concurrency, 10) : config.concurrency,
  maxRetries: maxRetries ? parseInt(maxRetries, 10) : config.maxRetries,
  retryDelay: retryDelay ? parseInt(retryDelay, 10) : config.retryDelay,
  cookie: cookie || config.cookie,
  feishuAppId: feishuAppId || config.feishuAppId,
  feishuAppSecret: feishuAppSecret || config.feishuAppSecret,
  feishuCookie: feishuCookie || config.feishuCookie,
});

// execute command
try {
  const [ command, ...repos ] = argv.positionals;

  // validate yuque token only for yuque commands
  if (command !== 'feishu' && !config.token) {
    logger.error('Missing YUQUE_TOKEN');
    logger.info('Set it via: export YUQUE_TOKEN=your_token or use --token flag');
    logger.info('Get your token at: https://www.yuque.com/settings/tokens');
    process.exit(1);
  }

  switch (command) {
    case 'crawl': {
      await crawl(repos, true);
      break;
    }

    case 'build': {
      await build();
      break;
    }

    case 'feishu': {
      const [nodeToken] = repos;
      if (!nodeToken) {
        logger.error('Missing feishu wiki node token or URL');
        logger.info('Usage: feishu <node_token_or_url> -o <output_dir>');
        process.exit(1);
      }
      if (!config.feishuAppId || !config.feishuAppSecret) {
        logger.error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
        logger.info('Set via env vars or --feishu-app-id / --feishu-app-secret flags');
        process.exit(1);
      }
      // support full URL or bare token
      const token = nodeToken.includes('/wiki/') ? nodeToken.split('/wiki/')[1].split('?')[0] : nodeToken;
      const crawlResult = await feishuCrawl(token);
      await feishuBuild(crawlResult);
      break;
    }

    default: {
      const crawlResults = await crawl(argv.positionals, false);
      await build(crawlResults);
      break;
    }
  }
} catch (err) {
  if (err instanceof YuqueExporterError) {
    logger.error(err.message);
    if (err.suggestion) {
      logger.info(err.suggestion);
    }
  } else if (err instanceof Error) {
    logger.error(err.message);
  } else {
    logger.error(String(err));
  }
  process.exit(1);
}
