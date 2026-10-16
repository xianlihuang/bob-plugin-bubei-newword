#!/bin/bash
# 重新打包「不背生词本」插件，并输出发布 Release / 更新 appcast.json 所需信息。
# 用法：dev/package.sh
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('src/info.json'))['version'])")
ASSET="bubei-newword-v${VERSION}.bobplugin"

# 1. 打包（包内只包含 info.json / main.js / icon.png 三个文件）
rm -f "不背生词本.bobplugin"
( cd src && zip -q -X ../不背生词本.bobplugin info.json main.js icon.png )

# 2. 复制一份英文文件名的包，用作 GitHub Release 附件
cp "不背生词本.bobplugin" "$ASSET"

# 3. 输出发布所需信息
SHA=$(shasum -a 256 "$ASSET" | awk '{print $1}')
TS=$(python3 -c "import time; print(int(time.time()*1000))")
REPO="https://github.com/xianlihuang/bob-plugin-bubei-newword"

echo "打包完成：$ASSET"
echo "sha256：$SHA"
echo
echo "把下面的条目放到 appcast.json 的 versions 数组最前面（记得改 desc）："
cat <<JSON
    {
      "version": "${VERSION}",
      "desc": "请填写本次更新说明",
      "sha256": "${SHA}",
      "url": "${REPO}/releases/download/v${VERSION}/${ASSET}",
      "minBobVersion": "1.8.0",
      "timestamp": ${TS}
    }
JSON
