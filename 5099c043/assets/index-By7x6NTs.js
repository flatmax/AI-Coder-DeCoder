(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))s(n);new MutationObserver(n=>{for(const r of n)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&s(o)}).observe(document,{childList:!0,subtree:!0});function t(n){const r={};return n.integrity&&(r.integrity=n.integrity),n.referrerPolicy&&(r.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?r.credentials="include":n.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function s(n){if(n.ep)return;n.ep=!0;const r=t(n);fetch(n.href,r)}})();/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const _e=window,Le=_e.ShadowRoot&&(_e.ShadyCSS===void 0||_e.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,Qe=Symbol(),ht=new WeakMap;let Je=class{constructor(e,t,s){if(this._$cssResult$=!0,s!==Qe)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const t=this.t;if(Le&&e===void 0){const s=t!==void 0&&t.length===1;s&&(e=ht.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),s&&ht.set(t,e))}return e}toString(){return this.cssText}};const Pt=i=>new Je(typeof i=="string"?i:i+"",void 0,Qe),U=(i,...e)=>{const t=i.length===1?i[0]:e.reduce((s,n,r)=>s+(o=>{if(o._$cssResult$===!0)return o.cssText;if(typeof o=="number")return o;throw Error("Value passed to 'css' function must be a 'css' function result: "+o+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(n)+i[r+1],i[0]);return new Je(t,i,Qe)},Dt=(i,e)=>{Le?i.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet):e.forEach(t=>{const s=document.createElement("style"),n=_e.litNonce;n!==void 0&&s.setAttribute("nonce",n),s.textContent=t.cssText,i.appendChild(s)})},We=Le?i=>i:i=>i instanceof CSSStyleSheet?(e=>{let t="";for(const s of e.cssRules)t+=s.cssText;return Pt(t)})(i):i;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */var De;const Se=window,ut=Se.trustedTypes,ms=ut?ut.emptyScript:"",pt=Se.reactiveElementPolyfillSupport,Ce={toAttribute(i,e){switch(e){case Boolean:i=i?ms:null;break;case Object:case Array:i=i==null?i:JSON.stringify(i)}return i},fromAttribute(i,e){let t=i;switch(e){case Boolean:t=i!==null;break;case Number:t=i===null?null:Number(i);break;case Object:case Array:try{t=JSON.parse(i)}catch{t=null}}return t}},et=(i,e)=>e!==i&&(e==e||i==i),He={attribute:!0,type:String,converter:Ce,reflect:!1,hasChanged:et},Ge="finalized";let X=class extends HTMLElement{constructor(){super(),this._$Ei=new Map,this.isUpdatePending=!1,this.hasUpdated=!1,this._$El=null,this._$Eu()}static addInitializer(e){var t;this.finalize(),((t=this.h)!==null&&t!==void 0?t:this.h=[]).push(e)}static get observedAttributes(){this.finalize();const e=[];return this.elementProperties.forEach((t,s)=>{const n=this._$Ep(s,t);n!==void 0&&(this._$Ev.set(n,s),e.push(n))}),e}static createProperty(e,t=He){if(t.state&&(t.attribute=!1),this.finalize(),this.elementProperties.set(e,t),!t.noAccessor&&!this.prototype.hasOwnProperty(e)){const s=typeof e=="symbol"?Symbol():"__"+e,n=this.getPropertyDescriptor(e,s,t);n!==void 0&&Object.defineProperty(this.prototype,e,n)}}static getPropertyDescriptor(e,t,s){return{get(){return this[t]},set(n){const r=this[e];this[t]=n,this.requestUpdate(e,r,s)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)||He}static finalize(){if(this.hasOwnProperty(Ge))return!1;this[Ge]=!0;const e=Object.getPrototypeOf(this);if(e.finalize(),e.h!==void 0&&(this.h=[...e.h]),this.elementProperties=new Map(e.elementProperties),this._$Ev=new Map,this.hasOwnProperty("properties")){const t=this.properties,s=[...Object.getOwnPropertyNames(t),...Object.getOwnPropertySymbols(t)];for(const n of s)this.createProperty(n,t[n])}return this.elementStyles=this.finalizeStyles(this.styles),!0}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const s=new Set(e.flat(1/0).reverse());for(const n of s)t.unshift(We(n))}else e!==void 0&&t.push(We(e));return t}static _$Ep(e,t){const s=t.attribute;return s===!1?void 0:typeof s=="string"?s:typeof e=="string"?e.toLowerCase():void 0}_$Eu(){var e;this._$E_=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$Eg(),this.requestUpdate(),(e=this.constructor.h)===null||e===void 0||e.forEach(t=>t(this))}addController(e){var t,s;((t=this._$ES)!==null&&t!==void 0?t:this._$ES=[]).push(e),this.renderRoot!==void 0&&this.isConnected&&((s=e.hostConnected)===null||s===void 0||s.call(e))}removeController(e){var t;(t=this._$ES)===null||t===void 0||t.splice(this._$ES.indexOf(e)>>>0,1)}_$Eg(){this.constructor.elementProperties.forEach((e,t)=>{this.hasOwnProperty(t)&&(this._$Ei.set(t,this[t]),delete this[t])})}createRenderRoot(){var e;const t=(e=this.shadowRoot)!==null&&e!==void 0?e:this.attachShadow(this.constructor.shadowRootOptions);return Dt(t,this.constructor.elementStyles),t}connectedCallback(){var e;this.renderRoot===void 0&&(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),(e=this._$ES)===null||e===void 0||e.forEach(t=>{var s;return(s=t.hostConnected)===null||s===void 0?void 0:s.call(t)})}enableUpdating(e){}disconnectedCallback(){var e;(e=this._$ES)===null||e===void 0||e.forEach(t=>{var s;return(s=t.hostDisconnected)===null||s===void 0?void 0:s.call(t)})}attributeChangedCallback(e,t,s){this._$AK(e,s)}_$EO(e,t,s=He){var n;const r=this.constructor._$Ep(e,s);if(r!==void 0&&s.reflect===!0){const o=(((n=s.converter)===null||n===void 0?void 0:n.toAttribute)!==void 0?s.converter:Ce).toAttribute(t,s.type);this._$El=e,o==null?this.removeAttribute(r):this.setAttribute(r,o),this._$El=null}}_$AK(e,t){var s;const n=this.constructor,r=n._$Ev.get(e);if(r!==void 0&&this._$El!==r){const o=n.getPropertyOptions(r),a=typeof o.converter=="function"?{fromAttribute:o.converter}:((s=o.converter)===null||s===void 0?void 0:s.fromAttribute)!==void 0?o.converter:Ce;this._$El=r,this[r]=a.fromAttribute(t,o.type),this._$El=null}}requestUpdate(e,t,s){let n=!0;e!==void 0&&(((s=s||this.constructor.getPropertyOptions(e)).hasChanged||et)(this[e],t)?(this._$AL.has(e)||this._$AL.set(e,t),s.reflect===!0&&this._$El!==e&&(this._$EC===void 0&&(this._$EC=new Map),this._$EC.set(e,s))):n=!1),!this.isUpdatePending&&n&&(this._$E_=this._$Ej())}async _$Ej(){this.isUpdatePending=!0;try{await this._$E_}catch(t){Promise.reject(t)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var e;if(!this.isUpdatePending)return;this.hasUpdated,this._$Ei&&(this._$Ei.forEach((n,r)=>this[r]=n),this._$Ei=void 0);let t=!1;const s=this._$AL;try{t=this.shouldUpdate(s),t?(this.willUpdate(s),(e=this._$ES)===null||e===void 0||e.forEach(n=>{var r;return(r=n.hostUpdate)===null||r===void 0?void 0:r.call(n)}),this.update(s)):this._$Ek()}catch(n){throw t=!1,this._$Ek(),n}t&&this._$AE(s)}willUpdate(e){}_$AE(e){var t;(t=this._$ES)===null||t===void 0||t.forEach(s=>{var n;return(n=s.hostUpdated)===null||n===void 0?void 0:n.call(s)}),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$Ek(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$E_}shouldUpdate(e){return!0}update(e){this._$EC!==void 0&&(this._$EC.forEach((t,s)=>this._$EO(s,this[s],t)),this._$EC=void 0),this._$Ek()}updated(e){}firstUpdated(e){}};X[Ge]=!0,X.elementProperties=new Map,X.elementStyles=[],X.shadowRootOptions={mode:"open"},pt?.({ReactiveElement:X}),((De=Se.reactiveElementVersions)!==null&&De!==void 0?De:Se.reactiveElementVersions=[]).push("1.6.3");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */var Oe;const Ee=window,ie=Ee.trustedTypes,ft=ie?ie.createPolicy("lit-html",{createHTML:i=>i}):void 0,Fe="$lit$",q=`lit$${(Math.random()+"").slice(9)}$`,tt="?"+q,bs=`<${tt}>`,Q=document,he=()=>Q.createComment(""),ue=i=>i===null||typeof i!="object"&&typeof i!="function",Ht=Array.isArray,Ot=i=>Ht(i)||typeof i?.[Symbol.iterator]=="function",je=`[ 	
\f\r]`,oe=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,gt=/-->/g,mt=/>/g,Y=RegExp(`>|${je}(?:([^\\s"'>=/]+)(${je}*=${je}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),bt=/'/g,xt=/"/g,jt=/^(?:script|style|textarea|title)$/i,Bt=i=>(e,...t)=>({_$litType$:i,strings:e,values:t}),d=Bt(1),xs=Bt(2),V=Symbol.for("lit-noChange"),L=Symbol.for("lit-nothing"),vt=new WeakMap,K=Q.createTreeWalker(Q,129,null,!1);function Nt(i,e){if(!Array.isArray(i)||!i.hasOwnProperty("raw"))throw Error("invalid template strings array");return ft!==void 0?ft.createHTML(e):e}const qt=(i,e)=>{const t=i.length-1,s=[];let n,r=e===2?"<svg>":"",o=oe;for(let a=0;a<t;a++){const l=i[a];let c,h,g=-1,f=0;for(;f<l.length&&(o.lastIndex=f,h=o.exec(l),h!==null);)f=o.lastIndex,o===oe?h[1]==="!--"?o=gt:h[1]!==void 0?o=mt:h[2]!==void 0?(jt.test(h[2])&&(n=RegExp("</"+h[2],"g")),o=Y):h[3]!==void 0&&(o=Y):o===Y?h[0]===">"?(o=n??oe,g=-1):h[1]===void 0?g=-2:(g=o.lastIndex-h[2].length,c=h[1],o=h[3]===void 0?Y:h[3]==='"'?xt:bt):o===xt||o===bt?o=Y:o===gt||o===mt?o=oe:(o=Y,n=void 0);const x=o===Y&&i[a+1].startsWith("/>")?" ":"";r+=o===oe?l+bs:g>=0?(s.push(c),l.slice(0,g)+Fe+l.slice(g)+q+x):l+q+(g===-2?(s.push(void 0),a):x)}return[Nt(i,r+(i[t]||"<?>")+(e===2?"</svg>":"")),s]};class pe{constructor({strings:e,_$litType$:t},s){let n;this.parts=[];let r=0,o=0;const a=e.length-1,l=this.parts,[c,h]=qt(e,t);if(this.el=pe.createElement(c,s),K.currentNode=this.el.content,t===2){const g=this.el.content,f=g.firstChild;f.remove(),g.append(...f.childNodes)}for(;(n=K.nextNode())!==null&&l.length<a;){if(n.nodeType===1){if(n.hasAttributes()){const g=[];for(const f of n.getAttributeNames())if(f.endsWith(Fe)||f.startsWith(q)){const x=h[o++];if(g.push(f),x!==void 0){const E=n.getAttribute(x.toLowerCase()+Fe).split(q),w=/([.?@])?(.*)/.exec(x);l.push({type:1,index:r,name:w[2],strings:E,ctor:w[1]==="."?Wt:w[1]==="?"?Gt:w[1]==="@"?Xt:fe})}else l.push({type:6,index:r})}for(const f of g)n.removeAttribute(f)}if(jt.test(n.tagName)){const g=n.textContent.split(q),f=g.length-1;if(f>0){n.textContent=ie?ie.emptyScript:"";for(let x=0;x<f;x++)n.append(g[x],he()),K.nextNode(),l.push({type:2,index:++r});n.append(g[f],he())}}}else if(n.nodeType===8)if(n.data===tt)l.push({type:2,index:r});else{let g=-1;for(;(g=n.data.indexOf(q,g+1))!==-1;)l.push({type:7,index:r}),g+=q.length-1}r++}}static createElement(e,t){const s=Q.createElement("template");return s.innerHTML=e,s}}function J(i,e,t=i,s){var n,r,o,a;if(e===V)return e;let l=s!==void 0?(n=t._$Co)===null||n===void 0?void 0:n[s]:t._$Cl;const c=ue(e)?void 0:e._$litDirective$;return l?.constructor!==c&&((r=l?._$AO)===null||r===void 0||r.call(l,!1),c===void 0?l=void 0:(l=new c(i),l._$AT(i,t,s)),s!==void 0?((o=(a=t)._$Co)!==null&&o!==void 0?o:a._$Co=[])[s]=l:t._$Cl=l),l!==void 0&&(e=J(i,l._$AS(i,e.values),l,s)),e}class Vt{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){var t;const{el:{content:s},parts:n}=this._$AD,r=((t=e?.creationScope)!==null&&t!==void 0?t:Q).importNode(s,!0);K.currentNode=r;let o=K.nextNode(),a=0,l=0,c=n[0];for(;c!==void 0;){if(a===c.index){let h;c.type===2?h=new ne(o,o.nextSibling,this,e):c.type===1?h=new c.ctor(o,c.name,c.strings,this,e):c.type===6&&(h=new Yt(o,this,e)),this._$AV.push(h),c=n[++l]}a!==c?.index&&(o=K.nextNode(),a++)}return K.currentNode=Q,r}v(e){let t=0;for(const s of this._$AV)s!==void 0&&(s.strings!==void 0?(s._$AI(e,s,t),t+=s.strings.length-2):s._$AI(e[t])),t++}}class ne{constructor(e,t,s,n){var r;this.type=2,this._$AH=L,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=s,this.options=n,this._$Cp=(r=n?.isConnected)===null||r===void 0||r}get _$AU(){var e,t;return(t=(e=this._$AM)===null||e===void 0?void 0:e._$AU)!==null&&t!==void 0?t:this._$Cp}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=J(this,e,t),ue(e)?e===L||e==null||e===""?(this._$AH!==L&&this._$AR(),this._$AH=L):e!==this._$AH&&e!==V&&this._(e):e._$litType$!==void 0?this.g(e):e.nodeType!==void 0?this.$(e):Ot(e)?this.T(e):this._(e)}k(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}$(e){this._$AH!==e&&(this._$AR(),this._$AH=this.k(e))}_(e){this._$AH!==L&&ue(this._$AH)?this._$AA.nextSibling.data=e:this.$(Q.createTextNode(e)),this._$AH=e}g(e){var t;const{values:s,_$litType$:n}=e,r=typeof n=="number"?this._$AC(e):(n.el===void 0&&(n.el=pe.createElement(Nt(n.h,n.h[0]),this.options)),n);if(((t=this._$AH)===null||t===void 0?void 0:t._$AD)===r)this._$AH.v(s);else{const o=new Vt(r,this),a=o.u(this.options);o.v(s),this.$(a),this._$AH=o}}_$AC(e){let t=vt.get(e.strings);return t===void 0&&vt.set(e.strings,t=new pe(e)),t}T(e){Ht(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let s,n=0;for(const r of e)n===t.length?t.push(s=new ne(this.k(he()),this.k(he()),this,this.options)):s=t[n],s._$AI(r),n++;n<t.length&&(this._$AR(s&&s._$AB.nextSibling,n),t.length=n)}_$AR(e=this._$AA.nextSibling,t){var s;for((s=this._$AP)===null||s===void 0||s.call(this,!1,!0,t);e&&e!==this._$AB;){const n=e.nextSibling;e.remove(),e=n}}setConnected(e){var t;this._$AM===void 0&&(this._$Cp=e,(t=this._$AP)===null||t===void 0||t.call(this,e))}}class fe{constructor(e,t,s,n,r){this.type=1,this._$AH=L,this._$AN=void 0,this.element=e,this.name=t,this._$AM=n,this.options=r,s.length>2||s[0]!==""||s[1]!==""?(this._$AH=Array(s.length-1).fill(new String),this.strings=s):this._$AH=L}get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}_$AI(e,t=this,s,n){const r=this.strings;let o=!1;if(r===void 0)e=J(this,e,t,0),o=!ue(e)||e!==this._$AH&&e!==V,o&&(this._$AH=e);else{const a=e;let l,c;for(e=r[0],l=0;l<r.length-1;l++)c=J(this,a[s+l],t,l),c===V&&(c=this._$AH[l]),o||(o=!ue(c)||c!==this._$AH[l]),c===L?e=L:e!==L&&(e+=(c??"")+r[l+1]),this._$AH[l]=c}o&&!n&&this.j(e)}j(e){e===L?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}}class Wt extends fe{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===L?void 0:e}}const vs=ie?ie.emptyScript:"";class Gt extends fe{constructor(){super(...arguments),this.type=4}j(e){e&&e!==L?this.element.setAttribute(this.name,vs):this.element.removeAttribute(this.name)}}class Xt extends fe{constructor(e,t,s,n,r){super(e,t,s,n,r),this.type=5}_$AI(e,t=this){var s;if((e=(s=J(this,e,t,0))!==null&&s!==void 0?s:L)===V)return;const n=this._$AH,r=e===L&&n!==L||e.capture!==n.capture||e.once!==n.once||e.passive!==n.passive,o=e!==L&&(n===L||r);r&&this.element.removeEventListener(this.name,this,n),o&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var t,s;typeof this._$AH=="function"?this._$AH.call((s=(t=this.options)===null||t===void 0?void 0:t.host)!==null&&s!==void 0?s:this.element,e):this._$AH.handleEvent(e)}}class Yt{constructor(e,t,s){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=s}get _$AU(){return this._$AM._$AU}_$AI(e){J(this,e)}}const Zt={O:Fe,P:q,A:tt,C:1,M:qt,L:Vt,R:Ot,D:J,I:ne,V:fe,H:Gt,N:Xt,U:Wt,F:Yt},yt=Ee.litHtmlPolyfillSupport;yt?.(pe,ne),((Oe=Ee.litHtmlVersions)!==null&&Oe!==void 0?Oe:Ee.litHtmlVersions=[]).push("2.8.0");const Kt=(i,e,t)=>{var s,n;const r=(s=t?.renderBefore)!==null&&s!==void 0?s:e;let o=r._$litPart$;if(o===void 0){const a=(n=t?.renderBefore)!==null&&n!==void 0?n:null;r._$litPart$=o=new ne(e.insertBefore(he(),a),a,void 0,t??{})}return o._$AI(i),o};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */var Be,Ne;const ys=X;let z=class extends X{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var e,t;const s=super.createRenderRoot();return(e=(t=this.renderOptions).renderBefore)!==null&&e!==void 0||(t.renderBefore=s.firstChild),s}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Kt(t,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),(e=this._$Do)===null||e===void 0||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this._$Do)===null||e===void 0||e.setConnected(!1)}render(){return V}};z.finalized=!0,z._$litElement$=!0,(Be=globalThis.litElementHydrateSupport)===null||Be===void 0||Be.call(globalThis,{LitElement:z});const wt=globalThis.litElementPolyfillSupport;wt?.({LitElement:z});const ws={_$AK:(i,e,t)=>{i._$AK(e,t)},_$AL:i=>i._$AL};((Ne=globalThis.litElementVersions)!==null&&Ne!==void 0?Ne:globalThis.litElementVersions=[]).push("3.3.3");/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const _s=!1,ks=Object.freeze(Object.defineProperty({__proto__:null,CSSResult:Je,LitElement:z,ReactiveElement:X,UpdatingElement:ys,_$LE:ws,_$LH:Zt,adoptStyles:Dt,css:U,defaultConverter:Ce,getCompatibleStyle:We,html:d,isServer:_s,noChange:V,notEqual:et,nothing:L,render:Kt,supportsAdoptingStyleSheets:Le,svg:xs,unsafeCSS:Pt},Symbol.toStringTag,{value:"Module"}));var Xe=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};function $s(i){return i&&i.__esModule&&Object.prototype.hasOwnProperty.call(i,"default")?i.default:i}function Ss(i){if(i.__esModule)return i;var e=i.default;if(typeof e=="function"){var t=function s(){return this instanceof s?Reflect.construct(e,arguments,this.constructor):e.apply(this,arguments)};t.prototype=e.prototype}else t={};return Object.defineProperty(t,"__esModule",{value:!0}),Object.keys(i).forEach(function(s){var n=Object.getOwnPropertyDescriptor(i,s);Object.defineProperty(t,s,n.get?n:{enumerable:!0,get:function(){return i[s]}})}),t}var Qt={exports:{}};(function(i){class e{getAllFns(s,n){let r=[],o=s.constructor.prototype;for(;o!=null;){let a=o.constructor.name.replace("_exports_","");if(n!=null&&(a=n),a!=="Object"){let l=Object.getOwnPropertyNames(o).filter(c=>c!=="constructor"&&c.indexOf("__")<0);l.forEach((c,h)=>{l[h]=a+"."+c}),r=r.concat(l)}if(n!=null)break;o=o.__proto__}return r}exposeAllFns(s,n){let r=this.getAllFns(s,n);var o={};return r.forEach(function(a){o[a]=function(l,c){Promise.resolve(s[a.substring(a.indexOf(".")+1)].apply(s,l.args)).then(function(h){return c(null,h)}).catch(function(h){return console.log("failed : "+h),c(h)})}}),o}}i.exports=e})(Qt);var Cs=Qt.exports;/*! JRPC v3.1.0
 * <https://github.com/vphantom/js-jrpc>
 * Copyright 2016 Stéphane Lavergne
 * Free software under MIT License: <https://opensource.org/licenses/MIT> */Xe.setImmediate=typeof setImmediate<"u"?setImmediate:(i,...e)=>setTimeout(()=>i(...e),0);function N(i){this.active=!0,this.transmitter=null,this.remoteTimeout=6e4,this.localTimeout=0,this.serial=0,this.outbox={requests:[],responses:[]},this.inbox={},this.localTimers={},this.outTimers={},this.localComponents={"system.listComponents":!0,"system.extension.dual-batch":!0},this.remoteComponents={},this.exposed={},this.exposed["system.listComponents"]=function(e,t){return typeof e=="object"&&e!==null&&(this.remoteComponents=e,this.remoteComponents["system._upgraded"]=!0),t(null,this.localComponents)}.bind(this),this.exposed["system.extension.dual-batch"]=function(e,t){return t(null,!0)},typeof i=="object"&&("remoteTimeout"in i&&typeof i.remoteTimeout=="number"&&(this.remoteTimeout=i.remoteTimeout*1e3),"localTimeout"in i&&typeof i.localTimeout=="number"&&(this.localTimeout=i.localTimeout*1e3))}function Es(){var i=this;return i.active=!1,i.transmitter=null,i.remoteTimeout=0,i.localTimeout=0,i.localComponents={},i.remoteComponents={},i.outbox.requests.length=0,i.outbox.responses.length=0,i.inbox={},i.exposed={},Object.keys(i.localTimers).forEach(function(e){clearTimeout(i.localTimers[e]),delete i.localTimers[e]}),Object.keys(i.outTimers).forEach(function(e){clearTimeout(i.outTimers[e]),delete i.outTimers[e]}),i}function Fs(i){var e,t,s=null,n={responses:[],requests:[]};if(typeof i!="function"&&(i=this.transmitter),!this.active||typeof i!="function")return this;if(e=this.outbox.responses.length,t=this.outbox.requests.length,e>0&&t>0&&"system.extension.dual-batch"in this.remoteComponents)n=s={responses:this.outbox.responses,requests:this.outbox.requests},this.outbox.responses=[],this.outbox.requests=[];else if(e>0)e>1?(n.responses=s=this.outbox.responses,this.outbox.responses=[]):n.responses.push(s=this.outbox.responses.pop());else if(t>0)t>1?(n.requests=s=this.outbox.requests,this.outbox.requests=[]):n.requests.push(s=this.outbox.requests.pop());else return this;return setImmediate(i,JSON.stringify(s),Rs.bind(this,n)),this}function Ts(i){return this.transmitter=i,this.transmit()}function Rs(i,e){this.active&&e&&(i.responses.length>0&&Array.prototype.push.apply(this.outbox.responses,i.responses),i.requests.length>0&&Array.prototype.push.apply(this.outbox.requests,i.requests))}function As(i){var e=[],t=[];if(!this.active)return this;if(typeof i=="string")try{i=JSON.parse(i)}catch{return this}if(i.constructor===Array){if(i.length===0)return this;typeof i[0].method=="string"?e=i:t=i}else typeof i=="object"&&(typeof i.requests<"u"&&typeof i.responses<"u"?(e=i.requests,t=i.responses):typeof i.method=="string"?e.push(i):t.push(i));return t.forEach(Jt.bind(this)),e.forEach(zs.bind(this)),this}function Ms(){return this.active?this.call("system.listComponents",this.localComponents,function(i,e){!i&&typeof e=="object"&&(this.remoteComponents=e,this.remoteComponents["system._upgraded"]=!0)}.bind(this)):this}function st(i,e,t){var s={jsonrpc:"2.0",method:i};return this.active?(typeof e=="function"&&(t=e,e=null),"system._upgraded"in this.remoteComponents&&!(i in this.remoteComponents)?(typeof t=="function"&&setImmediate(t,{code:-32601,message:"Unknown remote method"}),this):(typeof e=="object"&&(s.params=e),this.serial++,typeof t=="function"&&(s.id=this.serial,this.inbox[this.serial]=t),this.outbox.requests.push(s),this.transmit(),typeof t!="function"?this:(this.remoteTimeout>0?this.outTimers[this.serial]=setTimeout(Jt.bind(this,{jsonrpc:"2.0",id:this.serial,error:{code:-1e3,message:"Timed out waiting for response"}}),this.remoteTimeout):this.outTimers[this.serial]=!0,this))):this}function Jt(i){var e=!1,t=null;if(this.active&&"id"in i&&i.id in this.outTimers)clearTimeout(this.outTimers[i.id]),delete this.outTimers[i.id];else return;i.id in this.inbox&&("error"in i?e=i.error:t=i.result,setImmediate(this.inbox[i.id],e,t),delete this.inbox[i.id])}function Ls(i,e){var t;if(!this.active)return this;if(typeof i=="string")this.localComponents[i]=!0,this.exposed[i]=e;else if(typeof i=="object")for(t in i)i.hasOwnProperty(t)&&(this.localComponents[t]=!0,this.exposed[t]=i[t]);return this}function zs(i){var e=null,t=null;if(!(!this.active||typeof i!="object"||i===null)&&typeof i.jsonrpc=="string"&&i.jsonrpc==="2.0"){if(e=typeof i.id<"u"?i.id:null,typeof i.method!="string"){e!==null&&(this.localTimers[e]=!0,setImmediate(ae.bind(this,e,-32600)));return}if(!(i.method in this.exposed)){e!==null&&(this.localTimers[e]=!0,setImmediate(ae.bind(this,e,-32601)));return}if("params"in i)if(typeof i.params=="object")t=i.params;else{e!==null&&(this.localTimers[e]=!0,setImmediate(ae.bind(this,e,-32602)));return}e!==null&&(this.localTimeout>0?this.localTimers[e]=setTimeout(ae.bind(this,e,{code:-1002,message:"Method handler timed out"}),this.localTimeout):this.localTimers[e]=!0),setImmediate(this.exposed[i.method],t,ae.bind(this,e))}}function ae(i,e,t){var s={jsonrpc:"2.0",id:i};if(i!==null){if(this.active&&i in this.localTimers)clearTimeout(this.localTimers[i]),delete this.localTimers[i];else return;typeof e<"u"&&e!==null&&e!==!1?typeof e=="number"?s.error={code:e,message:"error"}:e===!0?s.error={code:-1,message:"error"}:typeof e=="string"?s.error={code:-1,message:e}:typeof e=="object"&&"code"in e&&"message"in e?s.error=e:s.error={code:-2,message:"error",data:e}:s.result=t,this.outbox.responses.push(s),this.transmit()}}N.prototype.shutdown=Es;N.prototype.call=st;N.prototype.notify=st;N.prototype.expose=Ls;N.prototype.upgrade=Ms;N.prototype.receive=As;N.prototype.transmit=Fs;N.prototype.setTransmitter=Ts;typeof Promise<"u"&&typeof Promise.promisify=="function"&&(N.prototype.callAsync=Promise.promisify(st));var es=N;const Us=$s(es),Is=Ss(ks);var Ps=Cs,_t=es,{LitElement:Ds}=Is,ke=self.crypto;ke.randomUUID||(ke.randomUUID=()=>ke.getRandomValues(new Uint8Array(32)).toString("base64").replaceAll(",",""));let Hs=class extends Ds{newRemote(){let e;return typeof Window>"u"?e=new _t({remoteTimeout:this.remoteTimeout}):e=new _t({remoteTimeout:this.remoteTimeout}),e.uuid=ke.randomUUID(),this.remotes==null&&(this.remotes={}),this.remotes[e.uuid]=e,e}createRemote(e){let t=this.newRemote();return this.remoteIsUp(),this.ws?(e=this.ws,this.ws.onclose=function(s){this.rmRemote(s,t.uuid)}.bind(this),this.ws.onmessage=s=>{t.receive(s.data)}):(e.on("close",(s,n)=>this.rmRemote.bind(this)(s,t.uuid)),e.on("message",function(s,n){const r=n?s:s.toString();t.receive(r)})),this.setupRemote(t,e),t}remoteIsUp(){console.log("JRPCCommon::remoteIsUp")}rmRemote(e,t){if(this.server&&this.remotes[t]&&this.remotes[t].rpcs&&Object.keys(this.remotes[t].rpcs).forEach(s=>{this.server[s]&&delete this.server[s]}),Object.keys(this.remotes).length&&delete this.remotes[t],this.call&&Object.keys(this.remotes).length){let s=[];for(const n in this.remotes)this.remotes[n].rpcs&&(s=s.concat(Object.keys(this.remotes[n].rpcs)));if(this.call){let n=Object.keys(this.call);for(let r=0;r<n.length;r++)s.indexOf(n[r])<0&&delete this.call[n[r]]}}else this.call={};this.remoteDisconnected(t)}remoteDisconnected(e){console.log("JPRCCommon::remoteDisconnected "+e)}setupRemote(e,t){e.setTransmitter(this.transmit.bind(t)),this.classes&&this.classes.forEach(s=>{e.expose(s)}),e.upgrade(),e.call("system.listComponents",[],(s,n)=>{s?(console.log(s),console.log("Something went wrong when calling system.listComponents !")):this.setupFns(Object.keys(n),e)})}transmit(e,t){try{return this.send(e),t(!1)}catch(s){return console.log(s),t(!0)}}setupFns(e,t){e.forEach(s=>{t.rpcs==null&&(t.rpcs={}),t.rpcs[s]=function(n){return new Promise((r,o)=>{t.call(s,{args:Array.from(arguments)},(a,l)=>{a?(console.log("Error when calling remote function : "+s),o(a)):r(l)})})},this.call==null&&(this.call={}),this.call[s]==null&&(this.call[s]=(...n)=>{let r=[],o=[];for(const a in this.remotes)this.remotes[a].rpcs[s]!=null&&(o.push(a),r.push(this.remotes[a].rpcs[s](...n)));return Promise.all(r).then(a=>{let l={};return o.forEach((c,h)=>l[c]=a[h]),l})}),this.server==null&&(this.server={}),this.server[s]==null?this.server[s]=function(n){return new Promise((r,o)=>{t.call(s,{args:Array.from(arguments)},(a,l)=>{a?(console.log("Error when calling remote function : "+s),o(a)):r(l)})})}:this.server[s]=function(n){return new Promise((r,o)=>{o(new Error("More then one remote has this RPC, not sure who to talk to : "+s))})}}),this.setupDone()}setupDone(){}addClass(e,t){e.getRemotes=()=>this.remotes,e.getCall=()=>this.call,e.getServer=()=>this.server;let n=new Ps().exposeAllFns(e,t);if(this.classes==null?this.classes=[n]:this.classes.push(n),this.remotes!=null)for(const[r,o]of Object.entries(this.remotes))o.expose(n),o.upgrade()}};var Os=Hs;Window.LitElement=z;Window.JRPC=Us;var js=Os;class it extends js{static get properties(){return{serverURI:{type:String},ws:{type:Object},server:{type:Object},remoteTimeout:{type:Number}}}constructor(){super(),this.remoteTimeout=60}updated(e){e.has("serverURI")&&this.serverURI&&this.serverURI!="undefined"&&this.serverChanged()}serverChanged(){this.ws!=null&&delete this.ws;try{this.ws=new WebSocket(this.serverURI),console.assert(this.ws.parent==null,"wss.parent already exists, this needs upgrade."),this.ws.addEventListener("open",this.createRemote.bind(this)),this.ws.addEventListener("error",this.wsError.bind(this))}catch(e){this.serverURI="",this.setupSkip(e)}}wsError(e){this.setupSkip(e)}isConnected(){return this.server!=null&&this.server!={}}setupSkip(){this.dispatchEvent(new CustomEvent("skip"))}setupDone(){this.dispatchEvent(new CustomEvent("done"))}}window.customElements.get("jrpc-client")||window.customElements.define("jrpc-client",it);const Bs=U`
  @keyframes line-highlight {
    0% { background-color: rgba(233, 69, 96, 0.4); }
    100% { background-color: transparent; }
  }

  .line-highlight-decoration {
    animation: line-highlight 1.5s ease-out;
  }
  :host {
    display: block;
    width: 100%;
    height: 100%;
  }

  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
  }

  .file-tabs {
    display: flex;
    background: #252526;
    border-bottom: 1px solid #3c3c3c;
    overflow-x: auto;
    min-height: 35px;
  }

  .tabs-left {
    display: flex;
    flex: 1;
    overflow-x: auto;
  }

  .tabs-right {
    display: flex;
    align-items: center;
    padding-right: 8px;
  }

  .save-btn {
    background: #0f3460;
    color: #eee;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
  }

  .save-btn:hover:not(:disabled) {
    background: #1a3a6e;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-btn.dirty {
    background: #e94560;
    color: #fff;
  }

  .save-btn.dirty:hover {
    background: #ff5a7a;
  }

  .file-tab {
    padding: 8px 16px;
    background: transparent;
    border: none;
    color: #969696;
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
    border-right: 1px solid #3c3c3c;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .file-tab:hover {
    background: #2a2d2e;
  }

  .file-tab.active {
    background: #1e1e1e;
    color: #fff;
    border-bottom: 2px solid #e94560;
  }

  .file-tab .status {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .file-tab .status.modified {
    background: #f0a500;
    color: #000;
  }

  .file-tab .status.new {
    background: #7ec699;
    color: #000;
  }

  #editor-container {
    flex: 1;
    overflow: hidden;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    font-size: 16px;
    gap: 12px;
    padding-left: 33%;
    box-sizing: border-box;
  }

  .empty-state .brand {
    font-size: 72px;
    font-weight: bold;
    color: #3c3c3c;
    letter-spacing: 4px;
    user-select: none;
  }

  .hidden {
    display: none;
  }
`;function Ns(i){const e=i.files.length>0;return d`
    <div class="container ${i.visible?"":"hidden"}">
      ${e?d`
        <div class="file-tabs">
          <div class="tabs-left">
            ${i.files.map(t=>d`
              <button 
                class="file-tab ${i.selectedFile===t.path?"active":""}"
                @click=${()=>i.selectFile(t.path)}
              >
                ${t.path}
                <span class="status ${t.isNew?"new":"modified"}">
                  ${t.isNew?"NEW":"MOD"}
                </span>
              </button>
            `)}
          </div>
          <div class="tabs-right">
            <button 
              class="save-btn ${i.isDirty?"dirty":""}"
              @click=${()=>i.saveAllFiles()}
              ?disabled=${!i.isDirty}
              title="Save all changes (Ctrl+S)"
            >
              💾
            </button>
          </div>
        </div>
      `:d`
        <div class="empty-state">
          <div class="brand">AC⚡DC</div>
        </div>
      `}
      <div id="editor-container"></div>
    </div>
  `}const qs="0.45.0",Vs=`https://cdn.jsdelivr.net/npm/monaco-editor@${qs}/min/vs`,Ye=Vs;let ye=!1;const de=[];function Ws(){if(ye)return;if(window.monaco?.editor){de.forEach(e=>e()),de.length=0;return}ye=!0;const i=document.createElement("script");i.src=`${Ye}/loader.js`,i.onerror=()=>{ye=!1},i.onload=()=>{window.require.config({paths:{vs:Ye}}),window.require(["vs/editor/editor.main"],()=>{de.forEach(e=>e()),de.length=0},()=>{ye=!1})},document.head.appendChild(i)}function Gs(i){window.monaco?.editor?i():de.push(i)}const Xs=i=>class extends i{initMonaco(){Ws()}injectMonacoStyles(){const e=document.createElement("style");e.textContent=`@import url('${Ye}/editor/editor.main.css');`,this.shadowRoot.appendChild(e)}};function Ys(i,e=["python","javascript","typescript"]){if(!window.monaco){console.warn("Monaco not loaded, cannot register symbol providers");return}for(const t of e)Zs(i,t),Ks(i,t),Qs(i,t),Js(i,t)}function Zs(i,e){window.monaco.languages.registerHoverProvider(e,{async provideHover(t,s){try{const n=ze(t);if(!n)return null;const r=await i.call["LiteLLM.lsp_get_hover"](n,s.lineNumber,s.column),o=r?Object.values(r)[0]:null;if(o&&o.contents)return{contents:[{value:o.contents}]}}catch(n){console.error("Hover provider error:",n)}return null}})}function Ks(i,e){window.monaco.languages.registerDefinitionProvider(e,{async provideDefinition(t,s){try{const n=ze(t);if(!n)return null;const r=await i.call["LiteLLM.lsp_get_definition"](n,s.lineNumber,s.column),o=r?Object.values(r)[0]:null;if(o&&o.file&&o.range){const a=o.range.start_line??o.range.start?.line,l=o.range.start_col??o.range.start?.col??0;return window.dispatchEvent(new CustomEvent("lsp-navigate-to-file",{detail:{file:o.file,line:a,column:l+1}})),null}}catch(n){console.error("Definition provider error:",n)}return null}})}function Qs(i,e){window.monaco.languages.registerReferenceProvider(e,{async provideReferences(t,s,n){try{const r=ze(t);if(!r)return[];const o=await i.call["LiteLLM.lsp_get_references"](r,s.lineNumber,s.column),a=o?Object.values(o)[0]:null;if(Array.isArray(a))return a.map(l=>({uri:window.monaco.Uri.file(l.file_path),range:new window.monaco.Range(l.line,l.col+1,l.line,l.col+1)}))}catch(r){console.error("References provider error:",r)}return[]}})}function Js(i,e){window.monaco.languages.registerCompletionItemProvider(e,{triggerCharacters:[".","_"],async provideCompletionItems(t,s){try{const n=ze(t);if(!n)return{suggestions:[]};const r=t.getWordUntilPosition(s),o=r?r.word:"",a=await i.call["LiteLLM.lsp_get_completions"](n,s.lineNumber,s.column,o),l=a?Object.values(a)[0]:null;if(Array.isArray(l))return{suggestions:l.map(h=>({label:h.label,kind:h.kind,detail:h.detail,documentation:h.documentation?{value:h.documentation}:void 0,insertText:h.insertText,insertTextRules:h.insertText?.includes("$0")?window.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet:void 0,sortText:h.sortText,range:{startLineNumber:s.lineNumber,startColumn:r?r.startColumn:s.column,endLineNumber:s.lineNumber,endColumn:s.column}}))}}catch(n){console.error("Completion provider error:",n)}return{suggestions:[]}}})}function ze(i){const e=i.uri;return e?e.scheme==="file"?e.path:i._associatedFilePath?i._associatedFilePath:e.path||null:null}function kt(i,e){i._associatedFilePath=e}const ei=i=>class extends i{initDiffEditor(){this._editor=null,this._models=new Map,this._dirtyFiles=new Set,this._contentListeners=new Map,this._lspProvidersRegistered=!1}createDiffEditor(){const e=this.shadowRoot.querySelector("#editor-container");!e||this._editor||(this._editor=window.monaco.editor.createDiffEditor(e,{theme:"vs-dark",automaticLayout:!0,readOnly:!1,originalEditable:!1,renderSideBySide:!0,minimap:{enabled:!1}}),this._editor.getModifiedEditor().addCommand(window.monaco.KeyMod.CtrlCmd|window.monaco.KeyCode.KeyS,()=>this.saveCurrentFile()),this._editor.getModifiedEditor().onMouseUp(t=>{t.event.ctrlKey&&t.target.position&&this._handleGoToDefinition(t.target.position)}),this._editor.getModifiedEditor().addCommand(window.monaco.KeyCode.F12,()=>{const t=this._editor.getModifiedEditor().getPosition();t&&this._handleGoToDefinition(t)}),this.files.length>0&&(this.updateModels(),this.showDiff(this.selectedFile||this.files[0].path)),typeof this._tryRegisterLspProviders=="function"&&this._tryRegisterLspProviders())}updateModels(){this._models.forEach(e=>{e.original.dispose(),e.modified.dispose()}),this._models.clear(),this._contentListeners.forEach(e=>e.dispose()),this._contentListeners.clear(),this._dirtyFiles.clear(),this.isDirty=!1;for(const e of this.files){const t=this.getLanguage(e.path),s=window.monaco.editor.createModel(e.original||"",t),n=window.monaco.editor.createModel(e.modified||"",t);kt(s,e.path),kt(n,e.path),this._models.set(e.path,{original:s,modified:n,savedContent:e.modified||""});const r=n.onDidChangeContent(()=>{const o=n.getValue(),a=this._models.get(e.path);o!==a.savedContent?this._dirtyFiles.add(e.path):this._dirtyFiles.delete(e.path),this.isDirty=this._dirtyFiles.size>0});this._contentListeners.set(e.path,r)}}showDiff(e){if(!this._editor||!e)return;const t=this._models.get(e);t&&this._editor.setModel({original:t.original,modified:t.modified})}async _handleGoToDefinition(e){if(!this.call)return;const t=this._editor?.getModifiedEditor()?.getModel();if(!t)return;const s=t._associatedFilePath;if(s)try{const n=await this.call["LiteLLM.lsp_get_definition"](s,e.lineNumber,e.column),r=n?Object.values(n)[0]:null;if(r&&r.file&&r.range){const o=r.range.start?.line||r.range.start_line,a=(r.range.start?.col||r.range.start_col||0)+1;window.dispatchEvent(new CustomEvent("lsp-navigate-to-file",{detail:{file:r.file,line:o,column:a}}))}}catch(n){console.error("Go to definition error:",n)}}getLanguage(e){const t=e.split(".").pop().toLowerCase();return{js:"javascript",mjs:"javascript",jsx:"javascript",ts:"typescript",tsx:"typescript",py:"python",json:"json",html:"html",css:"css",md:"markdown",yaml:"yaml",yml:"yaml",sh:"shell"}[t]||"plaintext"}disposeDiffEditor(){this._editor&&(this._editor.dispose(),this._editor=null),this._models.forEach(e=>{e.original.dispose(),e.modified.dispose()}),this._models.clear(),this._contentListeners.forEach(e=>e.dispose()),this._contentListeners.clear(),this._dirtyFiles.clear()}getOpenFilePaths(){return this.files.map(e=>e.path)}refreshFileContent(e,t,s){const n=this.files.findIndex(o=>o.path===e);if(n===-1)return!1;this.files=this.files.map((o,a)=>a===n?{...o,original:t,modified:s}:o);const r=this._models.get(e);return r&&(r.original.setValue(t),r.modified.setValue(s),r.savedContent=s,this._dirtyFiles.delete(e)),!0}getOpenFilePaths(){return this.files.map(e=>e.path)}clearFiles(){this.files=[],this.selectedFile=null,this.isDirty=!1,this._models.forEach(e=>{e.original.dispose(),e.modified.dispose()}),this._models.clear(),this._contentListeners.forEach(e=>e.dispose()),this._contentListeners.clear(),this._dirtyFiles.clear()}saveCurrentFile(){if(!this.selectedFile||!this._editor||!this._dirtyFiles.has(this.selectedFile))return;const t=this._editor.getModifiedEditor().getValue(),s=this._models.get(this.selectedFile);s&&(s.savedContent=t),this._dirtyFiles.delete(this.selectedFile),this.isDirty=this._dirtyFiles.size>0;const n=this.files?.find(r=>r.path===this.selectedFile);this.dispatchEvent(new CustomEvent("file-save",{detail:{path:this.selectedFile,content:t,isConfig:n?.isConfig,configType:n?.configType},bubbles:!0,composed:!0}))}saveAllFiles(){if(this._dirtyFiles.size===0)return;const e=[];for(const t of this._dirtyFiles){const s=this._models.get(t),n=this.files?.find(r=>r.path===t);if(s){const r=s.modified.getValue();s.savedContent=r,e.push({path:t,content:r,isConfig:n?.isConfig,configType:n?.configType})}}this._dirtyFiles.clear(),this.isDirty=!1,this.dispatchEvent(new CustomEvent("files-save",{detail:{files:e},bubbles:!0,composed:!0}))}},ti=ei(Xs(it));class si extends ti{static properties={files:{type:Array},selectedFile:{type:String},visible:{type:Boolean},isDirty:{type:Boolean},serverURI:{type:String},viewingFile:{type:String}};static styles=Bs;constructor(){super(),this.files=[],this.selectedFile=null,this.visible=!1,this.isDirty=!1,this.initDiffEditor()}connectedCallback(){super.connectedCallback(),this.addClass(this,"DiffViewer"),this.initMonaco(),this._handleLspNavigate=this._handleLspNavigate.bind(this),window.addEventListener("lsp-navigate-to-file",this._handleLspNavigate)}firstUpdated(){this.injectMonacoStyles(),Gs(()=>{this.createDiffEditor()})}_tryRegisterLspProviders(){if(!this._lspProvidersRegistered&&!(!this._editor||!this._remoteIsUp))try{Ys(this),this._lspProvidersRegistered=!0}catch(e){console.error("Failed to register LSP providers:",e)}}remoteIsUp(){this._remoteIsUp=!0,this._tryRegisterLspProviders()}setupDone(){}remoteDisconnected(e){this._remoteIsUp=!1,this._lspProvidersRegistered=!1}willUpdate(e){e.has("files")&&this.files.length>0&&(!this.selectedFile||!this.files.find(t=>t.path===this.selectedFile))&&(this.selectedFile=this.files[0].path)}updated(e){if(super.updated(e),e.has("files")&&this.files.length>0&&this._editor){const t=e.get("files")||[];this._filesActuallyChanged(t,this.files)&&(this.updateModels(),this.showDiff(this.selectedFile),this._emitFileSelected(this.selectedFile))}e.has("selectedFile")&&this.selectedFile&&this._editor&&(this.showDiff(this.selectedFile),this._emitFileSelected(this.selectedFile)),e.has("isDirty")&&this.dispatchEvent(new CustomEvent("isDirty-changed",{detail:{isDirty:this.isDirty},bubbles:!0,composed:!0}))}selectFile(e){this.selectedFile=e,this._emitFileSelected(e)}_filesActuallyChanged(e,t){if(e.length!==t.length)return!0;for(let s=0;s<t.length;s++){const n=e[s],r=t[s];if(!n||n.path!==r.path||n.original!==r.original||n.modified!==r.modified)return!0}return!1}_emitFileSelected(e){e&&this.dispatchEvent(new CustomEvent("file-selected",{detail:{path:e},bubbles:!0,composed:!0}))}disconnectedCallback(){super.disconnectedCallback(),this.disposeDiffEditor(),window.removeEventListener("lsp-navigate-to-file",this._handleLspNavigate)}_handleLspNavigate(e){const{file:t,line:s,column:n}=e.detail;if(this.files.find(o=>o.path===t)){this.selectedFile=t,this._revealPosition(s,n);return}this.dispatchEvent(new CustomEvent("request-file-load",{detail:{file:t,line:s,column:n,replace:!0},bubbles:!0,composed:!0}))}_revealPosition(e,t){if(!this._editor||!e)return;const s=this._editor.getModifiedEditor();s&&(s.revealLineInCenter(e),s.setPosition({lineNumber:e,column:t||1}),s.focus(),this._highlightLine(s,e))}_highlightLine(e,t){this._highlightDecorations&&e.deltaDecorations(this._highlightDecorations,[]),this._highlightDecorations=e.deltaDecorations([],[{range:new monaco.Range(t,1,t,1),options:{isWholeLine:!0,className:"line-highlight-decoration"}}]),setTimeout(()=>{this._highlightDecorations&&(e.deltaDecorations(this._highlightDecorations,[]),this._highlightDecorations=null)},1500)}_findLineByContent(e){if(!this._editor||!e)return null;const t=this._editor.getModifiedEditor();if(!t)return null;const s=t.getModel();if(!s)return null;const r=s.getValue().split(`
`),o=e.trim();for(let a=0;a<r.length;a++)if(r[a].includes(o)||r[a].trim()===o)return a+1;return null}render(){return Ns(this)}}customElements.define("diff-viewer",si);class ii extends it{static properties={serverURI:{type:String},messageHistory:{type:Array},_showScrollButton:{type:Boolean,state:!0}};constructor(){super(),this.messageHistory=[],this._messageId=0,this._userHasScrolledUp=!1,this._showScrollButton=!1}connectedCallback(){super.connectedCallback(),this.port&&(this.serverURI=`ws://localhost:${this.port}`)}handleWheel(e){if(e.deltaY<0&&(this._userHasScrolledUp=!0,this._showScrollButton=!0),e.deltaY>0){const t=this.shadowRoot?.querySelector("#messages-container");t&&setTimeout(()=>{t.scrollHeight-t.scrollTop-t.clientHeight<50&&(this._userHasScrolledUp=!1,this._showScrollButton=!1)},50)}}scrollToBottomNow(){this._userHasScrolledUp=!1,this._showScrollButton=!1;const e=this.shadowRoot?.querySelector("#messages-container");e&&(e.scrollTop=e.scrollHeight)}addMessage(e,t,s=null,n=null){const r={id:this._messageId++,role:e,content:t,final:!0};s&&(r.images=s),n&&(r.editResults=n),this.messageHistory=[...this.messageHistory,r],this._scrollToBottom()}streamWrite(e,t=!1,s="assistant",n=null){setTimeout(()=>this._processStreamChunk(e,t,s,n),0)}_processStreamChunk(e,t,s,n=null){const r=this.messageHistory[this.messageHistory.length-1];if(r&&r.role===s&&!r.final)e&&(r.content=e),r.final=t,n&&n.length>0&&(r.editResults=n),this.messageHistory=[...this.messageHistory];else{const o={id:this._messageId++,role:s,content:e,final:t};n&&n.length>0&&(o.editResults=n),this.messageHistory=[...this.messageHistory,o]}this._scrollToBottom()}_scrollToBottom(){this._userHasScrolledUp||this.updateComplete.then(()=>{const e=this.shadowRoot?.querySelector("#messages-container");e&&requestAnimationFrame(()=>{e.scrollTop=e.scrollHeight})})}clearHistory(){this.messageHistory=[],this._userHasScrolledUp=!1,this._showScrollButton=!1,this.requestUpdate()}setupScrollObserver(){const e=this.shadowRoot?.querySelector("#messages-container");!e||this._resizeObserver||(this._resizeObserver=new ResizeObserver(()=>{this._userHasScrolledUp||(e.scrollTop=e.scrollHeight)}),this._resizeObserver.observe(e))}disconnectScrollObserver(){this._resizeObserver&&(this._resizeObserver.disconnect(),this._resizeObserver=null)}}const ni=U`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .dialog {
    position: relative;
    width: 400px;
    height: 100%;
    background: #16213e;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dialog.dragged {
    position: fixed;
    height: calc(100vh - 80px);
    max-height: calc(100vh - 80px);
  }

  .dialog.minimized {
    width: 200px;
    max-height: 48px;
  }

  .dialog.with-picker {
    width: 700px;
  }

  .header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: #0f3460;
    color: #e94560;
    font-weight: 600;
    cursor: grab;
    user-select: none;
  }

  .header:active {
    cursor: grabbing;
  }

  .header-section {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .header-left {
    flex: 1;
    justify-content: flex-start;
    cursor: pointer;
  }

  .header-tabs {
    flex: 1;
    justify-content: center;
  }

  .header-git {
    flex: 1;
    justify-content: center;
  }

  .header-right {
    flex: 1;
    justify-content: flex-end;
  }

  .header-tab {
    width: 32px;
    height: 32px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    color: #888;
    transition: all 0.15s;
  }

  .header-tab:hover {
    background: rgba(233, 69, 96, 0.1);
    color: #ccc;
  }

  .header-tab.active {
    background: rgba(233, 69, 96, 0.2);
    border-color: #e94560;
    color: #e94560;
  }



  .header-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #888;
    cursor: pointer;
    font-size: 14px;
    padding: 4px 6px;
    transition: all 0.15s;
  }

  .header-btn:hover {
    background: rgba(233, 69, 96, 0.1);
    color: #ccc;
  }

  .header-btn.commit-btn {
    color: #7ec699;
  }

  .header-btn.commit-btn:hover {
    background: rgba(126, 198, 153, 0.2);
    color: #7ec699;
  }

  .header-btn.reset-btn {
    color: #f0a500;
  }

  .header-btn.reset-btn:hover {
    background: rgba(240, 165, 0, 0.2);
    color: #f0a500;
  }

  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .picker-panel {
    min-width: 150px;
    max-width: 500px;
    border-right: 1px solid #0f3460;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  file-picker {
    flex: 1;
    min-height: 0;
  }

  .embedded-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .embedded-panel find-in-files,
  .embedded-panel context-viewer {
    flex: 1;
    min-height: 0;
  }

  .chat-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .messages-wrapper {
    flex: 1;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    contain: strict;
    content-visibility: auto;
    contain-intrinsic-size: auto 500px;
  }

  .messages user-card,
  .messages assistant-card {
    contain: content;
    content-visibility: auto;
    contain-intrinsic-size: auto 100px;
  }

  /* Force last 15 messages to render fully for accurate scroll heights */
  .messages user-card:nth-last-child(-n+15),
  .messages assistant-card:nth-last-child(-n+15) {
    content-visibility: visible;
    contain-intrinsic-size: unset;
  }

  .scroll-to-bottom-btn {
    position: absolute;
    bottom: 12px;
    right: 20px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #e94560;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 18px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s, transform 0.2s;
  }

  .scroll-to-bottom-btn:hover {
    background: #ff6b6b;
    transform: scale(1.1);
  }

  .image-preview-area {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid #0f3460;
    background: #1a1a2e;
    align-items: center;
  }

  .image-preview {
    position: relative;
    width: 60px;
    height: 60px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #0f3460;
  }

  .image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .image-preview .remove-image {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #e94560;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .image-preview .remove-image:hover {
    background: #ff6b6b;
  }

  .clear-images {
    background: #0f3460;
    color: #eee;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 11px;
  }

  .clear-images:hover {
    background: #1a3a6e;
  }

  .input-area {
    display: flex;
    padding: 12px;
    gap: 8px;
    border-top: 1px solid #0f3460;
  }

  textarea {
    flex: 1;
    resize: none;
    border: none;
    border-radius: 8px;
    padding: 10px;
    background: #1a1a2e;
    color: #eee;
    font-family: inherit;
    font-size: 14px;
    min-height: 40px;
    max-height: var(--textarea-max-height, 200px);
    overflow-y: auto;
  }

  textarea:focus {
    outline: 2px solid #e94560;
  }

  .send-btn {
    background: #e94560;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    cursor: pointer;
    font-weight: 600;
  }

  .send-btn:hover {
    background: #ff6b6b;
  }

  .send-btn.stop-btn {
    background: #f0a500;
  }

  .send-btn.stop-btn:hover {
    background: #ffb732;
  }

  textarea:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .file-btn {
    background: #1a1a2e;
    color: #eee;
    border: 1px solid #0f3460;
    border-radius: 8px;
    padding: 10px 12px;
    cursor: pointer;
    font-size: 14px;
  }

  .file-btn:hover {
    background: #0f3460;
  }

  .file-btn.active {
    background: #0f3460;
    border-color: #e94560;
  }

  .input-buttons-stack {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .input-buttons-stack .file-btn {
    padding: 6px 10px;
    font-size: 12px;
  }

  /* Snippet drawer - collapsible horizontal expand */
  .snippet-drawer {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .snippet-drawer-toggle {
    background: #1a1a2e;
    border: 1px solid #0f3460;
    border-radius: 6px;
    padding: 6px 8px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s;
    z-index: 1;
  }

  .snippet-drawer-toggle:hover {
    background: #0f3460;
    border-color: #e94560;
  }

  .snippet-drawer-toggle.open {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: none;
  }

  .snippet-drawer-content {
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: 0;
    overflow: hidden;
    transition: max-width 0.2s ease-out, padding 0.2s ease-out;
    background: #1a1a2e;
    border: 1px solid #0f3460;
    border-left: none;
    border-radius: 0 6px 6px 0;
    padding: 0;
  }

  .snippet-drawer.open .snippet-drawer-content {
    max-width: 300px;
    padding: 4px 6px;
  }

  .snippet-btn {
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 4px 6px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .snippet-btn:hover {
    background: rgba(233, 69, 96, 0.2);
    transform: scale(1.1);
  }

  /* Panel resizer */
  .panel-resizer {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 12px;
    background: #0f3460;
    position: relative;
    flex-shrink: 0;
  }

  .panel-resizer-handle {
    flex: 1;
    width: 100%;
    cursor: col-resize;
    transition: background 0.15s;
  }

  .panel-resizer-handle:hover {
    background: rgba(233, 69, 96, 0.3);
  }

  .panel-collapse-btn {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 8px 2px;
    font-size: 10px;
    transition: color 0.15s;
  }

  .panel-collapse-btn:hover {
    color: #e94560;
  }

  /* URL chips */
  .url-chips-area {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid #0f3460;
    background: #1a1a2e;
  }

  .url-chips-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .url-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 16px;
    font-size: 12px;
    max-width: 100%;
  }

  .url-chip.detected {
    background: #0f3460;
    border: 1px solid #4a9eff;
    color: #4a9eff;
  }

  .url-chip.fetching {
    background: #0f3460;
    border: 1px solid #f0a500;
    color: #f0a500;
  }

  .url-chip.fetched.success {
    background: #1a3d2e;
    border: 1px solid #7ec699;
    color: #7ec699;
  }

  .url-chip.fetched.excluded {
    background: #2a2a3e;
    border: 1px solid #666;
    color: #888;
  }

  .url-chip.fetched.error {
    background: #3d1a1a;
    border: 1px solid #e94560;
    color: #e94560;
  }

  .url-chip-checkbox {
    margin: 0;
    cursor: pointer;
    accent-color: #7ec699;
  }

  .url-chip-type {
    font-size: 11px;
    opacity: 0.9;
  }

  .url-chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .url-chip-icon {
    font-size: 14px;
  }

  .url-chip-loading {
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .url-chip-fetch,
  .url-chip-dismiss,
  .url-chip-remove {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 2px;
    font-size: 14px;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .url-chip-fetch:hover,
  .url-chip-dismiss:hover,
  .url-chip-remove:hover {
    opacity: 1;
  }

  .url-chip-fetch {
    color: #4a9eff;
  }

  .url-chip-dismiss,
  .url-chip-remove {
    color: inherit;
  }

  /* Resize handles */
  .resize-handle {
    position: absolute;
    background: transparent;
    z-index: 100;
  }

  .resize-handle-n {
    top: 0;
    left: 10px;
    right: 10px;
    height: 6px;
    cursor: n-resize;
  }

  .resize-handle-s {
    bottom: 0;
    left: 10px;
    right: 10px;
    height: 6px;
    cursor: s-resize;
  }

  .resize-handle-e {
    right: 0;
    top: 10px;
    bottom: 10px;
    width: 6px;
    cursor: e-resize;
  }

  .resize-handle-w {
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 6px;
    cursor: w-resize;
  }

  .resize-handle-ne {
    top: 0;
    right: 0;
    width: 12px;
    height: 12px;
    cursor: ne-resize;
  }

  .resize-handle-nw {
    top: 0;
    left: 0;
    width: 12px;
    height: 12px;
    cursor: nw-resize;
  }

  .resize-handle-se {
    bottom: 0;
    right: 0;
    width: 12px;
    height: 12px;
    cursor: se-resize;
  }

  .resize-handle-sw {
    bottom: 0;
    left: 0;
    width: 12px;
    height: 12px;
    cursor: sw-resize;
  }

  .resize-handle:hover {
    background: rgba(233, 69, 96, 0.3);
  }

  /* History token bar */
  .history-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: rgba(15, 52, 96, 0.5);
    border-radius: 0 0 12px 12px;
    overflow: hidden;
  }

  .history-bar-fill {
    height: 100%;
    background: #7ec699;
    transition: width 0.3s ease, background 0.3s ease;
  }

  .history-bar.warning .history-bar-fill {
    background: #f0a500;
  }

  .history-bar.critical .history-bar-fill {
    background: #e94560;
  }

  /* Token HUD overlay */
  .token-hud {
    position: fixed;
    top: 16px;
    right: 16px;
    background: rgba(22, 33, 62, 0.85);
    border: 1px solid rgba(233, 69, 96, 0.4);
    border-radius: 8px;
    padding: 12px 16px;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 12px;
    color: #aaa;
    pointer-events: none;
    z-index: 10000;
    backdrop-filter: blur(4px);
    opacity: 0;
    transform: translateY(-10px);
    transition: opacity 0.3s ease, transform 0.3s ease;
  }

  .token-hud.visible {
    opacity: 1;
    transform: translateY(0);
    animation: hud-fade-out 8s ease-in-out forwards;
    pointer-events: auto;
  }

  .token-hud.visible:hover {
    animation-play-state: paused;
  }

  @keyframes hud-fade-out {
    0% { opacity: 1; transform: translateY(0); }
    50% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-5px); }
  }

  .hud-title {
    color: #e94560;
    font-weight: 600;
    margin-bottom: 8px;
    font-size: 13px;
  }

  .hud-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 2px 0;
  }

  .hud-label {
    color: #888;
  }

  .hud-value {
    color: #ddd;
    font-weight: 500;
  }

  .hud-row.total {
    border-top: 1px solid rgba(233, 69, 96, 0.3);
    margin-top: 4px;
    padding-top: 6px;
  }

  .hud-row.total .hud-value {
    color: #e94560;
  }

  .hud-row.cache .hud-value {
    color: #7ec699;
  }

  .hud-divider {
    border-top: 1px solid rgba(233, 69, 96, 0.3);
    margin: 6px 0;
  }

  .hud-section-title {
    color: #888;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .hud-row.cumulative .hud-value {
    color: #4a9eff;
  }

  /* HUD header with cache badge */
  .hud-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .hud-header .hud-title {
    margin-bottom: 0;
  }

  .hud-cache-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 8px;
    background: rgba(126, 198, 153, 0.2);
    color: var(--cache-color, #7ec699);
    border: 1px solid var(--cache-color, #7ec699);
  }

  /* Cache tiers section */
  .hud-cache-header {
    display: flex;
    justify-content: center;
    margin-bottom: 6px;
  }

  .hud-cache-percent {
    font-size: 11px;
    font-weight: 600;
    color: var(--cache-percent-color, #7ec699);
  }

  .hud-tier-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hud-tier-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.03);
  }

  .hud-tier-label {
    font-weight: 600;
    color: var(--tier-color, #888);
    min-width: 36px;
  }

  .hud-tier-contents {
    flex: 1;
    color: #888;
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hud-tier-tokens {
    color: #ddd;
    min-width: 50px;
    text-align: right;
  }

  .hud-tier-cached {
    color: #7ec699;
    font-size: 8px;
  }

  .hud-tier-uncached {
    color: #666;
    font-size: 8px;
  }

  /* Promotion/demotion rows */
  .hud-row.promotion .hud-value {
    color: #7ec699;
  }

  .hud-row.demotion .hud-value {
    color: #f0a500;
  }

  .hud-row.cache-write .hud-value {
    color: #4a9eff;
  }

  .hud-row.history .hud-value {
    color: #7ec699;
  }

  .hud-row.history.warning .hud-value {
    color: #f0a500;
  }

  .hud-row.history.critical .hud-value {
    color: #e94560;
  }

  .hud-changes {
    font-size: 10px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

`;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const ts={CHILD:2},ss=i=>(...e)=>({_$litDirective$:i,values:e});class is{constructor(e){}get _$AU(){return this._$AM._$AU}_$AT(e,t,s){this._$Ct=e,this._$AM=t,this._$Ci=s}_$AS(e,t){return this.update(e,t)}update(e,t){return this.render(...t)}}/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{I:ri}=Zt,$t=()=>document.createComment(""),le=(i,e,t)=>{var s;const n=i._$AA.parentNode,r=e===void 0?i._$AB:e._$AA;if(t===void 0){const o=n.insertBefore($t(),r),a=n.insertBefore($t(),r);t=new ri(o,a,i,i.options)}else{const o=t._$AB.nextSibling,a=t._$AM,l=a!==i;if(l){let c;(s=t._$AQ)===null||s===void 0||s.call(t,i),t._$AM=i,t._$AP!==void 0&&(c=i._$AU)!==a._$AU&&t._$AP(c)}if(o!==r||l){let c=t._$AA;for(;c!==o;){const h=c.nextSibling;n.insertBefore(c,r),c=h}}}return t},Z=(i,e,t=i)=>(i._$AI(e,t),i),oi={},ai=(i,e=oi)=>i._$AH=e,li=i=>i._$AH,qe=i=>{var e;(e=i._$AP)===null||e===void 0||e.call(i,!1,!0);let t=i._$AA;const s=i._$AB.nextSibling;for(;t!==s;){const n=t.nextSibling;t.remove(),t=n}};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const St=(i,e,t)=>{const s=new Map;for(let n=e;n<=t;n++)s.set(i[n],n);return s},ci=ss(class extends is{constructor(i){if(super(i),i.type!==ts.CHILD)throw Error("repeat() can only be used in text expressions")}ct(i,e,t){let s;t===void 0?t=e:e!==void 0&&(s=e);const n=[],r=[];let o=0;for(const a of i)n[o]=s?s(a,o):o,r[o]=t(a,o),o++;return{values:r,keys:n}}render(i,e,t){return this.ct(i,e,t).values}update(i,[e,t,s]){var n;const r=li(i),{values:o,keys:a}=this.ct(e,t,s);if(!Array.isArray(r))return this.ut=a,o;const l=(n=this.ut)!==null&&n!==void 0?n:this.ut=[],c=[];let h,g,f=0,x=r.length-1,E=0,w=o.length-1;for(;f<=x&&E<=w;)if(r[f]===null)f++;else if(r[x]===null)x--;else if(l[f]===a[E])c[E]=Z(r[f],o[E]),f++,E++;else if(l[x]===a[w])c[w]=Z(r[x],o[w]),x--,w--;else if(l[f]===a[w])c[w]=Z(r[f],o[w]),le(i,c[w+1],r[f]),f++,w--;else if(l[x]===a[E])c[E]=Z(r[x],o[E]),le(i,r[f],r[x]),x--,E++;else if(h===void 0&&(h=St(a,E,w),g=St(l,f,x)),h.has(l[f]))if(h.has(l[x])){const k=g.get(a[E]),A=k!==void 0?r[k]:null;if(A===null){const u=le(i,r[f]);Z(u,o[E]),c[E]=u}else c[E]=Z(A,o[E]),le(i,r[f],A),r[k]=null;E++}else qe(r[x]),x--;else qe(r[f]),f++;for(;E<=w;){const k=le(i,c[w+1]);Z(k,o[E]),c[E++]=k}for(;f<=x;){const k=r[f++];k!==null&&qe(k)}return this.ut=a,ai(i,c),V}});class di extends z{static properties={content:{type:String},images:{type:Array}};constructor(){super(),this.content="",this.images=[]}static styles=U`
    :host {
      display: block;
    }

    .card {
      background: #0f3460;
      border-radius: 8px;
      padding: 12px;
      color: #eee;
      margin-left: 40px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .label {
      font-size: 11px;
      color: #e94560;
      font-weight: 600;
    }

    .actions {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .card:hover .actions {
      opacity: 1;
    }

    .action-btn {
      background: #1a1a2e;
      border: none;
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 11px;
      color: #888;
      transition: color 0.2s, background 0.2s;
    }

    .action-btn:hover {
      background: #0f3460;
      color: #e94560;
    }

    .content {
      white-space: pre-wrap;
      word-break: break-word;
    }

    .images {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .thumbnail {
      width: 60px;
      height: 60px;
      object-fit: cover;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid #1a1a2e;
      transition: border-color 0.2s;
    }

    .thumbnail:hover {
      border-color: #e94560;
    }

    dialog {
      padding: 16px;
      border: none;
      border-radius: 8px;
      background: #1a1a2e;
      max-width: 90vw;
      max-height: 90vh;
      position: fixed;
    }

    dialog::backdrop {
      background: rgba(0, 0, 0, 0.85);
    }

    dialog img {
      display: block;
      max-width: calc(90vw - 32px);
      max-height: calc(90vh - 32px);
      object-fit: contain;
    }

    .footer-actions {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #1a1a2e;
    }
  `;copyToClipboard(){navigator.clipboard.writeText(this.content)}copyToPrompt(){this.dispatchEvent(new CustomEvent("copy-to-prompt",{detail:{content:this.content},bubbles:!0,composed:!0}))}openLightbox(e){const t=this.shadowRoot.querySelector("dialog"),s=t.querySelector("img");s.src=e,t.showModal()}handleDialogClick(e){const t=this.shadowRoot.querySelector("dialog"),s=t.getBoundingClientRect();(e.clientX<s.left||e.clientX>s.right||e.clientY<s.top||e.clientY>s.bottom)&&t.close()}render(){return d`
      <div class="card">
        <div class="header">
          <div class="label">You</div>
          <div class="actions">
            <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
            <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
          </div>
        </div>
        <div class="content">${this.content}</div>
        ${this.images&&this.images.length>0?d`
          <div class="images">
            ${this.images.map(e=>d`
              <img 
                class="thumbnail" 
                src=${e.preview}
                @click=${()=>this.openLightbox(e.preview)}
                alt="Attached image"
              >
            `)}
          </div>
        `:""}
        <div class="footer-actions">
          <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
          <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
        </div>
      </div>
      <dialog @click=${e=>this.handleDialogClick(e)}>
        <img src="" alt="Full size image" @click=${e=>e.stopPropagation()}>
      </dialog>
    `}}customElements.define("user-card",di);/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */class Ze extends is{constructor(e){if(super(e),this.et=L,e.type!==ts.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(e){if(e===L||e==null)return this.ft=void 0,this.et=e;if(e===V)return e;if(typeof e!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(e===this.et)return this.ft;this.et=e;const t=[e];return t.raw=t,this.ft={_$litType$:this.constructor.resultType,strings:t,values:[]}}}Ze.directiveName="unsafeHTML",Ze.resultType=1;const Ve=ss(Ze);function nt(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}let te=nt();function ns(i){te=i}const rs=/[&<>"']/,hi=new RegExp(rs.source,"g"),os=/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,ui=new RegExp(os.source,"g"),pi={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Ct=i=>pi[i];function D(i,e){if(e){if(rs.test(i))return i.replace(hi,Ct)}else if(os.test(i))return i.replace(ui,Ct);return i}const fi=/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig;function gi(i){return i.replace(fi,(e,t)=>(t=t.toLowerCase(),t==="colon"?":":t.charAt(0)==="#"?t.charAt(1)==="x"?String.fromCharCode(parseInt(t.substring(2),16)):String.fromCharCode(+t.substring(1)):""))}const mi=/(^|[^\[])\^/g;function R(i,e){i=typeof i=="string"?i:i.source,e=e||"";const t={replace:(s,n)=>(n=typeof n=="object"&&"source"in n?n.source:n,n=n.replace(mi,"$1"),i=i.replace(s,n),t),getRegex:()=>new RegExp(i,e)};return t}function Et(i){try{i=encodeURI(i).replace(/%25/g,"%")}catch{return null}return i}const Te={exec:()=>null};function Ft(i,e){const t=i.replace(/\|/g,(r,o,a)=>{let l=!1,c=o;for(;--c>=0&&a[c]==="\\";)l=!l;return l?"|":" |"}),s=t.split(/ \|/);let n=0;if(s[0].trim()||s.shift(),s.length>0&&!s[s.length-1].trim()&&s.pop(),e)if(s.length>e)s.splice(e);else for(;s.length<e;)s.push("");for(;n<s.length;n++)s[n]=s[n].trim().replace(/\\\|/g,"|");return s}function we(i,e,t){const s=i.length;if(s===0)return"";let n=0;for(;n<s&&i.charAt(s-n-1)===e;)n++;return i.slice(0,s-n)}function bi(i,e){if(i.indexOf(e[1])===-1)return-1;let t=0;for(let s=0;s<i.length;s++)if(i[s]==="\\")s++;else if(i[s]===e[0])t++;else if(i[s]===e[1]&&(t--,t<0))return s;return-1}function Tt(i,e,t,s){const n=e.href,r=e.title?D(e.title):null,o=i[1].replace(/\\([\[\]])/g,"$1");if(i[0].charAt(0)!=="!"){s.state.inLink=!0;const a={type:"link",raw:t,href:n,title:r,text:o,tokens:s.inlineTokens(o)};return s.state.inLink=!1,a}return{type:"image",raw:t,href:n,title:r,text:D(o)}}function xi(i,e){const t=i.match(/^(\s+)(?:```)/);if(t===null)return e;const s=t[1];return e.split(`
`).map(n=>{const r=n.match(/^\s+/);if(r===null)return n;const[o]=r;return o.length>=s.length?n.slice(s.length):n}).join(`
`)}class Re{options;rules;lexer;constructor(e){this.options=e||te}space(e){const t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return{type:"space",raw:t[0]}}code(e){const t=this.rules.block.code.exec(e);if(t){const s=t[0].replace(/^ {1,4}/gm,"");return{type:"code",raw:t[0],codeBlockStyle:"indented",text:this.options.pedantic?s:we(s,`
`)}}}fences(e){const t=this.rules.block.fences.exec(e);if(t){const s=t[0],n=xi(s,t[3]||"");return{type:"code",raw:s,lang:t[2]?t[2].trim().replace(this.rules.inline._escapes,"$1"):t[2],text:n}}}heading(e){const t=this.rules.block.heading.exec(e);if(t){let s=t[2].trim();if(/#$/.test(s)){const n=we(s,"#");(this.options.pedantic||!n||/ $/.test(n))&&(s=n.trim())}return{type:"heading",raw:t[0],depth:t[1].length,text:s,tokens:this.lexer.inline(s)}}}hr(e){const t=this.rules.block.hr.exec(e);if(t)return{type:"hr",raw:t[0]}}blockquote(e){const t=this.rules.block.blockquote.exec(e);if(t){const s=we(t[0].replace(/^ *>[ \t]?/gm,""),`
`),n=this.lexer.state.top;this.lexer.state.top=!0;const r=this.lexer.blockTokens(s);return this.lexer.state.top=n,{type:"blockquote",raw:t[0],tokens:r,text:s}}}list(e){let t=this.rules.block.list.exec(e);if(t){let s=t[1].trim();const n=s.length>1,r={type:"list",raw:"",ordered:n,start:n?+s.slice(0,-1):"",loose:!1,items:[]};s=n?`\\d{1,9}\\${s.slice(-1)}`:`\\${s}`,this.options.pedantic&&(s=n?s:"[*+-]");const o=new RegExp(`^( {0,3}${s})((?:[	 ][^\\n]*)?(?:\\n|$))`);let a="",l="",c=!1;for(;e;){let h=!1;if(!(t=o.exec(e))||this.rules.block.hr.test(e))break;a=t[0],e=e.substring(a.length);let g=t[2].split(`
`,1)[0].replace(/^\t+/,A=>" ".repeat(3*A.length)),f=e.split(`
`,1)[0],x=0;this.options.pedantic?(x=2,l=g.trimStart()):(x=t[2].search(/[^ ]/),x=x>4?1:x,l=g.slice(x),x+=t[1].length);let E=!1;if(!g&&/^ *$/.test(f)&&(a+=f+`
`,e=e.substring(f.length+1),h=!0),!h){const A=new RegExp(`^ {0,${Math.min(3,x-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),u=new RegExp(`^ {0,${Math.min(3,x-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),p=new RegExp(`^ {0,${Math.min(3,x-1)}}(?:\`\`\`|~~~)`),m=new RegExp(`^ {0,${Math.min(3,x-1)}}#`);for(;e;){const b=e.split(`
`,1)[0];if(f=b,this.options.pedantic&&(f=f.replace(/^ {1,4}(?=( {4})*[^ ])/g,"  ")),p.test(f)||m.test(f)||A.test(f)||u.test(e))break;if(f.search(/[^ ]/)>=x||!f.trim())l+=`
`+f.slice(x);else{if(E||g.search(/[^ ]/)>=4||p.test(g)||m.test(g)||u.test(g))break;l+=`
`+f}!E&&!f.trim()&&(E=!0),a+=b+`
`,e=e.substring(b.length+1),g=f.slice(x)}}r.loose||(c?r.loose=!0:/\n *\n *$/.test(a)&&(c=!0));let w=null,k;this.options.gfm&&(w=/^\[[ xX]\] /.exec(l),w&&(k=w[0]!=="[ ] ",l=l.replace(/^\[[ xX]\] +/,""))),r.items.push({type:"list_item",raw:a,task:!!w,checked:k,loose:!1,text:l,tokens:[]}),r.raw+=a}r.items[r.items.length-1].raw=a.trimEnd(),r.items[r.items.length-1].text=l.trimEnd(),r.raw=r.raw.trimEnd();for(let h=0;h<r.items.length;h++)if(this.lexer.state.top=!1,r.items[h].tokens=this.lexer.blockTokens(r.items[h].text,[]),!r.loose){const g=r.items[h].tokens.filter(x=>x.type==="space"),f=g.length>0&&g.some(x=>/\n.*\n/.test(x.raw));r.loose=f}if(r.loose)for(let h=0;h<r.items.length;h++)r.items[h].loose=!0;return r}}html(e){const t=this.rules.block.html.exec(e);if(t)return{type:"html",block:!0,raw:t[0],pre:t[1]==="pre"||t[1]==="script"||t[1]==="style",text:t[0]}}def(e){const t=this.rules.block.def.exec(e);if(t){const s=t[1].toLowerCase().replace(/\s+/g," "),n=t[2]?t[2].replace(/^<(.*)>$/,"$1").replace(this.rules.inline._escapes,"$1"):"",r=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline._escapes,"$1"):t[3];return{type:"def",tag:s,raw:t[0],href:n,title:r}}}table(e){const t=this.rules.block.table.exec(e);if(t){if(!/[:|]/.test(t[2]))return;const s={type:"table",raw:t[0],header:Ft(t[1]).map(n=>({text:n,tokens:[]})),align:t[2].replace(/^\||\| *$/g,"").split("|"),rows:t[3]&&t[3].trim()?t[3].replace(/\n[ \t]*$/,"").split(`
`):[]};if(s.header.length===s.align.length){let n=s.align.length,r,o,a,l;for(r=0;r<n;r++){const c=s.align[r];c&&(/^ *-+: *$/.test(c)?s.align[r]="right":/^ *:-+: *$/.test(c)?s.align[r]="center":/^ *:-+ *$/.test(c)?s.align[r]="left":s.align[r]=null)}for(n=s.rows.length,r=0;r<n;r++)s.rows[r]=Ft(s.rows[r],s.header.length).map(c=>({text:c,tokens:[]}));for(n=s.header.length,o=0;o<n;o++)s.header[o].tokens=this.lexer.inline(s.header[o].text);for(n=s.rows.length,o=0;o<n;o++)for(l=s.rows[o],a=0;a<l.length;a++)l[a].tokens=this.lexer.inline(l[a].text);return s}}}lheading(e){const t=this.rules.block.lheading.exec(e);if(t)return{type:"heading",raw:t[0],depth:t[2].charAt(0)==="="?1:2,text:t[1],tokens:this.lexer.inline(t[1])}}paragraph(e){const t=this.rules.block.paragraph.exec(e);if(t){const s=t[1].charAt(t[1].length-1)===`
`?t[1].slice(0,-1):t[1];return{type:"paragraph",raw:t[0],text:s,tokens:this.lexer.inline(s)}}}text(e){const t=this.rules.block.text.exec(e);if(t)return{type:"text",raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){const t=this.rules.inline.escape.exec(e);if(t)return{type:"escape",raw:t[0],text:D(t[1])}}tag(e){const t=this.rules.inline.tag.exec(e);if(t)return!this.lexer.state.inLink&&/^<a /i.test(t[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&/^<\/a>/i.test(t[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&/^<(pre|code|kbd|script)(\s|>)/i.test(t[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&/^<\/(pre|code|kbd|script)(\s|>)/i.test(t[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:t[0]}}link(e){const t=this.rules.inline.link.exec(e);if(t){const s=t[2].trim();if(!this.options.pedantic&&/^</.test(s)){if(!/>$/.test(s))return;const o=we(s.slice(0,-1),"\\");if((s.length-o.length)%2===0)return}else{const o=bi(t[2],"()");if(o>-1){const l=(t[0].indexOf("!")===0?5:4)+t[1].length+o;t[2]=t[2].substring(0,o),t[0]=t[0].substring(0,l).trim(),t[3]=""}}let n=t[2],r="";if(this.options.pedantic){const o=/^([^'"]*[^\s])\s+(['"])(.*)\2/.exec(n);o&&(n=o[1],r=o[3])}else r=t[3]?t[3].slice(1,-1):"";return n=n.trim(),/^</.test(n)&&(this.options.pedantic&&!/>$/.test(s)?n=n.slice(1):n=n.slice(1,-1)),Tt(t,{href:n&&n.replace(this.rules.inline._escapes,"$1"),title:r&&r.replace(this.rules.inline._escapes,"$1")},t[0],this.lexer)}}reflink(e,t){let s;if((s=this.rules.inline.reflink.exec(e))||(s=this.rules.inline.nolink.exec(e))){let n=(s[2]||s[1]).replace(/\s+/g," ");if(n=t[n.toLowerCase()],!n){const r=s[0].charAt(0);return{type:"text",raw:r,text:r}}return Tt(s,n,s[0],this.lexer)}}emStrong(e,t,s=""){let n=this.rules.inline.emStrong.lDelim.exec(e);if(!n||n[3]&&s.match(/[\p{L}\p{N}]/u))return;if(!(n[1]||n[2]||"")||!s||this.rules.inline.punctuation.exec(s)){const o=[...n[0]].length-1;let a,l,c=o,h=0;const g=n[0][0]==="*"?this.rules.inline.emStrong.rDelimAst:this.rules.inline.emStrong.rDelimUnd;for(g.lastIndex=0,t=t.slice(-1*e.length+o);(n=g.exec(t))!=null;){if(a=n[1]||n[2]||n[3]||n[4]||n[5]||n[6],!a)continue;if(l=[...a].length,n[3]||n[4]){c+=l;continue}else if((n[5]||n[6])&&o%3&&!((o+l)%3)){h+=l;continue}if(c-=l,c>0)continue;l=Math.min(l,l+c+h);const f=[...n[0]][0].length,x=e.slice(0,o+n.index+f+l);if(Math.min(o,l)%2){const w=x.slice(1,-1);return{type:"em",raw:x,text:w,tokens:this.lexer.inlineTokens(w)}}const E=x.slice(2,-2);return{type:"strong",raw:x,text:E,tokens:this.lexer.inlineTokens(E)}}}}codespan(e){const t=this.rules.inline.code.exec(e);if(t){let s=t[2].replace(/\n/g," ");const n=/[^ ]/.test(s),r=/^ /.test(s)&&/ $/.test(s);return n&&r&&(s=s.substring(1,s.length-1)),s=D(s,!0),{type:"codespan",raw:t[0],text:s}}}br(e){const t=this.rules.inline.br.exec(e);if(t)return{type:"br",raw:t[0]}}del(e){const t=this.rules.inline.del.exec(e);if(t)return{type:"del",raw:t[0],text:t[2],tokens:this.lexer.inlineTokens(t[2])}}autolink(e){const t=this.rules.inline.autolink.exec(e);if(t){let s,n;return t[2]==="@"?(s=D(t[1]),n="mailto:"+s):(s=D(t[1]),n=s),{type:"link",raw:t[0],text:s,href:n,tokens:[{type:"text",raw:s,text:s}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let s,n;if(t[2]==="@")s=D(t[0]),n="mailto:"+s;else{let r;do r=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])[0];while(r!==t[0]);s=D(t[0]),t[1]==="www."?n="http://"+t[0]:n=t[0]}return{type:"link",raw:t[0],text:s,href:n,tokens:[{type:"text",raw:s,text:s}]}}}inlineText(e){const t=this.rules.inline.text.exec(e);if(t){let s;return this.lexer.state.inRawBlock?s=t[0]:s=D(t[0]),{type:"text",raw:t[0],text:s}}}}const _={newline:/^(?: *(?:\n|$))+/,code:/^( {4}[^\n]+(?:\n(?: *(?:\n|$))*)?)+/,fences:/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,hr:/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,heading:/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,blockquote:/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/,list:/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/,html:"^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n *)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n *)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n *)+\\n|$))",def:/^ {0,3}\[(label)\]: *(?:\n *)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n *)?| *\n *)(title))? *(?:\n+|$)/,table:Te,lheading:/^(?!bull )((?:.|\n(?!\s*?\n|bull ))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,_paragraph:/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,text:/^[^\n]+/};_._label=/(?!\s*\])(?:\\.|[^\[\]\\])+/;_._title=/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/;_.def=R(_.def).replace("label",_._label).replace("title",_._title).getRegex();_.bullet=/(?:[*+-]|\d{1,9}[.)])/;_.listItemStart=R(/^( *)(bull) */).replace("bull",_.bullet).getRegex();_.list=R(_.list).replace(/bull/g,_.bullet).replace("hr","\\n+(?=\\1?(?:(?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$))").replace("def","\\n+(?="+_.def.source+")").getRegex();_._tag="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";_._comment=/<!--(?!-?>)[\s\S]*?(?:-->|$)/;_.html=R(_.html,"i").replace("comment",_._comment).replace("tag",_._tag).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();_.lheading=R(_.lheading).replace(/bull/g,_.bullet).getRegex();_.paragraph=R(_._paragraph).replace("hr",_.hr).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",_._tag).getRegex();_.blockquote=R(_.blockquote).replace("paragraph",_.paragraph).getRegex();_.normal={..._};_.gfm={..._.normal,table:"^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)"};_.gfm.table=R(_.gfm.table).replace("hr",_.hr).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code"," {4}[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",_._tag).getRegex();_.gfm.paragraph=R(_._paragraph).replace("hr",_.hr).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",_.gfm.table).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",_._tag).getRegex();_.pedantic={..._.normal,html:R(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",_._comment).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:Te,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:R(_.normal._paragraph).replace("hr",_.hr).replace("heading",` *#{1,6} *[^
]`).replace("lheading",_.lheading).replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").getRegex()};const y={escape:/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,autolink:/^<(scheme:[^\s\x00-\x1f<>]*|email)>/,url:Te,tag:"^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>",link:/^!?\[(label)\]\(\s*(href)(?:\s+(title))?\s*\)/,reflink:/^!?\[(label)\]\[(ref)\]/,nolink:/^!?\[(ref)\](?:\[\])?/,reflinkSearch:"reflink|nolink(?!\\()",emStrong:{lDelim:/^(?:\*+(?:((?!\*)[punct])|[^\s*]))|^_+(?:((?!_)[punct])|([^\s_]))/,rDelimAst:/^[^_*]*?__[^_*]*?\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\*)[punct](\*+)(?=[\s]|$)|[^punct\s](\*+)(?!\*)(?=[punct\s]|$)|(?!\*)[punct\s](\*+)(?=[^punct\s])|[\s](\*+)(?!\*)(?=[punct])|(?!\*)[punct](\*+)(?!\*)(?=[punct])|[^punct\s](\*+)(?=[^punct\s])/,rDelimUnd:/^[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)|[^_]+(?=[^_])|(?!_)[punct](_+)(?=[\s]|$)|[^punct\s](_+)(?!_)(?=[punct\s]|$)|(?!_)[punct\s](_+)(?=[^punct\s])|[\s](_+)(?!_)(?=[punct])|(?!_)[punct](_+)(?!_)(?=[punct])/},code:/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,br:/^( {2,}|\\)\n(?!\s*$)/,del:Te,text:/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,punctuation:/^((?![*_])[\spunctuation])/};y._punctuation="\\p{P}$+<=>`^|~";y.punctuation=R(y.punctuation,"u").replace(/punctuation/g,y._punctuation).getRegex();y.blockSkip=/\[[^[\]]*?\]\([^\(\)]*?\)|`[^`]*?`|<[^<>]*?>/g;y.anyPunctuation=/\\[punct]/g;y._escapes=/\\([punct])/g;y._comment=R(_._comment).replace("(?:-->|$)","-->").getRegex();y.emStrong.lDelim=R(y.emStrong.lDelim,"u").replace(/punct/g,y._punctuation).getRegex();y.emStrong.rDelimAst=R(y.emStrong.rDelimAst,"gu").replace(/punct/g,y._punctuation).getRegex();y.emStrong.rDelimUnd=R(y.emStrong.rDelimUnd,"gu").replace(/punct/g,y._punctuation).getRegex();y.anyPunctuation=R(y.anyPunctuation,"gu").replace(/punct/g,y._punctuation).getRegex();y._escapes=R(y._escapes,"gu").replace(/punct/g,y._punctuation).getRegex();y._scheme=/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/;y._email=/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/;y.autolink=R(y.autolink).replace("scheme",y._scheme).replace("email",y._email).getRegex();y._attribute=/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/;y.tag=R(y.tag).replace("comment",y._comment).replace("attribute",y._attribute).getRegex();y._label=/(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/;y._href=/<(?:\\.|[^\n<>\\])+>|[^\s\x00-\x1f]*/;y._title=/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/;y.link=R(y.link).replace("label",y._label).replace("href",y._href).replace("title",y._title).getRegex();y.reflink=R(y.reflink).replace("label",y._label).replace("ref",_._label).getRegex();y.nolink=R(y.nolink).replace("ref",_._label).getRegex();y.reflinkSearch=R(y.reflinkSearch,"g").replace("reflink",y.reflink).replace("nolink",y.nolink).getRegex();y.normal={...y};y.pedantic={...y.normal,strong:{start:/^__|\*\*/,middle:/^__(?=\S)([\s\S]*?\S)__(?!_)|^\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/,endAst:/\*\*(?!\*)/g,endUnd:/__(?!_)/g},em:{start:/^_|\*/,middle:/^()\*(?=\S)([\s\S]*?\S)\*(?!\*)|^_(?=\S)([\s\S]*?\S)_(?!_)/,endAst:/\*(?!\*)/g,endUnd:/_(?!_)/g},link:R(/^!?\[(label)\]\((.*?)\)/).replace("label",y._label).getRegex(),reflink:R(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",y._label).getRegex()};y.gfm={...y.normal,escape:R(y.escape).replace("])","~|])").getRegex(),_extended_email:/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/,url:/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/,_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/,text:/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/};y.gfm.url=R(y.gfm.url,"i").replace("email",y.gfm._extended_email).getRegex();y.breaks={...y.gfm,br:R(y.br).replace("{2,}","*").getRegex(),text:R(y.gfm.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()};class j{tokens;options;state;tokenizer;inlineQueue;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||te,this.options.tokenizer=this.options.tokenizer||new Re,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};const t={block:_.normal,inline:y.normal};this.options.pedantic?(t.block=_.pedantic,t.inline=y.pedantic):this.options.gfm&&(t.block=_.gfm,this.options.breaks?t.inline=y.breaks:t.inline=y.gfm),this.tokenizer.rules=t}static get rules(){return{block:_,inline:y}}static lex(e,t){return new j(t).lex(e)}static lexInline(e,t){return new j(t).inlineTokens(e)}lex(e){e=e.replace(/\r\n|\r/g,`
`),this.blockTokens(e,this.tokens);let t;for(;t=this.inlineQueue.shift();)this.inlineTokens(t.src,t.tokens);return this.tokens}blockTokens(e,t=[]){this.options.pedantic?e=e.replace(/\t/g,"    ").replace(/^ +$/gm,""):e=e.replace(/^( *)(\t+)/gm,(a,l,c)=>l+"    ".repeat(c.length));let s,n,r,o;for(;e;)if(!(this.options.extensions&&this.options.extensions.block&&this.options.extensions.block.some(a=>(s=a.call({lexer:this},e,t))?(e=e.substring(s.raw.length),t.push(s),!0):!1))){if(s=this.tokenizer.space(e)){e=e.substring(s.raw.length),s.raw.length===1&&t.length>0?t[t.length-1].raw+=`
`:t.push(s);continue}if(s=this.tokenizer.code(e)){e=e.substring(s.raw.length),n=t[t.length-1],n&&(n.type==="paragraph"||n.type==="text")?(n.raw+=`
`+s.raw,n.text+=`
`+s.text,this.inlineQueue[this.inlineQueue.length-1].src=n.text):t.push(s);continue}if(s=this.tokenizer.fences(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.heading(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.hr(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.blockquote(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.list(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.html(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.def(e)){e=e.substring(s.raw.length),n=t[t.length-1],n&&(n.type==="paragraph"||n.type==="text")?(n.raw+=`
`+s.raw,n.text+=`
`+s.raw,this.inlineQueue[this.inlineQueue.length-1].src=n.text):this.tokens.links[s.tag]||(this.tokens.links[s.tag]={href:s.href,title:s.title});continue}if(s=this.tokenizer.table(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.lheading(e)){e=e.substring(s.raw.length),t.push(s);continue}if(r=e,this.options.extensions&&this.options.extensions.startBlock){let a=1/0;const l=e.slice(1);let c;this.options.extensions.startBlock.forEach(h=>{c=h.call({lexer:this},l),typeof c=="number"&&c>=0&&(a=Math.min(a,c))}),a<1/0&&a>=0&&(r=e.substring(0,a+1))}if(this.state.top&&(s=this.tokenizer.paragraph(r))){n=t[t.length-1],o&&n.type==="paragraph"?(n.raw+=`
`+s.raw,n.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue[this.inlineQueue.length-1].src=n.text):t.push(s),o=r.length!==e.length,e=e.substring(s.raw.length);continue}if(s=this.tokenizer.text(e)){e=e.substring(s.raw.length),n=t[t.length-1],n&&n.type==="text"?(n.raw+=`
`+s.raw,n.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue[this.inlineQueue.length-1].src=n.text):t.push(s);continue}if(e){const a="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(a);break}else throw new Error(a)}}return this.state.top=!0,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}inlineTokens(e,t=[]){let s,n,r,o=e,a,l,c;if(this.tokens.links){const h=Object.keys(this.tokens.links);if(h.length>0)for(;(a=this.tokenizer.rules.inline.reflinkSearch.exec(o))!=null;)h.includes(a[0].slice(a[0].lastIndexOf("[")+1,-1))&&(o=o.slice(0,a.index)+"["+"a".repeat(a[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(a=this.tokenizer.rules.inline.blockSkip.exec(o))!=null;)o=o.slice(0,a.index)+"["+"a".repeat(a[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);for(;(a=this.tokenizer.rules.inline.anyPunctuation.exec(o))!=null;)o=o.slice(0,a.index)+"++"+o.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);for(;e;)if(l||(c=""),l=!1,!(this.options.extensions&&this.options.extensions.inline&&this.options.extensions.inline.some(h=>(s=h.call({lexer:this},e,t))?(e=e.substring(s.raw.length),t.push(s),!0):!1))){if(s=this.tokenizer.escape(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.tag(e)){e=e.substring(s.raw.length),n=t[t.length-1],n&&s.type==="text"&&n.type==="text"?(n.raw+=s.raw,n.text+=s.text):t.push(s);continue}if(s=this.tokenizer.link(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(s.raw.length),n=t[t.length-1],n&&s.type==="text"&&n.type==="text"?(n.raw+=s.raw,n.text+=s.text):t.push(s);continue}if(s=this.tokenizer.emStrong(e,o,c)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.codespan(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.br(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.del(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.autolink(e)){e=e.substring(s.raw.length),t.push(s);continue}if(!this.state.inLink&&(s=this.tokenizer.url(e))){e=e.substring(s.raw.length),t.push(s);continue}if(r=e,this.options.extensions&&this.options.extensions.startInline){let h=1/0;const g=e.slice(1);let f;this.options.extensions.startInline.forEach(x=>{f=x.call({lexer:this},g),typeof f=="number"&&f>=0&&(h=Math.min(h,f))}),h<1/0&&h>=0&&(r=e.substring(0,h+1))}if(s=this.tokenizer.inlineText(r)){e=e.substring(s.raw.length),s.raw.slice(-1)!=="_"&&(c=s.raw.slice(-1)),l=!0,n=t[t.length-1],n&&n.type==="text"?(n.raw+=s.raw,n.text+=s.text):t.push(s);continue}if(e){const h="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(h);break}else throw new Error(h)}}return t}}class Ae{options;constructor(e){this.options=e||te}code(e,t,s){const n=(t||"").match(/^\S*/)?.[0];return e=e.replace(/\n$/,"")+`
`,n?'<pre><code class="language-'+D(n)+'">'+(s?e:D(e,!0))+`</code></pre>
`:"<pre><code>"+(s?e:D(e,!0))+`</code></pre>
`}blockquote(e){return`<blockquote>
${e}</blockquote>
`}html(e,t){return e}heading(e,t,s){return`<h${t}>${e}</h${t}>
`}hr(){return`<hr>
`}list(e,t,s){const n=t?"ol":"ul",r=t&&s!==1?' start="'+s+'"':"";return"<"+n+r+`>
`+e+"</"+n+`>
`}listitem(e,t,s){return`<li>${e}</li>
`}checkbox(e){return"<input "+(e?'checked="" ':"")+'disabled="" type="checkbox">'}paragraph(e){return`<p>${e}</p>
`}table(e,t){return t&&(t=`<tbody>${t}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+t+`</table>
`}tablerow(e){return`<tr>
${e}</tr>
`}tablecell(e,t){const s=t.header?"th":"td";return(t.align?`<${s} align="${t.align}">`:`<${s}>`)+e+`</${s}>
`}strong(e){return`<strong>${e}</strong>`}em(e){return`<em>${e}</em>`}codespan(e){return`<code>${e}</code>`}br(){return"<br>"}del(e){return`<del>${e}</del>`}link(e,t,s){const n=Et(e);if(n===null)return s;e=n;let r='<a href="'+e+'"';return t&&(r+=' title="'+t+'"'),r+=">"+s+"</a>",r}image(e,t,s){const n=Et(e);if(n===null)return s;e=n;let r=`<img src="${e}" alt="${s}"`;return t&&(r+=` title="${t}"`),r+=">",r}text(e){return e}}class rt{strong(e){return e}em(e){return e}codespan(e){return e}del(e){return e}html(e){return e}text(e){return e}link(e,t,s){return""+s}image(e,t,s){return""+s}br(){return""}}class B{options;renderer;textRenderer;constructor(e){this.options=e||te,this.options.renderer=this.options.renderer||new Ae,this.renderer=this.options.renderer,this.renderer.options=this.options,this.textRenderer=new rt}static parse(e,t){return new B(t).parse(e)}static parseInline(e,t){return new B(t).parseInline(e)}parse(e,t=!0){let s="";for(let n=0;n<e.length;n++){const r=e[n];if(this.options.extensions&&this.options.extensions.renderers&&this.options.extensions.renderers[r.type]){const o=r,a=this.options.extensions.renderers[o.type].call({parser:this},o);if(a!==!1||!["space","hr","heading","code","table","blockquote","list","html","paragraph","text"].includes(o.type)){s+=a||"";continue}}switch(r.type){case"space":continue;case"hr":{s+=this.renderer.hr();continue}case"heading":{const o=r;s+=this.renderer.heading(this.parseInline(o.tokens),o.depth,gi(this.parseInline(o.tokens,this.textRenderer)));continue}case"code":{const o=r;s+=this.renderer.code(o.text,o.lang,!!o.escaped);continue}case"table":{const o=r;let a="",l="";for(let h=0;h<o.header.length;h++)l+=this.renderer.tablecell(this.parseInline(o.header[h].tokens),{header:!0,align:o.align[h]});a+=this.renderer.tablerow(l);let c="";for(let h=0;h<o.rows.length;h++){const g=o.rows[h];l="";for(let f=0;f<g.length;f++)l+=this.renderer.tablecell(this.parseInline(g[f].tokens),{header:!1,align:o.align[f]});c+=this.renderer.tablerow(l)}s+=this.renderer.table(a,c);continue}case"blockquote":{const o=r,a=this.parse(o.tokens);s+=this.renderer.blockquote(a);continue}case"list":{const o=r,a=o.ordered,l=o.start,c=o.loose;let h="";for(let g=0;g<o.items.length;g++){const f=o.items[g],x=f.checked,E=f.task;let w="";if(f.task){const k=this.renderer.checkbox(!!x);c?f.tokens.length>0&&f.tokens[0].type==="paragraph"?(f.tokens[0].text=k+" "+f.tokens[0].text,f.tokens[0].tokens&&f.tokens[0].tokens.length>0&&f.tokens[0].tokens[0].type==="text"&&(f.tokens[0].tokens[0].text=k+" "+f.tokens[0].tokens[0].text)):f.tokens.unshift({type:"text",text:k+" "}):w+=k+" "}w+=this.parse(f.tokens,c),h+=this.renderer.listitem(w,E,!!x)}s+=this.renderer.list(h,a,l);continue}case"html":{const o=r;s+=this.renderer.html(o.text,o.block);continue}case"paragraph":{const o=r;s+=this.renderer.paragraph(this.parseInline(o.tokens));continue}case"text":{let o=r,a=o.tokens?this.parseInline(o.tokens):o.text;for(;n+1<e.length&&e[n+1].type==="text";)o=e[++n],a+=`
`+(o.tokens?this.parseInline(o.tokens):o.text);s+=t?this.renderer.paragraph(a):a;continue}default:{const o='Token with "'+r.type+'" type was not found.';if(this.options.silent)return console.error(o),"";throw new Error(o)}}}return s}parseInline(e,t){t=t||this.renderer;let s="";for(let n=0;n<e.length;n++){const r=e[n];if(this.options.extensions&&this.options.extensions.renderers&&this.options.extensions.renderers[r.type]){const o=this.options.extensions.renderers[r.type].call({parser:this},r);if(o!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(r.type)){s+=o||"";continue}}switch(r.type){case"escape":{const o=r;s+=t.text(o.text);break}case"html":{const o=r;s+=t.html(o.text);break}case"link":{const o=r;s+=t.link(o.href,o.title,this.parseInline(o.tokens,t));break}case"image":{const o=r;s+=t.image(o.href,o.title,o.text);break}case"strong":{const o=r;s+=t.strong(this.parseInline(o.tokens,t));break}case"em":{const o=r;s+=t.em(this.parseInline(o.tokens,t));break}case"codespan":{const o=r;s+=t.codespan(o.text);break}case"br":{s+=t.br();break}case"del":{const o=r;s+=t.del(this.parseInline(o.tokens,t));break}case"text":{const o=r;s+=t.text(o.text);break}default:{const o='Token with "'+r.type+'" type was not found.';if(this.options.silent)return console.error(o),"";throw new Error(o)}}}return s}}class $e{options;constructor(e){this.options=e||te}static passThroughHooks=new Set(["preprocess","postprocess"]);preprocess(e){return e}postprocess(e){return e}}class vi{defaults=nt();options=this.setOptions;parse=this.#e(j.lex,B.parse);parseInline=this.#e(j.lexInline,B.parseInline);Parser=B;Renderer=Ae;TextRenderer=rt;Lexer=j;Tokenizer=Re;Hooks=$e;constructor(...e){this.use(...e)}walkTokens(e,t){let s=[];for(const n of e)switch(s=s.concat(t.call(this,n)),n.type){case"table":{const r=n;for(const o of r.header)s=s.concat(this.walkTokens(o.tokens,t));for(const o of r.rows)for(const a of o)s=s.concat(this.walkTokens(a.tokens,t));break}case"list":{const r=n;s=s.concat(this.walkTokens(r.items,t));break}default:{const r=n;this.defaults.extensions?.childTokens?.[r.type]?this.defaults.extensions.childTokens[r.type].forEach(o=>{s=s.concat(this.walkTokens(r[o],t))}):r.tokens&&(s=s.concat(this.walkTokens(r.tokens,t)))}}return s}use(...e){const t=this.defaults.extensions||{renderers:{},childTokens:{}};return e.forEach(s=>{const n={...s};if(n.async=this.defaults.async||n.async||!1,s.extensions&&(s.extensions.forEach(r=>{if(!r.name)throw new Error("extension name required");if("renderer"in r){const o=t.renderers[r.name];o?t.renderers[r.name]=function(...a){let l=r.renderer.apply(this,a);return l===!1&&(l=o.apply(this,a)),l}:t.renderers[r.name]=r.renderer}if("tokenizer"in r){if(!r.level||r.level!=="block"&&r.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");const o=t[r.level];o?o.unshift(r.tokenizer):t[r.level]=[r.tokenizer],r.start&&(r.level==="block"?t.startBlock?t.startBlock.push(r.start):t.startBlock=[r.start]:r.level==="inline"&&(t.startInline?t.startInline.push(r.start):t.startInline=[r.start]))}"childTokens"in r&&r.childTokens&&(t.childTokens[r.name]=r.childTokens)}),n.extensions=t),s.renderer){const r=this.defaults.renderer||new Ae(this.defaults);for(const o in s.renderer){const a=s.renderer[o],l=o,c=r[l];r[l]=(...h)=>{let g=a.apply(r,h);return g===!1&&(g=c.apply(r,h)),g||""}}n.renderer=r}if(s.tokenizer){const r=this.defaults.tokenizer||new Re(this.defaults);for(const o in s.tokenizer){const a=s.tokenizer[o],l=o,c=r[l];r[l]=(...h)=>{let g=a.apply(r,h);return g===!1&&(g=c.apply(r,h)),g}}n.tokenizer=r}if(s.hooks){const r=this.defaults.hooks||new $e;for(const o in s.hooks){const a=s.hooks[o],l=o,c=r[l];$e.passThroughHooks.has(o)?r[l]=h=>{if(this.defaults.async)return Promise.resolve(a.call(r,h)).then(f=>c.call(r,f));const g=a.call(r,h);return c.call(r,g)}:r[l]=(...h)=>{let g=a.apply(r,h);return g===!1&&(g=c.apply(r,h)),g}}n.hooks=r}if(s.walkTokens){const r=this.defaults.walkTokens,o=s.walkTokens;n.walkTokens=function(a){let l=[];return l.push(o.call(this,a)),r&&(l=l.concat(r.call(this,a))),l}}this.defaults={...this.defaults,...n}}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return j.lex(e,t??this.defaults)}parser(e,t){return B.parse(e,t??this.defaults)}#e(e,t){return(s,n)=>{const r={...n},o={...this.defaults,...r};this.defaults.async===!0&&r.async===!1&&(o.silent||console.warn("marked(): The async option was set to true by an extension. The async: false option sent to parse will be ignored."),o.async=!0);const a=this.#t(!!o.silent,!!o.async);if(typeof s>"u"||s===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof s!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(s)+", string expected"));if(o.hooks&&(o.hooks.options=o),o.async)return Promise.resolve(o.hooks?o.hooks.preprocess(s):s).then(l=>e(l,o)).then(l=>o.walkTokens?Promise.all(this.walkTokens(l,o.walkTokens)).then(()=>l):l).then(l=>t(l,o)).then(l=>o.hooks?o.hooks.postprocess(l):l).catch(a);try{o.hooks&&(s=o.hooks.preprocess(s));const l=e(s,o);o.walkTokens&&this.walkTokens(l,o.walkTokens);let c=t(l,o);return o.hooks&&(c=o.hooks.postprocess(c)),c}catch(l){return a(l)}}}#t(e,t){return s=>{if(s.message+=`
Please report this to https://github.com/markedjs/marked.`,e){const n="<p>An error occurred:</p><pre>"+D(s.message+"",!0)+"</pre>";return t?Promise.resolve(n):n}if(t)return Promise.reject(s);throw s}}}const ee=new vi;function T(i,e){return ee.parse(i,e)}T.options=T.setOptions=function(i){return ee.setOptions(i),T.defaults=ee.defaults,ns(T.defaults),T};T.getDefaults=nt;T.defaults=te;T.use=function(...i){return ee.use(...i),T.defaults=ee.defaults,ns(T.defaults),T};T.walkTokens=function(i,e){return ee.walkTokens(i,e)};T.parseInline=ee.parseInline;T.Parser=B;T.parser=B.parse;T.Renderer=Ae;T.TextRenderer=rt;T.Lexer=j;T.lexer=j.lex;T.Tokenizer=Re;T.Hooks=$e;T.parse=T;T.options;T.setOptions;T.use;T.walkTokens;T.parseInline;B.parse;j.lex;var yi={exports:{}};(function(i){var e=typeof window<"u"?window:typeof WorkerGlobalScope<"u"&&self instanceof WorkerGlobalScope?self:{};/**
 * Prism: Lightweight, robust, elegant syntax highlighting
 *
 * @license MIT <https://opensource.org/licenses/MIT>
 * @author Lea Verou <https://lea.verou.me>
 * @namespace
 * @public
 */var t=function(s){var n=/(?:^|\s)lang(?:uage)?-([\w-]+)(?=\s|$)/i,r=0,o={},a={manual:s.Prism&&s.Prism.manual,disableWorkerMessageHandler:s.Prism&&s.Prism.disableWorkerMessageHandler,util:{encode:function u(p){return p instanceof l?new l(p.type,u(p.content),p.alias):Array.isArray(p)?p.map(u):p.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\u00a0/g," ")},type:function(u){return Object.prototype.toString.call(u).slice(8,-1)},objId:function(u){return u.__id||Object.defineProperty(u,"__id",{value:++r}),u.__id},clone:function u(p,m){m=m||{};var b,v;switch(a.util.type(p)){case"Object":if(v=a.util.objId(p),m[v])return m[v];b={},m[v]=b;for(var S in p)p.hasOwnProperty(S)&&(b[S]=u(p[S],m));return b;case"Array":return v=a.util.objId(p),m[v]?m[v]:(b=[],m[v]=b,p.forEach(function(F,$){b[$]=u(F,m)}),b);default:return p}},getLanguage:function(u){for(;u;){var p=n.exec(u.className);if(p)return p[1].toLowerCase();u=u.parentElement}return"none"},setLanguage:function(u,p){u.className=u.className.replace(RegExp(n,"gi"),""),u.classList.add("language-"+p)},currentScript:function(){if(typeof document>"u")return null;if(document.currentScript&&document.currentScript.tagName==="SCRIPT")return document.currentScript;try{throw new Error}catch(b){var u=(/at [^(\r\n]*\((.*):[^:]+:[^:]+\)$/i.exec(b.stack)||[])[1];if(u){var p=document.getElementsByTagName("script");for(var m in p)if(p[m].src==u)return p[m]}return null}},isActive:function(u,p,m){for(var b="no-"+p;u;){var v=u.classList;if(v.contains(p))return!0;if(v.contains(b))return!1;u=u.parentElement}return!!m}},languages:{plain:o,plaintext:o,text:o,txt:o,extend:function(u,p){var m=a.util.clone(a.languages[u]);for(var b in p)m[b]=p[b];return m},insertBefore:function(u,p,m,b){b=b||a.languages;var v=b[u],S={};for(var F in v)if(v.hasOwnProperty(F)){if(F==p)for(var $ in m)m.hasOwnProperty($)&&(S[$]=m[$]);m.hasOwnProperty(F)||(S[F]=v[F])}var M=b[u];return b[u]=S,a.languages.DFS(a.languages,function(I,W){W===M&&I!=u&&(this[I]=S)}),S},DFS:function u(p,m,b,v){v=v||{};var S=a.util.objId;for(var F in p)if(p.hasOwnProperty(F)){m.call(p,F,p[F],b||F);var $=p[F],M=a.util.type($);M==="Object"&&!v[S($)]?(v[S($)]=!0,u($,m,null,v)):M==="Array"&&!v[S($)]&&(v[S($)]=!0,u($,m,F,v))}}},plugins:{},highlightAll:function(u,p){a.highlightAllUnder(document,u,p)},highlightAllUnder:function(u,p,m){var b={callback:m,container:u,selector:'code[class*="language-"], [class*="language-"] code, code[class*="lang-"], [class*="lang-"] code'};a.hooks.run("before-highlightall",b),b.elements=Array.prototype.slice.apply(b.container.querySelectorAll(b.selector)),a.hooks.run("before-all-elements-highlight",b);for(var v=0,S;S=b.elements[v++];)a.highlightElement(S,p===!0,b.callback)},highlightElement:function(u,p,m){var b=a.util.getLanguage(u),v=a.languages[b];a.util.setLanguage(u,b);var S=u.parentElement;S&&S.nodeName.toLowerCase()==="pre"&&a.util.setLanguage(S,b);var F=u.textContent,$={element:u,language:b,grammar:v,code:F};function M(W){$.highlightedCode=W,a.hooks.run("before-insert",$),$.element.innerHTML=$.highlightedCode,a.hooks.run("after-highlight",$),a.hooks.run("complete",$),m&&m.call($.element)}if(a.hooks.run("before-sanity-check",$),S=$.element.parentElement,S&&S.nodeName.toLowerCase()==="pre"&&!S.hasAttribute("tabindex")&&S.setAttribute("tabindex","0"),!$.code){a.hooks.run("complete",$),m&&m.call($.element);return}if(a.hooks.run("before-highlight",$),!$.grammar){M(a.util.encode($.code));return}if(p&&s.Worker){var I=new Worker(a.filename);I.onmessage=function(W){M(W.data)},I.postMessage(JSON.stringify({language:$.language,code:$.code,immediateClose:!0}))}else M(a.highlight($.code,$.grammar,$.language))},highlight:function(u,p,m){var b={code:u,grammar:p,language:m};if(a.hooks.run("before-tokenize",b),!b.grammar)throw new Error('The language "'+b.language+'" has no grammar.');return b.tokens=a.tokenize(b.code,b.grammar),a.hooks.run("after-tokenize",b),l.stringify(a.util.encode(b.tokens),b.language)},tokenize:function(u,p){var m=p.rest;if(m){for(var b in m)p[b]=m[b];delete p.rest}var v=new g;return f(v,v.head,u),h(u,v,p,v.head,0),E(v)},hooks:{all:{},add:function(u,p){var m=a.hooks.all;m[u]=m[u]||[],m[u].push(p)},run:function(u,p){var m=a.hooks.all[u];if(!(!m||!m.length))for(var b=0,v;v=m[b++];)v(p)}},Token:l};s.Prism=a;function l(u,p,m,b){this.type=u,this.content=p,this.alias=m,this.length=(b||"").length|0}l.stringify=function u(p,m){if(typeof p=="string")return p;if(Array.isArray(p)){var b="";return p.forEach(function(M){b+=u(M,m)}),b}var v={type:p.type,content:u(p.content,m),tag:"span",classes:["token",p.type],attributes:{},language:m},S=p.alias;S&&(Array.isArray(S)?Array.prototype.push.apply(v.classes,S):v.classes.push(S)),a.hooks.run("wrap",v);var F="";for(var $ in v.attributes)F+=" "+$+'="'+(v.attributes[$]||"").replace(/"/g,"&quot;")+'"';return"<"+v.tag+' class="'+v.classes.join(" ")+'"'+F+">"+v.content+"</"+v.tag+">"};function c(u,p,m,b){u.lastIndex=p;var v=u.exec(m);if(v&&b&&v[1]){var S=v[1].length;v.index+=S,v[0]=v[0].slice(S)}return v}function h(u,p,m,b,v,S){for(var F in m)if(!(!m.hasOwnProperty(F)||!m[F])){var $=m[F];$=Array.isArray($)?$:[$];for(var M=0;M<$.length;++M){if(S&&S.cause==F+","+M)return;var I=$[M],W=I.inside,at=!!I.lookbehind,lt=!!I.greedy,us=I.alias;if(lt&&!I.pattern.global){var ps=I.pattern.toString().match(/[imsuy]*$/)[0];I.pattern=RegExp(I.pattern.source,ps+"g")}for(var ct=I.pattern||I,P=b.next,O=v;P!==p.tail&&!(S&&O>=S.reach);O+=P.value.length,P=P.next){var se=P.value;if(p.length>u.length)return;if(!(se instanceof l)){var me=1,H;if(lt){if(H=c(ct,O,u,at),!H||H.index>=u.length)break;var be=H.index,fs=H.index+H[0].length,G=O;for(G+=P.value.length;be>=G;)P=P.next,G+=P.value.length;if(G-=P.value.length,O=G,P.value instanceof l)continue;for(var re=P;re!==p.tail&&(G<fs||typeof re.value=="string");re=re.next)me++,G+=re.value.length;me--,se=u.slice(O,G),H.index-=O}else if(H=c(ct,0,se,at),!H)continue;var be=H.index,xe=H[0],Ue=se.slice(0,be),dt=se.slice(be+xe.length),Ie=O+se.length;S&&Ie>S.reach&&(S.reach=Ie);var ve=P.prev;Ue&&(ve=f(p,ve,Ue),O+=Ue.length),x(p,ve,me);var gs=new l(F,W?a.tokenize(xe,W):xe,us,xe);if(P=f(p,ve,gs),dt&&f(p,P,dt),me>1){var Pe={cause:F+","+M,reach:Ie};h(u,p,m,P.prev,O,Pe),S&&Pe.reach>S.reach&&(S.reach=Pe.reach)}}}}}}function g(){var u={value:null,prev:null,next:null},p={value:null,prev:u,next:null};u.next=p,this.head=u,this.tail=p,this.length=0}function f(u,p,m){var b=p.next,v={value:m,prev:p,next:b};return p.next=v,b.prev=v,u.length++,v}function x(u,p,m){for(var b=p.next,v=0;v<m&&b!==u.tail;v++)b=b.next;p.next=b,b.prev=p,u.length-=v}function E(u){for(var p=[],m=u.head.next;m!==u.tail;)p.push(m.value),m=m.next;return p}if(!s.document)return s.addEventListener&&(a.disableWorkerMessageHandler||s.addEventListener("message",function(u){var p=JSON.parse(u.data),m=p.language,b=p.code,v=p.immediateClose;s.postMessage(a.highlight(b,a.languages[m],m)),v&&s.close()},!1)),a;var w=a.util.currentScript();w&&(a.filename=w.src,w.hasAttribute("data-manual")&&(a.manual=!0));function k(){a.manual||a.highlightAll()}if(!a.manual){var A=document.readyState;A==="loading"||A==="interactive"&&w&&w.defer?document.addEventListener("DOMContentLoaded",k):window.requestAnimationFrame?window.requestAnimationFrame(k):window.setTimeout(k,16)}return a}(e);i.exports&&(i.exports=t),typeof Xe<"u"&&(Xe.Prism=t),t.languages.markup={comment:{pattern:/<!--(?:(?!<!--)[\s\S])*?-->/,greedy:!0},prolog:{pattern:/<\?[\s\S]+?\?>/,greedy:!0},doctype:{pattern:/<!DOCTYPE(?:[^>"'[\]]|"[^"]*"|'[^']*')+(?:\[(?:[^<"'\]]|"[^"]*"|'[^']*'|<(?!!--)|<!--(?:[^-]|-(?!->))*-->)*\]\s*)?>/i,greedy:!0,inside:{"internal-subset":{pattern:/(^[^\[]*\[)[\s\S]+(?=\]>$)/,lookbehind:!0,greedy:!0,inside:null},string:{pattern:/"[^"]*"|'[^']*'/,greedy:!0},punctuation:/^<!|>$|[[\]]/,"doctype-tag":/^DOCTYPE/i,name:/[^\s<>'"]+/}},cdata:{pattern:/<!\[CDATA\[[\s\S]*?\]\]>/i,greedy:!0},tag:{pattern:/<\/?(?!\d)[^\s>\/=$<%]+(?:\s(?:\s*[^\s>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))|(?=[\s/>])))+)?\s*\/?>/,greedy:!0,inside:{tag:{pattern:/^<\/?[^\s>\/]+/,inside:{punctuation:/^<\/?/,namespace:/^[^\s>\/:]+:/}},"special-attr":[],"attr-value":{pattern:/=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+)/,inside:{punctuation:[{pattern:/^=/,alias:"attr-equals"},{pattern:/^(\s*)["']|["']$/,lookbehind:!0}]}},punctuation:/\/?>/,"attr-name":{pattern:/[^\s>\/]+/,inside:{namespace:/^[^\s>\/:]+:/}}}},entity:[{pattern:/&[\da-z]{1,8};/i,alias:"named-entity"},/&#x?[\da-f]{1,8};/i]},t.languages.markup.tag.inside["attr-value"].inside.entity=t.languages.markup.entity,t.languages.markup.doctype.inside["internal-subset"].inside=t.languages.markup,t.hooks.add("wrap",function(s){s.type==="entity"&&(s.attributes.title=s.content.replace(/&amp;/,"&"))}),Object.defineProperty(t.languages.markup.tag,"addInlined",{value:function(n,r){var o={};o["language-"+r]={pattern:/(^<!\[CDATA\[)[\s\S]+?(?=\]\]>$)/i,lookbehind:!0,inside:t.languages[r]},o.cdata=/^<!\[CDATA\[|\]\]>$/i;var a={"included-cdata":{pattern:/<!\[CDATA\[[\s\S]*?\]\]>/i,inside:o}};a["language-"+r]={pattern:/[\s\S]+/,inside:t.languages[r]};var l={};l[n]={pattern:RegExp(/(<__[^>]*>)(?:<!\[CDATA\[(?:[^\]]|\](?!\]>))*\]\]>|(?!<!\[CDATA\[)[\s\S])*?(?=<\/__>)/.source.replace(/__/g,function(){return n}),"i"),lookbehind:!0,greedy:!0,inside:a},t.languages.insertBefore("markup","cdata",l)}}),Object.defineProperty(t.languages.markup.tag,"addAttribute",{value:function(s,n){t.languages.markup.tag.inside["special-attr"].push({pattern:RegExp(/(^|["'\s])/.source+"(?:"+s+")"+/\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))/.source,"i"),lookbehind:!0,inside:{"attr-name":/^[^\s=]+/,"attr-value":{pattern:/=[\s\S]+/,inside:{value:{pattern:/(^=\s*(["']|(?!["'])))\S[\s\S]*(?=\2$)/,lookbehind:!0,alias:[n,"language-"+n],inside:t.languages[n]},punctuation:[{pattern:/^=/,alias:"attr-equals"},/"|'/]}}}})}}),t.languages.html=t.languages.markup,t.languages.mathml=t.languages.markup,t.languages.svg=t.languages.markup,t.languages.xml=t.languages.extend("markup",{}),t.languages.ssml=t.languages.xml,t.languages.atom=t.languages.xml,t.languages.rss=t.languages.xml,function(s){var n=/(?:"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n])*')/;s.languages.css={comment:/\/\*[\s\S]*?\*\//,atrule:{pattern:RegExp("@[\\w-](?:"+/[^;{\s"']|\s+(?!\s)/.source+"|"+n.source+")*?"+/(?:;|(?=\s*\{))/.source),inside:{rule:/^@[\w-]+/,"selector-function-argument":{pattern:/(\bselector\s*\(\s*(?![\s)]))(?:[^()\s]|\s+(?![\s)])|\((?:[^()]|\([^()]*\))*\))+(?=\s*\))/,lookbehind:!0,alias:"selector"},keyword:{pattern:/(^|[^\w-])(?:and|not|only|or)(?![\w-])/,lookbehind:!0}}},url:{pattern:RegExp("\\burl\\((?:"+n.source+"|"+/(?:[^\\\r\n()"']|\\[\s\S])*/.source+")\\)","i"),greedy:!0,inside:{function:/^url/i,punctuation:/^\(|\)$/,string:{pattern:RegExp("^"+n.source+"$"),alias:"url"}}},selector:{pattern:RegExp(`(^|[{}\\s])[^{}\\s](?:[^{};"'\\s]|\\s+(?![\\s{])|`+n.source+")*(?=\\s*\\{)"),lookbehind:!0},string:{pattern:n,greedy:!0},property:{pattern:/(^|[^-\w\xA0-\uFFFF])(?!\s)[-_a-z\xA0-\uFFFF](?:(?!\s)[-\w\xA0-\uFFFF])*(?=\s*:)/i,lookbehind:!0},important:/!important\b/i,function:{pattern:/(^|[^-a-z0-9])[-a-z0-9]+(?=\()/i,lookbehind:!0},punctuation:/[(){};:,]/},s.languages.css.atrule.inside.rest=s.languages.css;var r=s.languages.markup;r&&(r.tag.addInlined("style","css"),r.tag.addAttribute("style","css"))}(t),t.languages.clike={comment:[{pattern:/(^|[^\\])\/\*[\s\S]*?(?:\*\/|$)/,lookbehind:!0,greedy:!0},{pattern:/(^|[^\\:])\/\/.*/,lookbehind:!0,greedy:!0}],string:{pattern:/(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/,greedy:!0},"class-name":{pattern:/(\b(?:class|extends|implements|instanceof|interface|new|trait)\s+|\bcatch\s+\()[\w.\\]+/i,lookbehind:!0,inside:{punctuation:/[.\\]/}},keyword:/\b(?:break|catch|continue|do|else|finally|for|function|if|in|instanceof|new|null|return|throw|try|while)\b/,boolean:/\b(?:false|true)\b/,function:/\b\w+(?=\()/,number:/\b0x[\da-f]+\b|(?:\b\d+(?:\.\d*)?|\B\.\d+)(?:e[+-]?\d+)?/i,operator:/[<>]=?|[!=]=?=?|--?|\+\+?|&&?|\|\|?|[?*/~^%]/,punctuation:/[{}[\];(),.:]/},t.languages.javascript=t.languages.extend("clike",{"class-name":[t.languages.clike["class-name"],{pattern:/(^|[^$\w\xA0-\uFFFF])(?!\s)[_$A-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\.(?:constructor|prototype))/,lookbehind:!0}],keyword:[{pattern:/((?:^|\})\s*)catch\b/,lookbehind:!0},{pattern:/(^|[^.]|\.\.\.\s*)\b(?:as|assert(?=\s*\{)|async(?=\s*(?:function\b|\(|[$\w\xA0-\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally(?=\s*(?:\{|$))|for|from(?=\s*(?:['"]|$))|function|(?:get|set)(?=\s*(?:[#\[$\w\xA0-\uFFFF]|$))|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\b/,lookbehind:!0}],function:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*(?:\.\s*(?:apply|bind|call)\s*)?\()/,number:{pattern:RegExp(/(^|[^\w$])/.source+"(?:"+(/NaN|Infinity/.source+"|"+/0[bB][01]+(?:_[01]+)*n?/.source+"|"+/0[oO][0-7]+(?:_[0-7]+)*n?/.source+"|"+/0[xX][\dA-Fa-f]+(?:_[\dA-Fa-f]+)*n?/.source+"|"+/\d+(?:_\d+)*n/.source+"|"+/(?:\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[Ee][+-]?\d+(?:_\d+)*)?/.source)+")"+/(?![\w$])/.source),lookbehind:!0},operator:/--|\+\+|\*\*=?|=>|&&=?|\|\|=?|[!=]==|<<=?|>>>?=?|[-+*/%&|^!=<>]=?|\.{3}|\?\?=?|\?\.?|[~:]/}),t.languages.javascript["class-name"][0].pattern=/(\b(?:class|extends|implements|instanceof|interface|new)\s+)[\w.\\]+/,t.languages.insertBefore("javascript","keyword",{regex:{pattern:RegExp(/((?:^|[^$\w\xA0-\uFFFF."'\])\s]|\b(?:return|yield))\s*)/.source+/\//.source+"(?:"+/(?:\[(?:[^\]\\\r\n]|\\.)*\]|\\.|[^/\\\[\r\n])+\/[dgimyus]{0,7}/.source+"|"+/(?:\[(?:[^[\]\\\r\n]|\\.|\[(?:[^[\]\\\r\n]|\\.|\[(?:[^[\]\\\r\n]|\\.)*\])*\])*\]|\\.|[^/\\\[\r\n])+\/[dgimyus]{0,7}v[dgimyus]{0,7}/.source+")"+/(?=(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?:$|[\r\n,.;:})\]]|\/\/))/.source),lookbehind:!0,greedy:!0,inside:{"regex-source":{pattern:/^(\/)[\s\S]+(?=\/[a-z]*$)/,lookbehind:!0,alias:"language-regex",inside:t.languages.regex},"regex-delimiter":/^\/|\/$/,"regex-flags":/^[a-z]+$/}},"function-variable":{pattern:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*[=:]\s*(?:async\s*)?(?:\bfunction\b|(?:\((?:[^()]|\([^()]*\))*\)|(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)\s*=>))/,alias:"function"},parameter:[{pattern:/(function(?:\s+(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)?\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\))/,lookbehind:!0,inside:t.languages.javascript},{pattern:/(^|[^$\w\xA0-\uFFFF])(?!\s)[_$a-z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*=>)/i,lookbehind:!0,inside:t.languages.javascript},{pattern:/(\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*=>)/,lookbehind:!0,inside:t.languages.javascript},{pattern:/((?:\b|\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\w\xA0-\uFFFF]))(?:(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*\s*)\(\s*|\]\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*\{)/,lookbehind:!0,inside:t.languages.javascript}],constant:/\b[A-Z](?:[A-Z_]|\dx?)*\b/}),t.languages.insertBefore("javascript","string",{hashbang:{pattern:/^#!.*/,greedy:!0,alias:"comment"},"template-string":{pattern:/`(?:\\[\s\S]|\$\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})+\}|(?!\$\{)[^\\`])*`/,greedy:!0,inside:{"template-punctuation":{pattern:/^`|`$/,alias:"string"},interpolation:{pattern:/((?:^|[^\\])(?:\\{2})*)\$\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})+\}/,lookbehind:!0,inside:{"interpolation-punctuation":{pattern:/^\$\{|\}$/,alias:"punctuation"},rest:t.languages.javascript}},string:/[\s\S]+/}},"string-property":{pattern:/((?:^|[,{])[ \t]*)(["'])(?:\\(?:\r\n|[\s\S])|(?!\2)[^\\\r\n])*\2(?=\s*:)/m,lookbehind:!0,greedy:!0,alias:"property"}}),t.languages.insertBefore("javascript","operator",{"literal-property":{pattern:/((?:^|[,{])[ \t]*)(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*:)/m,lookbehind:!0,alias:"property"}}),t.languages.markup&&(t.languages.markup.tag.addInlined("script","javascript"),t.languages.markup.tag.addAttribute(/on(?:abort|blur|change|click|composition(?:end|start|update)|dblclick|error|focus(?:in|out)?|key(?:down|up)|load|mouse(?:down|enter|leave|move|out|over|up)|reset|resize|scroll|select|slotchange|submit|unload|wheel)/.source,"javascript")),t.languages.js=t.languages.javascript,function(){if(typeof t>"u"||typeof document>"u")return;Element.prototype.matches||(Element.prototype.matches=Element.prototype.msMatchesSelector||Element.prototype.webkitMatchesSelector);var s="Loading…",n=function(w,k){return"✖ Error "+w+" while fetching file: "+k},r="✖ Error: File does not exist or is empty",o={js:"javascript",py:"python",rb:"ruby",ps1:"powershell",psm1:"powershell",sh:"bash",bat:"batch",h:"c",tex:"latex"},a="data-src-status",l="loading",c="loaded",h="failed",g="pre[data-src]:not(["+a+'="'+c+'"]):not(['+a+'="'+l+'"])';function f(w,k,A){var u=new XMLHttpRequest;u.open("GET",w,!0),u.onreadystatechange=function(){u.readyState==4&&(u.status<400&&u.responseText?k(u.responseText):u.status>=400?A(n(u.status,u.statusText)):A(r))},u.send(null)}function x(w){var k=/^\s*(\d+)\s*(?:(,)\s*(?:(\d+)\s*)?)?$/.exec(w||"");if(k){var A=Number(k[1]),u=k[2],p=k[3];return u?p?[A,Number(p)]:[A,void 0]:[A,A]}}t.hooks.add("before-highlightall",function(w){w.selector+=", "+g}),t.hooks.add("before-sanity-check",function(w){var k=w.element;if(k.matches(g)){w.code="",k.setAttribute(a,l);var A=k.appendChild(document.createElement("CODE"));A.textContent=s;var u=k.getAttribute("data-src"),p=w.language;if(p==="none"){var m=(/\.(\w+)$/.exec(u)||[,"none"])[1];p=o[m]||m}t.util.setLanguage(A,p),t.util.setLanguage(k,p);var b=t.plugins.autoloader;b&&b.loadLanguages(p),f(u,function(v){k.setAttribute(a,c);var S=x(k.getAttribute("data-range"));if(S){var F=v.split(/\r\n?|\n/g),$=S[0],M=S[1]==null?F.length:S[1];$<0&&($+=F.length),$=Math.max(0,Math.min($-1,F.length)),M<0&&(M+=F.length),M=Math.max(0,Math.min(M,F.length)),v=F.slice($,M).join(`
`),k.hasAttribute("data-start")||k.setAttribute("data-start",String($+1))}A.textContent=v,t.highlightElement(A)},function(v){k.setAttribute(a,h),A.textContent=v})}}),t.plugins.fileHighlight={highlight:function(k){for(var A=(k||document).querySelectorAll(g),u=0,p;p=A[u++];)t.highlightElement(p)}};var E=!1;t.fileHighlight=function(){E||(console.warn("Prism.fileHighlight is deprecated. Use `Prism.plugins.fileHighlight.highlight` instead."),E=!0),t.plugins.fileHighlight.highlight.apply(this,arguments)}}()})(yi);Prism.languages.javascript=Prism.languages.extend("clike",{"class-name":[Prism.languages.clike["class-name"],{pattern:/(^|[^$\w\xA0-\uFFFF])(?!\s)[_$A-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\.(?:constructor|prototype))/,lookbehind:!0}],keyword:[{pattern:/((?:^|\})\s*)catch\b/,lookbehind:!0},{pattern:/(^|[^.]|\.\.\.\s*)\b(?:as|assert(?=\s*\{)|async(?=\s*(?:function\b|\(|[$\w\xA0-\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally(?=\s*(?:\{|$))|for|from(?=\s*(?:['"]|$))|function|(?:get|set)(?=\s*(?:[#\[$\w\xA0-\uFFFF]|$))|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\b/,lookbehind:!0}],function:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*(?:\.\s*(?:apply|bind|call)\s*)?\()/,number:{pattern:RegExp(/(^|[^\w$])/.source+"(?:"+(/NaN|Infinity/.source+"|"+/0[bB][01]+(?:_[01]+)*n?/.source+"|"+/0[oO][0-7]+(?:_[0-7]+)*n?/.source+"|"+/0[xX][\dA-Fa-f]+(?:_[\dA-Fa-f]+)*n?/.source+"|"+/\d+(?:_\d+)*n/.source+"|"+/(?:\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[Ee][+-]?\d+(?:_\d+)*)?/.source)+")"+/(?![\w$])/.source),lookbehind:!0},operator:/--|\+\+|\*\*=?|=>|&&=?|\|\|=?|[!=]==|<<=?|>>>?=?|[-+*/%&|^!=<>]=?|\.{3}|\?\?=?|\?\.?|[~:]/});Prism.languages.javascript["class-name"][0].pattern=/(\b(?:class|extends|implements|instanceof|interface|new)\s+)[\w.\\]+/;Prism.languages.insertBefore("javascript","keyword",{regex:{pattern:RegExp(/((?:^|[^$\w\xA0-\uFFFF."'\])\s]|\b(?:return|yield))\s*)/.source+/\//.source+"(?:"+/(?:\[(?:[^\]\\\r\n]|\\.)*\]|\\.|[^/\\\[\r\n])+\/[dgimyus]{0,7}/.source+"|"+/(?:\[(?:[^[\]\\\r\n]|\\.|\[(?:[^[\]\\\r\n]|\\.|\[(?:[^[\]\\\r\n]|\\.)*\])*\])*\]|\\.|[^/\\\[\r\n])+\/[dgimyus]{0,7}v[dgimyus]{0,7}/.source+")"+/(?=(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?:$|[\r\n,.;:})\]]|\/\/))/.source),lookbehind:!0,greedy:!0,inside:{"regex-source":{pattern:/^(\/)[\s\S]+(?=\/[a-z]*$)/,lookbehind:!0,alias:"language-regex",inside:Prism.languages.regex},"regex-delimiter":/^\/|\/$/,"regex-flags":/^[a-z]+$/}},"function-variable":{pattern:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*[=:]\s*(?:async\s*)?(?:\bfunction\b|(?:\((?:[^()]|\([^()]*\))*\)|(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)\s*=>))/,alias:"function"},parameter:[{pattern:/(function(?:\s+(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)?\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\))/,lookbehind:!0,inside:Prism.languages.javascript},{pattern:/(^|[^$\w\xA0-\uFFFF])(?!\s)[_$a-z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*=>)/i,lookbehind:!0,inside:Prism.languages.javascript},{pattern:/(\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*=>)/,lookbehind:!0,inside:Prism.languages.javascript},{pattern:/((?:\b|\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\w\xA0-\uFFFF]))(?:(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*\s*)\(\s*|\]\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*\{)/,lookbehind:!0,inside:Prism.languages.javascript}],constant:/\b[A-Z](?:[A-Z_]|\dx?)*\b/});Prism.languages.insertBefore("javascript","string",{hashbang:{pattern:/^#!.*/,greedy:!0,alias:"comment"},"template-string":{pattern:/`(?:\\[\s\S]|\$\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})+\}|(?!\$\{)[^\\`])*`/,greedy:!0,inside:{"template-punctuation":{pattern:/^`|`$/,alias:"string"},interpolation:{pattern:/((?:^|[^\\])(?:\\{2})*)\$\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})+\}/,lookbehind:!0,inside:{"interpolation-punctuation":{pattern:/^\$\{|\}$/,alias:"punctuation"},rest:Prism.languages.javascript}},string:/[\s\S]+/}},"string-property":{pattern:/((?:^|[,{])[ \t]*)(["'])(?:\\(?:\r\n|[\s\S])|(?!\2)[^\\\r\n])*\2(?=\s*:)/m,lookbehind:!0,greedy:!0,alias:"property"}});Prism.languages.insertBefore("javascript","operator",{"literal-property":{pattern:/((?:^|[,{])[ \t]*)(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*:)/m,lookbehind:!0,alias:"property"}});Prism.languages.markup&&(Prism.languages.markup.tag.addInlined("script","javascript"),Prism.languages.markup.tag.addAttribute(/on(?:abort|blur|change|click|composition(?:end|start|update)|dblclick|error|focus(?:in|out)?|key(?:down|up)|load|mouse(?:down|enter|leave|move|out|over|up)|reset|resize|scroll|select|slotchange|submit|unload|wheel)/.source,"javascript"));Prism.languages.js=Prism.languages.javascript;Prism.languages.python={comment:{pattern:/(^|[^\\])#.*/,lookbehind:!0,greedy:!0},"string-interpolation":{pattern:/(?:f|fr|rf)(?:("""|''')[\s\S]*?\1|("|')(?:\\.|(?!\2)[^\\\r\n])*\2)/i,greedy:!0,inside:{interpolation:{pattern:/((?:^|[^{])(?:\{\{)*)\{(?!\{)(?:[^{}]|\{(?!\{)(?:[^{}]|\{(?!\{)(?:[^{}])+\})+\})+\}/,lookbehind:!0,inside:{"format-spec":{pattern:/(:)[^:(){}]+(?=\}$)/,lookbehind:!0},"conversion-option":{pattern:/![sra](?=[:}]$)/,alias:"punctuation"},rest:null}},string:/[\s\S]+/}},"triple-quoted-string":{pattern:/(?:[rub]|br|rb)?("""|''')[\s\S]*?\1/i,greedy:!0,alias:"string"},string:{pattern:/(?:[rub]|br|rb)?("|')(?:\\.|(?!\1)[^\\\r\n])*\1/i,greedy:!0},function:{pattern:/((?:^|\s)def[ \t]+)[a-zA-Z_]\w*(?=\s*\()/g,lookbehind:!0},"class-name":{pattern:/(\bclass\s+)\w+/i,lookbehind:!0},decorator:{pattern:/(^[\t ]*)@\w+(?:\.\w+)*/m,lookbehind:!0,alias:["annotation","punctuation"],inside:{punctuation:/\./}},keyword:/\b(?:_(?=\s*:)|and|as|assert|async|await|break|case|class|continue|def|del|elif|else|except|exec|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|print|raise|return|try|while|with|yield)\b/,builtin:/\b(?:__import__|abs|all|any|apply|ascii|basestring|bin|bool|buffer|bytearray|bytes|callable|chr|classmethod|cmp|coerce|compile|complex|delattr|dict|dir|divmod|enumerate|eval|execfile|file|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|intern|isinstance|issubclass|iter|len|list|locals|long|map|max|memoryview|min|next|object|oct|open|ord|pow|property|range|raw_input|reduce|reload|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|type|unichr|unicode|vars|xrange|zip)\b/,boolean:/\b(?:False|None|True)\b/,number:/\b0(?:b(?:_?[01])+|o(?:_?[0-7])+|x(?:_?[a-f0-9])+)\b|(?:\b\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\B\.\d+(?:_\d+)*)(?:e[+-]?\d+(?:_\d+)*)?j?(?!\w)/i,operator:/[-+%=]=?|!=|:=|\*\*?=?|\/\/?=?|<[<=>]?|>[=>]?|[&|^~]/,punctuation:/[{}[\];(),.:]/};Prism.languages.python["string-interpolation"].inside.interpolation.inside.rest=Prism.languages.python;Prism.languages.py=Prism.languages.python;Prism.languages.json={property:{pattern:/(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?=\s*:)/,lookbehind:!0,greedy:!0},string:{pattern:/(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?!\s*:)/,lookbehind:!0,greedy:!0},comment:{pattern:/\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/,greedy:!0},number:/-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i,punctuation:/[{}[\],]/,operator:/:/,boolean:/\b(?:false|true)\b/,null:{pattern:/\bnull\b/,alias:"keyword"}};Prism.languages.webmanifest=Prism.languages.json;(function(i){var e="\\b(?:BASH|BASHOPTS|BASH_ALIASES|BASH_ARGC|BASH_ARGV|BASH_CMDS|BASH_COMPLETION_COMPAT_DIR|BASH_LINENO|BASH_REMATCH|BASH_SOURCE|BASH_VERSINFO|BASH_VERSION|COLORTERM|COLUMNS|COMP_WORDBREAKS|DBUS_SESSION_BUS_ADDRESS|DEFAULTS_PATH|DESKTOP_SESSION|DIRSTACK|DISPLAY|EUID|GDMSESSION|GDM_LANG|GNOME_KEYRING_CONTROL|GNOME_KEYRING_PID|GPG_AGENT_INFO|GROUPS|HISTCONTROL|HISTFILE|HISTFILESIZE|HISTSIZE|HOME|HOSTNAME|HOSTTYPE|IFS|INSTANCE|JOB|LANG|LANGUAGE|LC_ADDRESS|LC_ALL|LC_IDENTIFICATION|LC_MEASUREMENT|LC_MONETARY|LC_NAME|LC_NUMERIC|LC_PAPER|LC_TELEPHONE|LC_TIME|LESSCLOSE|LESSOPEN|LINES|LOGNAME|LS_COLORS|MACHTYPE|MAILCHECK|MANDATORY_PATH|NO_AT_BRIDGE|OLDPWD|OPTERR|OPTIND|ORBIT_SOCKETDIR|OSTYPE|PAPERSIZE|PATH|PIPESTATUS|PPID|PS1|PS2|PS3|PS4|PWD|RANDOM|REPLY|SECONDS|SELINUX_INIT|SESSION|SESSIONTYPE|SESSION_MANAGER|SHELL|SHELLOPTS|SHLVL|SSH_AUTH_SOCK|TERM|UID|UPSTART_EVENTS|UPSTART_INSTANCE|UPSTART_JOB|UPSTART_SESSION|USER|WINDOWID|XAUTHORITY|XDG_CONFIG_DIRS|XDG_CURRENT_DESKTOP|XDG_DATA_DIRS|XDG_GREETER_DATA_DIR|XDG_MENU_PREFIX|XDG_RUNTIME_DIR|XDG_SEAT|XDG_SEAT_PATH|XDG_SESSION_DESKTOP|XDG_SESSION_ID|XDG_SESSION_PATH|XDG_SESSION_TYPE|XDG_VTNR|XMODIFIERS)\\b",t={pattern:/(^(["']?)\w+\2)[ \t]+\S.*/,lookbehind:!0,alias:"punctuation",inside:null},s={bash:t,environment:{pattern:RegExp("\\$"+e),alias:"constant"},variable:[{pattern:/\$?\(\([\s\S]+?\)\)/,greedy:!0,inside:{variable:[{pattern:/(^\$\(\([\s\S]+)\)\)/,lookbehind:!0},/^\$\(\(/],number:/\b0x[\dA-Fa-f]+\b|(?:\b\d+(?:\.\d*)?|\B\.\d+)(?:[Ee]-?\d+)?/,operator:/--|\+\+|\*\*=?|<<=?|>>=?|&&|\|\||[=!+\-*/%<>^&|]=?|[?~:]/,punctuation:/\(\(?|\)\)?|,|;/}},{pattern:/\$\((?:\([^)]+\)|[^()])+\)|`[^`]+`/,greedy:!0,inside:{variable:/^\$\(|^`|\)$|`$/}},{pattern:/\$\{[^}]+\}/,greedy:!0,inside:{operator:/:[-=?+]?|[!\/]|##?|%%?|\^\^?|,,?/,punctuation:/[\[\]]/,environment:{pattern:RegExp("(\\{)"+e),lookbehind:!0,alias:"constant"}}},/\$(?:\w+|[#?*!@$])/],entity:/\\(?:[abceEfnrtv\\"]|O?[0-7]{1,3}|U[0-9a-fA-F]{8}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{1,2})/};i.languages.bash={shebang:{pattern:/^#!\s*\/.*/,alias:"important"},comment:{pattern:/(^|[^"{\\$])#.*/,lookbehind:!0},"function-name":[{pattern:/(\bfunction\s+)[\w-]+(?=(?:\s*\(?:\s*\))?\s*\{)/,lookbehind:!0,alias:"function"},{pattern:/\b[\w-]+(?=\s*\(\s*\)\s*\{)/,alias:"function"}],"for-or-select":{pattern:/(\b(?:for|select)\s+)\w+(?=\s+in\s)/,alias:"variable",lookbehind:!0},"assign-left":{pattern:/(^|[\s;|&]|[<>]\()\w+(?:\.\w+)*(?=\+?=)/,inside:{environment:{pattern:RegExp("(^|[\\s;|&]|[<>]\\()"+e),lookbehind:!0,alias:"constant"}},alias:"variable",lookbehind:!0},parameter:{pattern:/(^|\s)-{1,2}(?:\w+:[+-]?)?\w+(?:\.\w+)*(?=[=\s]|$)/,alias:"variable",lookbehind:!0},string:[{pattern:/((?:^|[^<])<<-?\s*)(\w+)\s[\s\S]*?(?:\r?\n|\r)\2/,lookbehind:!0,greedy:!0,inside:s},{pattern:/((?:^|[^<])<<-?\s*)(["'])(\w+)\2\s[\s\S]*?(?:\r?\n|\r)\3/,lookbehind:!0,greedy:!0,inside:{bash:t}},{pattern:/(^|[^\\](?:\\\\)*)"(?:\\[\s\S]|\$\([^)]+\)|\$(?!\()|`[^`]+`|[^"\\`$])*"/,lookbehind:!0,greedy:!0,inside:s},{pattern:/(^|[^$\\])'[^']*'/,lookbehind:!0,greedy:!0},{pattern:/\$'(?:[^'\\]|\\[\s\S])*'/,greedy:!0,inside:{entity:s.entity}}],environment:{pattern:RegExp("\\$?"+e),alias:"constant"},variable:s.variable,function:{pattern:/(^|[\s;|&]|[<>]\()(?:add|apropos|apt|apt-cache|apt-get|aptitude|aspell|automysqlbackup|awk|basename|bash|bc|bconsole|bg|bzip2|cal|cargo|cat|cfdisk|chgrp|chkconfig|chmod|chown|chroot|cksum|clear|cmp|column|comm|composer|cp|cron|crontab|csplit|curl|cut|date|dc|dd|ddrescue|debootstrap|df|diff|diff3|dig|dir|dircolors|dirname|dirs|dmesg|docker|docker-compose|du|egrep|eject|env|ethtool|expand|expect|expr|fdformat|fdisk|fg|fgrep|file|find|fmt|fold|format|free|fsck|ftp|fuser|gawk|git|gparted|grep|groupadd|groupdel|groupmod|groups|grub-mkconfig|gzip|halt|head|hg|history|host|hostname|htop|iconv|id|ifconfig|ifdown|ifup|import|install|ip|java|jobs|join|kill|killall|less|link|ln|locate|logname|logrotate|look|lpc|lpr|lprint|lprintd|lprintq|lprm|ls|lsof|lynx|make|man|mc|mdadm|mkconfig|mkdir|mke2fs|mkfifo|mkfs|mkisofs|mknod|mkswap|mmv|more|most|mount|mtools|mtr|mutt|mv|nano|nc|netstat|nice|nl|node|nohup|notify-send|npm|nslookup|op|open|parted|passwd|paste|pathchk|ping|pkill|pnpm|podman|podman-compose|popd|pr|printcap|printenv|ps|pushd|pv|quota|quotacheck|quotactl|ram|rar|rcp|reboot|remsync|rename|renice|rev|rm|rmdir|rpm|rsync|scp|screen|sdiff|sed|sendmail|seq|service|sftp|sh|shellcheck|shuf|shutdown|sleep|slocate|sort|split|ssh|stat|strace|su|sudo|sum|suspend|swapon|sync|sysctl|tac|tail|tar|tee|time|timeout|top|touch|tr|traceroute|tsort|tty|umount|uname|unexpand|uniq|units|unrar|unshar|unzip|update-grub|uptime|useradd|userdel|usermod|users|uudecode|uuencode|v|vcpkg|vdir|vi|vim|virsh|vmstat|wait|watch|wc|wget|whereis|which|who|whoami|write|xargs|xdg-open|yarn|yes|zenity|zip|zsh|zypper)(?=$|[)\s;|&])/,lookbehind:!0},keyword:{pattern:/(^|[\s;|&]|[<>]\()(?:case|do|done|elif|else|esac|fi|for|function|if|in|select|then|until|while)(?=$|[)\s;|&])/,lookbehind:!0},builtin:{pattern:/(^|[\s;|&]|[<>]\()(?:\.|:|alias|bind|break|builtin|caller|cd|command|continue|declare|echo|enable|eval|exec|exit|export|getopts|hash|help|let|local|logout|mapfile|printf|pwd|read|readarray|readonly|return|set|shift|shopt|source|test|times|trap|type|typeset|ulimit|umask|unalias|unset)(?=$|[)\s;|&])/,lookbehind:!0,alias:"class-name"},boolean:{pattern:/(^|[\s;|&]|[<>]\()(?:false|true)(?=$|[)\s;|&])/,lookbehind:!0},"file-descriptor":{pattern:/\B&\d\b/,alias:"important"},operator:{pattern:/\d?<>|>\||\+=|=[=~]?|!=?|<<[<-]?|[&\d]?>>|\d[<>]&?|[<>][&=]?|&[>&]?|\|[&|]?/,inside:{"file-descriptor":{pattern:/^\d/,alias:"important"}}},punctuation:/\$?\(\(?|\)\)?|\.\.|[{}[\];\\]/,number:{pattern:/(^|\s)(?:[1-9]\d*|0)(?:[.,]\d+)?\b/,lookbehind:!0}},t.inside=i.languages.bash;for(var n=["comment","function-name","for-or-select","assign-left","parameter","string","environment","function","keyword","builtin","boolean","file-descriptor","operator","punctuation","number"],r=s.variable[1].inside,o=0;o<n.length;o++)r[n[o]]=i.languages.bash[n[o]];i.languages.sh=i.languages.bash,i.languages.shell=i.languages.bash})(Prism);(function(i){i.languages.typescript=i.languages.extend("javascript",{"class-name":{pattern:/(\b(?:class|extends|implements|instanceof|interface|new|type)\s+)(?!keyof\b)(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?:\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?/,lookbehind:!0,greedy:!0,inside:null},builtin:/\b(?:Array|Function|Promise|any|boolean|console|never|number|string|symbol|unknown)\b/}),i.languages.typescript.keyword.push(/\b(?:abstract|declare|is|keyof|readonly|require)\b/,/\b(?:asserts|infer|interface|module|namespace|type)\b(?=\s*(?:[{_$a-zA-Z\xA0-\uFFFF]|$))/,/\btype\b(?=\s*(?:[\{*]|$))/),delete i.languages.typescript.parameter,delete i.languages.typescript["literal-property"];var e=i.languages.extend("typescript",{});delete e["class-name"],i.languages.typescript["class-name"].inside=e,i.languages.insertBefore("typescript","function",{decorator:{pattern:/@[$\w\xA0-\uFFFF]+/,inside:{at:{pattern:/^@/,alias:"operator"},function:/^[\s\S]+/}},"generic-function":{pattern:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>(?=\s*\()/,greedy:!0,inside:{function:/^#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*/,generic:{pattern:/<[\s\S]+/,alias:"class-name",inside:e}}}}),i.languages.ts=i.languages.typescript})(Prism);(function(i){var e=/(?:"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n])*')/;i.languages.css={comment:/\/\*[\s\S]*?\*\//,atrule:{pattern:RegExp("@[\\w-](?:"+/[^;{\s"']|\s+(?!\s)/.source+"|"+e.source+")*?"+/(?:;|(?=\s*\{))/.source),inside:{rule:/^@[\w-]+/,"selector-function-argument":{pattern:/(\bselector\s*\(\s*(?![\s)]))(?:[^()\s]|\s+(?![\s)])|\((?:[^()]|\([^()]*\))*\))+(?=\s*\))/,lookbehind:!0,alias:"selector"},keyword:{pattern:/(^|[^\w-])(?:and|not|only|or)(?![\w-])/,lookbehind:!0}}},url:{pattern:RegExp("\\burl\\((?:"+e.source+"|"+/(?:[^\\\r\n()"']|\\[\s\S])*/.source+")\\)","i"),greedy:!0,inside:{function:/^url/i,punctuation:/^\(|\)$/,string:{pattern:RegExp("^"+e.source+"$"),alias:"url"}}},selector:{pattern:RegExp(`(^|[{}\\s])[^{}\\s](?:[^{};"'\\s]|\\s+(?![\\s{])|`+e.source+")*(?=\\s*\\{)"),lookbehind:!0},string:{pattern:e,greedy:!0},property:{pattern:/(^|[^-\w\xA0-\uFFFF])(?!\s)[-_a-z\xA0-\uFFFF](?:(?!\s)[-\w\xA0-\uFFFF])*(?=\s*:)/i,lookbehind:!0},important:/!important\b/i,function:{pattern:/(^|[^-a-z0-9])[-a-z0-9]+(?=\()/i,lookbehind:!0},punctuation:/[(){};:,]/},i.languages.css.atrule.inside.rest=i.languages.css;var t=i.languages.markup;t&&(t.tag.addInlined("style","css"),t.tag.addAttribute("style","css"))})(Prism);Prism.languages.markup={comment:{pattern:/<!--(?:(?!<!--)[\s\S])*?-->/,greedy:!0},prolog:{pattern:/<\?[\s\S]+?\?>/,greedy:!0},doctype:{pattern:/<!DOCTYPE(?:[^>"'[\]]|"[^"]*"|'[^']*')+(?:\[(?:[^<"'\]]|"[^"]*"|'[^']*'|<(?!!--)|<!--(?:[^-]|-(?!->))*-->)*\]\s*)?>/i,greedy:!0,inside:{"internal-subset":{pattern:/(^[^\[]*\[)[\s\S]+(?=\]>$)/,lookbehind:!0,greedy:!0,inside:null},string:{pattern:/"[^"]*"|'[^']*'/,greedy:!0},punctuation:/^<!|>$|[[\]]/,"doctype-tag":/^DOCTYPE/i,name:/[^\s<>'"]+/}},cdata:{pattern:/<!\[CDATA\[[\s\S]*?\]\]>/i,greedy:!0},tag:{pattern:/<\/?(?!\d)[^\s>\/=$<%]+(?:\s(?:\s*[^\s>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))|(?=[\s/>])))+)?\s*\/?>/,greedy:!0,inside:{tag:{pattern:/^<\/?[^\s>\/]+/,inside:{punctuation:/^<\/?/,namespace:/^[^\s>\/:]+:/}},"special-attr":[],"attr-value":{pattern:/=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+)/,inside:{punctuation:[{pattern:/^=/,alias:"attr-equals"},{pattern:/^(\s*)["']|["']$/,lookbehind:!0}]}},punctuation:/\/?>/,"attr-name":{pattern:/[^\s>\/]+/,inside:{namespace:/^[^\s>\/:]+:/}}}},entity:[{pattern:/&[\da-z]{1,8};/i,alias:"named-entity"},/&#x?[\da-f]{1,8};/i]};Prism.languages.markup.tag.inside["attr-value"].inside.entity=Prism.languages.markup.entity;Prism.languages.markup.doctype.inside["internal-subset"].inside=Prism.languages.markup;Prism.hooks.add("wrap",function(i){i.type==="entity"&&(i.attributes.title=i.content.replace(/&amp;/,"&"))});Object.defineProperty(Prism.languages.markup.tag,"addInlined",{value:function(e,t){var s={};s["language-"+t]={pattern:/(^<!\[CDATA\[)[\s\S]+?(?=\]\]>$)/i,lookbehind:!0,inside:Prism.languages[t]},s.cdata=/^<!\[CDATA\[|\]\]>$/i;var n={"included-cdata":{pattern:/<!\[CDATA\[[\s\S]*?\]\]>/i,inside:s}};n["language-"+t]={pattern:/[\s\S]+/,inside:Prism.languages[t]};var r={};r[e]={pattern:RegExp(/(<__[^>]*>)(?:<!\[CDATA\[(?:[^\]]|\](?!\]>))*\]\]>|(?!<!\[CDATA\[)[\s\S])*?(?=<\/__>)/.source.replace(/__/g,function(){return e}),"i"),lookbehind:!0,greedy:!0,inside:n},Prism.languages.insertBefore("markup","cdata",r)}});Object.defineProperty(Prism.languages.markup.tag,"addAttribute",{value:function(i,e){Prism.languages.markup.tag.inside["special-attr"].push({pattern:RegExp(/(^|["'\s])/.source+"(?:"+i+")"+/\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))/.source,"i"),lookbehind:!0,inside:{"attr-name":/^[^\s=]+/,"attr-value":{pattern:/=[\s\S]+/,inside:{value:{pattern:/(^=\s*(["']|(?!["'])))\S[\s\S]*(?=\2$)/,lookbehind:!0,alias:[e,"language-"+e],inside:Prism.languages[e]},punctuation:[{pattern:/^=/,alias:"attr-equals"},/"|'/]}}}})}});Prism.languages.html=Prism.languages.markup;Prism.languages.mathml=Prism.languages.markup;Prism.languages.svg=Prism.languages.markup;Prism.languages.xml=Prism.languages.extend("markup",{});Prism.languages.ssml=Prism.languages.xml;Prism.languages.atom=Prism.languages.xml;Prism.languages.rss=Prism.languages.xml;function wi(i,e){const t=i.length,s=e.length,n=Array(t+1).fill(null).map(()=>Array(s+1).fill(0));for(let c=1;c<=t;c++)for(let h=1;h<=s;h++)i[c-1]===e[h-1]?n[c][h]=n[c-1][h-1]+1:n[c][h]=Math.max(n[c-1][h],n[c][h-1]);const r=[];let o=t,a=s;for(;o>0||a>0;)o>0&&a>0&&i[o-1]===e[a-1]?(r.push({type:"context",line:i[o-1]}),o--,a--):a>0&&(o===0||n[o][a-1]>=n[o-1][a])?(r.push({type:"add",line:e[a-1]}),a--):(r.push({type:"remove",line:i[o-1]}),o--);const l=r.reverse();return _i(l)}function _i(i){const e=[];let t=0;for(;t<i.length;){const s=i[t],n=i[t+1];if(s.type==="remove"&&n?.type==="add"){const r=ki(s.line,n.line);if(r.similarity>.7){e.push({...s,pair:{charDiff:r.oldSegments}}),e.push({...n,pair:{charDiff:r.newSegments}}),t+=2;continue}}e.push(s),t++}return e}function ki(i,e){const t=Rt(i),s=Rt(e),n=t.length,r=s.length;if(n===0&&r===0)return{oldSegments:[],newSegments:[],similarity:1};if(n===0)return{oldSegments:[],newSegments:[{type:"add",text:e}],similarity:0};if(r===0)return{oldSegments:[{type:"remove",text:i}],newSegments:[],similarity:0};const o=Array(n+1).fill(null).map(()=>Array(r+1).fill(0));for(let w=1;w<=n;w++)for(let k=1;k<=r;k++)t[w-1]===s[k-1]?o[w][k]=o[w-1][k-1]+1:o[w][k]=Math.max(o[w-1][k],o[w][k-1]);const a=[],l=[];let c=n,h=r;for(;c>0||h>0;)c>0&&h>0&&t[c-1]===s[h-1]?(a.push({type:"same",text:t[c-1]}),l.push({type:"same",text:s[h-1]}),c--,h--):h>0&&(c===0||o[c][h-1]>=o[c-1][h])?(l.push({type:"add",text:s[h-1]}),h--):(a.push({type:"remove",text:t[c-1]}),c--);const g=At(a.reverse()),f=At(l.reverse()),E=2*o[n][r]/(n+r);return{oldSegments:g,newSegments:f,similarity:E}}function Rt(i){const e=[];let t="",s=null;for(const n of i){let r;/\s/.test(n)?r="space":/\w/.test(n)?r="word":r="punct",s===null?(s=r,t=n):r===s?t+=n:(e.push(t),t=n,s=r)}return t&&e.push(t),e}function At(i){if(i.length===0)return[];const e=[];let t={type:i[0].type,text:i[0].text};for(let s=1;s<i.length;s++)i[s].type===t.type?t.text+=i[s].text:(e.push(t),t={type:i[s].type,text:i[s].text});return e.push(t),e}class $i extends z{static properties={content:{type:String},role:{type:String},mentionedFiles:{type:Array},selectedFiles:{type:Array},editResults:{type:Array}};static styles=U`
    :host {
      display: block;
    }

    .content {
      line-height: 1.5;
      word-break: break-word;
    }

    pre {
      background: #0d0d0d;
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      position: relative;
    }

    code {
      font-family: 'Fira Code', monospace;
      font-size: 13px;
    }

    p code {
      background: #0f3460;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .file-mention {
      color: #7ec699;
      cursor: pointer;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 2px;
    }

    .file-mention:hover {
      color: #a3e4b8;
      text-decoration-style: solid;
    }

    .file-mention.in-context {
      color: #6e7681;
      text-decoration: none;
      cursor: default;
    }

    .file-mention.in-context::before {
      content: '✓ ';
      font-size: 10px;
    }

    /* Files summary section */
    .files-summary {
      margin-top: 12px;
      padding: 10px 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-size: 13px;
    }

    .files-summary-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #8b949e;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 8px;
      font-weight: 600;
    }

    .select-all-btn {
      background: #238636;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-transform: none;
    }

    .select-all-btn:hover {
      background: #2ea043;
    }

    .files-summary-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .file-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .file-chip.not-in-context {
      background: #1f3d1f;
      color: #7ee787;
      border: 1px solid #238636;
    }

    .file-chip.not-in-context:hover {
      background: #238636;
    }

    .file-chip.in-context {
      background: #21262d;
      color: #8b949e;
      border: 1px solid #30363d;
      cursor: pointer;
    }

    .file-chip.in-context:hover {
      background: #30363d;
    }

    .file-chip .chip-icon {
      font-size: 10px;
    }

    /* Edits summary section */
    .edits-summary {
      margin-top: 12px;
      padding: 10px 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-size: 13px;
    }

    .edits-summary-header {
      color: #8b949e;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 8px;
      font-weight: 600;
    }

    .edits-summary-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .edit-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .edit-tag.applied {
      background: #1f3d1f;
      color: #7ee787;
      border: 1px solid #238636;
    }

    .edit-tag.applied:hover {
      background: #238636;
    }

    .edit-tag.failed {
      background: #3d1f1f;
      color: #ffa198;
      border: 1px solid #da3633;
    }

    .edit-tag.failed:hover {
      background: #da3633;
    }

    .edit-tag-icon {
      font-size: 10px;
    }

    /* Edit block styles */
    .edit-block {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      margin: 12px 0;
      overflow: hidden;
      font-family: 'Fira Code', monospace;
      font-size: 13px;
    }

    .edit-block-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
    }

    .edit-block-file {
      color: #58a6ff;
      font-weight: 600;
      cursor: pointer;
    }

    .edit-block-file:hover {
      text-decoration: underline;
    }

    .edit-block-status {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }

    .edit-block-status.applied {
      background: #238636;
      color: #fff;
    }

    .edit-block-status.failed {
      background: #da3633;
      color: #fff;
    }

    .edit-block-status.pending {
      background: #6e7681;
      color: #fff;
    }

    .edit-block-content {
      padding: 0;
    }

    .diff-line {
      display: block;
      padding: 0 12px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      line-height: 1.4;
    }

    .diff-line.context {
      background: #0d1117;
      color: #8b949e;
    }

    .diff-line.remove {
      background: #3d1f1f;
      color: #ffa198;
    }

    .diff-line.add {
      background: #1f3d1f;
      color: #7ee787;
    }

    .diff-line-prefix {
      user-select: none;
      display: inline-block;
      width: 1.5ch;
      color: inherit;
      opacity: 0.6;
    }

    /* Inline word-level highlighting */
    .diff-line.remove .diff-change {
      background: #8b3d3d;
      border-radius: 2px;
      padding: 0 2px;
    }

    .diff-line.add .diff-change {
      background: #2d6b2d;
      border-radius: 2px;
      padding: 0 2px;
    }

    .edit-block-error {
      padding: 8px 12px;
      background: #3d1f1f;
      color: #ffa198;
      font-size: 12px;
      border-top: 1px solid #da3633;
    }

    .edit-block-line-info {
      font-size: 11px;
      color: #6e7681;
      margin-left: 8px;
    }

    .code-wrapper {
      position: relative;
    }

    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: #e94560;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 11px;
    }

    .copy-btn:hover {
      background: #ff6b6b;
    }

    /* Prism Tomorrow Night theme */
    .token.comment,
    .token.prolog,
    .token.doctype,
    .token.cdata { color: #999; }
    .token.punctuation { color: #ccc; }
    .token.property,
    .token.tag,
    .token.boolean,
    .token.number,
    .token.constant,
    .token.symbol { color: #f08d49; }
    .token.selector,
    .token.attr-name,
    .token.string,
    .token.char,
    .token.builtin { color: #7ec699; }
    .token.operator,
    .token.entity,
    .token.url,
    .token.variable { color: #67cdcc; }
    .token.atrule,
    .token.attr-value,
    .token.keyword { color: #cc99cd; }
    .token.function { color: #f08d49; }
    .token.regex,
    .token.important { color: #e90; }
  `;constructor(){super(),this.content="",this.role="assistant",this.mentionedFiles=[],this.selectedFiles=[],this.editResults=[],this._foundFiles=[],this._codeScrollPositions=new Map,T.setOptions({highlight:(e,t)=>t&&Prism.languages[t]?Prism.highlight(e,Prism.languages[t],t):e,breaks:!0,gfm:!0})}processContent(){if(!this.content)return"";if(this.role==="user")return this.escapeHtml(this.content).replace(/\n/g,"<br>");if(this.content.includes("««« EDIT")){let n=this.processContentWithEditBlocks(this.content);return n=this.wrapCodeBlocksWithCopyButton(n),n=this.highlightFileMentions(n),n}let t=this.protectSearchReplaceBlocks(this.content),s=T.parse(t);return s=this.wrapCodeBlocksWithCopyButton(s),s=this.highlightFileMentions(s),s}protectSearchReplaceBlocks(e){return e}parseEditBlocks(e){const t=[],s=e.split(`
`);let n="IDLE",r=null,o=null,a=[],l=[],c=0;for(let h=0;h<s.length;h++){const g=s[h],f=g.trim();n==="IDLE"?f&&!f.startsWith("```")&&!f.startsWith("#")&&(o=f,n="EXPECT_START"):n==="EXPECT_START"?f==="««« EDIT"?(c=h-1,r={filePath:o,startIndex:c},a=[],n="EDIT_SECTION"):f?o=f:(n="IDLE",o=null):n==="EDIT_SECTION"?f==="═══════ REPL"?(r.editLines=a.join(`
`),l=[],n="REPL_SECTION"):a.push(g):n==="REPL_SECTION"&&(f==="»»» EDIT END"?(r.replLines=l.join(`
`),r.endIndex=h,t.push(r),n="IDLE",r=null,o=null):l.push(g))}return t}getEditResultForFile(e){if(!this.editResults||this.editResults.length===0)return null;const t=n=>n?.replace(/^\.\//,"").replace(/\\/g,"/").trim(),s=t(e);return this.editResults.find(n=>t(n.file_path)===s)}renderEditBlock(e){const t=this.getEditResultForFile(e.filePath),s=t?t.status:"pending",n=s==="applied"?"✓ Applied":s==="failed"?"✗ Failed":"○ Pending";let r="";if(t&&t.status==="failed"&&t.reason){const g=t.estimated_line?` (near line ${t.estimated_line})`:"";r=`<div class="edit-block-error">Error: ${this.escapeHtml(t.reason)}${g}</div>`}const o=t&&t.estimated_line?`<span class="edit-block-line-info">line ${t.estimated_line}</span>`:"",a=this.formatUnifiedDiff(e.editLines,e.replLines),c=(e.editLines?e.editLines.split(`
`):[]).find(g=>g.trim().length>0)||"",h=this.escapeHtml(c).replace(/"/g,"&quot;");return`
      <div class="edit-block" data-file="${this.escapeHtml(e.filePath)}">
        <div class="edit-block-header">
          <span class="edit-block-file" data-file="${this.escapeHtml(e.filePath)}" data-context="${h}">${this.escapeHtml(e.filePath)}</span>
          <div>
            ${o}
            <span class="edit-block-status ${s}">${n}</span>
          </div>
        </div>
        <div class="edit-block-content">
          ${a}
        </div>
        ${r}
      </div>
    `}formatUnifiedDiff(e,t){const s=e?e.split(`
`):[],n=t?t.split(`
`):[];return s.length===0&&n.length===0?"":wi(s,n).map(a=>{const l=a.type==="add"?"+":a.type==="remove"?"-":" ";if(a.pair?.charDiff){const h=this.renderInlineHighlight(a.pair.charDiff,a.type);return`<span class="diff-line ${a.type}"><span class="diff-line-prefix">${l}</span>${h}</span>`}const c=this.escapeHtml(a.line);return`<span class="diff-line ${a.type}"><span class="diff-line-prefix">${l}</span>${c}</span>`}).join(`
`)}renderInlineHighlight(e,t){return e.map(s=>{const n=this.escapeHtml(s.text);return s.type==="same"?n:t==="remove"&&s.type==="remove"||t==="add"&&s.type==="add"?`<span class="diff-change">${n}</span>`:n}).join("")}processContentWithEditBlocks(e){const t=this.parseEditBlocks(e);if(t.length===0)return T.parse(e);const s=e.split(`
`),n=[];let r=0;for(const a of t){if(a.startIndex>r){const l=s.slice(r,a.startIndex);n.push({type:"text",content:l.join(`
`)})}n.push({type:"edit",block:a}),r=a.endIndex+1}if(r<s.length){const a=s.slice(r);n.push({type:"text",content:a.join(`
`)})}let o="";for(const a of n)a.type==="text"?o+=T.parse(a.content):o+=this.renderEditBlock(a.block);return o}escapeHtml(e){const t=document.createElement("div");return t.textContent=e,t.innerHTML}wrapCodeBlocksWithCopyButton(e){const t=/(<pre[^>]*>)(\s*<code[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/gi;return e.replace(t,(s,n,r,o,a)=>`<div class="code-wrapper">${n}${r}${o}${a}<button class="copy-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">Copy</button></div>`)}highlightFileMentions(e){if(!this.mentionedFiles||this.mentionedFiles.length===0)return e;let t=e;this._foundFiles=[];const s=[...this.mentionedFiles].sort((n,r)=>r.length-n.length);for(const n of s){const r=n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),o=new RegExp(`(?<!<[^>]*)(?<!class=")\\b(${r})\\b(?![^<]*>)`,"g");if(o.test(e)){this._foundFiles.push(n);const l=this.selectedFiles&&this.selectedFiles.includes(n)?" in-context":"";o.lastIndex=0,t=t.replace(o,`<span class="file-mention${l}" data-file="${n}">$1</span>`)}}return t}renderEditsSummary(){if(!this.editResults||this.editResults.length===0)return"";const e=this.editResults.map(r=>{const o=r.status==="applied",a=o?"applied":"failed",l=o?"✓":"✗",c=o?"Applied successfully":`Failed: ${r.reason||"Unknown error"}`;return`<span class="edit-tag ${a}" title="${this.escapeHtml(c)}" data-file="${this.escapeHtml(r.file_path)}"><span class="edit-tag-icon">${l}</span>${this.escapeHtml(r.file_path)}</span>`}).join(""),t=this.editResults.filter(r=>r.status==="applied").length,s=this.editResults.length-t;let n="";return t>0&&s>0?n=`${t} applied, ${s} failed`:t>0?n=`${t} edit${t>1?"s":""} applied`:n=`${s} edit${s>1?"s":""} failed`,`
      <div class="edits-summary">
        <div class="edits-summary-header">✏️ Edits: ${n}</div>
        <div class="edits-summary-list">${e}</div>
      </div>
    `}renderFilesSummary(){if(this._foundFiles.length===0)return"";const e=this._foundFiles.filter(r=>!this.selectedFiles||!this.selectedFiles.includes(r)),t=e.length>1,s=this._foundFiles.map(r=>{const o=this.selectedFiles&&this.selectedFiles.includes(r),a=o?"in-context":"not-in-context",l=o?"✓":"+";return`<span class="file-chip ${a}" data-file="${this.escapeHtml(r)}"><span class="chip-icon">${l}</span>${this.escapeHtml(r)}</span>`}).join("");return`
      <div class="files-summary">
        <div class="files-summary-header">📁 Files Referenced ${t?`<button class="select-all-btn" data-files='${JSON.stringify(e)}'>+ Add All (${e.length})</button>`:""}</div>
        <div class="files-summary-list">${s}</div>
      </div>
    `}handleClick(e){const t=e.target.closest(".file-mention");if(t){const l=t.dataset.file;l&&this.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:l},bubbles:!0,composed:!0}));return}const s=e.target.closest(".edit-block-file");if(s){const l=s.dataset.file,c=s.dataset.context;if(l){const h=this.getEditResultForFile(l);this.dispatchEvent(new CustomEvent("edit-block-click",{detail:{path:l,line:h?.estimated_line||1,status:h?.status||"pending",searchContext:c||null},bubbles:!0,composed:!0}))}return}const n=e.target.closest(".edit-tag");if(n){const l=n.dataset.file;if(l){const c=this.getEditResultForFile(l);this.dispatchEvent(new CustomEvent("edit-block-click",{detail:{path:l,line:c?.estimated_line||1,status:c?.status||"pending",searchContext:null},bubbles:!0,composed:!0}))}return}const r=e.target.closest(".file-chip");if(r){const l=r.dataset.file;l&&this.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:l},bubbles:!0,composed:!0}));return}const o=e.target.closest(".select-all-btn");if(o){try{const l=JSON.parse(o.dataset.files||"[]");for(const c of l)this.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:c},bubbles:!0,composed:!0}))}catch(l){console.error("Failed to parse files:",l)}return}const a=e.target.closest(".edit-block");if(a){const l=a.dataset.file;if(l){const c=this.getEditResultForFile(l);this.dispatchEvent(new CustomEvent("edit-block-click",{detail:{path:l,line:c?.estimated_line||1,status:c?.status||"pending",searchContext:null},bubbles:!0,composed:!0}))}return}}willUpdate(){this._codeScrollPositions.clear();const e=this.shadowRoot?.querySelectorAll("pre");e&&e.forEach((t,s)=>{t.scrollLeft>0&&this._codeScrollPositions.set(s,t.scrollLeft)})}updated(){if(this._codeScrollPositions.size>0){const e=this.shadowRoot?.querySelectorAll("pre");e&&this._codeScrollPositions.forEach((t,s)=>{e[s]&&(e[s].scrollLeft=t)})}}render(){const e=this.processContent();return d`
      <div class="content" @click=${this.handleClick}>
        ${Ve(e)}
        ${this.role==="assistant"?Ve(this.renderEditsSummary()):""}
        ${this.role==="assistant"?Ve(this.renderFilesSummary()):""}
      </div>
    `}}customElements.define("card-markdown",$i);class Si extends z{static properties={content:{type:String},mentionedFiles:{type:Array},selectedFiles:{type:Array},editResults:{type:Array}};static styles=U`
    :host {
      display: block;
    }

    .card {
      background: #1a1a2e;
      border-radius: 8px;
      padding: 12px;
      color: #eee;
      margin-right: 40px;
      border: 1px solid #0f3460;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .label {
      font-size: 11px;
      color: #e94560;
      font-weight: 600;
    }

    .actions {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .card:hover .actions {
      opacity: 1;
    }

    .action-btn {
      background: #0f3460;
      border: none;
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 11px;
      color: #888;
      transition: color 0.2s, background 0.2s;
    }

    .action-btn:hover {
      background: #1a3a6e;
      color: #e94560;
    }

    .footer-actions {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #0f3460;
    }
  `;copyToClipboard(){navigator.clipboard.writeText(this.content)}copyToPrompt(){this.dispatchEvent(new CustomEvent("copy-to-prompt",{detail:{content:this.content},bubbles:!0,composed:!0}))}render(){return d`
      <div class="card">
        <div class="header">
          <div class="label">Assistant</div>
          <div class="actions">
            <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
            <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
          </div>
        </div>
        <card-markdown .content=${this.content} role="assistant" .mentionedFiles=${this.mentionedFiles||[]} .selectedFiles=${this.selectedFiles||[]} .editResults=${this.editResults||[]}></card-markdown>
        <div class="footer-actions">
          <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
          <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
        </div>
      </div>
    `}}customElements.define("assistant-card",Si);class Ci extends z{static properties={isListening:{type:Boolean,state:!0},autoTranscribe:{type:Boolean,state:!0},isSupported:{type:Boolean,state:!0},ledStatus:{type:String,state:!0}};constructor(){super(),this.isListening=!1,this.autoTranscribe=!1,this.isSupported="webkitSpeechRecognition"in window||"SpeechRecognition"in window,this.ledStatus="inactive",this.recognition=null,this._initSpeechRecognition()}static styles=U`
    :host {
      display: inline-flex;
    }

    .mic-btn {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s ease;
    }

    .mic-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .mic-btn.listening {
      background: rgba(255, 152, 0, 0.3);
      border-color: #ff9800;
      animation: pulse 1.5s infinite;
    }

    .mic-btn.speaking {
      background: rgba(76, 175, 80, 0.3);
      border-color: #4caf50;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    .mic-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;connectedCallback(){super.connectedCallback(),!this.recognition&&this.isSupported&&this._initSpeechRecognition()}disconnectedCallback(){if(super.disconnectedCallback(),this.recognition)try{this.recognition.stop()}catch{}}_initSpeechRecognition(){if(!this.isSupported)return;const e=window.SpeechRecognition||window.webkitSpeechRecognition;this.recognition=new e,this.recognition.continuous=!1,this.recognition.interimResults=!1,this.recognition.lang=navigator.language||"en-US",this.recognition.onstart=this._handleStart.bind(this),this.recognition.onresult=this._handleResult.bind(this),this.recognition.onerror=this._handleError.bind(this),this.recognition.onend=this._handleEnd.bind(this),this.recognition.onspeechstart=this._handleSpeechStart.bind(this),this.recognition.onspeechend=this._handleSpeechEnd.bind(this)}_handleStart(){this.isListening=!0,this.ledStatus="listening",this.dispatchEvent(new CustomEvent("recording-started",{bubbles:!0,composed:!0}))}_handleSpeechStart(){this.ledStatus="speaking"}_handleSpeechEnd(){this.autoTranscribe&&this.isListening&&(this.ledStatus="listening")}_handleResult(e){if(e.results.length>0){const t=e.results[e.resultIndex][0].transcript;this.dispatchEvent(new CustomEvent("transcript",{detail:{text:t},bubbles:!0,composed:!0})),this.autoTranscribe||this.stopListening()}}_handleError(e){console.error("Speech recognition error:",e.error),this.stopListening(),this.dispatchEvent(new CustomEvent("recognition-error",{detail:{error:e.error},bubbles:!0,composed:!0}))}_handleEnd(){this.autoTranscribe&&this.isListening?setTimeout(()=>{try{this.recognition.start()}catch(e){console.error("Error restarting recognition:",e),this.isListening=!1,this.ledStatus="inactive"}},100):(this.isListening=!1,this.ledStatus="inactive")}startListening(){if(!(!this.isSupported||this.isListening))try{this.recognition.start()}catch(e){console.error("Error starting recognition:",e)}}stopListening(){if(!(!this.isSupported||!this.isListening))try{this.recognition.stop()}catch(e){console.error("Error stopping recognition:",e),this.isListening=!1,this.ledStatus="inactive"}}_toggleListening(){this.isListening?this.stopListening():this.startListening()}_toggleAutoTranscribe(){this.autoTranscribe=!this.autoTranscribe,this.autoTranscribe?this.startListening():this.stopListening()}render(){if(!this.isSupported)return d``;const e=this.ledStatus==="speaking"?"speaking":this.isListening?"listening":"";return d`
      <button 
        class="mic-btn ${e}"
        @click=${this._toggleAutoTranscribe}
        title=${this.autoTranscribe?"Stop auto-transcribe":"Enable auto-transcribe (continuous listening)"}
      >🎤</button>
    `}}customElements.define("speech-to-text",Ci);const Ei=U`
  :host {
    display: flex;
    flex-direction: column;
    font-size: 13px;
    height: 100%;
  }

  .container {
    background: #1a1a2e;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .search-header {
    padding: 8px 12px;
    background: #0f3460;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .search-input-row {
    display: flex;
    gap: 8px;
  }

  input[type="text"] {
    flex: 1;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    background: #16213e;
    color: #eee;
    font-size: 13px;
  }

  input[type="text"]:focus {
    outline: 1px solid #e94560;
  }

  input[type="text"]::placeholder {
    color: #666;
  }

  .search-options {
    display: flex;
    gap: 4px;
  }

  .option-btn {
    padding: 4px 8px;
    border: 1px solid #0f3460;
    border-radius: 4px;
    background: #16213e;
    color: #888;
    cursor: pointer;
    font-size: 11px;
    min-width: 28px;
    text-align: center;
  }

  .option-btn:hover {
    background: #1a3a6e;
    color: #ccc;
  }

  .option-btn.active {
    background: #e94560;
    color: #fff;
    border-color: #e94560;
  }

  .results-summary {
    padding: 6px 12px;
    background: #16213e;
    color: #888;
    font-size: 12px;
    border-bottom: 1px solid #0f3460;
  }

  .results-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    min-height: 0;
  }

  .file-group {
    margin-bottom: 8px;
  }

  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    color: #7ec699;
    font-weight: 500;
  }

  .file-header:hover {
    background: #0f3460;
  }

  .file-header .icon {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: #666;
    transition: transform 0.15s;
  }

  .file-header .icon.expanded {
    transform: rotate(90deg);
  }

  .file-header .match-count {
    color: #666;
    font-weight: normal;
    font-size: 11px;
    margin-left: auto;
  }

  .match-list {
    margin-left: 20px;
  }

  .match-item {
    display: flex;
    flex-direction: column;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 12px;
  }

  .match-item:hover,
  .match-item.focused {
    background: #0f3460;
  }

  .match-item.focused {
    outline: 1px solid #e94560;
    outline-offset: -1px;
  }

  .match-row {
    display: flex;
    gap: 8px;
  }

  .line-num {
    color: #666;
    min-width: 36px;
    text-align: right;
    flex-shrink: 0;
  }

  .match-content {
    color: #ccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .match-content .highlight {
    background: #e9456033;
    color: #e94560;
    border-radius: 2px;
    padding: 0 2px;
  }

  /* Context lines - only shown when item is active */
  .context-lines {
    display: none;
    flex-direction: column;
    margin-top: 2px;
    padding-top: 2px;
    border-top: 1px solid #0f3460;
  }

  .match-item.show-context .context-lines {
    display: flex;
  }

  .context-line {
    display: flex;
    gap: 8px;
    opacity: 0.6;
  }

  .context-line .line-num {
    color: #555;
  }

  .context-line .match-content {
    color: #888;
  }

  .match-line {
    display: flex;
    gap: 8px;
  }

  .match-line .line-num {
    color: #e94560;
  }

  /* Empty states */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    text-align: center;
    padding: 20px;
    gap: 8px;
  }

  .empty-state .icon {
    font-size: 32px;
    opacity: 0.5;
  }

  .empty-state .hint {
    font-size: 11px;
    color: #555;
  }

  /* Loading state */
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    color: #888;
    gap: 8px;
  }

  .loading .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #333;
    border-top-color: #e94560;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Error state */
  .error-state {
    padding: 12px;
    color: #e94560;
    background: #3d1a2a;
    border-radius: 4px;
    margin: 8px;
    font-size: 12px;
  }

  .hidden {
    display: none;
  }
`;function Fi(i){return d`
    <div class="search-options">
      <button 
        class="option-btn ${i.ignoreCase?"":"active"}"
        @click=${()=>i.toggleOption("ignoreCase")}
        title="Match Case"
      >Aa</button>
      <button 
        class="option-btn ${i.useRegex?"active":""}"
        @click=${()=>i.toggleOption("useRegex")}
        title="Use Regular Expression"
      >.*</button>
      <button 
        class="option-btn ${i.wholeWord?"active":""}"
        @click=${()=>i.toggleOption("wholeWord")}
        title="Match Whole Word"
      >W</button>
    </div>
  `}function Ti(i){return i.isSearching?d`
      <div class="loading">
        <div class="spinner"></div>
        <span>Searching...</span>
      </div>
    `:i.error?d`
      <div class="error-state">
        ⚠ ${i.error}
      </div>
    `:i.query&&i.results.length===0&&i.searchPerformed?d`
      <div class="empty-state">
        <div class="icon">🔍</div>
        <div>No results found</div>
        <div class="hint">for "${i.query}"</div>
      </div>
    `:d`
    <div class="empty-state">
      <div class="icon">🔍</div>
      <div>Type to search across all files</div>
      <div class="hint">Ctrl+Shift+F to focus • ↑↓ to navigate</div>
    </div>
  `}function Ri(i,e,t,s){if(!e)return i;try{const n=s?"gi":"g",r=t?e:e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),o=new RegExp(`(${r})`,n);return i.split(o).map((l,c)=>c%2===1?d`<span class="highlight">${l}</span>`:l)}catch{return i}}function Mt(i,e){return!i||i.length===0?"":d`
    ${i.map(t=>d`
      <div class="context-line">
        <span class="line-num">${t.line_num}</span>
        <span class="match-content">${t.line}</span>
      </div>
    `)}
  `}function Ai(i,e,t,s){const n=i.focusedIndex===s,r=i.hoveredIndex===s,o=n||r,a=t.context_before?.length>0||t.context_after?.length>0;return d`
    <div 
      class="match-item ${n?"focused":""} ${o&&a?"show-context":""}"
      @click=${()=>i.selectResult(e.file,t.line_num)}
      @mouseenter=${()=>i.setHoveredIndex(s)}
      @mouseleave=${()=>i.clearHoveredIndex()}
    >
      ${a?d`
        <div class="context-lines">
          ${Mt(t.context_before)}
        </div>
      `:""}
      <div class="match-line">
        <span class="line-num">${t.line_num}</span>
        <span class="match-content">
          ${Ri(t.line,i.query,i.useRegex,i.ignoreCase)}
        </span>
      </div>
      ${a?d`
        <div class="context-lines">
          ${Mt(t.context_after)}
        </div>
      `:""}
    </div>
  `}function Mi(i){if(i.results.length===0)return Ti(i);let e=0;return d`
    ${i.results.map(t=>{const s=t.matches.map(n=>{const r=Ai(i,t,n,e);return e++,r});return d`
        <div class="file-group">
          <div class="file-header">
            <span 
              class="icon ${i.expandedFiles[t.file]!==!1?"expanded":""}"
              @click=${n=>{n.stopPropagation(),i.toggleFileExpanded(t.file)}}
            >▶</span>
            <span 
              class="file-name"
              @click=${()=>i.openFile(t.file)}
            >${t.file}</span>
            <span class="match-count">(${t.matches.length})</span>
          </div>
          ${i.expandedFiles[t.file]!==!1?d`
            <div class="match-list">
              ${s}
            </div>
          `:""}
        </div>
      `})}
  `}function Li(i){return i.reduce((e,t)=>e+t.matches.length,0)}function zi(i){const e=Li(i.results),t=i.results.length;return d`
    <div class="container">
      <div class="search-header">
        <div class="search-input-row">
          <input
            type="text"
            placeholder="Search in files..."
            .value=${i.query}
            @input=${s=>i.handleSearchInput(s)}
            @keydown=${s=>i.handleKeydown(s)}
          >
        </div>
        ${Fi(i)}
      </div>
      ${e>0?d`
        <div class="results-summary">
          ${e} result${e!==1?"s":""} in ${t} file${t!==1?"s":""}
        </div>
      `:""}
      <div class="results-list">
        ${Mi(i)}
      </div>
    </div>
  `}function as(i){if(!i)return null;if(typeof i!="object")return i;const e=Object.values(i);return e.length>0?e[0]:null}function ls(i,e=300){let t=null;const s=(...n)=>{t&&clearTimeout(t),t=setTimeout(()=>i(...n),e)};return s.cancel=()=>{t&&clearTimeout(t),t=null},s}const ge=i=>class extends i{__rpcCall=null;set rpcCall(e){const t=this.__rpcCall!=null;this.__rpcCall=e,e&&!t&&typeof this.onRpcReady=="function"&&this.onRpcReady()}get rpcCall(){return this.__rpcCall}_rpc(e,...t){return this.__rpcCall?.[e]?this.__rpcCall[e](...t):Promise.reject(new Error(`RPC not available: ${e}`))}_call(e,...t){return this._rpc(e,...t)}async _rpcExtract(e,...t){const s=await this._rpc(e,...t);return as(s)}async _rpcWithState(e,t={},...s){const{loadingProp:n="isLoading",errorProp:r="error"}=t;this[n]=!0,this[r]=null;try{const o=await this._rpcExtract(e,...s);return o?.error?(this[r]=o.error,null):o}catch(o){return this[r]=o.message||`${e} failed`,null}finally{this[n]=!1}}};class Ui extends ge(z){static properties={query:{type:String},results:{type:Array},isSearching:{type:Boolean},searchPerformed:{type:Boolean},error:{type:String},ignoreCase:{type:Boolean},useRegex:{type:Boolean},wholeWord:{type:Boolean},expandedFiles:{type:Object},focusedIndex:{type:Number},hoveredIndex:{type:Number}};static styles=Ei;constructor(){super(),this.query="",this.results=[],this.isSearching=!1,this.searchPerformed=!1,this.error=null,this.expandedFiles={},this._debouncedSearch=ls(()=>this.performSearch(),300),this.focusedIndex=-1,this.hoveredIndex=-1;const e=localStorage.getItem("findInFiles.options");if(e)try{const t=JSON.parse(e);this.ignoreCase=t.ignoreCase??!0,this.useRegex=t.useRegex??!1,this.wholeWord=t.wholeWord??!1}catch{this.ignoreCase=!0,this.useRegex=!1,this.wholeWord=!1}else this.ignoreCase=!0,this.useRegex=!1,this.wholeWord=!1}_getFlatMatches(){const e=[];for(const t of this.results)for(const s of t.matches)e.push({file:t.file,match:s});return e}handleSearchInput(e){this.query=e.target.value,this.error=null,this.focusedIndex=-1,this.query.trim()?this._debouncedSearch():(this._debouncedSearch.cancel(),this.results=[],this.searchPerformed=!1,this.isSearching=!1)}handleKeydown(e){const t=this._getFlatMatches();if(e.key==="Escape")this.query?(this.query="",this.results=[],this.searchPerformed=!1,this.focusedIndex=-1):this.dispatchEvent(new CustomEvent("close-search",{bubbles:!0,composed:!0}));else if(e.key==="ArrowDown")e.preventDefault(),t.length>0&&(this.focusedIndex=Math.min(this.focusedIndex+1,t.length-1),this._scrollToFocused());else if(e.key==="ArrowUp")e.preventDefault(),t.length>0&&(this.focusedIndex=Math.max(this.focusedIndex-1,0),this._scrollToFocused());else if(e.key==="Enter"){if(e.preventDefault(),this.focusedIndex>=0&&this.focusedIndex<t.length){const{file:s,match:n}=t[this.focusedIndex];this.selectResult(s,n.line_num)}else if(t.length>0){const{file:s,match:n}=t[0];this.selectResult(s,n.line_num)}}}_scrollToFocused(){this.updateComplete.then(()=>{const e=this.shadowRoot?.querySelector(".match-item.focused");e&&e.scrollIntoView({block:"nearest",behavior:"smooth"})})}setHoveredIndex(e){this.hoveredIndex=e}clearHoveredIndex(){this.hoveredIndex=-1}async performSearch(){if(!this.query.trim()){this.results=[],this.searchPerformed=!1;return}this.isSearching=!0,this.error=null,this.focusedIndex=-1;try{const e=await this._call("Repo.search_files",this.query,this.wholeWord,this.useRegex,this.ignoreCase,4),t=as(e);Array.isArray(t)?this.results=t:t?.error?(this.error=t.error,this.results=[]):this.results=[]}catch(e){this.error=e.message||"Search failed",this.results=[]}this.isSearching=!1,this.searchPerformed=!0}toggleOption(e){e==="ignoreCase"?this.ignoreCase=!this.ignoreCase:e==="useRegex"?this.useRegex=!this.useRegex:e==="wholeWord"&&(this.wholeWord=!this.wholeWord),localStorage.setItem("findInFiles.options",JSON.stringify({ignoreCase:this.ignoreCase,useRegex:this.useRegex,wholeWord:this.wholeWord})),this.query.trim()&&this.performSearch()}toggleFileExpanded(e){this.expandedFiles={...this.expandedFiles,[e]:this.expandedFiles[e]===!1}}selectResult(e,t){this.dispatchEvent(new CustomEvent("result-selected",{detail:{file:e,line:t},bubbles:!0,composed:!0}))}openFile(e){this.dispatchEvent(new CustomEvent("file-selected",{detail:{file:e},bubbles:!0,composed:!0}))}focusInput(){const e=this.shadowRoot?.querySelector('input[type="text"]');e&&(e.focus(),e.select())}render(){return zi(this)}}customElements.define("find-in-files",Ui);const Ii=U`
  .symbol-map-files {
    max-height: 300px;
    overflow-y: auto;
  }
  
  .symbol-map-chunks {
    background: #0f3460;
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 10px;
  }
  
  .chunks-header {
    font-size: 11px;
    color: #888;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #1a4a7a;
  }
  
  .chunk-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 4px;
    margin-bottom: 4px;
  }
  
  .chunk-row:last-child {
    margin-bottom: 0;
  }
  
  .chunk-row.cached {
    background: rgba(74, 222, 128, 0.1);
  }
  
  .chunk-row.uncached {
    background: rgba(251, 191, 36, 0.1);
  }
  
  .chunk-icon {
    font-size: 12px;
  }
  
  .chunk-label {
    color: #ccc;
    min-width: 60px;
  }
  
  .chunk-tokens {
    font-family: monospace;
    color: #888;
    font-size: 11px;
    min-width: 70px;
  }
  
  .chunk-status {
    font-size: 10px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .chunk-row.cached .chunk-status {
    color: #4ade80;
  }
  
  .chunk-row.uncached .chunk-status {
    color: #fbbf24;
  }
  
  .chunk-container {
    margin-bottom: 8px;
  }
  
  .chunk-container:last-child {
    margin-bottom: 0;
  }
  
  .chunk-file-count {
    font-size: 11px;
    color: #888;
    min-width: 50px;
  }
  
  .chunk-files {
    margin-left: 28px;
    margin-top: 4px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    max-height: 120px;
    overflow-y: auto;
  }
  
  .chunk-file {
    font-size: 11px;
    color: #888;
    padding: 2px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .chunk-row.cached + .chunk-files .chunk-file {
    color: #6ee7b7;
  }

  .symbol-map-info {
    font-size: 11px;
    color: #888;
    padding: 6px 8px;
    background: #1a1a2e;
    border-radius: 4px;
    margin-bottom: 6px;
    line-height: 1.4;
  }
  
  .symbol-map-file {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .file-order {
    color: #666;
    font-size: 11px;
    min-width: 24px;
    text-align: right;
  }

  :host {
    display: block;
    height: 100%;
    width: 100%;
    min-height: 400px;
    min-width: 300px;
    overflow-y: auto;
    background: #1a1a2e;
    color: #eee;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
  }

  .context-container {
    padding: 16px;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
  }

  .error {
    color: #e94560;
  }

  /* Token Budget Section */
  .budget-section {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .budget-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .budget-title {
    font-weight: 600;
    color: #fff;
  }

  .budget-value {
    font-family: monospace;
    color: #4ade80;
  }

  .budget-bar {
    height: 8px;
    background: #0f3460;
    border-radius: 4px;
    overflow: hidden;
  }

  .budget-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4ade80, #22c55e);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .budget-bar-fill.warning {
    background: linear-gradient(90deg, #fbbf24, #f59e0b);
  }

  .budget-bar-fill.danger {
    background: linear-gradient(90deg, #ef4444, #dc2626);
  }

  .budget-percent {
    text-align: right;
    font-size: 12px;
    color: #888;
    margin-top: 4px;
  }

  /* Category Breakdown */
  .breakdown-section {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
  }

  .breakdown-title {
    font-weight: 600;
    color: #fff;
    margin-bottom: 16px;
  }

  .category-row {
    display: flex;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #0f3460;
  }

  .category-row:last-child {
    border-bottom: none;
  }

  .category-row.expandable {
    cursor: pointer;
  }

  .category-row.expandable:hover {
    background: #0f3460;
    margin: 0 -8px;
    padding: 8px;
    border-radius: 4px;
  }

  .category-expand {
    width: 20px;
    color: #888;
    font-size: 10px;
  }

  .category-label {
    flex: 1;
    color: #ccc;
  }

  .category-tokens {
    font-family: monospace;
    color: #4ade80;
    margin-right: 12px;
    min-width: 60px;
    text-align: right;
  }

  .category-bar {
    width: 100px;
    height: 6px;
    background: #0f3460;
    border-radius: 3px;
    overflow: hidden;
  }

  .category-bar-fill {
    height: 100%;
    background: #4ade80;
    border-radius: 3px;
  }

  /* Expanded Items */
  .expanded-items {
    padding-left: 28px;
    margin-top: 8px;
  }

  .item-row {
    display: flex;
    align-items: center;
    padding: 6px 0;
    font-size: 12px;
  }

  .item-row.excluded {
    opacity: 0.6;
  }

  .url-checkbox {
    margin-right: 8px;
    cursor: pointer;
    accent-color: #4ade80;
  }

  .item-path {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-path.excluded {
    text-decoration: line-through;
    color: #666;
  }

  .item-tokens {
    font-family: monospace;
    color: #888;
    margin-left: 8px;
  }

  .item-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
  }

  .item-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .item-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .item-btn.danger:hover {
    background: #7f1d1d;
    color: #fca5a5;
  }

  /* History Warning */
  .history-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #fbbf24;
    font-size: 12px;
    margin-top: 4px;
    padding-left: 28px;
  }

  /* Refresh Button */
  .refresh-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .refresh-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Category row with action button */
  .category-row-with-action {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .category-row-with-action .category-row {
    flex: 1;
  }

  .symbol-map-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
  }

  .symbol-map-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .symbol-map-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Model Info */
  .model-info {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #666;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #0f3460;
  }

  /* Session Totals */
  .session-totals {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid #0f3460;
  }

  .session-totals .breakdown-title {
    margin-bottom: 12px;
  }

  .session-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    font-size: 12px;
  }

  .session-label {
    color: #888;
  }

  .session-value {
    font-family: monospace;
    color: #4ade80;
  }

  .session-row.total {
    border-top: 1px solid #0f3460;
    margin-top: 4px;
    padding-top: 8px;
    font-weight: 600;
  }

  .session-row.total .session-value {
    color: #fff;
  }

  .session-row.cache .session-value {
    color: #fbbf24;
  }
`;function C(i){return i?i>=1e6?`${(i/1e6).toFixed(1)}M`:i>=1e3?`${(i/1e3).toFixed(1)}K`:String(i):"0"}function Ke(i){return i?new Date(i).toLocaleString():""}function Pi(i){if(!i)return"Unknown";try{const e=new Date(i),s=new Date-e;return s<6e4?"Just now":s<36e5?`${Math.floor(s/6e4)} min ago`:s<864e5?`${Math.floor(s/36e5)} hours ago`:e.toLocaleDateString()}catch{return"Unknown"}}function Di(i,e=100){return!i||i.length<=e?i:i.substring(0,e)+"..."}function Hi(i){return d`
    <button 
      class="symbol-map-btn"
      @click=${()=>i.viewSymbolMap()}
      ?disabled=${i.isLoadingSymbolMap}
    >
      ${i.isLoadingSymbolMap?"⏳":"🗺️"} View Symbol Map
    </button>
  `}function Oi(i){const{breakdown:e}=i;if(!e)return d``;const t=i.getUsagePercent(),s=t>90?"danger":t>75?"warning":"";return d`
    <div class="budget-section">
      <div class="budget-header">
        <span class="budget-title">Token Budget</span>
        <span class="budget-value">
          ${C(e.used_tokens)} / ${C(e.max_input_tokens)}
        </span>
      </div>
      <div class="budget-bar">
        <div class="budget-bar-fill ${s}" style="width: ${t}%"></div>
      </div>
      <div class="budget-percent">${t}% used</div>
    </div>
  `}function ce(i,e,t,s=!1){const n=i.expandedSections[e],r=i.getBarWidth(t.tokens);return d`
    <div 
      class="category-row ${s?"expandable":""}"
      @click=${s?()=>i.toggleSection(e):null}
    >
      <span class="category-expand">
        ${s?n?"▼":"▶":""}
      </span>
      <span class="category-label">${t.label}</span>
      <span class="category-tokens">${C(t.tokens)}</span>
      <div class="category-bar">
        <div class="category-bar-fill" style="width: ${r}%"></div>
      </div>
    </div>
    ${s&&n?ji(i,e,t):""}
  `}function ji(i,e,t){if(e==="files"&&t.items?.length)return d`
      <div class="expanded-items">
        ${t.items.map(s=>d`
          <div class="item-row">
            <span class="item-path" title="${s.path}">${s.path}</span>
            <span class="item-tokens">${C(s.tokens)}</span>
          </div>
        `)}
      </div>
    `;if(e==="symbol_map"&&t.files?.length){const s=t.chunks?.some(n=>n.files?.length>0);return d`
      <div class="expanded-items symbol-map-files">
        ${t.chunks?.length?d`
          <div class="symbol-map-chunks">
            <div class="chunks-header">Cache Chunks (Bedrock limit: 4 blocks, 1 used by system prompt)</div>
            ${t.chunks.map(n=>d`
              <div class="chunk-container">
                <div class="chunk-row ${n.cached?"cached":"uncached"}">
                  <span class="chunk-icon">${n.cached?"🔒":"📝"}</span>
                  <span class="chunk-label">Chunk ${n.index}</span>
                  <span class="chunk-tokens">~${C(n.tokens)}</span>
                  <span class="chunk-file-count">${n.files?.length||0} files</span>
                  <span class="chunk-status">${n.cached?"cached":"volatile"}</span>
                </div>
                ${n.files?.length?d`
                  <div class="chunk-files">
                    ${n.files.map(r=>d`
                      <div class="chunk-file" title="${r}">${r}</div>
                    `)}
                  </div>
                `:""}
              </div>
            `)}
          </div>
        `:""}
        ${s?"":d`
          <div class="symbol-map-info">
            Files are ordered for LLM prefix cache optimization.
            New files appear at the bottom to preserve cached context.
          </div>
          ${t.files.map((n,r)=>d`
            <div class="item-row symbol-map-file">
              <span class="file-order">${r+1}.</span>
              <span class="item-path" title="${n}">${n}</span>
            </div>
          `)}
        `}
      </div>
    `}if(e==="urls"){const s=i.fetchedUrls||[];if(s.length===0)return"";const n={};if(t.items)for(const r of t.items)n[r.url]={tokens:r.tokens,title:r.title};return d`
      <div class="expanded-items">
        ${s.map(r=>{const o=i.isUrlIncluded(r),a=n[r]||{};return d`
            <div class="item-row ${o?"":"excluded"}">
              <input 
                type="checkbox" 
                class="url-checkbox"
                .checked=${o}
                @click=${l=>l.stopPropagation()}
                @change=${l=>{l.stopPropagation(),i.toggleUrlIncluded(r)}}
                title="${o?"Click to exclude from context":"Click to include in context"}"
              />
              <span class="item-path ${o?"":"excluded"}" title="${r}">${a.title||r}</span>
              <span class="item-tokens">${o?C(a.tokens||0):"—"}</span>
              <div class="item-actions">
                <button class="item-btn" @click=${l=>{l.stopPropagation(),i.viewUrl(r)}}>
                  View
                </button>
                <button class="item-btn danger" @click=${l=>{l.stopPropagation(),i.removeUrl(r)}}>
                  ✕
                </button>
              </div>
            </div>
          `})}
      </div>
    `}return e==="history"&&t.needs_summary?d`
      <div class="history-warning">
        ⚠️ History exceeds budget (${C(t.tokens)} / ${C(t.max_tokens)}) - consider summarizing
      </div>
    `:""}function Bi(i){const{breakdown:e}=i;if(!e?.breakdown)return d``;const t=e.breakdown,s=t.symbol_map?.files?.length>0;return d`
    <div class="breakdown-section">
      <div class="breakdown-title">Category Breakdown</div>
      ${ce(i,"system",t.system)}
      <div class="category-row-with-action">
        ${ce(i,"symbol_map",{...t.symbol_map,label:s?`Symbol Map (${t.symbol_map.file_count} files)`:t.symbol_map.label},s)}
        ${Hi(i)}
      </div>
      ${ce(i,"files",t.files,!0)}
      ${ce(i,"urls",t.urls,i.fetchedUrls?.length>0)}
      ${ce(i,"history",t.history,t.history?.needs_summary)}
      
      <div class="model-info">
        <span>Model: ${e.model}</span>
        <button 
          class="refresh-btn" 
          @click=${()=>i.refreshBreakdown()}
          ?disabled=${i.isLoading}
        >
          ${i.isLoading?"...":"↻ Refresh"}
        </button>
      </div>
      
      ${e.session_totals?d`
        <div class="session-totals">
          <div class="breakdown-title">Session Totals</div>
          <div class="session-row">
            <span class="session-label">Tokens In:</span>
            <span class="session-value">${C(e.session_totals.prompt_tokens)}</span>
          </div>
          <div class="session-row">
            <span class="session-label">Tokens Out:</span>
            <span class="session-value">${C(e.session_totals.completion_tokens)}</span>
          </div>
          <div class="session-row total">
            <span class="session-label">Total:</span>
            <span class="session-value">${C(e.session_totals.total_tokens)}</span>
          </div>
          ${e.session_totals.cache_hit_tokens?d`
            <div class="session-row cache">
              <span class="session-label">Cache Reads:</span>
              <span class="session-value">${C(e.session_totals.cache_hit_tokens)}</span>
            </div>
          `:""}
          ${e.session_totals.cache_write_tokens?d`
            <div class="session-row cache">
              <span class="session-label">Cache Writes:</span>
              <span class="session-value">${C(e.session_totals.cache_write_tokens)}</span>
            </div>
          `:""}
        </div>
      `:""}
    </div>
  `}function Ni(i){return i.isLoading&&!i.breakdown?d`<div class="loading">Loading context breakdown...</div>`:i.error?d`<div class="error">Error: ${i.error}</div>`:i.breakdown?d`
    <div class="context-container">
      ${Oi(i)}
      ${Bi(i)}
    </div>
    
    <url-content-modal
      ?open=${i.showUrlModal}
      .url=${i.selectedUrl}
      .content=${i.urlContent}
      @close=${()=>i.closeUrlModal()}
    ></url-content-modal>
    
    <symbol-map-modal
      ?open=${i.showSymbolMapModal}
      .content=${i.symbolMapContent}
      .isLoading=${i.isLoadingSymbolMap}
      @close=${()=>i.closeSymbolMapModal()}
    ></symbol-map-modal>
  `:d`<div class="loading">No breakdown data available</div>`}const cs=U`
  :host {
    display: block;
  }

  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    background: #1a1a2e;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    border: 1px solid #0f3460;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #0f3460;
  }

  .modal-title {
    font-weight: 600;
    color: #fff;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: #fff;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
  }

  .modal-footer {
    padding: 12px 20px;
    border-top: 1px solid #0f3460;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .footer-btn {
    background: #0f3460;
    border: none;
    border-radius: 6px;
    color: #ccc;
    padding: 8px 16px;
    font-size: 12px;
    cursor: pointer;
  }

  .footer-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: #888;
    gap: 8px;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #333;
    border-top-color: #e94560;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error {
    color: #e94560;
    padding: 20px;
  }
`;class Me extends z{static properties={open:{type:Boolean}};constructor(){super(),this.open=!1}_close(){this.dispatchEvent(new CustomEvent("close",{bubbles:!0,composed:!0}))}_handleOverlayClick(e){e.target===e.currentTarget&&this._close()}_copyToClipboard(e){e&&navigator.clipboard.writeText(e)}}class qi extends Me{static properties={...Me.properties,url:{type:String},content:{type:Object},showFullContent:{type:Boolean}};static styles=[cs,U`
      .modal {
        width: 90%;
        max-width: 800px;
        max-height: 80vh;
      }

      .modal-meta {
        padding: 12px 20px;
        background: #16213e;
        display: flex;
        flex-wrap: wrap;
        gap: 12px 20px;
        font-size: 12px;
        color: #888;
      }

      .meta-item {
        display: flex;
        gap: 6px;
      }

      .meta-label {
        color: #666;
      }

      .meta-value {
        color: #aaa;
      }

      .content-section {
        margin-bottom: 20px;
      }

      .content-label {
        font-size: 11px;
        text-transform: uppercase;
        color: #666;
        margin-bottom: 8px;
      }

      .content-box {
        background: #0f3460;
        border-radius: 8px;
        padding: 16px;
        font-size: 13px;
        line-height: 1.6;
        color: #ccc;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 300px;
        overflow-y: auto;
      }

      .content-box.full {
        max-height: none;
      }
    `];constructor(){super(),this.url="",this.content=null,this.showFullContent=!1}updated(e){e.has("open")&&this.open&&(this.showFullContent=!1)}_toggleFullContent(){this.showFullContent=!this.showFullContent}render(){return this.open?d`
      <div class="overlay" @click=${this._handleOverlayClick}>
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">URL Content</span>
            <button class="close-btn" @click=${this._close}>✕</button>
          </div>
          
          ${this._renderContent()}
        </div>
      </div>
    `:d``}_renderContent(){if(!this.content)return d`<div class="loading">Loading...</div>`;if(this.content.error)return d`<div class="error">Error: ${this.content.error}</div>`;const{title:e,type:t,fetched_at:s,content_tokens:n,readme_tokens:r,description:o,content:a,readme:l,symbol_map:c}=this.content;return d`
      <div class="modal-meta">
        <div class="meta-item">
          <span class="meta-label">URL:</span>
          <span class="meta-value">${this.url}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Type:</span>
          <span class="meta-value">${t||"unknown"}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Fetched:</span>
          <span class="meta-value">${Pi(s)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Tokens:</span>
          <span class="meta-value">${C(r||n)}</span>
        </div>
      </div>
      
      <div class="modal-body">
        ${o?d`
          <div class="content-section">
            <div class="content-label">Description</div>
            <div class="content-box">${o}</div>
          </div>
        `:""}
        
        ${l?d`
          <div class="content-section">
            <div class="content-label">README</div>
            <div class="content-box ${this.showFullContent?"full":""}">${l}</div>
          </div>
        `:""}
        
        ${c?d`
          <div class="content-section">
            <div class="content-label">Symbol Map</div>
            <div class="content-box ${this.showFullContent?"full":""}">${c}</div>
          </div>
        `:""}
        
        ${a&&this.showFullContent?d`
          <div class="content-section">
            <div class="content-label">Full Content</div>
            <div class="content-box full">${a}</div>
          </div>
        `:""}
      </div>
      
      <div class="modal-footer">
        ${a||c?d`
          <button class="footer-btn" @click=${this._toggleFullContent}>
            ${this.showFullContent?"Hide Details":"Show Full Content"}
          </button>
        `:""}
      </div>
    `}}customElements.define("url-content-modal",qi);class Vi extends Me{static properties={...Me.properties,content:{type:String},isLoading:{type:Boolean}};static styles=[cs,U`
      .modal {
        width: 90%;
        max-width: 900px;
        max-height: 85vh;
      }

      .modal-body {
        padding: 0;
      }

      .content-box {
        background: #0d0d0d;
        padding: 16px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Fira Code', monospace;
        font-size: 12px;
        line-height: 1.5;
        color: #ccc;
        white-space: pre;
        overflow-x: auto;
        min-height: 200px;
      }

      .footer-info {
        font-size: 11px;
        color: #666;
      }
    `];constructor(){super(),this.content=null,this.isLoading=!1}_getLineCount(){return this.content?this.content.split(`
`).length:0}render(){return this.open?d`
      <div class="overlay" @click=${this._handleOverlayClick}>
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">
              <span>🗺️</span>
              <span>Symbol Map</span>
            </span>
            <button class="close-btn" @click=${this._close}>✕</button>
          </div>
          
          <div class="modal-body">
            ${this.isLoading?d`
              <div class="loading">
                <div class="spinner"></div>
                <span>Loading symbol map...</span>
              </div>
            `:d`
              <div class="content-box">${this.content||"No content available"}</div>
            `}
          </div>
          
          <div class="modal-footer">
            <span class="footer-info">
              ${this.content?`${this._getLineCount()} lines`:""}
            </span>
            <button class="copy-btn" @click=${this._copyToClipboard} ?disabled=${!this.content}>
              📋 Copy to Clipboard
            </button>
          </div>
        </div>
      </div>
    `:d``}}customElements.define("symbol-map-modal",Vi);class Wi extends ge(z){static properties={visible:{type:Boolean},breakdown:{type:Object},isLoading:{type:Boolean},error:{type:String},expandedSections:{type:Object},selectedUrl:{type:String},showUrlModal:{type:Boolean},urlContent:{type:Object},showSymbolMapModal:{type:Boolean},symbolMapContent:{type:String},isLoadingSymbolMap:{type:Boolean},selectedFiles:{type:Array},fetchedUrls:{type:Array},excludedUrls:{type:Object}};static styles=Ii;constructor(){super(),this.visible=!0,this.breakdown=null,this.isLoading=!1,this.error=null,this.expandedSections={files:!1,urls:!1,history:!1,symbol_map:!1},this.selectedUrl=null,this.showUrlModal=!1,this.urlContent=null,this.showSymbolMapModal=!1,this.symbolMapContent=null,this.isLoadingSymbolMap=!1,this.selectedFiles=[],this.fetchedUrls=[],this.excludedUrls=new Set}onRpcReady(){this.refreshBreakdown()}getIncludedUrls(){return this.fetchedUrls?this.fetchedUrls.filter(e=>!this.excludedUrls.has(e)):[]}async refreshBreakdown(){if(!this.rpcCall)return;const e=await this._rpcWithState("LiteLLM.get_context_breakdown",{},this.selectedFiles||[],this.getIncludedUrls());e&&(this.breakdown=e)}willUpdate(e){(e.has("selectedFiles")||e.has("fetchedUrls"))&&this.rpcCall&&this.refreshBreakdown()}toggleSection(e){this.expandedSections={...this.expandedSections,[e]:!this.expandedSections[e]}}async viewUrl(e){if(this.rpcCall){this.selectedUrl=e,this.showUrlModal=!0,this.urlContent=null;try{const t=await this._rpc("LiteLLM.get_url_content",e);this.urlContent=extractResponse(t)}catch(t){this.urlContent={error:t.message}}}}closeUrlModal(){this.showUrlModal=!1,this.selectedUrl=null,this.urlContent=null}toggleUrlIncluded(e){const t=new Set(this.excludedUrls);t.has(e)?t.delete(e):t.add(e),this.excludedUrls=t,this.dispatchEvent(new CustomEvent("url-inclusion-changed",{detail:{url:e,included:!t.has(e),includedUrls:this.getIncludedUrls()},bubbles:!0,composed:!0})),this.refreshBreakdown()}isUrlIncluded(e){return!this.excludedUrls.has(e)}removeUrl(e){if(this.excludedUrls.has(e)){const t=new Set(this.excludedUrls);t.delete(e),this.excludedUrls=t}this.dispatchEvent(new CustomEvent("remove-url",{detail:{url:e},bubbles:!0,composed:!0}))}async viewSymbolMap(){if(this.rpcCall){this.isLoadingSymbolMap=!0,this.showSymbolMapModal=!0,this.symbolMapContent=null;try{const e=await this._rpc("LiteLLM.get_context_map",null,!0);this.symbolMapContent=extractResponse(e)}catch(e){this.symbolMapContent=`Error loading symbol map: ${e.message}`}finally{this.isLoadingSymbolMap=!1}}}closeSymbolMapModal(){this.showSymbolMapModal=!1,this.symbolMapContent=null}getUsagePercent(){if(!this.breakdown)return 0;const{used_tokens:e,max_input_tokens:t}=this.breakdown;return t?Math.min(100,Math.round(e/t*100)):0}getBarWidth(e){return!this.breakdown||!this.breakdown.used_tokens?0:Math.round(e/this.breakdown.used_tokens*100)}render(){return Ni(this)}}customElements.define("context-viewer",Wi);const Gi=U`
  :host {
    display: block;
    height: 100%;
    width: 100%;
    min-height: 400px;
    min-width: 300px;
    overflow-y: auto;
    background: #1a1a2e;
    color: #eee;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
  }

  .cache-container {
    padding: 16px;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
  }

  .error {
    color: #e94560;
  }

  /* ========== Search Box ========== */
  .search-box {
    position: relative;
    margin-bottom: 12px;
  }

  .search-input {
    width: 100%;
    padding: 10px 36px 10px 12px;
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 6px;
    color: #eee;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .search-input:focus {
    border-color: #4ade80;
    box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2);
  }

  .search-input::placeholder {
    color: #666;
  }

  .search-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px 8px;
    font-size: 12px;
  }

  .search-clear:hover {
    color: #fff;
  }

  .no-results {
    text-align: center;
    color: #888;
    padding: 20px;
    font-style: italic;
  }

  /* ========== Cache Performance Header ========== */
  .cache-performance {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .cache-performance-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .cache-performance-title {
    font-weight: 600;
    color: #fff;
  }

  .cache-performance-value {
    font-family: monospace;
    color: #4ade80;
  }

  .cache-bar {
    height: 8px;
    background: #0f3460;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .cache-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4ade80, #22c55e);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .cache-stats {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #888;
  }

  /* ========== Tier Blocks ========== */
  .tier-block {
    background: #16213e;
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
    border-left: 3px solid var(--tier-color, #888);
  }

  .tier-block.empty {
    opacity: 0.6;
  }

  .tier-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
  }

  .tier-header:hover {
    background: #1a2744;
  }

  .tier-expand {
    width: 20px;
    color: #888;
    font-size: 10px;
  }

  .tier-name {
    flex: 1;
    font-weight: 600;
    color: #fff;
  }

  .tier-name .tier-label {
    color: var(--tier-color, #888);
  }

  .tier-name .tier-desc {
    color: #888;
    font-weight: 400;
    margin-left: 8px;
  }

  .tier-tokens {
    font-family: monospace;
    color: #4ade80;
    margin-right: 8px;
  }

  .tier-cached {
    font-size: 14px;
  }

  .tier-threshold {
    font-size: 11px;
    color: #666;
    padding: 4px 12px 4px 36px;
    border-top: 1px solid #0f3460;
  }

  /* ========== Tier Contents ========== */
  .tier-contents {
    border-top: 1px solid #0f3460;
  }

  .content-group {
    border-bottom: 1px solid #0f3460;
  }

  .content-group:last-child {
    border-bottom: none;
  }

  .content-row {
    display: flex;
    align-items: center;
    padding: 8px 16px 8px 36px;
    cursor: pointer;
  }

  .content-row:hover {
    background: #0f3460;
  }

  .content-expand {
    width: 16px;
    color: #888;
    font-size: 10px;
  }

  .content-icon {
    width: 20px;
    margin-right: 8px;
  }

  .content-label {
    flex: 1;
    color: #ccc;
  }

  .content-tokens {
    font-family: monospace;
    color: #888;
    font-size: 12px;
  }

  /* ========== Item List ========== */
  .item-list {
    padding: 4px 0;
    background: #0f3460;
  }

  .item-row {
    display: flex;
    align-items: center;
    padding: 6px 16px 6px 56px;
    font-size: 12px;
  }

  .item-row:hover {
    background: #1a4a7a;
  }

  .item-row.clickable {
    cursor: pointer;
  }

  .item-path {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-tokens {
    font-family: monospace;
    color: #666;
    margin: 0 12px;
    min-width: 60px;
    text-align: right;
  }

  /* ========== Stability Progress ========== */
  .stability-container {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 100px;
  }

  .stability-bar {
    width: 50px;
    height: 4px;
    background: #1a1a2e;
    border-radius: 2px;
    overflow: hidden;
  }

  .stability-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .stability-bar-fill.tier-L0 { background: #4ade80; }
  .stability-bar-fill.tier-L1 { background: #2dd4bf; }
  .stability-bar-fill.tier-L2 { background: #60a5fa; }
  .stability-bar-fill.tier-L3 { background: #fbbf24; }
  .stability-bar-fill.tier-active { background: #fb923c; }

  .stability-text {
    font-size: 10px;
    color: #666;
    min-width: 45px;
  }

  /* ========== URL Items ========== */
  .url-row {
    display: flex;
    align-items: center;
    padding: 6px 16px 6px 56px;
    font-size: 12px;
  }

  .url-checkbox {
    margin-right: 8px;
    cursor: pointer;
    accent-color: #4ade80;
  }

  .url-title {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .url-title.excluded {
    text-decoration: line-through;
    color: #666;
  }

  .url-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
  }

  .url-btn {
    background: #1a1a2e;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .url-btn:hover {
    background: #2a2a4e;
    color: #fff;
  }

  .url-btn.danger:hover {
    background: #7f1d1d;
    color: #fca5a5;
  }

  /* ========== History Warning ========== */
  .history-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #fbbf24;
    font-size: 11px;
    padding: 4px 16px 8px 56px;
  }

  /* ========== Recent Changes ========== */
  .recent-changes {
    background: #16213e;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 12px;
  }

  .recent-changes-title {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .change-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
  }

  .change-icon {
    font-size: 14px;
  }

  .change-item {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .change-tier {
    color: #666;
  }

  /* ========== Footer / Actions ========== */
  .cache-footer {
    background: #16213e;
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .model-info {
    font-size: 11px;
    color: #666;
  }

  .footer-actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 6px 12px;
    font-size: 11px;
    cursor: pointer;
  }

  .action-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ========== Session Totals ========== */
  .session-totals {
    background: #16213e;
    border-radius: 8px;
    padding: 12px 16px;
    margin-top: 12px;
  }

  .session-title {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .session-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 12px;
  }

  .session-label {
    color: #888;
  }

  .session-value {
    font-family: monospace;
    color: #4ade80;
  }

  .session-row.total {
    border-top: 1px solid #0f3460;
    margin-top: 4px;
    padding-top: 6px;
  }

  .session-row.total .session-value {
    color: #fff;
  }

  .session-row.cache .session-value {
    color: #fbbf24;
  }
`;function ot(i){if(i.length>40){const e=i.split("/");if(e.length>3)return`${e[0]}/.../${e.slice(-2).join("/")}`}return i}function Xi(i){return i.next_threshold?`${i.stable_count}/${i.next_threshold}`:""}function Lt(i){return d`
    <div class="search-box">
      <input
        type="text"
        class="search-input"
        placeholder="Filter items... (fuzzy search)"
        .value=${i.searchQuery}
        @input=${e=>i.handleSearchInput(e)}
      />
      ${i.searchQuery?d`
        <button class="search-clear" @click=${()=>i.clearSearch()}>✕</button>
      `:""}
    </div>
  `}function zt(i){const e=i.getCacheHitPercent(),t=i.getTotalTokens(),s=i.getCachedTokens(),n=i.getUsagePercent();return d`
    <div class="cache-performance">
      <div class="cache-performance-header">
        <span class="cache-performance-title">Cache Performance</span>
        <span class="cache-performance-value">${e}% hit rate</span>
      </div>
      <div class="cache-bar">
        <div class="cache-bar-fill" style="width: ${e}%"></div>
      </div>
      <div class="cache-stats">
        <span>${C(s)} cached / ${C(t)} total</span>
        <span>${n}% of budget</span>
      </div>
    </div>
  `}function ds(i,e){if(!i.next_threshold)return d`
      <div class="stability-container">
        <div class="stability-bar">
          <div class="stability-bar-fill tier-${e}" style="width: 100%"></div>
        </div>
        <span class="stability-text">max</span>
      </div>
    `;const t=Math.round((i.progress||0)*100);return d`
    <div class="stability-container">
      <div class="stability-bar">
        <div class="stability-bar-fill tier-${i.next_tier||e}" style="width: ${t}%"></div>
      </div>
      <span class="stability-text">${Xi(i)}</span>
    </div>
  `}function Yi(i,e,t,s){const{type:n,icon:r,label:o}=s,a=i.isGroupExpanded(e,n),l=i.filterItems(t.items,n),c=l?.length||0,h=t.items?.length||t.count||0;if(i.searchQuery&&c===0)return"";const g=i.searchQuery?`${c}/${h}`:h;return d`
    <div class="content-group">
      <div class="content-row" @click=${()=>i.toggleGroup(e,n)}>
        <span class="content-expand">${a?"▼":"▶"}</span>
        <span class="content-icon">${r}</span>
        <span class="content-label">${o} (${g}${n==="symbols"?" files":""})</span>
        <span class="content-tokens">${C(t.tokens)}</span>
      </div>
      ${a?d`
        <div class="item-list">
          ${(l||[]).map(x=>s.renderItem?s.renderItem(i,x,e):Zi(i,x,e))}
        </div>
      `:""}
    </div>
  `}function Zi(i,e,t){return d`
    <div class="item-row clickable" @click=${()=>i.viewFile(e.path)}>
      <span class="item-path" title="${e.path}">${ot(e.path)}</span>
      ${ds(e,t)}
    </div>
  `}function Ki(i,e,t){return d`
    <div class="item-row clickable" @click=${()=>i.viewFile(e.path)}>
      <span class="item-path" title="${e.path}">${ot(e.path)}</span>
      <span class="item-tokens">${C(e.tokens)}</span>
      ${ds(e,t)}
    </div>
  `}function Qi(i,e,t){const s=i.isUrlIncluded(e.url);return d`
    <div class="url-row">
      <input 
        type="checkbox" 
        class="url-checkbox"
        .checked=${s}
        @click=${n=>n.stopPropagation()}
        @change=${n=>{n.stopPropagation(),i.toggleUrlIncluded(e.url)}}
      />
      <span class="url-title ${s?"":"excluded"}" title="${e.url}">
        ${e.title||e.url}
      </span>
      <span class="item-tokens">${s?C(e.tokens):"—"}</span>
      <div class="url-actions">
        <button class="url-btn" @click=${n=>{n.stopPropagation(),i.viewUrl(e.url)}}>
          View
        </button>
        <button class="url-btn danger" @click=${n=>{n.stopPropagation(),i.removeUrl(e.url)}}>
          ✕
        </button>
      </div>
    </div>
  `}const Ji={symbols:{type:"symbols",icon:"📦",label:"Symbols",renderItem:null},files:{type:"files",icon:"📄",label:"Files",renderItem:Ki},urls:{type:"urls",icon:"🔗",label:"URLs",renderItem:Qi}};function en(i,e,t){return d`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">💬</span>
        <span class="content-label">History (${t.count} messages)</span>
        <span class="content-tokens">${C(t.tokens)}</span>
      </div>
      ${t.needs_summary?d`
        <div class="history-warning">
          ⚠️ Exceeds budget (${C(t.tokens)} / ${C(t.max_tokens)})
        </div>
      `:""}
    </div>
  `}function tn(i,e){return d`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">⚙️</span>
        <span class="content-label">System Prompt</span>
        <span class="content-tokens">${C(e.tokens)}</span>
      </div>
    </div>
  `}function sn(i,e){return d`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">📖</span>
        <span class="content-label">Legend</span>
        <span class="content-tokens">${C(e.tokens)}</span>
      </div>
    </div>
  `}function nn(i,e){const t=i.expandedTiers[e.tier],s=e.tokens===0,n=i.getTierColor(e.tier);return i.searchQuery&&!i.tierHasMatches(e)?"":d`
    <div class="tier-block ${s?"empty":""}" style="--tier-color: ${n}">
      <div class="tier-header" @click=${()=>i.toggleTier(e.tier)}>
        <span class="tier-expand">${t?"▼":"▶"}</span>
        <span class="tier-name">
          <span class="tier-label">${e.tier}</span>
          <span class="tier-desc">· ${e.name}${s?" (empty)":""}</span>
        </span>
        <span class="tier-tokens">${C(e.tokens)}</span>
        <span class="tier-cached">${e.cached?"🔒":""}</span>
      </div>
      
      ${t&&e.threshold?d`
        <div class="tier-threshold">
          Threshold: ${e.threshold}+ responses unchanged
        </div>
      `:""}
      
      ${t&&e.contents?.length?d`
        <div class="tier-contents">
          ${e.contents.map(r=>{switch(r.type){case"system":return tn(i,r);case"legend":return sn(i,r);case"symbols":case"files":case"urls":return Yi(i,e.tier,r,Ji[r.type]);case"history":return en(i,e.tier,r);default:return""}})}
        </div>
      `:""}
    </div>
  `}function rn(i){return i.recentChanges?.length?d`
    <div class="recent-changes">
      <div class="recent-changes-title">Recent Changes</div>
      ${i.recentChanges.map(e=>d`
        <div class="change-row">
          <span class="change-icon">${e.type==="promotion"?"📈":"📉"}</span>
          <span class="change-item">${ot(e.item)}</span>
        </div>
      `)}
    </div>
  `:""}function on(i){const e=i.breakdown?.session_totals;return e?d`
    <div class="session-totals">
      <div class="session-title">Session Totals</div>
      <div class="session-row">
        <span class="session-label">Tokens In:</span>
        <span class="session-value">${C(e.prompt_tokens)}</span>
      </div>
      <div class="session-row">
        <span class="session-label">Tokens Out:</span>
        <span class="session-value">${C(e.completion_tokens)}</span>
      </div>
      <div class="session-row total">
        <span class="session-label">Total:</span>
        <span class="session-value">${C(e.total_tokens)}</span>
      </div>
      ${e.cache_hit_tokens?d`
        <div class="session-row cache">
          <span class="session-label">Cache Reads:</span>
          <span class="session-value">${C(e.cache_hit_tokens)}</span>
        </div>
      `:""}
      ${e.cache_write_tokens?d`
        <div class="session-row cache">
          <span class="session-label">Cache Writes:</span>
          <span class="session-value">${C(e.cache_write_tokens)}</span>
        </div>
      `:""}
    </div>
  `:""}function Ut(i){return d`
    <div class="cache-footer">
      <span class="model-info">Model: ${i.breakdown?.model||"unknown"}</span>
      <div class="footer-actions">
        <button 
          class="action-btn"
          @click=${()=>i.viewSymbolMap()}
          ?disabled=${i.isLoadingSymbolMap}
        >
          ${i.isLoadingSymbolMap?"⏳":"🗺️"} Symbol Map
        </button>
        <button 
          class="action-btn"
          @click=${()=>i.refreshBreakdown()}
          ?disabled=${i.isLoading}
        >
          ${i.isLoading?"...":"↻"} Refresh
        </button>
      </div>
    </div>
  `}function an(i){if(i.isLoading&&!i.breakdown)return d`<div class="loading">Loading cache breakdown...</div>`;if(i.error)return d`<div class="error">Error: ${i.error}</div>`;if(!i.breakdown)return d`<div class="loading">No breakdown data available</div>`;const e=i.breakdown.blocks||[];if(e.length===0)return d`
      <div class="cache-container">
        ${zt(i)}
        ${Lt(i)}
        <div class="loading">No cache blocks available. Send a message to populate cache tiers.</div>
        ${Ut(i)}
      </div>
    `;const t=!i.searchQuery||e.some(s=>i.tierHasMatches(s));return d`
    <div class="cache-container">
      ${zt(i)}
      ${Lt(i)}
      ${rn(i)}
      
      ${t?e.map(s=>nn(i,s)):d`<div class="no-results">No items match "${i.searchQuery}"</div>`}
      
      ${Ut(i)}
      ${on(i)}
    </div>
    
    <url-content-modal
      ?open=${i.showUrlModal}
      .url=${i.selectedUrl}
      .content=${i.urlContent}
      @close=${()=>i.closeUrlModal()}
    ></url-content-modal>
    
    <symbol-map-modal
      ?open=${i.showSymbolMapModal}
      .content=${i.symbolMapContent}
      .isLoading=${i.isLoadingSymbolMap}
      @close=${()=>i.closeSymbolMapModal()}
    ></symbol-map-modal>
  `}const ln={L0:"#4ade80",L1:"#2dd4bf",L2:"#60a5fa",L3:"#fbbf24",active:"#fb923c"};function hs(i){return ln[i]||"#888"}class cn extends ge(z){static properties={visible:{type:Boolean},breakdown:{type:Object},isLoading:{type:Boolean},error:{type:String},expandedTiers:{type:Object},expandedGroups:{type:Object},recentChanges:{type:Array},selectedUrl:{type:String},showUrlModal:{type:Boolean},urlContent:{type:Object},showSymbolMapModal:{type:Boolean},symbolMapContent:{type:String},isLoadingSymbolMap:{type:Boolean},selectedFiles:{type:Array},fetchedUrls:{type:Array},excludedUrls:{type:Object},searchQuery:{type:String}};static styles=Gi;constructor(){super(),this.visible=!0,this.breakdown=null,this.isLoading=!1,this.error=null,this.expandedTiers={L0:!0,L1:!1,L2:!1,L3:!1,active:!0},this.expandedGroups={},this.recentChanges=[],this.selectedUrl=null,this.showUrlModal=!1,this.urlContent=null,this.showSymbolMapModal=!1,this.symbolMapContent=null,this.isLoadingSymbolMap=!1,this.selectedFiles=[],this.fetchedUrls=[],this.excludedUrls=new Set,this.searchQuery=""}onRpcReady(){this.refreshBreakdown()}getIncludedUrls(){return this.fetchedUrls?this.fetchedUrls.filter(e=>!this.excludedUrls.has(e)):[]}async refreshBreakdown(){if(!this.rpcCall)return;const e=await this._rpcWithState("LiteLLM.get_context_breakdown",{},this.selectedFiles||[],this.getIncludedUrls());e&&((e.promotions?.length||e.demotions?.length)&&this._addRecentChanges(e.promotions,e.demotions),this.breakdown=e)}_addRecentChanges(e=[],t=[]){const s=Date.now(),n=[...e.map(o=>({item:o,type:"promotion",time:s})),...t.map(o=>({item:o,type:"demotion",time:s}))],r=s-3e4;this.recentChanges=[...n,...this.recentChanges.filter(o=>o.time>r)].slice(0,10)}willUpdate(e){(e.has("selectedFiles")||e.has("fetchedUrls")||e.has("excludedUrls"))&&this.rpcCall&&this.refreshBreakdown()}toggleTier(e){this.expandedTiers={...this.expandedTiers,[e]:!this.expandedTiers[e]}}toggleGroup(e,t){const s=`${e}-${t}`;this.expandedGroups={...this.expandedGroups,[s]:!this.expandedGroups[s]}}isGroupExpanded(e,t){return this.expandedGroups[`${e}-${t}`]||!1}async viewUrl(e){if(this.rpcCall){this.selectedUrl=e,this.showUrlModal=!0,this.urlContent=null;try{const t=await this._rpc("LiteLLM.get_url_content",e);this.urlContent=extractResponse(t)}catch(t){this.urlContent={error:t.message}}}}closeUrlModal(){this.showUrlModal=!1,this.selectedUrl=null,this.urlContent=null}toggleUrlIncluded(e){const t=new Set(this.excludedUrls);t.has(e)?t.delete(e):t.add(e),this.excludedUrls=t,this.dispatchEvent(new CustomEvent("url-inclusion-changed",{detail:{url:e,included:!t.has(e),includedUrls:this.getIncludedUrls()},bubbles:!0,composed:!0})),this.refreshBreakdown()}isUrlIncluded(e){return!this.excludedUrls.has(e)}removeUrl(e){if(this.excludedUrls.has(e)){const t=new Set(this.excludedUrls);t.delete(e),this.excludedUrls=t}this.dispatchEvent(new CustomEvent("remove-url",{detail:{url:e},bubbles:!0,composed:!0}))}async viewSymbolMap(){if(this.rpcCall){this.isLoadingSymbolMap=!0,this.showSymbolMapModal=!0,this.symbolMapContent=null;try{const e=await this._rpc("LiteLLM.get_context_map",null,!0);this.symbolMapContent=extractResponse(e)}catch(e){this.symbolMapContent=`Error loading symbol map: ${e.message}`}finally{this.isLoadingSymbolMap=!1}}}closeSymbolMapModal(){this.showSymbolMapModal=!1,this.symbolMapContent=null}viewFile(e){const t=e.startsWith("symbol:")?e.slice(7):e;this.dispatchEvent(new CustomEvent("file-selected",{detail:{path:t},bubbles:!0,composed:!0}))}getCacheHitPercent(){if(!this.breakdown)return 0;const e=this.breakdown.cache_hit_rate||0;return Math.round(e*100)}getTotalTokens(){return this.breakdown&&this.breakdown.total_tokens||0}getCachedTokens(){return this.breakdown&&this.breakdown.cached_tokens||0}getUsagePercent(){if(!this.breakdown)return 0;const{total_tokens:e,max_input_tokens:t}=this.breakdown;return t?Math.min(100,Math.round(e/t*100)):0}getTierColor(e){return hs(e)}handleSearchInput(e){this.searchQuery=e.target.value}clearSearch(){this.searchQuery=""}fuzzyMatch(e,t){if(!e)return!0;e=e.toLowerCase(),t=t.toLowerCase();let s=0;for(let n=0;n<t.length&&s<e.length;n++)t[n]===e[s]&&s++;return s===e.length}filterItems(e,t){return!this.searchQuery||!e?e:e.filter(s=>{const n=t==="urls"?s.title||s.url||"":s.path||"";return this.fuzzyMatch(this.searchQuery,n)})}tierHasMatches(e){return this.searchQuery?e.contents?e.contents.some(t=>{if(!t.items)return!1;const s=this.filterItems(t.items,t.type);return s&&s.length>0}):!1:!0}render(){return an(this)}}customElements.define("cache-viewer",cn);function dn(i){const e=i.tier_info;if(!e)return"";const t=["L0","L1","L2","L3","active"],s=i.prompt_tokens||0,n=i.cache_hit_tokens||0,r=s>0?Math.round(n/s*100):0,o=t.map(a=>{const l=e[a];if(!l||l.tokens===0&&a!=="L0")return null;const c=l.tokens||0,h=l.symbols||0,g=l.files||0,f=a!=="active",x=[];a==="L0"&&(l.has_system&&x.push("sys"),l.has_legend&&x.push("legend")),h>0&&x.push(`${h}sym`),g>0&&x.push(`${g}f`),l.has_urls&&x.push("urls"),l.has_history&&x.push("hist");const E=x.length>0?x.join("+"):"—",w=a==="active"?"active":`${a}`;return d`
      <div class="hud-tier-row" style="--tier-color: ${hs(a)}">
        <span class="hud-tier-label">${w}</span>
        <span class="hud-tier-contents">${E}</span>
        <span class="hud-tier-tokens">${C(c)}</span>
        ${f?d`<span class="hud-tier-cached">●</span>`:d`<span class="hud-tier-uncached">○</span>`}
      </div>
    `}).filter(a=>a!==null);return d`
    <div class="hud-divider"></div>
    <div class="hud-section-title">Cache Tiers</div>
    <div class="hud-cache-header">
      <span class="hud-cache-percent" style="--cache-percent-color: ${r>50?"#7ec699":r>20?"#f0a500":"#e94560"}">
        ${r}% cache hit
      </span>
    </div>
    <div class="hud-tier-list">
      ${o}
    </div>
  `}function hn(i){if(!i.tier_info)return"";const t=i.promotions||[],s=i.demotions||[];if(t.length===0&&s.length===0)return"";const n=r=>{const o=r.replace("symbol:","📦 "),a=o.split("/");return a.length>2?"..."+a.slice(-2).join("/"):o};return d`
    <div class="hud-divider"></div>
    <div class="hud-section-title">Tier Changes</div>
    ${t.length>0?d`
      <div class="hud-row promotion">
        <span class="hud-label">📈</span>
        <span class="hud-value hud-changes">${t.slice(0,3).map(r=>n(r[0])).join(", ")}${t.length>3?` +${t.length-3}`:""}</span>
      </div>
    `:""}
    ${s.length>0?d`
      <div class="hud-row demotion">
        <span class="hud-label">📉</span>
        <span class="hud-value hud-changes">${s.slice(0,3).map(r=>n(r[0])).join(", ")}${s.length>3?` +${s.length-3}`:""}</span>
      </div>
    `:""}
  `}function un(i){if(!i._hudVisible||!i._hudData)return"";const e=i._hudData,t=e.prompt_tokens||0,s=e.cache_hit_tokens||0,n=t>0?Math.round(s/t*100):0;return d`
    <div class="token-hud ${i._hudVisible?"visible":""}"
         @mouseenter=${()=>i._onHudMouseEnter()}
         @mouseleave=${()=>i._onHudMouseLeave()}>
      <div class="hud-header">
        <div class="hud-title">📊 Tokens</div>
        ${s>0?d`
          <div class="hud-cache-badge" style="--cache-color: ${n>50?"#7ec699":n>20?"#f0a500":"#e94560"}">
            ${n}% cached
          </div>
        `:""}
      </div>
      ${e.system_tokens!==void 0?d`
        <div class="hud-section-title">Context Breakdown</div>
        <div class="hud-row">
          <span class="hud-label">System:</span>
          <span class="hud-value">${C(e.system_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Symbol Map:</span>
          <span class="hud-value">${C(e.symbol_map_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Files:</span>
          <span class="hud-value">${C(e.file_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">History:</span>
          <span class="hud-value">${C(e.history_tokens)}</span>
        </div>
        <div class="hud-row total">
          <span class="hud-label">Context:</span>
          <span class="hud-value">${C(e.context_total_tokens)} / ${C(e.max_input_tokens)}</span>
        </div>
      `:""}
      ${dn(e)}
      <div class="hud-divider"></div>
      <div class="hud-section-title">This Request</div>
      <div class="hud-row">
        <span class="hud-label">Prompt:</span>
        <span class="hud-value">${C(e.prompt_tokens)}</span>
      </div>
      <div class="hud-row">
        <span class="hud-label">Response:</span>
        <span class="hud-value">${C(e.completion_tokens)}</span>
      </div>
      <div class="hud-row total">
        <span class="hud-label">Total:</span>
        <span class="hud-value">${C(e.total_tokens)}</span>
      </div>
      ${e.cache_hit_tokens?d`
        <div class="hud-row cache">
          <span class="hud-label">Cache hit:</span>
          <span class="hud-value">${C(e.cache_hit_tokens)} (${n}%)</span>
        </div>
      `:""}
      ${e.cache_write_tokens?d`
        <div class="hud-row cache-write">
          <span class="hud-label">Cache write:</span>
          <span class="hud-value">${C(e.cache_write_tokens)}</span>
        </div>
      `:""}
      ${e.history_tokens!==void 0?d`
        <div class="hud-divider"></div>
        <div class="hud-row history ${e.history_tokens>e.history_threshold*.95?"critical":e.history_tokens>e.history_threshold*.8?"warning":""}">
          <span class="hud-label">History:</span>
          <span class="hud-value">${C(e.history_tokens)} / ${C(e.history_threshold)}</span>
        </div>
      `:""}
      ${hn(e)}
      ${e.session_total_tokens?d`
        <div class="hud-divider"></div>
        <div class="hud-section-title">Session Total</div>
        <div class="hud-row cumulative">
          <span class="hud-label">In:</span>
          <span class="hud-value">${C(e.session_prompt_tokens)}</span>
        </div>
        <div class="hud-row cumulative">
          <span class="hud-label">Out:</span>
          <span class="hud-value">${C(e.session_completion_tokens)}</span>
        </div>
        <div class="hud-row cumulative total">
          <span class="hud-label">Total:</span>
          <span class="hud-value">${C(e.session_total_tokens)}</span>
        </div>
      `:""}
    </div>
  `}function pn(i){const e=i.detectedUrls?.length>0,t=Object.keys(i.fetchedUrls||{}).length>0,s=Object.keys(i.fetchingUrls||{}).length>0;return!e&&!t&&!s?"":d`
    <div class="url-chips-area">
      ${t?d`
        <div class="url-chips-row fetched">
          ${Object.values(i.fetchedUrls).map(n=>{const r=!i.excludedUrls?.has(n.url),o=n.error?"error":r?"success":"excluded";return d`
              <div class="url-chip fetched ${o}" 
                   title=${n.error?n.error:n.summary||n.readme||"No summary available"}>
                ${n.error?d`
                  <span class="url-chip-icon">❌</span>
                `:d`
                  <input 
                    type="checkbox" 
                    class="url-chip-checkbox"
                    .checked=${r}
                    @change=${()=>i.toggleUrlIncluded(n.url)}
                    title="${r?"Click to exclude from context":"Click to include in context"}"
                  />
                `}
                <span class="url-chip-label" 
                      @click=${()=>i.viewUrlContent(n)}
                      style="cursor: pointer;">
                  ${n.title||i.getUrlDisplayName({url:n.url})}
                </span>
                <button class="url-chip-remove" @click=${()=>i.removeFetchedUrl(n.url)} title="Remove">×</button>
              </div>
            `})}
        </div>
      `:""}
      ${e||s?d`
        <div class="url-chips-row detected">
          ${(i.detectedUrls||[]).map(n=>d`
            <div class="url-chip detected">
              <span class="url-chip-type">${i.getUrlTypeLabel(n.type)}</span>
              <span class="url-chip-label" title=${n.url}>
                ${i.getUrlDisplayName(n)}
              </span>
              ${i.fetchingUrls?.[n.url]?d`<span class="url-chip-loading">⏳</span>`:d`
                    <button class="url-chip-fetch" @click=${()=>i.fetchUrl(n)} title="Fetch content">
                      📥
                    </button>
                    <button class="url-chip-dismiss" @click=${()=>i.dismissUrl(n.url)} title="Dismiss">×</button>
                  `}
            </div>
          `)}
          ${Object.entries(i.fetchingUrls||{}).filter(([n])=>!(i.detectedUrls||[]).some(r=>r.url===n)).map(([n])=>d`
            <div class="url-chip fetching">
              <span class="url-chip-loading">⏳</span>
              <span class="url-chip-label">Fetching...</span>
            </div>
          `)}
        </div>
      `:""}
    </div>
  `}function fn(i){return i.minimized?"":d`
    <div class="resize-handle resize-handle-n" @mousedown=${e=>i._handleResizeStart(e,"n")}></div>
    <div class="resize-handle resize-handle-s" @mousedown=${e=>i._handleResizeStart(e,"s")}></div>
    <div class="resize-handle resize-handle-e" @mousedown=${e=>i._handleResizeStart(e,"e")}></div>
    <div class="resize-handle resize-handle-w" @mousedown=${e=>i._handleResizeStart(e,"w")}></div>
    <div class="resize-handle resize-handle-ne" @mousedown=${e=>i._handleResizeStart(e,"ne")}></div>
    <div class="resize-handle resize-handle-nw" @mousedown=${e=>i._handleResizeStart(e,"nw")}></div>
    <div class="resize-handle resize-handle-se" @mousedown=${e=>i._handleResizeStart(e,"se")}></div>
    <div class="resize-handle resize-handle-sw" @mousedown=${e=>i._handleResizeStart(e,"sw")}></div>
  `}function It(i){return i.minimized?"":d`
    <div class="panel-resizer">
      <div class="panel-resizer-handle" @mousedown=${e=>i._handlePanelResizeStart(e)}></div>
      <button class="panel-collapse-btn" @click=${()=>i.toggleLeftPanel()} title="${i.leftPanelCollapsed?"Expand panel":"Collapse panel"}">
        ${i.leftPanelCollapsed?"▶":"◀"}
      </button>
    </div>
  `}function gn(i){return!i.promptSnippets||i.promptSnippets.length===0?"":d`
    <div class="snippet-drawer ${i.snippetDrawerOpen?"open":""}">
      <button 
        class="snippet-drawer-toggle ${i.snippetDrawerOpen?"open":""}" 
        @click=${()=>i.toggleSnippetDrawer()}
        title="${i.snippetDrawerOpen?"Close snippets":"Open snippets"}"
      >📋</button>
      <div class="snippet-drawer-content">
        ${i.promptSnippets.map(e=>d`
          <button 
            class="snippet-btn" 
            @click=${()=>i.appendSnippet(e.message)}
            title="${e.tooltip}"
          >${e.icon}</button>
        `)}
      </div>
    </div>
  `}function mn(i){const e=i._hudData?.history_tokens||0,t=i._hudData?.history_threshold||9e3;if(t<=0)return"";const s=Math.min(100,e/t*100),n=s>95?"critical":s>80?"warning":"";return d`
    <div class="history-bar ${n}" title="History: ${C(e)} / ${C(t)} (${Math.round(s)}%)">
      <div class="history-bar-fill" style="width: ${s}%"></div>
    </div>
  `}function bn(i){const e=i.dialogX!==null&&i.dialogY!==null,t=e?`left: ${i.dialogX}px; top: ${i.dialogY}px;`:"",s=i.getResizeStyle?i.getResizeStyle():"",n=[t,s].filter(Boolean).join("; ");return d`
    ${un(i)}
    <history-browser
      .visible=${i.showHistoryBrowser}
      @copy-to-prompt=${r=>i.handleHistoryCopyToPrompt(r)}
      @load-session=${r=>i.handleLoadSession(r)}
    ></history-browser>
    <div class="dialog ${i.minimized?"minimized":""} ${i.showFilePicker?"with-picker":""} ${e?"dragged":""}"
         style=${n}>
      ${fn(i)}
      <div class="header" @mousedown=${r=>i._handleDragStart(r)}>
        <div class="header-section header-left" @click=${i.toggleMinimize}>
          <span>${i.activeLeftTab==="files"?"💬 Chat":i.activeLeftTab==="search"?"🔍 Search":i.activeLeftTab==="context"?"📊 Context":i.activeLeftTab==="cache"?"🗄️ Cache":"⚙️ Settings"}</span>
        </div>
        <div class="header-section header-tabs">
          <button 
            class="header-tab ${i.activeLeftTab==="files"?"active":""}"
            @click=${r=>{r.stopPropagation(),i.switchTab("files")}}
            title="Files & Chat"
          >📁</button>
          <button 
            class="header-tab ${i.activeLeftTab==="search"?"active":""}"
            @click=${r=>{r.stopPropagation(),i.switchTab("search")}}
            title="Search"
          >🔍</button>
          <button 
            class="header-tab ${i.activeLeftTab==="context"?"active":""}"
            @click=${r=>{r.stopPropagation(),i.switchTab("context")}}
            title="Context Budget"
          >📊</button>
          <button 
            class="header-tab ${i.activeLeftTab==="cache"?"active":""}"
            @click=${r=>{r.stopPropagation(),i.switchTab("cache")}}
            title="Cache Tiers"
          >🗄️</button>
          <button 
            class="header-tab ${i.activeLeftTab==="settings"?"active":""}"
            @click=${r=>{r.stopPropagation(),i.switchTab("settings")}}
            title="Settings"
          >⚙️</button>
        </div>
        <div class="header-section header-git">
          ${!i.minimized&&i.activeLeftTab==="files"?d`
            <button class="header-btn" @click=${i.copyGitDiff} title="Copy git diff HEAD to clipboard">
              📋
            </button>
            <button class="header-btn commit-btn" @click=${i.handleCommit} title="Generate commit message and commit">
              💾
            </button>
            <button class="header-btn reset-btn" @click=${i.handleResetHard} title="Reset to HEAD (discard all changes)">
              ⚠️
            </button>
          `:""}
        </div>
        <div class="header-section header-right">
          ${!i.minimized&&i.activeLeftTab==="files"?d`
            <button class="header-btn" @click=${i.toggleHistoryBrowser} title="View conversation history">
              📜
            </button>
            <button class="header-btn" @click=${i.clearContext} title="Clear conversation context">
              🗑️
            </button>
          `:""}
          <button class="header-btn" @click=${i.toggleMinimize}>${i.minimized?"▲":"▼"}</button>
        </div>
      </div>
      ${i.minimized?"":d`
        <div class="main-content">
          ${i.activeLeftTab==="files"?d`
            ${i.showFilePicker&&!i.leftPanelCollapsed?d`
              <div class="picker-panel" style="width: ${i.leftPanelWidth}px">
                <file-picker
                  .tree=${i.fileTree}
                  .modified=${i.modifiedFiles}
                  .staged=${i.stagedFiles}
                  .untracked=${i.untrackedFiles}
                  .diffStats=${i.diffStats}
                  .viewingFile=${i.viewingFile}
                  .selected=${i._getSelectedObject()}
                  .expanded=${i.filePickerExpanded}
                  @selection-change=${i.handleSelectionChange}
                  @expanded-change=${i.handleExpandedChange}
                  @file-view=${i.handleFileView}
                  @copy-path-to-prompt=${i.handleCopyPathToPrompt}
                ></file-picker>
              </div>
              ${It(i)}
            `:i.showFilePicker&&i.leftPanelCollapsed?d`
              ${It(i)}
            `:""}
            <div class="chat-panel">
              <div class="messages-wrapper">
                <div class="messages" id="messages-container" @copy-to-prompt=${r=>i.handleCopyToPrompt(r)} @file-mention-click=${r=>i.handleFileMentionClick(r)} @wheel=${r=>i.handleWheel(r)}>
                  ${ci(i.messageHistory,r=>r.id,r=>{if(r.role==="user")return d`<user-card .content=${r.content} .images=${r.images||[]}></user-card>`;if(r.role==="assistant")return d`<assistant-card .content=${r.content} .mentionedFiles=${i.getAddableFiles()} .selectedFiles=${i.selectedFiles} .editResults=${r.editResults||[]}></assistant-card>`})}
                </div>
                ${i._showScrollButton?d`
                  <button class="scroll-to-bottom-btn" @click=${()=>i.scrollToBottomNow()} title="Scroll to bottom">
                    ↓
                  </button>
                `:""}
              </div>
              ${i.pastedImages.length>0?d`
                <div class="image-preview-area">
                  ${i.pastedImages.map((r,o)=>d`
                    <div class="image-preview">
                      <img src=${r.preview} alt=${r.name}>
                      <button class="remove-image" @click=${()=>i.removeImage(o)}>×</button>
                    </div>
                  `)}
                  <button class="clear-images" @click=${()=>i.clearImages()}>Clear all</button>
                </div>
              `:""}
              ${pn(i)}
              <div class="input-area">
                <div class="input-buttons-stack">
                  <speech-to-text @transcript=${r=>i.handleSpeechTranscript(r)}></speech-to-text>
                  ${gn(i)}
                </div>
                <textarea
                  placeholder="Type a message... (paste images with Ctrl+V)"
                  .value=${i.inputValue}
                  @input=${i.handleInput}
                  @keydown=${i.handleKeyDown}
                  ?disabled=${i.isStreaming}
                ></textarea>
                ${i.isStreaming?d`<button class="send-btn stop-btn" @click=${()=>i.stopStreaming()}>Stop</button>`:d`<button class="send-btn" @click=${i.sendMessage}>Send</button>`}
              </div>
            </div>
          `:i.activeLeftTab==="search"?d`
            <div class="embedded-panel">
              <find-in-files
                .rpcCall=${i.call}
                @result-selected=${r=>i.handleSearchResultSelected(r)}
                @file-selected=${r=>i.handleSearchFileSelected(r)}
              ></find-in-files>
            </div>
          `:i.activeLeftTab==="context"?d`
            <div class="embedded-panel">
              <context-viewer
                .rpcCall=${i.call}
                .selectedFiles=${i.selectedFiles||[]}
                .fetchedUrls=${Object.keys(i.fetchedUrls||{})}
                .excludedUrls=${i.excludedUrls}
                @remove-url=${r=>i.handleContextRemoveUrl(r)}
                @url-inclusion-changed=${r=>i.handleContextUrlInclusionChanged(r)}
              ></context-viewer>
            </div>
          `:i.activeLeftTab==="cache"?d`
            <div class="embedded-panel">
              <cache-viewer
                .rpcCall=${i.call}
                .selectedFiles=${i.selectedFiles||[]}
                .fetchedUrls=${Object.keys(i.fetchedUrls||{})}
                .excludedUrls=${i.excludedUrls}
                @remove-url=${r=>i.handleContextRemoveUrl(r)}
                @url-inclusion-changed=${r=>i.handleContextUrlInclusionChanged(r)}
                @file-selected=${r=>i.handleFileMentionClick(r)}
              ></cache-viewer>
            </div>
          `:d`
            <div class="embedded-panel">
              <settings-panel
                .rpcCall=${i.call}
                @config-edit-request=${r=>i.handleConfigEditRequest(r)}
              ></settings-panel>
            </div>
          `}
        </div>
      `}
      ${mn(i)}
    </div>
  `}const xn=i=>class extends i{connectedCallback(){super.connectedCallback(),this._boundHandleGitOperation=this.handleGitOperation.bind(this),this.addEventListener("git-operation",this._boundHandleGitOperation)}disconnectedCallback(){super.disconnectedCallback(),this.removeEventListener("git-operation",this._boundHandleGitOperation)}async handleGitOperation(e){const{operation:t,paths:s}=e.detail;try{switch(t){case"stage":await this.call["Repo.stage_files"](s);break;case"stage-dir":await this.call["Repo.stage_files"](s);break;case"unstage":await this.call["Repo.unstage_files"](s);break;case"discard":await this.call["Repo.discard_changes"](s);break;case"delete":await this.call["Repo.delete_file"](s[0]);break;case"create-file":await this.call["Repo.create_file"](s[0],"");break;case"create-dir":await this.call["Repo.create_directory"](s[0]);break;default:console.warn("Unknown git operation:",t);return}await this.loadFileTree()}catch(n){console.error(`Git operation "${t}" failed:`,n)}}async loadFileTree(){if(!this.call){console.warn("loadFileTree called but RPC not ready");return}try{const e=await this.call["Repo.get_file_tree"](),t=this.extractResponse(e);t&&!t.error&&(this.fileTree=t.tree,this.modifiedFiles=t.modified||[],this.stagedFiles=t.staged||[],this.untrackedFiles=t.untracked||[],this.diffStats=t.diffStats||{})}catch(e){console.error("Error loading file tree:",e)}}toggleFilePicker(){this.showFilePicker=!this.showFilePicker,this.showFilePicker&&!this.fileTree&&this.loadFileTree()}handleSelectionChange(e){this.selectedFiles=e.detail}handleCopyPathToPrompt(e){const{path:t}=e.detail;if(!t)return;const s=this.inputValue&&!this.inputValue.endsWith(" ")?" ":"";this.inputValue=this.inputValue+s+t+" ",this.updateComplete.then(()=>{const n=this.shadowRoot?.querySelector("textarea");n&&(n.focus(),n.selectionStart=n.selectionEnd=n.value.length)})}async handleFileView(e){const{path:t}=e.detail;try{const s=await this.call["Repo.get_file_content"](t,"working"),n=this.extractResponse(s);let r="";try{const l=await this.call["Repo.get_file_content"](t,"HEAD");r=this.extractResponse(l),typeof r!="string"&&(r="")}catch{r=""}const o=r==="",a=this.modifiedFiles.includes(t);this.dispatchEvent(new CustomEvent("edits-applied",{detail:{files:[{path:t,original:r,modified:typeof n=="string"?n:"",isNew:o&&!a}]},bubbles:!0,composed:!0}))}catch(s){console.error("Error viewing file:",s)}}_handleAtMention(e){const t=e.lastIndexOf("@");if(t!==-1){const s=e.substring(t+1),n=s.indexOf(" "),r=n===-1?s:s.substring(0,n);n===-1&&s.length>=0&&(this.showFilePicker=!0,this._setFilePickerFilter(r))}}_setFilePickerFilter(e){const t=this.shadowRoot?.querySelector("file-picker");t&&(t.filter=e)}handleFileMentionClick(e){const{path:t}=e.detail;if(!t)return;const s=this.shadowRoot?.querySelector("file-picker");if(s){const n={...s.selected},r=t.split("/").pop(),o=n[t];o?delete n[t]:n[t]=!0,s.selected=n,this.selectedFiles=Object.keys(n).filter(l=>n[l]),s.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}));const a="Do you want to see more files before you continue?";if(o){const l=this.inputValue.match(/^The files? (.+) added\. /);if(l){const c=l[1].split(", ").filter(h=>h!==r);c.length===0?this.inputValue="":c.length===1?this.inputValue=`The file ${c[0]} added. ${a}`:this.inputValue=`The files ${c.join(", ")} added. ${a}`}}else{const l=this.inputValue.match(/^The files? (.+) added\. /);l?this.inputValue=`The files ${l[1]}, ${r} added. ${a}`:this.inputValue.trim()===""?this.inputValue=`The file ${r} added. ${a}`:this.inputValue=this.inputValue.trimEnd()+` (added ${r}) `}this.updateComplete.then(()=>{const l=this.shadowRoot?.querySelector("textarea");l&&(l.focus(),l.selectionStart=l.selectionEnd=l.value.length)})}}getAddableFiles(){if(!this.fileTree)return[];const e=[],t=s=>{s.path&&e.push(s.path),s.children&&s.children.forEach(t)};return t(this.fileTree),e}},vn=i=>class extends i{async handleResetHard(){if(confirm(`⚠️ This will discard ALL uncommitted changes!

Are you sure you want to reset to HEAD?`))try{this.addMessage("assistant","🔄 Resetting repository to HEAD...");const e=await this.call["Repo.reset_hard"](),t=this.extractResponse(e);if(t&&t.error){this.addMessage("assistant",`Error resetting: ${t.error}`);return}this.addMessage("assistant","✅ Repository reset to HEAD. All uncommitted changes have been discarded."),await this.loadFileTree(),this.dispatchEvent(new CustomEvent("edits-applied",{detail:{files:[]},bubbles:!0,composed:!0}))}catch(e){console.error("Error during reset:",e),this.addMessage("assistant",`Error during reset: ${e.message}`)}}async clearContext(){try{const e=await this.call["LiteLLM.clear_history"]();this.extractResponse(e),this.messageHistory=[],this.showHistoryBrowser&&(this.showHistoryBrowser=!1),this.clearAllUrlState&&this.clearAllUrlState(),this._hudData||(this._hudData={}),this._hudData.history_tokens=0,this.requestUpdate(),this.addMessage("assistant","Context cleared. Starting fresh conversation.")}catch(e){console.error("Error clearing context:",e),this.addMessage("assistant",`Error clearing context: ${e.message}`)}}async showTokenReport(){try{const e=this.selectedFiles.length>0?this.selectedFiles:null,t=await this.call["LiteLLM.get_token_report"](e,null),s=this.extractResponse(t);this.addMessage("assistant","```\n"+s+"\n```")}catch(e){console.error("Error getting token report:",e),this.addMessage("assistant",`Error getting token report: ${e.message}`)}}async copyGitDiff(){try{const e=await this.call["Repo.get_unstaged_diff"](),t=await this.call["Repo.get_staged_diff"](),s=this.extractResponse(e)||"",n=this.extractResponse(t)||"";let r="";if(n&&typeof n=="string"&&(r+=n),s&&typeof s=="string"&&(r&&(r+=`
`),r+=s),!r.trim()){this.addMessage("assistant","No changes to copy (working tree is clean).");return}await navigator.clipboard.writeText(r),this.addMessage("assistant",`📋 Copied diff to clipboard (${r.split(`
`).length} lines)`)}catch(e){console.error("Error copying git diff:",e),this.addMessage("assistant",`Error copying diff: ${e.message}`)}}async handleCommit(){try{this.addMessage("assistant","📦 Staging all changes...");const e=await this.call["Repo.stage_all"](),t=this.extractResponse(e);if(t&&t.error){this.addMessage("assistant",`Error staging changes: ${t.error}`);return}const s=await this.call["Repo.get_staged_diff"](),n=this.extractResponse(s);if(!n||typeof n=="object"&&n.error){this.addMessage("assistant",`Error getting diff: ${n?.error||"No staged changes"}`);return}if(!n.trim()){this.addMessage("assistant","No changes to commit.");return}this.addMessage("assistant","🤖 Generating commit message...");const r=await this.call["LiteLLM.get_commit_message"](n),o=this.extractResponse(r);if(o&&o.error){this.addMessage("assistant",`Error generating commit message: ${o.error}`);return}const a=o.message;this.addMessage("assistant",`📝 Generated commit message:
\`\`\`
${a}
\`\`\`

Committing...`);const l=await this.call["Repo.commit"](a),c=this.extractResponse(l);if(c&&c.error){this.addMessage("assistant",`Error committing: ${c.error}`);return}this.addMessage("assistant",`✅ Committed successfully!

Commit: \`${c.short_hash}\`
Message: ${a.split(`
`)[0]}`),await this.loadFileTree()}catch(e){console.error("Error during commit:",e),this.addMessage("assistant",`Error during commit: ${e.message}`)}}async sendMessage(){if(!this.inputValue.trim()&&this.pastedImages.length===0)return;const e=this.inputValue,t=this.getImagesForSend(),s=this.pastedImages.length>0?[...this.pastedImages]:null,n=this.getFetchedUrlsForMessage?this.getFetchedUrlsForMessage():[];let r=this.inputValue;if(n.length>0){const a=n.map(l=>{const c=l.title||l.url,h=l.summary||l.content||"";return`## ${c}
Source: ${l.url}

${h}`}).join(`

---

`);r=`${this.inputValue}

---
**Referenced URL Content:**

${a}`}this.addMessage("user",e,s),this.inputValue="",this.pastedImages=[],this.clearUrlState&&this.clearUrlState();const o=this.shadowRoot?.querySelector("textarea");o&&(o.style.height="auto",o.style.overflowY="hidden");try{const a=this._generateRequestId();this._streamingRequests.set(a,{message:r}),this.isStreaming=!0;const l=await this.call["LiteLLM.chat_streaming"](a,r,this.selectedFiles.length>0?this.selectedFiles:null,t),c=this.extractResponse(l);if(c.error){this._streamingRequests.delete(a),this.isStreaming=!1;const h=this.messageHistory[this.messageHistory.length-1];h&&h.role==="assistant"&&(h.content=`Error: ${c.error}`,h.final=!0,this.messageHistory=[...this.messageHistory])}}catch(a){console.error("Error sending message:",a),this.addMessage("assistant",`Error: ${a.message}`)}}async _buildDiffFiles(e){const t=[],s=e.content||{};for(const n of e.passed){const[r,o,a]=n;let l="";try{if(o==="")l="";else{const h=s[r]||"";l=await this._getOriginalFileContent(r,h,o,a)}}catch(h){console.error("Error getting original content:",h),l=o}let c=s[r];if(!c)try{const h=await this.call["Repo.get_file_content"](r);c=this.extractResponse(h)}catch{c=a}t.push({path:r,original:l,modified:c,isNew:o===""})}return t}async _getOriginalFileContent(e,t,s,n){try{const r=await this.call["Repo.get_file_content"](e,"HEAD"),o=this.extractResponse(r);if(o&&typeof o=="string")return o}catch{}return s===""?"":s&&n&&t?t.replace(n,s):""}},yn=i=>class extends i{initInputHandler(){this._historyIndex=-1,this._inputDraft="",this._savedScrollRatio=1,this._savedWasAtBottom=!0,this._boundHandlePaste=this._handlePaste.bind(this),document.addEventListener("paste",this._boundHandlePaste)}destroyInputHandler(){document.removeEventListener("paste",this._boundHandlePaste)}_handlePaste(e){const t=e.clipboardData?.items;if(t){for(const s of t)if(s.type.startsWith("image/")){e.preventDefault();const n=s.getAsFile();n&&this.processImageFile(n);break}}}processImageFile(e){const t=new FileReader;t.onload=s=>{const n=s.target.result.split(",")[1],r=e.type;this.pastedImages=[...this.pastedImages,{data:n,mime_type:r,preview:s.target.result,name:e.name||`image-${Date.now()}.${r.split("/")[1]}`}]},t.readAsDataURL(e)}removeImage(e){this.pastedImages=this.pastedImages.filter((t,s)=>s!==e)}clearImages(){this.pastedImages=[]}getImagesForSend(){return this.pastedImages.length===0?null:this.pastedImages.map(e=>({data:e.data,mime_type:e.mime_type}))}_getUserMessageHistory(){return this.messageHistory.filter(e=>e.role==="user").map(e=>e.content)}_navigateHistory(e){const t=this._getUserMessageHistory();if(t.length===0)return!1;const s=this.shadowRoot?.querySelector("textarea");if(!s||e===1&&this._historyIndex===-1||e===-1&&this._historyIndex===t.length-1)return!1;if(this._historyIndex===-1&&e===-1&&(this._inputDraft=this.inputValue),this._historyIndex-=e,this._historyIndex===-1)this.inputValue=this._inputDraft;else{const n=t.length-1-this._historyIndex;this.inputValue=t[n]}return this.updateComplete.then(()=>{s&&(s.value=this.inputValue,this._autoResizeTextarea(s),s.selectionStart=s.selectionEnd=s.value.length)}),!0}_resetHistoryNavigation(){this._historyIndex=-1,this._inputDraft=""}_autoResizeTextarea(e){if(!e)return;const t=this.shadowRoot?.querySelector(".chat-panel"),s=t?t.clientHeight*.5:200;e.style.setProperty("--textarea-max-height",`${s}px`),e.style.height="auto";const n=Math.min(e.scrollHeight,s);e.style.height=`${n}px`,e.scrollHeight>s?e.style.overflowY="auto":e.style.overflowY="hidden"}handleCopyToPrompt(e){const{content:t}=e.detail;this.inputValue=t,this.updateComplete.then(()=>{const s=this.shadowRoot?.querySelector("textarea");s&&s.focus()})}handleKeyDown(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(),this.sendMessage(),this._resetHistoryNavigation();return}const t=e.target;e.key==="ArrowUp"&&t.selectionStart===0&&t.selectionEnd===0&&this._navigateHistory(-1)&&e.preventDefault(),e.key==="ArrowDown"&&t.selectionStart===t.value.length&&t.selectionEnd===t.value.length&&this._navigateHistory(1)&&e.preventDefault()}handleInput(e){this.inputValue=e.target.value,this._handleAtMention(e.target.value),this._autoResizeTextarea(e.target),this.detectUrlsInInput&&this.detectUrlsInInput(e.target.value)}handleSpeechTranscript(e){const{text:t}=e.detail;if(!t)return;const s=t,n=this.inputValue&&!this.inputValue.endsWith(" ")&&!this.inputValue.endsWith(`
`);this.inputValue=this.inputValue+(n?" ":"")+s,this.updateComplete.then(()=>{const r=this.shadowRoot?.querySelector("textarea");r&&(r.value=this.inputValue,this._autoResizeTextarea(r),r.selectionStart=r.selectionEnd=r.value.length,r.focus())}),this.detectUrlsInInput&&this.detectUrlsInInput(this.inputValue)}toggleMinimize(){const e=this.shadowRoot?.querySelector("#messages-container");if(this.minimized)this.minimized=!1,this.updateComplete.then(()=>{requestAnimationFrame(()=>{const t=this.shadowRoot?.querySelector("#messages-container");if(t)if(this._savedWasAtBottom)t.scrollTop=t.scrollHeight;else{const s=t.scrollHeight-t.clientHeight;t.scrollTop=s*this._savedScrollRatio}})});else{if(e){const t=e.scrollTop,s=e.scrollHeight,n=e.clientHeight,r=s-n,o=s-t-n;this._savedWasAtBottom=o<50,this._savedScrollRatio=r>0?t/r:1}this.minimized=!0}}},wn=i=>class extends i{initWindowControls(){this._isDragging=!1,this._didDrag=!1,this._dragStartX=0,this._dragStartY=0,this._dialogStartX=0,this._dialogStartY=0,this._isResizing=!1,this._resizeDirection=null,this._resizeStartX=0,this._resizeStartY=0,this._resizeStartWidth=0,this._resizeStartHeight=0,this._dialogWidth=null,this._dialogHeight=null,this._boundHandleMouseMove=this._handleMouseMove.bind(this),this._boundHandleMouseUp=this._handleMouseUp.bind(this),this._boundHandleResizeMove=this._handleResizeMove.bind(this),this._boundHandleResizeEnd=this._handleResizeEnd.bind(this)}_handleDragStart(e){e.button===0&&e.target.tagName!=="BUTTON"&&(this._isDragging=!0,this._didDrag=!1,this._dragStartX=e.clientX,this._dragStartY=e.clientY,this._dialogStartX=this.dialogX,this._dialogStartY=this.dialogY,document.addEventListener("mousemove",this._boundHandleMouseMove),document.addEventListener("mouseup",this._boundHandleMouseUp),e.preventDefault())}_handleMouseMove(e){if(!this._isDragging)return;const t=e.clientX-this._dragStartX,s=e.clientY-this._dragStartY;(Math.abs(t)>5||Math.abs(s)>5)&&(this._didDrag=!0),this._didDrag&&(this.dialogX=this._dialogStartX+t,this.dialogY=this._dialogStartY+s)}_handleMouseUp(){const e=this._isDragging,t=this._didDrag;this._isDragging=!1,document.removeEventListener("mousemove",this._boundHandleMouseMove),document.removeEventListener("mouseup",this._boundHandleMouseUp),e&&!t&&this.toggleMinimize()}_handleResizeStart(e,t){if(e.button!==0)return;e.preventDefault(),e.stopPropagation(),this._isResizing=!0,this._resizeDirection=t,this._resizeStartX=e.clientX,this._resizeStartY=e.clientY;const s=this.shadowRoot?.querySelector(".dialog");if(s){const n=s.getBoundingClientRect();this._resizeStartWidth=n.width,this._resizeStartHeight=n.height}document.addEventListener("mousemove",this._boundHandleResizeMove),document.addEventListener("mouseup",this._boundHandleResizeEnd)}_handleResizeMove(e){if(!this._isResizing)return;const t=e.clientX-this._resizeStartX,s=e.clientY-this._resizeStartY,n=this._resizeDirection;let r=this._resizeStartWidth,o=this._resizeStartHeight;n.includes("e")?r=Math.max(300,this._resizeStartWidth+t):n.includes("w")&&(r=Math.max(300,this._resizeStartWidth-t),this.dialogX!==null&&(this.dialogX=this.dialogX+(this._resizeStartWidth-r))),n.includes("s")?o=Math.max(200,this._resizeStartHeight+s):n.includes("n")&&(o=Math.max(200,this._resizeStartHeight-s),this.dialogY!==null&&(this.dialogY=this.dialogY+(this._resizeStartHeight-o))),this._dialogWidth=r,this._dialogHeight=o,this.requestUpdate()}_handleResizeEnd(){this._isResizing=!1,this._resizeDirection=null,document.removeEventListener("mousemove",this._boundHandleResizeMove),document.removeEventListener("mouseup",this._boundHandleResizeEnd)}getResizeStyle(){const e=[];return this._dialogWidth&&e.push(`width: ${this._dialogWidth}px`),this._dialogHeight&&e.push(`height: ${this._dialogHeight}px`),e.join("; ")}destroyWindowControls(){document.removeEventListener("mousemove",this._boundHandleMouseMove),document.removeEventListener("mouseup",this._boundHandleMouseUp),document.removeEventListener("mousemove",this._boundHandleResizeMove),document.removeEventListener("mouseup",this._boundHandleResizeEnd)}},_n=i=>class extends i{static get properties(){return{...super.properties,isStreaming:{type:Boolean},_hudVisible:{type:Boolean},_hudData:{type:Object}}}initStreaming(){this._streamingRequests=new Map,this.isStreaming=!1,this._hudVisible=!1,this._hudData=null,this._hudTimeout=null}streamChunk(e,t){this._streamingRequests.get(e)&&this.streamWrite(t,!1,"assistant")}async stopStreaming(){if(this._streamingRequests.size===0)return;const[e]=this._streamingRequests.keys();try{await this.call["LiteLLM.cancel_streaming"](e)}catch(t){console.error("Error cancelling stream:",t)}}compactionEvent(e,t){if(t.type==="compaction_start")this.addMessage("assistant",t.message),this.isStreaming=!0;else if(t.type==="compaction_complete"){const s=t.tokens_saved.toLocaleString(),n=t.tokens_before.toLocaleString(),r=t.tokens_after.toLocaleString();if(this._hudData&&(this._hudData={...this._hudData,history_tokens:t.tokens_after}),t.case==="none"){const l=this.messageHistory[this.messageHistory.length-1];l&&l.role==="assistant"&&l.content.includes("Compacting")&&(this.messageHistory=this.messageHistory.slice(0,-1));return}const o=[];let a;if(t.case==="summarize")a=`📋 **History Compacted**

${t.truncated_count} older messages were summarized to preserve context.

---
_${n} → ${r} tokens (saved ${s})_`;else if(t.case==="truncate_only"){const l=t.topic_detected?`

**Topic change detected:** ${t.topic_detected}`:"";a=`✂️ **History Truncated**

${t.truncated_count} older messages from previous topic removed.${l}

---
_${n} → ${r} tokens (saved ${s})_`}else a=`🗜️ **History Compacted** (${t.case})

${t.truncated_count} messages processed.

---
_${n} → ${r} tokens (saved ${s})_`;if(o.push({role:"assistant",content:a,final:!0,isCompactionNotice:!0}),t.compacted_messages&&t.compacted_messages.length>0)for(const l of t.compacted_messages)o.push({role:l.role,content:l.content,final:!0});this.messageHistory=o,this.isStreaming=!1,console.log(`📋 History compacted: ${t.case}, now showing ${o.length} messages`)}else if(t.type==="compaction_error"){const s=this.messageHistory[this.messageHistory.length-1];if(s&&s.role==="assistant"&&s.content.includes("Compacting")){const n=`⚠️ **Compaction Failed**

${t.error}

_Continuing without compaction..._`,r={...s,content:n,final:!0};this.messageHistory=[...this.messageHistory.slice(0,-1),r]}this.isStreaming=!1}}async streamComplete(e,t){if(!this._streamingRequests.get(e))return;this._streamingRequests.delete(e),this.isStreaming=!1;const n=this.messageHistory[this.messageHistory.length-1];if(t.error){const r=[...t.binary_files||[],...t.invalid_files||[]];if(r.length>0&&this.selectedFiles){const a=new Set(r);this.selectedFiles=this.selectedFiles.filter(c=>!a.has(c));const l=this.shadowRoot?.querySelector("file-picker");if(l&&l.selected){const c={...l.selected};for(const h of r)delete c[h];l.selected=c}}let o=`⚠️ **Error:** ${t.error}`;if(r.length>0&&(o+=`

*The file(s) have been deselected. You can send your message again.*`),n&&n.role==="assistant"){const a={...n,content:o,final:!0,editResults:[]};this.messageHistory=[...this.messageHistory.slice(0,-1),a]}else{this.addMessage("assistant",o);const a=this.messageHistory[this.messageHistory.length-1];a&&a.role==="assistant"&&(this.messageHistory=[...this.messageHistory.slice(0,-1),{...a,final:!0,editResults:[]}])}return}if(n&&n.role==="assistant"){const r=this._buildEditResults(t);let o=n.content;t.cancelled&&(o=o+`

*[stopped]*`);const a={...n,content:o,final:!0,editResults:r};this.messageHistory=[...this.messageHistory.slice(0,-1),a]}if(t.passed&&t.passed.length>0){await this.loadFileTree();const r=t.passed.map(o=>Array.isArray(o)?o[0]:o.file_path||o.path).filter(Boolean);r.length>0&&this.dispatchEvent(new CustomEvent("files-edited",{detail:{paths:r},bubbles:!0,composed:!0}))}t.token_usage&&this._showHud(t.token_usage),typeof this.loadPromptSnippets=="function"&&this.loadPromptSnippets(),setTimeout(()=>{const r=this.shadowRoot?.querySelector("textarea");r&&r.focus()},100)}_showHud(e){this._hudTimeout&&clearTimeout(this._hudTimeout),this._hudData=e,this._hudVisible=!0,this._hudHovered=!1,this._startHudTimeout()}_startHudTimeout(){this._hudTimeout&&clearTimeout(this._hudTimeout),this._hudTimeout=setTimeout(()=>{this._hudHovered||(this._hudVisible=!1)},8e3)}_onHudMouseEnter(){this._hudHovered=!0,this._hudTimeout&&(clearTimeout(this._hudTimeout),this._hudTimeout=null)}_onHudMouseLeave(){this._hudHovered=!1,this._hudTimeout=setTimeout(()=>{this._hudVisible=!1},2e3)}_buildEditResults(e){if(e.edit_results&&e.edit_results.length>0)return e.edit_results.map(s=>({file_path:s.file_path,status:s.status==="applied"?"applied":"failed",reason:s.reason||null,estimated_line:s.estimated_line||null}));const t=[];if(e.passed)for(const s of e.passed){const n=Array.isArray(s)?s[0]:s.file_path||s.path;t.push({file_path:n,status:"applied",reason:null,estimated_line:null})}if(e.failed)for(const s of e.failed){const n=Array.isArray(s)?s[0]:s.file_path||s.path,r=Array.isArray(s)?s[1]:s.reason||s.error;t.push({file_path:n,status:"failed",reason:r,estimated_line:null})}return t}_generateRequestId(){return`${Date.now()}-${Math.random().toString(36).substr(2,9)}`}};class kn{constructor(e,t){this._rpcCall=e,this._onStateChange=t,this._detectedUrls=[],this._fetchingUrls={},this._fetchedUrls={},this._excludedUrls=new Set,this._urlDetectDebounce=null}get detectedUrls(){return this._detectedUrls}get fetchingUrls(){return this._fetchingUrls}get fetchedUrls(){return this._fetchedUrls}get excludedUrls(){return this._excludedUrls}detectUrlsInInput(e){this._urlDetectDebounce&&clearTimeout(this._urlDetectDebounce),this._urlDetectDebounce=setTimeout(async()=>{await this._performUrlDetection(e)},300)}async _performUrlDetection(e){if(!this._rpcCall||!e){this._detectedUrls=[],this._notifyStateChange();return}try{const t=await this._rpcCall("LiteLLM.detect_urls",e);Array.isArray(t)?this._detectedUrls=t.filter(s=>!this._fetchedUrls[s.url]):this._detectedUrls=[]}catch(t){console.error("URL detection failed:",t),this._detectedUrls=[]}this._notifyStateChange()}async fetchUrl(e,t=""){const s=e.url;if(!this._fetchingUrls[s]){this._fetchingUrls={...this._fetchingUrls,[s]:!0},this._notifyStateChange();try{const n=await this._rpcCall("LiteLLM.fetch_url",s,!0,!0,null,t);this._fetchedUrls={...this._fetchedUrls,[s]:n},this._detectedUrls=this._detectedUrls.filter(r=>r.url!==s),n.error&&console.warn(`Failed to fetch ${s}:`,n.error)}catch(n){console.error("URL fetch failed:",n),this._fetchedUrls={...this._fetchedUrls,[s]:{url:s,error:n.message}}}finally{const{[s]:n,...r}=this._fetchingUrls;this._fetchingUrls=r,this._notifyStateChange()}}}toggleUrlIncluded(e){const t=new Set(this._excludedUrls);return t.has(e)?t.delete(e):t.add(e),this._excludedUrls=t,this._notifyStateChange(),!t.has(e)}removeFetchedUrl(e){const{[e]:t,...s}=this._fetchedUrls;if(this._fetchedUrls=s,this._excludedUrls.has(e)){const n=new Set(this._excludedUrls);n.delete(e),this._excludedUrls=n}this._notifyStateChange()}dismissUrl(e){this._detectedUrls=this._detectedUrls.filter(t=>t.url!==e),this._notifyStateChange()}clearState(){this._detectedUrls=[],this._fetchingUrls={},this._notifyStateChange()}clearAllState(){this._detectedUrls=[],this._fetchingUrls={},this._fetchedUrls={},this._excludedUrls=new Set,this._notifyStateChange()}getFetchedUrlsForMessage(){return Object.values(this._fetchedUrls).filter(e=>!e.error&&!this._excludedUrls.has(e.url))}getUrlTypeLabel(e){return{github_repo:"📦 GitHub Repo",github_file:"📄 GitHub File",github_issue:"🐛 Issue",github_pr:"🔀 PR",documentation:"📚 Docs",generic_web:"🌐 Web"}[e]||"🔗 URL"}getUrlDisplayName(e){if(e.github_info){const t=e.github_info;return t.path?`${t.owner}/${t.repo}/${t.path.split("/").pop()}`:`${t.owner}/${t.repo}`}try{const t=new URL(e.url),s=t.pathname;if(s&&s!=="/"){const n=s.split("/").filter(Boolean);return n.length>2?`${t.hostname}/.../${n.slice(-1)[0]}`:`${t.hostname}${s}`}return t.hostname}catch{return e.url.substring(0,40)}}_notifyStateChange(){this._onStateChange&&this._onStateChange({detectedUrls:this._detectedUrls,fetchingUrls:this._fetchingUrls,fetchedUrls:this._fetchedUrls,excludedUrls:this._excludedUrls})}}const $n=U`
  :host { display: flex; flex-direction: column; font-size: 13px; flex: 1; min-height: 0; overflow: hidden; }
  .container { background: #1a1a2e; flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .header { padding: 8px 12px; background: #0f3460; display: flex; gap: 8px; flex-shrink: 0; }
  input[type="text"] { flex: 1; padding: 6px 10px; border: none; border-radius: 4px; background: #16213e; color: #eee; }
  input[type="text"]:focus { outline: 1px solid #e94560; }
  .tree { flex: 1; overflow-y: auto; padding: 8px; min-height: 0; }
  .node { padding: 1px 0; }
  .row { 
    display: flex; 
    align-items: center; 
    gap: 6px; 
    padding: 3px 6px; 
    border-radius: 4px; 
    cursor: pointer; 
    line-height: 1;
  }
  .row:hover { background: #0f3460; }
  .row.viewing { 
    background: #1a3a6e; 
    border-left: 2px solid #e94560;
    padding-left: 4px;
  }
  .row.viewing:hover { background: #1f4080; }
  .children { margin-left: 18px; }
  .icon { 
    width: 14px; 
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: #666; 
    flex-shrink: 0;
  }
  .name { color: #888; flex: 1; }
  .name:hover { text-decoration: underline; }
  .name.clean { color: #888; }
  .name.modified { color: #e2c08d; }
  .name.staged { color: #73c991; }
  .name.untracked { color: #73c991; }
  .name.staged-modified { color: #73c991; }
  .status-indicator {
    font-size: 10px;
    font-weight: bold;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }
  .status-indicator.modified { color: #e2c08d; }
  .status-indicator.staged { color: #73c991; }
  .status-indicator.untracked { color: #73c991; }
  .status-indicator.staged-modified { color: #73c991; }
  input[type="checkbox"] { 
    margin: 0; 
    width: 14px; 
    height: 14px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .line-count {
    width: 32px;
    text-align: right;
    color: #555;
    font-size: 11px;
    margin-left: -40px;
    flex-shrink: 0;
  }
  .line-count.warning {
    color: #f0a500;
  }
  .line-count.danger {
    color: #e94560;
  }
  .diff-stats {
    display: flex;
    gap: 4px;
    margin-left: auto;
    font-size: 11px;
    font-family: monospace;
  }
  .diff-stats .additions {
    color: #7ec699;
  }
  .diff-stats .deletions {
    color: #e94560;
  }
  .hidden { display: none; }
  .actions { padding: 8px 12px; border-top: 1px solid #0f3460; display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  button { padding: 4px 10px; border: none; border-radius: 4px; background: #0f3460; color: #eee; cursor: pointer; }
  button:hover { background: #1a3a6e; }
  .count { margin-left: auto; color: #7ec699; font-size: 12px; }
  
  /* Context Menu */
  .context-menu {
    position: fixed;
    background: #1e1e2e;
    border: 1px solid #0f3460;
    border-radius: 6px;
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1000;
  }
  .context-menu-item {
    padding: 8px 12px;
    cursor: pointer;
    color: #ccc;
  }
  .context-menu-item:hover {
    background: #0f3460;
    color: #fff;
  }
  .context-menu-item.danger {
    color: #e94560;
  }
  .context-menu-item.danger:hover {
    background: #3d1a2a;
    color: #ff6b8a;
  }
`;function Sn(i){return d`
    <div class="container">
      <div class="header">
        <input 
          type="text" 
          placeholder="Filter files..." 
          .value=${i.filter} 
          @input=${e=>i.filter=e.target.value}
        >
      </div>
      <div class="tree">
        ${i.tree?i.renderNode(i.tree):d`<div style="color:#666;padding:20px;text-align:center;">Loading...</div>`}
      </div>
      <div class="actions">
        <button @click=${()=>i.selectAll()}>Select All</button>
        <button @click=${()=>i.clearAll()}>Clear</button>
        <span class="count">${i.selectedFiles.length} selected</span>
      </div>
    </div>
  `}const Cn=i=>class extends i{get selectedFiles(){return Object.keys(this.selected).filter(e=>this.selected[e])}toggleSelect(e,t){t.stopPropagation(),this.selected={...this.selected,[e]:!this.selected[e]},this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}collectFilesInDir(e,t=""){const s=[];if(e.path&&s.push(e.path),e.children)for(const n of e.children){const r=t?`${t}/${n.name}`:n.name;s.push(...this.collectFilesInDir(n,r))}return s}toggleSelectDir(e,t,s){s.stopPropagation();const n=this.collectFilesInDir(e,t),r=n.every(a=>this.selected[a]),o={...this.selected};for(const a of n)o[a]=!r;this.selected=o,this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}isDirFullySelected(e,t){const s=this.collectFilesInDir(e,t);return s.length===0?!1:s.every(n=>this.selected[n])}isDirPartiallySelected(e,t){const s=this.collectFilesInDir(e,t);if(s.length===0)return!1;const n=s.filter(r=>this.selected[r]).length;return n>0&&n<s.length}selectAll(){const e={},t=s=>{s.path&&(e[s.path]=!0),s.children?.forEach(t)};this.tree&&t(this.tree),this.selected=e,this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}clearAll(){this.selected={},this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}},En=i=>class extends i{matchesFilter(e,t){if(!t)return!0;const s=t.toLowerCase();return e.path?e.path.toLowerCase().includes(s):e.children?e.children.some(n=>this.matchesFilter(n,s)):!1}toggleExpand(e){const t={...this.expanded,[e]:!this.expanded[e]};this._updateExpanded?this._updateExpanded(t):this.expanded=t}viewFile(e,t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("file-view",{detail:{path:e},bubbles:!0,composed:!0}))}copyPathToPrompt(e,t){t.preventDefault(),t.stopPropagation(),this.dispatchEvent(new CustomEvent("copy-path-to-prompt",{detail:{path:e},bubbles:!0,composed:!0}))}getFileStatus(e){const t=this.modified.includes(e),s=this.staged.includes(e),n=this.untracked.includes(e);let r="clean",o="";return s&&t?(r="staged-modified",o="M"):s?(r="staged",o="A"):t?(r="modified",o="M"):n&&(r="untracked",o="U"),{statusClass:r,statusIndicator:o}}renderNode(e,t=""){const s=t?`${t}/${e.name}`:e.name,n=!!e.children;return this.matchesFilter(e,this.filter)?n?this.renderDirNode(e,s):this.renderFileNode(e):""}renderDirNode(e,t){const s=this.expanded[t]??!!this.filter,n=this.isDirFullySelected(e,t),r=this.isDirPartiallySelected(e,t);return d`
      <div class="node">
        <div class="row" 
             @contextmenu=${o=>this.handleContextMenu(o,t,"dir",e)}
             @auxclick=${o=>{o.button===1&&(o.preventDefault(),this.copyPathToPrompt(t,o))}}
             @mousedown=${o=>{o.button===1&&o.preventDefault()}}
             @mouseup=${o=>{o.button===1&&o.preventDefault()}}>
          <input 
            type="checkbox" 
            .checked=${n}
            .indeterminate=${r}
            @click=${o=>this.toggleSelectDir(e,t,o)}
          >
          <span class="icon" @click=${()=>this.toggleExpand(t)}>${s?"▾":"▸"}</span>
          <span class="name" @click=${()=>this.toggleExpand(t)}>${e.name}</span>
        </div>
        <div class="children ${s?"":"hidden"}">
          ${e.children.map(o=>this.renderNode(o,t))}
        </div>
      </div>
    `}getLineCountClass(e){return e>170?"danger":e>130?"warning":""}renderFileNode(e){const t=e.path,{statusClass:s,statusIndicator:n}=this.getFileStatus(t),r=e.lines||0,o=this.getLineCountClass(r),a=this.diffStats?.[t],l=this.viewingFile===t;return d`
      <div class="node">
        <div class="row ${l?"viewing":""}" @contextmenu=${c=>this.handleContextMenu(c,t,"file")}>
          <span class="line-count ${o}">${r}</span>
          <input 
            type="checkbox" 
            .checked=${!!this.selected[t]} 
            @click=${c=>this.toggleSelect(t,c)}
          >
          ${n?d`<span class="status-indicator ${s}">${n}</span>`:d`<span class="status-indicator"></span>`}
          <span class="name ${s}" 
                @click=${c=>this.viewFile(t,c)}
                @auxclick=${c=>{c.button===1&&(c.preventDefault(),this.copyPathToPrompt(t,c))}}
                @mousedown=${c=>{c.button===1&&c.preventDefault()}}
                @mouseup=${c=>{c.button===1&&c.preventDefault()}}>${e.name}</span>
          ${a?d`
            <span class="diff-stats">
              ${a.additions>0?d`<span class="additions">+${a.additions}</span>`:""}
              ${a.deletions>0?d`<span class="deletions">-${a.deletions}</span>`:""}
            </span>
          `:""}
        </div>
      </div>
    `}},Fn=i=>class extends i{static get properties(){return{...super.properties,_contextMenu:{type:Object,state:!0}}}constructor(){super(),this._contextMenu=null,this._boundCloseContextMenu=this._closeContextMenu.bind(this)}connectedCallback(){super.connectedCallback(),document.addEventListener("click",this._boundCloseContextMenu),document.addEventListener("contextmenu",this._boundCloseContextMenu)}disconnectedCallback(){super.disconnectedCallback(),document.removeEventListener("click",this._boundCloseContextMenu),document.removeEventListener("contextmenu",this._boundCloseContextMenu)}_closeContextMenu(){this._contextMenu&&(this._contextMenu=null)}handleContextMenu(e,t,s,n=null){e.preventDefault(),e.stopPropagation(),this._contextMenu={x:e.clientX,y:e.clientY,path:t,type:s,node:n}}_getFileMenuItems(e){const t=this.modified.includes(e),s=this.staged.includes(e),n=this.untracked.includes(e),r=[];return(t||n)&&r.push({label:"Stage file",action:()=>this._stageFile(e)}),s&&r.push({label:"Unstage file",action:()=>this._unstageFile(e)}),t&&r.push({label:"Discard changes",action:()=>this._discardChanges(e),danger:!0}),r.push({label:"Delete file",action:()=>this._deleteFile(e),danger:!0}),r}_getDirMenuItems(e,t){const s=[],n=this.collectFilesInDir(t,e),r=n.some(a=>this.modified.includes(a)||this.untracked.includes(a)),o=n.some(a=>this.staged.includes(a));return r&&s.push({label:"Stage all in directory",action:()=>this._stageDirectory(e)}),o&&s.push({label:"Unstage all in directory",action:()=>this._unstageDirectory(n)}),s.push({label:"New file...",action:()=>this._createNewFile(e)}),s.push({label:"New directory...",action:()=>this._createNewDirectory(e)}),s}async _stageFile(e){this._closeContextMenu(),this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"stage",paths:[e]},bubbles:!0,composed:!0}))}async _unstageFile(e){this._closeContextMenu(),this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"unstage",paths:[e]},bubbles:!0,composed:!0}))}async _discardChanges(e){this._closeContextMenu(),confirm(`Discard all changes to "${e}"?

This cannot be undone.`)&&this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"discard",paths:[e]},bubbles:!0,composed:!0}))}async _deleteFile(e){this._closeContextMenu(),confirm(`Delete "${e}"?

This cannot be undone.`)&&this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"delete",paths:[e]},bubbles:!0,composed:!0}))}async _stageDirectory(e){this._closeContextMenu(),this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"stage-dir",paths:[e]},bubbles:!0,composed:!0}))}async _unstageDirectory(e){this._closeContextMenu();const t=e.filter(s=>this.staged.includes(s));this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"unstage",paths:t},bubbles:!0,composed:!0}))}async _createNewFile(e){this._closeContextMenu();const t=prompt("Enter new file name:");if(!t)return;const s=this.tree?.name||"";let n=e;s&&e.startsWith(s+"/")?n=e.substring(s.length+1):e===s&&(n="");const r=n?`${n}/${t}`:t;this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"create-file",paths:[r]},bubbles:!0,composed:!0}))}async _createNewDirectory(e){this._closeContextMenu();const t=prompt("Enter new directory name:");if(!t)return;const s=this.tree?.name||"";let n=e;s&&e.startsWith(s+"/")?n=e.substring(s.length+1):e===s&&(n="");const r=n?`${n}/${t}`:t;this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"create-dir",paths:[r]},bubbles:!0,composed:!0}))}renderContextMenu(){if(!this._contextMenu)return"";const{x:e,y:t,path:s,type:n,node:r}=this._contextMenu,o=n==="file"?this._getFileMenuItems(s):this._getDirMenuItems(s,r);return o.length===0?"":d`
      <div class="context-menu" style="left: ${e}px; top: ${t}px;">
        ${o.map(a=>d`
          <div 
            class="context-menu-item ${a.danger?"danger":""}"
            @click=${a.action}
          >
            ${a.label}
          </div>
        `)}
      </div>
    `}},Tn=Fn(En(Cn(z)));class Rn extends Tn{static properties={tree:{type:Object},modified:{type:Array},staged:{type:Array},untracked:{type:Array},diffStats:{type:Object},selected:{type:Object},expanded:{type:Object},filter:{type:String},viewingFile:{type:String}};static styles=$n;constructor(){super(),this.tree=null,this.modified=[],this.staged=[],this.untracked=[],this.diffStats={},this.selected={},this.expanded={},this.filter="",this.viewingFile=null,this._expandedInitialized=!1,this._savedScrollTop=0}willUpdate(e){const t=Object.keys(this.expanded||{}).length>0;!this._expandedInitialized&&this.tree&&!t&&(this.modified.length>0||this.staged.length>0||this.untracked.length>0)&&(this._expandedInitialized=!0,this._expandChangedFileDirs(),this._autoSelectChangedFiles())}_autoSelectChangedFiles(){const e=[...this.modified,...this.staged,...this.untracked];if(e.length===0)return;const t={...this.selected};for(const s of e)t[s]=!0;this.selected=t,this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}disconnectedCallback(){super.disconnectedCallback?.();const e=this.shadowRoot?.querySelector(".tree");e&&(this._savedScrollTop=e.scrollTop)}updated(e){if(super.updated?.(e),this._savedScrollTop>0){const t=this.shadowRoot?.querySelector(".tree");t&&(t.scrollTop=this._savedScrollTop)}}getScrollTop(){return this.shadowRoot?.querySelector(".tree")?.scrollTop??0}setScrollTop(e){const t=this.shadowRoot?.querySelector(".tree");t&&e>=0&&(t.scrollTop=e)}_expandChangedFileDirs(){const e=[...this.modified,...this.staged,...this.untracked],t=new Set,s=this.tree?.name||"";s&&t.add(s);for(const r of e){const o=r.split("/");let a=s;for(let l=0;l<o.length-1;l++)a=a?`${a}/${o[l]}`:o[l],t.add(a)}const n={...this.expanded};for(const r of t)n[r]=!0;this._updateExpanded(n)}_updateExpanded(e){this.expanded=e,this.dispatchEvent(new CustomEvent("expanded-change",{detail:e}))}render(){return d`
      ${Sn(this)}
      ${this.renderContextMenu()}
    `}}customElements.define("file-picker",Rn);const An=U`
  :host {
    display: block;
  }

  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    background: #1a1a2e;
    border-radius: 12px;
    width: 90vw;
    max-width: 1000px;
    height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    border: 1px solid #0f3460;
  }

  .header {
    display: flex;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #0f3460;
    gap: 12px;
  }

  .header h2 {
    margin: 0;
    color: #e94560;
    font-size: 18px;
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #0f3460;
    border-radius: 6px;
    background: #16213e;
    color: #eee;
    font-size: 14px;
  }

  .search-input:focus {
    outline: none;
    border-color: #e94560;
  }

  .load-session-btn {
    background: #e94560;
    border: none;
    border-radius: 6px;
    color: white;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: background 0.2s;
  }

  .load-session-btn:hover {
    background: #d63850;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 24px;
    cursor: pointer;
    padding: 4px 8px;
  }

  .close-btn:hover {
    color: #e94560;
  }

  .content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sessions-panel {
    width: 300px;
    border-right: 1px solid #0f3460;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .messages-panel {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .session-item {
    padding: 12px 16px;
    border-bottom: 1px solid #0f3460;
    cursor: pointer;
    transition: background 0.2s;
  }

  .session-item:hover {
    background: #0f3460;
  }

  .session-item.selected {
    background: #0f3460;
    border-left: 3px solid #e94560;
  }

  .session-date {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
  }

  .session-preview {
    font-size: 13px;
    color: #ccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .session-count {
    font-size: 11px;
    color: #666;
    margin-top: 4px;
  }

  .message-card {
    background: #16213e;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    border: 1px solid #0f3460;
  }

  .message-card.user {
    margin-left: 40px;
    background: #0f3460;
  }

  .message-card.assistant {
    margin-right: 40px;
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .message-role {
    font-size: 11px;
    color: #e94560;
    font-weight: 600;
    text-transform: uppercase;
  }

  .message-time {
    font-size: 11px;
    color: #666;
  }

  .message-content {
    color: #eee;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message-actions {
    display: flex;
    gap: 4px;
    margin-top: 8px;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .message-card:hover .message-actions {
    opacity: 1;
  }

  .action-btn {
    background: #1a1a2e;
    border: 1px solid #0f3460;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 11px;
    color: #888;
  }

  .action-btn:hover {
    background: #0f3460;
    color: #e94560;
  }

  .files-list {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #0f3460;
  }

  .files-label {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
  }

  .file-tag {
    display: inline-block;
    background: #0f3460;
    color: #7ec699;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    margin-right: 4px;
    margin-bottom: 4px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
  }

  .empty-state .icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    color: #888;
  }

  .search-results-header {
    padding: 12px 16px;
    background: #0f3460;
    color: #e94560;
    font-size: 13px;
    font-weight: 600;
  }

  .search-result-item {
    padding: 12px 16px;
    border-bottom: 1px solid #0f3460;
    cursor: pointer;
  }

  .search-result-item:hover {
    background: #0f3460;
  }

  .search-result-session {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
  }

  .search-result-content {
    font-size: 13px;
    color: #ccc;
  }

  .search-highlight {
    background: #e94560;
    color: white;
    padding: 0 2px;
    border-radius: 2px;
  }

  .message-card.highlight {
    animation: highlight-pulse 2s ease-out;
  }

  @keyframes highlight-pulse {
    0% {
      box-shadow: 0 0 0 3px #e94560;
      background: #2a1a3e;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
      background: #16213e;
    }
  }
`;function Mn(i){return i.isSearching&&i.searchResults.length>0?d`
      <div class="search-results-header">
        Search Results (${i.searchResults.length})
      </div>
      ${i.searchResults.map(e=>d`
        <div 
          class="search-result-item"
          @click=${()=>i.selectSession(e.session_id,e.id)}
        >
          <div class="search-result-session">
            ${Ke(e.timestamp)} · ${e.role}
          </div>
          <div class="search-result-content">
            ${Di(e.content,150)}
          </div>
        </div>
      `)}
    `:i.sessions.length===0?d`
      <div class="empty-state">
        <div class="icon">📭</div>
        <div>No conversation history</div>
      </div>
    `:i.sessions.map(e=>d`
    <div 
      class="session-item ${i.selectedSessionId===e.session_id?"selected":""}"
      @click=${()=>i.selectSession(e.session_id)}
    >
      <div class="session-date">${Ke(e.timestamp)}</div>
      <div class="session-preview">${e.preview}</div>
      <div class="session-count">${e.message_count} messages</div>
    </div>
  `)}function Ln(i){return i.selectedSessionId?i.isLoading?d`<div class="loading">Loading...</div>`:i.selectedSession.length===0?d`
      <div class="empty-state">
        <div class="icon">📭</div>
        <div>No messages in this session</div>
      </div>
    `:i.selectedSession.map(e=>d`
    <div class="message-card ${e.role}" data-message-id="${e.id}">
      <div class="message-header">
        <span class="message-role">${e.role}</span>
        <span class="message-time">${Ke(e.timestamp)}</span>
      </div>
      <div class="message-content">
        ${e.role==="assistant"?d`<card-markdown .content=${e.content} role="assistant"></card-markdown>`:e.content}
      </div>
      ${e.files&&e.files.length>0?d`
        <div class="files-list">
          <div class="files-label">Files in context:</div>
          ${e.files.map(t=>d`<span class="file-tag">${t}</span>`)}
        </div>
      `:""}
      ${e.files_modified&&e.files_modified.length>0?d`
        <div class="files-list">
          <div class="files-label">Files modified:</div>
          ${e.files_modified.map(t=>d`<span class="file-tag">${t}</span>`)}
        </div>
      `:""}
      <div class="message-actions">
        <button class="action-btn" @click=${()=>i.copyToClipboard(e.content)} title="Copy to clipboard">
          📋 Copy
        </button>
        <button class="action-btn" @click=${()=>i.copyToPrompt(e.content)} title="Paste to prompt">
          ↩️ To Prompt
        </button>
      </div>
    </div>
  `):d`
      <div class="empty-state">
        <div class="icon">👈</div>
        <div>Select a session to view messages</div>
      </div>
    `}function zn(i){return i.visible?d`
    <div class="overlay" @click=${e=>{e.target.classList.contains("overlay")&&i.hide()}}>
      <div class="modal">
        <div class="header">
          <h2>📜 Conversation History</h2>
          <input
            type="text"
            class="search-input"
            placeholder="Search messages..."
            .value=${i.searchQuery}
            @input=${e=>i.handleSearchInput(e)}
          >
          ${i.selectedSessionId&&i.selectedSession.length>0?d`
            <button 
              class="load-session-btn" 
              @click=${()=>i.loadSessionToChat()}
              title="Replace current chat with this session"
            >
              📥 Load Session
            </button>
          `:""}
          <button class="close-btn" @click=${()=>i.hide()}>×</button>
        </div>
        <div class="content">
          <div class="sessions-panel">
            ${i.isLoading&&!i.selectedSessionId?d`
              <div class="loading">Loading sessions...</div>
            `:Mn(i)}
          </div>
          <div class="messages-panel">
            ${Ln(i)}
          </div>
        </div>
      </div>
    </div>
  `:d``}class Un extends ge(z){static properties={visible:{type:Boolean},sessions:{type:Array},selectedSessionId:{type:String},selectedSession:{type:Array},searchQuery:{type:String},searchResults:{type:Array},isSearching:{type:Boolean},isLoading:{type:Boolean}};static styles=An;constructor(){super(),this.visible=!1,this.sessions=[],this.selectedSessionId=null,this.selectedSession=[],this.searchQuery="",this.searchResults=[],this.isSearching=!1,this.isLoading=!1,this._debouncedSearch=ls(()=>this.performSearch(),300),this._messagesScrollTop=0,this._sessionsScrollTop=0}onRpcReady(){this.visible&&this.loadSessions()}async show(){this.visible=!0,await this.loadSessions(),await this.updateComplete;const e=this.shadowRoot?.querySelector(".messages-panel"),t=this.shadowRoot?.querySelector(".sessions-panel");e&&(e.scrollTop=this._messagesScrollTop),t&&(t.scrollTop=this._sessionsScrollTop)}hide(){const e=this.shadowRoot?.querySelector(".messages-panel"),t=this.shadowRoot?.querySelector(".sessions-panel");e&&(this._messagesScrollTop=e.scrollTop),t&&(this._sessionsScrollTop=t.scrollTop),this.visible=!1}async loadSessions(){const e=await this._rpcWithState("LiteLLM.history_list_sessions",{},50);this.sessions=e||[]}async selectSession(e,t=null){if(this.selectedSessionId!==e){this.selectedSessionId=e;const s=await this._rpcWithState("LiteLLM.history_get_session",{},e);this.selectedSession=s||[]}t&&this._scrollToMessage(t)}_scrollToMessage(e){this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector(`[data-message-id="${e}"]`);t&&(t.scrollIntoView({behavior:"smooth",block:"center"}),t.classList.add("highlight"),setTimeout(()=>t.classList.remove("highlight"),2e3))})}handleSearchInput(e){this.searchQuery=e.target.value,this.searchQuery.trim()?this._debouncedSearch():(this._debouncedSearch.cancel(),this.searchResults=[],this.isSearching=!1)}async performSearch(){if(!this.searchQuery.trim()){this.searchResults=[],this.isSearching=!1;return}this.isSearching=!0;const e=await this._rpcWithState("LiteLLM.history_search",{},this.searchQuery,null,100);this.searchResults=e||[]}copyToClipboard(e){navigator.clipboard.writeText(e)}copyToPrompt(e){this.dispatchEvent(new CustomEvent("copy-to-prompt",{detail:{content:e},bubbles:!0,composed:!0}))}loadSessionToChat(){!this.selectedSession||this.selectedSession.length===0||(this.dispatchEvent(new CustomEvent("load-session",{detail:{messages:this.selectedSession,sessionId:this.selectedSessionId},bubbles:!0,composed:!0})),this.hide())}render(){return zn(this)}}customElements.define("history-browser",Un);const In=U`
  :host {
    display: block;
    padding: 12px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    color: #e0e0e0;
    height: 100%;
    overflow-y: auto;
  }

  h2 {
    margin: 0 0 16px 0;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
  }

  .section {
    margin-bottom: 20px;
    padding: 12px;
    background: #2a2a2a;
    border-radius: 6px;
    border: 1px solid #3a3a3a;
  }

  .section-title {
    margin: 0 0 12px 0;
    font-size: 12px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .config-value {
    margin-bottom: 8px;
    padding: 6px 8px;
    background: #1e1e1e;
    border-radius: 4px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 11px;
    color: #a5d6ff;
    word-break: break-all;
  }

  .config-label {
    font-size: 11px;
    color: #6b7280;
    margin-bottom: 4px;
  }

  .button-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  button {
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  button.primary {
    background: #3b82f6;
    color: white;
  }

  button.primary:hover {
    background: #2563eb;
  }

  button.secondary {
    background: #4b5563;
    color: #e5e7eb;
  }

  button.secondary:hover {
    background: #6b7280;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .note {
    margin-top: 8px;
    padding: 8px;
    background: #1e1e1e;
    border-radius: 4px;
    font-size: 11px;
    color: #9ca3af;
    border-left: 2px solid #6b7280;
  }

  .note.info {
    border-left-color: #3b82f6;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .file-button {
    justify-content: flex-start;
    background: #374151;
    color: #d1d5db;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 11px;
  }

  .file-button:hover {
    background: #4b5563;
  }

  /* Toast message */
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    z-index: 1000;
    animation: slideIn 0.2s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .toast.success {
    background: #065f46;
    color: #d1fae5;
  }

  .toast.error {
    background: #991b1b;
    color: #fecaca;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .loading {
    opacity: 0.7;
  }
`;function Pn(i){return i.message?d`
    <div 
      class="toast ${i.message.type}"
      @click=${()=>i.dismissMessage()}
    >
      ${i.message.type==="success"?"✓":"✗"}
      ${i.message.text}
    </div>
  `:""}function Dn(i){const e=i.configInfo?.model||"Loading...",t=i.configInfo?.smaller_model||"Loading...";return d`
    <div class="section">
      <h3 class="section-title">LLM Configuration</h3>
      
      <div class="config-label">Model</div>
      <div class="config-value">${e}</div>
      
      <div class="config-label">Smaller Model</div>
      <div class="config-value">${t}</div>
      
      <div class="button-row">
        <button 
          class="secondary"
          @click=${()=>i.editConfig("litellm")}
          ?disabled=${i.isLoading}
        >
          📝 Edit litellm.json
        </button>
        <button 
          class="primary"
          @click=${()=>i.reloadLlmConfig()}
          ?disabled=${i.isLoading}
        >
          🔄 Reload
        </button>
      </div>
    </div>
  `}function Hn(i){return d`
    <div class="section">
      <h3 class="section-title">App Configuration</h3>
      
      <div class="button-row">
        <button 
          class="secondary"
          @click=${()=>i.editConfig("app")}
          ?disabled=${i.isLoading}
        >
          📝 Edit app.json
        </button>
        <button 
          class="primary"
          @click=${()=>i.reloadAppConfig()}
          ?disabled=${i.isLoading}
        >
          🔄 Reload
        </button>
      </div>
      
      <div class="note info">
        ℹ️ Some settings (e.g., cache tier thresholds) may require restart to take effect.
      </div>
    </div>
  `}function On(i){return d`
    <div class="section">
      <h3 class="section-title">Prompts (live-reloaded)</h3>
      
      <div class="file-list">
        <button 
          class="file-button"
          @click=${()=>i.editConfig("system")}
          ?disabled=${i.isLoading}
        >
          📄 system.md
        </button>
        <button 
          class="file-button"
          @click=${()=>i.editConfig("system_extra")}
          ?disabled=${i.isLoading}
        >
          📄 system_extra.md
        </button>
        <button 
          class="file-button"
          @click=${()=>i.editConfig("snippets")}
          ?disabled=${i.isLoading}
        >
          📄 prompt-snippets.json
        </button>
      </div>
      
      <div class="note">
        These files are read fresh on each use. No reload needed.
      </div>
    </div>
  `}function jn(i){return d`
    <div class="section">
      <h3 class="section-title">Skills (live-reloaded)</h3>
      
      <div class="file-list">
        <button 
          class="file-button"
          @click=${()=>i.editConfig("compaction")}
          ?disabled=${i.isLoading}
        >
          📄 compaction.md
        </button>
      </div>
      
      <div class="note">
        Skill prompts are read fresh when invoked.
      </div>
    </div>
  `}function Bn(i){return d`
    <h2>⚙️ Settings</h2>
    
    <div class="${i.isLoading?"loading":""}">
      ${Dn(i)}
      ${Hn(i)}
      ${On(i)}
      ${jn(i)}
    </div>
    
    ${Pn(i)}
  `}class Nn extends ge(z){static properties={visible:{type:Boolean},configInfo:{type:Object},isLoading:{type:Boolean},message:{type:Object}};static styles=In;constructor(){super(),this.visible=!1,this.configInfo=null,this.isLoading=!1,this.message=null,this._messageTimeout=null}onRpcReady(){this.loadConfigInfo()}async loadConfigInfo(){if(!this.rpcCall){console.warn("loadConfigInfo called but rpcCall not set");return}try{this.isLoading=!0;const e=await this._rpcExtract("Settings.get_config_info");e?.success?this.configInfo=e:console.error("Failed to load config info:",e)}catch(e){console.error("Failed to load config info:",e)}finally{this.isLoading=!1}}editConfig(e){this.dispatchEvent(new CustomEvent("config-edit-request",{bubbles:!0,composed:!0,detail:{configType:e}}))}async reloadLlmConfig(){try{this.isLoading=!0;const e=await this._rpcExtract("Settings.reload_llm_config");e?.success?(this._showMessage("success",e.message||"LLM config reloaded"),this.configInfo={...this.configInfo,model:e.model,smaller_model:e.smaller_model}):this._showMessage("error",e?.error||"Failed to reload config")}catch(e){this._showMessage("error",e.message||"Failed to reload config")}finally{this.isLoading=!1}}async reloadAppConfig(){try{this.isLoading=!0;const e=await this._rpcExtract("Settings.reload_app_config");e?.success?this._showMessage("success",e.message||"App config reloaded"):this._showMessage("error",e?.error||"Failed to reload config")}catch(e){this._showMessage("error",e.message||"Failed to reload config")}finally{this.isLoading=!1}}_showMessage(e,t){this.message={type:e,text:t},this._messageTimeout&&clearTimeout(this._messageTimeout),this._messageTimeout=setTimeout(()=>{this.message=null},3e3)}dismissMessage(){this.message=null,this._messageTimeout&&(clearTimeout(this._messageTimeout),this._messageTimeout=null)}render(){return Bn(this)}}customElements.define("settings-panel",Nn);const qn=_n(wn(yn(vn(xn(ii)))));class Vn extends qn{static properties={inputValue:{type:String},minimized:{type:Boolean},isConnected:{type:Boolean},fileTree:{type:Object},modifiedFiles:{type:Array},stagedFiles:{type:Array},untrackedFiles:{type:Array},diffStats:{type:Object},selectedFiles:{type:Array},showFilePicker:{type:Boolean},pastedImages:{type:Array},dialogX:{type:Number},dialogY:{type:Number},showHistoryBrowser:{type:Boolean},viewingFile:{type:String},promptSnippets:{type:Array},snippetDrawerOpen:{type:Boolean},leftPanelWidth:{type:Number},leftPanelCollapsed:{type:Boolean},detectedUrls:{type:Array},fetchingUrls:{type:Object},fetchedUrls:{type:Object},excludedUrls:{type:Object},activeLeftTab:{type:String},filePickerExpanded:{type:Object}};static styles=ni;constructor(){super(),this.inputValue="",this.minimized=!1,this.isConnected=!1,this.fileTree=null,this.modifiedFiles=[],this.stagedFiles=[],this.untrackedFiles=[],this.diffStats={},this.selectedFiles=[],this.showFilePicker=!0,this.pastedImages=[],this.dialogX=null,this.dialogY=null,this.showHistoryBrowser=!1,this.viewingFile=null,this.detectedUrls=[],this.fetchingUrls={},this.fetchedUrls={},this.excludedUrls=new Set,this.activeLeftTab="files",this.promptSnippets=[],this.snippetDrawerOpen=!1,this.filePickerExpanded={},this.leftPanelWidth=parseInt(localStorage.getItem("promptview-left-panel-width"))||280,this.leftPanelCollapsed=localStorage.getItem("promptview-left-panel-collapsed")==="true",this._filePickerScrollTop=0,this._messagesScrollTop=0,this._wasScrolledUp=!1,this._isPanelResizing=!1;const e=new URLSearchParams(window.location.search);this.port=e.get("port"),this._urlService=null}_initUrlService(){this._urlService=new kn(async(e,...t)=>{const s=await this.call[e](...t);return this.extractResponse(s)},e=>{this.detectedUrls=e.detectedUrls,this.fetchingUrls=e.fetchingUrls,this.fetchedUrls=e.fetchedUrls,this.excludedUrls=e.excludedUrls})}detectUrlsInInput(e){this._urlService?.detectUrlsInInput(e)}async fetchUrl(e){await this._urlService?.fetchUrl(e,this.inputValue)}toggleUrlIncluded(e){const t=this._urlService?.toggleUrlIncluded(e);this.dispatchEvent(new CustomEvent("url-inclusion-changed",{detail:{url:e,included:t},bubbles:!0,composed:!0}))}removeFetchedUrl(e){this._urlService?.removeFetchedUrl(e),this.dispatchEvent(new CustomEvent("url-removed",{detail:{url:e},bubbles:!0,composed:!0})),this._urlService?.detectUrlsInInput(this.inputValue)}dismissUrl(e){this._urlService?.dismissUrl(e)}viewUrlContent(e){this.dispatchEvent(new CustomEvent("view-url-content",{detail:{url:e.url,content:e},bubbles:!0,composed:!0}))}clearUrlState(){this._urlService?.clearState()}clearAllUrlState(){this._urlService?.clearAllState()}getFetchedUrlsForMessage(){return this._urlService?.getFetchedUrlsForMessage()||[]}getUrlTypeLabel(e){return this._urlService?.getUrlTypeLabel(e)||"🔗 URL"}getUrlDisplayName(e){return this._urlService?.getUrlDisplayName(e)||e.url}_getSelectedObject(){const e={};for(const t of this.selectedFiles||[])e[t]=!0;return e}toggleHistoryBrowser(){this.showHistoryBrowser=!this.showHistoryBrowser,this.showHistoryBrowser&&this.updateComplete.then(()=>{const e=this.shadowRoot?.querySelector("history-browser");e&&(e.rpcCall=this.call,e.show())})}handleHistoryCopyToPrompt(e){const{content:t}=e.detail;this.inputValue=t,this.showHistoryBrowser=!1,this.updateComplete.then(()=>{const s=this.shadowRoot?.querySelector("textarea");s&&s.focus()})}async handleLoadSession(e){const{messages:t,sessionId:s}=e.detail;if(this.clearHistory(),s)try{await this.call["LiteLLM.load_session_into_context"](s)}catch(n){console.warn("Could not load session into context:",n)}for(const n of t)this.addMessage(n.role,n.content,n.images||null);this.showHistoryBrowser=!1,console.log(`📜 Loaded ${t.length} messages from session`),this._filePickerScrollTop=0,this._messagesScrollTop=0,this._wasScrolledUp=!1,this.updateComplete.then(()=>{requestAnimationFrame(()=>{this.scrollToBottomNow()})}),await this._refreshHistoryBar()}connectedCallback(){super.connectedCallback(),this.addClass(this,"PromptView"),this.initInputHandler(),this.initWindowControls(),this.initStreaming(),this._initUrlService(),this.setupScrollObserver(),this.addEventListener("edit-block-click",this._handleEditBlockClick.bind(this)),this._boundPanelResizeMove=this._handlePanelResizeMove.bind(this),this._boundPanelResizeEnd=this._handlePanelResizeEnd.bind(this)}_handleEditBlockClick(e){const{path:t,line:s,status:n,searchContext:r}=e.detail;this.dispatchEvent(new CustomEvent("navigate-to-edit",{detail:{path:t,line:s,status:n,searchContext:r},bubbles:!0,composed:!0}))}switchTab(e){if(this.activeLeftTab==="files"){const t=this.shadowRoot?.querySelector("file-picker");t&&(this._filePickerScrollTop=t.getScrollTop());const s=this.shadowRoot?.querySelector("#messages-container");s&&(this._messagesScrollTop=s.scrollTop,this._messagesScrollHeight=s.scrollHeight,this._wasScrolledUp=this._userHasScrolledUp)}this.disconnectScrollObserver(),this.activeLeftTab=e,e==="files"?requestAnimationFrame(()=>{requestAnimationFrame(()=>{const t=this.shadowRoot?.querySelector("file-picker");t&&this._filePickerScrollTop>0&&t.setScrollTop(this._filePickerScrollTop);const s=this.shadowRoot?.querySelector("#messages-container");s&&(this._wasScrolledUp?(s.scrollTop=this._messagesScrollTop,this._userHasScrolledUp=!0,this._showScrollButton=!0):(s.scrollTop=s.scrollHeight,this._userHasScrolledUp=!1,this._showScrollButton=!1),this.setupScrollObserver(),this.requestUpdate())})}):e==="search"?this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector("find-in-files");t&&t.focusInput()}):e==="context"?this.updateComplete.then(()=>{this._refreshContextViewer()}):e==="cache"?this.updateComplete.then(()=>{this._refreshCacheViewer()}):e==="settings"&&this.updateComplete.then(()=>{this._refreshSettingsPanel()})}async _refreshContextViewer(){const e=this.shadowRoot?.querySelector("context-viewer");e&&this.call&&(e.rpcCall=this.call,e.selectedFiles=this.selectedFiles||[],e.fetchedUrls=Object.keys(this.fetchedUrls||{}),e.excludedUrls=this.excludedUrls,await e.refreshBreakdown(),e.breakdown&&this._syncHistoryBarFromBreakdown(e.breakdown))}async _refreshCacheViewer(){const e=this.shadowRoot?.querySelector("cache-viewer");e&&this.call&&(e.rpcCall=this.call,e.selectedFiles=this.selectedFiles||[],e.fetchedUrls=Object.keys(this.fetchedUrls||{}),e.excludedUrls=this.excludedUrls,await e.refreshBreakdown(),e.breakdown&&this._syncHistoryBarFromBreakdown(e.breakdown))}async _refreshSettingsPanel(){const e=this.shadowRoot?.querySelector("settings-panel");e&&this.call&&(e.rpcCall=this.call,await e.loadConfigInfo())}_syncHistoryBarFromBreakdown(e){if(!e)return;this._hudData||(this._hudData={});const t=e.breakdown?.history;t&&(this._hudData.history_tokens=t.tokens||0,this._hudData.history_threshold=t.compaction_threshold||t.max_tokens||5e4),this.requestUpdate()}async _refreshHistoryBar(){if(this.call)try{const e=await this.call["LiteLLM.get_context_breakdown"](this.selectedFiles||[],Object.keys(this.fetchedUrls||{})),t=this.extractResponse(e);this._syncHistoryBarFromBreakdown(t)}catch(e){console.warn("Could not refresh history bar:",e)}}handleSearchResultSelected(e){this.dispatchEvent(new CustomEvent("search-result-selected",{detail:e.detail,bubbles:!0,composed:!0}))}handleSearchFileSelected(e){this.dispatchEvent(new CustomEvent("search-file-selected",{detail:e.detail,bubbles:!0,composed:!0}))}handleContextRemoveUrl(e){const{url:t}=e.detail;if(this.fetchedUrls&&this.fetchedUrls[t]){const{[t]:s,...n}=this.fetchedUrls;this.fetchedUrls=n}this.dispatchEvent(new CustomEvent("context-remove-url",{detail:e.detail,bubbles:!0,composed:!0}))}handleContextUrlInclusionChanged(e){const{url:t,included:s}=e.detail,n=new Set(this.excludedUrls);s?n.delete(t):n.add(t),this.excludedUrls=n}handleExpandedChange(e){this.filePickerExpanded=e.detail}handleConfigEditRequest(e){this.dispatchEvent(new CustomEvent("config-edit-request",{bubbles:!0,composed:!0,detail:e.detail}))}disconnectedCallback(){super.disconnectedCallback(),this.destroyInputHandler(),this.destroyWindowControls(),this.disconnectScrollObserver(),this.removeEventListener("edit-block-click",this._handleEditBlockClick),window.removeEventListener("mousemove",this._boundPanelResizeMove),window.removeEventListener("mouseup",this._boundPanelResizeEnd)}remoteIsUp(){}async setupDone(){if(this.isConnected=!0,this.call||await new Promise(e=>setTimeout(e,100)),!this.call){console.warn("setupDone called but this.call is not available yet");return}await this.loadFileTree(),await this.loadLastSession(),await this.loadPromptSnippets(),await this._refreshHistoryBar()}async loadPromptSnippets(){try{const e=await this.call["LiteLLM.get_prompt_snippets"](),t=this.extractResponse(e);Array.isArray(t)&&(this.promptSnippets=t)}catch(e){console.warn("Could not load prompt snippets:",e)}}toggleSnippetDrawer(){this.snippetDrawerOpen=!this.snippetDrawerOpen}appendSnippet(e){this.snippetDrawerOpen=!1,this.inputValue&&!this.inputValue.endsWith(`
`)?this.inputValue+=`
`+e:this.inputValue+=e,this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector("textarea");t&&(t.focus(),t.selectionStart=t.selectionEnd=t.value.length,this._autoResizeTextarea(t))})}toggleLeftPanel(){this.leftPanelCollapsed=!this.leftPanelCollapsed,localStorage.setItem("promptview-left-panel-collapsed",this.leftPanelCollapsed)}_handlePanelResizeStart(e){e.preventDefault(),this._isPanelResizing=!0,this._panelResizeStartX=e.clientX,this._panelResizeStartWidth=this.leftPanelWidth,window.addEventListener("mousemove",this._boundPanelResizeMove),window.addEventListener("mouseup",this._boundPanelResizeEnd)}_handlePanelResizeMove(e){if(!this._isPanelResizing)return;const t=e.clientX-this._panelResizeStartX,s=Math.max(150,Math.min(500,this._panelResizeStartWidth+t));this.leftPanelWidth=s}_handlePanelResizeEnd(){this._isPanelResizing&&(this._isPanelResizing=!1,localStorage.setItem("promptview-left-panel-width",this.leftPanelWidth),window.removeEventListener("mousemove",this._boundPanelResizeMove),window.removeEventListener("mouseup",this._boundPanelResizeEnd))}async loadLastSession(){try{const e=await this.call["LiteLLM.history_list_sessions"](1);console.log("📜 Sessions response:",e);const t=this.extractResponse(e);if(console.log("📜 Extracted sessions:",t),t&&t.length>0){const s=t[0].session_id;console.log("📜 Loading session:",s);const n=await this.call["LiteLLM.load_session_into_context"](s);console.log("📜 Messages response:",n);const r=this.extractResponse(n);if(console.log("📜 Extracted messages:",r),r&&r.length>0){for(const o of r)this.addMessage(o.role,o.content,o.images||null,o.edit_results||null);console.log(`📜 Loaded ${r.length} messages from last session`),this.scrollToBottomNow()}}await this._refreshHistoryBar()}catch(e){console.warn("Could not load last session:",e),console.error(e)}}remoteDisconnected(e){this.isConnected=!1}extractResponse(e){if(e&&typeof e=="object"){const t=Object.keys(e);if(t.length>0)return e[t[0]]}return e}streamChunk(e,t){super.streamChunk(e,t)}async streamComplete(e,t){await super.streamComplete(e,t)}compactionEvent(e,t){super.compactionEvent(e,t)}render(){return bn(this)}}customElements.define("prompt-view",Vn);class Wn extends z{static properties={diffFiles:{type:Array},showDiff:{type:Boolean},serverURI:{type:String},viewingFile:{type:String},showUrlModal:{type:Boolean},urlModalContent:{type:Object}};static styles=U`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    .app-container {
      width: 100%;
      height: 100%;
      position: relative;
      background: #1a1a2e;
    }

    .diff-area {
      width: 100%;
      height: 100%;
    }

    .prompt-overlay {
      position: fixed;
      top: 20px;
      bottom: 20px;
      left: 20px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
    }

  `;constructor(){super(),this.diffFiles=[],this.showDiff=!1,this.viewingFile=null,this.showUrlModal=!1,this.urlModalContent=null;const t=new URLSearchParams(window.location.search).get("port")||"8765";this.serverURI=`ws://localhost:${t}`,this._handleKeydown=this._handleKeydown.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._handleKeydown),this._updateTitle()}async _updateTitle(){await this.updateComplete;const e=this.shadowRoot?.querySelector("prompt-view");if(!e){console.warn("_updateTitle: prompt-view not found");return}let t=0;const s=50,n=setInterval(async()=>{if(t++,t>s){clearInterval(n),console.warn("_updateTitle: timed out waiting for RPC");return}if(e.call&&typeof e.call["Repo.get_repo_name"]=="function"){clearInterval(n);try{const r=await e.call["Repo.get_repo_name"](),o=r?Object.values(r)[0]:null;o?document.title=o:console.warn("_updateTitle: empty repo name response",r)}catch(r){console.error("Failed to get repo name:",r)}}},100)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._handleKeydown)}_handleKeydown(e){if(e.ctrlKey&&e.shiftKey&&e.key==="F"){e.preventDefault();const t=this.shadowRoot?.querySelector("prompt-view");t&&t.switchTab("search")}if(e.ctrlKey&&e.key==="b"){e.preventDefault();const t=this.shadowRoot?.querySelector("prompt-view");t&&t.switchTab("files")}}async _loadFileIntoDiff(e,t=!0){const s=t!==!1;if(this.diffFiles.find(o=>o.path===e)&&!s)return!0;const r=this.shadowRoot.querySelector("prompt-view");if(!r?.call)return!1;try{const o=await r.call["Repo.get_file_content"](e),a=o?Object.values(o)[0]:null,l=typeof a=="string"?a:a?.content??null;if(l!==null){const c={path:e,original:l,modified:l,isNew:!1,isReadOnly:!0};return s?this.diffFiles=[c]:this.diffFiles=[...this.diffFiles,c],!0}}catch(o){console.error("Failed to load file:",o)}return!1}async handleSearchResultSelected(e){const{file:t,line:s}=e.detail;this.viewingFile=t,this.activeLeftTab="files",await this._loadFileIntoDiff(t),await this.updateComplete;const n=this.shadowRoot.querySelector("diff-viewer");n&&setTimeout(()=>{n.selectFile(t),setTimeout(()=>{n._revealPosition(s,1)},150)},100)}async handleSearchFileSelected(e){const{file:t}=e.detail;this.viewingFile=t,await this._loadFileIntoDiff(t)}handleCloseSearch(){this.activeLeftTab="files"}handleFileSelected(e){this.viewingFile=e.detail.path}handleEditsApplied(e){const{files:t}=e.detail;t&&t.length>0&&(this.diffFiles=t,this.showDiff=!0)}async handleFilesEdited(e){const{paths:t}=e.detail;if(!t||t.length===0)return;const s=this.shadowRoot.querySelector("diff-viewer");if(!s)return;const n=s.getOpenFilePaths();if(n.length===0)return;const r=new Set(t),o=n.filter(l=>r.has(l));if(o.length===0)return;const a=this.shadowRoot.querySelector("prompt-view");if(a?.call)for(const l of o)try{const c=await a.call["Repo.get_file_content"](l,"HEAD"),h=c?Object.values(c)[0]:null,g=typeof h=="string"?h:h?.content??"",f=await a.call["Repo.get_file_content"](l),x=f?Object.values(f)[0]:null,E=typeof x=="string"?x:x?.content??"";s.refreshFileContent(l,g,E)}catch(c){console.error("Failed to refresh file:",l,c)}}async handleNavigateToEdit(e){const{path:t,line:s,searchContext:n,status:r}=e.detail;this.viewingFile=t;const o=this.diffFiles.find(c=>c.path===t);o&&o.original!==o.modified||(r==="applied"?await this._loadDiffFromHead(t)||await this._loadFileIntoDiff(t):o||await this._loadFileIntoDiff(t)),await this.updateComplete;const l=this.shadowRoot.querySelector("diff-viewer");l&&setTimeout(()=>{l.selectFile(t),setTimeout(()=>{const c=n&&l._findLineByContent(n)||s;c&&l._revealPosition(c,1)},150)},100)}async _loadDiffFromHead(e){const t=this.shadowRoot.querySelector("prompt-view");if(!t?.call)return!1;try{const s=await t.call["Repo.get_file_content"](e,"HEAD"),n=s?Object.values(s)[0]:null,r=typeof n=="string"?n:n?.content??null,o=await t.call["Repo.get_file_content"](e),a=o?Object.values(o)[0]:null,l=typeof a=="string"?a:a?.content??null;return r===null||l===null||r===l?!1:(this.diffFiles=[{path:e,original:r,modified:l,isNew:!1,isReadOnly:!1}],!0)}catch(s){return console.error("Failed to load diff from HEAD:",s),!1}}clearDiff(){this.diffFiles=[],this.showDiff=!1;const e=this.shadowRoot.querySelector("diff-viewer");e&&e.clearFiles()}async handleRequestFileLoad(e){const{file:t,line:s,column:n,replace:r}=e.detail;if(await this._loadFileIntoDiff(t,r)&&(s||n)){await this.updateComplete;const a=this.shadowRoot.querySelector("diff-viewer");a&&setTimeout(()=>{a.selectFile(t),s&&setTimeout(()=>{a._revealPosition(s,n||1)},150)},100)}}handleRemoveUrl(e){const{url:t}=e.detail,s=this.shadowRoot?.querySelector("prompt-view");if(s&&s.fetchedUrls){const{[t]:n,...r}=s.fetchedUrls;s.fetchedUrls=r,this._refreshContextViewer()}}handleUrlRemoved(e){this._refreshContextViewer()}handleViewUrlContent(e){const{content:t}=e.detail;this.urlModalContent=t,this.showUrlModal=!0}closeUrlModal(){this.showUrlModal=!1,this.urlModalContent=null}async handleConfigEditRequest(e){const{configType:t}=e.detail,s=this.shadowRoot.querySelector("prompt-view");if(!s?.call){console.error("RPC not available for config edit");return}try{const n=await s.call["Settings.get_config_content"](t),r=n?Object.values(n)[0]:null;if(!r?.success){console.error("Failed to load config:",r?.error);return}const o=`[config]/${t}`;this.diffFiles=[{path:o,original:r.content,modified:r.content,isNew:!1,isReadOnly:!1,isConfig:!0,configType:t,realPath:r.path}],this.viewingFile=o}catch(n){console.error("Failed to load config for editing:",n)}}async handleFileSave(e){const{path:t,content:s,isConfig:n,configType:r}=e.detail,o=this.shadowRoot.querySelector("prompt-view");if(!o?.call){console.error("RPC not available for file save");return}try{if(n&&r){const a=await o.call["Settings.save_config_content"](r,s),l=a?Object.values(a)[0]:null;l?.success||console.error("Failed to save config:",l?.error)}else await o.call["Repo.write_file"](t,s)}catch(a){console.error("Failed to save file:",a)}}async handleFilesSave(e){const{files:t}=e.detail,s=this.shadowRoot.querySelector("prompt-view");if(!s?.call){console.error("RPC not available for file save");return}for(const n of t)try{if(n.isConfig&&n.configType){const r=await s.call["Settings.save_config_content"](n.configType,n.content),o=r?Object.values(r)[0]:null;o?.success||console.error("Failed to save config:",o?.error)}else await s.call["Repo.write_file"](n.path,n.content)}catch(r){console.error("Failed to save file:",n.path,r)}}render(){return d`
      <url-content-modal
        .open=${this.showUrlModal}
        .url=${this.urlModalContent?.url||""}
        .content=${this.urlModalContent}
        @close=${this.closeUrlModal}
      ></url-content-modal>
      <div class="app-container">
        <div class="diff-area">
          <diff-viewer
            .files=${this.diffFiles}
            .visible=${!0}
            .serverURI=${this.serverURI}
            .viewingFile=${this.viewingFile}
            @file-save=${this.handleFileSave}
            @files-save=${this.handleFilesSave}
            @file-selected=${this.handleFileSelected}
            @request-file-load=${this.handleRequestFileLoad}
          ></diff-viewer>
        </div>
        <div class="prompt-overlay">
          <prompt-view 
            .viewingFile=${this.viewingFile}
            @edits-applied=${this.handleEditsApplied}
            @navigate-to-edit=${this.handleNavigateToEdit}
            @files-edited=${this.handleFilesEdited}
            @url-removed=${this.handleUrlRemoved}
            @view-url-content=${this.handleViewUrlContent}
            @search-result-selected=${this.handleSearchResultSelected}
            @search-file-selected=${this.handleSearchFileSelected}
            @context-remove-url=${this.handleRemoveUrl}
            @config-edit-request=${this.handleConfigEditRequest}
          ></prompt-view>
        </div>
      </div>
    `}}customElements.define("app-shell",Wn);
