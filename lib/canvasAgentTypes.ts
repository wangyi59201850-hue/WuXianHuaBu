export const CANVAS_AGENT_IMAGE_RATIOS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
  "21:9",
] as const;

export const CANVAS_AGENT_VIDEO_RATIOS = [
  "1:1",
  "3:4",
  "16:9",
  "4:3",
  "9:16",
  "21:9",
] as const;

export const CANVAS_AGENT_IMAGE_RESOLUTIONS = ["1k", "2k", "4k"] as const;
export const CANVAS_AGENT_VIDEO_RESOLUTIONS = ["720p", "1080p"] as const;

export type CanvasAgentRole = "user" | "assistant";
export type CanvasAgentActionType =
  | "chat"
  | "generate_image"
  | "generate_video"
  | "ask_generation_path";
export type CanvasAgentProviderId = "default_gpt" | "foropencode" | "google" | "banana2";
export type CanvasAgentImageProvider = "dreamina" | "aiwanwu";

export type CanvasAgentHistoryMessage = {
  id?: string;
  role: CanvasAgentRole;
  text: string;
  mediaUrls?: string[];
  mediaKind?: "image" | "video";
  pendingAction?: Extract<CanvasAgentAction, { type: "ask_generation_path" }>;
  isStreaming?: boolean;
};

export type CanvasAgentCanvasNodeType =
  | "prompt"
  | "prompt2"
  | "video"
  | "text"
  | "process"
  | "image"
  | "group";

export type CanvasAgentCanvasNodeSummary = {
  id: string;
  type: CanvasAgentCanvasNodeType;
  selected: boolean;
  label: string;
  nodeName?: string;
  promptText?: string;
  hasRenderableMedia?: boolean;
  mediaKind?: "image" | "video" | null;
  canReference?: boolean;
  status?: "idle" | "running" | "error" | "done";
  error?: string | null;
  modelVersion?: string;
  imageProvider?: CanvasAgentImageProvider;
  externalApiProviderId?: CanvasAgentProviderId;
  operation?: string;
  ratio?: string;
  resolutionType?: string;
  count?: number;
  durationSeconds?: number;
  withAudio?: boolean;
  referenceMode?: "general" | "headtail";
  outputCount?: number;
  connectedNodeIds?: string[];
  incomingNodeIds?: string[];
  outgoingNodeIds?: string[];
  materialOrder?: string[];
  imageOrder?: string[];
  videoOrder?: string[];
  streamStatusLine?: string | null;
  lastSubmitId?: string | null;
};

export type CanvasAgentCanvasEdgeSummary = {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType?: CanvasAgentCanvasNodeType;
  targetType?: CanvasAgentCanvasNodeType;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type CanvasAgentCanvasSummary = {
  nodeCount: number;
  edgeCount: number;
  selectedNodeIds: string[];
  externalApiProviderId?: CanvasAgentProviderId;
  externalApiImageModel?: string;
  externalApiTextModel?: string;
  nodes: CanvasAgentCanvasNodeSummary[];
  edges: CanvasAgentCanvasEdgeSummary[];
};

export type CanvasAgentDefaults = {
  imageCount: number;
  imageRatio: (typeof CANVAS_AGENT_IMAGE_RATIOS)[number];
  imageResolution: (typeof CANVAS_AGENT_IMAGE_RESOLUTIONS)[number];
  videoCount: number;
  videoRatio: (typeof CANVAS_AGENT_VIDEO_RATIOS)[number];
  videoResolution: (typeof CANVAS_AGENT_VIDEO_RESOLUTIONS)[number];
  videoDurationSeconds: number;
  videoWithAudio: boolean;
};

export type CanvasAgentRequest = {
  message: string;
  history?: CanvasAgentHistoryMessage[];
  canvasSummary?: CanvasAgentCanvasSummary;
  defaults?: CanvasAgentDefaults;
  model?: string;
  providerId?: CanvasAgentProviderId;
  directImageDataUrls?: string[];
};

export type CanvasAgentAction =
  | {
      type: "chat";
    }
  | {
      type: "ask_generation_path";
      target: "image" | "video";
      prompt: string;
      reply?: string;
      reasoningSummary?: string;
      count?: number;
      ratio?: string;
      resolutionType?: string;
      durationSeconds?: number;
      withAudio?: boolean;
      imageProvider?: CanvasAgentImageProvider;
      modelVersion?: string;
      targetNodeId?: string;
      referenceNodeIds?: string[];
    }
  | {
      type: "generate_image";
      prompt: string;
      reply?: string;
      reasoningSummary?: string;
      count?: number;
      ratio?: (typeof CANVAS_AGENT_IMAGE_RATIOS)[number];
      resolutionType?: (typeof CANVAS_AGENT_IMAGE_RESOLUTIONS)[number];
      imageProvider?: CanvasAgentImageProvider;
      modelVersion?: string;
      targetNodeId?: string;
      referenceNodeIds?: string[];
    }
  | {
      type: "generate_video";
      prompt: string;
      reply?: string;
      reasoningSummary?: string;
      count?: number;
      ratio?: (typeof CANVAS_AGENT_VIDEO_RATIOS)[number];
      resolutionType?: (typeof CANVAS_AGENT_VIDEO_RESOLUTIONS)[number];
      durationSeconds?: number;
      withAudio?: boolean;
      modelVersion?: string;
      targetNodeId?: string;
      referenceNodeIds?: string[];
    };

export type CanvasAgentResponse = {
  ok: true;
  reply: string;
  reasoningSummary?: string | null;
  action: CanvasAgentAction;
  model?: string;
};
