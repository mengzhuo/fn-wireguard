# WireGuard for fnOS

WireGuard VPN 管理应用，以原生应用包形式运行在 [飞牛 fnOS](https://www.fnnas.com/) 上。

## 功能

- **统一网关集成** — 通过 `/app/fn-wireguard` 访问，不暴露独立端口
- **实时状态轮询** — 每 3 秒刷新 peer 连接状态、传输量、握手时间
- **标准配置导入** — 粘贴 wg-quick 格式的 `.conf` 文件，一键导入
- **完整接口配置** — Address / ListenPort / DNS / MTU / Table / PreUp / PostUp / PreDown / PostDown / SaveConfig
- **Peer 管理** — 增删改 Peer，下载客户端配置文件
- **配置查看** — 实时查看当前 `wg0.conf` 内容

## 安装

1. 在飞牛 fnOS 应用中心点击「手动安装」
2. 选择 `fn-wireguard_*.fpk` 文件
3. 系统需预装 `wireguard-tools`：
   ```bash
   apt install wireguard-tools
   ```

## 开发

### 构建

```bash
make build    # 编译 Go → 打包 .fpk → 输出到 build/
make test     # 运行测试
make clean    # 清理
```

### 本地开发

```bash
cd app/server
PORT=51821 go run .
# 访问 http://localhost:51821
```

### 项目结构

```
├── manifest              # FN 应用描述
├── cmd/                  # 生命周期脚本 (main, install, upgrade, uninstall, config)
├── config/               # privilege (权限) + resource (资源声明)
├── app/
│   ├── ui/config         # 桌面入口配置
│   ├── ui/images/        # 入口图标
│   └── server/           # Go 后端源码
│       ├── main.go       # Gin 引擎 + 路由
│       ├── handlers.go   # API 处理器
│       ├── state.go      # 状态管理 + wg 命令封装 + 配置解析
│       ├── state_test.go # 单元测试
│       └── web/          # 嵌入前端 (HTML/CSS/JS)
├── wizard/               # 安装向导 (可空)
├── ICON.PNG / ICON_256.PNG  # 包图标
└── Makefile
```

## CI

- **build** (push/PR): `go test` → 交叉编译 amd64/arm64 → 打包 → artifact
- **release** (tag `v*`): 构建 + 创建 GitHub Release

## 许可

MIT
