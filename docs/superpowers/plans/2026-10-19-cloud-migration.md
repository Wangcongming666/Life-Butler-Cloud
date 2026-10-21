# 生活管家云开发迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session if the user selects native execution. Steps use checkbox (`- [x]`) syntax for tracking. Only use superpowers:subagent-driven-development if the user selects delegation.

**Goal:** 将原生活管家完整迁入独立云开发目录，使同一微信用户在手机和 PC 小程序共享业务记录及照片。

**Architecture:** 保留现有页面与业务计算，抽离数据校验和快照映射，业务写入改为等待云端确认。云函数从微信上下文取身份，按记录存储、按版本检测冲突，客户端使用已确认快照渲染并自动拉取更新。大批量替换通过暂存新代次并原子切换指针发布，禁止全量覆盖一个大文档。

**Tech Stack:** 原生微信小程序、wx.cloud、wx-server-sdk、文档型云数据库、云存储；CommonJS；Node 内置 assert/node:test 与现有 VM 模拟测试。

**Spec:** `E:/Life-Butler/Life-Butler-Cloud/docs/cloud-migration-design.md`

## Global Constraints

- 唯一目标环境：`YOUR_CLOUD_ENV_ID`。
- AppID：`YOUR_WECHAT_APPID`。
- 所有新增和修改限于 `E:/Life-Butler/Life-Butler-Cloud`；源项目代码保持原状。
- 首版在线保存；离线允许查看已确认缓存，保存失败明确提示，不实现离线编辑队列。
- 金额沿用整数分，时间沿用原项目本地时区计算和已有数据格式。
- 云函数只信任 `cloud.getWXContext().OPENID`，客户端不得提供授权身份。
- 不购买套餐、不变更账号关联、不删除环境，不执行真实数据清空或覆盖。
- 原目录不是 Git 仓库，不初始化仓库或伪造提交；以文件检查与测试作为任务记录。
- 原项目基线：68 项基础检查和 35 项扩展检查通过。
- 测试前在当前 PowerShell 子进程设置 `SystemRoot`、`WINDIR` 为 `C:\Windows`；Node 使用 `D:\nvm\nodejs\node.exe`。不更改用户或系统级环境变量。

## Review Focus

1. 编辑表单打开后另一端修改同条记录：保存必须使用打开表单时的版本，不能用后台刷新后的版本掩盖冲突。测试归任务 4。
2. 云端提交成功但响应丢失：重试同一个操作 ID，只提交一次；未确认结果前不清理上传照片。测试归任务 2、5。
3. 分页拉取时另一端写入：不得展示新旧版本拼接的快照；批量替换中断不影响当前数据。测试归任务 2、3。
4. 云端写成功而本地缓存空间不足：仍标记云端已提交，提示缓存问题，不重复创建。测试归任务 3。
5. 旧设备路径与新用户缓存混用：未验证用户不能加载缓存，缺失旧照片必须在迁移预览中提示。测试归任务 3、6。

## Files and interfaces

相对路径均以目标目录为根。

- `miniprogram/`：从原项目复制业务页面、资源、组件、路由和样式，改动云端接入。
- `miniprogram/utils/data-schema.js`：提取 `emptyData()`、`validate(data, imagePredicate)`，不依赖 wx；保持原数据格式和校验。
- `miniprogram/utils/record-model.js`：`flatten(data) -> RecordMap`、`hydrate(records) -> Data`、`diff(before, after, versions) -> Change[]`、`mergeLegacy(local, remote, choices) -> MergePreview`。
- `miniprogram/utils/cloud.js`：`init()`、`call(action, payload) -> Promise<Result>`，环境常量与标准错误码。
- `miniprogram/utils/sync.js`：`start()`、`pull({force})`、`commit(data, context)`、`beginEdit(kind,id)`、`subscribe(listener)`、`getState()`、`stop()`；内存保存已确认快照。
- `miniprogram/utils/storage.js`：`read()` 保持同步读取已初始化的快照；所有修改方法返回 Promise，并等待云端；纯计算方法保留同步。
- `miniprogram/utils/page-sync.js`：`attach(page, refresh)` 返回卸载函数；订阅数据与状态变化，保留草稿。
- `cloudfunctions/lifeButler/`：`index.js` 做上下文鉴权与路由，`repository.js` 实现事务与分页，`service.js` 业务验证，`media.js` 文件引用检查；`shared/` 放同源纯校验模块。
- `scripts/check-shared.cjs`：校验云函数内共享纯模块与客户端来源一致，防止校验漂移。
- `tests/`：协议、双端、身份、媒体、页面行为和迁移回归。

