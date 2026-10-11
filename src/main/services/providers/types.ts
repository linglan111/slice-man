export {
  profileInputSchema,
  type Profile,
  type ProfileInput,
} from "../../../shared/contracts";
export type ProviderSecret = {
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  isEncryptionAvailable(): boolean;
};
