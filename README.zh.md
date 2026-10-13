<p align="center">
    <h1 align="center">Bark-Worker</h1>
</p>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**[English](README.md)** | 中文文档

<!-- > [!CAUTION]
> Cloudflare Dashboard 目前(2024-07-27)存在Bug, 部署和变量编辑不可用, 在Cloudflare修复该问题之前请勿进行任何操作, 如果需要部署请使用wrangler. -->

<!-- > [!NOTE]
> Device token可能发生变化, 之前使用多Key或Key别名的方法可能会失效, 如有多Key使用需要参考[Tips](doc/tips.zh.md). -->

> [!NOTE]
> KV版本由于数据库配额较低, 可能不会添加MCP支持, 但如果MCP的代码能够优化到一定程度, 可能会有MCP支持.

> [!NOTE]
> 批量推送有最高优先级, 如果指定了`device_keys`且不为空, `device_key`将被忽略.

<!-- > [!CAUTION]
> 对于D1 Alpha用户： 在2024-08-01之后， D1 Alpha数据库将停止接受SQL查询，需要使用新的D1数据库，参考[迁移指南](https://developers.cloudflare.com/d1/platform/alpha-migration/) -->

Bark-Worker 是一个 [Bark-Server](https://github.com/Finb/bark-server) 在 Cloudflare Worker 上的实现. 为隐私敏感的用户提供一个低成本且保证隐私的服务端.

### 什么是 [Bark](https://github.com/Finb/Bark)?
[Bark](https://github.com/Finb/Bark) 是一个允许向iPhone发送通知的iOS APP.

> [!NOTE]
> 如果worker.dev域名在当前国家/地区不可用，则需要一个自己的域名

## 特性
- 支持所有的Bark-Server API
    - `register`
    - `ping`
    - `healthz`
    - `info`
    - `push`
- 基于路径的参数解析
- 便于部署, 低成本且方便管理

## 与 [bark-server](https://github.com/Finb/bark-server) 的差异

本项目是 bark-server 在 Cloudflare Workers 上的移植, 而非原样替换. 公开 API 保持兼容, 差异如下:

- **运行平台**: 跑在 Cloudflare Workers 上, 用 D1 (推荐) 或 KV 存数据, 不需要自建 Go 服务 / Docker 维护.
- **APNs 认证 token**: 用 WebCrypto 生成 provider JWT, 缓存在 D1 里 50 分钟 (Apple 上限 60 分钟), 外加 isolate 级内存缓存; 上游是常驻内存的 HTTP/2 连接池.
- **MCP**: 自研 JSON-RPC 实现, 会话存 D1 (1 小时滑动过期、24 小时绝对过期); 上游用 `mcp-go`, 10 分钟 idle TTL, 会话在内存里.
- **批量推送**: 单个设备失败不会拖垮整批请求, 返回逐设备结果, 与上游一致.
- **参数优先级**: 与上游一致, V1/V2 都是 请求体 < query 参数 < URL 路径.
- **配置项**: Worker 专属变量 `ALLOW_NEW_DEVICE`、`ALLOW_QUERY_NUMS`、`ROOT_PATH` (子路径部署) 和单个 `BASIC_AUTH` 值; 上游是 `BARK_SERVER_*` 系列变量和用户名+密码的 Basic Auth.
- **不支持**: `multipart/form-data` 的推送请求体 (上游 V1 支持); `GET /register/:device_key` 存活检查接口; 上游的 `BARK_SERVER_MAX_BATCH_PUSH_COUNT` (这里不限制批量数量). `register` 只认 query 参数.
- **KV 版本**: 无 MCP 支持 (配额限制); `info` 的设备数受 KV `list` 分页限制 (最多 1000).

## 部署

> [!NOTE]
> 从D1版本和KV版本中选择一个. 更推荐D1版本, D1版本的额度更高.

<!-- > [!CAUTION]
> 当Cloudfalre D1不再Beta后, KV版本的Database部分可能停止维护. -->

### 直接部署D1版本

> [!NOTE]
> Cloudflare API Token必须有D1权限

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cwxiaos/bark-worker)

### 或手动部署

参考 [部署指南](doc/setup_guide.zh.md)

#### Cloudflare D1 版本

创建一个Worker和D1 数据库, 将D1 数据库绑定至Worker并命名为 `database`

#### Cloudflare KV 版本

创建一个Worker和KV 存储, 将KV 存储绑定至Worker并命名为 `database`

## Tips

- 一个设备使用多个Key
- 设备Key别名
- D1数据库Console管理
- etc.

参考 [Tips](doc/tips.zh.md)
