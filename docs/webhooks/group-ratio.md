# 分组倍率 Webhook

系统设置的分组倍率页面提供一个由 root 管理的 Webhook 订阅。填写目标地址和监听的分组名称（英文逗号分隔），然后启用并保存。签名密钥可选：未配置密钥时直接发送，不附带签名；如需签名，填写至少 32 个字符的随机密钥。已有密钥时留空会保留原密钥，查询接口不返回密钥。

仅通知已存在且被监听分组的自身倍率实际变化；新增、删除、重复保存、分组间倍率覆盖和充值倍率变化不通知。一次倍率保存中的多个变化合并成一个事件。旧入口 `GroupRatio` 和分层入口 `group_ratio_setting.group_ratio` 使用同一持久化路径，并同步两个配置键。

## 消息与签名

目标必须是公网 HTTPS 地址，端口 443。不支持 URL 内嵌用户名/密码，不跟随重定向。连接时检查实际解析出的 IP，拒绝私有、回环和保留地址；不使用全局代理或跳过 TLS 验证的配置。

请求采用 `POST`，`Content-Type: application/json`，示例：

```json
{
  "id": "f59eb808-711e-4dd5-83db-997e855252fc",
  "type": "group.ratio.changed",
  "timestamp": 1790000000,
  "changes": [
    { "group": "vip", "old_ratio": 1, "new_ratio": 0.8 }
  ]
}
```

请求头：

- `X-Webhook-ID`：事件 ID，自动或手动重试均保持不变。
- `X-Webhook-Timestamp`：本次投递的 Unix 秒时间戳，重试时重新生成。
- `X-Webhook-Signature`（仅配置密钥时发送）：`sha256=` 加十六进制 HMAC-SHA256 签名。

启用签名时，签名输入为 `X-Webhook-Timestamp + "." + 原始请求体`，密钥为配置中的签名密钥。接收方应使用恒定时间比较验证签名，校验请求头时间戳的新鲜度（例如允许前后 5 分钟），然后按事件 ID 去重。不要重新序列化 JSON 后再验证签名。消息中的 `timestamp` 是事件产生时间，不是重试时间。

## 投递语义

倍率更新与事件在主数据库同一事务内提交。事件记录保存创建时的目标地址和密钥快照；之后更改或禁用订阅不会取消已经排队的事件，手动重试也使用原快照。

后台每 2 秒领取任务。单次请求超时为 15 秒，只有 HTTP 2xx 算成功。最多自动尝试 8 次，失败后的间隔依次为 30、60、120、240、480、960、1920 秒。界面每 10 秒刷新投递记录，最终失败后可手动重试，重新开始最多 8 次尝试。

多实例通过数据库条件更新领取 60 秒租约；实例退出后任务可重新领取。采用至少一次投递语义：接收方已处理但发送方未能记录成功时，可能重复发送。不同事件可能因重试乱序到达，接收方应结合自己的同步策略处理旧通知。

事件与结果保存在主数据库的 `group_ratio_webhook_deliveries` 表中，当前不自动清理。结果记录本轮重试的尝试次数、最近 HTTP 状态、成功时间和不含目标 URL/响应体的错误摘要。

## 管理 API

以下接口均要求 root 权限：

- `GET /api/option/group-ratio-webhook`：查询配置，返回 `has_secret` 而非密钥。
- `PUT /api/option/group-ratio-webhook`：保存 `{ "enabled": true, "url": "https://example.com/hook", "groups": ["vip"], "secret": "" }`。
- `GET /api/option/group-ratio-webhook/deliveries?page=1`：每页 20 条记录，不返回目标地址或密钥。
- `POST /api/option/group-ratio-webhook/deliveries/:id/retry`：仅允许重试最终失败的事件。

表结构由现有启动迁移流程创建，支持 SQLite、MySQL 和 PostgreSQL 的 GORM 路径。
