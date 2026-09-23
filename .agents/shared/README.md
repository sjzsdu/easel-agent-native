# Easel 共享工具（.agents/shared）

跨技能复用的工具、脚本与配置。技能通过相对路径引用（如 `../../shared/xxx`）。

## 知识文件

- `hotlist-apis.md` — 中文社媒热搜 API（60s / xxapi 聚合源，走代理；禁止直接抓平台官网）
- `pillar-and-cadence.md` — 内容支柱与发布节奏（策划三角共享知识）
- `scoring-dimensions.md` — 统一评分维度（七维 + 标尺）

## references/

- `copy-frameworks.md` — 经典文案框架（PAS/AIDA/BAB/FAB/4U/STAR/SLAY）的唯一定义源
- `hook-title-formulas.md` — 钩子/标题公式唯一定义源
- `voice-casting.md` — 多角色配音选角参考

## 脚本（scripts/）

- `social_stats.py` — 公共统计计算（互动率/环比/移动平均/加权/聚合），归因层复用，把 LLM 心算固化为确定性代码
- `wordcount.py` — 字数统计与目标字数校验（count/check/selftest，含 social_count 社媒计数口径）。文本类技能（hook-generator / video-script / social-copy / xhs-note）统一用它校验字数行数
- `render_card.py` — HTML → 图片确定性渲染（playwright + chromium，走代理加载 CDN/字体、有界超时不卡死）。卡片/slide 类产出（card-design 管线、xhs-note 出卡）统一用它出图
- `image_ops.py` — 通用图像处理确定性封装（纯 Pillow）：resize/crop/pad/convert/compress/watermark/round/collage/thumbnail/info 子命令。处理「已有图片」的加工统一用它，区别于 render_card 的「HTML 设计→渲染」
- `audio_ops.py` — 通用音频处理封装（ffmpeg）：trim/convert/normalize/extract/concat/fade/speed/denoise/info
- `video_ops.py` — 通用视频处理封装（ffmpeg）：cut/concat/speed/silence-cut/text/aspect(横竖转)/frame/gif/compress/bgm/watermark/info
- `asr.py` — 语音转字幕（faster-whisper）：transcribe → SRT/ASS/TXT/JSON，中文友好断句。配音后转字幕用它
- `tts.py` — 文字转语音配音（edge-tts）：speak（多音色/语速/字幕）/voices。口播配音用它
- `multivoice.py` — 多角色逐行多音色配音（cast.json + lines.json → voice.mp3 + SRT）。双人问答口播用它
- `subtitle_ops.py` — 字幕解析/双语合并/烧录（parse/extract/merge/build/convert/burn）
- `calendar_ops.py` — 日历底座读写（context：已发/待发/平台活动窗口）
- `ai_image.py` — AI 文生图/图生图/变体（OpenAI 兼容 + apimart 异步，用户自备 key）
- `ai_video.py` — AI 文/图生视频（provider: 通义万相/火山Seedance/可灵/OpenAI兼容，异步轮询，用户自备 key）
- `ai_music.py` — AI 音乐/BGM 生成（provider: DashScope/Suno兼容，用户自备 key）

## 依赖

- `render_card.py` 需 `pip install playwright && playwright install chromium`
- `image_ops.py` 需 `pip install Pillow`（图像处理）
- `audio_ops.py` / `video_ops.py` 需系统 `ffmpeg` + `ffprobe`
- `asr.py` 需 `pip install faster-whisper` + ffmpeg；模型放 `~/.cache/easel-models/faster-whisper-<size>/`（本环境代理下 HF 自动下载失败，需 curl 手动下 config.json/model.bin/tokenizer.json/vocabulary.txt）
- `tts.py` 需 `pip install edge-tts` + 外网代理（微软在线 TTS）
- `ai_image.py` / `ai_video.py` / `ai_music.py` 纯标准库（urllib/hmac），但需**用户自备各服务的 API key**（配 .env），见各自脚本的配置章节
- 其余脚本纯标准库，无需额外依赖
