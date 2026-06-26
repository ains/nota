import type { NotaBridge } from "../shared/ipc";

declare global {
  interface Window {
    nota: NotaBridge;
  }
}
