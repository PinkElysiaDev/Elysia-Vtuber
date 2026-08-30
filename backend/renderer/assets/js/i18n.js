/**
 * VTuber Professional Console - Tactical i18n Dictionary System
 * Inspired by Seedance-Live i18n & Tactical Precision Design System
 */

const STORAGE_LOCALE_KEY = 'vtuber_locale';

const DICTIONARY = {
  // ===== 顶部指令栏 (top.*) =====
  'top.connecting': { zh: '连接中...', en: 'CONNECTING...' },
  'top.online': { zh: '在线运行', en: 'ONLINE' },
  'top.disconnected': { zh: '已断开', en: 'DISCONNECTED' },
  'top.obsDisplay': { zh: 'OBS 展示板', en: 'OBS DISPLAY' },
  'top.obsJukebox': { zh: 'OBS 点歌板', en: 'OBS JUKEBOX' },
  'top.obsNowPlaying': { zh: 'OBS 歌曲信息', en: 'OBS NOW PLAYING' },
  'top.reloadCfg': { zh: '重载配置', en: 'RELOAD CFG' },
  'top.langToggle': { zh: '中 / EN', en: 'ZH / EN' },

  // ===== 侧边导航 (nav.*) =====
  'nav.modulesLabel': { zh: '功能模块', en: 'MODULES' },
  'nav.server': { zh: '服务网络', en: 'SERVICE NETWORK' },
  'nav.tts': { zh: '语音合成', en: 'VOICE SYNTH' },
  'nav.mcp': { zh: 'MCP 接入', en: 'MCP CLIENT' },
  'nav.events': { zh: '事件接收', en: 'EVENT RECEPTION' },
  'nav.triggers': { zh: '触发器', en: 'TRIGGER RULES' },
  'nav.output': { zh: '输出策略', en: 'OUTPUT STRATEGY' },
  'nav.systemLabel': { zh: '系统管理配置', en: 'SYSTEM CONFIG' },
  'nav.dashboard': { zh: '仪表盘', en: 'DASHBOARD' },
  'nav.live2d': { zh: 'Live2D 视口工坊', en: 'LIVE2D STUDIO' },
  'nav.audio': { zh: '音频中枢路由', en: 'AUDIO ROUTER' },
  'nav.jukebox': { zh: '点歌机运营中台', en: 'JUKEBOX DECK' },
  'nav.sandbox': { zh: '事件沙盒注入', en: 'EVENT SANDBOX' },
  'nav.prompt': { zh: '提示词调试工坊', en: 'PROMPT STUDIO' },
  'nav.config': { zh: '系统配置中心', en: 'SETTINGS HUB' },

  // ===== 战术仪表盘 (dash.*) =====
  'dash.coreTelemetry': { zh: '核心遥测指标', en: 'CORE TELEMETRY' },
  'dash.boundRoom': { zh: '直播间房间号', en: 'BOUND ROOM ID' },
  'dash.totalEvents': { zh: '累计接收事件', en: 'TOTAL INGESTED EVENTS' },
  'dash.eventBusDesc': { zh: '事件总线排队处理通过数', en: 'EVENT BUS QUEUE PASS' },
  'dash.activeTriggers': { zh: '激活触发规则', en: 'ACTIVE TRIGGER RULES' },
  'dash.triggerDesc': { zh: '防抖与定时调度引擎', en: 'DEBOUNCED & CRON ENGINES' },
  'dash.subsystems': { zh: '子系统运行状态', en: 'SUBSYSTEM RUNTIME STATUS' },
  'dash.cppTitle': { zh: 'Live2D 执行器 (DirectX 11)', en: 'Live2D Executor (DirectX 11)' },
  'dash.cppDesc': { zh: '本地 IPC :19276 · 渲染 Live2D 视口（关闭不影响音频）', en: 'Local IPC :19276 · Live2D viewport (closing does not affect audio)' },
  'dash.audioTitle': { zh: '音频执行器 (Audio Engine)', en: 'Audio Executor (XAudio2)' },
  'dash.audioDesc': { zh: 'XAudio2 双通道播放引擎 · 点歌机 / TTS / 试听', en: 'XAudio2 dual-channel playback · Jukebox / TTS / preview' },
  'dash.jbTitle': { zh: '点歌机双轨播放引擎', en: 'Dual-Deck Jukebox Engine' },
  'dash.jbDesc': { zh: '多音源音频流解析与队列调度', en: 'Multi-source audio stream parser & queue processor' },
  'dash.startCpp': { zh: '启动 C++ 执行器', en: 'START C++ EXECUTOR' },
  'dash.stopCpp': { zh: '停止执行器', en: 'STOP EXECUTOR' },
  'dash.realtimeLog': { zh: '实时系统日志流', en: 'REALTIME LOG STREAM' },
  'dash.clearLog': { zh: '清空日志', en: 'CLEAR' },

  // ===== Live2D 视口工坊 (l2d.*) =====
  'l2d.modelHub': { zh: '模型资源库 (HUB)', en: 'LIVE2D MODEL HUB' },
  'l2d.scanDir': { zh: '扫描模型目录', en: 'SCAN DIRECTORY' },
  'l2d.scanBtn': { zh: '扫描', en: 'SCAN' },
  'l2d.activeModel': { zh: '当前激活模型', en: 'ACTIVE MODEL SELECTION' },
  'l2d.detailsTitle': { zh: '模型元数据概览', en: 'DISCOVERED MODEL DETAILS' },
  'l2d.noModelSelected': { zh: '未选择模型。请点击上方扫描或选择模型。', en: 'No model selected. Scan directories or select from dropdown above.' },
  'l2d.discoveredCount': { zh: '在扫描目录中发现了 {n} 个 .model3.json 模型文件。', en: 'Discovered {n} model3.json files in scanned directories.' },
  'l2d.customPath': { zh: '自定义绝对路径模式', en: 'Custom Absolute Path Mode' },
  'l2d.customPathDesc': { zh: '直接加载硬盘上的任意 .model3.json', en: 'Directly load any .model3.json on filesystem' },
  'l2d.loadBtn': { zh: '加载模型文件', en: 'LOAD MODEL FILE' },
  'l2d.transformGizmo': { zh: '视口位姿标定手柄', en: 'VIEWPORT TRANSFORM GIZMO' },
  'l2d.savePose': { zh: '保存默认开播位姿', en: 'SAVE DEFAULT POSE' },
  'l2d.scale': { zh: '缩放比例 (ZOOM)', en: 'SCALE FACTOR (ZOOM)' },
  'l2d.posX': { zh: '水平平移 (X)', en: 'HORIZONTAL OFFSET (X)' },
  'l2d.posY': { zh: '垂直平移 (Y)', en: 'VERTICAL OFFSET (Y)' },
  'l2d.resetCenter': { zh: '重置居中 (1.0x)', en: 'RESET TO 1.0 (CENTER)' },
  'l2d.matrixTitle': { zh: '表情与动作触发矩阵', en: 'EXPRESSION & MOTION TRIGGER MATRIX' },
  'l2d.resetExpr': { zh: '重置表情', en: 'RESET EXPRESSION' },
  'l2d.facialExpr': { zh: '面部表情', en: 'FACIAL EXPRESSIONS' },
  'l2d.animMotions': { zh: '动画动作', en: 'ANIMATION MOTIONS' },
  'l2d.assetRegistry': { zh: '资源注册与待机', en: 'ASSET REGISTRY & STANDBY' },
  'l2d.sniffAssets': { zh: '嗅探资源', en: 'SNIFF ASSETS' },
  'l2d.expressions': { zh: '表情库 (expressions/)', en: 'EXPRESSIONS (expressions/)' },
  'l2d.costumes': { zh: '换装库 (costumes/)', en: 'COSTUMES (costumes/)' },
  'l2d.motions': { zh: '动作库 (motions/)', en: 'MOTIONS (motions/)' },
  'l2d.uncategorized': { zh: '未分类资源文件', en: 'UNCATEGORIZED ASSET FILES' },
  'l2d.idleMode': { zh: '待机播放模式', en: 'IDLE PLAYBACK MODE' },
  'l2d.idleRandom': { zh: '随机', en: 'RANDOM' },
  'l2d.idleSequential': { zh: '顺序', en: 'SEQUENTIAL' },
  'l2d.idleInterval': { zh: '待机动作间隔(秒)', en: 'IDLE INTERVAL (SEC)' },
  'l2d.stageSettings': { zh: '模型与舞台设置', en: 'MODEL & STAGE SETTINGS' },
  'l2d.autoSaveOn': { zh: '自动保存已启用', en: 'AUTO-SAVE ENABLED' },

  // ===== 音频中枢路由 (audio.*) =====
  'audio.bgmChannel': { zh: 'BGM 点歌音乐通道', en: 'BGM CHANNEL (JUKEBOX)' },
  'audio.ttsChannel': { zh: 'TTS 语音朗读通道', en: 'TTS VOICE CHANNEL (SPEECH)' },
  'audio.playTestChime': { zh: '播放测试提示音', en: 'PLAY TEST CHIME' },
  'audio.physicalEndpoint': { zh: '物理输出声卡端点', en: 'PHYSICAL AUDIO ENDPOINT' },
  'audio.sysDefault': { zh: '[ 系统默认 WASAPI 声卡端点 ]', en: '[ SYSTEM DEFAULT WASAPI ENDPOINT ]' },
  'audio.bgmVolume': { zh: 'BGM 音量推子', en: 'BGM VOLUME SLIDER' },
  'audio.ttsVolume': { zh: 'TTS 朗读音量推子', en: 'TTS VOLUME SLIDER' },
  'audio.benchTitle': { zh: 'TTS 语音朗读基准测试', en: 'TTS SPEECH BENCHMARK & TESTER' },
  'audio.interrupt': { zh: '打断朗读', en: 'INTERRUPT SPEECH' },
  'audio.synthesizeSpeak': { zh: '合成并朗读', en: 'SYNTHESIZE & SPEAK' },
  'audio.testHolder': { zh: '输入测试语音文本，如：指挥官，作战系统已全面就绪，随时可以出击！', en: 'Enter test speech text...' },
  'audio.executorSettings': { zh: '音频执行器原生设置', en: 'AUDIO EXECUTOR SETTINGS' },

  // ===== 点歌机运营中台 (jb.*) =====
  'jb.searchTitle': { zh: '多音源歌曲搜索', en: 'MULTI-SOURCE MUSIC SEARCH' },
  'jb.qrLogin': { zh: '扫码登录模态框', en: 'QR LOGIN MODAL' },
  'jb.searchHolder': { zh: '歌曲名 / 歌手 / 歌单 URL', en: 'Song title / Artist / Playlist URL' },
  'jb.searchBtn': { zh: '搜索歌曲', en: 'SEARCH' },
  'jb.searchHint': { zh: '输入关键词在多平台搜索歌曲。', en: 'Enter keywords to search songs across providers.' },
  'jb.queueTitle': { zh: '当前待播队列', en: 'ACTIVE PLAYBACK QUEUE' },
  'jb.skip': { zh: '切歌', en: 'SKIP' },
  'jb.clearQueue': { zh: '清空待播队列', en: 'CLEAR QUEUE' },
  'jb.noTrack': { zh: '暂无正在播放曲目', en: 'NO ACTIVE TRACK' },
  'jb.standby': { zh: '待机就绪状态', en: 'STANDBY MODE' },
  'jb.queueEmpty': { zh: '待播队列为空', en: 'Queue is empty.' },
  'jb.orderedBy': { zh: '点歌用户', en: 'Ordered by' },
  'jb.orderCommands': { zh: '点歌指令配置', en: 'ORDER COMMANDS CONFIG' },
  'jb.directOrder': { zh: '直接点歌', en: 'Direct Order' },
  'jb.directOrderDesc': { zh: '弹幕以触发词开头即点歌（绕过 LLM）', en: 'Danmaku starting with a trigger keyword orders directly (bypasses LLM)' },
  'jb.genericKeywords': { zh: '通用触发词', en: 'GENERIC TRIGGER KEYWORDS' },
  'jb.channelKeywords': { zh: '渠道触发词', en: 'CHANNEL TRIGGER KEYWORDS' },
  'jb.addKeyword': { zh: '+ 指令', en: '+ KEYWORD' },
  'jb.addChannel': { zh: '+ 添加渠道', en: '+ ADD CHANNEL' },
  'jb.skipCommand': { zh: '切歌指令', en: 'SKIP COMMAND' },
  'jb.skipEnable': { zh: '启用切歌指令', en: 'Enable skip command' },
  'jb.skipCommandDesc': { zh: '观众发送切歌弹幕即跳过当前歌曲', en: 'Viewers skip the current song via danmaku' },
  'jb.skipKeywords': { zh: '切歌触发词', en: 'SKIP KEYWORDS' },
  'jb.skipSelfOnly': { zh: '仅限点歌人', en: 'Requester only' },
  'jb.skipSelfOnlyDesc': { zh: '观众只能切自己点的歌；空闲歌单曲目不受限', en: 'Viewers can only skip their own requests; idle playlist tracks are unrestricted' },
  'jb.idlePlaylist': { zh: '空闲待机歌单', en: 'IDLE STANDBY PLAYLIST' },
  'jb.idleLoop': { zh: '歌单循环', en: 'Playlist Loop' },
  'jb.idleLoopDesc': { zh: '队列为空时按空闲歌单循环播放', en: 'Loop the idle playlist when the queue is empty' },
  'jb.resolvePlaylist': { zh: '解析歌单', en: 'RESOLVE PLAYLIST' },
  'jb.nowPlayingOutputs': { zh: '歌曲信息文本输出', en: 'NOW PLAYING FILE OUTPUTS' },
  'jb.addOutput': { zh: '新增输出文件', en: 'ADD OUTPUT FILE' },
  'jb.availableVars': { zh: '可用变量 (点击在光标处插入)', en: 'AVAILABLE VARIABLES (CLICK TO INSERT)' },
  'jb.outputDir': { zh: '输出目录: backend/data/music_info/', en: 'Output Dir: backend/data/music_info/' },
  'jb.settingsTitle': { zh: '点歌机核心设置', en: 'JUKEBOX ENGINE SETTINGS' },

  // ===== 事件沙盒模拟器 (sb.*) =====
  'sb.sandboxTitle': { zh: '直播间事件注入沙盒', en: 'LIVE STREAM EVENT INJECTOR & SANDBOX' },
  'sb.presets': { zh: '快捷模拟预设', en: 'QUICK SIMULATION PRESETS' },
  'sb.danmakuBtn': { zh: '[弹幕] 打卡弹幕', en: '[DANMAKU] Chat Check-in' },
  'sb.orderBtn': { zh: '[点歌] 点歌 晴天', en: '[ORDER] Song Order' },
  'sb.skipBtn': { zh: '[切歌] 切歌', en: '[SKIP] Skip Song' },
  'sb.giftBtn': { zh: '[礼物] 10根辣条 (1000金瓜子)', en: '[GIFT] 10x Spicy Strip (1000 Coin)' },
  'sb.scBtn': { zh: '[SC] ¥50 醒目留言', en: '[SC] ¥50 SuperChat' },
  'sb.guardBtn': { zh: '[上舰] 舰长', en: '[GUARD] Captain' },
  'sb.followBtn': { zh: '[关注] 关注直播间', en: '[FOLLOW] Follow Room' },
  'sb.formTitle': { zh: '自定义事件注入表单', en: 'CUSTOM EVENT INJECTION FORM' },
  'sb.injectBtn': { zh: '注入事件处理管线', en: 'INJECT INTO PIPELINE' },
  'l2d.execAdvanced': { zh: 'LIVE2D 执行器 · 高级', en: 'LIVE2D EXECUTOR · ADVANCED' },
  'l2d.execAdvancedHint': { zh: '▸ 展开高级参数（可执行文件 / IPC / 启动行为）', en: '▸ EXPAND ADVANCED (executable / IPC / startup)' },
  'l2d.scanEmpty': { zh: '未扫描到模型。可填写模型目录后重试，或使用下方"高级"手动指定路径。', en: 'No models found. Set a scan directory or use Advanced below to specify a path manually.' },
  'sb.eventType': { zh: '事件类型 (EVENT TYPE)', en: 'EVENT TYPE' },
  'sb.userName': { zh: '用户昵称 (USER NAME)', en: 'USER NAME' },
  'sb.payload': { zh: '负载数据 (PAYLOAD / MSG)', en: 'PAYLOAD DATA' },

  'cfg.fontUpload': { zh: '上传字体', en: 'UPLOAD FONT' },
  'cfg.queueTplEdit': { zh: '编辑', en: 'EDIT' },
  'cfg.queueTplTitle': { zh: '编辑 {{queue}} 元素格式', en: 'EDIT {{queue}} ITEM FORMAT' },
  'cfg.queueTplDesc': { zh: '{{queue}} 是待播队列列表：每个元素按下面的模板渲染（列表内所有元素格式一致）。点击变量插入到模板中，留空则使用默认格式。需要多行/控制元素间距时，用单独成行的 {{ 开头、}} 结尾包裹模板——包裹内的换行会原样渲染。', en: '{{queue}} is the upcoming queue list: every item is rendered with the template below. Click a variable to insert it; leave empty for the default format. For multi-line templates or spacing control, wrap the template with a standalone {{ line and }} line — newlines inside the wrapper are rendered as-is.' },
  'cfg.queueTplLabel': { zh: '单元素模板', en: 'ITEM TEMPLATE' },
  'cfg.queueTplPreview': { zh: '预览（示例数据）', en: 'PREVIEW (SAMPLE DATA)' },
  'cfg.queueTplReset': { zh: '恢复默认', en: 'RESET DEFAULT' },
  'cfg.queueTplDone': { zh: '完成', en: 'DONE' },
  'cfg.fontClear': { zh: '清除', en: 'CLEAR' },
  'cfg.fontNone': { zh: '未设置（系统默认字体）', en: 'none (system default)' },
  'cfg.fontSaved': { zh: '字体已保存', en: 'Font saved' },
  'cfg.fontSaveFail': { zh: '字体保存失败', en: 'Font upload failed' },
  'cfg.fontCleared': { zh: '已恢复系统默认字体', en: 'Cleared to system default' },
  'nav.music': { zh: '点歌机配置', en: 'JUKEBOX CONFIG' },
  'jb.deckTitle': { zh: '播放中台', en: 'PLAYBACK DECK' },
  'jb.deckIdle': { zh: '未在播放', en: 'Not playing' },
  'jb.deckIdleTip': { zh: '当前没有播放中的曲目', en: 'Nothing is playing' },
  'jb.deckNoLyric': { zh: '暂无歌词', en: 'No lyrics' },
  'jb.historyTitle': { zh: '播放记录', en: 'PLAY HISTORY' },
  'jb.hReqAt': { zh: '点歌时间', en: 'Requested' },
  'jb.hPlayAt': { zh: '播放时间', en: 'Played' },
  'jb.hTitle': { zh: '歌名', en: 'Title' },
  'jb.hArtist': { zh: '歌手', en: 'Artist' },
  'jb.hDur': { zh: '时长', en: 'Dur' },
  'jb.hStatus': { zh: '状态', en: 'Status' },
  'jb.hUser': { zh: '点歌人', en: 'By' },
  'jb.hDone': { zh: '播完', en: 'Done' },
  'jb.hSkipped': { zh: '跳过', en: 'Skipped' },
  'jb.hInterrupted': { zh: '中断', en: 'Cut' },
  'jb.hFailed': { zh: '失败', en: 'Failed' },
  'jb.hPlaying': { zh: '播放中', en: 'Playing' },
  'jb.hEmpty': { zh: '暂无播放记录', en: 'No history yet' },
  'jb.idleGroups': { zh: '歌单列表', en: 'PLAYLISTS' },
  'jb.idleNoGroup': { zh: '尚未配置歌单（导入歌单或手动添加）', en: 'No playlists yet' },
  'jb.idleGroupEmpty': { zh: '歌单为空', en: 'Empty playlist' },
  // ===== 提示词调试工坊 (prompt.*) =====
  'mcp.title': { zh: 'MCP 接入 · 外部工具', en: 'MCP CLIENT · EXTERNAL TOOLS' },
  'mcp.refresh': { zh: '刷新', en: 'REFRESH' },
  'mcp.addTitle': { zh: '添加 MCP 服务器', en: 'ADD MCP SERVER' },
  'mcp.addBtn': { zh: '接入', en: 'ATTACH' },
  'mcp.empty': { zh: '尚未接入 MCP 服务器', en: 'No MCP servers connected' },
  'mcp.hint': { zh: '接入外部 MCP 服务器（stdio 命令 或 Streamable HTTP URL）：其工具自动注册为 mcp__服务器__工具，并出现在提示词工坊的「工具加载管理」中。', en: 'Connect external MCP servers (stdio command or Streamable HTTP URL): their tools register as mcp__server__tool and appear in Prompt Studio tool loading.' },
  'mcp.transport': { zh: '传输', en: 'TRANSPORT' },
  'mcp.transportStdio': { zh: 'stdio 命令', en: 'stdio command' },
  'mcp.transportHttp': { zh: 'HTTP URL', en: 'HTTP URL' },
  'mcp.headersHint': { zh: 'HTTP 鉴权头 JSON（可选，如 {"Authorization":"Bearer ..."}）', en: 'HTTP auth headers JSON (optional, e.g. {"Authorization":"Bearer ..."})' },
  'mcp.nameHolder': { zh: '名称（如 weather）', en: 'Name (e.g. weather)' },
  'mcp.commandHolder': { zh: '命令（如 npx -y mcp-server-weather）', en: 'Command (e.g. npx -y mcp-server-weather)' },
  'mcp.urlHolder': { zh: 'URL（如 http://127.0.0.1:3000/mcp）', en: 'URL (e.g. http://127.0.0.1:3000/mcp)' },
  'mcp.envTitle': { zh: '环境变量（可选）', en: 'Environment variables (optional)' },
  'mcp.envAdd': { zh: '+ 环境变量', en: '+ Add variable' },
  'mcp.envKeyHolder': { zh: '变量名（如 API_KEY）', en: 'Name (e.g. API_KEY)' },
  'mcp.envValueHolder': { zh: '值', en: 'Value' },
  'mcp.headersTitle': { zh: 'HTTP 请求头（鉴权等，可选）', en: 'HTTP headers (auth etc., optional)' },
  'mcp.headerAdd': { zh: '+ 请求头', en: '+ Add header' },
  'mcp.headerBearer': { zh: '+ Bearer Token', en: '+ Bearer Token' },
  'mcp.headerKeyHolder': { zh: 'Header 名（如 Authorization）', en: 'Header name (e.g. Authorization)' },
  'mcp.headerValueHolder': { zh: '值（如 Bearer eyJ...）', en: 'Value (e.g. Bearer eyJ...)' },
  'mcp.aiParse': { zh: '✨ AI 解析文档', en: '✨ Parse docs with AI' },
  'mcp.aiTitle': { zh: 'AI 解析 MCP 文档', en: 'PARSE MCP DOCS WITH AI' },
  'mcp.aiTabText': { zh: '粘贴文本', en: 'Paste text' },
  'mcp.aiTabImage': { zh: '上传截图', en: 'Screenshots' },
  'mcp.aiTabUrl': { zh: '文档 URL', en: 'Docs URL' },
  'mcp.aiRun': { zh: '立即解析', en: 'PARSE NOW' },
  'mcp.aiApply': { zh: '应用到表单', en: 'APPLY TO FORM' },
  'mcp.aiPreview': { zh: '解析结果预览', en: 'SUGGESTION PREVIEW' },
  'mcp.aiNotice': { zh: 'AI 生成内容仅供参考：请核对后再连接；密钥请自行填入，AI 不会（也不应）替你填写真实密钥。截图模式需要 vision 模型。', en: 'AI output is advisory only: review before connecting; fill in your own key — the AI never fills real credentials. Screenshot mode requires a vision model.' },
  'mcp.aiTextHolder': { zh: '粘贴 MCP 服务器的文档 / README 内容…', en: 'Paste the MCP server docs / README here…' },
  'mcp.aiUrlHolder': { zh: 'https://example.com/mcp-server#readme', en: 'https://example.com/mcp-server#readme' },
  'mcp.aiEmpty': { zh: '尚未解析', en: 'Nothing parsed yet' },
  'nav.llmmodels': { zh: 'LLM 模型库', en: 'LLM MODELS' },
  'lm.title': { zh: 'LLM 模型库 · 注册表', en: 'LLM MODELS · REGISTRY' },
  'lm.refresh': { zh: '刷新', en: 'REFRESH' },
  'lm.hint': { zh: '填写端点与参数保存即注册模型；★ 设为当前使用后该模型即生效。生成参数留空回退默认（温度 0.7 / Top P 1 / 超时 60s）。', en: 'Fill in the endpoint and save to register; star to make it active. Empty generation params fall back to defaults (temp 0.7 / topP 1 / 60s).' },
  'lm.empty': { zh: '尚未注册模型', en: 'No models registered' },
  'lm.editorTitle': { zh: '注册模型', en: 'REGISTER MODEL' },
  'lm.nameHolder': { zh: '模型名（即请求的模型 ID，如 gpt-4o-mini）', en: 'Model name (also the request model ID)' },
  'lm.baseUrlHolder': { zh: 'Base URL（如 https://api.openai.com/v1）', en: 'Base URL (e.g. https://api.openai.com/v1)' },
  'lm.apiKeyHolder': { zh: 'API Key', en: 'API Key' },
  'lm.maxTokensHolder': { zh: '最大输出 2000', en: 'Max output 2000' },
  'lm.contextHolder': { zh: '上下文窗口 200000', en: 'Context 200000' },
  'lm.tempHolder': { zh: '温度 0.7', en: 'Temp 0.7' },
  'lm.topPHolder': { zh: 'Top P 1', en: 'Top P 1' },
  'lm.timeoutHolder': { zh: '超时ms 60000', en: 'Timeout 60000' },
  'lm.thinking': { zh: '开启思考', en: 'Thinking' },
  'lm.headersTitle': { zh: '自定义请求头', en: 'Custom headers' },
  'lm.headerAdd': { zh: '+ 请求头', en: '+ Add header' },
  'lm.save': { zh: '保存', en: 'SAVE' },
  'lm.clear': { zh: '清空', en: 'CLEAR' },
  'prompt.sysTitle': { zh: '系统提示词架构设计', en: 'SYSTEM PROMPT ARCHITECTURE' },
  'prompt.save': { zh: '保存提示词', en: 'SAVE PROMPT' },
  'prompt.chipsLabel': { zh: '变量占位符 (点击在光标处插入)', en: 'VARIABLE INSERTION CHIPS (CLICK TO INSERT)' },
  'prompt.pgTitle': { zh: 'LLM 免开播调试与工具调用追踪', en: 'LLM PLAYGROUND & TOOL TRACER' },
  'prompt.runInfer': { zh: '运行试算推理', en: 'RUN INFERENCE' },
  'prompt.userInput': { zh: '用户测试输入', en: 'USER BENCHMARK INPUT' },
  'prompt.outputTrace': { zh: '模型回复与工具调用轨迹', en: 'OUTPUT RESPONSE & TOOL CALL TRACE' },
  'prompt.varRef': { zh: '变量参考', en: 'VARIABLE REFERENCE' },
  'prompt.toolLoading': { zh: '工具加载管理', en: 'TOOL LOADING' },
  'prompt.vrRoom': { zh: '直播间房间号，如 22465949', en: 'Live room ID, e.g. 22465949' },
  'prompt.vrEvents': { zh: '本次触发合并后的事件详情文本块（多事件时逐条列出）', en: 'Merged event details of this trigger, one per line' },
  'prompt.vrHistory': { zh: '最近 20 条历史事件上下文（供模型理解前情）', en: 'Context of the last 20 events' },
  'prompt.vrUser': { zh: '触发事件的用户昵称', en: 'User name of the triggering event' },
  'prompt.vrContent': { zh: '弹幕或 SC 的文本内容', en: 'Danmaku or SuperChat text content' },
  'prompt.vrNow': { zh: '当前时间，格式 YYYY-MM-DD HH:mm:ss', en: 'Current time, YYYY-MM-DD HH:mm:ss' },
  'prompt.vrNowIso': { zh: '当前时间的 ISO 8601 格式（含时区）', en: 'Current time in ISO 8601 (with timezone)' },
  'prompt.vrEventCount': { zh: '本会话累计接收的事件数', en: 'Total events received this session' },
  'prompt.vrType': { zh: '触发事件类型（danmaku/gift/superchat/…）', en: 'Event type (danmaku/gift/superchat/...)' },
  'prompt.vrEventPath': { zh: '事件对象字段路径，如 {{event.user.name}}、{{event.data.content}}', en: 'Event field path, e.g. {{event.user.name}}, {{event.data.content}}' },
  'prompt.vrExtraPath': { zh: '事件扩展数据字段路径（礼物/SC 的附加信息）', en: 'Extra data path of the event (gift/SC attachments)' },
  'prompt.pgDefaultTrace': { zh: '点击「运行试算推理」即可使用当前模型进行免开播交互评估。', en: "Click 'RUN INFERENCE' to evaluate prompt with active model without broadcasting live." },

  // ===== 系统配置中心 (cfg.*) =====
  'cfg.hubTitle': { zh: '系统核心配置中枢', en: 'CORE CONFIGURATION HUB' },
  'cfg.saveSection': { zh: '保存当前分区', en: 'SAVE CURRENT SECTION' },
  'cfg.reloadDisk': { zh: '从磁盘重载', en: 'RELOAD FROM DISK' },
  'cfg.groupService': { zh: '服务与事件', en: 'SERVICE & EVENTS' },
  'cfg.groupAutomation': { zh: '规则引擎', en: 'RULES & AUTOMATION' },
  'cfg.groupIntelligence': { zh: 'AI 认知与语音', en: 'INTELLIGENCE & VOICE' },
  'cfg.groupMedia': { zh: '媒体与展示', en: 'MEDIA & DISPLAY' },
  'cfg.groupEngine': { zh: '底层执行引擎', en: 'NATIVE ENGINE' },
  'cfg.llmGateway': { zh: '大模型网关配置 (LLM GATEWAY)', en: 'LLM PROVIDER GATEWAY' },
  'cfg.ttsEngine': { zh: '火山方舟 TTS 引擎配置 (VOLCENGINE)', en: 'TTS VOICE ENGINE (VOLCENGINE)' },
  'cfg.provider': { zh: '协议提供商', en: 'PROVIDER' },
  'cfg.baseUrl': { zh: '接口地址 (BASE URL)', en: 'BASE URL' },
  'cfg.apiKey': { zh: '访问密钥 (API KEY)', en: 'API KEY' },
  'cfg.ttsEngineType': { zh: '引擎类型', en: 'ENGINE TYPE' },
  'cfg.ttsAppId': { zh: '应用 ID (APP ID)', en: 'APP ID' },
  'cfg.ttsToken': { zh: '访问令牌 (ACCESS TOKEN)', en: 'ACCESS TOKEN' },
  'cfg.ttsVoiceType': { zh: '音色标识 (VOICE TYPE)', en: 'VOICE TYPE' },
  'cfg.musicLoginTitle': { zh: '音源账号登录与鉴权', en: 'MUSIC PROVIDER AUTHENTICATION' },
  'cfg.musicLoginHint': { zh: '选择对应平台后点击「获取二维码」，用手机官方 App 扫码登录。', en: 'Select music provider and click QR login to authenticate.' },
  'cfg.loginQrBtn': { zh: '获取登录二维码', en: 'GET QR CODE' },
  'cfg.logoutBtn': { zh: '登出当前账号', en: 'LOGOUT' },
  'cfg.applySessionBtn': { zh: '应用 Session', en: 'APPLY SESSION' },
  'cfg.refreshDevices': { zh: '刷新设备', en: 'REFRESH' },
  'cfg.triggerExpandAll': { zh: '全部展开', en: 'EXPAND ALL' },
  'cfg.triggerCollapseAll': { zh: '全部折叠', en: 'COLLAPSE ALL' },
  'cfg.addTrigger': { zh: '+ 新增触发规则', en: '+ ADD TRIGGER RULE' },
  'cfg.autoSaved': { zh: '✓ 已自动保存', en: '✓ AUTO-SAVED' },
  'cfg.autoSaving': { zh: '… 自动保存中', en: '… AUTO-SAVING' },
  'cfg.savedSuccess': { zh: '✅ 配置分区已成功保存', en: '✅ Configuration section saved successfully' },
  'cfg.saveError': { zh: '❌ 配置保存失败', en: '❌ Configuration save failed' },
  'cfg.ruleEditor': { zh: '触发规则可视化编辑器', en: 'TRIGGER RULE VISUAL EDITOR' },
  'cfg.actionPipeline': { zh: '执行动作管线', en: 'ACTION PIPELINE' },

  // ===== 模态窗 (modal.*) =====
  'modal.qrTitle': { zh: '音源扫码登录鉴权', en: 'MUSIC PROVIDER QR SCAN LOGIN' },
  'modal.qrScanHint': { zh: '请使用对应官方手机客户端扫码授权。', en: 'Scan with mobile app to authenticate.' },
  'modal.updateQr': { zh: '更新二维码', en: 'REFRESH QR' },
  'modal.manualSession': { zh: '高级：手动导入 Session (Base64)', en: 'Advanced: Manual Session (Base64)' },
  'modal.sessionPlaceholder': { zh: '粘贴由抓包或官方客户端导出的 Base64 Session 字符串...', en: 'Paste Base64 encoded session string...' },
};

