/** Update status the main process sends the UI. */
export interface UpdateState {
  /** The off status means the app runs from source or from an install that cannot update itself. */
  status: "off" | "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  current: string;
  version?: string;
  percent?: number;
  error?: string;
}
