# AGENTS.md — fn-wireguard

## 项目概述

飞牛 fnOS 的 WireGuard 管理应用。Gin 后端 + 嵌入前端，通过统一网关 Unix Socket 提供服务。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Go 1.22 + Gin |
| 前端 | 原生 HTML/CSS/JS（嵌入 Go binary） |
| 打包 | fnpack → `.fpk` |
| CI | GitHub Actions + mengzhuo/setup-fnpack |

## 关键约定

- **不要引入新框架** — 前端用原生 JS，不用 React/Vue
- **Unix socket > 端口** — 统一网关模式，`GATEWAY_PREFIX` + `SOCKET_PATH` 环境变量控制
- **State 先改后 Apply** — 增删 Peer / 改配置只写 state.json，Apply 才动 WireGuard
- **wg-quick 配置全覆盖** — Interface 配置项跟 wg-quick(8) man page 对齐
- **FN 包结构严格** — `manifest`、`cmd/*`、`config/*`、`wizard/`、`ICON*.PNG` 缺一不可

## 项目结构

```
app/server/main.go       — Gin 引擎、路由注册、中间件
app/server/handlers.go   — API handler（*gin.Context）
app/server/state.go      — 数据模型、JSON 持久化、wg 命令封装、配置解析/生成
app/server/state_test.go — 单元测试
app/server/web/          — 嵌入前端（index.html + app.js）
app/server/go.mod        — 依赖声明（仅 gin）
cmd/main                 — 生命周期：启停 Go 进程，设 GATEWAY_PREFIX/SOCKET_PATH
config/privilege         — run-as: root（wg-quick 需要）
manifest                 — appname=fn-wireguard, platform=x86
```

## 构建

```bash
make build    # → build/fn-wireguard_1.0.0_x86.fpk
make test     # → go test ./...
```

## 本地调试

```bash
cd app/server && PORT=51821 go run .
# 不设 GATEWAY_PREFIX/SOCKET_PATH 时回退到 TCP 模式
```
