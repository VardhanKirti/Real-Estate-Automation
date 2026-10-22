/**
 * The no-flash intro start for a hard load (03.3.2). Rendered first inside the /lab layout; runs before
 * first paint and evaluates the same rule as `shouldPlayIntro`: reduced motion or a hidden tab never
 * plays; a scope already marked in sessionStorage never replays. It marks `aurora` as played at once
 * (the intro starts now) and leaves `today` for Today's `useLabIntro` to mark, because only Today plays
 * that scope. The source is a fixed string, never interpolated (CSP-safe, like the appearance
 * pre-script), and touches only sessionStorage, matchMedia, document.documentElement,
 * document.visibilityState and performance.now (AC-03-14).
 */
export const LAB_INTRO_SCRIPT =
  "(function(){try{var h=document.documentElement;if(document.visibilityState==='hidden')return;" +
  "if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;" +
  "var s=[],a=null,t=null;try{a=sessionStorage.getItem('lab.intro.aurora');t=sessionStorage.getItem('lab.intro.today');}catch(e){}" +
  "if(a!=='1')s.push('aurora');if(t!=='1')s.push('today');if(!s.length)return;" +
  "h.setAttribute('data-lab-intro','play');h.setAttribute('data-lab-intro-scope',s.join(' '));" +
  "h.setAttribute('data-lab-intro-t0',String(performance.now()));" +
  "try{sessionStorage.setItem('lab.intro.aurora','1');}catch(e){}}catch(e){}})();";

export function LabIntroScript() {
  return <script id="lab-intro" dangerouslySetInnerHTML={{ __html: LAB_INTRO_SCRIPT }} />;
}
