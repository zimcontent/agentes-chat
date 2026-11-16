import { isolatedPage } from "./isolated-page";

/*
 * The editor's side inside a design piece (docs/adr/doug-0010-design-review.md). The piece is an agent's page, so it
 * runs where every agent page runs (ADR 0019): a sandboxed frame with an opaque origin and no network. This script
 * goes in first and talks to the app only by `postMessage`: it shows one slide at a time, finds what can be edited
 * on it (what the agent marked `data-layer`, or else its pictures, texts and shapes), and does the editing itself:
 * select, move with guides, resize and rotate from the handles or with two fingers, rewrite a text in place, and the
 * changes the side panel asks for. Every change is kept as the element's own inline style or content, so the page it
 * hands back on save is the piece itself, without a trace of the editor.
 *
 * Plain ES5 in a string: it runs as written inside the piece, whatever the app is built to.
 */
const BRIDGE = String.raw`(function(){
var P = window.parent;
// In the phone app the piece is a WebView's page of its own: it speaks through the app's channel, and the app's
// commands come through window.__ed (injected), not a parent frame's postMessage.
var RN = window.ReactNativeWebView;
function post(m){ try { if (RN) RN.postMessage(JSON.stringify(m)); else P.postMessage(m, "*"); } catch (e) {} }
function mem(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){var k=Object.keys(d)[i];return k===undefined?null:k},get length(){return Object.keys(d).length}}}
["localStorage","sessionStorage"].forEach(function(n){try{void window[n].length}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(_){}}});
try{void document.cookie}catch(e){try{Object.defineProperty(document,"cookie",{get:function(){return""},set:function(){},configurable:true})}catch(_){}}

var LIME = "#9cfa05";
var st = { mode: "view", slide: 1, k: 1, sel: null, multi: [], adding: false, editing: null, words: {} };
var slides = [];
var byId = {};
var original = {};
var seq = 0;
var past = [];
var future = [];
var drag = null;
var pointers = {};
var lastTap = { el: null, at: 0 };
var guidesEl = null, boxEl = null, hoverEl = null;

var css = document.createElement("style");
css.setAttribute("data-ed-ui", "1");
css.textContent = [
  "html.ed-one,html.ed-one body{margin:0!important;padding:0!important;overflow:hidden!important;min-height:0!important;background:transparent!important}",
  "html.ed-one .ed-slide:not(.ed-active){display:none!important}",
  "html.ed-one .ed-slide.ed-active{position:relative!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;margin:0!important}",
  "html.ed-edit,html.ed-edit *{touch-action:none}",
  "html.ed-edit [data-ed-id]{cursor:move}",
  "html.ed-edit [contenteditable=true]{cursor:text;outline:none;user-select:text;-webkit-user-select:text}",
  "html.ed-edit{user-select:none;-webkit-user-select:none}",
  "[data-ed-ui]{position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box}",
  ".ed-box{border:calc(1.5px*var(--ed-u,1)) solid " + LIME + ";box-shadow:0 0 0 calc(1px*var(--ed-u,1)) rgba(0,0,0,.35)}",
  ".ed-hover{border:calc(1px*var(--ed-u,1)) dashed rgba(156,250,5,.85)}",
  ".ed-box.ed-texting{border-style:dashed}",
  ".ed-h{position:absolute;width:calc(14px*var(--ed-u,1));height:calc(14px*var(--ed-u,1));margin:calc(-7px*var(--ed-u,1)) 0 0 calc(-7px*var(--ed-u,1));background:#0a0a0a;border:calc(2px*var(--ed-u,1)) solid " + LIME + ";border-radius:calc(4px*var(--ed-u,1));pointer-events:auto;box-sizing:border-box}",
  ".ed-h[data-h=nw]{left:0;top:0;cursor:nwse-resize}.ed-h[data-h=ne]{left:100%;top:0;cursor:nesw-resize}.ed-h[data-h=sw]{left:0;top:100%;cursor:nesw-resize}.ed-h[data-h=se]{left:100%;top:100%;cursor:nwse-resize}",
  ".ed-h[data-h=rot]{left:50%;top:calc(-28px*var(--ed-u,1));border-radius:50%;cursor:grab;background:" + LIME + ";border-color:#0a0a0a}",
  ".ed-stem{position:absolute;left:50%;top:calc(-21px*var(--ed-u,1));width:calc(1.5px*var(--ed-u,1));height:calc(21px*var(--ed-u,1));background:" + LIME + ";transform:translateX(-50%)}",
  ".ed-g{position:fixed;pointer-events:none;z-index:2147483645;background:#ff4fd8}",
  // On a touchscreen the handle stays small to the eye (it would cover a short word) and its target grows past it.
  ".ed-h::after{content:'';position:absolute;inset:calc(-6px*var(--ed-u,1));border-radius:50%}",
  "@media (pointer:coarse){.ed-h{width:calc(16px*var(--ed-u,1));height:calc(16px*var(--ed-u,1));margin:calc(-8px*var(--ed-u,1)) 0 0 calc(-8px*var(--ed-u,1))}.ed-h::after{inset:calc(-14px*var(--ed-u,1))}}"
].join("");
document.head.appendChild(css);

function words(k, d){ return (st.words && st.words[k]) || d; }
function px(v){ var n = parseFloat(v); return isFinite(n) ? n : 0; }
function hex(c){
  if (!c) return null;
  var m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+%?))?/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  function h(n){ var s = Math.round(+n).toString(16); return s.length < 2 ? "0" + s : s; }
  return "#" + h(m[1]) + h(m[2]) + h(m[3]);
}

// ---------- slides and layers ----------

function findSlides(){
  var list = Array.prototype.slice.call(document.querySelectorAll("[data-slide]"));
  if (!list.length) list = Array.prototype.slice.call(document.querySelectorAll("section.slide, .slide"));
  list = list.filter(function(el){ return !list.some(function(o){ return o !== el && o.contains(el); }); });
  if (!list.length) list = [document.body];
  return list;
}

function visibleBox(el, cs){
  return cs.backgroundImage !== "none" || hex(cs.backgroundColor) !== null || px(cs.borderTopWidth) > 0 ||
    px(cs.borderLeftWidth) > 0 || (cs.boxShadow && cs.boxShadow !== "none") ||
    ((cs.backdropFilter || cs.webkitBackdropFilter || "none") !== "none");
}
function ownText(el){
  for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
  return false;
}
function onlyChild(parent, el){
  var kids = Array.prototype.filter.call(parent.children, function(c){ return c.tagName !== "BR"; });
  return kids.length === 1 && kids[0] === el && !ownText(parent);
}
var MEDIA = { IMG: 1, SVG: 1, svg: 1, VIDEO: 1, CANVAS: 1, PICTURE: 1 };

function collect(slide, marked){
  var out = [];
  if (marked) {
    Array.prototype.forEach.call(slide.querySelectorAll("[data-layer]"), function(el){ out.push(el); });
    return out;
  }
  var area = slide.offsetWidth * slide.offsetHeight || 1;
  function promote(el){
    var p = el.parentElement;
    while (p && p !== slide && onlyChild(p, el)) {
      var cs = getComputedStyle(p);
      if (visibleBox(p, cs) || cs.overflow === "hidden" || px(cs.borderTopLeftRadius) > 0) { el = p; p = el.parentElement; }
      else break;
    }
    return el;
  }
  function walk(el){
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (/^(SCRIPT|STYLE|BR|TEMPLATE|LINK|META)$/.test(c.tagName)) continue;
      var cs = getComputedStyle(c);
      if (cs.display === "none") continue;
      if (MEDIA[c.tagName]) { var m = promote(c); if (out.indexOf(m) < 0) out.push(m); continue; }
      if (ownText(c)) { var t = promote(c); if (out.indexOf(t) < 0) out.push(t); continue; }
      var r = c.getBoundingClientRect();
      var big = r.width * r.height >= area * 0.9;
      if (!c.firstElementChild) {
        if (visibleBox(c, cs) && !big && r.width * r.height > 16) out.push(c);
        continue;
      }
      walk(c);
    }
  }
  walk(slide);
  return out;
}

function kindOf(el){
  if (MEDIA[el.tagName] || el.querySelector("img,svg,video,canvas,picture")) {
    if (ownText(el) || (el.innerText || "").trim()) return "text";
    return "image";
  }
  if ((el.innerText || "").trim()) return "text";
  return "shape";
}
function imageOf(el){ return el.tagName === "IMG" ? el : el.querySelector("img"); }
function nameOf(el, kind){
  var given = el.getAttribute("data-layer");
  if (given) return given;
  if (kind === "text") {
    var t = (el.innerText || "").replace(/\s+/g, " ").trim();
    return words("text", "Text") + " · " + (t.length > 28 ? t.slice(0, 27) + "…" : t);
  }
  var hint = ((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || "") + " " +
    (el.getAttribute("alt") || "") + " " + ((imageOf(el) && imageOf(el).getAttribute("alt")) || "");
  if (/logo|marca|brand|simb/i.test(hint)) return words("logo", "Logo");
  if (kind === "image") return words("photo", "Photo");
  return words("shape", "Shape");
}

function snapshot(el){
  var img = imageOf(el);
  return {
    style: el.getAttribute("style"),
    html: kindOf(el) === "text" ? el.innerHTML : null,
    src: img ? img.getAttribute("src") : null,
    imgStyle: img && img !== el ? img.getAttribute("style") : null
  };
}
function restore(el, s){
  if (s.style === null) el.removeAttribute("style"); else el.setAttribute("style", s.style);
  if (s.html !== null && el.innerHTML !== s.html) el.innerHTML = s.html;
  var img = imageOf(el);
  if (img && s.src !== null && img.getAttribute("src") !== s.src) { img.setAttribute("src", s.src); img.removeAttribute("srcset"); }
  if (img && img !== el) { if (s.imgStyle === null) img.removeAttribute("style"); else img.setAttribute("style", s.imgStyle); }
}

function setup(){
  slides = findSlides();
  var marked = !!document.querySelector("[data-layer]");
  slides.forEach(function(s, i){
    s.classList.add("ed-slide");
    collect(s, marked).forEach(function(el){
      var id = "l" + (++seq);
      el.setAttribute("data-ed-id", id);
      byId[id] = { el: el, slide: i + 1 };
      original[id] = snapshot(el);
    });
  });
  if (slides.length > 1 || slides[0] !== document.body) document.documentElement.classList.add("ed-one");
}

function layerAt(x, y){
  var stack = document.elementsFromPoint(x, y);
  for (var i = 0; i < stack.length; i++) {
    var el = stack[i].closest ? stack[i].closest("[data-ed-id]") : null;
    if (el && byId[el.getAttribute("data-ed-id")].slide === st.slide && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

// ---------- telling the app ----------

function sizeOf(){ var s = slides[st.slide - 1]; return { w: s.offsetWidth || 1080, h: s.offsetHeight || 1350 }; }
function layersMsg(){
  var list = [];
  Object.keys(byId).forEach(function(id){
    var l = byId[id];
    if (l.slide !== st.slide) return;
    var kind = kindOf(l.el);
    list.push({ id: id, name: nameOf(l.el, kind), kind: kind, hidden: l.el.style.visibility === "hidden" });
  });
  list.reverse();
  post({ ed: "layers", slide: st.slide, layers: list });
}
function info(el){
  if (!el) return null;
  var cs = getComputedStyle(el);
  var kind = kindOf(el);
  var img = imageOf(el);
  var simple = kind === "text" && !Array.prototype.some.call(el.querySelectorAll("*"), function(c){ return c.tagName !== "BR"; });
  var ics = img ? getComputedStyle(img) : null;
  var pos = ics ? ics.objectPosition.split(" ") : null;
  return {
    id: el.getAttribute("data-ed-id"),
    name: nameOf(el, kind),
    kind: kind,
    text: simple ? el.innerText : null,
    fontSize: Math.round(px(cs.fontSize)),
    color: hex(cs.color),
    fill: kind === "shape" ? hex(cs.backgroundColor) : null,
    opacity: Math.round(parseFloat(cs.opacity) * 100),
    rotate: Math.round(px(el.style.rotate || cs.rotate)),
    scale: Math.round((parseFloat(el.style.scale || (cs.scale === "none" ? "1" : cs.scale)) || 1) * 100),
    hidden: el.style.visibility === "hidden",
    image: img ? { fit: ics.objectFit || "fill", x: Math.round(px(pos && pos[0] || "50")), y: Math.round(px(pos && pos[1] || "50")) } : null,
    parent: !!groupOf(el)
  };
}
function selMsg(){ post({ ed: "selected", info: info(st.sel), count: st.multi.length }); }
function historyMsg(){ post({ ed: "history", changes: past.length, undo: past.length > 0, redo: future.length > 0 }); }

function colors(){
  var seen = {};
  Array.prototype.forEach.call(document.body.querySelectorAll("*"), function(el){
    if (el.closest("[data-ed-ui]")) return;
    var cs = getComputedStyle(el);
    [hex(cs.color), hex(cs.backgroundColor)].forEach(function(c){ if (c) seen[c] = (seen[c] || 0) + 1; });
  });
  return Object.keys(seen).sort(function(a, b){ return seen[b] - seen[a]; }).slice(0, 10);
}

// ---------- the selection's box and the guides ----------

function ui(cls){ var d = document.createElement("div"); d.setAttribute("data-ed-ui", "1"); d.className = cls; document.body.appendChild(d); return d; }
function drawBox(){
  document.documentElement.style.setProperty("--ed-u", String(1 / (st.k || 1)));
  if (!st.sel || st.mode !== "edit") { if (boxEl) { boxEl.remove(); boxEl = null; } return; }
  if (!boxEl) {
    boxEl = ui("ed-box");
    boxEl.innerHTML = '<div class="ed-stem"></div><div class="ed-h" data-h="rot"></div><div class="ed-h" data-h="nw"></div><div class="ed-h" data-h="ne"></div><div class="ed-h" data-h="sw"></div><div class="ed-h" data-h="se"></div>';
  }
  var r = union(st.multi.length ? st.multi : [st.sel]);
  boxEl.style.left = r.left + "px"; boxEl.style.top = r.top + "px";
  boxEl.style.width = r.width + "px"; boxEl.style.height = r.height + "px";
  boxEl.classList.toggle("ed-texting", !!st.editing);
  var bare = !!st.editing || st.multi.length > 1;
  Array.prototype.forEach.call(boxEl.querySelectorAll(".ed-h,.ed-stem"), function(h){ h.style.display = bare ? "none" : ""; });
}
function union(els){
  var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  els.forEach(function(el){ var x = el.getBoundingClientRect(); l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom); });
  return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
}
function drawHover(el){
  if (!el || st.multi.indexOf(el) >= 0 || st.mode !== "edit" || drag) { if (hoverEl) { hoverEl.remove(); hoverEl = null; } return; }
  if (!hoverEl) hoverEl = ui("ed-hover");
  var r = el.getBoundingClientRect();
  hoverEl.style.left = r.left + "px"; hoverEl.style.top = r.top + "px";
  hoverEl.style.width = r.width + "px"; hoverEl.style.height = r.height + "px";
}
function drawGuides(lines){
  if (guidesEl) guidesEl.forEach(function(g){ g.remove(); });
  guidesEl = (lines || []).map(function(l){
    var g = document.createElement("div"); g.className = "ed-g"; g.setAttribute("data-ed-ui", "1");
    var u = 1 / (st.k || 1);
    if (l.x !== undefined) { g.style.left = l.x + "px"; g.style.top = "0"; g.style.width = u + "px"; g.style.height = "100%"; }
    else { g.style.top = l.y + "px"; g.style.left = "0"; g.style.height = u + "px"; g.style.width = "100%"; }
    document.body.appendChild(g); return g;
  });
}

// ---------- changes and history ----------

function record(el, before, key){ recordMany([{ el: el, before: before }], key); }
function recordMany(list, key){
  var items = [];
  list.forEach(function(x){
    var after = snapshot(x.el);
    if (JSON.stringify(x.before) !== JSON.stringify(after)) items.push({ id: x.el.getAttribute("data-ed-id"), before: x.before, after: after });
  });
  if (!items.length) return;
  var last = past[past.length - 1];
  var now = Date.now();
  var sameAs = last && key && last.key === key && now - last.at < 900 && last.items.length === items.length &&
    last.items.every(function(it, i){ return it.id === items[i].id; });
  if (sameAs) { last.items.forEach(function(it, i){ it.after = items[i].after; }); last.at = now; }
  else past.push({ items: items, key: key || null, at: now });
  future = [];
  historyMsg();
}
function travel(from, to, back){
  var step = from.pop();
  if (!step) return;
  to.push(step);
  var els = step.items.map(function(it){ var l = byId[it.id]; restore(l.el, back ? it.before : it.after); return l; });
  if (els[0].slide !== st.slide) goSlide(els[0].slide);
  select(els[0].el);
  els.slice(1).forEach(function(l){ select(l.el, true); });
  layersMsg();
  historyMsg();
}

function transformOf(el){
  var cs = getComputedStyle(el);
  var t = (el.style.translate || (cs.translate === "none" ? "" : cs.translate) || "0px 0px").split(" ");
  var s = el.style.scale || (cs.scale === "none" ? "1" : cs.scale);
  return { x: px(t[0]), y: px(t[1] || "0"), s: parseFloat(s) || 1, r: px(el.style.rotate || (cs.rotate === "none" ? "0" : cs.rotate)) };
}
function setTransform(el, t){
  el.style.translate = Math.round(t.x * 10) / 10 + "px " + Math.round(t.y * 10) / 10 + "px";
  el.style.scale = String(Math.round(t.s * 1000) / 1000);
  el.style.rotate = Math.round(t.r * 10) / 10 + "deg";
}

function groupOf(el){
  var p = el.parentElement;
  var slide = slides[st.slide - 1];
  if (!p || p === slide || p === document.body) return null;
  var inside = Object.keys(byId).filter(function(id){ return p.contains(byId[id].el); }).length;
  return inside > 1 ? p : null;
}

function apply(id, patch){
  var l = byId[id];
  if (!l) return;
  var many = st.multi.length > 1 && st.multi.indexOf(l.el) >= 0 &&
    (patch.hidden !== undefined || patch.opacity !== undefined || patch.z !== undefined || patch.reset);
  var targets = many ? st.multi.slice() : [l.el];
  var list = targets.map(function(el){ return { el: el, before: snapshot(el) }; });
  targets.forEach(function(el){ change(el, patch); });
  recordMany(list, patch.key);
  if (patch.hidden !== undefined || patch.text !== undefined) layersMsg();
  drawBox();
  selMsg();
}
function change(el, patch){
  var id = el.getAttribute("data-ed-id");
  var t;
  if (patch.text !== undefined) {
    el.innerHTML = String(patch.text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  }
  if (patch.fontSize !== undefined) el.style.fontSize = patch.fontSize + "px";
  if (patch.color !== undefined) el.style.color = patch.color;
  if (patch.fill !== undefined) el.style.background = patch.fill;
  if (patch.opacity !== undefined) el.style.opacity = String(patch.opacity / 100);
  if (patch.rotate !== undefined || patch.scale !== undefined) {
    t = transformOf(el);
    if (patch.rotate !== undefined) t.r = patch.rotate;
    if (patch.scale !== undefined) t.s = patch.scale / 100;
    setTransform(el, t);
  }
  if (patch.hidden !== undefined) el.style.visibility = patch.hidden ? "hidden" : "";
  if (patch.z !== undefined) {
    var cs = getComputedStyle(el);
    if (cs.position === "static") el.style.position = "relative";
    el.style.zIndex = String((parseInt(cs.zIndex, 10) || 0) + patch.z);
  }
  var img = imageOf(el);
  if (img && patch.src !== undefined) { img.setAttribute("src", patch.src); img.removeAttribute("srcset"); }
  if (img && patch.fit !== undefined) img.style.objectFit = patch.fit;
  if (img && (patch.posX !== undefined || patch.posY !== undefined)) {
    var pos = getComputedStyle(img).objectPosition.split(" ");
    img.style.objectPosition = (patch.posX !== undefined ? patch.posX : px(pos[0])) + "% " + (patch.posY !== undefined ? patch.posY : px(pos[1] || "50")) + "%";
  }
  if (patch.reset) restore(el, original[id]);
}

// ---------- selecting and editing ----------

function select(el, add){
  if (st.editing && st.editing !== el) stopText();
  if (add && el) {
    var i = st.multi.indexOf(el);
    if (i >= 0 && st.multi.length > 1) { st.multi.splice(i, 1); el = st.multi[st.multi.length - 1]; }
    else if (i < 0) st.multi.push(el);
  } else st.multi = el ? [el] : [];
  st.sel = el;
  drawBox();
  drawHover(null);
  selMsg();
}
function startText(el){
  if (kindOf(el) !== "text") return;
  st.editing = el;
  el._before = snapshot(el);
  el.setAttribute("contenteditable", "true");
  el.focus();
  var r = document.createRange(); r.selectNodeContents(el);
  var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  drawBox();
  post({ ed: "texting", on: true });
}
function stopText(){
  var el = st.editing;
  if (!el) return;
  st.editing = null;
  el.removeAttribute("contenteditable");
  try { window.getSelection().removeAllRanges(); } catch (e) {}
  record(el, el._before);
  delete el._before;
  layersMsg();
  drawBox();
  selMsg();
  post({ ed: "texting", on: false });
}

function goSlide(n){
  st.slide = Math.max(1, Math.min(slides.length, n));
  slides.forEach(function(s, i){ s.classList.toggle("ed-active", i === st.slide - 1); });
  if (st.sel && byId[st.sel.getAttribute("data-ed-id")].slide !== st.slide) select(null);
  if (st.adding) st.multi = st.multi.filter(function(m){ return byId[m.getAttribute("data-ed-id")].slide === st.slide; });
  var z = sizeOf();
  post({ ed: "slide", slide: st.slide, w: z.w, h: z.h });
  layersMsg();
}

function setMode(mode){
  if (st.editing) stopText();
  st.mode = mode;
  document.documentElement.classList.toggle("ed-edit", mode === "edit");
  if (mode !== "edit") select(null);
  drawBox();
}

// ---------- pointer ----------

function rectsBut(els){
  var out = [];
  Object.keys(byId).forEach(function(id){
    var l = byId[id];
    if (l.slide !== st.slide || els.some(function(el){ return l.el === el || l.el.contains(el) || el.contains(l.el); })) return;
    if (getComputedStyle(l.el).visibility === "hidden") return;
    out.push(l.el.getBoundingClientRect());
  });
  var s = slides[st.slide - 1].getBoundingClientRect();
  out.push({ left: s.left, right: s.right, top: s.top, bottom: s.bottom, width: s.width, height: s.height, slide: true });
  return out;
}
function snapMove(d){
  var r = d.rect, near = 6 / (st.k || 1), lines = [];
  var xs = [r.left + d.dx, r.left + d.dx + r.width / 2, r.right + d.dx];
  var ys = [r.top + d.dy, r.top + d.dy + r.height / 2, r.bottom + d.dy];
  var bx = null, by = null;
  d.others.forEach(function(o){
    var ox = [o.left, o.left + o.width / 2, o.right], oy = [o.top, o.top + o.height / 2, o.bottom];
    xs.forEach(function(x){ ox.forEach(function(t){ var gap = t - x; if (Math.abs(gap) <= near && (bx === null || Math.abs(gap) < Math.abs(bx.gap))) bx = { gap: gap, at: t }; }); });
    ys.forEach(function(y){ oy.forEach(function(t){ var gap = t - y; if (Math.abs(gap) <= near && (by === null || Math.abs(gap) < Math.abs(by.gap))) by = { gap: gap, at: t }; }); });
  });
  if (bx) { d.dx += bx.gap; lines.push({ x: bx.at }); }
  if (by) { d.dy += by.gap; lines.push({ y: by.at }); }
  drawGuides(lines);
}

document.addEventListener("pointerdown", function(e){
  if (st.mode !== "edit") return;
  // The presses below keep the browser from selecting text, which also keeps the focus out: take it, for the keys.
  try { window.focus(); } catch (err) {}
  pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var ids = Object.keys(pointers);
  if (ids.length === 2 && st.sel && !st.editing) {
    var a = pointers[ids[0]], b = pointers[ids[1]];
    drag = { kind: "pinch", el: st.sel, before: snapshot(st.sel), t0: transformOf(st.sel),
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    e.preventDefault();
    return;
  }
  var handle = e.target && e.target.getAttribute && e.target.getAttribute("data-h");
  if (handle && st.sel) {
    var r = st.sel.getBoundingClientRect();
    var c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    drag = { kind: handle === "rot" ? "rot" : "scale", el: st.sel, before: snapshot(st.sel), t0: transformOf(st.sel), c: c,
      d0: Math.hypot(e.clientX - c.x, e.clientY - c.y) || 1, a0: Math.atan2(e.clientY - c.y, e.clientX - c.x) };
    e.preventDefault();
    return;
  }
  if (st.editing && st.editing.contains(e.target)) return;
  var el = layerAt(e.clientX, e.clientY);
  if (st.editing) stopText();
  var add = e.shiftKey || st.adding;
  if (!el) { if (!add) select(null); return; }
  var now = Date.now();
  if (!add && lastTap.el === el && now - lastTap.at < 380 && kindOf(el) === "text") {
    lastTap = { el: null, at: 0 };
    select(el);
    startText(el);
    return;
  }
  lastTap = { el: el, at: now };
  if (add) select(el, true);
  else if (st.multi.indexOf(el) < 0 || st.multi.length < 2) select(el);
  if (st.multi.indexOf(el) < 0) return;
  var items = st.multi.map(function(m){ return { el: m, before: snapshot(m), t0: transformOf(m) }; });
  drag = { kind: "move", el: el, items: items, x0: e.clientX, y0: e.clientY, moved: false,
    rect: union(st.multi), others: rectsBut(st.multi) };
  e.preventDefault();
}, true);

document.addEventListener("pointermove", function(e){
  if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  if (!drag) { if (st.mode === "edit" && e.pointerType === "mouse") drawHover(layerAt(e.clientX, e.clientY)); return; }
  if (drag.kind === "move") {
    var d = { dx: e.clientX - drag.x0, dy: e.clientY - drag.y0, rect: drag.rect, others: drag.others };
    if (!drag.moved && Math.hypot(d.dx, d.dy) < 3 / (st.k || 1)) return;
    drag.moved = true;
    if (!e.altKey) snapMove(d);
    drag.items.forEach(function(it){ setTransform(it.el, { x: it.t0.x + d.dx, y: it.t0.y + d.dy, s: it.t0.s, r: it.t0.r }); });
    drawBox();
    e.preventDefault();
    return;
  }
  var t = { x: drag.t0.x, y: drag.t0.y, s: drag.t0.s, r: drag.t0.r };
  if (drag.kind === "scale") {
    t.s = Math.max(0.05, drag.t0.s * Math.hypot(e.clientX - drag.c.x, e.clientY - drag.c.y) / drag.d0);
  } else if (drag.kind === "rot") {
    var deg = drag.t0.r + (Math.atan2(e.clientY - drag.c.y, e.clientX - drag.c.x) - drag.a0) * 180 / Math.PI;
    if (!e.altKey) { var snapTo = Math.round(deg / 45) * 45; if (Math.abs(snapTo - deg) < 4) deg = snapTo; }
    t.r = deg;
  } else if (drag.kind === "pinch") {
    var ids = Object.keys(pointers);
    if (ids.length < 2) return;
    var a = pointers[ids[0]], b = pointers[ids[1]];
    t.s = Math.max(0.05, drag.t0.s * (Math.hypot(b.x - a.x, b.y - a.y) || 1) / drag.dist);
    t.r = drag.t0.r + (Math.atan2(b.y - a.y, b.x - a.x) - drag.ang) * 180 / Math.PI;
  }
  setTransform(drag.el, t);
  drawBox();
  e.preventDefault();
}, true);

function endDrag(e){
  delete pointers[e.pointerId];
  if (!drag) return;
  if (drag.kind === "pinch" && Object.keys(pointers).length > 0) return;
  var d = drag;
  drag = null;
  drawGuides(null);
  if (d.items) recordMany(d.items, null); else record(d.el, d.before, null);
  selMsg();
}
document.addEventListener("pointerup", endDrag, true);
document.addEventListener("pointercancel", endDrag, true);
document.addEventListener("dblclick", function(e){
  if (st.mode !== "edit" || st.editing) return;
  var el = layerAt(e.clientX, e.clientY);
  if (el && kindOf(el) === "text") { select(el); startText(el); }
}, true);
document.addEventListener("paste", function(e){
  if (!st.editing) return;
  e.preventDefault();
  var text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
  document.execCommand("insertText", false, text);
}, true);
document.addEventListener("input", function(){ if (st.editing) drawBox(); }, true);

document.addEventListener("keydown", function(e){
  var mod = e.metaKey || e.ctrlKey;
  if (st.editing) {
    if (e.key === "Escape" || (e.key === "Enter" && mod)) { e.preventDefault(); stopText(); }
    return;
  }
  if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) travel(future, past, false); else travel(past, future, true); return; }
  if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); travel(future, past, false); return; }
  if (st.mode === "edit" && st.sel) {
    var step = e.shiftKey ? 10 : 1;
    var move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (move) {
      e.preventDefault();
      var list = st.multi.map(function(m){ return { el: m, before: snapshot(m) }; });
      st.multi.forEach(function(m){ var t = transformOf(m); t.x += move[0]; t.y += move[1]; setTransform(m, t); });
      recordMany(list, "nudge");
      drawBox();
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); select(null); return; }
    if (e.key === "Enter" && kindOf(st.sel) === "text") { e.preventDefault(); startText(st.sel); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); apply(st.sel.getAttribute("data-ed-id"), { hidden: true }); return; }
  }
  post({ ed: "key", key: e.key, shift: e.shiftKey, mod: mod });
}, true);

// ---------- the page handed back ----------

function serialize(){
  if (st.editing) stopText();
  var root = document.documentElement.cloneNode(true);
  Array.prototype.forEach.call(root.querySelectorAll("[data-ed-ui]"), function(n){ n.remove(); });
  Array.prototype.forEach.call(root.querySelectorAll("meta[http-equiv]"), function(n){
    var k = (n.getAttribute("http-equiv") || "").toLowerCase();
    if (k === "content-security-policy" || k === "x-dns-prefetch-control") n.remove();
  });
  var charsets = root.querySelectorAll("meta[charset]");
  for (var i = 1; i < charsets.length; i++) charsets[i].remove();
  Array.prototype.forEach.call(root.querySelectorAll("[data-ed-id]"), function(n){ n.removeAttribute("data-ed-id"); });
  Array.prototype.forEach.call(root.querySelectorAll("[contenteditable]"), function(n){ n.removeAttribute("contenteditable"); });
  [root].concat(Array.prototype.slice.call(root.querySelectorAll(".ed-slide,.ed-active"))).forEach(function(n){
    ["ed-one", "ed-edit", "ed-slide", "ed-active"].forEach(function(c){ n.classList.remove(c); });
    if (n.getAttribute("class") === "") n.removeAttribute("class");
  });
  root.style.removeProperty("--ed-u");
  if (root.getAttribute("style") === "") root.removeAttribute("style");
  return "<!doctype html>\n" + root.outerHTML;
}

// ---------- the app's side ----------

function command(m){
  m = m || {};
  if (m.ed === "words") st.words = m.words || {};
  else if (m.ed === "mode") setMode(m.mode);
  else if (m.ed === "slide") goSlide(m.slide);
  else if (m.ed === "scale") { st.k = m.k || 1; drawBox(); }
  else if (m.ed === "select") { var l = byId[m.id]; select(l ? l.el : null); }
  else if (m.ed === "parent") { if (st.sel) { var g = groupOf(st.sel); if (g) { if (!g.getAttribute("data-ed-id")) { var id = "l" + (++seq); g.setAttribute("data-ed-id", id); byId[id] = { el: g, slide: st.slide }; original[id] = snapshot(g); layersMsg(); } select(g); } } }
  else if (m.ed === "text") { if (st.sel) startText(st.sel); }
  else if (m.ed === "adding") st.adding = !!m.on;
  else if (m.ed === "set") apply(m.id, m.patch || {});
  else if (m.ed === "undo") travel(past, future, true);
  else if (m.ed === "redo") travel(future, past, false);
  else if (m.ed === "serialize") post({ ed: "page", req: m.req, html: serialize() });
}
window.__ed = command;
if (!RN) window.addEventListener("message", function(e){ if (e.source === P && P !== window) command(e.data); }, false);

function start(){
  setup();
  goSlide(1);
  var z = sizeOf();
  post({ ed: "ready", slides: slides.length, w: z.w, h: z.h, colors: colors() });
  layersMsg();
  historyMsg();
}
function whenLoaded(){
  var imgs = Array.prototype.slice.call(document.images).filter(function(i){ return !i.complete; });
  var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.all([fonts].concat(imgs.map(function(i){ return new Promise(function(r){ i.addEventListener("load", r); i.addEventListener("error", r); }); })))
    .then(start, start);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", whenLoaded); else whenLoaded();
post({ ed: "boot" });
})();`;

