# STDF Viewer (Web 版) — 部署到 Cloudflare Pages

浏览器端的 STDF 测试数据交互分析工具（Advantest MVA 风格）。
**纯静态网站**：STDF 文件在用户浏览器本地用 JavaScript 解析，数据不上传任何服务器，无后端、无数据库。

## 功能
- **导入**：单文件 / **文件夹（批量）** / **压缩包** — 支持 `.stdf .std .zip .tar.gz .tgz .gz .tar`，可拖拽文件夹；多文件时导航栏下拉切换。全部在浏览器本地解压解析，不上传。
- **Overview**：机台/批次/良率/平均测试时间/Bin 分布
- **Test Statistics**：168 项可排序统计（Cpk 红黄绿分级）+ 测试项搜索
- **Histogram**：分布 + 正态拟合曲线 + LSL/USL/Mean 线 + Cpk
- **Trend**：数值 vs DUT 序号，Pass/Fail 着色
- **Wafer Map**：Pass/Fail · Hard Bin · 任意参数项色阶
- **Correlation（相关性分析）**：① Pearson 相关矩阵（红正/蓝负，点格子下钻）② X-Y 散点 + 线性拟合 + r / R²
- **Box Plot**：按 Site 分布对比（站点一致性 / 偏移分析）
- **Failure Pareto**：失效 Soft Bin Pareto + 测试项超限 Pareto（含累计 %）
- **DUT Data**：每颗 die 数据网格（含 Test Time）
- Site 站点过滤（所有图表/统计实时重算）
- CSV 导出：统计表 / DUT 宽表 / 长格式

## 目录结构（这就是要部署的内容）
```
web/
├── index.html         # 主页面（文件选择框 + 看板）
├── _headers           # Cloudflare Pages 缓存/安全头
├── README.md
└── js/
    ├── stdf.js         # 浏览器端 STDF V4 解析器
    ├── viewer.js       # 统计计算 + UI 渲染 + CSV 导出
    └── plotly.min.js   # 图表库（已本地打包，无外网依赖）
```

## 部署方式

### 方式 A：Wrangler CLI（推荐）
```bash
# 1. 安装并登录（只需一次）
npm install -g wrangler
wrangler login

# 2. 在项目根目录（含 wrangler.toml）执行
wrangler pages deploy web --project-name stdf-viewer
```
部署完成后会给出一个 `https://stdf-viewer.pages.dev` 网址。

### 方式 B：Cloudflare 仪表盘拖拽上传（最简单，零命令行）
1. 登录 https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. 项目名填 `stdf-viewer`
3. 把 **`web/` 文件夹里的内容**整体拖进去（或先把 `web` 压成 zip 上传）
4. 点 **Deploy**

### 方式 C：Git 自动部署
把仓库推到 GitHub，然后在 Pages 里 **Connect to Git**：
- Build command：留空
- Build output directory：`web`

## 说明
- 单文件可处理到上百 MB（取决于浏览器内存）；解析在主线程完成，超大文件会短暂卡顿（已有"解析中…"提示）。
- 全程离线可用：plotly 已本地打包，没有任何外部 CDN 请求。
- 仅支持 STDF V4（小端 / 大端均按小端读取，V93000 SmarTest 默认小端）。
