const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/review-selector-D7VJ6Nx5.js","assets/monaco-DWgZwlcv.js","assets/monaco-B_gQEi6j.css","assets/marked-IDzlF_wn.js","assets/hljs-gJDTAEaL.js","assets/ac-search-tab-CD4eoejh.js","assets/ac-context-tab-Cbyzt-EF.js","assets/ac-cache-tab-BWhMxl4M.js","assets/ac-settings-tab-CjdF51ZX.js"])))=>i.map(i=>d[i]);
var ys=Object.defineProperty;var bs=Object.getPrototypeOf;var xs=Reflect.get;var ws=(n,e,t)=>e in n?ys(n,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):n[e]=t;var $=(n,e,t)=>ws(n,typeof e!="symbol"?e+"":e,t);var Yt=(n,e,t)=>xs(bs(n),t,e);import{_ as $e,e as j,l as D,R as Ne,U as Kt}from"./monaco-DWgZwlcv.js";import{M as Zi}from"./marked-IDzlF_wn.js";import{H as C,j as Vi,p as Wi,t as Xi,a as Ss,b as Ot,c as $s,x as Yi,y as Ki,d as Cs,e as ks,f as Es,m as Gi,g as Gt,h as As}from"./hljs-gJDTAEaL.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))i(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function t(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function i(s){if(s.ep)return;s.ep=!0;const r=t(s);fetch(s.href,r)}})();/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Ve=globalThis,Nt=Ve.ShadowRoot&&(Ve.ShadyCSS===void 0||Ve.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,qt=Symbol(),Jt=new WeakMap;let Ji=class{constructor(e,t,i){if(this._$cssResult$=!0,i!==qt)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const t=this.t;if(Nt&&e===void 0){const i=t!==void 0&&t.length===1;i&&(e=Jt.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),i&&Jt.set(t,e))}return e}toString(){return this.cssText}};const Ts=n=>new Ji(typeof n=="string"?n:n+"",void 0,qt),L=(n,...e)=>{const t=n.length===1?n[0]:e.reduce((i,s,r)=>i+(o=>{if(o._$cssResult$===!0)return o.cssText;if(typeof o=="number")return o;throw Error("Value passed to 'css' function must be a 'css' function result: "+o+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+n[r+1],n[0]);return new Ji(t,n,qt)},Ms=(n,e)=>{if(Nt)n.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const t of e){const i=document.createElement("style"),s=Ve.litNonce;s!==void 0&&i.setAttribute("nonce",s),i.textContent=t.cssText,n.appendChild(i)}},Qt=Nt?n=>n:n=>n instanceof CSSStyleSheet?(e=>{let t="";for(const i of e.cssRules)t+=i.cssText;return Ts(t)})(n):n;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:zs,defineProperty:Ls,getOwnPropertyDescriptor:Rs,getOwnPropertyNames:Is,getOwnPropertySymbols:Ps,getPrototypeOf:Ds}=Object,K=globalThis,ei=K.trustedTypes,Fs=ei?ei.emptyScript:"",it=K.reactiveElementPolyfillSupport,Ce=(n,e)=>n,mt={toAttribute(n,e){switch(e){case Boolean:n=n?Fs:null;break;case Object:case Array:n=n==null?n:JSON.stringify(n)}return n},fromAttribute(n,e){let t=n;switch(e){case Boolean:t=n!==null;break;case Number:t=n===null?null:Number(n);break;case Object:case Array:try{t=JSON.parse(n)}catch{t=null}}return t}},Qi=(n,e)=>!zs(n,e),ti={attribute:!0,type:String,converter:mt,reflect:!1,useDefault:!1,hasChanged:Qi};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),K.litPropertyMetadata??(K.litPropertyMetadata=new WeakMap);let ce=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??(this.l=[])).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=ti){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){const i=Symbol(),s=this.getPropertyDescriptor(e,i,t);s!==void 0&&Ls(this.prototype,e,s)}}static getPropertyDescriptor(e,t,i){const{get:s,set:r}=Rs(this.prototype,e)??{get(){return this[t]},set(o){this[t]=o}};return{get:s,set(o){const l=s==null?void 0:s.call(this);r==null||r.call(this,o),this.requestUpdate(e,l,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??ti}static _$Ei(){if(this.hasOwnProperty(Ce("elementProperties")))return;const e=Ds(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(Ce("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Ce("properties"))){const t=this.properties,i=[...Is(t),...Ps(t)];for(const s of i)this.createProperty(s,t[s])}const e=this[Symbol.metadata];if(e!==null){const t=litPropertyMetadata.get(e);if(t!==void 0)for(const[i,s]of t)this.elementProperties.set(i,s)}this._$Eh=new Map;for(const[t,i]of this.elementProperties){const s=this._$Eu(t,i);s!==void 0&&this._$Eh.set(s,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const i=new Set(e.flat(1/0).reverse());for(const s of i)t.unshift(Qt(s))}else e!==void 0&&t.push(Qt(e));return t}static _$Eu(e,t){const i=t.attribute;return i===!1?void 0:typeof i=="string"?i:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){var e;this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),(e=this.constructor.l)==null||e.forEach(t=>t(this))}addController(e){var t;(this._$EO??(this._$EO=new Set)).add(e),this.renderRoot!==void 0&&this.isConnected&&((t=e.hostConnected)==null||t.call(e))}removeController(e){var t;(t=this._$EO)==null||t.delete(e)}_$E_(){const e=new Map,t=this.constructor.elementProperties;for(const i of t.keys())this.hasOwnProperty(i)&&(e.set(i,this[i]),delete this[i]);e.size>0&&(this._$Ep=e)}createRenderRoot(){const e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Ms(e,this.constructor.elementStyles),e}connectedCallback(){var e;this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostConnected)==null?void 0:i.call(t)})}enableUpdating(e){}disconnectedCallback(){var e;(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostDisconnected)==null?void 0:i.call(t)})}attributeChangedCallback(e,t,i){this._$AK(e,i)}_$ET(e,t){var r;const i=this.constructor.elementProperties.get(e),s=this.constructor._$Eu(e,i);if(s!==void 0&&i.reflect===!0){const o=(((r=i.converter)==null?void 0:r.toAttribute)!==void 0?i.converter:mt).toAttribute(t,i.type);this._$Em=e,o==null?this.removeAttribute(s):this.setAttribute(s,o),this._$Em=null}}_$AK(e,t){var r,o;const i=this.constructor,s=i._$Eh.get(e);if(s!==void 0&&this._$Em!==s){const l=i.getPropertyOptions(s),a=typeof l.converter=="function"?{fromAttribute:l.converter}:((r=l.converter)==null?void 0:r.fromAttribute)!==void 0?l.converter:mt;this._$Em=s;const c=a.fromAttribute(t,l.type);this[s]=c??((o=this._$Ej)==null?void 0:o.get(s))??c,this._$Em=null}}requestUpdate(e,t,i,s=!1,r){var o;if(e!==void 0){const l=this.constructor;if(s===!1&&(r=this[e]),i??(i=l.getPropertyOptions(e)),!((i.hasChanged??Qi)(r,t)||i.useDefault&&i.reflect&&r===((o=this._$Ej)==null?void 0:o.get(e))&&!this.hasAttribute(l._$Eu(e,i))))return;this.C(e,t,i)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:i,reflect:s,wrapped:r},o){i&&!(this._$Ej??(this._$Ej=new Map)).has(e)&&(this._$Ej.set(e,o??t??this[e]),r!==!0||o!==void 0)||(this._$AL.has(e)||(this.hasUpdated||i||(t=void 0),this._$AL.set(e,t)),s===!0&&this._$Em!==e&&(this._$Eq??(this._$Eq=new Set)).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var i;if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(const[r,o]of this._$Ep)this[r]=o;this._$Ep=void 0}const s=this.constructor.elementProperties;if(s.size>0)for(const[r,o]of s){const{wrapped:l}=o,a=this[r];l!==!0||this._$AL.has(r)||a===void 0||this.C(r,void 0,o,a)}}let e=!1;const t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),(i=this._$EO)==null||i.forEach(s=>{var r;return(r=s.hostUpdate)==null?void 0:r.call(s)}),this.update(t)):this._$EM()}catch(s){throw e=!1,this._$EM(),s}e&&this._$AE(t)}willUpdate(e){}_$AE(e){var t;(t=this._$EO)==null||t.forEach(i=>{var s;return(s=i.hostUpdated)==null?void 0:s.call(i)}),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&(this._$Eq=this._$Eq.forEach(t=>this._$ET(t,this[t]))),this._$EM()}updated(e){}firstUpdated(e){}};ce.elementStyles=[],ce.shadowRootOptions={mode:"open"},ce[Ce("elementProperties")]=new Map,ce[Ce("finalized")]=new Map,it==null||it({ReactiveElement:ce}),(K.reactiveElementVersions??(K.reactiveElementVersions=[])).push("2.1.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const ke=globalThis,ii=n=>n,Ye=ke.trustedTypes,si=Ye?Ye.createPolicy("lit-html",{createHTML:n=>n}):void 0,es="$lit$",W=`lit$${Math.random().toFixed(9).slice(2)}$`,ts="?"+W,Os=`<${ts}>`,oe=document,ze=()=>oe.createComment(""),Le=n=>n===null||typeof n!="object"&&typeof n!="function",Bt=Array.isArray,Ns=n=>Bt(n)||typeof(n==null?void 0:n[Symbol.iterator])=="function",st=`[ 	
\f\r]`,_e=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,ni=/-->/g,ri=/>/g,Q=RegExp(`>|${st}(?:([^\\s"'>=/]+)(${st}*=${st}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),oi=/'/g,ai=/"/g,is=/^(?:script|style|textarea|title)$/i,ss=n=>(e,...t)=>({_$litType$:n,strings:e,values:t}),f=ss(1),rr=ss(2),ae=Symbol.for("lit-noChange"),_=Symbol.for("lit-nothing"),li=new WeakMap,ie=oe.createTreeWalker(oe,129);function ns(n,e){if(!Bt(n)||!n.hasOwnProperty("raw"))throw Error("invalid template strings array");return si!==void 0?si.createHTML(e):e}const qs=(n,e)=>{const t=n.length-1,i=[];let s,r=e===2?"<svg>":e===3?"<math>":"",o=_e;for(let l=0;l<t;l++){const a=n[l];let c,h,d=-1,u=0;for(;u<a.length&&(o.lastIndex=u,h=o.exec(a),h!==null);)u=o.lastIndex,o===_e?h[1]==="!--"?o=ni:h[1]!==void 0?o=ri:h[2]!==void 0?(is.test(h[2])&&(s=RegExp("</"+h[2],"g")),o=Q):h[3]!==void 0&&(o=Q):o===Q?h[0]===">"?(o=s??_e,d=-1):h[1]===void 0?d=-2:(d=o.lastIndex-h[2].length,c=h[1],o=h[3]===void 0?Q:h[3]==='"'?ai:oi):o===ai||o===oi?o=Q:o===ni||o===ri?o=_e:(o=Q,s=void 0);const v=o===Q&&n[l+1].startsWith("/>")?" ":"";r+=o===_e?a+Os:d>=0?(i.push(c),a.slice(0,d)+es+a.slice(d)+W+v):a+W+(d===-2?l:v)}return[ns(n,r+(n[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),i]};let gt=class rs{constructor({strings:e,_$litType$:t},i){let s;this.parts=[];let r=0,o=0;const l=e.length-1,a=this.parts,[c,h]=qs(e,t);if(this.el=rs.createElement(c,i),ie.currentNode=this.el.content,t===2||t===3){const d=this.el.content.firstChild;d.replaceWith(...d.childNodes)}for(;(s=ie.nextNode())!==null&&a.length<l;){if(s.nodeType===1){if(s.hasAttributes())for(const d of s.getAttributeNames())if(d.endsWith(es)){const u=h[o++],v=s.getAttribute(d).split(W),m=/([.?@])?(.*)/.exec(u);a.push({type:1,index:r,name:m[2],strings:v,ctor:m[1]==="."?Us:m[1]==="?"?Hs:m[1]==="@"?js:Je}),s.removeAttribute(d)}else d.startsWith(W)&&(a.push({type:6,index:r}),s.removeAttribute(d));if(is.test(s.tagName)){const d=s.textContent.split(W),u=d.length-1;if(u>0){s.textContent=Ye?Ye.emptyScript:"";for(let v=0;v<u;v++)s.append(d[v],ze()),ie.nextNode(),a.push({type:2,index:++r});s.append(d[u],ze())}}}else if(s.nodeType===8)if(s.data===ts)a.push({type:2,index:r});else{let d=-1;for(;(d=s.data.indexOf(W,d+1))!==-1;)a.push({type:7,index:r}),d+=W.length-1}r++}}static createElement(e,t){const i=oe.createElement("template");return i.innerHTML=e,i}};function pe(n,e,t=n,i){var o,l;if(e===ae)return e;let s=i!==void 0?(o=t._$Co)==null?void 0:o[i]:t._$Cl;const r=Le(e)?void 0:e._$litDirective$;return(s==null?void 0:s.constructor)!==r&&((l=s==null?void 0:s._$AO)==null||l.call(s,!1),r===void 0?s=void 0:(s=new r(n),s._$AT(n,t,i)),i!==void 0?(t._$Co??(t._$Co=[]))[i]=s:t._$Cl=s),s!==void 0&&(e=pe(n,s._$AS(n,e.values),s,i)),e}let Bs=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){const{el:{content:t},parts:i}=this._$AD,s=((e==null?void 0:e.creationScope)??oe).importNode(t,!0);ie.currentNode=s;let r=ie.nextNode(),o=0,l=0,a=i[0];for(;a!==void 0;){if(o===a.index){let c;a.type===2?c=new Ut(r,r.nextSibling,this,e):a.type===1?c=new a.ctor(r,a.name,a.strings,this,e):a.type===6&&(c=new Zs(r,this,e)),this._$AV.push(c),a=i[++l]}o!==(a==null?void 0:a.index)&&(r=ie.nextNode(),o++)}return ie.currentNode=oe,s}p(e){let t=0;for(const i of this._$AV)i!==void 0&&(i.strings!==void 0?(i._$AI(e,i,t),t+=i.strings.length-2):i._$AI(e[t])),t++}},Ut=class os{get _$AU(){var e;return((e=this._$AM)==null?void 0:e._$AU)??this._$Cv}constructor(e,t,i,s){this.type=2,this._$AH=_,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=i,this.options=s,this._$Cv=(s==null?void 0:s.isConnected)??!0}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return t!==void 0&&(e==null?void 0:e.nodeType)===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=pe(this,e,t),Le(e)?e===_||e==null||e===""?(this._$AH!==_&&this._$AR(),this._$AH=_):e!==this._$AH&&e!==ae&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):Ns(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==_&&Le(this._$AH)?this._$AA.nextSibling.data=e:this.T(oe.createTextNode(e)),this._$AH=e}$(e){var r;const{values:t,_$litType$:i}=e,s=typeof i=="number"?this._$AC(e):(i.el===void 0&&(i.el=gt.createElement(ns(i.h,i.h[0]),this.options)),i);if(((r=this._$AH)==null?void 0:r._$AD)===s)this._$AH.p(t);else{const o=new Bs(s,this),l=o.u(this.options);o.p(t),this.T(l),this._$AH=o}}_$AC(e){let t=li.get(e.strings);return t===void 0&&li.set(e.strings,t=new gt(e)),t}k(e){Bt(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let i,s=0;for(const r of e)s===t.length?t.push(i=new os(this.O(ze()),this.O(ze()),this,this.options)):i=t[s],i._$AI(r),s++;s<t.length&&(this._$AR(i&&i._$AB.nextSibling,s),t.length=s)}_$AR(e=this._$AA.nextSibling,t){var i;for((i=this._$AP)==null?void 0:i.call(this,!1,!0,t);e!==this._$AB;){const s=ii(e).nextSibling;ii(e).remove(),e=s}}setConnected(e){var t;this._$AM===void 0&&(this._$Cv=e,(t=this._$AP)==null||t.call(this,e))}},Je=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,i,s,r){this.type=1,this._$AH=_,this._$AN=void 0,this.element=e,this.name=t,this._$AM=s,this.options=r,i.length>2||i[0]!==""||i[1]!==""?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=_}_$AI(e,t=this,i,s){const r=this.strings;let o=!1;if(r===void 0)e=pe(this,e,t,0),o=!Le(e)||e!==this._$AH&&e!==ae,o&&(this._$AH=e);else{const l=e;let a,c;for(e=r[0],a=0;a<r.length-1;a++)c=pe(this,l[i+a],t,a),c===ae&&(c=this._$AH[a]),o||(o=!Le(c)||c!==this._$AH[a]),c===_?e=_:e!==_&&(e+=(c??"")+r[a+1]),this._$AH[a]=c}o&&!s&&this.j(e)}j(e){e===_?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},Us=class extends Je{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===_?void 0:e}},Hs=class extends Je{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==_)}},js=class extends Je{constructor(e,t,i,s,r){super(e,t,i,s,r),this.type=5}_$AI(e,t=this){if((e=pe(this,e,t,0)??_)===ae)return;const i=this._$AH,s=e===_&&i!==_||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,r=e!==_&&(i===_||s);s&&this.element.removeEventListener(this.name,this,i),r&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var t;typeof this._$AH=="function"?this._$AH.call(((t=this.options)==null?void 0:t.host)??this.element,e):this._$AH.handleEvent(e)}},Zs=class{constructor(e,t,i){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(e){pe(this,e)}};const nt=ke.litHtmlPolyfillSupport;nt==null||nt(gt,Ut),(ke.litHtmlVersions??(ke.litHtmlVersions=[])).push("3.3.2");const Vs=(n,e,t)=>{const i=(t==null?void 0:t.renderBefore)??e;let s=i._$litPart$;if(s===void 0){const r=(t==null?void 0:t.renderBefore)??null;i._$litPart$=s=new Ut(e.insertBefore(ze(),r),r,void 0,t??{})}return s._$AI(n),s};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const ne=globalThis;let z=class extends ce{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var t;const e=super.createRenderRoot();return(t=this.renderOptions).renderBefore??(t.renderBefore=e.firstChild),e}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Vs(t,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),(e=this._$Do)==null||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this._$Do)==null||e.setConnected(!1)}render(){return ae}};var Hi;z._$litElement$=!0,z.finalized=!0,(Hi=ne.litElementHydrateSupport)==null||Hi.call(ne,{LitElement:z});const rt=ne.litElementPolyfillSupport;rt==null||rt({LitElement:z});(ne.litElementVersions??(ne.litElementVersions=[])).push("4.2.2");const qe=new Set;let ye=null;const Ee={set(n){ye=n;for(const e of qe)try{e(n)}catch(t){console.error("SharedRpc listener error:",t)}},get(){return ye},addListener(n){if(qe.add(n),ye)try{n(ye)}catch(e){console.error("SharedRpc listener error:",e)}},removeListener(n){qe.delete(n)},clear(){ye=null;for(const n of qe)try{n(null)}catch(e){console.error("SharedRpc listener error:",e)}}},P=L`
  :host {
    --bg-primary: #0d1117;
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --bg-overlay: #1c2128;

    --text-primary: #c9d1d9;
    --text-secondary: #8b949e;
    --text-muted: #6e7681;

    --border-primary: #30363d;
    --border-secondary: #21262d;

    --accent-primary: #4fc3f7;
    --accent-green: #7ee787;
    --accent-red: #ffa198;
    --accent-orange: #f0883e;
    --accent-yellow: #d29922;

    --font-mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;

    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;

    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);

    --z-dialog: 100;
    --z-overlay: 200;
    --z-modal: 300;
    --z-toast: 400;
    --z-hud: 10000;
  }
`,B=L`
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--border-primary);
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--text-muted);
  }
`;let ci=class{getAllFns(e,t){let i=[],s=e.constructor.prototype;for(;s!=null;){let r=s.constructor.name.replace("_exports_","");if(t!=null&&(r=t),r!=="Object"){let o=Object.getOwnPropertyNames(s).filter(l=>l!=="constructor"&&l.indexOf("__")<0);o.forEach((l,a)=>{o[a]=r+"."+l}),i=i.concat(o)}if(t!=null)break;s=s.__proto__}return i}exposeAllFns(e,t){let i=this.getAllFns(e,t);var s={};return i.forEach(function(r){s[r]=function(o,l){Promise.resolve(e[r.substring(r.indexOf(".")+1)].apply(e,o.args)).then(function(a){return l(null,a)}).catch(function(a){return console.log("failed : "+a),l(a)})}}),s}};typeof module<"u"&&typeof module.exports<"u"?module.exports=ci:Window.ExposeClass=ci;/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const We=globalThis,Ht=We.ShadowRoot&&(We.ShadyCSS===void 0||We.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,as=Symbol(),di=new WeakMap;let Ws=class{constructor(e,t,i){if(this._$cssResult$=!0,i!==as)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const t=this.t;if(Ht&&e===void 0){const i=t!==void 0&&t.length===1;i&&(e=di.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),i&&di.set(t,e))}return e}toString(){return this.cssText}};const Xs=n=>new Ws(typeof n=="string"?n:n+"",void 0,as),Ys=(n,e)=>{if(Ht)n.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const t of e){const i=document.createElement("style"),s=We.litNonce;s!==void 0&&i.setAttribute("nonce",s),i.textContent=t.cssText,n.appendChild(i)}},hi=Ht?n=>n:n=>n instanceof CSSStyleSheet?(e=>{let t="";for(const i of e.cssRules)t+=i.cssText;return Xs(t)})(n):n;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:Ks,defineProperty:Gs,getOwnPropertyDescriptor:Js,getOwnPropertyNames:Qs,getOwnPropertySymbols:en,getPrototypeOf:tn}=Object,G=globalThis,pi=G.trustedTypes,sn=pi?pi.emptyScript:"",ot=G.reactiveElementPolyfillSupport,Ae=(n,e)=>n,vt={toAttribute(n,e){switch(e){case Boolean:n=n?sn:null;break;case Object:case Array:n=n==null?n:JSON.stringify(n)}return n},fromAttribute(n,e){let t=n;switch(e){case Boolean:t=n!==null;break;case Number:t=n===null?null:Number(n);break;case Object:case Array:try{t=JSON.parse(n)}catch{t=null}}return t}},ls=(n,e)=>!Ks(n,e),ui={attribute:!0,type:String,converter:vt,reflect:!1,useDefault:!1,hasChanged:ls};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),G.litPropertyMetadata??(G.litPropertyMetadata=new WeakMap);let de=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??(this.l=[])).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=ui){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){const i=Symbol(),s=this.getPropertyDescriptor(e,i,t);s!==void 0&&Gs(this.prototype,e,s)}}static getPropertyDescriptor(e,t,i){const{get:s,set:r}=Js(this.prototype,e)??{get(){return this[t]},set(o){this[t]=o}};return{get:s,set(o){const l=s==null?void 0:s.call(this);r==null||r.call(this,o),this.requestUpdate(e,l,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??ui}static _$Ei(){if(this.hasOwnProperty(Ae("elementProperties")))return;const e=tn(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(Ae("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Ae("properties"))){const t=this.properties,i=[...Qs(t),...en(t)];for(const s of i)this.createProperty(s,t[s])}const e=this[Symbol.metadata];if(e!==null){const t=litPropertyMetadata.get(e);if(t!==void 0)for(const[i,s]of t)this.elementProperties.set(i,s)}this._$Eh=new Map;for(const[t,i]of this.elementProperties){const s=this._$Eu(t,i);s!==void 0&&this._$Eh.set(s,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const i=new Set(e.flat(1/0).reverse());for(const s of i)t.unshift(hi(s))}else e!==void 0&&t.push(hi(e));return t}static _$Eu(e,t){const i=t.attribute;return i===!1?void 0:typeof i=="string"?i:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){var e;this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),(e=this.constructor.l)==null||e.forEach(t=>t(this))}addController(e){var t;(this._$EO??(this._$EO=new Set)).add(e),this.renderRoot!==void 0&&this.isConnected&&((t=e.hostConnected)==null||t.call(e))}removeController(e){var t;(t=this._$EO)==null||t.delete(e)}_$E_(){const e=new Map,t=this.constructor.elementProperties;for(const i of t.keys())this.hasOwnProperty(i)&&(e.set(i,this[i]),delete this[i]);e.size>0&&(this._$Ep=e)}createRenderRoot(){const e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Ys(e,this.constructor.elementStyles),e}connectedCallback(){var e;this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostConnected)==null?void 0:i.call(t)})}enableUpdating(e){}disconnectedCallback(){var e;(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostDisconnected)==null?void 0:i.call(t)})}attributeChangedCallback(e,t,i){this._$AK(e,i)}_$ET(e,t){var r;const i=this.constructor.elementProperties.get(e),s=this.constructor._$Eu(e,i);if(s!==void 0&&i.reflect===!0){const o=(((r=i.converter)==null?void 0:r.toAttribute)!==void 0?i.converter:vt).toAttribute(t,i.type);this._$Em=e,o==null?this.removeAttribute(s):this.setAttribute(s,o),this._$Em=null}}_$AK(e,t){var r,o;const i=this.constructor,s=i._$Eh.get(e);if(s!==void 0&&this._$Em!==s){const l=i.getPropertyOptions(s),a=typeof l.converter=="function"?{fromAttribute:l.converter}:((r=l.converter)==null?void 0:r.fromAttribute)!==void 0?l.converter:vt;this._$Em=s;const c=a.fromAttribute(t,l.type);this[s]=c??((o=this._$Ej)==null?void 0:o.get(s))??c,this._$Em=null}}requestUpdate(e,t,i,s=!1,r){var o;if(e!==void 0){const l=this.constructor;if(s===!1&&(r=this[e]),i??(i=l.getPropertyOptions(e)),!((i.hasChanged??ls)(r,t)||i.useDefault&&i.reflect&&r===((o=this._$Ej)==null?void 0:o.get(e))&&!this.hasAttribute(l._$Eu(e,i))))return;this.C(e,t,i)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:i,reflect:s,wrapped:r},o){i&&!(this._$Ej??(this._$Ej=new Map)).has(e)&&(this._$Ej.set(e,o??t??this[e]),r!==!0||o!==void 0)||(this._$AL.has(e)||(this.hasUpdated||i||(t=void 0),this._$AL.set(e,t)),s===!0&&this._$Em!==e&&(this._$Eq??(this._$Eq=new Set)).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var i;if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(const[r,o]of this._$Ep)this[r]=o;this._$Ep=void 0}const s=this.constructor.elementProperties;if(s.size>0)for(const[r,o]of s){const{wrapped:l}=o,a=this[r];l!==!0||this._$AL.has(r)||a===void 0||this.C(r,void 0,o,a)}}let e=!1;const t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),(i=this._$EO)==null||i.forEach(s=>{var r;return(r=s.hostUpdate)==null?void 0:r.call(s)}),this.update(t)):this._$EM()}catch(s){throw e=!1,this._$EM(),s}e&&this._$AE(t)}willUpdate(e){}_$AE(e){var t;(t=this._$EO)==null||t.forEach(i=>{var s;return(s=i.hostUpdated)==null?void 0:s.call(i)}),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&(this._$Eq=this._$Eq.forEach(t=>this._$ET(t,this[t]))),this._$EM()}updated(e){}firstUpdated(e){}};de.elementStyles=[],de.shadowRootOptions={mode:"open"},de[Ae("elementProperties")]=new Map,de[Ae("finalized")]=new Map,ot==null||ot({ReactiveElement:de}),(G.reactiveElementVersions??(G.reactiveElementVersions=[])).push("2.1.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Te=globalThis,fi=n=>n,Ke=Te.trustedTypes,mi=Ke?Ke.createPolicy("lit-html",{createHTML:n=>n}):void 0,cs="$lit$",X=`lit$${Math.random().toFixed(9).slice(2)}$`,ds="?"+X,nn=`<${ds}>`,le=document,Re=()=>le.createComment(""),Ie=n=>n===null||typeof n!="object"&&typeof n!="function",jt=Array.isArray,rn=n=>jt(n)||typeof(n==null?void 0:n[Symbol.iterator])=="function",at=`[ 	
\f\r]`,be=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,gi=/-->/g,vi=/>/g,ee=RegExp(`>|${at}(?:([^\\s"'>=/]+)(${at}*=${at}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),_i=/'/g,yi=/"/g,hs=/^(?:script|style|textarea|title)$/i,ue=Symbol.for("lit-noChange"),T=Symbol.for("lit-nothing"),bi=new WeakMap,se=le.createTreeWalker(le,129);function ps(n,e){if(!jt(n)||!n.hasOwnProperty("raw"))throw Error("invalid template strings array");return mi!==void 0?mi.createHTML(e):e}const on=(n,e)=>{const t=n.length-1,i=[];let s,r=e===2?"<svg>":e===3?"<math>":"",o=be;for(let l=0;l<t;l++){const a=n[l];let c,h,d=-1,u=0;for(;u<a.length&&(o.lastIndex=u,h=o.exec(a),h!==null);)u=o.lastIndex,o===be?h[1]==="!--"?o=gi:h[1]!==void 0?o=vi:h[2]!==void 0?(hs.test(h[2])&&(s=RegExp("</"+h[2],"g")),o=ee):h[3]!==void 0&&(o=ee):o===ee?h[0]===">"?(o=s??be,d=-1):h[1]===void 0?d=-2:(d=o.lastIndex-h[2].length,c=h[1],o=h[3]===void 0?ee:h[3]==='"'?yi:_i):o===yi||o===_i?o=ee:o===gi||o===vi?o=be:(o=ee,s=void 0);const v=o===ee&&n[l+1].startsWith("/>")?" ":"";r+=o===be?a+nn:d>=0?(i.push(c),a.slice(0,d)+cs+a.slice(d)+X+v):a+X+(d===-2?l:v)}return[ps(n,r+(n[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),i]};class Pe{constructor({strings:e,_$litType$:t},i){let s;this.parts=[];let r=0,o=0;const l=e.length-1,a=this.parts,[c,h]=on(e,t);if(this.el=Pe.createElement(c,i),se.currentNode=this.el.content,t===2||t===3){const d=this.el.content.firstChild;d.replaceWith(...d.childNodes)}for(;(s=se.nextNode())!==null&&a.length<l;){if(s.nodeType===1){if(s.hasAttributes())for(const d of s.getAttributeNames())if(d.endsWith(cs)){const u=h[o++],v=s.getAttribute(d).split(X),m=/([.?@])?(.*)/.exec(u);a.push({type:1,index:r,name:m[2],strings:v,ctor:m[1]==="."?ln:m[1]==="?"?cn:m[1]==="@"?dn:Qe}),s.removeAttribute(d)}else d.startsWith(X)&&(a.push({type:6,index:r}),s.removeAttribute(d));if(hs.test(s.tagName)){const d=s.textContent.split(X),u=d.length-1;if(u>0){s.textContent=Ke?Ke.emptyScript:"";for(let v=0;v<u;v++)s.append(d[v],Re()),se.nextNode(),a.push({type:2,index:++r});s.append(d[u],Re())}}}else if(s.nodeType===8)if(s.data===ds)a.push({type:2,index:r});else{let d=-1;for(;(d=s.data.indexOf(X,d+1))!==-1;)a.push({type:7,index:r}),d+=X.length-1}r++}}static createElement(e,t){const i=le.createElement("template");return i.innerHTML=e,i}}function fe(n,e,t=n,i){var o,l;if(e===ue)return e;let s=i!==void 0?(o=t._$Co)==null?void 0:o[i]:t._$Cl;const r=Ie(e)?void 0:e._$litDirective$;return(s==null?void 0:s.constructor)!==r&&((l=s==null?void 0:s._$AO)==null||l.call(s,!1),r===void 0?s=void 0:(s=new r(n),s._$AT(n,t,i)),i!==void 0?(t._$Co??(t._$Co=[]))[i]=s:t._$Cl=s),s!==void 0&&(e=fe(n,s._$AS(n,e.values),s,i)),e}class an{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){const{el:{content:t},parts:i}=this._$AD,s=((e==null?void 0:e.creationScope)??le).importNode(t,!0);se.currentNode=s;let r=se.nextNode(),o=0,l=0,a=i[0];for(;a!==void 0;){if(o===a.index){let c;a.type===2?c=new Fe(r,r.nextSibling,this,e):a.type===1?c=new a.ctor(r,a.name,a.strings,this,e):a.type===6&&(c=new hn(r,this,e)),this._$AV.push(c),a=i[++l]}o!==(a==null?void 0:a.index)&&(r=se.nextNode(),o++)}return se.currentNode=le,s}p(e){let t=0;for(const i of this._$AV)i!==void 0&&(i.strings!==void 0?(i._$AI(e,i,t),t+=i.strings.length-2):i._$AI(e[t])),t++}}class Fe{get _$AU(){var e;return((e=this._$AM)==null?void 0:e._$AU)??this._$Cv}constructor(e,t,i,s){this.type=2,this._$AH=T,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=i,this.options=s,this._$Cv=(s==null?void 0:s.isConnected)??!0}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return t!==void 0&&(e==null?void 0:e.nodeType)===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=fe(this,e,t),Ie(e)?e===T||e==null||e===""?(this._$AH!==T&&this._$AR(),this._$AH=T):e!==this._$AH&&e!==ue&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):rn(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==T&&Ie(this._$AH)?this._$AA.nextSibling.data=e:this.T(le.createTextNode(e)),this._$AH=e}$(e){var r;const{values:t,_$litType$:i}=e,s=typeof i=="number"?this._$AC(e):(i.el===void 0&&(i.el=Pe.createElement(ps(i.h,i.h[0]),this.options)),i);if(((r=this._$AH)==null?void 0:r._$AD)===s)this._$AH.p(t);else{const o=new an(s,this),l=o.u(this.options);o.p(t),this.T(l),this._$AH=o}}_$AC(e){let t=bi.get(e.strings);return t===void 0&&bi.set(e.strings,t=new Pe(e)),t}k(e){jt(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let i,s=0;for(const r of e)s===t.length?t.push(i=new Fe(this.O(Re()),this.O(Re()),this,this.options)):i=t[s],i._$AI(r),s++;s<t.length&&(this._$AR(i&&i._$AB.nextSibling,s),t.length=s)}_$AR(e=this._$AA.nextSibling,t){var i;for((i=this._$AP)==null?void 0:i.call(this,!1,!0,t);e!==this._$AB;){const s=fi(e).nextSibling;fi(e).remove(),e=s}}setConnected(e){var t;this._$AM===void 0&&(this._$Cv=e,(t=this._$AP)==null||t.call(this,e))}}class Qe{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,i,s,r){this.type=1,this._$AH=T,this._$AN=void 0,this.element=e,this.name=t,this._$AM=s,this.options=r,i.length>2||i[0]!==""||i[1]!==""?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=T}_$AI(e,t=this,i,s){const r=this.strings;let o=!1;if(r===void 0)e=fe(this,e,t,0),o=!Ie(e)||e!==this._$AH&&e!==ue,o&&(this._$AH=e);else{const l=e;let a,c;for(e=r[0],a=0;a<r.length-1;a++)c=fe(this,l[i+a],t,a),c===ue&&(c=this._$AH[a]),o||(o=!Ie(c)||c!==this._$AH[a]),c===T?e=T:e!==T&&(e+=(c??"")+r[a+1]),this._$AH[a]=c}o&&!s&&this.j(e)}j(e){e===T?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}}class ln extends Qe{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===T?void 0:e}}class cn extends Qe{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==T)}}class dn extends Qe{constructor(e,t,i,s,r){super(e,t,i,s,r),this.type=5}_$AI(e,t=this){if((e=fe(this,e,t,0)??T)===ue)return;const i=this._$AH,s=e===T&&i!==T||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,r=e!==T&&(i===T||s);s&&this.element.removeEventListener(this.name,this,i),r&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var t;typeof this._$AH=="function"?this._$AH.call(((t=this.options)==null?void 0:t.host)??this.element,e):this._$AH.handleEvent(e)}}class hn{constructor(e,t,i){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(e){fe(this,e)}}const lt=Te.litHtmlPolyfillSupport;lt==null||lt(Pe,Fe),(Te.litHtmlVersions??(Te.litHtmlVersions=[])).push("3.3.2");const pn=(n,e,t)=>{const i=(t==null?void 0:t.renderBefore)??e;let s=i._$litPart$;if(s===void 0){const r=(t==null?void 0:t.renderBefore)??null;i._$litPart$=s=new Fe(e.insertBefore(Re(),r),r,void 0,t??{})}return s._$AI(n),s};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const re=globalThis;let Me=class extends de{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var t;const e=super.createRenderRoot();return(t=this.renderOptions).renderBefore??(t.renderBefore=e.firstChild),e}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=pn(t,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),(e=this._$Do)==null||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this._$Do)==null||e.setConnected(!1)}render(){return ue}};var ji;Me._$litElement$=!0,Me.finalized=!0,(ji=re.litElementHydrateSupport)==null||ji.call(re,{LitElement:Me});const ct=re.litElementPolyfillSupport;ct==null||ct({LitElement:Me});(re.litElementVersions??(re.litElementVersions=[])).push("4.2.2");Window.LitElement=Me;(function(n){if(typeof exports=="object"&&typeof module<"u")module.exports=n();else if(typeof define=="function"&&define.amd)define([],n);else{var e;e=typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:this,e.JRPC=n()}})(function(){return function n(e,t,i){function s(l,a){if(!t[l]){if(!e[l]){var c=typeof require=="function"&&require;if(!a&&c)return c(l,!0);if(r)return r(l,!0);var h=new Error("Cannot find module '"+l+"'");throw h.code="MODULE_NOT_FOUND",h}var d=t[l]={exports:{}};e[l][0].call(d.exports,function(u){var v=e[l][1][u];return s(v||u)},d,d.exports,n,e,t,i)}return t[l].exports}for(var r=typeof require=="function"&&require,o=0;o<i.length;o++)s(i[o]);return s}({1:[function(n,e,t){(function(i){/*! JRPC v3.1.0
* <https://github.com/vphantom/js-jrpc>
* Copyright 2016 Stéphane Lavergne
* Free software under MIT License: <https://opensource.org/licenses/MIT> */function s(p){this.active=!0,this.transmitter=null,this.remoteTimeout=6e4,this.localTimeout=0,this.serial=0,this.discardSerial=0,this.outbox={requests:[],responses:[]},this.inbox={},this.localTimers={},this.outTimers={},this.localComponents={"system.listComponents":!0,"system.extension.dual-batch":!0},this.remoteComponents={},this.exposed={},this.exposed["system.listComponents"]=(function(g,b){return typeof g=="object"&&g!==null&&(this.remoteComponents=g,this.remoteComponents["system._upgraded"]=!0),b(null,this.localComponents)}).bind(this),this.exposed["system.extension.dual-batch"]=function(g,b){return b(null,!0)},typeof p=="object"&&("remoteTimeout"in p&&typeof p.remoteTimeout=="number"&&(this.remoteTimeout=1e3*p.remoteTimeout),"localTimeout"in p&&typeof p.localTimeout=="number"&&(this.localTimeout=1e3*p.localTimeout))}function r(){var p=this;return p.active=!1,p.transmitter=null,p.remoteTimeout=0,p.localTimeout=0,p.localComponents={},p.remoteComponents={},p.outbox.requests.length=0,p.outbox.responses.length=0,p.inbox={},p.exposed={},Object.keys(p.localTimers).forEach(function(g){clearTimeout(p.localTimers[g]),delete p.localTimers[g]}),Object.keys(p.outTimers).forEach(function(g){clearTimeout(p.outTimers[g]),delete p.outTimers[g]}),p}function o(p){var g,b,k=null,w={responses:[],requests:[]};if(typeof p!="function"&&(p=this.transmitter),!this.active||typeof p!="function")return this;if(g=this.outbox.responses.length,b=this.outbox.requests.length,g>0&&b>0&&"system.extension.dual-batch"in this.remoteComponents)w=k={responses:this.outbox.responses,requests:this.outbox.requests},this.outbox.responses=[],this.outbox.requests=[];else if(g>0)g>1?(w.responses=k=this.outbox.responses,this.outbox.responses=[]):w.responses.push(k=this.outbox.responses.pop());else{if(!(b>0))return this;b>1?(w.requests=k=this.outbox.requests,this.outbox.requests=[]):w.requests.push(k=this.outbox.requests.pop())}return setImmediate(p,JSON.stringify(k),a.bind(this,w)),this}function l(p){return this.transmitter=p,this.transmit()}function a(p,g){this.active&&g&&(p.responses.length>0&&Array.prototype.push.apply(this.outbox.responses,p.responses),p.requests.length>0&&Array.prototype.push.apply(this.outbox.requests,p.requests))}function c(p){var g=[],b=[];if(!this.active)return this;if(typeof p=="string")try{p=JSON.parse(p)}catch{return this}if(p.constructor===Array){if(p.length===0)return this;typeof p[0].method=="string"?g=p:b=p}else typeof p=="object"&&(typeof p.requests<"u"&&typeof p.responses<"u"?(g=p.requests,b=p.responses):typeof p.method=="string"?g.push(p):b.push(p));return b.forEach(u.bind(this)),g.forEach(m.bind(this)),this}function h(){return this.active?this.call("system.listComponents",this.localComponents,(function(p,g){p||typeof g!="object"||(this.remoteComponents=g,this.remoteComponents["system._upgraded"]=!0)}).bind(this)):this}function d(p,g,b){var k={jsonrpc:"2.0",method:p};return this.active?(typeof g=="function"&&(b=g,g=null),"system._upgraded"in this.remoteComponents&&!(p in this.remoteComponents)?(typeof b=="function"&&setImmediate(b,{code:-32601,message:"Unknown remote method"}),this):(this.serial++,k.id=this.serial,typeof g=="object"&&(k.params=g),typeof b=="function"&&(this.inbox[this.serial]=b),this.outbox.requests.push(k),this.transmit(),typeof b!="function"?this:(this.remoteTimeout>0?this.outTimers[this.serial]=setTimeout(u.bind(this,{jsonrpc:"2.0",id:this.serial,error:{code:-1e3,message:"Timed out waiting for response"}},!0),this.remoteTimeout):this.outTimers[this.serial]=!0,this))):this}function u(p,g){var b=!1,k=null;this.active&&"id"in p&&p.id in this.outTimers&&(g===!0&&clearTimeout(this.outTimers[p.id]),delete this.outTimers[p.id],"id"in p&&p.id in this.inbox&&("error"in p?b=p.error:k=p.result,setImmediate(this.inbox[p.id],b,k),delete this.inbox[p.id]))}function v(p,g){var b;if(!this.active)return this;if(typeof p=="string")this.localComponents[p]=!0,this.exposed[p]=g;else if(typeof p=="object")for(b in p)p.hasOwnProperty(b)&&(this.localComponents[b]=!0,this.exposed[b]=p[b]);return this}function m(p){var g=null,b=null;if(this.active&&typeof p=="object"&&p!==null&&typeof p.jsonrpc=="string"&&p.jsonrpc==="2.0"){if(g=typeof p.id<"u"?p.id:null,typeof p.method!="string")return void(g!==null&&(this.localTimers[g]=!0,setImmediate(y.bind(this,g,-32600))));if(!(p.method in this.exposed))return void(g!==null&&(this.localTimers[g]=!0,setImmediate(y.bind(this,g,-32601))));if("params"in p){if(typeof p.params!="object")return void(g!==null&&(this.localTimers[g]=!0,setImmediate(y.bind(this,g,-32602))));b=p.params}g===null&&(this.discardSerial--,g=this.discardSerial),this.localTimeout>0?this.localTimers[g]=setTimeout(y.bind(this,g,{code:-1002,message:"Method handler timed out"},void 0,!0),this.localTimeout):this.localTimers[g]=!0,setImmediate(this.exposed[p.method],b,y.bind(this,g))}}function y(p,g,b,k){var w={jsonrpc:"2.0",id:p};this.active&&p in this.localTimers&&(k===!0&&clearTimeout(this.localTimers[p]),delete this.localTimers[p],p===null||0>p||(typeof g<"u"&&g!==null&&g!==!1?typeof g=="number"?w.error={code:g,message:"error"}:g===!0?w.error={code:-1,message:"error"}:typeof g=="string"?w.error={code:-1,message:g}:typeof g=="object"&&"code"in g&&"message"in g?w.error=g:w.error={code:-2,message:"error",data:g}:w.result=b,this.outbox.responses.push(w),this.transmit()))}i.setImmediate=n("timers").setImmediate,s.prototype.shutdown=r,s.prototype.call=d,s.prototype.notify=d,s.prototype.expose=v,s.prototype.upgrade=h,s.prototype.receive=c,s.prototype.transmit=o,s.prototype.setTransmitter=l,typeof Promise.promisify=="function"&&(s.prototype.callAsync=Promise.promisify(d)),e.exports=s}).call(this,typeof global<"u"?global:typeof self<"u"?self:typeof window<"u"?window:{})},{timers:3}],2:[function(n,e,t){function i(){h=!1,l.length?c=l.concat(c):d=-1,c.length&&s()}function s(){if(!h){var u=setTimeout(i);h=!0;for(var v=c.length;v;){for(l=c,c=[];++d<v;)l&&l[d].run();d=-1,v=c.length}l=null,h=!1,clearTimeout(u)}}function r(u,v){this.fun=u,this.array=v}function o(){}var l,a=e.exports={},c=[],h=!1,d=-1;a.nextTick=function(u){var v=new Array(arguments.length-1);if(arguments.length>1)for(var m=1;m<arguments.length;m++)v[m-1]=arguments[m];c.push(new r(u,v)),c.length!==1||h||setTimeout(s,0)},r.prototype.run=function(){this.fun.apply(null,this.array)},a.title="browser",a.browser=!0,a.env={},a.argv=[],a.version="",a.versions={},a.on=o,a.addListener=o,a.once=o,a.off=o,a.removeListener=o,a.removeAllListeners=o,a.emit=o,a.binding=function(u){throw new Error("process.binding is not supported")},a.cwd=function(){return"/"},a.chdir=function(u){throw new Error("process.chdir is not supported")},a.umask=function(){return 0}},{}],3:[function(n,e,t){function i(c,h){this._id=c,this._clearFn=h}var s=n("process/browser.js").nextTick,r=Function.prototype.apply,o=Array.prototype.slice,l={},a=0;t.setTimeout=function(){return new i(r.call(setTimeout,window,arguments),clearTimeout)},t.setInterval=function(){return new i(r.call(setInterval,window,arguments),clearInterval)},t.clearTimeout=t.clearInterval=function(c){c.close()},i.prototype.unref=i.prototype.ref=function(){},i.prototype.close=function(){this._clearFn.call(window,this._id)},t.enroll=function(c,h){clearTimeout(c._idleTimeoutId),c._idleTimeout=h},t.unenroll=function(c){clearTimeout(c._idleTimeoutId),c._idleTimeout=-1},t._unrefActive=t.active=function(c){clearTimeout(c._idleTimeoutId);var h=c._idleTimeout;h>=0&&(c._idleTimeoutId=setTimeout(function(){c._onTimeout&&c._onTimeout()},h))},t.setImmediate=typeof setImmediate=="function"?setImmediate:function(c){var h=a++,d=arguments.length<2?!1:o.call(arguments,1);return l[h]=!0,s(function(){l[h]&&(d?c.apply(null,d):c.call(null),t.clearImmediate(h))}),h},t.clearImmediate=typeof clearImmediate=="function"?clearImmediate:function(c){delete l[c]}},{"process/browser.js":2}]},{},[1])(1)});Window.JRPC=JRPC;if(typeof module<"u"&&typeof module.exports<"u")var us={},he=require("crypto"),un={},fs=class{};else{if(!he)var he=self.crypto;var us=Window.ExposeClass,fs=Window.LitElement}he.randomUUID||(he.randomUUID=()=>he.getRandomValues(new Uint8Array(32)).toString("base64").replaceAll(",",""));let xi=class extends fs{newRemote(){let e;return typeof Window>"u"?e=new un({remoteTimeout:this.remoteTimeout}):e=new Window.JRPC({remoteTimeout:this.remoteTimeout}),e.uuid=he.randomUUID(),this.remotes==null&&(this.remotes={}),this.remotes[e.uuid]=e,e}createRemote(e){let t=this.newRemote();return this.remoteIsUp(),this.ws?(e=this.ws,this.ws.onclose=(function(i){this.rmRemote(i,t.uuid)}).bind(this),this.ws.onmessage=i=>{t.receive(i.data)}):(e.on("close",(i,s)=>this.rmRemote.bind(this)(i,t.uuid)),e.on("message",function(i,s){const r=s?i:i.toString();t.receive(r)})),this.setupRemote(t,e),t}remoteIsUp(){console.log("JRPCCommon::remoteIsUp")}rmRemote(e,t){if(this.server&&this.remotes[t]&&this.remotes[t].rpcs&&Object.keys(this.remotes[t].rpcs).forEach(i=>{this.server[i]&&delete this.server[i]}),Object.keys(this.remotes).length&&delete this.remotes[t],this.call&&Object.keys(this.remotes).length){let i=[];for(const s in this.remotes)this.remotes[s].rpcs&&(i=i.concat(Object.keys(this.remotes[s].rpcs)));if(this.call){let s=Object.keys(this.call);for(let r=0;r<s.length;r++)i.indexOf(s[r])<0&&delete this.call[s[r]]}}else this.call={};this.remoteDisconnected(t)}remoteDisconnected(e){console.log("JPRCCommon::remoteDisconnected "+e)}setupRemote(e,t){e.setTransmitter(this.transmit.bind(t)),this.classes&&this.classes.forEach(i=>{e.expose(i)}),e.upgrade(),e.call("system.listComponents",[],(i,s)=>{i?(console.log(i),console.log("Something went wrong when calling system.listComponents !")):this.setupFns(Object.keys(s),e)})}transmit(e,t){try{return this.send(e),t(!1)}catch(i){return console.log(i),t(!0)}}setupFns(e,t){e.forEach(i=>{t.rpcs==null&&(t.rpcs={}),t.rpcs[i]=function(s){return new Promise((r,o)=>{t.call(i,{args:Array.from(arguments)},(l,a)=>{l?(console.log("Error when calling remote function : "+i),o(l)):r(a)})})},this.call==null&&(this.call={}),this.call[i]==null&&(this.call[i]=(...s)=>{let r=[],o=[];for(const l in this.remotes)this.remotes[l].rpcs[i]!=null&&(o.push(l),r.push(this.remotes[l].rpcs[i](...s)));return Promise.all(r).then(l=>{let a={};return o.forEach((c,h)=>a[c]=l[h]),a})}),this.server==null&&(this.server={}),this.server[i]==null?this.server[i]=function(s){return new Promise((r,o)=>{t.call(i,{args:Array.from(arguments)},(l,a)=>{l?(console.log("Error when calling remote function : "+i),o(l)):r(a)})})}:this.server[i]=function(s){return new Promise((r,o)=>{o(new Error("More then one remote has this RPC, not sure who to talk to : "+i))})}}),this.setupDone()}setupDone(){}addClass(e,t){e.getRemotes=()=>this.remotes,e.getCall=()=>this.call,e.getServer=()=>this.server;let s=new us().exposeAllFns(e,t);if(this.classes==null?this.classes=[s]:this.classes.push(s),this.remotes!=null)for(const[r,o]of Object.entries(this.remotes))o.expose(s),o.upgrade()}};typeof module<"u"&&typeof module.exports<"u"?module.exports=xi:Window.JRPCCommon=xi;let fn=Window.JRPCCommon;class ms extends fn{static get properties(){return{serverURI:{type:String},ws:{type:Object},server:{type:Object},remoteTimeout:{type:Number}}}constructor(){super(),this.remoteTimeout=60}updated(e){e.has("serverURI")&&this.serverURI&&this.serverURI!="undefined"&&this.serverChanged()}serverChanged(){this.ws!=null&&delete this.ws;try{this.ws=new WebSocket(this.serverURI),console.assert(this.ws.parent==null,"wss.parent already exists, this needs upgrade."),this.ws.addEventListener("open",this.createRemote.bind(this)),this.ws.addEventListener("error",this.wsError.bind(this))}catch(e){this.serverURI="",this.setupSkip(e)}}wsError(e){this.setupSkip(e)}isConnected(){return this.server!=null&&this.server!={}}setupSkip(){this.dispatchEvent(new CustomEvent("skip"))}setupDone(){this.dispatchEvent(new CustomEvent("done"))}}window.customElements.get("jrpc-client")||window.customElements.define("jrpc-client",ms);function dt(n,e="error"){window.dispatchEvent(new CustomEvent("ac-toast",{detail:{message:n,type:e}}))}const U=n=>{var e;return e=class extends n{constructor(){super(),this.rpcConnected=!1,this._rpcCallProxy=null,this._onRpcAvailable=this._onRpcAvailable.bind(this)}connectedCallback(){super.connectedCallback(),Ee.addListener(this._onRpcAvailable)}disconnectedCallback(){super.disconnectedCallback(),Ee.removeListener(this._onRpcAvailable)}_onRpcAvailable(i){this._rpcCallProxy=i,this.rpcConnected=!!i,i?this.onRpcReady():this.onRpcDisconnected()}onRpcReady(){}onRpcDisconnected(){}async rpcCall(i,...s){const r=this._rpcCallProxy||Ee.get();if(!r)throw new Error("RPC not connected");return await r[i](...s)}async rpcExtract(i,...s){const r=await this.rpcCall(i,...s);if(r&&typeof r=="object"){const o=Object.keys(r);if(o.length===1)return r[o[0]]}return r}async rpcSafeExtract(i,...s){try{return await this.rpcExtract(i,...s)}catch(r){const o=i.split(".").pop()||i;return console.warn(`RPC ${i} failed:`,r),dt(`${o} failed: ${r.message||"Connection error"}`,"error"),null}}async rpcSafeCall(i,...s){try{return await this.rpcCall(i,...s)}catch(r){const o=i.split(".").pop()||i;return console.warn(`RPC ${i} failed:`,r),dt(`${o} failed: ${r.message||"Connection error"}`,"error"),null}}showToast(i,s=""){dt(i,s)}},$(e,"properties",{...Yt(e,e,"properties"),rpcConnected:{type:Boolean,state:!0}}),e};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const mn={CHILD:2},gn=n=>(...e)=>({_$litDirective$:n,values:e});class vn{constructor(e){}get _$AU(){return this._$AM._$AU}_$AT(e,t,i){this._$Ct=e,this._$AM=t,this._$Ci=i}_$AS(e,t){return this.update(e,t)}update(e,t){return this.render(...t)}}/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */class _t extends vn{constructor(e){if(super(e),this.it=_,e.type!==mn.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(e){if(e===_||e==null)return this._t=void 0,this.it=e;if(e===ae)return e;if(typeof e!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(e===this.it)return this._t;this.it=e;const t=[e];return t.raw=t,this._t={_$litType$:this.constructor.resultType,strings:t,values:[]}}}_t.directiveName="unsafeHTML",_t.resultType=1;const Y=gn(_t);C.registerLanguage("javascript",Vi);C.registerLanguage("js",Vi);C.registerLanguage("python",Wi);C.registerLanguage("py",Wi);C.registerLanguage("typescript",Xi);C.registerLanguage("ts",Xi);C.registerLanguage("json",Ss);C.registerLanguage("bash",Ot);C.registerLanguage("sh",Ot);C.registerLanguage("shell",Ot);C.registerLanguage("css",$s);C.registerLanguage("html",Yi);C.registerLanguage("xml",Yi);C.registerLanguage("yaml",Ki);C.registerLanguage("yml",Ki);C.registerLanguage("c",Cs);C.registerLanguage("cpp",ks);C.registerLanguage("diff",Es);C.registerLanguage("markdown",Gi);C.registerLanguage("md",Gi);function me(n){return n.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}const _n=new Zi({gfm:!0,breaks:!0,renderer:{code(n){let e,t;typeof n=="string"?(e=n,t=""):(e=n.text||"",t=(n.lang||"").trim());const i=t&&C.getLanguage(t)?t:null;let s;if(i)try{s=C.highlight(e,{language:i}).value}catch{s=me(e)}else try{s=C.highlightAuto(e).value}catch{s=me(e)}return`<pre class="code-block">${i?`<span class="code-lang">${i}</span>`:""}<button class="code-copy-btn" title="Copy code">📋</button><code class="hljs${i?` language-${i}`:""}">${s}</code></pre>`}}});function Xe(n){if(!n)return"";try{return _n.parse(n)}catch(e){return console.warn("Markdown parse error:",e),`<pre>${me(n)}</pre>`}}function yn(n){const e=new Map;n.split(`
`);let t=0;const i=Z.lexer(n);for(const s of i){if(s.raw){const o=n.indexOf(s.raw,0);o!==-1&&(t=n.slice(0,o).split(`
`).length)}const r=bn(s);r&&!e.has(r)&&e.set(r,t)}return e}function bn(n){return!n||!n.text?null:(n.type||"p")+":"+n.text.slice(0,120)}const Z=new Zi({gfm:!0,breaks:!0,renderer:{code(n){let e,t;typeof n=="string"?(e=n,t=""):(e=n.text||"",t=(n.lang||"").trim());const i=t&&C.getLanguage(t)?t:null;let s;if(i)try{s=C.highlight(e,{language:i}).value}catch{s=me(e)}else try{s=C.highlightAuto(e).value}catch{s=me(e)}const r="code:"+e.slice(0,120),o=(E==null?void 0:E.get(r))??"";return`<pre class="code-block"${o!==""?` data-source-line="${o}"`:""}><code class="hljs${i?` language-${i}`:""}">${s}</code></pre>`},heading(n){const e=typeof n=="string"?n:n.text||"",t=(typeof n=="object"?n.depth:2)||2,i="heading:"+e.slice(0,120),s=(E==null?void 0:E.get(i))??"",r=s!==""?` data-source-line="${s}"`:"";let o;return typeof n=="object"&&n.tokens?o=Z.parser.parseInline(n.tokens):o=e,`<h${t}${r}>${o}</h${t}>
`},paragraph(n){const e=typeof n=="string"?n:n.text||"",t="paragraph:"+e.slice(0,120),i=(E==null?void 0:E.get(t))??"",s=i!==""?` data-source-line="${i}"`:"";let r;return typeof n=="object"&&n.tokens?r=Z.parser.parseInline(n.tokens):r=e,`<p${s}>${r}</p>
`},list(n){const e=typeof n=="object"?n.items:[],i=(typeof n=="object"?n.ordered:!1)?"ol":"ul",s=e.map(r=>{const o=typeof r=="string"?r:r.text||"",l="list_item:"+o.slice(0,120),a=(E==null?void 0:E.get(l))??"",c=a!==""?` data-source-line="${a}"`:"";let h;return typeof r=="object"&&r.tokens?h=Z.parser.parseInline(r.tokens):h=o,`<li${c}>${h}</li>
`}).join("");return`<${i}>${s}</${i}>
`},blockquote(n){const e=typeof n=="string"?n:n.text||"",t="blockquote:"+e.slice(0,120),i=(E==null?void 0:E.get(t))??"",s=i!==""?` data-source-line="${i}"`:"";let r;return typeof n=="object"&&n.tokens?r=Z.parser.parse(n.tokens):r=`<p>${e}</p>`,`<blockquote${s}>${r}</blockquote>
`},hr(){return`<hr data-source-line="">
`},table(n){const e=typeof n=="string"?n:n.text||"",t="table:"+(e||"").slice(0,120),i=(E==null?void 0:E.get(t))??"",s=i!==""?` data-source-line="${i}"`:"";if(typeof n=="object"&&n.header&&n.rows){const r=n.header.map((l,a)=>{var d;const c=(d=n.align)!=null&&d[a]?` align="${n.align[a]}"`:"",h=l.tokens?Z.parser.parseInline(l.tokens):l.text||"";return`<th${c}>${h}</th>`}).join(""),o=n.rows.map(l=>"<tr>"+l.map((a,c)=>{var u;const h=(u=n.align)!=null&&u[c]?` align="${n.align[c]}"`:"",d=a.tokens?Z.parser.parseInline(a.tokens):a.text||"";return`<td${h}>${d}</td>`}).join("")+"</tr>").join(`
`);return`<table${s}><thead><tr>${r}</tr></thead><tbody>${o}</tbody></table>
`}return`<table${s}>${e}</table>
`}}});let E=null;function wi(n){if(!n)return"";try{E=yn(n);const e=Z.parse(n);return E=null,e}catch(e){return E=null,console.warn("Markdown source-map parse error:",e),`<pre>${me(n)}</pre>`}}class yt extends z{constructor(){super(),this.open=!1,this._filter="",this._selectedIndex=0,this._history=[],this._originalInput=""}addEntry(e){const t=e.trim();if(!t)return;const i=this._history.indexOf(t);i!==-1&&this._history.splice(i,1),this._history.push(t),this._history.length>100&&this._history.shift()}show(e){this._history.length!==0&&(this._originalInput=e||"",this._filter="",this._selectedIndex=0,this.open=!0,this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".filter-input");t&&t.focus(),this._scrollToSelected()}))}cancel(){return this.open=!1,this._originalInput}select(){const e=this._getFiltered();if(e.length===0)return this.open=!1,this._originalInput;const t=e[e.length-1-this._selectedIndex];return this.open=!1,t||this._originalInput}handleKey(e){if(!this.open)return!1;const t=this._getFiltered();switch(e.key){case"ArrowUp":return e.preventDefault(),this._selectedIndex=Math.min(this._selectedIndex+1,t.length-1),this._scrollToSelected(),!0;case"ArrowDown":return e.preventDefault(),this._selectedIndex=Math.max(this._selectedIndex-1,0),this._scrollToSelected(),!0;case"Enter":return e.preventDefault(),this._dispatchSelect(this.select()),!0;case"Escape":return e.preventDefault(),this._dispatchCancel(this.cancel()),!0;default:return!1}}_getFiltered(){if(!this._filter)return this._history;const e=this._filter.toLowerCase();return this._history.filter(t=>t.toLowerCase().includes(e))}_onFilterInput(e){this._filter=e.target.value,this._selectedIndex=0}_onFilterKeyDown(e){this.handleKey(e)}_onItemClick(e){const t=this._getFiltered();this._selectedIndex=t.length-1-e,this._dispatchSelect(this.select())}_scrollToSelected(){this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".item.selected");e&&e.scrollIntoView({block:"nearest"})})}_dispatchSelect(e){this.dispatchEvent(new CustomEvent("history-select",{detail:{text:e},bubbles:!0,composed:!0}))}_dispatchCancel(e){this.dispatchEvent(new CustomEvent("history-cancel",{detail:{text:e},bubbles:!0,composed:!0}))}render(){if(!this.open)return _;const e=this._getFiltered();return f`
      <div class="overlay">
        <div class="filter-row">
          <span class="filter-label">History</span>
          <input
            class="filter-input"
            type="text"
            placeholder="Filter..."
            aria-label="Filter input history"
            .value=${this._filter}
            @input=${this._onFilterInput}
            @keydown=${this._onFilterKeyDown}
          >
        </div>
        <div class="items" role="listbox" aria-label="Input history">
          ${e.length===0?f`
            <div class="empty">${this._filter?"No matches":"No history"}</div>
          `:e.map((t,i)=>{const s=i===e.length-1-this._selectedIndex;return f`
              <div
                class="item ${s?"selected":""}"
                role="option"
                aria-selected="${s}"
                @click=${()=>this._onItemClick(i)}
                title="${t}"
              >${t}</div>
            `})}
        </div>
      </div>
    `}}$(yt,"properties",{open:{type:Boolean,reflect:!0},_filter:{type:String,state:!0},_selectedIndex:{type:Number,state:!0}}),$(yt,"styles",[P,B,L`
    :host {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      z-index: 50;
    }
    :host([open]) {
      display: block;
    }

    .overlay {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      max-height: 300px;
      display: flex;
      flex-direction: column;
      margin-bottom: 4px;
      overflow: hidden;
    }

    .filter-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-primary);
    }

    .filter-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.8rem;
      padding: 4px 8px;
      outline: none;
    }
    .filter-input:focus {
      border-color: var(--accent-primary);
    }
    .filter-input::placeholder {
      color: var(--text-muted);
    }

    .filter-label {
      color: var(--text-muted);
      font-size: 0.75rem;
      flex-shrink: 0;
    }

    .items {
      overflow-y: auto;
      padding: 4px 0;
    }

    .item {
      padding: 6px 12px;
      font-size: 0.8rem;
      color: var(--text-secondary);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.4;
    }
    .item:hover {
      background: var(--bg-tertiary);
    }
    .item.selected {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border-left: 2px solid var(--accent-primary);
      padding-left: 10px;
    }

    .empty {
      padding: 12px;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.8rem;
    }
  `]);customElements.define("ac-input-history",yt);const Be={github_repo:"📦",github_file:"📄",github_issue:"🐛",github_pr:"🔀",documentation:"📚",generic:"🌐"};class bt extends U(z){constructor(){super(),this._detected=[],this._fetched=[],this._fetching=new Set,this._excluded=new Set,this._debounceTimer=null}async detectUrls(e){if(!e||!this.rpcConnected){this._detected=[];return}clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(async()=>{try{const t=await this.rpcExtract("LLMService.detect_urls",e);if(!Array.isArray(t)){this._detected=[];return}const i=new Set(this._fetched.map(r=>r.url)),s=t.filter(r=>!i.has(r.url)&&!this._fetching.has(r.url));this._detected=s}catch(t){console.error("URL detection failed:",t)}},300)}onSend(){this._detected=[]}clear(){this._detected=[],this._fetched=[],this._fetching=new Set,this._excluded=new Set}getIncludedUrls(){return this._fetched.filter(e=>!e.error&&!this._excluded.has(e.url)).map(e=>e.url)}getExcludedUrls(){return[...this._excluded]}async _fetchUrl(e,t){if(!this._fetching.has(e)){this._detected=this._detected.filter(i=>i.url!==e),this._fetching=new Set([...this._fetching,e]),this.requestUpdate();try{const i=await this.rpcExtract("LLMService.fetch_url",e,!0,!0,null,null);this._fetching=new Set([...this._fetching].filter(s=>s!==e)),i&&(this._fetched=[...this._fetched,{url:e,url_type:i.url_type||t||"generic",title:i.title||e,error:i.error||null,display_name:i.title||this._shortenUrl(e)}])}catch(i){console.error("URL fetch failed:",i),this._fetching=new Set([...this._fetching].filter(s=>s!==e)),this._fetched=[...this._fetched,{url:e,url_type:t||"generic",title:e,error:i.message||"Fetch failed",display_name:this._shortenUrl(e)}]}this._notifyChange()}}_toggleExclude(e){const t=new Set(this._excluded);t.has(e)?t.delete(e):t.add(e),this._excluded=t,this._notifyChange()}_removeFetched(e){this._fetched=this._fetched.filter(i=>i.url!==e);const t=new Set(this._excluded);t.delete(e),this._excluded=t,this.rpcConnected&&this.rpcExtract("LLMService.remove_fetched_url",e).catch(()=>{}),this._notifyChange()}_dismissDetected(e){this._detected=this._detected.filter(t=>t.url!==e)}_viewContent(e){this.dispatchEvent(new CustomEvent("view-url-content",{bubbles:!0,composed:!0,detail:{url:e}}))}_notifyChange(){this.dispatchEvent(new CustomEvent("url-chips-changed",{bubbles:!0,composed:!0}))}_shortenUrl(e){try{const t=new URL(e);let i=t.pathname.replace(/\/$/,"");return i.length>30&&(i="..."+i.slice(-27)),t.hostname+i}catch{return e.length>40?e.slice(0,37)+"...":e}}_getDisplayName(e){return e.display_name||e.title||this._shortenUrl(e.url)}_renderDetectedChip(e){const t=Be[e.url_type]||Be.generic;return f`
      <span class="chip detected">
        <span class="badge">${t}</span>
        <span class="label" title="${e.url}">${e.display_name||this._shortenUrl(e.url)}</span>
        <button class="chip-btn fetch-btn" @click=${()=>this._fetchUrl(e.url,e.url_type)} title="Fetch">📥</button>
        <button class="chip-btn" @click=${()=>this._dismissDetected(e.url)} title="Dismiss">×</button>
      </span>
    `}_renderFetchingChip(e){return f`
      <span class="chip fetching">
        <span class="spinner"></span>
        <span class="label" title="${e}">${this._shortenUrl(e)}</span>
      </span>
    `}_renderFetchedChip(e){const t=this._excluded.has(e.url),i=!!e.error;return Be[e.url_type]||Be.generic,f`
      <span class="${`chip fetched ${t?"excluded":""} ${i?"error":""}`}">
        ${i?f`<span class="badge">⚠️</span>`:f`
          <input
            type="checkbox"
            class="checkbox"
            .checked=${!t}
            @change=${()=>this._toggleExclude(e.url)}
            title="${t?"Include in context":"Exclude from context"}"
          >
        `}
        <span
          class="label ${i?"":"clickable"}"
          title="${e.error||e.url}"
          @click=${i?_:()=>this._viewContent(e.url)}
        >${this._getDisplayName(e)}</span>
        <button class="chip-btn" @click=${()=>this._removeFetched(e.url)} title="Remove">×</button>
      </span>
    `}render(){return this._detected.length>0||this._fetching.size>0||this._fetched.length>0?f`
      <div class="chips-container" role="list" aria-label="URL references">
        ${this._fetched.map(t=>this._renderFetchedChip(t))}
        ${[...this._fetching].map(t=>this._renderFetchingChip(t))}
        ${this._detected.map(t=>this._renderDetectedChip(t))}
      </div>
    `:_}}$(bt,"properties",{_detected:{type:Array,state:!0},_fetched:{type:Array,state:!0},_fetching:{type:Object,state:!0},_excluded:{type:Object,state:!0}}),$(bt,"styles",[P,L`
    :host {
      display: block;
    }

    .chips-container {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 0;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      border: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      max-width: 280px;
      line-height: 1.3;
    }

    .chip .badge {
      flex-shrink: 0;
      font-size: 0.8rem;
    }

    .chip .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .chip .chip-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 0 2px;
      cursor: pointer;
      flex-shrink: 0;
      line-height: 1;
    }
    .chip .chip-btn:hover {
      color: var(--text-primary);
    }

    /* Detected chip */
    .chip.detected {
      border-style: dashed;
    }

    .chip.detected .fetch-btn {
      color: var(--accent-primary);
      font-size: 0.8rem;
    }
    .chip.detected .fetch-btn:hover {
      opacity: 0.8;
    }

    /* Fetching chip */
    .chip.fetching {
      border-color: var(--accent-primary);
      opacity: 0.7;
    }

    .spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid var(--border-primary);
      border-top-color: var(--accent-primary);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Fetched chip */
    .chip.fetched {
      border-color: var(--accent-green);
      background: rgba(126, 231, 135, 0.08);
    }

    .chip.fetched.excluded {
      border-color: var(--border-primary);
      background: var(--bg-tertiary);
      opacity: 0.6;
    }

    .chip.fetched.error {
      border-color: var(--accent-red);
      background: rgba(255, 161, 152, 0.08);
    }

    .chip .checkbox {
      width: 12px;
      height: 12px;
      cursor: pointer;
      flex-shrink: 0;
      accent-color: var(--accent-green);
    }

    .chip .label.clickable {
      cursor: pointer;
    }
    .chip .label.clickable:hover {
      color: var(--text-primary);
    }
  `]);customElements.define("ac-url-chips",bt);function xn(n){return n?n.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/```(\w*)\n([\s\S]*?)```/g,(e,t,i)=>`<pre class="code-block"><code>${i}</code></pre>`).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>").replace(/^### (.+)$/gm,"<h4>$1</h4>").replace(/^## (.+)$/gm,"<h3>$1</h3>").replace(/^# (.+)$/gm,"<h2>$1</h2>").replace(/\n/g,"<br>"):""}class xt extends U(z){constructor(){super(),this.open=!1,this._sessions=[],this._selectedSessionId=null,this._sessionMessages=[],this._searchQuery="",this._searchResults=[],this._loading=!1,this._loadingMessages=!1,this._mode="sessions",this._debounceTimer=null,this._toast=null,this._toastTimer=null}show(){this.open=!0,this._loadSessions(),this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".search-input");e&&e.focus()})}hide(){this.open=!1}async _loadSessions(){if(this.rpcConnected){this._loading=!0;try{const e=await this.rpcExtract("LLMService.history_list_sessions",50);Array.isArray(e)&&(this._sessions=e)}catch(e){console.warn("Failed to load sessions:",e)}finally{this._loading=!1}}}async _selectSession(e){if(!(e===this._selectedSessionId&&this._sessionMessages.length>0)){this._selectedSessionId=e,this._loadingMessages=!0,this._sessionMessages=[];try{const t=await this.rpcExtract("LLMService.history_get_session",e);Array.isArray(t)&&(this._sessionMessages=t)}catch(t){console.warn("Failed to load session messages:",t)}finally{this._loadingMessages=!1}}}_onSearchInput(e){if(this._searchQuery=e.target.value,clearTimeout(this._debounceTimer),!this._searchQuery.trim()){this._mode="sessions",this._searchResults=[];return}this._debounceTimer=setTimeout(()=>this._runSearch(),300)}async _runSearch(){const e=this._searchQuery.trim();if(!(!e||!this.rpcConnected)){this._mode="search",this._loading=!0;try{const t=await this.rpcExtract("LLMService.history_search",e,null,50);Array.isArray(t)&&(this._searchResults=t)}catch(t){console.warn("Search failed:",t)}finally{this._loading=!1}}}_onSearchKeyDown(e){var t;if(e.key==="Escape")if(e.preventDefault(),this._searchQuery){this._searchQuery="",this._mode="sessions",this._searchResults=[];const i=(t=this.shadowRoot)==null?void 0:t.querySelector(".search-input");i&&(i.value="")}else this.hide()}async _loadSessionIntoContext(){if(!(!this._selectedSessionId||!this.rpcConnected))try{const e=await this.rpcExtract("LLMService.load_session_into_context",this._selectedSessionId);if(e!=null&&e.error){console.warn("Failed to load session:",e.error);return}this.dispatchEvent(new CustomEvent("session-loaded",{detail:{sessionId:e.session_id,messages:e.messages||[],messageCount:e.message_count||0},bubbles:!0,composed:!0})),this.hide()}catch(e){console.warn("Failed to load session:",e)}}_copyMessage(e){const t=e.content||"";navigator.clipboard.writeText(t).then(()=>{this._showToast("Copied to clipboard")})}_pasteToPrompt(e){const t=e.content||"";this.dispatchEvent(new CustomEvent("paste-to-prompt",{detail:{text:t},bubbles:!0,composed:!0})),this.hide()}_showToast(e){this._toast=e,clearTimeout(this._toastTimer),this._toastTimer=setTimeout(()=>{this._toast=null},1500)}_onOverlayClick(e){e.target===e.currentTarget&&this.hide()}_onKeyDown(e){e.key==="Escape"&&this.hide()}_formatTimestamp(e){if(!e)return"";try{const t=new Date(e),s=new Date-t,r=Math.floor(s/(1e3*60*60*24));return r===0?t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):r===1?"Yesterday":r<7?t.toLocaleDateString([],{weekday:"short"}):t.toLocaleDateString([],{month:"short",day:"numeric"})}catch{return""}}_renderSessionItem(e){const t=e.session_id===this._selectedSessionId,i=e.preview||"Empty session",s=this._formatTimestamp(e.timestamp),r=e.message_count||0;return f`
      <div
        class="session-item ${t?"selected":""}"
        @click=${()=>this._selectSession(e.session_id)}
      >
        <div class="session-preview">${i}</div>
        <div class="session-meta">
          <span>${s}</span>
          <span class="msg-count">${r} msg${r!==1?"s":""}</span>
        </div>
      </div>
    `}_renderSearchResultItem(e){var r;const t=((r=e.content)==null?void 0:r.slice(0,100))||"",i=e.role||"user",s=e.session_id;return f`
      <div
        class="session-item ${s===this._selectedSessionId?"selected":""}"
        @click=${()=>{s&&this._selectSession(s)}}
      >
        <div class="session-preview">
          <span style="color: ${i==="user"?"var(--accent-primary)":"var(--accent-green)"}; font-size: 0.7rem; font-weight: 600;">
            ${i.toUpperCase()}
          </span>
          ${t}
        </div>
        <div class="session-meta">
          <span>${this._formatTimestamp(e.timestamp)}</span>
        </div>
      </div>
    `}_renderMessage(e){const t=e.role==="user",i=e.content||"",s=e.images;return f`
      <div class="msg-card ${t?"user":"assistant"}">
        <div class="msg-role">${t?"You":"Assistant"}</div>
        <div class="msg-content">
          ${Y(xn(i))}
        </div>
        ${Array.isArray(s)&&s.length>0?f`
          <div class="msg-images">
            ${s.map(r=>f`<img src="${r}" alt="Image">`)}
          </div>
        `:_}
        <div class="msg-actions">
          <button class="msg-action-btn" title="Copy" @click=${()=>this._copyMessage(e)}>📋</button>
          <button class="msg-action-btn" title="Paste to prompt" @click=${()=>this._pasteToPrompt(e)}>↩</button>
        </div>
      </div>
    `}_renderLeftPanel(){return this._loading&&this._sessions.length===0&&this._searchResults.length===0?f`<div class="loading">Loading...</div>`:this._mode==="search"?this._searchResults.length===0?f`<div class="empty-state">No results found</div>`:f`
        <div class="session-list">
          ${this._searchResults.map(e=>this._renderSearchResultItem(e))}
        </div>
      `:this._sessions.length===0?f`<div class="empty-state">No sessions yet</div>`:f`
      <div class="session-list">
        ${this._sessions.map(e=>this._renderSessionItem(e))}
      </div>
    `}_renderRightPanel(){return this._selectedSessionId?this._loadingMessages?f`<div class="loading">Loading messages...</div>`:this._sessionMessages.length===0?f`<div class="empty-state">No messages in this session</div>`:f`
      <div class="message-panel-header">
        <span class="session-info">
          ${this._sessionMessages.length} message${this._sessionMessages.length!==1?"s":""}
        </span>
        <button
          class="load-session-btn"
          @click=${this._loadSessionIntoContext}
          ?disabled=${!this.rpcConnected}
          aria-label="Load this session into current context"
        >Load into context</button>
      </div>
      <div class="message-list">
        ${this._sessionMessages.map(e=>this._renderMessage(e))}
      </div>
    `:f`<div class="empty-state">Select a session to view messages</div>`}render(){return this.open?f`
      <div class="modal-overlay"
        @click=${this._onOverlayClick}
        @keydown=${this._onKeyDown}
      >
        <div class="modal" role="dialog" aria-modal="true" aria-label="History browser"
             @click=${e=>e.stopPropagation()}>
          <div class="modal-header">
            <span class="modal-title" id="history-dialog-title">📜 History</span>
            <input
              class="search-input"
              type="text"
              placeholder="Search conversations..."
              aria-label="Search conversations"
              .value=${this._searchQuery}
              @input=${this._onSearchInput}
              @keydown=${this._onSearchKeyDown}
            >
            <button class="close-btn" @click=${this.hide} title="Close (Esc)" aria-label="Close history browser">✕</button>
          </div>

          <div class="modal-body">
            <div class="session-panel" role="region" aria-label="Session list">
              ${this._renderLeftPanel()}
            </div>
            <div class="message-panel" role="region" aria-label="Session messages">
              ${this._renderRightPanel()}
            </div>
          </div>
        </div>

        ${this._toast?f`
          <div class="toast">${this._toast}</div>
        `:_}
      </div>
    `:_}}$(xt,"properties",{open:{type:Boolean,reflect:!0},_sessions:{type:Array,state:!0},_selectedSessionId:{type:String,state:!0},_sessionMessages:{type:Array,state:!0},_searchQuery:{type:String,state:!0},_searchResults:{type:Array,state:!0},_loading:{type:Boolean,state:!0},_loadingMessages:{type:Boolean,state:!0},_mode:{type:String,state:!0}}),$(xt,"styles",[P,B,L`
    :host {
      display: none;
    }
    :host([open]) {
      display: block;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: var(--z-modal);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: 85vw;
      max-width: 1100px;
      height: 75vh;
      max-height: 700px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Header */
    .modal-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
    }

    .modal-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
    }

    .search-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.85rem;
      padding: 6px 12px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--accent-primary);
    }
    .search-input::placeholder {
      color: var(--text-muted);
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.1rem;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      flex-shrink: 0;
    }
    .close-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    /* Body — two-panel layout */
    .modal-body {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    /* Left panel: sessions */
    .session-panel {
      width: 300px;
      min-width: 240px;
      border-right: 1px solid var(--border-primary);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .session-item {
      padding: 10px 14px;
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: background 0.1s;
    }
    .session-item:hover {
      background: var(--bg-tertiary);
    }
    .session-item.selected {
      background: var(--bg-tertiary);
      border-left-color: var(--accent-primary);
    }

    .session-preview {
      font-size: 0.8rem;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.4;
    }

    .session-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .session-meta .msg-count {
      background: var(--bg-primary);
      padding: 1px 6px;
      border-radius: 8px;
      font-size: 0.65rem;
    }

    /* Right panel: messages */
    .message-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    .message-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-secondary);
      flex-shrink: 0;
      gap: 8px;
    }

    .session-info {
      font-size: 0.8rem;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .load-session-btn {
      background: var(--accent-primary);
      color: var(--bg-primary);
      border: none;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 5px 14px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .load-session-btn:hover {
      opacity: 0.9;
    }
    .load-session-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .message-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
    }

    .msg-card {
      margin-bottom: 10px;
      padding: 10px 14px;
      border-radius: var(--radius-md);
      font-size: 0.85rem;
      line-height: 1.5;
      position: relative;
    }

    .msg-card.user {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
    }
    .msg-card.assistant {
      background: var(--bg-primary);
    }

    .msg-role {
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .msg-card.user .msg-role { color: var(--accent-primary); }
    .msg-card.assistant .msg-role { color: var(--accent-green); }

    .msg-content {
      color: var(--text-secondary);
      word-break: break-word;
    }
    .msg-content pre.code-block {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      padding: 8px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      margin: 6px 0;
    }
    .msg-content code {
      font-family: var(--font-mono);
      font-size: 0.8em;
      background: var(--bg-secondary);
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }
    .msg-content pre.code-block code {
      background: none;
      padding: 0;
    }

    /* Message action buttons */
    .msg-actions {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .msg-card:hover .msg-actions {
      opacity: 1;
    }

    .msg-action-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .msg-action-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    /* Empty/loading states */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 0.85rem;
      text-align: center;
      padding: 20px;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    /* Image thumbnails in history messages */
    .msg-images {
      display: flex;
      gap: 6px;
      margin-top: 6px;
      flex-wrap: wrap;
    }
    .msg-images img {
      width: 48px;
      height: 48px;
      object-fit: cover;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-primary);
    }

    /* Toast */
    .toast {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--accent-green);
      border-radius: var(--radius-md);
      padding: 6px 14px;
      font-size: 0.8rem;
      color: var(--accent-green);
      z-index: 10;
      pointer-events: none;
    }

    /* Search result highlight */
    .search-highlight {
      background: rgba(79, 195, 247, 0.2);
      border-radius: 2px;
      padding: 0 1px;
    }
  `]);customElements.define("ac-history-browser",xt);const Si=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;class wt extends z{constructor(){super(),this._state="inactive",this._autoRestart=!1,this._recognition=null,this._supported=!!Si,this._supported&&(this._recognition=new Si,this._recognition.continuous=!1,this._recognition.interimResults=!1,this._recognition.lang=navigator.language||"en-US",this._recognition.onstart=()=>{this._state="listening"},this._recognition.onspeechstart=()=>{this._state="speaking"},this._recognition.onspeechend=()=>{this._state==="speaking"&&(this._state="listening")},this._recognition.onresult=e=>{const t=e.results[e.results.length-1];if(t.isFinal){const i=t[0].transcript.trim();i&&this.dispatchEvent(new CustomEvent("transcript",{detail:{text:i},bubbles:!0,composed:!0}))}},this._recognition.onend=()=>{this._autoRestart?setTimeout(()=>{if(this._autoRestart)try{this._recognition.start()}catch(e){console.warn("[SpeechToText] Auto-restart failed:",e),this._autoRestart=!1,this._state="inactive"}},100):this._state="inactive"},this._recognition.onerror=e=>{this._autoRestart&&(e.error==="no-speech"||e.error==="aborted")||(console.warn("[SpeechToText] Recognition error:",e.error),this._autoRestart=!1,this._state="inactive",this.dispatchEvent(new CustomEvent("speech-error",{detail:{error:e.error},bubbles:!0,composed:!0})))})}disconnectedCallback(){if(super.disconnectedCallback(),this._autoRestart=!1,this._recognition)try{this._recognition.stop()}catch{}this._state="inactive"}_toggle(){if(this._recognition)if(this._autoRestart||this._state!=="inactive"){this._autoRestart=!1;try{this._recognition.stop()}catch{}this._state="inactive"}else{this._autoRestart=!0;try{this._recognition.start()}catch(e){console.warn("[SpeechToText] Failed to start:",e),this._autoRestart=!1,this._state="inactive"}}}render(){return this._supported?f`
      <button
        class=${this._state}
        @click=${this._toggle}
        title=${this._state==="inactive"?"Start voice dictation":"Stop voice dictation"}
        aria-label=${this._state==="inactive"?"Start voice dictation":"Stop voice dictation"}
        aria-pressed=${this._state!=="inactive"}
      >🎤</button>
    `:f``}}$(wt,"properties",{_state:{type:String,state:!0},_supported:{type:Boolean,state:!0}}),$(wt,"styles",[P,L`
    :host {
      display: inline-flex;
      align-items: center;
    }

    button {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1rem;
      width: 36px;
      height: 36px;
      border-radius: var(--radius-md);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      transition: color 0.15s, background 0.15s;
      flex-shrink: 0;
    }

    button:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    /* Listening — orange pulsing */
    button.listening {
      color: var(--accent-orange);
      animation: pulse 1.5s ease-in-out infinite;
    }

    /* Speaking — green solid with glow */
    button.speaking {
      color: var(--accent-green);
      animation: none;
      box-shadow: 0 0 8px rgba(126, 231, 135, 0.5);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `]);customElements.define("ac-speech-to-text",wt);class St extends z{constructor(){super(),this._visible=!1,this._content=null,this._showFull=!1}show(e){this._content=e,this._showFull=!1,this._visible=!0,this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".overlay");t&&t.focus()})}hide(){this._visible=!1,this._content=null,this._showFull=!1}_onOverlayClick(e){e.target===e.currentTarget&&this.hide()}_onKeyDown(e){e.key==="Escape"&&(e.preventDefault(),this.hide())}_toggleFull(){this._showFull=!this._showFull}_formatDate(e){if(!e)return"Unknown";try{return new Date(e).toLocaleString()}catch{return e}}_renderSection(e,t,i=""){return t?f`
      <div class="section">
        <span class="section-label">${e}</span>
        <div class="section-content ${i}">
          ${i==="symbol-map"?t:Y(Xe(t))}
        </div>
      </div>
    `:_}render(){if(!this._visible||!this._content)return _;const e=this._content,t=e.url_type||"generic",i=!!e.readme,s=!!e.summary,r=!!e.symbol_map,o=!!e.content,l=!!e.error,a=s||i||o,c=this._showFull&&o&&(s||i);return f`
      <div class="overlay"
           tabindex="-1"
           @click=${this._onOverlayClick}
           @keydown=${this._onKeyDown}>
        <div class="dialog" @click=${h=>h.stopPropagation()}>

          <!-- Header -->
          <div class="header">
            <h2>URL Content</h2>
            <button class="close-btn" @click=${()=>this.hide()} title="Close" aria-label="Close">✕</button>
          </div>

          <!-- Metadata bar -->
          <div class="meta-bar">
            <span>
              <span class="meta-label">URL:</span>
              <a href="${e.url}" target="_blank" rel="noopener">${e.url}</a>
            </span>
            <span>
              <span class="meta-label">Type:</span>
              <span class="type-badge ${t}">${t}</span>
            </span>
            <span>
              <span class="meta-label">Fetched:</span>
              <span class="meta-value">${this._formatDate(e.fetched_at)}</span>
            </span>
            ${e.title?f`
              <span>
                <span class="meta-label">Title:</span>
                <span class="meta-value">${e.title}</span>
              </span>
            `:_}
          </div>

          <!-- Body -->
          <div class="body">
            ${l?f`
              <div class="error-msg">⚠️ ${e.error}</div>
            `:_}

            ${s?this._renderSection("Summary",e.summary,"summary"):_}

            ${i?this._renderSection("README",e.readme):_}

            ${!s&&!i&&o?this._renderSection("Content",e.content):_}

            ${c?this._renderSection("Full Content",e.content):_}

            ${r?this._renderSection("Symbol Map",e.symbol_map,"symbol-map"):_}
          </div>

          <!-- Footer -->
          <div class="footer">
            ${a&&o&&(s||i)?f`
              <button class="footer-btn" @click=${this._toggleFull}>
                ${this._showFull?"Hide Details":"Show Full Content"}
              </button>
            `:_}
          </div>

        </div>
      </div>
    `}}$(St,"properties",{_visible:{type:Boolean,state:!0},_content:{type:Object,state:!0},_showFull:{type:Boolean,state:!0}}),$(St,"styles",[P,B,L`
    :host {
      display: contents;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dialog {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      width: min(90vw, 800px);
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      flex-shrink: 0;
    }

    .header h2 {
      margin: 0;
      font-size: 1rem;
      color: var(--text-primary);
      font-weight: 600;
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.2rem;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      line-height: 1;
    }
    .close-btn:hover {
      color: var(--text-primary);
      background: var(--bg-secondary);
    }

    /* Metadata bar */
    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      padding: 8px 16px;
      background: rgba(79, 195, 247, 0.06);
      border-bottom: 1px solid var(--border-primary);
      font-size: 0.75rem;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    .meta-bar .meta-label {
      color: var(--text-muted);
      margin-right: 4px;
    }

    .meta-bar .meta-value {
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.75rem;
    }

    .meta-bar a {
      color: var(--accent-primary);
      text-decoration: none;
    }
    .meta-bar a:hover {
      text-decoration: underline;
    }

    /* Scrollable body */
    .body {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }

    /* Content sections */
    .section {
      padding: 0;
    }

    .section-label {
      display: block;
      padding: 6px 16px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      border-top: 1px solid var(--border-primary);
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .section-content {
      padding: 12px 16px;
      font-size: 0.85rem;
      line-height: 1.6;
      color: var(--text-primary);
      max-height: 400px;
      overflow-y: auto;
    }

    .section-content.symbol-map {
      background: rgba(0, 0, 0, 0.2);
      font-family: var(--font-mono);
      font-size: 0.8rem;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.4;
    }

    .section-content.summary {
      background: rgba(79, 195, 247, 0.04);
    }

    /* Markdown inside sections */
    .section-content h1,
    .section-content h2,
    .section-content h3 {
      margin-top: 0.8em;
      margin-bottom: 0.4em;
    }
    .section-content h1 { font-size: 1.1rem; }
    .section-content h2 { font-size: 1rem; }
    .section-content h3 { font-size: 0.95rem; }

    .section-content pre {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.8rem;
    }

    .section-content code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--bg-primary);
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }

    .section-content pre code {
      background: none;
      padding: 0;
    }

    .section-content a {
      color: var(--accent-primary);
      text-decoration: none;
    }
    .section-content a:hover {
      text-decoration: underline;
    }

    .section-content ul,
    .section-content ol {
      padding-left: 24px;
      margin: 6px 0;
    }

    .section-content blockquote {
      border-left: 3px solid var(--border-primary);
      margin: 8px 0;
      padding: 4px 12px;
      color: var(--text-secondary);
    }

    /* Footer with toggle button */
    .footer {
      padding: 8px 16px;
      border-top: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .footer-btn {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 0.8rem;
      padding: 6px 16px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .footer-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    /* Error state */
    .error-msg {
      padding: 24px 16px;
      color: var(--accent-red);
      font-size: 0.85rem;
      text-align: center;
    }

    /* Type badge */
    .type-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 8px;
      font-size: 0.7rem;
      font-weight: 600;
    }
    .type-badge.github_repo { background: rgba(126, 231, 135, 0.15); color: var(--accent-green); }
    .type-badge.github_file { background: rgba(79, 195, 247, 0.15); color: var(--accent-primary); }
    .type-badge.github_issue { background: rgba(255, 180, 50, 0.15); color: #f0a030; }
    .type-badge.github_pr { background: rgba(192, 132, 252, 0.15); color: #c084fc; }
    .type-badge.documentation { background: rgba(79, 195, 247, 0.15); color: var(--accent-primary); }
    .type-badge.generic { background: rgba(160, 160, 160, 0.15); color: var(--text-muted); }
  `]);customElements.define("ac-url-content-dialog",St);function N(){}N.prototype={diff:function(e,t){var i,s=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},r=s.callback;typeof s=="function"&&(r=s,s={});var o=this;function l(w){return w=o.postProcess(w,s),r?(setTimeout(function(){r(w)},0),!0):w}e=this.castInput(e,s),t=this.castInput(t,s),e=this.removeEmpty(this.tokenize(e,s)),t=this.removeEmpty(this.tokenize(t,s));var a=t.length,c=e.length,h=1,d=a+c;s.maxEditLength!=null&&(d=Math.min(d,s.maxEditLength));var u=(i=s.timeout)!==null&&i!==void 0?i:1/0,v=Date.now()+u,m=[{oldPos:-1,lastComponent:void 0}],y=this.extractCommon(m[0],t,e,0,s);if(m[0].oldPos+1>=c&&y+1>=a)return l($i(o,m[0].lastComponent,t,e,o.useLongestToken));var p=-1/0,g=1/0;function b(){for(var w=Math.max(p,-h);w<=Math.min(g,h);w+=2){var H=void 0,ge=m[w-1],ve=m[w+1];ge&&(m[w-1]=void 0);var tt=!1;if(ve){var Wt=ve.oldPos-w;tt=ve&&0<=Wt&&Wt<a}var Xt=ge&&ge.oldPos+1<c;if(!tt&&!Xt){m[w]=void 0;continue}if(!Xt||tt&&ge.oldPos<ve.oldPos?H=o.addToPath(ve,!0,!1,0,s):H=o.addToPath(ge,!1,!0,1,s),y=o.extractCommon(H,t,e,w,s),H.oldPos+1>=c&&y+1>=a)return l($i(o,H.lastComponent,t,e,o.useLongestToken));m[w]=H,H.oldPos+1>=c&&(g=Math.min(g,w-1)),y+1>=a&&(p=Math.max(p,w+1))}h++}if(r)(function w(){setTimeout(function(){if(h>d||Date.now()>v)return r();b()||w()},0)})();else for(;h<=d&&Date.now()<=v;){var k=b();if(k)return k}},addToPath:function(e,t,i,s,r){var o=e.lastComponent;return o&&!r.oneChangePerToken&&o.added===t&&o.removed===i?{oldPos:e.oldPos+s,lastComponent:{count:o.count+1,added:t,removed:i,previousComponent:o.previousComponent}}:{oldPos:e.oldPos+s,lastComponent:{count:1,added:t,removed:i,previousComponent:o}}},extractCommon:function(e,t,i,s,r){for(var o=t.length,l=i.length,a=e.oldPos,c=a-s,h=0;c+1<o&&a+1<l&&this.equals(i[a+1],t[c+1],r);)c++,a++,h++,r.oneChangePerToken&&(e.lastComponent={count:1,previousComponent:e.lastComponent,added:!1,removed:!1});return h&&!r.oneChangePerToken&&(e.lastComponent={count:h,previousComponent:e.lastComponent,added:!1,removed:!1}),e.oldPos=a,c},equals:function(e,t,i){return i.comparator?i.comparator(e,t):e===t||i.ignoreCase&&e.toLowerCase()===t.toLowerCase()},removeEmpty:function(e){for(var t=[],i=0;i<e.length;i++)e[i]&&t.push(e[i]);return t},castInput:function(e){return e},tokenize:function(e){return Array.from(e)},join:function(e){return e.join("")},postProcess:function(e){return e}};function $i(n,e,t,i,s){for(var r=[],o;e;)r.push(e),o=e.previousComponent,delete e.previousComponent,e=o;r.reverse();for(var l=0,a=r.length,c=0,h=0;l<a;l++){var d=r[l];if(d.removed)d.value=n.join(i.slice(h,h+d.count)),h+=d.count;else{if(!d.added&&s){var u=t.slice(c,c+d.count);u=u.map(function(v,m){var y=i[h+m];return y.length>v.length?y:v}),d.value=n.join(u)}else d.value=n.join(t.slice(c,c+d.count));c+=d.count,d.added||(h+=d.count)}}return r}function Ci(n,e){var t;for(t=0;t<n.length&&t<e.length;t++)if(n[t]!=e[t])return n.slice(0,t);return n.slice(0,t)}function ki(n,e){var t;if(!n||!e||n[n.length-1]!=e[e.length-1])return"";for(t=0;t<n.length&&t<e.length;t++)if(n[n.length-(t+1)]!=e[e.length-(t+1)])return n.slice(-t);return n.slice(-t)}function $t(n,e,t){if(n.slice(0,e.length)!=e)throw Error("string ".concat(JSON.stringify(n)," doesn't start with prefix ").concat(JSON.stringify(e),"; this is a bug"));return t+n.slice(e.length)}function Ct(n,e,t){if(!e)return n+t;if(n.slice(-e.length)!=e)throw Error("string ".concat(JSON.stringify(n)," doesn't end with suffix ").concat(JSON.stringify(e),"; this is a bug"));return n.slice(0,-e.length)+t}function xe(n,e){return $t(n,e,"")}function Ue(n,e){return Ct(n,e,"")}function Ei(n,e){return e.slice(0,wn(n,e))}function wn(n,e){var t=0;n.length>e.length&&(t=n.length-e.length);var i=e.length;n.length<e.length&&(i=n.length);var s=Array(i),r=0;s[0]=0;for(var o=1;o<i;o++){for(e[o]==e[r]?s[o]=s[r]:s[o]=r;r>0&&e[o]!=e[r];)r=s[r];e[o]==e[r]&&r++}r=0;for(var l=t;l<n.length;l++){for(;r>0&&n[l]!=e[r];)r=s[r];n[l]==e[r]&&r++}return r}var Ge="a-zA-Z0-9_\\u{C0}-\\u{FF}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}",Sn=new RegExp("[".concat(Ge,"]+|\\s+|[^").concat(Ge,"]"),"ug"),Oe=new N;Oe.equals=function(n,e,t){return t.ignoreCase&&(n=n.toLowerCase(),e=e.toLowerCase()),n.trim()===e.trim()};Oe.tokenize=function(n){var e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},t;if(e.intlSegmenter){if(e.intlSegmenter.resolvedOptions().granularity!="word")throw new Error('The segmenter passed must have a granularity of "word"');t=Array.from(e.intlSegmenter.segment(n),function(r){return r.segment})}else t=n.match(Sn)||[];var i=[],s=null;return t.forEach(function(r){/\s/.test(r)?s==null?i.push(r):i.push(i.pop()+r):/\s/.test(s)?i[i.length-1]==s?i.push(i.pop()+r):i.push(s+r):i.push(r),s=r}),i};Oe.join=function(n){return n.map(function(e,t){return t==0?e:e.replace(/^\s+/,"")}).join("")};Oe.postProcess=function(n,e){if(!n||e.oneChangePerToken)return n;var t=null,i=null,s=null;return n.forEach(function(r){r.added?i=r:r.removed?s=r:((i||s)&&Ai(t,s,i,r),t=r,i=null,s=null)}),(i||s)&&Ai(t,s,i,null),n};function $n(n,e,t){return Oe.diff(n,e,t)}function Ai(n,e,t,i){if(e&&t){var s=e.value.match(/^\s*/)[0],r=e.value.match(/\s*$/)[0],o=t.value.match(/^\s*/)[0],l=t.value.match(/\s*$/)[0];if(n){var a=Ci(s,o);n.value=Ct(n.value,o,a),e.value=xe(e.value,a),t.value=xe(t.value,a)}if(i){var c=ki(r,l);i.value=$t(i.value,l,c),e.value=Ue(e.value,c),t.value=Ue(t.value,c)}}else if(t)n&&(t.value=t.value.replace(/^\s*/,"")),i&&(i.value=i.value.replace(/^\s*/,""));else if(n&&i){var h=i.value.match(/^\s*/)[0],d=e.value.match(/^\s*/)[0],u=e.value.match(/\s*$/)[0],v=Ci(h,d);e.value=xe(e.value,v);var m=ki(xe(h,v),u);e.value=Ue(e.value,m),i.value=$t(i.value,h,m),n.value=Ct(n.value,h,h.slice(0,h.length-m.length))}else if(i){var y=i.value.match(/^\s*/)[0],p=e.value.match(/\s*$/)[0],g=Ei(p,y);e.value=Ue(e.value,g)}else if(n){var b=n.value.match(/\s*$/)[0],k=e.value.match(/^\s*/)[0],w=Ei(b,k);e.value=xe(e.value,w)}}var Cn=new N;Cn.tokenize=function(n){var e=new RegExp("(\\r?\\n)|[".concat(Ge,"]+|[^\\S\\n\\r]+|[^").concat(Ge,"]"),"ug");return n.match(e)||[]};var et=new N;et.tokenize=function(n,e){e.stripTrailingCr&&(n=n.replace(/\r\n/g,`
`));var t=[],i=n.split(/(\n|\r\n)/);i[i.length-1]||i.pop();for(var s=0;s<i.length;s++){var r=i[s];s%2&&!e.newlineIsToken?t[t.length-1]+=r:t.push(r)}return t};et.equals=function(n,e,t){return t.ignoreWhitespace?((!t.newlineIsToken||!n.includes(`
`))&&(n=n.trim()),(!t.newlineIsToken||!e.includes(`
`))&&(e=e.trim())):t.ignoreNewlineAtEof&&!t.newlineIsToken&&(n.endsWith(`
`)&&(n=n.slice(0,-1)),e.endsWith(`
`)&&(e=e.slice(0,-1))),N.prototype.equals.call(this,n,e,t)};function kn(n,e,t){return et.diff(n,e,t)}var En=new N;En.tokenize=function(n){return n.split(/(\S.+?[.!?])(?=\s+|$)/)};var An=new N;An.tokenize=function(n){return n.split(/([{}:;,]|\s+)/)};function kt(n){"@babel/helpers - typeof";return kt=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(e){return typeof e}:function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},kt(n)}var De=new N;De.useLongestToken=!0;De.tokenize=et.tokenize;De.castInput=function(n,e){var t=e.undefinedReplacement,i=e.stringifyReplacer,s=i===void 0?function(r,o){return typeof o>"u"?t:o}:i;return typeof n=="string"?n:JSON.stringify(Et(n,null,null,s),s,"  ")};De.equals=function(n,e,t){return N.prototype.equals.call(De,n.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"),t)};function Et(n,e,t,i,s){e=e||[],t=t||[],i&&(n=i(s,n));var r;for(r=0;r<e.length;r+=1)if(e[r]===n)return t[r];var o;if(Object.prototype.toString.call(n)==="[object Array]"){for(e.push(n),o=new Array(n.length),t.push(o),r=0;r<n.length;r+=1)o[r]=Et(n[r],e,t,i,s);return e.pop(),t.pop(),o}if(n&&n.toJSON&&(n=n.toJSON()),kt(n)==="object"&&n!==null){e.push(n),o={},t.push(o);var l=[],a;for(a in n)Object.prototype.hasOwnProperty.call(n,a)&&l.push(a);for(l.sort(),r=0;r<l.length;r+=1)a=l[r],o[a]=Et(n[a],e,t,i,a);e.pop(),t.pop()}else o=n;return o}var At=new N;At.tokenize=function(n){return n.slice()};At.join=At.removeEmpty=function(n){return n};const ht="««« EDIT",Tn="═══════ REPL",Mn="»»» EDIT END";function Ti(n){const e=n.trim();return!e||e.length>200||/^[#\/*\->]|^```/.test(e)?!1:!!(e.includes("/")||e.includes("\\")||/^[\w\-.]+\.\w+$/.test(e))}function zn(n){const e=n.split(`
`),t=[];let i=[],s="text",r="",o=[],l=[];function a(){i.length>0&&(t.push({type:"text",content:i.join(`
`)}),i=[])}for(let c=0;c<e.length;c++){const h=e[c],d=h.trim();if(s==="text")Ti(d)&&d!==ht?(r=d,s="expect_edit"):i.push(h);else if(s==="expect_edit")d===ht?(i.length>0&&/^`{3,}\s*\w*$/.test(i[i.length-1].trim())&&i.pop(),a(),o=[],l=[],s="old"):Ti(d)&&d!==ht?(i.push(r),r=d):(i.push(r),i.push(h),r="",s="text");else if(s==="old")d===Tn||d.startsWith("═══════")?s="new":o.push(h);else if(s==="new")if(d===Mn){const u=o.length===0;t.push({type:"edit",filePath:r,oldLines:[...o],newLines:[...l],isCreate:u}),r="",o=[],l=[],s="text",c+1<e.length&&/^`{3,}\s*$/.test(e[c+1].trim())&&c++}else l.push(h)}return s==="old"||s==="new"?t.push({type:"edit-pending",filePath:r,oldLines:[...o],newLines:[...l]}):(s==="expect_edit"&&i.push(r),a()),t}function Mi(n){if(n.length===0)return n;const e=[n[0]];for(let t=1;t<n.length;t++){const i=e[e.length-1];n[t].type===i.type?i.text+=n[t].text:e.push(n[t])}return e}function Ln(n,e){const t=$n(n,e),i=[],s=[];for(const r of t)r.added?s.push({type:"insert",text:r.value}):r.removed?i.push({type:"delete",text:r.value}):(i.push({type:"equal",text:r.value}),s.push({type:"equal",text:r.value}));return{old:Mi(i),new:Mi(s)}}function Rn(n,e){const t=n.join(`
`),i=e.join(`
`),s=kn(t,i),r=[];for(const l of s){const a=l.value.replace(/\n$/,"").split(`
`);for(const c of a)l.added?r.push({type:"add",text:c}):l.removed?r.push({type:"remove",text:c}):r.push({type:"context",text:c})}let o=0;for(;o<r.length;){const l=o;for(;o<r.length&&r[o].type==="remove";)o++;const a=o,c=o;for(;o<r.length&&r[o].type==="add";)o++;const h=o,d=a-l,u=h-c;if(d>0&&u>0){const v=Math.min(d,u);for(let m=0;m<v;m++){const y=Ln(r[l+m].text,r[c+m].text);r[l+m].charDiff=y.old,r[c+m].charDiff=y.new}}o===l&&o++}return r}function zi(n,e,t,i=[]){if(!e||e.length===0)return{html:n,referencedFiles:[]};const s=new Set(t||[]),r=new Set(i),o=e.filter(p=>n.includes(p));if(o.length===0)return{html:n,referencedFiles:[...r]};o.sort((p,g)=>g.length-p.length);const l=o.map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),a=new RegExp("("+l.join("|")+")","g"),c=[];let h=!1;const d=/<\/?[a-zA-Z][^>]*>/g;let u;const v=[];for(;(u=d.exec(n))!==null;)v.push({index:u.index,end:u.index+u[0].length,tag:u[0]});let m=0,y=0;for(;y<n.length;){for(;m<v.length&&v[m].end<=y;)m++;const p=m<v.length?v[m]:null,g=p?p.index:n.length;if(y<g&&!h){const k=n.slice(y,g).replace(a,w=>(r.add(w),`<span class="${s.has(w)?"file-mention in-context":"file-mention"}" data-file="${M(w)}">${M(w)}</span>`));c.push(k)}else y<g&&c.push(n.slice(y,g));if(p){c.push(p.tag);const b=p.tag.toLowerCase();b.startsWith("<pre")?h=!0:b.startsWith("</pre")&&(h=!1),y=p.end}else y=g}return{html:c.join(""),referencedFiles:[...r]}}function In(n,e){if(!n||n.length===0)return"";const t=new Set(e||[]),i=n.filter(l=>t.has(l)),s=n.filter(l=>!t.has(l)),r=[];for(const l of i){const a=l.split("/").pop();r.push(`<span class="file-chip in-context" data-file="${M(l)}" title="${M(l)}">✓ ${M(a)}</span>`)}for(const l of s){const a=l.split("/").pop();r.push(`<span class="file-chip addable" data-file="${M(l)}" title="${M(l)}">+ ${M(a)}</span>`)}return`<div class="file-summary"><span class="file-summary-label">📁 Files Referenced</span>${s.length>=2?`<button class="add-all-btn" data-files='${JSON.stringify(s).replace(/'/g,"&#39;")}'>+ Add All (${s.length})</button>`:""}<div class="file-chips">${r.join("")}</div></div>`}function M(n){return n.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}class Tt extends U(z){constructor(){super(),this.messages=[],this.selectedFiles=[],this.streamingActive=!1,this.reviewState={active:!1},this._streamingContent="",this._inputValue="",this._images=[],this._autoScroll=!0,this._snippetDrawerOpen=this._loadBoolPref("ac-dc-snippet-drawer",!1),this._historyOpen=!1,this._snippets=[],this._observer=null,this._pendingChunk=null,this._rafId=null,this._currentRequestId=null,this._confirmAction=null,this._toast=null,this._committing=!1,this._repoFiles=[],this._chatSearchQuery="",this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._atFilterActive=!1,this._onStreamChunk=this._onStreamChunk.bind(this),this._onStreamComplete=this._onStreamComplete.bind(this),this._onViewUrlContent=this._onViewUrlContent.bind(this),this._onCompactionEvent=this._onCompactionEvent.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-chunk",this._onStreamChunk),window.addEventListener("stream-complete",this._onStreamComplete),window.addEventListener("compaction-event",this._onCompactionEvent),this.addEventListener("view-url-content",this._onViewUrlContent)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-chunk",this._onStreamChunk),window.removeEventListener("stream-complete",this._onStreamComplete),window.removeEventListener("compaction-event",this._onCompactionEvent),this.removeEventListener("view-url-content",this._onViewUrlContent),this._rafId&&cancelAnimationFrame(this._rafId),this._observer&&this._observer.disconnect()}firstUpdated(){const e=this.shadowRoot.querySelector(".scroll-sentinel"),t=this.shadowRoot.querySelector(".messages");e&&t&&(this._observer=new IntersectionObserver(([i])=>{i.isIntersecting?this._autoScroll=!0:this.streamingActive||(this._autoScroll=!1)},{root:t,threshold:.01}),this._observer.observe(e),this._lastScrollTop=0,t.addEventListener("scroll",()=>{this.streamingActive&&t.scrollTop<this._lastScrollTop-30&&(this._autoScroll=!1),this._lastScrollTop=t.scrollTop},{passive:!0})),this.messages.length>0&&requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom()))}onRpcReady(){this._loadSnippets(),this._loadRepoFiles()}updated(e){if(super.updated(e),e.has("reviewState")&&this._loadSnippets(),e.has("messages")&&!this.streamingActive){const t=e.get("messages");(!t||t.length===0)&&this.messages.length>0&&(this._autoScroll=!0,requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom())))}}async _loadRepoFiles(){try{const e=await this.rpcExtract("Repo.get_flat_file_list");Array.isArray(e)?this._repoFiles=e:e!=null&&e.files&&Array.isArray(e.files)&&(this._repoFiles=e.files)}catch(e){console.warn("Failed to load repo files:",e)}}async _loadSnippets(){try{const e=await this.rpcExtract("LLMService.get_snippets");Array.isArray(e)&&(this._snippets=e)}catch(e){console.warn("Failed to load snippets:",e)}}_onStreamChunk(e){const{requestId:t,content:i}=e.detail;t===this._currentRequestId&&(this.streamingActive=!0,this._pendingChunk=i,this._rafId||(this._rafId=requestAnimationFrame(()=>{this._rafId=null,this._pendingChunk!==null&&(this._streamingContent=this._pendingChunk,this._pendingChunk=null,this._autoScroll&&this.updateComplete.then(()=>{requestAnimationFrame(()=>this._scrollToBottom())}))})))}_onStreamComplete(e){var s,r;const{requestId:t,result:i}=e.detail;if(t===this._currentRequestId){if(this._pendingChunk!==null&&(this._streamingContent=this._pendingChunk,this._pendingChunk=null),this.streamingActive=!1,this._currentRequestId=null,i!=null&&i.error)this.messages=[...this.messages,{role:"assistant",content:`**Error:** ${i.error}`}];else if(i!=null&&i.response){const o={};if(i.edit_results){o.editResults={};for(const l of i.edit_results)o.editResults[l.file]={status:l.status,message:l.message}}(i.passed||i.failed||i.skipped||i.not_in_context)&&(o.passed=i.passed||0,o.failed=i.failed||0,o.skipped=i.skipped||0,o.not_in_context=i.not_in_context||0,i.files_auto_added&&(o.files_auto_added=i.files_auto_added)),this.messages=[...this.messages,{role:"assistant",content:i.response,...Object.keys(o).length>0?o:{}}]}if(this._streamingContent="",this._pendingChunk=null,this._autoScroll&&this.updateComplete.then(()=>{requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom()))}),((s=i==null?void 0:i.files_modified)==null?void 0:s.length)>0&&(this.dispatchEvent(new CustomEvent("files-modified",{detail:{files:i.files_modified},bubbles:!0,composed:!0})),this._loadRepoFiles()),i!=null&&i.edit_results){const o=i.edit_results.filter(l=>l.status==="failed"&&l.message&&l.message.includes("Ambiguous anchor"));o.length>0&&this._populateAmbiguousRetryPrompt(o)}((r=i==null?void 0:i.files_auto_added)==null?void 0:r.length)>0&&this._populateNotInContextRetryPrompt(i.files_auto_added)}}_onCompactionEvent(e){const{requestId:t,event:i}=e.detail||{};if(t!==this._currentRequestId)return;const s=(i==null?void 0:i.stage)||"",r=(i==null?void 0:i.message)||"";(s==="url_fetch"||s==="url_ready")&&this._showToast(r,s==="url_ready"?"success":"")}_populateAmbiguousRetryPrompt(e){var r;const i=`Some edits failed due to ambiguous anchors (the context lines matched multiple locations in the file). Please retry these edits with more unique anchor context — include a distinctive preceding line (like a function name, class definition, or unique comment) to disambiguate:

`+e.map(o=>`- ${o.file}: ${o.message}`).join(`
`);this._inputValue=i;const s=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");s&&(s.value=i,this._autoResize(s),s.focus())}_populateNotInContextRetryPrompt(e){var o;const t=e.map(l=>l.split("/").pop()),i=e.map(l=>`- ${l}`).join(`
`),s=e.length===1?`The file ${t[0]} has been added to context. Please retry the edit for:

${i}`:`The files ${t.join(", ")} have been added to context. Please retry the edits for:

${i}`;this._inputValue=s;const r=(o=this.shadowRoot)==null?void 0:o.querySelector(".input-textarea");r&&(r.value=s,this._autoResize(r),r.focus())}_scrollToBottom(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".messages");e&&(e.scrollTop=e.scrollHeight+1e3)}_onScrollBtnClick(){this._autoScroll=!0,this._scrollToBottom()}_onInput(e){this._inputValue=e.target.value,this._autoResize(e.target),this._onInputForUrlDetection(),this._checkAtFilter(this._inputValue)}_autoResize(e){e.style.height="auto",e.style.height=Math.min(e.scrollHeight,200)+"px"}_onKeyDown(e){var i,s;const t=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-input-history");if(!(t!=null&&t.open&&t.handleKey(e))){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(),this._send();return}if(e.key==="ArrowUp"){const r=e.target;if(r.selectionStart===0&&r.selectionEnd===0){e.preventDefault(),t&&(t.show(this._inputValue),this._historyOpen=!0);return}}if(e.key==="Escape"){if(e.preventDefault(),this._atFilterActive)this._clearAtFilter();else if(this._snippetDrawerOpen)this._snippetDrawerOpen=!1;else if(this._inputValue){this._inputValue="";const r=(s=this.shadowRoot)==null?void 0:s.querySelector(".input-textarea");r&&(r.value="",r.style.height="auto")}}}}_onPaste(e){var i;if(this._suppressNextPaste){this._suppressNextPaste=!1,e.preventDefault();return}const t=(i=e.clipboardData)==null?void 0:i.items;if(t){for(const s of t)if(s.type.startsWith("image/")){e.preventDefault();const r=s.getAsFile();if(!r)continue;if(r.size>5*1024*1024){console.warn("Image too large (max 5MB)");continue}if(this._images.length>=5){console.warn("Max 5 images per message");continue}const o=new FileReader;o.onload=()=>{this._images=[...this._images,o.result]},o.readAsDataURL(r);break}}}_removeImage(e){this._images=this._images.filter((t,i)=>i!==e)}async _send(){var c,h,d,u;const e=this._inputValue.trim();if(!e&&this._images.length===0||!this.rpcConnected)return;const t=(c=this.shadowRoot)==null?void 0:c.querySelector("ac-input-history");t&&e&&t.addEntry(e);const i=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;this._currentRequestId=i;const s=this._images.length>0?[...this._images]:null,r=((h=this.selectedFiles)==null?void 0:h.length)>0?[...this.selectedFiles]:null,o=(d=this.shadowRoot)==null?void 0:d.querySelector("ac-url-chips");o==null||o.onSend();const l={role:"user",content:e};s&&s.length>0&&(l.images=[...s]),this.messages=[...this.messages,l],this._inputValue="",this._images=[],this._snippetDrawerOpen=!1,this._saveBoolPref("ac-dc-snippet-drawer",!1);const a=(u=this.shadowRoot)==null?void 0:u.querySelector(".input-textarea");a&&(a.value="",a.style.height="auto"),this._autoScroll=!0,this.streamingActive=!0,requestAnimationFrame(()=>this._scrollToBottom());try{await this.rpcExtract("LLMService.chat_streaming",i,e,r,s)}catch(v){console.error("Failed to start stream:",v),this.streamingActive=!1,this._currentRequestId=null;const m=v.message||"Failed to connect";this.messages=[...this.messages,{role:"assistant",content:`**Error:** ${m}`}],this._showToast(`Stream failed: ${m}`,"error")}}async _stop(){if(!(!this._currentRequestId||!this.rpcConnected))try{await this.rpcExtract("LLMService.cancel_streaming",this._currentRequestId)}catch(e){console.error("Failed to cancel:",e)}}_toggleSnippets(){this._snippetDrawerOpen=!this._snippetDrawerOpen,this._saveBoolPref("ac-dc-snippet-drawer",this._snippetDrawerOpen)}_saveBoolPref(e,t){try{localStorage.setItem(e,String(t))}catch{}}_loadBoolPref(e,t){try{const i=localStorage.getItem(e);return i===null?t:i==="true"}catch{return t}}_insertSnippet(e){var a;const t=(a=this.shadowRoot)==null?void 0:a.querySelector(".input-textarea");if(!t)return;const i=e.message||"",s=t.selectionStart,r=this._inputValue.slice(0,s),o=this._inputValue.slice(t.selectionEnd);this._inputValue=r+i+o,t.value=this._inputValue,this._autoResize(t);const l=s+i.length;t.setSelectionRange(l,l),t.focus()}_onHistorySelect(e){var s,r;const t=((s=e.detail)==null?void 0:s.text)??"";this._inputValue=t,this._historyOpen=!1;const i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");i&&(i.value=t,this._autoResize(i),i.focus())}_onHistoryCancel(e){var s,r;const t=((s=e.detail)==null?void 0:s.text)??"";this._inputValue=t,this._historyOpen=!1;const i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");i&&(i.value=t,i.focus())}_onInputForUrlDetection(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-url-chips");e&&e.detectUrls(this._inputValue)}_onTranscript(e){var s,r;const t=(s=e.detail)==null?void 0:s.text;if(!t)return;const i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");this._inputValue&&!this._inputValue.endsWith(" ")&&(this._inputValue+=" "),this._inputValue+=t,i&&(i.value=this._inputValue,this._autoResize(i)),this._onInputForUrlDetection()}async _newSession(){var e;if(this.rpcConnected)try{await this.rpcExtract("LLMService.new_session"),this.messages=[],this._streamingContent="",this._currentRequestId=null,this.streamingActive=!1,this._chatSearchQuery="",this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._clearSearchHighlights();const t=(e=this.shadowRoot)==null?void 0:e.querySelector("ac-url-chips");t&&t.clear(),this._showToast("New session started","success")}catch(t){console.error("Failed to start new session:",t),this._showToast("Failed to start new session","error")}}_openHistoryBrowser(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-history-browser");e&&e.show()}_onSessionLoaded(e){const{messages:t,sessionId:i}=e.detail;Array.isArray(t)&&(this.messages=[...t],this._autoScroll=!0,requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom()))),this.dispatchEvent(new CustomEvent("session-loaded",{detail:{sessionId:i,messages:t},bubbles:!0,composed:!0}))}_onPasteToPrompt(e){var s,r;const t=((s=e.detail)==null?void 0:s.text)||"";if(!t)return;const i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");i&&(this._inputValue=t,i.value=t,this._autoResize(i),i.focus())}async _onViewUrlContent(e){var i,s;const t=(i=e.detail)==null?void 0:i.url;if(!(!t||!this.rpcConnected))try{const r=await this.rpcExtract("LLMService.get_url_content",t);if(!r){this._showToast("Failed to load URL content","error");return}const o=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-url-content-dialog");o&&o.show(r)}catch(r){console.error("Failed to load URL content:",r),this._showToast("Failed to load URL content","error")}}async _copyDiff(){if(this.rpcConnected)try{const e=await this.rpcExtract("Repo.get_staged_diff"),t=await this.rpcExtract("Repo.get_unstaged_diff"),i=(e==null?void 0:e.diff)||"",s=(t==null?void 0:t.diff)||"",r=[i,s].filter(Boolean).join(`
`);if(!r.trim()){this._showToast("No changes to copy","error");return}await navigator.clipboard.writeText(r),this._showToast("Diff copied to clipboard","success")}catch(e){console.error("Failed to copy diff:",e),this._showToast("Failed to copy diff","error")}}async _commitWithMessage(){var t;if(!this.rpcConnected||this._committing)return;this._committing=!0;const e={role:"assistant",content:"⏳ **Staging changes and generating commit message...**"};this.messages=[...this.messages,e],this._autoScroll&&requestAnimationFrame(()=>this._scrollToBottom());try{const i=await this.rpcExtract("Repo.stage_all");if(i!=null&&i.error){this._removeProgressMsg(e),this._showToast(`Stage failed: ${i.error}`,"error");return}const s=await this.rpcExtract("Repo.get_staged_diff"),r=(s==null?void 0:s.diff)||"";if(!r.trim()){this._removeProgressMsg(e),this._showToast("Nothing to commit","error");return}const o=await this.rpcExtract("LLMService.generate_commit_message",r);if(o!=null&&o.error){this._removeProgressMsg(e),this._showToast(`Message generation failed: ${o.error}`,"error");return}const l=o==null?void 0:o.message;if(!l){this._removeProgressMsg(e),this._showToast("Failed to generate commit message","error");return}const a=await this.rpcExtract("Repo.commit",l);if(a!=null&&a.error){this._removeProgressMsg(e),this._showToast(`Commit failed: ${a.error}`,"error");return}const c=((t=a==null?void 0:a.sha)==null?void 0:t.slice(0,7))||"";this._showToast(`Committed ${c}: ${l.split(`
`)[0]}`,"success");const h=this.messages.filter(d=>d!==e);this.messages=[...h,{role:"assistant",content:`**Committed** \`${c}\`

\`\`\`
${l}
\`\`\``}],this._autoScroll&&requestAnimationFrame(()=>this._scrollToBottom()),this.dispatchEvent(new CustomEvent("files-modified",{detail:{files:[]},bubbles:!0,composed:!0}))}catch(i){console.error("Commit failed:",i),this._removeProgressMsg(e),this._showToast(`Commit failed: ${i.message||"Unknown error"}`,"error")}finally{this._committing=!1}}_removeProgressMsg(e){this.messages=this.messages.filter(t=>t!==e)}_confirmReset(){this._confirmAction={title:"Reset to HEAD",message:"This will discard ALL uncommitted changes (staged and unstaged). This cannot be undone.",action:()=>this._resetHard()},this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".confirm-cancel");e&&e.focus()})}async _resetHard(){if(this._confirmAction=null,!!this.rpcConnected)try{const e=await this.rpcExtract("Repo.reset_hard");if(e!=null&&e.error){this._showToast(`Reset failed: ${e.error}`,"error");return}this._showToast("Reset to HEAD — all changes discarded","success"),this.dispatchEvent(new CustomEvent("files-modified",{detail:{files:[]},bubbles:!0,composed:!0}))}catch(e){console.error("Reset failed:",e),this._showToast(`Reset failed: ${e.message||"Unknown error"}`,"error")}}_dismissConfirm(){this._confirmAction=null}_showToast(e,t=""){this._toast={message:e,type:t},clearTimeout(this._toastTimer),this._toastTimer=setTimeout(()=>{this._toast=null},3e3)}_onChatSearchInput(e){this._chatSearchQuery=e.target.value,this._updateChatSearchMatches()}_onChatSearchKeyDown(e){e.key==="Enter"?(e.preventDefault(),e.shiftKey?this._chatSearchPrev():this._chatSearchNext()):e.key==="Escape"&&(e.preventDefault(),this._clearChatSearch(),e.target.blur())}_updateChatSearchMatches(){const e=this._chatSearchQuery.trim().toLowerCase();if(!e){this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._clearSearchHighlights();return}const t=[];for(let i=0;i<this.messages.length;i++)(this.messages[i].content||"").toLowerCase().includes(e)&&t.push(i);this._chatSearchMatches=t,t.length>0?(this._chatSearchCurrent=0,this._scrollToSearchMatch(t[0])):(this._chatSearchCurrent=-1,this._clearSearchHighlights())}_chatSearchNext(){this._chatSearchMatches.length!==0&&(this._chatSearchCurrent=(this._chatSearchCurrent+1)%this._chatSearchMatches.length,this._scrollToSearchMatch(this._chatSearchMatches[this._chatSearchCurrent]))}_chatSearchPrev(){this._chatSearchMatches.length!==0&&(this._chatSearchCurrent=(this._chatSearchCurrent-1+this._chatSearchMatches.length)%this._chatSearchMatches.length,this._scrollToSearchMatch(this._chatSearchMatches[this._chatSearchCurrent]))}_scrollToSearchMatch(e){this._clearSearchHighlights(),this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(`.message-card[data-msg-index="${e}"]`);t&&(t.classList.add("search-highlight"),t.scrollIntoView({block:"center",behavior:"smooth"}))})}_clearSearchHighlights(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelectorAll(".message-card.search-highlight");if(e)for(const i of e)i.classList.remove("search-highlight")}_clearChatSearch(){this._chatSearchQuery="",this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._clearSearchHighlights()}_getReviewDiffCount(){var t;if(!((t=this.reviewState)!=null&&t.active)||!this.reviewState.changed_files)return 0;const e=new Set(this.reviewState.changed_files.map(i=>i.path));return(this.selectedFiles||[]).filter(i=>e.has(i)).length}_checkAtFilter(e){const t=e.match(/@(\S*)$/);t?(this._atFilterActive=!0,this.dispatchEvent(new CustomEvent("filter-from-chat",{detail:{filter:t[1]},bubbles:!0,composed:!0}))):this._atFilterActive&&(this._atFilterActive=!1,this.dispatchEvent(new CustomEvent("filter-from-chat",{detail:{filter:""},bubbles:!0,composed:!0})))}_clearAtFilter(){var t;if(!this._atFilterActive)return!1;const e=this._inputValue.match(/@\S*$/);if(e){this._inputValue=this._inputValue.slice(0,e.index).trimEnd();const i=(t=this.shadowRoot)==null?void 0:t.querySelector(".input-textarea");i&&(i.value=this._inputValue,this._autoResize(i))}return this._atFilterActive=!1,this.dispatchEvent(new CustomEvent("filter-from-chat",{detail:{filter:""},bubbles:!0,composed:!0})),!0}accumulateFileInInput(e){var r;const t=e.split("/").pop(),i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea"),s=this._inputValue.trim();if(!s)this._inputValue=`The file ${t} added. Do you want to see more files before you continue?`;else if(/^The file .+ added\./.test(s)||/\(added .+\)$/.test(s))if(s.includes("Do you want to see more files")){const o=s.match(/^The file (.+?) added\./);if(o)this._inputValue=`The files ${o[1]}, ${t} added. Do you want to see more files before you continue?`;else{const l=s.match(/^The files (.+?) added\./);l&&(this._inputValue=`The files ${l[1]}, ${t} added. Do you want to see more files before you continue?`)}}else this._inputValue=s+` (added ${t})`;else this._inputValue=s+` (added ${t})`;i&&(i.value=this._inputValue,this._autoResize(i))}_getMessageText(e){const t=e.content;return Array.isArray(t)?t.filter(i=>i.type==="text"&&i.text).map(i=>i.text).join(`
`):t||""}_copyMessageText(e){navigator.clipboard.writeText(this._getMessageText(e)).then(()=>{this._showToast("Copied to clipboard","success")})}_insertMessageText(e){var s;const t=this._getMessageText(e),i=(s=this.shadowRoot)==null?void 0:s.querySelector(".input-textarea");i&&(this._inputValue=t,i.value=t,this._autoResize(i),i.focus())}_renderAssistantContent(e,t,i){const s=t||{},r=zn(e),o=[];for(const l of r)if(l.type==="text"){let a=Xe(l.content);if(i&&this._repoFiles.length>0){const{html:c}=zi(a,this._repoFiles,this.selectedFiles,[]);a=c}o.push(a)}else if(l.type==="edit"||l.type==="edit-pending"){const a=s[l.filePath]||{};o.push(this._renderEditBlockHtml(l,a))}return o.join("")}_renderEditBlockHtml(e,t){const i=t.status||(e.type==="edit-pending"?"pending":"unknown"),s=t.message||"";let r="";i==="applied"?r='<span class="edit-badge applied">✅ applied</span>':i==="failed"?r='<span class="edit-badge failed">❌ failed</span>':i==="skipped"?r='<span class="edit-badge skipped">⚠️ skipped</span>':i==="validated"?r='<span class="edit-badge validated">☑ validated</span>':i==="not_in_context"?r='<span class="edit-badge not-in-context">⚠️ not in context</span>':e.isCreate?r='<span class="edit-badge applied">🆕 new</span>':r='<span class="edit-badge pending">⏳ pending</span>';const l=Rn(e.oldLines||[],e.newLines||[]).map(u=>this._renderDiffLineHtml(u)).join(""),a=i==="failed"&&s?`<div class="edit-error">${M(s)}</div>`:"",h=((e.newLines&&e.newLines.length>0?e.newLines:e.oldLines)||[]).slice(0,5).join(`
`).trim(),d=M(h);return`
      <div class="edit-block-card">
        <div class="edit-block-header">
          <span class="edit-file-path" data-path="${M(e.filePath)}">${M(e.filePath)}</span>
          <button class="edit-goto-btn" data-path="${M(e.filePath)}" data-search="${d}" title="Open in diff viewer">↗</button>
          ${r}
        </div>
        ${a}
        <pre class="edit-diff">${l}</pre>
      </div>
    `}_renderDiffLineHtml(e){const t=e.type==="remove"?"-":e.type==="add"?"+":" ";if(e.charDiff&&e.charDiff.length>0){const i=e.charDiff.map(s=>s.type==="equal"?M(s.text):`<span class="diff-change">${M(s.text)}</span>`).join("");return`<span class="diff-line ${e.type}"><span class="diff-line-prefix">${t}</span>${i}</span>`}return`<span class="diff-line ${e.type}"><span class="diff-line-prefix">${t}</span>${M(e.text)}</span>`}_renderEditSummary(e){var o;if(!e.passed&&!e.failed&&!e.skipped&&!e.not_in_context)return _;const t=[];e.passed&&t.push(f`<span class="stat pass">✅ ${e.passed} applied</span>`),e.failed&&t.push(f`<span class="stat fail">❌ ${e.failed} failed</span>`),e.skipped&&t.push(f`<span class="stat skip">⚠️ ${e.skipped} skipped</span>`),e.not_in_context&&t.push(f`<span class="stat skip">⚠️ ${e.not_in_context} not in context</span>`);const i=((o=e.files_auto_added)==null?void 0:o.length)>0?f`<div style="margin-top:4px;font-size:0.75rem;color:var(--text-secondary)">
          ${e.files_auto_added.length} file${e.files_auto_added.length>1?"s were":" was"} added to context. Send a follow-up to retry those edits.
        </div>`:_,r=e.editResults&&Object.values(e.editResults).some(l=>l.status==="failed")?f`<div style="margin-top:4px;font-size:0.75rem;color:var(--text-secondary)">
          A retry prompt has been prepared in the input below.
        </div>`:_;return f`<div class="edit-summary">${t}${i}${r}</div>`}_renderMsgActions(e){return this.streamingActive?_:f`
      <div class="msg-actions top">
        <button class="msg-action-btn" title="Copy" @click=${()=>this._copyMessageText(e)}>📋</button>
        <button class="msg-action-btn" title="Insert into input" @click=${()=>this._insertMessageText(e)}>↩</button>
      </div>
    `}_renderMsgActionsBottom(e){return this.streamingActive||(e.content||"").length<600?_:f`
      <div class="msg-actions bottom">
        <button class="msg-action-btn" title="Copy" @click=${()=>this._copyMessageText(e)}>📋</button>
        <button class="msg-action-btn" title="Insert into input" @click=${()=>this._insertMessageText(e)}>↩</button>
      </div>
    `}_renderUserContent(e){var r;const t=e.content;if(Array.isArray(t)){const o=[],l=[];for(const a of t)a.type==="text"&&a.text?o.push(f`<div class="md-content" @click=${this._onContentClick}>
            ${Y(Xe(a.text))}
          </div>`):a.type==="image_url"&&((r=a.image_url)!=null&&r.url)&&l.push(a.image_url.url);return l.length>0&&o.push(f`
          <div class="user-images">
            ${l.map(a=>f`
              <img class="user-image-thumb" src="${a}" alt="User image"
                   @click=${()=>this._openLightbox(a)}>
            `)}
          </div>
        `),o}const i=t||"",s=f`<div class="md-content" @click=${this._onContentClick}>
      ${Y(Xe(i))}
    </div>`;return e.images&&e.images.length>0?f`
        ${s}
        <div class="user-images">
          ${e.images.map(o=>f`
            <img class="user-image-thumb" src="${o}" alt="User image"
                 @click=${()=>this._openLightbox(o)}>
          `)}
        </div>
      `:s}_openLightbox(e){this._lightboxSrc=e,this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".image-lightbox");t&&t.focus()})}_closeLightbox(e){this._lightboxSrc=null}_onLightboxKeyDown(e){e.key==="Escape"&&(e.preventDefault(),this._lightboxSrc=null)}_renderMessage(e,t){const i=e.role==="user",s=e.content||"",o=this.messages.length-t<=15?" force-visible":"";if(i)return f`
        <div class="message-card user${o}" data-msg-index="${t}">
          ${this._renderMsgActions(e)}
          <div class="role-label">You</div>
          ${this._renderUserContent(e)}
          ${this._renderMsgActionsBottom(e)}
        </div>
      `;const l=e.editResults?Object.keys(e.editResults):[],a=this._renderAssistantContent(s,e.editResults,!0),{html:c,referencedFiles:h}=zi(a,this._repoFiles,this.selectedFiles,l),d=In(h,this.selectedFiles);return f`
      <div class="message-card assistant" data-msg-index="${t}">
        ${this._renderMsgActions(e)}
        <div class="role-label">Assistant</div>
        <div class="md-content" @click=${this._onContentClick}>
          ${Y(c)}
        </div>
        ${d?f`
          <div class="file-summary-container" @click=${this._onFileSummaryClick}>
            ${Y(d)}
          </div>
        `:_}
        ${this._renderEditSummary(e)}
        ${this._renderMsgActionsBottom(e)}
      </div>
    `}_onContentClick(e){const t=e.target.closest(".file-mention");if(t){const o=t.dataset.file;o&&this._dispatchFileMentionClick(o,!0);return}const i=e.target.closest(".edit-file-path");if(i){const o=i.dataset.path;o&&this._dispatchFileMentionClick(o,!1);return}const s=e.target.closest(".edit-goto-btn");if(s){const o=s.dataset.path,l=s.dataset.search||"";o&&window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:o,searchText:l}}));return}const r=e.target.closest(".code-copy-btn");if(r){const o=r.closest("pre");if(o){const l=o.querySelector("code"),a=l?l.textContent:o.textContent;navigator.clipboard.writeText(a).then(()=>{r.textContent="✓ Copied",r.classList.add("copied"),setTimeout(()=>{r.textContent="📋",r.classList.remove("copied")},1500)}).catch(()=>{r.textContent="✗ Failed",setTimeout(()=>{r.textContent="📋"},1500)})}return}}_onFileSummaryClick(e){const t=e.target.closest(".file-chip");if(t){const s=t.dataset.file;s&&this._dispatchFileMentionClick(s,!1);return}const i=e.target.closest(".add-all-btn");if(i)try{const s=JSON.parse(i.dataset.files);if(Array.isArray(s))for(const r of s)this._dispatchFileMentionClick(r,!1)}catch(s){console.warn("Failed to parse add-all files:",s)}}_dispatchFileMentionClick(e,t=!0){this.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:e,navigate:t},bubbles:!0,composed:!0}))}render(){var t,i,s,r,o,l,a,c,h;const e=this.messages.length>0||this._streamingContent;return f`
      <!-- Action Bar -->
      <div class="action-bar" role="toolbar" aria-label="Chat actions">
        <button class="action-btn" title="New session" aria-label="New session" @click=${this._newSession}>✨</button>
        <button class="action-btn" title="Browse history" aria-label="Browse history" @click=${this._openHistoryBrowser}>📜</button>

        <div class="chat-search">
          <input
            class="chat-search-input"
            type="text"
            placeholder="Search messages..."
            aria-label="Search messages"
            .value=${this._chatSearchQuery}
            @input=${this._onChatSearchInput}
            @keydown=${this._onChatSearchKeyDown}
          >
          ${this._chatSearchMatches.length>0?f`
            <span class="chat-search-counter" aria-live="polite">${this._chatSearchCurrent+1}/${this._chatSearchMatches.length}</span>
            <button class="chat-search-nav" title="Previous (Shift+Enter)" aria-label="Previous search result" @click=${this._chatSearchPrev}>▲</button>
            <button class="chat-search-nav" title="Next (Enter)" aria-label="Next search result" @click=${this._chatSearchNext}>▼</button>
          `:_}
        </div>

        <button class="action-btn" title="Copy diff" aria-label="Copy diff to clipboard" @click=${this._copyDiff}
          ?disabled=${!this.rpcConnected}>📋</button>
        <button class="action-btn ${this._committing?"committing":""}"
          title="${(t=this.reviewState)!=null&&t.active?"Commit disabled during review":"Stage all & commit"}"
          aria-label="${(i=this.reviewState)!=null&&i.active?"Commit disabled during review":"Stage all and commit"}"
          @click=${this._commitWithMessage}
          ?disabled=${!this.rpcConnected||this._committing||this.streamingActive||((s=this.reviewState)==null?void 0:s.active)}>
          ${this._committing?"⏳":"💾"}
        </button>
        <button class="action-btn danger" title="Reset to HEAD" aria-label="Reset all changes to HEAD"
          @click=${this._confirmReset}
          ?disabled=${!this.rpcConnected||this.streamingActive}>⚠️</button>
      </div>

      <!-- Messages -->
      <div class="messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions">
        ${e?f`
          ${this.messages.map((d,u)=>this._renderMessage(d,u))}

          ${this._streamingContent?f`
            <div class="message-card assistant force-visible">
              <div class="role-label">
                Assistant <span class="streaming-indicator"></span>
              </div>
              <div class="md-content" @click=${this._onContentClick}>
                ${Y(this._renderAssistantContent(this._streamingContent,{},!1))}
              </div>
            </div>
          `:_}
        `:f`
          <div class="empty-state">
            <div class="brand">AC⚡DC</div>
            <div class="hint">Select files and start chatting</div>
          </div>
        `}

        <div class="scroll-sentinel"></div>
      </div>

      <!-- Scroll to bottom -->
      <button
        class="scroll-bottom-btn ${!this._autoScroll&&e?"visible":""}"
        @click=${this._onScrollBtnClick}
      >↓</button>

      <!-- Review Status Bar -->
      ${(r=this.reviewState)!=null&&r.active?f`
        <div class="review-status-bar">
          📋 <strong>${this.reviewState.branch}</strong>
          ${((o=this.reviewState.stats)==null?void 0:o.commit_count)||0} commits ·
          ${((l=this.reviewState.stats)==null?void 0:l.files_changed)||0} files ·
          +${((a=this.reviewState.stats)==null?void 0:a.additions)||0} −${((c=this.reviewState.stats)==null?void 0:c.deletions)||0}
          <span class="review-diff-count">
            ${this._getReviewDiffCount()}/${((h=this.reviewState.stats)==null?void 0:h.files_changed)||0} diffs in context
          </span>
          <button class="review-exit-link" @click=${()=>this.dispatchEvent(new CustomEvent("exit-review",{bubbles:!0,composed:!0}))}>
            Exit Review
          </button>
        </div>
      `:_}

      <!-- Input Area -->
      <div class="input-area">
        <ac-input-history
          @history-select=${this._onHistorySelect}
          @history-cancel=${this._onHistoryCancel}
        ></ac-input-history>

        <ac-url-chips></ac-url-chips>

        ${this._images.length>0?f`
          <div class="image-previews">
            ${this._images.map((d,u)=>f`
              <div class="image-preview">
                <img src="${d}" alt="Pasted image">
                <button class="remove-btn" @click=${()=>this._removeImage(u)}>✕</button>
              </div>
            `)}
          </div>
        `:_}

        ${this._snippetDrawerOpen&&this._snippets.length>0?f`
          <div class="snippet-drawer">
            ${this._snippets.map(d=>{var u;return f`
              <button class="snippet-btn" @click=${()=>this._insertSnippet(d)} title="${d.tooltip||""}">
                ${d.icon||"📌"} ${d.tooltip||((u=d.message)==null?void 0:u.slice(0,30))||"Snippet"}
              </button>
            `})}
          </div>
        `:_}

        <div class="input-row">
          <div class="input-left-buttons">
            <ac-speech-to-text
              @transcript=${this._onTranscript}
            ></ac-speech-to-text>
            <button
              class="snippet-toggle ${this._snippetDrawerOpen?"active":""}"
              @click=${this._toggleSnippets}
              title="Quick snippets"
              aria-label="Toggle quick snippets"
              aria-expanded="${this._snippetDrawerOpen}"
            >📌</button>
          </div>

          <textarea
            class="input-textarea"
            placeholder="Message AC⚡DC..."
            aria-label="Chat message input"
            rows="1"
            .value=${this._inputValue}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
            @paste=${this._onPaste}
          ></textarea>

          ${this.streamingActive?f`
            <button class="send-btn stop" @click=${this._stop} title="Stop" aria-label="Stop generation">⏹</button>
          `:f`
            <button
              class="send-btn"
              @click=${this._send}
              ?disabled=${!this.rpcConnected}
              title="Send (Enter)"
              aria-label="Send message"
            >↑</button>
          `}
        </div>
      </div>

      <!-- URL Content Dialog -->
      <ac-url-content-dialog></ac-url-content-dialog>

      <!-- History Browser -->
      <ac-history-browser
        @session-loaded=${this._onSessionLoaded}
        @paste-to-prompt=${this._onPasteToPrompt}
      ></ac-history-browser>

      <!-- Confirm Dialog -->
      ${this._confirmAction?f`
        <div class="confirm-overlay" @click=${this._dismissConfirm}
             @keydown=${d=>{d.key==="Escape"&&this._dismissConfirm()}}>
          <div class="confirm-dialog" role="alertdialog" aria-modal="true"
               aria-labelledby="confirm-title" aria-describedby="confirm-desc"
               @click=${d=>d.stopPropagation()}>
            <h3 id="confirm-title">${this._confirmAction.title}</h3>
            <p id="confirm-desc">${this._confirmAction.message}</p>
            <div class="confirm-actions">
              <button class="confirm-cancel" @click=${this._dismissConfirm}>Cancel</button>
              <button class="confirm-danger" @click=${this._confirmAction.action}>
                ${this._confirmAction.title}
              </button>
            </div>
          </div>
        </div>
      `:_}

      <!-- Toast -->
      ${this._toast?f`
        <div class="toast ${this._toast.type}" role="alert">${this._toast.message}</div>
      `:_}

      <!-- Image Lightbox -->
      ${this._lightboxSrc?f`
        <div class="image-lightbox"
             role="dialog"
             aria-modal="true"
             aria-label="Image preview"
             @click=${this._closeLightbox}
             @keydown=${this._onLightboxKeyDown}
             tabindex="0">
          <img src="${this._lightboxSrc}" alt="Full size image"
               @click=${d=>d.stopPropagation()}>
        </div>
      `:_}
    `}}$(Tt,"properties",{messages:{type:Array},selectedFiles:{type:Array},streamingActive:{type:Boolean},reviewState:{type:Object},_streamingContent:{type:String,state:!0},_inputValue:{type:String,state:!0},_images:{type:Array,state:!0},_autoScroll:{type:Boolean,state:!0},_snippetDrawerOpen:{type:Boolean,state:!0},_historyOpen:{type:Boolean,state:!0},_currentRequestId:{type:String,state:!0},_confirmAction:{type:Object,state:!0},_toast:{type:Object,state:!0},_committing:{type:Boolean,state:!0},_repoFiles:{type:Array,state:!0},_chatSearchQuery:{type:String,state:!0},_chatSearchMatches:{type:Array,state:!0},_chatSearchCurrent:{type:Number,state:!0},_lightboxSrc:{type:String,state:!0}}),$(Tt,"styles",[P,B,L`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* Action bar */
    .action-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      min-height: 36px;
    }

    .action-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.9rem;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .action-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    .action-btn.danger:hover {
      color: var(--accent-red);
    }
    .action-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .action-btn:disabled:hover {
      background: none;
      color: var(--text-muted);
    }
    .action-btn.committing {
      color: var(--accent-primary);
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .action-spacer { flex: 1; }

    /* Confirm dialog overlay */
    .confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .confirm-dialog {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 24px;
      max-width: 400px;
      box-shadow: var(--shadow-lg);
    }

    .confirm-dialog h3 {
      margin: 0 0 12px;
      color: var(--text-primary);
      font-size: 1rem;
    }

    .confirm-dialog p {
      margin: 0 0 20px;
      color: var(--text-secondary);
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .confirm-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .confirm-actions button {
      padding: 6px 16px;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      cursor: pointer;
      border: 1px solid var(--border-primary);
    }

    .confirm-cancel {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
    }
    .confirm-cancel:hover {
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    .confirm-danger {
      background: var(--accent-red);
      color: white;
      border-color: var(--accent-red);
    }
    .confirm-danger:hover {
      opacity: 0.9;
    }

    /* Toast notification */
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      z-index: 10001;
      box-shadow: var(--shadow-md);
      transition: opacity 0.3s;
    }
    .toast.success { border-color: var(--accent-green); color: var(--accent-green); }
    .toast.error { border-color: var(--accent-red); color: var(--accent-red); }

    /* Messages area */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      scroll-behavior: smooth;
    }

    .message-card {
      margin-bottom: 12px;
      padding: 12px 16px;
      border-radius: var(--radius-md);
      border: 1px solid transparent;
      line-height: 1.6;
      font-size: 0.9rem;
      position: relative;
      transition: border-color 0.2s, box-shadow 0.2s;
      content-visibility: auto;
      contain-intrinsic-size: auto 120px;
      contain: layout style paint;
    }

    .message-card.user {
      contain-intrinsic-size: auto 80px;
    }

    .message-card.assistant {
      contain-intrinsic-size: auto 200px;
    }

    .message-card.force-visible {
      content-visibility: visible;
      contain: none;
    }

    .message-card.user {
      background: var(--bg-tertiary);
      border-color: var(--border-primary);
    }

    .message-card.assistant {
      background: var(--bg-secondary);
    }

    .message-card .role-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
      letter-spacing: 0.05em;
    }

    .message-card.user .role-label { color: var(--accent-primary); }
    .message-card.assistant .role-label { color: var(--accent-green); }

    .md-content h2, .md-content h3, .md-content h4 {
      margin-top: 0.8em;
      margin-bottom: 0.4em;
      color: var(--text-primary);
    }
    .md-content h2 { font-size: 1.1rem; }
    .md-content h3 { font-size: 1rem; }
    .md-content h4 { font-size: 0.95rem; }

    .md-content pre.code-block {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      padding: 12px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      margin: 8px 0;
      position: relative;
    }

    .md-content code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--bg-primary);
      padding: 0.15em 0.4em;
      border-radius: 3px;
    }

    .md-content pre.code-block code {
      background: none;
      padding: 0;
      color: var(--text-primary);
      line-height: 1.5;
    }

    .md-content pre .code-lang {
      position: absolute;
      top: 4px;
      right: 36px;
      font-size: 0.65rem;
      color: var(--text-muted);
      font-family: var(--font-sans);
      pointer-events: none;
    }

    .md-content pre .code-copy-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
      font-family: var(--font-sans);
      line-height: 1;
      z-index: 1;
    }
    .md-content pre:hover .code-copy-btn {
      opacity: 1;
    }
    .md-content pre .code-copy-btn:hover {
      color: var(--text-primary);
      background: var(--bg-secondary);
    }
    .md-content pre .code-copy-btn.copied {
      opacity: 1;
      color: var(--accent-green);
    }

    /* highlight.js syntax theme */
    .md-content .hljs-keyword { color: #c792ea; }
    .md-content .hljs-string { color: #c3e88d; }
    .md-content .hljs-number { color: #f78c6c; }
    .md-content .hljs-comment { color: #546e7a; font-style: italic; }
    .md-content .hljs-function { color: #82aaff; }
    .md-content .hljs-built_in { color: #ffcb6b; }
    .md-content .hljs-title { color: #82aaff; }
    .md-content .hljs-params { color: var(--text-primary); }
    .md-content .hljs-attr { color: #ffcb6b; }
    .md-content .hljs-literal { color: #f78c6c; }
    .md-content .hljs-type { color: #ffcb6b; }

    /* Tables (from marked GFM) */
    .md-content table {
      border-collapse: collapse;
      width: 100%;
      margin: 8px 0;
      font-size: 0.85rem;
    }
    .md-content th,
    .md-content td {
      border: 1px solid var(--border-primary);
      padding: 6px 10px;
      text-align: left;
    }
    .md-content th {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      font-weight: 600;
    }
    .md-content tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.02);
    }

    /* Lists */
    .md-content ul,
    .md-content ol {
      margin: 6px 0;
      padding-left: 24px;
    }
    .md-content li {
      margin: 3px 0;
    }

    /* Paragraphs — tighten spacing for chat */
    .md-content p {
      margin: 4px 0;
    }

    /* Horizontal rules */
    .md-content hr {
      border: none;
      border-top: 1px solid var(--border-primary);
      margin: 12px 0;
    }

    /* Links */
    .md-content a {
      color: var(--accent-primary);
      text-decoration: none;
    }
    .md-content a:hover {
      text-decoration: underline;
    }

    /* Blockquotes */
    .md-content blockquote {
      border-left: 3px solid var(--border-primary);
      margin: 8px 0;
      padding: 4px 12px;
      color: var(--text-secondary);
    }

    /* Streaming indicator */
    .streaming-indicator {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: var(--accent-primary);
      border-radius: 50%;
      animation: pulse 1s ease-in-out infinite;
      margin-left: 4px;
      vertical-align: middle;
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Scroll sentinel */
    .scroll-sentinel {
      height: 1px;
    }

    /* Scroll to bottom button */
    .scroll-bottom-btn {
      position: absolute;
      bottom: 80px;
      right: 24px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 1rem;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 5;
      box-shadow: var(--shadow-md);
    }
    .scroll-bottom-btn.visible {
      display: flex;
    }
    .scroll-bottom-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      text-align: center;
      gap: 8px;
    }
    .empty-state .brand {
      font-size: 2rem;
      opacity: 0.3;
    }
    .empty-state .hint {
      font-size: 0.85rem;
    }

    /* Input area */
    .input-area {
      position: relative;
      border-top: 1px solid var(--border-primary);
      padding: 8px 12px;
      background: var(--bg-secondary);
    }

    .input-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .input-textarea {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.9rem;
      padding: 10px 12px;
      resize: none;
      min-height: 42px;
      max-height: 200px;
      line-height: 1.4;
      outline: none;
    }
    .input-textarea:focus {
      border-color: var(--accent-primary);
    }
    .input-textarea::placeholder {
      color: var(--text-muted);
    }

    .send-btn {
      background: var(--accent-primary);
      border: none;
      color: var(--bg-primary);
      font-size: 1rem;
      width: 42px;
      height: 42px;
      border-radius: var(--radius-md);
      cursor: pointer;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .send-btn:hover { opacity: 0.9; }
    .send-btn.stop {
      background: var(--accent-red);
    }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* User image thumbnails in messages */
    .user-images {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .user-image-thumb {
      width: 120px;
      height: 120px;
      object-fit: cover;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-primary);
      cursor: pointer;
      transition: border-color 0.15s, transform 0.15s;
    }
    .user-image-thumb:hover {
      border-color: var(--accent-primary);
      transform: scale(1.03);
    }

    /* Image lightbox */
    .image-lightbox {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 10002;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .image-lightbox img {
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
    }

    /* Image previews */
    .image-previews {
      display: flex;
      gap: 8px;
      padding: 8px 0 4px;
      flex-wrap: wrap;
    }

    .image-preview {
      position: relative;
      width: 64px;
      height: 64px;
      border-radius: var(--radius-sm);
      overflow: hidden;
      border: 1px solid var(--border-primary);
    }

    .image-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .image-preview .remove-btn {
      position: absolute;
      top: 2px;
      right: 2px;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      border: none;
      font-size: 0.65rem;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Snippet drawer */
    .snippet-drawer {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 6px 0;
    }

    .snippet-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 0.75rem;
      padding: 3px 8px;
      border-radius: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .snippet-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    .snippet-toggle {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.85rem;
      padding: 4px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .snippet-toggle:hover {
      color: var(--text-primary);
    }
    .snippet-toggle.active {
      color: var(--accent-primary);
    }

    /* Stacked left buttons (mic + snippets) */
    .input-left-buttons {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
      flex-shrink: 0;
    }

    /* Edit block cards */
    .edit-block-card {
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      margin: 10px 0;
      overflow: hidden;
      background: var(--bg-primary);
    }

    .edit-block-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      font-size: 0.8rem;
      gap: 8px;
    }

    .edit-file-path {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--accent-primary);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .edit-file-path:hover {
      text-decoration: underline;
    }

    .edit-goto-btn {
      background: none;
      border: 1px solid rgba(79, 195, 247, 0.5);
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      flex-shrink: 0;
      transition: color 0.15s, border-color 0.15s, box-shadow 0.15s;
      box-shadow: 0 0 8px 2px rgba(79, 195, 247, 0.25);
    }
    .edit-goto-btn:hover {
      color: var(--accent-primary);
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px rgba(79, 195, 247, 0.3);
    }

    .edit-badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .edit-badge.applied {
      background: rgba(80, 200, 120, 0.15);
      color: var(--accent-green);
    }
    .edit-badge.failed {
      background: rgba(255, 80, 80, 0.15);
      color: var(--accent-red);
    }
    .edit-badge.skipped {
      background: rgba(255, 180, 50, 0.15);
      color: #f0a030;
    }
    .edit-badge.validated {
      background: rgba(80, 160, 255, 0.15);
      color: var(--accent-primary);
    }
    .edit-badge.pending {
      background: rgba(160, 160, 160, 0.15);
      color: var(--text-muted);
    }
    .edit-badge.not-in-context {
      background: rgba(255, 180, 50, 0.15);
      color: #e0a030;
    }

    .edit-error {
      padding: 4px 12px;
      font-size: 0.75rem;
      color: var(--accent-red);
      background: rgba(255, 80, 80, 0.08);
      border-bottom: 1px solid var(--border-primary);
    }

    .edit-diff {
      margin: 0;
      padding: 8px 0;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      line-height: 1.5;
      overflow-x: auto;
    }

    .diff-line {
      padding: 0 12px;
      white-space: pre;
      display: block;
    }
    .diff-line.remove {
      background: #2d1215;
      color: var(--accent-red);
    }
    .diff-line.add {
      background: #122117;
      color: var(--accent-green);
    }
    .diff-line.context {
      background: var(--bg-primary);
      color: var(--text-primary);
    }
    .diff-line.remove .diff-change {
      background: #6d3038;
      border-radius: 2px;
    }
    .diff-line.add .diff-change {
      background: #2b6331;
      border-radius: 2px;
    }
    .diff-line-prefix {
      display: inline-block;
      width: 1.2em;
      user-select: none;
      opacity: 0.6;
    }

    /* Edit summary banner */
    .edit-summary {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 12px;
      margin: 8px 0 4px;
      border-radius: var(--radius-sm);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    .edit-summary .stat { font-weight: 600; }
    .edit-summary .stat.pass { color: var(--accent-green); }
    .edit-summary .stat.fail { color: var(--accent-red); }
    .edit-summary .stat.skip { color: #f0a030; }

    /* File mentions */
    .file-mention {
      color: var(--accent-primary);
      cursor: pointer;
      border-radius: 3px;
      padding: 0 2px;
      margin: 0 1px;
      transition: background 0.15s;
    }
    .file-mention:hover {
      background: rgba(79, 195, 247, 0.15);
      text-decoration: underline;
    }
    .file-mention.in-context {
      color: var(--text-muted);
    }

    /* File summary section */
    .file-summary {
      margin-top: 10px;
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
    }
    .file-summary-label {
      color: var(--text-secondary);
      margin-right: 8px;
      font-weight: 600;
    }
    .add-all-btn {
      background: none;
      border: 1px solid var(--accent-primary);
      color: var(--accent-primary);
      font-size: 0.7rem;
      padding: 1px 8px;
      border-radius: 10px;
      cursor: pointer;
      margin-left: 4px;
      vertical-align: middle;
    }
    .add-all-btn:hover {
      background: rgba(79, 195, 247, 0.15);
    }
    .file-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }
    .file-chip {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .file-chip.in-context {
      background: var(--bg-secondary);
      color: var(--text-muted);
      border: 1px solid var(--border-primary);
    }
    .file-chip.addable {
      background: rgba(79, 195, 247, 0.1);
      color: var(--accent-primary);
      border: 1px solid var(--accent-primary);
    }
    .file-chip.addable:hover {
      background: rgba(79, 195, 247, 0.2);
    }

    /* Message action buttons (top-right and bottom-right) */
    .msg-actions {
      position: absolute;
      right: 8px;
      display: flex;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .msg-actions.top { top: 8px; }
    .msg-actions.bottom { bottom: 8px; }
    .message-card:hover .msg-actions { opacity: 1; }

    .msg-action-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .msg-action-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    /* Chat search */
    .chat-search {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }
    .chat-search-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.8rem;
      padding: 4px 8px;
      outline: none;
      min-width: 60px;
    }
    .chat-search-input:focus {
      border-color: var(--accent-primary);
    }
    .chat-search-input::placeholder {
      color: var(--text-muted);
    }
    .chat-search-counter {
      font-size: 0.7rem;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .chat-search-nav {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 2px 4px;
      cursor: pointer;
      border-radius: var(--radius-sm);
    }
    .chat-search-nav:hover {
      color: var(--text-primary);
      background: var(--bg-secondary);
    }

    /* Review status bar */
    .review-status-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(79, 195, 247, 0.06);
      border-top: 1px solid var(--accent-primary);
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    .review-status-bar strong {
      color: var(--accent-primary);
    }
    .review-status-bar .review-diff-count {
      margin-left: auto;
      color: var(--text-muted);
    }
    .review-status-bar .review-exit-link {
      color: var(--accent-red);
      cursor: pointer;
      font-size: 0.7rem;
      border: none;
      background: none;
      padding: 0;
    }
    .review-status-bar .review-exit-link:hover {
      text-decoration: underline;
    }

    /* Search highlight on message cards */
    .message-card.search-highlight {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 1px var(--accent-primary), 0 0 12px rgba(79, 195, 247, 0.15);
    }

  `]);customElements.define("ac-chat-panel",Tt);class Mt extends U(z){constructor(){super(),this.selectedFiles=new Set,this._tree=null,this._modified=[],this._staged=[],this._untracked=[],this._diffStats={},this._expanded=new Set,this._filter="",this._focusedPath="",this._contextMenu=null,this._contextInput=null,this._activeInViewer="",this._allFilePaths=[],this._flatVisible=[],this._initialAutoSelect=!1,this._expanded.add(""),this._onDocClick=this._onDocClick.bind(this),this._onActiveFileChanged=this._onActiveFileChanged.bind(this)}connectedCallback(){super.connectedCallback(),document.addEventListener("click",this._onDocClick),window.addEventListener("active-file-changed",this._onActiveFileChanged)}disconnectedCallback(){super.disconnectedCallback(),document.removeEventListener("click",this._onDocClick),window.removeEventListener("active-file-changed",this._onActiveFileChanged)}onRpcReady(){Promise.resolve().then(()=>this.loadTree())}_onActiveFileChanged(e){var t;this._activeInViewer=((t=e.detail)==null?void 0:t.path)||"",this._activeInViewer&&this._expandToPath(this._activeInViewer)}_expandToPath(e){const t=e.split("/");if(t.length<=1)return;let i=!1,s="";for(let r=0;r<t.length-1;r++)s=s?`${s}/${t[r]}`:t[r],this._expanded.has(s)||(this._expanded.add(s),i=!0);i&&(this._expanded=new Set(this._expanded))}async loadTree(){try{const e=await this.rpcExtract("Repo.get_file_tree");if(!e||e.error){console.error("Failed to load tree:",e==null?void 0:e.error);return}if(this._tree=e.tree,this._modified=e.modified||[],this._staged=e.staged||[],this._untracked=e.untracked||[],this._diffStats=e.diff_stats||{},this._allFilePaths=[],this._collectPaths(this._tree,this._allFilePaths),!this._initialAutoSelect){this._initialAutoSelect=!0;const t=new Set([...this._modified,...this._staged,...this._untracked]);t.size>0&&(this.selectedFiles=new Set(t),this._autoExpandChanged(t),this._notifySelection())}}catch(e){console.error("Failed to load file tree:",e)}}_collectPaths(e,t){if(e&&(e.type==="file"&&t.push(e.path),e.children))for(const i of e.children)this._collectPaths(i,t)}_autoExpandChanged(e){for(const t of e){const i=t.split("/");let s="";for(let r=0;r<i.length-1;r++)s=s?`${s}/${i[r]}`:i[r],this._expanded.add(s)}this._expanded=new Set(this._expanded)}_flattenTree(e,t=0){if(!e)return[];const i=[];if(e.path===""&&e.type==="dir"){if(i.push({node:e,depth:0}),this._expanded.has("")||this._filter){const r=this._sortChildren(e.children||[]);for(const o of r)i.push(...this._flattenTree(o,1))}return i}if(!this._matchesFilter(e))return i;if(i.push({node:e,depth:t}),e.type==="dir"&&(this._expanded.has(e.path)||this._filter)){const r=this._sortChildren(e.children||[]);for(const o of r)i.push(...this._flattenTree(o,t+1))}return i}_sortChildren(e){return[...e].sort((t,i)=>t.type!==i.type?t.type==="dir"?-1:1:t.name.localeCompare(i.name))}_matchesFilter(e){if(!this._filter)return!0;const t=this._filter.toLowerCase();return e.path.toLowerCase().includes(t)?!0:e.children?e.children.some(i=>this._matchesFilter(i)):!1}_toggleSelect(e,t){if(t.stopPropagation(),e.type==="file"){const i=new Set(this.selectedFiles);i.has(e.path)?i.delete(e.path):i.add(e.path),this.selectedFiles=i}else{const i=[];this._collectPaths(e,i);const s=i.every(o=>this.selectedFiles.has(o)),r=new Set(this.selectedFiles);for(const o of i)s?r.delete(o):r.add(o);this.selectedFiles=r}this._notifySelection()}_getCheckState(e){if(e.type==="file")return this.selectedFiles.has(e.path)?"checked":"unchecked";const t=[];if(this._collectPaths(e,t),t.length===0)return"unchecked";const i=t.filter(s=>this.selectedFiles.has(s)).length;return i===0?"unchecked":i===t.length?"checked":"indeterminate"}_notifySelection(){this.dispatchEvent(new CustomEvent("selection-changed",{detail:{selectedFiles:[...this.selectedFiles]},bubbles:!0,composed:!0}))}_toggleExpand(e){const t=new Set(this._expanded);t.has(e.path)?t.delete(e.path):t.add(e.path),this._expanded=t}_onRowClick(e){e.type==="dir"?this._toggleExpand(e):this.dispatchEvent(new CustomEvent("file-clicked",{detail:{path:e.path},bubbles:!0,composed:!0})),this._focusedPath=e.path}_onRowMiddleClick(e,t){t.button===1&&(t.preventDefault(),this.dispatchEvent(new CustomEvent("insert-path",{detail:{path:e.path},bubbles:!0,composed:!0})))}_onContextMenu(e,t){t.preventDefault(),t.stopPropagation(),this._contextMenu={x:t.clientX,y:t.clientY,node:e,isDir:e.type==="dir"}}_onDocClick(){this._contextMenu&&(this._contextMenu=null)}async _ctxStage(e){this._contextMenu=null;try{await this.rpcExtract("Repo.stage_files",e),await this.loadTree()}catch(t){console.error("Stage failed:",t)}}async _ctxUnstage(e){this._contextMenu=null;try{await this.rpcExtract("Repo.unstage_files",e),await this.loadTree()}catch(t){console.error("Unstage failed:",t)}}async _ctxDiscard(e){if(this._contextMenu=null,!!confirm(`Discard changes to ${e}?`))try{await this.rpcExtract("Repo.discard_changes",[e]),await this.loadTree()}catch(t){console.error("Discard failed:",t)}}_ctxRename(e){this._contextMenu=null,this._contextInput={type:"rename",path:e.path,value:e.name}}async _ctxDelete(e){if(this._contextMenu=null,!!confirm(`Delete ${e}?`))try{await this.rpcExtract("Repo.delete_file",e);const t=new Set(this.selectedFiles);t.delete(e),this.selectedFiles=t,this._notifySelection(),await this.loadTree()}catch(t){console.error("Delete failed:",t)}}_ctxNewFile(e){if(this._contextMenu=null,this._contextInput={type:"new-file",path:e,value:""},!this._expanded.has(e)){const t=new Set(this._expanded);t.add(e),this._expanded=t}}_ctxNewDir(e){if(this._contextMenu=null,this._contextInput={type:"new-dir",path:e,value:""},!this._expanded.has(e)){const t=new Set(this._expanded);t.add(e),this._expanded=t}}async _submitContextInput(e){if(e.key!=="Enter")return;const t=this._contextInput;if(!t)return;const i=e.target.value.trim();if(!i){this._contextInput=null;return}try{if(t.type==="rename"){const s=t.path.includes("/")?t.path.substring(0,t.path.lastIndexOf("/")):"",r=s?`${s}/${i}`:i;await this.rpcExtract("Repo.rename_file",t.path,r)}else if(t.type==="new-file"){const s=t.path?`${t.path}/${i}`:i;await this.rpcExtract("Repo.create_file",s,"")}else if(t.type==="new-dir"){const s=t.path?`${t.path}/${i}/.gitkeep`:`${i}/.gitkeep`;await this.rpcExtract("Repo.create_file",s,"")}}catch(s){console.error("Operation failed:",s)}this._contextInput=null,await this.loadTree()}_cancelContextInput(e){e.key==="Escape"&&(this._contextInput=null)}_onTreeKeyDown(e){const t=this._flatVisible;if(!t.length)return;let i=t.findIndex(s=>s.node.path===this._focusedPath);if(e.key==="ArrowDown")e.preventDefault(),i=Math.min(t.length-1,i+1),this._focusedPath=t[i].node.path,this._scrollToFocused();else if(e.key==="ArrowUp")e.preventDefault(),i=Math.max(0,i-1),this._focusedPath=t[i].node.path,this._scrollToFocused();else if(e.key==="ArrowRight"){e.preventDefault();const s=t[i];(s==null?void 0:s.node.type)==="dir"&&!this._expanded.has(s.node.path)&&this._toggleExpand(s.node)}else if(e.key==="ArrowLeft"){e.preventDefault();const s=t[i];(s==null?void 0:s.node.type)==="dir"&&this._expanded.has(s.node.path)&&this._toggleExpand(s.node)}else if(e.key===" "||e.key==="Enter"){e.preventDefault();const s=t[i];s&&(e.key===" "?this._toggleSelect(s.node,e):this._onRowClick(s.node))}}_scrollToFocused(){requestAnimationFrame(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".tree-row.focused");e&&e.scrollIntoView({block:"nearest"})})}_onFilterInput(e){this._filter=e.target.value}setFilter(e){this._filter=e||""}_getGitStatus(e){return this._staged.includes(e)?"staged":this._modified.includes(e)?"modified":this._untracked.includes(e)?"untracked":null}_getLineCountColor(e){return e>170?"red":e>=130?"orange":"green"}_renderRow(e){var d,u,v;const{node:t,depth:i}=e,s=t.type==="dir",r=this._expanded.has(t.path),o=this._getCheckState(t),l=s?null:this._getGitStatus(t.path),a=s?null:this._diffStats[t.path],c=this._focusedPath===t.path,h=this._activeInViewer===t.path;return f`
      <div
        class="tree-row ${c?"focused":""} ${h?"active-in-viewer":""}"
        role="treeitem"
        aria-selected="${o==="checked"}"
        aria-expanded="${s?String(r):_}"
        aria-level="${i+1}"
        aria-label="${t.name}${l?`, ${l}`:""}"
        style="padding-left: ${i*16+4}px"
        @click=${()=>this._onRowClick(t)}
        @auxclick=${m=>this._onRowMiddleClick(t,m)}
        @contextmenu=${m=>this._onContextMenu(t,m)}
      >
        <span class="toggle" aria-hidden="true">
          ${s?r?"▾":"▸":""}
        </span>

        <input
          type="checkbox"
          class="tree-checkbox"
          aria-label="Select ${t.name}"
          .checked=${o==="checked"}
          .indeterminate=${o==="indeterminate"}
          @click=${m=>this._toggleSelect(t,m)}
          @change=${m=>m.stopPropagation()}
        />

        <span class="node-name ${s?"dir":""}${!s&&l?` ${l}`:""}">${t.name}</span>

        <span class="badges">
          ${!s&&t.lines>0?f`
            <span class="line-count ${this._getLineCountColor(t.lines)}">${t.lines}</span>
          `:_}

          ${l?f`
            <span class="git-badge ${l}">
              ${l==="modified"?"M":l==="staged"?"S":"U"}
            </span>
          `:_}

          ${a?f`
            <span class="diff-stat">
              ${a.additions>0?f`<span class="diff-add">+${a.additions}</span>`:_}
              ${a.deletions>0?f` <span class="diff-del">-${a.deletions}</span>`:_}
            </span>
          `:_}
        </span>
      </div>

      ${this._contextInput&&this._contextInput.path===t.path&&this._contextInput.type==="rename"?f`
        <div style="padding-left: ${i*16+40}px; padding-right: 8px;">
          <input
            class="inline-input"
            .value=${this._contextInput.value}
            @keydown=${m=>{m.stopPropagation(),this._submitContextInput(m),this._cancelContextInput(m)}}
            @blur=${()=>{this._contextInput=null}}
          />
        </div>
      `:_}

      ${s&&((d=this._contextInput)==null?void 0:d.path)===t.path&&(((u=this._contextInput)==null?void 0:u.type)==="new-file"||((v=this._contextInput)==null?void 0:v.type)==="new-dir")?f`
        <div style="padding-left: ${(i+1)*16+40}px; padding-right: 8px;">
          <input
            class="inline-input"
            placeholder="${this._contextInput.type==="new-file"?"filename":"dirname"}"
            @keydown=${m=>{m.stopPropagation(),this._submitContextInput(m),this._cancelContextInput(m)}}
            @blur=${()=>{this._contextInput=null}}
          />
        </div>
      `:_}
    `}_renderContextMenu(){if(!this._contextMenu)return _;const{x:e,y:t,node:i,isDir:s}=this._contextMenu,r=i.path;return f`
      <div class="context-menu" role="menu" aria-label="File actions"
           style="left: ${e}px; top: ${t}px"
           @click=${o=>o.stopPropagation()}>
        ${s?f`
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxNewFile(r)}>📄 New File</div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxNewDir(r)}>📁 New Directory</div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${()=>{const o=[];this._collectPaths(i,o),this._ctxStage(o)}}>
            ➕ Stage All
          </div>
          <div class="context-menu-item" role="menuitem" @click=${()=>{const o=[];this._collectPaths(i,o),this._ctxUnstage(o)}}>
            ➖ Unstage All
          </div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxRename(i)}>✏️ Rename</div>
        `:f`
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxStage([r])}>➕ Stage</div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxUnstage([r])}>➖ Unstage</div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxRename(i)}>✏️ Rename</div>
          <div class="context-menu-item danger" role="menuitem" @click=${()=>this._ctxDiscard(r)}>↩️ Discard Changes</div>
          <div class="context-menu-item danger" role="menuitem" @click=${()=>this._ctxDelete(r)}>🗑️ Delete</div>
        `}
      </div>
    `}updated(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".inline-input");e&&this._contextInput&&(e.focus(),this._contextInput.type==="rename"&&e.select())}render(){var i,s,r,o,l;if(!this._tree)return f`<div class="empty-state">Loading file tree...</div>`;const e=this._flattenTree(this._tree);this._flatVisible=e;const t=(i=this.reviewState)==null?void 0:i.active;return f`
      ${t?f`
        <div class="review-banner">
          <div class="review-banner-title">
            <span>📋 Reviewing: <strong>${this.reviewState.branch}</strong></span>
            <button class="review-exit-btn" @click=${()=>this.dispatchEvent(new CustomEvent("exit-review",{bubbles:!0,composed:!0}))}>
              Exit ✕
            </button>
          </div>
          <div class="review-stats">
            ${((s=this.reviewState.stats)==null?void 0:s.commit_count)||0} commits ·
            ${((r=this.reviewState.stats)==null?void 0:r.files_changed)||0} files ·
            +${((o=this.reviewState.stats)==null?void 0:o.additions)||0}
            -${((l=this.reviewState.stats)==null?void 0:l.deletions)||0}
          </div>
        </div>
      `:_}

      <div class="filter-bar">
        <input
          class="filter-input"
          type="text"
          placeholder="Filter files..."
          aria-label="Filter files"
          .value=${this._filter}
          @input=${this._onFilterInput}
        />
      </div>

      <div
        class="tree-container"
        role="tree"
        aria-label="Repository files"
        tabindex="0"
        @keydown=${this._onTreeKeyDown}
      >
        ${e.map(a=>this._renderRow(a))}
      </div>

      ${this._renderContextMenu()}
    `}}$(Mt,"properties",{selectedFiles:{type:Object,hasChanged:()=>!0},reviewState:{type:Object},_tree:{type:Object,state:!0},_modified:{type:Array,state:!0},_staged:{type:Array,state:!0},_untracked:{type:Array,state:!0},_diffStats:{type:Object,state:!0},_expanded:{type:Object,state:!0},_filter:{type:String,state:!0},_focusedPath:{type:String,state:!0},_contextMenu:{type:Object,state:!0},_contextInput:{type:Object,state:!0},_activeInViewer:{type:String,state:!0}}),$(Mt,"styles",[P,B,L`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      font-size: 0.8rem;
    }

    /* Filter bar */
    .filter-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-secondary);
    }

    .filter-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.8rem;
      padding: 4px 8px;
      outline: none;
    }
    .filter-input:focus {
      border-color: var(--accent-primary);
    }
    .filter-input::placeholder {
      color: var(--text-muted);
    }

    /* Tree container */
    .tree-container {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 4px 0;
    }

    /* Tree row */
    .tree-row {
      display: flex;
      align-items: center;
      padding: 2px 8px 2px 0;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      min-height: 26px;
      border-left: 2px solid transparent;
    }
    .tree-row:hover {
      background: var(--bg-tertiary);
    }
    .tree-row.focused {
      background: var(--bg-tertiary);
      outline: 1px solid var(--accent-primary);
      outline-offset: -1px;
    }
    .tree-row.active-in-viewer {
      background: rgba(79, 195, 247, 0.08);
      border-left-color: var(--accent-primary);
    }

    /* Indent spacer */
    .indent {
      flex-shrink: 0;
    }

    /* Toggle arrow for directories */
    .toggle {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.6rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* Checkbox */
    .tree-checkbox {
      width: 14px;
      height: 14px;
      margin: 0 4px 0 0;
      accent-color: var(--accent-primary);
      flex-shrink: 0;
      cursor: pointer;
    }

    /* Name */
    .node-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-primary);
    }
    .node-name.dir {
      color: var(--text-secondary);
      font-weight: 500;
    }
    .node-name.modified {
      color: var(--accent-orange);
    }
    .node-name.staged {
      color: var(--accent-green);
    }
    .node-name.untracked {
      color: var(--accent-green);
    }

    /* Badges */
    .badges {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      padding-left: 8px;
      flex-shrink: 0;
    }

    .line-count {
      font-size: 0.7rem;
      font-family: var(--font-mono);
      padding: 0 3px;
    }
    .line-count.green { color: var(--accent-green); }
    .line-count.orange { color: var(--accent-orange); }
    .line-count.red { color: var(--accent-red); }

    .git-badge {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0 4px;
      border-radius: 2px;
      line-height: 1.4;
    }
    .git-badge.modified {
      color: var(--accent-orange);
      background: rgba(240, 136, 62, 0.15);
    }
    .git-badge.staged {
      color: var(--accent-green);
      background: rgba(126, 231, 135, 0.15);
    }
    .git-badge.untracked {
      color: var(--accent-green);
      background: rgba(126, 231, 135, 0.15);
    }

    .diff-stat {
      font-size: 0.65rem;
      font-family: var(--font-mono);
    }
    .diff-add { color: var(--accent-green); }
    .diff-del { color: var(--accent-red); }

    /* Context menu */
    .context-menu {
      position: fixed;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 4px 0;
      min-width: 160px;
      box-shadow: var(--shadow-lg);
      z-index: var(--z-overlay);
      font-size: 0.8rem;
    }

    .context-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      cursor: pointer;
      color: var(--text-primary);
    }
    .context-menu-item:hover {
      background: var(--bg-secondary);
    }
    .context-menu-item.danger {
      color: var(--accent-red);
    }

    .context-menu-separator {
      height: 1px;
      background: var(--border-primary);
      margin: 4px 0;
    }

    /* Inline prompt input for rename / new file */
    .inline-input {
      background: var(--bg-primary);
      border: 1px solid var(--accent-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.8rem;
      padding: 2px 6px;
      outline: none;
      width: 100%;
      margin: 2px 0;
    }

    /* Review banner */
    .review-banner {
      padding: 8px 10px;
      background: rgba(79, 195, 247, 0.08);
      border-bottom: 1px solid var(--accent-primary);
      font-size: 0.75rem;
    }
    .review-banner-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .review-banner-title strong {
      color: var(--accent-primary);
    }
    .review-banner .review-stats {
      color: var(--text-muted);
      margin-top: 2px;
      font-size: 0.7rem;
    }
    .review-exit-btn {
      background: none;
      border: 1px solid var(--accent-red);
      color: var(--accent-red);
      font-size: 0.65rem;
      padding: 1px 8px;
      border-radius: 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .review-exit-btn:hover {
      background: rgba(255, 80, 80, 0.15);
    }
    /* Empty state */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 0.8rem;
    }
  `]);customElements.define("ac-file-picker",Mt);const Li=280,Ri=150,Ii=500,Pi="ac-dc-picker-width",Di="ac-dc-picker-collapsed";class zt extends U(z){constructor(){super(),this._pickerWidth=this._loadWidth(),this._pickerCollapsed=this._loadCollapsed(),this._selectedFiles=[],this._messages=[],this._streamingActive=!1,this._isDragging=!1,this._reviewState={active:!1},this._showReviewSelector=!1}connectedCallback(){super.connectedCallback(),window.addEventListener("state-loaded",e=>this._onStateLoaded(e)),window.addEventListener("files-changed",e=>this._onFilesChanged(e))}onRpcReady(){Promise.resolve().then(()=>this._loadReviewState())}async _loadReviewState(){try{const e=await this.rpcExtract("LLMService.get_review_state");e&&(this._reviewState=e)}catch(e){console.warn("Failed to load review state:",e)}}async _openReviewSelector(){var t;await $e(()=>import("./review-selector-D7VJ6Nx5.js"),__vite__mapDeps([0,1,2,3,4])),this._showReviewSelector=!0,await this.updateComplete;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-review-selector");e&&e.show()}_onReviewSelectorClose(){this._showReviewSelector=!1}async _onReviewStarted(e){var s,r;this._reviewState={active:!0,...e.detail},this._selectedFiles=[];const t=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-file-picker");t&&(t.selectedFiles=new Set,t.requestUpdate()),t&&await t.loadTree();const i=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-chat-panel");i&&(i.selectedFiles=[],i.reviewState=this._reviewState,i.requestUpdate())}async _exitReview(){var e,t;try{const i=await this.rpcExtract("LLMService.end_review");if(i!=null&&i.error){console.error("Exit review failed:",i.error),this.showToast(`Exit review failed: ${i.error}`,"error");return}this._reviewState={active:!1};const s=(e=this.shadowRoot)==null?void 0:e.querySelector("ac-file-picker");s&&await s.loadTree();const r=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-chat-panel");r&&(r.reviewState=this._reviewState,r.requestUpdate()),window.dispatchEvent(new CustomEvent("review-ended"))}catch(i){console.error("Exit review failed:",i),this.showToast(`Exit review failed: ${i.message||"Unknown error"}`,"error")}}_onFilesChanged(e){var i;const t=(i=e.detail)==null?void 0:i.selectedFiles;Array.isArray(t)&&(this._syncMessagesFromChat(),this._selectedFiles=t)}_onSelectionChanged(e){var s,r;const t=((s=e.detail)==null?void 0:s.selectedFiles)||[];this._syncMessagesFromChat(),this._selectedFiles=t,this.rpcConnected&&this.rpcCall("LLMService.set_selected_files",t).catch(()=>{});const i=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-chat-panel");i&&(i.selectedFiles=t,i.requestUpdate())}_onFileClicked(e){var i;const t=(i=e.detail)==null?void 0:i.path;t&&window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:t}}))}_syncMessagesFromChat(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-chat-panel");e&&(this._messages=e.messages)}_onInsertPath(e){var s,r,o;const t=(s=e.detail)==null?void 0:s.path;if(!t)return;const i=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-chat-panel");if(i){const l=(o=i.shadowRoot)==null?void 0:o.querySelector(".input-textarea");if(l){const a=l.selectionStart,c=l.value.slice(0,a),h=l.value.slice(l.selectionEnd),d=!c.endsWith(" ")&&c.length>0?" ":"",u=h.startsWith(" ")?"":" ";l.value=c+d+t+u+h,l.dispatchEvent(new Event("input",{bubbles:!0}));const v=a+d.length+t.length+u.length;l.setSelectionRange(v,v),i._suppressNextPaste=!0,l.focus()}}}_onFilterFromChat(e){var s,r;const t=((s=e.detail)==null?void 0:s.filter)||"",i=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-file-picker");i&&i.setFilter(t)}_onFileMentionClick(e){var a,c,h,d,u;const t=(a=e.detail)==null?void 0:a.path;if(!t)return;this._syncMessagesFromChat();const i=((c=e.detail)==null?void 0:c.navigate)!==!1;let s;if(this._selectedFiles.includes(t))s=this._selectedFiles.filter(v=>v!==t);else{s=[...this._selectedFiles,t];const v=(h=this.shadowRoot)==null?void 0:h.querySelector("ac-chat-panel");v&&v.accumulateFileInInput(t)}this._selectedFiles=s;const o=(d=this.shadowRoot)==null?void 0:d.querySelector("ac-file-picker");o&&(o.selectedFiles=new Set(s),o.requestUpdate());const l=(u=this.shadowRoot)==null?void 0:u.querySelector("ac-chat-panel");l&&(l.selectedFiles=s,l.requestUpdate()),this.rpcConnected&&this.rpcCall("LLMService.set_selected_files",s).catch(()=>{}),i&&window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:t}}))}_onFilesModified(e){var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-file-picker");t&&t.loadTree(),window.dispatchEvent(new CustomEvent("files-modified",{detail:e.detail}))}_onStateLoaded(e){const t=e.detail;t&&(this._messages=t.messages||[],this._selectedFiles=t.selected_files||[],this._streamingActive=t.streaming_active||!1,requestAnimationFrame(()=>{var s;const i=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-file-picker");i&&this._selectedFiles.length>0&&(i.selectedFiles=new Set(this._selectedFiles))}))}_loadWidth(){try{const e=localStorage.getItem(Pi);return e?Math.max(Ri,Math.min(Ii,parseInt(e))):Li}catch{return Li}}_loadCollapsed(){try{return localStorage.getItem(Di)==="true"}catch{return!1}}_saveWidth(e){try{localStorage.setItem(Pi,String(e))}catch{}}_saveCollapsed(e){try{localStorage.setItem(Di,String(e))}catch{}}_onResizeStart(e){e.preventDefault(),this._isDragging=!0;const t=e.clientX,i=this._pickerWidth,s=o=>{const l=o.clientX-t,a=Math.max(Ri,Math.min(Ii,i+l));this._pickerWidth=a},r=()=>{this._isDragging=!1,this._saveWidth(this._pickerWidth),window.removeEventListener("mousemove",s),window.removeEventListener("mouseup",r)};window.addEventListener("mousemove",s),window.addEventListener("mouseup",r)}_toggleCollapse(){this._pickerCollapsed=!this._pickerCollapsed,this._saveCollapsed(this._pickerCollapsed)}render(){return f`
      <div
        class="picker-panel ${this._pickerCollapsed?"collapsed":""}"
        style="width: ${this._pickerCollapsed?0:this._pickerWidth}px"
        role="region"
        aria-label="File picker"
      >
        <ac-file-picker
          .selectedFiles=${new Set(this._selectedFiles)}
          .reviewState=${this._reviewState}
          @selection-changed=${this._onSelectionChanged}
          @file-clicked=${this._onFileClicked}
          @insert-path=${this._onInsertPath}
          @open-review=${this._openReviewSelector}
          @exit-review=${this._exitReview}
        ></ac-file-picker>
      </div>

      <div
        class="resizer ${this._isDragging?"dragging":""}"
        @mousedown=${this._onResizeStart}
      >
        <button class="collapse-btn" @click=${this._toggleCollapse}
          title="${this._pickerCollapsed?"Expand":"Collapse"} file picker"
          aria-label="${this._pickerCollapsed?"Expand":"Collapse"} file picker"
          aria-expanded="${!this._pickerCollapsed}">
          ${this._pickerCollapsed?"▶":"◀"}
        </button>
      </div>

      <div class="chat-panel" role="region" aria-label="Chat">
        <ac-chat-panel
          .messages=${this._messages}
          .selectedFiles=${this._selectedFiles}
          .streamingActive=${this._streamingActive}
          .reviewState=${this._reviewState}
          @files-modified=${this._onFilesModified}
          @filter-from-chat=${this._onFilterFromChat}
          @file-mention-click=${this._onFileMentionClick}
          @open-review=${this._openReviewSelector}
          @exit-review=${this._exitReview}
        ></ac-chat-panel>
      </div>

      ${this._showReviewSelector?f`
        <ac-review-selector
          @review-started=${this._onReviewStarted}
          @review-selector-close=${this._onReviewSelectorClose}
        ></ac-review-selector>
      `:_}
    `}}$(zt,"properties",{_pickerWidth:{type:Number,state:!0},_pickerCollapsed:{type:Boolean,state:!0},_selectedFiles:{type:Array,state:!0},_messages:{type:Array,state:!0},_streamingActive:{type:Boolean,state:!0},_reviewState:{type:Object,state:!0},_showReviewSelector:{type:Boolean,state:!0}}),$(zt,"styles",[P,B,L`
    :host {
      display: flex;
      flex-direction: row;
      height: 100%;
      overflow: hidden;
      position: relative;
    }

    /* File picker panel */
    .picker-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--bg-primary);
      border-right: 1px solid var(--border-primary);
      overflow: hidden;
      flex-shrink: 0;
    }
    .picker-panel.collapsed {
      width: 0 !important;
      border-right: none;
    }

    .picker-panel ac-file-picker {
      flex: 1;
      min-height: 0;
    }

    /* Resizer */
    .resizer {
      width: 4px;
      cursor: col-resize;
      background: transparent;
      flex-shrink: 0;
      position: relative;
    }
    .resizer:hover,
    .resizer.dragging {
      background: var(--accent-primary);
      opacity: 0.3;
    }

    .collapse-btn {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.6rem;
      width: 16px;
      height: 32px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .resizer:hover .collapse-btn,
    .collapse-btn:hover {
      opacity: 1;
    }

    /* Chat panel */
    .chat-panel {
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .chat-panel > * {
      flex: 1;
      min-height: 0;
    }

  `]);customElements.define("ac-files-tab",zt);const Fi={search:()=>$e(()=>import("./ac-search-tab-CD4eoejh.js"),__vite__mapDeps([5,1,2,3,4])),context:()=>$e(()=>import("./ac-context-tab-Cbyzt-EF.js"),__vite__mapDeps([6,1,2,3,4])),cache:()=>$e(()=>import("./ac-cache-tab-BWhMxl4M.js"),__vite__mapDeps([7,1,2,3,4])),settings:()=>$e(()=>import("./ac-settings-tab-CjdF51ZX.js"),__vite__mapDeps([8,1,2,3,4]))},He=[{id:"files",icon:"📁",label:"Files",shortcut:"Alt+1"},{id:"search",icon:"🔍",label:"Search",shortcut:"Alt+2"},{id:"context",icon:"📊",label:"Context",shortcut:"Alt+3"},{id:"cache",icon:"🗄️",label:"Cache",shortcut:"Alt+4"},{id:"settings",icon:"⚙️",label:"Settings",shortcut:"Alt+5"}];class Lt extends U(z){constructor(){super(),this.activeTab="files",this.minimized=this._loadBoolPref("ac-dc-minimized",!1),this._historyPercent=0,this._reviewActive=!1,this._visitedTabs=new Set(["files"]),this._onKeyDown=this._onKeyDown.bind(this),this._undocked=!1}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._onKeyDown),this._restoreDialogWidth(),this._restoreDialogPosition()}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._onKeyDown)}onRpcReady(){this._refreshHistoryBar(),this._refreshReviewState();const e=this._loadPref("ac-dc-active-tab","files");e!==this.activeTab&&this._switchTab(e),this._dialogEventsRegistered||(this._dialogEventsRegistered=!0,window.addEventListener("stream-complete",()=>this._refreshHistoryBar()),window.addEventListener("compaction-event",()=>this._refreshHistoryBar()),window.addEventListener("state-loaded",()=>this._refreshHistoryBar()),window.addEventListener("session-loaded",()=>this._refreshHistoryBar()),window.addEventListener("review-started",()=>{this._reviewActive=!0}),window.addEventListener("review-ended",()=>{this._reviewActive=!1}))}async _refreshReviewState(){try{const e=await this.rpcExtract("LLMService.get_review_state");e&&(this._reviewActive=!!e.active)}catch{}}_onReviewClick(){this._switchTab("files"),this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-files-tab");e&&(this._reviewActive?e._exitReview():e._openReviewSelector())})}async _refreshHistoryBar(){try{const e=await this.rpcExtract("LLMService.get_history_status");e&&typeof e.percent=="number"&&(this._historyPercent=e.percent)}catch{}}_onKeyDown(e){var t,i;if(e.altKey&&e.key>="1"&&e.key<="5"){e.preventDefault();const s=parseInt(e.key)-1;He[s]&&this._switchTab(He[s].id);return}if(e.altKey&&(e.key==="m"||e.key==="M")){e.preventDefault(),this._toggleMinimize();return}if(e.ctrlKey&&e.shiftKey&&(e.key==="f"||e.key==="F")){e.preventDefault();const s=((i=(t=window.getSelection())==null?void 0:t.toString())==null?void 0:i.trim())||"";this._switchTab("search"),s&&!s.includes(`
`)&&this.updateComplete.then(()=>{var o;const r=(o=this.shadowRoot)==null?void 0:o.querySelector("ac-search-tab");r&&r.prefill(s)});return}}_switchTab(e){this.activeTab=e,this._savePref("ac-dc-active-tab",e),this._visitedTabs.add(e),this.minimized&&(this.minimized=!1),Fi[e]&&Fi[e](),this.updateComplete.then(()=>{var i,s;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".tab-panel.active");if(t){const r=t.firstElementChild;r&&typeof r.onTabVisible=="function"&&r.onTabVisible()}if(e==="search"){const r=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-search-tab");r&&r.focus()}})}_toggleMinimize(){this.minimized=!this.minimized,this._saveBoolPref("ac-dc-minimized",this.minimized)}_getHistoryBarColor(){return this._historyPercent>90?"red":this._historyPercent>75?"orange":"green"}_getContainer(){return this.parentElement}_onResizeStart(e){e.preventDefault(),e.stopPropagation(),this._isResizing=!0;const t=this._getContainer();if(!t)return;const i=e.clientX,s=t.offsetWidth,r=l=>{const a=l.clientX-i,c=Math.max(300,s+a);t.style.width=`${c}px`},o=()=>{this._isResizing=!1,this._savePref("ac-dc-dialog-width",String(t.offsetWidth)),window.removeEventListener("mousemove",r),window.removeEventListener("mouseup",o)};window.addEventListener("mousemove",r),window.addEventListener("mouseup",o)}_onResizeBottomStart(e){e.preventDefault(),e.stopPropagation();const t=this._getContainer();if(!t)return;this._undocked||this._undock(t);const i=e.clientY,s=t.offsetHeight,r=l=>{const a=l.clientY-i,c=Math.max(200,s+a);t.style.height=`${c}px`},o=()=>{this._persistPosition(t),window.removeEventListener("mousemove",r),window.removeEventListener("mouseup",o)};window.addEventListener("mousemove",r),window.addEventListener("mouseup",o)}_onResizeCornerStart(e){e.preventDefault(),e.stopPropagation();const t=this._getContainer();if(!t)return;this._undocked||this._undock(t);const i=e.clientX,s=e.clientY,r=t.offsetWidth,o=t.offsetHeight,l=c=>{const h=c.clientX-i,d=c.clientY-s;t.style.width=`${Math.max(300,r+h)}px`,t.style.height=`${Math.max(200,o+d)}px`},a=()=>{this._persistPosition(t),window.removeEventListener("mousemove",l),window.removeEventListener("mouseup",a)};window.addEventListener("mousemove",l),window.addEventListener("mouseup",a)}_undock(e){const t=e.getBoundingClientRect();this._undocked=!0,e.style.position="fixed",e.style.top=`${t.top}px`,e.style.left=`${t.left}px`,e.style.width=`${t.width}px`,e.style.height=`${t.height}px`,e.style.right="auto",e.style.bottom="auto"}_persistPosition(e){const t=e.getBoundingClientRect();this._savePref("ac-dc-dialog-pos",JSON.stringify({left:t.left,top:t.top,width:t.width,height:t.height}))}_onHeaderMouseDown(e){if(e.button!==0)return;e.preventDefault();const t=this._getContainer();if(!t)return;const i=e.clientX,s=e.clientY,r=t.getBoundingClientRect(),o=r.left,l=r.top;r.width,r.height;let a=!1;const c=d=>{const u=d.clientX-i,v=d.clientY-s;if(!a){if(Math.abs(u)<5&&Math.abs(v)<5)return;a=!0,this._undocked||this._undock(t)}const m=Math.max(0,o+u),y=Math.max(0,l+v);t.style.left=`${m}px`,t.style.top=`${y}px`},h=()=>{window.removeEventListener("mousemove",c),window.removeEventListener("mouseup",h),a?this._undocked&&this._persistPosition(t):this._toggleMinimize()};window.addEventListener("mousemove",c),window.addEventListener("mouseup",h)}_savePref(e,t){try{localStorage.setItem(e,t)}catch{}}_loadPref(e,t){try{const i=localStorage.getItem(e);return i!==null?i:t}catch{return t}}_saveBoolPref(e,t){this._savePref(e,String(t))}_loadBoolPref(e,t){try{const i=localStorage.getItem(e);return i===null?t:i==="true"}catch{return t}}_restoreDialogWidth(){const e=this._loadPref("ac-dc-dialog-width",null);if(!e)return;const t=parseInt(e);if(isNaN(t)||t<300)return;const i=this._getContainer();i&&(i.style.width=`${Math.min(t,window.innerWidth-50)}px`)}_restoreDialogPosition(){const e=this._loadPref("ac-dc-dialog-pos",null);if(e)try{const t=JSON.parse(e);if(!t||typeof t.left!="number")return;const i=window.innerWidth,s=window.innerHeight,r=Math.min(t.width||400,i-20),o=Math.min(t.height||s,s-20),l=Math.max(0,Math.min(t.left,i-100)),a=Math.max(0,Math.min(t.top,s-100)),c=this._getContainer();if(!c)return;this._undocked=!0,c.style.position="fixed",c.style.left=`${l}px`,c.style.top=`${a}px`,c.style.width=`${r}px`,c.style.height=`${o}px`,c.style.right="auto",c.style.bottom="auto"}catch{}}render(){const e=He.find(t=>t.id===this.activeTab);return f`
      <div class="header" @mousedown=${this._onHeaderMouseDown}>
        <span class="header-label">${(e==null?void 0:e.label)||"Files"}</span>

        <div class="tab-buttons" role="tablist" aria-label="Tool tabs">
          ${He.map(t=>f`
            <button
              class="tab-btn ${t.id===this.activeTab?"active":""}"
              role="tab"
              aria-selected="${t.id===this.activeTab}"
              aria-controls="panel-${t.id}"
              id="tab-${t.id}"
              title="${t.label} (${t.shortcut})"
              @mousedown=${i=>i.stopPropagation()}
              @click=${i=>{i.stopPropagation(),this._switchTab(t.id)}}
            >${t.icon}</button>
          `)}
        </div>

        <div class="header-actions">
          <button class="header-action ${this._reviewActive?"review-active":""}"
            title="${this._reviewActive?"Exit Review":"Code Review"}"
            aria-label="${this._reviewActive?"Exit code review":"Start code review"}"
            @mousedown=${t=>t.stopPropagation()}
            @click=${()=>this._onReviewClick()}>
            👁️
          </button>
          <button class="header-action" title="Minimize (Alt+M)"
            aria-label="${this.minimized?"Expand panel":"Minimize panel"}"
            aria-expanded="${!this.minimized}"
            @mousedown=${t=>t.stopPropagation()}
            @click=${this._toggleMinimize}>
            ${this.minimized?"▲":"▼"}
          </button>
        </div>
      </div>

      <div class="content ${this.minimized?"minimized":""}">
        <!-- Files tab (always rendered) -->
        <div class="tab-panel ${this.activeTab==="files"?"active":""}"
             role="tabpanel" id="panel-files" aria-labelledby="tab-files">
          <ac-files-tab></ac-files-tab>
        </div>

        <!-- Lazy-loaded tabs — only render once visited -->
        ${this._visitedTabs.has("search")?f`
          <div class="tab-panel ${this.activeTab==="search"?"active":""}"
               role="tabpanel" id="panel-search" aria-labelledby="tab-search">
            <ac-search-tab></ac-search-tab>
          </div>
        `:""}

        ${this._visitedTabs.has("context")?f`
          <div class="tab-panel ${this.activeTab==="context"?"active":""}"
               role="tabpanel" id="panel-context" aria-labelledby="tab-context">
            <ac-context-tab></ac-context-tab>
          </div>
        `:""}

        ${this._visitedTabs.has("cache")?f`
          <div class="tab-panel ${this.activeTab==="cache"?"active":""}"
               role="tabpanel" id="panel-cache" aria-labelledby="tab-cache">
            <ac-cache-tab></ac-cache-tab>
          </div>
        `:""}

        ${this._visitedTabs.has("settings")?f`
          <div class="tab-panel ${this.activeTab==="settings"?"active":""}"
               role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
            <ac-settings-tab></ac-settings-tab>
          </div>
        `:""}
      </div>

      <div class="history-bar">
        <div
          class="history-bar-fill ${this._getHistoryBarColor()}"
          style="width: ${this._historyPercent}%"
        ></div>
      </div>

      <div class="resize-handle" @mousedown=${this._onResizeStart}></div>
      <div class="resize-handle-bottom" @mousedown=${this._onResizeBottomStart}></div>
      <div class="resize-handle-corner" @mousedown=${this._onResizeCornerStart}></div>
    `}}$(Lt,"properties",{activeTab:{type:String,state:!0},minimized:{type:Boolean,reflect:!0},_historyPercent:{type:Number,state:!0},_reviewActive:{type:Boolean,state:!0}}),$(Lt,"styles",[P,B,L`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-primary);
      overflow: hidden;
      pointer-events: auto;
    }
    :host([minimized]) {
      height: auto;
    }

    /* Header bar */
    .header {
      display: flex;
      align-items: center;
      height: 40px;
      min-height: 40px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      padding: 0 8px;
      cursor: grab;
      user-select: none;
    }
    .header:active {
      cursor: grabbing;
    }

    .header-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-secondary);
      margin-right: 12px;
      white-space: nowrap;
      cursor: pointer;
    }

    .tab-buttons {
      display: flex;
      gap: 2px;
      flex: 1;
    }

    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1rem;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .tab-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    .tab-btn.active {
      background: var(--bg-primary);
      color: var(--accent-primary);
    }

    .header-actions {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }

    .header-action {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.9rem;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .header-action:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    .header-action.review-active {
      color: var(--accent-primary);
    }

    /* Content area */
    .content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .content.minimized {
      display: none;
    }

    .tab-panel {
      position: absolute;
      inset: 0;
      overflow: hidden;
      display: none;
    }
    .tab-panel.active {
      display: flex;
      flex-direction: column;
    }
    .tab-panel > * {
      flex: 1;
      min-height: 0;
    }

    /* Placeholder for unimplemented tabs */
    .placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    /* History bar */
    .history-bar {
      height: 3px;
      min-height: 3px;
      background: var(--bg-tertiary);
    }
    .history-bar-fill {
      height: 100%;
      transition: width 0.3s, background-color 0.3s;
    }
    .history-bar-fill.green { background: var(--accent-green); }
    .history-bar-fill.orange { background: var(--accent-orange); }
    .history-bar-fill.red { background: var(--accent-red); }

    /* Resize handle — right edge */
    .resize-handle {
      position: absolute;
      top: 0;
      right: -4px;
      width: 8px;
      height: 100%;
      cursor: col-resize;
      z-index: 10;
    }
    :host([minimized]) .resize-handle,
    :host([minimized]) .resize-handle-bottom,
    :host([minimized]) .resize-handle-corner {
      display: none;
    }
    .resize-handle:hover,
    .resize-handle:active {
      background: var(--accent-primary);
      opacity: 0.3;
    }

    /* Resize handle — bottom edge */
    .resize-handle-bottom {
      position: absolute;
      bottom: -4px;
      left: 0;
      width: 100%;
      height: 8px;
      cursor: row-resize;
      z-index: 10;
    }
    .resize-handle-bottom:hover,
    .resize-handle-bottom:active {
      background: var(--accent-primary);
      opacity: 0.3;
    }

    /* Resize handle — bottom-right corner */
    .resize-handle-corner {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      z-index: 11;
    }
    .resize-handle-corner:hover,
    .resize-handle-corner:active {
      background: var(--accent-primary);
      opacity: 0.3;
      border-radius: 2px;
    }
  `]);customElements.define("ac-dialog",Lt);self.MonacoEnvironment={getWorker(n,e){if(e==="editorWorkerService")return new Worker(new URL("/AI-Coder-DeCoder/be2d999b/assets/editor.worker-DX6ApQqM.js",import.meta.url),{type:"module"});const t=new Blob(["self.onmessage = function() {}"],{type:"application/javascript"});return new Worker(URL.createObjectURL(t))}};const Pn={".js":"javascript",".mjs":"javascript",".jsx":"javascript",".ts":"typescript",".tsx":"typescript",".py":"python",".json":"json",".yaml":"yaml",".yml":"yaml",".html":"html",".htm":"html",".css":"css",".scss":"scss",".less":"less",".md":"markdown",".markdown":"markdown",".c":"c",".h":"c",".cpp":"cpp",".cc":"cpp",".cxx":"cpp",".hpp":"cpp",".hxx":"cpp",".sh":"shell",".bash":"shell",".xml":"xml",".svg":"xml",".java":"java",".rs":"rust",".go":"go",".rb":"ruby",".php":"php",".sql":"sql",".toml":"ini",".ini":"ini",".cfg":"ini"};function Dn(n){if(!n)return"plaintext";const e=n.lastIndexOf(".");if(e===-1)return"plaintext";const t=n.slice(e).toLowerCase();return Pn[t]||"plaintext"}function Oi(n){if(!n)return[];const e=n.querySelectorAll("[data-source-line]"),t=[];for(const i of e){const s=parseInt(i.getAttribute("data-source-line"),10);isNaN(s)||t.push({line:s,offsetTop:i.offsetTop})}return t.sort((i,s)=>i.line-s.line),t}class Rt extends U(z){constructor(){super(),this._files=[],this._activeIndex=-1,this._dirtySet=new Set,this._previewMode=!1,this._previewContent="",this._editor=null,this._editorContainer=null,this._resizeObserver=null,this._styleObserver=null,this._monacoStylesInjected=!1,this._highlightTimer=null,this._highlightDecorations=[],this._lspRegistered=!1,this._virtualContents={},this._scrollLock=null,this._scrollLockTimer=null,this._editorScrollDisposable=null,this._onKeyDown=this._onKeyDown.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._onKeyDown)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._onKeyDown),this._disposeEditor(),this._resizeObserver&&(this._resizeObserver.disconnect(),this._resizeObserver=null),this._styleObserver&&(this._styleObserver.disconnect(),this._styleObserver=null),this._scrollLockTimer&&(clearTimeout(this._scrollLockTimer),this._scrollLockTimer=null)}firstUpdated(){this._editorContainer=this.shadowRoot.querySelector(".editor-pane")||this.shadowRoot.querySelector(".editor-container"),this._editorContainer&&(this._resizeObserver=new ResizeObserver(()=>{this._editor&&this._editor.layout()}),this._resizeObserver.observe(this._editorContainer))}onRpcReady(){this._registerLspProviders()}async openFile(e){const{path:t,searchText:i,line:s}=e;if(!t)return;e.virtualContent!=null&&(this._virtualContents[t]=e.virtualContent);const r=this._files.findIndex(d=>d.path===t);if(r!==-1){this._activeIndex=r,await this.updateComplete,this._showEditor(),s!=null?this._scrollToLine(s):i&&this._scrollToSearchText(i),this._dispatchActiveFileChanged(t);return}let o=e.original??"",l=e.modified??"",a=e.is_new??!1,c=e.is_read_only??!1;if(e.virtualContent!=null)o="",l=e.virtualContent,a=!0,c=e.readOnly??!0;else if(!e.original&&!e.modified){const d=await this._fetchFileContent(t);if(d===null)return;o=d.original,l=d.modified,a=d.is_new,c=d.is_read_only??!1}const h={path:t,original:o,modified:l,is_new:a,is_read_only:c??!1,is_config:e.is_config??!1,config_type:e.config_type??null,real_path:e.real_path??null,savedContent:l};this._files=[...this._files,h],this._activeIndex=this._files.length-1,await this.updateComplete,this._showEditor(),s!=null?this._scrollToLine(s):i&&this._scrollToSearchText(i),this._dispatchActiveFileChanged(t)}async refreshOpenFiles(){const e=[];let t=!1;for(const i of this._files){if(i.is_config){e.push(i);continue}const s=await this._fetchFileContent(i.path);if(s===null){e.push(i);continue}const r={...i,original:s.original,modified:s.modified,is_new:s.is_new,savedContent:s.modified};e.push(r),t=!0}t&&(this._files=e,this._dirtySet=new Set,await this.updateComplete,this._showEditor())}closeFile(e){delete this._virtualContents[e];const t=this._files.findIndex(i=>i.path===e);t!==-1&&(this._dirtySet.delete(e),this._files=this._files.filter(i=>i.path!==e),this._files.length===0?(this._activeIndex=-1,this._disposeEditor(),this._dispatchActiveFileChanged(null)):this._activeIndex>=this._files.length?(this._activeIndex=this._files.length-1,this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)):t<=this._activeIndex&&(this._activeIndex=Math.max(0,this._activeIndex-1),this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)))}getDirtyFiles(){return[...this._dirtySet]}getViewportState(){if(!this._editor)return null;const e=this._editor.getModifiedEditor();if(!e)return null;const t=e.getPosition();return{scrollTop:e.getScrollTop(),scrollLeft:e.getScrollLeft(),lineNumber:(t==null?void 0:t.lineNumber)??1,column:(t==null?void 0:t.column)??1}}restoreViewportState(e){if(!e)return;const t=(i=0)=>{var o;const s=this._editor,r=(o=s==null?void 0:s.getModifiedEditor)==null?void 0:o.call(s);r?requestAnimationFrame(()=>{e.lineNumber&&(r.setPosition({lineNumber:e.lineNumber,column:e.column??1}),r.revealLineInCenter(e.lineNumber)),e.scrollTop!=null&&r.setScrollTop(e.scrollTop),e.scrollLeft!=null&&r.setScrollLeft(e.scrollLeft)}):i<20&&requestAnimationFrame(()=>t(i+1))};requestAnimationFrame(()=>t())}async _fetchFileContent(e){if(e.startsWith("virtual://"))return{original:"",modified:this._virtualContents[e]||"(no content)"};if(!this.rpcConnected)return null;try{let t="",i="",s=!1,r=!1;const o=await this.rpcExtract("Repo.get_file_content",e,"HEAD"),l=await this.rpcExtract("Repo.get_file_content",e);return o!=null&&o.error&&(l!=null&&l.error)?(console.warn("File not found:",e),null):(o!=null&&o.error?(s=!0,t="",i=(l==null?void 0:l.content)??l??""):l!=null&&l.error?(t=(o==null?void 0:o.content)??o??"",i="",r=!0):(t=(o==null?void 0:o.content)??o??"",i=(l==null?void 0:l.content)??l??""),{original:t,modified:i,is_new:s,is_read_only:r})}catch(t){return console.warn("Failed to fetch file content:",e,t),null}}_showEditor(){if(this._activeIndex<0||this._activeIndex>=this._files.length){this._disposeEditor();return}const e=this._files[this._activeIndex],t=this._editorContainer;if(!t)return;this._injectMonacoStyles();const i=Dn(e.path),s=!this._previewMode;if(this._editor){const r=this._editor.getModel();r&&(r.original&&r.original.dispose(),r.modified&&r.modified.dispose()),this._editor.updateOptions({renderSideBySide:s});const o=j.createModel(e.original,i),l=j.createModel(e.modified,i);this._editor.setModel({original:o,modified:l}),this._editor.getModifiedEditor().updateOptions({readOnly:e.is_read_only})}else{this._editor=j.createDiffEditor(t,{theme:"vs-dark",automaticLayout:!1,minimap:{enabled:!1},renderSideBySide:s,readOnly:!1,originalEditable:!1,scrollBeyondLastLine:!1,fontSize:13,lineNumbers:"on",glyphMargin:!1,folding:!0,wordWrap:this._previewMode?"on":"off",renderWhitespace:"selection",contextmenu:!0,scrollbar:{verticalScrollbarSize:8,horizontalScrollbarSize:8}});const r=j.createModel(e.original,i),o=j.createModel(e.modified,i);this._editor.setModel({original:r,modified:o}),this._editor.getModifiedEditor().updateOptions({readOnly:e.is_read_only}),this._editor.getModifiedEditor().onDidChangeModelContent(()=>{this._checkDirty(),this._previewMode&&this._updatePreview()})}if(this._editorScrollDisposable&&(this._editorScrollDisposable.dispose(),this._editorScrollDisposable=null),this._previewMode){const r=this._editor.getModifiedEditor();this._editorScrollDisposable=r.onDidScrollChange(()=>{this._scrollLock!=="preview"&&(this._scrollLock="editor",clearTimeout(this._scrollLockTimer),this._scrollLockTimer=setTimeout(()=>{this._scrollLock=null},120),this._scrollPreviewToEditorLine())})}this._editor.layout(),this._previewMode&&this._updatePreview()}_disposeEditor(){if(this._editorScrollDisposable&&(this._editorScrollDisposable.dispose(),this._editorScrollDisposable=null),this._editor){const e=this._editor.getModel();this._editor.dispose(),this._editor=null,e&&(e.original&&e.original.dispose(),e.modified&&e.modified.dispose())}this._highlightDecorations=[]}_checkDirty(){var r,o;if(this._activeIndex<0||this._activeIndex>=this._files.length)return;const e=this._files[this._activeIndex],i=(((o=(r=this._editor)==null?void 0:r.getModifiedEditor())==null?void 0:o.getValue())??"")!==e.savedContent,s=new Set(this._dirtySet);i?s.add(e.path):s.delete(e.path),this._dirtySet=s}_injectMonacoStyles(){const e=this.shadowRoot;this._syncAllStyles(e),!this._monacoStylesInjected&&(this._monacoStylesInjected=!0,this._styleObserver=new MutationObserver(t=>{for(const i of t){for(const s of i.addedNodes)if(s.nodeName==="STYLE"||s.nodeName==="LINK"){const r=s.cloneNode(!0);r.setAttribute("data-monaco-injected","true"),e.appendChild(r)}for(const s of i.removedNodes)if(s.nodeName==="STYLE"||s.nodeName==="LINK"){const r=e.querySelectorAll("[data-monaco-injected]");for(const o of r)if(o.textContent===s.textContent){o.remove();break}}}}),this._styleObserver.observe(document.head,{childList:!0}))}_syncAllStyles(e){const t=e.querySelectorAll("[data-monaco-injected]");for(const s of t)s.remove();const i=document.head.querySelectorAll('style, link[rel="stylesheet"]');for(const s of i){const r=s.cloneNode(!0);r.setAttribute("data-monaco-injected","true"),e.appendChild(r)}}_onKeyDown(e){if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault(),this._saveActiveFile();return}if((e.ctrlKey||e.metaKey)&&e.key==="PageDown"){e.preventDefault(),this._files.length>1&&(this._activeIndex=(this._activeIndex+1)%this._files.length,this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}if((e.ctrlKey||e.metaKey)&&e.key==="PageUp"){e.preventDefault(),this._files.length>1&&(this._activeIndex=(this._activeIndex-1+this._files.length)%this._files.length,this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}(e.ctrlKey||e.metaKey)&&e.key==="w"&&(e.preventDefault(),this._files.length>0&&this._activeIndex>=0&&this.closeFile(this._files[this._activeIndex].path))}_saveActiveFile(){var i,s;if(this._activeIndex<0||this._activeIndex>=this._files.length)return;const e=this._files[this._activeIndex];if(!this._dirtySet.has(e.path))return;const t=((s=(i=this._editor)==null?void 0:i.getModifiedEditor())==null?void 0:s.getValue())??"";this._doSave(e,t)}_saveFile(e){const t=this._files.findIndex(r=>r.path===e);if(t===-1)return;const i=this._files[t];let s;t===this._activeIndex&&this._editor?s=this._editor.getModifiedEditor().getValue():s=i.modified,this._doSave(i,s)}_doSave(e,t){const i=this._files.map(r=>r.path===e.path?{...r,modified:t,savedContent:t}:r);this._files=i;const s=new Set(this._dirtySet);s.delete(e.path),this._dirtySet=s,window.dispatchEvent(new CustomEvent("file-save",{detail:{path:e.path,content:t,isConfig:e.is_config,configType:e.config_type}}))}saveAll(){for(const e of this._dirtySet)this._saveFile(e)}_scrollToLine(e){if(!this._editor)return;const t=this._editor.getModifiedEditor();requestAnimationFrame(()=>{t.revealLineInCenter(e),t.setPosition({lineNumber:e,column:1}),t.focus()})}_scrollToSearchText(e){if(!this._editor||!e)return;const t=this._editor.getModifiedEditor(),i=t.getModel();if(!i)return;const s=e.split(`
`);for(let o=s.length;o>=1;o--){const l=s.slice(0,o).join(`
`).trim();if(!l)continue;const a=i.findNextMatch(l,{lineNumber:1,column:1},!1,!0,null,!1);if(a){requestAnimationFrame(()=>{t.revealLineInCenter(a.range.startLineNumber),t.setSelection(a.range),t.focus(),this._applyHighlight(t,a.range)});return}}const r=s.find(o=>o.trim());if(r){const o=i.findNextMatch(r.trim(),{lineNumber:1,column:1},!1,!0,null,!1);o&&requestAnimationFrame(()=>{t.revealLineInCenter(o.range.startLineNumber),t.setSelection(o.range),t.focus(),this._applyHighlight(t,o.range)})}}_applyHighlight(e,t){this._highlightTimer&&clearTimeout(this._highlightTimer),this._highlightDecorations=e.deltaDecorations(this._highlightDecorations,[{range:t,options:{isWholeLine:!0,className:"highlight-decoration",overviewRuler:{color:"#4fc3f7",position:j.OverviewRulerLane.Full}}}]),this._highlightTimer=setTimeout(()=>{this._highlightDecorations=e.deltaDecorations(this._highlightDecorations,[])},3e3)}_dispatchActiveFileChanged(e){window.dispatchEvent(new CustomEvent("active-file-changed",{detail:{path:e}}))}_registerLspProviders(){this._lspRegistered||(this._lspRegistered=!0,D.registerHoverProvider("*",{provideHover:async(e,t)=>{if(!this.rpcConnected)return null;const i=this._getFileForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLMService.lsp_get_hover",i.path,t.lineNumber-1,t.column-1);if(s!=null&&s.contents)return{contents:[{value:s.contents}],range:s.range?new Ne(s.range.start_line+1,s.range.start_col+1,s.range.end_line+1,s.range.end_col+1):void 0}}catch{}return null}}),D.registerDefinitionProvider("*",{provideDefinition:async(e,t)=>{if(!this.rpcConnected)return null;const i=this._getFileForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLMService.lsp_get_definition",i.path,t.lineNumber-1,t.column-1);if(s!=null&&s.file&&(s!=null&&s.range))return await this.openFile({path:s.file,line:s.range.start_line+1}),{uri:Kt.parse(`file:///${s.file}`),range:new Ne(s.range.start_line+1,s.range.start_col+1,s.range.end_line+1,s.range.end_col+1)}}catch{}return null}}),D.registerReferenceProvider("*",{provideReferences:async(e,t)=>{if(!this.rpcConnected)return null;const i=this._getFileForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLMService.lsp_get_references",i.path,t.lineNumber-1,t.column-1);if(Array.isArray(s))return s.map(r=>({uri:Kt.parse(`file:///${r.file}`),range:new Ne(r.range.start_line+1,r.range.start_col+1,r.range.end_line+1,r.range.end_col+1)}))}catch{}return null}}),D.registerCompletionItemProvider("*",{triggerCharacters:["."],provideCompletionItems:async(e,t)=>{if(!this.rpcConnected)return{suggestions:[]};const i=this._getFileForModel(e);if(!i)return{suggestions:[]};const s=e.getWordUntilPosition(t),r=(s==null?void 0:s.word)||"";try{const o=await this.rpcExtract("LLMService.lsp_get_completions",i.path,t.lineNumber-1,t.column-1,r);if(Array.isArray(o)){const l=new Ne(t.lineNumber,s.startColumn,t.lineNumber,s.endColumn);return{suggestions:o.map(a=>({label:a.label,kind:this._mapCompletionKind(a.kind),detail:a.detail||"",insertText:a.label,range:l}))}}}catch{}return{suggestions:[]}}}))}_getFileForModel(e){return this._activeIndex>=0&&this._activeIndex<this._files.length?this._files[this._activeIndex]:null}_mapCompletionKind(e){return{class:D.CompletionItemKind.Class,function:D.CompletionItemKind.Function,method:D.CompletionItemKind.Method,variable:D.CompletionItemKind.Variable,property:D.CompletionItemKind.Property,import:D.CompletionItemKind.Module}[e]||D.CompletionItemKind.Text}_isMarkdownFile(e){if(!e)return!1;const t=e.slice(e.lastIndexOf(".")).toLowerCase();return t===".md"||t===".markdown"}_togglePreview(){this._previewMode=!this._previewMode,this._previewMode&&this._updatePreview(),this._disposeEditor(),this.updateComplete.then(()=>{this._editorContainer=this.shadowRoot.querySelector(".editor-pane")||this.shadowRoot.querySelector(".editor-container"),this._editorContainer&&(this._resizeObserver&&this._resizeObserver.disconnect(),this._resizeObserver=new ResizeObserver(()=>{this._editor&&this._editor.layout()}),this._resizeObserver.observe(this._editorContainer)),this._showEditor()})}_updatePreview(){var e;if(this._editor){const t=((e=this._editor.getModifiedEditor())==null?void 0:e.getValue())??"";this._previewContent=wi(t)}else{const t=this._activeIndex>=0?this._files[this._activeIndex]:null;this._previewContent=t?wi(t.modified):""}this.requestUpdate()}_scrollPreviewToEditorLine(){var d;const e=(d=this.shadowRoot)==null?void 0:d.querySelector(".preview-pane");if(!e||!this._editor)return;const t=this._editor.getModifiedEditor(),i=t.getScrollTop(),s=t.getOption(j.EditorOption.lineHeight),r=Math.floor(i/s)+1,o=Oi(e);if(o.length===0)return;let l=o[0];for(const u of o)if(u.line<=r)l=u;else break;const a=o.indexOf(l),c=o[a+1];let h=l.offsetTop;if(c&&c.line>l.line){const u=(r-l.line)/(c.line-l.line);h+=u*(c.offsetTop-l.offsetTop)}e.scrollTop=h}_scrollEditorToPreviewLine(){var h;if(!this._editor)return;const e=(h=this.shadowRoot)==null?void 0:h.querySelector(".preview-pane");if(!e||this._scrollLock==="editor")return;this._scrollLock="preview",clearTimeout(this._scrollLockTimer),this._scrollLockTimer=setTimeout(()=>{this._scrollLock=null},120);const t=e.scrollTop,i=Oi(e);if(i.length===0)return;let s=i[0];for(const d of i)if(d.offsetTop<=t)s=d;else break;const r=i.indexOf(s),o=i[r+1];let l=s.line;if(o&&o.offsetTop>s.offsetTop){const d=(t-s.offsetTop)/(o.offsetTop-s.offsetTop);l+=d*(o.line-s.line)}const a=this._editor.getModifiedEditor(),c=a.getOption(j.EditorOption.lineHeight);a.setScrollTop((l-1)*c)}render(){const e=this._files.length>0,t=e&&this._activeIndex>=0?this._files[this._activeIndex]:null,i=t?this._dirtySet.has(t.path):!1,s=t&&this._isMarkdownFile(t.path);return this._previewMode&&t?f`
        <div class="split-container">
          <div class="editor-pane">
            ${this._renderOverlayButtons(t,i,s)}
          </div>
          <div class="preview-pane"
               @scroll=${()=>this._scrollEditorToPreviewLine()}>
            ${Y(this._previewContent)}
          </div>
        </div>
      `:f`
      <div class="editor-container">
        ${this._renderOverlayButtons(t,i,s)}
        ${e?_:f`
          <div class="empty-state">
            <div class="watermark">AC⚡DC</div>
          </div>
        `}
      </div>
    `}_renderOverlayButtons(e,t,i){return e?f`
      ${i?f`
        <button
          class="preview-btn ${this._previewMode?"active":""}"
          title="Toggle Markdown preview"
          @click=${()=>this._togglePreview()}
        >
          <span class="preview-icon"></span>
          Preview
        </button>
      `:_}
      <button
        class="status-led ${t?"dirty":e.is_new?"new-file":"clean"}"
        title="${e.path}${t?" — unsaved (Ctrl+S to save)":e.is_new?" — new file":""}"
        aria-label="${e.path}${t?", unsaved changes, press to save":e.is_new?", new file":", no changes"}"
        @click=${()=>t?this._saveActiveFile():null}
      ></button>
    `:_}}$(Rt,"properties",{_files:{type:Array,state:!0},_activeIndex:{type:Number,state:!0},_dirtySet:{type:Object,state:!0},_previewMode:{type:Boolean,state:!0}}),$(Rt,"styles",[P,B,L`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    /* Status LED — floating top-right indicator */
    .status-led {
      position: absolute;
      top: 8px;
      right: 16px;
      z-index: 10;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      cursor: pointer;
      transition: box-shadow 0.3s, background 0.3s;
      border: none;
      padding: 0;
    }
    .status-led.dirty {
      background: var(--accent-orange, #f0883e);
      box-shadow: 0 0 6px 2px rgba(240, 136, 62, 0.6);
      animation: led-pulse 2s ease-in-out infinite;
    }
    .status-led.clean {
      background: var(--accent-green);
      box-shadow: 0 0 4px 1px rgba(126, 231, 135, 0.4);
    }
    .status-led.new-file {
      background: var(--accent-primary);
      box-shadow: 0 0 4px 1px rgba(79, 195, 247, 0.4);
    }
    .status-led:hover {
      transform: scale(1.4);
    }
    @keyframes led-pulse {
      0%, 100% { opacity: 0.7; box-shadow: 0 0 6px 2px rgba(240, 136, 62, 0.4); }
      50% { opacity: 1; box-shadow: 0 0 10px 3px rgba(240, 136, 62, 0.8); }
    }

    /* Editor container */
    .editor-container {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }

    /* Empty state */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
    }
    .watermark {
      font-size: 8rem;
      opacity: 0.18;
      user-select: none;
    }

    /* Preview button — top-right, next to status LED */
    .preview-btn {
      position: absolute;
      top: 6px;
      right: 36px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border: 1px solid var(--border, #444);
      border-radius: 4px;
      background: var(--bg-secondary, #1e1e1e);
      color: var(--text-muted, #999);
      font-size: 0.75rem;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .preview-btn:hover {
      background: var(--bg-tertiary, #2a2a2a);
      color: var(--text-primary, #e0e0e0);
      border-color: var(--text-muted, #666);
    }
    .preview-btn.active {
      background: var(--accent-primary-dim, rgba(79, 195, 247, 0.15));
      color: var(--accent-primary, #4fc3f7);
      border-color: var(--accent-primary, #4fc3f7);
    }
    .preview-btn .preview-icon {
      width: 12px;
      height: 10px;
      border: 1.5px solid currentColor;
      border-radius: 2px;
    }

    /* Split layout for preview mode */
    .split-container {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .split-container .editor-pane {
      flex: 1;
      min-width: 0;
      position: relative;
      overflow: hidden;
    }
    .split-container .preview-pane {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      padding: 24px 32px;
      background: var(--bg-primary, #0d1117);
      border-left: 1px solid var(--border, #333);
      font-size: 0.9rem;
      line-height: 1.6;
      color: var(--text-primary, #e0e0e0);
    }

    /* Markdown preview content styling */
    .preview-pane h1, .preview-pane h2, .preview-pane h3,
    .preview-pane h4, .preview-pane h5, .preview-pane h6 {
      color: var(--text-primary, #e0e0e0);
      margin-top: 1.2em;
      margin-bottom: 0.4em;
      border-bottom: 1px solid var(--border, #333);
      padding-bottom: 0.3em;
    }
    .preview-pane h1 { font-size: 1.8em; }
    .preview-pane h2 { font-size: 1.4em; }
    .preview-pane h3 { font-size: 1.15em; }
    .preview-pane p { margin: 0.6em 0; }
    .preview-pane a { color: var(--accent-primary, #4fc3f7); }
    .preview-pane code {
      background: var(--bg-tertiary, #161b22);
      padding: 0.15em 0.4em;
      border-radius: 3px;
      font-size: 0.88em;
    }
    .preview-pane pre {
      background: var(--bg-tertiary, #161b22);
      padding: 12px 16px;
      border-radius: 6px;
      overflow-x: auto;
    }
    .preview-pane pre code {
      background: none;
      padding: 0;
    }
    .preview-pane blockquote {
      border-left: 3px solid var(--accent-primary, #4fc3f7);
      padding-left: 12px;
      margin-left: 0;
      color: var(--text-muted, #999);
    }
    .preview-pane ul, .preview-pane ol {
      padding-left: 1.5em;
    }
    .preview-pane li { margin: 0.25em 0; }
    .preview-pane table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.8em 0;
    }
    .preview-pane th, .preview-pane td {
      border: 1px solid var(--border, #333);
      padding: 6px 12px;
      text-align: left;
    }
    .preview-pane th {
      background: var(--bg-secondary, #1e1e1e);
    }
    .preview-pane img {
      max-width: 100%;
    }
    .preview-pane hr {
      border: none;
      border-top: 1px solid var(--border, #333);
      margin: 1.5em 0;
    }

    /* Highlight animation for scroll-to-edit */
    .highlight-decoration {
      background: rgba(79, 195, 247, 0.2);
    }
  `]);customElements.define("ac-diff-viewer",Rt);var Fn=function(){var n="",e,t,i,s=[],r={passive:!0},o={passive:!1};window.addEventListener?(e="addEventListener",t="removeEventListener"):(e="attachEvent",t="detachEvent",n="on"),i="onwheel"in document.createElement("div")?"wheel":document.onmousewheel!==void 0?"mousewheel":"DOMMouseScroll";function l(m,y){var p=function(g){!g&&(g=window.event);var b={originalEvent:g,target:g.target||g.srcElement,type:"wheel",deltaMode:g.type=="MozMousePixelScroll"?0:1,deltaX:0,delatZ:0,preventDefault:function(){g.preventDefault?g.preventDefault():g.returnValue=!1}};return i=="mousewheel"?(b.deltaY=-.025*g.wheelDelta,g.wheelDeltaX&&(b.deltaX=-.025*g.wheelDeltaX)):b.deltaY=g.detail,y(b)};return s.push({element:m,fn:p}),p}function a(m){for(var y=0;y<s.length;y++)if(s[y].element===m)return s[y].fn;return function(){}}function c(m){for(var y=0;y<s.length;y++)if(s[y].element===m)return s.splice(y,1)}function h(m,y,p,g){var b;i==="wheel"?b=p:b=l(m,p),m[e](n+y,b,g?r:o)}function d(m,y,p,g){var b;i==="wheel"?b=p:b=a(m),m[t](n+y,b,g?r:o),c(m)}function u(m,y,p){h(m,i,y,p),i=="DOMMouseScroll"&&h(m,"MozMousePixelScroll",y,p)}function v(m,y,p){d(m,i,y,p),i=="DOMMouseScroll"&&d(m,"MozMousePixelScroll",y,p)}return{on:u,off:v}}(),Zt={extend:function(n,e){n=n||{};for(var t in e)this.isObject(e[t])?n[t]=this.extend(n[t],e[t]):n[t]=e[t];return n},isElement:function(n){return n instanceof HTMLElement||n instanceof SVGElement||n instanceof SVGSVGElement||n&&typeof n=="object"&&n!==null&&n.nodeType===1&&typeof n.nodeName=="string"},isObject:function(n){return Object.prototype.toString.call(n)==="[object Object]"},isNumber:function(n){return!isNaN(parseFloat(n))&&isFinite(n)},getSvg:function(n){var e,t;if(this.isElement(n))e=n;else if(typeof n=="string"||n instanceof String){if(e=document.querySelector(n),!e)throw new Error("Provided selector did not find any elements. Selector: "+n)}else throw new Error("Provided selector is not an HTML object nor String");if(e.tagName.toLowerCase()==="svg")t=e;else if(e.tagName.toLowerCase()==="object")t=e.contentDocument.documentElement;else if(e.tagName.toLowerCase()==="embed")t=e.getSVGDocument().documentElement;else throw e.tagName.toLowerCase()==="img"?new Error('Cannot script an SVG in an "img" element. Please use an "object" element or an in-line SVG.'):new Error("Cannot get SVG.");return t},proxy:function(n,e){return function(){return n.apply(e,arguments)}},getType:function(n){return Object.prototype.toString.apply(n).replace(/^\[object\s/,"").replace(/\]$/,"")},mouseAndTouchNormalize:function(n,e){if(n.clientX===void 0||n.clientX===null)if(n.clientX=0,n.clientY=0,n.touches!==void 0&&n.touches.length){if(n.touches[0].clientX!==void 0)n.clientX=n.touches[0].clientX,n.clientY=n.touches[0].clientY;else if(n.touches[0].pageX!==void 0){var t=e.getBoundingClientRect();n.clientX=n.touches[0].pageX-t.left,n.clientY=n.touches[0].pageY-t.top}}else n.originalEvent!==void 0&&n.originalEvent.clientX!==void 0&&(n.clientX=n.originalEvent.clientX,n.clientY=n.originalEvent.clientY)},isDblClick:function(n,e){if(n.detail===2)return!0;if(e!=null){var t=n.timeStamp-e.timeStamp,i=Math.sqrt(Math.pow(n.clientX-e.clientX,2)+Math.pow(n.clientY-e.clientY,2));return t<250&&i<10}return!1},now:Date.now||function(){return new Date().getTime()},throttle:function(n,e,t){var i=this,s,r,o,l=null,a=0;t||(t={});var c=function(){a=t.leading===!1?0:i.now(),l=null,o=n.apply(s,r),l||(s=r=null)};return function(){var h=i.now();!a&&t.leading===!1&&(a=h);var d=e-(h-a);return s=this,r=arguments,d<=0||d>e?(clearTimeout(l),l=null,a=h,o=n.apply(s,r),l||(s=r=null)):!l&&t.trailing!==!1&&(l=setTimeout(c,d)),o}},createRequestAnimationFrame:function(n){var e=null;return n!=="auto"&&n<60&&n>1&&(e=Math.floor(1e3/n)),e===null?window.requestAnimationFrame||Ni(33):Ni(e)}};function Ni(n){return function(e){window.setTimeout(e,n)}}var pt=Zt,gs="unknown";document.documentMode&&(gs="ie");var Vt={svgNS:"http://www.w3.org/2000/svg",xmlNS:"http://www.w3.org/XML/1998/namespace",xmlnsNS:"http://www.w3.org/2000/xmlns/",xlinkNS:"http://www.w3.org/1999/xlink",evNS:"http://www.w3.org/2001/xml-events",getBoundingClientRectNormalized:function(n){if(n.clientWidth&&n.clientHeight)return{width:n.clientWidth,height:n.clientHeight};if(n.getBoundingClientRect())return n.getBoundingClientRect();throw new Error("Cannot get BoundingClientRect for SVG.")},getOrCreateViewport:function(n,e){var t=null;if(pt.isElement(e)?t=e:t=n.querySelector(e),!t){var i=Array.prototype.slice.call(n.childNodes||n.children).filter(function(a){return a.nodeName!=="defs"&&a.nodeName!=="#text"});i.length===1&&i[0].nodeName==="g"&&i[0].getAttribute("transform")===null&&(t=i[0])}if(!t){var s="viewport-"+new Date().toISOString().replace(/\D/g,"");t=document.createElementNS(this.svgNS,"g"),t.setAttribute("id",s);var r=n.childNodes||n.children;if(r&&r.length>0)for(var o=r.length;o>0;o--)r[r.length-o].nodeName!=="defs"&&t.appendChild(r[r.length-o]);n.appendChild(t)}var l=[];return t.getAttribute("class")&&(l=t.getAttribute("class").split(" ")),~l.indexOf("svg-pan-zoom_viewport")||(l.push("svg-pan-zoom_viewport"),t.setAttribute("class",l.join(" "))),t},setupSvgAttributes:function(n){if(n.setAttribute("xmlns",this.svgNS),n.setAttributeNS(this.xmlnsNS,"xmlns:xlink",this.xlinkNS),n.setAttributeNS(this.xmlnsNS,"xmlns:ev",this.evNS),n.parentNode!==null){var e=n.getAttribute("style")||"";e.toLowerCase().indexOf("overflow")===-1&&n.setAttribute("style","overflow: hidden; "+e)}},internetExplorerRedisplayInterval:300,refreshDefsGlobal:pt.throttle(function(){for(var n=document.querySelectorAll("defs"),e=n.length,t=0;t<e;t++){var i=n[t];i.parentNode.insertBefore(i,i)}},Gt?Gt.internetExplorerRedisplayInterval:null),setCTM:function(n,e,t){var i=this,s="matrix("+e.a+","+e.b+","+e.c+","+e.d+","+e.e+","+e.f+")";n.setAttributeNS(null,"transform",s),"transform"in n.style?n.style.transform=s:"-ms-transform"in n.style?n.style["-ms-transform"]=s:"-webkit-transform"in n.style&&(n.style["-webkit-transform"]=s),gs==="ie"&&t&&(t.parentNode.insertBefore(t,t),window.setTimeout(function(){i.refreshDefsGlobal()},i.internetExplorerRedisplayInterval))},getEventPoint:function(n,e){var t=e.createSVGPoint();return pt.mouseAndTouchNormalize(n,e),t.x=n.clientX,t.y=n.clientY,t},getSvgCenterPoint:function(n,e,t){return this.createSVGPoint(n,e/2,t/2)},createSVGPoint:function(n,e,t){var i=n.createSVGPoint();return i.x=e,i.y=t,i}},I=Vt,On={enable:function(n){var e=n.svg.querySelector("defs");e||(e=document.createElementNS(I.svgNS,"defs"),n.svg.appendChild(e));var t=e.querySelector("style#svg-pan-zoom-controls-styles");if(!t){var i=document.createElementNS(I.svgNS,"style");i.setAttribute("id","svg-pan-zoom-controls-styles"),i.setAttribute("type","text/css"),i.textContent=".svg-pan-zoom-control { cursor: pointer; fill: black; fill-opacity: 0.333; } .svg-pan-zoom-control:hover { fill-opacity: 0.8; } .svg-pan-zoom-control-background { fill: white; fill-opacity: 0.5; } .svg-pan-zoom-control-background { fill-opacity: 0.8; }",e.appendChild(i)}var s=document.createElementNS(I.svgNS,"g");s.setAttribute("id","svg-pan-zoom-controls"),s.setAttribute("transform","translate("+(n.width-70)+" "+(n.height-76)+") scale(0.75)"),s.setAttribute("class","svg-pan-zoom-control"),s.appendChild(this._createZoomIn(n)),s.appendChild(this._createZoomReset(n)),s.appendChild(this._createZoomOut(n)),n.svg.appendChild(s),n.controlIcons=s},_createZoomIn:function(n){var e=document.createElementNS(I.svgNS,"g");e.setAttribute("id","svg-pan-zoom-zoom-in"),e.setAttribute("transform","translate(30.5 5) scale(0.015)"),e.setAttribute("class","svg-pan-zoom-control"),e.addEventListener("click",function(){n.getPublicInstance().zoomIn()},!1),e.addEventListener("touchstart",function(){n.getPublicInstance().zoomIn()},!1);var t=document.createElementNS(I.svgNS,"rect");t.setAttribute("x","0"),t.setAttribute("y","0"),t.setAttribute("width","1500"),t.setAttribute("height","1400"),t.setAttribute("class","svg-pan-zoom-control-background"),e.appendChild(t);var i=document.createElementNS(I.svgNS,"path");return i.setAttribute("d","M1280 576v128q0 26 -19 45t-45 19h-320v320q0 26 -19 45t-45 19h-128q-26 0 -45 -19t-19 -45v-320h-320q-26 0 -45 -19t-19 -45v-128q0 -26 19 -45t45 -19h320v-320q0 -26 19 -45t45 -19h128q26 0 45 19t19 45v320h320q26 0 45 19t19 45zM1536 1120v-960 q0 -119 -84.5 -203.5t-203.5 -84.5h-960q-119 0 -203.5 84.5t-84.5 203.5v960q0 119 84.5 203.5t203.5 84.5h960q119 0 203.5 -84.5t84.5 -203.5z"),i.setAttribute("class","svg-pan-zoom-control-element"),e.appendChild(i),e},_createZoomReset:function(n){var e=document.createElementNS(I.svgNS,"g");e.setAttribute("id","svg-pan-zoom-reset-pan-zoom"),e.setAttribute("transform","translate(5 35) scale(0.4)"),e.setAttribute("class","svg-pan-zoom-control"),e.addEventListener("click",function(){n.getPublicInstance().reset()},!1),e.addEventListener("touchstart",function(){n.getPublicInstance().reset()},!1);var t=document.createElementNS(I.svgNS,"rect");t.setAttribute("x","2"),t.setAttribute("y","2"),t.setAttribute("width","182"),t.setAttribute("height","58"),t.setAttribute("class","svg-pan-zoom-control-background"),e.appendChild(t);var i=document.createElementNS(I.svgNS,"path");i.setAttribute("d","M33.051,20.632c-0.742-0.406-1.854-0.609-3.338-0.609h-7.969v9.281h7.769c1.543,0,2.701-0.188,3.473-0.562c1.365-0.656,2.048-1.953,2.048-3.891C35.032,22.757,34.372,21.351,33.051,20.632z"),i.setAttribute("class","svg-pan-zoom-control-element"),e.appendChild(i);var s=document.createElementNS(I.svgNS,"path");return s.setAttribute("d","M170.231,0.5H15.847C7.102,0.5,0.5,5.708,0.5,11.84v38.861C0.5,56.833,7.102,61.5,15.847,61.5h154.384c8.745,0,15.269-4.667,15.269-10.798V11.84C185.5,5.708,178.976,0.5,170.231,0.5z M42.837,48.569h-7.969c-0.219-0.766-0.375-1.383-0.469-1.852c-0.188-0.969-0.289-1.961-0.305-2.977l-0.047-3.211c-0.03-2.203-0.41-3.672-1.142-4.406c-0.732-0.734-2.103-1.102-4.113-1.102h-7.05v13.547h-7.055V14.022h16.524c2.361,0.047,4.178,0.344,5.45,0.891c1.272,0.547,2.351,1.352,3.234,2.414c0.731,0.875,1.31,1.844,1.737,2.906s0.64,2.273,0.64,3.633c0,1.641-0.414,3.254-1.242,4.84s-2.195,2.707-4.102,3.363c1.594,0.641,2.723,1.551,3.387,2.73s0.996,2.98,0.996,5.402v2.32c0,1.578,0.063,2.648,0.19,3.211c0.19,0.891,0.635,1.547,1.333,1.969V48.569z M75.579,48.569h-26.18V14.022h25.336v6.117H56.454v7.336h16.781v6H56.454v8.883h19.125V48.569z M104.497,46.331c-2.44,2.086-5.887,3.129-10.34,3.129c-4.548,0-8.125-1.027-10.731-3.082s-3.909-4.879-3.909-8.473h6.891c0.224,1.578,0.662,2.758,1.316,3.539c1.196,1.422,3.246,2.133,6.15,2.133c1.739,0,3.151-0.188,4.236-0.562c2.058-0.719,3.087-2.055,3.087-4.008c0-1.141-0.504-2.023-1.512-2.648c-1.008-0.609-2.607-1.148-4.796-1.617l-3.74-0.82c-3.676-0.812-6.201-1.695-7.576-2.648c-2.328-1.594-3.492-4.086-3.492-7.477c0-3.094,1.139-5.664,3.417-7.711s5.623-3.07,10.036-3.07c3.685,0,6.829,0.965,9.431,2.895c2.602,1.93,3.966,4.73,4.093,8.402h-6.938c-0.128-2.078-1.057-3.555-2.787-4.43c-1.154-0.578-2.587-0.867-4.301-0.867c-1.907,0-3.428,0.375-4.565,1.125c-1.138,0.75-1.706,1.797-1.706,3.141c0,1.234,0.561,2.156,1.682,2.766c0.721,0.406,2.25,0.883,4.589,1.43l6.063,1.43c2.657,0.625,4.648,1.461,5.975,2.508c2.059,1.625,3.089,3.977,3.089,7.055C108.157,41.624,106.937,44.245,104.497,46.331z M139.61,48.569h-26.18V14.022h25.336v6.117h-18.281v7.336h16.781v6h-16.781v8.883h19.125V48.569z M170.337,20.14h-10.336v28.43h-7.266V20.14h-10.383v-6.117h27.984V20.14z"),s.setAttribute("class","svg-pan-zoom-control-element"),e.appendChild(s),e},_createZoomOut:function(n){var e=document.createElementNS(I.svgNS,"g");e.setAttribute("id","svg-pan-zoom-zoom-out"),e.setAttribute("transform","translate(30.5 70) scale(0.015)"),e.setAttribute("class","svg-pan-zoom-control"),e.addEventListener("click",function(){n.getPublicInstance().zoomOut()},!1),e.addEventListener("touchstart",function(){n.getPublicInstance().zoomOut()},!1);var t=document.createElementNS(I.svgNS,"rect");t.setAttribute("x","0"),t.setAttribute("y","0"),t.setAttribute("width","1500"),t.setAttribute("height","1400"),t.setAttribute("class","svg-pan-zoom-control-background"),e.appendChild(t);var i=document.createElementNS(I.svgNS,"path");return i.setAttribute("d","M1280 576v128q0 26 -19 45t-45 19h-896q-26 0 -45 -19t-19 -45v-128q0 -26 19 -45t45 -19h896q26 0 45 19t19 45zM1536 1120v-960q0 -119 -84.5 -203.5t-203.5 -84.5h-960q-119 0 -203.5 84.5t-84.5 203.5v960q0 119 84.5 203.5t203.5 84.5h960q119 0 203.5 -84.5 t84.5 -203.5z"),i.setAttribute("class","svg-pan-zoom-control-element"),e.appendChild(i),e},disable:function(n){n.controlIcons&&(n.controlIcons.parentNode.removeChild(n.controlIcons),n.controlIcons=null)}},Nn=Vt,J=Zt,A=function(n,e){this.init(n,e)};A.prototype.init=function(n,e){this.viewport=n,this.options=e,this.originalState={zoom:1,x:0,y:0},this.activeState={zoom:1,x:0,y:0},this.updateCTMCached=J.proxy(this.updateCTM,this),this.requestAnimationFrame=J.createRequestAnimationFrame(this.options.refreshRate),this.viewBox={x:0,y:0,width:0,height:0},this.cacheViewBox();var t=this.processCTM();this.setCTM(t),this.updateCTM()};A.prototype.cacheViewBox=function(){var n=this.options.svg.getAttribute("viewBox");if(n){var e=n.split(/[\s\,]/).filter(function(i){return i}).map(parseFloat);this.viewBox.x=e[0],this.viewBox.y=e[1],this.viewBox.width=e[2],this.viewBox.height=e[3];var t=Math.min(this.options.width/this.viewBox.width,this.options.height/this.viewBox.height);this.activeState.zoom=t,this.activeState.x=(this.options.width-this.viewBox.width*t)/2,this.activeState.y=(this.options.height-this.viewBox.height*t)/2,this.updateCTMOnNextFrame(),this.options.svg.removeAttribute("viewBox")}else this.simpleViewBoxCache()};A.prototype.simpleViewBoxCache=function(){var n=this.viewport.getBBox();this.viewBox.x=n.x,this.viewBox.y=n.y,this.viewBox.width=n.width,this.viewBox.height=n.height};A.prototype.getViewBox=function(){return J.extend({},this.viewBox)};A.prototype.processCTM=function(){var n=this.getCTM();if(this.options.fit||this.options.contain){var e;this.options.fit?e=Math.min(this.options.width/this.viewBox.width,this.options.height/this.viewBox.height):e=Math.max(this.options.width/this.viewBox.width,this.options.height/this.viewBox.height),n.a=e,n.d=e,n.e=-this.viewBox.x*e,n.f=-this.viewBox.y*e}if(this.options.center){var t=(this.options.width-(this.viewBox.width+this.viewBox.x*2)*n.a)*.5,i=(this.options.height-(this.viewBox.height+this.viewBox.y*2)*n.a)*.5;n.e=t,n.f=i}return this.originalState.zoom=n.a,this.originalState.x=n.e,this.originalState.y=n.f,n};A.prototype.getOriginalState=function(){return J.extend({},this.originalState)};A.prototype.getState=function(){return J.extend({},this.activeState)};A.prototype.getZoom=function(){return this.activeState.zoom};A.prototype.getRelativeZoom=function(){return this.activeState.zoom/this.originalState.zoom};A.prototype.computeRelativeZoom=function(n){return n/this.originalState.zoom};A.prototype.getPan=function(){return{x:this.activeState.x,y:this.activeState.y}};A.prototype.getCTM=function(){var n=this.options.svg.createSVGMatrix();return n.a=this.activeState.zoom,n.b=0,n.c=0,n.d=this.activeState.zoom,n.e=this.activeState.x,n.f=this.activeState.y,n};A.prototype.setCTM=function(n){var e=this.isZoomDifferent(n),t=this.isPanDifferent(n);if(e||t){if(e&&(this.options.beforeZoom(this.getRelativeZoom(),this.computeRelativeZoom(n.a))===!1?(n.a=n.d=this.activeState.zoom,e=!1):(this.updateCache(n),this.options.onZoom(this.getRelativeZoom()))),t){var i=this.options.beforePan(this.getPan(),{x:n.e,y:n.f}),s=!1,r=!1;i===!1?(n.e=this.getPan().x,n.f=this.getPan().y,s=r=!0):J.isObject(i)&&(i.x===!1?(n.e=this.getPan().x,s=!0):J.isNumber(i.x)&&(n.e=i.x),i.y===!1?(n.f=this.getPan().y,r=!0):J.isNumber(i.y)&&(n.f=i.y)),s&&r||!this.isPanDifferent(n)?t=!1:(this.updateCache(n),this.options.onPan(this.getPan()))}(e||t)&&this.updateCTMOnNextFrame()}};A.prototype.isZoomDifferent=function(n){return this.activeState.zoom!==n.a};A.prototype.isPanDifferent=function(n){return this.activeState.x!==n.e||this.activeState.y!==n.f};A.prototype.updateCache=function(n){this.activeState.zoom=n.a,this.activeState.x=n.e,this.activeState.y=n.f};A.prototype.pendingUpdate=!1;A.prototype.updateCTMOnNextFrame=function(){this.pendingUpdate||(this.pendingUpdate=!0,this.requestAnimationFrame.call(window,this.updateCTMCached))};A.prototype.updateCTM=function(){var n=this.getCTM();Nn.setCTM(this.viewport,n,this.defs),this.pendingUpdate=!1,this.options.onUpdatedCTM&&this.options.onUpdatedCTM(n)};var qn=function(n,e){return new A(n,e)},vs=Fn,It=On,F=Zt,O=Vt,Bn=qn,S=function(n,e){this.init(n,e)},Un={viewportSelector:".svg-pan-zoom_viewport",panEnabled:!0,controlIconsEnabled:!1,zoomEnabled:!0,dblClickZoomEnabled:!0,mouseWheelZoomEnabled:!0,preventMouseEventsDefault:!0,zoomScaleSensitivity:.1,minZoom:.5,maxZoom:10,fit:!0,contain:!1,center:!0,refreshRate:"auto",beforeZoom:null,onZoom:null,beforePan:null,onPan:null,customEventsHandler:null,eventsListenerElement:null,onUpdatedCTM:null},_s={passive:!0};S.prototype.init=function(n,e){var t=this;this.svg=n,this.defs=n.querySelector("defs"),O.setupSvgAttributes(this.svg),this.options=F.extend(F.extend({},Un),e),this.state="none";var i=O.getBoundingClientRectNormalized(n);this.width=i.width,this.height=i.height,this.viewport=Bn(O.getOrCreateViewport(this.svg,this.options.viewportSelector),{svg:this.svg,width:this.width,height:this.height,fit:this.options.fit,contain:this.options.contain,center:this.options.center,refreshRate:this.options.refreshRate,beforeZoom:function(r,o){if(t.viewport&&t.options.beforeZoom)return t.options.beforeZoom(r,o)},onZoom:function(r){if(t.viewport&&t.options.onZoom)return t.options.onZoom(r)},beforePan:function(r,o){if(t.viewport&&t.options.beforePan)return t.options.beforePan(r,o)},onPan:function(r){if(t.viewport&&t.options.onPan)return t.options.onPan(r)},onUpdatedCTM:function(r){if(t.viewport&&t.options.onUpdatedCTM)return t.options.onUpdatedCTM(r)}});var s=this.getPublicInstance();s.setBeforeZoom(this.options.beforeZoom),s.setOnZoom(this.options.onZoom),s.setBeforePan(this.options.beforePan),s.setOnPan(this.options.onPan),s.setOnUpdatedCTM(this.options.onUpdatedCTM),this.options.controlIconsEnabled&&It.enable(this),this.lastMouseWheelEventTime=Date.now(),this.setupHandlers()};S.prototype.setupHandlers=function(){var n=this,e=null;if(this.eventListeners={mousedown:function(r){var o=n.handleMouseDown(r,e);return e=r,o},touchstart:function(r){var o=n.handleMouseDown(r,e);return e=r,o},mouseup:function(r){return n.handleMouseUp(r)},touchend:function(r){return n.handleMouseUp(r)},mousemove:function(r){return n.handleMouseMove(r)},touchmove:function(r){return n.handleMouseMove(r)},mouseleave:function(r){return n.handleMouseUp(r)},touchleave:function(r){return n.handleMouseUp(r)},touchcancel:function(r){return n.handleMouseUp(r)}},this.options.customEventsHandler!=null){this.options.customEventsHandler.init({svgElement:this.svg,eventsListenerElement:this.options.eventsListenerElement,instance:this.getPublicInstance()});var t=this.options.customEventsHandler.haltEventListeners;if(t&&t.length)for(var i=t.length-1;i>=0;i--)this.eventListeners.hasOwnProperty(t[i])&&delete this.eventListeners[t[i]]}for(var s in this.eventListeners)(this.options.eventsListenerElement||this.svg).addEventListener(s,this.eventListeners[s],this.options.preventMouseEventsDefault?!1:_s);this.options.mouseWheelZoomEnabled&&(this.options.mouseWheelZoomEnabled=!1,this.enableMouseWheelZoom())};S.prototype.enableMouseWheelZoom=function(){if(!this.options.mouseWheelZoomEnabled){var n=this;this.wheelListener=function(t){return n.handleMouseWheel(t)};var e=!this.options.preventMouseEventsDefault;vs.on(this.options.eventsListenerElement||this.svg,this.wheelListener,e),this.options.mouseWheelZoomEnabled=!0}};S.prototype.disableMouseWheelZoom=function(){if(this.options.mouseWheelZoomEnabled){var n=!this.options.preventMouseEventsDefault;vs.off(this.options.eventsListenerElement||this.svg,this.wheelListener,n),this.options.mouseWheelZoomEnabled=!1}};S.prototype.handleMouseWheel=function(n){if(!(!this.options.zoomEnabled||this.state!=="none")){this.options.preventMouseEventsDefault&&(n.preventDefault?n.preventDefault():n.returnValue=!1);var e=n.deltaY||1,t=Date.now()-this.lastMouseWheelEventTime,i=3+Math.max(0,30-t);this.lastMouseWheelEventTime=Date.now(),"deltaMode"in n&&n.deltaMode===0&&n.wheelDelta&&(e=n.deltaY===0?0:Math.abs(n.wheelDelta)/n.deltaY),e=-.3<e&&e<.3?e:(e>0?1:-1)*Math.log(Math.abs(e)+10)/i;var s=this.svg.getScreenCTM().inverse(),r=O.getEventPoint(n,this.svg).matrixTransform(s),o=Math.pow(1+this.options.zoomScaleSensitivity,-1*e);this.zoomAtPoint(o,r)}};S.prototype.zoomAtPoint=function(n,e,t){var i=this.viewport.getOriginalState();t?(n=Math.max(this.options.minZoom*i.zoom,Math.min(this.options.maxZoom*i.zoom,n)),n=n/this.getZoom()):this.getZoom()*n<this.options.minZoom*i.zoom?n=this.options.minZoom*i.zoom/this.getZoom():this.getZoom()*n>this.options.maxZoom*i.zoom&&(n=this.options.maxZoom*i.zoom/this.getZoom());var s=this.viewport.getCTM(),r=e.matrixTransform(s.inverse()),o=this.svg.createSVGMatrix().translate(r.x,r.y).scale(n).translate(-r.x,-r.y),l=s.multiply(o);l.a!==s.a&&this.viewport.setCTM(l)};S.prototype.zoom=function(n,e){this.zoomAtPoint(n,O.getSvgCenterPoint(this.svg,this.width,this.height),e)};S.prototype.publicZoom=function(n,e){e&&(n=this.computeFromRelativeZoom(n)),this.zoom(n,e)};S.prototype.publicZoomAtPoint=function(n,e,t){if(t&&(n=this.computeFromRelativeZoom(n)),F.getType(e)!=="SVGPoint")if("x"in e&&"y"in e)e=O.createSVGPoint(this.svg,e.x,e.y);else throw new Error("Given point is invalid");this.zoomAtPoint(n,e,t)};S.prototype.getZoom=function(){return this.viewport.getZoom()};S.prototype.getRelativeZoom=function(){return this.viewport.getRelativeZoom()};S.prototype.computeFromRelativeZoom=function(n){return n*this.viewport.getOriginalState().zoom};S.prototype.resetZoom=function(){var n=this.viewport.getOriginalState();this.zoom(n.zoom,!0)};S.prototype.resetPan=function(){this.pan(this.viewport.getOriginalState())};S.prototype.reset=function(){this.resetZoom(),this.resetPan()};S.prototype.handleDblClick=function(n){if(this.options.preventMouseEventsDefault&&(n.preventDefault?n.preventDefault():n.returnValue=!1),this.options.controlIconsEnabled){var e=n.target.getAttribute("class")||"";if(e.indexOf("svg-pan-zoom-control")>-1)return!1}var t;n.shiftKey?t=1/((1+this.options.zoomScaleSensitivity)*2):t=(1+this.options.zoomScaleSensitivity)*2;var i=O.getEventPoint(n,this.svg).matrixTransform(this.svg.getScreenCTM().inverse());this.zoomAtPoint(t,i)};S.prototype.handleMouseDown=function(n,e){this.options.preventMouseEventsDefault&&(n.preventDefault?n.preventDefault():n.returnValue=!1),F.mouseAndTouchNormalize(n,this.svg),this.options.dblClickZoomEnabled&&F.isDblClick(n,e)?this.handleDblClick(n):(this.state="pan",this.firstEventCTM=this.viewport.getCTM(),this.stateOrigin=O.getEventPoint(n,this.svg).matrixTransform(this.firstEventCTM.inverse()))};S.prototype.handleMouseMove=function(n){if(this.options.preventMouseEventsDefault&&(n.preventDefault?n.preventDefault():n.returnValue=!1),this.state==="pan"&&this.options.panEnabled){var e=O.getEventPoint(n,this.svg).matrixTransform(this.firstEventCTM.inverse()),t=this.firstEventCTM.translate(e.x-this.stateOrigin.x,e.y-this.stateOrigin.y);this.viewport.setCTM(t)}};S.prototype.handleMouseUp=function(n){this.options.preventMouseEventsDefault&&(n.preventDefault?n.preventDefault():n.returnValue=!1),this.state==="pan"&&(this.state="none")};S.prototype.fit=function(){var n=this.viewport.getViewBox(),e=Math.min(this.width/n.width,this.height/n.height);this.zoom(e,!0)};S.prototype.contain=function(){var n=this.viewport.getViewBox(),e=Math.max(this.width/n.width,this.height/n.height);this.zoom(e,!0)};S.prototype.center=function(){var n=this.viewport.getViewBox(),e=(this.width-(n.width+n.x*2)*this.getZoom())*.5,t=(this.height-(n.height+n.y*2)*this.getZoom())*.5;this.getPublicInstance().pan({x:e,y:t})};S.prototype.updateBBox=function(){this.viewport.simpleViewBoxCache()};S.prototype.pan=function(n){var e=this.viewport.getCTM();e.e=n.x,e.f=n.y,this.viewport.setCTM(e)};S.prototype.panBy=function(n){var e=this.viewport.getCTM();e.e+=n.x,e.f+=n.y,this.viewport.setCTM(e)};S.prototype.getPan=function(){var n=this.viewport.getState();return{x:n.x,y:n.y}};S.prototype.resize=function(){var n=O.getBoundingClientRectNormalized(this.svg);this.width=n.width,this.height=n.height;var e=this.viewport;e.options.width=this.width,e.options.height=this.height,e.processCTM(),this.options.controlIconsEnabled&&(this.getPublicInstance().disableControlIcons(),this.getPublicInstance().enableControlIcons())};S.prototype.destroy=function(){var n=this;this.beforeZoom=null,this.onZoom=null,this.beforePan=null,this.onPan=null,this.onUpdatedCTM=null,this.options.customEventsHandler!=null&&this.options.customEventsHandler.destroy({svgElement:this.svg,eventsListenerElement:this.options.eventsListenerElement,instance:this.getPublicInstance()});for(var e in this.eventListeners)(this.options.eventsListenerElement||this.svg).removeEventListener(e,this.eventListeners[e],this.options.preventMouseEventsDefault?!1:_s);this.disableMouseWheelZoom(),this.getPublicInstance().disableControlIcons(),this.reset(),V=V.filter(function(t){return t.svg!==n.svg}),delete this.options,delete this.viewport,delete this.publicInstance,delete this.pi,this.getPublicInstance=function(){return null}};S.prototype.getPublicInstance=function(){var n=this;return this.publicInstance||(this.publicInstance=this.pi={enablePan:function(){return n.options.panEnabled=!0,n.pi},disablePan:function(){return n.options.panEnabled=!1,n.pi},isPanEnabled:function(){return!!n.options.panEnabled},pan:function(e){return n.pan(e),n.pi},panBy:function(e){return n.panBy(e),n.pi},getPan:function(){return n.getPan()},setBeforePan:function(e){return n.options.beforePan=e===null?null:F.proxy(e,n.publicInstance),n.pi},setOnPan:function(e){return n.options.onPan=e===null?null:F.proxy(e,n.publicInstance),n.pi},enableZoom:function(){return n.options.zoomEnabled=!0,n.pi},disableZoom:function(){return n.options.zoomEnabled=!1,n.pi},isZoomEnabled:function(){return!!n.options.zoomEnabled},enableControlIcons:function(){return n.options.controlIconsEnabled||(n.options.controlIconsEnabled=!0,It.enable(n)),n.pi},disableControlIcons:function(){return n.options.controlIconsEnabled&&(n.options.controlIconsEnabled=!1,It.disable(n)),n.pi},isControlIconsEnabled:function(){return!!n.options.controlIconsEnabled},enableDblClickZoom:function(){return n.options.dblClickZoomEnabled=!0,n.pi},disableDblClickZoom:function(){return n.options.dblClickZoomEnabled=!1,n.pi},isDblClickZoomEnabled:function(){return!!n.options.dblClickZoomEnabled},enableMouseWheelZoom:function(){return n.enableMouseWheelZoom(),n.pi},disableMouseWheelZoom:function(){return n.disableMouseWheelZoom(),n.pi},isMouseWheelZoomEnabled:function(){return!!n.options.mouseWheelZoomEnabled},setZoomScaleSensitivity:function(e){return n.options.zoomScaleSensitivity=e,n.pi},setMinZoom:function(e){return n.options.minZoom=e,n.pi},setMaxZoom:function(e){return n.options.maxZoom=e,n.pi},setBeforeZoom:function(e){return n.options.beforeZoom=e===null?null:F.proxy(e,n.publicInstance),n.pi},setOnZoom:function(e){return n.options.onZoom=e===null?null:F.proxy(e,n.publicInstance),n.pi},zoom:function(e){return n.publicZoom(e,!0),n.pi},zoomBy:function(e){return n.publicZoom(e,!1),n.pi},zoomAtPoint:function(e,t){return n.publicZoomAtPoint(e,t,!0),n.pi},zoomAtPointBy:function(e,t){return n.publicZoomAtPoint(e,t,!1),n.pi},zoomIn:function(){return this.zoomBy(1+n.options.zoomScaleSensitivity),n.pi},zoomOut:function(){return this.zoomBy(1/(1+n.options.zoomScaleSensitivity)),n.pi},getZoom:function(){return n.getRelativeZoom()},setOnUpdatedCTM:function(e){return n.options.onUpdatedCTM=e===null?null:F.proxy(e,n.publicInstance),n.pi},resetZoom:function(){return n.resetZoom(),n.pi},resetPan:function(){return n.resetPan(),n.pi},reset:function(){return n.reset(),n.pi},fit:function(){return n.fit(),n.pi},contain:function(){return n.contain(),n.pi},center:function(){return n.center(),n.pi},updateBBox:function(){return n.updateBBox(),n.pi},resize:function(){return n.resize(),n.pi},getSizes:function(){return{width:n.width,height:n.height,realZoom:n.getZoom(),viewBox:n.viewport.getViewBox()}},destroy:function(){return n.destroy(),n.pi}}),this.publicInstance};var V=[],Hn=function(n,e){var t=F.getSvg(n);if(t===null)return null;for(var i=V.length-1;i>=0;i--)if(V[i].svg===t)return V[i].instance.getPublicInstance();return V.push({svg:t,instance:new S(t,e)}),V[V.length-1].instance.getPublicInstance()},jn=Hn;const qi=As(jn),Zn=6,Vn=.1,Wn=40,Xn=.002,q="svg-editor-handle",ut="svg-editor-handles";function te(n){switch(n.tagName.toLowerCase()){case"rect":return{drag:!0,endpoints:!1,resize:!0};case"circle":return{drag:!0,endpoints:!1,resize:!0};case"ellipse":return{drag:!0,endpoints:!1,resize:!0};case"line":return{drag:!0,endpoints:!0,resize:!1};case"polyline":case"polygon":return{drag:!0,endpoints:!0,resize:!1};case"path":return{drag:!0,endpoints:!0,resize:!1};case"text":return{drag:!0,endpoints:!1,resize:!1};case"g":case"image":case"use":case"foreignobject":return{drag:!0,endpoints:!1,resize:!1};default:return{drag:!1,endpoints:!1,resize:!1}}}function Bi(n){const e=[],t=/([MLHVCSQTAZmlhvcsqtaz])\s*([-\d.,eE\s]*)/g;let i;for(;(i=t.exec(n))!==null;){const s=i[1],r=i[2].trim(),o=r.length>0?r.split(/[\s,]+/).map(Number):[];e.push({cmd:s,args:o})}return e}function Yn(n){return n.map(e=>e.args.length===0?e.cmd:e.cmd+" "+e.args.map(t=>Math.round(t*1e3)/1e3).join(" ")).join(" ")}function Kn(n){const e=[];let t=0,i=0,s=0,r=0;for(let o=0;o<n.length;o++){const{cmd:l,args:a}=n[o],c=l.toUpperCase(),h=l!==c;if(c==="M"){const d=h?t+a[0]:a[0],u=h?i+a[1]:a[1];e.push({x:d,y:u,cmdIndex:o,argIndex:0,type:"endpoint"}),t=d,i=u,s=d,r=u}else if(c==="L"){const d=h?t+a[0]:a[0],u=h?i+a[1]:a[1];e.push({x:d,y:u,cmdIndex:o,argIndex:0,type:"endpoint"}),t=d,i=u}else if(c==="H"){const d=h?t+a[0]:a[0];e.push({x:d,y:i,cmdIndex:o,argIndex:0,type:"endpoint"}),t=d}else if(c==="V"){const d=h?i+a[0]:a[0];e.push({x:t,y:d,cmdIndex:o,argIndex:0,type:"endpoint"}),i=d}else if(c==="Q"){const d=h?t+a[0]:a[0],u=h?i+a[1]:a[1],v=h?t+a[2]:a[2],m=h?i+a[3]:a[3];e.push({x:d,y:u,cmdIndex:o,argIndex:0,type:"control"}),e.push({x:v,y:m,cmdIndex:o,argIndex:2,type:"endpoint"}),t=v,i=m}else if(c==="C"){const d=h?t+a[0]:a[0],u=h?i+a[1]:a[1],v=h?t+a[2]:a[2],m=h?i+a[3]:a[3],y=h?t+a[4]:a[4],p=h?i+a[5]:a[5];e.push({x:d,y:u,cmdIndex:o,argIndex:0,type:"control"}),e.push({x:v,y:m,cmdIndex:o,argIndex:2,type:"control"}),e.push({x:y,y:p,cmdIndex:o,argIndex:4,type:"endpoint"}),t=y,i=p}else if(c==="S"){const d=h?t+a[0]:a[0],u=h?i+a[1]:a[1],v=h?t+a[2]:a[2],m=h?i+a[3]:a[3];e.push({x:d,y:u,cmdIndex:o,argIndex:0,type:"control"}),e.push({x:v,y:m,cmdIndex:o,argIndex:2,type:"endpoint"}),t=v,i=m}else if(c==="T"){const d=h?t+a[0]:a[0],u=h?i+a[1]:a[1];e.push({x:d,y:u,cmdIndex:o,argIndex:0,type:"endpoint"}),t=d,i=u}else if(c==="A"){const d=h?t+a[5]:a[5],u=h?i+a[6]:a[6];e.push({x:d,y:u,cmdIndex:o,argIndex:5,type:"endpoint"}),t=d,i=u}else c==="Z"&&(t=s,i=r)}return e}function we(n){const t=(n.getAttribute("transform")||"").match(/translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/);return t?{tx:parseFloat(t[1]),ty:parseFloat(t[2])}:{tx:0,ty:0}}function je(n,e,t){let i=n.getAttribute("transform")||"";const s=`translate(${e}, ${t})`;/translate\(/.test(i)?i=i.replace(/translate\(\s*[-\d.e]+[\s,]+[-\d.e]+\s*\)/,s):i=i?`${s} ${i}`:s,n.setAttribute("transform",i)}function Se(n){const e=n.getAttribute("points")||"",t=[],i=e.trim().split(/\s+/);for(const s of i){const[r,o]=s.split(",").map(Number);!isNaN(r)&&!isNaN(o)&&t.push({x:r,y:o})}return t}function Ze(n){return n.map(e=>`${e.x},${e.y}`).join(" ")}function x(n,e){return parseFloat(n.getAttribute(e))||0}class Gn{constructor(e,{onDirty:t,onSelect:i,onDeselect:s,onZoom:r}={}){this._svg=e,this._onDirty=t||(()=>{}),this._onSelect=i||(()=>{}),this._onDeselect=s||(()=>{}),this._onZoom=r||(()=>{}),this._selected=null,this._multiSelected=new Set,this._dragState=null,this._handleGroup=null,this._dirty=!1,this._clipboard=null,this._zoomLevel=1,this._panX=0,this._panY=0,this._isPanning=!1,this._panStart=null,this._marqueeRect=null,this._marqueeStart=null,this._marqueeActive=!1,this._textEditEl=null,this._textEditOverlay=null,this._onPointerDown=this._onPointerDown.bind(this),this._onPointerMove=this._onPointerMove.bind(this),this._onPointerUp=this._onPointerUp.bind(this),this._onKeyDown=this._onKeyDown.bind(this),this._onWheel=this._onWheel.bind(this),this._onPointerMoveHover=this._onPointerMoveHover.bind(this),this._onDblClick=this._onDblClick.bind(this),this._svg.addEventListener("pointerdown",this._onPointerDown),this._svg.addEventListener("dblclick",this._onDblClick),this._svg.addEventListener("wheel",this._onWheel,{passive:!1}),this._svg.addEventListener("pointermove",this._onPointerMoveHover),window.addEventListener("pointermove",this._onPointerMove),window.addEventListener("pointerup",this._onPointerUp),window.addEventListener("keydown",this._onKeyDown),this._svg.style.touchAction="none",this._origViewBox=this._getViewBox()}dispose(){this._commitTextEdit(),this._cancelMarquee(),this._removeHandles(),this._svg.removeEventListener("pointerdown",this._onPointerDown),this._svg.removeEventListener("dblclick",this._onDblClick),this._svg.removeEventListener("wheel",this._onWheel),this._svg.removeEventListener("pointermove",this._onPointerMoveHover),window.removeEventListener("pointermove",this._onPointerMove),window.removeEventListener("pointerup",this._onPointerUp),window.removeEventListener("keydown",this._onKeyDown),this._svg.style.cursor="",this._selected=null,this._multiSelected.clear(),this._dragState=null}get isDirty(){return this._dirty}get selectedElement(){return this._selected}getContent(){this._commitTextEdit(),this._removeHandles();const e=this._svg.outerHTML;return(this._selected||this._multiSelected.size>0)&&this._renderHandles(),e}_screenToSvg(e,t){const i=this._svg.getScreenCTM();if(!i)return{x:e,y:t};const s=i.inverse(),r=this._svg.createSVGPoint();r.x=e,r.y=t;const o=r.matrixTransform(s);return{x:o.x,y:o.y}}_screenDistToSvgDist(e){const t=this._screenToSvg(0,0),i=this._screenToSvg(e,0);return Math.abs(i.x-t.x)}_getViewBox(){const e=this._svg.getAttribute("viewBox");if(!e)return{x:0,y:0,w:800,h:600};const t=e.split(/[\s,]+/).map(Number);return{x:t[0]||0,y:t[1]||0,w:t[2]||800,h:t[3]||600}}_setViewBox(e,t,i,s){this._svg.setAttribute("viewBox",`${e} ${t} ${i} ${s}`)}get zoomLevel(){return this._zoomLevel}get viewBox(){return this._getViewBox()}setViewBox(e,t,i,s){this._setViewBox(e,t,i,s),this._origViewBox.w>0&&(this._zoomLevel=this._origViewBox.w/i)}_onWheel(e){e.preventDefault(),e.stopPropagation();const t=-e.deltaY*Xn,i=this._zoomLevel,s=Math.min(Wn,Math.max(Vn,i*(1+t))),r=i/s,o=this._screenToSvg(e.clientX,e.clientY),l=this._getViewBox(),a=l.w*r,c=l.h*r,h=o.x-(o.x-l.x)*r,d=o.y-(o.y-l.y)*r;this._setViewBox(h,d,a,c),this._zoomLevel=s,this._updateHandles(),this._onZoom({zoom:s,viewBox:{x:h,y:d,w:a,h:c}})}_onPointerMoveHover(e){if(this._dragState||this._isPanning)return;const t=e.clientX,i=e.clientY;if(this._selected){const r=this._hitTestHandle(t,i);if(r){if(r.type==="endpoint")this._svg.style.cursor="crosshair";else if(r.type==="resize-corner"){const o=["nwse-resize","nesw-resize","nwse-resize","nesw-resize"];this._svg.style.cursor=o[r.index]||"nwse-resize"}else if(r.type==="resize-edge"){const o=["ew-resize","ns-resize","ew-resize","ns-resize"];this._svg.style.cursor=o[r.index]||"ew-resize"}return}}const s=this._hitTest(t,i);if(s){if(this._multiSelected.size>1&&this._multiSelected.has(s)){this._svg.style.cursor="move";return}const r=te(s);r.endpoints?this._svg.style.cursor="pointer":r.resize?this._svg.style.cursor="move":r.drag?this._svg.style.cursor="grab":this._svg.style.cursor="default"}else this._svg.style.cursor="default"}_hitTest(e,t){const i=this._svg.getRootNode(),s=i.elementsFromPoint?i.elementsFromPoint(e,t):document.elementsFromPoint(e,t);for(const r of s){if(r.classList&&r.classList.contains(q)||r===this._svg)continue;const o=r.tagName.toLowerCase();if(["defs","style","metadata","title","desc","filter","lineargradient","radialgradient","clippath","mask","marker","pattern","symbol","femerge","femergenode","fegaussianblur","fedropshadow","stop"].includes(o)||!this._svg.contains(r))continue;if(te(r).drag)return r}return null}_hitTestHandle(e,t){const i=this._svg.getRootNode(),s=i.elementsFromPoint?i.elementsFromPoint(e,t):document.elementsFromPoint(e,t);for(const r of s)if(r.classList&&r.classList.contains(q))return{type:r.dataset.handleType,index:parseInt(r.dataset.handleIndex,10)};return null}_onPointerDown(e){if(e.button===1){e.preventDefault(),e.stopPropagation(),this._isPanning=!0,this._panStart={screenX:e.clientX,screenY:e.clientY,vb:this._getViewBox()},this._svg.style.cursor="grabbing";return}if(e.button!==0)return;const t=e.clientX,i=e.clientY,s=this._screenToSvg(t,i),r=e.shiftKey;if(this._selected&&!r&&this._multiSelected.size<=1){const c=this._hitTestHandle(t,i);if(c){e.preventDefault(),e.stopPropagation(),this._startHandleDrag(c,s,t,i);return}}this._textEditEl&&this._commitTextEdit();const o=this._hitTest(t,i);if(!o){if(r){e.preventDefault(),e.stopPropagation(),this._startMarquee(s);return}this._deselect();return}if(e.preventDefault(),e.stopPropagation(),r){if(this._multiSelected.has(o)){if(this._multiSelected.delete(o),this._selected===o){const c=[...this._multiSelected];this._selected=c.length>0?c[c.length-1]:null}if(this._multiSelected.size===0){this._deselect();return}this._renderHandles(),this._onSelect(this._selected)}else this._selected||(this._selected=o),this._multiSelected.add(o),this._renderHandles(),this._onSelect(this._selected);this._multiSelected.has(o)&&this._multiSelected.size>1&&(this._svg.style.cursor="grabbing",this._startMultiDrag(s));return}this._select(o),this._svg.style.cursor="grabbing";const l=te(o),a=o.tagName.toLowerCase();a==="line"&&l.endpoints?this._startLineDrag(o,s):(a==="polyline"||a==="polygon")&&l.endpoints?this._startPolyDrag(o,s):a==="path"&&l.endpoints?this._startPathDrag(o,s):l.drag&&(this._multiSelected.size>1&&this._multiSelected.has(o)?this._startMultiDrag(s):this._startElementDrag(o,s))}_onPointerMove(e){if(this._marqueeActive){e.preventDefault();const r=this._screenToSvg(e.clientX,e.clientY);this._updateMarquee(r);return}if(this._isPanning&&this._panStart){e.preventDefault();const r=e.clientX-this._panStart.screenX,o=e.clientY-this._panStart.screenY,l=this._panStart.vb,a=this._svg.getBoundingClientRect(),c=l.w/a.width,h=l.h/a.height;this._setViewBox(l.x-r*c,l.y-o*h,l.w,l.h),this._updateHandles(),this._onZoom({zoom:this._zoomLevel,viewBox:this._getViewBox()});return}if(!this._dragState)return;e.preventDefault();const t=this._screenToSvg(e.clientX,e.clientY),i=t.x-this._dragState.startSvg.x,s=t.y-this._dragState.startSvg.y;switch(this._dragState.mode){case"translate":this._applyTranslate(i,s);break;case"multi-translate":this._applyMultiTranslate(i,s);break;case"line-whole":this._applyLineWhole(i,s);break;case"line-endpoint":this._applyLineEndpoint(t);break;case"poly-whole":this._applyPolyWhole(i,s);break;case"poly-vertex":this._applyPolyVertex(t);break;case"resize":this._applyResize(t);break;case"path-point":this._applyPathPoint(t);break}this._updateHandles()}_onPointerUp(e){if(this._marqueeActive){const r=this._screenToSvg(e.clientX,e.clientY);this._finishMarquee(r);return}if(this._isPanning){this._isPanning=!1,this._panStart=null,this._svg.style.cursor="";return}if(!this._dragState)return;const t=this._screenToSvg(e.clientX,e.clientY),i=Math.abs(t.x-this._dragState.startSvg.x),s=Math.abs(t.y-this._dragState.startSvg.y);(i>.5||s>.5)&&this._markDirty(),this._dragState=null,this._svg.style.cursor=""}_onKeyDown(e){if(e.key==="Escape"){this._marqueeActive?this._cancelMarquee():this._textEditEl?this._commitTextEdit():(this._selected||this._multiSelected.size>0)&&this._deselect();return}if(this._textEditEl)return;const t=e.ctrlKey||e.metaKey,i=this._selected||this._multiSelected.size>0;t&&e.key==="c"&&i?(e.preventDefault(),this._copySelected()):t&&e.key==="v"&&this._clipboard&&this._clipboard.length>0?(e.preventDefault(),this._pasteClipboard()):t&&e.key==="d"&&i?(e.preventDefault(),this._copySelected(),this._pasteClipboard()):(e.key==="Delete"||e.key==="Backspace")&&i&&(e.preventDefault(),this._deleteSelected())}_copySelected(){this._multiSelected.size!==0&&(this._removeHandles(),this._clipboard=[...this._multiSelected].map(e=>e.cloneNode(!0)),this._renderHandles())}_pasteClipboard(){if(!this._clipboard||this._clipboard.length===0)return;const e=this._screenDistToSvgDist(15),t=[];for(const i of this._clipboard){const s=i.cloneNode(!0),r=s.tagName.toLowerCase();if(r==="rect"||r==="text"||r==="image"||r==="foreignobject")s.setAttribute("x",x(s,"x")+e),s.setAttribute("y",x(s,"y")+e);else if(r==="circle"||r==="ellipse")s.setAttribute("cx",x(s,"cx")+e),s.setAttribute("cy",x(s,"cy")+e);else if(r==="line")s.setAttribute("x1",x(s,"x1")+e),s.setAttribute("y1",x(s,"y1")+e),s.setAttribute("x2",x(s,"x2")+e),s.setAttribute("y2",x(s,"y2")+e);else if(r==="polyline"||r==="polygon"){const l=Se(s).map(a=>({x:a.x+e,y:a.y+e}));s.setAttribute("points",Ze(l))}else if(r==="path"){const{tx:o,ty:l}=we(s);je(s,o+e,l+e)}else{const{tx:o,ty:l}=we(s);je(s,o+e,l+e)}this._svg.appendChild(s),t.push(s)}this._deselect(),t.length>0&&(this._selected=t[t.length-1],this._multiSelected=new Set(t),this._renderHandles(),this._onSelect(this._selected)),this._markDirty()}_deleteSelected(){if(this._multiSelected.size===0)return;const e=[...this._multiSelected];this._deselect();for(const t of e)t.remove();this._markDirty()}_onDblClick(e){const t=e.clientX,i=e.clientY,s=this._hitTest(t,i);if(!s)return;s.tagName.toLowerCase()==="text"&&(e.preventDefault(),e.stopPropagation(),this._select(s),this._startTextEdit(s))}_startTextEdit(e){this._commitTextEdit(),this._textEditEl=e;let t;try{t=e.getBBox()}catch{return}const i="http://www.w3.org/2000/svg",s="http://www.w3.org/1999/xhtml",r=4,o=document.createElementNS(i,"foreignObject");o.setAttribute("x",t.x-r),o.setAttribute("y",t.y-r),o.setAttribute("width",Math.max(t.width+r*4,60)),o.setAttribute("height",t.height+r*2),o.classList.add(q),o.dataset.handleType="text-edit",o.dataset.handleIndex="0";const l=document.createElementNS(s,"div");l.setAttribute("contenteditable","true"),l.setAttribute("xmlns",s);const a=window.getComputedStyle(e),c=a.fontSize||"16px",h=a.fontFamily||"sans-serif",d=a.fill||e.getAttribute("fill")||"#000";Object.assign(l.style,{fontSize:c,fontFamily:h,color:d==="none"?"#000":d,background:"rgba(30, 30, 30, 0.85)",border:"1px solid #4fc3f7",borderRadius:"2px",padding:`${r}px`,margin:"0",outline:"none",whiteSpace:"pre",minWidth:"40px",lineHeight:"normal",boxSizing:"border-box",width:"100%",height:"100%",overflow:"hidden"}),l.textContent=e.textContent,o.appendChild(l),this._svg.appendChild(o),this._textEditOverlay=o,e.style.opacity="0",requestAnimationFrame(()=>{l.focus();const u=document.createRange();u.selectNodeContents(l);const v=window.getSelection();v.removeAllRanges(),v.addRange(u)}),l.addEventListener("blur",()=>this._commitTextEdit()),l.addEventListener("pointerdown",u=>u.stopPropagation()),l.addEventListener("keydown",u=>{u.key==="Enter"&&!u.shiftKey&&(u.preventDefault(),this._commitTextEdit()),u.key==="Escape"&&(u.preventDefault(),this._cancelTextEdit()),u.stopPropagation()})}_commitTextEdit(){if(!this._textEditEl||!this._textEditOverlay)return;const e=this._textEditOverlay.querySelector("div"),t=e?e.textContent:"",i=this._textEditEl.textContent;this._textEditEl.style.opacity="",t!==i&&(this._textEditEl.textContent=t,this._markDirty()),this._textEditOverlay.remove(),this._textEditOverlay=null,this._textEditEl=null,this._updateHandles()}_cancelTextEdit(){!this._textEditEl||!this._textEditOverlay||(this._textEditEl.style.opacity="",this._textEditOverlay.remove(),this._textEditOverlay=null,this._textEditEl=null)}_startMarquee(e){this._marqueeStart={x:e.x,y:e.y},this._marqueeActive=!0;const i=document.createElementNS("http://www.w3.org/2000/svg","rect");i.setAttribute("x",e.x),i.setAttribute("y",e.y),i.setAttribute("width",0),i.setAttribute("height",0),i.setAttribute("fill","rgba(79, 195, 247, 0.1)");const s=this._screenDistToSvgDist(1),r=this._screenDistToSvgDist(4),o=this._screenDistToSvgDist(3);i.setAttribute("stroke","#4fc3f7"),i.setAttribute("stroke-width",s),i.setAttribute("stroke-dasharray",`${r} ${o}`),i.setAttribute("pointer-events","none"),i.classList.add(q),i.dataset.handleType="marquee",i.dataset.handleIndex="0",this._svg.appendChild(i),this._marqueeRect=i,this._svg.style.cursor="crosshair"}_updateMarquee(e){if(!this._marqueeRect||!this._marqueeStart)return;const t=Math.min(this._marqueeStart.x,e.x),i=Math.min(this._marqueeStart.y,e.y),s=Math.abs(e.x-this._marqueeStart.x),r=Math.abs(e.y-this._marqueeStart.y);this._marqueeRect.setAttribute("x",t),this._marqueeRect.setAttribute("y",i),this._marqueeRect.setAttribute("width",s),this._marqueeRect.setAttribute("height",r)}_finishMarquee(e){const t=this._marqueeStart;if(!t){this._cancelMarquee();return}const i=Math.min(t.x,e.x),s=Math.min(t.y,e.y),r=Math.max(t.x,e.x),o=Math.max(t.y,e.y);this._cancelMarquee();const l=this._screenDistToSvgDist(5);if(r-i<l&&o-s<l)return;const a=[],c=this._svg.children;for(let h=0;h<c.length;h++){const d=c[h];if(d.classList&&d.classList.contains(q)||d.id===ut)continue;const u=d.tagName.toLowerCase();if(!(["defs","style","metadata","title","desc"].includes(u)||!te(d).drag))try{const m=d.getBBox();if(m.width===0&&m.height===0)continue;const y=m.x,p=m.y,g=m.x+m.width,b=m.y+m.height;y<=r&&g>=i&&p<=o&&b>=s&&a.push(d)}catch{}}for(let h=0;h<c.length;h++){const d=c[h];if(d.tagName.toLowerCase()==="g"&&!(d.classList&&d.classList.contains(q))&&d.id!==ut)for(let u=0;u<d.children.length;u++){const v=d.children[u];if(te(v).drag)try{const y=v.getBBox();if(y.width===0&&y.height===0)continue;const p=y.x,g=y.y,b=y.x+y.width,k=y.y+y.height;p<=r&&b>=i&&g<=o&&k>=s&&a.push(v)}catch{}}}if(a.length!==0){for(const h of a)this._multiSelected.add(h);(!this._selected||!this._multiSelected.has(this._selected))&&(this._selected=a[a.length-1]),this._renderHandles(),this._onSelect(this._selected)}}_cancelMarquee(){this._marqueeRect&&(this._marqueeRect.remove(),this._marqueeRect=null),this._marqueeStart=null,this._marqueeActive=!1,this._svg.style.cursor=""}_select(e){this._selected===e&&this._multiSelected.size<=1||(this._deselect(),this._selected=e,this._multiSelected.clear(),this._multiSelected.add(e),this._renderHandles(),this._onSelect(e))}_deselect(){!this._selected&&this._multiSelected.size===0||(this._removeHandles(),this._selected=null,this._multiSelected.clear(),this._onDeselect())}_markDirty(){this._dirty||(this._dirty=!0),this._onDirty()}_removeHandles(){this._handleGroup&&(this._handleGroup.remove(),this._handleGroup=null)}_renderHandles(){if(this._removeHandles(),!this._selected&&this._multiSelected.size===0)return;const t=document.createElementNS("http://www.w3.org/2000/svg","g");t.id=ut,t.setAttribute("pointer-events","all"),this._svg.appendChild(t),this._handleGroup=t;const i=this._multiSelected.size>1;for(const s of this._multiSelected)this._renderBoundingBox(t,s);if(!i&&this._selected){const s=this._selected,r=s.tagName.toLowerCase(),o=te(s);r==="line"?this._renderLineHandles(t,s):r==="polyline"||r==="polygon"?this._renderPolyHandles(t,s):r==="rect"&&o.resize?this._renderRectHandles(t,s):r==="circle"&&o.resize?this._renderCircleHandles(t,s):r==="ellipse"&&o.resize?this._renderEllipseHandles(t,s):r==="path"&&this._renderPathHandles(t,s)}}_renderBoundingBox(e,t){try{const i=t.getBBox();if(i.width===0&&i.height===0)return;const s="http://www.w3.org/2000/svg",r=3,o=document.createElementNS(s,"rect");o.setAttribute("x",i.x-r),o.setAttribute("y",i.y-r),o.setAttribute("width",i.width+r*2),o.setAttribute("height",i.height+r*2);const l=this._screenDistToSvgDist(1),a=this._screenDistToSvgDist(4),c=this._screenDistToSvgDist(3),h=this._screenDistToSvgDist(3);o.setAttribute("x",i.x-h),o.setAttribute("y",i.y-h),o.setAttribute("width",i.width+h*2),o.setAttribute("height",i.height+h*2),o.setAttribute("fill","none"),o.setAttribute("stroke","#4fc3f7"),o.setAttribute("stroke-width",l),o.setAttribute("stroke-dasharray",`${a} ${c}`),o.setAttribute("pointer-events","none"),o.classList.add(q),o.dataset.handleType="bbox",o.dataset.handleIndex="0",e.appendChild(o)}catch{}}_updateHandles(){this._renderHandles()}_getHandleRadius(){return this._screenDistToSvgDist(Zn)}_createHandle(e,t,i,s,r,o="circle"){const l="http://www.w3.org/2000/svg",a=this._getHandleRadius();let c;o==="diamond"?(c=document.createElementNS(l,"polygon"),c.setAttribute("points",`${t},${i-a} ${t+a},${i} ${t},${i+a} ${t-a},${i}`)):o==="circle"?(c=document.createElementNS(l,"circle"),c.setAttribute("cx",t),c.setAttribute("cy",i),c.setAttribute("r",a)):(c=document.createElementNS(l,"rect"),c.setAttribute("x",t-a),c.setAttribute("y",i-a),c.setAttribute("width",a*2),c.setAttribute("height",a*2));const h=this._screenDistToSvgDist(1.5),d=s==="path-control"?"#f0883e":s==="endpoint"||s==="path-point"?"#4fc3f7":"#f0883e";return c.setAttribute("fill",d),c.setAttribute("stroke","#fff"),c.setAttribute("stroke-width",h),c.setAttribute("cursor","pointer"),c.classList.add(q),c.dataset.handleType=s,c.dataset.handleIndex=r,c.style.pointerEvents="all",e.appendChild(c),c}_renderLineHandles(e,t){const i=x(t,"x1"),s=x(t,"y1"),r=x(t,"x2"),o=x(t,"y2");this._createHandle(e,i,s,"endpoint",0),this._createHandle(e,r,o,"endpoint",1)}_renderPolyHandles(e,t){Se(t).forEach((s,r)=>{this._createHandle(e,s.x,s.y,"endpoint",r)})}_renderRectHandles(e,t){const i=x(t,"x"),s=x(t,"y"),r=x(t,"width"),o=x(t,"height");[{x:i,y:s},{x:i+r,y:s},{x:i+r,y:s+o},{x:i,y:s+o}].forEach((a,c)=>{this._createHandle(e,a.x,a.y,"resize-corner",c,"rect")})}_renderCircleHandles(e,t){const i=x(t,"cx"),s=x(t,"cy"),r=x(t,"r");[{x:i+r,y:s},{x:i,y:s+r},{x:i-r,y:s},{x:i,y:s-r}].forEach((l,a)=>{this._createHandle(e,l.x,l.y,"resize-edge",a,"rect")})}_renderEllipseHandles(e,t){const i=x(t,"cx"),s=x(t,"cy"),r=x(t,"rx"),o=x(t,"ry");[{x:i+r,y:s},{x:i,y:s+o},{x:i-r,y:s},{x:i,y:s-o}].forEach((a,c)=>{this._createHandle(e,a.x,a.y,"resize-edge",c,"rect")})}_renderPathHandles(e,t){const i=t.getAttribute("d")||"",s=Bi(i),r=Kn(s),o="http://www.w3.org/2000/svg",l=this._screenDistToSvgDist(.75);for(let a=0;a<r.length;a++)if(r[a].type==="control"){let c=null;if(a>0&&r[a-1].type==="endpoint"&&(c=r[a-1]),a+1<r.length&&r[a+1].type==="endpoint"&&(c=r[a+1]),c||(a+2<r.length&&r[a+2].type==="endpoint"&&(c=r[a+2]),a>=2&&r[a-2].type==="endpoint"&&(c=r[a-2])),c){const h=document.createElementNS(o,"line");h.setAttribute("x1",r[a].x),h.setAttribute("y1",r[a].y),h.setAttribute("x2",c.x),h.setAttribute("y2",c.y),h.setAttribute("stroke","#4fc3f7"),h.setAttribute("stroke-width",l),h.setAttribute("stroke-opacity","0.4"),h.setAttribute("stroke-dasharray",`${this._screenDistToSvgDist(2)} ${this._screenDistToSvgDist(2)}`),h.setAttribute("pointer-events","none"),h.classList.add(q),h.dataset.handleType="guide",h.dataset.handleIndex="0",e.appendChild(h)}}r.forEach((a,c)=>{const h=a.type==="control"?"path-control":"path-point",d=a.type==="control"?"diamond":"circle";this._createHandle(e,a.x,a.y,h,c,d)}),this._handleGroup&&(this._handleGroup._pathPoints=r,this._handleGroup._pathCommands=s)}_startElementDrag(e,t){const i=e.tagName.toLowerCase();if(["rect","text"].includes(i))this._dragState={mode:"translate",element:e,startSvg:{...t},attrMode:"xy",origX:x(e,"x"),origY:x(e,"y")};else if(["circle","ellipse"].includes(i))this._dragState={mode:"translate",element:e,startSvg:{...t},attrMode:"cxcy",origX:x(e,"cx"),origY:x(e,"cy")};else{const{tx:s,ty:r}=we(e);this._dragState={mode:"translate",element:e,startSvg:{...t},attrMode:"transform",origX:s,origY:r}}}_startLineDrag(e,t){const i=x(e,"x1"),s=x(e,"y1"),r=x(e,"x2"),o=x(e,"y2");this._dragState={mode:"line-whole",element:e,startSvg:{...t},origX1:i,origY1:s,origX2:r,origY2:o}}_startPolyDrag(e,t){const i=Se(e);this._dragState={mode:"poly-whole",element:e,startSvg:{...t},origPoints:i.map(s=>({...s}))}}_startPathDrag(e,t){const i=e.getAttribute("d")||"";Bi(i);const{tx:s,ty:r}=we(e);this._dragState={mode:"translate",element:e,startSvg:{...t},attrMode:"transform",origX:s,origY:r}}_startMultiDrag(e){const t=[];for(const i of this._multiSelected){const s=i.tagName.toLowerCase();if(te(i).drag)if(s==="line")t.push({el:i,kind:"line",origX1:x(i,"x1"),origY1:x(i,"y1"),origX2:x(i,"x2"),origY2:x(i,"y2")});else if(s==="polyline"||s==="polygon")t.push({el:i,kind:"poly",origPoints:Se(i).map(o=>({...o}))});else if(["rect","text","image","foreignobject"].includes(s))t.push({el:i,kind:"xy",origX:x(i,"x"),origY:x(i,"y")});else if(s==="circle"||s==="ellipse")t.push({el:i,kind:"cxcy",origX:x(i,"cx"),origY:x(i,"cy")});else{const{tx:o,ty:l}=we(i);t.push({el:i,kind:"transform",origX:o,origY:l})}}this._dragState={mode:"multi-translate",startSvg:{...e},snapshots:t}}_applyMultiTranslate(e,t){const i=this._dragState;for(const s of i.snapshots){const r=s.el;if(s.kind==="xy")r.setAttribute("x",s.origX+e),r.setAttribute("y",s.origY+t);else if(s.kind==="cxcy")r.setAttribute("cx",s.origX+e),r.setAttribute("cy",s.origY+t);else if(s.kind==="transform")je(r,s.origX+e,s.origY+t);else if(s.kind==="line")r.setAttribute("x1",s.origX1+e),r.setAttribute("y1",s.origY1+t),r.setAttribute("x2",s.origX2+e),r.setAttribute("y2",s.origY2+t);else if(s.kind==="poly"){const o=s.origPoints.map(l=>({x:l.x+e,y:l.y+t}));r.setAttribute("points",Ze(o))}}}_startHandleDrag(e,t,i,s){const r=this._selected;if(!r)return;const o=r.tagName.toLowerCase();if(e.type==="endpoint"){if(o==="line")this._dragState={mode:"line-endpoint",element:r,startSvg:{...t},endpointIndex:e.index};else if(o==="polyline"||o==="polygon"){const l=Se(r);this._dragState={mode:"poly-vertex",element:r,startSvg:{...t},vertexIndex:e.index,origPoints:l.map(a=>({...a}))}}}else if(e.type==="path-point"||e.type==="path-control"){const l=this._handleGroup;l&&l._pathPoints&&l._pathCommands&&l._pathPoints[e.index]&&(this._dragState={mode:"path-point",element:r,startSvg:{...t},pointIndex:e.index,pathPoints:l._pathPoints.map(c=>({...c})),pathCommands:l._pathCommands.map(c=>({cmd:c.cmd,args:[...c.args]}))})}else(e.type==="resize-corner"||e.type==="resize-edge")&&(this._dragState={mode:"resize",element:r,startSvg:{...t},handleType:e.type,handleIndex:e.index,...this._snapshotGeometry(r)})}_snapshotGeometry(e){const t=e.tagName.toLowerCase();return t==="rect"?{geomType:"rect",origX:x(e,"x"),origY:x(e,"y"),origW:x(e,"width"),origH:x(e,"height")}:t==="circle"?{geomType:"circle",origCx:x(e,"cx"),origCy:x(e,"cy"),origR:x(e,"r")}:t==="ellipse"?{geomType:"ellipse",origCx:x(e,"cx"),origCy:x(e,"cy"),origRx:x(e,"rx"),origRy:x(e,"ry")}:{}}_applyTranslate(e,t){const i=this._dragState,s=i.element;i.attrMode==="xy"?(s.setAttribute("x",i.origX+e),s.setAttribute("y",i.origY+t)):i.attrMode==="cxcy"?(s.setAttribute("cx",i.origX+e),s.setAttribute("cy",i.origY+t)):i.attrMode==="transform"&&je(s,i.origX+e,i.origY+t)}_applyLineWhole(e,t){const i=this._dragState,s=i.element;s.setAttribute("x1",i.origX1+e),s.setAttribute("y1",i.origY1+t),s.setAttribute("x2",i.origX2+e),s.setAttribute("y2",i.origY2+t)}_applyLineEndpoint(e){const t=this._dragState,i=t.element;t.endpointIndex===0?(i.setAttribute("x1",e.x),i.setAttribute("y1",e.y)):(i.setAttribute("x2",e.x),i.setAttribute("y2",e.y))}_applyPolyWhole(e,t){const i=this._dragState,s=i.element,r=i.origPoints.map(o=>({x:o.x+e,y:o.y+t}));s.setAttribute("points",Ze(r))}_applyPolyVertex(e){const t=this._dragState,i=t.element,s=t.origPoints.map(r=>({...r}));s[t.vertexIndex]={x:e.x,y:e.y},i.setAttribute("points",Ze(s))}_applyPathPoint(e){const t=this._dragState,i=t.element,s=t.pathPoints[t.pointIndex];if(!s)return;const r=t.pathCommands.map(a=>({cmd:a.cmd,args:[...a.args]})),o=r[s.cmdIndex];if(!o)return;if(o.cmd!==o.cmd.toUpperCase()){const a=t.pathCommands[s.cmdIndex],c=e.x-s.x,h=e.y-s.y;o.args[s.argIndex]=a.args[s.argIndex]+c,o.args[s.argIndex+1]=a.args[s.argIndex+1]+h}else o.args[s.argIndex]=e.x,o.args[s.argIndex+1]=e.y;i.setAttribute("d",Yn(r))}_applyResize(e){const t=this._dragState,i=t.element,s=e.x-t.startSvg.x,r=e.y-t.startSvg.y;t.geomType==="rect"?this._applyRectResize(i,t,s,r):t.geomType==="circle"?this._applyCircleResize(i,t,e):t.geomType==="ellipse"&&this._applyEllipseResize(i,t,e)}_applyRectResize(e,t,i,s){const r=t.handleIndex;let o=t.origX,l=t.origY,a=t.origW,c=t.origH;r===0?(o+=i,l+=s,a-=i,c-=s):r===1?(l+=s,a+=i,c-=s):r===2?(a+=i,c+=s):r===3&&(o+=i,a-=i,c+=s),a<1&&(a=1),c<1&&(c=1),e.setAttribute("x",o),e.setAttribute("y",l),e.setAttribute("width",a),e.setAttribute("height",c)}_applyCircleResize(e,t,i){const s=t.origCx,r=t.origCy,o=Math.max(1,Math.hypot(i.x-s,i.y-r));e.setAttribute("r",o)}_applyEllipseResize(e,t,i){const s=t.origCx,r=t.origCy,o=t.handleIndex;o===0||o===2?e.setAttribute("rx",Math.max(1,Math.abs(i.x-s))):e.setAttribute("ry",Math.max(1,Math.abs(i.y-r)))}}class Pt extends U(z){constructor(){super(),this._files=[],this._activeIndex=-1,this._dirtySet=new Set,this._zoomLevel=100,this._mode="select",this._selectedTag="",this._panZoomLeft=null,this._panZoomRight=null,this._svgEditor=null,this._syncing=!1,this._resizeObserver=null,this._undoStack=[],this._onKeyDown=this._onKeyDown.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._onKeyDown)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._onKeyDown),this._disposeAll(),this._resizeObserver&&(this._resizeObserver.disconnect(),this._resizeObserver=null)}firstUpdated(){const e=this.shadowRoot.querySelector(".diff-container");e&&(this._resizeObserver=new ResizeObserver(()=>this._handleResize()),this._resizeObserver.observe(e))}async openFile(e){const{path:t}=e;if(!t)return;const i=this._files.findIndex(a=>a.path===t);if(i!==-1){this._activeIndex=i,await this.updateComplete,this._injectSvgContent(),this._dispatchActiveFileChanged(t);return}let s=e.original??"",r=e.modified??"",o=e.is_new??!1;if(!s&&!r){const a=await this._fetchSvgContent(t);if(a===null){console.warn("SVG viewer: no content for",t);return}s=a.original,r=a.modified,o=a.is_new}console.log(`SVG viewer: opening ${t} (original: ${s.length} chars, modified: ${r.length} chars, new: ${o})`);const l={path:t,original:s,modified:r,is_new:o,savedContent:r};this._files=[...this._files,l],this._activeIndex=this._files.length-1,this._undoStack=[r],await this.updateComplete,this._injectSvgContent(),this._dispatchActiveFileChanged(t)}async refreshOpenFiles(){const e=[];let t=!1;for(const i of this._files){const s=await this._fetchSvgContent(i.path);if(s===null){e.push(i);continue}e.push({...i,original:s.original,modified:s.modified,is_new:s.is_new,savedContent:s.modified}),t=!0}t&&(this._files=e,this._dirtySet=new Set,await this.updateComplete,this._injectSvgContent())}closeFile(e){const t=this._files.findIndex(i=>i.path===e);t!==-1&&(this._dirtySet.delete(e),this._files=this._files.filter(i=>i.path!==e),this._files.length===0?(this._activeIndex=-1,this._disposeAll(),this._dispatchActiveFileChanged(null)):this._activeIndex>=this._files.length?(this._activeIndex=this._files.length-1,this.updateComplete.then(()=>this._injectSvgContent()),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)):t<=this._activeIndex&&(this._activeIndex=Math.max(0,this._activeIndex-1),this.updateComplete.then(()=>this._injectSvgContent()),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)))}getDirtyFiles(){return[...this._dirtySet]}async _fetchSvgContent(e){if(!this.rpcConnected)return console.warn("SVG viewer: RPC not connected, cannot fetch",e),null;try{let t="",i="",s=!1,r="";try{const l=await this.rpcExtract("Repo.get_file_content",e,"HEAD");r=typeof l=="string"?l:(l==null?void 0:l.content)??""}catch{}let o="";try{const l=await this.rpcExtract("Repo.get_file_content",e);o=typeof l=="string"?l:(l==null?void 0:l.content)??""}catch{}return!r&&!o?(console.warn("SVG file not found:",e),null):(r||(s=!0),t=r,i=o||r,{original:t,modified:i,is_new:s})}catch(t){return console.warn("Failed to fetch SVG content:",e,t),null}}_setMode(e){e!==this._mode&&(this._captureEditorContent(),this._mode=e,this._selectedTag="",this.updateComplete.then(()=>this._injectSvgContent()))}_captureEditorContent(){if(!this._svgEditor)return;const e=this._getActiveFile();if(!e)return;const t=this._svgEditor.getContent();t&&t!==e.modified&&(e.modified=t)}_disposeAll(){this._disposePanZoom(),this._disposeEditor()}_disposePanZoom(){if(this._panZoomLeft){try{this._panZoomLeft.destroy()}catch{}this._panZoomLeft=null}if(this._panZoomRight){try{this._panZoomRight.destroy()}catch{}this._panZoomRight=null}}_disposeEditor(){this._svgEditor&&(this._svgEditor.dispose(),this._svgEditor=null)}_initLeftPanZoom(){if(this._panZoomLeft){try{this._panZoomLeft.destroy()}catch{}this._panZoomLeft=null}const e=this.shadowRoot.querySelector(".svg-left svg");if(!e)return;const t=()=>{if(!this._syncing){this._syncing=!0;try{if(this._panZoomLeft){const i=this._panZoomLeft.getZoom();this._zoomLevel=Math.round(i*100),this._syncLeftToRight()}}finally{this._syncing=!1}}};try{this._panZoomLeft=qi(e,{zoomEnabled:!0,panEnabled:!0,controlIconsEnabled:!1,fit:!0,center:!0,minZoom:.1,maxZoom:40,zoomScaleSensitivity:.3,dblClickZoomEnabled:!0,onZoom:t,onPan:t,onUpdatedCTM:t})}catch(i){console.warn("svg-pan-zoom init failed for left panel:",i)}this._zoomLevel=100}_initRightPanZoom(){if(this._panZoomRight){try{this._panZoomRight.destroy()}catch{}this._panZoomRight=null}const e=this.shadowRoot.querySelector(".svg-right svg");if(!e)return;const t=()=>{if(!this._syncing){this._syncing=!0;try{if(this._panZoomRight&&this._panZoomLeft){const i=this._panZoomRight.getZoom(),s=this._panZoomRight.getPan();this._panZoomLeft.zoom(i),this._panZoomLeft.pan(s),this._zoomLevel=Math.round(i*100)}}finally{this._syncing=!1}}};try{this._panZoomRight=qi(e,{zoomEnabled:!0,panEnabled:!0,controlIconsEnabled:!1,fit:!0,center:!0,minZoom:.1,maxZoom:40,zoomScaleSensitivity:.3,dblClickZoomEnabled:!0,onZoom:t,onPan:t,onUpdatedCTM:t})}catch(i){console.warn("svg-pan-zoom init failed for right panel:",i)}this._syncLeftToRight()}_initEditor(){this._disposeEditor();const e=this.shadowRoot.querySelector(".svg-right svg");if(!e)return;const t=this._getActiveFile();this._svgEditor=new Gn(e,{onDirty:()=>{var i;if(t){this._dirtySet.add(t.path),this._dirtySet=new Set(this._dirtySet);const s=(i=this._svgEditor)==null?void 0:i.getContent();s&&(this._undoStack.push(s),this._undoStack.length>50&&this._undoStack.shift())}},onSelect:i=>{this._svgEditor&&this._svgEditor._multiSelected.size>1?this._selectedTag=`${this._svgEditor._multiSelected.size} elements`:this._selectedTag=i?`<${i.tagName.toLowerCase()}>`:""},onDeselect:()=>{this._selectedTag=""},onZoom:({zoom:i,viewBox:s})=>{this._zoomLevel=Math.round(i*100),this._syncRightToLeft(s)}})}_syncLeftToRight(){if(this._panZoomLeft){if(this._mode==="pan"&&this._panZoomRight){const e=this._panZoomLeft.getZoom(),t=this._panZoomLeft.getPan();this._panZoomRight.zoom(e),this._panZoomRight.pan(t)}else if(this._mode==="select"&&this._svgEditor){const e=this.shadowRoot.querySelector(".svg-left svg");if(e){const t=e.getAttribute("viewBox");if(t){const i=t.split(/[\s,]+/).map(Number);this._svgEditor.setViewBox(i[0],i[1],i[2],i[3])}}}}}_syncRightToLeft(e){if(!(!this._panZoomLeft||this._syncing)){this._syncing=!0;try{const t=this.shadowRoot.querySelector(".svg-left svg");if(!t)return;if(t.querySelector(".svg-pan-zoom_viewport")&&e){const s=this._getOriginalViewBox(t);if(s){const r=s.w/e.w,o=s.h/e.h,l=Math.min(r,o),a=-(e.x-s.x)*l,c=-(e.y-s.y)*l;this._panZoomLeft.zoom(l),this._panZoomLeft.pan({x:a,y:c})}}}finally{this._syncing=!1}}}_getOriginalViewBox(e){var s;const t=(s=e.viewBox)==null?void 0:s.baseVal;if(t&&t.width>0)return{x:t.x,y:t.y,w:t.width,h:t.height};const i=e.getAttribute("viewBox");if(i){const r=i.split(/[\s,]+/).map(Number);return{x:r[0]||0,y:r[1]||0,w:r[2]||800,h:r[3]||600}}return{x:0,y:0,w:800,h:600}}_handleResize(){this._panZoomLeft&&this._panZoomLeft.resize(),this._panZoomRight&&this._panZoomRight.resize()}_zoomIn(){this._panZoomLeft&&this._panZoomLeft.zoomIn()}_zoomOut(){this._panZoomLeft&&this._panZoomLeft.zoomOut()}_zoomReset(){this._panZoomLeft&&(this._panZoomLeft.resetZoom(),this._panZoomLeft.resetPan()),this._panZoomRight&&(this._panZoomRight.resetZoom(),this._panZoomRight.resetPan()),this._zoomLevel=100}_fitAll(){this._panZoomLeft&&this._panZoomLeft.fit(),this._panZoomRight&&this._panZoomRight.fit(),this._panZoomLeft&&(this._zoomLevel=Math.round(this._panZoomLeft.getZoom()*100)),this._syncLeftToRight()}_undo(){if(this._undoStack.length<=1)return;this._undoStack.pop();const e=this._undoStack[this._undoStack.length-1];if(!e)return;const t=this._getActiveFile();t&&(t.modified=e,this._injectSvgContent())}async _save(){const e=this._getActiveFile();if(e){if(this._captureEditorContent(),!this.rpcConnected){console.warn("SVG viewer: RPC not connected, cannot save");return}try{await this.rpcCall("Repo.write_file",e.path,e.modified),e.savedContent=e.modified,this._dirtySet.delete(e.path),this._dirtySet=new Set(this._dirtySet),this.dispatchEvent(new CustomEvent("file-saved",{bubbles:!0,composed:!0,detail:{path:e.path,content:e.modified}}))}catch(t){console.error("Failed to save SVG:",t)}}}_onKeyDown(e){if((e.ctrlKey||e.metaKey)&&e.key==="PageDown"){e.preventDefault(),this._files.length>1&&(this._captureEditorContent(),this._activeIndex=(this._activeIndex+1)%this._files.length,this.updateComplete.then(()=>this._injectSvgContent()),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}if((e.ctrlKey||e.metaKey)&&e.key==="PageUp"){e.preventDefault(),this._files.length>1&&(this._captureEditorContent(),this._activeIndex=(this._activeIndex-1+this._files.length)%this._files.length,this.updateComplete.then(()=>this._injectSvgContent()),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}if((e.ctrlKey||e.metaKey)&&e.key==="w"){e.preventDefault(),this._files.length>0&&this._activeIndex>=0&&(this._captureEditorContent(),this.closeFile(this._files[this._activeIndex].path));return}if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault(),this._save();return}if((e.ctrlKey||e.metaKey)&&e.key==="z"){this._mode==="select"&&(e.preventDefault(),this._undo());return}}_dispatchActiveFileChanged(e){window.dispatchEvent(new CustomEvent("active-file-changed",{detail:{path:e}}))}_getActiveFile(){return this._activeIndex>=0&&this._activeIndex<this._files.length?this._files[this._activeIndex]:null}updated(e){(e.has("_activeIndex")||e.has("_files"))&&this._injectSvgContent()}_prepareSvgElement(e){const t=e.querySelector("svg");if(t){if(t.style.width="100%",t.style.height="100%",!t.getAttribute("viewBox")){const i=t.getAttribute("width")||"800",s=t.getAttribute("height")||"600";t.setAttribute("viewBox",`0 0 ${parseFloat(i)} ${parseFloat(s)}`)}t.removeAttribute("width"),t.removeAttribute("height")}}_injectSvgContent(){const e=this._getActiveFile(),t=this.shadowRoot.querySelector(".svg-left"),i=this.shadowRoot.querySelector(".svg-right");if(!e)return;if(!t||!i){requestAnimationFrame(()=>this._injectSvgContent());return}this._injectGeneration==null&&(this._injectGeneration=0);const s=++this._injectGeneration;this._disposeAll();const r=e.original||e.modified||"",o=e.modified||"";t.innerHTML=r.trim()||'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>',i.innerHTML=o.trim()||'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>',this._prepareSvgElement(t),this._prepareSvgElement(i),requestAnimationFrame(()=>{s===this._injectGeneration&&(this._initLeftPanZoom(),this._mode==="select"?this._initEditor():this._initRightPanZoom())})}render(){const t=this._files.length>0?this._getActiveFile():null,i=t&&this._dirtySet.has(t.path);return f`
      <div class="diff-container">
        ${t?f`
          <button
            class="status-led ${i?"dirty":t.is_new?"new-file":"clean"}"
            title="${t.path}${i?" — unsaved (Ctrl+S to save)":t.is_new?" — new file":""}"
            aria-label="${t.path}${i?", unsaved changes, press to save":t.is_new?", new file":", no changes"}"
            @click=${()=>i?this._save():null}
          ></button>
          <div class="diff-panel">
            <div class="svg-container svg-left"></div>
          </div>
          <div class="splitter"></div>
          <div class="diff-panel">
            <div class="svg-container svg-right"></div>
          </div>
        `:f`
          <div class="empty-state">
            <div class="watermark">AC⚡DC</div>
          </div>
        `}
      </div>

      ${t?f`
        <div class="toolbar">
          <!-- Mode toggle -->
          <button class="${this._mode==="select"?"active":""}"
            @click=${()=>this._setMode("select")} title="Select & edit mode">✦ Select</button>
          <button class="${this._mode==="pan"?"active":""}"
            @click=${()=>this._setMode("pan")} title="Pan & zoom mode">✥ Pan</button>
          ${this._selectedTag?f`<span class="mode-label">${this._selectedTag}</span>`:_}

          <div class="separator"></div>

          <!-- Zoom controls -->
          <button @click=${this._zoomOut} title="Zoom out (−)">−</button>
          <span class="zoom-label">${this._zoomLevel}%</span>
          <button @click=${this._zoomIn} title="Zoom in (+)">+</button>
          <button @click=${this._zoomReset} title="Reset zoom">1:1</button>
          <button @click=${this._fitAll} title="Fit to view">Fit</button>

          <div class="separator"></div>

          <!-- Edit actions -->
          <button @click=${this._undo} title="Undo (Ctrl+Z)"
            ?disabled=${this._undoStack.length<=1}>↩ Undo</button>
          <button @click=${this._save} title="Save (Ctrl+S)"
            ?disabled=${!i}>💾 Save</button>
        </div>
      `:_}
    `}}$(Pt,"properties",{_files:{type:Array,state:!0},_activeIndex:{type:Number,state:!0},_dirtySet:{type:Object,state:!0},_zoomLevel:{type:Number,state:!0},_mode:{type:String,state:!0},_selectedTag:{type:String,state:!0}}),$(Pt,"styles",[P,B,L`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    /* Diff container — side by side */
    .diff-container {
      flex: 1;
      display: flex;
      flex-direction: row;
      min-height: 0;
      overflow: hidden;
      position: relative;
    }

    .diff-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      position: relative;
    }
    .diff-panel + .diff-panel {
      border-left: 1px solid var(--border-primary);
    }

    .svg-container {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      background: var(--bg-primary);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .svg-container svg {
      width: 100%;
      height: 100%;
    }

    .svg-left svg {
      cursor: grab;
    }
    .svg-left svg:active {
      cursor: grabbing;
    }

    /* Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 4px 8px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-primary);
      flex-shrink: 0;
    }

    .toolbar button {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 0.7rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    .toolbar button:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .toolbar button.active {
      background: var(--accent-primary);
      color: var(--bg-primary);
      border-color: var(--accent-primary);
    }

    .toolbar .zoom-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      min-width: 48px;
      text-align: center;
    }

    .toolbar .separator {
      width: 1px;
      height: 16px;
      background: var(--border-primary);
    }

    .toolbar .mode-label {
      font-size: 0.65rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Splitter handle */
    .splitter {
      width: 4px;
      cursor: col-resize;
      background: transparent;
      flex-shrink: 0;
      z-index: 1;
    }
    .splitter:hover { background: var(--accent-primary); opacity: 0.3; }

    /* Status LED — floating top-right indicator */
    .status-led {
      position: absolute;
      top: 8px;
      right: 16px;
      z-index: 10;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      cursor: pointer;
      transition: box-shadow 0.3s, background 0.3s;
      border: none;
      padding: 0;
    }
    .status-led.dirty {
      background: var(--accent-orange, #f0883e);
      box-shadow: 0 0 6px 2px rgba(240, 136, 62, 0.6);
      animation: led-pulse 2s ease-in-out infinite;
    }
    .status-led.clean {
      background: var(--accent-green);
      box-shadow: 0 0 4px 1px rgba(126, 231, 135, 0.4);
    }
    .status-led.new-file {
      background: var(--accent-primary);
      box-shadow: 0 0 4px 1px rgba(79, 195, 247, 0.4);
    }
    .status-led:hover {
      transform: scale(1.4);
    }
    @keyframes led-pulse {
      0%, 100% { opacity: 0.7; box-shadow: 0 0 6px 2px rgba(240, 136, 62, 0.4); }
      50% { opacity: 1; box-shadow: 0 0 10px 3px rgba(240, 136, 62, 0.8); }
    }

    /* Empty state */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
    }
    .watermark {
      font-size: 8rem;
      opacity: 0.18;
      user-select: none;
    }
  `]);customElements.define("ac-svg-viewer",Pt);function R(n){return n==null?"—":n>=1e3?(n/1e3).toFixed(1)+"K":String(n)}class Dt extends U(z){constructor(){super(),this._visible=!1,this._fading=!1,this._data=null,this._basicData=null,this._collapsed=this._loadCollapsedSections(),this._hideTimer=null,this._fadeTimer=null,this._hovered=!1,this._onStreamComplete=this._onStreamComplete.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-complete",this._onStreamComplete)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-complete",this._onStreamComplete),this._clearTimers()}_onStreamComplete(e){var i;const t=(i=e.detail)==null?void 0:i.result;!t||t.error||(this._basicData=t.token_usage||null,this._data=null,this._visible=!0,this._fading=!1,this._startAutoHide(),this._fetchBreakdown())}async _fetchBreakdown(){if(this.rpcConnected)try{const e=await this.rpcExtract("LLMService.get_context_breakdown");e&&(this._data=e)}catch(e){console.warn("Token HUD: failed to fetch breakdown:",e)}}_startAutoHide(){this._clearTimers(),this._hideTimer=setTimeout(()=>{this._hovered||(this._fading=!0,this._fadeTimer=setTimeout(()=>{this._visible=!1,this._fading=!1},800))},8e3)}_clearTimers(){this._hideTimer&&(clearTimeout(this._hideTimer),this._hideTimer=null),this._fadeTimer&&(clearTimeout(this._fadeTimer),this._fadeTimer=null)}_onMouseEnter(){this._hovered=!0,this._fading=!1,this._clearTimers()}_onMouseLeave(){this._hovered=!1,this._startAutoHide()}_dismiss(){this._clearTimers(),this._visible=!1,this._fading=!1}_toggleSection(e){const t=new Set(this._collapsed);t.has(e)?t.delete(e):t.add(e),this._collapsed=t,this._saveCollapsedSections(t)}_saveCollapsedSections(e){try{localStorage.setItem("ac-dc-hud-collapsed",JSON.stringify([...e]))}catch{}}_loadCollapsedSections(){try{const e=localStorage.getItem("ac-dc-hud-collapsed");if(e)return new Set(JSON.parse(e))}catch{}return new Set}_isExpanded(e){return!this._collapsed.has(e)}_getCacheBadge(e){if(e==null)return _;const t=Math.min(100,Math.max(0,e*100)).toFixed(0);let i="low";return e>=.5?i="good":e>=.2&&(i="ok"),f`<span class="cache-badge ${i}">${t}% cache</span>`}_getBudgetColor(e){return e>90?"red":e>75?"yellow":"green"}_renderHeader(){const e=this._data,t=(e==null?void 0:e.model)||"—",i=(e==null?void 0:e.provider_cache_rate)??(e==null?void 0:e.cache_hit_rate);return f`
      <div class="hud-header">
        <span class="hud-title">
          ${t}
          ${this._getCacheBadge(i)}
        </span>
        <button class="dismiss-btn" @click=${this._dismiss} title="Dismiss" aria-label="Dismiss token usage overlay">✕</button>
      </div>
    `}_getSubIcon(e){switch(e){case"system":return"⚙️";case"symbols":return"📦";case"files":return"📄";case"urls":return"🔗";case"history":return"💬";default:return"•"}}_getSubLabel(e){return e.name||e.path||e.type||"—"}_renderCacheTiers(){const e=this._data;if(!(e!=null&&e.blocks))return _;const t=Math.max(1,...e.blocks.map(i=>i.tokens||0));return f`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("tiers")}"
             @click=${()=>this._toggleSection("tiers")}
             @keydown=${i=>{(i.key==="Enter"||i.key===" ")&&(i.preventDefault(),this._toggleSection("tiers"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("tiers")?"▼":"▶"}</span>
          Cache Tiers
        </div>
        <div class="section-body ${this._isExpanded("tiers")?"":"collapsed"}">
          ${e.blocks.map(i=>{const s=t>0?i.tokens/t*100:0,r=(i.tier||i.name||"active").toLowerCase().replace(/[^a-z0-9]/g,""),o=i.contents||[];return f`
              <div class="tier-row">
                <span class="tier-label">${i.name||i.tier||"?"}</span>
                <div class="tier-bar">
                  <div class="tier-bar-fill ${r}" style="width: ${s}%"></div>
                </div>
                <span class="tier-tokens">${R(i.tokens)}</span>
                ${i.cached?f`<span class="tier-cached">🔒</span>`:_}
              </div>
              ${o.map(l=>{const a=l.n!=null?l.n:null,c=l.threshold,h=a!=null&&c?Math.min(100,a/c*100):0,d={L0:"var(--accent-green)",L1:"#26a69a",L2:"var(--accent-primary)",L3:"var(--accent-yellow)",active:"var(--accent-orange)"}[i.tier||i.name]||"var(--text-muted)";return f`
                <div class="tier-sub">
                  <span class="tier-sub-icon">${this._getSubIcon(l.type)}</span>
                  <span class="tier-sub-label">${this._getSubLabel(l)}</span>
                  ${a!=null?f`
                    <span class="tier-sub-n" title="N=${a}/${c||"?"}">${a}/${c||"?"}</span>
                    <div class="tier-sub-bar" title="N=${a}/${c||"?"}">
                      <div class="tier-sub-bar-fill" style="width: ${h}%; background: ${d}"></div>
                    </div>
                  `:_}
                  <span class="tier-sub-tokens">${R(l.tokens)}</span>
                </div>
              `})}
            `})}
        </div>
      </div>
    `}_renderThisRequest(){var o;const e=this._basicData||((o=this._data)==null?void 0:o.token_usage);if(!e)return _;const t=e.input_tokens||e.prompt_tokens||0,i=e.output_tokens||e.completion_tokens||0,s=e.cache_read_tokens||e.cache_read_input_tokens||0,r=e.cache_write_tokens||e.cache_creation_input_tokens||0;return f`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("request")}"
             @click=${()=>this._toggleSection("request")}
             @keydown=${l=>{(l.key==="Enter"||l.key===" ")&&(l.preventDefault(),this._toggleSection("request"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("request")?"▼":"▶"}</span>
          This Request
        </div>
        <div class="section-body ${this._isExpanded("request")?"":"collapsed"}">
          <div class="stat-row">
            <span class="stat-label">Prompt</span>
            <span class="stat-value">${R(t)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Completion</span>
            <span class="stat-value">${R(i)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Cache Read</span>
            <span class="stat-value ${s>0?"green":""}">${R(s)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Cache Write</span>
            <span class="stat-value ${r>0?"yellow":""}">${R(r)}</span>
          </div>
        </div>
      </div>
    `}_renderHistoryBudget(){const e=this._data;if(!e)return _;const t=e.breakdown;if(!t)return _;const i=t.history||0,s=e.total_tokens||0,r=e.max_input_tokens||1,o=Math.min(100,s/r*100),l=this._getBudgetColor(o);return f`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("budget")}"
             @click=${()=>this._toggleSection("budget")}
             @keydown=${a=>{(a.key==="Enter"||a.key===" ")&&(a.preventDefault(),this._toggleSection("budget"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("budget")?"▼":"▶"}</span>
          History Budget
        </div>
        <div class="section-body ${this._isExpanded("budget")?"":"collapsed"}">
          <div class="stat-row">
            <span class="stat-label">Total</span>
            <span class="stat-value">${R(s)} / ${R(r)}</span>
          </div>
          <div class="budget-bar">
            <div class="budget-bar-fill ${l}" style="width: ${o}%"></div>
          </div>
          <div class="stat-row">
            <span class="stat-label">History</span>
            <span class="stat-value">${R(i)}</span>
          </div>
        </div>
      </div>
    `}_renderTierChanges(){const e=this._data,t=e==null?void 0:e.promotions,i=e==null?void 0:e.demotions;return!(t!=null&&t.length)&&!(i!=null&&i.length)?_:f`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("changes")}"
             @click=${()=>this._toggleSection("changes")}
             @keydown=${s=>{(s.key==="Enter"||s.key===" ")&&(s.preventDefault(),this._toggleSection("changes"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("changes")?"▼":"▶"}</span>
          Tier Changes
        </div>
        <div class="section-body ${this._isExpanded("changes")?"":"collapsed"}">
          ${(t||[]).map(s=>f`
            <div class="change-item">
              <span class="change-icon">📈</span>
              <span class="change-text" title="${s}">${s}</span>
            </div>
          `)}
          ${(i||[]).map(s=>f`
            <div class="change-item">
              <span class="change-icon">📉</span>
              <span class="change-text" title="${s}">${s}</span>
            </div>
          `)}
        </div>
      </div>
    `}_renderSessionTotals(){var t;const e=(t=this._data)==null?void 0:t.session_totals;return e?f`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("session")}"
             @click=${()=>this._toggleSection("session")}
             @keydown=${i=>{(i.key==="Enter"||i.key===" ")&&(i.preventDefault(),this._toggleSection("session"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("session")?"▼":"▶"}</span>
          Session Totals
        </div>
        <div class="section-body ${this._isExpanded("session")?"":"collapsed"}">
          <div class="stat-row">
            <span class="stat-label">Prompt In</span>
            <span class="stat-value">${R(e.prompt)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Completion Out</span>
            <span class="stat-value">${R(e.completion)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Total</span>
            <span class="stat-value">${R(e.total)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Cache Read</span>
            <span class="stat-value ${e.cache_hit>0?"green":""}">${R(e.cache_hit)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Cache Write</span>
            <span class="stat-value ${e.cache_write>0?"yellow":""}">${R(e.cache_write)}</span>
          </div>
        </div>
      </div>
    `:_}render(){return this._visible?f`
      <div class="hud ${this._fading?"fading":""}"
        @mouseenter=${this._onMouseEnter}
        @mouseleave=${this._onMouseLeave}
      >
        ${this._renderHeader()}
        ${this._renderThisRequest()}
        ${this._renderSessionTotals()}
        ${this._renderHistoryBudget()}
        ${this._renderCacheTiers()}
        ${this._renderTierChanges()}
      </div>
    `:_}}$(Dt,"properties",{_visible:{type:Boolean,state:!0},_fading:{type:Boolean,state:!0},_data:{type:Object,state:!0},_basicData:{type:Object,state:!0},_collapsed:{type:Object,state:!0}}),$(Dt,"styles",[P,L`
    :host {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: var(--z-hud, 10000);
      pointer-events: none;
    }

    .hud {
      pointer-events: auto;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      width: 340px;
      max-height: 80vh;
      overflow-y: auto;
      font-size: 0.82rem;
      color: var(--text-secondary);
      opacity: 1;
      transition: opacity 0.8s ease;
    }

    .hud.hidden {
      display: none;
    }

    .hud.fading {
      opacity: 0;
    }

    /* Header */
    .hud-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      border-radius: var(--radius-md) var(--radius-md) 0 0;
    }

    .hud-title {
      font-weight: 600;
      color: var(--text-primary);
      font-size: 0.82rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .cache-badge {
      font-size: 0.7rem;
      padding: 1px 6px;
      border-radius: 8px;
      font-weight: 600;
    }
    .cache-badge.good {
      background: rgba(126, 231, 135, 0.15);
      color: var(--accent-green);
    }
    .cache-badge.ok {
      background: rgba(210, 153, 34, 0.15);
      color: var(--accent-yellow);
    }
    .cache-badge.low {
      background: rgba(255, 161, 152, 0.15);
      color: var(--accent-red);
    }

    .dismiss-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.85rem;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: var(--radius-sm);
    }
    .section-header:focus-visible {
      outline: 1px solid var(--accent-primary);
      outline-offset: -1px;
    }
    .dismiss-btn:hover {
      color: var(--text-primary);
      background: var(--bg-secondary);
    }

    /* Sections */
    .section {
      border-bottom: 1px solid var(--border-primary);
    }
    .section:last-child {
      border-bottom: none;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      color: var(--text-secondary);
      font-size: 0.75rem;
    }
    .section-header:hover,
    .section-header:focus-visible {
      background: var(--bg-tertiary);
    }

    .section-toggle {
      font-size: 0.55rem;
      color: var(--text-muted);
      width: 10px;
    }

    .section-body {
      padding: 0 12px 8px;
    }

    .section-body.collapsed {
      display: none;
    }

    /* Tier bars */
    .tier-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
    }

    .tier-label {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--text-secondary);
      min-width: 7ch;
      flex-shrink: 0;
    }

    .tier-bar {
      flex: 1;
      height: 8px;
      background: var(--bg-primary);
      border-radius: 4px;
      overflow: hidden;
    }

    .tier-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s;
    }
    .tier-bar-fill.l0 { background: var(--accent-green); }
    .tier-bar-fill.l1 { background: #26a69a; }
    .tier-bar-fill.l2 { background: var(--accent-primary); }
    .tier-bar-fill.l3 { background: var(--accent-yellow); }
    .tier-bar-fill.active { background: var(--accent-orange); }

    .tier-tokens {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--accent-green);
      min-width: 5ch;
      text-align: right;
      flex-shrink: 0;
    }

    .tier-cached {
      font-size: 0.72rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* Tier sub-items */
    .tier-sub {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0 2px 20px;
      font-size: 0.76rem;
      color: var(--text-secondary);
    }
    .tier-sub-icon {
      flex-shrink: 0;
      width: 16px;
      text-align: center;
    }
    .tier-sub-label { flex: 1; }
    .tier-sub-n {
      font-family: var(--font-mono);
      font-size: 0.73rem;
      color: var(--text-secondary);
      flex-shrink: 0;
      min-width: 4ch;
      text-align: right;
    }
    .tier-sub-bar {
      width: 36px;
      height: 4px;
      background: var(--bg-primary);
      border-radius: 2px;
      overflow: hidden;
      flex-shrink: 0;
    }
    .tier-sub-bar-fill {
      height: 100%;
      border-radius: 2px;
    }
    .tier-sub-tokens {
      font-family: var(--font-mono);
      font-size: 0.76rem;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    /* Stat rows */
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
    }

    .stat-label {
      color: var(--text-muted);
    }

    .stat-value {
      font-family: var(--font-mono);
      color: var(--text-primary);
    }

    .stat-value.green { color: var(--accent-green); }
    .stat-value.yellow { color: var(--accent-yellow); }
    .stat-value.red { color: var(--accent-red); }

    /* History budget bar */
    .budget-bar {
      height: 6px;
      background: var(--bg-primary);
      border-radius: 3px;
      overflow: hidden;
      margin: 4px 0;
    }

    .budget-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s;
    }
    .budget-bar-fill.green { background: var(--accent-green); }
    .budget-bar-fill.yellow { background: #e5c07b; }
    .budget-bar-fill.red { background: var(--accent-red); }

    /* Tier changes */
    .change-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      font-size: 0.78rem;
    }
    .change-icon { flex-shrink: 0; }
    .change-text {
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Scrollbar */
    .hud::-webkit-scrollbar {
      width: 4px;
    }
    .hud::-webkit-scrollbar-track {
      background: transparent;
    }
    .hud::-webkit-scrollbar-thumb {
      background: var(--border-primary);
      border-radius: 2px;
    }
  `]);customElements.define("ac-token-hud",Dt);const ft="ac-last-open-file",Ui="ac-last-viewport";function Jn(){const e=new URLSearchParams(window.location.search).get("port");return e?parseInt(e,10):18080}class Ft extends ms{constructor(){super(),this._port=Jn(),this._reconnectAttempt=0,this._reconnectTimer=null,this._statusBar="hidden",this._reconnectVisible=!1,this._reconnectMsg="",this._toasts=[],this._toastIdCounter=0,this._wasConnected=!1,this._statusBarTimer=null,this.serverURI=`ws://localhost:${this._port}`,this.remoteTimeout=60,this._onNavigateFile=this._onNavigateFile.bind(this),this._onFileSave=this._onFileSave.bind(this),this._onStreamCompleteForDiff=this._onStreamCompleteForDiff.bind(this),this._onFilesModified=this._onFilesModified.bind(this),this._onSearchNavigate=this._onSearchNavigate.bind(this),this._onGlobalKeyDown=this._onGlobalKeyDown.bind(this),this._onToastEvent=this._onToastEvent.bind(this),this._onActiveFileChanged=this._onActiveFileChanged.bind(this),this._onBeforeUnload=this._onBeforeUnload.bind(this)}connectedCallback(){super.connectedCallback(),console.log(`AC⚡DC connecting to ${this.serverURI}`),this.addClass(this,"AcApp"),window.addEventListener("navigate-file",this._onNavigateFile),window.addEventListener("file-save",this._onFileSave),window.addEventListener("stream-complete",this._onStreamCompleteForDiff),window.addEventListener("files-modified",this._onFilesModified),window.addEventListener("search-navigate",this._onSearchNavigate),window.addEventListener("active-file-changed",this._onActiveFileChanged),window.addEventListener("keydown",this._onGlobalKeyDown),window.addEventListener("ac-toast",this._onToastEvent),window.addEventListener("beforeunload",this._onBeforeUnload)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("navigate-file",this._onNavigateFile),window.removeEventListener("file-save",this._onFileSave),window.removeEventListener("stream-complete",this._onStreamCompleteForDiff),window.removeEventListener("files-modified",this._onFilesModified),window.removeEventListener("search-navigate",this._onSearchNavigate),window.removeEventListener("active-file-changed",this._onActiveFileChanged),window.removeEventListener("keydown",this._onGlobalKeyDown),window.removeEventListener("ac-toast",this._onToastEvent),window.removeEventListener("beforeunload",this._onBeforeUnload),this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._statusBarTimer&&clearTimeout(this._statusBarTimer)}remoteIsUp(){console.log("WebSocket connected — remote is up");const e=this._reconnectAttempt>0;this._reconnectAttempt=0,this._reconnectVisible=!1,this._reconnectMsg="",this._reconnectTimer&&(clearTimeout(this._reconnectTimer),this._reconnectTimer=null),this._showStatusBar("ok"),e&&this._showToast("Reconnected","success")}setupDone(){console.log("jrpc-oo setup done — call proxy ready"),this._wasConnected=!0,Ee.set(this.call),this._loadInitialState()}setupSkip(){console.warn("jrpc-oo setup skipped — connection failed"),this._wasConnected&&this._scheduleReconnect()}remoteDisconnected(){console.log("WebSocket disconnected"),Ee.clear(),this._showStatusBar("error",!1),window.dispatchEvent(new CustomEvent("rpc-disconnected")),this._scheduleReconnect()}_scheduleReconnect(){if(this._reconnectTimer)return;this._reconnectAttempt++;const e=Math.min(1e3*Math.pow(2,this._reconnectAttempt-1),15e3),t=(e/1e3).toFixed(0);this._reconnectMsg=`Reconnecting (attempt ${this._reconnectAttempt})... retry in ${t}s`,this._reconnectVisible=!0,console.log(`Scheduling reconnect attempt ${this._reconnectAttempt} in ${e}ms`),this._reconnectTimer=setTimeout(()=>{this._reconnectTimer=null,this._reconnectMsg=`Reconnecting (attempt ${this._reconnectAttempt})...`,this.requestUpdate();try{this.open(this.serverURI)}catch(i){console.error("Reconnect failed:",i),this._scheduleReconnect()}},e)}_showStatusBar(e,t=!0){this._statusBar=e,this._statusBarTimer&&(clearTimeout(this._statusBarTimer),this._statusBarTimer=null),t&&(this._statusBarTimer=setTimeout(()=>{this._statusBar="hidden"},3e3))}_onToastEvent(e){const{message:t,type:i}=e.detail||{};t&&this._showToast(t,i||"")}_showToast(e,t=""){const i=++this._toastIdCounter;this._toasts=[...this._toasts,{id:i,message:e,type:t,fading:!1}],setTimeout(()=>{this._toasts=this._toasts.map(s=>s.id===i?{...s,fading:!0}:s),setTimeout(()=>{this._toasts=this._toasts.filter(s=>s.id!==i)},300)},3e3)}streamChunk(e,t){return window.dispatchEvent(new CustomEvent("stream-chunk",{detail:{requestId:e,content:t}})),!0}streamComplete(e,t){return window.dispatchEvent(new CustomEvent("stream-complete",{detail:{requestId:e,result:t}})),!0}compactionEvent(e,t){return window.dispatchEvent(new CustomEvent("compaction-event",{detail:{requestId:e,event:t}})),!0}filesChanged(e){return window.dispatchEvent(new CustomEvent("files-changed",{detail:{selectedFiles:e}})),!0}async _loadInitialState(){try{const e=await this.call["LLMService.get_current_state"](),t=this._extract(e);console.log("Initial state loaded:",t),t!=null&&t.repo_name&&(document.title=`${t.repo_name}`),window.dispatchEvent(new CustomEvent("state-loaded",{detail:t})),this._reopenLastFile()}catch(e){console.error("Failed to load initial state:",e)}}_extract(e){if(e&&typeof e=="object"){const t=Object.keys(e);if(t.length===1)return e[t[0]]}return e}_reopenLastFile(){try{const e=localStorage.getItem(ft);if(!e)return;const t=localStorage.getItem(Ui);let i=null;if(t&&(i=JSON.parse(t),(i==null?void 0:i.path)!==e&&(i=null)),i&&i.type==="diff"){const s=r=>{var o;((o=r.detail)==null?void 0:o.path)===e&&(window.removeEventListener("active-file-changed",s),requestAnimationFrame(()=>{requestAnimationFrame(()=>{this._restoreViewportState(e,i)})}))};window.addEventListener("active-file-changed",s),setTimeout(()=>window.removeEventListener("active-file-changed",s),1e4)}window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:e}}))}catch{}}_saveViewportState(){var e,t;try{const i=localStorage.getItem(ft);if(!i||i.toLowerCase().endsWith(".svg"))return;const s=(e=this.shadowRoot)==null?void 0:e.querySelector("ac-diff-viewer");if(s){const r=((t=s.getViewportState)==null?void 0:t.call(s))??null;if(!r)return;const o={path:i,type:"diff",diff:r};localStorage.setItem(Ui,JSON.stringify(o))}}catch{}}_restoreViewportState(e,t){var i,s;try{if(t.type==="diff"&&t.diff){const r=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-diff-viewer");r&&((s=r.restoreViewportState)==null||s.call(r,t.diff))}}catch{}}_onNavigateFile(e){var o,l;const t=e.detail;if(!(t!=null&&t.path))return;this._saveViewportState();try{localStorage.setItem(ft,t.path)}catch{}const i=t.path.toLowerCase().endsWith(".svg"),s=(o=this.shadowRoot)==null?void 0:o.querySelector("ac-diff-viewer"),r=(l=this.shadowRoot)==null?void 0:l.querySelector("ac-svg-viewer");if(s&&(s.classList.toggle("viewer-visible",!i),s.classList.toggle("viewer-hidden",i)),r&&(r.classList.toggle("viewer-visible",i),r.classList.toggle("viewer-hidden",!i)),i){if(!r)return;r.openFile({path:t.path,original:t.original,modified:t.modified,is_new:t.is_new})}else{if(!s)return;s.openFile({path:t.path,original:t.original,modified:t.modified,is_new:t.is_new,is_read_only:t.is_read_only,is_config:t.is_config,config_type:t.config_type,real_path:t.real_path,searchText:t.searchText,line:t.line})}}_onSearchNavigate(e){const t=e.detail;t!=null&&t.path&&this._onNavigateFile({detail:{path:t.path,line:t.line}})}async _onFileSave(e){const{path:t,content:i,isConfig:s,configType:r}=e.detail;if(t)try{s&&r?await this.call["Settings.save_config_content"](r,i):await this.call["Repo.write_file"](t,i)}catch(o){console.error("File save failed:",o),this._showToast(`Save failed: ${o.message||"Unknown error"}`,"error")}}_onStreamCompleteForDiff(e){var r,o,l,a;const t=(r=e.detail)==null?void 0:r.result;if(!((o=t==null?void 0:t.files_modified)!=null&&o.length))return;const i=(l=this.shadowRoot)==null?void 0:l.querySelector("ac-diff-viewer");i&&i.refreshOpenFiles();const s=(a=this.shadowRoot)==null?void 0:a.querySelector("ac-svg-viewer");s&&s.refreshOpenFiles()}_onFilesModified(e){var s,r;const t=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-diff-viewer");t&&t._files.length>0&&t.refreshOpenFiles();const i=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-svg-viewer");i&&i._files.length>0&&i.refreshOpenFiles()}_onActiveFileChanged(e){var i,s,r;const t=(i=e.detail)==null?void 0:i.path;if(t){const o=t.toLowerCase().endsWith(".svg"),l=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-diff-viewer"),a=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-svg-viewer");l&&(l.classList.toggle("viewer-visible",!o),l.classList.toggle("viewer-hidden",o)),a&&(a.classList.toggle("viewer-visible",o),a.classList.toggle("viewer-hidden",!o))}}_onGlobalKeyDown(e){(e.ctrlKey||e.metaKey)&&e.key==="s"&&e.preventDefault()}_onBeforeUnload(){this._saveViewportState()}render(){return f`
      <div class="viewport">
        <div class="diff-background" role="region" aria-label="Code viewer">
          <ac-diff-viewer class="viewer-visible"></ac-diff-viewer>
          <ac-svg-viewer class="viewer-hidden"></ac-svg-viewer>
        </div>

        <div class="dialog-container" role="complementary" aria-label="Tools panel">
          <ac-dialog></ac-dialog>
        </div>
      </div>

      <ac-token-hud></ac-token-hud>

      <div class="status-bar ${this._statusBar}" role="status" aria-live="polite"
           aria-label="${this._statusBar==="ok"?"Connected":this._statusBar==="error"?"Disconnected":""}"></div>
      <div class="reconnect-banner ${this._reconnectVisible?"visible":""}"
           role="alert" aria-live="assertive">${this._reconnectMsg}</div>

      <div class="toast-container" role="status" aria-live="polite" aria-relevant="additions">
        ${this._toasts.map(e=>f`
          <div class="global-toast ${e.type} ${e.fading?"fading":""}" role="alert">${e.message}</div>
        `)}
      </div>
    `}}$(Ft,"properties",{_statusBar:{type:String,state:!0},_reconnectVisible:{type:Boolean,state:!0},_reconnectMsg:{type:String,state:!0},_toasts:{type:Array,state:!0}}),$(Ft,"styles",[P,L`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    .viewport {
      position: relative;
      width: 100%;
      height: 100%;
    }

    /* Viewer background — diff and SVG viewers stacked */
    .diff-background {
      position: fixed;
      inset: 0;
      z-index: 0;
      background: var(--bg-primary);
    }

    .diff-background ac-diff-viewer,
    .diff-background ac-svg-viewer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transition: opacity 0.15s;
    }

    .diff-background .viewer-hidden {
      opacity: 0;
      pointer-events: none;
      z-index: 0;
    }
    .diff-background .viewer-visible {
      opacity: 1;
      pointer-events: auto;
      z-index: 1;
    }

    /* Dialog container */
    .dialog-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 50%;
      min-width: 400px;
      height: 100%;
      z-index: 100;
      pointer-events: none;
    }

    /* Status bar */
    .status-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      z-index: 10001;
      transition: opacity 0.5s;
    }
    .status-bar.ok { background: var(--accent-green); }
    .status-bar.error { background: var(--accent-red); }
    .status-bar.hidden { opacity: 0; pointer-events: none; }

    /* Reconnecting banner */
    .reconnect-banner {
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      z-index: 10001;
      display: none;
      box-shadow: var(--shadow-md);
    }
    .reconnect-banner.visible { display: block; }

    /* Global toasts */
    .toast-container {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10002;
      display: flex;
      flex-direction: column-reverse;
      gap: 8px;
      pointer-events: none;
    }

    .global-toast {
      pointer-events: auto;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md, 8px);
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      box-shadow: var(--shadow-md);
      animation: toast-in 0.25s ease;
      max-width: 420px;
      text-align: center;
    }
    .global-toast.success { border-color: var(--accent-green); color: var(--accent-green); }
    .global-toast.error { border-color: var(--accent-red); color: var(--accent-red); }
    .global-toast.warning { border-color: var(--accent-orange); color: var(--accent-orange); }
    .global-toast.fading { opacity: 0; transition: opacity 0.3s; }

    @keyframes toast-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `]);customElements.define("ac-app",Ft);export{_ as A,U as R,L as a,f as b,z as i,Y as o,B as s,P as t,rr as w};
