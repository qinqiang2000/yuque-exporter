import path from 'path';

export const config = {
  host: 'https://www.yuque.com',
  token: process.env.YUQUE_TOKEN,
  userAgent: 'yuque-exporter',
  outputDir: './storage',
  repoDir: undefined as string | undefined,
  clean: false,
  skipDraft: true,
  get metaDir() {
    return path.join(config.outputDir, '.meta');
  },
};