class I18nManager {
  constructor() {
    this.locale = this.loadLocale();
    this.listeners = [];
  }

  loadLocale() {
    try {
      const saved = localStorage.getItem(STORAGE_LOCALE_KEY);
      if (saved === 'en' || saved === 'zh') return saved;
      return navigator.language?.startsWith('zh') ? 'zh' : 'en';
    } catch {
      return 'zh';
    }
  }

  getLocale() {
    return this.locale;
  }

  setLocale(loc) {
    if (loc !== 'zh' && loc !== 'en') return;
    this.locale = loc;
    try {
      localStorage.setItem(STORAGE_LOCALE_KEY, loc);
    } catch {}
    document.documentElement.lang = loc === 'zh' ? 'zh-CN' : 'en';
    this.applyToDOM();
    this.notifyListeners();
  }

  toggleLocale() {
    this.setLocale(this.locale === 'zh' ? 'en' : 'zh');
  }

  t(key, params) {
    const entry = DICTIONARY[key];
    let text = entry ? (entry[this.locale] || entry.zh || key) : key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v));
      }
    }
    return text;
  }

  onChange(callback) {
    this.listeners.push(callback);
  }

  notifyListeners() {
    this.listeners.forEach((fn) => {
      try { fn(this.locale); } catch (e) {}
    });
  }

  applyToDOM(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      // 防御：含元素子节点时只替换首个文本节点，避免覆写掉按钮内的徽章等子结构
      if (el.children.length > 0) {
        const firstText = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== '');
        if (firstText) firstText.textContent = ' ' + this.t(key) + ' ';
        return;
      }
      el.innerText = this.t(key);
    });

    root.querySelectorAll('[data-i18n-holder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-holder');
      if (key) {
        el.setAttribute('placeholder', this.t(key));
      }
    });

    // Update Language Toggle Button text
    const langBtn = document.getElementById('langToggleBtn');
    if (langBtn) {
      langBtn.innerText = this.locale === 'zh' ? '中 / EN' : 'EN / 中';
    }
  }
}

window.vtuberI18n = new I18nManager();
