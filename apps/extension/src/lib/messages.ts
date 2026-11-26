import type { Config, ConfigEdit, Status } from "@undoom/engine";

export interface View {
  signedIn: boolean;
  /** False until the first snapshot arrives; editing before then would overwrite the server's config. */
  loaded: boolean;
  /** Server time. */
  now: number;
  config: Config;
  desired: ConfigEdit;
  statuses: Record<string, Status>;
  unsynced: boolean;
}

export interface Result {
  error: string | null;
}

export type Request =
  | { type: "view" }
  | { type: "signIn" }
  | { type: "signOut" }
  | { type: "addPasskey" }
  | { type: "saveConfig"; edit: ConfigEdit }
  | { type: "unlock"; targetId: string };

export type Response<R extends Request> = R extends { type: "view" } ? View : Result;
