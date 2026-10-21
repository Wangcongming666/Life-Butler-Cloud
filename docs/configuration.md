# 本机配置

本项目为独立云服务仓库。配置模板复制命令、填写项目和部署步骤见 [README](../README.md#2-创建本机配置)。

以下文件只保留在本机，由 `.gitignore` 排除：

- `project.config.json`
- `project.private.config.json`
- `miniprogram/utils/cloud.js`
- `cloudfunctions/lifeButler/environment.js`

客户端和服务端的云环境 ID 必须一致。部署业务云函数时需要包含本机的 `environment.js`，Git 忽略不影响开发者工具上传云函数。

不要在客户端、测试或公开文档中写入 AppSecret、腾讯云密钥、令牌或私钥。