/** The piece, isolated like every agent page, with the editor's side in first. */
export function editorPage(html: string): string {
  return isolatedPage(html, `<script data-ed-ui="1">${BRIDGE}</script>`);
}

/** What the piece says to the app. */
export type FrameMessage =
  | { ed: "boot" }
  | { ed: "ready"; slides: number; w: number; h: number; colors: string[] }
  | { ed: "slide"; slide: number; w: number; h: number }
  | { ed: "layers"; slide: number; layers: FrameLayer[] }
  | { ed: "selected"; info: LayerInfo | null; count: number }
  | { ed: "history"; changes: number; undo: boolean; redo: boolean }
  | { ed: "texting"; on: boolean }
  | { ed: "key"; key: string; shift: boolean; mod: boolean }
  | { ed: "page"; req: number; html: string };

export interface FrameLayer {
  id: string;
  name: string;
  kind: "text" | "image" | "shape";
  hidden: boolean;
}

export interface LayerInfo {
  id: string;
  name: string;
  kind: "text" | "image" | "shape";
  /** Its words, when it is plain text (no inner markup): the side panel can rewrite them in a field. */
  text: string | null;
  fontSize: number;
  color: string | null;
  fill: string | null;
  /** 0–100. */
  opacity: number;
  rotate: number;
  /** Percent. */
  scale: number;
  hidden: boolean;
  image: { fit: string; x: number; y: number } | null;
  /** It sits in a group of other layers: "select the group" moves them together. */
  parent: boolean;
}

/** What the app asks of the piece. */
export type LayerPatch = Partial<{
  text: string;
  fontSize: number;
  color: string;
  fill: string;
  opacity: number;
  rotate: number;
  scale: number;
  hidden: boolean;
  z: 1 | -1;
  src: string;
  fit: "cover" | "contain";
  posX: number;
  posY: number;
  reset: true;
  /** Changes with the same key in a row (a slider dragged) make one step of the history. */
  key: string;
}>;

export type FrameCommand =
  | { ed: "words"; words: Record<string, string> }
  | { ed: "mode"; mode: "view" | "edit" }
  | { ed: "slide"; slide: number }
  | { ed: "scale"; k: number }
  | { ed: "select"; id: string | null }
  | { ed: "parent" }
  | { ed: "text" }
  | { ed: "adding"; on: boolean }
  | { ed: "set"; id: string; patch: LayerPatch }
  | { ed: "undo" }
  | { ed: "redo" }
  | { ed: "serialize"; req: number };
