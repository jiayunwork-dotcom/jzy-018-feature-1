# muskingum-service

Muskingum 河道演进演算后端：交一份入流过程线，取回一份出流过程线。
Node.js 20 + Fastify，作业与河段档保存在进程内 SQLite（better-sqlite3），无独立数据库容器。

## 一条命令构建并启动

```bash
docker build -t muskingum . && docker run --rm -p 3000:3000 muskingum
```

持久化数据可加 `-v muskingum-data:/data`。本地开发：

```bash
npm ci
npm test        # node:test 全量测试
npm start       # 监听 0.0.0.0:3000，可用 PORT / HOST / DB_PATH 覆盖
```

## 演算约定

- 三联系数共用分母 `D = 2K(1−X) + dt`：`C0 = (dt − 2KX)/D`，`C1 = (dt + 2KX)/D`，`C2 = (2K(1−X) − dt)/D`；三者之和与 1 的偏差只允许钉死容差 `1e-9`。
- 递推 `O[i+1] = C0·I[i+1] + C1·I[i] + C2·O[i]`；缺省起始出流取入流首值（恒定流起步）。
- 约束：`K > 0`，`X ∈ [0, 0.5]`（闭区间），`dt > 0` 且与 K 同时间单位；入流至少两点、有限、非负。
- 递推中出现负出流即判定失稳，作业失败（422），绝不夹零冒充洪量闭合；分母无法安全相除同样失败，不硬除出 Infinity/NaN。
- 峰现下标取最先达到最大值的位置；洪量 = 流量 × 步长求和。每条作业记录本次使用的闭合容差（`1e-6 × max(1, |入流洪量|)`）。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 存活检查 |
| POST | `/reaches` | 登记河段档 `{ name, K, X }`，重名 409 |
| GET | `/reaches` | 列出全部档的名字与 K、X |
| GET | `/reaches/:name` | 取单个档 |
| POST | `/jobs` | 提交演算作业（见下） |
| GET | `/jobs` | 作业摘要列表 |
| GET | `/jobs/:id` | 取回整份作业结果 |

提交作业二选一指定参数：点名已登记档 `reachName`，或内联 `K`、`X`（用完即止）；两者同给报 `CONFLICTING_PARAMETERS`，点到未登记的名字报 `UNKNOWN_REACH`，不会自行找相近档顶替。

```json
{
  "inflow": [0, 5, 10, 15, 20, 25, 30, 25, 20, 15, 10, 5, 0],
  "dt": 1,
  "K": 2,
  "X": 0.2,
  "initialOutflow": 0
}
```

`initialOutflow` 可省略。成功返回 201 与整份结果：入流、步长、所用 K/X（或档名）、三联系数及其和、出流全过程、入流峰与出流峰下标、峰现滞后的步数、入流洪量、出流洪量、两者之差、本次闭合容差。

服务内置一条三角入流示范作业，编号固定为 `demo-triangular`（`GET /jobs/demo-triangular`）：出流峰更矮更晚，且洪量闭合。

## 错误说明

失败响应统一为 `{ "error": { "type", "message", "details?" } }`，类型包括：
`MISSING_FIELD`、`NOT_FINITE`、`INVALID_K`、`INVALID_X`、`INVALID_DT`、`INFLOW_TOO_SHORT`、`NEGATIVE_INFLOW`、`NEGATIVE_INITIAL_OUTFLOW`、`UNKNOWN_REACH`、`CONFLICTING_PARAMETERS`、`REACH_EXISTS`、`DENOMINATOR_TOO_SMALL`、`COEFFICIENT_SUM_MISMATCH`、`UNSTABLE_NEGATIVE_OUTFLOW`、`NON_FINITE_OUTFLOW`、`NOT_FOUND`、`BAD_JSON`。

入参问题 400，重名档 409，演算期失败（失稳、分母过小等）422，未找到 404。

## 代码结构

```
src/
  config.js                 钉死的容差与运行配置
  errors.js                 带类型的业务错误
  validation.js             入参检查
  muskingum/coefficients.js 三联系数
  muskingum/routing.js      逐步递推
  muskingum/hydrograph.js   峰现下标与洪量
  storage/db.js             进程内 SQLite
  storage/reaches.js        河段档存取
  storage/jobs.js           作业存取
  jobService.js             演算编排
  demo.js                   内置示范作业
  app.js / index.js         HTTP 层与入口
test/                       node:test 自动化测试
```
