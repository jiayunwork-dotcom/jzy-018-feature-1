# muskingum-service

Muskingum 河道演进演算后端：单段作业交一份入流过程线、取回一份出流过程线；河链作业交「最上游入流 + 按序排列的几段河」，一次演到下游取回整条链。
Node.js 20 + Fastify，作业、河段档与河链记录保存在进程内 SQLite（better-sqlite3），无独立数据库容器。

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
| POST | `/chains` | 提交河链作业（见下） |
| GET | `/chains` | 河链摘要列表 |
| GET | `/chains/:id` | 按河链自己的编号取回整份串联记录 |

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

## 河链

`POST /chains` 把一条河交进来：最上游入流加上按从上游到下游排好的几段河，服务逐段往下演，成功才落一条串联记录。

```json
{
  "inflow": [0, 5, 10, 15, 20, 25, 30, 25, 20, 15, 10, 5, 0],
  "dt": 1,
  "initialOutflow": 0,
  "segments": [
    { "reachName": "上游甲段" },
    { "K": 2, "X": 0.2, "lateralInflow": [0, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0] }
  ]
}
```

- 河链至少一段；每段二选一指定参数：点名已登记档 `reachName`，或内联 `K`、`X`；同一段两种写法同给报 `CONFLICTING_PARAMETERS`。
- 提交时先把全链点到的档名一次解析完：任何一段点到未登记的名字，整链当场拒绝（`UNKNOWN_REACH`，`details.segmentIndex` 指出第几段），不会演到那一段才报缺档，更不会把已算完的上游段落成单段作业。
- 全链共用一个 `dt`。第一段起始出流沿用单段规矩（`initialOutflow` 给了就用，没给取上游入流首值）；从第二段起，起始出流取该段实际入流的首值。
- 上一段的出流整条成为下一段的主槽入流。从第二段起可带 `lateralInflow`（区间入流），与主槽过程逐点相加后才是该段真正的入流；不带当作全程为零。区间入流必须与主槽一样长、每点有限且非负，否则开演前拒绝（`LATERAL_INFLOW_LENGTH_MISMATCH` / `NEGATIVE_LATERAL_INFLOW`，与单段的 `INFLOW_TOO_SHORT` / `NEGATIVE_INFLOW` 区分开）。
- 任一段分母过小或递推出负出流，整链失败（422），错误带 `details.segmentIndex` 指明第几段；已演完的上游段不落任何记录，下游也不会接着用被夹过的数。

成功返回 201 与整份串联记录：上游入流、步长、各段实际用到的 K/X（点名的附档名）、各段三联系数、各段出入流全过程与峰现下标、各汇入口区间入流及其洪量、出口过程（最后一段出流）、出口峰相对上游入流峰滞后的步数、上游入流洪量、出口出流洪量、「出口洪量 −（上游洪量 + 全部区间洪量）」的差与本次闭合容差（`1e-6 × max(1, |进入全链的总水量|)`）。

串联记录与单段作业分表保存：不进 `/jobs` 列表，也不能用 `/jobs/:id` 取出；按 `GET /chains/:id` 取回，服务重启后仍在。

## 错误说明

失败响应统一为 `{ "error": { "type", "message", "details?" } }`，类型包括：
`MISSING_FIELD`、`NOT_FINITE`、`INVALID_K`、`INVALID_X`、`INVALID_DT`、`INFLOW_TOO_SHORT`、`NEGATIVE_INFLOW`、`NEGATIVE_INITIAL_OUTFLOW`、`UNKNOWN_REACH`、`CONFLICTING_PARAMETERS`、`REACH_EXISTS`、`EMPTY_CHAIN`、`INVALID_SEGMENTS`、`INVALID_SEGMENT`、`INVALID_LATERAL_INFLOW`、`LATERAL_INFLOW_LENGTH_MISMATCH`、`NEGATIVE_LATERAL_INFLOW`、`LATERAL_INFLOW_NOT_ALLOWED`、`DENOMINATOR_TOO_SMALL`、`COEFFICIENT_SUM_MISMATCH`、`UNSTABLE_NEGATIVE_OUTFLOW`、`NON_FINITE_OUTFLOW`、`NOT_FOUND`、`BAD_JSON`。

入参问题 400，重名档 409，演算期失败（失稳、分母过小等）422，未找到 404。

## 代码结构

```
src/
  config.js                 钉死的容差与运行配置
  errors.js                 带类型的业务错误
  validation.js             入参检查（单段与河链共用的底层检查）
  chainValidation.js        河链请求体检查（空链、段结构、汇入口区间入流）
  muskingum/coefficients.js 三联系数
  muskingum/routing.js      逐步递推
  muskingum/hydrograph.js   峰现下标与洪量
  muskingum/confluence.js   汇入口逐点相加与整链洪量对账
  storage/db.js             进程内 SQLite
  storage/reaches.js        河段档存取
  storage/jobs.js           作业存取
  storage/chains.js         河链串联记录存取
  jobService.js             单段演算编排
  chainService.js           河链编排（档名解析、逐段下演、整链对账）
  demo.js                   内置示范作业
  app.js / index.js         HTTP 层与入口
test/                       node:test 自动化测试
```
