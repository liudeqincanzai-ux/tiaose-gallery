# 调色摄影作品相册

这个版本已经改成 Decap CMS 在线后台：

- 访客视角：普通用户看到作品集页面
- 用户视角：打开 `/admin/` 进入后台，在线修改文字、颜色、板块和图片
- 保存后：Decap CMS 会把内容提交到 GitHub，网站重新部署后，公开网址也会更新

主要内容在：

- `content/site.json`：首页内容、板块、联系方式
- `admin/config.yml`：后台表单配置
- `photos/`：作品图片和后台上传的新图片

「精选作品」和「主题故事」是横向滑动板块，图片会完整显示，不会再被裁切。

## 在线后台

后台地址：

```text
https://你的网址/admin/
```

要让 Decap CMS 可以登录 GitHub 并保存内容，建议把这个 GitHub 仓库连接到 Netlify 免费部署，并在 Netlify 里配置 GitHub OAuth。配置好后，后台点击保存会提交到 GitHub；GitHub Pages 或 Netlify 重新部署后，访客就能看到更新。

## 旧发布脚本

如果你仍然想手动发布到 GitHub Pages，脚本还在这里：

```zsh
cd /Users/ahs/Documents/0041video
./deploy-tiaose-to-github-pages.command
```
