const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/review-selector-DHmhk01X.js","assets/monaco-BTVA1LJb.js","assets/monaco-CJ-zWnmM.css","assets/marked-IDzlF_wn.js","assets/hljs-TiioHWPY.js","assets/ac-search-tab-T2Mp2hBk.js","assets/ac-context-tab-CySvdCmA.js","assets/ac-cache-tab-CplaYO0z.js","assets/ac-settings-tab-CYr-s0Hf.js"])))=>i.map(i=>d[i]);
var Ui=Object.defineProperty;var ji=Object.getPrototypeOf;var qi=Reflect.get;var Ni=(o,e,t)=>e in o?Ui(o,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):o[e]=t;var w=(o,e,t)=>Ni(o,typeof e!="symbol"?e+"":e,t);var Ct=(o,e,t)=>qi(ji(o),t,e);import{_ as ce,e as X,l as M,R as Se,U as Et}from"./monaco-BTVA1LJb.js";import{M as Hi}from"./marked-IDzlF_wn.js";import{H as S,j as mi,p as gi,t as vi,a as Bi,b as vt,c as Vi,x as _i,y as bi,d as Wi,e as Ki,f as Ji,m as yi}from"./hljs-TiioHWPY.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))i(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const n of r.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&i(n)}).observe(document,{childList:!0,subtree:!0});function t(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function i(s){if(s.ep)return;s.ep=!0;const r=t(s);fetch(s.href,r)}})();/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Te=globalThis,_t=Te.ShadowRoot&&(Te.ShadyCSS===void 0||Te.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,bt=Symbol(),At=new WeakMap;let xi=class{constructor(e,t,i){if(this._$cssResult$=!0,i!==bt)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const t=this.t;if(_t&&e===void 0){const i=t!==void 0&&t.length===1;i&&(e=At.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),i&&At.set(t,e))}return e}toString(){return this.cssText}};const Qi=o=>new xi(typeof o=="string"?o:o+"",void 0,bt),T=(o,...e)=>{const t=o.length===1?o[0]:e.reduce((i,s,r)=>i+(n=>{if(n._$cssResult$===!0)return n.cssText;if(typeof n=="number")return n;throw Error("Value passed to 'css' function must be a 'css' function result: "+n+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+o[r+1],o[0]);return new xi(t,o,bt)},Xi=(o,e)=>{if(_t)o.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const t of e){const i=document.createElement("style"),s=Te.litNonce;s!==void 0&&i.setAttribute("nonce",s),i.textContent=t.cssText,o.appendChild(i)}},Tt=_t?o=>o:o=>o instanceof CSSStyleSheet?(e=>{let t="";for(const i of e.cssRules)t+=i.cssText;return Qi(t)})(o):o;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:Yi,defineProperty:Gi,getOwnPropertyDescriptor:Zi,getOwnPropertyNames:es,getOwnPropertySymbols:ts,getPrototypeOf:is}=Object,P=globalThis,Rt=P.trustedTypes,ss=Rt?Rt.emptyScript:"",Ue=P.reactiveElementPolyfillSupport,de=(o,e)=>o,Qe={toAttribute(o,e){switch(e){case Boolean:o=o?ss:null;break;case Object:case Array:o=o==null?o:JSON.stringify(o)}return o},fromAttribute(o,e){let t=o;switch(e){case Boolean:t=o!==null;break;case Number:t=o===null?null:Number(o);break;case Object:case Array:try{t=JSON.parse(o)}catch{t=null}}return t}},wi=(o,e)=>!Yi(o,e),Mt={attribute:!0,type:String,converter:Qe,reflect:!1,useDefault:!1,hasChanged:wi};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),P.litPropertyMetadata??(P.litPropertyMetadata=new WeakMap);let Y=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??(this.l=[])).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=Mt){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){const i=Symbol(),s=this.getPropertyDescriptor(e,i,t);s!==void 0&&Gi(this.prototype,e,s)}}static getPropertyDescriptor(e,t,i){const{get:s,set:r}=Zi(this.prototype,e)??{get(){return this[t]},set(n){this[t]=n}};return{get:s,set(n){const a=s==null?void 0:s.call(this);r==null||r.call(this,n),this.requestUpdate(e,a,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??Mt}static _$Ei(){if(this.hasOwnProperty(de("elementProperties")))return;const e=is(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(de("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(de("properties"))){const t=this.properties,i=[...es(t),...ts(t)];for(const s of i)this.createProperty(s,t[s])}const e=this[Symbol.metadata];if(e!==null){const t=litPropertyMetadata.get(e);if(t!==void 0)for(const[i,s]of t)this.elementProperties.set(i,s)}this._$Eh=new Map;for(const[t,i]of this.elementProperties){const s=this._$Eu(t,i);s!==void 0&&this._$Eh.set(s,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const i=new Set(e.flat(1/0).reverse());for(const s of i)t.unshift(Tt(s))}else e!==void 0&&t.push(Tt(e));return t}static _$Eu(e,t){const i=t.attribute;return i===!1?void 0:typeof i=="string"?i:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){var e;this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),(e=this.constructor.l)==null||e.forEach(t=>t(this))}addController(e){var t;(this._$EO??(this._$EO=new Set)).add(e),this.renderRoot!==void 0&&this.isConnected&&((t=e.hostConnected)==null||t.call(e))}removeController(e){var t;(t=this._$EO)==null||t.delete(e)}_$E_(){const e=new Map,t=this.constructor.elementProperties;for(const i of t.keys())this.hasOwnProperty(i)&&(e.set(i,this[i]),delete this[i]);e.size>0&&(this._$Ep=e)}createRenderRoot(){const e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Xi(e,this.constructor.elementStyles),e}connectedCallback(){var e;this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostConnected)==null?void 0:i.call(t)})}enableUpdating(e){}disconnectedCallback(){var e;(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostDisconnected)==null?void 0:i.call(t)})}attributeChangedCallback(e,t,i){this._$AK(e,i)}_$ET(e,t){var r;const i=this.constructor.elementProperties.get(e),s=this.constructor._$Eu(e,i);if(s!==void 0&&i.reflect===!0){const n=(((r=i.converter)==null?void 0:r.toAttribute)!==void 0?i.converter:Qe).toAttribute(t,i.type);this._$Em=e,n==null?this.removeAttribute(s):this.setAttribute(s,n),this._$Em=null}}_$AK(e,t){var r,n;const i=this.constructor,s=i._$Eh.get(e);if(s!==void 0&&this._$Em!==s){const a=i.getPropertyOptions(s),l=typeof a.converter=="function"?{fromAttribute:a.converter}:((r=a.converter)==null?void 0:r.fromAttribute)!==void 0?a.converter:Qe;this._$Em=s;const c=l.fromAttribute(t,a.type);this[s]=c??((n=this._$Ej)==null?void 0:n.get(s))??c,this._$Em=null}}requestUpdate(e,t,i,s=!1,r){var n;if(e!==void 0){const a=this.constructor;if(s===!1&&(r=this[e]),i??(i=a.getPropertyOptions(e)),!((i.hasChanged??wi)(r,t)||i.useDefault&&i.reflect&&r===((n=this._$Ej)==null?void 0:n.get(e))&&!this.hasAttribute(a._$Eu(e,i))))return;this.C(e,t,i)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:i,reflect:s,wrapped:r},n){i&&!(this._$Ej??(this._$Ej=new Map)).has(e)&&(this._$Ej.set(e,n??t??this[e]),r!==!0||n!==void 0)||(this._$AL.has(e)||(this.hasUpdated||i||(t=void 0),this._$AL.set(e,t)),s===!0&&this._$Em!==e&&(this._$Eq??(this._$Eq=new Set)).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var i;if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(const[r,n]of this._$Ep)this[r]=n;this._$Ep=void 0}const s=this.constructor.elementProperties;if(s.size>0)for(const[r,n]of s){const{wrapped:a}=n,l=this[r];a!==!0||this._$AL.has(r)||l===void 0||this.C(r,void 0,n,l)}}let e=!1;const t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),(i=this._$EO)==null||i.forEach(s=>{var r;return(r=s.hostUpdate)==null?void 0:r.call(s)}),this.update(t)):this._$EM()}catch(s){throw e=!1,this._$EM(),s}e&&this._$AE(t)}willUpdate(e){}_$AE(e){var t;(t=this._$EO)==null||t.forEach(i=>{var s;return(s=i.hostUpdated)==null?void 0:s.call(i)}),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&(this._$Eq=this._$Eq.forEach(t=>this._$ET(t,this[t]))),this._$EM()}updated(e){}firstUpdated(e){}};Y.elementStyles=[],Y.shadowRootOptions={mode:"open"},Y[de("elementProperties")]=new Map,Y[de("finalized")]=new Map,Ue==null||Ue({ReactiveElement:Y}),(P.reactiveElementVersions??(P.reactiveElementVersions=[])).push("2.1.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const he=globalThis,Lt=o=>o,Le=he.trustedTypes,It=Le?Le.createPolicy("lit-html",{createHTML:o=>o}):void 0,$i="$lit$",F=`lit$${Math.random().toFixed(9).slice(2)}$`,Si="?"+F,rs=`<${Si}>`,K=document,ge=()=>K.createComment(""),ve=o=>o===null||typeof o!="object"&&typeof o!="function",yt=Array.isArray,ns=o=>yt(o)||typeof(o==null?void 0:o[Symbol.iterator])=="function",je=`[ 	
\f\r]`,ne=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Ft=/-->/g,Dt=/>/g,j=RegExp(`>|${je}(?:([^\\s"'>=/]+)(${je}*=${je}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Pt=/'/g,zt=/"/g,ki=/^(?:script|style|textarea|title)$/i,Ci=o=>(e,...t)=>({_$litType$:o,strings:e,values:t}),u=Ci(1),ar=Ci(2),J=Symbol.for("lit-noChange"),m=Symbol.for("lit-nothing"),Ot=new WeakMap,H=K.createTreeWalker(K,129);function Ei(o,e){if(!yt(o)||!o.hasOwnProperty("raw"))throw Error("invalid template strings array");return It!==void 0?It.createHTML(e):e}const os=(o,e)=>{const t=o.length-1,i=[];let s,r=e===2?"<svg>":e===3?"<math>":"",n=ne;for(let a=0;a<t;a++){const l=o[a];let c,h,d=-1,g=0;for(;g<l.length&&(n.lastIndex=g,h=n.exec(l),h!==null);)g=n.lastIndex,n===ne?h[1]==="!--"?n=Ft:h[1]!==void 0?n=Dt:h[2]!==void 0?(ki.test(h[2])&&(s=RegExp("</"+h[2],"g")),n=j):h[3]!==void 0&&(n=j):n===j?h[0]===">"?(n=s??ne,d=-1):h[1]===void 0?d=-2:(d=n.lastIndex-h[2].length,c=h[1],n=h[3]===void 0?j:h[3]==='"'?zt:Pt):n===zt||n===Pt?n=j:n===Ft||n===Dt?n=ne:(n=j,s=void 0);const v=n===j&&o[a+1].startsWith("/>")?" ":"";r+=n===ne?l+rs:d>=0?(i.push(c),l.slice(0,d)+$i+l.slice(d)+F+v):l+F+(d===-2?a:v)}return[Ei(o,r+(o[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),i]};let Xe=class Ai{constructor({strings:e,_$litType$:t},i){let s;this.parts=[];let r=0,n=0;const a=e.length-1,l=this.parts,[c,h]=os(e,t);if(this.el=Ai.createElement(c,i),H.currentNode=this.el.content,t===2||t===3){const d=this.el.content.firstChild;d.replaceWith(...d.childNodes)}for(;(s=H.nextNode())!==null&&l.length<a;){if(s.nodeType===1){if(s.hasAttributes())for(const d of s.getAttributeNames())if(d.endsWith($i)){const g=h[n++],v=s.getAttribute(d).split(F),_=/([.?@])?(.*)/.exec(g);l.push({type:1,index:r,name:_[2],strings:v,ctor:_[1]==="."?ls:_[1]==="?"?cs:_[1]==="@"?ds:De}),s.removeAttribute(d)}else d.startsWith(F)&&(l.push({type:6,index:r}),s.removeAttribute(d));if(ki.test(s.tagName)){const d=s.textContent.split(F),g=d.length-1;if(g>0){s.textContent=Le?Le.emptyScript:"";for(let v=0;v<g;v++)s.append(d[v],ge()),H.nextNode(),l.push({type:2,index:++r});s.append(d[g],ge())}}}else if(s.nodeType===8)if(s.data===Si)l.push({type:2,index:r});else{let d=-1;for(;(d=s.data.indexOf(F,d+1))!==-1;)l.push({type:7,index:r}),d+=F.length-1}r++}}static createElement(e,t){const i=K.createElement("template");return i.innerHTML=e,i}};function ee(o,e,t=o,i){var n,a;if(e===J)return e;let s=i!==void 0?(n=t._$Co)==null?void 0:n[i]:t._$Cl;const r=ve(e)?void 0:e._$litDirective$;return(s==null?void 0:s.constructor)!==r&&((a=s==null?void 0:s._$AO)==null||a.call(s,!1),r===void 0?s=void 0:(s=new r(o),s._$AT(o,t,i)),i!==void 0?(t._$Co??(t._$Co=[]))[i]=s:t._$Cl=s),s!==void 0&&(e=ee(o,s._$AS(o,e.values),s,i)),e}let as=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){const{el:{content:t},parts:i}=this._$AD,s=((e==null?void 0:e.creationScope)??K).importNode(t,!0);H.currentNode=s;let r=H.nextNode(),n=0,a=0,l=i[0];for(;l!==void 0;){if(n===l.index){let c;l.type===2?c=new xt(r,r.nextSibling,this,e):l.type===1?c=new l.ctor(r,l.name,l.strings,this,e):l.type===6&&(c=new hs(r,this,e)),this._$AV.push(c),l=i[++a]}n!==(l==null?void 0:l.index)&&(r=H.nextNode(),n++)}return H.currentNode=K,s}p(e){let t=0;for(const i of this._$AV)i!==void 0&&(i.strings!==void 0?(i._$AI(e,i,t),t+=i.strings.length-2):i._$AI(e[t])),t++}},xt=class Ti{get _$AU(){var e;return((e=this._$AM)==null?void 0:e._$AU)??this._$Cv}constructor(e,t,i,s){this.type=2,this._$AH=m,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=i,this.options=s,this._$Cv=(s==null?void 0:s.isConnected)??!0}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return t!==void 0&&(e==null?void 0:e.nodeType)===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=ee(this,e,t),ve(e)?e===m||e==null||e===""?(this._$AH!==m&&this._$AR(),this._$AH=m):e!==this._$AH&&e!==J&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):ns(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==m&&ve(this._$AH)?this._$AA.nextSibling.data=e:this.T(K.createTextNode(e)),this._$AH=e}$(e){var r;const{values:t,_$litType$:i}=e,s=typeof i=="number"?this._$AC(e):(i.el===void 0&&(i.el=Xe.createElement(Ei(i.h,i.h[0]),this.options)),i);if(((r=this._$AH)==null?void 0:r._$AD)===s)this._$AH.p(t);else{const n=new as(s,this),a=n.u(this.options);n.p(t),this.T(a),this._$AH=n}}_$AC(e){let t=Ot.get(e.strings);return t===void 0&&Ot.set(e.strings,t=new Xe(e)),t}k(e){yt(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let i,s=0;for(const r of e)s===t.length?t.push(i=new Ti(this.O(ge()),this.O(ge()),this,this.options)):i=t[s],i._$AI(r),s++;s<t.length&&(this._$AR(i&&i._$AB.nextSibling,s),t.length=s)}_$AR(e=this._$AA.nextSibling,t){var i;for((i=this._$AP)==null?void 0:i.call(this,!1,!0,t);e!==this._$AB;){const s=Lt(e).nextSibling;Lt(e).remove(),e=s}}setConnected(e){var t;this._$AM===void 0&&(this._$Cv=e,(t=this._$AP)==null||t.call(this,e))}},De=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,i,s,r){this.type=1,this._$AH=m,this._$AN=void 0,this.element=e,this.name=t,this._$AM=s,this.options=r,i.length>2||i[0]!==""||i[1]!==""?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=m}_$AI(e,t=this,i,s){const r=this.strings;let n=!1;if(r===void 0)e=ee(this,e,t,0),n=!ve(e)||e!==this._$AH&&e!==J,n&&(this._$AH=e);else{const a=e;let l,c;for(e=r[0],l=0;l<r.length-1;l++)c=ee(this,a[i+l],t,l),c===J&&(c=this._$AH[l]),n||(n=!ve(c)||c!==this._$AH[l]),c===m?e=m:e!==m&&(e+=(c??"")+r[l+1]),this._$AH[l]=c}n&&!s&&this.j(e)}j(e){e===m?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},ls=class extends De{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===m?void 0:e}},cs=class extends De{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==m)}},ds=class extends De{constructor(e,t,i,s,r){super(e,t,i,s,r),this.type=5}_$AI(e,t=this){if((e=ee(this,e,t,0)??m)===J)return;const i=this._$AH,s=e===m&&i!==m||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,r=e!==m&&(i===m||s);s&&this.element.removeEventListener(this.name,this,i),r&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var t;typeof this._$AH=="function"?this._$AH.call(((t=this.options)==null?void 0:t.host)??this.element,e):this._$AH.handleEvent(e)}},hs=class{constructor(e,t,i){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(e){ee(this,e)}};const qe=he.litHtmlPolyfillSupport;qe==null||qe(Xe,xt),(he.litHtmlVersions??(he.litHtmlVersions=[])).push("3.3.2");const ps=(o,e,t)=>{const i=(t==null?void 0:t.renderBefore)??e;let s=i._$litPart$;if(s===void 0){const r=(t==null?void 0:t.renderBefore)??null;i._$litPart$=s=new xt(e.insertBefore(ge(),r),r,void 0,t??{})}return s._$AI(o),s};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const V=globalThis;let E=class extends Y{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var t;const e=super.createRenderRoot();return(t=this.renderOptions).renderBefore??(t.renderBefore=e.firstChild),e}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=ps(t,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),(e=this._$Do)==null||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this._$Do)==null||e.setConnected(!1)}render(){return J}};var ui;E._$litElement$=!0,E.finalized=!0,(ui=V.litElementHydrateSupport)==null||ui.call(V,{LitElement:E});const Ne=V.litElementPolyfillSupport;Ne==null||Ne({LitElement:E});(V.litElementVersions??(V.litElementVersions=[])).push("4.2.2");const ke=new Set;let oe=null;const pe={set(o){oe=o;for(const e of ke)try{e(o)}catch(t){console.error("SharedRpc listener error:",t)}},get(){return oe},addListener(o){if(ke.add(o),oe)try{o(oe)}catch(e){console.error("SharedRpc listener error:",e)}},removeListener(o){ke.delete(o)},clear(){oe=null;for(const o of ke)try{o(null)}catch(e){console.error("SharedRpc listener error:",e)}}},R=T`
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
`,O=T`
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
`;let Ut=class{getAllFns(e,t){let i=[],s=e.constructor.prototype;for(;s!=null;){let r=s.constructor.name.replace("_exports_","");if(t!=null&&(r=t),r!=="Object"){let n=Object.getOwnPropertyNames(s).filter(a=>a!=="constructor"&&a.indexOf("__")<0);n.forEach((a,l)=>{n[l]=r+"."+a}),i=i.concat(n)}if(t!=null)break;s=s.__proto__}return i}exposeAllFns(e,t){let i=this.getAllFns(e,t);var s={};return i.forEach(function(r){s[r]=function(n,a){Promise.resolve(e[r.substring(r.indexOf(".")+1)].apply(e,n.args)).then(function(l){return a(null,l)}).catch(function(l){return console.log("failed : "+l),a(l)})}}),s}};typeof module<"u"&&typeof module.exports<"u"?module.exports=Ut:Window.ExposeClass=Ut;/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Re=globalThis,wt=Re.ShadowRoot&&(Re.ShadyCSS===void 0||Re.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,Ri=Symbol(),jt=new WeakMap;let us=class{constructor(e,t,i){if(this._$cssResult$=!0,i!==Ri)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const t=this.t;if(wt&&e===void 0){const i=t!==void 0&&t.length===1;i&&(e=jt.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),i&&jt.set(t,e))}return e}toString(){return this.cssText}};const fs=o=>new us(typeof o=="string"?o:o+"",void 0,Ri),ms=(o,e)=>{if(wt)o.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const t of e){const i=document.createElement("style"),s=Re.litNonce;s!==void 0&&i.setAttribute("nonce",s),i.textContent=t.cssText,o.appendChild(i)}},qt=wt?o=>o:o=>o instanceof CSSStyleSheet?(e=>{let t="";for(const i of e.cssRules)t+=i.cssText;return fs(t)})(o):o;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:gs,defineProperty:vs,getOwnPropertyDescriptor:_s,getOwnPropertyNames:bs,getOwnPropertySymbols:ys,getPrototypeOf:xs}=Object,z=globalThis,Nt=z.trustedTypes,ws=Nt?Nt.emptyScript:"",He=z.reactiveElementPolyfillSupport,ue=(o,e)=>o,Ye={toAttribute(o,e){switch(e){case Boolean:o=o?ws:null;break;case Object:case Array:o=o==null?o:JSON.stringify(o)}return o},fromAttribute(o,e){let t=o;switch(e){case Boolean:t=o!==null;break;case Number:t=o===null?null:Number(o);break;case Object:case Array:try{t=JSON.parse(o)}catch{t=null}}return t}},Mi=(o,e)=>!gs(o,e),Ht={attribute:!0,type:String,converter:Ye,reflect:!1,useDefault:!1,hasChanged:Mi};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),z.litPropertyMetadata??(z.litPropertyMetadata=new WeakMap);let G=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??(this.l=[])).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=Ht){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){const i=Symbol(),s=this.getPropertyDescriptor(e,i,t);s!==void 0&&vs(this.prototype,e,s)}}static getPropertyDescriptor(e,t,i){const{get:s,set:r}=_s(this.prototype,e)??{get(){return this[t]},set(n){this[t]=n}};return{get:s,set(n){const a=s==null?void 0:s.call(this);r==null||r.call(this,n),this.requestUpdate(e,a,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??Ht}static _$Ei(){if(this.hasOwnProperty(ue("elementProperties")))return;const e=xs(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(ue("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(ue("properties"))){const t=this.properties,i=[...bs(t),...ys(t)];for(const s of i)this.createProperty(s,t[s])}const e=this[Symbol.metadata];if(e!==null){const t=litPropertyMetadata.get(e);if(t!==void 0)for(const[i,s]of t)this.elementProperties.set(i,s)}this._$Eh=new Map;for(const[t,i]of this.elementProperties){const s=this._$Eu(t,i);s!==void 0&&this._$Eh.set(s,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const i=new Set(e.flat(1/0).reverse());for(const s of i)t.unshift(qt(s))}else e!==void 0&&t.push(qt(e));return t}static _$Eu(e,t){const i=t.attribute;return i===!1?void 0:typeof i=="string"?i:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){var e;this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),(e=this.constructor.l)==null||e.forEach(t=>t(this))}addController(e){var t;(this._$EO??(this._$EO=new Set)).add(e),this.renderRoot!==void 0&&this.isConnected&&((t=e.hostConnected)==null||t.call(e))}removeController(e){var t;(t=this._$EO)==null||t.delete(e)}_$E_(){const e=new Map,t=this.constructor.elementProperties;for(const i of t.keys())this.hasOwnProperty(i)&&(e.set(i,this[i]),delete this[i]);e.size>0&&(this._$Ep=e)}createRenderRoot(){const e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return ms(e,this.constructor.elementStyles),e}connectedCallback(){var e;this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostConnected)==null?void 0:i.call(t)})}enableUpdating(e){}disconnectedCallback(){var e;(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostDisconnected)==null?void 0:i.call(t)})}attributeChangedCallback(e,t,i){this._$AK(e,i)}_$ET(e,t){var r;const i=this.constructor.elementProperties.get(e),s=this.constructor._$Eu(e,i);if(s!==void 0&&i.reflect===!0){const n=(((r=i.converter)==null?void 0:r.toAttribute)!==void 0?i.converter:Ye).toAttribute(t,i.type);this._$Em=e,n==null?this.removeAttribute(s):this.setAttribute(s,n),this._$Em=null}}_$AK(e,t){var r,n;const i=this.constructor,s=i._$Eh.get(e);if(s!==void 0&&this._$Em!==s){const a=i.getPropertyOptions(s),l=typeof a.converter=="function"?{fromAttribute:a.converter}:((r=a.converter)==null?void 0:r.fromAttribute)!==void 0?a.converter:Ye;this._$Em=s;const c=l.fromAttribute(t,a.type);this[s]=c??((n=this._$Ej)==null?void 0:n.get(s))??c,this._$Em=null}}requestUpdate(e,t,i,s=!1,r){var n;if(e!==void 0){const a=this.constructor;if(s===!1&&(r=this[e]),i??(i=a.getPropertyOptions(e)),!((i.hasChanged??Mi)(r,t)||i.useDefault&&i.reflect&&r===((n=this._$Ej)==null?void 0:n.get(e))&&!this.hasAttribute(a._$Eu(e,i))))return;this.C(e,t,i)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:i,reflect:s,wrapped:r},n){i&&!(this._$Ej??(this._$Ej=new Map)).has(e)&&(this._$Ej.set(e,n??t??this[e]),r!==!0||n!==void 0)||(this._$AL.has(e)||(this.hasUpdated||i||(t=void 0),this._$AL.set(e,t)),s===!0&&this._$Em!==e&&(this._$Eq??(this._$Eq=new Set)).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var i;if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(const[r,n]of this._$Ep)this[r]=n;this._$Ep=void 0}const s=this.constructor.elementProperties;if(s.size>0)for(const[r,n]of s){const{wrapped:a}=n,l=this[r];a!==!0||this._$AL.has(r)||l===void 0||this.C(r,void 0,n,l)}}let e=!1;const t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),(i=this._$EO)==null||i.forEach(s=>{var r;return(r=s.hostUpdate)==null?void 0:r.call(s)}),this.update(t)):this._$EM()}catch(s){throw e=!1,this._$EM(),s}e&&this._$AE(t)}willUpdate(e){}_$AE(e){var t;(t=this._$EO)==null||t.forEach(i=>{var s;return(s=i.hostUpdated)==null?void 0:s.call(i)}),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&(this._$Eq=this._$Eq.forEach(t=>this._$ET(t,this[t]))),this._$EM()}updated(e){}firstUpdated(e){}};G.elementStyles=[],G.shadowRootOptions={mode:"open"},G[ue("elementProperties")]=new Map,G[ue("finalized")]=new Map,He==null||He({ReactiveElement:G}),(z.reactiveElementVersions??(z.reactiveElementVersions=[])).push("2.1.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const fe=globalThis,Bt=o=>o,Ie=fe.trustedTypes,Vt=Ie?Ie.createPolicy("lit-html",{createHTML:o=>o}):void 0,Li="$lit$",D=`lit$${Math.random().toFixed(9).slice(2)}$`,Ii="?"+D,$s=`<${Ii}>`,Q=document,_e=()=>Q.createComment(""),be=o=>o===null||typeof o!="object"&&typeof o!="function",$t=Array.isArray,Ss=o=>$t(o)||typeof(o==null?void 0:o[Symbol.iterator])=="function",Be=`[ 	
\f\r]`,ae=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Wt=/-->/g,Kt=/>/g,q=RegExp(`>|${Be}(?:([^\\s"'>=/]+)(${Be}*=${Be}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Jt=/'/g,Qt=/"/g,Fi=/^(?:script|style|textarea|title)$/i,te=Symbol.for("lit-noChange"),k=Symbol.for("lit-nothing"),Xt=new WeakMap,B=Q.createTreeWalker(Q,129);function Di(o,e){if(!$t(o)||!o.hasOwnProperty("raw"))throw Error("invalid template strings array");return Vt!==void 0?Vt.createHTML(e):e}const ks=(o,e)=>{const t=o.length-1,i=[];let s,r=e===2?"<svg>":e===3?"<math>":"",n=ae;for(let a=0;a<t;a++){const l=o[a];let c,h,d=-1,g=0;for(;g<l.length&&(n.lastIndex=g,h=n.exec(l),h!==null);)g=n.lastIndex,n===ae?h[1]==="!--"?n=Wt:h[1]!==void 0?n=Kt:h[2]!==void 0?(Fi.test(h[2])&&(s=RegExp("</"+h[2],"g")),n=q):h[3]!==void 0&&(n=q):n===q?h[0]===">"?(n=s??ae,d=-1):h[1]===void 0?d=-2:(d=n.lastIndex-h[2].length,c=h[1],n=h[3]===void 0?q:h[3]==='"'?Qt:Jt):n===Qt||n===Jt?n=q:n===Wt||n===Kt?n=ae:(n=q,s=void 0);const v=n===q&&o[a+1].startsWith("/>")?" ":"";r+=n===ae?l+$s:d>=0?(i.push(c),l.slice(0,d)+Li+l.slice(d)+D+v):l+D+(d===-2?a:v)}return[Di(o,r+(o[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),i]};class ye{constructor({strings:e,_$litType$:t},i){let s;this.parts=[];let r=0,n=0;const a=e.length-1,l=this.parts,[c,h]=ks(e,t);if(this.el=ye.createElement(c,i),B.currentNode=this.el.content,t===2||t===3){const d=this.el.content.firstChild;d.replaceWith(...d.childNodes)}for(;(s=B.nextNode())!==null&&l.length<a;){if(s.nodeType===1){if(s.hasAttributes())for(const d of s.getAttributeNames())if(d.endsWith(Li)){const g=h[n++],v=s.getAttribute(d).split(D),_=/([.?@])?(.*)/.exec(g);l.push({type:1,index:r,name:_[2],strings:v,ctor:_[1]==="."?Es:_[1]==="?"?As:_[1]==="@"?Ts:Pe}),s.removeAttribute(d)}else d.startsWith(D)&&(l.push({type:6,index:r}),s.removeAttribute(d));if(Fi.test(s.tagName)){const d=s.textContent.split(D),g=d.length-1;if(g>0){s.textContent=Ie?Ie.emptyScript:"";for(let v=0;v<g;v++)s.append(d[v],_e()),B.nextNode(),l.push({type:2,index:++r});s.append(d[g],_e())}}}else if(s.nodeType===8)if(s.data===Ii)l.push({type:2,index:r});else{let d=-1;for(;(d=s.data.indexOf(D,d+1))!==-1;)l.push({type:7,index:r}),d+=D.length-1}r++}}static createElement(e,t){const i=Q.createElement("template");return i.innerHTML=e,i}}function ie(o,e,t=o,i){var n,a;if(e===te)return e;let s=i!==void 0?(n=t._$Co)==null?void 0:n[i]:t._$Cl;const r=be(e)?void 0:e._$litDirective$;return(s==null?void 0:s.constructor)!==r&&((a=s==null?void 0:s._$AO)==null||a.call(s,!1),r===void 0?s=void 0:(s=new r(o),s._$AT(o,t,i)),i!==void 0?(t._$Co??(t._$Co=[]))[i]=s:t._$Cl=s),s!==void 0&&(e=ie(o,s._$AS(o,e.values),s,i)),e}class Cs{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){const{el:{content:t},parts:i}=this._$AD,s=((e==null?void 0:e.creationScope)??Q).importNode(t,!0);B.currentNode=s;let r=B.nextNode(),n=0,a=0,l=i[0];for(;l!==void 0;){if(n===l.index){let c;l.type===2?c=new we(r,r.nextSibling,this,e):l.type===1?c=new l.ctor(r,l.name,l.strings,this,e):l.type===6&&(c=new Rs(r,this,e)),this._$AV.push(c),l=i[++a]}n!==(l==null?void 0:l.index)&&(r=B.nextNode(),n++)}return B.currentNode=Q,s}p(e){let t=0;for(const i of this._$AV)i!==void 0&&(i.strings!==void 0?(i._$AI(e,i,t),t+=i.strings.length-2):i._$AI(e[t])),t++}}class we{get _$AU(){var e;return((e=this._$AM)==null?void 0:e._$AU)??this._$Cv}constructor(e,t,i,s){this.type=2,this._$AH=k,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=i,this.options=s,this._$Cv=(s==null?void 0:s.isConnected)??!0}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return t!==void 0&&(e==null?void 0:e.nodeType)===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=ie(this,e,t),be(e)?e===k||e==null||e===""?(this._$AH!==k&&this._$AR(),this._$AH=k):e!==this._$AH&&e!==te&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):Ss(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==k&&be(this._$AH)?this._$AA.nextSibling.data=e:this.T(Q.createTextNode(e)),this._$AH=e}$(e){var r;const{values:t,_$litType$:i}=e,s=typeof i=="number"?this._$AC(e):(i.el===void 0&&(i.el=ye.createElement(Di(i.h,i.h[0]),this.options)),i);if(((r=this._$AH)==null?void 0:r._$AD)===s)this._$AH.p(t);else{const n=new Cs(s,this),a=n.u(this.options);n.p(t),this.T(a),this._$AH=n}}_$AC(e){let t=Xt.get(e.strings);return t===void 0&&Xt.set(e.strings,t=new ye(e)),t}k(e){$t(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let i,s=0;for(const r of e)s===t.length?t.push(i=new we(this.O(_e()),this.O(_e()),this,this.options)):i=t[s],i._$AI(r),s++;s<t.length&&(this._$AR(i&&i._$AB.nextSibling,s),t.length=s)}_$AR(e=this._$AA.nextSibling,t){var i;for((i=this._$AP)==null?void 0:i.call(this,!1,!0,t);e!==this._$AB;){const s=Bt(e).nextSibling;Bt(e).remove(),e=s}}setConnected(e){var t;this._$AM===void 0&&(this._$Cv=e,(t=this._$AP)==null||t.call(this,e))}}class Pe{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,i,s,r){this.type=1,this._$AH=k,this._$AN=void 0,this.element=e,this.name=t,this._$AM=s,this.options=r,i.length>2||i[0]!==""||i[1]!==""?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=k}_$AI(e,t=this,i,s){const r=this.strings;let n=!1;if(r===void 0)e=ie(this,e,t,0),n=!be(e)||e!==this._$AH&&e!==te,n&&(this._$AH=e);else{const a=e;let l,c;for(e=r[0],l=0;l<r.length-1;l++)c=ie(this,a[i+l],t,l),c===te&&(c=this._$AH[l]),n||(n=!be(c)||c!==this._$AH[l]),c===k?e=k:e!==k&&(e+=(c??"")+r[l+1]),this._$AH[l]=c}n&&!s&&this.j(e)}j(e){e===k?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}}class Es extends Pe{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===k?void 0:e}}class As extends Pe{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==k)}}class Ts extends Pe{constructor(e,t,i,s,r){super(e,t,i,s,r),this.type=5}_$AI(e,t=this){if((e=ie(this,e,t,0)??k)===te)return;const i=this._$AH,s=e===k&&i!==k||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,r=e!==k&&(i===k||s);s&&this.element.removeEventListener(this.name,this,i),r&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var t;typeof this._$AH=="function"?this._$AH.call(((t=this.options)==null?void 0:t.host)??this.element,e):this._$AH.handleEvent(e)}}class Rs{constructor(e,t,i){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(e){ie(this,e)}}const Ve=fe.litHtmlPolyfillSupport;Ve==null||Ve(ye,we),(fe.litHtmlVersions??(fe.litHtmlVersions=[])).push("3.3.2");const Ms=(o,e,t)=>{const i=(t==null?void 0:t.renderBefore)??e;let s=i._$litPart$;if(s===void 0){const r=(t==null?void 0:t.renderBefore)??null;i._$litPart$=s=new we(e.insertBefore(_e(),r),r,void 0,t??{})}return s._$AI(o),s};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const W=globalThis;let me=class extends G{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var t;const e=super.createRenderRoot();return(t=this.renderOptions).renderBefore??(t.renderBefore=e.firstChild),e}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Ms(t,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),(e=this._$Do)==null||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this._$Do)==null||e.setConnected(!1)}render(){return te}};var fi;me._$litElement$=!0,me.finalized=!0,(fi=W.litElementHydrateSupport)==null||fi.call(W,{LitElement:me});const We=W.litElementPolyfillSupport;We==null||We({LitElement:me});(W.litElementVersions??(W.litElementVersions=[])).push("4.2.2");Window.LitElement=me;(function(o){if(typeof exports=="object"&&typeof module<"u")module.exports=o();else if(typeof define=="function"&&define.amd)define([],o);else{var e;e=typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:this,e.JRPC=o()}})(function(){return function o(e,t,i){function s(a,l){if(!t[a]){if(!e[a]){var c=typeof require=="function"&&require;if(!l&&c)return c(a,!0);if(r)return r(a,!0);var h=new Error("Cannot find module '"+a+"'");throw h.code="MODULE_NOT_FOUND",h}var d=t[a]={exports:{}};e[a][0].call(d.exports,function(g){var v=e[a][1][g];return s(v||g)},d,d.exports,o,e,t,i)}return t[a].exports}for(var r=typeof require=="function"&&require,n=0;n<i.length;n++)s(i[n]);return s}({1:[function(o,e,t){(function(i){/*! JRPC v3.1.0
* <https://github.com/vphantom/js-jrpc>
* Copyright 2016 Stéphane Lavergne
* Free software under MIT License: <https://opensource.org/licenses/MIT> */function s(p){this.active=!0,this.transmitter=null,this.remoteTimeout=6e4,this.localTimeout=0,this.serial=0,this.discardSerial=0,this.outbox={requests:[],responses:[]},this.inbox={},this.localTimers={},this.outTimers={},this.localComponents={"system.listComponents":!0,"system.extension.dual-batch":!0},this.remoteComponents={},this.exposed={},this.exposed["system.listComponents"]=(function(f,b){return typeof f=="object"&&f!==null&&(this.remoteComponents=f,this.remoteComponents["system._upgraded"]=!0),b(null,this.localComponents)}).bind(this),this.exposed["system.extension.dual-batch"]=function(f,b){return b(null,!0)},typeof p=="object"&&("remoteTimeout"in p&&typeof p.remoteTimeout=="number"&&(this.remoteTimeout=1e3*p.remoteTimeout),"localTimeout"in p&&typeof p.localTimeout=="number"&&(this.localTimeout=1e3*p.localTimeout))}function r(){var p=this;return p.active=!1,p.transmitter=null,p.remoteTimeout=0,p.localTimeout=0,p.localComponents={},p.remoteComponents={},p.outbox.requests.length=0,p.outbox.responses.length=0,p.inbox={},p.exposed={},Object.keys(p.localTimers).forEach(function(f){clearTimeout(p.localTimers[f]),delete p.localTimers[f]}),Object.keys(p.outTimers).forEach(function(f){clearTimeout(p.outTimers[f]),delete p.outTimers[f]}),p}function n(p){var f,b,$=null,y={responses:[],requests:[]};if(typeof p!="function"&&(p=this.transmitter),!this.active||typeof p!="function")return this;if(f=this.outbox.responses.length,b=this.outbox.requests.length,f>0&&b>0&&"system.extension.dual-batch"in this.remoteComponents)y=$={responses:this.outbox.responses,requests:this.outbox.requests},this.outbox.responses=[],this.outbox.requests=[];else if(f>0)f>1?(y.responses=$=this.outbox.responses,this.outbox.responses=[]):y.responses.push($=this.outbox.responses.pop());else{if(!(b>0))return this;b>1?(y.requests=$=this.outbox.requests,this.outbox.requests=[]):y.requests.push($=this.outbox.requests.pop())}return setImmediate(p,JSON.stringify($),l.bind(this,y)),this}function a(p){return this.transmitter=p,this.transmit()}function l(p,f){this.active&&f&&(p.responses.length>0&&Array.prototype.push.apply(this.outbox.responses,p.responses),p.requests.length>0&&Array.prototype.push.apply(this.outbox.requests,p.requests))}function c(p){var f=[],b=[];if(!this.active)return this;if(typeof p=="string")try{p=JSON.parse(p)}catch{return this}if(p.constructor===Array){if(p.length===0)return this;typeof p[0].method=="string"?f=p:b=p}else typeof p=="object"&&(typeof p.requests<"u"&&typeof p.responses<"u"?(f=p.requests,b=p.responses):typeof p.method=="string"?f.push(p):b.push(p));return b.forEach(g.bind(this)),f.forEach(_.bind(this)),this}function h(){return this.active?this.call("system.listComponents",this.localComponents,(function(p,f){p||typeof f!="object"||(this.remoteComponents=f,this.remoteComponents["system._upgraded"]=!0)}).bind(this)):this}function d(p,f,b){var $={jsonrpc:"2.0",method:p};return this.active?(typeof f=="function"&&(b=f,f=null),"system._upgraded"in this.remoteComponents&&!(p in this.remoteComponents)?(typeof b=="function"&&setImmediate(b,{code:-32601,message:"Unknown remote method"}),this):(this.serial++,$.id=this.serial,typeof f=="object"&&($.params=f),typeof b=="function"&&(this.inbox[this.serial]=b),this.outbox.requests.push($),this.transmit(),typeof b!="function"?this:(this.remoteTimeout>0?this.outTimers[this.serial]=setTimeout(g.bind(this,{jsonrpc:"2.0",id:this.serial,error:{code:-1e3,message:"Timed out waiting for response"}},!0),this.remoteTimeout):this.outTimers[this.serial]=!0,this))):this}function g(p,f){var b=!1,$=null;this.active&&"id"in p&&p.id in this.outTimers&&(f===!0&&clearTimeout(this.outTimers[p.id]),delete this.outTimers[p.id],"id"in p&&p.id in this.inbox&&("error"in p?b=p.error:$=p.result,setImmediate(this.inbox[p.id],b,$),delete this.inbox[p.id]))}function v(p,f){var b;if(!this.active)return this;if(typeof p=="string")this.localComponents[p]=!0,this.exposed[p]=f;else if(typeof p=="object")for(b in p)p.hasOwnProperty(b)&&(this.localComponents[b]=!0,this.exposed[b]=p[b]);return this}function _(p){var f=null,b=null;if(this.active&&typeof p=="object"&&p!==null&&typeof p.jsonrpc=="string"&&p.jsonrpc==="2.0"){if(f=typeof p.id<"u"?p.id:null,typeof p.method!="string")return void(f!==null&&(this.localTimers[f]=!0,setImmediate(x.bind(this,f,-32600))));if(!(p.method in this.exposed))return void(f!==null&&(this.localTimers[f]=!0,setImmediate(x.bind(this,f,-32601))));if("params"in p){if(typeof p.params!="object")return void(f!==null&&(this.localTimers[f]=!0,setImmediate(x.bind(this,f,-32602))));b=p.params}f===null&&(this.discardSerial--,f=this.discardSerial),this.localTimeout>0?this.localTimers[f]=setTimeout(x.bind(this,f,{code:-1002,message:"Method handler timed out"},void 0,!0),this.localTimeout):this.localTimers[f]=!0,setImmediate(this.exposed[p.method],b,x.bind(this,f))}}function x(p,f,b,$){var y={jsonrpc:"2.0",id:p};this.active&&p in this.localTimers&&($===!0&&clearTimeout(this.localTimers[p]),delete this.localTimers[p],p===null||0>p||(typeof f<"u"&&f!==null&&f!==!1?typeof f=="number"?y.error={code:f,message:"error"}:f===!0?y.error={code:-1,message:"error"}:typeof f=="string"?y.error={code:-1,message:f}:typeof f=="object"&&"code"in f&&"message"in f?y.error=f:y.error={code:-2,message:"error",data:f}:y.result=b,this.outbox.responses.push(y),this.transmit()))}i.setImmediate=o("timers").setImmediate,s.prototype.shutdown=r,s.prototype.call=d,s.prototype.notify=d,s.prototype.expose=v,s.prototype.upgrade=h,s.prototype.receive=c,s.prototype.transmit=n,s.prototype.setTransmitter=a,typeof Promise.promisify=="function"&&(s.prototype.callAsync=Promise.promisify(d)),e.exports=s}).call(this,typeof global<"u"?global:typeof self<"u"?self:typeof window<"u"?window:{})},{timers:3}],2:[function(o,e,t){function i(){h=!1,a.length?c=a.concat(c):d=-1,c.length&&s()}function s(){if(!h){var g=setTimeout(i);h=!0;for(var v=c.length;v;){for(a=c,c=[];++d<v;)a&&a[d].run();d=-1,v=c.length}a=null,h=!1,clearTimeout(g)}}function r(g,v){this.fun=g,this.array=v}function n(){}var a,l=e.exports={},c=[],h=!1,d=-1;l.nextTick=function(g){var v=new Array(arguments.length-1);if(arguments.length>1)for(var _=1;_<arguments.length;_++)v[_-1]=arguments[_];c.push(new r(g,v)),c.length!==1||h||setTimeout(s,0)},r.prototype.run=function(){this.fun.apply(null,this.array)},l.title="browser",l.browser=!0,l.env={},l.argv=[],l.version="",l.versions={},l.on=n,l.addListener=n,l.once=n,l.off=n,l.removeListener=n,l.removeAllListeners=n,l.emit=n,l.binding=function(g){throw new Error("process.binding is not supported")},l.cwd=function(){return"/"},l.chdir=function(g){throw new Error("process.chdir is not supported")},l.umask=function(){return 0}},{}],3:[function(o,e,t){function i(c,h){this._id=c,this._clearFn=h}var s=o("process/browser.js").nextTick,r=Function.prototype.apply,n=Array.prototype.slice,a={},l=0;t.setTimeout=function(){return new i(r.call(setTimeout,window,arguments),clearTimeout)},t.setInterval=function(){return new i(r.call(setInterval,window,arguments),clearInterval)},t.clearTimeout=t.clearInterval=function(c){c.close()},i.prototype.unref=i.prototype.ref=function(){},i.prototype.close=function(){this._clearFn.call(window,this._id)},t.enroll=function(c,h){clearTimeout(c._idleTimeoutId),c._idleTimeout=h},t.unenroll=function(c){clearTimeout(c._idleTimeoutId),c._idleTimeout=-1},t._unrefActive=t.active=function(c){clearTimeout(c._idleTimeoutId);var h=c._idleTimeout;h>=0&&(c._idleTimeoutId=setTimeout(function(){c._onTimeout&&c._onTimeout()},h))},t.setImmediate=typeof setImmediate=="function"?setImmediate:function(c){var h=l++,d=arguments.length<2?!1:n.call(arguments,1);return a[h]=!0,s(function(){a[h]&&(d?c.apply(null,d):c.call(null),t.clearImmediate(h))}),h},t.clearImmediate=typeof clearImmediate=="function"?clearImmediate:function(c){delete a[c]}},{"process/browser.js":2}]},{},[1])(1)});Window.JRPC=JRPC;if(typeof module<"u"&&typeof module.exports<"u")var Pi={},Z=require("crypto"),Ls={},zi=class{};else{if(!Z)var Z=self.crypto;var Pi=Window.ExposeClass,zi=Window.LitElement}Z.randomUUID||(Z.randomUUID=()=>Z.getRandomValues(new Uint8Array(32)).toString("base64").replaceAll(",",""));let Yt=class extends zi{newRemote(){let e;return typeof Window>"u"?e=new Ls({remoteTimeout:this.remoteTimeout}):e=new Window.JRPC({remoteTimeout:this.remoteTimeout}),e.uuid=Z.randomUUID(),this.remotes==null&&(this.remotes={}),this.remotes[e.uuid]=e,e}createRemote(e){let t=this.newRemote();return this.remoteIsUp(),this.ws?(e=this.ws,this.ws.onclose=(function(i){this.rmRemote(i,t.uuid)}).bind(this),this.ws.onmessage=i=>{t.receive(i.data)}):(e.on("close",(i,s)=>this.rmRemote.bind(this)(i,t.uuid)),e.on("message",function(i,s){const r=s?i:i.toString();t.receive(r)})),this.setupRemote(t,e),t}remoteIsUp(){console.log("JRPCCommon::remoteIsUp")}rmRemote(e,t){if(this.server&&this.remotes[t]&&this.remotes[t].rpcs&&Object.keys(this.remotes[t].rpcs).forEach(i=>{this.server[i]&&delete this.server[i]}),Object.keys(this.remotes).length&&delete this.remotes[t],this.call&&Object.keys(this.remotes).length){let i=[];for(const s in this.remotes)this.remotes[s].rpcs&&(i=i.concat(Object.keys(this.remotes[s].rpcs)));if(this.call){let s=Object.keys(this.call);for(let r=0;r<s.length;r++)i.indexOf(s[r])<0&&delete this.call[s[r]]}}else this.call={};this.remoteDisconnected(t)}remoteDisconnected(e){console.log("JPRCCommon::remoteDisconnected "+e)}setupRemote(e,t){e.setTransmitter(this.transmit.bind(t)),this.classes&&this.classes.forEach(i=>{e.expose(i)}),e.upgrade(),e.call("system.listComponents",[],(i,s)=>{i?(console.log(i),console.log("Something went wrong when calling system.listComponents !")):this.setupFns(Object.keys(s),e)})}transmit(e,t){try{return this.send(e),t(!1)}catch(i){return console.log(i),t(!0)}}setupFns(e,t){e.forEach(i=>{t.rpcs==null&&(t.rpcs={}),t.rpcs[i]=function(s){return new Promise((r,n)=>{t.call(i,{args:Array.from(arguments)},(a,l)=>{a?(console.log("Error when calling remote function : "+i),n(a)):r(l)})})},this.call==null&&(this.call={}),this.call[i]==null&&(this.call[i]=(...s)=>{let r=[],n=[];for(const a in this.remotes)this.remotes[a].rpcs[i]!=null&&(n.push(a),r.push(this.remotes[a].rpcs[i](...s)));return Promise.all(r).then(a=>{let l={};return n.forEach((c,h)=>l[c]=a[h]),l})}),this.server==null&&(this.server={}),this.server[i]==null?this.server[i]=function(s){return new Promise((r,n)=>{t.call(i,{args:Array.from(arguments)},(a,l)=>{a?(console.log("Error when calling remote function : "+i),n(a)):r(l)})})}:this.server[i]=function(s){return new Promise((r,n)=>{n(new Error("More then one remote has this RPC, not sure who to talk to : "+i))})}}),this.setupDone()}setupDone(){}addClass(e,t){e.getRemotes=()=>this.remotes,e.getCall=()=>this.call,e.getServer=()=>this.server;let s=new Pi().exposeAllFns(e,t);if(this.classes==null?this.classes=[s]:this.classes.push(s),this.remotes!=null)for(const[r,n]of Object.entries(this.remotes))n.expose(s),n.upgrade()}};typeof module<"u"&&typeof module.exports<"u"?module.exports=Yt:Window.JRPCCommon=Yt;let Is=Window.JRPCCommon;class Oi extends Is{static get properties(){return{serverURI:{type:String},ws:{type:Object},server:{type:Object},remoteTimeout:{type:Number}}}constructor(){super(),this.remoteTimeout=60}updated(e){e.has("serverURI")&&this.serverURI&&this.serverURI!="undefined"&&this.serverChanged()}serverChanged(){this.ws!=null&&delete this.ws;try{this.ws=new WebSocket(this.serverURI),console.assert(this.ws.parent==null,"wss.parent already exists, this needs upgrade."),this.ws.addEventListener("open",this.createRemote.bind(this)),this.ws.addEventListener("error",this.wsError.bind(this))}catch(e){this.serverURI="",this.setupSkip(e)}}wsError(e){this.setupSkip(e)}isConnected(){return this.server!=null&&this.server!={}}setupSkip(){this.dispatchEvent(new CustomEvent("skip"))}setupDone(){this.dispatchEvent(new CustomEvent("done"))}}window.customElements.get("jrpc-client")||window.customElements.define("jrpc-client",Oi);function Ke(o,e="error"){window.dispatchEvent(new CustomEvent("ac-toast",{detail:{message:o,type:e}}))}const U=o=>{var e;return e=class extends o{constructor(){super(),this.rpcConnected=!1,this._rpcCallProxy=null,this._onRpcAvailable=this._onRpcAvailable.bind(this)}connectedCallback(){super.connectedCallback(),pe.addListener(this._onRpcAvailable)}disconnectedCallback(){super.disconnectedCallback(),pe.removeListener(this._onRpcAvailable)}_onRpcAvailable(i){this._rpcCallProxy=i,this.rpcConnected=!!i,i?this.onRpcReady():this.onRpcDisconnected()}onRpcReady(){}onRpcDisconnected(){}async rpcCall(i,...s){const r=this._rpcCallProxy||pe.get();if(!r)throw new Error("RPC not connected");return await r[i](...s)}async rpcExtract(i,...s){const r=await this.rpcCall(i,...s);if(r&&typeof r=="object"){const n=Object.keys(r);if(n.length===1)return r[n[0]]}return r}async rpcSafeExtract(i,...s){try{return await this.rpcExtract(i,...s)}catch(r){const n=i.split(".").pop()||i;return console.warn(`RPC ${i} failed:`,r),Ke(`${n} failed: ${r.message||"Connection error"}`,"error"),null}}async rpcSafeCall(i,...s){try{return await this.rpcCall(i,...s)}catch(r){const n=i.split(".").pop()||i;return console.warn(`RPC ${i} failed:`,r),Ke(`${n} failed: ${r.message||"Connection error"}`,"error"),null}}showToast(i,s=""){Ke(i,s)}},w(e,"properties",{...Ct(e,e,"properties"),rpcConnected:{type:Boolean,state:!0}}),e};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Fs={CHILD:2},Ds=o=>(...e)=>({_$litDirective$:o,values:e});class Ps{constructor(e){}get _$AU(){return this._$AM._$AU}_$AT(e,t,i){this._$Ct=e,this._$AM=t,this._$Ci=i}_$AS(e,t){return this.update(e,t)}update(e,t){return this.render(...t)}}/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */class Ge extends Ps{constructor(e){if(super(e),this.it=m,e.type!==Fs.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(e){if(e===m||e==null)return this._t=void 0,this.it=e;if(e===J)return e;if(typeof e!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(e===this.it)return this._t;this.it=e;const t=[e];return t.raw=t,this._t={_$litType$:this.constructor.resultType,strings:t,values:[]}}}Ge.directiveName="unsafeHTML",Ge.resultType=1;const N=Ds(Ge);S.registerLanguage("javascript",mi);S.registerLanguage("js",mi);S.registerLanguage("python",gi);S.registerLanguage("py",gi);S.registerLanguage("typescript",vi);S.registerLanguage("ts",vi);S.registerLanguage("json",Bi);S.registerLanguage("bash",vt);S.registerLanguage("sh",vt);S.registerLanguage("shell",vt);S.registerLanguage("css",Vi);S.registerLanguage("html",_i);S.registerLanguage("xml",_i);S.registerLanguage("yaml",bi);S.registerLanguage("yml",bi);S.registerLanguage("c",Wi);S.registerLanguage("cpp",Ki);S.registerLanguage("diff",Ji);S.registerLanguage("markdown",yi);S.registerLanguage("md",yi);function Ze(o){return o.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}const zs=new Hi({gfm:!0,breaks:!0,renderer:{code(o){let e,t;typeof o=="string"?(e=o,t=""):(e=o.text||"",t=(o.lang||"").trim());const i=t&&S.getLanguage(t)?t:null;let s;if(i)try{s=S.highlight(e,{language:i}).value}catch{s=Ze(e)}else try{s=S.highlightAuto(e).value}catch{s=Ze(e)}return`<pre class="code-block">${i?`<span class="code-lang">${i}</span>`:""}<button class="code-copy-btn" title="Copy code">📋</button><code class="hljs${i?` language-${i}`:""}">${s}</code></pre>`}}});function Me(o){if(!o)return"";try{return zs.parse(o)}catch(e){return console.warn("Markdown parse error:",e),`<pre>${Ze(o)}</pre>`}}class et extends E{constructor(){super(),this.open=!1,this._filter="",this._selectedIndex=0,this._history=[],this._originalInput=""}addEntry(e){const t=e.trim();if(!t)return;const i=this._history.indexOf(t);i!==-1&&this._history.splice(i,1),this._history.push(t),this._history.length>100&&this._history.shift()}show(e){this._history.length!==0&&(this._originalInput=e||"",this._filter="",this._selectedIndex=0,this.open=!0,this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".filter-input");t&&t.focus(),this._scrollToSelected()}))}cancel(){return this.open=!1,this._originalInput}select(){const e=this._getFiltered();if(e.length===0)return this.open=!1,this._originalInput;const t=e[e.length-1-this._selectedIndex];return this.open=!1,t||this._originalInput}handleKey(e){if(!this.open)return!1;const t=this._getFiltered();switch(e.key){case"ArrowUp":return e.preventDefault(),this._selectedIndex=Math.min(this._selectedIndex+1,t.length-1),this._scrollToSelected(),!0;case"ArrowDown":return e.preventDefault(),this._selectedIndex=Math.max(this._selectedIndex-1,0),this._scrollToSelected(),!0;case"Enter":return e.preventDefault(),this._dispatchSelect(this.select()),!0;case"Escape":return e.preventDefault(),this._dispatchCancel(this.cancel()),!0;default:return!1}}_getFiltered(){if(!this._filter)return this._history;const e=this._filter.toLowerCase();return this._history.filter(t=>t.toLowerCase().includes(e))}_onFilterInput(e){this._filter=e.target.value,this._selectedIndex=0}_onFilterKeyDown(e){this.handleKey(e)}_onItemClick(e){const t=this._getFiltered();this._selectedIndex=t.length-1-e,this._dispatchSelect(this.select())}_scrollToSelected(){this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".item.selected");e&&e.scrollIntoView({block:"nearest"})})}_dispatchSelect(e){this.dispatchEvent(new CustomEvent("history-select",{detail:{text:e},bubbles:!0,composed:!0}))}_dispatchCancel(e){this.dispatchEvent(new CustomEvent("history-cancel",{detail:{text:e},bubbles:!0,composed:!0}))}render(){if(!this.open)return m;const e=this._getFiltered();return u`
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
          ${e.length===0?u`
            <div class="empty">${this._filter?"No matches":"No history"}</div>
          `:e.map((t,i)=>{const s=i===e.length-1-this._selectedIndex;return u`
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
    `}}w(et,"properties",{open:{type:Boolean,reflect:!0},_filter:{type:String,state:!0},_selectedIndex:{type:Number,state:!0}}),w(et,"styles",[R,O,T`
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
  `]);customElements.define("ac-input-history",et);const Ce={github_repo:"📦",github_file:"📄",github_issue:"🐛",github_pr:"🔀",documentation:"📚",generic:"🌐"};class tt extends U(E){constructor(){super(),this._detected=[],this._fetched=[],this._fetching=new Set,this._excluded=new Set,this._debounceTimer=null}async detectUrls(e){if(!e||!this.rpcConnected){this._detected=[];return}clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(async()=>{try{const t=await this.rpcExtract("LLMService.detect_urls",e);if(!Array.isArray(t)){this._detected=[];return}const i=new Set(this._fetched.map(r=>r.url)),s=t.filter(r=>!i.has(r.url)&&!this._fetching.has(r.url));this._detected=s}catch(t){console.error("URL detection failed:",t)}},300)}onSend(){this._detected=[]}clear(){this._detected=[],this._fetched=[],this._fetching=new Set,this._excluded=new Set}getIncludedUrls(){return this._fetched.filter(e=>!e.error&&!this._excluded.has(e.url)).map(e=>e.url)}getExcludedUrls(){return[...this._excluded]}async _fetchUrl(e,t){if(!this._fetching.has(e)){this._detected=this._detected.filter(i=>i.url!==e),this._fetching=new Set([...this._fetching,e]),this.requestUpdate();try{const i=await this.rpcExtract("LLMService.fetch_url",e,!0,!0,null,null);this._fetching=new Set([...this._fetching].filter(s=>s!==e)),i&&(this._fetched=[...this._fetched,{url:e,url_type:i.url_type||t||"generic",title:i.title||e,error:i.error||null,display_name:i.title||this._shortenUrl(e)}])}catch(i){console.error("URL fetch failed:",i),this._fetching=new Set([...this._fetching].filter(s=>s!==e)),this._fetched=[...this._fetched,{url:e,url_type:t||"generic",title:e,error:i.message||"Fetch failed",display_name:this._shortenUrl(e)}]}this._notifyChange()}}_toggleExclude(e){const t=new Set(this._excluded);t.has(e)?t.delete(e):t.add(e),this._excluded=t,this._notifyChange()}_removeFetched(e){this._fetched=this._fetched.filter(i=>i.url!==e);const t=new Set(this._excluded);t.delete(e),this._excluded=t,this.rpcConnected&&this.rpcExtract("LLMService.remove_fetched_url",e).catch(()=>{}),this._notifyChange()}_dismissDetected(e){this._detected=this._detected.filter(t=>t.url!==e)}_viewContent(e){this.dispatchEvent(new CustomEvent("view-url-content",{bubbles:!0,composed:!0,detail:{url:e}}))}_notifyChange(){this.dispatchEvent(new CustomEvent("url-chips-changed",{bubbles:!0,composed:!0}))}_shortenUrl(e){try{const t=new URL(e);let i=t.pathname.replace(/\/$/,"");return i.length>30&&(i="..."+i.slice(-27)),t.hostname+i}catch{return e.length>40?e.slice(0,37)+"...":e}}_getDisplayName(e){return e.display_name||e.title||this._shortenUrl(e.url)}_renderDetectedChip(e){const t=Ce[e.url_type]||Ce.generic;return u`
      <span class="chip detected">
        <span class="badge">${t}</span>
        <span class="label" title="${e.url}">${e.display_name||this._shortenUrl(e.url)}</span>
        <button class="chip-btn fetch-btn" @click=${()=>this._fetchUrl(e.url,e.url_type)} title="Fetch">📥</button>
        <button class="chip-btn" @click=${()=>this._dismissDetected(e.url)} title="Dismiss">×</button>
      </span>
    `}_renderFetchingChip(e){return u`
      <span class="chip fetching">
        <span class="spinner"></span>
        <span class="label" title="${e}">${this._shortenUrl(e)}</span>
      </span>
    `}_renderFetchedChip(e){const t=this._excluded.has(e.url),i=!!e.error;return Ce[e.url_type]||Ce.generic,u`
      <span class="${`chip fetched ${t?"excluded":""} ${i?"error":""}`}">
        ${i?u`<span class="badge">⚠️</span>`:u`
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
          @click=${i?m:()=>this._viewContent(e.url)}
        >${this._getDisplayName(e)}</span>
        <button class="chip-btn" @click=${()=>this._removeFetched(e.url)} title="Remove">×</button>
      </span>
    `}render(){return this._detected.length>0||this._fetching.size>0||this._fetched.length>0?u`
      <div class="chips-container" role="list" aria-label="URL references">
        ${this._fetched.map(t=>this._renderFetchedChip(t))}
        ${[...this._fetching].map(t=>this._renderFetchingChip(t))}
        ${this._detected.map(t=>this._renderDetectedChip(t))}
      </div>
    `:m}}w(tt,"properties",{_detected:{type:Array,state:!0},_fetched:{type:Array,state:!0},_fetching:{type:Object,state:!0},_excluded:{type:Object,state:!0}}),w(tt,"styles",[R,T`
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
  `]);customElements.define("ac-url-chips",tt);function Os(o){return o?o.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/```(\w*)\n([\s\S]*?)```/g,(e,t,i)=>`<pre class="code-block"><code>${i}</code></pre>`).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>").replace(/^### (.+)$/gm,"<h4>$1</h4>").replace(/^## (.+)$/gm,"<h3>$1</h3>").replace(/^# (.+)$/gm,"<h2>$1</h2>").replace(/\n/g,"<br>"):""}class it extends U(E){constructor(){super(),this.open=!1,this._sessions=[],this._selectedSessionId=null,this._sessionMessages=[],this._searchQuery="",this._searchResults=[],this._loading=!1,this._loadingMessages=!1,this._mode="sessions",this._debounceTimer=null,this._toast=null,this._toastTimer=null}show(){this.open=!0,this._loadSessions(),this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".search-input");e&&e.focus()})}hide(){this.open=!1}async _loadSessions(){if(this.rpcConnected){this._loading=!0;try{const e=await this.rpcExtract("LLMService.history_list_sessions",50);Array.isArray(e)&&(this._sessions=e)}catch(e){console.warn("Failed to load sessions:",e)}finally{this._loading=!1}}}async _selectSession(e){if(!(e===this._selectedSessionId&&this._sessionMessages.length>0)){this._selectedSessionId=e,this._loadingMessages=!0,this._sessionMessages=[];try{const t=await this.rpcExtract("LLMService.history_get_session",e);Array.isArray(t)&&(this._sessionMessages=t)}catch(t){console.warn("Failed to load session messages:",t)}finally{this._loadingMessages=!1}}}_onSearchInput(e){if(this._searchQuery=e.target.value,clearTimeout(this._debounceTimer),!this._searchQuery.trim()){this._mode="sessions",this._searchResults=[];return}this._debounceTimer=setTimeout(()=>this._runSearch(),300)}async _runSearch(){const e=this._searchQuery.trim();if(!(!e||!this.rpcConnected)){this._mode="search",this._loading=!0;try{const t=await this.rpcExtract("LLMService.history_search",e,null,50);Array.isArray(t)&&(this._searchResults=t)}catch(t){console.warn("Search failed:",t)}finally{this._loading=!1}}}_onSearchKeyDown(e){var t;if(e.key==="Escape")if(e.preventDefault(),this._searchQuery){this._searchQuery="",this._mode="sessions",this._searchResults=[];const i=(t=this.shadowRoot)==null?void 0:t.querySelector(".search-input");i&&(i.value="")}else this.hide()}async _loadSessionIntoContext(){if(!(!this._selectedSessionId||!this.rpcConnected))try{const e=await this.rpcExtract("LLMService.load_session_into_context",this._selectedSessionId);if(e!=null&&e.error){console.warn("Failed to load session:",e.error);return}this.dispatchEvent(new CustomEvent("session-loaded",{detail:{sessionId:e.session_id,messages:e.messages||[],messageCount:e.message_count||0},bubbles:!0,composed:!0})),this.hide()}catch(e){console.warn("Failed to load session:",e)}}_copyMessage(e){const t=e.content||"";navigator.clipboard.writeText(t).then(()=>{this._showToast("Copied to clipboard")})}_pasteToPrompt(e){const t=e.content||"";this.dispatchEvent(new CustomEvent("paste-to-prompt",{detail:{text:t},bubbles:!0,composed:!0})),this.hide()}_showToast(e){this._toast=e,clearTimeout(this._toastTimer),this._toastTimer=setTimeout(()=>{this._toast=null},1500)}_onOverlayClick(e){e.target===e.currentTarget&&this.hide()}_onKeyDown(e){e.key==="Escape"&&this.hide()}_formatTimestamp(e){if(!e)return"";try{const t=new Date(e),s=new Date-t,r=Math.floor(s/(1e3*60*60*24));return r===0?t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):r===1?"Yesterday":r<7?t.toLocaleDateString([],{weekday:"short"}):t.toLocaleDateString([],{month:"short",day:"numeric"})}catch{return""}}_renderSessionItem(e){const t=e.session_id===this._selectedSessionId,i=e.preview||"Empty session",s=this._formatTimestamp(e.timestamp),r=e.message_count||0;return u`
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
    `}_renderSearchResultItem(e){var r;const t=((r=e.content)==null?void 0:r.slice(0,100))||"",i=e.role||"user",s=e.session_id;return u`
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
    `}_renderMessage(e){const t=e.role==="user",i=e.content||"",s=e.images;return u`
      <div class="msg-card ${t?"user":"assistant"}">
        <div class="msg-role">${t?"You":"Assistant"}</div>
        <div class="msg-content">
          ${N(Os(i))}
        </div>
        ${Array.isArray(s)&&s.length>0?u`
          <div class="msg-images">
            ${s.map(r=>u`<img src="${r}" alt="Image">`)}
          </div>
        `:m}
        <div class="msg-actions">
          <button class="msg-action-btn" title="Copy" @click=${()=>this._copyMessage(e)}>📋</button>
          <button class="msg-action-btn" title="Paste to prompt" @click=${()=>this._pasteToPrompt(e)}>↩</button>
        </div>
      </div>
    `}_renderLeftPanel(){return this._loading&&this._sessions.length===0&&this._searchResults.length===0?u`<div class="loading">Loading...</div>`:this._mode==="search"?this._searchResults.length===0?u`<div class="empty-state">No results found</div>`:u`
        <div class="session-list">
          ${this._searchResults.map(e=>this._renderSearchResultItem(e))}
        </div>
      `:this._sessions.length===0?u`<div class="empty-state">No sessions yet</div>`:u`
      <div class="session-list">
        ${this._sessions.map(e=>this._renderSessionItem(e))}
      </div>
    `}_renderRightPanel(){return this._selectedSessionId?this._loadingMessages?u`<div class="loading">Loading messages...</div>`:this._sessionMessages.length===0?u`<div class="empty-state">No messages in this session</div>`:u`
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
    `:u`<div class="empty-state">Select a session to view messages</div>`}render(){return this.open?u`
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

        ${this._toast?u`
          <div class="toast">${this._toast}</div>
        `:m}
      </div>
    `:m}}w(it,"properties",{open:{type:Boolean,reflect:!0},_sessions:{type:Array,state:!0},_selectedSessionId:{type:String,state:!0},_sessionMessages:{type:Array,state:!0},_searchQuery:{type:String,state:!0},_searchResults:{type:Array,state:!0},_loading:{type:Boolean,state:!0},_loadingMessages:{type:Boolean,state:!0},_mode:{type:String,state:!0}}),w(it,"styles",[R,O,T`
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
  `]);customElements.define("ac-history-browser",it);const Gt=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;class st extends E{constructor(){super(),this._state="inactive",this._autoRestart=!1,this._recognition=null,this._supported=!!Gt,this._supported&&(this._recognition=new Gt,this._recognition.continuous=!1,this._recognition.interimResults=!1,this._recognition.lang=navigator.language||"en-US",this._recognition.onstart=()=>{this._state="listening"},this._recognition.onspeechstart=()=>{this._state="speaking"},this._recognition.onspeechend=()=>{this._state==="speaking"&&(this._state="listening")},this._recognition.onresult=e=>{const t=e.results[e.results.length-1];if(t.isFinal){const i=t[0].transcript.trim();i&&this.dispatchEvent(new CustomEvent("transcript",{detail:{text:i},bubbles:!0,composed:!0}))}},this._recognition.onend=()=>{this._autoRestart?setTimeout(()=>{if(this._autoRestart)try{this._recognition.start()}catch(e){console.warn("[SpeechToText] Auto-restart failed:",e),this._autoRestart=!1,this._state="inactive"}},100):this._state="inactive"},this._recognition.onerror=e=>{this._autoRestart&&(e.error==="no-speech"||e.error==="aborted")||(console.warn("[SpeechToText] Recognition error:",e.error),this._autoRestart=!1,this._state="inactive",this.dispatchEvent(new CustomEvent("speech-error",{detail:{error:e.error},bubbles:!0,composed:!0})))})}disconnectedCallback(){if(super.disconnectedCallback(),this._autoRestart=!1,this._recognition)try{this._recognition.stop()}catch{}this._state="inactive"}_toggle(){if(this._recognition)if(this._autoRestart||this._state!=="inactive"){this._autoRestart=!1;try{this._recognition.stop()}catch{}this._state="inactive"}else{this._autoRestart=!0;try{this._recognition.start()}catch(e){console.warn("[SpeechToText] Failed to start:",e),this._autoRestart=!1,this._state="inactive"}}}render(){return this._supported?u`
      <button
        class=${this._state}
        @click=${this._toggle}
        title=${this._state==="inactive"?"Start voice dictation":"Stop voice dictation"}
        aria-label=${this._state==="inactive"?"Start voice dictation":"Stop voice dictation"}
        aria-pressed=${this._state!=="inactive"}
      >🎤</button>
    `:u``}}w(st,"properties",{_state:{type:String,state:!0},_supported:{type:Boolean,state:!0}}),w(st,"styles",[R,T`
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
  `]);customElements.define("ac-speech-to-text",st);class rt extends E{constructor(){super(),this._visible=!1,this._content=null,this._showFull=!1}show(e){this._content=e,this._showFull=!1,this._visible=!0,this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".overlay");t&&t.focus()})}hide(){this._visible=!1,this._content=null,this._showFull=!1}_onOverlayClick(e){e.target===e.currentTarget&&this.hide()}_onKeyDown(e){e.key==="Escape"&&(e.preventDefault(),this.hide())}_toggleFull(){this._showFull=!this._showFull}_formatDate(e){if(!e)return"Unknown";try{return new Date(e).toLocaleString()}catch{return e}}_renderSection(e,t,i=""){return t?u`
      <div class="section">
        <span class="section-label">${e}</span>
        <div class="section-content ${i}">
          ${i==="symbol-map"?t:N(Me(t))}
        </div>
      </div>
    `:m}render(){if(!this._visible||!this._content)return m;const e=this._content,t=e.url_type||"generic",i=!!e.readme,s=!!e.summary,r=!!e.symbol_map,n=!!e.content,a=!!e.error,l=s||i||n,c=this._showFull&&n&&(s||i);return u`
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
            ${e.title?u`
              <span>
                <span class="meta-label">Title:</span>
                <span class="meta-value">${e.title}</span>
              </span>
            `:m}
          </div>

          <!-- Body -->
          <div class="body">
            ${a?u`
              <div class="error-msg">⚠️ ${e.error}</div>
            `:m}

            ${s?this._renderSection("Summary",e.summary,"summary"):m}

            ${i?this._renderSection("README",e.readme):m}

            ${!s&&!i&&n?this._renderSection("Content",e.content):m}

            ${c?this._renderSection("Full Content",e.content):m}

            ${r?this._renderSection("Symbol Map",e.symbol_map,"symbol-map"):m}
          </div>

          <!-- Footer -->
          <div class="footer">
            ${l&&n&&(s||i)?u`
              <button class="footer-btn" @click=${this._toggleFull}>
                ${this._showFull?"Hide Details":"Show Full Content"}
              </button>
            `:m}
          </div>

        </div>
      </div>
    `}}w(rt,"properties",{_visible:{type:Boolean,state:!0},_content:{type:Object,state:!0},_showFull:{type:Boolean,state:!0}}),w(rt,"styles",[R,O,T`
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
  `]);customElements.define("ac-url-content-dialog",rt);function L(){}L.prototype={diff:function(e,t){var i,s=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},r=s.callback;typeof s=="function"&&(r=s,s={});var n=this;function a(y){return y=n.postProcess(y,s),r?(setTimeout(function(){r(y)},0),!0):y}e=this.castInput(e,s),t=this.castInput(t,s),e=this.removeEmpty(this.tokenize(e,s)),t=this.removeEmpty(this.tokenize(t,s));var l=t.length,c=e.length,h=1,d=l+c;s.maxEditLength!=null&&(d=Math.min(d,s.maxEditLength));var g=(i=s.timeout)!==null&&i!==void 0?i:1/0,v=Date.now()+g,_=[{oldPos:-1,lastComponent:void 0}],x=this.extractCommon(_[0],t,e,0,s);if(_[0].oldPos+1>=c&&x+1>=l)return a(Zt(n,_[0].lastComponent,t,e,n.useLongestToken));var p=-1/0,f=1/0;function b(){for(var y=Math.max(p,-h);y<=Math.min(f,h);y+=2){var I=void 0,se=_[y-1],re=_[y+1];se&&(_[y-1]=void 0);var Oe=!1;if(re){var St=re.oldPos-y;Oe=re&&0<=St&&St<l}var kt=se&&se.oldPos+1<c;if(!Oe&&!kt){_[y]=void 0;continue}if(!kt||Oe&&se.oldPos<re.oldPos?I=n.addToPath(re,!0,!1,0,s):I=n.addToPath(se,!1,!0,1,s),x=n.extractCommon(I,t,e,y,s),I.oldPos+1>=c&&x+1>=l)return a(Zt(n,I.lastComponent,t,e,n.useLongestToken));_[y]=I,I.oldPos+1>=c&&(f=Math.min(f,y-1)),x+1>=l&&(p=Math.max(p,y+1))}h++}if(r)(function y(){setTimeout(function(){if(h>d||Date.now()>v)return r();b()||y()},0)})();else for(;h<=d&&Date.now()<=v;){var $=b();if($)return $}},addToPath:function(e,t,i,s,r){var n=e.lastComponent;return n&&!r.oneChangePerToken&&n.added===t&&n.removed===i?{oldPos:e.oldPos+s,lastComponent:{count:n.count+1,added:t,removed:i,previousComponent:n.previousComponent}}:{oldPos:e.oldPos+s,lastComponent:{count:1,added:t,removed:i,previousComponent:n}}},extractCommon:function(e,t,i,s,r){for(var n=t.length,a=i.length,l=e.oldPos,c=l-s,h=0;c+1<n&&l+1<a&&this.equals(i[l+1],t[c+1],r);)c++,l++,h++,r.oneChangePerToken&&(e.lastComponent={count:1,previousComponent:e.lastComponent,added:!1,removed:!1});return h&&!r.oneChangePerToken&&(e.lastComponent={count:h,previousComponent:e.lastComponent,added:!1,removed:!1}),e.oldPos=l,c},equals:function(e,t,i){return i.comparator?i.comparator(e,t):e===t||i.ignoreCase&&e.toLowerCase()===t.toLowerCase()},removeEmpty:function(e){for(var t=[],i=0;i<e.length;i++)e[i]&&t.push(e[i]);return t},castInput:function(e){return e},tokenize:function(e){return Array.from(e)},join:function(e){return e.join("")},postProcess:function(e){return e}};function Zt(o,e,t,i,s){for(var r=[],n;e;)r.push(e),n=e.previousComponent,delete e.previousComponent,e=n;r.reverse();for(var a=0,l=r.length,c=0,h=0;a<l;a++){var d=r[a];if(d.removed)d.value=o.join(i.slice(h,h+d.count)),h+=d.count;else{if(!d.added&&s){var g=t.slice(c,c+d.count);g=g.map(function(v,_){var x=i[h+_];return x.length>v.length?x:v}),d.value=o.join(g)}else d.value=o.join(t.slice(c,c+d.count));c+=d.count,d.added||(h+=d.count)}}return r}function ei(o,e){var t;for(t=0;t<o.length&&t<e.length;t++)if(o[t]!=e[t])return o.slice(0,t);return o.slice(0,t)}function ti(o,e){var t;if(!o||!e||o[o.length-1]!=e[e.length-1])return"";for(t=0;t<o.length&&t<e.length;t++)if(o[o.length-(t+1)]!=e[e.length-(t+1)])return o.slice(-t);return o.slice(-t)}function nt(o,e,t){if(o.slice(0,e.length)!=e)throw Error("string ".concat(JSON.stringify(o)," doesn't start with prefix ").concat(JSON.stringify(e),"; this is a bug"));return t+o.slice(e.length)}function ot(o,e,t){if(!e)return o+t;if(o.slice(-e.length)!=e)throw Error("string ".concat(JSON.stringify(o)," doesn't end with suffix ").concat(JSON.stringify(e),"; this is a bug"));return o.slice(0,-e.length)+t}function le(o,e){return nt(o,e,"")}function Ee(o,e){return ot(o,e,"")}function ii(o,e){return e.slice(0,Us(o,e))}function Us(o,e){var t=0;o.length>e.length&&(t=o.length-e.length);var i=e.length;o.length<e.length&&(i=o.length);var s=Array(i),r=0;s[0]=0;for(var n=1;n<i;n++){for(e[n]==e[r]?s[n]=s[r]:s[n]=r;r>0&&e[n]!=e[r];)r=s[r];e[n]==e[r]&&r++}r=0;for(var a=t;a<o.length;a++){for(;r>0&&o[a]!=e[r];)r=s[r];o[a]==e[r]&&r++}return r}var Fe="a-zA-Z0-9_\\u{C0}-\\u{FF}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}",js=new RegExp("[".concat(Fe,"]+|\\s+|[^").concat(Fe,"]"),"ug"),$e=new L;$e.equals=function(o,e,t){return t.ignoreCase&&(o=o.toLowerCase(),e=e.toLowerCase()),o.trim()===e.trim()};$e.tokenize=function(o){var e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},t;if(e.intlSegmenter){if(e.intlSegmenter.resolvedOptions().granularity!="word")throw new Error('The segmenter passed must have a granularity of "word"');t=Array.from(e.intlSegmenter.segment(o),function(r){return r.segment})}else t=o.match(js)||[];var i=[],s=null;return t.forEach(function(r){/\s/.test(r)?s==null?i.push(r):i.push(i.pop()+r):/\s/.test(s)?i[i.length-1]==s?i.push(i.pop()+r):i.push(s+r):i.push(r),s=r}),i};$e.join=function(o){return o.map(function(e,t){return t==0?e:e.replace(/^\s+/,"")}).join("")};$e.postProcess=function(o,e){if(!o||e.oneChangePerToken)return o;var t=null,i=null,s=null;return o.forEach(function(r){r.added?i=r:r.removed?s=r:((i||s)&&si(t,s,i,r),t=r,i=null,s=null)}),(i||s)&&si(t,s,i,null),o};function qs(o,e,t){return $e.diff(o,e,t)}function si(o,e,t,i){if(e&&t){var s=e.value.match(/^\s*/)[0],r=e.value.match(/\s*$/)[0],n=t.value.match(/^\s*/)[0],a=t.value.match(/\s*$/)[0];if(o){var l=ei(s,n);o.value=ot(o.value,n,l),e.value=le(e.value,l),t.value=le(t.value,l)}if(i){var c=ti(r,a);i.value=nt(i.value,a,c),e.value=Ee(e.value,c),t.value=Ee(t.value,c)}}else if(t)o&&(t.value=t.value.replace(/^\s*/,"")),i&&(i.value=i.value.replace(/^\s*/,""));else if(o&&i){var h=i.value.match(/^\s*/)[0],d=e.value.match(/^\s*/)[0],g=e.value.match(/\s*$/)[0],v=ei(h,d);e.value=le(e.value,v);var _=ti(le(h,v),g);e.value=Ee(e.value,_),i.value=nt(i.value,h,_),o.value=ot(o.value,h,h.slice(0,h.length-_.length))}else if(i){var x=i.value.match(/^\s*/)[0],p=e.value.match(/\s*$/)[0],f=ii(p,x);e.value=Ee(e.value,f)}else if(o){var b=o.value.match(/\s*$/)[0],$=e.value.match(/^\s*/)[0],y=ii(b,$);e.value=le(e.value,y)}}var Ns=new L;Ns.tokenize=function(o){var e=new RegExp("(\\r?\\n)|[".concat(Fe,"]+|[^\\S\\n\\r]+|[^").concat(Fe,"]"),"ug");return o.match(e)||[]};var ze=new L;ze.tokenize=function(o,e){e.stripTrailingCr&&(o=o.replace(/\r\n/g,`
`));var t=[],i=o.split(/(\n|\r\n)/);i[i.length-1]||i.pop();for(var s=0;s<i.length;s++){var r=i[s];s%2&&!e.newlineIsToken?t[t.length-1]+=r:t.push(r)}return t};ze.equals=function(o,e,t){return t.ignoreWhitespace?((!t.newlineIsToken||!o.includes(`
`))&&(o=o.trim()),(!t.newlineIsToken||!e.includes(`
`))&&(e=e.trim())):t.ignoreNewlineAtEof&&!t.newlineIsToken&&(o.endsWith(`
`)&&(o=o.slice(0,-1)),e.endsWith(`
`)&&(e=e.slice(0,-1))),L.prototype.equals.call(this,o,e,t)};function Hs(o,e,t){return ze.diff(o,e,t)}var Bs=new L;Bs.tokenize=function(o){return o.split(/(\S.+?[.!?])(?=\s+|$)/)};var Vs=new L;Vs.tokenize=function(o){return o.split(/([{}:;,]|\s+)/)};function at(o){"@babel/helpers - typeof";return at=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(e){return typeof e}:function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},at(o)}var xe=new L;xe.useLongestToken=!0;xe.tokenize=ze.tokenize;xe.castInput=function(o,e){var t=e.undefinedReplacement,i=e.stringifyReplacer,s=i===void 0?function(r,n){return typeof n>"u"?t:n}:i;return typeof o=="string"?o:JSON.stringify(lt(o,null,null,s),s,"  ")};xe.equals=function(o,e,t){return L.prototype.equals.call(xe,o.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"),t)};function lt(o,e,t,i,s){e=e||[],t=t||[],i&&(o=i(s,o));var r;for(r=0;r<e.length;r+=1)if(e[r]===o)return t[r];var n;if(Object.prototype.toString.call(o)==="[object Array]"){for(e.push(o),n=new Array(o.length),t.push(n),r=0;r<o.length;r+=1)n[r]=lt(o[r],e,t,i,s);return e.pop(),t.pop(),n}if(o&&o.toJSON&&(o=o.toJSON()),at(o)==="object"&&o!==null){e.push(o),n={},t.push(n);var a=[],l;for(l in o)Object.prototype.hasOwnProperty.call(o,l)&&a.push(l);for(a.sort(),r=0;r<a.length;r+=1)l=a[r],n[l]=lt(o[l],e,t,i,l);e.pop(),t.pop()}else n=o;return n}var ct=new L;ct.tokenize=function(o){return o.slice()};ct.join=ct.removeEmpty=function(o){return o};const Je="««« EDIT",Ws="═══════ REPL",Ks="»»» EDIT END";function ri(o){const e=o.trim();return!e||e.length>200||/^[#\/*\->]|^```/.test(e)?!1:!!(e.includes("/")||e.includes("\\")||/^[\w\-.]+\.\w+$/.test(e))}function Js(o){const e=o.split(`
`),t=[];let i=[],s="text",r="",n=[],a=[];function l(){i.length>0&&(t.push({type:"text",content:i.join(`
`)}),i=[])}for(let c=0;c<e.length;c++){const h=e[c],d=h.trim();if(s==="text")ri(d)&&d!==Je?(r=d,s="expect_edit"):i.push(h);else if(s==="expect_edit")d===Je?(i.length>0&&/^`{3,}\s*\w*$/.test(i[i.length-1].trim())&&i.pop(),l(),n=[],a=[],s="old"):ri(d)&&d!==Je?(i.push(r),r=d):(i.push(r),i.push(h),r="",s="text");else if(s==="old")d===Ws||d.startsWith("═══════")?s="new":n.push(h);else if(s==="new")if(d===Ks){const g=n.length===0;t.push({type:"edit",filePath:r,oldLines:[...n],newLines:[...a],isCreate:g}),r="",n=[],a=[],s="text",c+1<e.length&&/^`{3,}\s*$/.test(e[c+1].trim())&&c++}else a.push(h)}return s==="old"||s==="new"?t.push({type:"edit-pending",filePath:r,oldLines:[...n],newLines:[...a]}):(s==="expect_edit"&&i.push(r),l()),t}function ni(o){if(o.length===0)return o;const e=[o[0]];for(let t=1;t<o.length;t++){const i=e[e.length-1];o[t].type===i.type?i.text+=o[t].text:e.push(o[t])}return e}function Qs(o,e){const t=qs(o,e),i=[],s=[];for(const r of t)r.added?s.push({type:"insert",text:r.value}):r.removed?i.push({type:"delete",text:r.value}):(i.push({type:"equal",text:r.value}),s.push({type:"equal",text:r.value}));return{old:ni(i),new:ni(s)}}function Xs(o,e){const t=o.join(`
`),i=e.join(`
`),s=Hs(t,i),r=[];for(const a of s){const l=a.value.replace(/\n$/,"").split(`
`);for(const c of l)a.added?r.push({type:"add",text:c}):a.removed?r.push({type:"remove",text:c}):r.push({type:"context",text:c})}let n=0;for(;n<r.length;){const a=n;for(;n<r.length&&r[n].type==="remove";)n++;const l=n,c=n;for(;n<r.length&&r[n].type==="add";)n++;const h=n,d=l-a,g=h-c;if(d>0&&g>0){const v=Math.min(d,g);for(let _=0;_<v;_++){const x=Qs(r[a+_].text,r[c+_].text);r[a+_].charDiff=x.old,r[c+_].charDiff=x.new}}n===a&&n++}return r}function oi(o,e,t,i=[]){if(!e||e.length===0)return{html:o,referencedFiles:[]};const s=new Set(t||[]),r=new Set(i),n=e.filter(p=>o.includes(p));if(n.length===0)return{html:o,referencedFiles:[...r]};n.sort((p,f)=>f.length-p.length);const a=n.map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),l=new RegExp("("+a.join("|")+")","g"),c=[];let h=!1;const d=/<\/?[a-zA-Z][^>]*>/g;let g;const v=[];for(;(g=d.exec(o))!==null;)v.push({index:g.index,end:g.index+g[0].length,tag:g[0]});let _=0,x=0;for(;x<o.length;){for(;_<v.length&&v[_].end<=x;)_++;const p=_<v.length?v[_]:null,f=p?p.index:o.length;if(x<f&&!h){const $=o.slice(x,f).replace(l,y=>(r.add(y),`<span class="${s.has(y)?"file-mention in-context":"file-mention"}" data-file="${C(y)}">${C(y)}</span>`));c.push($)}else x<f&&c.push(o.slice(x,f));if(p){c.push(p.tag);const b=p.tag.toLowerCase();b.startsWith("<pre")?h=!0:b.startsWith("</pre")&&(h=!1),x=p.end}else x=f}return{html:c.join(""),referencedFiles:[...r]}}function Ys(o,e){if(!o||o.length===0)return"";const t=new Set(e||[]),i=o.filter(a=>t.has(a)),s=o.filter(a=>!t.has(a)),r=[];for(const a of i){const l=a.split("/").pop();r.push(`<span class="file-chip in-context" data-file="${C(a)}" title="${C(a)}">✓ ${C(l)}</span>`)}for(const a of s){const l=a.split("/").pop();r.push(`<span class="file-chip addable" data-file="${C(a)}" title="${C(a)}">+ ${C(l)}</span>`)}return`<div class="file-summary"><span class="file-summary-label">📁 Files Referenced</span>${s.length>=2?`<button class="add-all-btn" data-files='${JSON.stringify(s).replace(/'/g,"&#39;")}'>+ Add All (${s.length})</button>`:""}<div class="file-chips">${r.join("")}</div></div>`}function C(o){return o.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}class dt extends U(E){constructor(){super(),this.messages=[],this.selectedFiles=[],this.streamingActive=!1,this.reviewState={active:!1},this._streamingContent="",this._inputValue="",this._images=[],this._autoScroll=!0,this._snippetDrawerOpen=this._loadBoolPref("ac-dc-snippet-drawer",!1),this._historyOpen=!1,this._snippets=[],this._observer=null,this._pendingChunk=null,this._rafId=null,this._currentRequestId=null,this._confirmAction=null,this._toast=null,this._committing=!1,this._repoFiles=[],this._chatSearchQuery="",this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._atFilterActive=!1,this._onStreamChunk=this._onStreamChunk.bind(this),this._onStreamComplete=this._onStreamComplete.bind(this),this._onViewUrlContent=this._onViewUrlContent.bind(this),this._onCompactionEvent=this._onCompactionEvent.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-chunk",this._onStreamChunk),window.addEventListener("stream-complete",this._onStreamComplete),window.addEventListener("compaction-event",this._onCompactionEvent),this.addEventListener("view-url-content",this._onViewUrlContent)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-chunk",this._onStreamChunk),window.removeEventListener("stream-complete",this._onStreamComplete),window.removeEventListener("compaction-event",this._onCompactionEvent),this.removeEventListener("view-url-content",this._onViewUrlContent),this._rafId&&cancelAnimationFrame(this._rafId),this._observer&&this._observer.disconnect()}firstUpdated(){const e=this.shadowRoot.querySelector(".scroll-sentinel"),t=this.shadowRoot.querySelector(".messages");e&&t&&(this._observer=new IntersectionObserver(([i])=>{i.isIntersecting?this._autoScroll=!0:this.streamingActive||(this._autoScroll=!1)},{root:t,threshold:.01}),this._observer.observe(e),this._lastScrollTop=0,t.addEventListener("scroll",()=>{this.streamingActive&&t.scrollTop<this._lastScrollTop-30&&(this._autoScroll=!1),this._lastScrollTop=t.scrollTop},{passive:!0})),this.messages.length>0&&requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom()))}onRpcReady(){this._loadSnippets(),this._loadRepoFiles()}updated(e){if(super.updated(e),e.has("reviewState")&&this._loadSnippets(),e.has("messages")&&!this.streamingActive){const t=e.get("messages");(!t||t.length===0)&&this.messages.length>0&&(this._autoScroll=!0,requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom())))}}async _loadRepoFiles(){try{const e=await this.rpcExtract("Repo.get_flat_file_list");Array.isArray(e)?this._repoFiles=e:e!=null&&e.files&&Array.isArray(e.files)&&(this._repoFiles=e.files)}catch(e){console.warn("Failed to load repo files:",e)}}async _loadSnippets(){try{const e=await this.rpcExtract("LLMService.get_snippets");Array.isArray(e)&&(this._snippets=e)}catch(e){console.warn("Failed to load snippets:",e)}}_onStreamChunk(e){const{requestId:t,content:i}=e.detail;t===this._currentRequestId&&(this.streamingActive=!0,this._pendingChunk=i,this._rafId||(this._rafId=requestAnimationFrame(()=>{this._rafId=null,this._pendingChunk!==null&&(this._streamingContent=this._pendingChunk,this._pendingChunk=null,this._autoScroll&&this.updateComplete.then(()=>{requestAnimationFrame(()=>this._scrollToBottom())}))})))}_onStreamComplete(e){var s;const{requestId:t,result:i}=e.detail;if(t===this._currentRequestId){if(this._pendingChunk!==null&&(this._streamingContent=this._pendingChunk,this._pendingChunk=null),this.streamingActive=!1,this._currentRequestId=null,i!=null&&i.error)this.messages=[...this.messages,{role:"assistant",content:`**Error:** ${i.error}`}];else if(i!=null&&i.response){const r={};if(i.edit_results){r.editResults={};for(const n of i.edit_results)r.editResults[n.file]={status:n.status,message:n.message}}(i.passed||i.failed||i.skipped||i.not_in_context)&&(r.passed=i.passed||0,r.failed=i.failed||0,r.skipped=i.skipped||0,r.not_in_context=i.not_in_context||0,i.files_auto_added&&(r.files_auto_added=i.files_auto_added)),this.messages=[...this.messages,{role:"assistant",content:i.response,...Object.keys(r).length>0?r:{}}]}if(this._streamingContent="",this._pendingChunk=null,this._autoScroll&&this.updateComplete.then(()=>{requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom()))}),((s=i==null?void 0:i.files_modified)==null?void 0:s.length)>0&&(this.dispatchEvent(new CustomEvent("files-modified",{detail:{files:i.files_modified},bubbles:!0,composed:!0})),this._loadRepoFiles()),i!=null&&i.edit_results){const r=i.edit_results.filter(n=>n.status==="failed"&&n.message&&n.message.includes("Ambiguous anchor"));r.length>0&&this._populateAmbiguousRetryPrompt(r)}}}_onCompactionEvent(e){const{requestId:t,event:i}=e.detail||{};if(t!==this._currentRequestId)return;const s=(i==null?void 0:i.stage)||"",r=(i==null?void 0:i.message)||"";(s==="url_fetch"||s==="url_ready")&&this._showToast(r,s==="url_ready"?"success":"")}_populateAmbiguousRetryPrompt(e){var r;const i=`Some edits failed due to ambiguous anchors (the context lines matched multiple locations in the file). Please retry these edits with more unique anchor context — include a distinctive preceding line (like a function name, class definition, or unique comment) to disambiguate:

`+e.map(n=>`- ${n.file}: ${n.message}`).join(`
`);this._inputValue=i;const s=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");s&&(s.value=i,this._autoResize(s),s.focus())}_scrollToBottom(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".messages");e&&(e.scrollTop=e.scrollHeight+1e3)}_onScrollBtnClick(){this._autoScroll=!0,this._scrollToBottom()}_onInput(e){this._inputValue=e.target.value,this._autoResize(e.target),this._onInputForUrlDetection(),this._checkAtFilter(this._inputValue)}_autoResize(e){e.style.height="auto",e.style.height=Math.min(e.scrollHeight,200)+"px"}_onKeyDown(e){var i,s;const t=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-input-history");if(!(t!=null&&t.open&&t.handleKey(e))){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(),this._send();return}if(e.key==="ArrowUp"){const r=e.target;if(r.selectionStart===0&&r.selectionEnd===0){e.preventDefault(),t&&(t.show(this._inputValue),this._historyOpen=!0);return}}if(e.key==="Escape"){if(e.preventDefault(),this._atFilterActive)this._clearAtFilter();else if(this._snippetDrawerOpen)this._snippetDrawerOpen=!1;else if(this._inputValue){this._inputValue="";const r=(s=this.shadowRoot)==null?void 0:s.querySelector(".input-textarea");r&&(r.value="",r.style.height="auto")}}}}_onPaste(e){var i;if(this._suppressNextPaste){this._suppressNextPaste=!1,e.preventDefault();return}const t=(i=e.clipboardData)==null?void 0:i.items;if(t){for(const s of t)if(s.type.startsWith("image/")){e.preventDefault();const r=s.getAsFile();if(!r)continue;if(r.size>5*1024*1024){console.warn("Image too large (max 5MB)");continue}if(this._images.length>=5){console.warn("Max 5 images per message");continue}const n=new FileReader;n.onload=()=>{this._images=[...this._images,n.result]},n.readAsDataURL(r);break}}}_removeImage(e){this._images=this._images.filter((t,i)=>i!==e)}async _send(){var c,h,d,g;const e=this._inputValue.trim();if(!e&&this._images.length===0||!this.rpcConnected)return;const t=(c=this.shadowRoot)==null?void 0:c.querySelector("ac-input-history");t&&e&&t.addEntry(e);const i=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;this._currentRequestId=i;const s=this._images.length>0?[...this._images]:null,r=((h=this.selectedFiles)==null?void 0:h.length)>0?[...this.selectedFiles]:null,n=(d=this.shadowRoot)==null?void 0:d.querySelector("ac-url-chips");n==null||n.onSend();const a={role:"user",content:e};s&&s.length>0&&(a.images=[...s]),this.messages=[...this.messages,a],this._inputValue="",this._images=[],this._snippetDrawerOpen=!1,this._saveBoolPref("ac-dc-snippet-drawer",!1);const l=(g=this.shadowRoot)==null?void 0:g.querySelector(".input-textarea");l&&(l.value="",l.style.height="auto"),this._autoScroll=!0,this.streamingActive=!0,requestAnimationFrame(()=>this._scrollToBottom());try{await this.rpcExtract("LLMService.chat_streaming",i,e,r,s)}catch(v){console.error("Failed to start stream:",v),this.streamingActive=!1,this._currentRequestId=null;const _=v.message||"Failed to connect";this.messages=[...this.messages,{role:"assistant",content:`**Error:** ${_}`}],this._showToast(`Stream failed: ${_}`,"error")}}async _stop(){if(!(!this._currentRequestId||!this.rpcConnected))try{await this.rpcExtract("LLMService.cancel_streaming",this._currentRequestId)}catch(e){console.error("Failed to cancel:",e)}}_toggleSnippets(){this._snippetDrawerOpen=!this._snippetDrawerOpen,this._saveBoolPref("ac-dc-snippet-drawer",this._snippetDrawerOpen)}_saveBoolPref(e,t){try{localStorage.setItem(e,String(t))}catch{}}_loadBoolPref(e,t){try{const i=localStorage.getItem(e);return i===null?t:i==="true"}catch{return t}}_insertSnippet(e){var l;const t=(l=this.shadowRoot)==null?void 0:l.querySelector(".input-textarea");if(!t)return;const i=e.message||"",s=t.selectionStart,r=this._inputValue.slice(0,s),n=this._inputValue.slice(t.selectionEnd);this._inputValue=r+i+n,t.value=this._inputValue,this._autoResize(t);const a=s+i.length;t.setSelectionRange(a,a),t.focus()}_onHistorySelect(e){var s,r;const t=((s=e.detail)==null?void 0:s.text)??"";this._inputValue=t,this._historyOpen=!1;const i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");i&&(i.value=t,this._autoResize(i),i.focus())}_onHistoryCancel(e){var s,r;const t=((s=e.detail)==null?void 0:s.text)??"";this._inputValue=t,this._historyOpen=!1;const i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");i&&(i.value=t,i.focus())}_onInputForUrlDetection(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-url-chips");e&&e.detectUrls(this._inputValue)}_onTranscript(e){var s,r;const t=(s=e.detail)==null?void 0:s.text;if(!t)return;const i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");this._inputValue&&!this._inputValue.endsWith(" ")&&(this._inputValue+=" "),this._inputValue+=t,i&&(i.value=this._inputValue,this._autoResize(i)),this._onInputForUrlDetection()}async _newSession(){var e;if(this.rpcConnected)try{await this.rpcExtract("LLMService.new_session"),this.messages=[],this._streamingContent="",this._currentRequestId=null,this.streamingActive=!1,this._chatSearchQuery="",this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._clearSearchHighlights();const t=(e=this.shadowRoot)==null?void 0:e.querySelector("ac-url-chips");t&&t.clear(),this._showToast("New session started","success")}catch(t){console.error("Failed to start new session:",t),this._showToast("Failed to start new session","error")}}_openHistoryBrowser(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-history-browser");e&&e.show()}_onSessionLoaded(e){const{messages:t,sessionId:i}=e.detail;Array.isArray(t)&&(this.messages=[...t],this._autoScroll=!0,requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom()))),this.dispatchEvent(new CustomEvent("session-loaded",{detail:{sessionId:i,messages:t},bubbles:!0,composed:!0}))}_onPasteToPrompt(e){var s,r;const t=((s=e.detail)==null?void 0:s.text)||"";if(!t)return;const i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea");i&&(this._inputValue=t,i.value=t,this._autoResize(i),i.focus())}async _onViewUrlContent(e){var i,s;const t=(i=e.detail)==null?void 0:i.url;if(!(!t||!this.rpcConnected))try{const r=await this.rpcExtract("LLMService.get_url_content",t);if(!r){this._showToast("Failed to load URL content","error");return}const n=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-url-content-dialog");n&&n.show(r)}catch(r){console.error("Failed to load URL content:",r),this._showToast("Failed to load URL content","error")}}async _copyDiff(){if(this.rpcConnected)try{const e=await this.rpcExtract("Repo.get_staged_diff"),t=await this.rpcExtract("Repo.get_unstaged_diff"),i=(e==null?void 0:e.diff)||"",s=(t==null?void 0:t.diff)||"",r=[i,s].filter(Boolean).join(`
`);if(!r.trim()){this._showToast("No changes to copy","error");return}await navigator.clipboard.writeText(r),this._showToast("Diff copied to clipboard","success")}catch(e){console.error("Failed to copy diff:",e),this._showToast("Failed to copy diff","error")}}async _commitWithMessage(){var t;if(!this.rpcConnected||this._committing)return;this._committing=!0;const e={role:"assistant",content:"⏳ **Staging changes and generating commit message...**"};this.messages=[...this.messages,e],this._autoScroll&&requestAnimationFrame(()=>this._scrollToBottom());try{const i=await this.rpcExtract("Repo.stage_all");if(i!=null&&i.error){this._removeProgressMsg(e),this._showToast(`Stage failed: ${i.error}`,"error");return}const s=await this.rpcExtract("Repo.get_staged_diff"),r=(s==null?void 0:s.diff)||"";if(!r.trim()){this._removeProgressMsg(e),this._showToast("Nothing to commit","error");return}const n=await this.rpcExtract("LLMService.generate_commit_message",r);if(n!=null&&n.error){this._removeProgressMsg(e),this._showToast(`Message generation failed: ${n.error}`,"error");return}const a=n==null?void 0:n.message;if(!a){this._removeProgressMsg(e),this._showToast("Failed to generate commit message","error");return}const l=await this.rpcExtract("Repo.commit",a);if(l!=null&&l.error){this._removeProgressMsg(e),this._showToast(`Commit failed: ${l.error}`,"error");return}const c=((t=l==null?void 0:l.sha)==null?void 0:t.slice(0,7))||"";this._showToast(`Committed ${c}: ${a.split(`
`)[0]}`,"success");const h=this.messages.filter(d=>d!==e);this.messages=[...h,{role:"assistant",content:`**Committed** \`${c}\`

\`\`\`
${a}
\`\`\``}],this._autoScroll&&requestAnimationFrame(()=>this._scrollToBottom()),this.dispatchEvent(new CustomEvent("files-modified",{detail:{files:[]},bubbles:!0,composed:!0}))}catch(i){console.error("Commit failed:",i),this._removeProgressMsg(e),this._showToast(`Commit failed: ${i.message||"Unknown error"}`,"error")}finally{this._committing=!1}}_removeProgressMsg(e){this.messages=this.messages.filter(t=>t!==e)}_confirmReset(){this._confirmAction={title:"Reset to HEAD",message:"This will discard ALL uncommitted changes (staged and unstaged). This cannot be undone.",action:()=>this._resetHard()},this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".confirm-cancel");e&&e.focus()})}async _resetHard(){if(this._confirmAction=null,!!this.rpcConnected)try{const e=await this.rpcExtract("Repo.reset_hard");if(e!=null&&e.error){this._showToast(`Reset failed: ${e.error}`,"error");return}this._showToast("Reset to HEAD — all changes discarded","success"),this.dispatchEvent(new CustomEvent("files-modified",{detail:{files:[]},bubbles:!0,composed:!0}))}catch(e){console.error("Reset failed:",e),this._showToast(`Reset failed: ${e.message||"Unknown error"}`,"error")}}_dismissConfirm(){this._confirmAction=null}_showToast(e,t=""){this._toast={message:e,type:t},clearTimeout(this._toastTimer),this._toastTimer=setTimeout(()=>{this._toast=null},3e3)}_onChatSearchInput(e){this._chatSearchQuery=e.target.value,this._updateChatSearchMatches()}_onChatSearchKeyDown(e){e.key==="Enter"?(e.preventDefault(),e.shiftKey?this._chatSearchPrev():this._chatSearchNext()):e.key==="Escape"&&(e.preventDefault(),this._clearChatSearch(),e.target.blur())}_updateChatSearchMatches(){const e=this._chatSearchQuery.trim().toLowerCase();if(!e){this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._clearSearchHighlights();return}const t=[];for(let i=0;i<this.messages.length;i++)(this.messages[i].content||"").toLowerCase().includes(e)&&t.push(i);this._chatSearchMatches=t,t.length>0?(this._chatSearchCurrent=0,this._scrollToSearchMatch(t[0])):(this._chatSearchCurrent=-1,this._clearSearchHighlights())}_chatSearchNext(){this._chatSearchMatches.length!==0&&(this._chatSearchCurrent=(this._chatSearchCurrent+1)%this._chatSearchMatches.length,this._scrollToSearchMatch(this._chatSearchMatches[this._chatSearchCurrent]))}_chatSearchPrev(){this._chatSearchMatches.length!==0&&(this._chatSearchCurrent=(this._chatSearchCurrent-1+this._chatSearchMatches.length)%this._chatSearchMatches.length,this._scrollToSearchMatch(this._chatSearchMatches[this._chatSearchCurrent]))}_scrollToSearchMatch(e){this._clearSearchHighlights(),this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(`.message-card[data-msg-index="${e}"]`);t&&(t.classList.add("search-highlight"),t.scrollIntoView({block:"center",behavior:"smooth"}))})}_clearSearchHighlights(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelectorAll(".message-card.search-highlight");if(e)for(const i of e)i.classList.remove("search-highlight")}_clearChatSearch(){this._chatSearchQuery="",this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._clearSearchHighlights()}_getReviewDiffCount(){var t;if(!((t=this.reviewState)!=null&&t.active)||!this.reviewState.changed_files)return 0;const e=new Set(this.reviewState.changed_files.map(i=>i.path));return(this.selectedFiles||[]).filter(i=>e.has(i)).length}_checkAtFilter(e){const t=e.match(/@(\S*)$/);t?(this._atFilterActive=!0,this.dispatchEvent(new CustomEvent("filter-from-chat",{detail:{filter:t[1]},bubbles:!0,composed:!0}))):this._atFilterActive&&(this._atFilterActive=!1,this.dispatchEvent(new CustomEvent("filter-from-chat",{detail:{filter:""},bubbles:!0,composed:!0})))}_clearAtFilter(){var t;if(!this._atFilterActive)return!1;const e=this._inputValue.match(/@\S*$/);if(e){this._inputValue=this._inputValue.slice(0,e.index).trimEnd();const i=(t=this.shadowRoot)==null?void 0:t.querySelector(".input-textarea");i&&(i.value=this._inputValue,this._autoResize(i))}return this._atFilterActive=!1,this.dispatchEvent(new CustomEvent("filter-from-chat",{detail:{filter:""},bubbles:!0,composed:!0})),!0}accumulateFileInInput(e){var r;const t=e.split("/").pop(),i=(r=this.shadowRoot)==null?void 0:r.querySelector(".input-textarea"),s=this._inputValue.trim();if(!s)this._inputValue=`The file ${t} added. Do you want to see more files before you continue?`;else if(/^The file .+ added\./.test(s)||/\(added .+\)$/.test(s))if(s.includes("Do you want to see more files")){const n=s.match(/^The file (.+?) added\./);if(n)this._inputValue=`The files ${n[1]}, ${t} added. Do you want to see more files before you continue?`;else{const a=s.match(/^The files (.+?) added\./);a&&(this._inputValue=`The files ${a[1]}, ${t} added. Do you want to see more files before you continue?`)}}else this._inputValue=s+` (added ${t})`;else this._inputValue=s+` (added ${t})`;i&&(i.value=this._inputValue,this._autoResize(i))}_getMessageText(e){const t=e.content;return Array.isArray(t)?t.filter(i=>i.type==="text"&&i.text).map(i=>i.text).join(`
`):t||""}_copyMessageText(e){navigator.clipboard.writeText(this._getMessageText(e)).then(()=>{this._showToast("Copied to clipboard","success")})}_insertMessageText(e){var s;const t=this._getMessageText(e),i=(s=this.shadowRoot)==null?void 0:s.querySelector(".input-textarea");i&&(this._inputValue=t,i.value=t,this._autoResize(i),i.focus())}_renderAssistantContent(e,t,i){const s=t||{},r=Js(e),n=[];for(const a of r)if(a.type==="text"){let l=Me(a.content);if(i&&this._repoFiles.length>0){const{html:c}=oi(l,this._repoFiles,this.selectedFiles,[]);l=c}n.push(l)}else if(a.type==="edit"||a.type==="edit-pending"){const l=s[a.filePath]||{};n.push(this._renderEditBlockHtml(a,l))}return n.join("")}_renderEditBlockHtml(e,t){const i=t.status||(e.type==="edit-pending"?"pending":"unknown"),s=t.message||"";let r="";i==="applied"?r='<span class="edit-badge applied">✅ applied</span>':i==="failed"?r='<span class="edit-badge failed">❌ failed</span>':i==="skipped"?r='<span class="edit-badge skipped">⚠️ skipped</span>':i==="validated"?r='<span class="edit-badge validated">☑ validated</span>':i==="not_in_context"?r='<span class="edit-badge not-in-context">⚠️ not in context</span>':e.isCreate?r='<span class="edit-badge applied">🆕 new</span>':r='<span class="edit-badge pending">⏳ pending</span>';const a=Xs(e.oldLines||[],e.newLines||[]).map(g=>this._renderDiffLineHtml(g)).join(""),l=i==="failed"&&s?`<div class="edit-error">${C(s)}</div>`:"",h=((e.newLines&&e.newLines.length>0?e.newLines:e.oldLines)||[]).slice(0,5).join(`
`).trim(),d=C(h);return`
      <div class="edit-block-card">
        <div class="edit-block-header">
          <span class="edit-file-path" data-path="${C(e.filePath)}">${C(e.filePath)}</span>
          <button class="edit-goto-btn" data-path="${C(e.filePath)}" data-search="${d}" title="Open in diff viewer">↗</button>
          ${r}
        </div>
        ${l}
        <pre class="edit-diff">${a}</pre>
      </div>
    `}_renderDiffLineHtml(e){const t=e.type==="remove"?"-":e.type==="add"?"+":" ";if(e.charDiff&&e.charDiff.length>0){const i=e.charDiff.map(s=>s.type==="equal"?C(s.text):`<span class="diff-change">${C(s.text)}</span>`).join("");return`<span class="diff-line ${e.type}"><span class="diff-line-prefix">${t}</span>${i}</span>`}return`<span class="diff-line ${e.type}"><span class="diff-line-prefix">${t}</span>${C(e.text)}</span>`}_renderEditSummary(e){var n;if(!e.passed&&!e.failed&&!e.skipped&&!e.not_in_context)return m;const t=[];e.passed&&t.push(u`<span class="stat pass">✅ ${e.passed} applied</span>`),e.failed&&t.push(u`<span class="stat fail">❌ ${e.failed} failed</span>`),e.skipped&&t.push(u`<span class="stat skip">⚠️ ${e.skipped} skipped</span>`),e.not_in_context&&t.push(u`<span class="stat skip">⚠️ ${e.not_in_context} not in context</span>`);const i=((n=e.files_auto_added)==null?void 0:n.length)>0?u`<div style="margin-top:4px;font-size:0.75rem;color:var(--text-secondary)">
          ${e.files_auto_added.length} file${e.files_auto_added.length>1?"s were":" was"} added to context. Send a follow-up to retry those edits.
        </div>`:m,r=e.editResults&&Object.values(e.editResults).some(a=>a.status==="failed"&&a.message&&a.message.includes("Ambiguous anchor"))?u`<div style="margin-top:4px;font-size:0.75rem;color:var(--text-secondary)">
          A retry prompt has been prepared in the input below.
        </div>`:m;return u`<div class="edit-summary">${t}${i}${r}</div>`}_renderMsgActions(e){return this.streamingActive?m:u`
      <div class="msg-actions top">
        <button class="msg-action-btn" title="Copy" @click=${()=>this._copyMessageText(e)}>📋</button>
        <button class="msg-action-btn" title="Insert into input" @click=${()=>this._insertMessageText(e)}>↩</button>
      </div>
    `}_renderMsgActionsBottom(e){return this.streamingActive||(e.content||"").length<600?m:u`
      <div class="msg-actions bottom">
        <button class="msg-action-btn" title="Copy" @click=${()=>this._copyMessageText(e)}>📋</button>
        <button class="msg-action-btn" title="Insert into input" @click=${()=>this._insertMessageText(e)}>↩</button>
      </div>
    `}_renderUserContent(e){var r;const t=e.content;if(Array.isArray(t)){const n=[],a=[];for(const l of t)l.type==="text"&&l.text?n.push(u`<div class="md-content" @click=${this._onContentClick}>
            ${N(Me(l.text))}
          </div>`):l.type==="image_url"&&((r=l.image_url)!=null&&r.url)&&a.push(l.image_url.url);return a.length>0&&n.push(u`
          <div class="user-images">
            ${a.map(l=>u`
              <img class="user-image-thumb" src="${l}" alt="User image"
                   @click=${()=>this._openLightbox(l)}>
            `)}
          </div>
        `),n}const i=t||"",s=u`<div class="md-content" @click=${this._onContentClick}>
      ${N(Me(i))}
    </div>`;return e.images&&e.images.length>0?u`
        ${s}
        <div class="user-images">
          ${e.images.map(n=>u`
            <img class="user-image-thumb" src="${n}" alt="User image"
                 @click=${()=>this._openLightbox(n)}>
          `)}
        </div>
      `:s}_openLightbox(e){this._lightboxSrc=e,this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".image-lightbox");t&&t.focus()})}_closeLightbox(e){this._lightboxSrc=null}_onLightboxKeyDown(e){e.key==="Escape"&&(e.preventDefault(),this._lightboxSrc=null)}_renderMessage(e,t){const i=e.role==="user",s=e.content||"",n=this.messages.length-t<=15?" force-visible":"";if(i)return u`
        <div class="message-card user${n}" data-msg-index="${t}">
          ${this._renderMsgActions(e)}
          <div class="role-label">You</div>
          ${this._renderUserContent(e)}
          ${this._renderMsgActionsBottom(e)}
        </div>
      `;const a=e.editResults?Object.keys(e.editResults):[],l=this._renderAssistantContent(s,e.editResults,!0),{html:c,referencedFiles:h}=oi(l,this._repoFiles,this.selectedFiles,a),d=Ys(h,this.selectedFiles);return u`
      <div class="message-card assistant" data-msg-index="${t}">
        ${this._renderMsgActions(e)}
        <div class="role-label">Assistant</div>
        <div class="md-content" @click=${this._onContentClick}>
          ${N(c)}
        </div>
        ${d?u`
          <div class="file-summary-container" @click=${this._onFileSummaryClick}>
            ${N(d)}
          </div>
        `:m}
        ${this._renderEditSummary(e)}
        ${this._renderMsgActionsBottom(e)}
      </div>
    `}_onContentClick(e){const t=e.target.closest(".file-mention");if(t){const n=t.dataset.file;n&&this._dispatchFileMentionClick(n,!0);return}const i=e.target.closest(".edit-file-path");if(i){const n=i.dataset.path;n&&this._dispatchFileMentionClick(n,!1);return}const s=e.target.closest(".edit-goto-btn");if(s){const n=s.dataset.path,a=s.dataset.search||"";n&&window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:n,searchText:a}}));return}const r=e.target.closest(".code-copy-btn");if(r){const n=r.closest("pre");if(n){const a=n.querySelector("code"),l=a?a.textContent:n.textContent;navigator.clipboard.writeText(l).then(()=>{r.textContent="✓ Copied",r.classList.add("copied"),setTimeout(()=>{r.textContent="📋",r.classList.remove("copied")},1500)}).catch(()=>{r.textContent="✗ Failed",setTimeout(()=>{r.textContent="📋"},1500)})}return}}_onFileSummaryClick(e){const t=e.target.closest(".file-chip");if(t){const s=t.dataset.file;s&&this._dispatchFileMentionClick(s,!1);return}const i=e.target.closest(".add-all-btn");if(i)try{const s=JSON.parse(i.dataset.files);if(Array.isArray(s))for(const r of s)this._dispatchFileMentionClick(r,!1)}catch(s){console.warn("Failed to parse add-all files:",s)}}_dispatchFileMentionClick(e,t=!0){this.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:e,navigate:t},bubbles:!0,composed:!0}))}render(){var t,i,s,r,n,a,l,c,h;const e=this.messages.length>0||this._streamingContent;return u`
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
          ${this._chatSearchMatches.length>0?u`
            <span class="chat-search-counter" aria-live="polite">${this._chatSearchCurrent+1}/${this._chatSearchMatches.length}</span>
            <button class="chat-search-nav" title="Previous (Shift+Enter)" aria-label="Previous search result" @click=${this._chatSearchPrev}>▲</button>
            <button class="chat-search-nav" title="Next (Enter)" aria-label="Next search result" @click=${this._chatSearchNext}>▼</button>
          `:m}
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
        ${e?u`
          ${this.messages.map((d,g)=>this._renderMessage(d,g))}

          ${this._streamingContent?u`
            <div class="message-card assistant force-visible">
              <div class="role-label">
                Assistant <span class="streaming-indicator"></span>
              </div>
              <div class="md-content" @click=${this._onContentClick}>
                ${N(this._renderAssistantContent(this._streamingContent,{},!1))}
              </div>
            </div>
          `:m}
        `:u`
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
      ${(r=this.reviewState)!=null&&r.active?u`
        <div class="review-status-bar">
          📋 <strong>${this.reviewState.branch}</strong>
          ${((n=this.reviewState.stats)==null?void 0:n.commit_count)||0} commits ·
          ${((a=this.reviewState.stats)==null?void 0:a.files_changed)||0} files ·
          +${((l=this.reviewState.stats)==null?void 0:l.additions)||0} −${((c=this.reviewState.stats)==null?void 0:c.deletions)||0}
          <span class="review-diff-count">
            ${this._getReviewDiffCount()}/${((h=this.reviewState.stats)==null?void 0:h.files_changed)||0} diffs in context
          </span>
          <button class="review-exit-link" @click=${()=>this.dispatchEvent(new CustomEvent("exit-review",{bubbles:!0,composed:!0}))}>
            Exit Review
          </button>
        </div>
      `:m}

      <!-- Input Area -->
      <div class="input-area">
        <ac-input-history
          @history-select=${this._onHistorySelect}
          @history-cancel=${this._onHistoryCancel}
        ></ac-input-history>

        <ac-url-chips></ac-url-chips>

        ${this._images.length>0?u`
          <div class="image-previews">
            ${this._images.map((d,g)=>u`
              <div class="image-preview">
                <img src="${d}" alt="Pasted image">
                <button class="remove-btn" @click=${()=>this._removeImage(g)}>✕</button>
              </div>
            `)}
          </div>
        `:m}

        ${this._snippetDrawerOpen&&this._snippets.length>0?u`
          <div class="snippet-drawer">
            ${this._snippets.map(d=>{var g;return u`
              <button class="snippet-btn" @click=${()=>this._insertSnippet(d)} title="${d.tooltip||""}">
                ${d.icon||"📌"} ${d.tooltip||((g=d.message)==null?void 0:g.slice(0,30))||"Snippet"}
              </button>
            `})}
          </div>
        `:m}

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

          ${this.streamingActive?u`
            <button class="send-btn stop" @click=${this._stop} title="Stop" aria-label="Stop generation">⏹</button>
          `:u`
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
      ${this._confirmAction?u`
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
      `:m}

      <!-- Toast -->
      ${this._toast?u`
        <div class="toast ${this._toast.type}" role="alert">${this._toast.message}</div>
      `:m}

      <!-- Image Lightbox -->
      ${this._lightboxSrc?u`
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
      `:m}
    `}}w(dt,"properties",{messages:{type:Array},selectedFiles:{type:Array},streamingActive:{type:Boolean},reviewState:{type:Object},_streamingContent:{type:String,state:!0},_inputValue:{type:String,state:!0},_images:{type:Array,state:!0},_autoScroll:{type:Boolean,state:!0},_snippetDrawerOpen:{type:Boolean,state:!0},_historyOpen:{type:Boolean,state:!0},_currentRequestId:{type:String,state:!0},_confirmAction:{type:Object,state:!0},_toast:{type:Object,state:!0},_committing:{type:Boolean,state:!0},_repoFiles:{type:Array,state:!0},_chatSearchQuery:{type:String,state:!0},_chatSearchMatches:{type:Array,state:!0},_chatSearchCurrent:{type:Number,state:!0},_lightboxSrc:{type:String,state:!0}}),w(dt,"styles",[R,O,T`
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

  `]);customElements.define("ac-chat-panel",dt);class ht extends U(E){constructor(){super(),this.selectedFiles=new Set,this._tree=null,this._modified=[],this._staged=[],this._untracked=[],this._diffStats={},this._expanded=new Set,this._filter="",this._focusedPath="",this._contextMenu=null,this._contextInput=null,this._activeInViewer="",this._allFilePaths=[],this._flatVisible=[],this._initialAutoSelect=!1,this._expanded.add(""),this._onDocClick=this._onDocClick.bind(this),this._onActiveFileChanged=this._onActiveFileChanged.bind(this)}connectedCallback(){super.connectedCallback(),document.addEventListener("click",this._onDocClick),window.addEventListener("active-file-changed",this._onActiveFileChanged)}disconnectedCallback(){super.disconnectedCallback(),document.removeEventListener("click",this._onDocClick),window.removeEventListener("active-file-changed",this._onActiveFileChanged)}onRpcReady(){Promise.resolve().then(()=>this.loadTree())}_onActiveFileChanged(e){var t;this._activeInViewer=((t=e.detail)==null?void 0:t.path)||""}async loadTree(){try{const e=await this.rpcExtract("Repo.get_file_tree");if(!e||e.error){console.error("Failed to load tree:",e==null?void 0:e.error);return}if(this._tree=e.tree,this._modified=e.modified||[],this._staged=e.staged||[],this._untracked=e.untracked||[],this._diffStats=e.diff_stats||{},this._allFilePaths=[],this._collectPaths(this._tree,this._allFilePaths),!this._initialAutoSelect){this._initialAutoSelect=!0;const t=new Set([...this._modified,...this._staged,...this._untracked]);t.size>0&&(this.selectedFiles=new Set(t),this._autoExpandChanged(t),this._notifySelection())}}catch(e){console.error("Failed to load file tree:",e)}}_collectPaths(e,t){if(e&&(e.type==="file"&&t.push(e.path),e.children))for(const i of e.children)this._collectPaths(i,t)}_autoExpandChanged(e){for(const t of e){const i=t.split("/");let s="";for(let r=0;r<i.length-1;r++)s=s?`${s}/${i[r]}`:i[r],this._expanded.add(s)}this._expanded=new Set(this._expanded)}_flattenTree(e,t=0){if(!e)return[];const i=[];if(e.path===""&&e.type==="dir"){if(i.push({node:e,depth:0}),this._expanded.has("")||this._filter){const r=this._sortChildren(e.children||[]);for(const n of r)i.push(...this._flattenTree(n,1))}return i}if(!this._matchesFilter(e))return i;if(i.push({node:e,depth:t}),e.type==="dir"&&(this._expanded.has(e.path)||this._filter)){const r=this._sortChildren(e.children||[]);for(const n of r)i.push(...this._flattenTree(n,t+1))}return i}_sortChildren(e){return[...e].sort((t,i)=>t.type!==i.type?t.type==="dir"?-1:1:t.name.localeCompare(i.name))}_matchesFilter(e){if(!this._filter)return!0;const t=this._filter.toLowerCase();return e.path.toLowerCase().includes(t)?!0:e.children?e.children.some(i=>this._matchesFilter(i)):!1}_toggleSelect(e,t){if(t.stopPropagation(),e.type==="file"){const i=new Set(this.selectedFiles);i.has(e.path)?i.delete(e.path):i.add(e.path),this.selectedFiles=i}else{const i=[];this._collectPaths(e,i);const s=i.every(n=>this.selectedFiles.has(n)),r=new Set(this.selectedFiles);for(const n of i)s?r.delete(n):r.add(n);this.selectedFiles=r}this._notifySelection()}_getCheckState(e){if(e.type==="file")return this.selectedFiles.has(e.path)?"checked":"unchecked";const t=[];if(this._collectPaths(e,t),t.length===0)return"unchecked";const i=t.filter(s=>this.selectedFiles.has(s)).length;return i===0?"unchecked":i===t.length?"checked":"indeterminate"}_notifySelection(){this.dispatchEvent(new CustomEvent("selection-changed",{detail:{selectedFiles:[...this.selectedFiles]},bubbles:!0,composed:!0}))}_toggleExpand(e){const t=new Set(this._expanded);t.has(e.path)?t.delete(e.path):t.add(e.path),this._expanded=t}_onRowClick(e){e.type==="dir"?this._toggleExpand(e):this.dispatchEvent(new CustomEvent("file-clicked",{detail:{path:e.path},bubbles:!0,composed:!0})),this._focusedPath=e.path}_onRowMiddleClick(e,t){t.button===1&&(t.preventDefault(),this.dispatchEvent(new CustomEvent("insert-path",{detail:{path:e.path},bubbles:!0,composed:!0})))}_onContextMenu(e,t){t.preventDefault(),t.stopPropagation(),this._contextMenu={x:t.clientX,y:t.clientY,node:e,isDir:e.type==="dir"}}_onDocClick(){this._contextMenu&&(this._contextMenu=null)}async _ctxStage(e){this._contextMenu=null;try{await this.rpcExtract("Repo.stage_files",e),await this.loadTree()}catch(t){console.error("Stage failed:",t)}}async _ctxUnstage(e){this._contextMenu=null;try{await this.rpcExtract("Repo.unstage_files",e),await this.loadTree()}catch(t){console.error("Unstage failed:",t)}}async _ctxDiscard(e){if(this._contextMenu=null,!!confirm(`Discard changes to ${e}?`))try{await this.rpcExtract("Repo.discard_changes",[e]),await this.loadTree()}catch(t){console.error("Discard failed:",t)}}_ctxRename(e){this._contextMenu=null,this._contextInput={type:"rename",path:e.path,value:e.name}}async _ctxDelete(e){if(this._contextMenu=null,!!confirm(`Delete ${e}?`))try{await this.rpcExtract("Repo.delete_file",e);const t=new Set(this.selectedFiles);t.delete(e),this.selectedFiles=t,this._notifySelection(),await this.loadTree()}catch(t){console.error("Delete failed:",t)}}_ctxNewFile(e){if(this._contextMenu=null,this._contextInput={type:"new-file",path:e,value:""},!this._expanded.has(e)){const t=new Set(this._expanded);t.add(e),this._expanded=t}}_ctxNewDir(e){if(this._contextMenu=null,this._contextInput={type:"new-dir",path:e,value:""},!this._expanded.has(e)){const t=new Set(this._expanded);t.add(e),this._expanded=t}}async _submitContextInput(e){if(e.key!=="Enter")return;const t=this._contextInput;if(!t)return;const i=e.target.value.trim();if(!i){this._contextInput=null;return}try{if(t.type==="rename"){const s=t.path.includes("/")?t.path.substring(0,t.path.lastIndexOf("/")):"",r=s?`${s}/${i}`:i;await this.rpcExtract("Repo.rename_file",t.path,r)}else if(t.type==="new-file"){const s=t.path?`${t.path}/${i}`:i;await this.rpcExtract("Repo.create_file",s,"")}else if(t.type==="new-dir"){const s=t.path?`${t.path}/${i}/.gitkeep`:`${i}/.gitkeep`;await this.rpcExtract("Repo.create_file",s,"")}}catch(s){console.error("Operation failed:",s)}this._contextInput=null,await this.loadTree()}_cancelContextInput(e){e.key==="Escape"&&(this._contextInput=null)}_onTreeKeyDown(e){const t=this._flatVisible;if(!t.length)return;let i=t.findIndex(s=>s.node.path===this._focusedPath);if(e.key==="ArrowDown")e.preventDefault(),i=Math.min(t.length-1,i+1),this._focusedPath=t[i].node.path,this._scrollToFocused();else if(e.key==="ArrowUp")e.preventDefault(),i=Math.max(0,i-1),this._focusedPath=t[i].node.path,this._scrollToFocused();else if(e.key==="ArrowRight"){e.preventDefault();const s=t[i];(s==null?void 0:s.node.type)==="dir"&&!this._expanded.has(s.node.path)&&this._toggleExpand(s.node)}else if(e.key==="ArrowLeft"){e.preventDefault();const s=t[i];(s==null?void 0:s.node.type)==="dir"&&this._expanded.has(s.node.path)&&this._toggleExpand(s.node)}else if(e.key===" "||e.key==="Enter"){e.preventDefault();const s=t[i];s&&(e.key===" "?this._toggleSelect(s.node,e):this._onRowClick(s.node))}}_scrollToFocused(){requestAnimationFrame(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".tree-row.focused");e&&e.scrollIntoView({block:"nearest"})})}_onFilterInput(e){this._filter=e.target.value}setFilter(e){this._filter=e||""}_getGitStatus(e){return this._staged.includes(e)?"staged":this._modified.includes(e)?"modified":this._untracked.includes(e)?"untracked":null}_getLineCountColor(e){return e>170?"red":e>=130?"orange":"green"}_renderRow(e){var d,g,v;const{node:t,depth:i}=e,s=t.type==="dir",r=this._expanded.has(t.path),n=this._getCheckState(t),a=s?null:this._getGitStatus(t.path),l=s?null:this._diffStats[t.path],c=this._focusedPath===t.path,h=this._activeInViewer===t.path;return u`
      <div
        class="tree-row ${c?"focused":""} ${h?"active-in-viewer":""}"
        role="treeitem"
        aria-selected="${n==="checked"}"
        aria-expanded="${s?String(r):m}"
        aria-level="${i+1}"
        aria-label="${t.name}${a?`, ${a}`:""}"
        style="padding-left: ${i*16+4}px"
        @click=${()=>this._onRowClick(t)}
        @auxclick=${_=>this._onRowMiddleClick(t,_)}
        @contextmenu=${_=>this._onContextMenu(t,_)}
      >
        <span class="toggle" aria-hidden="true">
          ${s?r?"▾":"▸":""}
        </span>

        <input
          type="checkbox"
          class="tree-checkbox"
          aria-label="Select ${t.name}"
          .checked=${n==="checked"}
          .indeterminate=${n==="indeterminate"}
          @click=${_=>this._toggleSelect(t,_)}
          @change=${_=>_.stopPropagation()}
        />

        <span class="node-name ${s?"dir":""}${!s&&a?` ${a}`:""}">${t.name}</span>

        <span class="badges">
          ${!s&&t.lines>0?u`
            <span class="line-count ${this._getLineCountColor(t.lines)}">${t.lines}</span>
          `:m}

          ${a?u`
            <span class="git-badge ${a}">
              ${a==="modified"?"M":a==="staged"?"S":"U"}
            </span>
          `:m}

          ${l?u`
            <span class="diff-stat">
              ${l.additions>0?u`<span class="diff-add">+${l.additions}</span>`:m}
              ${l.deletions>0?u` <span class="diff-del">-${l.deletions}</span>`:m}
            </span>
          `:m}
        </span>
      </div>

      ${this._contextInput&&this._contextInput.path===t.path&&this._contextInput.type==="rename"?u`
        <div style="padding-left: ${i*16+40}px; padding-right: 8px;">
          <input
            class="inline-input"
            .value=${this._contextInput.value}
            @keydown=${_=>{this._submitContextInput(_),this._cancelContextInput(_)}}
            @blur=${()=>{this._contextInput=null}}
          />
        </div>
      `:m}

      ${s&&((d=this._contextInput)==null?void 0:d.path)===t.path&&(((g=this._contextInput)==null?void 0:g.type)==="new-file"||((v=this._contextInput)==null?void 0:v.type)==="new-dir")?u`
        <div style="padding-left: ${(i+1)*16+40}px; padding-right: 8px;">
          <input
            class="inline-input"
            placeholder="${this._contextInput.type==="new-file"?"filename":"dirname"}"
            @keydown=${_=>{this._submitContextInput(_),this._cancelContextInput(_)}}
            @blur=${()=>{this._contextInput=null}}
          />
        </div>
      `:m}
    `}_renderContextMenu(){if(!this._contextMenu)return m;const{x:e,y:t,node:i,isDir:s}=this._contextMenu,r=i.path;return u`
      <div class="context-menu" role="menu" aria-label="File actions"
           style="left: ${e}px; top: ${t}px"
           @click=${n=>n.stopPropagation()}>
        ${s?u`
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxNewFile(r)}>📄 New File</div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxNewDir(r)}>📁 New Directory</div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${()=>{const n=[];this._collectPaths(i,n),this._ctxStage(n)}}>
            ➕ Stage All
          </div>
          <div class="context-menu-item" role="menuitem" @click=${()=>{const n=[];this._collectPaths(i,n),this._ctxUnstage(n)}}>
            ➖ Unstage All
          </div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxRename(i)}>✏️ Rename</div>
        `:u`
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxStage([r])}>➕ Stage</div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxUnstage([r])}>➖ Unstage</div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxRename(i)}>✏️ Rename</div>
          <div class="context-menu-item danger" role="menuitem" @click=${()=>this._ctxDiscard(r)}>↩️ Discard Changes</div>
          <div class="context-menu-item danger" role="menuitem" @click=${()=>this._ctxDelete(r)}>🗑️ Delete</div>
        `}
      </div>
    `}updated(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".inline-input");e&&this._contextInput&&(e.focus(),this._contextInput.type==="rename"&&e.select())}render(){var i,s,r,n,a;if(!this._tree)return u`<div class="empty-state">Loading file tree...</div>`;const e=this._flattenTree(this._tree);this._flatVisible=e;const t=(i=this.reviewState)==null?void 0:i.active;return u`
      ${t?u`
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
            +${((n=this.reviewState.stats)==null?void 0:n.additions)||0}
            -${((a=this.reviewState.stats)==null?void 0:a.deletions)||0}
          </div>
        </div>
      `:m}

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
        ${e.map(l=>this._renderRow(l))}
      </div>

      ${this._renderContextMenu()}
    `}}w(ht,"properties",{selectedFiles:{type:Object,hasChanged:()=>!0},reviewState:{type:Object},_tree:{type:Object,state:!0},_modified:{type:Array,state:!0},_staged:{type:Array,state:!0},_untracked:{type:Array,state:!0},_diffStats:{type:Object,state:!0},_expanded:{type:Object,state:!0},_filter:{type:String,state:!0},_focusedPath:{type:String,state:!0},_contextMenu:{type:Object,state:!0},_contextInput:{type:Object,state:!0},_activeInViewer:{type:String,state:!0}}),w(ht,"styles",[R,O,T`
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
  `]);customElements.define("ac-file-picker",ht);const ai=280,li=150,ci=500,di="ac-dc-picker-width",hi="ac-dc-picker-collapsed";class pt extends U(E){constructor(){super(),this._pickerWidth=this._loadWidth(),this._pickerCollapsed=this._loadCollapsed(),this._selectedFiles=[],this._messages=[],this._streamingActive=!1,this._isDragging=!1,this._reviewState={active:!1},this._showReviewSelector=!1}connectedCallback(){super.connectedCallback(),window.addEventListener("state-loaded",e=>this._onStateLoaded(e)),window.addEventListener("files-changed",e=>this._onFilesChanged(e))}onRpcReady(){Promise.resolve().then(()=>this._loadReviewState())}async _loadReviewState(){try{const e=await this.rpcExtract("LLMService.get_review_state");e&&(this._reviewState=e)}catch(e){console.warn("Failed to load review state:",e)}}async _openReviewSelector(){var t;await ce(()=>import("./review-selector-DHmhk01X.js"),__vite__mapDeps([0,1,2,3,4])),this._showReviewSelector=!0,await this.updateComplete;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-review-selector");e&&e.show()}_onReviewSelectorClose(){this._showReviewSelector=!1}async _onReviewStarted(e){var s,r;this._reviewState={active:!0,...e.detail},this._selectedFiles=[];const t=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-file-picker");t&&(t.selectedFiles=new Set,t.requestUpdate()),t&&await t.loadTree();const i=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-chat-panel");i&&(i.selectedFiles=[],i.reviewState=this._reviewState,i.requestUpdate())}async _exitReview(){var e,t;try{const i=await this.rpcExtract("LLMService.end_review");if(i!=null&&i.error){console.error("Exit review failed:",i.error),this.showToast(`Exit review failed: ${i.error}`,"error");return}this._reviewState={active:!1};const s=(e=this.shadowRoot)==null?void 0:e.querySelector("ac-file-picker");s&&await s.loadTree();const r=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-chat-panel");r&&(r.reviewState=this._reviewState,r.requestUpdate()),window.dispatchEvent(new CustomEvent("review-ended"))}catch(i){console.error("Exit review failed:",i),this.showToast(`Exit review failed: ${i.message||"Unknown error"}`,"error")}}_onFilesChanged(e){var i;const t=(i=e.detail)==null?void 0:i.selectedFiles;Array.isArray(t)&&(this._syncMessagesFromChat(),this._selectedFiles=t)}_onSelectionChanged(e){var s,r;const t=((s=e.detail)==null?void 0:s.selectedFiles)||[];this._syncMessagesFromChat(),this._selectedFiles=t,this.rpcConnected&&this.rpcCall("LLMService.set_selected_files",t).catch(()=>{});const i=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-chat-panel");i&&(i.selectedFiles=t,i.requestUpdate())}_onFileClicked(e){var i;const t=(i=e.detail)==null?void 0:i.path;t&&window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:t}}))}_syncMessagesFromChat(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-chat-panel");e&&(this._messages=e.messages)}_onInsertPath(e){var s,r,n;const t=(s=e.detail)==null?void 0:s.path;if(!t)return;const i=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-chat-panel");if(i){const a=(n=i.shadowRoot)==null?void 0:n.querySelector(".input-textarea");if(a){const l=a.selectionStart,c=a.value.slice(0,l),h=a.value.slice(a.selectionEnd),d=!c.endsWith(" ")&&c.length>0?" ":"",g=h.startsWith(" ")?"":" ";a.value=c+d+t+g+h,a.dispatchEvent(new Event("input",{bubbles:!0}));const v=l+d.length+t.length+g.length;a.setSelectionRange(v,v),i._suppressNextPaste=!0,a.focus()}}}_onFilterFromChat(e){var s,r;const t=((s=e.detail)==null?void 0:s.filter)||"",i=(r=this.shadowRoot)==null?void 0:r.querySelector("ac-file-picker");i&&i.setFilter(t)}_onFileMentionClick(e){var l,c,h,d,g;const t=(l=e.detail)==null?void 0:l.path;if(!t)return;this._syncMessagesFromChat();const i=((c=e.detail)==null?void 0:c.navigate)!==!1;let s;if(this._selectedFiles.includes(t))s=this._selectedFiles.filter(v=>v!==t);else{s=[...this._selectedFiles,t];const v=(h=this.shadowRoot)==null?void 0:h.querySelector("ac-chat-panel");v&&v.accumulateFileInInput(t)}this._selectedFiles=s;const n=(d=this.shadowRoot)==null?void 0:d.querySelector("ac-file-picker");n&&(n.selectedFiles=new Set(s),n.requestUpdate());const a=(g=this.shadowRoot)==null?void 0:g.querySelector("ac-chat-panel");a&&(a.selectedFiles=s,a.requestUpdate()),this.rpcConnected&&this.rpcCall("LLMService.set_selected_files",s).catch(()=>{}),i&&window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:t}}))}_onFilesModified(e){var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-file-picker");t&&t.loadTree(),window.dispatchEvent(new CustomEvent("files-modified",{detail:e.detail}))}_onStateLoaded(e){const t=e.detail;t&&(this._messages=t.messages||[],this._selectedFiles=t.selected_files||[],this._streamingActive=t.streaming_active||!1,requestAnimationFrame(()=>{var s;const i=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-file-picker");i&&this._selectedFiles.length>0&&(i.selectedFiles=new Set(this._selectedFiles))}))}_loadWidth(){try{const e=localStorage.getItem(di);return e?Math.max(li,Math.min(ci,parseInt(e))):ai}catch{return ai}}_loadCollapsed(){try{return localStorage.getItem(hi)==="true"}catch{return!1}}_saveWidth(e){try{localStorage.setItem(di,String(e))}catch{}}_saveCollapsed(e){try{localStorage.setItem(hi,String(e))}catch{}}_onResizeStart(e){e.preventDefault(),this._isDragging=!0;const t=e.clientX,i=this._pickerWidth,s=n=>{const a=n.clientX-t,l=Math.max(li,Math.min(ci,i+a));this._pickerWidth=l},r=()=>{this._isDragging=!1,this._saveWidth(this._pickerWidth),window.removeEventListener("mousemove",s),window.removeEventListener("mouseup",r)};window.addEventListener("mousemove",s),window.addEventListener("mouseup",r)}_toggleCollapse(){this._pickerCollapsed=!this._pickerCollapsed,this._saveCollapsed(this._pickerCollapsed)}render(){return u`
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

      ${this._showReviewSelector?u`
        <ac-review-selector
          @review-started=${this._onReviewStarted}
          @review-selector-close=${this._onReviewSelectorClose}
        ></ac-review-selector>
      `:m}
    `}}w(pt,"properties",{_pickerWidth:{type:Number,state:!0},_pickerCollapsed:{type:Boolean,state:!0},_selectedFiles:{type:Array,state:!0},_messages:{type:Array,state:!0},_streamingActive:{type:Boolean,state:!0},_reviewState:{type:Object,state:!0},_showReviewSelector:{type:Boolean,state:!0}}),w(pt,"styles",[R,O,T`
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

  `]);customElements.define("ac-files-tab",pt);const pi={search:()=>ce(()=>import("./ac-search-tab-T2Mp2hBk.js"),__vite__mapDeps([5,1,2,3,4])),context:()=>ce(()=>import("./ac-context-tab-CySvdCmA.js"),__vite__mapDeps([6,1,2,3,4])),cache:()=>ce(()=>import("./ac-cache-tab-CplaYO0z.js"),__vite__mapDeps([7,1,2,3,4])),settings:()=>ce(()=>import("./ac-settings-tab-CYr-s0Hf.js"),__vite__mapDeps([8,1,2,3,4]))},Ae=[{id:"files",icon:"📁",label:"Files",shortcut:"Alt+1"},{id:"search",icon:"🔍",label:"Search",shortcut:"Alt+2"},{id:"context",icon:"📊",label:"Context",shortcut:"Alt+3"},{id:"cache",icon:"🗄️",label:"Cache",shortcut:"Alt+4"},{id:"settings",icon:"⚙️",label:"Settings",shortcut:"Alt+5"}];class ut extends U(E){constructor(){super(),this.activeTab="files",this.minimized=this._loadBoolPref("ac-dc-minimized",!1),this._historyPercent=0,this._reviewActive=!1,this._visitedTabs=new Set(["files"]),this._onKeyDown=this._onKeyDown.bind(this),this._undocked=!1}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._onKeyDown),this._restoreDialogWidth(),this._restoreDialogPosition()}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._onKeyDown)}onRpcReady(){this._refreshHistoryBar(),this._refreshReviewState();const e=this._loadPref("ac-dc-active-tab","files");e!==this.activeTab&&this._switchTab(e),this._dialogEventsRegistered||(this._dialogEventsRegistered=!0,window.addEventListener("stream-complete",()=>this._refreshHistoryBar()),window.addEventListener("compaction-event",()=>this._refreshHistoryBar()),window.addEventListener("state-loaded",()=>this._refreshHistoryBar()),window.addEventListener("review-started",()=>{this._reviewActive=!0}),window.addEventListener("review-ended",()=>{this._reviewActive=!1}))}async _refreshReviewState(){try{const e=await this.rpcExtract("LLMService.get_review_state");e&&(this._reviewActive=!!e.active)}catch{}}_onReviewClick(){this._switchTab("files"),this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-files-tab");e&&(this._reviewActive?e._exitReview():e._openReviewSelector())})}async _refreshHistoryBar(){try{const e=await this.rpcExtract("LLMService.get_history_status");e&&typeof e.percent=="number"&&(this._historyPercent=e.percent)}catch{}}_onKeyDown(e){var t,i;if(e.altKey&&e.key>="1"&&e.key<="5"){e.preventDefault();const s=parseInt(e.key)-1;Ae[s]&&this._switchTab(Ae[s].id);return}if(e.altKey&&(e.key==="m"||e.key==="M")){e.preventDefault(),this._toggleMinimize();return}if(e.ctrlKey&&e.shiftKey&&(e.key==="f"||e.key==="F")){e.preventDefault();const s=((i=(t=window.getSelection())==null?void 0:t.toString())==null?void 0:i.trim())||"";this._switchTab("search"),s&&!s.includes(`
`)&&this.updateComplete.then(()=>{var n;const r=(n=this.shadowRoot)==null?void 0:n.querySelector("ac-search-tab");r&&r.prefill(s)});return}}_switchTab(e){this.activeTab=e,this._savePref("ac-dc-active-tab",e),this._visitedTabs.add(e),this.minimized&&(this.minimized=!1),pi[e]&&pi[e](),this.updateComplete.then(()=>{var i,s;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".tab-panel.active");if(t){const r=t.firstElementChild;r&&typeof r.onTabVisible=="function"&&r.onTabVisible()}if(e==="search"){const r=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-search-tab");r&&r.focus()}})}_toggleMinimize(){this.minimized=!this.minimized,this._saveBoolPref("ac-dc-minimized",this.minimized)}_getHistoryBarColor(){return this._historyPercent>90?"red":this._historyPercent>75?"orange":"green"}_getContainer(){return this.parentElement}_onResizeStart(e){e.preventDefault(),e.stopPropagation(),this._isResizing=!0;const t=this._getContainer();if(!t)return;const i=e.clientX,s=t.offsetWidth,r=a=>{const l=a.clientX-i,c=Math.max(300,s+l);t.style.width=`${c}px`},n=()=>{this._isResizing=!1,this._savePref("ac-dc-dialog-width",String(t.offsetWidth)),window.removeEventListener("mousemove",r),window.removeEventListener("mouseup",n)};window.addEventListener("mousemove",r),window.addEventListener("mouseup",n)}_onHeaderMouseDown(e){if(e.button!==0)return;e.preventDefault();const t=this._getContainer();if(!t)return;const i=e.clientX,s=e.clientY,r=t.getBoundingClientRect(),n=r.left,a=r.top,l=r.width,c=r.height;let h=!1;const d=v=>{const _=v.clientX-i,x=v.clientY-s;if(!h){if(Math.abs(_)<5&&Math.abs(x)<5)return;h=!0,this._undocked||(this._undocked=!0,t.style.position="fixed",t.style.top=`${a}px`,t.style.left=`${n}px`,t.style.width=`${l}px`,t.style.height=`${c}px`,t.style.right="auto",t.style.bottom="auto")}const p=Math.max(0,n+_),f=Math.max(0,a+x);t.style.left=`${p}px`,t.style.top=`${f}px`},g=()=>{if(window.removeEventListener("mousemove",d),window.removeEventListener("mouseup",g),!h)this._toggleMinimize();else if(this._undocked){const v=t.getBoundingClientRect();this._savePref("ac-dc-dialog-pos",JSON.stringify({left:v.left,top:v.top,width:v.width,height:v.height}))}};window.addEventListener("mousemove",d),window.addEventListener("mouseup",g)}_savePref(e,t){try{localStorage.setItem(e,t)}catch{}}_loadPref(e,t){try{const i=localStorage.getItem(e);return i!==null?i:t}catch{return t}}_saveBoolPref(e,t){this._savePref(e,String(t))}_loadBoolPref(e,t){try{const i=localStorage.getItem(e);return i===null?t:i==="true"}catch{return t}}_restoreDialogWidth(){const e=this._loadPref("ac-dc-dialog-width",null);if(!e)return;const t=parseInt(e);if(isNaN(t)||t<300)return;const i=this._getContainer();i&&(i.style.width=`${Math.min(t,window.innerWidth-50)}px`)}_restoreDialogPosition(){const e=this._loadPref("ac-dc-dialog-pos",null);if(e)try{const t=JSON.parse(e);if(!t||typeof t.left!="number")return;const i=window.innerWidth,s=window.innerHeight,r=Math.min(t.width||400,i-20),n=Math.min(t.height||s,s-20),a=Math.max(0,Math.min(t.left,i-100)),l=Math.max(0,Math.min(t.top,s-100)),c=this._getContainer();if(!c)return;this._undocked=!0,c.style.position="fixed",c.style.left=`${a}px`,c.style.top=`${l}px`,c.style.width=`${r}px`,c.style.height=`${n}px`,c.style.right="auto",c.style.bottom="auto"}catch{}}render(){const e=Ae.find(t=>t.id===this.activeTab);return u`
      <div class="header" @mousedown=${this._onHeaderMouseDown}>
        <span class="header-label">${(e==null?void 0:e.label)||"Files"}</span>

        <div class="tab-buttons" role="tablist" aria-label="Tool tabs">
          ${Ae.map(t=>u`
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
        ${this._visitedTabs.has("search")?u`
          <div class="tab-panel ${this.activeTab==="search"?"active":""}"
               role="tabpanel" id="panel-search" aria-labelledby="tab-search">
            <ac-search-tab></ac-search-tab>
          </div>
        `:""}

        ${this._visitedTabs.has("context")?u`
          <div class="tab-panel ${this.activeTab==="context"?"active":""}"
               role="tabpanel" id="panel-context" aria-labelledby="tab-context">
            <ac-context-tab></ac-context-tab>
          </div>
        `:""}

        ${this._visitedTabs.has("cache")?u`
          <div class="tab-panel ${this.activeTab==="cache"?"active":""}"
               role="tabpanel" id="panel-cache" aria-labelledby="tab-cache">
            <ac-cache-tab></ac-cache-tab>
          </div>
        `:""}

        ${this._visitedTabs.has("settings")?u`
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
    `}}w(ut,"properties",{activeTab:{type:String,state:!0},minimized:{type:Boolean,reflect:!0},_historyPercent:{type:Number,state:!0},_reviewActive:{type:Boolean,state:!0}}),w(ut,"styles",[R,O,T`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-primary);
      overflow: hidden;
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

    /* Resize handle */
    .resize-handle {
      position: absolute;
      top: 0;
      right: -4px;
      width: 8px;
      height: 100%;
      cursor: col-resize;
      z-index: 10;
    }
    .resize-handle:hover,
    .resize-handle:active {
      background: var(--accent-primary);
      opacity: 0.3;
    }
  `]);customElements.define("ac-dialog",ut);self.MonacoEnvironment={getWorker(o,e){if(e==="editorWorkerService")return new Worker(new URL("/AI-Coder-DeCoder/582ec8cc/assets/editor.worker-DX6ApQqM.js",import.meta.url),{type:"module"});const t=new Blob(["self.onmessage = function() {}"],{type:"application/javascript"});return new Worker(URL.createObjectURL(t))}};const Gs={".js":"javascript",".mjs":"javascript",".jsx":"javascript",".ts":"typescript",".tsx":"typescript",".py":"python",".json":"json",".yaml":"yaml",".yml":"yaml",".html":"html",".htm":"html",".css":"css",".scss":"scss",".less":"less",".md":"markdown",".markdown":"markdown",".c":"c",".h":"c",".cpp":"cpp",".cc":"cpp",".cxx":"cpp",".hpp":"cpp",".hxx":"cpp",".sh":"shell",".bash":"shell",".xml":"xml",".svg":"xml",".java":"java",".rs":"rust",".go":"go",".rb":"ruby",".php":"php",".sql":"sql",".toml":"ini",".ini":"ini",".cfg":"ini"};function Zs(o){if(!o)return"plaintext";const e=o.lastIndexOf(".");if(e===-1)return"plaintext";const t=o.slice(e).toLowerCase();return Gs[t]||"plaintext"}class ft extends U(E){constructor(){super(),this._files=[],this._activeIndex=-1,this._dirtySet=new Set,this._editor=null,this._editorContainer=null,this._resizeObserver=null,this._styleObserver=null,this._monacoStylesInjected=!1,this._highlightTimer=null,this._highlightDecorations=[],this._lspRegistered=!1,this._virtualContents={},this._onKeyDown=this._onKeyDown.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._onKeyDown)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._onKeyDown),this._disposeEditor(),this._resizeObserver&&(this._resizeObserver.disconnect(),this._resizeObserver=null),this._styleObserver&&(this._styleObserver.disconnect(),this._styleObserver=null)}firstUpdated(){this._editorContainer=this.shadowRoot.querySelector(".editor-container"),this._editorContainer&&(this._resizeObserver=new ResizeObserver(()=>{this._editor&&this._editor.layout()}),this._resizeObserver.observe(this._editorContainer))}onRpcReady(){this._registerLspProviders()}async openFile(e){const{path:t,searchText:i,line:s}=e;if(!t)return;e.virtualContent!=null&&(this._virtualContents[t]=e.virtualContent);const r=this._files.findIndex(d=>d.path===t);if(r!==-1){this._activeIndex=r,await this.updateComplete,this._showEditor(),s!=null?this._scrollToLine(s):i&&this._scrollToSearchText(i),this._dispatchActiveFileChanged(t);return}let n=e.original??"",a=e.modified??"",l=e.is_new??!1,c=e.is_read_only??!1;if(e.virtualContent!=null)n="",a=e.virtualContent,l=!0,c=e.readOnly??!0;else if(!e.original&&!e.modified){const d=await this._fetchFileContent(t);if(d===null)return;n=d.original,a=d.modified,l=d.is_new,c=d.is_read_only??!1}const h={path:t,original:n,modified:a,is_new:l,is_read_only:c??!1,is_config:e.is_config??!1,config_type:e.config_type??null,real_path:e.real_path??null,savedContent:a};this._files=[...this._files,h],this._activeIndex=this._files.length-1,await this.updateComplete,this._showEditor(),s!=null?this._scrollToLine(s):i&&this._scrollToSearchText(i),this._dispatchActiveFileChanged(t)}async refreshOpenFiles(){const e=[];let t=!1;for(const i of this._files){if(i.is_config){e.push(i);continue}const s=await this._fetchFileContent(i.path);if(s===null){e.push(i);continue}const r={...i,original:s.original,modified:s.modified,is_new:s.is_new,savedContent:s.modified};e.push(r),t=!0}t&&(this._files=e,this._dirtySet=new Set,await this.updateComplete,this._showEditor())}closeFile(e){delete this._virtualContents[e];const t=this._files.findIndex(i=>i.path===e);t!==-1&&(this._dirtySet.delete(e),this._files=this._files.filter(i=>i.path!==e),this._files.length===0?(this._activeIndex=-1,this._disposeEditor(),this._dispatchActiveFileChanged(null)):this._activeIndex>=this._files.length?(this._activeIndex=this._files.length-1,this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)):t<=this._activeIndex&&(this._activeIndex=Math.max(0,this._activeIndex-1),this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)))}getDirtyFiles(){return[...this._dirtySet]}async _fetchFileContent(e){if(e.startsWith("virtual://"))return{original:"",modified:this._virtualContents[e]||"(no content)"};if(!this.rpcConnected)return null;try{let t="",i="",s=!1,r=!1;const n=await this.rpcExtract("Repo.get_file_content",e,"HEAD"),a=await this.rpcExtract("Repo.get_file_content",e);return n!=null&&n.error&&(a!=null&&a.error)?(console.warn("File not found:",e),null):(n!=null&&n.error?(s=!0,t="",i=(a==null?void 0:a.content)??a??""):a!=null&&a.error?(t=(n==null?void 0:n.content)??n??"",i="",r=!0):(t=(n==null?void 0:n.content)??n??"",i=(a==null?void 0:a.content)??a??""),{original:t,modified:i,is_new:s,is_read_only:r})}catch(t){return console.warn("Failed to fetch file content:",e,t),null}}_showEditor(){if(this._activeIndex<0||this._activeIndex>=this._files.length){this._disposeEditor();return}const e=this._files[this._activeIndex],t=this._editorContainer;if(!t)return;this._injectMonacoStyles();const i=Zs(e.path);if(this._editor){const s=this._editor.getModel();s&&(s.original&&s.original.dispose(),s.modified&&s.modified.dispose());const r=X.createModel(e.original,i),n=X.createModel(e.modified,i);this._editor.setModel({original:r,modified:n}),this._editor.getModifiedEditor().updateOptions({readOnly:e.is_read_only})}else{this._editor=X.createDiffEditor(t,{theme:"vs-dark",automaticLayout:!1,minimap:{enabled:!1},renderSideBySide:!0,readOnly:!1,originalEditable:!1,scrollBeyondLastLine:!1,fontSize:13,lineNumbers:"on",glyphMargin:!1,folding:!0,wordWrap:"off",renderWhitespace:"selection",contextmenu:!0,scrollbar:{verticalScrollbarSize:8,horizontalScrollbarSize:8}});const s=X.createModel(e.original,i),r=X.createModel(e.modified,i);this._editor.setModel({original:s,modified:r}),this._editor.getModifiedEditor().updateOptions({readOnly:e.is_read_only}),this._editor.getModifiedEditor().onDidChangeModelContent(()=>{this._checkDirty()})}this._editor.layout()}_disposeEditor(){if(this._editor){const e=this._editor.getModel();e&&(e.original&&e.original.dispose(),e.modified&&e.modified.dispose()),this._editor.dispose(),this._editor=null}this._highlightDecorations=[]}_checkDirty(){var r,n;if(this._activeIndex<0||this._activeIndex>=this._files.length)return;const e=this._files[this._activeIndex],i=(((n=(r=this._editor)==null?void 0:r.getModifiedEditor())==null?void 0:n.getValue())??"")!==e.savedContent,s=new Set(this._dirtySet);i?s.add(e.path):s.delete(e.path),this._dirtySet=s}_injectMonacoStyles(){if(this._monacoStylesInjected)return;this._monacoStylesInjected=!0;const e=this.shadowRoot;this._syncAllStyles(e),this._styleObserver=new MutationObserver(t=>{for(const i of t){for(const s of i.addedNodes)if(s.nodeName==="STYLE"||s.nodeName==="LINK"){const r=s.cloneNode(!0);r.setAttribute("data-monaco-injected","true"),e.appendChild(r)}for(const s of i.removedNodes)if(s.nodeName==="STYLE"||s.nodeName==="LINK"){const r=e.querySelectorAll("[data-monaco-injected]");for(const n of r)if(n.textContent===s.textContent){n.remove();break}}}}),this._styleObserver.observe(document.head,{childList:!0})}_syncAllStyles(e){const t=document.head.querySelectorAll('style, link[rel="stylesheet"]');for(const i of t){const s=i.cloneNode(!0);s.setAttribute("data-monaco-injected","true"),e.appendChild(s)}}_onKeyDown(e){if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault(),this._saveActiveFile();return}if((e.ctrlKey||e.metaKey)&&e.key==="PageDown"){e.preventDefault(),this._files.length>1&&(this._activeIndex=(this._activeIndex+1)%this._files.length,this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}if((e.ctrlKey||e.metaKey)&&e.key==="PageUp"){e.preventDefault(),this._files.length>1&&(this._activeIndex=(this._activeIndex-1+this._files.length)%this._files.length,this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}(e.ctrlKey||e.metaKey)&&e.key==="w"&&(e.preventDefault(),this._files.length>0&&this._activeIndex>=0&&this.closeFile(this._files[this._activeIndex].path))}_saveActiveFile(){var i,s;if(this._activeIndex<0||this._activeIndex>=this._files.length)return;const e=this._files[this._activeIndex];if(!this._dirtySet.has(e.path))return;const t=((s=(i=this._editor)==null?void 0:i.getModifiedEditor())==null?void 0:s.getValue())??"";this._doSave(e,t)}_saveFile(e){const t=this._files.findIndex(r=>r.path===e);if(t===-1)return;const i=this._files[t];let s;t===this._activeIndex&&this._editor?s=this._editor.getModifiedEditor().getValue():s=i.modified,this._doSave(i,s)}_doSave(e,t){const i=this._files.map(r=>r.path===e.path?{...r,modified:t,savedContent:t}:r);this._files=i;const s=new Set(this._dirtySet);s.delete(e.path),this._dirtySet=s,window.dispatchEvent(new CustomEvent("file-save",{detail:{path:e.path,content:t,isConfig:e.is_config,configType:e.config_type}}))}saveAll(){for(const e of this._dirtySet)this._saveFile(e)}_scrollToLine(e){if(!this._editor)return;const t=this._editor.getModifiedEditor();requestAnimationFrame(()=>{t.revealLineInCenter(e),t.setPosition({lineNumber:e,column:1}),t.focus()})}_scrollToSearchText(e){if(!this._editor||!e)return;const t=this._editor.getModifiedEditor(),i=t.getModel();if(!i)return;const s=e.split(`
`);for(let n=s.length;n>=1;n--){const a=s.slice(0,n).join(`
`).trim();if(!a)continue;const l=i.findNextMatch(a,{lineNumber:1,column:1},!1,!0,null,!1);if(l){requestAnimationFrame(()=>{t.revealLineInCenter(l.range.startLineNumber),t.setSelection(l.range),t.focus(),this._applyHighlight(t,l.range)});return}}const r=s.find(n=>n.trim());if(r){const n=i.findNextMatch(r.trim(),{lineNumber:1,column:1},!1,!0,null,!1);n&&requestAnimationFrame(()=>{t.revealLineInCenter(n.range.startLineNumber),t.setSelection(n.range),t.focus(),this._applyHighlight(t,n.range)})}}_applyHighlight(e,t){this._highlightTimer&&clearTimeout(this._highlightTimer),this._highlightDecorations=e.deltaDecorations(this._highlightDecorations,[{range:t,options:{isWholeLine:!0,className:"highlight-decoration",overviewRuler:{color:"#4fc3f7",position:X.OverviewRulerLane.Full}}}]),this._highlightTimer=setTimeout(()=>{this._highlightDecorations=e.deltaDecorations(this._highlightDecorations,[])},3e3)}_dispatchActiveFileChanged(e){window.dispatchEvent(new CustomEvent("active-file-changed",{detail:{path:e}}))}_registerLspProviders(){this._lspRegistered||(this._lspRegistered=!0,M.registerHoverProvider("*",{provideHover:async(e,t)=>{if(!this.rpcConnected)return null;const i=this._getFileForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLMService.lsp_get_hover",i.path,t.lineNumber-1,t.column-1);if(s!=null&&s.contents)return{contents:[{value:s.contents}],range:s.range?new Se(s.range.start_line+1,s.range.start_col+1,s.range.end_line+1,s.range.end_col+1):void 0}}catch{}return null}}),M.registerDefinitionProvider("*",{provideDefinition:async(e,t)=>{if(!this.rpcConnected)return null;const i=this._getFileForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLMService.lsp_get_definition",i.path,t.lineNumber-1,t.column-1);if(s!=null&&s.file&&(s!=null&&s.range))return await this.openFile({path:s.file,line:s.range.start_line+1}),{uri:Et.parse(`file:///${s.file}`),range:new Se(s.range.start_line+1,s.range.start_col+1,s.range.end_line+1,s.range.end_col+1)}}catch{}return null}}),M.registerReferenceProvider("*",{provideReferences:async(e,t)=>{if(!this.rpcConnected)return null;const i=this._getFileForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLMService.lsp_get_references",i.path,t.lineNumber-1,t.column-1);if(Array.isArray(s))return s.map(r=>({uri:Et.parse(`file:///${r.file}`),range:new Se(r.range.start_line+1,r.range.start_col+1,r.range.end_line+1,r.range.end_col+1)}))}catch{}return null}}),M.registerCompletionItemProvider("*",{triggerCharacters:["."],provideCompletionItems:async(e,t)=>{if(!this.rpcConnected)return{suggestions:[]};const i=this._getFileForModel(e);if(!i)return{suggestions:[]};const s=e.getWordUntilPosition(t),r=(s==null?void 0:s.word)||"";try{const n=await this.rpcExtract("LLMService.lsp_get_completions",i.path,t.lineNumber-1,t.column-1,r);if(Array.isArray(n)){const a=new Se(t.lineNumber,s.startColumn,t.lineNumber,s.endColumn);return{suggestions:n.map(l=>({label:l.label,kind:this._mapCompletionKind(l.kind),detail:l.detail||"",insertText:l.label,range:a}))}}}catch{}return{suggestions:[]}}}))}_getFileForModel(e){return this._activeIndex>=0&&this._activeIndex<this._files.length?this._files[this._activeIndex]:null}_mapCompletionKind(e){return{class:M.CompletionItemKind.Class,function:M.CompletionItemKind.Function,method:M.CompletionItemKind.Method,variable:M.CompletionItemKind.Variable,property:M.CompletionItemKind.Property,import:M.CompletionItemKind.Module}[e]||M.CompletionItemKind.Text}render(){const e=this._files.length>0,t=e&&this._activeIndex>=0?this._files[this._activeIndex]:null,i=t?this._dirtySet.has(t.path):!1;return t&&(t.is_new||(t.original,t.savedContent)),u`
      <div class="editor-container">
        ${t?u`
          <button
            class="status-led ${i?"dirty":t.is_new?"new-file":"clean"}"
            title="${t.path}${i?" — unsaved (Ctrl+S to save)":t.is_new?" — new file":""}"
            aria-label="${t.path}${i?", unsaved changes, press to save":t.is_new?", new file":", no changes"}"
            @click=${()=>i?this._saveActiveFile():null}
          ></button>
        `:m}
        ${e?m:u`
          <div class="empty-state">
            <div class="watermark">AC⚡DC</div>
          </div>
        `}
      </div>
    `}}w(ft,"properties",{_files:{type:Array,state:!0},_activeIndex:{type:Number,state:!0},_dirtySet:{type:Object,state:!0}}),w(ft,"styles",[R,O,T`
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

    /* Highlight animation for scroll-to-edit */
    .highlight-decoration {
      background: rgba(79, 195, 247, 0.2);
    }
  `]);customElements.define("ac-diff-viewer",ft);function A(o){return o==null?"—":o>=1e3?(o/1e3).toFixed(1)+"K":String(o)}class mt extends U(E){constructor(){super(),this._visible=!1,this._fading=!1,this._data=null,this._basicData=null,this._collapsed=this._loadCollapsedSections(),this._hideTimer=null,this._fadeTimer=null,this._hovered=!1,this._onStreamComplete=this._onStreamComplete.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-complete",this._onStreamComplete)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-complete",this._onStreamComplete),this._clearTimers()}_onStreamComplete(e){var i;const t=(i=e.detail)==null?void 0:i.result;!t||t.error||(this._basicData=t.token_usage||null,this._data=null,this._visible=!0,this._fading=!1,this._startAutoHide(),this._fetchBreakdown())}async _fetchBreakdown(){if(this.rpcConnected)try{const e=await this.rpcExtract("LLMService.get_context_breakdown");e&&(this._data=e)}catch(e){console.warn("Token HUD: failed to fetch breakdown:",e)}}_startAutoHide(){this._clearTimers(),this._hideTimer=setTimeout(()=>{this._hovered||(this._fading=!0,this._fadeTimer=setTimeout(()=>{this._visible=!1,this._fading=!1},800))},8e3)}_clearTimers(){this._hideTimer&&(clearTimeout(this._hideTimer),this._hideTimer=null),this._fadeTimer&&(clearTimeout(this._fadeTimer),this._fadeTimer=null)}_onMouseEnter(){this._hovered=!0,this._fading=!1,this._clearTimers()}_onMouseLeave(){this._hovered=!1,this._startAutoHide()}_dismiss(){this._clearTimers(),this._visible=!1,this._fading=!1}_toggleSection(e){const t=new Set(this._collapsed);t.has(e)?t.delete(e):t.add(e),this._collapsed=t,this._saveCollapsedSections(t)}_saveCollapsedSections(e){try{localStorage.setItem("ac-dc-hud-collapsed",JSON.stringify([...e]))}catch{}}_loadCollapsedSections(){try{const e=localStorage.getItem("ac-dc-hud-collapsed");if(e)return new Set(JSON.parse(e))}catch{}return new Set}_isExpanded(e){return!this._collapsed.has(e)}_getCacheBadge(e){if(e==null)return m;const t=(e*100).toFixed(0);let i="low";return e>=.5?i="good":e>=.2&&(i="ok"),u`<span class="cache-badge ${i}">${t}% cache</span>`}_getBudgetColor(e){return e>90?"red":e>75?"yellow":"green"}_renderHeader(){const e=this._data,t=(e==null?void 0:e.model)||"—",i=e==null?void 0:e.cache_hit_rate;return u`
      <div class="hud-header">
        <span class="hud-title">
          ${t}
          ${this._getCacheBadge(i)}
        </span>
        <button class="dismiss-btn" @click=${this._dismiss} title="Dismiss" aria-label="Dismiss token usage overlay">✕</button>
      </div>
    `}_getSubIcon(e){switch(e){case"system":return"⚙️";case"symbols":return"📦";case"files":return"📄";case"urls":return"🔗";case"history":return"💬";default:return"•"}}_getSubLabel(e){return e.name||e.path||e.type||"—"}_renderCacheTiers(){const e=this._data;if(!(e!=null&&e.blocks))return m;const t=Math.max(1,...e.blocks.map(i=>i.tokens||0));return u`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("tiers")}"
             @click=${()=>this._toggleSection("tiers")}
             @keydown=${i=>{(i.key==="Enter"||i.key===" ")&&(i.preventDefault(),this._toggleSection("tiers"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("tiers")?"▼":"▶"}</span>
          Cache Tiers
        </div>
        <div class="section-body ${this._isExpanded("tiers")?"":"collapsed"}">
          ${e.blocks.map(i=>{const s=t>0?i.tokens/t*100:0,r=(i.tier||i.name||"active").toLowerCase().replace(/[^a-z0-9]/g,""),n=i.contents||[];return u`
              <div class="tier-row">
                <span class="tier-label">${i.name||i.tier||"?"}</span>
                <div class="tier-bar">
                  <div class="tier-bar-fill ${r}" style="width: ${s}%"></div>
                </div>
                <span class="tier-tokens">${A(i.tokens)}</span>
                ${i.cached?u`<span class="tier-cached">🔒</span>`:m}
              </div>
              ${n.map(a=>{const l=a.n!=null?a.n:null,c=a.threshold,h=l!=null&&c?Math.min(100,l/c*100):0,d={L0:"var(--accent-green)",L1:"#26a69a",L2:"var(--accent-primary)",L3:"var(--accent-yellow)",active:"var(--accent-orange)"}[i.tier||i.name]||"var(--text-muted)";return u`
                <div class="tier-sub">
                  <span class="tier-sub-icon">${this._getSubIcon(a.type)}</span>
                  <span class="tier-sub-label">${this._getSubLabel(a)}</span>
                  ${l!=null?u`
                    <span class="tier-sub-n" title="N=${l}/${c||"?"}">${l}/${c||"?"}</span>
                    <div class="tier-sub-bar" title="N=${l}/${c||"?"}">
                      <div class="tier-sub-bar-fill" style="width: ${h}%; background: ${d}"></div>
                    </div>
                  `:m}
                  <span class="tier-sub-tokens">${A(a.tokens)}</span>
                </div>
              `})}
            `})}
        </div>
      </div>
    `}_renderThisRequest(){var n;const e=this._basicData||((n=this._data)==null?void 0:n.token_usage);if(!e)return m;const t=e.input_tokens||e.prompt_tokens||0,i=e.output_tokens||e.completion_tokens||0,s=e.cache_read_tokens||e.cache_read_input_tokens||0,r=e.cache_write_tokens||e.cache_creation_input_tokens||0;return u`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("request")}"
             @click=${()=>this._toggleSection("request")}
             @keydown=${a=>{(a.key==="Enter"||a.key===" ")&&(a.preventDefault(),this._toggleSection("request"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("request")?"▼":"▶"}</span>
          This Request
        </div>
        <div class="section-body ${this._isExpanded("request")?"":"collapsed"}">
          <div class="stat-row">
            <span class="stat-label">Prompt</span>
            <span class="stat-value">${A(t)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Completion</span>
            <span class="stat-value">${A(i)}</span>
          </div>
          ${s>0?u`
            <div class="stat-row">
              <span class="stat-label">Cache Read</span>
              <span class="stat-value green">${A(s)}</span>
            </div>
          `:m}
          ${r>0?u`
            <div class="stat-row">
              <span class="stat-label">Cache Write</span>
              <span class="stat-value yellow">${A(r)}</span>
            </div>
          `:m}
        </div>
      </div>
    `}_renderHistoryBudget(){const e=this._data;if(!e)return m;const t=e.breakdown;if(!t)return m;const i=t.history||0,s=e.total_tokens||0,r=e.max_input_tokens||1,n=Math.min(100,s/r*100),a=this._getBudgetColor(n);return u`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("budget")}"
             @click=${()=>this._toggleSection("budget")}
             @keydown=${l=>{(l.key==="Enter"||l.key===" ")&&(l.preventDefault(),this._toggleSection("budget"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("budget")?"▼":"▶"}</span>
          History Budget
        </div>
        <div class="section-body ${this._isExpanded("budget")?"":"collapsed"}">
          <div class="stat-row">
            <span class="stat-label">Total</span>
            <span class="stat-value">${A(s)} / ${A(r)}</span>
          </div>
          <div class="budget-bar">
            <div class="budget-bar-fill ${a}" style="width: ${n}%"></div>
          </div>
          <div class="stat-row">
            <span class="stat-label">History</span>
            <span class="stat-value">${A(i)}</span>
          </div>
        </div>
      </div>
    `}_renderTierChanges(){const e=this._data,t=e==null?void 0:e.promotions,i=e==null?void 0:e.demotions;return!(t!=null&&t.length)&&!(i!=null&&i.length)?m:u`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("changes")}"
             @click=${()=>this._toggleSection("changes")}
             @keydown=${s=>{(s.key==="Enter"||s.key===" ")&&(s.preventDefault(),this._toggleSection("changes"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("changes")?"▼":"▶"}</span>
          Tier Changes
        </div>
        <div class="section-body ${this._isExpanded("changes")?"":"collapsed"}">
          ${(t||[]).map(s=>u`
            <div class="change-item">
              <span class="change-icon">📈</span>
              <span class="change-text" title="${s}">${s}</span>
            </div>
          `)}
          ${(i||[]).map(s=>u`
            <div class="change-item">
              <span class="change-icon">📉</span>
              <span class="change-text" title="${s}">${s}</span>
            </div>
          `)}
        </div>
      </div>
    `}_renderSessionTotals(){var t;const e=(t=this._data)==null?void 0:t.session_totals;return e?u`
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
            <span class="stat-value">${A(e.prompt)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Completion Out</span>
            <span class="stat-value">${A(e.completion)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Total</span>
            <span class="stat-value">${A(e.total)}</span>
          </div>
          ${e.cache_hit>0?u`
            <div class="stat-row">
              <span class="stat-label">Cache Saved</span>
              <span class="stat-value green">${A(e.cache_hit)}</span>
            </div>
          `:m}
          ${e.cache_write>0?u`
            <div class="stat-row">
              <span class="stat-label">Cache Written</span>
              <span class="stat-value yellow">${A(e.cache_write)}</span>
            </div>
          `:m}
        </div>
      </div>
    `:m}render(){return this._visible?u`
      <div class="hud ${this._fading?"fading":""}"
        @mouseenter=${this._onMouseEnter}
        @mouseleave=${this._onMouseLeave}
      >
        ${this._renderHeader()}
        ${this._renderCacheTiers()}
        ${this._renderThisRequest()}
        ${this._renderHistoryBudget()}
        ${this._renderTierChanges()}
        ${this._renderSessionTotals()}
      </div>
    `:m}}w(mt,"properties",{_visible:{type:Boolean,state:!0},_fading:{type:Boolean,state:!0},_data:{type:Object,state:!0},_basicData:{type:Object,state:!0},_collapsed:{type:Object,state:!0}}),w(mt,"styles",[R,T`
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
  `]);customElements.define("ac-token-hud",mt);function er(){const e=new URLSearchParams(window.location.search).get("port");return e?parseInt(e,10):18080}class gt extends Oi{constructor(){super(),this._port=er(),this._reconnectAttempt=0,this._reconnectTimer=null,this._statusBar="hidden",this._reconnectVisible=!1,this._reconnectMsg="",this._toasts=[],this._toastIdCounter=0,this._wasConnected=!1,this._statusBarTimer=null,this.serverURI=`ws://localhost:${this._port}`,this.remoteTimeout=60,this._onNavigateFile=this._onNavigateFile.bind(this),this._onFileSave=this._onFileSave.bind(this),this._onStreamCompleteForDiff=this._onStreamCompleteForDiff.bind(this),this._onFilesModified=this._onFilesModified.bind(this),this._onSearchNavigate=this._onSearchNavigate.bind(this),this._onGlobalKeyDown=this._onGlobalKeyDown.bind(this),this._onToastEvent=this._onToastEvent.bind(this)}connectedCallback(){super.connectedCallback(),console.log(`AC⚡DC connecting to ${this.serverURI}`),this.addClass(this,"AcApp"),window.addEventListener("navigate-file",this._onNavigateFile),window.addEventListener("file-save",this._onFileSave),window.addEventListener("stream-complete",this._onStreamCompleteForDiff),window.addEventListener("files-modified",this._onFilesModified),window.addEventListener("search-navigate",this._onSearchNavigate),window.addEventListener("keydown",this._onGlobalKeyDown),window.addEventListener("ac-toast",this._onToastEvent)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("navigate-file",this._onNavigateFile),window.removeEventListener("file-save",this._onFileSave),window.removeEventListener("stream-complete",this._onStreamCompleteForDiff),window.removeEventListener("files-modified",this._onFilesModified),window.removeEventListener("search-navigate",this._onSearchNavigate),window.removeEventListener("keydown",this._onGlobalKeyDown),window.removeEventListener("ac-toast",this._onToastEvent),this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._statusBarTimer&&clearTimeout(this._statusBarTimer)}remoteIsUp(){console.log("WebSocket connected — remote is up");const e=this._reconnectAttempt>0;this._reconnectAttempt=0,this._reconnectVisible=!1,this._reconnectMsg="",this._reconnectTimer&&(clearTimeout(this._reconnectTimer),this._reconnectTimer=null),this._showStatusBar("ok"),e&&this._showToast("Reconnected","success")}setupDone(){console.log("jrpc-oo setup done — call proxy ready"),this._wasConnected=!0,pe.set(this.call),this._loadInitialState()}setupSkip(){console.warn("jrpc-oo setup skipped — connection failed"),this._wasConnected&&this._scheduleReconnect()}remoteDisconnected(){console.log("WebSocket disconnected"),pe.clear(),this._showStatusBar("error",!1),window.dispatchEvent(new CustomEvent("rpc-disconnected")),this._scheduleReconnect()}_scheduleReconnect(){if(this._reconnectTimer)return;this._reconnectAttempt++;const e=Math.min(1e3*Math.pow(2,this._reconnectAttempt-1),15e3),t=(e/1e3).toFixed(0);this._reconnectMsg=`Reconnecting (attempt ${this._reconnectAttempt})... retry in ${t}s`,this._reconnectVisible=!0,console.log(`Scheduling reconnect attempt ${this._reconnectAttempt} in ${e}ms`),this._reconnectTimer=setTimeout(()=>{this._reconnectTimer=null,this._reconnectMsg=`Reconnecting (attempt ${this._reconnectAttempt})...`,this.requestUpdate();try{this.open(this.serverURI)}catch(i){console.error("Reconnect failed:",i),this._scheduleReconnect()}},e)}_showStatusBar(e,t=!0){this._statusBar=e,this._statusBarTimer&&(clearTimeout(this._statusBarTimer),this._statusBarTimer=null),t&&(this._statusBarTimer=setTimeout(()=>{this._statusBar="hidden"},3e3))}_onToastEvent(e){const{message:t,type:i}=e.detail||{};t&&this._showToast(t,i||"")}_showToast(e,t=""){const i=++this._toastIdCounter;this._toasts=[...this._toasts,{id:i,message:e,type:t,fading:!1}],setTimeout(()=>{this._toasts=this._toasts.map(s=>s.id===i?{...s,fading:!0}:s),setTimeout(()=>{this._toasts=this._toasts.filter(s=>s.id!==i)},300)},3e3)}streamChunk(e,t){return window.dispatchEvent(new CustomEvent("stream-chunk",{detail:{requestId:e,content:t}})),!0}streamComplete(e,t){return window.dispatchEvent(new CustomEvent("stream-complete",{detail:{requestId:e,result:t}})),!0}compactionEvent(e,t){return window.dispatchEvent(new CustomEvent("compaction-event",{detail:{requestId:e,event:t}})),!0}filesChanged(e){return window.dispatchEvent(new CustomEvent("files-changed",{detail:{selectedFiles:e}})),!0}async _loadInitialState(){try{const e=await this.call["LLMService.get_current_state"](),t=this._extract(e);console.log("Initial state loaded:",t),t!=null&&t.repo_name&&(document.title=`${t.repo_name}`),window.dispatchEvent(new CustomEvent("state-loaded",{detail:t}))}catch(e){console.error("Failed to load initial state:",e)}}_extract(e){if(e&&typeof e=="object"){const t=Object.keys(e);if(t.length===1)return e[t[0]]}return e}_onNavigateFile(e){var s;const t=e.detail;if(!(t!=null&&t.path))return;const i=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-diff-viewer");i&&i.openFile({path:t.path,original:t.original,modified:t.modified,is_new:t.is_new,is_read_only:t.is_read_only,is_config:t.is_config,config_type:t.config_type,real_path:t.real_path,searchText:t.searchText,line:t.line})}_onSearchNavigate(e){const t=e.detail;t!=null&&t.path&&this._onNavigateFile({detail:{path:t.path,line:t.line}})}async _onFileSave(e){const{path:t,content:i,isConfig:s,configType:r}=e.detail;if(t)try{s&&r?await this.call["Settings.save_config_content"](r,i):await this.call["Repo.write_file"](t,i)}catch(n){console.error("File save failed:",n),this._showToast(`Save failed: ${n.message||"Unknown error"}`,"error")}}_onStreamCompleteForDiff(e){var s,r,n;const t=(s=e.detail)==null?void 0:s.result;if(!((r=t==null?void 0:t.files_modified)!=null&&r.length))return;const i=(n=this.shadowRoot)==null?void 0:n.querySelector("ac-diff-viewer");i&&i.refreshOpenFiles()}_onFilesModified(e){var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-diff-viewer");t&&t._files.length>0&&t.refreshOpenFiles()}_onGlobalKeyDown(e){(e.ctrlKey||e.metaKey)&&e.key==="s"&&e.preventDefault()}render(){return u`
      <div class="viewport">
        <div class="diff-background" role="region" aria-label="Code diff viewer">
          <ac-diff-viewer></ac-diff-viewer>
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
        ${this._toasts.map(e=>u`
          <div class="global-toast ${e.type} ${e.fading?"fading":""}" role="alert">${e.message}</div>
        `)}
      </div>
    `}}w(gt,"properties",{_statusBar:{type:String,state:!0},_reconnectVisible:{type:Boolean,state:!0},_reconnectMsg:{type:String,state:!0},_toasts:{type:Array,state:!0}}),w(gt,"styles",[R,T`
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

    /* Diff viewer background */
    .diff-background {
      position: fixed;
      inset: 0;
      z-index: 0;
      background: var(--bg-primary);
    }

    .diff-background ac-diff-viewer {
      width: 100%;
      height: 100%;
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
  `]);customElements.define("ac-app",gt);export{m as A,U as R,T as a,u as b,E as i,N as o,O as s,R as t,ar as w};
