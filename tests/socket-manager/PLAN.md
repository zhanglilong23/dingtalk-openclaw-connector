# socket-manager 模块测试方案

## 1. 目的与覆盖范围

`tests/socket-manager` 覆盖 WebSocket 连接管理功能，负责连接生命周期管理、消息队列处理、心跳保活和异常重连。

主要覆盖（以测试文件实际引用为准）：

- Socket 管理：**createSocketManager / stop**
- 消息队列：**addToPendingAckQueue / removeFromPendingAckQueue / clearPendingAckQueue**
- 连接事件处理：socket open / message / close
- 心跳保活：**startKeepAlive**

## 2. 用例表（覆盖现有测试）

### 2.1 Socket 连接事件

| 序号 | 场景 | 期望 |
|------|------|------|
| 1 | socket 打开 | 刷新 pending ack 队列，调用 socketCallBackResponse |
| 2 | 收到 SYSTEM 类型的 disconnect 消息 | 触发 disconnect 后 reconnect |
| 3 | socket 异常关闭（code=1006） | 触发 disconnect 后 reconnect |

### 2.2 心跳保活

| 序号 | 场景 | 期望 |
|------|------|------|
| 4 | 启动 keepAlive 并等待 10 秒 | 调用 socket.ping |

### 2.3 管理器控制

| 序号 | 场景 | 期望 |
|------|------|------|
| 5 | 调用 stop | 移除所有监听器 |

### 2.4 消息队列 helpers

| 序号 | 输入 | 期望 |
|------|------|------|
| 6 | addToPendingAckQueue(q, "a") / addToPendingAckQueue(q, "b") | 队列包含 ["a", "b"] |
| 7 | removeFromPendingAckQueue(q, "a") | 队列变为 ["b"] |
| 8 | clearPendingAckQueue(q) | 队列清空（size=0） |

## 3. 预期正确输出与潜在错误

- **正确**：Socket 打开时正确处理待确认消息队列；收到断开系统消息或异常关闭时正确触发重连；心跳保活按预期发送 ping；停止时正确清理监听器。
- **潜在错误原因**：消息队列处理顺序错误；重连逻辑未正确触发或重复触发；心跳定时器未正确清理；监听器未完全移除导致内存泄漏。