## Protocol decisions

- 集合：`life_users`（用户活动代次、全局修订号）、`life_records`（逐记录）、`life_operations`（幂等结果）、`life_imports`（暂存/发布状态）。
- 记录键由服务端使用 `OPENID + generation + kind + businessId` 生成摘要；不把客户端输入直接作为跨用户文档路径。
- 业务类别：todos、expenses、notes、courses、exams、lifeRecords、budgets、sessions、loans、recipes、meals；preferences、term、timer 为单例。数组条目使用原 ID，预算使用 month，单例使用固定 ID。
- 记录版本单调增加；删除保留墓碑，不能让旧客户端把已删除条目重新创建。数据与墓碑均受 owner 和 generation 限制。
- `describe` 返回可信用户标识、generation、revision；`pull` 接收游标与期望 generation/revision，返回记录、版本及 nextCursor；版本改变返回 `SNAPSHOT_CHANGED`。
- `commit` 接收 `{operationId,generation,changes}`。每项包含 `{kind,id,expectedVersion,value}`；`value:null` 表示删除。云端检查所有项、业务校验和幂等结果后事务提交。返回已提交修订号和新版本。
- 单次直接 commit 最多 40 项，单次拉取最多 50 条且响应按 UTF-8 大小限制为 256 KiB，单条记录最多 128 KiB。超过限制使用暂存发布或报 `LIMIT_EXCEEDED`，禁止截断。
- `operation` 查询本用户操作结果。网络结果不确定时保留 operationId 并查询/重试；不把未确认状态当作业务失败清理。
- 大批量导入、恢复和清空使用 `beginReplace`、`stageReplace`、`publishReplace`。暂存记录属于不可见的新 generation；发布前校验完整性并封存；发布事务核对基准 revision 并切换活动 generation，同时写幂等结果。
- 发布前发生其他设备写入时返回 `CONFLICT`；中断、失败或重复分片均不修改当前活动数据。云函数配置及批次实现必须遵守实际平台事务、请求体和执行时长限制。
- 错误码统一为 `UNAUTHENTICATED`、`NOT_READY`、`CONFLICT`、`SNAPSHOT_CHANGED`、`INVALID_DATA`、`LIMIT_EXCEEDED`、`NETWORK`、`PENDING_CONFIRMATION`；错误提示使用中文。

### Task 1: 复制业务代码并建立纯数据模型

**Files:** Create `miniprogram/utils/data-schema.js`, `record-model.js`, `tests/record-model.test.cjs`, `scripts/check-shared.cjs`; modify target `project.config.json`, `miniprogram/app.json`; copy original assets/components/custom-tab-bar/pages/utils/app.wxss/sitemap.json and original regression scripts into target test fixtures.

**Interfaces:** Produces `emptyData`, `validate`, `flatten`, `hydrate`, `diff`，以及原业务页面与纯计算模块；不启动真实云请求。

- [x] 记录源代码清单/哈希，确认目标所有覆盖范围均为模板文件；不复制父目录本身，避免递归复制目标。
- [x] 新增失败测试：`hydrate(flatten(data))` 与合法原数据相等；金额、图片数量和无效日期仍拒绝；预算和单例映射无 ID 冲突；删除生成 value:null。
- [x] 运行 `node --test tests/record-model.test.cjs`，确认因缺少模型实现而失败。
- [x] 复制业务文件，提取纯校验，按协议定义实现映射和差异；保留 AppID 和 cloudfunctionRoot/miniprogramRoot，移除模板调试启动页配置。
- [x] 运行模型测试与复制后的原业务基线，确认 103 项原检查在未切换云存储前仍通过；确认源文件哈希未变化。

### Task 2: 实现可信云端读写与批量发布

**Files:** Create `cloudfunctions/lifeButler/{index.js,repository.js,service.js,package.json,config.json}`, `shared/`, `tests/{cloud-service,cloud-repository}.test.cjs`, `tests/helpers/memory-cloud.cjs`, `cloud/database.rules.json`, `cloud/database.indexes.json`。

**Interfaces:** Consumes Task 1 的纯校验/映射；produces `handle(context,event,repository) -> Promise<Result>` 和协议 action；repository 注入数据库/时钟便于测试。

