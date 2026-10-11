export {
  optionsSchema,
  segmentSchema,
  styleSchema,
  type Job,
  type JobOptions,
  type Segment,
  type StageName,
} from "../../../shared/contracts";
export type RuntimeAccess = {
  executable(preferGpu: boolean): { path: string; backend: "cpu" | "gpu" };
  modelPath(id: string): string;
};
