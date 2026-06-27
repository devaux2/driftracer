import "./ui/styles.css";
import { Game } from "./core/Game";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const container = document.getElementById("app") as HTMLElement;

if (!canvas || !container) {
  throw new Error("DRIFTRACER: missing #renderCanvas or #app in the DOM");
}

// Kick off the game. Everything (menu, race, HUD) lives inside Game.
const game = new Game(canvas, container);

// Best-effort: keep the device awake during a session if supported.
if ("wakeLock" in navigator) {
  const requestWakeLock = () =>
    (navigator as unknown as { wakeLock: { request: (t: string) => Promise<unknown> } }).wakeLock
      .request("screen")
      .catch(() => {});
  requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestWakeLock();
  });
}

// Expose for quick debugging in the console during development.
(window as unknown as { game: Game }).game = game;
