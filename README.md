# 情侣打卡 100 件事

按提供的图片逐项整理，保留原编号和文字，不根据黄色高亮推断完成状态。初始为 100 项未完成，原图保存在 reference.jpg。

## 打开与共享

在此目录运行 `powershell -ExecutionPolicy Bypass -File .\start.ps1`，然后查看 `server.log` 中带 `#` 密钥的完整地址。也可以前台运行 `node server.mjs`。需要 Node.js 20 或更新版本。

本机使用 Local 地址。两台手机或电脑连接同一 Wi-Fi 后，使用页面右上角“邀请另一半”复制的局域网地址。电脑必须保持开机、不休眠，且服务正在运行。首次连接可能需要在 Windows 防火墙提示中允许 Node.js 通过私人网络；访客 Wi-Fi 或设备隔离也可能阻止互访。本项目不会自动修改防火墙。

本地局域网版本不是公网网站。不同网络、异地使用需要另外部署到支持长期 Node.js 进程和持久磁盘的 HTTPS 服务器。本次没有创建公网服务、账户或临时隧道。不能将 localhost 地址直接发给另一台设备使用。

若端口 8765 被其他程序占用，不关闭原程序；先设置 `$env:PORT = '8766'` 再运行启动脚本。

## 记录

- 勾选即完成并显示删除线；再次点击可恢复未完成，原有日期及备注保留。
- 点击项目标题或铅笔可填写日期、地点和两个人各自的记录。
- 右上角人物图标可修改两个人的名字和本设备身份；邀请链接默认选择另一位。
- 筛选全部、未完成、已完成，按分类过滤或搜索标题、地点、备注；支持随机选一件未完成的事。
- 修改先保存到磁盘，再实时同步给所有已连接的浏览器。离线不排队写入，避免之后静默覆盖；编辑框中尚未提交的内容只在当前页面保留，关闭或刷新前需保存。
- 两人修改不同字段会合并；同一字段冲突时提示核对最新内容，不静默覆盖。
- 桌面端下载按钮导出 JSON 备份。全部数据在 `data/checklist.json`，密钥在 `data/access-key.txt`。移动项目时保留整个 data 目录。恢复导出备份需先停止服务，保留原数据副本，再将备份放回 `data/checklist.json`。

## 访问边界

这是一个两人共用的私密链接，不是两个有独立权限的登录账户。持有完整链接者都能查看和编辑两个备注栏，所以不要公开链接。密钥放在浏览器 URL 片段中，API 请求使用 Authorization 头；服务只公开显式列出的静态资源，不公开数据文件或密钥文件。

局域网默认 HTTP，不适用于不可信的公共网络。对外部署必须使用 HTTPS 并考虑额外登录与备份。界面不包含遥测或外部字体、脚本请求。

## 检查

`node --test server.test.mjs` 使用系统临时目录，不改动真实清单。`node browser-test.mjs` 使用独立测试服务验证两个浏览器会话同步、手机布局和截图，需要环境已有 Playwright。

图标使用 Lucide，本地许可证见 `vendor/LICENSE`。本项目未改动工作区已有题库。

## GitHub Pages + Supabase 公网版

公网版已经兼容 GitHub Pages 子目录：网页发布到 GitHub，勾选、日期、地点和双方备注保存在 Supabase。页面约每 2 秒获取另一端的新记录，电脑无需保持开机。

完成上线需要：

1. 在 Supabase 新建项目，在 SQL Editor 执行 `supabase/schema.sql` 全文。
2. 在 Supabase 的 Project Settings / API 复制 Project URL 和 Publishable key（旧项目可能显示 anon public key）。绝对不要使用或提交 secret/service_role key。
3. 在 GitHub 仓库 Settings / Secrets and variables / Actions 新建 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY` 两个 Repository secrets。
4. 仓库 Settings / Pages 的 Source 选择 GitHub Actions，然后运行 `Deploy checklist to GitHub Pages` 工作流。

部署工作流会生成浏览器可用的 `config.js`，不会把 Supabase 配置提交到 Git 历史。Publishable/anon key 本身是前端公开标识，安全边界由数据库权限控制：数据表已启用 RLS 并撤销直接访问，页面仅能调用受限函数；真正保护这对情侣清单的是 URL `#` 后面的高强度房间密钥，因此完整邀请链接不可公开。

本地真实数据不会自动上传到云端。首次公网打开会建立全新的 100 项空清单；如需迁移本地已有完成记录，应使用专门迁移流程，不要把 `data/checklist.json` 提交到 GitHub。

验证：`node --test server.test.mjs` 检查本地服务；`node browser-test.mjs` 检查本地双端同步；`node cloud-browser-test.mjs` 在模拟 GitHub Pages 子路径与云端接口下检查公网模式。真实 Supabase SQL 仍必须在创建的项目中执行后才能做最终联调。
