import { CLI_VIDEO_MODEL_CATALOG } from "@/lib/cliVideoModels";

const CANVAS_IMAGE_MODEL_CATALOG = [
  {
    value: "5.0",
    title: "即梦 5.0 Lite",
    desc: "轻量快速的通用生图模型，适合快速出稿与常规图片生成。",
    when: "当用户强调快速、先出一版、通用场景时优先考虑。",
  },
  {
    value: "4.6",
    title: "Seedream 4.6",
    desc: "细节和光影表现更强，适合精细成片。",
    when: "当用户强调电影感、细节、写实、高级质感、精修成片时优先考虑。",
  },
  {
    value: "4.5",
    title: "Seedream 4.5",
    desc: "速度与画质比较均衡。",
    when: "当用户要求稳妥、均衡，没有特别极端的速度或细节诉求时适合。",
  },
  {
    value: "4.1",
    title: "Seedream 4.1",
    desc: "稳定的通用生图模型。",
    when: "当用户要稳定常规出图时可以考虑。",
  },
  {
    value: "4.0",
    title: "Seedream 4.0",
    desc: "轻量快速的图像输出模型。",
    when: "当用户主要看速度时可考虑。",
  },
] as const;

const EXTERNAL_IMAGE_MODEL_CATALOG = [
  {
    value: "gpt-image-2",
    title: "gpt-image-2",
    desc: "通用 GPT 图像模型，适合聊天窗口直生与多模态参考图理解。",
    when: "当用户在聊天窗口直生图片，或需要结合上传图片做多模态理解时优先考虑。",
  },
  {
    value: "gpt-image-2-c",
    title: "gpt-image-2-c",
    desc: "兼容型 GPT 图像模型。",
    when: "当渠道配置默认落在兼容模型时可使用。",
  },
  {
    value: "gpt-draw-2048x2048",
    title: "gpt-draw-2048x2048",
    desc: "固定正方形绘图模型。",
    when: "当用户明确需要正方形、品牌图标、海报单物体时可考虑。",
  },
  {
    value: "gpt-draw-3840x2160",
    title: "gpt-draw-3840x2160",
    desc: "更高分辨率绘图模型。",
    when: "当用户明确要求超高分辨率或大屏宽幅时可考虑。",
  },
] as const;

const PROCESS_OPERATION_CATALOG = [
  {
    value: "outpaint",
    title: "扩图",
    desc: "扩展画面边界，补全空白区域。",
  },
  {
    value: "upscale",
    title: "图片放大",
    desc: "做 2x 或 4x 高清增强，提高细节和边缘质量。",
  },
  {
    value: "retouch",
    title: "修复",
    desc: "对局部涂抹区域做修复，让画面自然融合。",
  },
  {
    value: "multiview",
    title: "多角度",
    desc: "保持主体一致，生成同一物体的不同视角版本。",
  },
  {
    value: "cutout",
    title: "智能抠图",
    desc: "识别主体边缘并抠除背景。",
  },
] as const;

const NODE_TYPE_GUIDE = [
  {
    type: "prompt",
    title: "生图节点",
    desc: "用于图片生成，可接参考图、参考视频帧、编辑输出作为素材。",
  },
  {
    type: "prompt2",
    title: "生视频节点",
    desc: "用于视频生成，可接图像、视频、首尾帧素材，支持时长、音频、参考模式。",
  },
  {
    type: "video",
    title: "视频输出节点",
    desc: "用于承接视频结果与显示进度。",
  },
  {
    type: "process",
    title: "编辑节点",
    desc: "用于扩图、放大、修复、多角度、抠图等图像编辑操作。",
  },
  {
    type: "image",
    title: "素材节点",
    desc: "用于承载本地图片或视频素材，也可承载历史素材拖入后的媒体。",
  },
  {
    type: "text",
    title: "文本节点",
    desc: "用于普通文本推理、说明、备注和非渲染对话。",
  },
  {
    type: "group",
    title: "编组节点",
    desc: "用于整理画布布局，不直接参与渲染。",
  },
] as const;

export function buildCanvasAgentKnowledgePrompt() {
  const imageModelLines = CANVAS_IMAGE_MODEL_CATALOG.map(
    (item) => `- ${item.value} / ${item.title}: ${item.desc} 使用建议：${item.when}`
  );
  const externalImageModelLines = EXTERNAL_IMAGE_MODEL_CATALOG.map(
    (item) => `- ${item.value} / ${item.title}: ${item.desc} 使用建议：${item.when}`
  );
  const videoModelLines = CLI_VIDEO_MODEL_CATALOG.map(
    (item) =>
      `- ${item.value}: ${item.title}; ${item.desc}; provider=${item.provider}; ratio=${item.defaultRatio}; resolution=${item.defaultResolution}; duration=${item.defaultDuration}s; maxCount=${item.maxCount}; reference=${item.referenceSupport}`
  );
  const processLines = PROCESS_OPERATION_CATALOG.map(
    (item) => `- ${item.value} / ${item.title}: ${item.desc}`
  );
  const nodeLines = NODE_TYPE_GUIDE.map(
    (item) => `- ${item.type} / ${item.title}: ${item.desc}`
  );

  return [
    "你还掌握一套固定的画布产品知识，回答问题和选择动作时都要参考这些知识。",
    "节点类型知识：",
    ...nodeLines,
    "画布内置图片模型知识：",
    ...imageModelLines,
    "GPT / 外部图片模型知识：",
    ...externalImageModelLines,
    "视频模型知识：",
    ...videoModelLines,
    "编辑节点操作知识：",
    ...processLines,
    "模型选择原则：",
    "- 用户强调速度、先出一版、快速草稿时，优先考虑更快的模型。",
    "- 用户强调细节、电影感、写实、高级成片时，优先考虑更强细节模型。",
    "- 用户在聊天窗口直生图片时，优先考虑 GPT 图像模型，尤其是 gpt-image-2。",
    "- 用户在画布节点里生成时，可以根据意图切换 Dreamina 生图模型、GPT 图像模型或视频模型。",
    "- 用户问当前画布正在做什么、哪个节点在跑、哪个模型适合什么任务时，你必须依据实时画布摘要和这份知识回答。",
    "- 如果用户要求使用特定模型，就尊重用户；如果用户没指定，你可以根据任务自行匹配最适合的模型。",
  ].join("\n");
}
