<div align="center">
  <h1>Art Supabase TMS 司机端</h1>
  <p><strong>与 Art Supabase TMS 实时协同的 H5 / 微信小程序运输执行端</strong></p>
  <p>让司机在手机上完成接单、装卸货打卡、发车、签收、收车、凭证与费用上报。</p>

  <p>
    <a href="https://gitee.com/wangyanghub/supabase-mobile-tms-driver">Gitee</a>
    ·
    <a href="https://github.com/869123771/supabase-mobile-tms-driver">GitHub</a>
    ·
    <a href="https://gitee.com/wangyanghub/art-supabase-tms">TMS 管理端</a>
    ·
    <a href="https://gitee.com/wangyanghub/art-supabase-pro">主平台</a>
    ·
    <a href="https://869123771.github.io/art-supabase-doc/modules/driver">使用文档</a>
    ·
    <a href="./README.en.md">English</a>
  </p>
</div>

## 项目定位

Art Supabase TMS 司机端是运输履约的一线移动工作台，基于 uni-app、Vue 3、TypeScript、Pinia、Wot Design Uni 与 Supabase 构建，同时支持 H5 和微信小程序。

司机端不是独立维护另一套运单数据。它通过受控服务端契约读取当前司机可见的任务，并把定位、照片、磅单、回单、里程、签收和费用记录同步回同一条 TMS 运单链路。

![司机工作台](screenshots/driver-home.png)

## 核心能力

| 场景       | 已覆盖能力                                                        |
| ---------- | ----------------------------------------------------------------- |
| 身份与任务 | 账号密码登录、微信手机号登录、司机档案、待办任务与状态筛选        |
| 接单与路线 | 接受/取消任务、起讫地与站点信息、联系人拨号、路线与运输轨迹       |
| 装卸货     | 定位与电子围栏打卡、毛重/皮重/净重、现场照片、磅单与 OCR 辅助识别 |
| 运输执行   | 发车时间、出车里程、车辆照片、到达打卡、收车时间与回场里程        |
| 签收回单   | 签收人、签收时间、回单、签字照片与运输节点时间线                  |
| 费用协同   | 费用项目、金额、日期、地点、票据、OCR 草稿、提交审批与审核状态    |
| 车辆与我的 | 绑定车辆、证件状态、司机资料与账号退出                            |

「我的」还提供提货预约、送货预约、异常报备、过磅记录、在途费用、司机认证和 AI 助手。过磅与在途费用沿用运单原有记录。AI 助手复用已部署的 Supabase `ai-assistant`，使用当前登录会话，不自动附带运单或档案。

预约、异常报备和认证状态查询的司机专用 RPC 见 [数据库接口说明](supabase/review/README.md)。司机提交的是待调度处理的申请或报备，预计额外运费由后台复核。司机认证页面只读审核结果，材料补充沿用车队审核流程。

## 履约流程

```text
接收任务
  → 装货地定位打卡与装货资料
  → 发车时间、里程与车辆照片
  → 在途运输与到达打卡
  → 卸货资料、签收与电子回单
  → 收车时间、里程与运输完成
  → 途中费用上报与财务审批
```

定位或 OCR 失败不会替代人工判断：允许按服务端策略重试、手工补录或提交清晰凭证，最终值以司机确认和后台审核为准。

## 快速开始

开发和构建使用 [supabase-mobile-pro](https://gitee.com/art-si/supabase-mobile-pro) 的公共样式。可在主仓的 `modules/` 中开发。单独检出时，在同一级放好对应版本的主仓，或用 `MOBILE_PRO_ROOT` 指向主仓目录。

建议使用 Node.js 22 与 pnpm。

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev:h5
```

在 `.env.local` 中配置：

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_MP_URL=
VITE_SUPABASE_KEY=your-publishable-or-anon-key
VITE_AMAP_KEY=
VITE_AMAP_SECURITY_JS_CODE=
```

微信小程序开发与生产构建：

```powershell
pnpm dev:mp-weixin
pnpm typecheck
pnpm build:h5
pnpm build:mp-weixin
```

`pnpm build:h5` 生成静态发布目录 `docs/`。提交产物后，在司机端的 GitHub 仓库按[分支发布说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-from-a-branch)选择 **Settings → Pages → Deploy from a branch**，指定包含产物的分支和 `/docs`。生成的 `.nojekyll`、相对资源路径和哈希路由支持部署在仓库子路径。写入 `docs/` 时会排除高德安全密钥和 Web 服务密钥；公开构建的 Supabase 配置仅使用 publishable 或 anon key。

微信小程序还需要在开发者工具和平台后台配置 AppID、合法域名、定位/相册/相机权限与手机号授权能力。

账号由后台「用户管理 → 移动端账号」关联到具体司机档案，承运商归属从档案带出。修改联系手机号不会改变司机身份。密码登录使用 `driver-auth`；微信登录和绑定使用 Pro 维护的统一 `mobile-wechat-auth`。首次密码登录后，10 分钟内在「我的」绑定本人微信手机号；之后可一键登录。构建设置 `VITE_ENABLE_WECHAT_PHONE_LOGIN=true`。未关联或停用的司机不能登录，现有会话也停止业务访问。运单直接读取司机专用 RPC，无需额外的同步接口。配置说明见主仓 `supabase/README.md`。
若手机网络无法直连 Supabase，可将 `VITE_SUPABASE_MP_URL` 设为可直达的 HTTPS 代理域名；H5 仍使用 `VITE_SUPABASE_URL`。该域名须在小程序后台配置为 request、uploadFile 和 downloadFile 合法域名，并转发 `/auth/v1`、`/rest/v1`、`/functions/v1` 与 `/storage/v1`。

## 安全边界

- 前端只使用 Supabase `anon` / publishable key，禁止写入 `service_role` 或 AI Provider 密钥。
- 司机只能访问服务端判定为本人可见的运单、车辆和业务字段。
- 运单接受、取消、装卸货、发车、签收、完成与费用提交均由服务端重新校验身份、状态和租户。
- 定位、照片、票据与回单属于业务证据，应按最小权限、有效期和审计要求管理。

## 关联项目

- [`art-supabase-tms`](https://gitee.com/wangyanghub/art-supabase-tms)：运输管理、调度、监控与签收管理端。
- [`art-supabase-pro`](https://gitee.com/wangyanghub/art-supabase-pro)：统一认证、租户、权限、审批与平台能力。
- [`art-supabase-doc`](https://gitee.com/wangyanghub/art-supabase-doc)：完整使用、开发、部署与运维文档。
