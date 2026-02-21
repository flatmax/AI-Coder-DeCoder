const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/review-selector-Brfqlu8V.js","assets/monaco-B6MQ1wD3.js","assets/monaco-B5ouZ0XZ.css","assets/marked-IDzlF_wn.js","assets/hljs-gJDTAEaL.js","assets/ac-search-tab-B5jORBJK.js","assets/ac-context-tab-CfSaLJGV.js","assets/ac-cache-tab-BamMAK8v.js","assets/ac-settings-tab-BPeNWfF3.js"])))=>i.map(i=>d[i]);
var xs=Object.defineProperty;var ws=Object.getPrototypeOf;var Ss=Reflect.get;var $s=(r,e,t)=>e in r?xs(r,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):r[e]=t;var C=(r,e,t)=>$s(r,typeof e!="symbol"?e+"":e,t);var Yt=(r,e,t)=>Ss(ws(r),t,e);import{_ as Ee,e as W,l as q,R as He,U as Gt}from"./monaco-B6MQ1wD3.js";import{M as Wi}from"./marked-IDzlF_wn.js";import{H as k,j as Ki,p as Xi,t as Yi,a as Cs,b as qt,c as ks,x as Gi,y as Ji,d as Es,e as As,f as Ts,m as Qi,g as Jt,h as Ms}from"./hljs-gJDTAEaL.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))i(s);new MutationObserver(s=>{for(const n of s)if(n.type==="childList")for(const o of n.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function t(s){const n={};return s.integrity&&(n.integrity=s.integrity),s.referrerPolicy&&(n.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?n.credentials="include":s.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function i(s){if(s.ep)return;s.ep=!0;const n=t(s);fetch(s.href,n)}})();/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Xe=globalThis,Bt=Xe.ShadowRoot&&(Xe.ShadyCSS===void 0||Xe.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,Nt=Symbol(),Qt=new WeakMap;let es=class{constructor(e,t,i){if(this._$cssResult$=!0,i!==Nt)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const t=this.t;if(Bt&&e===void 0){const i=t!==void 0&&t.length===1;i&&(e=Qt.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),i&&Qt.set(t,e))}return e}toString(){return this.cssText}};const Rs=r=>new es(typeof r=="string"?r:r+"",void 0,Nt),z=(r,...e)=>{const t=r.length===1?r[0]:e.reduce((i,s,n)=>i+(o=>{if(o._$cssResult$===!0)return o.cssText;if(typeof o=="number")return o;throw Error("Value passed to 'css' function must be a 'css' function result: "+o+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+r[n+1],r[0]);return new es(t,r,Nt)},Ls=(r,e)=>{if(Bt)r.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const t of e){const i=document.createElement("style"),s=Xe.litNonce;s!==void 0&&i.setAttribute("nonce",s),i.textContent=t.cssText,r.appendChild(i)}},ei=Bt?r=>r:r=>r instanceof CSSStyleSheet?(e=>{let t="";for(const i of e.cssRules)t+=i.cssText;return Rs(t)})(r):r;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:zs,defineProperty:Is,getOwnPropertyDescriptor:Ds,getOwnPropertyNames:Ps,getOwnPropertySymbols:Fs,getPrototypeOf:Os}=Object,Q=globalThis,ti=Q.trustedTypes,qs=ti?ti.emptyScript:"",nt=Q.reactiveElementPolyfillSupport,Ae=(r,e)=>r,gt={toAttribute(r,e){switch(e){case Boolean:r=r?qs:null;break;case Object:case Array:r=r==null?r:JSON.stringify(r)}return r},fromAttribute(r,e){let t=r;switch(e){case Boolean:t=r!==null;break;case Number:t=r===null?null:Number(r);break;case Object:case Array:try{t=JSON.parse(r)}catch{t=null}}return t}},ts=(r,e)=>!zs(r,e),ii={attribute:!0,type:String,converter:gt,reflect:!1,useDefault:!1,hasChanged:ts};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),Q.litPropertyMetadata??(Q.litPropertyMetadata=new WeakMap);let ue=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??(this.l=[])).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=ii){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){const i=Symbol(),s=this.getPropertyDescriptor(e,i,t);s!==void 0&&Is(this.prototype,e,s)}}static getPropertyDescriptor(e,t,i){const{get:s,set:n}=Ds(this.prototype,e)??{get(){return this[t]},set(o){this[t]=o}};return{get:s,set(o){const a=s==null?void 0:s.call(this);n==null||n.call(this,o),this.requestUpdate(e,a,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??ii}static _$Ei(){if(this.hasOwnProperty(Ae("elementProperties")))return;const e=Os(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(Ae("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Ae("properties"))){const t=this.properties,i=[...Ps(t),...Fs(t)];for(const s of i)this.createProperty(s,t[s])}const e=this[Symbol.metadata];if(e!==null){const t=litPropertyMetadata.get(e);if(t!==void 0)for(const[i,s]of t)this.elementProperties.set(i,s)}this._$Eh=new Map;for(const[t,i]of this.elementProperties){const s=this._$Eu(t,i);s!==void 0&&this._$Eh.set(s,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const i=new Set(e.flat(1/0).reverse());for(const s of i)t.unshift(ei(s))}else e!==void 0&&t.push(ei(e));return t}static _$Eu(e,t){const i=t.attribute;return i===!1?void 0:typeof i=="string"?i:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){var e;this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),(e=this.constructor.l)==null||e.forEach(t=>t(this))}addController(e){var t;(this._$EO??(this._$EO=new Set)).add(e),this.renderRoot!==void 0&&this.isConnected&&((t=e.hostConnected)==null||t.call(e))}removeController(e){var t;(t=this._$EO)==null||t.delete(e)}_$E_(){const e=new Map,t=this.constructor.elementProperties;for(const i of t.keys())this.hasOwnProperty(i)&&(e.set(i,this[i]),delete this[i]);e.size>0&&(this._$Ep=e)}createRenderRoot(){const e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Ls(e,this.constructor.elementStyles),e}connectedCallback(){var e;this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostConnected)==null?void 0:i.call(t)})}enableUpdating(e){}disconnectedCallback(){var e;(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostDisconnected)==null?void 0:i.call(t)})}attributeChangedCallback(e,t,i){this._$AK(e,i)}_$ET(e,t){var n;const i=this.constructor.elementProperties.get(e),s=this.constructor._$Eu(e,i);if(s!==void 0&&i.reflect===!0){const o=(((n=i.converter)==null?void 0:n.toAttribute)!==void 0?i.converter:gt).toAttribute(t,i.type);this._$Em=e,o==null?this.removeAttribute(s):this.setAttribute(s,o),this._$Em=null}}_$AK(e,t){var n,o;const i=this.constructor,s=i._$Eh.get(e);if(s!==void 0&&this._$Em!==s){const a=i.getPropertyOptions(s),l=typeof a.converter=="function"?{fromAttribute:a.converter}:((n=a.converter)==null?void 0:n.fromAttribute)!==void 0?a.converter:gt;this._$Em=s;const c=l.fromAttribute(t,a.type);this[s]=c??((o=this._$Ej)==null?void 0:o.get(s))??c,this._$Em=null}}requestUpdate(e,t,i,s=!1,n){var o;if(e!==void 0){const a=this.constructor;if(s===!1&&(n=this[e]),i??(i=a.getPropertyOptions(e)),!((i.hasChanged??ts)(n,t)||i.useDefault&&i.reflect&&n===((o=this._$Ej)==null?void 0:o.get(e))&&!this.hasAttribute(a._$Eu(e,i))))return;this.C(e,t,i)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:i,reflect:s,wrapped:n},o){i&&!(this._$Ej??(this._$Ej=new Map)).has(e)&&(this._$Ej.set(e,o??t??this[e]),n!==!0||o!==void 0)||(this._$AL.has(e)||(this.hasUpdated||i||(t=void 0),this._$AL.set(e,t)),s===!0&&this._$Em!==e&&(this._$Eq??(this._$Eq=new Set)).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var i;if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(const[n,o]of this._$Ep)this[n]=o;this._$Ep=void 0}const s=this.constructor.elementProperties;if(s.size>0)for(const[n,o]of s){const{wrapped:a}=o,l=this[n];a!==!0||this._$AL.has(n)||l===void 0||this.C(n,void 0,o,l)}}let e=!1;const t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),(i=this._$EO)==null||i.forEach(s=>{var n;return(n=s.hostUpdate)==null?void 0:n.call(s)}),this.update(t)):this._$EM()}catch(s){throw e=!1,this._$EM(),s}e&&this._$AE(t)}willUpdate(e){}_$AE(e){var t;(t=this._$EO)==null||t.forEach(i=>{var s;return(s=i.hostUpdated)==null?void 0:s.call(i)}),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&(this._$Eq=this._$Eq.forEach(t=>this._$ET(t,this[t]))),this._$EM()}updated(e){}firstUpdated(e){}};ue.elementStyles=[],ue.shadowRootOptions={mode:"open"},ue[Ae("elementProperties")]=new Map,ue[Ae("finalized")]=new Map,nt==null||nt({ReactiveElement:ue}),(Q.reactiveElementVersions??(Q.reactiveElementVersions=[])).push("2.1.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Te=globalThis,si=r=>r,Je=Te.trustedTypes,ni=Je?Je.createPolicy("lit-html",{createHTML:r=>r}):void 0,is="$lit$",Y=`lit$${Math.random().toFixed(9).slice(2)}$`,ss="?"+Y,Bs=`<${ss}>`,ce=document,Ie=()=>ce.createComment(""),De=r=>r===null||typeof r!="object"&&typeof r!="function",Ht=Array.isArray,Ns=r=>Ht(r)||typeof(r==null?void 0:r[Symbol.iterator])=="function",rt=`[ 	
\f\r]`,be=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,ri=/-->/g,oi=/>/g,se=RegExp(`>|${rt}(?:([^\\s"'>=/]+)(${rt}*=${rt}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),ai=/'/g,li=/"/g,ns=/^(?:script|style|textarea|title)$/i,rs=r=>(e,...t)=>({_$litType$:r,strings:e,values:t}),m=rs(1),ar=rs(2),de=Symbol.for("lit-noChange"),v=Symbol.for("lit-nothing"),ci=new WeakMap,re=ce.createTreeWalker(ce,129);function os(r,e){if(!Ht(r)||!r.hasOwnProperty("raw"))throw Error("invalid template strings array");return ni!==void 0?ni.createHTML(e):e}const Hs=(r,e)=>{const t=r.length-1,i=[];let s,n=e===2?"<svg>":e===3?"<math>":"",o=be;for(let a=0;a<t;a++){const l=r[a];let c,h,d=-1,p=0;for(;p<l.length&&(o.lastIndex=p,h=o.exec(l),h!==null);)p=o.lastIndex,o===be?h[1]==="!--"?o=ri:h[1]!==void 0?o=oi:h[2]!==void 0?(ns.test(h[2])&&(s=RegExp("</"+h[2],"g")),o=se):h[3]!==void 0&&(o=se):o===se?h[0]===">"?(o=s??be,d=-1):h[1]===void 0?d=-2:(d=o.lastIndex-h[2].length,c=h[1],o=h[3]===void 0?se:h[3]==='"'?li:ai):o===li||o===ai?o=se:o===ri||o===oi?o=be:(o=se,s=void 0);const _=o===se&&r[a+1].startsWith("/>")?" ":"";n+=o===be?l+Bs:d>=0?(i.push(c),l.slice(0,d)+is+l.slice(d)+Y+_):l+Y+(d===-2?a:_)}return[os(r,n+(r[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),i]};let _t=class as{constructor({strings:e,_$litType$:t},i){let s;this.parts=[];let n=0,o=0;const a=e.length-1,l=this.parts,[c,h]=Hs(e,t);if(this.el=as.createElement(c,i),re.currentNode=this.el.content,t===2||t===3){const d=this.el.content.firstChild;d.replaceWith(...d.childNodes)}for(;(s=re.nextNode())!==null&&l.length<a;){if(s.nodeType===1){if(s.hasAttributes())for(const d of s.getAttributeNames())if(d.endsWith(is)){const p=h[o++],_=s.getAttribute(d).split(Y),g=/([.?@])?(.*)/.exec(p);l.push({type:1,index:n,name:g[2],strings:_,ctor:g[1]==="."?js:g[1]==="?"?Vs:g[1]==="@"?Zs:tt}),s.removeAttribute(d)}else d.startsWith(Y)&&(l.push({type:6,index:n}),s.removeAttribute(d));if(ns.test(s.tagName)){const d=s.textContent.split(Y),p=d.length-1;if(p>0){s.textContent=Je?Je.emptyScript:"";for(let _=0;_<p;_++)s.append(d[_],Ie()),re.nextNode(),l.push({type:2,index:++n});s.append(d[p],Ie())}}}else if(s.nodeType===8)if(s.data===ss)l.push({type:2,index:n});else{let d=-1;for(;(d=s.data.indexOf(Y,d+1))!==-1;)l.push({type:7,index:n}),d+=Y.length-1}n++}}static createElement(e,t){const i=ce.createElement("template");return i.innerHTML=e,i}};function ge(r,e,t=r,i){var o,a;if(e===de)return e;let s=i!==void 0?(o=t._$Co)==null?void 0:o[i]:t._$Cl;const n=De(e)?void 0:e._$litDirective$;return(s==null?void 0:s.constructor)!==n&&((a=s==null?void 0:s._$AO)==null||a.call(s,!1),n===void 0?s=void 0:(s=new n(r),s._$AT(r,t,i)),i!==void 0?(t._$Co??(t._$Co=[]))[i]=s:t._$Cl=s),s!==void 0&&(e=ge(r,s._$AS(r,e.values),s,i)),e}let Us=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){const{el:{content:t},parts:i}=this._$AD,s=((e==null?void 0:e.creationScope)??ce).importNode(t,!0);re.currentNode=s;let n=re.nextNode(),o=0,a=0,l=i[0];for(;l!==void 0;){if(o===l.index){let c;l.type===2?c=new Ut(n,n.nextSibling,this,e):l.type===1?c=new l.ctor(n,l.name,l.strings,this,e):l.type===6&&(c=new Ws(n,this,e)),this._$AV.push(c),l=i[++a]}o!==(l==null?void 0:l.index)&&(n=re.nextNode(),o++)}return re.currentNode=ce,s}p(e){let t=0;for(const i of this._$AV)i!==void 0&&(i.strings!==void 0?(i._$AI(e,i,t),t+=i.strings.length-2):i._$AI(e[t])),t++}},Ut=class ls{get _$AU(){var e;return((e=this._$AM)==null?void 0:e._$AU)??this._$Cv}constructor(e,t,i,s){this.type=2,this._$AH=v,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=i,this.options=s,this._$Cv=(s==null?void 0:s.isConnected)??!0}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return t!==void 0&&(e==null?void 0:e.nodeType)===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=ge(this,e,t),De(e)?e===v||e==null||e===""?(this._$AH!==v&&this._$AR(),this._$AH=v):e!==this._$AH&&e!==de&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):Ns(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==v&&De(this._$AH)?this._$AA.nextSibling.data=e:this.T(ce.createTextNode(e)),this._$AH=e}$(e){var n;const{values:t,_$litType$:i}=e,s=typeof i=="number"?this._$AC(e):(i.el===void 0&&(i.el=_t.createElement(os(i.h,i.h[0]),this.options)),i);if(((n=this._$AH)==null?void 0:n._$AD)===s)this._$AH.p(t);else{const o=new Us(s,this),a=o.u(this.options);o.p(t),this.T(a),this._$AH=o}}_$AC(e){let t=ci.get(e.strings);return t===void 0&&ci.set(e.strings,t=new _t(e)),t}k(e){Ht(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let i,s=0;for(const n of e)s===t.length?t.push(i=new ls(this.O(Ie()),this.O(Ie()),this,this.options)):i=t[s],i._$AI(n),s++;s<t.length&&(this._$AR(i&&i._$AB.nextSibling,s),t.length=s)}_$AR(e=this._$AA.nextSibling,t){var i;for((i=this._$AP)==null?void 0:i.call(this,!1,!0,t);e!==this._$AB;){const s=si(e).nextSibling;si(e).remove(),e=s}}setConnected(e){var t;this._$AM===void 0&&(this._$Cv=e,(t=this._$AP)==null||t.call(this,e))}},tt=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,i,s,n){this.type=1,this._$AH=v,this._$AN=void 0,this.element=e,this.name=t,this._$AM=s,this.options=n,i.length>2||i[0]!==""||i[1]!==""?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=v}_$AI(e,t=this,i,s){const n=this.strings;let o=!1;if(n===void 0)e=ge(this,e,t,0),o=!De(e)||e!==this._$AH&&e!==de,o&&(this._$AH=e);else{const a=e;let l,c;for(e=n[0],l=0;l<n.length-1;l++)c=ge(this,a[i+l],t,l),c===de&&(c=this._$AH[l]),o||(o=!De(c)||c!==this._$AH[l]),c===v?e=v:e!==v&&(e+=(c??"")+n[l+1]),this._$AH[l]=c}o&&!s&&this.j(e)}j(e){e===v?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},js=class extends tt{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===v?void 0:e}},Vs=class extends tt{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==v)}},Zs=class extends tt{constructor(e,t,i,s,n){super(e,t,i,s,n),this.type=5}_$AI(e,t=this){if((e=ge(this,e,t,0)??v)===de)return;const i=this._$AH,s=e===v&&i!==v||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,n=e!==v&&(i===v||s);s&&this.element.removeEventListener(this.name,this,i),n&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var t;typeof this._$AH=="function"?this._$AH.call(((t=this.options)==null?void 0:t.host)??this.element,e):this._$AH.handleEvent(e)}},Ws=class{constructor(e,t,i){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(e){ge(this,e)}};const ot=Te.litHtmlPolyfillSupport;ot==null||ot(_t,Ut),(Te.litHtmlVersions??(Te.litHtmlVersions=[])).push("3.3.2");const Ks=(r,e,t)=>{const i=(t==null?void 0:t.renderBefore)??e;let s=i._$litPart$;if(s===void 0){const n=(t==null?void 0:t.renderBefore)??null;i._$litPart$=s=new Ut(e.insertBefore(Ie(),n),n,void 0,t??{})}return s._$AI(r),s};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const ae=globalThis;let L=class extends ue{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var t;const e=super.createRenderRoot();return(t=this.renderOptions).renderBefore??(t.renderBefore=e.firstChild),e}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Ks(t,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),(e=this._$Do)==null||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this._$Do)==null||e.setConnected(!1)}render(){return de}};var Vi;L._$litElement$=!0,L.finalized=!0,(Vi=ae.litElementHydrateSupport)==null||Vi.call(ae,{LitElement:L});const at=ae.litElementPolyfillSupport;at==null||at({LitElement:L});(ae.litElementVersions??(ae.litElementVersions=[])).push("4.2.2");const Ue=new Set;let xe=null;const Me={set(r){xe=r;for(const e of Ue)try{e(r)}catch(t){console.error("SharedRpc listener error:",t)}},get(){return xe},addListener(r){if(Ue.add(r),xe)try{r(xe)}catch(e){console.error("SharedRpc listener error:",e)}},removeListener(r){Ue.delete(r)},clear(){xe=null;for(const r of Ue)try{r(null)}catch(e){console.error("SharedRpc listener error:",e)}}},F=z`
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
`,j=z`
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
`;let di=class{getAllFns(e,t){let i=[],s=e.constructor.prototype;for(;s!=null;){let n=s.constructor.name.replace("_exports_","");if(t!=null&&(n=t),n!=="Object"){let o=Object.getOwnPropertyNames(s).filter(a=>a!=="constructor"&&a.indexOf("__")<0);o.forEach((a,l)=>{o[l]=n+"."+a}),i=i.concat(o)}if(t!=null)break;s=s.__proto__}return i}exposeAllFns(e,t){let i=this.getAllFns(e,t);var s={};return i.forEach(function(n){s[n]=function(o,a){Promise.resolve(e[n.substring(n.indexOf(".")+1)].apply(e,o.args)).then(function(l){return a(null,l)}).catch(function(l){return console.log("failed : "+l),a(l)})}}),s}};typeof module<"u"&&typeof module.exports<"u"?module.exports=di:Window.ExposeClass=di;/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Ye=globalThis,jt=Ye.ShadowRoot&&(Ye.ShadyCSS===void 0||Ye.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,cs=Symbol(),hi=new WeakMap;let Xs=class{constructor(e,t,i){if(this._$cssResult$=!0,i!==cs)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const t=this.t;if(jt&&e===void 0){const i=t!==void 0&&t.length===1;i&&(e=hi.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),i&&hi.set(t,e))}return e}toString(){return this.cssText}};const Ys=r=>new Xs(typeof r=="string"?r:r+"",void 0,cs),Gs=(r,e)=>{if(jt)r.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const t of e){const i=document.createElement("style"),s=Ye.litNonce;s!==void 0&&i.setAttribute("nonce",s),i.textContent=t.cssText,r.appendChild(i)}},pi=jt?r=>r:r=>r instanceof CSSStyleSheet?(e=>{let t="";for(const i of e.cssRules)t+=i.cssText;return Ys(t)})(r):r;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:Js,defineProperty:Qs,getOwnPropertyDescriptor:en,getOwnPropertyNames:tn,getOwnPropertySymbols:sn,getPrototypeOf:nn}=Object,ee=globalThis,ui=ee.trustedTypes,rn=ui?ui.emptyScript:"",lt=ee.reactiveElementPolyfillSupport,Re=(r,e)=>r,vt={toAttribute(r,e){switch(e){case Boolean:r=r?rn:null;break;case Object:case Array:r=r==null?r:JSON.stringify(r)}return r},fromAttribute(r,e){let t=r;switch(e){case Boolean:t=r!==null;break;case Number:t=r===null?null:Number(r);break;case Object:case Array:try{t=JSON.parse(r)}catch{t=null}}return t}},ds=(r,e)=>!Js(r,e),fi={attribute:!0,type:String,converter:vt,reflect:!1,useDefault:!1,hasChanged:ds};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),ee.litPropertyMetadata??(ee.litPropertyMetadata=new WeakMap);let fe=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??(this.l=[])).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=fi){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){const i=Symbol(),s=this.getPropertyDescriptor(e,i,t);s!==void 0&&Qs(this.prototype,e,s)}}static getPropertyDescriptor(e,t,i){const{get:s,set:n}=en(this.prototype,e)??{get(){return this[t]},set(o){this[t]=o}};return{get:s,set(o){const a=s==null?void 0:s.call(this);n==null||n.call(this,o),this.requestUpdate(e,a,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??fi}static _$Ei(){if(this.hasOwnProperty(Re("elementProperties")))return;const e=nn(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(Re("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Re("properties"))){const t=this.properties,i=[...tn(t),...sn(t)];for(const s of i)this.createProperty(s,t[s])}const e=this[Symbol.metadata];if(e!==null){const t=litPropertyMetadata.get(e);if(t!==void 0)for(const[i,s]of t)this.elementProperties.set(i,s)}this._$Eh=new Map;for(const[t,i]of this.elementProperties){const s=this._$Eu(t,i);s!==void 0&&this._$Eh.set(s,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const i=new Set(e.flat(1/0).reverse());for(const s of i)t.unshift(pi(s))}else e!==void 0&&t.push(pi(e));return t}static _$Eu(e,t){const i=t.attribute;return i===!1?void 0:typeof i=="string"?i:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){var e;this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),(e=this.constructor.l)==null||e.forEach(t=>t(this))}addController(e){var t;(this._$EO??(this._$EO=new Set)).add(e),this.renderRoot!==void 0&&this.isConnected&&((t=e.hostConnected)==null||t.call(e))}removeController(e){var t;(t=this._$EO)==null||t.delete(e)}_$E_(){const e=new Map,t=this.constructor.elementProperties;for(const i of t.keys())this.hasOwnProperty(i)&&(e.set(i,this[i]),delete this[i]);e.size>0&&(this._$Ep=e)}createRenderRoot(){const e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Gs(e,this.constructor.elementStyles),e}connectedCallback(){var e;this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostConnected)==null?void 0:i.call(t)})}enableUpdating(e){}disconnectedCallback(){var e;(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostDisconnected)==null?void 0:i.call(t)})}attributeChangedCallback(e,t,i){this._$AK(e,i)}_$ET(e,t){var n;const i=this.constructor.elementProperties.get(e),s=this.constructor._$Eu(e,i);if(s!==void 0&&i.reflect===!0){const o=(((n=i.converter)==null?void 0:n.toAttribute)!==void 0?i.converter:vt).toAttribute(t,i.type);this._$Em=e,o==null?this.removeAttribute(s):this.setAttribute(s,o),this._$Em=null}}_$AK(e,t){var n,o;const i=this.constructor,s=i._$Eh.get(e);if(s!==void 0&&this._$Em!==s){const a=i.getPropertyOptions(s),l=typeof a.converter=="function"?{fromAttribute:a.converter}:((n=a.converter)==null?void 0:n.fromAttribute)!==void 0?a.converter:vt;this._$Em=s;const c=l.fromAttribute(t,a.type);this[s]=c??((o=this._$Ej)==null?void 0:o.get(s))??c,this._$Em=null}}requestUpdate(e,t,i,s=!1,n){var o;if(e!==void 0){const a=this.constructor;if(s===!1&&(n=this[e]),i??(i=a.getPropertyOptions(e)),!((i.hasChanged??ds)(n,t)||i.useDefault&&i.reflect&&n===((o=this._$Ej)==null?void 0:o.get(e))&&!this.hasAttribute(a._$Eu(e,i))))return;this.C(e,t,i)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:i,reflect:s,wrapped:n},o){i&&!(this._$Ej??(this._$Ej=new Map)).has(e)&&(this._$Ej.set(e,o??t??this[e]),n!==!0||o!==void 0)||(this._$AL.has(e)||(this.hasUpdated||i||(t=void 0),this._$AL.set(e,t)),s===!0&&this._$Em!==e&&(this._$Eq??(this._$Eq=new Set)).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var i;if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(const[n,o]of this._$Ep)this[n]=o;this._$Ep=void 0}const s=this.constructor.elementProperties;if(s.size>0)for(const[n,o]of s){const{wrapped:a}=o,l=this[n];a!==!0||this._$AL.has(n)||l===void 0||this.C(n,void 0,o,l)}}let e=!1;const t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),(i=this._$EO)==null||i.forEach(s=>{var n;return(n=s.hostUpdate)==null?void 0:n.call(s)}),this.update(t)):this._$EM()}catch(s){throw e=!1,this._$EM(),s}e&&this._$AE(t)}willUpdate(e){}_$AE(e){var t;(t=this._$EO)==null||t.forEach(i=>{var s;return(s=i.hostUpdated)==null?void 0:s.call(i)}),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&(this._$Eq=this._$Eq.forEach(t=>this._$ET(t,this[t]))),this._$EM()}updated(e){}firstUpdated(e){}};fe.elementStyles=[],fe.shadowRootOptions={mode:"open"},fe[Re("elementProperties")]=new Map,fe[Re("finalized")]=new Map,lt==null||lt({ReactiveElement:fe}),(ee.reactiveElementVersions??(ee.reactiveElementVersions=[])).push("2.1.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Le=globalThis,mi=r=>r,Qe=Le.trustedTypes,gi=Qe?Qe.createPolicy("lit-html",{createHTML:r=>r}):void 0,hs="$lit$",G=`lit$${Math.random().toFixed(9).slice(2)}$`,ps="?"+G,on=`<${ps}>`,he=document,Pe=()=>he.createComment(""),Fe=r=>r===null||typeof r!="object"&&typeof r!="function",Vt=Array.isArray,an=r=>Vt(r)||typeof(r==null?void 0:r[Symbol.iterator])=="function",ct=`[ 	
\f\r]`,we=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,_i=/-->/g,vi=/>/g,ne=RegExp(`>|${ct}(?:([^\\s"'>=/]+)(${ct}*=${ct}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),yi=/'/g,bi=/"/g,us=/^(?:script|style|textarea|title)$/i,_e=Symbol.for("lit-noChange"),T=Symbol.for("lit-nothing"),xi=new WeakMap,oe=he.createTreeWalker(he,129);function fs(r,e){if(!Vt(r)||!r.hasOwnProperty("raw"))throw Error("invalid template strings array");return gi!==void 0?gi.createHTML(e):e}const ln=(r,e)=>{const t=r.length-1,i=[];let s,n=e===2?"<svg>":e===3?"<math>":"",o=we;for(let a=0;a<t;a++){const l=r[a];let c,h,d=-1,p=0;for(;p<l.length&&(o.lastIndex=p,h=o.exec(l),h!==null);)p=o.lastIndex,o===we?h[1]==="!--"?o=_i:h[1]!==void 0?o=vi:h[2]!==void 0?(us.test(h[2])&&(s=RegExp("</"+h[2],"g")),o=ne):h[3]!==void 0&&(o=ne):o===ne?h[0]===">"?(o=s??we,d=-1):h[1]===void 0?d=-2:(d=o.lastIndex-h[2].length,c=h[1],o=h[3]===void 0?ne:h[3]==='"'?bi:yi):o===bi||o===yi?o=ne:o===_i||o===vi?o=we:(o=ne,s=void 0);const _=o===ne&&r[a+1].startsWith("/>")?" ":"";n+=o===we?l+on:d>=0?(i.push(c),l.slice(0,d)+hs+l.slice(d)+G+_):l+G+(d===-2?a:_)}return[fs(r,n+(r[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),i]};class Oe{constructor({strings:e,_$litType$:t},i){let s;this.parts=[];let n=0,o=0;const a=e.length-1,l=this.parts,[c,h]=ln(e,t);if(this.el=Oe.createElement(c,i),oe.currentNode=this.el.content,t===2||t===3){const d=this.el.content.firstChild;d.replaceWith(...d.childNodes)}for(;(s=oe.nextNode())!==null&&l.length<a;){if(s.nodeType===1){if(s.hasAttributes())for(const d of s.getAttributeNames())if(d.endsWith(hs)){const p=h[o++],_=s.getAttribute(d).split(G),g=/([.?@])?(.*)/.exec(p);l.push({type:1,index:n,name:g[2],strings:_,ctor:g[1]==="."?dn:g[1]==="?"?hn:g[1]==="@"?pn:it}),s.removeAttribute(d)}else d.startsWith(G)&&(l.push({type:6,index:n}),s.removeAttribute(d));if(us.test(s.tagName)){const d=s.textContent.split(G),p=d.length-1;if(p>0){s.textContent=Qe?Qe.emptyScript:"";for(let _=0;_<p;_++)s.append(d[_],Pe()),oe.nextNode(),l.push({type:2,index:++n});s.append(d[p],Pe())}}}else if(s.nodeType===8)if(s.data===ps)l.push({type:2,index:n});else{let d=-1;for(;(d=s.data.indexOf(G,d+1))!==-1;)l.push({type:7,index:n}),d+=G.length-1}n++}}static createElement(e,t){const i=he.createElement("template");return i.innerHTML=e,i}}function ve(r,e,t=r,i){var o,a;if(e===_e)return e;let s=i!==void 0?(o=t._$Co)==null?void 0:o[i]:t._$Cl;const n=Fe(e)?void 0:e._$litDirective$;return(s==null?void 0:s.constructor)!==n&&((a=s==null?void 0:s._$AO)==null||a.call(s,!1),n===void 0?s=void 0:(s=new n(r),s._$AT(r,t,i)),i!==void 0?(t._$Co??(t._$Co=[]))[i]=s:t._$Cl=s),s!==void 0&&(e=ve(r,s._$AS(r,e.values),s,i)),e}class cn{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){const{el:{content:t},parts:i}=this._$AD,s=((e==null?void 0:e.creationScope)??he).importNode(t,!0);oe.currentNode=s;let n=oe.nextNode(),o=0,a=0,l=i[0];for(;l!==void 0;){if(o===l.index){let c;l.type===2?c=new Be(n,n.nextSibling,this,e):l.type===1?c=new l.ctor(n,l.name,l.strings,this,e):l.type===6&&(c=new un(n,this,e)),this._$AV.push(c),l=i[++a]}o!==(l==null?void 0:l.index)&&(n=oe.nextNode(),o++)}return oe.currentNode=he,s}p(e){let t=0;for(const i of this._$AV)i!==void 0&&(i.strings!==void 0?(i._$AI(e,i,t),t+=i.strings.length-2):i._$AI(e[t])),t++}}class Be{get _$AU(){var e;return((e=this._$AM)==null?void 0:e._$AU)??this._$Cv}constructor(e,t,i,s){this.type=2,this._$AH=T,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=i,this.options=s,this._$Cv=(s==null?void 0:s.isConnected)??!0}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return t!==void 0&&(e==null?void 0:e.nodeType)===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=ve(this,e,t),Fe(e)?e===T||e==null||e===""?(this._$AH!==T&&this._$AR(),this._$AH=T):e!==this._$AH&&e!==_e&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):an(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==T&&Fe(this._$AH)?this._$AA.nextSibling.data=e:this.T(he.createTextNode(e)),this._$AH=e}$(e){var n;const{values:t,_$litType$:i}=e,s=typeof i=="number"?this._$AC(e):(i.el===void 0&&(i.el=Oe.createElement(fs(i.h,i.h[0]),this.options)),i);if(((n=this._$AH)==null?void 0:n._$AD)===s)this._$AH.p(t);else{const o=new cn(s,this),a=o.u(this.options);o.p(t),this.T(a),this._$AH=o}}_$AC(e){let t=xi.get(e.strings);return t===void 0&&xi.set(e.strings,t=new Oe(e)),t}k(e){Vt(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let i,s=0;for(const n of e)s===t.length?t.push(i=new Be(this.O(Pe()),this.O(Pe()),this,this.options)):i=t[s],i._$AI(n),s++;s<t.length&&(this._$AR(i&&i._$AB.nextSibling,s),t.length=s)}_$AR(e=this._$AA.nextSibling,t){var i;for((i=this._$AP)==null?void 0:i.call(this,!1,!0,t);e!==this._$AB;){const s=mi(e).nextSibling;mi(e).remove(),e=s}}setConnected(e){var t;this._$AM===void 0&&(this._$Cv=e,(t=this._$AP)==null||t.call(this,e))}}class it{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,i,s,n){this.type=1,this._$AH=T,this._$AN=void 0,this.element=e,this.name=t,this._$AM=s,this.options=n,i.length>2||i[0]!==""||i[1]!==""?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=T}_$AI(e,t=this,i,s){const n=this.strings;let o=!1;if(n===void 0)e=ve(this,e,t,0),o=!Fe(e)||e!==this._$AH&&e!==_e,o&&(this._$AH=e);else{const a=e;let l,c;for(e=n[0],l=0;l<n.length-1;l++)c=ve(this,a[i+l],t,l),c===_e&&(c=this._$AH[l]),o||(o=!Fe(c)||c!==this._$AH[l]),c===T?e=T:e!==T&&(e+=(c??"")+n[l+1]),this._$AH[l]=c}o&&!s&&this.j(e)}j(e){e===T?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}}class dn extends it{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===T?void 0:e}}class hn extends it{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==T)}}class pn extends it{constructor(e,t,i,s,n){super(e,t,i,s,n),this.type=5}_$AI(e,t=this){if((e=ve(this,e,t,0)??T)===_e)return;const i=this._$AH,s=e===T&&i!==T||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,n=e!==T&&(i===T||s);s&&this.element.removeEventListener(this.name,this,i),n&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var t;typeof this._$AH=="function"?this._$AH.call(((t=this.options)==null?void 0:t.host)??this.element,e):this._$AH.handleEvent(e)}}class un{constructor(e,t,i){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(e){ve(this,e)}}const dt=Le.litHtmlPolyfillSupport;dt==null||dt(Oe,Be),(Le.litHtmlVersions??(Le.litHtmlVersions=[])).push("3.3.2");const fn=(r,e,t)=>{const i=(t==null?void 0:t.renderBefore)??e;let s=i._$litPart$;if(s===void 0){const n=(t==null?void 0:t.renderBefore)??null;i._$litPart$=s=new Be(e.insertBefore(Pe(),n),n,void 0,t??{})}return s._$AI(r),s};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const le=globalThis;let ze=class extends fe{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var t;const e=super.createRenderRoot();return(t=this.renderOptions).renderBefore??(t.renderBefore=e.firstChild),e}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=fn(t,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),(e=this._$Do)==null||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this._$Do)==null||e.setConnected(!1)}render(){return _e}};var Zi;ze._$litElement$=!0,ze.finalized=!0,(Zi=le.litElementHydrateSupport)==null||Zi.call(le,{LitElement:ze});const ht=le.litElementPolyfillSupport;ht==null||ht({LitElement:ze});(le.litElementVersions??(le.litElementVersions=[])).push("4.2.2");Window.LitElement=ze;(function(r){if(typeof exports=="object"&&typeof module<"u")module.exports=r();else if(typeof define=="function"&&define.amd)define([],r);else{var e;e=typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:this,e.JRPC=r()}})(function(){return function r(e,t,i){function s(a,l){if(!t[a]){if(!e[a]){var c=typeof require=="function"&&require;if(!l&&c)return c(a,!0);if(n)return n(a,!0);var h=new Error("Cannot find module '"+a+"'");throw h.code="MODULE_NOT_FOUND",h}var d=t[a]={exports:{}};e[a][0].call(d.exports,function(p){var _=e[a][1][p];return s(_||p)},d,d.exports,r,e,t,i)}return t[a].exports}for(var n=typeof require=="function"&&require,o=0;o<i.length;o++)s(i[o]);return s}({1:[function(r,e,t){(function(i){/*! JRPC v3.1.0
* <https://github.com/vphantom/js-jrpc>
* Copyright 2016 Stéphane Lavergne
* Free software under MIT License: <https://opensource.org/licenses/MIT> */function s(u){this.active=!0,this.transmitter=null,this.remoteTimeout=6e4,this.localTimeout=0,this.serial=0,this.discardSerial=0,this.outbox={requests:[],responses:[]},this.inbox={},this.localTimers={},this.outTimers={},this.localComponents={"system.listComponents":!0,"system.extension.dual-batch":!0},this.remoteComponents={},this.exposed={},this.exposed["system.listComponents"]=(function(f,b){return typeof f=="object"&&f!==null&&(this.remoteComponents=f,this.remoteComponents["system._upgraded"]=!0),b(null,this.localComponents)}).bind(this),this.exposed["system.extension.dual-batch"]=function(f,b){return b(null,!0)},typeof u=="object"&&("remoteTimeout"in u&&typeof u.remoteTimeout=="number"&&(this.remoteTimeout=1e3*u.remoteTimeout),"localTimeout"in u&&typeof u.localTimeout=="number"&&(this.localTimeout=1e3*u.localTimeout))}function n(){var u=this;return u.active=!1,u.transmitter=null,u.remoteTimeout=0,u.localTimeout=0,u.localComponents={},u.remoteComponents={},u.outbox.requests.length=0,u.outbox.responses.length=0,u.inbox={},u.exposed={},Object.keys(u.localTimers).forEach(function(f){clearTimeout(u.localTimers[f]),delete u.localTimers[f]}),Object.keys(u.outTimers).forEach(function(f){clearTimeout(u.outTimers[f]),delete u.outTimers[f]}),u}function o(u){var f,b,S=null,x={responses:[],requests:[]};if(typeof u!="function"&&(u=this.transmitter),!this.active||typeof u!="function")return this;if(f=this.outbox.responses.length,b=this.outbox.requests.length,f>0&&b>0&&"system.extension.dual-batch"in this.remoteComponents)x=S={responses:this.outbox.responses,requests:this.outbox.requests},this.outbox.responses=[],this.outbox.requests=[];else if(f>0)f>1?(x.responses=S=this.outbox.responses,this.outbox.responses=[]):x.responses.push(S=this.outbox.responses.pop());else{if(!(b>0))return this;b>1?(x.requests=S=this.outbox.requests,this.outbox.requests=[]):x.requests.push(S=this.outbox.requests.pop())}return setImmediate(u,JSON.stringify(S),l.bind(this,x)),this}function a(u){return this.transmitter=u,this.transmit()}function l(u,f){this.active&&f&&(u.responses.length>0&&Array.prototype.push.apply(this.outbox.responses,u.responses),u.requests.length>0&&Array.prototype.push.apply(this.outbox.requests,u.requests))}function c(u){var f=[],b=[];if(!this.active)return this;if(typeof u=="string")try{u=JSON.parse(u)}catch{return this}if(u.constructor===Array){if(u.length===0)return this;typeof u[0].method=="string"?f=u:b=u}else typeof u=="object"&&(typeof u.requests<"u"&&typeof u.responses<"u"?(f=u.requests,b=u.responses):typeof u.method=="string"?f.push(u):b.push(u));return b.forEach(p.bind(this)),f.forEach(g.bind(this)),this}function h(){return this.active?this.call("system.listComponents",this.localComponents,(function(u,f){u||typeof f!="object"||(this.remoteComponents=f,this.remoteComponents["system._upgraded"]=!0)}).bind(this)):this}function d(u,f,b){var S={jsonrpc:"2.0",method:u};return this.active?(typeof f=="function"&&(b=f,f=null),"system._upgraded"in this.remoteComponents&&!(u in this.remoteComponents)?(typeof b=="function"&&setImmediate(b,{code:-32601,message:"Unknown remote method"}),this):(this.serial++,S.id=this.serial,typeof f=="object"&&(S.params=f),typeof b=="function"&&(this.inbox[this.serial]=b),this.outbox.requests.push(S),this.transmit(),typeof b!="function"?this:(this.remoteTimeout>0?this.outTimers[this.serial]=setTimeout(p.bind(this,{jsonrpc:"2.0",id:this.serial,error:{code:-1e3,message:"Timed out waiting for response"}},!0),this.remoteTimeout):this.outTimers[this.serial]=!0,this))):this}function p(u,f){var b=!1,S=null;this.active&&"id"in u&&u.id in this.outTimers&&(f===!0&&clearTimeout(this.outTimers[u.id]),delete this.outTimers[u.id],"id"in u&&u.id in this.inbox&&("error"in u?b=u.error:S=u.result,setImmediate(this.inbox[u.id],b,S),delete this.inbox[u.id]))}function _(u,f){var b;if(!this.active)return this;if(typeof u=="string")this.localComponents[u]=!0,this.exposed[u]=f;else if(typeof u=="object")for(b in u)u.hasOwnProperty(b)&&(this.localComponents[b]=!0,this.exposed[b]=u[b]);return this}function g(u){var f=null,b=null;if(this.active&&typeof u=="object"&&u!==null&&typeof u.jsonrpc=="string"&&u.jsonrpc==="2.0"){if(f=typeof u.id<"u"?u.id:null,typeof u.method!="string")return void(f!==null&&(this.localTimers[f]=!0,setImmediate(y.bind(this,f,-32600))));if(!(u.method in this.exposed))return void(f!==null&&(this.localTimers[f]=!0,setImmediate(y.bind(this,f,-32601))));if("params"in u){if(typeof u.params!="object")return void(f!==null&&(this.localTimers[f]=!0,setImmediate(y.bind(this,f,-32602))));b=u.params}f===null&&(this.discardSerial--,f=this.discardSerial),this.localTimeout>0?this.localTimers[f]=setTimeout(y.bind(this,f,{code:-1002,message:"Method handler timed out"},void 0,!0),this.localTimeout):this.localTimers[f]=!0,setImmediate(this.exposed[u.method],b,y.bind(this,f))}}function y(u,f,b,S){var x={jsonrpc:"2.0",id:u};this.active&&u in this.localTimers&&(S===!0&&clearTimeout(this.localTimers[u]),delete this.localTimers[u],u===null||0>u||(typeof f<"u"&&f!==null&&f!==!1?typeof f=="number"?x.error={code:f,message:"error"}:f===!0?x.error={code:-1,message:"error"}:typeof f=="string"?x.error={code:-1,message:f}:typeof f=="object"&&"code"in f&&"message"in f?x.error=f:x.error={code:-2,message:"error",data:f}:x.result=b,this.outbox.responses.push(x),this.transmit()))}i.setImmediate=r("timers").setImmediate,s.prototype.shutdown=n,s.prototype.call=d,s.prototype.notify=d,s.prototype.expose=_,s.prototype.upgrade=h,s.prototype.receive=c,s.prototype.transmit=o,s.prototype.setTransmitter=a,typeof Promise.promisify=="function"&&(s.prototype.callAsync=Promise.promisify(d)),e.exports=s}).call(this,typeof global<"u"?global:typeof self<"u"?self:typeof window<"u"?window:{})},{timers:3}],2:[function(r,e,t){function i(){h=!1,a.length?c=a.concat(c):d=-1,c.length&&s()}function s(){if(!h){var p=setTimeout(i);h=!0;for(var _=c.length;_;){for(a=c,c=[];++d<_;)a&&a[d].run();d=-1,_=c.length}a=null,h=!1,clearTimeout(p)}}function n(p,_){this.fun=p,this.array=_}function o(){}var a,l=e.exports={},c=[],h=!1,d=-1;l.nextTick=function(p){var _=new Array(arguments.length-1);if(arguments.length>1)for(var g=1;g<arguments.length;g++)_[g-1]=arguments[g];c.push(new n(p,_)),c.length!==1||h||setTimeout(s,0)},n.prototype.run=function(){this.fun.apply(null,this.array)},l.title="browser",l.browser=!0,l.env={},l.argv=[],l.version="",l.versions={},l.on=o,l.addListener=o,l.once=o,l.off=o,l.removeListener=o,l.removeAllListeners=o,l.emit=o,l.binding=function(p){throw new Error("process.binding is not supported")},l.cwd=function(){return"/"},l.chdir=function(p){throw new Error("process.chdir is not supported")},l.umask=function(){return 0}},{}],3:[function(r,e,t){function i(c,h){this._id=c,this._clearFn=h}var s=r("process/browser.js").nextTick,n=Function.prototype.apply,o=Array.prototype.slice,a={},l=0;t.setTimeout=function(){return new i(n.call(setTimeout,window,arguments),clearTimeout)},t.setInterval=function(){return new i(n.call(setInterval,window,arguments),clearInterval)},t.clearTimeout=t.clearInterval=function(c){c.close()},i.prototype.unref=i.prototype.ref=function(){},i.prototype.close=function(){this._clearFn.call(window,this._id)},t.enroll=function(c,h){clearTimeout(c._idleTimeoutId),c._idleTimeout=h},t.unenroll=function(c){clearTimeout(c._idleTimeoutId),c._idleTimeout=-1},t._unrefActive=t.active=function(c){clearTimeout(c._idleTimeoutId);var h=c._idleTimeout;h>=0&&(c._idleTimeoutId=setTimeout(function(){c._onTimeout&&c._onTimeout()},h))},t.setImmediate=typeof setImmediate=="function"?setImmediate:function(c){var h=l++,d=arguments.length<2?!1:o.call(arguments,1);return a[h]=!0,s(function(){a[h]&&(d?c.apply(null,d):c.call(null),t.clearImmediate(h))}),h},t.clearImmediate=typeof clearImmediate=="function"?clearImmediate:function(c){delete a[c]}},{"process/browser.js":2}]},{},[1])(1)});Window.JRPC=JRPC;if(typeof module<"u"&&typeof module.exports<"u")var ms={},me=require("crypto"),mn={},gs=class{};else{if(!me)var me=self.crypto;var ms=Window.ExposeClass,gs=Window.LitElement}me.randomUUID||(me.randomUUID=()=>me.getRandomValues(new Uint8Array(32)).toString("base64").replaceAll(",",""));let wi=class extends gs{newRemote(){let e;return typeof Window>"u"?e=new mn({remoteTimeout:this.remoteTimeout}):e=new Window.JRPC({remoteTimeout:this.remoteTimeout}),e.uuid=me.randomUUID(),this.remotes==null&&(this.remotes={}),this.remotes[e.uuid]=e,e}createRemote(e){let t=this.newRemote();return this.remoteIsUp(),this.ws?(e=this.ws,this.ws.onclose=(function(i){this.rmRemote(i,t.uuid)}).bind(this),this.ws.onmessage=i=>{t.receive(i.data)}):(e.on("close",(i,s)=>this.rmRemote.bind(this)(i,t.uuid)),e.on("message",function(i,s){const n=s?i:i.toString();t.receive(n)})),this.setupRemote(t,e),t}remoteIsUp(){console.log("JRPCCommon::remoteIsUp")}rmRemote(e,t){if(this.server&&this.remotes[t]&&this.remotes[t].rpcs&&Object.keys(this.remotes[t].rpcs).forEach(i=>{this.server[i]&&delete this.server[i]}),Object.keys(this.remotes).length&&delete this.remotes[t],this.call&&Object.keys(this.remotes).length){let i=[];for(const s in this.remotes)this.remotes[s].rpcs&&(i=i.concat(Object.keys(this.remotes[s].rpcs)));if(this.call){let s=Object.keys(this.call);for(let n=0;n<s.length;n++)i.indexOf(s[n])<0&&delete this.call[s[n]]}}else this.call={};this.remoteDisconnected(t)}remoteDisconnected(e){console.log("JPRCCommon::remoteDisconnected "+e)}setupRemote(e,t){e.setTransmitter(this.transmit.bind(t)),this.classes&&this.classes.forEach(i=>{e.expose(i)}),e.upgrade(),e.call("system.listComponents",[],(i,s)=>{i?(console.log(i),console.log("Something went wrong when calling system.listComponents !")):this.setupFns(Object.keys(s),e)})}transmit(e,t){try{return this.send(e),t(!1)}catch(i){return console.log(i),t(!0)}}setupFns(e,t){e.forEach(i=>{t.rpcs==null&&(t.rpcs={}),t.rpcs[i]=function(s){return new Promise((n,o)=>{t.call(i,{args:Array.from(arguments)},(a,l)=>{a?(console.log("Error when calling remote function : "+i),o(a)):n(l)})})},this.call==null&&(this.call={}),this.call[i]==null&&(this.call[i]=(...s)=>{let n=[],o=[];for(const a in this.remotes)this.remotes[a].rpcs[i]!=null&&(o.push(a),n.push(this.remotes[a].rpcs[i](...s)));return Promise.all(n).then(a=>{let l={};return o.forEach((c,h)=>l[c]=a[h]),l})}),this.server==null&&(this.server={}),this.server[i]==null?this.server[i]=function(s){return new Promise((n,o)=>{t.call(i,{args:Array.from(arguments)},(a,l)=>{a?(console.log("Error when calling remote function : "+i),o(a)):n(l)})})}:this.server[i]=function(s){return new Promise((n,o)=>{o(new Error("More then one remote has this RPC, not sure who to talk to : "+i))})}}),this.setupDone()}setupDone(){}addClass(e,t){e.getRemotes=()=>this.remotes,e.getCall=()=>this.call,e.getServer=()=>this.server;let s=new ms().exposeAllFns(e,t);if(this.classes==null?this.classes=[s]:this.classes.push(s),this.remotes!=null)for(const[n,o]of Object.entries(this.remotes))o.expose(s),o.upgrade()}};typeof module<"u"&&typeof module.exports<"u"?module.exports=wi:Window.JRPCCommon=wi;let gn=Window.JRPCCommon;class _s extends gn{static get properties(){return{serverURI:{type:String},ws:{type:Object},server:{type:Object},remoteTimeout:{type:Number}}}constructor(){super(),this.remoteTimeout=60}updated(e){e.has("serverURI")&&this.serverURI&&this.serverURI!="undefined"&&this.serverChanged()}serverChanged(){this.ws!=null&&delete this.ws;try{this.ws=new WebSocket(this.serverURI),console.assert(this.ws.parent==null,"wss.parent already exists, this needs upgrade."),this.ws.addEventListener("open",this.createRemote.bind(this)),this.ws.addEventListener("error",this.wsError.bind(this))}catch(e){this.serverURI="",this.setupSkip(e)}}wsError(e){this.setupSkip(e)}isConnected(){return this.server!=null&&this.server!={}}setupSkip(){this.dispatchEvent(new CustomEvent("skip"))}setupDone(){this.dispatchEvent(new CustomEvent("done"))}}window.customElements.get("jrpc-client")||window.customElements.define("jrpc-client",_s);function D(r,e="error"){window.dispatchEvent(new CustomEvent("ac-toast",{detail:{message:r,type:e}}))}const V=r=>{var e;return e=class extends r{constructor(){super(),this.rpcConnected=!1,this._rpcCallProxy=null,this._onRpcAvailable=this._onRpcAvailable.bind(this)}connectedCallback(){super.connectedCallback(),Me.addListener(this._onRpcAvailable)}disconnectedCallback(){super.disconnectedCallback(),Me.removeListener(this._onRpcAvailable)}_onRpcAvailable(i){this._rpcCallProxy=i,this.rpcConnected=!!i,i?this.onRpcReady():this.onRpcDisconnected()}onRpcReady(){}onRpcDisconnected(){}async rpcCall(i,...s){const n=this._rpcCallProxy||Me.get();if(!n)throw new Error("RPC not connected");return await n[i](...s)}async rpcExtract(i,...s){const n=await this.rpcCall(i,...s);if(n&&typeof n=="object"){const o=Object.keys(n);if(o.length===1)return n[o[0]]}return n}async rpcSafeExtract(i,...s){try{return await this.rpcExtract(i,...s)}catch(n){const o=i.split(".").pop()||i;return console.warn(`RPC ${i} failed:`,n),D(`${o} failed: ${n.message||"Connection error"}`,"error"),null}}async rpcSafeCall(i,...s){try{return await this.rpcCall(i,...s)}catch(n){const o=i.split(".").pop()||i;return console.warn(`RPC ${i} failed:`,n),D(`${o} failed: ${n.message||"Connection error"}`,"error"),null}}showToast(i,s=""){D(i,s)}},C(e,"properties",{...Yt(e,e,"properties"),rpcConnected:{type:Boolean,state:!0}}),e};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const _n={CHILD:2},vn=r=>(...e)=>({_$litDirective$:r,values:e});class yn{constructor(e){}get _$AU(){return this._$AM._$AU}_$AT(e,t,i){this._$Ct=e,this._$AM=t,this._$Ci=i}_$AS(e,t){return this.update(e,t)}update(e,t){return this.render(...t)}}/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */class yt extends yn{constructor(e){if(super(e),this.it=v,e.type!==_n.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(e){if(e===v||e==null)return this._t=void 0,this.it=e;if(e===de)return e;if(typeof e!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(e===this.it)return this._t;this.it=e;const t=[e];return t.raw=t,this._t={_$litType$:this.constructor.resultType,strings:t,values:[]}}}yt.directiveName="unsafeHTML",yt.resultType=1;const J=vn(yt);k.registerLanguage("javascript",Ki);k.registerLanguage("js",Ki);k.registerLanguage("python",Xi);k.registerLanguage("py",Xi);k.registerLanguage("typescript",Yi);k.registerLanguage("ts",Yi);k.registerLanguage("json",Cs);k.registerLanguage("bash",qt);k.registerLanguage("sh",qt);k.registerLanguage("shell",qt);k.registerLanguage("css",ks);k.registerLanguage("html",Gi);k.registerLanguage("xml",Gi);k.registerLanguage("yaml",Ji);k.registerLanguage("yml",Ji);k.registerLanguage("c",Es);k.registerLanguage("cpp",As);k.registerLanguage("diff",Ts);k.registerLanguage("markdown",Qi);k.registerLanguage("md",Qi);function ye(r){return r.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}const bn=new Wi({gfm:!0,breaks:!0,renderer:{code(r){let e,t;typeof r=="string"?(e=r,t=""):(e=r.text||"",t=(r.lang||"").trim());const i=t&&k.getLanguage(t)?t:null;let s;if(i)try{s=k.highlight(e,{language:i}).value}catch{s=ye(e)}else try{s=k.highlightAuto(e).value}catch{s=ye(e)}return`<pre class="code-block">${i?`<span class="code-lang">${i}</span>`:""}<button class="code-copy-btn" title="Copy code">📋</button><code class="hljs${i?` language-${i}`:""}">${s}</code></pre>`}}});function Ge(r){if(!r)return"";try{return bn.parse(r)}catch(e){return console.warn("Markdown parse error:",e),`<pre>${ye(r)}</pre>`}}function xn(r){const e=new Map;r.split(`
`);let t=0;const i=Zt.lexer(r);for(const s of i){if(s.raw){const o=r.indexOf(s.raw,0);o!==-1&&(t=r.slice(0,o).split(`
`).length)}const n=wn(s);n&&!e.has(n)&&e.set(n,t)}return e}function wn(r){return!r||!r.text?null:(r.type||"p")+":"+r.text.slice(0,120)}const Zt=new Wi({gfm:!0,breaks:!0,renderer:{code(r){let e,t;typeof r=="string"?(e=r,t=""):(e=r.text||"",t=(r.lang||"").trim());const i=t&&k.getLanguage(t)?t:null;let s;if(i)try{s=k.highlight(e,{language:i}).value}catch{s=ye(e)}else try{s=k.highlightAuto(e).value}catch{s=ye(e)}const n="code:"+e.slice(0,120),o=(M==null?void 0:M.get(n))??"";return`<pre class="code-block"${o!==""?` data-source-line="${o}"`:""}><code class="hljs${i?` language-${i}`:""}">${s}</code></pre>`},heading(r){const e=typeof r=="string"?r:r.text||"";typeof r!="object"||r.depth;const t="heading:"+e.slice(0,120);return M==null||M.get(t),!1},paragraph(r){const t="paragraph:"+(typeof r=="string"?r:r.text||"").slice(0,120);return M==null||M.get(t),!1},hr(){return`<hr data-source-line="">
`}}}),pt=[];Zt.use({walkTokens(r){if(M&&(r.type==="heading"||r.type==="paragraph")){const e=r.text||"",t=r.type+":"+e.slice(0,120),i=(M==null?void 0:M.get(t))??"";i!==""&&pt.push({type:r.type,text:e.slice(0,80),line:i})}},hooks:{postprocess(r){let e=r;for(const t of pt){const i=t.type==="heading"?"h[1-6]":"p",s=new RegExp(`(<${i})(?![^>]*data-source-line)(\\s|>)`,"i");e=e.replace(s,`$1 data-source-line="${t.line}"$2`)}return pt.length=0,e}}});let M=null;function Si(r){if(!r)return"";try{M=xn(r);const e=Zt.parse(r);return M=null,e}catch(e){return M=null,console.warn("Markdown source-map parse error:",e),`<pre>${ye(r)}</pre>`}}class bt extends L{constructor(){super(),this.open=!1,this._filter="",this._selectedIndex=0,this._history=[],this._originalInput=""}addEntry(e){const t=e.trim();if(!t)return;const i=this._history.indexOf(t);i!==-1&&this._history.splice(i,1),this._history.push(t),this._history.length>100&&this._history.shift()}show(e){this._history.length!==0&&(this._originalInput=e||"",this._filter="",this._selectedIndex=0,this.open=!0,this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".filter-input");t&&t.focus(),this._scrollToSelected()}))}cancel(){return this.open=!1,this._originalInput}select(){const e=this._getFiltered();if(e.length===0)return this.open=!1,this._originalInput;const t=e[e.length-1-this._selectedIndex];return this.open=!1,t||this._originalInput}handleKey(e){if(!this.open)return!1;const t=this._getFiltered();switch(e.key){case"ArrowUp":return e.preventDefault(),this._selectedIndex=Math.min(this._selectedIndex+1,t.length-1),this._scrollToSelected(),!0;case"ArrowDown":return e.preventDefault(),this._selectedIndex=Math.max(this._selectedIndex-1,0),this._scrollToSelected(),!0;case"Enter":return e.preventDefault(),this._dispatchSelect(this.select()),!0;case"Escape":return e.preventDefault(),this._dispatchCancel(this.cancel()),!0;default:return!1}}_getFiltered(){if(!this._filter)return this._history;const e=this._filter.toLowerCase();return this._history.filter(t=>t.toLowerCase().includes(e))}_onFilterInput(e){this._filter=e.target.value,this._selectedIndex=0}_onFilterKeyDown(e){this.handleKey(e)}_onItemClick(e){const t=this._getFiltered();this._selectedIndex=t.length-1-e,this._dispatchSelect(this.select())}_scrollToSelected(){this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".item.selected");e&&e.scrollIntoView({block:"nearest"})})}_dispatchSelect(e){this.dispatchEvent(new CustomEvent("history-select",{detail:{text:e},bubbles:!0,composed:!0}))}_dispatchCancel(e){this.dispatchEvent(new CustomEvent("history-cancel",{detail:{text:e},bubbles:!0,composed:!0}))}render(){if(!this.open)return v;const e=this._getFiltered();return m`
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
          ${e.length===0?m`
            <div class="empty">${this._filter?"No matches":"No history"}</div>
          `:e.map((t,i)=>{const s=i===e.length-1-this._selectedIndex;return m`
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
    `}}C(bt,"properties",{open:{type:Boolean,reflect:!0},_filter:{type:String,state:!0},_selectedIndex:{type:Number,state:!0}}),C(bt,"styles",[F,j,z`
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
  `]);customElements.define("ac-input-history",bt);const je={github_repo:"📦",github_file:"📄",github_issue:"🐛",github_pr:"🔀",documentation:"📚",generic:"🌐"};class xt extends V(L){constructor(){super(),this._detected=[],this._fetched=[],this._fetching=new Set,this._excluded=new Set,this._debounceTimer=null}async detectUrls(e){if(!e||!this.rpcConnected){this._detected=[];return}clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(async()=>{try{const t=await this.rpcExtract("LLMService.detect_urls",e);if(!Array.isArray(t)){this._detected=[];return}const i=new Set(this._fetched.map(n=>n.url)),s=t.filter(n=>!i.has(n.url)&&!this._fetching.has(n.url));this._detected=s}catch(t){console.error("URL detection failed:",t)}},300)}onSend(){this._detected=[]}clear(){this._detected=[],this._fetched=[],this._fetching=new Set,this._excluded=new Set}getIncludedUrls(){return this._fetched.filter(e=>!e.error&&!this._excluded.has(e.url)).map(e=>e.url)}getExcludedUrls(){return[...this._excluded]}async _fetchUrl(e,t){if(!this._fetching.has(e)){this._detected=this._detected.filter(i=>i.url!==e),this._fetching=new Set([...this._fetching,e]),this.requestUpdate();try{const i=await this.rpcExtract("LLMService.fetch_url",e,!0,!0,null,null);this._fetching=new Set([...this._fetching].filter(s=>s!==e)),i&&(this._fetched=[...this._fetched,{url:e,url_type:i.url_type||t||"generic",title:i.title||e,error:i.error||null,display_name:i.title||this._shortenUrl(e)}])}catch(i){console.error("URL fetch failed:",i),this._fetching=new Set([...this._fetching].filter(s=>s!==e)),this._fetched=[...this._fetched,{url:e,url_type:t||"generic",title:e,error:i.message||"Fetch failed",display_name:this._shortenUrl(e)}]}this._notifyChange()}}_toggleExclude(e){const t=new Set(this._excluded);t.has(e)?t.delete(e):t.add(e),this._excluded=t,this._notifyChange()}_removeFetched(e){this._fetched=this._fetched.filter(i=>i.url!==e);const t=new Set(this._excluded);t.delete(e),this._excluded=t,this.rpcConnected&&this.rpcExtract("LLMService.remove_fetched_url",e).catch(()=>{}),this._notifyChange()}_dismissDetected(e){this._detected=this._detected.filter(t=>t.url!==e)}_viewContent(e){this.dispatchEvent(new CustomEvent("view-url-content",{bubbles:!0,composed:!0,detail:{url:e}}))}_notifyChange(){this.dispatchEvent(new CustomEvent("url-chips-changed",{bubbles:!0,composed:!0}))}_shortenUrl(e){try{const t=new URL(e);let i=t.pathname.replace(/\/$/,"");return i.length>30&&(i="..."+i.slice(-27)),t.hostname+i}catch{return e.length>40?e.slice(0,37)+"...":e}}_getDisplayName(e){return e.display_name||e.title||this._shortenUrl(e.url)}_renderDetectedChip(e){const t=je[e.url_type]||je.generic;return m`
      <span class="chip detected">
        <span class="badge">${t}</span>
        <span class="label" title="${e.url}">${e.display_name||this._shortenUrl(e.url)}</span>
        <button class="chip-btn fetch-btn" @click=${()=>this._fetchUrl(e.url,e.url_type)} title="Fetch">📥</button>
        <button class="chip-btn" @click=${()=>this._dismissDetected(e.url)} title="Dismiss">×</button>
      </span>
    `}_renderFetchingChip(e){return m`
      <span class="chip fetching">
        <span class="spinner"></span>
        <span class="label" title="${e}">${this._shortenUrl(e)}</span>
      </span>
    `}_renderFetchedChip(e){const t=this._excluded.has(e.url),i=!!e.error;return je[e.url_type]||je.generic,m`
      <span class="${`chip fetched ${t?"excluded":""} ${i?"error":""}`}">
        ${i?m`<span class="badge">⚠️</span>`:m`
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
          @click=${i?v:()=>this._viewContent(e.url)}
        >${this._getDisplayName(e)}</span>
        <button class="chip-btn" @click=${()=>this._removeFetched(e.url)} title="Remove">×</button>
      </span>
    `}render(){return this._detected.length>0||this._fetching.size>0||this._fetched.length>0?m`
      <div class="chips-container" role="list" aria-label="URL references">
        ${this._fetched.map(t=>this._renderFetchedChip(t))}
        ${[...this._fetching].map(t=>this._renderFetchingChip(t))}
        ${this._detected.map(t=>this._renderDetectedChip(t))}
      </div>
    `:v}}C(xt,"properties",{_detected:{type:Array,state:!0},_fetched:{type:Array,state:!0},_fetching:{type:Object,state:!0},_excluded:{type:Object,state:!0}}),C(xt,"styles",[F,z`
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
  `]);customElements.define("ac-url-chips",xt);function Sn(r){return r?r.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/```(\w*)\n([\s\S]*?)```/g,(e,t,i)=>`<pre class="code-block"><code>${i}</code></pre>`).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>").replace(/^### (.+)$/gm,"<h4>$1</h4>").replace(/^## (.+)$/gm,"<h3>$1</h3>").replace(/^# (.+)$/gm,"<h2>$1</h2>").replace(/\n/g,"<br>"):""}class wt extends V(L){constructor(){super(),this.open=!1,this._sessions=[],this._selectedSessionId=null,this._sessionMessages=[],this._searchQuery="",this._searchResults=[],this._loading=!1,this._loadingMessages=!1,this._mode="sessions",this._debounceTimer=null,this._toast=null,this._toastTimer=null}show(){this.open=!0,this._selectedSessionId=null,this._sessionMessages=[],this._searchQuery="",this._searchResults=[],this._mode="sessions",this._loadSessions(),this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".search-input");e&&(e.value="",e.focus())})}hide(){this.open=!1}async _loadSessions(){if(this.rpcConnected){this._loading=!0;try{const e=await this.rpcExtract("LLMService.history_list_sessions",50);Array.isArray(e)&&(this._sessions=e)}catch(e){console.warn("Failed to load sessions:",e)}finally{this._loading=!1}}}async _selectSession(e){this._selectedSessionId=e,this._loadingMessages=!0,this._sessionMessages=[];try{const t=await this.rpcExtract("LLMService.history_get_session",e);Array.isArray(t)&&(this._sessionMessages=t)}catch(t){console.warn("Failed to load session messages:",t)}finally{this._loadingMessages=!1}}_onSearchInput(e){if(this._searchQuery=e.target.value,clearTimeout(this._debounceTimer),!this._searchQuery.trim()){this._mode="sessions",this._searchResults=[];return}this._debounceTimer=setTimeout(()=>this._runSearch(),300)}async _runSearch(){const e=this._searchQuery.trim();if(!(!e||!this.rpcConnected)){this._mode="search",this._loading=!0;try{const t=await this.rpcExtract("LLMService.history_search",e,null,50);Array.isArray(t)&&(this._searchResults=t)}catch(t){console.warn("Search failed:",t)}finally{this._loading=!1}}}_onSearchKeyDown(e){var t;if(e.key==="Escape")if(e.preventDefault(),this._searchQuery){this._searchQuery="",this._mode="sessions",this._searchResults=[];const i=(t=this.shadowRoot)==null?void 0:t.querySelector(".search-input");i&&(i.value="")}else this.hide()}async _loadSessionIntoContext(){if(!(!this._selectedSessionId||!this.rpcConnected))try{const e=await this.rpcExtract("LLMService.load_session_into_context",this._selectedSessionId);if(e!=null&&e.error){console.warn("Failed to load session:",e.error);return}this.dispatchEvent(new CustomEvent("session-loaded",{detail:{sessionId:e.session_id,messages:e.messages||[],messageCount:e.message_count||0},bubbles:!0,composed:!0})),this.hide()}catch(e){console.warn("Failed to load session:",e)}}_copyMessage(e){const t=e.content||"";navigator.clipboard.writeText(t).then(()=>{this._showToast("Copied to clipboard")})}_pasteToPrompt(e){const t=e.content||"";this.dispatchEvent(new CustomEvent("paste-to-prompt",{detail:{text:t},bubbles:!0,composed:!0})),this.hide()}_showToast(e){this._toast=e,clearTimeout(this._toastTimer),this._toastTimer=setTimeout(()=>{this._toast=null},1500)}_onOverlayClick(e){e.target===e.currentTarget&&this.hide()}_onKeyDown(e){e.key==="Escape"&&this.hide()}_formatTimestamp(e){if(!e)return"";try{const t=new Date(e),s=new Date-t,n=Math.floor(s/(1e3*60*60*24));return n===0?t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):n===1?"Yesterday":n<7?t.toLocaleDateString([],{weekday:"short"}):t.toLocaleDateString([],{month:"short",day:"numeric"})}catch{return""}}_renderSessionItem(e){const t=e.session_id===this._selectedSessionId,i=e.preview||"Empty session",s=this._formatTimestamp(e.timestamp),n=e.message_count||0;return m`
      <div
        class="session-item ${t?"selected":""}"
        @click=${()=>this._selectSession(e.session_id)}
      >
        <div class="session-preview">${i}</div>
        <div class="session-meta">
          <span>${s}</span>
          <span class="msg-count">${n} msg${n!==1?"s":""}</span>
        </div>
      </div>
    `}_renderSearchResultItem(e){var n;const t=((n=e.content)==null?void 0:n.slice(0,100))||"",i=e.role||"user",s=e.session_id;return m`
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
    `}_renderMessage(e){const t=e.role==="user",i=e.content||"",s=e.images;return m`
      <div class="msg-card ${t?"user":"assistant"}">
        <div class="msg-role">${t?"You":"Assistant"}</div>
        <div class="msg-content">
          ${J(Sn(i))}
        </div>
        ${Array.isArray(s)&&s.length>0?m`
          <div class="msg-images">
            ${s.map(n=>m`<img src="${n}" alt="Image">`)}
          </div>
        `:v}
        <div class="msg-actions">
          <button class="msg-action-btn" title="Copy" @click=${()=>this._copyMessage(e)}>📋</button>
          <button class="msg-action-btn" title="Paste to prompt" @click=${()=>this._pasteToPrompt(e)}>↩</button>
        </div>
      </div>
    `}_renderLeftPanel(){return this._loading&&this._sessions.length===0&&this._searchResults.length===0?m`<div class="loading">Loading...</div>`:this._mode==="search"?this._searchResults.length===0?m`<div class="empty-state">No results found</div>`:m`
        <div class="session-list">
          ${this._searchResults.map(e=>this._renderSearchResultItem(e))}
        </div>
      `:this._sessions.length===0?m`<div class="empty-state">No sessions yet</div>`:m`
      <div class="session-list">
        ${this._sessions.map(e=>this._renderSessionItem(e))}
      </div>
    `}_renderRightPanel(){return this._selectedSessionId?this._loadingMessages?m`<div class="loading">Loading messages...</div>`:this._sessionMessages.length===0?m`<div class="empty-state">No messages in this session</div>`:m`
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
    `:m`<div class="empty-state">Select a session to view messages</div>`}render(){return this.open?m`
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

        ${this._toast?m`
          <div class="toast">${this._toast}</div>
        `:v}
      </div>
    `:v}}C(wt,"properties",{open:{type:Boolean,reflect:!0},_sessions:{type:Array,state:!0},_selectedSessionId:{type:String,state:!0},_sessionMessages:{type:Array,state:!0},_searchQuery:{type:String,state:!0},_searchResults:{type:Array,state:!0},_loading:{type:Boolean,state:!0},_loadingMessages:{type:Boolean,state:!0},_mode:{type:String,state:!0}}),C(wt,"styles",[F,j,z`
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
  `]);customElements.define("ac-history-browser",wt);const $i=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;class St extends L{constructor(){super(),this._state="inactive",this._autoRestart=!1,this._recognition=null,this._supported=!!$i,this._supported&&(this._recognition=new $i,this._recognition.continuous=!1,this._recognition.interimResults=!1,this._recognition.lang=navigator.language||"en-US",this._recognition.onstart=()=>{this._state="listening"},this._recognition.onspeechstart=()=>{this._state="speaking"},this._recognition.onspeechend=()=>{this._state==="speaking"&&(this._state="listening")},this._recognition.onresult=e=>{const t=e.results[e.results.length-1];if(t.isFinal){const i=t[0].transcript.trim();i&&this.dispatchEvent(new CustomEvent("transcript",{detail:{text:i},bubbles:!0,composed:!0}))}},this._recognition.onend=()=>{this._autoRestart?setTimeout(()=>{if(this._autoRestart)try{this._recognition.start()}catch(e){console.warn("[SpeechToText] Auto-restart failed:",e),this._autoRestart=!1,this._state="inactive"}},100):this._state="inactive"},this._recognition.onerror=e=>{this._autoRestart&&(e.error==="no-speech"||e.error==="aborted")||(console.warn("[SpeechToText] Recognition error:",e.error),this._autoRestart=!1,this._state="inactive",this.dispatchEvent(new CustomEvent("speech-error",{detail:{error:e.error},bubbles:!0,composed:!0})))})}disconnectedCallback(){if(super.disconnectedCallback(),this._autoRestart=!1,this._recognition)try{this._recognition.stop()}catch{}this._state="inactive"}_toggle(){if(this._recognition)if(this._autoRestart||this._state!=="inactive"){this._autoRestart=!1;try{this._recognition.stop()}catch{}this._state="inactive"}else{this._autoRestart=!0;try{this._recognition.start()}catch(e){console.warn("[SpeechToText] Failed to start:",e),this._autoRestart=!1,this._state="inactive"}}}render(){return this._supported?m`
      <button
        class=${this._state}
        @click=${this._toggle}
        title=${this._state==="inactive"?"Start voice dictation":"Stop voice dictation"}
        aria-label=${this._state==="inactive"?"Start voice dictation":"Stop voice dictation"}
        aria-pressed=${this._state!=="inactive"}
      >🎤</button>
    `:m``}}C(St,"properties",{_state:{type:String,state:!0},_supported:{type:Boolean,state:!0}}),C(St,"styles",[F,z`
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
  `]);customElements.define("ac-speech-to-text",St);class $t extends L{constructor(){super(),this._visible=!1,this._content=null,this._showFull=!1}show(e){this._content=e,this._showFull=!1,this._visible=!0,this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".overlay");t&&t.focus()})}hide(){this._visible=!1,this._content=null,this._showFull=!1}_onOverlayClick(e){e.target===e.currentTarget&&this.hide()}_onKeyDown(e){e.key==="Escape"&&(e.preventDefault(),this.hide())}_toggleFull(){this._showFull=!this._showFull}_formatDate(e){if(!e)return"Unknown";try{return new Date(e).toLocaleString()}catch{return e}}_renderSection(e,t,i=""){return t?m`
      <div class="section">
        <span class="section-label">${e}</span>
        <div class="section-content ${i}">
          ${i==="symbol-map"?t:J(Ge(t))}
        </div>
      </div>
    `:v}render(){if(!this._visible||!this._content)return v;const e=this._content,t=e.url_type||"generic",i=!!e.readme,s=!!e.summary,n=!!e.symbol_map,o=!!e.content,a=!!e.error,l=s||i||o,c=this._showFull&&o&&(s||i);return m`
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
            ${e.title?m`
              <span>
                <span class="meta-label">Title:</span>
                <span class="meta-value">${e.title}</span>
              </span>
            `:v}
          </div>

          <!-- Body -->
          <div class="body">
            ${a?m`
              <div class="error-msg">⚠️ ${e.error}</div>
            `:v}

            ${s?this._renderSection("Summary",e.summary,"summary"):v}

            ${i?this._renderSection("README",e.readme):v}

            ${!s&&!i&&o?this._renderSection("Content",e.content):v}

            ${c?this._renderSection("Full Content",e.content):v}

            ${n?this._renderSection("Symbol Map",e.symbol_map,"symbol-map"):v}
          </div>

          <!-- Footer -->
          <div class="footer">
            ${l&&o&&(s||i)?m`
              <button class="footer-btn" @click=${this._toggleFull}>
                ${this._showFull?"Hide Details":"Show Full Content"}
              </button>
            `:v}
          </div>

        </div>
      </div>
    `}}C($t,"properties",{_visible:{type:Boolean,state:!0},_content:{type:Object,state:!0},_showFull:{type:Boolean,state:!0}}),C($t,"styles",[F,j,z`
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
  `]);customElements.define("ac-url-content-dialog",$t);function U(){}U.prototype={diff:function(e,t){var i,s=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},n=s.callback;typeof s=="function"&&(n=s,s={});var o=this;function a(x){return x=o.postProcess(x,s),n?(setTimeout(function(){n(x)},0),!0):x}e=this.castInput(e,s),t=this.castInput(t,s),e=this.removeEmpty(this.tokenize(e,s)),t=this.removeEmpty(this.tokenize(t,s));var l=t.length,c=e.length,h=1,d=l+c;s.maxEditLength!=null&&(d=Math.min(d,s.maxEditLength));var p=(i=s.timeout)!==null&&i!==void 0?i:1/0,_=Date.now()+p,g=[{oldPos:-1,lastComponent:void 0}],y=this.extractCommon(g[0],t,e,0,s);if(g[0].oldPos+1>=c&&y+1>=l)return a(Ci(o,g[0].lastComponent,t,e,o.useLongestToken));var u=-1/0,f=1/0;function b(){for(var x=Math.max(u,-h);x<=Math.min(f,h);x+=2){var E=void 0,O=g[x-1],N=g[x+1];O&&(g[x-1]=void 0);var Z=!1;if(N){var ie=N.oldPos-x;Z=N&&0<=ie&&ie<l}var Xt=O&&O.oldPos+1<c;if(!Z&&!Xt){g[x]=void 0;continue}if(!Xt||Z&&O.oldPos<N.oldPos?E=o.addToPath(N,!0,!1,0,s):E=o.addToPath(O,!1,!0,1,s),y=o.extractCommon(E,t,e,x,s),E.oldPos+1>=c&&y+1>=l)return a(Ci(o,E.lastComponent,t,e,o.useLongestToken));g[x]=E,E.oldPos+1>=c&&(f=Math.min(f,x-1)),y+1>=l&&(u=Math.max(u,x+1))}h++}if(n)(function x(){setTimeout(function(){if(h>d||Date.now()>_)return n();b()||x()},0)})();else for(;h<=d&&Date.now()<=_;){var S=b();if(S)return S}},addToPath:function(e,t,i,s,n){var o=e.lastComponent;return o&&!n.oneChangePerToken&&o.added===t&&o.removed===i?{oldPos:e.oldPos+s,lastComponent:{count:o.count+1,added:t,removed:i,previousComponent:o.previousComponent}}:{oldPos:e.oldPos+s,lastComponent:{count:1,added:t,removed:i,previousComponent:o}}},extractCommon:function(e,t,i,s,n){for(var o=t.length,a=i.length,l=e.oldPos,c=l-s,h=0;c+1<o&&l+1<a&&this.equals(i[l+1],t[c+1],n);)c++,l++,h++,n.oneChangePerToken&&(e.lastComponent={count:1,previousComponent:e.lastComponent,added:!1,removed:!1});return h&&!n.oneChangePerToken&&(e.lastComponent={count:h,previousComponent:e.lastComponent,added:!1,removed:!1}),e.oldPos=l,c},equals:function(e,t,i){return i.comparator?i.comparator(e,t):e===t||i.ignoreCase&&e.toLowerCase()===t.toLowerCase()},removeEmpty:function(e){for(var t=[],i=0;i<e.length;i++)e[i]&&t.push(e[i]);return t},castInput:function(e){return e},tokenize:function(e){return Array.from(e)},join:function(e){return e.join("")},postProcess:function(e){return e}};function Ci(r,e,t,i,s){for(var n=[],o;e;)n.push(e),o=e.previousComponent,delete e.previousComponent,e=o;n.reverse();for(var a=0,l=n.length,c=0,h=0;a<l;a++){var d=n[a];if(d.removed)d.value=r.join(i.slice(h,h+d.count)),h+=d.count;else{if(!d.added&&s){var p=t.slice(c,c+d.count);p=p.map(function(_,g){var y=i[h+g];return y.length>_.length?y:_}),d.value=r.join(p)}else d.value=r.join(t.slice(c,c+d.count));c+=d.count,d.added||(h+=d.count)}}return n}function ki(r,e){var t;for(t=0;t<r.length&&t<e.length;t++)if(r[t]!=e[t])return r.slice(0,t);return r.slice(0,t)}function Ei(r,e){var t;if(!r||!e||r[r.length-1]!=e[e.length-1])return"";for(t=0;t<r.length&&t<e.length;t++)if(r[r.length-(t+1)]!=e[e.length-(t+1)])return r.slice(-t);return r.slice(-t)}function Ct(r,e,t){if(r.slice(0,e.length)!=e)throw Error("string ".concat(JSON.stringify(r)," doesn't start with prefix ").concat(JSON.stringify(e),"; this is a bug"));return t+r.slice(e.length)}function kt(r,e,t){if(!e)return r+t;if(r.slice(-e.length)!=e)throw Error("string ".concat(JSON.stringify(r)," doesn't end with suffix ").concat(JSON.stringify(e),"; this is a bug"));return r.slice(0,-e.length)+t}function Se(r,e){return Ct(r,e,"")}function Ve(r,e){return kt(r,e,"")}function Ai(r,e){return e.slice(0,$n(r,e))}function $n(r,e){var t=0;r.length>e.length&&(t=r.length-e.length);var i=e.length;r.length<e.length&&(i=r.length);var s=Array(i),n=0;s[0]=0;for(var o=1;o<i;o++){for(e[o]==e[n]?s[o]=s[n]:s[o]=n;n>0&&e[o]!=e[n];)n=s[n];e[o]==e[n]&&n++}n=0;for(var a=t;a<r.length;a++){for(;n>0&&r[a]!=e[n];)n=s[n];r[a]==e[n]&&n++}return n}var et="a-zA-Z0-9_\\u{C0}-\\u{FF}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}",Cn=new RegExp("[".concat(et,"]+|\\s+|[^").concat(et,"]"),"ug"),Ne=new U;Ne.equals=function(r,e,t){return t.ignoreCase&&(r=r.toLowerCase(),e=e.toLowerCase()),r.trim()===e.trim()};Ne.tokenize=function(r){var e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},t;if(e.intlSegmenter){if(e.intlSegmenter.resolvedOptions().granularity!="word")throw new Error('The segmenter passed must have a granularity of "word"');t=Array.from(e.intlSegmenter.segment(r),function(n){return n.segment})}else t=r.match(Cn)||[];var i=[],s=null;return t.forEach(function(n){/\s/.test(n)?s==null?i.push(n):i.push(i.pop()+n):/\s/.test(s)?i[i.length-1]==s?i.push(i.pop()+n):i.push(s+n):i.push(n),s=n}),i};Ne.join=function(r){return r.map(function(e,t){return t==0?e:e.replace(/^\s+/,"")}).join("")};Ne.postProcess=function(r,e){if(!r||e.oneChangePerToken)return r;var t=null,i=null,s=null;return r.forEach(function(n){n.added?i=n:n.removed?s=n:((i||s)&&Ti(t,s,i,n),t=n,i=null,s=null)}),(i||s)&&Ti(t,s,i,null),r};function kn(r,e,t){return Ne.diff(r,e,t)}function Ti(r,e,t,i){if(e&&t){var s=e.value.match(/^\s*/)[0],n=e.value.match(/\s*$/)[0],o=t.value.match(/^\s*/)[0],a=t.value.match(/\s*$/)[0];if(r){var l=ki(s,o);r.value=kt(r.value,o,l),e.value=Se(e.value,l),t.value=Se(t.value,l)}if(i){var c=Ei(n,a);i.value=Ct(i.value,a,c),e.value=Ve(e.value,c),t.value=Ve(t.value,c)}}else if(t)r&&(t.value=t.value.replace(/^\s*/,"")),i&&(i.value=i.value.replace(/^\s*/,""));else if(r&&i){var h=i.value.match(/^\s*/)[0],d=e.value.match(/^\s*/)[0],p=e.value.match(/\s*$/)[0],_=ki(h,d);e.value=Se(e.value,_);var g=Ei(Se(h,_),p);e.value=Ve(e.value,g),i.value=Ct(i.value,h,g),r.value=kt(r.value,h,h.slice(0,h.length-g.length))}else if(i){var y=i.value.match(/^\s*/)[0],u=e.value.match(/\s*$/)[0],f=Ai(u,y);e.value=Ve(e.value,f)}else if(r){var b=r.value.match(/\s*$/)[0],S=e.value.match(/^\s*/)[0],x=Ai(b,S);e.value=Se(e.value,x)}}var En=new U;En.tokenize=function(r){var e=new RegExp("(\\r?\\n)|[".concat(et,"]+|[^\\S\\n\\r]+|[^").concat(et,"]"),"ug");return r.match(e)||[]};var st=new U;st.tokenize=function(r,e){e.stripTrailingCr&&(r=r.replace(/\r\n/g,`
`));var t=[],i=r.split(/(\n|\r\n)/);i[i.length-1]||i.pop();for(var s=0;s<i.length;s++){var n=i[s];s%2&&!e.newlineIsToken?t[t.length-1]+=n:t.push(n)}return t};st.equals=function(r,e,t){return t.ignoreWhitespace?((!t.newlineIsToken||!r.includes(`
`))&&(r=r.trim()),(!t.newlineIsToken||!e.includes(`
`))&&(e=e.trim())):t.ignoreNewlineAtEof&&!t.newlineIsToken&&(r.endsWith(`
`)&&(r=r.slice(0,-1)),e.endsWith(`
`)&&(e=e.slice(0,-1))),U.prototype.equals.call(this,r,e,t)};function An(r,e,t){return st.diff(r,e,t)}var Tn=new U;Tn.tokenize=function(r){return r.split(/(\S.+?[.!?])(?=\s+|$)/)};var Mn=new U;Mn.tokenize=function(r){return r.split(/([{}:;,]|\s+)/)};function Et(r){"@babel/helpers - typeof";return Et=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(e){return typeof e}:function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},Et(r)}var qe=new U;qe.useLongestToken=!0;qe.tokenize=st.tokenize;qe.castInput=function(r,e){var t=e.undefinedReplacement,i=e.stringifyReplacer,s=i===void 0?function(n,o){return typeof o>"u"?t:o}:i;return typeof r=="string"?r:JSON.stringify(At(r,null,null,s),s,"  ")};qe.equals=function(r,e,t){return U.prototype.equals.call(qe,r.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"),t)};function At(r,e,t,i,s){e=e||[],t=t||[],i&&(r=i(s,r));var n;for(n=0;n<e.length;n+=1)if(e[n]===r)return t[n];var o;if(Object.prototype.toString.call(r)==="[object Array]"){for(e.push(r),o=new Array(r.length),t.push(o),n=0;n<r.length;n+=1)o[n]=At(r[n],e,t,i,s);return e.pop(),t.pop(),o}if(r&&r.toJSON&&(r=r.toJSON()),Et(r)==="object"&&r!==null){e.push(r),o={},t.push(o);var a=[],l;for(l in r)Object.prototype.hasOwnProperty.call(r,l)&&a.push(l);for(a.sort(),n=0;n<a.length;n+=1)l=a[n],o[l]=At(r[l],e,t,i,l);e.pop(),t.pop()}else o=r;return o}var Tt=new U;Tt.tokenize=function(r){return r.slice()};Tt.join=Tt.removeEmpty=function(r){return r};const ut="««« EDIT",Rn="═══════ REPL",Ln="»»» EDIT END";function Mi(r){const e=r.trim();return!e||e.length>200||/^[#\/*\->]|^```/.test(e)?!1:!!(e.includes("/")||e.includes("\\")||/^[\w\-.]+\.\w+$/.test(e))}function zn(r){const e=r.split(`
`),t=[];let i=[],s="text",n="",o=[],a=[];function l(){i.length>0&&(t.push({type:"text",content:i.join(`
`)}),i=[])}for(let c=0;c<e.length;c++){const h=e[c],d=h.trim();if(s==="text")Mi(d)&&d!==ut?(n=d,s="expect_edit"):i.push(h);else if(s==="expect_edit")d===ut?(i.length>0&&/^`{3,}\s*\w*$/.test(i[i.length-1].trim())&&i.pop(),l(),o=[],a=[],s="old"):Mi(d)&&d!==ut?(i.push(n),n=d):(i.push(n),i.push(h),n="",s="text");else if(s==="old")d===Rn||d.startsWith("═══════")?s="new":o.push(h);else if(s==="new")if(d===Ln){const p=o.length===0;t.push({type:"edit",filePath:n,oldLines:[...o],newLines:[...a],isCreate:p}),n="",o=[],a=[],s="text",c+1<e.length&&/^`{3,}\s*$/.test(e[c+1].trim())&&c++}else a.push(h)}return s==="old"||s==="new"?t.push({type:"edit-pending",filePath:n,oldLines:[...o],newLines:[...a]}):(s==="expect_edit"&&i.push(n),l()),t}function Ri(r){if(r.length===0)return r;const e=[r[0]];for(let t=1;t<r.length;t++){const i=e[e.length-1];r[t].type===i.type?i.text+=r[t].text:e.push(r[t])}return e}function In(r,e){const t=kn(r,e),i=[],s=[];for(const n of t)n.added?s.push({type:"insert",text:n.value}):n.removed?i.push({type:"delete",text:n.value}):(i.push({type:"equal",text:n.value}),s.push({type:"equal",text:n.value}));return{old:Ri(i),new:Ri(s)}}function Dn(r,e){const t=r.join(`
`),i=e.join(`
`),s=An(t,i),n=[];for(const a of s){const l=a.value.replace(/\n$/,"").split(`
`);for(const c of l)a.added?n.push({type:"add",text:c}):a.removed?n.push({type:"remove",text:c}):n.push({type:"context",text:c})}let o=0;for(;o<n.length;){const a=o;for(;o<n.length&&n[o].type==="remove";)o++;const l=o,c=o;for(;o<n.length&&n[o].type==="add";)o++;const h=o,d=l-a,p=h-c;if(d>0&&p>0){const _=Math.min(d,p);for(let g=0;g<_;g++){const y=In(n[a+g].text,n[c+g].text);n[a+g].charDiff=y.old,n[c+g].charDiff=y.new}}o===a&&o++}return n}function Li(r,e,t,i=[]){if(!e||e.length===0)return{html:r,referencedFiles:[]};const s=new Set(t||[]),n=new Set(i),o=e.filter(u=>r.includes(u));if(o.length===0)return{html:r,referencedFiles:[...n]};o.sort((u,f)=>f.length-u.length);const a=o.map(u=>u.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),l=new RegExp("("+a.join("|")+")","g"),c=[];let h=!1;const d=/<\/?[a-zA-Z][^>]*>/g;let p;const _=[];for(;(p=d.exec(r))!==null;)_.push({index:p.index,end:p.index+p[0].length,tag:p[0]});let g=0,y=0;for(;y<r.length;){for(;g<_.length&&_[g].end<=y;)g++;const u=g<_.length?_[g]:null,f=u?u.index:r.length;if(y<f&&!h){const S=r.slice(y,f).replace(l,x=>(n.add(x),`<span class="${s.has(x)?"file-mention in-context":"file-mention"}" data-file="${R(x)}">${R(x)}</span>`));c.push(S)}else y<f&&c.push(r.slice(y,f));if(u){c.push(u.tag);const b=u.tag.toLowerCase();b.startsWith("<pre")?h=!0:b.startsWith("</pre")&&(h=!1),y=u.end}else y=f}return{html:c.join(""),referencedFiles:[...n]}}function Pn(r,e){if(!r||r.length===0)return"";const t=new Set(e||[]),i=r.filter(a=>t.has(a)),s=r.filter(a=>!t.has(a)),n=[];for(const a of i){const l=a.split("/").pop();n.push(`<span class="file-chip in-context" data-file="${R(a)}" title="${R(a)}">✓ ${R(l)}</span>`)}for(const a of s){const l=a.split("/").pop();n.push(`<span class="file-chip addable" data-file="${R(a)}" title="${R(a)}">+ ${R(l)}</span>`)}return`<div class="file-summary"><span class="file-summary-label">📁 Files Referenced</span>${s.length>=2?`<button class="add-all-btn" data-files='${JSON.stringify(s).replace(/'/g,"&#39;")}'>+ Add All (${s.length})</button>`:""}<div class="file-chips">${n.join("")}</div></div>`}function R(r){return r.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}class Mt extends V(L){constructor(){super(),this.messages=[],this.selectedFiles=[],this.streamingActive=!1,this.reviewState={active:!1},this._streamingContent="",this._inputValue="",this._images=[],this._autoScroll=!0,this._snippetDrawerOpen=this._loadBoolPref("ac-dc-snippet-drawer",!1),this._historyOpen=!1,this._snippets=[],this._observer=null,this._pendingChunk=null,this._rafId=null,this._currentRequestId=null,this._confirmAction=null,this._toast=null,this._committing=!1,this._repoFiles=[],this._chatSearchQuery="",this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._atFilterActive=!1,this._onStreamChunk=this._onStreamChunk.bind(this),this._onStreamComplete=this._onStreamComplete.bind(this),this._onViewUrlContent=this._onViewUrlContent.bind(this),this._onCompactionEvent=this._onCompactionEvent.bind(this),this._onModeChanged=this._onModeChanged.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-chunk",this._onStreamChunk),window.addEventListener("stream-complete",this._onStreamComplete),window.addEventListener("compaction-event",this._onCompactionEvent),window.addEventListener("mode-changed",this._onModeChanged),this.addEventListener("view-url-content",this._onViewUrlContent)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-chunk",this._onStreamChunk),window.removeEventListener("stream-complete",this._onStreamComplete),window.removeEventListener("compaction-event",this._onCompactionEvent),window.removeEventListener("mode-changed",this._onModeChanged),this.removeEventListener("view-url-content",this._onViewUrlContent),this._rafId&&cancelAnimationFrame(this._rafId),this._observer&&this._observer.disconnect()}firstUpdated(){const e=this.shadowRoot.querySelector(".scroll-sentinel"),t=this.shadowRoot.querySelector(".messages");e&&t&&(this._observer=new IntersectionObserver(([i])=>{i.isIntersecting?this._autoScroll=!0:this.streamingActive||(this._autoScroll=!1)},{root:t,threshold:.01}),this._observer.observe(e),this._lastScrollTop=0,t.addEventListener("scroll",()=>{this.streamingActive&&t.scrollTop<this._lastScrollTop-30&&(this._autoScroll=!1),this._lastScrollTop=t.scrollTop},{passive:!0})),this.messages.length>0&&requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom()))}onRpcReady(){this._loadSnippets(),this._loadRepoFiles()}updated(e){if(super.updated(e),e.has("reviewState")&&this._loadSnippets(),e.has("messages")&&!this.streamingActive){const t=e.get("messages");(!t||t.length===0)&&this.messages.length>0&&(this._autoScroll=!0,requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom())),this._seedInputHistory(this.messages))}}async _loadRepoFiles(){try{const e=await this.rpcExtract("Repo.get_flat_file_list");Array.isArray(e)?this._repoFiles=e:e!=null&&e.files&&Array.isArray(e.files)&&(this._repoFiles=e.files)}catch(e){console.warn("Failed to load repo files:",e)}}async _loadSnippets(){try{const e=await this.rpcExtract("LLMService.get_snippets");Array.isArray(e)&&(this._snippets=e)}catch(e){console.warn("Failed to load snippets:",e)}}_onStreamChunk(e){const{requestId:t,content:i}=e.detail;t===this._currentRequestId&&(this.streamingActive=!0,this._pendingChunk=i,this._rafId||(this._rafId=requestAnimationFrame(()=>{var s;if(this._rafId=null,this._pendingChunk!==null){const n=(s=this.shadowRoot)==null?void 0:s.querySelector(".message-card.assistant.force-visible .md-content"),o=[];if(n){const a=n.querySelectorAll("pre");for(const l of a)l.scrollLeft>0?o.push({index:o.length,scrollLeft:l.scrollLeft}):o.push({index:o.length,scrollLeft:0})}this._streamingContent=this._pendingChunk,this._pendingChunk=null,o.some(a=>a.scrollLeft>0)&&this.updateComplete.then(()=>{var l;const a=(l=this.shadowRoot)==null?void 0:l.querySelector(".message-card.assistant.force-visible .md-content");if(a){const c=a.querySelectorAll("pre");for(const h of o)h.scrollLeft>0&&c[h.index]&&(c[h.index].scrollLeft=h.scrollLeft)}}),this._autoScroll&&this.updateComplete.then(()=>{requestAnimationFrame(()=>this._scrollToBottom())})}})))}_onStreamComplete(e){var s,n;const{requestId:t,result:i}=e.detail;if(t===this._currentRequestId){if(this._pendingChunk!==null&&(this._streamingContent=this._pendingChunk,this._pendingChunk=null),this.streamingActive=!1,this._currentRequestId=null,i!=null&&i.error)this.messages=[...this.messages,{role:"assistant",content:`**Error:** ${i.error}`}];else if(i!=null&&i.response){const o={};if(i.edit_results){o.editResults={};for(const a of i.edit_results)o.editResults[a.file]={status:a.status,message:a.message}}(i.passed||i.failed||i.skipped||i.not_in_context||i.already_applied)&&(o.passed=i.passed||0,o.already_applied=i.already_applied||0,o.failed=i.failed||0,o.skipped=i.skipped||0,o.not_in_context=i.not_in_context||0,i.files_auto_added&&(o.files_auto_added=i.files_auto_added)),this.messages=[...this.messages,{role:"assistant",content:i.response,...Object.keys(o).length>0?o:{}}]}if(this._streamingContent="",this._pendingChunk=null,this._autoScroll&&this.updateComplete.then(()=>{requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom()))}),((s=i==null?void 0:i.files_modified)==null?void 0:s.length)>0&&(this.dispatchEvent(new CustomEvent("files-modified",{detail:{files:i.files_modified},bubbles:!0,composed:!0})),this._loadRepoFiles()),i!=null&&i.edit_results){const o=i.edit_results.filter(a=>a.status==="failed"&&a.message&&a.message.includes("Ambiguous anchor"));o.length>0&&this._populateAmbiguousRetryPrompt(o)}((n=i==null?void 0:i.files_auto_added)==null?void 0:n.length)>0&&this._populateNotInContextRetryPrompt(i.files_auto_added)}}_onModeChanged(e){this._loadSnippets()}_onCompactionEvent(e){const{requestId:t,event:i}=e.detail||{};if(t!==this._currentRequestId&&t!==this._lastRequestId)return;const s=(i==null?void 0:i.stage)||"",n=(i==null?void 0:i.message)||"";s==="url_fetch"||s==="url_ready"?this._showToast(n,s==="url_ready"?"success":""):s==="compacting"?this._showToast(n||"🗜️ Compacting history...",""):s==="compacted"&&(i!=null&&i.messages&&Array.isArray(i.messages)&&(this.messages=i.messages.map(o=>({role:o.role,content:o.content}))),this._showToast(n||"History compacted","success"))}_populateAmbiguousRetryPrompt(e){var n;const i=`Some edits failed due to ambiguous anchors (the context lines matched multiple locations in the file). Please retry these edits with more unique anchor context — include a distinctive preceding line (like a function name, class definition, or unique comment) to disambiguate:

`+e.map(o=>`- ${o.file}: ${o.message}`).join(`
`);this._inputValue=i;const s=(n=this.shadowRoot)==null?void 0:n.querySelector(".input-textarea");s&&(s.value=i,this._autoResize(s),s.focus())}_populateNotInContextRetryPrompt(e){var o;const t=e.map(a=>a.split("/").pop()),i=e.map(a=>`- ${a}`).join(`
`),s=e.length===1?`The file ${t[0]} has been added to context. Please retry the edit for:

${i}`:`The files ${t.join(", ")} have been added to context. Please retry the edits for:

${i}`;this._inputValue=s;const n=(o=this.shadowRoot)==null?void 0:o.querySelector(".input-textarea");n&&(n.value=s,this._autoResize(n),n.focus())}_scrollToBottom(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".messages");e&&(e.scrollTop=e.scrollHeight+1e3)}_onScrollBtnClick(){this._autoScroll=!0,this._scrollToBottom()}_onInput(e){this._inputValue=e.target.value,this._autoResize(e.target),this._onInputForUrlDetection(),this._checkAtFilter(this._inputValue)}_autoResize(e){e.style.height="auto",e.style.height=Math.min(e.scrollHeight,200)+"px"}_onKeyDown(e){var i,s;const t=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-input-history");if(!(t!=null&&t.open&&t.handleKey(e))){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(),this._send();return}if(e.key==="ArrowUp"){const n=e.target;if(n.selectionStart===0&&n.selectionEnd===0){e.preventDefault(),t&&(t.show(this._inputValue),this._historyOpen=!0);return}}if(e.key==="Escape"){if(e.preventDefault(),this._atFilterActive)this._clearAtFilter();else if(this._snippetDrawerOpen)this._snippetDrawerOpen=!1;else if(this._inputValue){this._inputValue="";const n=(s=this.shadowRoot)==null?void 0:s.querySelector(".input-textarea");n&&(n.value="",n.style.height="auto")}}}}_onPaste(e){var i;if(this._suppressNextPaste){this._suppressNextPaste=!1,e.preventDefault();return}const t=(i=e.clipboardData)==null?void 0:i.items;if(t){for(const s of t)if(s.type.startsWith("image/")){e.preventDefault();const n=s.getAsFile();if(!n)continue;if(n.size>5*1024*1024){console.warn("Image too large (max 5MB)");continue}if(this._images.length>=5){console.warn("Max 5 images per message");continue}const o=new FileReader;o.onload=()=>{this._images=[...this._images,o.result]},o.readAsDataURL(n);break}}}_removeImage(e){this._images=this._images.filter((t,i)=>i!==e)}async _send(){var c,h,d,p;const e=this._inputValue.trim();if(!e&&this._images.length===0||!this.rpcConnected)return;const t=(c=this.shadowRoot)==null?void 0:c.querySelector("ac-input-history");t&&e&&t.addEntry(e);const i=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;this._currentRequestId=i,this._lastRequestId=i;const s=this._images.length>0?[...this._images]:null,n=((h=this.selectedFiles)==null?void 0:h.length)>0?[...this.selectedFiles]:null,o=(d=this.shadowRoot)==null?void 0:d.querySelector("ac-url-chips");o==null||o.onSend();const a={role:"user",content:e};s&&s.length>0&&(a.images=[...s]),this.messages=[...this.messages,a],this._inputValue="",this._images=[],this._snippetDrawerOpen=!1,this._saveBoolPref("ac-dc-snippet-drawer",!1);const l=(p=this.shadowRoot)==null?void 0:p.querySelector(".input-textarea");l&&(l.value="",l.style.height="auto"),this._autoScroll=!0,this.streamingActive=!0,requestAnimationFrame(()=>this._scrollToBottom());try{await this.rpcExtract("LLMService.chat_streaming",i,e,n,s)}catch(_){console.error("Failed to start stream:",_),this.streamingActive=!1,this._currentRequestId=null;const g=_.message||"Failed to connect";this.messages=[...this.messages,{role:"assistant",content:`**Error:** ${g}`}],this._showToast(`Stream failed: ${g}`,"error")}}async _stop(){if(!(!this._currentRequestId||!this.rpcConnected))try{await this.rpcExtract("LLMService.cancel_streaming",this._currentRequestId)}catch(e){console.error("Failed to cancel:",e)}}_toggleSnippets(){this._snippetDrawerOpen=!this._snippetDrawerOpen,this._saveBoolPref("ac-dc-snippet-drawer",this._snippetDrawerOpen)}_saveBoolPref(e,t){try{localStorage.setItem(e,String(t))}catch{}}_loadBoolPref(e,t){try{const i=localStorage.getItem(e);return i===null?t:i==="true"}catch{return t}}_insertSnippet(e){var l;const t=(l=this.shadowRoot)==null?void 0:l.querySelector(".input-textarea");if(!t)return;const i=e.message||"",s=t.selectionStart,n=this._inputValue.slice(0,s),o=this._inputValue.slice(t.selectionEnd);this._inputValue=n+i+o,t.value=this._inputValue,this._autoResize(t);const a=s+i.length;t.setSelectionRange(a,a),t.focus()}_onHistorySelect(e){var s,n;const t=((s=e.detail)==null?void 0:s.text)??"";this._inputValue=t,this._historyOpen=!1;const i=(n=this.shadowRoot)==null?void 0:n.querySelector(".input-textarea");i&&(i.value=t,this._autoResize(i),i.focus())}_onHistoryCancel(e){var s,n;const t=((s=e.detail)==null?void 0:s.text)??"";this._inputValue=t,this._historyOpen=!1;const i=(n=this.shadowRoot)==null?void 0:n.querySelector(".input-textarea");i&&(i.value=t,i.focus())}_onInputForUrlDetection(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-url-chips");e&&e.detectUrls(this._inputValue)}_onTranscript(e){var s,n;const t=(s=e.detail)==null?void 0:s.text;if(!t)return;const i=(n=this.shadowRoot)==null?void 0:n.querySelector(".input-textarea");this._inputValue&&!this._inputValue.endsWith(" ")&&(this._inputValue+=" "),this._inputValue+=t,i&&(i.value=this._inputValue,this._autoResize(i)),this._onInputForUrlDetection()}async _newSession(){var e;if(this.rpcConnected)try{await this.rpcExtract("LLMService.new_session"),this.messages=[],this._streamingContent="",this._currentRequestId=null,this.streamingActive=!1,this._chatSearchQuery="",this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._clearSearchHighlights();const t=(e=this.shadowRoot)==null?void 0:e.querySelector("ac-url-chips");t&&t.clear(),this._showToast("New session started","success"),window.dispatchEvent(new CustomEvent("session-loaded",{detail:{sessionId:null,messages:[]}}))}catch(t){console.error("Failed to start new session:",t),this._showToast("Failed to start new session","error")}}_openHistoryBrowser(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-history-browser");e&&e.show()}_onSessionLoaded(e){const{messages:t,sessionId:i}=e.detail;Array.isArray(t)&&(this.messages=[...t],this._autoScroll=!0,requestAnimationFrame(()=>requestAnimationFrame(()=>this._scrollToBottom())),this._seedInputHistory(t)),this.dispatchEvent(new CustomEvent("session-loaded",{detail:{sessionId:i,messages:t},bubbles:!0,composed:!0}))}_seedInputHistory(e){var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-input-history");if(t){for(const s of e)if(s.role==="user"){const n=Array.isArray(s.content)?s.content.filter(o=>o.type==="text"&&o.text).map(o=>o.text).join(`
`):s.content||"";n.trim()&&t.addEntry(n)}}}_onPasteToPrompt(e){var s,n;const t=((s=e.detail)==null?void 0:s.text)||"";if(!t)return;const i=(n=this.shadowRoot)==null?void 0:n.querySelector(".input-textarea");i&&(this._inputValue=t,i.value=t,this._autoResize(i),i.focus())}async _onViewUrlContent(e){var i,s;const t=(i=e.detail)==null?void 0:i.url;if(!(!t||!this.rpcConnected))try{const n=await this.rpcExtract("LLMService.get_url_content",t);if(!n){this._showToast("Failed to load URL content","error");return}const o=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-url-content-dialog");o&&o.show(n)}catch(n){console.error("Failed to load URL content:",n),this._showToast("Failed to load URL content","error")}}async _copyDiff(){if(this.rpcConnected)try{const e=await this.rpcExtract("Repo.get_staged_diff"),t=await this.rpcExtract("Repo.get_unstaged_diff"),i=(e==null?void 0:e.diff)||"",s=(t==null?void 0:t.diff)||"",n=[i,s].filter(Boolean).join(`
`);if(!n.trim()){this._showToast("No changes to copy","error");return}await navigator.clipboard.writeText(n),this._showToast("Diff copied to clipboard","success")}catch(e){console.error("Failed to copy diff:",e),this._showToast("Failed to copy diff","error")}}async _commitWithMessage(){var t;if(!this.rpcConnected||this._committing)return;this._committing=!0;const e={role:"assistant",content:"⏳ **Staging changes and generating commit message...**"};this.messages=[...this.messages,e],this._autoScroll&&requestAnimationFrame(()=>this._scrollToBottom());try{const i=await this.rpcExtract("Repo.stage_all");if(i!=null&&i.error){this._removeProgressMsg(e),this._showToast(`Stage failed: ${i.error}`,"error");return}const s=await this.rpcExtract("Repo.get_staged_diff"),n=(s==null?void 0:s.diff)||"";if(!n.trim()){this._removeProgressMsg(e),this._showToast("Nothing to commit","error");return}const o=await this.rpcExtract("LLMService.generate_commit_message",n);if(o!=null&&o.error){this._removeProgressMsg(e),this._showToast(`Message generation failed: ${o.error}`,"error");return}const a=o==null?void 0:o.message;if(!a){this._removeProgressMsg(e),this._showToast("Failed to generate commit message","error");return}const l=await this.rpcExtract("Repo.commit",a);if(l!=null&&l.error){this._removeProgressMsg(e),this._showToast(`Commit failed: ${l.error}`,"error");return}const c=((t=l==null?void 0:l.sha)==null?void 0:t.slice(0,7))||"";this._showToast(`Committed ${c}: ${a.split(`
`)[0]}`,"success");const h=this.messages.filter(d=>d!==e);this.messages=[...h,{role:"assistant",content:`**Committed** \`${c}\`

\`\`\`
${a}
\`\`\``}],this._autoScroll&&requestAnimationFrame(()=>this._scrollToBottom()),this.dispatchEvent(new CustomEvent("files-modified",{detail:{files:[]},bubbles:!0,composed:!0}))}catch(i){console.error("Commit failed:",i),this._removeProgressMsg(e),this._showToast(`Commit failed: ${i.message||"Unknown error"}`,"error")}finally{this._committing=!1}}_removeProgressMsg(e){this.messages=this.messages.filter(t=>t!==e)}_confirmReset(){this._confirmAction={title:"Reset to HEAD",message:"This will discard ALL uncommitted changes (staged and unstaged). This cannot be undone.",action:()=>this._resetHard()},this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".confirm-cancel");e&&e.focus()})}async _resetHard(){if(this._confirmAction=null,!!this.rpcConnected)try{const e=await this.rpcExtract("Repo.reset_hard");if(e!=null&&e.error){this._showToast(`Reset failed: ${e.error}`,"error");return}this._showToast("Reset to HEAD — all changes discarded","success"),this.dispatchEvent(new CustomEvent("files-modified",{detail:{files:[]},bubbles:!0,composed:!0}))}catch(e){console.error("Reset failed:",e),this._showToast(`Reset failed: ${e.message||"Unknown error"}`,"error")}}_dismissConfirm(){this._confirmAction=null}_showToast(e,t=""){this._toast={message:e,type:t},clearTimeout(this._toastTimer),this._toastTimer=setTimeout(()=>{this._toast=null},3e3)}_onChatSearchInput(e){this._chatSearchQuery=e.target.value,this._updateChatSearchMatches()}_onChatSearchKeyDown(e){e.key==="Enter"?(e.preventDefault(),e.shiftKey?this._chatSearchPrev():this._chatSearchNext()):e.key==="Escape"&&(e.preventDefault(),this._clearChatSearch(),e.target.blur())}_updateChatSearchMatches(){const e=this._chatSearchQuery.trim().toLowerCase();if(!e){this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._clearSearchHighlights();return}const t=[];for(let i=0;i<this.messages.length;i++)(this.messages[i].content||"").toLowerCase().includes(e)&&t.push(i);this._chatSearchMatches=t,t.length>0?(this._chatSearchCurrent=0,this._scrollToSearchMatch(t[0])):(this._chatSearchCurrent=-1,this._clearSearchHighlights())}_chatSearchNext(){this._chatSearchMatches.length!==0&&(this._chatSearchCurrent=(this._chatSearchCurrent+1)%this._chatSearchMatches.length,this._scrollToSearchMatch(this._chatSearchMatches[this._chatSearchCurrent]))}_chatSearchPrev(){this._chatSearchMatches.length!==0&&(this._chatSearchCurrent=(this._chatSearchCurrent-1+this._chatSearchMatches.length)%this._chatSearchMatches.length,this._scrollToSearchMatch(this._chatSearchMatches[this._chatSearchCurrent]))}_scrollToSearchMatch(e){this._clearSearchHighlights(),this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(`.message-card[data-msg-index="${e}"]`);t&&(t.classList.add("search-highlight"),t.scrollIntoView({block:"center",behavior:"smooth"}))})}_clearSearchHighlights(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelectorAll(".message-card.search-highlight");if(e)for(const i of e)i.classList.remove("search-highlight")}_clearChatSearch(){this._chatSearchQuery="",this._chatSearchMatches=[],this._chatSearchCurrent=-1,this._clearSearchHighlights()}_getReviewDiffCount(){var t;if(!((t=this.reviewState)!=null&&t.active)||!this.reviewState.changed_files)return 0;const e=new Set(this.reviewState.changed_files.map(i=>i.path));return(this.selectedFiles||[]).filter(i=>e.has(i)).length}_checkAtFilter(e){const t=e.match(/@(\S*)$/);t?(this._atFilterActive=!0,this.dispatchEvent(new CustomEvent("filter-from-chat",{detail:{filter:t[1]},bubbles:!0,composed:!0}))):this._atFilterActive&&(this._atFilterActive=!1,this.dispatchEvent(new CustomEvent("filter-from-chat",{detail:{filter:""},bubbles:!0,composed:!0})))}_clearAtFilter(){var t;if(!this._atFilterActive)return!1;const e=this._inputValue.match(/@\S*$/);if(e){this._inputValue=this._inputValue.slice(0,e.index).trimEnd();const i=(t=this.shadowRoot)==null?void 0:t.querySelector(".input-textarea");i&&(i.value=this._inputValue,this._autoResize(i))}return this._atFilterActive=!1,this.dispatchEvent(new CustomEvent("filter-from-chat",{detail:{filter:""},bubbles:!0,composed:!0})),!0}accumulateFileInInput(e){var n;const t=e.split("/").pop(),i=(n=this.shadowRoot)==null?void 0:n.querySelector(".input-textarea"),s=this._inputValue.trim();if(!s)this._inputValue=`The file ${t} added. Do you want to see more files before you continue?`;else if(/^The file .+ added\./.test(s)||/\(added .+\)$/.test(s))if(s.includes("Do you want to see more files")){const o=s.match(/^The file (.+?) added\./);if(o)this._inputValue=`The files ${o[1]}, ${t} added. Do you want to see more files before you continue?`;else{const a=s.match(/^The files (.+?) added\./);a&&(this._inputValue=`The files ${a[1]}, ${t} added. Do you want to see more files before you continue?`)}}else this._inputValue=s+` (added ${t})`;else this._inputValue=s+` (added ${t})`;i&&(i.value=this._inputValue,this._autoResize(i))}_getMessageText(e){const t=e.content;return Array.isArray(t)?t.filter(i=>i.type==="text"&&i.text).map(i=>i.text).join(`
`):t||""}_copyMessageText(e){navigator.clipboard.writeText(this._getMessageText(e)).then(()=>{this._showToast("Copied to clipboard","success")})}_insertMessageText(e){var s;const t=this._getMessageText(e),i=(s=this.shadowRoot)==null?void 0:s.querySelector(".input-textarea");i&&(this._inputValue=t,i.value=t,this._autoResize(i),i.focus())}_renderAssistantContent(e,t,i){const s=t||{},n=zn(e),o=[];for(const a of n)if(a.type==="text"){let l=Ge(a.content);if(i&&this._repoFiles.length>0){const{html:c}=Li(l,this._repoFiles,this.selectedFiles,[]);l=c}o.push(l)}else if(a.type==="edit"||a.type==="edit-pending"){const l=s[a.filePath]||{};o.push(this._renderEditBlockHtml(a,l))}return o.join("")}_renderEditBlockHtml(e,t){const i=t.status||(e.type==="edit-pending"?"pending":"unknown"),s=t.message||"";let n="";i==="applied"?n='<span class="edit-badge applied">✅ applied</span>':i==="failed"?n='<span class="edit-badge failed">❌ failed</span>':i==="skipped"?n='<span class="edit-badge skipped">⚠️ skipped</span>':i==="validated"?n='<span class="edit-badge validated">☑ validated</span>':i==="not_in_context"?n='<span class="edit-badge not-in-context">⚠️ not in context</span>':i==="already_applied"?n='<span class="edit-badge applied">✅ already applied</span>':e.isCreate?n='<span class="edit-badge applied">🆕 new</span>':n='<span class="edit-badge pending">⏳ pending</span>';const a=Dn(e.oldLines||[],e.newLines||[]).map(p=>this._renderDiffLineHtml(p)).join(""),l=i==="failed"&&s?`<div class="edit-error">${R(s)}</div>`:"",h=((e.newLines&&e.newLines.length>0?e.newLines:e.oldLines)||[]).slice(0,5).join(`
`).trim(),d=R(h);return`
      <div class="edit-block-card">
        <div class="edit-block-header">
          <span class="edit-file-path" data-path="${R(e.filePath)}">${R(e.filePath)}</span>
          <button class="edit-goto-btn" data-path="${R(e.filePath)}" data-search="${d}" title="Open in diff viewer">↗</button>
          ${n}
        </div>
        ${l}
        <pre class="edit-diff">${a}</pre>
      </div>
    `}_renderDiffLineHtml(e){const t=e.type==="remove"?"-":e.type==="add"?"+":" ";if(e.charDiff&&e.charDiff.length>0){const i=e.charDiff.map(s=>s.type==="equal"?R(s.text):`<span class="diff-change">${R(s.text)}</span>`).join("");return`<span class="diff-line ${e.type}"><span class="diff-line-prefix">${t}</span>${i}</span>`}return`<span class="diff-line ${e.type}"><span class="diff-line-prefix">${t}</span>${R(e.text)}</span>`}_renderEditSummary(e){var o;if(!e.passed&&!e.failed&&!e.skipped&&!e.not_in_context&&!e.already_applied)return v;const t=[];e.passed&&t.push(m`<span class="stat pass">✅ ${e.passed} applied</span>`),e.already_applied&&t.push(m`<span class="stat pass">✅ ${e.already_applied} already applied</span>`),e.failed&&t.push(m`<span class="stat fail">❌ ${e.failed} failed</span>`),e.skipped&&t.push(m`<span class="stat skip">⚠️ ${e.skipped} skipped</span>`),e.not_in_context&&t.push(m`<span class="stat skip">⚠️ ${e.not_in_context} not in context</span>`);const i=((o=e.files_auto_added)==null?void 0:o.length)>0?m`<div style="margin-top:4px;font-size:0.75rem;color:var(--text-secondary)">
          ${e.files_auto_added.length} file${e.files_auto_added.length>1?"s were":" was"} added to context. Send a follow-up to retry those edits.
        </div>`:v,n=e.editResults&&Object.values(e.editResults).some(a=>a.status==="failed"&&a.message!=="already_applied")?m`<div style="margin-top:4px;font-size:0.75rem;color:var(--text-secondary)">
          A retry prompt has been prepared in the input below.
        </div>`:v;return m`<div class="edit-summary">${t}${i}${n}</div>`}_renderMsgActions(e){return this.streamingActive?v:m`
      <div class="msg-actions top">
        <button class="msg-action-btn" title="Copy" @click=${()=>this._copyMessageText(e)}>📋</button>
        <button class="msg-action-btn" title="Insert into input" @click=${()=>this._insertMessageText(e)}>↩</button>
      </div>
    `}_renderMsgActionsBottom(e){return this.streamingActive||(e.content||"").length<600?v:m`
      <div class="msg-actions bottom">
        <button class="msg-action-btn" title="Copy" @click=${()=>this._copyMessageText(e)}>📋</button>
        <button class="msg-action-btn" title="Insert into input" @click=${()=>this._insertMessageText(e)}>↩</button>
      </div>
    `}_renderUserContent(e){var n;const t=e.content;if(Array.isArray(t)){const o=[],a=[];for(const l of t)l.type==="text"&&l.text?o.push(m`<div class="md-content" @click=${this._onContentClick}>
            ${J(Ge(l.text))}
          </div>`):l.type==="image_url"&&((n=l.image_url)!=null&&n.url)&&a.push(l.image_url.url);return a.length>0&&o.push(m`
          <div class="user-images">
            ${a.map(l=>m`
              <img class="user-image-thumb" src="${l}" alt="User image"
                   @click=${()=>this._openLightbox(l)}>
            `)}
          </div>
        `),o}const i=t||"",s=m`<div class="md-content" @click=${this._onContentClick}>
      ${J(Ge(i))}
    </div>`;return e.images&&e.images.length>0?m`
        ${s}
        <div class="user-images">
          ${e.images.map(o=>m`
            <img class="user-image-thumb" src="${o}" alt="User image"
                 @click=${()=>this._openLightbox(o)}>
          `)}
        </div>
      `:s}_openLightbox(e){this._lightboxSrc=e,this.updateComplete.then(()=>{var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".image-lightbox");t&&t.focus()})}_closeLightbox(e){this._lightboxSrc=null}_onLightboxKeyDown(e){e.key==="Escape"&&(e.preventDefault(),this._lightboxSrc=null)}_renderMessage(e,t){const i=e.role==="user",s=e.content||"",o=this.messages.length-t<=15?" force-visible":"";if(i)return m`
        <div class="message-card user${o}" data-msg-index="${t}">
          ${this._renderMsgActions(e)}
          <div class="role-label">You</div>
          ${this._renderUserContent(e)}
          ${this._renderMsgActionsBottom(e)}
        </div>
      `;const a=e.editResults?Object.keys(e.editResults):[],l=this._renderAssistantContent(s,e.editResults,!0),{html:c,referencedFiles:h}=Li(l,this._repoFiles,this.selectedFiles,a),d=Pn(h,this.selectedFiles);return m`
      <div class="message-card assistant" data-msg-index="${t}">
        ${this._renderMsgActions(e)}
        <div class="role-label">Assistant</div>
        <div class="md-content" @click=${this._onContentClick}>
          ${J(c)}
        </div>
        ${d?m`
          <div class="file-summary-container" @click=${this._onFileSummaryClick}>
            ${J(d)}
          </div>
        `:v}
        ${this._renderEditSummary(e)}
        ${this._renderMsgActionsBottom(e)}
      </div>
    `}_onContentClick(e){const t=e.target.closest(".file-mention");if(t){const o=t.dataset.file;o&&this._dispatchFileMentionClick(o,!0);return}const i=e.target.closest(".edit-file-path");if(i){const o=i.dataset.path;o&&this._dispatchFileMentionClick(o,!1);return}const s=e.target.closest(".edit-goto-btn");if(s){const o=s.dataset.path,a=s.dataset.search||"";o&&window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:o,searchText:a}}));return}const n=e.target.closest(".code-copy-btn");if(n){const o=n.closest("pre");if(o){const a=o.querySelector("code"),l=a?a.textContent:o.textContent;navigator.clipboard.writeText(l).then(()=>{n.textContent="✓ Copied",n.classList.add("copied"),setTimeout(()=>{n.textContent="📋",n.classList.remove("copied")},1500)}).catch(()=>{n.textContent="✗ Failed",setTimeout(()=>{n.textContent="📋"},1500)})}return}}_onFileSummaryClick(e){const t=e.target.closest(".file-chip");if(t){const s=t.dataset.file;s&&this._dispatchFileMentionClick(s,!1);return}const i=e.target.closest(".add-all-btn");if(i)try{const s=JSON.parse(i.dataset.files);if(Array.isArray(s))for(const n of s)this._dispatchFileMentionClick(n,!1)}catch(s){console.warn("Failed to parse add-all files:",s)}}_dispatchFileMentionClick(e,t=!0){this.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:e,navigate:t},bubbles:!0,composed:!0}))}render(){var t,i,s,n,o,a,l,c,h;const e=this.messages.length>0||this._streamingContent;return m`
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
          ${this._chatSearchMatches.length>0?m`
            <span class="chat-search-counter" aria-live="polite">${this._chatSearchCurrent+1}/${this._chatSearchMatches.length}</span>
            <button class="chat-search-nav" title="Previous (Shift+Enter)" aria-label="Previous search result" @click=${this._chatSearchPrev}>▲</button>
            <button class="chat-search-nav" title="Next (Enter)" aria-label="Next search result" @click=${this._chatSearchNext}>▼</button>
          `:v}
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
        ${e?m`
          ${this.messages.map((d,p)=>this._renderMessage(d,p))}

          ${this._streamingContent?m`
            <div class="message-card assistant force-visible">
              <div class="role-label">
                Assistant <span class="streaming-indicator"></span>
              </div>
              <div class="md-content" @click=${this._onContentClick}>
                ${J(this._renderAssistantContent(this._streamingContent,{},!1))}
              </div>
            </div>
          `:v}
        `:m`
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
      ${(n=this.reviewState)!=null&&n.active?m`
        <div class="review-status-bar">
          📋 <strong>${this.reviewState.branch}</strong>
          ${((o=this.reviewState.stats)==null?void 0:o.commit_count)||0} commits ·
          ${((a=this.reviewState.stats)==null?void 0:a.files_changed)||0} files ·
          +${((l=this.reviewState.stats)==null?void 0:l.additions)||0} −${((c=this.reviewState.stats)==null?void 0:c.deletions)||0}
          <span class="review-diff-count">
            ${this._getReviewDiffCount()}/${((h=this.reviewState.stats)==null?void 0:h.files_changed)||0} diffs in context
          </span>
          <button class="review-exit-link" @click=${()=>this.dispatchEvent(new CustomEvent("exit-review",{bubbles:!0,composed:!0}))}>
            Exit Review
          </button>
        </div>
      `:v}

      <!-- Input Area -->
      <div class="input-area">
        <ac-input-history
          @history-select=${this._onHistorySelect}
          @history-cancel=${this._onHistoryCancel}
        ></ac-input-history>

        <ac-url-chips></ac-url-chips>

        ${this._images.length>0?m`
          <div class="image-previews">
            ${this._images.map((d,p)=>m`
              <div class="image-preview">
                <img src="${d}" alt="Pasted image">
                <button class="remove-btn" @click=${()=>this._removeImage(p)}>✕</button>
              </div>
            `)}
          </div>
        `:v}

        ${this._snippetDrawerOpen&&this._snippets.length>0?m`
          <div class="snippet-drawer">
            ${this._snippets.map(d=>{var p;return m`
              <button class="snippet-btn" @click=${()=>this._insertSnippet(d)} title="${d.tooltip||""}">
                ${d.icon||"📌"} ${d.tooltip||((p=d.message)==null?void 0:p.slice(0,30))||"Snippet"}
              </button>
            `})}
          </div>
        `:v}

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

          ${this.streamingActive?m`
            <button class="send-btn stop" @click=${this._stop} title="Stop" aria-label="Stop generation">⏹</button>
          `:m`
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
      ${this._confirmAction?m`
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
      `:v}

      <!-- Toast -->
      ${this._toast?m`
        <div class="toast ${this._toast.type}" role="alert">${this._toast.message}</div>
      `:v}

      <!-- Image Lightbox -->
      ${this._lightboxSrc?m`
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
      `:v}
    `}}C(Mt,"properties",{messages:{type:Array},selectedFiles:{type:Array},streamingActive:{type:Boolean},reviewState:{type:Object},_streamingContent:{type:String,state:!0},_inputValue:{type:String,state:!0},_images:{type:Array,state:!0},_autoScroll:{type:Boolean,state:!0},_snippetDrawerOpen:{type:Boolean,state:!0},_historyOpen:{type:Boolean,state:!0},_currentRequestId:{type:String,state:!0},_confirmAction:{type:Object,state:!0},_toast:{type:Object,state:!0},_committing:{type:Boolean,state:!0},_repoFiles:{type:Array,state:!0},_chatSearchQuery:{type:String,state:!0},_chatSearchMatches:{type:Array,state:!0},_chatSearchCurrent:{type:Number,state:!0},_lightboxSrc:{type:String,state:!0}}),C(Mt,"styles",[F,j,z`
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

  `]);customElements.define("ac-chat-panel",Mt);class Rt extends V(L){constructor(){super(),this.selectedFiles=new Set,this._tree=null,this._modified=[],this._staged=[],this._untracked=[],this._diffStats={},this._expanded=new Set,this._filter="",this._focusedPath="",this._contextMenu=null,this._contextInput=null,this._activeInViewer="",this._branch="",this._branchDetached=!1,this._allFilePaths=[],this._flatVisible=[],this._initialAutoSelect=!1,this._expanded.add("");try{this._sortMode=localStorage.getItem("ac-dc-sort-mode")||"name",this._sortAscending=localStorage.getItem("ac-dc-sort-asc")!=="false"}catch{this._sortMode="name",this._sortAscending=!0}this._onDocClick=this._onDocClick.bind(this),this._onActiveFileChanged=this._onActiveFileChanged.bind(this)}connectedCallback(){super.connectedCallback(),document.addEventListener("click",this._onDocClick),window.addEventListener("active-file-changed",this._onActiveFileChanged)}disconnectedCallback(){super.disconnectedCallback(),document.removeEventListener("click",this._onDocClick),window.removeEventListener("active-file-changed",this._onActiveFileChanged)}onRpcReady(){Promise.resolve().then(()=>this.loadTree())}_onActiveFileChanged(e){var t;this._activeInViewer=((t=e.detail)==null?void 0:t.path)||"",this._activeInViewer&&this._expandToPath(this._activeInViewer)}_expandToPath(e){const t=e.split("/");if(t.length<=1)return;let i=!1,s="";for(let n=0;n<t.length-1;n++)s=s?`${s}/${t[n]}`:t[n],this._expanded.has(s)||(this._expanded.add(s),i=!0);i&&(this._expanded=new Set(this._expanded))}async loadTree(){try{const e=await this.rpcExtract("Repo.get_file_tree");if(!e||e.error){console.error("Failed to load tree:",e==null?void 0:e.error);return}this._tree=e.tree,this._modified=e.modified||[],this._staged=e.staged||[],this._untracked=e.untracked||[],this._diffStats=e.diff_stats||{};try{const t=await this.rpcExtract("Repo.get_current_branch");if(t&&!t.error){const i=typeof t=="string"?t:t.branch||"";if(this._branchDetached=i==="HEAD",this._branchDetached)try{const s=await this.rpcExtract("Repo.resolve_ref","HEAD");this._branch=(typeof s=="string"?s:"").slice(0,7)||"detached"}catch{this._branch="detached"}else this._branch=i}}catch{}if(this._allFilePaths=[],this._collectPaths(this._tree,this._allFilePaths),!this._initialAutoSelect){this._initialAutoSelect=!0;const t=new Set([...this._modified,...this._staged,...this._untracked]);t.size>0&&(this.selectedFiles=new Set(t),this._autoExpandChanged(t),this._notifySelection())}}catch(e){console.error("Failed to load file tree:",e)}}_collectPaths(e,t){if(e&&(e.type==="file"&&t.push(e.path),e.children))for(const i of e.children)this._collectPaths(i,t)}_autoExpandChanged(e){for(const t of e){const i=t.split("/");let s="";for(let n=0;n<i.length-1;n++)s=s?`${s}/${i[n]}`:i[n],this._expanded.add(s)}this._expanded=new Set(this._expanded)}_flattenTree(e,t=0){if(!e)return[];const i=[];if(e.path===""&&e.type==="dir"){if(i.push({node:e,depth:0}),this._expanded.has("")||this._filter){const n=this._sortChildren(e.children||[]);for(const o of n)i.push(...this._flattenTree(o,1))}return i}if(!this._matchesFilter(e))return i;if(i.push({node:e,depth:t}),e.type==="dir"&&(this._expanded.has(e.path)||this._filter)){const n=this._sortChildren(e.children||[]);for(const o of n)i.push(...this._flattenTree(o,t+1))}return i}_sortChildren(e){const t=this._sortAscending?1:-1;return[...e].sort((i,s)=>{if(i.type!==s.type)return i.type==="dir"?-1:1;if(i.type==="dir")return i.name.localeCompare(s.name);if(this._sortMode==="mtime"){const n=i.mtime||0,o=s.mtime||0;return n!==o?(o-n)*t:i.name.localeCompare(s.name)}if(this._sortMode==="size"){const n=i.lines||0,o=s.lines||0;return n!==o?(o-n)*t:i.name.localeCompare(s.name)}return i.name.localeCompare(s.name)*t})}_setSort(e){this._sortMode===e?this._sortAscending=!this._sortAscending:(this._sortMode=e,this._sortAscending=!0);try{localStorage.setItem("ac-dc-sort-mode",this._sortMode),localStorage.setItem("ac-dc-sort-asc",String(this._sortAscending))}catch{}}_matchesFilter(e){if(!this._filter)return!0;const t=this._filter.toLowerCase();return e.path.toLowerCase().includes(t)?!0:e.children?e.children.some(i=>this._matchesFilter(i)):!1}_toggleSelect(e,t){if(t.stopPropagation(),e.type==="file"){const i=new Set(this.selectedFiles);i.has(e.path)?i.delete(e.path):i.add(e.path),this.selectedFiles=i}else{const i=[];this._collectPaths(e,i);const s=i.every(o=>this.selectedFiles.has(o)),n=new Set(this.selectedFiles);for(const o of i)s?n.delete(o):n.add(o);this.selectedFiles=n}this._notifySelection()}_getCheckState(e){if(e.type==="file")return this.selectedFiles.has(e.path)?"checked":"unchecked";const t=[];if(this._collectPaths(e,t),t.length===0)return"unchecked";const i=t.filter(s=>this.selectedFiles.has(s)).length;return i===0?"unchecked":i===t.length?"checked":"indeterminate"}_notifySelection(){this.dispatchEvent(new CustomEvent("selection-changed",{detail:{selectedFiles:[...this.selectedFiles]},bubbles:!0,composed:!0}))}_toggleExpand(e){const t=new Set(this._expanded);t.has(e.path)?t.delete(e.path):t.add(e.path),this._expanded=t}_onRowClick(e){e.type==="dir"?this._toggleExpand(e):this.dispatchEvent(new CustomEvent("file-clicked",{detail:{path:e.path},bubbles:!0,composed:!0})),this._focusedPath=e.path}_onRowMiddleClick(e,t){t.button===1&&(t.preventDefault(),this.dispatchEvent(new CustomEvent("insert-path",{detail:{path:e.path},bubbles:!0,composed:!0})))}_onContextMenu(e,t){t.preventDefault(),t.stopPropagation(),this._contextMenu={x:t.clientX,y:t.clientY,node:e,isDir:e.type==="dir"}}_onDocClick(){this._contextMenu&&(this._contextMenu=null)}async _ctxStage(e){this._contextMenu=null;try{await this.rpcExtract("Repo.stage_files",e),await this.loadTree()}catch(t){console.error("Stage failed:",t)}}async _ctxUnstage(e){this._contextMenu=null;try{await this.rpcExtract("Repo.unstage_files",e),await this.loadTree()}catch(t){console.error("Unstage failed:",t)}}async _ctxDiscard(e){if(this._contextMenu=null,!!confirm(`Discard changes to ${e}?`))try{await this.rpcExtract("Repo.discard_changes",[e]),await this.loadTree()}catch(t){console.error("Discard failed:",t)}}_ctxRename(e){this._contextMenu=null,this._contextInput={type:"rename",path:e.path,value:e.path}}async _ctxDelete(e){if(this._contextMenu=null,!!confirm(`Delete ${e}?`))try{await this.rpcExtract("Repo.delete_file",e);const t=new Set(this.selectedFiles);t.delete(e),this.selectedFiles=t,this._notifySelection(),await this.loadTree()}catch(t){console.error("Delete failed:",t)}}_ctxNewFile(e){if(this._contextMenu=null,this._contextInput={type:"new-file",path:e,value:""},!this._expanded.has(e)){const t=new Set(this._expanded);t.add(e),this._expanded=t}}_ctxNewDir(e){if(this._contextMenu=null,this._contextInput={type:"new-dir",path:e,value:""},!this._expanded.has(e)){const t=new Set(this._expanded);t.add(e),this._expanded=t}}async _submitContextInput(e){if(e.key!=="Enter")return;const t=this._contextInput;if(!t)return;const i=e.target.value.trim();if(!i){this._contextInput=null;return}try{if(t.type==="rename")await this.rpcExtract("Repo.rename_file",t.path,i);else if(t.type==="new-file"){const s=t.path?`${t.path}/${i}`:i;await this.rpcExtract("Repo.create_file",s,"")}else if(t.type==="new-dir"){const s=t.path?`${t.path}/${i}/.gitkeep`:`${i}/.gitkeep`;await this.rpcExtract("Repo.create_file",s,"")}}catch(s){console.error("Operation failed:",s)}this._contextInput=null,await this.loadTree()}_cancelContextInput(e){e.key==="Escape"&&(this._contextInput=null)}_onTreeKeyDown(e){const t=this._flatVisible;if(!t.length)return;let i=t.findIndex(s=>s.node.path===this._focusedPath);if(e.key==="ArrowDown")e.preventDefault(),i=Math.min(t.length-1,i+1),this._focusedPath=t[i].node.path,this._scrollToFocused();else if(e.key==="ArrowUp")e.preventDefault(),i=Math.max(0,i-1),this._focusedPath=t[i].node.path,this._scrollToFocused();else if(e.key==="ArrowRight"){e.preventDefault();const s=t[i];(s==null?void 0:s.node.type)==="dir"&&!this._expanded.has(s.node.path)&&this._toggleExpand(s.node)}else if(e.key==="ArrowLeft"){e.preventDefault();const s=t[i];(s==null?void 0:s.node.type)==="dir"&&this._expanded.has(s.node.path)&&this._toggleExpand(s.node)}else if(e.key===" "||e.key==="Enter"){e.preventDefault();const s=t[i];s&&(e.key===" "?this._toggleSelect(s.node,e):this._onRowClick(s.node))}else if(e.key==="F2"){e.preventDefault();const s=t[i];s&&s.node.type==="file"&&this._ctxRename(s.node)}}_scrollToFocused(){requestAnimationFrame(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".tree-row.focused");e&&e.scrollIntoView({block:"nearest"})})}_onFilterInput(e){this._filter=e.target.value}setFilter(e){this._filter=e||""}_getGitStatus(e){return this._staged.includes(e)?"staged":this._modified.includes(e)?"modified":this._untracked.includes(e)?"untracked":null}_getLineCountColor(e){return e>170?"red":e>=130?"orange":"green"}_renderRow(e){var d,p,_;const{node:t,depth:i}=e,s=t.type==="dir",n=this._expanded.has(t.path),o=this._getCheckState(t),a=s?null:this._getGitStatus(t.path),l=s?null:this._diffStats[t.path],c=this._focusedPath===t.path,h=this._activeInViewer===t.path;return m`
      <div
        class="tree-row ${c?"focused":""} ${h?"active-in-viewer":""}"
        role="treeitem"
        aria-selected="${o==="checked"}"
        aria-expanded="${s?String(n):v}"
        aria-level="${i+1}"
        aria-label="${t.name}${a?`, ${a}`:""}"
        style="padding-left: ${i*16+4}px"
        @click=${()=>this._onRowClick(t)}
        @auxclick=${g=>this._onRowMiddleClick(t,g)}
        @contextmenu=${g=>this._onContextMenu(t,g)}
      >
        <span class="toggle" aria-hidden="true">
          ${s?n?"▾":"▸":""}
        </span>

        <input
          type="checkbox"
          class="tree-checkbox"
          aria-label="Select ${t.name}"
          .checked=${o==="checked"}
          .indeterminate=${o==="indeterminate"}
          @click=${g=>this._toggleSelect(t,g)}
          @change=${g=>g.stopPropagation()}
        />

        <span class="node-name ${s?"dir":""}${!s&&a?` ${a}`:""}">${t.name}</span>

        ${s&&t.path===""&&this._branch?m`
          <span class="branch-badge ${this._branchDetached?"detached":""}"
                title="${this._branchDetached?"Detached HEAD":"Branch"}: ${this._branch}">
            <span class="branch-icon">⎇</span>${this._branch}
          </span>
        `:v}

        <span class="badges">
          ${!s&&t.lines>0?m`
            <span class="line-count ${this._getLineCountColor(t.lines)}">${t.lines}</span>
          `:v}

          ${a?m`
            <span class="git-badge ${a}">
              ${a==="modified"?"M":a==="staged"?"S":"U"}
            </span>
          `:v}

          ${l?m`
            <span class="diff-stat">
              ${l.additions>0?m`<span class="diff-add">+${l.additions}</span>`:v}
              ${l.deletions>0?m` <span class="diff-del">-${l.deletions}</span>`:v}
            </span>
          `:v}
        </span>
      </div>

      ${this._contextInput&&this._contextInput.path===t.path&&this._contextInput.type==="rename"?m`
        <div style="padding-left: ${i*16+40}px; padding-right: 8px;">
          <input
            class="inline-input"
            .value=${this._contextInput.value}
            @keydown=${g=>{g.stopPropagation(),this._submitContextInput(g),this._cancelContextInput(g)}}
            @blur=${()=>{this._contextInput=null}}
          />
        </div>
      `:v}

      ${s&&((d=this._contextInput)==null?void 0:d.path)===t.path&&(((p=this._contextInput)==null?void 0:p.type)==="new-file"||((_=this._contextInput)==null?void 0:_.type)==="new-dir")?m`
        <div style="padding-left: ${(i+1)*16+40}px; padding-right: 8px;">
          <input
            class="inline-input"
            placeholder="${this._contextInput.type==="new-file"?"filename":"dirname"}"
            @keydown=${g=>{g.stopPropagation(),this._submitContextInput(g),this._cancelContextInput(g)}}
            @blur=${()=>{this._contextInput=null}}
          />
        </div>
      `:v}
    `}_renderContextMenu(){if(!this._contextMenu)return v;const{x:e,y:t,node:i,isDir:s}=this._contextMenu,n=i.path;return m`
      <div class="context-menu" role="menu" aria-label="File actions"
           style="left: ${e}px; top: ${t}px"
           @click=${o=>o.stopPropagation()}>
        ${s?m`
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxNewFile(n)}>📄 New File</div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxNewDir(n)}>📁 New Directory</div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${()=>{const o=[];this._collectPaths(i,o),this._ctxStage(o)}}>
            ➕ Stage All
          </div>
          <div class="context-menu-item" role="menuitem" @click=${()=>{const o=[];this._collectPaths(i,o),this._ctxUnstage(o)}}>
            ➖ Unstage All
          </div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxRename(i)}>✏️ Rename</div>
        `:m`
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxStage([n])}>➕ Stage</div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxUnstage([n])}>➖ Unstage</div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${()=>this._ctxRename(i)}>✏️ Rename</div>
          <div class="context-menu-item danger" role="menuitem" @click=${()=>this._ctxDiscard(n)}>↩️ Discard Changes</div>
          <div class="context-menu-item danger" role="menuitem" @click=${()=>this._ctxDelete(n)}>🗑️ Delete</div>
        `}
      </div>
    `}updated(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".inline-input");if(e&&this._contextInput&&(e.focus(),this._contextInput.type==="rename")){const i=e.value||"",n=i.lastIndexOf("/")+1,o=i.lastIndexOf("."),a=o>n?o:i.length;e.setSelectionRange(n,a)}}render(){var i,s,n,o,a;if(!this._tree)return m`<div class="empty-state">Loading file tree...</div>`;const e=this._flattenTree(this._tree);this._flatVisible=e;const t=(i=this.reviewState)==null?void 0:i.active;return m`
      ${t?m`
        <div class="review-banner">
          <div class="review-banner-title">
            <span>📋 Reviewing: <strong>${this.reviewState.branch}</strong></span>
            <button class="review-exit-btn" @click=${()=>this.dispatchEvent(new CustomEvent("exit-review",{bubbles:!0,composed:!0}))}>
              Exit ✕
            </button>
          </div>
          <div class="review-stats">
            ${((s=this.reviewState.stats)==null?void 0:s.commit_count)||0} commits ·
            ${((n=this.reviewState.stats)==null?void 0:n.files_changed)||0} files ·
            +${((o=this.reviewState.stats)==null?void 0:o.additions)||0}
            -${((a=this.reviewState.stats)==null?void 0:a.deletions)||0}
          </div>
        </div>
      `:v}

      <div class="filter-bar">
        <input
          class="filter-input"
          type="text"
          placeholder="Filter files..."
          aria-label="Filter files"
          .value=${this._filter}
          @input=${this._onFilterInput}
        />
        <div class="sort-buttons">
          <button class="sort-btn ${this._sortMode==="name"?"active":""}"
            title="Sort by name"
            @click=${()=>this._setSort("name")}>
            A${this._sortMode==="name"?this._sortAscending?"↓":"↑":""}
          </button>
          <button class="sort-btn ${this._sortMode==="mtime"?"active":""}"
            title="Sort by modification time"
            @click=${()=>this._setSort("mtime")}>
            🕐${this._sortMode==="mtime"?this._sortAscending?"↓":"↑":""}
          </button>
          <button class="sort-btn ${this._sortMode==="size"?"active":""}"
            title="Sort by size (line count)"
            @click=${()=>this._setSort("size")}>
            #${this._sortMode==="size"?this._sortAscending?"↓":"↑":""}
          </button>
        </div>
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
    `}}C(Rt,"properties",{selectedFiles:{type:Object,hasChanged:()=>!0},reviewState:{type:Object},_tree:{type:Object,state:!0},_modified:{type:Array,state:!0},_staged:{type:Array,state:!0},_untracked:{type:Array,state:!0},_diffStats:{type:Object,state:!0},_expanded:{type:Object,state:!0},_filter:{type:String,state:!0},_focusedPath:{type:String,state:!0},_contextMenu:{type:Object,state:!0},_contextInput:{type:Object,state:!0},_activeInViewer:{type:String,state:!0},_branch:{type:String,state:!0},_branchDetached:{type:Boolean,state:!0},_sortMode:{type:String,state:!0},_sortAscending:{type:Boolean,state:!0}}),C(Rt,"styles",[F,j,z`
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

    /* Sort buttons */
    .sort-buttons {
      display: flex;
      gap: 2px;
      flex-shrink: 0;
    }
    .sort-btn {
      background: none;
      border: 1px solid transparent;
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 2px 5px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;
      line-height: 1;
    }
    .sort-btn:hover {
      color: var(--text-primary);
      background: var(--bg-tertiary);
    }
    .sort-btn.active {
      color: var(--accent-primary);
      border-color: var(--accent-primary);
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

    /* Branch badge next to repo name */
    .branch-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 0.7rem;
      font-family: var(--font-mono);
      color: var(--text-muted);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 10px;
      padding: 1px 8px 1px 6px;
      margin-left: 6px;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 0;
      line-height: 1.4;
    }
    .branch-badge.detached {
      color: var(--accent-orange);
      border-color: rgba(240, 136, 62, 0.3);
    }
    .branch-icon {
      font-size: 0.65rem;
      flex-shrink: 0;
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
  `]);customElements.define("ac-file-picker",Rt);const zi=280,Ii=150,Di=500,Pi="ac-dc-picker-width",Fi="ac-dc-picker-collapsed";class Lt extends V(L){constructor(){super(),this._pickerWidth=this._loadWidth(),this._pickerCollapsed=this._loadCollapsed(),this._selectedFiles=[],this._messages=[],this._streamingActive=!1,this._isDragging=!1,this._reviewState={active:!1},this._showReviewSelector=!1}connectedCallback(){super.connectedCallback(),window.addEventListener("state-loaded",e=>this._onStateLoaded(e)),window.addEventListener("files-changed",e=>this._onFilesChanged(e))}onRpcReady(){Promise.resolve().then(()=>this._loadReviewState())}async _loadReviewState(){try{const e=await this.rpcExtract("LLMService.get_review_state");e&&(this._reviewState=e)}catch(e){console.warn("Failed to load review state:",e)}}async _openReviewSelector(){var t;await Ee(()=>import("./review-selector-Brfqlu8V.js"),__vite__mapDeps([0,1,2,3,4])),this._showReviewSelector=!0,await this.updateComplete;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-review-selector");e&&e.show()}_onReviewSelectorClose(){this._showReviewSelector=!1}async _onReviewStarted(e){var s,n;this._reviewState={active:!0,...e.detail},this._selectedFiles=[];const t=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-file-picker");t&&(t.selectedFiles=new Set,t.requestUpdate()),t&&await t.loadTree();const i=(n=this.shadowRoot)==null?void 0:n.querySelector("ac-chat-panel");i&&(i.selectedFiles=[],i.reviewState=this._reviewState,i.requestUpdate())}async _exitReview(){var e,t;try{const i=await this.rpcExtract("LLMService.end_review");if(i!=null&&i.error){console.error("Exit review failed:",i.error),this.showToast(`Exit review failed: ${i.error}`,"error");return}this._reviewState={active:!1};const s=(e=this.shadowRoot)==null?void 0:e.querySelector("ac-file-picker");s&&await s.loadTree();const n=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-chat-panel");n&&(n.reviewState=this._reviewState,n.requestUpdate()),window.dispatchEvent(new CustomEvent("review-ended"))}catch(i){console.error("Exit review failed:",i),this.showToast(`Exit review failed: ${i.message||"Unknown error"}`,"error")}}_onFilesChanged(e){var i;const t=(i=e.detail)==null?void 0:i.selectedFiles;Array.isArray(t)&&(this._syncMessagesFromChat(),this._selectedFiles=t)}_onSelectionChanged(e){var s,n;const t=((s=e.detail)==null?void 0:s.selectedFiles)||[];this._syncMessagesFromChat(),this._selectedFiles=t,this.rpcConnected&&this.rpcCall("LLMService.set_selected_files",t).catch(()=>{});const i=(n=this.shadowRoot)==null?void 0:n.querySelector("ac-chat-panel");i&&(i.selectedFiles=t,i.requestUpdate())}_onFileClicked(e){var i;const t=(i=e.detail)==null?void 0:i.path;t&&window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:t}}))}_syncMessagesFromChat(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-chat-panel");e&&(this._messages=e.messages)}_onInsertPath(e){var s,n,o;const t=(s=e.detail)==null?void 0:s.path;if(!t)return;const i=(n=this.shadowRoot)==null?void 0:n.querySelector("ac-chat-panel");if(i){const a=(o=i.shadowRoot)==null?void 0:o.querySelector(".input-textarea");if(a){const l=a.selectionStart,c=a.value.slice(0,l),h=a.value.slice(a.selectionEnd),d=!c.endsWith(" ")&&c.length>0?" ":"",p=h.startsWith(" ")?"":" ";a.value=c+d+t+p+h,a.dispatchEvent(new Event("input",{bubbles:!0}));const _=l+d.length+t.length+p.length;a.setSelectionRange(_,_),i._suppressNextPaste=!0,a.focus()}}}_onFilterFromChat(e){var s,n;const t=((s=e.detail)==null?void 0:s.filter)||"",i=(n=this.shadowRoot)==null?void 0:n.querySelector("ac-file-picker");i&&i.setFilter(t)}_onFileMentionClick(e){var l,c,h,d,p;const t=(l=e.detail)==null?void 0:l.path;if(!t)return;this._syncMessagesFromChat();const i=((c=e.detail)==null?void 0:c.navigate)!==!1;let s;if(this._selectedFiles.includes(t))s=this._selectedFiles.filter(_=>_!==t);else{s=[...this._selectedFiles,t];const _=(h=this.shadowRoot)==null?void 0:h.querySelector("ac-chat-panel");_&&_.accumulateFileInInput(t)}this._selectedFiles=s;const o=(d=this.shadowRoot)==null?void 0:d.querySelector("ac-file-picker");o&&(o.selectedFiles=new Set(s),o.requestUpdate());const a=(p=this.shadowRoot)==null?void 0:p.querySelector("ac-chat-panel");a&&(a.selectedFiles=s,a.requestUpdate()),this.rpcConnected&&this.rpcCall("LLMService.set_selected_files",s).catch(()=>{}),i&&window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:t}}))}_onFilesModified(e){var i;const t=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-file-picker");t&&t.loadTree(),window.dispatchEvent(new CustomEvent("files-modified",{detail:e.detail}))}_onStateLoaded(e){const t=e.detail;t&&(this._messages=t.messages||[],this._selectedFiles=t.selected_files||[],this._streamingActive=t.streaming_active||!1,requestAnimationFrame(()=>{var s;const i=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-file-picker");i&&this._selectedFiles.length>0&&(i.selectedFiles=new Set(this._selectedFiles))}))}_loadWidth(){try{const e=localStorage.getItem(Pi);return e?Math.max(Ii,Math.min(Di,parseInt(e))):zi}catch{return zi}}_loadCollapsed(){try{return localStorage.getItem(Fi)==="true"}catch{return!1}}_saveWidth(e){try{localStorage.setItem(Pi,String(e))}catch{}}_saveCollapsed(e){try{localStorage.setItem(Fi,String(e))}catch{}}_onResizeStart(e){e.preventDefault(),this._isDragging=!0;const t=e.clientX,i=this._pickerWidth,s=o=>{const a=o.clientX-t,l=Math.max(Ii,Math.min(Di,i+a));this._pickerWidth=l},n=()=>{this._isDragging=!1,this._saveWidth(this._pickerWidth),window.removeEventListener("mousemove",s),window.removeEventListener("mouseup",n)};window.addEventListener("mousemove",s),window.addEventListener("mouseup",n)}_toggleCollapse(){this._pickerCollapsed=!this._pickerCollapsed,this._saveCollapsed(this._pickerCollapsed)}render(){return m`
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

      ${this._showReviewSelector?m`
        <ac-review-selector
          @review-started=${this._onReviewStarted}
          @review-selector-close=${this._onReviewSelectorClose}
        ></ac-review-selector>
      `:v}
    `}}C(Lt,"properties",{_pickerWidth:{type:Number,state:!0},_pickerCollapsed:{type:Boolean,state:!0},_selectedFiles:{type:Array,state:!0},_messages:{type:Array,state:!0},_streamingActive:{type:Boolean,state:!0},_reviewState:{type:Object,state:!0},_showReviewSelector:{type:Boolean,state:!0}}),C(Lt,"styles",[F,j,z`
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

  `]);customElements.define("ac-files-tab",Lt);const Oi={search:()=>Ee(()=>import("./ac-search-tab-B5jORBJK.js"),__vite__mapDeps([5,1,2,3,4])),context:()=>Ee(()=>import("./ac-context-tab-CfSaLJGV.js"),__vite__mapDeps([6,1,2,3,4])),cache:()=>Ee(()=>import("./ac-cache-tab-BamMAK8v.js"),__vite__mapDeps([7,1,2,3,4])),settings:()=>Ee(()=>import("./ac-settings-tab-BPeNWfF3.js"),__vite__mapDeps([8,1,2,3,4]))},Ze=[{id:"files",icon:"📁",label:"Files",shortcut:"Alt+1"},{id:"search",icon:"🔍",label:"Search",shortcut:"Alt+2"},{id:"context",icon:"📊",label:"Context",shortcut:"Alt+3"},{id:"cache",icon:"🗄️",label:"Cache",shortcut:"Alt+4"},{id:"settings",icon:"⚙️",label:"Settings",shortcut:"Alt+5"}];class zt extends V(L){constructor(){super(),this.activeTab="files",this.minimized=this._loadBoolPref("ac-dc-minimized",!1),this._historyPercent=0,this._reviewActive=!1,this._mode="code",this._modeSwitching=!1,this._modeSwitchMessage="",this._modeSwitchPercent=0,this._docIndexReady=!1,this._docIndexBuilding=!1,this._crossRefReady=!1,this._crossRefEnabled=!1,this._enrichingDocs=!1,this._repoName=null,this._visitedTabs=new Set(["files"]),this._onKeyDown=this._onKeyDown.bind(this),this._undocked=!1}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._onKeyDown),this._onStateLoaded=this._onStateLoaded.bind(this),window.addEventListener("state-loaded",this._onStateLoaded),this._restoreDialogWidth(),this._restoreDialogPosition()}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._onKeyDown),window.removeEventListener("state-loaded",this._onStateLoaded)}_onStateLoaded(e){const t=e.detail;t!=null&&t.repo_name&&!this._repoName&&(this._repoName=t.repo_name,this._migrateModeKey()),t&&(typeof t.cross_ref_ready=="boolean"&&(this._crossRefReady=t.cross_ref_ready),typeof t.cross_ref_enabled=="boolean"&&(this._crossRefEnabled=t.cross_ref_enabled))}_migrateModeKey(){const e=this._modeKey();if(this._loadPref(e,null))return;const i=this._loadPref("ac-dc-mode",null);i&&this._savePref(e,i)}onRpcReady(){this._refreshHistoryBar(),this._refreshReviewState(),this._refreshMode();const e=this._loadPref("ac-dc-active-tab","files");e!==this.activeTab&&this._switchTab(e),this._dialogEventsRegistered||(this._dialogEventsRegistered=!0,window.addEventListener("stream-complete",()=>{this._refreshHistoryBar(),this._refreshMode()}),window.addEventListener("compaction-event",()=>this._refreshHistoryBar()),window.addEventListener("state-loaded",()=>{this._refreshHistoryBar(),this._refreshMode()}),window.addEventListener("session-loaded",()=>this._refreshHistoryBar()),window.addEventListener("review-started",()=>{this._reviewActive=!0}),window.addEventListener("review-ended",()=>{this._reviewActive=!1}),window.addEventListener("mode-switch-progress",t=>{if(this._docIndexReady)return;const{message:i,percent:s}=t.detail||{};typeof s=="number"&&s>=100||(this._docIndexBuilding=!0,this._modeSwitching=!0,i!==void 0&&(this._modeSwitchMessage=i),typeof s=="number"&&(this._modeSwitchPercent=s))}),window.addEventListener("compaction-event",t=>{var s;const i=(s=t.detail)==null?void 0:s.event;if(i)if(i.stage==="doc_index_ready")this._docIndexReady=!0,this._docIndexBuilding=!1,this._modeSwitching=!1,this._modeSwitchMessage="",this._modeSwitchPercent=0,this._mode==="code"&&(this._crossRefReady=!0),this.requestUpdate(),this._refreshMode(),D(i.message||"📝 Document index ready","info");else if(i.stage==="doc_index_failed")this._docIndexBuilding=!1,this._modeSwitching=!1,this._modeSwitchMessage="",this._modeSwitchPercent=0,this.requestUpdate(),D(i.message||"Document index build failed","error");else if(i.stage==="doc_index_progress"){if(this._docIndexReady){this._enrichingDocs=!0,i.message&&(this._modeSwitchMessage=i.message),typeof i.percent=="number"&&(this._modeSwitchPercent=i.percent),this._docIndexBuilding=!1;return}this._docIndexBuilding=!0,this._modeSwitching=!0,i.message&&(this._modeSwitchMessage=i.message),typeof i.percent=="number"&&(this._modeSwitchPercent=i.percent)}else i.stage==="doc_enrichment_queued"?(this._enrichingDocs=!0,this.requestUpdate()):i.stage==="doc_enrichment_file_done"?this.requestUpdate():i.stage==="doc_enrichment_complete"&&(this._enrichingDocs=!1,this._modeSwitchMessage="",this._modeSwitchPercent=0,this.requestUpdate())}))}async _refreshReviewState(){try{const e=await this.rpcExtract("LLMService.get_review_state");e&&(this._reviewActive=!!e.active)}catch{}}_onReviewClick(){this._switchTab("files"),this.updateComplete.then(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-files-tab");e&&(this._reviewActive?e._exitReview():e._openReviewSelector())})}_modeKey(){return this._repoName?`ac-dc-mode:${this._repoName}`:"ac-dc-mode"}async _refreshMode(){if(this._modeSwitchInFlight)return;try{const t=await this.rpcExtract("LLMService.get_mode");if(this._modeSwitchInFlight)return;t&&(t.mode&&(this._mode=t.mode),this._docIndexReady=!!t.doc_index_ready,this._docIndexBuilding=!!t.doc_index_building,this._crossRefReady=!!t.cross_ref_ready,this._crossRefEnabled=!!t.cross_ref_enabled,this._docIndexReady&&(this._modeSwitching=!1,this._modeSwitchMessage="",this._modeSwitchPercent=0,this._docIndexBuilding=!1))}catch{}if(this._modeSwitchInFlight)return;const e=this._loadPref(this._modeKey(),null);e&&e!==this._mode&&this._docIndexReady&&await this._switchMode(e)}async _switchMode(e){if(e!==this._mode&&!this._modeSwitchInFlight){console.log("[ac-dialog] switching mode to",e,"from",this._mode),this._modeSwitchInFlight=!0;try{const t=await this.rpcExtract("LLMService.switch_mode",e);if(console.log("[ac-dialog] switch_mode result:",t),!t)return;if(t.building){D("Document index is still building — please wait…","info");return}if(t.error){D(t.error,"error");return}this._mode=t.mode||e,this._crossRefEnabled=!1,this._savePref(this._modeKey(),this._mode),window.dispatchEvent(new CustomEvent("mode-changed",{detail:{mode:this._mode}})),t.keywords_available===!1&&D(t.keywords_message||"Keyword enrichment unavailable — headings shown without keywords. Install with: pip install keybert sentence-transformers","warning")}catch(t){D(`Mode switch failed: ${t.message||t}`,"error")}finally{this._modeSwitchInFlight=!1}}}_onModeToggle(){const e=this._mode==="code"?"doc":"code";this._switchMode(e)}async _onCrossRefToggle(){const e=!this._crossRefEnabled;try{const t=await this.rpcExtract("LLMService.set_cross_reference",e);if(!t)return;if(t.status==="not_ready"){D(t.message||"Cross-reference index is not ready yet.","warning");return}if(t.error){D(t.error,"error");return}this._crossRefEnabled=!!t.cross_ref_enabled,this._crossRefEnabled?D(t.message||"Cross-reference enabled — additional tokens will be used.","info"):D(t.message||"Cross-reference disabled.","info"),window.dispatchEvent(new CustomEvent("mode-changed",{detail:{mode:this._mode,crossRefEnabled:this._crossRefEnabled}}))}catch(t){D(`Cross-reference toggle failed: ${t.message||t}`,"error")}}async _refreshHistoryBar(){try{const e=await this.rpcExtract("LLMService.get_history_status");e&&typeof e.percent=="number"&&(this._historyPercent=e.percent)}catch{}}_onKeyDown(e){var t,i;if(e.altKey&&e.key>="1"&&e.key<="5"){e.preventDefault();const s=parseInt(e.key)-1;Ze[s]&&this._switchTab(Ze[s].id);return}if(e.altKey&&(e.key==="m"||e.key==="M")){e.preventDefault(),this._toggleMinimize();return}if(e.ctrlKey&&e.shiftKey&&(e.key==="f"||e.key==="F")){e.preventDefault();const s=((i=(t=window.getSelection())==null?void 0:t.toString())==null?void 0:i.trim())||"";this._switchTab("search"),s&&!s.includes(`
`)&&this.updateComplete.then(()=>{var o;const n=(o=this.shadowRoot)==null?void 0:o.querySelector("ac-search-tab");n&&n.prefill(s)});return}}_switchTab(e){this.activeTab=e,this._savePref("ac-dc-active-tab",e),this._visitedTabs.add(e),this.minimized&&(this.minimized=!1),Oi[e]&&Oi[e](),this.updateComplete.then(()=>{var i,s;const t=(i=this.shadowRoot)==null?void 0:i.querySelector(".tab-panel.active");if(t){const n=t.firstElementChild;n&&typeof n.onTabVisible=="function"&&n.onTabVisible()}if(e==="search"){const n=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-search-tab");n&&n.focus()}})}_toggleMinimize(){this.minimized=!this.minimized,this._saveBoolPref("ac-dc-minimized",this.minimized)}_getHistoryBarColor(){return this._historyPercent>90?"red":this._historyPercent>75?"orange":"green"}_getContainer(){return this.parentElement}_onResizeStart(e){e.preventDefault(),e.stopPropagation(),this._isResizing=!0;const t=this._getContainer();if(!t)return;const i=e.clientX,s=t.offsetWidth,n=a=>{const l=a.clientX-i,c=Math.max(300,s+l);t.style.width=`${c}px`},o=()=>{this._isResizing=!1,this._savePref("ac-dc-dialog-width",String(t.offsetWidth)),window.removeEventListener("mousemove",n),window.removeEventListener("mouseup",o)};window.addEventListener("mousemove",n),window.addEventListener("mouseup",o)}_onResizeBottomStart(e){e.preventDefault(),e.stopPropagation();const t=this._getContainer();if(!t)return;this._undocked||this._undock(t);const i=e.clientY,s=t.offsetHeight,n=a=>{const l=a.clientY-i,c=Math.max(200,s+l);t.style.height=`${c}px`},o=()=>{this._persistPosition(t),window.removeEventListener("mousemove",n),window.removeEventListener("mouseup",o)};window.addEventListener("mousemove",n),window.addEventListener("mouseup",o)}_onResizeCornerStart(e){e.preventDefault(),e.stopPropagation();const t=this._getContainer();if(!t)return;this._undocked||this._undock(t);const i=e.clientX,s=e.clientY,n=t.offsetWidth,o=t.offsetHeight,a=c=>{const h=c.clientX-i,d=c.clientY-s;t.style.width=`${Math.max(300,n+h)}px`,t.style.height=`${Math.max(200,o+d)}px`},l=()=>{this._persistPosition(t),window.removeEventListener("mousemove",a),window.removeEventListener("mouseup",l)};window.addEventListener("mousemove",a),window.addEventListener("mouseup",l)}_undock(e){const t=e.getBoundingClientRect();this._undocked=!0,e.style.position="fixed",e.style.top=`${t.top}px`,e.style.left=`${t.left}px`,e.style.width=`${t.width}px`,e.style.height=`${t.height}px`,e.style.right="auto",e.style.bottom="auto"}_persistPosition(e){const t=e.getBoundingClientRect();this._savePref("ac-dc-dialog-pos",JSON.stringify({left:t.left,top:t.top,width:t.width,height:t.height}))}_onHeaderMouseDown(e){if(e.button!==0)return;e.preventDefault();const t=this._getContainer();if(!t)return;const i=e.clientX,s=e.clientY,n=t.getBoundingClientRect(),o=n.left,a=n.top;n.width,n.height;let l=!1;const c=d=>{const p=d.clientX-i,_=d.clientY-s;if(!l){if(Math.abs(p)<5&&Math.abs(_)<5)return;l=!0,this._undocked||this._undock(t)}const g=Math.max(0,o+p),y=Math.max(0,a+_);t.style.left=`${g}px`,t.style.top=`${y}px`},h=()=>{window.removeEventListener("mousemove",c),window.removeEventListener("mouseup",h),l?this._undocked&&this._persistPosition(t):this._toggleMinimize()};window.addEventListener("mousemove",c),window.addEventListener("mouseup",h)}_savePref(e,t){try{localStorage.setItem(e,t)}catch{}}_loadPref(e,t){try{const i=localStorage.getItem(e);return i!==null?i:t}catch{return t}}_saveBoolPref(e,t){this._savePref(e,String(t))}_loadBoolPref(e,t){try{const i=localStorage.getItem(e);return i===null?t:i==="true"}catch{return t}}_restoreDialogWidth(){const e=this._loadPref("ac-dc-dialog-width",null);if(!e)return;const t=parseInt(e);if(isNaN(t)||t<300)return;const i=this._getContainer();i&&(i.style.width=`${Math.min(t,window.innerWidth-50)}px`)}_restoreDialogPosition(){const e=this._loadPref("ac-dc-dialog-pos",null);if(e)try{const t=JSON.parse(e);if(!t||typeof t.left!="number")return;const i=window.innerWidth,s=window.innerHeight,n=Math.min(t.width||400,i-20),o=Math.min(t.height||s,s-20),a=Math.max(0,Math.min(t.left,i-100)),l=Math.max(0,Math.min(t.top,s-100)),c=this._getContainer();if(!c)return;this._undocked=!0,c.style.position="fixed",c.style.left=`${a}px`,c.style.top=`${l}px`,c.style.width=`${n}px`,c.style.height=`${o}px`,c.style.right="auto",c.style.bottom="auto"}catch{}}render(){const e=Ze.find(t=>t.id===this.activeTab);return m`
      <div class="header" @mousedown=${this._onHeaderMouseDown}>
        <span class="header-label">${(e==null?void 0:e.label)||"Files"}</span>

        <div class="tab-buttons" role="tablist" aria-label="Tool tabs">
          ${Ze.map(t=>m`
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

        ${this._modeSwitching&&!this._docIndexReady?m`
          <div class="header-progress">
            <span class="header-progress-label">${this._modeSwitchMessage||"Building…"}</span>
            <div class="header-progress-bar">
              <div class="header-progress-fill" style="width: ${this._modeSwitchPercent}%"></div>
            </div>
          </div>
        `:this._enrichingDocs&&this._modeSwitchMessage?m`
          <div class="header-progress">
            <span class="header-progress-label">${this._modeSwitchMessage}</span>
            <div class="header-progress-bar">
              <div class="header-progress-fill" style="width: ${this._modeSwitchPercent}%"></div>
            </div>
          </div>
        `:""}

        <div class="header-actions">
          <label class="header-action" style="display: flex; align-items: center; gap: 3px; font-size: 0.72rem; cursor: pointer;"
            title="${this._crossRefEnabled?"Disable cross-reference index":"Enable cross-reference index"}"
            @mousedown=${t=>t.stopPropagation()}>
            <input type="checkbox"
              .checked=${this._crossRefEnabled}
              @change=${()=>this._onCrossRefToggle()}
              style="margin: 0; cursor: pointer;">
            <span style="color: var(--text-muted); white-space: nowrap;">
              ${this._mode==="code"?"+doc index":"+code symbols"}
            </span>
          </label>
          <button class="header-action ${this._mode==="doc"?"review-active":""} ${this._docIndexBuilding?"building":""}"
            title="${this._docIndexBuilding?"Document index building…":this._mode==="doc"?"Switch to Code mode":"Switch to Document mode"}"
            aria-label="${this._mode==="code"?"Switch to document mode":"Switch to code mode"}"
            ?disabled=${this._docIndexBuilding}
            @mousedown=${t=>t.stopPropagation()}
            @click=${()=>this._onModeToggle()}>
            ${this._docIndexBuilding?"⏳":this._mode==="doc"?"📝":"💻"}
          </button>
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
        ${this._visitedTabs.has("search")?m`
          <div class="tab-panel ${this.activeTab==="search"?"active":""}"
               role="tabpanel" id="panel-search" aria-labelledby="tab-search">
            <ac-search-tab></ac-search-tab>
          </div>
        `:""}

        ${this._visitedTabs.has("context")?m`
          <div class="tab-panel ${this.activeTab==="context"?"active":""}"
               role="tabpanel" id="panel-context" aria-labelledby="tab-context">
            <ac-context-tab></ac-context-tab>
          </div>
        `:""}

        ${this._visitedTabs.has("cache")?m`
          <div class="tab-panel ${this.activeTab==="cache"?"active":""}"
               role="tabpanel" id="panel-cache" aria-labelledby="tab-cache">
            <ac-cache-tab></ac-cache-tab>
          </div>
        `:""}

        ${this._visitedTabs.has("settings")?m`
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
    `}}C(zt,"properties",{activeTab:{type:String,state:!0},minimized:{type:Boolean,reflect:!0},_historyPercent:{type:Number,state:!0},_reviewActive:{type:Boolean,state:!0},_mode:{type:String,state:!0},_modeSwitching:{type:Boolean,state:!0},_modeSwitchMessage:{type:String,state:!0},_modeSwitchPercent:{type:Number,state:!0},_docIndexReady:{type:Boolean,state:!0},_docIndexBuilding:{type:Boolean,state:!0},_crossRefReady:{type:Boolean,state:!0},_crossRefEnabled:{type:Boolean,state:!0},_enrichingDocs:{type:Boolean,state:!0},_repoName:{type:String,state:!0}}),C(zt,"styles",[F,j,z`
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
      flex-shrink: 0;
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
    .header-action.building {
      opacity: 0.6;
      animation: pulse-building 1.5s ease-in-out infinite;
      cursor: wait;
    }
    .header-action:disabled {
      pointer-events: none;
    }
    @keyframes pulse-building {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 0.9; }
    }

    /* Header-inline progress bar (visible even when minimized) */
    .header-progress {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-right: 8px;
      flex-shrink: 10;
      min-width: 0;
      max-width: 240px;
      overflow: hidden;
    }
    .header-progress-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 180px;
    }
    .header-progress-bar {
      width: 60px;
      min-width: 40px;
      height: 4px;
      background: var(--bg-secondary);
      border-radius: 2px;
      overflow: hidden;
    }
    .header-progress-fill {
      height: 100%;
      background: var(--accent-primary);
      border-radius: 2px;
      transition: width 0.4s ease;
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

    /* Mode switch overlay */
    .mode-switch-overlay {
      position: absolute;
      inset: 0;
      z-index: 50;
      background: var(--bg-secondary);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      opacity: 0.95;
    }
    .mode-switch-overlay .mode-switch-msg {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    .mode-switch-overlay .mode-switch-bar {
      width: 200px;
      height: 4px;
      background: var(--bg-tertiary);
      border-radius: 2px;
      overflow: hidden;
    }
    .mode-switch-overlay .mode-switch-fill {
      height: 100%;
      background: var(--accent-primary);
      border-radius: 2px;
      transition: width 0.4s ease;
    }

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
  `]);customElements.define("ac-dialog",zt);self.MonacoEnvironment={getWorker(r,e){if(e==="editorWorkerService")return new Worker(new URL("/AI-Coder-DeCoder/3889f038/assets/editor.worker-DX6ApQqM.js",import.meta.url),{type:"module"});const t=new Blob(["self.onmessage = function() {}"],{type:"application/javascript"});return new Worker(URL.createObjectURL(t))}};const Fn={".js":"javascript",".mjs":"javascript",".jsx":"javascript",".ts":"typescript",".tsx":"typescript",".py":"python",".json":"json",".yaml":"yaml",".yml":"yaml",".html":"html",".htm":"html",".css":"css",".scss":"scss",".less":"less",".md":"markdown",".markdown":"markdown",".c":"c",".h":"c",".cpp":"cpp",".cc":"cpp",".cxx":"cpp",".hpp":"cpp",".hxx":"cpp",".sh":"shell",".bash":"shell",".xml":"xml",".svg":"xml",".java":"java",".rs":"rust",".go":"go",".rb":"ruby",".php":"php",".sql":"sql",".toml":"ini",".ini":"ini",".cfg":"ini"};function On(r){if(!r)return"plaintext";const e=r.lastIndexOf(".");if(e===-1)return"plaintext";const t=r.slice(e).toLowerCase();return Fn[t]||"plaintext"}function qi(r){if(!r)return[];const e=r.querySelectorAll("[data-source-line]"),t=[];for(const i of e){const s=parseInt(i.getAttribute("data-source-line"),10);isNaN(s)||t.push({line:s,offsetTop:i.offsetTop})}return t.sort((i,s)=>i.line-s.line),t}class It extends V(L){constructor(){super(),this._files=[],this._activeIndex=-1,this._dirtySet=new Set,this._previewMode=!1,this._previewContent="",this._editor=null,this._editorContainer=null,this._resizeObserver=null,this._styleObserver=null,this._monacoStylesInjected=!1,this._highlightTimer=null,this._highlightDecorations=[],this._lspRegistered=!1,this._virtualContents={},this._scrollLock=null,this._scrollLockTimer=null,this._editorScrollDisposable=null,this._onKeyDown=this._onKeyDown.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._onKeyDown)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._onKeyDown),this._disposeEditor(),this._resizeObserver&&(this._resizeObserver.disconnect(),this._resizeObserver=null),this._styleObserver&&(this._styleObserver.disconnect(),this._styleObserver=null),this._scrollLockTimer&&(clearTimeout(this._scrollLockTimer),this._scrollLockTimer=null)}firstUpdated(){this._editorContainer=this.shadowRoot.querySelector(".editor-pane")||this.shadowRoot.querySelector(".editor-container"),this._editorContainer&&(this._resizeObserver=new ResizeObserver(()=>{this._editor&&this._editor.layout()}),this._resizeObserver.observe(this._editorContainer))}onRpcReady(){this._registerLspProviders()}async openFile(e){const{path:t,searchText:i,line:s}=e;if(!t)return;e.virtualContent!=null&&(this._virtualContents[t]=e.virtualContent);const n=this._files.findIndex(d=>d.path===t);if(n!==-1){this._activeIndex=n,await this.updateComplete,this._showEditor(),s!=null?this._scrollToLine(s):i&&this._scrollToSearchText(i),this._dispatchActiveFileChanged(t);return}let o=e.original??"",a=e.modified??"",l=e.is_new??!1,c=e.is_read_only??!1;if(e.virtualContent!=null)o="",a=e.virtualContent,l=!0,c=e.readOnly??!0;else if(!e.original&&!e.modified){const d=await this._fetchFileContent(t);if(d===null)return;o=d.original,a=d.modified,l=d.is_new,c=d.is_read_only??!1}const h={path:t,original:o,modified:a,is_new:l,is_read_only:c??!1,is_config:e.is_config??!1,config_type:e.config_type??null,real_path:e.real_path??null,savedContent:a};this._files=[...this._files,h],this._activeIndex=this._files.length-1,await this.updateComplete,this._showEditor(),s!=null?this._scrollToLine(s):i&&this._scrollToSearchText(i),this._dispatchActiveFileChanged(t)}async refreshOpenFiles(){const e=[];let t=!1;const i=this.getViewportState();for(const s of this._files){if(s.is_config){e.push(s);continue}const n=await this._fetchFileContent(s.path);if(n===null){e.push(s);continue}const o={...s,original:n.original,modified:n.modified,is_new:n.is_new,savedContent:n.modified};e.push(o),t=!0}t&&(this._files=e,this._dirtySet=new Set,await this.updateComplete,this._showEditor(),i&&this.restoreViewportState(i))}closeFile(e){delete this._virtualContents[e];const t=this._files.findIndex(i=>i.path===e);t!==-1&&(this._dirtySet.delete(e),this._files=this._files.filter(i=>i.path!==e),this._files.length===0?(this._activeIndex=-1,this._disposeEditor(),this._dispatchActiveFileChanged(null)):this._activeIndex>=this._files.length?(this._activeIndex=this._files.length-1,this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)):t<=this._activeIndex&&(this._activeIndex=Math.max(0,this._activeIndex-1),this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)))}getDirtyFiles(){return[...this._dirtySet]}getViewportState(){if(!this._editor)return null;const e=this._editor.getModifiedEditor();if(!e)return null;const t=e.getPosition();return{scrollTop:e.getScrollTop(),scrollLeft:e.getScrollLeft(),lineNumber:(t==null?void 0:t.lineNumber)??1,column:(t==null?void 0:t.column)??1}}restoreViewportState(e){if(!e)return;const t=(i=0)=>{var o;const s=this._editor,n=(o=s==null?void 0:s.getModifiedEditor)==null?void 0:o.call(s);n?requestAnimationFrame(()=>{e.lineNumber&&(n.setPosition({lineNumber:e.lineNumber,column:e.column??1}),n.revealLineInCenter(e.lineNumber)),e.scrollTop!=null&&n.setScrollTop(e.scrollTop),e.scrollLeft!=null&&n.setScrollLeft(e.scrollLeft)}):i<20&&requestAnimationFrame(()=>t(i+1))};requestAnimationFrame(()=>t())}async _fetchFileContent(e){if(e.startsWith("virtual://"))return{original:"",modified:this._virtualContents[e]||"(no content)"};if(!this.rpcConnected)return null;try{let t="",i="",s=!1,n=!1;const o=await this.rpcExtract("Repo.get_file_content",e,"HEAD"),a=await this.rpcExtract("Repo.get_file_content",e);return o!=null&&o.error&&(a!=null&&a.error)?(console.warn("File not found:",e),null):(o!=null&&o.error?(s=!0,t="",i=(a==null?void 0:a.content)??a??""):a!=null&&a.error?(t=(o==null?void 0:o.content)??o??"",i="",n=!0):(t=(o==null?void 0:o.content)??o??"",i=(a==null?void 0:a.content)??a??""),{original:t,modified:i,is_new:s,is_read_only:n})}catch(t){return console.warn("Failed to fetch file content:",e,t),null}}_showEditor(){if(this._activeIndex<0||this._activeIndex>=this._files.length){this._disposeEditor();return}const e=this._files[this._activeIndex],t=this._editorContainer;if(!t)return;this._injectMonacoStyles();const i=On(e.path),s=!this._previewMode;if(this._editor){const n=this._editor.getModel();this._editor.updateOptions({renderSideBySide:s});const o=W.createModel(e.original,i),a=W.createModel(e.modified,i);this._editor.setModel({original:o,modified:a}),n&&(n.original&&n.original.dispose(),n.modified&&n.modified.dispose()),this._editor.getModifiedEditor().updateOptions({readOnly:e.is_read_only})}else{this._editor=W.createDiffEditor(t,{theme:"vs-dark",automaticLayout:!1,minimap:{enabled:!1},renderSideBySide:s,readOnly:!1,originalEditable:!1,scrollBeyondLastLine:!1,fontSize:13,lineNumbers:"on",glyphMargin:!1,folding:!0,wordWrap:this._previewMode?"on":"off",renderWhitespace:"selection",contextmenu:!0,links:!1,hover:{enabled:!0,above:!1,sticky:!0,delay:600},scrollbar:{verticalScrollbarSize:8,horizontalScrollbarSize:8}});const n=W.createModel(e.original,i),o=W.createModel(e.modified,i);this._editor.setModel({original:n,modified:o}),this._editor.getModifiedEditor().updateOptions({readOnly:e.is_read_only}),this._editor.getModifiedEditor().onDidChangeModelContent(()=>{this._checkDirty(),this._previewMode&&this._updatePreview()})}if(this._editorScrollDisposable&&(this._editorScrollDisposable.dispose(),this._editorScrollDisposable=null),this._previewMode){const n=this._editor.getModifiedEditor();this._editorScrollDisposable=n.onDidScrollChange(()=>{this._scrollLock!=="preview"&&(this._scrollLock="editor",clearTimeout(this._scrollLockTimer),this._scrollLockTimer=setTimeout(()=>{this._scrollLock=null},120),this._scrollPreviewToEditorLine())})}this._editor.layout(),this._previewMode&&this._updatePreview()}_disposeEditor(){if(this._editorScrollDisposable&&(this._editorScrollDisposable.dispose(),this._editorScrollDisposable=null),this._editor){const e=this._editor.getModel();this._editor.dispose(),this._editor=null,e&&(e.original&&e.original.dispose(),e.modified&&e.modified.dispose())}this._highlightDecorations=[]}_checkDirty(){var n,o;if(this._activeIndex<0||this._activeIndex>=this._files.length)return;const e=this._files[this._activeIndex],i=(((o=(n=this._editor)==null?void 0:n.getModifiedEditor())==null?void 0:o.getValue())??"")!==e.savedContent,s=new Set(this._dirtySet);i?s.add(e.path):s.delete(e.path),this._dirtySet=s}_injectMonacoStyles(){const e=this.shadowRoot;this._syncAllStyles(e),!this._monacoStylesInjected&&(this._monacoStylesInjected=!0,this._styleObserver=new MutationObserver(t=>{for(const i of t){for(const s of i.addedNodes)if(s.nodeName==="STYLE"||s.nodeName==="LINK"){const n=s.cloneNode(!0);n.setAttribute("data-monaco-injected","true"),e.appendChild(n)}for(const s of i.removedNodes)if(s.nodeName==="STYLE"||s.nodeName==="LINK"){const n=e.querySelectorAll("[data-monaco-injected]");for(const o of n)if(o.textContent===s.textContent){o.remove();break}}}}),this._styleObserver.observe(document.head,{childList:!0}))}_syncAllStyles(e){const t=e.querySelectorAll("[data-monaco-injected]");for(const s of t)s.remove();const i=document.head.querySelectorAll('style, link[rel="stylesheet"]');for(const s of i){const n=s.cloneNode(!0);n.setAttribute("data-monaco-injected","true"),e.appendChild(n)}}_onKeyDown(e){if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault(),this._saveActiveFile();return}if((e.ctrlKey||e.metaKey)&&e.key==="PageDown"){e.preventDefault(),this._files.length>1&&(this._activeIndex=(this._activeIndex+1)%this._files.length,this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}if((e.ctrlKey||e.metaKey)&&e.key==="PageUp"){e.preventDefault(),this._files.length>1&&(this._activeIndex=(this._activeIndex-1+this._files.length)%this._files.length,this._showEditor(),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}(e.ctrlKey||e.metaKey)&&e.key==="w"&&(e.preventDefault(),this._files.length>0&&this._activeIndex>=0&&this.closeFile(this._files[this._activeIndex].path))}_saveActiveFile(){var i,s;if(this._activeIndex<0||this._activeIndex>=this._files.length)return;const e=this._files[this._activeIndex];if(!this._dirtySet.has(e.path))return;const t=((s=(i=this._editor)==null?void 0:i.getModifiedEditor())==null?void 0:s.getValue())??"";this._doSave(e,t)}_saveFile(e){const t=this._files.findIndex(n=>n.path===e);if(t===-1)return;const i=this._files[t];let s;t===this._activeIndex&&this._editor?s=this._editor.getModifiedEditor().getValue():s=i.modified,this._doSave(i,s)}_doSave(e,t){const i=this._files.map(n=>n.path===e.path?{...n,modified:t,savedContent:t}:n);this._files=i;const s=new Set(this._dirtySet);s.delete(e.path),this._dirtySet=s,window.dispatchEvent(new CustomEvent("file-save",{detail:{path:e.path,content:t,isConfig:e.is_config,configType:e.config_type}}))}saveAll(){for(const e of this._dirtySet)this._saveFile(e)}_scrollToLine(e){if(!this._editor)return;const t=this._editor.getModifiedEditor();requestAnimationFrame(()=>{t.revealLineInCenter(e),t.setPosition({lineNumber:e,column:1}),t.focus()})}_scrollToSearchText(e){if(!this._editor||!e)return;const t=this._editor.getModifiedEditor(),i=t.getModel();if(!i)return;const s=e.split(`
`);for(let o=s.length;o>=1;o--){const a=s.slice(0,o).join(`
`).trim();if(!a)continue;const l=i.findNextMatch(a,{lineNumber:1,column:1},!1,!0,null,!1);if(l){requestAnimationFrame(()=>{t.revealLineInCenter(l.range.startLineNumber),t.setSelection(l.range),t.focus(),this._applyHighlight(t,l.range)});return}}const n=s.find(o=>o.trim());if(n){const o=i.findNextMatch(n.trim(),{lineNumber:1,column:1},!1,!0,null,!1);o&&requestAnimationFrame(()=>{t.revealLineInCenter(o.range.startLineNumber),t.setSelection(o.range),t.focus(),this._applyHighlight(t,o.range)})}}_applyHighlight(e,t){this._highlightTimer&&clearTimeout(this._highlightTimer),this._highlightDecorations=e.deltaDecorations(this._highlightDecorations,[{range:t,options:{isWholeLine:!0,className:"highlight-decoration",overviewRuler:{color:"#4fc3f7",position:W.OverviewRulerLane.Full}}}]),this._highlightTimer=setTimeout(()=>{this._highlightDecorations=e.deltaDecorations(this._highlightDecorations,[])},3e3)}_dispatchActiveFileChanged(e){window.dispatchEvent(new CustomEvent("active-file-changed",{detail:{path:e}}))}_registerLspProviders(){this._lspRegistered||(this._lspRegistered=!0,q.registerHoverProvider("*",{provideHover:async(e,t)=>{if(!this.rpcConnected)return null;const i=this._getFileForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLMService.lsp_get_hover",i.path,t.lineNumber,t.column);if(s!=null&&s.contents)return{contents:[{value:s.contents}],range:s.range?new He(s.range.start_line+1,s.range.start_col+1,s.range.end_line+1,s.range.end_col+1):void 0}}catch(s){console.error("[LSP hover] error:",s)}return null}}),q.registerDefinitionProvider("*",{provideDefinition:async(e,t)=>{if(!this.rpcConnected)return null;const i=this._getFileForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLMService.lsp_get_definition",i.path,t.lineNumber,t.column);if(s!=null&&s.file&&(s!=null&&s.range))return await this.openFile({path:s.file,line:s.range.start_line+1}),{uri:Gt.parse(`file:///${s.file}`),range:new He(s.range.start_line+1,s.range.start_col+1,s.range.end_line+1,s.range.end_col+1)}}catch{}return null}}),q.registerReferenceProvider("*",{provideReferences:async(e,t)=>{if(!this.rpcConnected)return null;const i=this._getFileForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLMService.lsp_get_references",i.path,t.lineNumber,t.column);if(Array.isArray(s))return s.map(n=>({uri:Gt.parse(`file:///${n.file}`),range:new He(n.range.start_line+1,n.range.start_col+1,n.range.end_line+1,n.range.end_col+1)}))}catch(s){console.error("[LSP references] error:",s)}return null}}),q.registerCompletionItemProvider("*",{triggerCharacters:["."],provideCompletionItems:async(e,t)=>{if(!this.rpcConnected)return{suggestions:[]};const i=this._getFileForModel(e);if(!i)return{suggestions:[]};const s=e.getWordUntilPosition(t),n=(s==null?void 0:s.word)||"";try{const o=await this.rpcExtract("LLMService.lsp_get_completions",i.path,t.lineNumber,t.column,n);if(Array.isArray(o)){const a=new He(t.lineNumber,s.startColumn,t.lineNumber,s.endColumn);return{suggestions:o.map(l=>({label:l.label,kind:this._mapCompletionKind(l.kind),detail:l.detail||"",insertText:l.label,range:a}))}}}catch{}return{suggestions:[]}}}))}_getFileForModel(e){return this._activeIndex>=0&&this._activeIndex<this._files.length?this._files[this._activeIndex]:null}_mapCompletionKind(e){return{class:q.CompletionItemKind.Class,function:q.CompletionItemKind.Function,method:q.CompletionItemKind.Method,variable:q.CompletionItemKind.Variable,property:q.CompletionItemKind.Property,import:q.CompletionItemKind.Module}[e]||q.CompletionItemKind.Text}_isMarkdownFile(e){if(!e)return!1;const t=e.slice(e.lastIndexOf(".")).toLowerCase();return t===".md"||t===".markdown"}_togglePreview(){this._previewMode=!this._previewMode,this._previewMode&&this._updatePreview(),this._disposeEditor(),this.updateComplete.then(()=>{this._editorContainer=this.shadowRoot.querySelector(".editor-pane")||this.shadowRoot.querySelector(".editor-container"),this._editorContainer&&(this._resizeObserver&&this._resizeObserver.disconnect(),this._resizeObserver=new ResizeObserver(()=>{this._editor&&this._editor.layout()}),this._resizeObserver.observe(this._editorContainer)),this._showEditor()})}_updatePreview(){var e;if(this._editor){const t=((e=this._editor.getModifiedEditor())==null?void 0:e.getValue())??"";this._previewContent=Si(t)}else{const t=this._activeIndex>=0?this._files[this._activeIndex]:null;this._previewContent=t?Si(t.modified):""}this.requestUpdate()}_scrollPreviewToEditorLine(){var d;const e=(d=this.shadowRoot)==null?void 0:d.querySelector(".preview-pane");if(!e||!this._editor)return;const t=this._editor.getModifiedEditor(),i=t.getScrollTop(),s=t.getOption(W.EditorOption.lineHeight),n=Math.floor(i/s)+1,o=qi(e);if(o.length===0)return;let a=o[0];for(const p of o)if(p.line<=n)a=p;else break;const l=o.indexOf(a),c=o[l+1];let h=a.offsetTop;if(c&&c.line>a.line){const p=(n-a.line)/(c.line-a.line);h+=p*(c.offsetTop-a.offsetTop)}e.scrollTop=h}_scrollEditorToPreviewLine(){var h;if(!this._editor)return;const e=(h=this.shadowRoot)==null?void 0:h.querySelector(".preview-pane");if(!e||this._scrollLock==="editor")return;this._scrollLock="preview",clearTimeout(this._scrollLockTimer),this._scrollLockTimer=setTimeout(()=>{this._scrollLock=null},120);const t=e.scrollTop,i=qi(e);if(i.length===0)return;let s=i[0];for(const d of i)if(d.offsetTop<=t)s=d;else break;const n=i.indexOf(s),o=i[n+1];let a=s.line;if(o&&o.offsetTop>s.offsetTop){const d=(t-s.offsetTop)/(o.offsetTop-s.offsetTop);a+=d*(o.line-s.line)}const l=this._editor.getModifiedEditor(),c=l.getOption(W.EditorOption.lineHeight);l.setScrollTop((a-1)*c)}render(){const e=this._files.length>0,t=e&&this._activeIndex>=0?this._files[this._activeIndex]:null,i=t?this._dirtySet.has(t.path):!1,s=t&&this._isMarkdownFile(t.path);return this._previewMode&&t?m`
        <div class="split-container">
          <div class="editor-pane">
            ${this._renderOverlayButtons(t,i,s)}
          </div>
          <div class="preview-pane"
               @scroll=${()=>this._scrollEditorToPreviewLine()}>
            ${J(this._previewContent)}
          </div>
        </div>
      `:m`
      <div class="editor-container">
        ${this._renderOverlayButtons(t,i,s)}
        ${e?v:m`
          <div class="empty-state">
            <div class="watermark">AC⚡DC</div>
          </div>
        `}
      </div>
    `}_renderOverlayButtons(e,t,i){return e?m`
      ${i?m`
        <button
          class="preview-btn ${this._previewMode?"active":""}"
          title="Toggle Markdown preview"
          @click=${()=>this._togglePreview()}
        >
          <span class="preview-icon"></span>
          Preview
        </button>
      `:v}
      <button
        class="status-led ${t?"dirty":e.is_new?"new-file":"clean"}"
        title="${e.path}${t?" — unsaved (Ctrl+S to save)":e.is_new?" — new file":""}"
        aria-label="${e.path}${t?", unsaved changes, press to save":e.is_new?", new file":", no changes"}"
        @click=${()=>t?this._saveActiveFile():null}
      ></button>
    `:v}}C(It,"properties",{_files:{type:Array,state:!0},_activeIndex:{type:Number,state:!0},_dirtySet:{type:Object,state:!0},_previewMode:{type:Boolean,state:!0}}),C(It,"styles",[F,j,z`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      height: 100dvh;
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
      padding-left: 50%;
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
  `]);customElements.define("ac-diff-viewer",It);var qn=function(){var r="",e,t,i,s=[],n={passive:!0},o={passive:!1};window.addEventListener?(e="addEventListener",t="removeEventListener"):(e="attachEvent",t="detachEvent",r="on"),i="onwheel"in document.createElement("div")?"wheel":document.onmousewheel!==void 0?"mousewheel":"DOMMouseScroll";function a(g,y){var u=function(f){!f&&(f=window.event);var b={originalEvent:f,target:f.target||f.srcElement,type:"wheel",deltaMode:f.type=="MozMousePixelScroll"?0:1,deltaX:0,delatZ:0,preventDefault:function(){f.preventDefault?f.preventDefault():f.returnValue=!1}};return i=="mousewheel"?(b.deltaY=-.025*f.wheelDelta,f.wheelDeltaX&&(b.deltaX=-.025*f.wheelDeltaX)):b.deltaY=f.detail,y(b)};return s.push({element:g,fn:u}),u}function l(g){for(var y=0;y<s.length;y++)if(s[y].element===g)return s[y].fn;return function(){}}function c(g){for(var y=0;y<s.length;y++)if(s[y].element===g)return s.splice(y,1)}function h(g,y,u,f){var b;i==="wheel"?b=u:b=a(g,u),g[e](r+y,b,f?n:o)}function d(g,y,u,f){var b;i==="wheel"?b=u:b=l(g),g[t](r+y,b,f?n:o),c(g)}function p(g,y,u){h(g,i,y,u),i=="DOMMouseScroll"&&h(g,"MozMousePixelScroll",y,u)}function _(g,y,u){d(g,i,y,u),i=="DOMMouseScroll"&&d(g,"MozMousePixelScroll",y,u)}return{on:p,off:_}}(),Wt={extend:function(r,e){r=r||{};for(var t in e)this.isObject(e[t])?r[t]=this.extend(r[t],e[t]):r[t]=e[t];return r},isElement:function(r){return r instanceof HTMLElement||r instanceof SVGElement||r instanceof SVGSVGElement||r&&typeof r=="object"&&r!==null&&r.nodeType===1&&typeof r.nodeName=="string"},isObject:function(r){return Object.prototype.toString.call(r)==="[object Object]"},isNumber:function(r){return!isNaN(parseFloat(r))&&isFinite(r)},getSvg:function(r){var e,t;if(this.isElement(r))e=r;else if(typeof r=="string"||r instanceof String){if(e=document.querySelector(r),!e)throw new Error("Provided selector did not find any elements. Selector: "+r)}else throw new Error("Provided selector is not an HTML object nor String");if(e.tagName.toLowerCase()==="svg")t=e;else if(e.tagName.toLowerCase()==="object")t=e.contentDocument.documentElement;else if(e.tagName.toLowerCase()==="embed")t=e.getSVGDocument().documentElement;else throw e.tagName.toLowerCase()==="img"?new Error('Cannot script an SVG in an "img" element. Please use an "object" element or an in-line SVG.'):new Error("Cannot get SVG.");return t},proxy:function(r,e){return function(){return r.apply(e,arguments)}},getType:function(r){return Object.prototype.toString.apply(r).replace(/^\[object\s/,"").replace(/\]$/,"")},mouseAndTouchNormalize:function(r,e){if(r.clientX===void 0||r.clientX===null)if(r.clientX=0,r.clientY=0,r.touches!==void 0&&r.touches.length){if(r.touches[0].clientX!==void 0)r.clientX=r.touches[0].clientX,r.clientY=r.touches[0].clientY;else if(r.touches[0].pageX!==void 0){var t=e.getBoundingClientRect();r.clientX=r.touches[0].pageX-t.left,r.clientY=r.touches[0].pageY-t.top}}else r.originalEvent!==void 0&&r.originalEvent.clientX!==void 0&&(r.clientX=r.originalEvent.clientX,r.clientY=r.originalEvent.clientY)},isDblClick:function(r,e){if(r.detail===2)return!0;if(e!=null){var t=r.timeStamp-e.timeStamp,i=Math.sqrt(Math.pow(r.clientX-e.clientX,2)+Math.pow(r.clientY-e.clientY,2));return t<250&&i<10}return!1},now:Date.now||function(){return new Date().getTime()},throttle:function(r,e,t){var i=this,s,n,o,a=null,l=0;t||(t={});var c=function(){l=t.leading===!1?0:i.now(),a=null,o=r.apply(s,n),a||(s=n=null)};return function(){var h=i.now();!l&&t.leading===!1&&(l=h);var d=e-(h-l);return s=this,n=arguments,d<=0||d>e?(clearTimeout(a),a=null,l=h,o=r.apply(s,n),a||(s=n=null)):!a&&t.trailing!==!1&&(a=setTimeout(c,d)),o}},createRequestAnimationFrame:function(r){var e=null;return r!=="auto"&&r<60&&r>1&&(e=Math.floor(1e3/r)),e===null?window.requestAnimationFrame||Bi(33):Bi(e)}};function Bi(r){return function(e){window.setTimeout(e,r)}}var ft=Wt,vs="unknown";document.documentMode&&(vs="ie");var Kt={svgNS:"http://www.w3.org/2000/svg",xmlNS:"http://www.w3.org/XML/1998/namespace",xmlnsNS:"http://www.w3.org/2000/xmlns/",xlinkNS:"http://www.w3.org/1999/xlink",evNS:"http://www.w3.org/2001/xml-events",getBoundingClientRectNormalized:function(r){if(r.clientWidth&&r.clientHeight)return{width:r.clientWidth,height:r.clientHeight};if(r.getBoundingClientRect())return r.getBoundingClientRect();throw new Error("Cannot get BoundingClientRect for SVG.")},getOrCreateViewport:function(r,e){var t=null;if(ft.isElement(e)?t=e:t=r.querySelector(e),!t){var i=Array.prototype.slice.call(r.childNodes||r.children).filter(function(l){return l.nodeName!=="defs"&&l.nodeName!=="#text"});i.length===1&&i[0].nodeName==="g"&&i[0].getAttribute("transform")===null&&(t=i[0])}if(!t){var s="viewport-"+new Date().toISOString().replace(/\D/g,"");t=document.createElementNS(this.svgNS,"g"),t.setAttribute("id",s);var n=r.childNodes||r.children;if(n&&n.length>0)for(var o=n.length;o>0;o--)n[n.length-o].nodeName!=="defs"&&t.appendChild(n[n.length-o]);r.appendChild(t)}var a=[];return t.getAttribute("class")&&(a=t.getAttribute("class").split(" ")),~a.indexOf("svg-pan-zoom_viewport")||(a.push("svg-pan-zoom_viewport"),t.setAttribute("class",a.join(" "))),t},setupSvgAttributes:function(r){if(r.setAttribute("xmlns",this.svgNS),r.setAttributeNS(this.xmlnsNS,"xmlns:xlink",this.xlinkNS),r.setAttributeNS(this.xmlnsNS,"xmlns:ev",this.evNS),r.parentNode!==null){var e=r.getAttribute("style")||"";e.toLowerCase().indexOf("overflow")===-1&&r.setAttribute("style","overflow: hidden; "+e)}},internetExplorerRedisplayInterval:300,refreshDefsGlobal:ft.throttle(function(){for(var r=document.querySelectorAll("defs"),e=r.length,t=0;t<e;t++){var i=r[t];i.parentNode.insertBefore(i,i)}},Jt?Jt.internetExplorerRedisplayInterval:null),setCTM:function(r,e,t){var i=this,s="matrix("+e.a+","+e.b+","+e.c+","+e.d+","+e.e+","+e.f+")";r.setAttributeNS(null,"transform",s),"transform"in r.style?r.style.transform=s:"-ms-transform"in r.style?r.style["-ms-transform"]=s:"-webkit-transform"in r.style&&(r.style["-webkit-transform"]=s),vs==="ie"&&t&&(t.parentNode.insertBefore(t,t),window.setTimeout(function(){i.refreshDefsGlobal()},i.internetExplorerRedisplayInterval))},getEventPoint:function(r,e){var t=e.createSVGPoint();return ft.mouseAndTouchNormalize(r,e),t.x=r.clientX,t.y=r.clientY,t},getSvgCenterPoint:function(r,e,t){return this.createSVGPoint(r,e/2,t/2)},createSVGPoint:function(r,e,t){var i=r.createSVGPoint();return i.x=e,i.y=t,i}},P=Kt,Bn={enable:function(r){var e=r.svg.querySelector("defs");e||(e=document.createElementNS(P.svgNS,"defs"),r.svg.appendChild(e));var t=e.querySelector("style#svg-pan-zoom-controls-styles");if(!t){var i=document.createElementNS(P.svgNS,"style");i.setAttribute("id","svg-pan-zoom-controls-styles"),i.setAttribute("type","text/css"),i.textContent=".svg-pan-zoom-control { cursor: pointer; fill: black; fill-opacity: 0.333; } .svg-pan-zoom-control:hover { fill-opacity: 0.8; } .svg-pan-zoom-control-background { fill: white; fill-opacity: 0.5; } .svg-pan-zoom-control-background { fill-opacity: 0.8; }",e.appendChild(i)}var s=document.createElementNS(P.svgNS,"g");s.setAttribute("id","svg-pan-zoom-controls"),s.setAttribute("transform","translate("+(r.width-70)+" "+(r.height-76)+") scale(0.75)"),s.setAttribute("class","svg-pan-zoom-control"),s.appendChild(this._createZoomIn(r)),s.appendChild(this._createZoomReset(r)),s.appendChild(this._createZoomOut(r)),r.svg.appendChild(s),r.controlIcons=s},_createZoomIn:function(r){var e=document.createElementNS(P.svgNS,"g");e.setAttribute("id","svg-pan-zoom-zoom-in"),e.setAttribute("transform","translate(30.5 5) scale(0.015)"),e.setAttribute("class","svg-pan-zoom-control"),e.addEventListener("click",function(){r.getPublicInstance().zoomIn()},!1),e.addEventListener("touchstart",function(){r.getPublicInstance().zoomIn()},!1);var t=document.createElementNS(P.svgNS,"rect");t.setAttribute("x","0"),t.setAttribute("y","0"),t.setAttribute("width","1500"),t.setAttribute("height","1400"),t.setAttribute("class","svg-pan-zoom-control-background"),e.appendChild(t);var i=document.createElementNS(P.svgNS,"path");return i.setAttribute("d","M1280 576v128q0 26 -19 45t-45 19h-320v320q0 26 -19 45t-45 19h-128q-26 0 -45 -19t-19 -45v-320h-320q-26 0 -45 -19t-19 -45v-128q0 -26 19 -45t45 -19h320v-320q0 -26 19 -45t45 -19h128q26 0 45 19t19 45v320h320q26 0 45 19t19 45zM1536 1120v-960 q0 -119 -84.5 -203.5t-203.5 -84.5h-960q-119 0 -203.5 84.5t-84.5 203.5v960q0 119 84.5 203.5t203.5 84.5h960q119 0 203.5 -84.5t84.5 -203.5z"),i.setAttribute("class","svg-pan-zoom-control-element"),e.appendChild(i),e},_createZoomReset:function(r){var e=document.createElementNS(P.svgNS,"g");e.setAttribute("id","svg-pan-zoom-reset-pan-zoom"),e.setAttribute("transform","translate(5 35) scale(0.4)"),e.setAttribute("class","svg-pan-zoom-control"),e.addEventListener("click",function(){r.getPublicInstance().reset()},!1),e.addEventListener("touchstart",function(){r.getPublicInstance().reset()},!1);var t=document.createElementNS(P.svgNS,"rect");t.setAttribute("x","2"),t.setAttribute("y","2"),t.setAttribute("width","182"),t.setAttribute("height","58"),t.setAttribute("class","svg-pan-zoom-control-background"),e.appendChild(t);var i=document.createElementNS(P.svgNS,"path");i.setAttribute("d","M33.051,20.632c-0.742-0.406-1.854-0.609-3.338-0.609h-7.969v9.281h7.769c1.543,0,2.701-0.188,3.473-0.562c1.365-0.656,2.048-1.953,2.048-3.891C35.032,22.757,34.372,21.351,33.051,20.632z"),i.setAttribute("class","svg-pan-zoom-control-element"),e.appendChild(i);var s=document.createElementNS(P.svgNS,"path");return s.setAttribute("d","M170.231,0.5H15.847C7.102,0.5,0.5,5.708,0.5,11.84v38.861C0.5,56.833,7.102,61.5,15.847,61.5h154.384c8.745,0,15.269-4.667,15.269-10.798V11.84C185.5,5.708,178.976,0.5,170.231,0.5z M42.837,48.569h-7.969c-0.219-0.766-0.375-1.383-0.469-1.852c-0.188-0.969-0.289-1.961-0.305-2.977l-0.047-3.211c-0.03-2.203-0.41-3.672-1.142-4.406c-0.732-0.734-2.103-1.102-4.113-1.102h-7.05v13.547h-7.055V14.022h16.524c2.361,0.047,4.178,0.344,5.45,0.891c1.272,0.547,2.351,1.352,3.234,2.414c0.731,0.875,1.31,1.844,1.737,2.906s0.64,2.273,0.64,3.633c0,1.641-0.414,3.254-1.242,4.84s-2.195,2.707-4.102,3.363c1.594,0.641,2.723,1.551,3.387,2.73s0.996,2.98,0.996,5.402v2.32c0,1.578,0.063,2.648,0.19,3.211c0.19,0.891,0.635,1.547,1.333,1.969V48.569z M75.579,48.569h-26.18V14.022h25.336v6.117H56.454v7.336h16.781v6H56.454v8.883h19.125V48.569z M104.497,46.331c-2.44,2.086-5.887,3.129-10.34,3.129c-4.548,0-8.125-1.027-10.731-3.082s-3.909-4.879-3.909-8.473h6.891c0.224,1.578,0.662,2.758,1.316,3.539c1.196,1.422,3.246,2.133,6.15,2.133c1.739,0,3.151-0.188,4.236-0.562c2.058-0.719,3.087-2.055,3.087-4.008c0-1.141-0.504-2.023-1.512-2.648c-1.008-0.609-2.607-1.148-4.796-1.617l-3.74-0.82c-3.676-0.812-6.201-1.695-7.576-2.648c-2.328-1.594-3.492-4.086-3.492-7.477c0-3.094,1.139-5.664,3.417-7.711s5.623-3.07,10.036-3.07c3.685,0,6.829,0.965,9.431,2.895c2.602,1.93,3.966,4.73,4.093,8.402h-6.938c-0.128-2.078-1.057-3.555-2.787-4.43c-1.154-0.578-2.587-0.867-4.301-0.867c-1.907,0-3.428,0.375-4.565,1.125c-1.138,0.75-1.706,1.797-1.706,3.141c0,1.234,0.561,2.156,1.682,2.766c0.721,0.406,2.25,0.883,4.589,1.43l6.063,1.43c2.657,0.625,4.648,1.461,5.975,2.508c2.059,1.625,3.089,3.977,3.089,7.055C108.157,41.624,106.937,44.245,104.497,46.331z M139.61,48.569h-26.18V14.022h25.336v6.117h-18.281v7.336h16.781v6h-16.781v8.883h19.125V48.569z M170.337,20.14h-10.336v28.43h-7.266V20.14h-10.383v-6.117h27.984V20.14z"),s.setAttribute("class","svg-pan-zoom-control-element"),e.appendChild(s),e},_createZoomOut:function(r){var e=document.createElementNS(P.svgNS,"g");e.setAttribute("id","svg-pan-zoom-zoom-out"),e.setAttribute("transform","translate(30.5 70) scale(0.015)"),e.setAttribute("class","svg-pan-zoom-control"),e.addEventListener("click",function(){r.getPublicInstance().zoomOut()},!1),e.addEventListener("touchstart",function(){r.getPublicInstance().zoomOut()},!1);var t=document.createElementNS(P.svgNS,"rect");t.setAttribute("x","0"),t.setAttribute("y","0"),t.setAttribute("width","1500"),t.setAttribute("height","1400"),t.setAttribute("class","svg-pan-zoom-control-background"),e.appendChild(t);var i=document.createElementNS(P.svgNS,"path");return i.setAttribute("d","M1280 576v128q0 26 -19 45t-45 19h-896q-26 0 -45 -19t-19 -45v-128q0 -26 19 -45t45 -19h896q26 0 45 19t19 45zM1536 1120v-960q0 -119 -84.5 -203.5t-203.5 -84.5h-960q-119 0 -203.5 84.5t-84.5 203.5v960q0 119 84.5 203.5t203.5 84.5h960q119 0 203.5 -84.5 t84.5 -203.5z"),i.setAttribute("class","svg-pan-zoom-control-element"),e.appendChild(i),e},disable:function(r){r.controlIcons&&(r.controlIcons.parentNode.removeChild(r.controlIcons),r.controlIcons=null)}},Nn=Kt,te=Wt,A=function(r,e){this.init(r,e)};A.prototype.init=function(r,e){this.viewport=r,this.options=e,this.originalState={zoom:1,x:0,y:0},this.activeState={zoom:1,x:0,y:0},this.updateCTMCached=te.proxy(this.updateCTM,this),this.requestAnimationFrame=te.createRequestAnimationFrame(this.options.refreshRate),this.viewBox={x:0,y:0,width:0,height:0},this.cacheViewBox();var t=this.processCTM();this.setCTM(t),this.updateCTM()};A.prototype.cacheViewBox=function(){var r=this.options.svg.getAttribute("viewBox");if(r){var e=r.split(/[\s\,]/).filter(function(i){return i}).map(parseFloat);this.viewBox.x=e[0],this.viewBox.y=e[1],this.viewBox.width=e[2],this.viewBox.height=e[3];var t=Math.min(this.options.width/this.viewBox.width,this.options.height/this.viewBox.height);this.activeState.zoom=t,this.activeState.x=(this.options.width-this.viewBox.width*t)/2,this.activeState.y=(this.options.height-this.viewBox.height*t)/2,this.updateCTMOnNextFrame(),this.options.svg.removeAttribute("viewBox")}else this.simpleViewBoxCache()};A.prototype.simpleViewBoxCache=function(){var r=this.viewport.getBBox();this.viewBox.x=r.x,this.viewBox.y=r.y,this.viewBox.width=r.width,this.viewBox.height=r.height};A.prototype.getViewBox=function(){return te.extend({},this.viewBox)};A.prototype.processCTM=function(){var r=this.getCTM();if(this.options.fit||this.options.contain){var e;this.options.fit?e=Math.min(this.options.width/this.viewBox.width,this.options.height/this.viewBox.height):e=Math.max(this.options.width/this.viewBox.width,this.options.height/this.viewBox.height),r.a=e,r.d=e,r.e=-this.viewBox.x*e,r.f=-this.viewBox.y*e}if(this.options.center){var t=(this.options.width-(this.viewBox.width+this.viewBox.x*2)*r.a)*.5,i=(this.options.height-(this.viewBox.height+this.viewBox.y*2)*r.a)*.5;r.e=t,r.f=i}return this.originalState.zoom=r.a,this.originalState.x=r.e,this.originalState.y=r.f,r};A.prototype.getOriginalState=function(){return te.extend({},this.originalState)};A.prototype.getState=function(){return te.extend({},this.activeState)};A.prototype.getZoom=function(){return this.activeState.zoom};A.prototype.getRelativeZoom=function(){return this.activeState.zoom/this.originalState.zoom};A.prototype.computeRelativeZoom=function(r){return r/this.originalState.zoom};A.prototype.getPan=function(){return{x:this.activeState.x,y:this.activeState.y}};A.prototype.getCTM=function(){var r=this.options.svg.createSVGMatrix();return r.a=this.activeState.zoom,r.b=0,r.c=0,r.d=this.activeState.zoom,r.e=this.activeState.x,r.f=this.activeState.y,r};A.prototype.setCTM=function(r){var e=this.isZoomDifferent(r),t=this.isPanDifferent(r);if(e||t){if(e&&(this.options.beforeZoom(this.getRelativeZoom(),this.computeRelativeZoom(r.a))===!1?(r.a=r.d=this.activeState.zoom,e=!1):(this.updateCache(r),this.options.onZoom(this.getRelativeZoom()))),t){var i=this.options.beforePan(this.getPan(),{x:r.e,y:r.f}),s=!1,n=!1;i===!1?(r.e=this.getPan().x,r.f=this.getPan().y,s=n=!0):te.isObject(i)&&(i.x===!1?(r.e=this.getPan().x,s=!0):te.isNumber(i.x)&&(r.e=i.x),i.y===!1?(r.f=this.getPan().y,n=!0):te.isNumber(i.y)&&(r.f=i.y)),s&&n||!this.isPanDifferent(r)?t=!1:(this.updateCache(r),this.options.onPan(this.getPan()))}(e||t)&&this.updateCTMOnNextFrame()}};A.prototype.isZoomDifferent=function(r){return this.activeState.zoom!==r.a};A.prototype.isPanDifferent=function(r){return this.activeState.x!==r.e||this.activeState.y!==r.f};A.prototype.updateCache=function(r){this.activeState.zoom=r.a,this.activeState.x=r.e,this.activeState.y=r.f};A.prototype.pendingUpdate=!1;A.prototype.updateCTMOnNextFrame=function(){this.pendingUpdate||(this.pendingUpdate=!0,this.requestAnimationFrame.call(window,this.updateCTMCached))};A.prototype.updateCTM=function(){var r=this.getCTM();Nn.setCTM(this.viewport,r,this.defs),this.pendingUpdate=!1,this.options.onUpdatedCTM&&this.options.onUpdatedCTM(r)};var Hn=function(r,e){return new A(r,e)},ys=qn,Dt=Bn,B=Wt,H=Kt,Un=Hn,$=function(r,e){this.init(r,e)},jn={viewportSelector:".svg-pan-zoom_viewport",panEnabled:!0,controlIconsEnabled:!1,zoomEnabled:!0,dblClickZoomEnabled:!0,mouseWheelZoomEnabled:!0,preventMouseEventsDefault:!0,zoomScaleSensitivity:.1,minZoom:.5,maxZoom:10,fit:!0,contain:!1,center:!0,refreshRate:"auto",beforeZoom:null,onZoom:null,beforePan:null,onPan:null,customEventsHandler:null,eventsListenerElement:null,onUpdatedCTM:null},bs={passive:!0};$.prototype.init=function(r,e){var t=this;this.svg=r,this.defs=r.querySelector("defs"),H.setupSvgAttributes(this.svg),this.options=B.extend(B.extend({},jn),e),this.state="none";var i=H.getBoundingClientRectNormalized(r);this.width=i.width,this.height=i.height,this.viewport=Un(H.getOrCreateViewport(this.svg,this.options.viewportSelector),{svg:this.svg,width:this.width,height:this.height,fit:this.options.fit,contain:this.options.contain,center:this.options.center,refreshRate:this.options.refreshRate,beforeZoom:function(n,o){if(t.viewport&&t.options.beforeZoom)return t.options.beforeZoom(n,o)},onZoom:function(n){if(t.viewport&&t.options.onZoom)return t.options.onZoom(n)},beforePan:function(n,o){if(t.viewport&&t.options.beforePan)return t.options.beforePan(n,o)},onPan:function(n){if(t.viewport&&t.options.onPan)return t.options.onPan(n)},onUpdatedCTM:function(n){if(t.viewport&&t.options.onUpdatedCTM)return t.options.onUpdatedCTM(n)}});var s=this.getPublicInstance();s.setBeforeZoom(this.options.beforeZoom),s.setOnZoom(this.options.onZoom),s.setBeforePan(this.options.beforePan),s.setOnPan(this.options.onPan),s.setOnUpdatedCTM(this.options.onUpdatedCTM),this.options.controlIconsEnabled&&Dt.enable(this),this.lastMouseWheelEventTime=Date.now(),this.setupHandlers()};$.prototype.setupHandlers=function(){var r=this,e=null;if(this.eventListeners={mousedown:function(n){var o=r.handleMouseDown(n,e);return e=n,o},touchstart:function(n){var o=r.handleMouseDown(n,e);return e=n,o},mouseup:function(n){return r.handleMouseUp(n)},touchend:function(n){return r.handleMouseUp(n)},mousemove:function(n){return r.handleMouseMove(n)},touchmove:function(n){return r.handleMouseMove(n)},mouseleave:function(n){return r.handleMouseUp(n)},touchleave:function(n){return r.handleMouseUp(n)},touchcancel:function(n){return r.handleMouseUp(n)}},this.options.customEventsHandler!=null){this.options.customEventsHandler.init({svgElement:this.svg,eventsListenerElement:this.options.eventsListenerElement,instance:this.getPublicInstance()});var t=this.options.customEventsHandler.haltEventListeners;if(t&&t.length)for(var i=t.length-1;i>=0;i--)this.eventListeners.hasOwnProperty(t[i])&&delete this.eventListeners[t[i]]}for(var s in this.eventListeners)(this.options.eventsListenerElement||this.svg).addEventListener(s,this.eventListeners[s],this.options.preventMouseEventsDefault?!1:bs);this.options.mouseWheelZoomEnabled&&(this.options.mouseWheelZoomEnabled=!1,this.enableMouseWheelZoom())};$.prototype.enableMouseWheelZoom=function(){if(!this.options.mouseWheelZoomEnabled){var r=this;this.wheelListener=function(t){return r.handleMouseWheel(t)};var e=!this.options.preventMouseEventsDefault;ys.on(this.options.eventsListenerElement||this.svg,this.wheelListener,e),this.options.mouseWheelZoomEnabled=!0}};$.prototype.disableMouseWheelZoom=function(){if(this.options.mouseWheelZoomEnabled){var r=!this.options.preventMouseEventsDefault;ys.off(this.options.eventsListenerElement||this.svg,this.wheelListener,r),this.options.mouseWheelZoomEnabled=!1}};$.prototype.handleMouseWheel=function(r){if(!(!this.options.zoomEnabled||this.state!=="none")){this.options.preventMouseEventsDefault&&(r.preventDefault?r.preventDefault():r.returnValue=!1);var e=r.deltaY||1,t=Date.now()-this.lastMouseWheelEventTime,i=3+Math.max(0,30-t);this.lastMouseWheelEventTime=Date.now(),"deltaMode"in r&&r.deltaMode===0&&r.wheelDelta&&(e=r.deltaY===0?0:Math.abs(r.wheelDelta)/r.deltaY),e=-.3<e&&e<.3?e:(e>0?1:-1)*Math.log(Math.abs(e)+10)/i;var s=this.svg.getScreenCTM().inverse(),n=H.getEventPoint(r,this.svg).matrixTransform(s),o=Math.pow(1+this.options.zoomScaleSensitivity,-1*e);this.zoomAtPoint(o,n)}};$.prototype.zoomAtPoint=function(r,e,t){var i=this.viewport.getOriginalState();t?(r=Math.max(this.options.minZoom*i.zoom,Math.min(this.options.maxZoom*i.zoom,r)),r=r/this.getZoom()):this.getZoom()*r<this.options.minZoom*i.zoom?r=this.options.minZoom*i.zoom/this.getZoom():this.getZoom()*r>this.options.maxZoom*i.zoom&&(r=this.options.maxZoom*i.zoom/this.getZoom());var s=this.viewport.getCTM(),n=e.matrixTransform(s.inverse()),o=this.svg.createSVGMatrix().translate(n.x,n.y).scale(r).translate(-n.x,-n.y),a=s.multiply(o);a.a!==s.a&&this.viewport.setCTM(a)};$.prototype.zoom=function(r,e){this.zoomAtPoint(r,H.getSvgCenterPoint(this.svg,this.width,this.height),e)};$.prototype.publicZoom=function(r,e){e&&(r=this.computeFromRelativeZoom(r)),this.zoom(r,e)};$.prototype.publicZoomAtPoint=function(r,e,t){if(t&&(r=this.computeFromRelativeZoom(r)),B.getType(e)!=="SVGPoint")if("x"in e&&"y"in e)e=H.createSVGPoint(this.svg,e.x,e.y);else throw new Error("Given point is invalid");this.zoomAtPoint(r,e,t)};$.prototype.getZoom=function(){return this.viewport.getZoom()};$.prototype.getRelativeZoom=function(){return this.viewport.getRelativeZoom()};$.prototype.computeFromRelativeZoom=function(r){return r*this.viewport.getOriginalState().zoom};$.prototype.resetZoom=function(){var r=this.viewport.getOriginalState();this.zoom(r.zoom,!0)};$.prototype.resetPan=function(){this.pan(this.viewport.getOriginalState())};$.prototype.reset=function(){this.resetZoom(),this.resetPan()};$.prototype.handleDblClick=function(r){if(this.options.preventMouseEventsDefault&&(r.preventDefault?r.preventDefault():r.returnValue=!1),this.options.controlIconsEnabled){var e=r.target.getAttribute("class")||"";if(e.indexOf("svg-pan-zoom-control")>-1)return!1}var t;r.shiftKey?t=1/((1+this.options.zoomScaleSensitivity)*2):t=(1+this.options.zoomScaleSensitivity)*2;var i=H.getEventPoint(r,this.svg).matrixTransform(this.svg.getScreenCTM().inverse());this.zoomAtPoint(t,i)};$.prototype.handleMouseDown=function(r,e){this.options.preventMouseEventsDefault&&(r.preventDefault?r.preventDefault():r.returnValue=!1),B.mouseAndTouchNormalize(r,this.svg),this.options.dblClickZoomEnabled&&B.isDblClick(r,e)?this.handleDblClick(r):(this.state="pan",this.firstEventCTM=this.viewport.getCTM(),this.stateOrigin=H.getEventPoint(r,this.svg).matrixTransform(this.firstEventCTM.inverse()))};$.prototype.handleMouseMove=function(r){if(this.options.preventMouseEventsDefault&&(r.preventDefault?r.preventDefault():r.returnValue=!1),this.state==="pan"&&this.options.panEnabled){var e=H.getEventPoint(r,this.svg).matrixTransform(this.firstEventCTM.inverse()),t=this.firstEventCTM.translate(e.x-this.stateOrigin.x,e.y-this.stateOrigin.y);this.viewport.setCTM(t)}};$.prototype.handleMouseUp=function(r){this.options.preventMouseEventsDefault&&(r.preventDefault?r.preventDefault():r.returnValue=!1),this.state==="pan"&&(this.state="none")};$.prototype.fit=function(){var r=this.viewport.getViewBox(),e=Math.min(this.width/r.width,this.height/r.height);this.zoom(e,!0)};$.prototype.contain=function(){var r=this.viewport.getViewBox(),e=Math.max(this.width/r.width,this.height/r.height);this.zoom(e,!0)};$.prototype.center=function(){var r=this.viewport.getViewBox(),e=(this.width-(r.width+r.x*2)*this.getZoom())*.5,t=(this.height-(r.height+r.y*2)*this.getZoom())*.5;this.getPublicInstance().pan({x:e,y:t})};$.prototype.updateBBox=function(){this.viewport.simpleViewBoxCache()};$.prototype.pan=function(r){var e=this.viewport.getCTM();e.e=r.x,e.f=r.y,this.viewport.setCTM(e)};$.prototype.panBy=function(r){var e=this.viewport.getCTM();e.e+=r.x,e.f+=r.y,this.viewport.setCTM(e)};$.prototype.getPan=function(){var r=this.viewport.getState();return{x:r.x,y:r.y}};$.prototype.resize=function(){var r=H.getBoundingClientRectNormalized(this.svg);this.width=r.width,this.height=r.height;var e=this.viewport;e.options.width=this.width,e.options.height=this.height,e.processCTM(),this.options.controlIconsEnabled&&(this.getPublicInstance().disableControlIcons(),this.getPublicInstance().enableControlIcons())};$.prototype.destroy=function(){var r=this;this.beforeZoom=null,this.onZoom=null,this.beforePan=null,this.onPan=null,this.onUpdatedCTM=null,this.options.customEventsHandler!=null&&this.options.customEventsHandler.destroy({svgElement:this.svg,eventsListenerElement:this.options.eventsListenerElement,instance:this.getPublicInstance()});for(var e in this.eventListeners)(this.options.eventsListenerElement||this.svg).removeEventListener(e,this.eventListeners[e],this.options.preventMouseEventsDefault?!1:bs);this.disableMouseWheelZoom(),this.getPublicInstance().disableControlIcons(),this.reset(),X=X.filter(function(t){return t.svg!==r.svg}),delete this.options,delete this.viewport,delete this.publicInstance,delete this.pi,this.getPublicInstance=function(){return null}};$.prototype.getPublicInstance=function(){var r=this;return this.publicInstance||(this.publicInstance=this.pi={enablePan:function(){return r.options.panEnabled=!0,r.pi},disablePan:function(){return r.options.panEnabled=!1,r.pi},isPanEnabled:function(){return!!r.options.panEnabled},pan:function(e){return r.pan(e),r.pi},panBy:function(e){return r.panBy(e),r.pi},getPan:function(){return r.getPan()},setBeforePan:function(e){return r.options.beforePan=e===null?null:B.proxy(e,r.publicInstance),r.pi},setOnPan:function(e){return r.options.onPan=e===null?null:B.proxy(e,r.publicInstance),r.pi},enableZoom:function(){return r.options.zoomEnabled=!0,r.pi},disableZoom:function(){return r.options.zoomEnabled=!1,r.pi},isZoomEnabled:function(){return!!r.options.zoomEnabled},enableControlIcons:function(){return r.options.controlIconsEnabled||(r.options.controlIconsEnabled=!0,Dt.enable(r)),r.pi},disableControlIcons:function(){return r.options.controlIconsEnabled&&(r.options.controlIconsEnabled=!1,Dt.disable(r)),r.pi},isControlIconsEnabled:function(){return!!r.options.controlIconsEnabled},enableDblClickZoom:function(){return r.options.dblClickZoomEnabled=!0,r.pi},disableDblClickZoom:function(){return r.options.dblClickZoomEnabled=!1,r.pi},isDblClickZoomEnabled:function(){return!!r.options.dblClickZoomEnabled},enableMouseWheelZoom:function(){return r.enableMouseWheelZoom(),r.pi},disableMouseWheelZoom:function(){return r.disableMouseWheelZoom(),r.pi},isMouseWheelZoomEnabled:function(){return!!r.options.mouseWheelZoomEnabled},setZoomScaleSensitivity:function(e){return r.options.zoomScaleSensitivity=e,r.pi},setMinZoom:function(e){return r.options.minZoom=e,r.pi},setMaxZoom:function(e){return r.options.maxZoom=e,r.pi},setBeforeZoom:function(e){return r.options.beforeZoom=e===null?null:B.proxy(e,r.publicInstance),r.pi},setOnZoom:function(e){return r.options.onZoom=e===null?null:B.proxy(e,r.publicInstance),r.pi},zoom:function(e){return r.publicZoom(e,!0),r.pi},zoomBy:function(e){return r.publicZoom(e,!1),r.pi},zoomAtPoint:function(e,t){return r.publicZoomAtPoint(e,t,!0),r.pi},zoomAtPointBy:function(e,t){return r.publicZoomAtPoint(e,t,!1),r.pi},zoomIn:function(){return this.zoomBy(1+r.options.zoomScaleSensitivity),r.pi},zoomOut:function(){return this.zoomBy(1/(1+r.options.zoomScaleSensitivity)),r.pi},getZoom:function(){return r.getRelativeZoom()},setOnUpdatedCTM:function(e){return r.options.onUpdatedCTM=e===null?null:B.proxy(e,r.publicInstance),r.pi},resetZoom:function(){return r.resetZoom(),r.pi},resetPan:function(){return r.resetPan(),r.pi},reset:function(){return r.reset(),r.pi},fit:function(){return r.fit(),r.pi},contain:function(){return r.contain(),r.pi},center:function(){return r.center(),r.pi},updateBBox:function(){return r.updateBBox(),r.pi},resize:function(){return r.resize(),r.pi},getSizes:function(){return{width:r.width,height:r.height,realZoom:r.getZoom(),viewBox:r.viewport.getViewBox()}},destroy:function(){return r.destroy(),r.pi}}),this.publicInstance};var X=[],Vn=function(r,e){var t=B.getSvg(r);if(t===null)return null;for(var i=X.length-1;i>=0;i--)if(X[i].svg===t)return X[i].instance.getPublicInstance();return X.push({svg:t,instance:new $(t,e)}),X[X.length-1].instance.getPublicInstance()},Zn=Vn;const Ni=Ms(Zn),Wn=6,Kn=.1,Xn=40,Yn=.002,K="svg-editor-handle",Hi="svg-editor-handles";function pe(r){switch(r.tagName.toLowerCase()){case"rect":return{drag:!0,endpoints:!1,resize:!0};case"circle":return{drag:!0,endpoints:!1,resize:!0};case"ellipse":return{drag:!0,endpoints:!1,resize:!0};case"line":return{drag:!0,endpoints:!0,resize:!1};case"polyline":case"polygon":return{drag:!0,endpoints:!0,resize:!1};case"path":return{drag:!0,endpoints:!0,resize:!1};case"text":return{drag:!0,endpoints:!1,resize:!1};case"g":case"image":case"use":case"foreignobject":return{drag:!0,endpoints:!1,resize:!1};default:return{drag:!1,endpoints:!1,resize:!1}}}function Ui(r){const e=[],t=/([MLHVCSQTAZmlhvcsqtaz])\s*([-\d.,eE\s]*)/g;let i;for(;(i=t.exec(r))!==null;){const s=i[1],n=i[2].trim(),o=n.length>0?n.split(/[\s,]+/).map(Number):[];e.push({cmd:s,args:o})}return e}function Gn(r){return r.map(e=>e.args.length===0?e.cmd:e.cmd+" "+e.args.map(t=>Math.round(t*1e3)/1e3).join(" ")).join(" ")}function Jn(r){const e=[];let t=0,i=0,s=0,n=0;for(let o=0;o<r.length;o++){const{cmd:a,args:l}=r[o],c=a.toUpperCase(),h=a!==c;if(c==="M"){const d=h?t+l[0]:l[0],p=h?i+l[1]:l[1];e.push({x:d,y:p,cmdIndex:o,argIndex:0,type:"endpoint"}),t=d,i=p,s=d,n=p}else if(c==="L"){const d=h?t+l[0]:l[0],p=h?i+l[1]:l[1];e.push({x:d,y:p,cmdIndex:o,argIndex:0,type:"endpoint"}),t=d,i=p}else if(c==="H"){const d=h?t+l[0]:l[0];e.push({x:d,y:i,cmdIndex:o,argIndex:0,type:"endpoint"}),t=d}else if(c==="V"){const d=h?i+l[0]:l[0];e.push({x:t,y:d,cmdIndex:o,argIndex:0,type:"endpoint"}),i=d}else if(c==="Q"){const d=h?t+l[0]:l[0],p=h?i+l[1]:l[1],_=h?t+l[2]:l[2],g=h?i+l[3]:l[3];e.push({x:d,y:p,cmdIndex:o,argIndex:0,type:"control"}),e.push({x:_,y:g,cmdIndex:o,argIndex:2,type:"endpoint"}),t=_,i=g}else if(c==="C"){const d=h?t+l[0]:l[0],p=h?i+l[1]:l[1],_=h?t+l[2]:l[2],g=h?i+l[3]:l[3],y=h?t+l[4]:l[4],u=h?i+l[5]:l[5];e.push({x:d,y:p,cmdIndex:o,argIndex:0,type:"control"}),e.push({x:_,y:g,cmdIndex:o,argIndex:2,type:"control"}),e.push({x:y,y:u,cmdIndex:o,argIndex:4,type:"endpoint"}),t=y,i=u}else if(c==="S"){const d=h?t+l[0]:l[0],p=h?i+l[1]:l[1],_=h?t+l[2]:l[2],g=h?i+l[3]:l[3];e.push({x:d,y:p,cmdIndex:o,argIndex:0,type:"control"}),e.push({x:_,y:g,cmdIndex:o,argIndex:2,type:"endpoint"}),t=_,i=g}else if(c==="T"){const d=h?t+l[0]:l[0],p=h?i+l[1]:l[1];e.push({x:d,y:p,cmdIndex:o,argIndex:0,type:"endpoint"}),t=d,i=p}else if(c==="A"){const d=h?t+l[5]:l[5],p=h?i+l[6]:l[6];e.push({x:d,y:p,cmdIndex:o,argIndex:5,type:"endpoint"}),t=d,i=p}else c==="Z"&&(t=s,i=n)}return e}function $e(r){const t=(r.getAttribute("transform")||"").match(/translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/);return t?{tx:parseFloat(t[1]),ty:parseFloat(t[2])}:{tx:0,ty:0}}function We(r,e,t){let i=r.getAttribute("transform")||"";const s=`translate(${e}, ${t})`;/translate\(/.test(i)?i=i.replace(/translate\(\s*[-\d.e]+[\s,]+[-\d.e]+\s*\)/,s):i=i?`${s} ${i}`:s,r.setAttribute("transform",i)}function Ce(r){const e=r.getAttribute("points")||"",t=[],i=e.trim().split(/\s+/);for(const s of i){const[n,o]=s.split(",").map(Number);!isNaN(n)&&!isNaN(o)&&t.push({x:n,y:o})}return t}function Ke(r){return r.map(e=>`${e.x},${e.y}`).join(" ")}function w(r,e){return parseFloat(r.getAttribute(e))||0}class Qn{constructor(e,{onDirty:t,onSelect:i,onDeselect:s,onZoom:n}={}){this._svg=e,this._onDirty=t||(()=>{}),this._onSelect=i||(()=>{}),this._onDeselect=s||(()=>{}),this._onZoom=n||(()=>{}),this._selected=null,this._multiSelected=new Set,this._dragState=null,this._handleGroup=null,this._dirty=!1,this._clipboard=null,this._zoomLevel=1,this._panX=0,this._panY=0,this._isPanning=!1,this._panStart=null,this._marqueeRect=null,this._marqueeStart=null,this._marqueeActive=!1,this._marqueePendingToggle=null,this._textEditEl=null,this._textEditOverlay=null,this._onPointerDown=this._onPointerDown.bind(this),this._onPointerMove=this._onPointerMove.bind(this),this._onPointerUp=this._onPointerUp.bind(this),this._onKeyDown=this._onKeyDown.bind(this),this._onWheel=this._onWheel.bind(this),this._onPointerMoveHover=this._onPointerMoveHover.bind(this),this._onDblClick=this._onDblClick.bind(this),this._svg.addEventListener("pointerdown",this._onPointerDown),this._svg.addEventListener("dblclick",this._onDblClick),this._svg.addEventListener("wheel",this._onWheel,{passive:!1}),this._svg.addEventListener("pointermove",this._onPointerMoveHover),window.addEventListener("pointermove",this._onPointerMove),window.addEventListener("pointerup",this._onPointerUp),window.addEventListener("keydown",this._onKeyDown),this._svg.style.touchAction="none",this._origViewBox=this._getViewBox()}dispose(){this._commitTextEdit(),this._cancelMarquee(),this._removeHandles(),this._svg.removeEventListener("pointerdown",this._onPointerDown),this._svg.removeEventListener("dblclick",this._onDblClick),this._svg.removeEventListener("wheel",this._onWheel),this._svg.removeEventListener("pointermove",this._onPointerMoveHover),window.removeEventListener("pointermove",this._onPointerMove),window.removeEventListener("pointerup",this._onPointerUp),window.removeEventListener("keydown",this._onKeyDown),this._svg.style.cursor="",this._selected=null,this._multiSelected.clear(),this._dragState=null}get isDirty(){return this._dirty}get selectedElement(){return this._selected}getContent(){this._commitTextEdit(),this._removeHandles();const e=this._svg.outerHTML;return(this._selected||this._multiSelected.size>0)&&this._renderHandles(),e}_screenToSvg(e,t){const i=this._svg.getScreenCTM();if(!i)return{x:e,y:t};const s=i.inverse(),n=this._svg.createSVGPoint();n.x=e,n.y=t;const o=n.matrixTransform(s);return{x:o.x,y:o.y}}_screenDistToSvgDist(e){const t=this._screenToSvg(0,0),i=this._screenToSvg(e,0);return Math.abs(i.x-t.x)}_getViewBox(){const e=this._svg.getAttribute("viewBox");if(!e)return{x:0,y:0,w:800,h:600};const t=e.split(/[\s,]+/).map(Number);return{x:t[0]||0,y:t[1]||0,w:t[2]||800,h:t[3]||600}}_setViewBox(e,t,i,s){this._svg.setAttribute("viewBox",`${e} ${t} ${i} ${s}`)}get zoomLevel(){return this._zoomLevel}get viewBox(){return this._getViewBox()}setViewBox(e,t,i,s){this._setViewBox(e,t,i,s),this._origViewBox.w>0&&(this._zoomLevel=this._origViewBox.w/i)}fitContent(){let e;try{const f=this._svg.getBBox();f.width>0&&f.height>0&&(e={x:f.x,y:f.y,w:f.width,h:f.height})}catch{}if(e||(e=this._origViewBox),!e||e.w<=0||e.h<=0)return;const t=e,i=this._svg.getBoundingClientRect(),s=i.width||1,n=i.height||1,o=s/n,a=t.w/t.h,l=.03,c=t.x-t.w*l,h=t.y-t.h*l,d=t.w*(1+l*2),p=t.h*(1+l*2);let _,g;a>o?(_=d,g=d/o):(g=p,_=p*o);const y=c-(_-d)/2,u=h-(g-p)/2;this._setViewBox(y,u,_,g),this._zoomLevel=1,this._updateHandles(),this._onZoom({zoom:1,viewBox:{x:y,y:u,w:_,h:g}})}_onWheel(e){e.preventDefault(),e.stopPropagation();const t=-e.deltaY*Yn,i=this._zoomLevel,s=Math.min(Xn,Math.max(Kn,i*(1+t))),n=i/s,o=this._screenToSvg(e.clientX,e.clientY),a=this._getViewBox(),l=a.w*n,c=a.h*n,h=o.x-(o.x-a.x)*n,d=o.y-(o.y-a.y)*n;this._setViewBox(h,d,l,c),this._zoomLevel=s,this._updateHandles(),this._onZoom({zoom:s,viewBox:{x:h,y:d,w:l,h:c}})}_onPointerMoveHover(e){if(this._dragState||this._isPanning)return;const t=e.clientX,i=e.clientY;if(this._selected){const n=this._hitTestHandle(t,i);if(n){if(n.type==="endpoint")this._svg.style.cursor="crosshair";else if(n.type==="resize-corner"){const o=["nwse-resize","nesw-resize","nwse-resize","nesw-resize"];this._svg.style.cursor=o[n.index]||"nwse-resize"}else if(n.type==="resize-edge"){const o=["ew-resize","ns-resize","ew-resize","ns-resize"];this._svg.style.cursor=o[n.index]||"ew-resize"}return}}const s=this._hitTest(t,i);if(s){if(this._multiSelected.size>1&&this._multiSelected.has(s)){this._svg.style.cursor="move";return}const n=pe(s);n.endpoints?this._svg.style.cursor="pointer":n.resize?this._svg.style.cursor="move":n.drag?this._svg.style.cursor="grab":this._svg.style.cursor="default"}else this._svg.style.cursor="default"}_hitTest(e,t){const i=this._svg.getRootNode(),s=i.elementsFromPoint?i.elementsFromPoint(e,t):document.elementsFromPoint(e,t);for(const n of s){if(n.classList&&n.classList.contains(K)||n===this._svg)continue;const o=n.tagName.toLowerCase();if(["defs","style","metadata","title","desc","filter","lineargradient","radialgradient","clippath","mask","marker","pattern","symbol","femerge","femergenode","fegaussianblur","fedropshadow","stop"].includes(o)||!this._svg.contains(n))continue;if(pe(n).drag)return n}return null}_hitTestHandle(e,t){const i=this._svg.getRootNode(),s=i.elementsFromPoint?i.elementsFromPoint(e,t):document.elementsFromPoint(e,t);for(const n of s)if(n.classList&&n.classList.contains(K))return{type:n.dataset.handleType,index:parseInt(n.dataset.handleIndex,10)};return null}_onPointerDown(e){if(e.button===1){e.preventDefault(),e.stopPropagation(),this._isPanning=!0,this._panStart={screenX:e.clientX,screenY:e.clientY,vb:this._getViewBox()},this._svg.style.cursor="grabbing";return}if(e.button!==0)return;const t=e.clientX,i=e.clientY,s=this._screenToSvg(t,i),n=e.shiftKey;if(this._selected&&!n&&this._multiSelected.size<=1){const c=this._hitTestHandle(t,i);if(c){e.preventDefault(),e.stopPropagation(),this._startHandleDrag(c,s,t,i);return}}this._textEditEl&&this._commitTextEdit();const o=this._hitTest(t,i);if(n){if(e.preventDefault(),e.stopPropagation(),o){if(this._multiSelected.has(o)){if(this._multiSelected.delete(o),this._selected===o){const c=[...this._multiSelected];this._selected=c.length>0?c[c.length-1]:null}this._multiSelected.size===0?this._deselect():(this._renderHandles(),this._onSelect(this._selected));return}this._marqueePendingToggle=o,this._startMarquee(s);return}this._marqueePendingToggle=null,this._startMarquee(s);return}if(!o){this._deselect();return}if(e.preventDefault(),e.stopPropagation(),this._multiSelected.size>1&&this._multiSelected.has(o)){this._svg.style.cursor="grabbing",this._startMultiDrag(s);return}this._select(o),this._svg.style.cursor="grabbing";const a=pe(o),l=o.tagName.toLowerCase();l==="line"&&a.endpoints?this._startLineDrag(o,s):(l==="polyline"||l==="polygon")&&a.endpoints?this._startPolyDrag(o,s):l==="path"&&a.endpoints?this._startPathDrag(o,s):a.drag&&this._startElementDrag(o,s)}_onPointerMove(e){if(this._marqueeActive){e.preventDefault();const n=this._screenToSvg(e.clientX,e.clientY);this._updateMarquee(n);return}if(this._isPanning&&this._panStart){e.preventDefault();const n=e.clientX-this._panStart.screenX,o=e.clientY-this._panStart.screenY,a=this._panStart.vb,l=this._svg.getBoundingClientRect(),c=a.w/l.width,h=a.h/l.height;this._setViewBox(a.x-n*c,a.y-o*h,a.w,a.h),this._updateHandles(),this._onZoom({zoom:this._zoomLevel,viewBox:this._getViewBox()});return}if(!this._dragState)return;e.preventDefault();const t=this._screenToSvg(e.clientX,e.clientY),i=t.x-this._dragState.startSvg.x,s=t.y-this._dragState.startSvg.y;switch(this._dragState.mode){case"translate":this._applyTranslate(i,s);break;case"multi-translate":this._applyMultiTranslate(i,s);break;case"line-whole":this._applyLineWhole(i,s);break;case"line-endpoint":this._applyLineEndpoint(t);break;case"poly-whole":this._applyPolyWhole(i,s);break;case"poly-vertex":this._applyPolyVertex(t);break;case"resize":this._applyResize(t);break;case"path-point":this._applyPathPoint(t);break}this._updateHandles()}_onPointerUp(e){if(this._marqueeActive){const n=this._screenToSvg(e.clientX,e.clientY);this._finishMarquee(n);return}if(this._isPanning){this._isPanning=!1,this._panStart=null,this._svg.style.cursor="";return}if(!this._dragState)return;const t=this._screenToSvg(e.clientX,e.clientY),i=Math.abs(t.x-this._dragState.startSvg.x),s=Math.abs(t.y-this._dragState.startSvg.y);(i>.5||s>.5)&&this._markDirty(),this._dragState=null,this._svg.style.cursor=""}_onKeyDown(e){if(e.key==="Escape"){this._marqueeActive?this._cancelMarquee():this._textEditEl?this._commitTextEdit():(this._selected||this._multiSelected.size>0)&&this._deselect();return}if(this._textEditEl)return;const t=e.ctrlKey||e.metaKey,i=this._selected||this._multiSelected.size>0;t&&e.key==="c"&&i?(e.preventDefault(),this._copySelected()):t&&e.key==="v"&&this._clipboard&&this._clipboard.length>0?(e.preventDefault(),this._pasteClipboard()):t&&e.key==="d"&&i?(e.preventDefault(),this._copySelected(),this._pasteClipboard()):(e.key==="Delete"||e.key==="Backspace")&&i&&(e.preventDefault(),this._deleteSelected())}_copySelected(){this._multiSelected.size!==0&&(this._removeHandles(),this._clipboard=[...this._multiSelected].map(e=>e.cloneNode(!0)),this._renderHandles())}_pasteClipboard(){if(!this._clipboard||this._clipboard.length===0)return;const e=this._screenDistToSvgDist(15),t=[];for(const i of this._clipboard){const s=i.cloneNode(!0),n=s.tagName.toLowerCase();if(n==="rect"||n==="text"||n==="image"||n==="foreignobject")s.setAttribute("x",w(s,"x")+e),s.setAttribute("y",w(s,"y")+e);else if(n==="circle"||n==="ellipse")s.setAttribute("cx",w(s,"cx")+e),s.setAttribute("cy",w(s,"cy")+e);else if(n==="line")s.setAttribute("x1",w(s,"x1")+e),s.setAttribute("y1",w(s,"y1")+e),s.setAttribute("x2",w(s,"x2")+e),s.setAttribute("y2",w(s,"y2")+e);else if(n==="polyline"||n==="polygon"){const a=Ce(s).map(l=>({x:l.x+e,y:l.y+e}));s.setAttribute("points",Ke(a))}else if(n==="path"){const{tx:o,ty:a}=$e(s);We(s,o+e,a+e)}else{const{tx:o,ty:a}=$e(s);We(s,o+e,a+e)}this._svg.appendChild(s),t.push(s)}this._deselect(),t.length>0&&(this._selected=t[t.length-1],this._multiSelected=new Set(t),this._renderHandles(),this._onSelect(this._selected)),this._markDirty()}_deleteSelected(){if(this._multiSelected.size===0)return;const e=[...this._multiSelected];this._deselect();for(const t of e)t.remove();this._markDirty()}_onDblClick(e){const t=e.clientX,i=e.clientY,s=this._hitTest(t,i);if(!s)return;s.tagName.toLowerCase()==="text"&&(e.preventDefault(),e.stopPropagation(),this._select(s),this._startTextEdit(s))}_startTextEdit(e){this._commitTextEdit(),this._textEditEl=e;let t;try{t=e.getBBox()}catch{return}const i="http://www.w3.org/2000/svg",s="http://www.w3.org/1999/xhtml",n=4,o=document.createElementNS(i,"foreignObject");o.setAttribute("x",t.x-n),o.setAttribute("y",t.y-n),o.setAttribute("width",Math.max(t.width+n*4,60)),o.setAttribute("height",t.height+n*2),o.classList.add(K),o.dataset.handleType="text-edit",o.dataset.handleIndex="0";const a=document.createElementNS(s,"div");a.setAttribute("contenteditable","true"),a.setAttribute("xmlns",s);const l=window.getComputedStyle(e),c=l.fontSize||"16px",h=l.fontFamily||"sans-serif",d=l.fill||e.getAttribute("fill")||"#000";Object.assign(a.style,{fontSize:c,fontFamily:h,color:d==="none"?"#000":d,background:"rgba(30, 30, 30, 0.85)",border:"1px solid #4fc3f7",borderRadius:"2px",padding:`${n}px`,margin:"0",outline:"none",whiteSpace:"pre",minWidth:"40px",lineHeight:"normal",boxSizing:"border-box",width:"100%",height:"100%",overflow:"hidden"}),a.textContent=e.textContent,o.appendChild(a),this._svg.appendChild(o),this._textEditOverlay=o,e.style.opacity="0",requestAnimationFrame(()=>{a.focus();const p=document.createRange();p.selectNodeContents(a);const _=window.getSelection();_.removeAllRanges(),_.addRange(p)}),a.addEventListener("blur",()=>this._commitTextEdit()),a.addEventListener("pointerdown",p=>p.stopPropagation()),a.addEventListener("keydown",p=>{p.key==="Enter"&&!p.shiftKey&&(p.preventDefault(),this._commitTextEdit()),p.key==="Escape"&&(p.preventDefault(),this._cancelTextEdit()),p.stopPropagation()})}_commitTextEdit(){if(!this._textEditEl||!this._textEditOverlay)return;const e=this._textEditOverlay.querySelector("div"),t=e?e.textContent:"",i=this._textEditEl.textContent;this._textEditEl.style.opacity="",t!==i&&(this._textEditEl.textContent=t,this._markDirty()),this._textEditOverlay.remove(),this._textEditOverlay=null,this._textEditEl=null,this._updateHandles()}_cancelTextEdit(){!this._textEditEl||!this._textEditOverlay||(this._textEditEl.style.opacity="",this._textEditOverlay.remove(),this._textEditOverlay=null,this._textEditEl=null)}_startMarquee(e){this._marqueeStart={x:e.x,y:e.y},this._marqueeActive=!0;const i=document.createElementNS("http://www.w3.org/2000/svg","rect");i.setAttribute("x",e.x),i.setAttribute("y",e.y),i.setAttribute("width",0),i.setAttribute("height",0),i.setAttribute("fill","rgba(79, 195, 247, 0.1)");const s=this._screenDistToSvgDist(1),n=this._screenDistToSvgDist(4),o=this._screenDistToSvgDist(3);i.setAttribute("stroke","#4fc3f7"),i.setAttribute("stroke-width",s),i.setAttribute("stroke-dasharray",`${n} ${o}`),i.setAttribute("pointer-events","none"),i.classList.add(K),i.dataset.handleType="marquee",i.dataset.handleIndex="0",this._svg.appendChild(i),this._marqueeRect=i,this._svg.style.cursor="crosshair"}_updateMarquee(e){if(!this._marqueeRect||!this._marqueeStart)return;const t=Math.min(this._marqueeStart.x,e.x),i=Math.min(this._marqueeStart.y,e.y),s=Math.abs(e.x-this._marqueeStart.x),n=Math.abs(e.y-this._marqueeStart.y);this._marqueeRect.setAttribute("x",t),this._marqueeRect.setAttribute("y",i),this._marqueeRect.setAttribute("width",s),this._marqueeRect.setAttribute("height",n);const o=e.x>=this._marqueeStart.x&&e.y>=this._marqueeStart.y,a=this._screenDistToSvgDist(1);if(o)this._marqueeRect.setAttribute("fill","rgba(79, 195, 247, 0.12)"),this._marqueeRect.setAttribute("stroke","#4fc3f7"),this._marqueeRect.setAttribute("stroke-width",a),this._marqueeRect.removeAttribute("stroke-dasharray");else{const l=this._screenDistToSvgDist(4),c=this._screenDistToSvgDist(3);this._marqueeRect.setAttribute("fill","rgba(126, 231, 135, 0.10)"),this._marqueeRect.setAttribute("stroke","#7ee787"),this._marqueeRect.setAttribute("stroke-width",a),this._marqueeRect.setAttribute("stroke-dasharray",`${l} ${c}`)}}_finishMarquee(e){const t=this._marqueeStart,i=this._marqueePendingToggle;if(!t){this._cancelMarquee();return}const s=Math.min(t.x,e.x),n=Math.min(t.y,e.y),o=Math.max(t.x,e.x),a=Math.max(t.y,e.y);this._cancelMarquee();const l=this._screenDistToSvgDist(5);if(o-s<l&&a-n<l){if(i){this._selected||(this._selected=i),this._multiSelected.add(i),this._renderHandles(),this._onSelect(this._selected);return}this._deselect();return}const c=e.x>=t.x&&e.y>=t.y,h=this._collectMarqueeHits(s,n,o,a,c);if(h.length!==0){for(const d of h)this._multiSelected.add(d);(!this._selected||!this._multiSelected.has(this._selected))&&(this._selected=h[h.length-1]),this._renderHandles(),this._onSelect(this._selected)}}_collectMarqueeHits(e,t,i,s,n){const o=[],a=c=>{if(pe(c).drag)try{const d=c.getBBox();if(d.width===0&&d.height===0)return;const p=this._localToSvgRoot(c,d.x,d.y),_=this._localToSvgRoot(c,d.x+d.width,d.y),g=this._localToSvgRoot(c,d.x+d.width,d.y+d.height),y=this._localToSvgRoot(c,d.x,d.y+d.height),u=Math.min(p.x,_.x,g.x,y.x),f=Math.min(p.y,_.y,g.y,y.y),b=Math.max(p.x,_.x,g.x,y.x),S=Math.max(p.y,_.y,g.y,y.y);n?u>=e&&f>=t&&b<=i&&S<=s&&o.push(c):u<=i&&b>=e&&f<=s&&S>=t&&o.push(c)}catch{}},l=this._svg.children;for(let c=0;c<l.length;c++){const h=l[c];if(h.classList&&h.classList.contains(K)||h.id===Hi)continue;const d=h.tagName.toLowerCase();if(!["defs","style","metadata","title","desc"].includes(d)&&(a(h),d==="g"))for(let p=0;p<h.children.length;p++)a(h.children[p])}return o}_cancelMarquee(){this._marqueeRect&&(this._marqueeRect.remove(),this._marqueeRect=null),this._marqueeStart=null,this._marqueeActive=!1,this._marqueePendingToggle=null,this._svg.style.cursor=""}_select(e){this._selected===e&&this._multiSelected.size<=1||(this._deselect(),this._selected=e,this._multiSelected.clear(),this._multiSelected.add(e),this._renderHandles(),this._onSelect(e))}_deselect(){!this._selected&&this._multiSelected.size===0||(this._removeHandles(),this._selected=null,this._multiSelected.clear(),this._onDeselect())}_markDirty(){this._dirty||(this._dirty=!0),this._onDirty()}_removeHandles(){this._handleGroup&&(this._handleGroup.remove(),this._handleGroup=null)}_renderHandles(){if(this._removeHandles(),!this._selected&&this._multiSelected.size===0)return;const t=document.createElementNS("http://www.w3.org/2000/svg","g");t.id=Hi,t.setAttribute("pointer-events","all"),this._svg.appendChild(t),this._handleGroup=t;const i=this._multiSelected.size>1;for(const s of this._multiSelected)this._renderBoundingBox(t,s);if(!i&&this._selected){const s=this._selected,n=s.tagName.toLowerCase(),o=pe(s);n==="line"?this._renderLineHandles(t,s):n==="polyline"||n==="polygon"?this._renderPolyHandles(t,s):n==="rect"&&o.resize?this._renderRectHandles(t,s):n==="circle"&&o.resize?this._renderCircleHandles(t,s):n==="ellipse"&&o.resize?this._renderEllipseHandles(t,s):n==="path"&&this._renderPathHandles(t,s)}}_renderBoundingBox(e,t){try{const i=t.getBBox();if(i.width===0&&i.height===0)return;let s=i.x,n=i.y,o=i.width,a=i.height;const l=t.getCTM(),c=this._svg.getCTM();if(l&&c){const f=c.inverse().multiply(l),b=[{x:i.x,y:i.y},{x:i.x+i.width,y:i.y},{x:i.x+i.width,y:i.y+i.height},{x:i.x,y:i.y+i.height}];let S=1/0,x=1/0,E=-1/0,O=-1/0;for(const N of b){const Z=f.a*N.x+f.c*N.y+f.e,ie=f.b*N.x+f.d*N.y+f.f;Z<S&&(S=Z),ie<x&&(x=ie),Z>E&&(E=Z),ie>O&&(O=ie)}s=S,n=x,o=E-S,a=O-x}const d=document.createElementNS("http://www.w3.org/2000/svg","rect"),p=this._screenDistToSvgDist(1),_=this._screenDistToSvgDist(4),g=this._screenDistToSvgDist(3),y=this._screenDistToSvgDist(3);d.setAttribute("x",s-y),d.setAttribute("y",n-y),d.setAttribute("width",o+y*2),d.setAttribute("height",a+y*2),d.setAttribute("fill","none"),d.setAttribute("stroke","#4fc3f7"),d.setAttribute("stroke-width",p),d.setAttribute("stroke-dasharray",`${_} ${g}`),d.setAttribute("pointer-events","none"),d.classList.add(K),d.dataset.handleType="bbox",d.dataset.handleIndex="0",e.appendChild(d)}catch{}}_updateHandles(){this._renderHandles()}_getHandleRadius(){return this._screenDistToSvgDist(Wn)}_localToSvgRoot(e,t,i){const s=e.getCTM(),n=this._svg.getCTM();if(s&&n){const o=n.inverse().multiply(s);return{x:o.a*t+o.c*i+o.e,y:o.b*t+o.d*i+o.f}}return{x:t,y:i}}_createHandle(e,t,i,s,n,o="circle"){const a="http://www.w3.org/2000/svg",l=this._getHandleRadius();let c;o==="diamond"?(c=document.createElementNS(a,"polygon"),c.setAttribute("points",`${t},${i-l} ${t+l},${i} ${t},${i+l} ${t-l},${i}`)):o==="circle"?(c=document.createElementNS(a,"circle"),c.setAttribute("cx",t),c.setAttribute("cy",i),c.setAttribute("r",l)):(c=document.createElementNS(a,"rect"),c.setAttribute("x",t-l),c.setAttribute("y",i-l),c.setAttribute("width",l*2),c.setAttribute("height",l*2));const h=this._screenDistToSvgDist(1.5),d=s==="path-control"?"#f0883e":s==="endpoint"||s==="path-point"?"#4fc3f7":"#f0883e";return c.setAttribute("fill",d),c.setAttribute("stroke","#fff"),c.setAttribute("stroke-width",h),c.setAttribute("cursor","pointer"),c.classList.add(K),c.dataset.handleType=s,c.dataset.handleIndex=n,c.style.pointerEvents="all",e.appendChild(c),c}_renderLineHandles(e,t){const i=w(t,"x1"),s=w(t,"y1"),n=w(t,"x2"),o=w(t,"y2"),a=this._localToSvgRoot(t,i,s),l=this._localToSvgRoot(t,n,o);this._createHandle(e,a.x,a.y,"endpoint",0),this._createHandle(e,l.x,l.y,"endpoint",1)}_renderPolyHandles(e,t){Ce(t).forEach((s,n)=>{const o=this._localToSvgRoot(t,s.x,s.y);this._createHandle(e,o.x,o.y,"endpoint",n)})}_renderRectHandles(e,t){const i=w(t,"x"),s=w(t,"y"),n=w(t,"width"),o=w(t,"height");[{x:i,y:s},{x:i+n,y:s},{x:i+n,y:s+o},{x:i,y:s+o}].forEach((l,c)=>{const h=this._localToSvgRoot(t,l.x,l.y);this._createHandle(e,h.x,h.y,"resize-corner",c,"rect")})}_renderCircleHandles(e,t){const i=w(t,"cx"),s=w(t,"cy"),n=w(t,"r");[{x:i+n,y:s},{x:i,y:s+n},{x:i-n,y:s},{x:i,y:s-n}].forEach((a,l)=>{const c=this._localToSvgRoot(t,a.x,a.y);this._createHandle(e,c.x,c.y,"resize-edge",l,"rect")})}_renderEllipseHandles(e,t){const i=w(t,"cx"),s=w(t,"cy"),n=w(t,"rx"),o=w(t,"ry");[{x:i+n,y:s},{x:i,y:s+o},{x:i-n,y:s},{x:i,y:s-o}].forEach((l,c)=>{const h=this._localToSvgRoot(t,l.x,l.y);this._createHandle(e,h.x,h.y,"resize-edge",c,"rect")})}_renderPathHandles(e,t){const i=t.getAttribute("d")||"",s=Ui(i),n=Jn(s),o="http://www.w3.org/2000/svg",a=this._screenDistToSvgDist(.75);for(let l=0;l<n.length;l++)if(n[l].type==="control"){let c=null;if(l>0&&n[l-1].type==="endpoint"&&(c=n[l-1]),l+1<n.length&&n[l+1].type==="endpoint"&&(c=n[l+1]),c||(l+2<n.length&&n[l+2].type==="endpoint"&&(c=n[l+2]),l>=2&&n[l-2].type==="endpoint"&&(c=n[l-2])),c){const h=this._localToSvgRoot(t,n[l].x,n[l].y),d=this._localToSvgRoot(t,c.x,c.y),p=document.createElementNS(o,"line");p.setAttribute("x1",h.x),p.setAttribute("y1",h.y),p.setAttribute("x2",d.x),p.setAttribute("y2",d.y),p.setAttribute("stroke","#4fc3f7"),p.setAttribute("stroke-width",a),p.setAttribute("stroke-opacity","0.4"),p.setAttribute("stroke-dasharray",`${this._screenDistToSvgDist(2)} ${this._screenDistToSvgDist(2)}`),p.setAttribute("pointer-events","none"),p.classList.add(K),p.dataset.handleType="guide",p.dataset.handleIndex="0",e.appendChild(p)}}n.forEach((l,c)=>{const h=this._localToSvgRoot(t,l.x,l.y),d=l.type==="control"?"path-control":"path-point",p=l.type==="control"?"diamond":"circle";this._createHandle(e,h.x,h.y,d,c,p)}),this._handleGroup&&(this._handleGroup._pathPoints=n,this._handleGroup._pathCommands=s)}_startElementDrag(e,t){const i=e.tagName.toLowerCase();if(["rect","text"].includes(i))this._dragState={mode:"translate",element:e,startSvg:{...t},attrMode:"xy",origX:w(e,"x"),origY:w(e,"y")};else if(["circle","ellipse"].includes(i))this._dragState={mode:"translate",element:e,startSvg:{...t},attrMode:"cxcy",origX:w(e,"cx"),origY:w(e,"cy")};else{const{tx:s,ty:n}=$e(e);this._dragState={mode:"translate",element:e,startSvg:{...t},attrMode:"transform",origX:s,origY:n}}}_startLineDrag(e,t){const i=w(e,"x1"),s=w(e,"y1"),n=w(e,"x2"),o=w(e,"y2");this._dragState={mode:"line-whole",element:e,startSvg:{...t},origX1:i,origY1:s,origX2:n,origY2:o}}_startPolyDrag(e,t){const i=Ce(e);this._dragState={mode:"poly-whole",element:e,startSvg:{...t},origPoints:i.map(s=>({...s}))}}_startPathDrag(e,t){const i=e.getAttribute("d")||"";Ui(i);const{tx:s,ty:n}=$e(e);this._dragState={mode:"translate",element:e,startSvg:{...t},attrMode:"transform",origX:s,origY:n}}_startMultiDrag(e){const t=[];for(const i of this._multiSelected){const s=i.tagName.toLowerCase();if(pe(i).drag)if(s==="line")t.push({el:i,kind:"line",origX1:w(i,"x1"),origY1:w(i,"y1"),origX2:w(i,"x2"),origY2:w(i,"y2")});else if(s==="polyline"||s==="polygon")t.push({el:i,kind:"poly",origPoints:Ce(i).map(o=>({...o}))});else if(["rect","text","image","foreignobject"].includes(s))t.push({el:i,kind:"xy",origX:w(i,"x"),origY:w(i,"y")});else if(s==="circle"||s==="ellipse")t.push({el:i,kind:"cxcy",origX:w(i,"cx"),origY:w(i,"cy")});else{const{tx:o,ty:a}=$e(i);t.push({el:i,kind:"transform",origX:o,origY:a})}}this._dragState={mode:"multi-translate",startSvg:{...e},snapshots:t}}_applyMultiTranslate(e,t){const i=this._dragState;for(const s of i.snapshots){const n=s.el;if(s.kind==="xy")n.setAttribute("x",s.origX+e),n.setAttribute("y",s.origY+t);else if(s.kind==="cxcy")n.setAttribute("cx",s.origX+e),n.setAttribute("cy",s.origY+t);else if(s.kind==="transform")We(n,s.origX+e,s.origY+t);else if(s.kind==="line")n.setAttribute("x1",s.origX1+e),n.setAttribute("y1",s.origY1+t),n.setAttribute("x2",s.origX2+e),n.setAttribute("y2",s.origY2+t);else if(s.kind==="poly"){const o=s.origPoints.map(a=>({x:a.x+e,y:a.y+t}));n.setAttribute("points",Ke(o))}}}_startHandleDrag(e,t,i,s){const n=this._selected;if(!n)return;const o=n.tagName.toLowerCase();if(e.type==="endpoint"){if(o==="line")this._dragState={mode:"line-endpoint",element:n,startSvg:{...t},endpointIndex:e.index};else if(o==="polyline"||o==="polygon"){const a=Ce(n);this._dragState={mode:"poly-vertex",element:n,startSvg:{...t},vertexIndex:e.index,origPoints:a.map(l=>({...l}))}}}else if(e.type==="path-point"||e.type==="path-control"){const a=this._handleGroup;a&&a._pathPoints&&a._pathCommands&&a._pathPoints[e.index]&&(this._dragState={mode:"path-point",element:n,startSvg:{...t},pointIndex:e.index,pathPoints:a._pathPoints.map(c=>({...c})),pathCommands:a._pathCommands.map(c=>({cmd:c.cmd,args:[...c.args]}))})}else(e.type==="resize-corner"||e.type==="resize-edge")&&(this._dragState={mode:"resize",element:n,startSvg:{...t},handleType:e.type,handleIndex:e.index,...this._snapshotGeometry(n)})}_snapshotGeometry(e){const t=e.tagName.toLowerCase();return t==="rect"?{geomType:"rect",origX:w(e,"x"),origY:w(e,"y"),origW:w(e,"width"),origH:w(e,"height")}:t==="circle"?{geomType:"circle",origCx:w(e,"cx"),origCy:w(e,"cy"),origR:w(e,"r")}:t==="ellipse"?{geomType:"ellipse",origCx:w(e,"cx"),origCy:w(e,"cy"),origRx:w(e,"rx"),origRy:w(e,"ry")}:{}}_applyTranslate(e,t){const i=this._dragState,s=i.element;i.attrMode==="xy"?(s.setAttribute("x",i.origX+e),s.setAttribute("y",i.origY+t)):i.attrMode==="cxcy"?(s.setAttribute("cx",i.origX+e),s.setAttribute("cy",i.origY+t)):i.attrMode==="transform"&&We(s,i.origX+e,i.origY+t)}_applyLineWhole(e,t){const i=this._dragState,s=i.element;s.setAttribute("x1",i.origX1+e),s.setAttribute("y1",i.origY1+t),s.setAttribute("x2",i.origX2+e),s.setAttribute("y2",i.origY2+t)}_applyLineEndpoint(e){const t=this._dragState,i=t.element;t.endpointIndex===0?(i.setAttribute("x1",e.x),i.setAttribute("y1",e.y)):(i.setAttribute("x2",e.x),i.setAttribute("y2",e.y))}_applyPolyWhole(e,t){const i=this._dragState,s=i.element,n=i.origPoints.map(o=>({x:o.x+e,y:o.y+t}));s.setAttribute("points",Ke(n))}_applyPolyVertex(e){const t=this._dragState,i=t.element,s=t.origPoints.map(n=>({...n}));s[t.vertexIndex]={x:e.x,y:e.y},i.setAttribute("points",Ke(s))}_applyPathPoint(e){const t=this._dragState,i=t.element,s=t.pathPoints[t.pointIndex];if(!s)return;const n=t.pathCommands.map(l=>({cmd:l.cmd,args:[...l.args]})),o=n[s.cmdIndex];if(!o)return;if(o.cmd!==o.cmd.toUpperCase()){const l=t.pathCommands[s.cmdIndex],c=e.x-s.x,h=e.y-s.y;o.args[s.argIndex]=l.args[s.argIndex]+c,o.args[s.argIndex+1]=l.args[s.argIndex+1]+h}else o.args[s.argIndex]=e.x,o.args[s.argIndex+1]=e.y;i.setAttribute("d",Gn(n))}_applyResize(e){const t=this._dragState,i=t.element,s=e.x-t.startSvg.x,n=e.y-t.startSvg.y;t.geomType==="rect"?this._applyRectResize(i,t,s,n):t.geomType==="circle"?this._applyCircleResize(i,t,e):t.geomType==="ellipse"&&this._applyEllipseResize(i,t,e)}_applyRectResize(e,t,i,s){const n=t.handleIndex;let o=t.origX,a=t.origY,l=t.origW,c=t.origH;n===0?(o+=i,a+=s,l-=i,c-=s):n===1?(a+=s,l+=i,c-=s):n===2?(l+=i,c+=s):n===3&&(o+=i,l-=i,c+=s),l<1&&(l=1),c<1&&(c=1),e.setAttribute("x",o),e.setAttribute("y",a),e.setAttribute("width",l),e.setAttribute("height",c)}_applyCircleResize(e,t,i){const s=t.origCx,n=t.origCy,o=Math.max(1,Math.hypot(i.x-s,i.y-n));e.setAttribute("r",o)}_applyEllipseResize(e,t,i){const s=t.origCx,n=t.origCy,o=t.handleIndex;o===0||o===2?e.setAttribute("rx",Math.max(1,Math.abs(i.x-s))):e.setAttribute("ry",Math.max(1,Math.abs(i.y-n)))}}class Pt extends V(L){constructor(){super(),this._files=[],this._activeIndex=-1,this._dirtySet=new Set,this._zoomLevel=100,this._mode="select",this._selectedTag="",this._panZoomLeft=null,this._panZoomRight=null,this._svgEditor=null,this._resizeObserver=null,this._undoStack=[],this._onKeyDown=this._onKeyDown.bind(this),this._onContextMenu=this._onContextMenu.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._onKeyDown)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._onKeyDown),this._dismissContextMenu(),this._disposeAll(),this._resizeObserver&&(this._resizeObserver.disconnect(),this._resizeObserver=null)}firstUpdated(){const e=this.shadowRoot.querySelector(".diff-container");e&&(this._resizeObserver=new ResizeObserver(()=>this._handleResize()),this._resizeObserver.observe(e))}async openFile(e){const{path:t}=e;if(!t)return;const i=this._files.findIndex(l=>l.path===t);if(i!==-1){this._activeIndex=i,await this.updateComplete,this._injectSvgContent(),this._dispatchActiveFileChanged(t);return}let s=e.original??"",n=e.modified??"",o=e.is_new??!1;if(!s&&!n){const l=await this._fetchSvgContent(t);if(l===null){console.warn("SVG viewer: no content for",t);return}s=l.original,n=l.modified,o=l.is_new}console.log(`SVG viewer: opening ${t} (original: ${s.length} chars, modified: ${n.length} chars, new: ${o})`);const a={path:t,original:s,modified:n,is_new:o,savedContent:n};this._files=[...this._files,a],this._activeIndex=this._files.length-1,this._undoStack=[n],await this.updateComplete,this._injectSvgContent(),this._dispatchActiveFileChanged(t)}async refreshOpenFiles(){const e=[];let t=!1;for(const i of this._files){const s=await this._fetchSvgContent(i.path);if(s===null){e.push(i);continue}e.push({...i,original:s.original,modified:s.modified,is_new:s.is_new,savedContent:s.modified}),t=!0}t&&(this._files=e,this._dirtySet=new Set,await this.updateComplete,this._injectSvgContent())}closeFile(e){const t=this._files.findIndex(i=>i.path===e);t!==-1&&(this._dirtySet.delete(e),this._files=this._files.filter(i=>i.path!==e),this._files.length===0?(this._activeIndex=-1,this._disposeAll(),this._dispatchActiveFileChanged(null)):this._activeIndex>=this._files.length?(this._activeIndex=this._files.length-1,this.updateComplete.then(()=>this._injectSvgContent()),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)):t<=this._activeIndex&&(this._activeIndex=Math.max(0,this._activeIndex-1),this.updateComplete.then(()=>this._injectSvgContent()),this._dispatchActiveFileChanged(this._files[this._activeIndex].path)))}getDirtyFiles(){return[...this._dirtySet]}async _fetchSvgContent(e){if(!this.rpcConnected)return console.warn("SVG viewer: RPC not connected, cannot fetch",e),null;try{let t="",i="",s=!1,n="";try{const a=await this.rpcExtract("Repo.get_file_content",e,"HEAD");n=typeof a=="string"?a:(a==null?void 0:a.content)??""}catch{}let o="";try{const a=await this.rpcExtract("Repo.get_file_content",e);o=typeof a=="string"?a:(a==null?void 0:a.content)??""}catch{}return!n&&!o?(console.warn("SVG file not found:",e),null):(n||(s=!0),t=n,i=o||n,{original:t,modified:i,is_new:s})}catch(t){return console.warn("Failed to fetch SVG content:",e,t),null}}_setMode(e){e!==this._mode&&(this._captureEditorContent(),this._mode=e,this._selectedTag="",this.updateComplete.then(()=>this._injectSvgContent()))}_captureEditorContent(){if(!this._svgEditor)return;const e=this._getActiveFile();if(!e)return;const t=this._svgEditor.getContent();t&&t!==e.modified&&(e.modified=t)}_disposeAll(){this._disposePanZoom(),this._disposeEditor()}_disposePanZoom(){if(this._panZoomLeft){try{this._panZoomLeft.destroy()}catch{}this._panZoomLeft=null}if(this._panZoomRight){try{this._panZoomRight.destroy()}catch{}this._panZoomRight=null}}_disposeEditor(){this._svgEditor&&(this._svgEditor.dispose(),this._svgEditor=null)}_initLeftPanZoom(){if(this._panZoomLeft){try{this._panZoomLeft.destroy()}catch{}this._panZoomLeft=null}const e=this.shadowRoot.querySelector(".svg-left svg");if(e){try{const t=e.getBBox();if(t.width>0&&t.height>0){const s=t.x-t.width*.03,n=t.y-t.height*.03,o=t.width*(1+.03*2),a=t.height*(1+.03*2);e.setAttribute("viewBox",`${s} ${n} ${o} ${a}`)}}catch{}try{this._panZoomLeft=Ni(e,{zoomEnabled:!0,panEnabled:!0,controlIconsEnabled:!1,fit:!0,center:!0,minZoom:.1,maxZoom:40,zoomScaleSensitivity:.3,dblClickZoomEnabled:!0})}catch(t){console.warn("svg-pan-zoom init failed for left panel:",t)}this._zoomLevel=100}}_initRightPanZoom(){if(this._panZoomRight){try{this._panZoomRight.destroy()}catch{}this._panZoomRight=null}const e=this.shadowRoot.querySelector(".svg-right svg");if(e){try{this._panZoomRight=Ni(e,{zoomEnabled:!0,panEnabled:!0,controlIconsEnabled:!1,fit:!0,center:!0,minZoom:.1,maxZoom:40,zoomScaleSensitivity:.3,dblClickZoomEnabled:!0})}catch(t){console.warn("svg-pan-zoom init failed for right panel:",t)}this._syncLeftToRight()}}_initEditor(){this._disposeEditor();const e=this.shadowRoot.querySelector(".svg-right svg");if(!e)return;const t=this._getActiveFile();this._svgEditor=new Qn(e,{onDirty:()=>{var i;if(t){this._dirtySet.add(t.path),this._dirtySet=new Set(this._dirtySet);const s=(i=this._svgEditor)==null?void 0:i.getContent();s&&(this._undoStack.push(s),this._undoStack.length>50&&this._undoStack.shift())}},onSelect:i=>{this._svgEditor&&this._svgEditor._multiSelected.size>1?this._selectedTag=`${this._svgEditor._multiSelected.size} elements`:this._selectedTag=i?`<${i.tagName.toLowerCase()}>`:""},onDeselect:()=>{this._selectedTag=""},onZoom:({zoom:i})=>{this._zoomLevel=Math.round(i*100)}})}_syncLeftToRight(){if(this._panZoomLeft){if(this._mode==="pan"&&this._panZoomRight){const e=this._panZoomLeft.getZoom(),t=this._panZoomLeft.getPan();this._panZoomRight.zoom(e),this._panZoomRight.pan(t)}else if(this._mode==="select"&&this._svgEditor){const e=this.shadowRoot.querySelector(".svg-left svg");if(e){const t=this._getOriginalViewBox(e);if(t){const i=this._panZoomLeft.getZoom(),s=this._panZoomLeft.getPan(),n=t.w/i,o=t.h/i,a=t.x-s.x/i,l=t.y-s.y/i;this._svgEditor.setViewBox(a,l,n,o)}}}}}_syncRightToLeft(e){if(!(!this._panZoomLeft||this._syncing)){this._syncing=!0;try{const t=this.shadowRoot.querySelector(".svg-left svg");if(!t)return;if(t.querySelector(".svg-pan-zoom_viewport")&&e){const s=this._getOriginalViewBox(t);if(s){const n=s.w/e.w,o=s.h/e.h,a=Math.min(n,o),l=-(e.x-s.x)*a,c=-(e.y-s.y)*a;this._panZoomLeft.zoom(a),this._panZoomLeft.pan({x:l,y:c})}}}finally{this._syncing=!1}}}_getOriginalViewBox(e){var s;const t=(s=e.viewBox)==null?void 0:s.baseVal;if(t&&t.width>0)return{x:t.x,y:t.y,w:t.width,h:t.height};const i=e.getAttribute("viewBox");if(i){const n=i.split(/[\s,]+/).map(Number);return{x:n[0]||0,y:n[1]||0,w:n[2]||800,h:n[3]||600}}return{x:0,y:0,w:800,h:600}}_handleResize(){this._panZoomLeft&&this._panZoomLeft.resize(),this._panZoomRight&&this._panZoomRight.resize()}_zoomIn(){this._panZoomLeft&&this._panZoomLeft.zoomIn()}_zoomOut(){this._panZoomLeft&&this._panZoomLeft.zoomOut()}_zoomReset(){this._panZoomLeft&&(this._panZoomLeft.resetZoom(),this._panZoomLeft.resetPan()),this._panZoomRight&&(this._panZoomRight.resetZoom(),this._panZoomRight.resetPan()),this._zoomLevel=100}_fitAll(){this._panZoomLeft&&(this._panZoomLeft.resize(),this._panZoomLeft.fit(),this._panZoomLeft.center(),this._zoomLevel=Math.round(this._panZoomLeft.getZoom()*100)),this._panZoomRight&&(this._panZoomRight.resize(),this._panZoomRight.fit(),this._panZoomRight.center()),this._mode==="select"&&this._svgEditor&&(this._svgEditor.fitContent(),this._zoomLevel=Math.round(this._svgEditor.zoomLevel*100))}_undo(){if(this._undoStack.length<=1)return;this._undoStack.pop();const e=this._undoStack[this._undoStack.length-1];if(!e)return;const t=this._getActiveFile();t&&(t.modified=e,this._injectSvgContent())}async _save(){const e=this._getActiveFile();if(e){if(this._captureEditorContent(),!this.rpcConnected){console.warn("SVG viewer: RPC not connected, cannot save");return}try{await this.rpcCall("Repo.write_file",e.path,e.modified),e.savedContent=e.modified,this._dirtySet.delete(e.path),this._dirtySet=new Set(this._dirtySet),this.dispatchEvent(new CustomEvent("file-saved",{bubbles:!0,composed:!0,detail:{path:e.path,content:e.modified}}))}catch(t){console.error("Failed to save SVG:",t)}}}async _copyImage(){var i;const e=this._getActiveFile();if(!e)return;this._captureEditorContent();const t=e.modified||e.original||"";if(t.trim())try{const o=new DOMParser().parseFromString(t,"image/svg+xml").documentElement;let a=1920,l=1080;const c=o.getAttribute("viewBox");if(c){const x=c.split(/[\s,]+/).map(Number);x[2]>0&&x[3]>0&&(a=x[2],l=x[3])}else{const x=parseFloat(o.getAttribute("width")),E=parseFloat(o.getAttribute("height"));x>0&&E>0&&(a=x,l=E)}const h=Math.max(a,l),d=h<1024?Math.min(4,4096/h):Math.min(2,4096/h),p=Math.round(a*d),_=Math.round(l*d);o.setAttribute("width",p),o.setAttribute("height",_);const g=new XMLSerializer,y=new Blob([g.serializeToString(o)],{type:"image/svg+xml;charset=utf-8"}),u=URL.createObjectURL(y),f=new Image;f.width=p,f.height=_,await new Promise((x,E)=>{f.onload=x,f.onerror=E,f.src=u});const b=document.createElement("canvas");b.width=p,b.height=_;const S=b.getContext("2d");if(S.fillStyle="#ffffff",S.fillRect(0,0,p,_),S.drawImage(f,0,0,p,_),URL.revokeObjectURL(u),(i=navigator.clipboard)!=null&&i.write){const x=new Promise(E=>b.toBlob(E,"image/png"));try{await navigator.clipboard.write([new ClipboardItem({"image/png":x})]),this._showCopyToast("Image copied to clipboard")}catch(E){console.warn("Clipboard write failed, falling back to download:",E);const O=await x;this._downloadBlob(O,e.path)}}else{const x=await new Promise(E=>b.toBlob(E,"image/png"));this._downloadBlob(x,e.path)}}catch(s){console.error("Failed to copy SVG as image:",s),this._showCopyToast("Failed to copy image")}}_showCopyToast(e){this.dispatchEvent(new CustomEvent("show-toast",{bubbles:!0,composed:!0,detail:{message:e,type:"info"}}))}_downloadBlob(e,t){if(!e){this._showCopyToast("Failed to create image");return}const i=document.createElement("a");i.href=URL.createObjectURL(e),i.download=(t.split("/").pop()||"image").replace(/\.svg$/i,"")+".png",i.click(),URL.revokeObjectURL(i.href),this._showCopyToast("Image downloaded as PNG")}_onContextMenu(e){const t=this.shadowRoot.querySelector(".svg-right");if(!t||!t.contains(e.target))return;e.preventDefault(),this._dismissContextMenu();const i=this.shadowRoot.querySelector(".diff-container");if(!i)return;const s=i.getBoundingClientRect(),n=e.clientX-s.left,o=e.clientY-s.top,a=document.createElement("div");a.className="context-menu",a.style.left=`${n}px`,a.style.top=`${o}px`;const l=document.createElement("button");l.innerHTML='📋 Copy as PNG <span class="shortcut">Ctrl+Shift+C</span>',l.addEventListener("click",()=>{this._dismissContextMenu(),this._copyImage()}),a.appendChild(l),i.appendChild(a),this._contextMenu=a;const c=h=>{a.contains(h.target)||this._dismissContextMenu()};setTimeout(()=>{window.addEventListener("click",c,{capture:!0}),window.addEventListener("contextmenu",c,{capture:!0}),this._contextMenuDismiss=()=>{window.removeEventListener("click",c,{capture:!0}),window.removeEventListener("contextmenu",c,{capture:!0})}},0)}_dismissContextMenu(){this._contextMenu&&(this._contextMenu.remove(),this._contextMenu=null),this._contextMenuDismiss&&(this._contextMenuDismiss(),this._contextMenuDismiss=null)}_onKeyDown(e){if((e.ctrlKey||e.metaKey)&&e.key==="PageDown"){e.preventDefault(),this._files.length>1&&(this._captureEditorContent(),this._activeIndex=(this._activeIndex+1)%this._files.length,this.updateComplete.then(()=>this._injectSvgContent()),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}if((e.ctrlKey||e.metaKey)&&e.key==="PageUp"){e.preventDefault(),this._files.length>1&&(this._captureEditorContent(),this._activeIndex=(this._activeIndex-1+this._files.length)%this._files.length,this.updateComplete.then(()=>this._injectSvgContent()),this._dispatchActiveFileChanged(this._files[this._activeIndex].path));return}if((e.ctrlKey||e.metaKey)&&e.key==="w"){e.preventDefault(),this._files.length>0&&this._activeIndex>=0&&(this._captureEditorContent(),this.closeFile(this._files[this._activeIndex].path));return}if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault(),this._save();return}if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==="C"){e.preventDefault(),this._copyImage();return}if((e.ctrlKey||e.metaKey)&&e.key==="z"){this._mode==="select"&&(e.preventDefault(),this._undo());return}}_dispatchActiveFileChanged(e){window.dispatchEvent(new CustomEvent("active-file-changed",{detail:{path:e}}))}_getActiveFile(){return this._activeIndex>=0&&this._activeIndex<this._files.length?this._files[this._activeIndex]:null}updated(e){(e.has("_activeIndex")||e.has("_files"))&&this._injectSvgContent()}_prepareSvgElement(e,{editable:t=!1}={}){const i=e.querySelector("svg");if(i){if(i.style.width="100%",i.style.height="100%",!i.getAttribute("viewBox")){const s=i.getAttribute("width")||"800",n=i.getAttribute("height")||"600";i.setAttribute("viewBox",`0 0 ${parseFloat(s)} ${parseFloat(n)}`)}i.removeAttribute("width"),i.removeAttribute("height"),t&&i.setAttribute("preserveAspectRatio","none")}}_injectSvgContent(){const e=this._getActiveFile(),t=this.shadowRoot.querySelector(".svg-left"),i=this.shadowRoot.querySelector(".svg-right");if(!e)return;if(!t||!i){requestAnimationFrame(()=>this._injectSvgContent());return}this._injectGeneration==null&&(this._injectGeneration=0);const s=++this._injectGeneration;this._disposeAll();const n=e.original||e.modified||"",o=e.modified||"";t.innerHTML=n.trim()||'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>',i.innerHTML=o.trim()||'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>',this._prepareSvgElement(t),this._prepareSvgElement(i),i.removeEventListener("contextmenu",this._onContextMenu),i.addEventListener("contextmenu",this._onContextMenu),requestAnimationFrame(()=>{s===this._injectGeneration&&(this._initLeftPanZoom(),this._mode==="select"?this._initEditor():this._initRightPanZoom(),requestAnimationFrame(()=>{s===this._injectGeneration&&this._fitAll()}))})}render(){const t=this._files.length>0?this._getActiveFile():null,i=t&&this._dirtySet.has(t.path);return m`
      <div class="diff-container">
        ${t?m`
          <button
            class="status-led ${i?"dirty":t.is_new?"new-file":"clean"}"
            title="${t.path}${i?" — unsaved (Ctrl+S to save)":t.is_new?" — new file":""}"
            aria-label="${t.path}${i?", unsaved changes, press to save":t.is_new?", new file":", no changes"}"
            @click=${()=>i?this._save():null}
          ></button>
          <button class="fit-btn" @click=${this._fitAll} title="Fit to view">⊡</button>
          <div class="diff-panel">
            <div class="svg-container svg-left"></div>
          </div>
          <div class="splitter"></div>
          <div class="diff-panel">
            <div class="svg-container svg-right"></div>
          </div>
        `:m`
          <div class="empty-state">
            <div class="watermark">AC⚡DC</div>
          </div>
        `}
      </div>

    `}}C(Pt,"properties",{_files:{type:Array,state:!0},_activeIndex:{type:Number,state:!0},_dirtySet:{type:Object,state:!0},_zoomLevel:{type:Number,state:!0},_mode:{type:String,state:!0},_selectedTag:{type:String,state:!0}}),C(Pt,"styles",[F,j,z`
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

    /* Fit button — floating bottom-right */
    .fit-btn {
      position: absolute;
      bottom: 12px;
      right: 16px;
      z-index: 10;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: 1px solid var(--border-primary);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-size: 1rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .fit-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    /* Splitter handle */
    .splitter {
      width: 4px;
      background: transparent;
      flex-shrink: 0;
      z-index: 1;
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

    /* Context menu */
    .context-menu {
      position: absolute;
      z-index: 100;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      min-width: 160px;
    }
    .context-menu button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 14px;
      background: none;
      border: none;
      color: var(--text-primary);
      font-size: 0.75rem;
      cursor: pointer;
      text-align: left;
    }
    .context-menu button:hover {
      background: var(--bg-hover);
    }
    .context-menu button .shortcut {
      margin-left: auto;
      color: var(--text-muted);
      font-size: 0.65rem;
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
  `]);customElements.define("ac-svg-viewer",Pt);function I(r){return r==null?"—":r>=1e3?(r/1e3).toFixed(1)+"K":String(r)}class Ft extends V(L){constructor(){super(),this._visible=!1,this._fading=!1,this._data=null,this._basicData=null,this._collapsed=this._loadCollapsedSections(),this._hideTimer=null,this._fadeTimer=null,this._hovered=!1,this._onStreamComplete=this._onStreamComplete.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-complete",this._onStreamComplete)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-complete",this._onStreamComplete),this._clearTimers()}_onStreamComplete(e){var i;const t=(i=e.detail)==null?void 0:i.result;!t||t.error||(this._basicData=t.token_usage||null,this._data=null,this._visible=!0,this._fading=!1,this._startAutoHide(),this._fetchBreakdown())}async _fetchBreakdown(){if(this.rpcConnected)try{const e=await this.rpcExtract("LLMService.get_context_breakdown");e&&(this._data=e)}catch(e){console.warn("Token HUD: failed to fetch breakdown:",e)}}_startAutoHide(){this._clearTimers(),this._hideTimer=setTimeout(()=>{this._hovered||(this._fading=!0,this._fadeTimer=setTimeout(()=>{this._visible=!1,this._fading=!1},800))},8e3)}_clearTimers(){this._hideTimer&&(clearTimeout(this._hideTimer),this._hideTimer=null),this._fadeTimer&&(clearTimeout(this._fadeTimer),this._fadeTimer=null)}_onMouseEnter(){this._hovered=!0,this._fading=!1,this._clearTimers()}_onMouseLeave(){this._hovered=!1,this._startAutoHide()}_dismiss(){this._clearTimers(),this._visible=!1,this._fading=!1}_toggleSection(e){const t=new Set(this._collapsed);t.has(e)?t.delete(e):t.add(e),this._collapsed=t,this._saveCollapsedSections(t)}_saveCollapsedSections(e){try{localStorage.setItem("ac-dc-hud-collapsed",JSON.stringify([...e]))}catch{}}_loadCollapsedSections(){try{const e=localStorage.getItem("ac-dc-hud-collapsed");if(e)return new Set(JSON.parse(e))}catch{}return new Set}_isExpanded(e){return!this._collapsed.has(e)}_getCacheBadge(e){if(e==null)return v;const t=Math.min(100,Math.max(0,e*100)).toFixed(0);let i="low";return e>=.5?i="good":e>=.2&&(i="ok"),m`<span class="cache-badge ${i}">${t}% cache</span>`}_getBudgetColor(e){return e>90?"red":e>75?"yellow":"green"}_renderHeader(){const e=this._data,t=(e==null?void 0:e.model)||"—",i=(e==null?void 0:e.provider_cache_rate)??(e==null?void 0:e.cache_hit_rate);return m`
      <div class="hud-header">
        <span class="hud-title">
          ${t}
          ${this._getCacheBadge(i)}
        </span>
        <button class="dismiss-btn" @click=${this._dismiss} title="Dismiss" aria-label="Dismiss token usage overlay">✕</button>
      </div>
    `}_getSubIcon(e){switch(e){case"system":return"⚙️";case"symbols":return"📦";case"files":return"📄";case"urls":return"🔗";case"history":return"💬";default:return"•"}}_getSubLabel(e){return e.name||e.path||e.type||"—"}_renderCacheTiers(){const e=this._data;if(!(e!=null&&e.blocks))return v;const t=Math.max(1,...e.blocks.map(i=>i.tokens||0));return m`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("tiers")}"
             @click=${()=>this._toggleSection("tiers")}
             @keydown=${i=>{(i.key==="Enter"||i.key===" ")&&(i.preventDefault(),this._toggleSection("tiers"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("tiers")?"▼":"▶"}</span>
          Cache Tiers
        </div>
        <div class="section-body ${this._isExpanded("tiers")?"":"collapsed"}">
          ${e.blocks.map(i=>{const s=t>0?i.tokens/t*100:0,n=(i.tier||i.name||"active").toLowerCase().replace(/[^a-z0-9]/g,""),o=i.contents||[];return m`
              <div class="tier-row">
                <span class="tier-label">${i.name||i.tier||"?"}</span>
                <div class="tier-bar">
                  <div class="tier-bar-fill ${n}" style="width: ${s}%"></div>
                </div>
                <span class="tier-tokens">${I(i.tokens)}</span>
                ${i.cached?m`<span class="tier-cached">🔒</span>`:v}
              </div>
              ${o.map(a=>{const l=a.n!=null?a.n:null,c=a.threshold,h=l!=null&&c?Math.min(100,l/c*100):0,d={L0:"var(--accent-green)",L1:"#26a69a",L2:"var(--accent-primary)",L3:"var(--accent-yellow)",active:"var(--accent-orange)"}[i.tier||i.name]||"var(--text-muted)";return m`
                <div class="tier-sub">
                  <span class="tier-sub-icon">${this._getSubIcon(a.type)}</span>
                  <span class="tier-sub-label">${this._getSubLabel(a)}</span>
                  ${l!=null?m`
                    <span class="tier-sub-n" title="N=${l}/${c||"?"}">${l}/${c||"?"}</span>
                    <div class="tier-sub-bar" title="N=${l}/${c||"?"}">
                      <div class="tier-sub-bar-fill" style="width: ${h}%; background: ${d}"></div>
                    </div>
                  `:v}
                  <span class="tier-sub-tokens">${I(a.tokens)}</span>
                </div>
              `})}
            `})}
        </div>
      </div>
    `}_renderThisRequest(){var o;const e=this._basicData||((o=this._data)==null?void 0:o.token_usage);if(!e)return v;const t=e.input_tokens||e.prompt_tokens||0,i=e.output_tokens||e.completion_tokens||0,s=e.cache_read_tokens||e.cache_read_input_tokens||0,n=e.cache_write_tokens||e.cache_creation_input_tokens||0;return m`
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
            <span class="stat-value">${I(t)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Completion</span>
            <span class="stat-value">${I(i)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Cache Read</span>
            <span class="stat-value ${s>0?"green":""}">${I(s)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Cache Write</span>
            <span class="stat-value ${n>0?"yellow":""}">${I(n)}</span>
          </div>
        </div>
      </div>
    `}_renderHistoryBudget(){const e=this._data;if(!e)return v;const t=e.breakdown;if(!t)return v;const i=t.history||0,s=e.total_tokens||0,n=e.max_input_tokens||1,o=Math.min(100,s/n*100),a=this._getBudgetColor(o);return m`
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
            <span class="stat-value">${I(s)} / ${I(n)}</span>
          </div>
          <div class="budget-bar">
            <div class="budget-bar-fill ${a}" style="width: ${o}%"></div>
          </div>
          <div class="stat-row">
            <span class="stat-label">History</span>
            <span class="stat-value">${I(i)}</span>
          </div>
        </div>
      </div>
    `}_renderTierChanges(){const e=this._data,t=e==null?void 0:e.promotions,i=e==null?void 0:e.demotions;return!(t!=null&&t.length)&&!(i!=null&&i.length)?v:m`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded("changes")}"
             @click=${()=>this._toggleSection("changes")}
             @keydown=${s=>{(s.key==="Enter"||s.key===" ")&&(s.preventDefault(),this._toggleSection("changes"))}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded("changes")?"▼":"▶"}</span>
          Tier Changes
        </div>
        <div class="section-body ${this._isExpanded("changes")?"":"collapsed"}">
          ${(t||[]).map(s=>m`
            <div class="change-item">
              <span class="change-icon">📈</span>
              <span class="change-text" title="${s}">${s}</span>
            </div>
          `)}
          ${(i||[]).map(s=>m`
            <div class="change-item">
              <span class="change-icon">📉</span>
              <span class="change-text" title="${s}">${s}</span>
            </div>
          `)}
        </div>
      </div>
    `}_renderSessionTotals(){var t;const e=(t=this._data)==null?void 0:t.session_totals;return e?m`
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
            <span class="stat-value">${I(e.prompt)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Completion Out</span>
            <span class="stat-value">${I(e.completion)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Total</span>
            <span class="stat-value">${I(e.total)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Cache Read</span>
            <span class="stat-value ${e.cache_hit>0?"green":""}">${I(e.cache_hit)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Cache Write</span>
            <span class="stat-value ${e.cache_write>0?"yellow":""}">${I(e.cache_write)}</span>
          </div>
        </div>
      </div>
    `:v}render(){return this._visible?m`
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
    `:v}}C(Ft,"properties",{_visible:{type:Boolean,state:!0},_fading:{type:Boolean,state:!0},_data:{type:Object,state:!0},_basicData:{type:Object,state:!0},_collapsed:{type:Object,state:!0}}),C(Ft,"styles",[F,z`
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
  `]);customElements.define("ac-token-hud",Ft);const mt="ac-last-open-file",ji="ac-last-viewport";function ke(r,e){return e?`${r}:${e}`:r}function er(){const e=new URLSearchParams(window.location.search).get("port");return e?parseInt(e,10):18080}class Ot extends _s{constructor(){super(),this._port=er(),this._reconnectAttempt=0,this._reconnectTimer=null,this._statusBar="hidden",this._reconnectVisible=!1,this._reconnectMsg="",this._toasts=[],this._toastIdCounter=0,this._wasConnected=!1,this._statusBarTimer=null,this._startupVisible=!0,this._startupMessage="Connecting...",this._startupPercent=0,this._repoName=null,this.serverURI=`ws://localhost:${this._port}`,this.remoteTimeout=60,this._onNavigateFile=this._onNavigateFile.bind(this),this._onFileSave=this._onFileSave.bind(this),this._onStreamCompleteForDiff=this._onStreamCompleteForDiff.bind(this),this._onFilesModified=this._onFilesModified.bind(this),this._onSearchNavigate=this._onSearchNavigate.bind(this),this._onGlobalKeyDown=this._onGlobalKeyDown.bind(this),this._onToastEvent=this._onToastEvent.bind(this),this._onActiveFileChanged=this._onActiveFileChanged.bind(this),this._onBeforeUnload=this._onBeforeUnload.bind(this),this._onWindowResize=this._onWindowResize.bind(this),this._resizeRAF=null}connectedCallback(){super.connectedCallback(),console.log(`AC⚡DC connecting to ${this.serverURI}`),this.addClass(this,"AcApp"),window.addEventListener("navigate-file",this._onNavigateFile),window.addEventListener("file-save",this._onFileSave),window.addEventListener("stream-complete",this._onStreamCompleteForDiff),window.addEventListener("files-modified",this._onFilesModified),window.addEventListener("search-navigate",this._onSearchNavigate),window.addEventListener("active-file-changed",this._onActiveFileChanged),window.addEventListener("keydown",this._onGlobalKeyDown),window.addEventListener("ac-toast",this._onToastEvent),window.addEventListener("beforeunload",this._onBeforeUnload),window.addEventListener("resize",this._onWindowResize)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("navigate-file",this._onNavigateFile),window.removeEventListener("file-save",this._onFileSave),window.removeEventListener("stream-complete",this._onStreamCompleteForDiff),window.removeEventListener("files-modified",this._onFilesModified),window.removeEventListener("search-navigate",this._onSearchNavigate),window.removeEventListener("active-file-changed",this._onActiveFileChanged),window.removeEventListener("keydown",this._onGlobalKeyDown),window.removeEventListener("ac-toast",this._onToastEvent),window.removeEventListener("beforeunload",this._onBeforeUnload),window.removeEventListener("resize",this._onWindowResize),this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._statusBarTimer&&clearTimeout(this._statusBarTimer),this._resizeRAF&&(cancelAnimationFrame(this._resizeRAF),this._resizeRAF=null)}remoteIsUp(){console.log("WebSocket connected — remote is up, _wasConnected:",this._wasConnected,"_startupVisible:",this._startupVisible);const e=this._reconnectAttempt>0;this._reconnectAttempt=0,this._reconnectVisible=!1,this._reconnectMsg="",this._reconnectTimer&&(clearTimeout(this._reconnectTimer),this._reconnectTimer=null),this._showStatusBar("ok"),this._startupVisible&&(this._startupMessage="Connected — initializing...",this._startupPercent=5),e&&(this._showToast("Reconnected","success"),this._startupVisible=!1)}setupDone(){console.log("jrpc-oo setup done — call proxy ready, _wasConnected:",this._wasConnected,"_startupVisible:",this._startupVisible),this._wasConnected=!0,Me.set(this.call),this._loadInitialState()}setupSkip(){console.warn("jrpc-oo setup skipped — connection failed"),this._wasConnected&&this._scheduleReconnect()}remoteDisconnected(){console.log("WebSocket disconnected"),Me.clear(),this._showStatusBar("error",!1),window.dispatchEvent(new CustomEvent("rpc-disconnected")),this._scheduleReconnect()}_scheduleReconnect(){if(this._reconnectTimer)return;this._reconnectAttempt++;const e=Math.min(1e3*Math.pow(2,this._reconnectAttempt-1),15e3),t=(e/1e3).toFixed(0);this._reconnectMsg=`Reconnecting (attempt ${this._reconnectAttempt})... retry in ${t}s`,this._reconnectVisible=!0,console.log(`Scheduling reconnect attempt ${this._reconnectAttempt} in ${e}ms`),this._reconnectTimer=setTimeout(()=>{this._reconnectTimer=null,this._reconnectMsg=`Reconnecting (attempt ${this._reconnectAttempt})...`,this.requestUpdate();try{this.open(this.serverURI)}catch(i){console.error("Reconnect failed:",i),this._scheduleReconnect()}},e)}_showStatusBar(e,t=!0){this._statusBar=e,this._statusBarTimer&&(clearTimeout(this._statusBarTimer),this._statusBarTimer=null),t&&(this._statusBarTimer=setTimeout(()=>{this._statusBar="hidden"},3e3))}_onToastEvent(e){const{message:t,type:i}=e.detail||{};t&&this._showToast(t,i||"")}_showToast(e,t=""){const i=++this._toastIdCounter;this._toasts=[...this._toasts,{id:i,message:e,type:t,fading:!1}],setTimeout(()=>{this._toasts=this._toasts.map(s=>s.id===i?{...s,fading:!0}:s),setTimeout(()=>{this._toasts=this._toasts.filter(s=>s.id!==i)},300)},3e3)}streamChunk(e,t){return window.dispatchEvent(new CustomEvent("stream-chunk",{detail:{requestId:e,content:t}})),!0}streamComplete(e,t){return window.dispatchEvent(new CustomEvent("stream-complete",{detail:{requestId:e,result:t}})),!0}compactionEvent(e,t){return window.dispatchEvent(new CustomEvent("compaction-event",{detail:{requestId:e,event:t}})),!0}filesChanged(e){return window.dispatchEvent(new CustomEvent("files-changed",{detail:{selectedFiles:e}})),!0}startupProgress(e,t,i){return console.log(`startupProgress: stage=${e}, message=${t}, percent=${i}, _startupVisible=${this._startupVisible}`),e==="doc_index"?(i<100&&window.dispatchEvent(new CustomEvent("mode-switch-progress",{detail:{message:t||"",percent:i||0}})),!0):(this._startupMessage=t||"",typeof i=="number"&&(this._startupPercent=Math.min(100,Math.max(0,i))),e==="ready"&&(console.log("startupProgress: ready — dismissing overlay in 400ms"),setTimeout(()=>{console.log("startupProgress: dismissing overlay now"),this._startupVisible=!1},400)),!0)}async _loadInitialState(){try{const e=await this.call["LLMService.get_current_state"](),t=this._extract(e);console.log("Initial state loaded:",t),console.log("init_complete:",t==null?void 0:t.init_complete,"startupVisible:",this._startupVisible),t!=null&&t.repo_name&&(document.title=`${t.repo_name}`,this._repoName=t.repo_name),t!=null&&t.init_complete?(console.log("Server already initialized — dismissing startup overlay"),this._startupVisible=!1):console.log("Server not yet initialized — keeping startup overlay"),t!=null&&t.mode&&window.dispatchEvent(new CustomEvent("mode-changed",{detail:{mode:t.mode}})),window.dispatchEvent(new CustomEvent("state-loaded",{detail:t})),this._reopenLastFile()}catch(e){console.error("Failed to load initial state:",e)}}_extract(e){if(e&&typeof e=="object"){const t=Object.keys(e);if(t.length===1)return e[t[0]]}return e}_reopenLastFile(){try{const e=localStorage.getItem(ke(mt,this._repoName));if(!e)return;const t=localStorage.getItem(ke(ji,this._repoName));let i=null;if(t&&(i=JSON.parse(t),(i==null?void 0:i.path)!==e&&(i=null)),i&&i.type==="diff"){const s=n=>{var o;((o=n.detail)==null?void 0:o.path)===e&&(window.removeEventListener("active-file-changed",s),requestAnimationFrame(()=>{requestAnimationFrame(()=>{this._restoreViewportState(e,i)})}))};window.addEventListener("active-file-changed",s),setTimeout(()=>window.removeEventListener("active-file-changed",s),1e4)}window.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:e}}))}catch{}}_saveViewportState(){var e,t;try{const i=localStorage.getItem(ke(mt,this._repoName));if(!i||i.toLowerCase().endsWith(".svg"))return;const s=(e=this.shadowRoot)==null?void 0:e.querySelector("ac-diff-viewer");if(s){const n=((t=s.getViewportState)==null?void 0:t.call(s))??null;if(!n)return;const o={path:i,type:"diff",diff:n};localStorage.setItem(ke(ji,this._repoName),JSON.stringify(o))}}catch{}}_restoreViewportState(e,t){var i,s;try{if(t.type==="diff"&&t.diff){const n=(i=this.shadowRoot)==null?void 0:i.querySelector("ac-diff-viewer");n&&((s=n.restoreViewportState)==null||s.call(n,t.diff))}}catch{}}_onNavigateFile(e){var o,a;const t=e.detail;if(!(t!=null&&t.path))return;try{this._saveViewportState()}catch{}try{localStorage.setItem(ke(mt,this._repoName),t.path)}catch{}const i=t.path.toLowerCase().endsWith(".svg"),s=(o=this.shadowRoot)==null?void 0:o.querySelector("ac-diff-viewer"),n=(a=this.shadowRoot)==null?void 0:a.querySelector("ac-svg-viewer");if(s&&(s.classList.toggle("viewer-visible",!i),s.classList.toggle("viewer-hidden",i)),n&&(n.classList.toggle("viewer-visible",i),n.classList.toggle("viewer-hidden",!i)),i){if(!n)return;n.openFile({path:t.path,original:t.original,modified:t.modified,is_new:t.is_new})}else{if(!s)return;s.openFile({path:t.path,original:t.original,modified:t.modified,is_new:t.is_new,is_read_only:t.is_read_only,is_config:t.is_config,config_type:t.config_type,real_path:t.real_path,searchText:t.searchText,line:t.line})}}_onSearchNavigate(e){const t=e.detail;t!=null&&t.path&&this._onNavigateFile({detail:{path:t.path,line:t.line}})}async _onFileSave(e){const{path:t,content:i,isConfig:s,configType:n}=e.detail;if(t)try{s&&n?await this.call["Settings.save_config_content"](n,i):await this.call["Repo.write_file"](t,i)}catch(o){console.error("File save failed:",o),this._showToast(`Save failed: ${o.message||"Unknown error"}`,"error")}}_onStreamCompleteForDiff(e){var n,o,a,l;const t=(n=e.detail)==null?void 0:n.result;if(!((o=t==null?void 0:t.files_modified)!=null&&o.length))return;const i=(a=this.shadowRoot)==null?void 0:a.querySelector("ac-diff-viewer");i&&i.refreshOpenFiles();const s=(l=this.shadowRoot)==null?void 0:l.querySelector("ac-svg-viewer");s&&s.refreshOpenFiles()}_onFilesModified(e){var s,n;const t=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-diff-viewer");t&&t._files.length>0&&t.refreshOpenFiles();const i=(n=this.shadowRoot)==null?void 0:n.querySelector("ac-svg-viewer");i&&i._files.length>0&&i.refreshOpenFiles()}_onActiveFileChanged(e){var i,s,n;const t=(i=e.detail)==null?void 0:i.path;if(t){const o=t.toLowerCase().endsWith(".svg"),a=(s=this.shadowRoot)==null?void 0:s.querySelector("ac-diff-viewer"),l=(n=this.shadowRoot)==null?void 0:n.querySelector("ac-svg-viewer");a&&(a.classList.toggle("viewer-visible",!o),a.classList.toggle("viewer-hidden",o)),l&&(l.classList.toggle("viewer-visible",o),l.classList.toggle("viewer-hidden",!o))}}_onGlobalKeyDown(e){(e.ctrlKey||e.metaKey)&&e.key==="s"&&e.preventDefault()}_onBeforeUnload(){this._saveViewportState()}_onWindowResize(){this._resizeRAF||(this._resizeRAF=requestAnimationFrame(()=>{var t;this._resizeRAF=null;const e=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-diff-viewer");e!=null&&e._editor&&e._editor.layout()}))}render(){return m`
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

      ${this._startupVisible?m`
        <div class="startup-overlay" role="status" aria-live="polite" aria-label="Loading">
          <div class="startup-brand">AC⚡DC</div>
          <div class="startup-message">${this._startupMessage}</div>
          <div class="startup-bar-track">
            <div class="startup-bar-fill" style="width: ${this._startupPercent}%"></div>
          </div>
        </div>
      `:""}

      <div class="status-bar ${this._statusBar}" role="status" aria-live="polite"
           aria-label="${this._statusBar==="ok"?"Connected":this._statusBar==="error"?"Disconnected":""}"></div>
      <div class="reconnect-banner ${this._reconnectVisible?"visible":""}"
           role="alert" aria-live="assertive">${this._reconnectMsg}</div>

      <div class="toast-container" role="status" aria-live="polite" aria-relevant="additions">
        ${this._toasts.map(e=>m`
          <div class="global-toast ${e.type} ${e.fading?"fading":""}" role="alert">${e.message}</div>
        `)}
      </div>
    `}}C(Ot,"properties",{_statusBar:{type:String,state:!0},_reconnectVisible:{type:Boolean,state:!0},_reconnectMsg:{type:String,state:!0},_toasts:{type:Array,state:!0},_startupVisible:{type:Boolean,state:!0},_startupMessage:{type:String,state:!0},_startupPercent:{type:Number,state:!0}}),C(Ot,"styles",[F,z`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
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

    /* Startup overlay */
    .startup-overlay {
      position: fixed;
      inset: 0;
      z-index: 20000;
      background: var(--bg-primary, #0d1117);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: opacity 0.4s ease;
    }
    .startup-overlay.hidden {
      opacity: 0;
      pointer-events: none;
    }
    .startup-brand {
      font-size: 3rem;
      opacity: 0.25;
      margin-bottom: 2rem;
      user-select: none;
    }
    .startup-message {
      font-size: 0.95rem;
      color: var(--text-secondary, #8b949e);
      margin-bottom: 1.2rem;
      min-height: 1.4em;
    }
    .startup-bar-track {
      width: 280px;
      height: 4px;
      background: var(--bg-tertiary, #21262d);
      border-radius: 2px;
      overflow: hidden;
    }
    .startup-bar-fill {
      height: 100%;
      background: var(--accent-blue, #58a6ff);
      border-radius: 2px;
      transition: width 0.4s ease;
    }
  `]);customElements.define("ac-app",Ot);export{v as A,V as R,z as a,m as b,L as i,J as o,j as s,F as t,ar as w};
