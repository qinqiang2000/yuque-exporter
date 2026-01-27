yuque-exporter [...repos] [options]

export yuque docs to local

Usages:
  yuque-exporter --token=<your_token>
  yuque-exporter --token=<your_token> eggjs
  yuque-exporter --token=<your_token> atian25/test atian25/blog
  yuque-exporter --token=<your_token> user/repo -o /path/to/output --repo custom-name
  yuque-exporter --token=<your_token> user/repo -o /path/to/output --repo .
  YUQUE_TOKEN=<your_token> yuque-exporter

Commands:
  yuque-exporter [...repos]     export yuque docs to local             [default]
  yuque-exporter crawl          only crawl yuque docs meta
  yuque-exporter build          only build yuque docs with meta

Options:
  --help, -h       Show help                                            [boolean]
  --version        Show version number                                  [boolean]
  --token          yuque token                                          [string] [default: process.env.YUQUE_TOKEN]
  --host           yuque host                                           [string] [default: "https://www.yuque.com"]
  -o, --output     output target directory                              [string] [default: "./storage"]
  --repo           custom repo directory name, use "." to skip layer    [string]
  --clean          Whether clean the output target directory            [boolean] [default: false]
  --skip-draft     Skip draft and uncategorized documents               [boolean] [default: true]

Network Options:
  --timeout        Request timeout in milliseconds                      [number] [default: 60000]
  -c, --concurrency  Number of concurrent requests                      [number] [default: 10]
  --max-retries    Maximum number of retries on network failure         [number] [default: 3]
  --retry-delay    Initial delay between retries in milliseconds        [number] [default: 1000]