# yuque-exporter

批量导出语雀文档为本地 Markdown 文件。

## 功能特性

- ✅ 批量导出语雀知识库为 Markdown
- ✅ 保留文档目录结构
- ✅ 自动下载图片到本地
- ✅ 转换文档内链为相对路径
- ✅ 增量更新（只导出变更的文档）
- ✅ 支持 frontmatter 元数据

## 安装

```bash
git clone <your-repo-url>
cd yuque-exporter
npm install
npm run build
```

## 使用方法

### 1. 获取语雀 Token

访问 [语雀个人设置 - Token](https://www.yuque.com/settings/tokens) 创建一个新的 Token。

### 2. 导出文档

**推荐方式（使用环境变量）：**

```bash
# 导出指定知识库
YUQUE_TOKEN=your_token node dist/bin/cli.js username/repo-name

# 导出多个知识库
YUQUE_TOKEN=your_token node dist/bin/cli.js user/repo1 user/repo2

# 导出用户的所有知识库
YUQUE_TOKEN=your_token node dist/bin/cli.js username
```

**或使用命令行参数：**

```bash
node dist/bin/cli.js --token your_token username/repo-name
```

### 3. 查看导出结果

导出的文件默认保存在 `./storage` 目录：

```bash
ls storage/
```

## 命令选项

```bash
yuque-exporter [...repos] [options]

命令：
  yuque-exporter [...repos]     导出语雀文档（爬取 + 构建）      [默认]
  yuque-exporter crawl          仅爬取元数据
  yuque-exporter build          仅构建 Markdown（需先 crawl）

选项：
  --help       显示帮助信息                                     [boolean]
  --token      语雀 Token                                       [string]
  --host       语雀 host                                        [string] [默认: "https://www.yuque.com"]
  --outputDir  输出目录                                         [string] [默认: "./storage"]
  --clean      是否清空输出目录                                 [boolean] [默认: false]
```

## 使用示例

### 导出单个知识库

```bash
YUQUE_TOKEN=xxx node dist/bin/cli.js nbklz3/tadboa
```

### 导出用户所有知识库

```bash
YUQUE_TOKEN=xxx node dist/bin/cli.js nbklz3
```

### 清空目录重新导出

```bash
YUQUE_TOKEN=xxx node dist/bin/cli.js --clean nbklz3/tadboa
```

### 自定义输出目录

```bash
YUQUE_TOKEN=xxx node dist/bin/cli.js --outputDir ./my-docs nbklz3/tadboa
```

### 分步执行

```bash
# 第一步：爬取元数据
YUQUE_TOKEN=xxx node dist/bin/cli.js crawl nbklz3/tadboa

# 第二步：构建 Markdown
node dist/bin/cli.js build
```

## 工作原理

1. **爬取阶段** - 调用语雀 API 获取知识库、文档列表、TOC 等元数据
2. **存储元数据** - 将元数据保存到 `./storage/.meta` 目录
3. **构建阶段** - 根据 TOC 构建目录结构，转换文档为 Markdown
4. **资源处理** - 下载图片、替换链接为相对路径

## 增量更新

再次运行相同命令时，工具会：

- 比较文档的 `published_at` 时间戳
- 只爬取和构建变更过的文档
- 跳过未变更的文档以提高效率

## 目录结构

```
./storage/
├── .meta/              # 元数据缓存
│   └── username/
│       └── repo/
│           ├── repo.json
│           ├── toc.json
│           ├── docs.json
│           └── docs/
│               └── *.json
└── 知识库名称/          # 导出的 Markdown 文件
    ├── 文档1.md
    ├── 文档2.md
    └── 子目录/
        └── 文档3.md
```

## 注意事项

- API 限制：5000 次/小时
- 附件下载需要登录，暂不支持
- 文档内链会被转换为相对路径
- 草稿文档也会被导出

## 开发

```bash
# 开发模式
YUQUE_TOKEN=xxx npm run start:dev

# 构建
npm run build

# 代码检查
npm run lint

# 修复代码风格
npm run lint:fix
```

## License

MIT
