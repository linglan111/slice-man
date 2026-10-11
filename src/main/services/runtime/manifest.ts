export type Artifact = { url: string; sha256: string; sizeBytes: number };
export type ModelId = "base" | "small" | "large-v3-turbo";
export type RuntimeArtifacts = {
  cpu: Artifact;
  gpu: Artifact;
  models: Record<ModelId, Artifact & { name: string }>;
};
const origin =
  "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/";
const modelOrigin =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/";
export const ENGINE_VERSION = "1.8.3";
export const CPU_ARTIFACT: Artifact = {
  url: `${origin}whisper-bin-x64.zip`,
  sha256: "d824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d",
  sizeBytes: 3968674,
};
export const GPU_ARTIFACT: Artifact = {
  url: `${origin}whisper-cublas-12.4.0-bin-x64.zip`,
  sha256: "c12a563333d3c3707be70754dc0e87c1cb58aa6333a87055bbcf9b524488dfb0",
  sizeBytes: 459854042,
};
export const MODELS: Record<ModelId, Artifact & { name: string }> = {
  base: {
    name: "轻量 · Base（多语言）",
    url: `${modelOrigin}ggml-base.bin`,
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    sizeBytes: 147951465,
  },
  small: {
    name: "均衡 · Small（多语言）",
    url: `${modelOrigin}ggml-small.bin`,
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    sizeBytes: 487601967,
  },
  "large-v3-turbo": {
    name: "高质量 · Large v3 Turbo",
    url: `${modelOrigin}ggml-large-v3-turbo.bin`,
    sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    sizeBytes: 1624555275,
  },
};
