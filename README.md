# yuque-exporter

一键批量导出语雀知识库为本地 Markdown 文件，保留完整目录结构。

## 快速开始

### 1. 安装

```bash
git clone <your-repo-url>
cd yuque-exporter
npm install
npm run build
```

### 2. 获取语雀 Token

访问 **[语雀设置 - Token 管理](https://www.yuque.com/settings/tokens)** 创建一个新 Token，复制保存。

### 3. 开始导出

```bash
# 替换 your_token 和 username/repo-name
YUQUE_TOKEN=your_token node dist/bin/cli.js username/repo-name
```

导出完成后，文件保存在 `./storage/` 目录。

---

## 使用方式

### 基础用法

```bash
# 导出单个知识库
YUQUE_TOKEN=xxx node dist/bin/cli.js username/repo-name

# 导出多个知识库
YUQUE_TOKEN=xxx node dist/bin/cli.js user/repo1 user/repo2

# 导出用户所有知识库
YUQUE_TOKEN=xxx node dist/bin/cli.js username
```

### 使用命令行参数

如果不想用环境变量，可以直接传入 token：

```bash
node dist/bin/cli.js --token your_token username/repo-name
```

---

## 命令参数详解

### 基本命令格式

```bash
node dist/bin/cli.js [command] [...repos] [options]
```

### 命令 (Command)

| 命令 | 说明 |
|------|------|
| `(无命令)` | **默认** - 完整导出（爬取 + 构建） |
| `crawl` | 仅爬取数据（从语雀 API 获取元数据） |
| `build` | 仅构建 Markdown（需要先 crawl） |

**示例：**

```bash
# 完整导出（默认）
YUQUE_TOKEN=xxx node dist/bin/cli.js username/repo

# 分步执行
YUQUE_TOKEN=xxx node dist/bin/cli.js crawl username/repo  # 第一步：爬取
node dist/bin/cli.js build                                 # 第二步：构建
```

### 参数 (Options)

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--token` | string | `$YUQUE_TOKEN` | 语雀 Token（必需） |
| `--host` | string | `https://www.yuque.com` | 语雀服务器地址 |
| `--outputDir` | string | `./storage` | 输出目录路径 |
| `--clean` | boolean | `false` | 清空输出目录后重新导出 |
| `--help` / `-h` | boolean | - | 显示帮助信息 |

#### `--token` - 认证凭证

提供语雀 API Token，有两种方式：

```bash
# 方式 1：环境变量（推荐）
export YUQUE_TOKEN=your_token
node dist/bin/cli.js username/repo

# 方式 2：命令行参数
node dist/bin/cli.js --token your_token username/repo
```

#### `--outputDir` - 自定义输出目录

指定 Markdown 文件和元数据的保存位置：

```bash
YUQUE_TOKEN=xxx node dist/bin/cli.js --outputDir /path/to/output username/repo
```

输出结构：
```
/path/to/output/
├── .meta/           # 元数据缓存
└── 知识库名称/       # Markdown 文件
```

#### `--clean` - 清空重建

删除输出目录后重新导出（慎用）：

```bash
YUQUE_TOKEN=xxx node dist/bin/cli.js --clean username/repo
```

**⚠️ 警告：** 此操作会删除 `outputDir` 下的所有文件，包括 `.meta` 缓存。

#### `--host` - 私有部署

如果使用语雀私有部署版本：

```bash
YUQUE_TOKEN=xxx node dist/bin/cli.js --host https://your-yuque-server.com username/repo
```

---

## 完整示例

### 场景 1：导出单个知识库到默认目录

```bash
YUQUE_TOKEN=abc123 node dist/bin/cli.js nbklz3/my-notes
```

结果：
```
./storage/
├── .meta/nbklz3/my-notes/  # 元数据
└── My Notes/               # Markdown 文件
    ├── 文档1.md
    └── 子目录/
```

### 场景 2：导出到自定义目录

```bash
YUQUE_TOKEN=abc123 node dist/bin/cli.js \
  --outputDir ~/Documents/yuque-backup \
  nbklz3/my-notes
```

### 场景 3：清空重新导出

```bash
YUQUE_TOKEN=abc123 node dist/bin/cli.js --clean nbklz3/my-notes
```

### 场景 4：导出用户所有知识库

```bash
YUQUE_TOKEN=abc123 node dist/bin/cli.js nbklz3
```

### 场景 5：批量导出多个知识库

```bash
YUQUE_TOKEN=abc123 node dist/bin/cli.js \
  nbklz3/repo1 \
  nbklz3/repo2 \
  nbklz3/repo3
```

---

## 功能特性

- ✅ **批量导出** - 支持单个/多个知识库/全部知识库
- ✅ **保留结构** - 完整保留语雀目录层级
- ✅ **图片下载** - 自动下载图片到 `assets/` 目录
- ✅ **相对链接** - 文档内链转换为相对路径
- ✅ **增量更新** - 只导出变更的文档，节省时间
- ✅ **Frontmatter** - 包含标题、URL 等元数据
- ✅ **多格式支持** - Markdown、Lake 格式、表格
- ✅ **草稿文档** - 导出到 `_未分类文档/` 目录

---

## 增量更新机制

再次运行相同命令时，工具会智能跳过未变更的文档：

1. 比较文档的 `published_at` 时间戳
2. 仅下载和转换更新过的文档
3. 大幅提升重复导出速度

**示例：**

```bash
# 第一次导出（完整）
YUQUE_TOKEN=xxx node dist/bin/cli.js username/repo
# 导出 100 篇文档...

# 第二次导出（增量）
YUQUE_TOKEN=xxx node dist/bin/cli.js username/repo
# 仅导出 3 篇更新的文档
```

---

## 常见问题

### ❌ 错误：Missing YUQUE_TOKEN

**原因：** 未设置 Token

**解决：**
```bash
# 方法 1：设置环境变量
export YUQUE_TOKEN=your_token

# 方法 2：使用 --token 参数
node dist/bin/cli.js --token your_token username/repo
```

### ❌ 错误：Authentication failed: bad X-Auth-Token

**原因：** Token 无效或已过期

**解决：**
1. 访问 https://www.yuque.com/settings/tokens
2. 检查 Token 是否有效
3. 如已失效，删除旧 Token 并创建新的

### ❌ 错误：Resource not found

**原因：** 知识库路径错误或无权限访问

**解决：**
- 检查路径格式是否为 `username/repo-name`
- 确认 Token 对应账号有访问权限
- 确认知识库是否存在

### ❌ 错误：Rate limit exceeded

**原因：** API 调用次数超限（5000 次/小时）

**解决：** 等待一段时间后重试，或使用增量更新减少 API 调用。

---

## 目录结构说明

```
./storage/                      # 默认输出目录
├── .meta/                      # 元数据缓存（JSON 格式）
│   └── username/
│       └── repo-name/
│           ├── repo.json       # 知识库信息
│           ├── toc.json        # 目录结构
│           ├── docs.json       # 文档列表
│           ├── docs-published-at.json  # 更新时间戳
│           └── docs/           # 文档详情
│               ├── doc1.json
│               └── doc2.json
│
└── 知识库标题/                  # Markdown 输出
    ├── 文档1.md
    ├── 文档2.md
    ├── 子目录/
    │   └── 子文档.md
    ├── assets/                 # 图片资源
    │   └── image1.png
    └── _未分类文档/             # 草稿/未分类文档
        └── 草稿.md
```

---

## 开发相关

### 开发模式

```bash
# 启动开发模式（自动重载）
YUQUE_TOKEN=xxx npm run start:dev

# 编译 TypeScript
npm run build

# 代码检查
npm run lint

# 自动修复代码风格
npm run lint:fix

# 运行测试
npm test
```

### 项目架构

```
src/
├── bin/
│   └── cli.ts         # CLI 入口
├── lib/
│   ├── sdk.ts         # 语雀 API 客户端
│   ├── crawler.ts     # 爬取逻辑
│   ├── builder.ts     # 构建逻辑
│   ├── tree.ts        # 目录树处理
│   ├── doc.ts         # 文档转换
│   ├── errors.ts      # 错误处理
│   └── utils.ts       # 工具函数
└── config.ts          # 全局配置
```

---

## 注意事项

1. **API 限制** - 语雀 API 限制 5000 次请求/小时
2. **附件下载** - 附件（非图片）暂不支持下载
3. **私有知识库** - 确保 Token 有访问权限
4. **文件名冲突** - 同名文件自动添加 `_1`、`_2` 后缀

---

## License

MIT
