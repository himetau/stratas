// Update status the main process sends the UI. Main checks GitHub releases, the UI shows the button
export interface UpdateState {
  /** off: running from the code or an install that can't update itself */
  status: "off" | "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  current: string;
  version?: string;
  percent?: number;
  error?: string;
}
