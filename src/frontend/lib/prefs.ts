// Theme and motion preferences. Stored per browser; applied before first paint
// by PREFS_SCRIPT (inlined in the root layout) so there is no flash.

export type Theme = "dark" | "light";

export const PREFS_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem("dj-theme");d.dataset.theme=t==="light"?"light":"dark";var m=localStorage.getItem("dj-motion");if(m==="reduce"||(m===null&&matchMedia("(prefers-reduced-motion: reduce)").matches))d.dataset.motion="reduce";}catch(e){}})();`;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("dj-theme", t);
  } catch {}
  window.dispatchEvent(new CustomEvent("dj-prefs"));
}

export function reducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduce";
}

export function setReducedMotion(on: boolean) {
  if (on) document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
  try {
    localStorage.setItem("dj-motion", on ? "reduce" : "full");
  } catch {}
  window.dispatchEvent(new CustomEvent("dj-prefs"));
}
