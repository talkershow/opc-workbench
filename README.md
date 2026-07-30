# OPC 个人工作台

自媒体内容管理一体化工作台，纯前端实现，数据本地存储，支持 GitHub 云同步。

## ✨ 功能

- **📊 仪表盘** — 数据总览 + 快捷入口
- **📬 数据邮箱** — 每日热点信息流，一键转选题（支持选平台）
- **💡 选题看板** — 选题 CRUD + 三维评分 + 状态管理
- **🎯 内容看板** — 六维评分 + 自动分级（S/A/B/C）+ 二次加工追踪
- **📈 数据追踪** — 按平台分类（B站/抖音/小红书等），趋势图 + 排行榜
- **📝 复盘** — 日复盘（3 分钟）+ 周复盘（四问法）
- **🧰 SOP 工具箱** — 内容模板 + 发布清单 + 平台规格 + 标题公式
- **☁️ GitHub 同步** — 数据云端备份，多设备同步

## 🚀 使用

### 本地使用
直接用浏览器打开 `opc-workbench.html` 即可。

### 线上部署
已部署到 GitHub Pages：[https://talkershow.github.io/opc-workbench/](https://talkershow.github.io/opc-workbench/)

### 数据同步配置
1. 打开工作台，点击左下角「☁ 同步」
2. 填入 GitHub 用户名、仓库名、Token
3. 保存 → 测试连接 → 推送数据
4. 换设备时打开页面 → 拉取即可恢复

## 📂 结构

```
opc-workbench/
├── opc-workbench.html   # 主页面
├── assets/
│   ├── app.js           # 核心逻辑
│   └── charts.js        # 图表渲染
├── _shared/
│   └── js/
│       └── echarts.min.js
└── README.md
```

## 🛠 技术栈

- 纯 HTML + CSS + JavaScript（零依赖）
- ECharts 数据可视化
- localStorage 本地存储
- GitHub Contents API 云同步
