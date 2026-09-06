# 免费云端部署候选

部署包包含 Dockerfile、requirements.txt、main.py、schedules.py，根目录 render.yaml 固定 plan: free，不创建数据库或磁盘。

创建 Render Free 服务需要用户的 Render 账号。采用生成的随机 RUNNER_TOKEN，不使用 Allegro 密码作为后台令牌。部署后将该令牌及服务 HTTPS 地址分别配置到网站 RUNNER_TOKEN、RUNNER_URL，值不得使用 NEXT_PUBLIC 前缀、不得入库。

单连接控制内存占用；多台电脑共用网址，查询需要排队或在另一台断开后登录。密码只用于创建临时浏览器会话，不长期存储。服务休眠或重启会清除会话和结果。前端允许约两分钟唤醒等待。

尚未验证 Render 的 Chromium sandbox 和 512 MB 运行条件。必须通过 healthz、实际登录、按航线和日期查询、下载解析、选择导出全流程，才可标记已接通；不得自动关闭 sandbox 或切换付费实例来跳过验证。

官方限制：https://render.com/docs/free
