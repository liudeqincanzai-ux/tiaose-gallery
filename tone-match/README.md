# Reference Tone Match Web

本目录是 Photoshop 插件的 HTTPS 网页版原型。它在浏览器内用 Canvas 完成参考图分析、批量仿色、预览和下载，不依赖 Photoshop。

## 本地 HTTPS 启动

```bash
python3 server.py --host 127.0.0.1 --port 8443
```

打开：

```text
https://127.0.0.1:8443/
```

第一次访问会看到自签名证书提示。若浏览器没有“继续访问”按钮，双击运行 `Trust Local HTTPS.command`，把本地证书加入登录钥匙串后重启浏览器。

如果只想先测试功能，也可以启动 HTTP 备用服务：

```bash
python3 server.py --http --host 127.0.0.1 --port 8080
```

打开：

```text
http://127.0.0.1:8080/
```

## 当前格式

支持浏览器能直接解码的格式：JPG、PNG、WebP、HEIC/AVIF 取决于浏览器。RAW 不能由普通网页直接读取，后续要做 RAW 需要增加本地辅助程序或服务器端解码管线。