- [x] 新增失败测试：用户 A 的两台客户端可共享数据，B 不可读 A；传入伪造 owner 无效，无 OPENID 拒绝；不同记录并发均保留，同条记录/墓碑版本不匹配失败。
- [x] 新增失败测试：同操作 ID 同载荷重试只写一次，不同载荷复用 ID 被拒绝；事务失败不留下部分写入；响应丢失后 operation 查询确认提交。
- [x] 新增失败测试：分页中途修改返回 SNAPSHOT_CHANGED；暂存中断活动数据不变，重复分片幂等，发布基准变化拒绝，超限明确报错。
- [x] 运行 `node --test tests/cloud-service.test.cjs tests/cloud-repository.test.cjs` 确认失败。
- [x] 实现服务端上下文鉴权、所有者限定、版本/墓碑、幂等和数据库事务；实现分页与暂存封存/原子发布；添加必需查询索引。
- [x] 为集合提供禁止客户端访问的规则；提供最小 wx-server-sdk 依赖，运行共享校验一致性检查及上述测试。

### Task 3: 接入云端快照与自动同步

**Files:** Create `miniprogram/utils/{cloud.js,sync.js,page-sync.js}`, `tests/{sync,app-lifecycle}.test.cjs`; modify `miniprogram/app.js` and `miniprogram/utils/storage.js`。

**Interfaces:** Consumes action 协议；produces Task 1 接口表中的同步服务；`getState()` 返回 `{status,ready,lastSyncedAt,error}`，`read()` 返回已确认 Data 的副本；`beginEdit` 返回 `{generation,kind,id,expectedVersion}`。

- [x] 新增失败测试：初始化使用 YOUR_CLOUD_ENV_ID；身份成功前不能读取旧缓存；未 ready 时拒绝写入；云端缓存按环境/AppID/OPENID 隔离。
- [x] 新增失败测试：两台客户端保存后互相 pull 可见；拉取过程中重复请求合并；同记录冲突保留已确认状态；暂存发布失败不污染快照。
- [x] 新增失败测试：云端提交响应丢失进入 PENDING_CONFIRMATION 并复用操作 ID；本地缓存写失败不重做云端成功操作。
- [x] 新增失败测试：前台每 30 秒检查 revision，后台停止；启动、前台、页面切换和手动同步触发拉取；分页不一致最多重试 3 次后明确提示重试。
- [x] 运行 `node --test tests/sync.test.cjs tests/app-lifecycle.test.cjs` 确认失败。
- [x] 实现初始化、状态、快照、缓存、版本、请求串行协调与编辑上下文；所有写入方法返回 Promise，在云端确认后更新快照，不使用原 KEY 写业务数据。
- [x] 接入应用前后台生命周期和页面更新订阅；网络失败不隐式初始化云端空数据；运行测试。

### Task 4: 改造页面异步调用与同步状态

**Files:** Modify `miniprogram/pages/{todo,account,notes,schedule,life,focus,loans,food,profile,settings,search,review,timeline,tools,backup}/index.js`, corresponding profile/backup WXML/WXSS/JSON, `miniprogram/utils/ui.js`; create `tests/{pages-cloud,editing-conflicts}.test.cjs`。

**Interfaces:** Consumes `storage.* -> Promise` 写方法、`sync.beginEdit` 和页面订阅；produces 在线保存反馈、加载/失败/同步状态、手动同步按钮。只读计算保持同步。

- [x] 新增失败测试：记账等写入 pending 时不提示成功、不关闭表单；失败保留输入；重复点击保存不产生重复请求。
- [x] 新增失败测试：打开表单后模拟另一端更新并后台刷新，旧表单提交仍使用打开时版本并被拒绝；草稿与照片选择不被页面 refresh 清除。
- [x] 新增失败测试：搜索/主题/统计收到远端更改后更新；卸载页面后不再 setData；初次加载时不展示误导性空库。
- [x] 新增失败测试：两端同时结算同一专注计时仅产生一条历史，倒计时每秒渲染不发云请求。
- [x] 运行上述测试确认失败，再逐页增加 async/await、busy 锁与错误处理；`attempt` 同时捕获同步错误和 Promise rejection，调用方在成功后执行后续动作。
- [x] 修改“纯本地”“无需登录”“所有本地记录”等文案，显示微信身份下云端同步语义；清空/恢复确认明确影响所有设备且保留二次确认。
- [x] 运行页面行为测试及更新后的原业务回归；静态扫描所有写方法调用，确认没有遗漏 await 或拒绝处理。

### Task 5: 云照片、引用与完整备份

**Files:** Modify `miniprogram/utils/{media.js,backup.js,storage.js}`, photo component/preview code where needed; create `cloudfunctions/lifeButler/media.js`, `cloud/storage.rules.json`, `tests/{cloud-media,cloud-backup}.test.cjs`。

