# muskingum-service

Muskingum 河道演进演算后端：交一份入流过程线，取回一份出流过程线；也可以把上中下游接成一条河链一次提交、逐段往下演。
Node.js 20 + Fastify，作业、河链与河段档保存在进程内 SQLite（better-sqlite3），无独立数据库容器。

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
| POST | `/chains` | 提交河链（最上游入流 + 若干段河，逐段串联演算） |
| GET | `/chains` | 河链摘要列表（与单段作业列表各自独立） |
| GET | `/chains/:id` | 取回整份河链记录 |

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

## 河链：上中下游接成一条河

`POST /chains` 一次吃进一条最上游入流和按书写顺序（上游→下游）排好的若干段河，逐段往下演。河链是单段入口之外另开的一层：串联记录单独成表，不出现在 `/jobs` 列表里，也不能用 `/jobs/:id` 当单段取出；单段入口的登记档、列档、点名演算、示范作业一切照旧，加河链不会改动既有单段作业的编号、内容和条数。

```json
{
  "inflow": [8, 8, 8, 8, 8, 8, 8, 8],
  "dt": 1,
  "initialOutflow": 8,
  "segments": [
    { "reachName": "已登记的上游段" },
    { "K": 2, "X": 0.2, "localInflow": [2, 2, 2, 2, 2, 2, 2, 2] }
  ]
}
```

约定：

- 河链至少一段；每段二选一指定参数——点名已登记档 `reachName`，或内联 `K`、`X`；同一段两种写法同时给出按 `CONFLICTING_PARAMETERS` 拒绝。
- 提交时先把整条链点到的档名**全部**解析完：任何一段点到没登记的名字，整链当场拒绝（`UNKNOWN_REACH`，details 带 `segment` 段号），不会演到那一段才报，更不会把已算完的上游段先落成一条成功的单段作业。
- 全链共用一个 `dt`。第一段起始出流与单段同规矩：给了就用，没给取最上游入流首值；从第二段起，取它实际接到的那条入流的第一个值。
- 上一段出流整条成为下一段的主槽入流。从第二段起每段可带一条 `localInflow` 区间入流，与主槽出流**逐点相加**后才是本段真正入流；不带视为全程为零。区间入流必须与主槽等长、各点有限非负，且第一段没有汇入口、不能带。
- 每段仍走单段同一套规则（同三联系数、同步递推、负出流即失败不夹零）。任一段分母过小或递推出负值，整条链失败（`CHAIN_SEGMENT_FAILED`，422，details 带 `segment` 与 `reason`），已演完的上游段不落任何单段记录，下游也不会拿被夹过的数继续传。
- 只有整条链成功才落一条河链记录。记录含：最上游入流、步长、各段实际用到的 K/X（点名的另记档名）、各段三联系数、各段入流（含汇入口逐点相加后的真入流）与出流全过程、区间入流、各段入流峰/出流峰下标、出口过程（最后一段出流）、出口峰相对上游入流峰的滞后步数、上游洪量、各汇入口区间洪量、出口洪量、`出口洪量 −（上游洪量 + 全部区间洪量）` 与本次闭合容差。

## 错误说明

失败响应统一为 `{ "error": { "type", "message", "details?" } }`，类型包括：
`MISSING_FIELD`、`NOT_FINITE`、`INVALID_K`、`INVALID_X`、`INVALID_DT`、`INFLOW_TOO_SHORT`、`NEGATIVE_INFLOW`、`NEGATIVE_INITIAL_OUTFLOW`、`UNKNOWN_REACH`、`CONFLICTING_PARAMETERS`、`REACH_EXISTS`、`DENOMINATOR_TOO_SMALL`、`COEFFICIENT_SUM_MISMATCH`、`UNSTABLE_NEGATIVE_OUTFLOW`、`NON_FINITE_OUTFLOW`、`NOT_FOUND`、`BAD_JSON`，
以及河链专用的 `CHAIN_NO_SEGMENTS`、`CHAIN_INVALID_SEGMENT`、`INVALID_LOCAL_INFLOW`、`LOCAL_INFLOW_LENGTH_MISMATCH`、`LOCAL_INFLOW_NOT_FINITE`、`LOCAL_INFLOW_NEGATIVE`、`LOCAL_INFLOW_ON_FIRST_SEGMENT`、`CHAIN_SEGMENT_FAILED`。

入参问题 400，重名档 409，演算期失败（失稳、分母过小等）422，未找到 404。
河链开演前的结构/档名/区间入流问题是 400（错误类型刻意与单段的 `INFLOW_TOO_SHORT`、`NEGATIVE_INFLOW` 区分开，details 都标明第几段、汇入口），演算到某一段才失败是 422 `CHAIN_SEGMENT_FAILED`。

## 代码结构

```
src/
  config.js                 钉死的容差与运行配置
  errors.js                 带类型的业务错误
  validation.js             入参检查（单段作业 + 河链）
  muskingum/coefficients.js 三联系数
  muskingum/routing.js      逐步递推
  muskingum/hydrograph.js   峰现下标与洪量
  muskingum/confluence.js   河链汇入口逐点相加与洪量对账
  storage/db.js             进程内 SQLite（jobs / chains / reaches 三表）
  storage/reaches.js        河段档存取
  storage/jobs.js           单段作业存取
  storage/chains.js         河链记录存取（与单段表互不通用）
  jobService.js             单段演算编排
  chainService.js           河链编排：解析档名 → 逐段串联演算 → 落盘
  demo.js                   内置示范作业
  app.js / index.js         HTTP 层与入口
test/                       node:test 自动化测试
```
