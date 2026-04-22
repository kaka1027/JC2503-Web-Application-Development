# Puzzle Game - 网页拼图游戏

JC2503 Web Application Development 课程作业项目

## 项目简介

一个基于Web的拼图游戏，支持多种难度、自定义图片、排行榜等功能。

## 技术栈

- **前端**: HTML5, CSS3, JavaScript, Canvas API
- **后端**: Node.js + Express
- **数据库**: MySQL

## 主要功能

- 用户注册与登录
- 多难度选择（3x3, 4x4, 5x5）
- 自定义图片上传
- 游戏计时与计步
- 排行榜系统
- 游戏进度保存

## 安装运行

### 环境要求
- Node.js (v14+)
- MySQL (v8.0+)

### 步骤

1. 安装依赖
```bash
npm install
```

2. 配置数据库
- 创建数据库并导入 `database.sql`
- 修改 `config/database.js` 配置

3. 启动
```bash
npm start
```

4. 访问 `http://localhost:3000`

## 项目结构

```
├── public/          # 静态资源
├── views/           # 页面
├── routes/          # 路由
├── controllers/     # 控制器
├── models/          # 数据模型
├── config/          # 配置
└── app.js           # 入口
```

## 作者

课程: JC2503 Web Application Development