**Interfaces:** `media.persist(paths,existing,kind) -> Promise<{paths,created}>` 返回 cloud fileID；`media.remove(paths)` 区分本地临时清理与云端引用安全清理；`backup.build(data)` 支持下载云图后嵌入；恢复完成时记录只包含云 fileID。

- [x] 新增失败测试：手机上传的 fileID 在 PC 可预览；同图被随记与购物引用时删一条不删文件；其他用户 fileID 无法注入当前用户记录。
- [x] 新增失败测试：上传成功而业务提交明确失败会补偿，提交结果不确定不删附件；查询到成功后保留图片。
- [x] 新增失败测试：云图下载失败完整备份报错；下载/编辑/取消不替换正式附件；完整备份跨设备恢复后上传云图，发布失败保留旧记录。
- [x] 运行上述测试确认失败，再实现上传、私有读写规则、按需下载、文件路径验证、服务端引用检查；后续清理只能删除确认无引用且属于当前用户的文件。
- [x] 运行照片、备份、原本地媒体回归和权限规则检查。

### Task 6: 旧本地记录与双端备份迁移

**Files:** Create `miniprogram/utils/migration.js`, `tests/legacy-migration.test.cjs`; modify `miniprogram/pages/backup/index.*`, `miniprogram/utils/{record-model.js,storage.js}`。

**Interfaces:** `inspectLegacy() -> LegacyPreview|null` 只读旧 KEY 并保留独立副本；`previewMerge(source,remote,choices) -> {data,conflicts,missing,counts}`；`applyMerge(preview) -> Promise` 通过暂存发布提交。恢复覆盖作为独立的双确认操作。

- [x] 新增失败测试：首次启动不自动上传/覆盖旧缓存；两个设备不同 ID 合并，相同 ID 同内容去重，不同内容必须解决冲突；元数据/偏好也显式选择。
- [x] 新增失败测试：无法访问的旧路径进入 missing；完整备份先还原照片再上传；损坏备份或取消预览不改变本地/云端记录。
- [x] 新增失败测试：迁移期间另一端写入导致发布冲突，保留原数据与预览；成功后重导同一备份不增加重复记录。
- [x] 运行迁移测试确认失败，增加“导入旧数据”入口、合并预览及逐项/统一选择本地或云端冲突；不默认覆盖；显示数量、缺图和影响范围。
- [x] 运行迁移、备份与页面集成测试。

### Task 7: 完整回归、部署说明与验收交接

**Files:** Create `scripts/check-project.cjs`, `tests/two-device.test.cjs`; update target `README.md` and this plan's progress boxes。

**Interfaces:** Consumes 全部实现；produces 可导入微信开发者工具的目标项目、部署配置和可重复的本地测试命令。

- [x] 写双端集成测试：同账号手机新增文字/照片，PC 拉取修改，手机拉取删除；重启保持一致；不同用户不可见；并发、断网和超时重试均遵守设计。
- [x] 运行 `node --test tests/*.test.cjs`、适配后的两套业务回归、`node scripts/check-shared.cjs`、`node scripts/check-project.cjs`；检查 JS 语法、页面文件/事件、云环境常量和源目录哈希。
- [x] README 写明：导入目标 project.config.json、选中新环境、创建四个集合并设置规则/索引、上传部署 lifeButler 并云端安装依赖、配置云存储权限、验证身份与函数日志。
- [x] 写明原缓存需要在对应设备发起迁移，PC 与手机必须用同一微信账号及同一 AppID；说明先部署再测试，未部署时的错误不能视为云环境已可用。
- [x] 真机验收清单标记为待用户部署后执行；没有远端工具时不能宣称已部署或双端实测通过。
- [x] 对照设计完成整体审查；按 executing-plans / requesting-code-review 技能要求完成一次独立最终审查（不委派实现任务）。记录测试结果、未验证项与具体部署步骤。

## Self-review / current status

- [x] 设计已由用户批准。
- [x] 本计划覆盖原页面迁移、记录/附件同步、幂等与冲突、旧数据迁移、权限、回归和部署边界。
- [x] 五项 Review Focus 均有对应测试任务，协议名称与接口表保持一致。
- [x] 原项目基线已执行：68 + 35 项通过。
- [x] 用户审核本实施计划并选择执行方式。
- [x] 本地业务迁移、同步实现和验证完成；远端部署及真机验收尚未执行，操作步骤已交付。
