"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect } from "react";
import { prefersReduced } from "@/components/motion";

// Lenis is the only smoothing engine; GSAP's ticker drives it and it feeds
// ScrollTrigger, so pinned scenes and smooth scroll share one clock. Mounted
// by the landing page only, and not at all under reduced motion.
export function SmoothScroll() {
  useEffect(() => {
    if (prefersReduced()) return;
    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    // In-page anchors (#how, #run) glide instead of jumping.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a[href^="#"], a[href^="/#"]');
      if (!a) return;
      const id = a.getAttribute("href")?.split("#")[1];
      const el = id && document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el, { offset: -64 });
      history.replaceState(null, "", `#${id}`);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
  return null;
}
