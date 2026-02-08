const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/ContextViewer-CNE0CWlE.js","assets/SymbolMapModal-BOFsRDcT.js","assets/CacheViewer-RsrlvWjn.js"])))=>i.map(i=>d[i]);
(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))s(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&s(a)}).observe(document,{childList:!0,subtree:!0});function t(i){const r={};return i.integrity&&(r.integrity=i.integrity),i.referrerPolicy&&(r.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?r.credentials="include":i.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function s(i){if(i.ep)return;i.ep=!0;const r=t(i);fetch(i.href,r)}})();/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const $e=globalThis,Ie=$e.ShadowRoot&&($e.ShadyCSS===void 0||$e.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,Ye=Symbol(),ut=new WeakMap;let Ze=class{constructor(e,t,s){if(this._$cssResult$=!0,s!==Ye)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const t=this.t;if(Ie&&e===void 0){const s=t!==void 0&&t.length===1;s&&(e=ut.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),s&&ut.set(t,e))}return e}toString(){return this.cssText}};const Ot=n=>new Ze(typeof n=="string"?n:n+"",void 0,Ye),N=(n,...e)=>{const t=n.length===1?n[0]:e.reduce((s,i,r)=>s+(a=>{if(a._$cssResult$===!0)return a.cssText;if(typeof a=="number")return a;throw Error("Value passed to 'css' function must be a 'css' function result: "+a+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(i)+n[r+1],n[0]);return new Ze(t,n,Ye)},Nt=(n,e)=>{if(Ie)n.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const t of e){const s=document.createElement("style"),i=$e.litNonce;i!==void 0&&s.setAttribute("nonce",i),s.textContent=t.cssText,n.appendChild(s)}},Be=Ie?n=>n:n=>n instanceof CSSStyleSheet?(e=>{let t="";for(const s of e.cssRules)t+=s.cssText;return Ot(t)})(n):n;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:ps,defineProperty:fs,getOwnPropertyDescriptor:gs,getOwnPropertyNames:ms,getOwnPropertySymbols:bs,getPrototypeOf:ys}=Object,De=globalThis,pt=De.trustedTypes,xs=pt?pt.emptyScript:"",_s=De.reactiveElementPolyfillSupport,pe=(n,e)=>n,Ee={toAttribute(n,e){switch(e){case Boolean:n=n?xs:null;break;case Object:case Array:n=n==null?n:JSON.stringify(n)}return n},fromAttribute(n,e){let t=n;switch(e){case Boolean:t=n!==null;break;case Number:t=n===null?null:Number(n);break;case Object:case Array:try{t=JSON.parse(n)}catch{t=null}}return t}},Ke=(n,e)=>!ps(n,e),ft={attribute:!0,type:String,converter:Ee,reflect:!1,useDefault:!1,hasChanged:Ke};Symbol.metadata??=Symbol("metadata"),De.litPropertyMetadata??=new WeakMap;let J=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=ft){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){const s=Symbol(),i=this.getPropertyDescriptor(e,s,t);i!==void 0&&fs(this.prototype,e,i)}}static getPropertyDescriptor(e,t,s){const{get:i,set:r}=gs(this.prototype,e)??{get(){return this[t]},set(a){this[t]=a}};return{get:i,set(a){const o=i?.call(this);r?.call(this,a),this.requestUpdate(e,o,s)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??ft}static _$Ei(){if(this.hasOwnProperty(pe("elementProperties")))return;const e=ys(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(pe("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(pe("properties"))){const t=this.properties,s=[...ms(t),...bs(t)];for(const i of s)this.createProperty(i,t[i])}const e=this[Symbol.metadata];if(e!==null){const t=litPropertyMetadata.get(e);if(t!==void 0)for(const[s,i]of t)this.elementProperties.set(s,i)}this._$Eh=new Map;for(const[t,s]of this.elementProperties){const i=this._$Eu(t,s);i!==void 0&&this._$Eh.set(i,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const s=new Set(e.flat(1/0).reverse());for(const i of s)t.unshift(Be(i))}else e!==void 0&&t.push(Be(e));return t}static _$Eu(e,t){const s=t.attribute;return s===!1?void 0:typeof s=="string"?s:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){const e=new Map,t=this.constructor.elementProperties;for(const s of t.keys())this.hasOwnProperty(s)&&(e.set(s,this[s]),delete this[s]);e.size>0&&(this._$Ep=e)}createRenderRoot(){const e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Nt(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,s){this._$AK(e,s)}_$ET(e,t){const s=this.constructor.elementProperties.get(e),i=this.constructor._$Eu(e,s);if(i!==void 0&&s.reflect===!0){const r=(s.converter?.toAttribute!==void 0?s.converter:Ee).toAttribute(t,s.type);this._$Em=e,r==null?this.removeAttribute(i):this.setAttribute(i,r),this._$Em=null}}_$AK(e,t){const s=this.constructor,i=s._$Eh.get(e);if(i!==void 0&&this._$Em!==i){const r=s.getPropertyOptions(i),a=typeof r.converter=="function"?{fromAttribute:r.converter}:r.converter?.fromAttribute!==void 0?r.converter:Ee;this._$Em=i;const o=a.fromAttribute(t,r.type);this[i]=o??this._$Ej?.get(i)??o,this._$Em=null}}requestUpdate(e,t,s,i=!1,r){if(e!==void 0){const a=this.constructor;if(i===!1&&(r=this[e]),s??=a.getPropertyOptions(e),!((s.hasChanged??Ke)(r,t)||s.useDefault&&s.reflect&&r===this._$Ej?.get(e)&&!this.hasAttribute(a._$Eu(e,s))))return;this.C(e,t,s)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:s,reflect:i,wrapped:r},a){s&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,a??t??this[e]),r!==!0||a!==void 0)||(this._$AL.has(e)||(this.hasUpdated||s||(t=void 0),this._$AL.set(e,t)),i===!0&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(const[i,r]of this._$Ep)this[i]=r;this._$Ep=void 0}const s=this.constructor.elementProperties;if(s.size>0)for(const[i,r]of s){const{wrapped:a}=r,o=this[i];a!==!0||this._$AL.has(i)||o===void 0||this.C(i,void 0,r,o)}}let e=!1;const t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(s=>s.hostUpdate?.()),this.update(t)):this._$EM()}catch(s){throw e=!1,this._$EM(),s}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(e){}firstUpdated(e){}};J.elementStyles=[],J.shadowRootOptions={mode:"open"},J[pe("elementProperties")]=new Map,J[pe("finalized")]=new Map,_s?.({ReactiveElement:J}),(De.reactiveElementVersions??=[]).push("2.1.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Je=globalThis,gt=n=>n,Fe=Je.trustedTypes,mt=Fe?Fe.createPolicy("lit-html",{createHTML:n=>n}):void 0,Qe="$lit$",W=`lit$${Math.random().toFixed(9).slice(2)}$`,et="?"+W,vs=`<${et}>`,ee=document,fe=()=>ee.createComment(""),ge=n=>n===null||typeof n!="object"&&typeof n!="function",tt=Array.isArray,jt=n=>tt(n)||typeof n?.[Symbol.iterator]=="function",Oe=`[ 	
\f\r]`,oe=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,bt=/-->/g,yt=/>/g,Z=RegExp(`>|${Oe}(?:([^\\s"'>=/]+)(${Oe}*=${Oe}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),xt=/'/g,_t=/"/g,Bt=/^(?:script|style|textarea|title)$/i,st=n=>(e,...t)=>({_$litType$:n,strings:e,values:t}),m=st(1),ws=st(2),ks=st(3),G=Symbol.for("lit-noChange"),I=Symbol.for("lit-nothing"),vt=new WeakMap,Q=ee.createTreeWalker(ee,129);function qt(n,e){if(!tt(n)||!n.hasOwnProperty("raw"))throw Error("invalid template strings array");return mt!==void 0?mt.createHTML(e):e}const Vt=(n,e)=>{const t=n.length-1,s=[];let i,r=e===2?"<svg>":e===3?"<math>":"",a=oe;for(let o=0;o<t;o++){const l=n[o];let d,c,h=-1,p=0;for(;p<l.length&&(a.lastIndex=p,c=a.exec(l),c!==null);)p=a.lastIndex,a===oe?c[1]==="!--"?a=bt:c[1]!==void 0?a=yt:c[2]!==void 0?(Bt.test(c[2])&&(i=RegExp("</"+c[2],"g")),a=Z):c[3]!==void 0&&(a=Z):a===Z?c[0]===">"?(a=i??oe,h=-1):c[1]===void 0?h=-2:(h=a.lastIndex-c[2].length,d=c[1],a=c[3]===void 0?Z:c[3]==='"'?_t:xt):a===_t||a===xt?a=Z:a===bt||a===yt?a=oe:(a=Z,i=void 0);const g=a===Z&&n[o+1].startsWith("/>")?" ":"";r+=a===oe?l+vs:h>=0?(s.push(d),l.slice(0,h)+Qe+l.slice(h)+W+g):l+W+(h===-2?o:g)}return[qt(n,r+(n[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),s]};class me{constructor({strings:e,_$litType$:t},s){let i;this.parts=[];let r=0,a=0;const o=e.length-1,l=this.parts,[d,c]=Vt(e,t);if(this.el=me.createElement(d,s),Q.currentNode=this.el.content,t===2||t===3){const h=this.el.content.firstChild;h.replaceWith(...h.childNodes)}for(;(i=Q.nextNode())!==null&&l.length<o;){if(i.nodeType===1){if(i.hasAttributes())for(const h of i.getAttributeNames())if(h.endsWith(Qe)){const p=c[a++],g=i.getAttribute(h).split(W),k=/([.?@])?(.*)/.exec(p);l.push({type:1,index:r,name:k[2],strings:g,ctor:k[1]==="."?Gt:k[1]==="?"?Xt:k[1]==="@"?Yt:be}),i.removeAttribute(h)}else h.startsWith(W)&&(l.push({type:6,index:r}),i.removeAttribute(h));if(Bt.test(i.tagName)){const h=i.textContent.split(W),p=h.length-1;if(p>0){i.textContent=Fe?Fe.emptyScript:"";for(let g=0;g<p;g++)i.append(h[g],fe()),Q.nextNode(),l.push({type:2,index:++r});i.append(h[p],fe())}}}else if(i.nodeType===8)if(i.data===et)l.push({type:2,index:r});else{let h=-1;for(;(h=i.data.indexOf(W,h+1))!==-1;)l.push({type:7,index:r}),h+=W.length-1}r++}}static createElement(e,t){const s=ee.createElement("template");return s.innerHTML=e,s}}function te(n,e,t=n,s){if(e===G)return e;let i=s!==void 0?t._$Co?.[s]:t._$Cl;const r=ge(e)?void 0:e._$litDirective$;return i?.constructor!==r&&(i?._$AO?.(!1),r===void 0?i=void 0:(i=new r(n),i._$AT(n,t,s)),s!==void 0?(t._$Co??=[])[s]=i:t._$Cl=i),i!==void 0&&(e=te(n,i._$AS(n,e.values),i,s)),e}class Wt{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){const{el:{content:t},parts:s}=this._$AD,i=(e?.creationScope??ee).importNode(t,!0);Q.currentNode=i;let r=Q.nextNode(),a=0,o=0,l=s[0];for(;l!==void 0;){if(a===l.index){let d;l.type===2?d=new re(r,r.nextSibling,this,e):l.type===1?d=new l.ctor(r,l.name,l.strings,this,e):l.type===6&&(d=new Zt(r,this,e)),this._$AV.push(d),l=s[++o]}a!==l?.index&&(r=Q.nextNode(),a++)}return Q.currentNode=ee,i}p(e){let t=0;for(const s of this._$AV)s!==void 0&&(s.strings!==void 0?(s._$AI(e,s,t),t+=s.strings.length-2):s._$AI(e[t])),t++}}class re{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,s,i){this.type=2,this._$AH=I,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=s,this.options=i,this._$Cv=i?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=te(this,e,t),ge(e)?e===I||e==null||e===""?(this._$AH!==I&&this._$AR(),this._$AH=I):e!==this._$AH&&e!==G&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):jt(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==I&&ge(this._$AH)?this._$AA.nextSibling.data=e:this.T(ee.createTextNode(e)),this._$AH=e}$(e){const{values:t,_$litType$:s}=e,i=typeof s=="number"?this._$AC(e):(s.el===void 0&&(s.el=me.createElement(qt(s.h,s.h[0]),this.options)),s);if(this._$AH?._$AD===i)this._$AH.p(t);else{const r=new Wt(i,this),a=r.u(this.options);r.p(t),this.T(a),this._$AH=r}}_$AC(e){let t=vt.get(e.strings);return t===void 0&&vt.set(e.strings,t=new me(e)),t}k(e){tt(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let s,i=0;for(const r of e)i===t.length?t.push(s=new re(this.O(fe()),this.O(fe()),this,this.options)):s=t[i],s._$AI(r),i++;i<t.length&&(this._$AR(s&&s._$AB.nextSibling,i),t.length=i)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){const s=gt(e).nextSibling;gt(e).remove(),e=s}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}}class be{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,s,i,r){this.type=1,this._$AH=I,this._$AN=void 0,this.element=e,this.name=t,this._$AM=i,this.options=r,s.length>2||s[0]!==""||s[1]!==""?(this._$AH=Array(s.length-1).fill(new String),this.strings=s):this._$AH=I}_$AI(e,t=this,s,i){const r=this.strings;let a=!1;if(r===void 0)e=te(this,e,t,0),a=!ge(e)||e!==this._$AH&&e!==G,a&&(this._$AH=e);else{const o=e;let l,d;for(e=r[0],l=0;l<r.length-1;l++)d=te(this,o[s+l],t,l),d===G&&(d=this._$AH[l]),a||=!ge(d)||d!==this._$AH[l],d===I?e=I:e!==I&&(e+=(d??"")+r[l+1]),this._$AH[l]=d}a&&!i&&this.j(e)}j(e){e===I?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}}class Gt extends be{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===I?void 0:e}}class Xt extends be{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==I)}}class Yt extends be{constructor(e,t,s,i,r){super(e,t,s,i,r),this.type=5}_$AI(e,t=this){if((e=te(this,e,t,0)??I)===G)return;const s=this._$AH,i=e===I&&s!==I||e.capture!==s.capture||e.once!==s.once||e.passive!==s.passive,r=e!==I&&(s===I||i);i&&this.element.removeEventListener(this.name,this,s),r&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}}class Zt{constructor(e,t,s){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=s}get _$AU(){return this._$AM._$AU}_$AI(e){te(this,e)}}const Kt={M:Qe,P:W,A:et,C:1,L:Vt,R:Wt,D:jt,V:te,I:re,H:be,N:Xt,U:Yt,B:Gt,F:Zt},$s=Je.litHtmlPolyfillSupport;$s?.(me,re),(Je.litHtmlVersions??=[]).push("3.3.2");const Jt=(n,e,t)=>{const s=t?.renderBefore??e;let i=s._$litPart$;if(i===void 0){const r=t?.renderBefore??null;s._$litPart$=i=new re(e.insertBefore(fe(),r),r,void 0,t??{})}return i._$AI(n),i};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const it=globalThis;let H=class extends J{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){const e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=Jt(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return G}};H._$litElement$=!0,H.finalized=!0,it.litElementHydrateSupport?.({LitElement:H});const Ss=it.litElementPolyfillSupport;Ss?.({LitElement:H});const Cs={_$AK:(n,e,t)=>{n._$AK(e,t)},_$AL:n=>n._$AL};(it.litElementVersions??=[]).push("4.2.2");/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Es=!1,Fs=Object.freeze(Object.defineProperty({__proto__:null,CSSResult:Ze,LitElement:H,ReactiveElement:J,_$LE:Cs,_$LH:Kt,adoptStyles:Nt,css:N,defaultConverter:Ee,getCompatibleStyle:Be,html:m,isServer:Es,mathml:ks,noChange:G,notEqual:Ke,nothing:I,render:Jt,supportsAdoptingStyleSheets:Ie,svg:ws,unsafeCSS:Ot},Symbol.toStringTag,{value:"Module"}));let Ae=null,qe=[];function As(n){Ae=n;for(const e of qe)e(n);qe=[]}function Ts(){return Ae}function Rs(){return Ae?Promise.resolve(Ae):new Promise(n=>qe.push(n))}function Qt(n){if(!n)return null;if(typeof n!="object")return n;const e=Object.values(n);return e.length>0?e[0]:null}function In(n,e=300){let t=null;const s=(...i)=>{t&&clearTimeout(t),t=setTimeout(()=>n(...i),e)};return s.cancel=()=>{t&&clearTimeout(t),t=null},s}const Ps=n=>class extends n{__rpcCall=null;connectedCallback(){if(super.connectedCallback(),!this.__rpcCall){const e=Ts();e?this.rpcCall=e:Rs().then(t=>{this.__rpcCall||(this.rpcCall=t)})}}set rpcCall(e){const t=this.__rpcCall!=null;this.__rpcCall=e,e&&!t&&typeof this.onRpcReady=="function"&&this.onRpcReady()}get rpcCall(){return this.__rpcCall}_rpc(e,...t){return this.__rpcCall?.[e]?this.__rpcCall[e](...t):Promise.reject(new Error(`RPC not available: ${e}`))}async _rpcExtract(e,...t){const s=await this._rpc(e,...t);return Qt(s)}async _rpcWithState(e,t={},...s){const{loadingProp:i="isLoading",errorProp:r="error"}=t;this[i]=!0,this[r]=null;try{const a=await this._rpcExtract(e,...s);return a?.error?(this[r]=a.error,null):a}catch(a){return this[r]=a.message||`${e} failed`,null}finally{this[i]=!1}}},E={FILES:"files",SEARCH:"search",CONTEXT:"context",CACHE:"cache",SETTINGS:"settings"};var Ve=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};function Is(n){return n&&n.__esModule&&Object.prototype.hasOwnProperty.call(n,"default")?n.default:n}function Ds(n){if(n.__esModule)return n;var e=n.default;if(typeof e=="function"){var t=function s(){return this instanceof s?Reflect.construct(e,arguments,this.constructor):e.apply(this,arguments)};t.prototype=e.prototype}else t={};return Object.defineProperty(t,"__esModule",{value:!0}),Object.keys(n).forEach(function(s){var i=Object.getOwnPropertyDescriptor(n,s);Object.defineProperty(t,s,i.get?i:{enumerable:!0,get:function(){return n[s]}})}),t}var es={exports:{}};(function(n){class e{getAllFns(s,i){let r=[],a=s.constructor.prototype;for(;a!=null;){let o=a.constructor.name.replace("_exports_","");if(i!=null&&(o=i),o!=="Object"){let l=Object.getOwnPropertyNames(a).filter(d=>d!=="constructor"&&d.indexOf("__")<0);l.forEach((d,c)=>{l[c]=o+"."+d}),r=r.concat(l)}if(i!=null)break;a=a.__proto__}return r}exposeAllFns(s,i){let r=this.getAllFns(s,i);var a={};return r.forEach(function(o){a[o]=function(l,d){Promise.resolve(s[o.substring(o.indexOf(".")+1)].apply(s,l.args)).then(function(c){return d(null,c)}).catch(function(c){return console.log("failed : "+c),d(c)})}}),a}}n.exports=e})(es);var Ls=es.exports;/*! JRPC v3.1.0
 * <https://github.com/vphantom/js-jrpc>
 * Copyright 2016 Stéphane Lavergne
 * Free software under MIT License: <https://opensource.org/licenses/MIT> */Ve.setImmediate=typeof setImmediate<"u"?setImmediate:(n,...e)=>setTimeout(()=>n(...e),0);function V(n){this.active=!0,this.transmitter=null,this.remoteTimeout=6e4,this.localTimeout=0,this.serial=0,this.outbox={requests:[],responses:[]},this.inbox={},this.localTimers={},this.outTimers={},this.localComponents={"system.listComponents":!0,"system.extension.dual-batch":!0},this.remoteComponents={},this.exposed={},this.exposed["system.listComponents"]=function(e,t){return typeof e=="object"&&e!==null&&(this.remoteComponents=e,this.remoteComponents["system._upgraded"]=!0),t(null,this.localComponents)}.bind(this),this.exposed["system.extension.dual-batch"]=function(e,t){return t(null,!0)},typeof n=="object"&&("remoteTimeout"in n&&typeof n.remoteTimeout=="number"&&(this.remoteTimeout=n.remoteTimeout*1e3),"localTimeout"in n&&typeof n.localTimeout=="number"&&(this.localTimeout=n.localTimeout*1e3))}function zs(){var n=this;return n.active=!1,n.transmitter=null,n.remoteTimeout=0,n.localTimeout=0,n.localComponents={},n.remoteComponents={},n.outbox.requests.length=0,n.outbox.responses.length=0,n.inbox={},n.exposed={},Object.keys(n.localTimers).forEach(function(e){clearTimeout(n.localTimers[e]),delete n.localTimers[e]}),Object.keys(n.outTimers).forEach(function(e){clearTimeout(n.outTimers[e]),delete n.outTimers[e]}),n}function Ms(n){var e,t,s=null,i={responses:[],requests:[]};if(typeof n!="function"&&(n=this.transmitter),!this.active||typeof n!="function")return this;if(e=this.outbox.responses.length,t=this.outbox.requests.length,e>0&&t>0&&"system.extension.dual-batch"in this.remoteComponents)i=s={responses:this.outbox.responses,requests:this.outbox.requests},this.outbox.responses=[],this.outbox.requests=[];else if(e>0)e>1?(i.responses=s=this.outbox.responses,this.outbox.responses=[]):i.responses.push(s=this.outbox.responses.pop());else if(t>0)t>1?(i.requests=s=this.outbox.requests,this.outbox.requests=[]):i.requests.push(s=this.outbox.requests.pop());else return this;return setImmediate(n,JSON.stringify(s),Hs.bind(this,i)),this}function Us(n){return this.transmitter=n,this.transmit()}function Hs(n,e){this.active&&e&&(n.responses.length>0&&Array.prototype.push.apply(this.outbox.responses,n.responses),n.requests.length>0&&Array.prototype.push.apply(this.outbox.requests,n.requests))}function Os(n){var e=[],t=[];if(!this.active)return this;if(typeof n=="string")try{n=JSON.parse(n)}catch{return this}if(n.constructor===Array){if(n.length===0)return this;typeof n[0].method=="string"?e=n:t=n}else typeof n=="object"&&(typeof n.requests<"u"&&typeof n.responses<"u"?(e=n.requests,t=n.responses):typeof n.method=="string"?e.push(n):t.push(n));return t.forEach(ts.bind(this)),e.forEach(Bs.bind(this)),this}function Ns(){return this.active?this.call("system.listComponents",this.localComponents,function(n,e){!n&&typeof e=="object"&&(this.remoteComponents=e,this.remoteComponents["system._upgraded"]=!0)}.bind(this)):this}function nt(n,e,t){var s={jsonrpc:"2.0",method:n};return this.active?(typeof e=="function"&&(t=e,e=null),"system._upgraded"in this.remoteComponents&&!(n in this.remoteComponents)?(typeof t=="function"&&setImmediate(t,{code:-32601,message:"Unknown remote method"}),this):(typeof e=="object"&&(s.params=e),this.serial++,typeof t=="function"&&(s.id=this.serial,this.inbox[this.serial]=t),this.outbox.requests.push(s),this.transmit(),typeof t!="function"?this:(this.remoteTimeout>0?this.outTimers[this.serial]=setTimeout(ts.bind(this,{jsonrpc:"2.0",id:this.serial,error:{code:-1e3,message:"Timed out waiting for response"}}),this.remoteTimeout):this.outTimers[this.serial]=!0,this))):this}function ts(n){var e=!1,t=null;if(this.active&&"id"in n&&n.id in this.outTimers)clearTimeout(this.outTimers[n.id]),delete this.outTimers[n.id];else return;n.id in this.inbox&&("error"in n?e=n.error:t=n.result,setImmediate(this.inbox[n.id],e,t),delete this.inbox[n.id])}function js(n,e){var t;if(!this.active)return this;if(typeof n=="string")this.localComponents[n]=!0,this.exposed[n]=e;else if(typeof n=="object")for(t in n)n.hasOwnProperty(t)&&(this.localComponents[t]=!0,this.exposed[t]=n[t]);return this}function Bs(n){var e=null,t=null;if(!(!this.active||typeof n!="object"||n===null)&&typeof n.jsonrpc=="string"&&n.jsonrpc==="2.0"){if(e=typeof n.id<"u"?n.id:null,typeof n.method!="string"){e!==null&&(this.localTimers[e]=!0,setImmediate(le.bind(this,e,-32600)));return}if(!(n.method in this.exposed)){e!==null&&(this.localTimers[e]=!0,setImmediate(le.bind(this,e,-32601)));return}if("params"in n)if(typeof n.params=="object")t=n.params;else{e!==null&&(this.localTimers[e]=!0,setImmediate(le.bind(this,e,-32602)));return}e!==null&&(this.localTimeout>0?this.localTimers[e]=setTimeout(le.bind(this,e,{code:-1002,message:"Method handler timed out"}),this.localTimeout):this.localTimers[e]=!0),setImmediate(this.exposed[n.method],t,le.bind(this,e))}}function le(n,e,t){var s={jsonrpc:"2.0",id:n};if(n!==null){if(this.active&&n in this.localTimers)clearTimeout(this.localTimers[n]),delete this.localTimers[n];else return;typeof e<"u"&&e!==null&&e!==!1?typeof e=="number"?s.error={code:e,message:"error"}:e===!0?s.error={code:-1,message:"error"}:typeof e=="string"?s.error={code:-1,message:e}:typeof e=="object"&&"code"in e&&"message"in e?s.error=e:s.error={code:-2,message:"error",data:e}:s.result=t,this.outbox.responses.push(s),this.transmit()}}V.prototype.shutdown=zs;V.prototype.call=nt;V.prototype.notify=nt;V.prototype.expose=js;V.prototype.upgrade=Ns;V.prototype.receive=Os;V.prototype.transmit=Ms;V.prototype.setTransmitter=Us;typeof Promise<"u"&&typeof Promise.promisify=="function"&&(V.prototype.callAsync=Promise.promisify(nt));var ss=V;const qs=Is(ss),Vs=Ds(Fs);var Ws=Ls,wt=ss,{LitElement:Gs}=Vs,Se=self.crypto;Se.randomUUID||(Se.randomUUID=()=>Se.getRandomValues(new Uint8Array(32)).toString("base64").replaceAll(",",""));let Xs=class extends Gs{newRemote(){let e;return typeof Window>"u"?e=new wt({remoteTimeout:this.remoteTimeout}):e=new wt({remoteTimeout:this.remoteTimeout}),e.uuid=Se.randomUUID(),this.remotes==null&&(this.remotes={}),this.remotes[e.uuid]=e,e}createRemote(e){let t=this.newRemote();return this.remoteIsUp(),this.ws?(e=this.ws,this.ws.onclose=function(s){this.rmRemote(s,t.uuid)}.bind(this),this.ws.onmessage=s=>{t.receive(s.data)}):(e.on("close",(s,i)=>this.rmRemote.bind(this)(s,t.uuid)),e.on("message",function(s,i){const r=i?s:s.toString();t.receive(r)})),this.setupRemote(t,e),t}remoteIsUp(){console.log("JRPCCommon::remoteIsUp")}rmRemote(e,t){if(this.server&&this.remotes[t]&&this.remotes[t].rpcs&&Object.keys(this.remotes[t].rpcs).forEach(s=>{this.server[s]&&delete this.server[s]}),Object.keys(this.remotes).length&&delete this.remotes[t],this.call&&Object.keys(this.remotes).length){let s=[];for(const i in this.remotes)this.remotes[i].rpcs&&(s=s.concat(Object.keys(this.remotes[i].rpcs)));if(this.call){let i=Object.keys(this.call);for(let r=0;r<i.length;r++)s.indexOf(i[r])<0&&delete this.call[i[r]]}}else this.call={};this.remoteDisconnected(t)}remoteDisconnected(e){console.log("JPRCCommon::remoteDisconnected "+e)}setupRemote(e,t){e.setTransmitter(this.transmit.bind(t)),this.classes&&this.classes.forEach(s=>{e.expose(s)}),e.upgrade(),e.call("system.listComponents",[],(s,i)=>{s?(console.log(s),console.log("Something went wrong when calling system.listComponents !")):this.setupFns(Object.keys(i),e)})}transmit(e,t){try{return this.send(e),t(!1)}catch(s){return console.log(s),t(!0)}}setupFns(e,t){e.forEach(s=>{t.rpcs==null&&(t.rpcs={}),t.rpcs[s]=function(i){return new Promise((r,a)=>{t.call(s,{args:Array.from(arguments)},(o,l)=>{o?(console.log("Error when calling remote function : "+s),a(o)):r(l)})})},this.call==null&&(this.call={}),this.call[s]==null&&(this.call[s]=(...i)=>{let r=[],a=[];for(const o in this.remotes)this.remotes[o].rpcs[s]!=null&&(a.push(o),r.push(this.remotes[o].rpcs[s](...i)));return Promise.all(r).then(o=>{let l={};return a.forEach((d,c)=>l[d]=o[c]),l})}),this.server==null&&(this.server={}),this.server[s]==null?this.server[s]=function(i){return new Promise((r,a)=>{t.call(s,{args:Array.from(arguments)},(o,l)=>{o?(console.log("Error when calling remote function : "+s),a(o)):r(l)})})}:this.server[s]=function(i){return new Promise((r,a)=>{a(new Error("More then one remote has this RPC, not sure who to talk to : "+s))})}}),this.setupDone()}setupDone(){}addClass(e,t){e.getRemotes=()=>this.remotes,e.getCall=()=>this.call,e.getServer=()=>this.server;let i=new Ws().exposeAllFns(e,t);if(this.classes==null?this.classes=[i]:this.classes.push(i),this.remotes!=null)for(const[r,a]of Object.entries(this.remotes))a.expose(i),a.upgrade()}};var Ys=Xs;Window.LitElement=H;Window.JRPC=qs;var Zs=Ys;class rt extends Zs{static get properties(){return{serverURI:{type:String},ws:{type:Object},server:{type:Object},remoteTimeout:{type:Number}}}constructor(){super(),this.remoteTimeout=60}updated(e){e.has("serverURI")&&this.serverURI&&this.serverURI!="undefined"&&this.serverChanged()}serverChanged(){this.ws!=null&&delete this.ws;try{this.ws=new WebSocket(this.serverURI),console.assert(this.ws.parent==null,"wss.parent already exists, this needs upgrade."),this.ws.addEventListener("open",this.createRemote.bind(this)),this.ws.addEventListener("error",this.wsError.bind(this))}catch(e){this.serverURI="",this.setupSkip(e)}}wsError(e){this.setupSkip(e)}isConnected(){return this.server!=null&&this.server!={}}setupSkip(){this.dispatchEvent(new CustomEvent("skip"))}setupDone(){this.dispatchEvent(new CustomEvent("done"))}}window.customElements.get("jrpc-client")||window.customElements.define("jrpc-client",rt);const Ks=N`
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
`;function Js(n){const e=n.files.length>0;return m`
    <div class="container ${n.visible?"":"hidden"}">
      ${e?m`
        <div class="file-tabs">
          <div class="tabs-left">
            ${n.files.map(t=>m`
              <button 
                class="file-tab ${n.selectedFile===t.path?"active":""}"
                @click=${()=>n.selectFile(t.path)}
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
              class="save-btn ${n.isDirty?"dirty":""}"
              @click=${()=>n.saveAllFiles()}
              ?disabled=${!n.isDirty}
              title="Save all changes (Ctrl+S)"
            >
              💾
            </button>
          </div>
        </div>
      `:m`
        <div class="empty-state">
          <div class="brand">AC⚡DC</div>
        </div>
      `}
      <div id="editor-container"></div>
    </div>
  `}const Qs="0.45.0",ei=`https://cdn.jsdelivr.net/npm/monaco-editor@${Qs}/min/vs`,We=ei;let we=!1;const ue=[];function ti(){if(we)return;if(window.monaco?.editor){ue.forEach(e=>e()),ue.length=0;return}we=!0;const n=document.createElement("script");n.src=`${We}/loader.js`,n.onerror=()=>{we=!1},n.onload=()=>{window.require.config({paths:{vs:We}}),window.require(["vs/editor/editor.main"],()=>{ue.forEach(e=>e()),ue.length=0},()=>{we=!1})},document.head.appendChild(n)}function si(n){window.monaco?.editor?n():ue.push(n)}const ii=n=>class extends n{initMonaco(){ti()}injectMonacoStyles(){const e=document.createElement("style");e.textContent=`@import url('${We}/editor/editor.main.css');`,this.shadowRoot.appendChild(e)}};function ni(n,e=["python","javascript","typescript"]){if(!window.monaco){console.warn("Monaco not loaded, cannot register symbol providers");return}for(const t of e)ri(n,t),ai(n,t),oi(n,t),li(n,t)}function ri(n,e){window.monaco.languages.registerHoverProvider(e,{async provideHover(t,s){try{const i=Le(t);if(!i)return null;const r=await n.call["LiteLLM.lsp_get_hover"](i,s.lineNumber,s.column),a=r?Object.values(r)[0]:null;if(a&&a.contents)return{contents:[{value:a.contents}]}}catch(i){console.error("Hover provider error:",i)}return null}})}function ai(n,e){window.monaco.languages.registerDefinitionProvider(e,{async provideDefinition(t,s){try{const i=Le(t);if(!i)return null;const r=await n.call["LiteLLM.lsp_get_definition"](i,s.lineNumber,s.column),a=r?Object.values(r)[0]:null;if(a&&a.file&&a.range){const o=a.range.start_line??a.range.start?.line,l=a.range.start_col??a.range.start?.col??0;return window.dispatchEvent(new CustomEvent("lsp-navigate-to-file",{detail:{file:a.file,line:o,column:l+1}})),null}}catch(i){console.error("Definition provider error:",i)}return null}})}function oi(n,e){window.monaco.languages.registerReferenceProvider(e,{async provideReferences(t,s,i){try{const r=Le(t);if(!r)return[];const a=await n.call["LiteLLM.lsp_get_references"](r,s.lineNumber,s.column),o=a?Object.values(a)[0]:null;if(Array.isArray(o))return o.map(l=>({uri:window.monaco.Uri.file(l.file_path),range:new window.monaco.Range(l.line,l.col+1,l.line,l.col+1)}))}catch(r){console.error("References provider error:",r)}return[]}})}function li(n,e){window.monaco.languages.registerCompletionItemProvider(e,{triggerCharacters:[".","_"],async provideCompletionItems(t,s){try{const i=Le(t);if(!i)return{suggestions:[]};const r=t.getWordUntilPosition(s),a=r?r.word:"",o=await n.call["LiteLLM.lsp_get_completions"](i,s.lineNumber,s.column,a),l=o?Object.values(o)[0]:null;if(Array.isArray(l))return{suggestions:l.map(c=>({label:c.label,kind:c.kind,detail:c.detail,documentation:c.documentation?{value:c.documentation}:void 0,insertText:c.insertText,insertTextRules:c.insertText?.includes("$0")?window.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet:void 0,sortText:c.sortText,range:{startLineNumber:s.lineNumber,startColumn:r?r.startColumn:s.column,endLineNumber:s.lineNumber,endColumn:s.column}}))}}catch(i){console.error("Completion provider error:",i)}return{suggestions:[]}}})}function Le(n){const e=n.uri;return e?e.scheme==="file"?e.path:n._associatedFilePath?n._associatedFilePath:e.path||null:null}function kt(n,e){n._associatedFilePath=e}const ci=n=>class extends n{initDiffEditor(){this._editor=null,this._models=new Map,this._dirtyFiles=new Set,this._contentListeners=new Map,this._lspProvidersRegistered=!1}createDiffEditor(){const e=this.shadowRoot.querySelector("#editor-container");!e||this._editor||(this._editor=window.monaco.editor.createDiffEditor(e,{theme:"vs-dark",automaticLayout:!0,readOnly:!1,originalEditable:!1,renderSideBySide:!0,minimap:{enabled:!1}}),this._editor.getModifiedEditor().addCommand(window.monaco.KeyMod.CtrlCmd|window.monaco.KeyCode.KeyS,()=>this.saveCurrentFile()),this._editor.getModifiedEditor().onMouseUp(t=>{t.event.ctrlKey&&t.target.position&&this._handleGoToDefinition(t.target.position)}),this._editor.getModifiedEditor().addCommand(window.monaco.KeyCode.F12,()=>{const t=this._editor.getModifiedEditor().getPosition();t&&this._handleGoToDefinition(t)}),this.files.length>0&&(this.updateModels(),this.showDiff(this.selectedFile||this.files[0].path)),typeof this._tryRegisterLspProviders=="function"&&this._tryRegisterLspProviders())}updateModels(){this._models.forEach(e=>{e.original.dispose(),e.modified.dispose()}),this._models.clear(),this._contentListeners.forEach(e=>e.dispose()),this._contentListeners.clear(),this._dirtyFiles.clear(),this.isDirty=!1;for(const e of this.files){const t=this.getLanguage(e.path),s=window.monaco.editor.createModel(e.original||"",t),i=window.monaco.editor.createModel(e.modified||"",t);kt(s,e.path),kt(i,e.path),this._models.set(e.path,{original:s,modified:i,savedContent:e.modified||""});const r=i.onDidChangeContent(()=>{const a=i.getValue(),o=this._models.get(e.path);a!==o.savedContent?this._dirtyFiles.add(e.path):this._dirtyFiles.delete(e.path),this.isDirty=this._dirtyFiles.size>0});this._contentListeners.set(e.path,r)}}showDiff(e){if(!this._editor||!e)return;const t=this._models.get(e);t&&this._editor.setModel({original:t.original,modified:t.modified})}async _handleGoToDefinition(e){if(!this.call)return;const t=this._editor?.getModifiedEditor()?.getModel();if(!t)return;const s=t._associatedFilePath;if(s)try{const i=await this.call["LiteLLM.lsp_get_definition"](s,e.lineNumber,e.column),r=i?Object.values(i)[0]:null;if(r&&r.file&&r.range){const a=r.range.start?.line||r.range.start_line,o=(r.range.start?.col||r.range.start_col||0)+1;window.dispatchEvent(new CustomEvent("lsp-navigate-to-file",{detail:{file:r.file,line:a,column:o}}))}}catch(i){console.error("Go to definition error:",i)}}getLanguage(e){const t=e.split(".").pop().toLowerCase();return{js:"javascript",mjs:"javascript",jsx:"javascript",ts:"typescript",tsx:"typescript",py:"python",json:"json",html:"html",css:"css",md:"markdown",yaml:"yaml",yml:"yaml",sh:"shell"}[t]||"plaintext"}disposeDiffEditor(){this._editor&&(this._editor.dispose(),this._editor=null),this._models.forEach(e=>{e.original.dispose(),e.modified.dispose()}),this._models.clear(),this._contentListeners.forEach(e=>e.dispose()),this._contentListeners.clear(),this._dirtyFiles.clear()}getOpenFilePaths(){return this.files.map(e=>e.path)}refreshFileContent(e,t,s){const i=this.files.findIndex(a=>a.path===e);if(i===-1)return!1;this.files=this.files.map((a,o)=>o===i?{...a,original:t,modified:s}:a);const r=this._models.get(e);return r&&(r.original.setValue(t),r.modified.setValue(s),r.savedContent=s,this._dirtyFiles.delete(e)),!0}clearFiles(){this.files=[],this.selectedFile=null,this.isDirty=!1,this._models.forEach(e=>{e.original.dispose(),e.modified.dispose()}),this._models.clear(),this._contentListeners.forEach(e=>e.dispose()),this._contentListeners.clear(),this._dirtyFiles.clear()}saveCurrentFile(){if(!this.selectedFile||!this._editor||!this._dirtyFiles.has(this.selectedFile))return;const t=this._editor.getModifiedEditor().getValue(),s=this._models.get(this.selectedFile);s&&(s.savedContent=t),this._dirtyFiles.delete(this.selectedFile),this.isDirty=this._dirtyFiles.size>0;const i=this.files?.find(r=>r.path===this.selectedFile);this.dispatchEvent(new CustomEvent("file-save",{detail:{path:this.selectedFile,content:t,isConfig:i?.isConfig,configType:i?.configType},bubbles:!0,composed:!0}))}saveAllFiles(){if(this._dirtyFiles.size===0)return;const e=[];for(const t of this._dirtyFiles){const s=this._models.get(t),i=this.files?.find(r=>r.path===t);if(s){const r=s.modified.getValue();s.savedContent=r,e.push({path:t,content:r,isConfig:i?.isConfig,configType:i?.configType})}}this._dirtyFiles.clear(),this.isDirty=!1,this.dispatchEvent(new CustomEvent("files-save",{detail:{files:e},bubbles:!0,composed:!0}))}},di=ci(ii(rt));class hi extends di{static properties={files:{type:Array},selectedFile:{type:String},visible:{type:Boolean},isDirty:{type:Boolean},serverURI:{type:String},viewingFile:{type:String}};static styles=Ks;constructor(){super(),this.files=[],this.selectedFile=null,this.visible=!1,this.isDirty=!1,this.initDiffEditor()}connectedCallback(){super.connectedCallback(),this.addClass(this,"DiffViewer"),this.initMonaco(),this._handleLspNavigate=this._handleLspNavigate.bind(this),window.addEventListener("lsp-navigate-to-file",this._handleLspNavigate)}firstUpdated(){this.injectMonacoStyles(),si(()=>{this.createDiffEditor()})}_tryRegisterLspProviders(){if(!this._lspProvidersRegistered&&!(!this._editor||!this._remoteIsUp))try{ni(this),this._lspProvidersRegistered=!0}catch(e){console.error("Failed to register LSP providers:",e)}}remoteIsUp(){this._remoteIsUp=!0,this._tryRegisterLspProviders()}setupDone(){}remoteDisconnected(e){this._remoteIsUp=!1,this._lspProvidersRegistered=!1}willUpdate(e){e.has("files")&&this.files.length>0&&(!this.selectedFile||!this.files.find(t=>t.path===this.selectedFile))&&(this.selectedFile=this.files[0].path)}updated(e){if(super.updated(e),e.has("files")&&this.files.length>0&&this._editor){const t=e.get("files")||[];this._filesActuallyChanged(t,this.files)&&(this.updateModels(),this.showDiff(this.selectedFile),this._emitFileSelected(this.selectedFile))}e.has("selectedFile")&&this.selectedFile&&this._editor&&(this.showDiff(this.selectedFile),this._emitFileSelected(this.selectedFile)),e.has("isDirty")&&this.dispatchEvent(new CustomEvent("isDirty-changed",{detail:{isDirty:this.isDirty},bubbles:!0,composed:!0}))}selectFile(e){this.selectedFile=e,this._emitFileSelected(e)}_filesActuallyChanged(e,t){if(e.length!==t.length)return!0;for(let s=0;s<t.length;s++){const i=e[s],r=t[s];if(!i||i.path!==r.path||i.original!==r.original||i.modified!==r.modified)return!0}return!1}_emitFileSelected(e){e&&this.dispatchEvent(new CustomEvent("file-selected",{detail:{path:e},bubbles:!0,composed:!0}))}disconnectedCallback(){super.disconnectedCallback(),this.disposeDiffEditor(),window.removeEventListener("lsp-navigate-to-file",this._handleLspNavigate)}_handleLspNavigate(e){const{file:t,line:s,column:i}=e.detail;if(this.files.find(a=>a.path===t)){this.selectedFile=t,this._revealPosition(s,i);return}this.dispatchEvent(new CustomEvent("request-file-load",{detail:{file:t,line:s,column:i,replace:!0},bubbles:!0,composed:!0}))}_revealPosition(e,t){if(!this._editor||!e)return;const s=this._editor.getModifiedEditor();s&&(s.revealLineInCenter(e),s.setPosition({lineNumber:e,column:t||1}),s.focus(),this._highlightLine(s,e))}_highlightLine(e,t){this._highlightDecorations&&e.deltaDecorations(this._highlightDecorations,[]),this._highlightDecorations=e.deltaDecorations([],[{range:new monaco.Range(t,1,t,1),options:{isWholeLine:!0,className:"line-highlight-decoration"}}]),setTimeout(()=>{this._highlightDecorations&&(e.deltaDecorations(this._highlightDecorations,[]),this._highlightDecorations=null)},1500)}_findLineByContent(e){if(!this._editor||!e)return null;const t=this._editor.getModifiedEditor();if(!t)return null;const s=t.getModel();if(!s)return null;const r=s.getValue().split(`
`),a=e.trim();for(let o=0;o<r.length;o++)if(r[o].includes(a)||r[o].trim()===a)return o+1;return null}render(){return Js(this)}}customElements.define("diff-viewer",hi);const ui="modulepreload",pi=function(n){return"/AI-Coder-DeCoder/d8fc861d/"+n},$t={},ce=function(e,t,s){let i=Promise.resolve();if(t&&t.length>0){document.getElementsByTagName("link");const a=document.querySelector("meta[property=csp-nonce]"),o=a?.nonce||a?.getAttribute("nonce");i=Promise.allSettled(t.map(l=>{if(l=pi(l),l in $t)return;$t[l]=!0;const d=l.endsWith(".css"),c=d?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${l}"]${c}`))return;const h=document.createElement("link");if(h.rel=d?"stylesheet":ui,d||(h.as="script"),h.crossOrigin="",h.href=l,o&&h.setAttribute("nonce",o),document.head.appendChild(h),d)return new Promise((p,g)=>{h.addEventListener("load",p),h.addEventListener("error",()=>g(new Error(`Unable to preload CSS for ${l}`)))})}))}function r(a){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=a,window.dispatchEvent(o),!o.defaultPrevented)throw a}return i.then(a=>{for(const o of a||[])o.status==="rejected"&&r(o.reason);return e().catch(r)})};class fi extends rt{static properties={serverURI:{type:String},messageHistory:{type:Array},_showScrollButton:{type:Boolean,state:!0}};constructor(){super(),this.messageHistory=[],this._messageId=0,this._userHasScrolledUp=!1,this._showScrollButton=!1}connectedCallback(){super.connectedCallback(),this.port&&(this.serverURI=`ws://localhost:${this.port}`)}handleWheel(e){e.deltaY<0&&(this._userHasScrolledUp=!0,this._showScrollButton=!0)}scrollToBottomNow(){this._userHasScrolledUp=!1,this._showScrollButton=!1,this._scrollPending=!1;const e=this.shadowRoot?.querySelector("#scroll-sentinel");e&&e.scrollIntoView({block:"end"})}addMessage(e,t,s=null,i=null){const r={id:this._messageId++,role:e,content:t,final:!0};s&&(r.images=s),i&&(r.editResults=i),this.messageHistory=[...this.messageHistory,r],this._scrollToBottom()}streamWrite(e,t=!1,s="assistant",i=null){this._pendingChunk={chunk:e,final:t,role:s,editResults:i},this._chunkRafPending||(this._chunkRafPending=!0,requestAnimationFrame(()=>{this._chunkRafPending=!1;const r=this._pendingChunk;r&&(this._pendingChunk=null,this._processStreamChunk(r.chunk,r.final,r.role,r.editResults))}))}_processStreamChunk(e,t,s,i=null){const r=this.messageHistory[this.messageHistory.length-1];if(r&&r.role===s&&!r.final)e&&(r.content=e),r.final=t,i&&i.length>0&&(r.editResults=i),this.requestUpdate("messageHistory");else{const a={id:this._messageId++,role:s,content:e,final:t};i&&i.length>0&&(a.editResults=i),this.messageHistory=[...this.messageHistory,a]}this._scrollToBottom()}_scrollToBottom(){this._userHasScrolledUp||this._scrollPending||(this._scrollPending=!0,this.updateComplete.then(()=>{requestAnimationFrame(()=>{if(this._scrollPending=!1,this._userHasScrolledUp)return;const e=this.shadowRoot?.querySelector("#scroll-sentinel");e&&e.scrollIntoView({block:"end"})})}))}clearHistory(){this.messageHistory=[],this._userHasScrolledUp=!1,this._showScrollButton=!1,this.requestUpdate()}setupScrollObserver(){const e=this.shadowRoot?.querySelector("#messages-container"),t=this.shadowRoot?.querySelector("#scroll-sentinel");!e||!t||this._intersectionObserver||(this._intersectionObserver=new IntersectionObserver(([s])=>{s.isIntersecting&&(this._userHasScrolledUp=!1,this._showScrollButton=!1)},{root:e}),this._intersectionObserver.observe(t))}disconnectScrollObserver(){this._intersectionObserver&&(this._intersectionObserver.disconnect(),this._intersectionObserver=null)}}const gi=N`
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
    position: relative;
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

  .files-tab-panel {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .tab-hidden {
    visibility: hidden !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    pointer-events: none !important;
    z-index: -1 !important;
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

  #scroll-sentinel {
    height: 0;
    margin: 0;
    padding: 0;
    border: none;
    flex-shrink: 0;
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
    position: relative;
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

  /* History search dropdown */
  .history-search-dropdown {
    position: absolute;
    bottom: 100%;
    left: 12px;
    right: 12px;
    max-height: 280px;
    display: flex;
    flex-direction: column;
    background: #1a1a2e;
    border: 1px solid #0f3460;
    border-radius: 8px 8px 0 0;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.4);
    z-index: 20;
    margin-bottom: -1px;
  }

  .history-overlay-input {
    width: 100%;
    padding: 8px 12px;
    background: #1a1a2e;
    border: none;
    border-top: 1px solid #0f3460;
    border-radius: 0;
    color: #eee;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .history-overlay-input:focus {
    border-top-color: #e94560;
  }

  .history-overlay-input::placeholder {
    color: #666;
  }

  .history-search-results {
    overflow-y: auto;
    max-height: 220px;
  }

  .history-search-empty {
    padding: 12px;
    text-align: center;
    color: #666;
    font-size: 13px;
  }

  .history-search-item {
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid rgba(15, 52, 96, 0.3);
    transition: background 0.1s;
  }

  .history-search-item:last-child {
    border-bottom: none;
  }

  .history-search-item:hover,
  .history-search-item.selected {
    background: rgba(233, 69, 96, 0.15);
  }

  .history-search-preview {
    color: #ccc;
    font-size: 13px;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }

  .history-search-item.selected .history-search-preview {
    color: #eee;
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
 */const is={CHILD:2},ns=n=>(...e)=>({_$litDirective$:n,values:e});let rs=class{constructor(e){}get _$AU(){return this._$AM._$AU}_$AT(e,t,s){this._$Ct=e,this._$AM=t,this._$Ci=s}_$AS(e,t){return this.update(e,t)}update(e,t){return this.render(...t)}};/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{I:mi}=Kt,St=n=>n,Ct=()=>document.createComment(""),de=(n,e,t)=>{const s=n._$AA.parentNode,i=e===void 0?n._$AB:e._$AA;if(t===void 0){const r=s.insertBefore(Ct(),i),a=s.insertBefore(Ct(),i);t=new mi(r,a,n,n.options)}else{const r=t._$AB.nextSibling,a=t._$AM,o=a!==n;if(o){let l;t._$AQ?.(n),t._$AM=n,t._$AP!==void 0&&(l=n._$AU)!==a._$AU&&t._$AP(l)}if(r!==i||o){let l=t._$AA;for(;l!==r;){const d=St(l).nextSibling;St(s).insertBefore(l,i),l=d}}}return t},K=(n,e,t=n)=>(n._$AI(e,t),n),bi={},yi=(n,e=bi)=>n._$AH=e,xi=n=>n._$AH,Ne=n=>{n._$AR(),n._$AA.remove()};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Et=(n,e,t)=>{const s=new Map;for(let i=e;i<=t;i++)s.set(n[i],i);return s},_i=ns(class extends rs{constructor(n){if(super(n),n.type!==is.CHILD)throw Error("repeat() can only be used in text expressions")}dt(n,e,t){let s;t===void 0?t=e:e!==void 0&&(s=e);const i=[],r=[];let a=0;for(const o of n)i[a]=s?s(o,a):a,r[a]=t(o,a),a++;return{values:r,keys:i}}render(n,e,t){return this.dt(n,e,t).values}update(n,[e,t,s]){const i=xi(n),{values:r,keys:a}=this.dt(e,t,s);if(!Array.isArray(i))return this.ut=a,r;const o=this.ut??=[],l=[];let d,c,h=0,p=i.length-1,g=0,k=r.length-1;for(;h<=p&&g<=k;)if(i[h]===null)h++;else if(i[p]===null)p--;else if(o[h]===a[g])l[g]=K(i[h],r[g]),h++,g++;else if(o[p]===a[k])l[k]=K(i[p],r[k]),p--,k--;else if(o[h]===a[k])l[k]=K(i[h],r[k]),de(n,l[k+1],i[h]),h++,k--;else if(o[p]===a[g])l[g]=K(i[p],r[g]),de(n,i[h],i[p]),p--,g++;else if(d===void 0&&(d=Et(a,g,k),c=Et(o,h,p)),d.has(o[h]))if(d.has(o[p])){const w=c.get(a[g]),v=w!==void 0?i[w]:null;if(v===null){const T=de(n,i[h]);K(T,r[g]),l[g]=T}else l[g]=K(v,r[g]),de(n,i[h],v),i[w]=null;g++}else Ne(i[p]),p--;else Ne(i[h]),h++;for(;g<=k;){const w=de(n,l[k+1]);K(w,r[g]),l[g++]=w}for(;h<=p;){const w=i[h++];w!==null&&Ne(w)}return this.ut=a,yi(n,l),G}});class vi extends H{static properties={content:{type:String},images:{type:Array}};constructor(){super(),this.content="",this.images=[]}static styles=N`
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
  `;copyToClipboard(){navigator.clipboard.writeText(this.content)}copyToPrompt(){this.dispatchEvent(new CustomEvent("copy-to-prompt",{detail:{content:this.content},bubbles:!0,composed:!0}))}openLightbox(e){const t=this.shadowRoot.querySelector("dialog"),s=t.querySelector("img");s.src=e,t.showModal()}handleDialogClick(e){const t=this.shadowRoot.querySelector("dialog"),s=t.getBoundingClientRect();(e.clientX<s.left||e.clientX>s.right||e.clientY<s.top||e.clientY>s.bottom)&&t.close()}render(){return m`
      <div class="card">
        <div class="header">
          <div class="label">You</div>
          <div class="actions">
            <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
            <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
          </div>
        </div>
        <div class="content">${this.content}</div>
        ${this.images&&this.images.length>0?m`
          <div class="images">
            ${this.images.map(e=>m`
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
    `}}customElements.define("user-card",vi);/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */class Ge extends rs{constructor(e){if(super(e),this.it=I,e.type!==is.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(e){if(e===I||e==null)return this._t=void 0,this.it=e;if(e===G)return e;if(typeof e!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(e===this.it)return this._t;this.it=e;const t=[e];return t.raw=t,this._t={_$litType$:this.constructor.resultType,strings:t,values:[]}}}Ge.directiveName="unsafeHTML",Ge.resultType=1;const je=ns(Ge);function at(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}let ie=at();function as(n){ie=n}const os=/[&<>"']/,wi=new RegExp(os.source,"g"),ls=/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,ki=new RegExp(ls.source,"g"),$i={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Ft=n=>$i[n];function U(n,e){if(e){if(os.test(n))return n.replace(wi,Ft)}else if(ls.test(n))return n.replace(ki,Ft);return n}const Si=/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig;function Ci(n){return n.replace(Si,(e,t)=>(t=t.toLowerCase(),t==="colon"?":":t.charAt(0)==="#"?t.charAt(1)==="x"?String.fromCharCode(parseInt(t.substring(2),16)):String.fromCharCode(+t.substring(1)):""))}const Ei=/(^|[^\[])\^/g;function R(n,e){n=typeof n=="string"?n:n.source,e=e||"";const t={replace:(s,i)=>(i=typeof i=="object"&&"source"in i?i.source:i,i=i.replace(Ei,"$1"),n=n.replace(s,i),t),getRegex:()=>new RegExp(n,e)};return t}function At(n){try{n=encodeURI(n).replace(/%25/g,"%")}catch{return null}return n}const Te={exec:()=>null};function Tt(n,e){const t=n.replace(/\|/g,(r,a,o)=>{let l=!1,d=a;for(;--d>=0&&o[d]==="\\";)l=!l;return l?"|":" |"}),s=t.split(/ \|/);let i=0;if(s[0].trim()||s.shift(),s.length>0&&!s[s.length-1].trim()&&s.pop(),e)if(s.length>e)s.splice(e);else for(;s.length<e;)s.push("");for(;i<s.length;i++)s[i]=s[i].trim().replace(/\\\|/g,"|");return s}function ke(n,e,t){const s=n.length;if(s===0)return"";let i=0;for(;i<s&&n.charAt(s-i-1)===e;)i++;return n.slice(0,s-i)}function Fi(n,e){if(n.indexOf(e[1])===-1)return-1;let t=0;for(let s=0;s<n.length;s++)if(n[s]==="\\")s++;else if(n[s]===e[0])t++;else if(n[s]===e[1]&&(t--,t<0))return s;return-1}function Rt(n,e,t,s){const i=e.href,r=e.title?U(e.title):null,a=n[1].replace(/\\([\[\]])/g,"$1");if(n[0].charAt(0)!=="!"){s.state.inLink=!0;const o={type:"link",raw:t,href:i,title:r,text:a,tokens:s.inlineTokens(a)};return s.state.inLink=!1,o}return{type:"image",raw:t,href:i,title:r,text:U(a)}}function Ai(n,e){const t=n.match(/^(\s+)(?:```)/);if(t===null)return e;const s=t[1];return e.split(`
`).map(i=>{const r=i.match(/^\s+/);if(r===null)return i;const[a]=r;return a.length>=s.length?i.slice(s.length):i}).join(`
`)}class Re{options;rules;lexer;constructor(e){this.options=e||ie}space(e){const t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return{type:"space",raw:t[0]}}code(e){const t=this.rules.block.code.exec(e);if(t){const s=t[0].replace(/^ {1,4}/gm,"");return{type:"code",raw:t[0],codeBlockStyle:"indented",text:this.options.pedantic?s:ke(s,`
`)}}}fences(e){const t=this.rules.block.fences.exec(e);if(t){const s=t[0],i=Ai(s,t[3]||"");return{type:"code",raw:s,lang:t[2]?t[2].trim().replace(this.rules.inline._escapes,"$1"):t[2],text:i}}}heading(e){const t=this.rules.block.heading.exec(e);if(t){let s=t[2].trim();if(/#$/.test(s)){const i=ke(s,"#");(this.options.pedantic||!i||/ $/.test(i))&&(s=i.trim())}return{type:"heading",raw:t[0],depth:t[1].length,text:s,tokens:this.lexer.inline(s)}}}hr(e){const t=this.rules.block.hr.exec(e);if(t)return{type:"hr",raw:t[0]}}blockquote(e){const t=this.rules.block.blockquote.exec(e);if(t){const s=ke(t[0].replace(/^ *>[ \t]?/gm,""),`
`),i=this.lexer.state.top;this.lexer.state.top=!0;const r=this.lexer.blockTokens(s);return this.lexer.state.top=i,{type:"blockquote",raw:t[0],tokens:r,text:s}}}list(e){let t=this.rules.block.list.exec(e);if(t){let s=t[1].trim();const i=s.length>1,r={type:"list",raw:"",ordered:i,start:i?+s.slice(0,-1):"",loose:!1,items:[]};s=i?`\\d{1,9}\\${s.slice(-1)}`:`\\${s}`,this.options.pedantic&&(s=i?s:"[*+-]");const a=new RegExp(`^( {0,3}${s})((?:[	 ][^\\n]*)?(?:\\n|$))`);let o="",l="",d=!1;for(;e;){let c=!1;if(!(t=a.exec(e))||this.rules.block.hr.test(e))break;o=t[0],e=e.substring(o.length);let h=t[2].split(`
`,1)[0].replace(/^\t+/,T=>" ".repeat(3*T.length)),p=e.split(`
`,1)[0],g=0;this.options.pedantic?(g=2,l=h.trimStart()):(g=t[2].search(/[^ ]/),g=g>4?1:g,l=h.slice(g),g+=t[1].length);let k=!1;if(!h&&/^ *$/.test(p)&&(o+=p+`
`,e=e.substring(p.length+1),c=!0),!c){const T=new RegExp(`^ {0,${Math.min(3,g-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),f=new RegExp(`^ {0,${Math.min(3,g-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),u=new RegExp(`^ {0,${Math.min(3,g-1)}}(?:\`\`\`|~~~)`),b=new RegExp(`^ {0,${Math.min(3,g-1)}}#`);for(;e;){const y=e.split(`
`,1)[0];if(p=y,this.options.pedantic&&(p=p.replace(/^ {1,4}(?=( {4})*[^ ])/g,"  ")),u.test(p)||b.test(p)||T.test(p)||f.test(e))break;if(p.search(/[^ ]/)>=g||!p.trim())l+=`
`+p.slice(g);else{if(k||h.search(/[^ ]/)>=4||u.test(h)||b.test(h)||f.test(h))break;l+=`
`+p}!k&&!p.trim()&&(k=!0),o+=y+`
`,e=e.substring(y.length+1),h=p.slice(g)}}r.loose||(d?r.loose=!0:/\n *\n *$/.test(o)&&(d=!0));let w=null,v;this.options.gfm&&(w=/^\[[ xX]\] /.exec(l),w&&(v=w[0]!=="[ ] ",l=l.replace(/^\[[ xX]\] +/,""))),r.items.push({type:"list_item",raw:o,task:!!w,checked:v,loose:!1,text:l,tokens:[]}),r.raw+=o}r.items[r.items.length-1].raw=o.trimEnd(),r.items[r.items.length-1].text=l.trimEnd(),r.raw=r.raw.trimEnd();for(let c=0;c<r.items.length;c++)if(this.lexer.state.top=!1,r.items[c].tokens=this.lexer.blockTokens(r.items[c].text,[]),!r.loose){const h=r.items[c].tokens.filter(g=>g.type==="space"),p=h.length>0&&h.some(g=>/\n.*\n/.test(g.raw));r.loose=p}if(r.loose)for(let c=0;c<r.items.length;c++)r.items[c].loose=!0;return r}}html(e){const t=this.rules.block.html.exec(e);if(t)return{type:"html",block:!0,raw:t[0],pre:t[1]==="pre"||t[1]==="script"||t[1]==="style",text:t[0]}}def(e){const t=this.rules.block.def.exec(e);if(t){const s=t[1].toLowerCase().replace(/\s+/g," "),i=t[2]?t[2].replace(/^<(.*)>$/,"$1").replace(this.rules.inline._escapes,"$1"):"",r=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline._escapes,"$1"):t[3];return{type:"def",tag:s,raw:t[0],href:i,title:r}}}table(e){const t=this.rules.block.table.exec(e);if(t){if(!/[:|]/.test(t[2]))return;const s={type:"table",raw:t[0],header:Tt(t[1]).map(i=>({text:i,tokens:[]})),align:t[2].replace(/^\||\| *$/g,"").split("|"),rows:t[3]&&t[3].trim()?t[3].replace(/\n[ \t]*$/,"").split(`
`):[]};if(s.header.length===s.align.length){let i=s.align.length,r,a,o,l;for(r=0;r<i;r++){const d=s.align[r];d&&(/^ *-+: *$/.test(d)?s.align[r]="right":/^ *:-+: *$/.test(d)?s.align[r]="center":/^ *:-+ *$/.test(d)?s.align[r]="left":s.align[r]=null)}for(i=s.rows.length,r=0;r<i;r++)s.rows[r]=Tt(s.rows[r],s.header.length).map(d=>({text:d,tokens:[]}));for(i=s.header.length,a=0;a<i;a++)s.header[a].tokens=this.lexer.inline(s.header[a].text);for(i=s.rows.length,a=0;a<i;a++)for(l=s.rows[a],o=0;o<l.length;o++)l[o].tokens=this.lexer.inline(l[o].text);return s}}}lheading(e){const t=this.rules.block.lheading.exec(e);if(t)return{type:"heading",raw:t[0],depth:t[2].charAt(0)==="="?1:2,text:t[1],tokens:this.lexer.inline(t[1])}}paragraph(e){const t=this.rules.block.paragraph.exec(e);if(t){const s=t[1].charAt(t[1].length-1)===`
`?t[1].slice(0,-1):t[1];return{type:"paragraph",raw:t[0],text:s,tokens:this.lexer.inline(s)}}}text(e){const t=this.rules.block.text.exec(e);if(t)return{type:"text",raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){const t=this.rules.inline.escape.exec(e);if(t)return{type:"escape",raw:t[0],text:U(t[1])}}tag(e){const t=this.rules.inline.tag.exec(e);if(t)return!this.lexer.state.inLink&&/^<a /i.test(t[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&/^<\/a>/i.test(t[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&/^<(pre|code|kbd|script)(\s|>)/i.test(t[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&/^<\/(pre|code|kbd|script)(\s|>)/i.test(t[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:t[0]}}link(e){const t=this.rules.inline.link.exec(e);if(t){const s=t[2].trim();if(!this.options.pedantic&&/^</.test(s)){if(!/>$/.test(s))return;const a=ke(s.slice(0,-1),"\\");if((s.length-a.length)%2===0)return}else{const a=Fi(t[2],"()");if(a>-1){const l=(t[0].indexOf("!")===0?5:4)+t[1].length+a;t[2]=t[2].substring(0,a),t[0]=t[0].substring(0,l).trim(),t[3]=""}}let i=t[2],r="";if(this.options.pedantic){const a=/^([^'"]*[^\s])\s+(['"])(.*)\2/.exec(i);a&&(i=a[1],r=a[3])}else r=t[3]?t[3].slice(1,-1):"";return i=i.trim(),/^</.test(i)&&(this.options.pedantic&&!/>$/.test(s)?i=i.slice(1):i=i.slice(1,-1)),Rt(t,{href:i&&i.replace(this.rules.inline._escapes,"$1"),title:r&&r.replace(this.rules.inline._escapes,"$1")},t[0],this.lexer)}}reflink(e,t){let s;if((s=this.rules.inline.reflink.exec(e))||(s=this.rules.inline.nolink.exec(e))){let i=(s[2]||s[1]).replace(/\s+/g," ");if(i=t[i.toLowerCase()],!i){const r=s[0].charAt(0);return{type:"text",raw:r,text:r}}return Rt(s,i,s[0],this.lexer)}}emStrong(e,t,s=""){let i=this.rules.inline.emStrong.lDelim.exec(e);if(!i||i[3]&&s.match(/[\p{L}\p{N}]/u))return;if(!(i[1]||i[2]||"")||!s||this.rules.inline.punctuation.exec(s)){const a=[...i[0]].length-1;let o,l,d=a,c=0;const h=i[0][0]==="*"?this.rules.inline.emStrong.rDelimAst:this.rules.inline.emStrong.rDelimUnd;for(h.lastIndex=0,t=t.slice(-1*e.length+a);(i=h.exec(t))!=null;){if(o=i[1]||i[2]||i[3]||i[4]||i[5]||i[6],!o)continue;if(l=[...o].length,i[3]||i[4]){d+=l;continue}else if((i[5]||i[6])&&a%3&&!((a+l)%3)){c+=l;continue}if(d-=l,d>0)continue;l=Math.min(l,l+d+c);const p=[...i[0]][0].length,g=e.slice(0,a+i.index+p+l);if(Math.min(a,l)%2){const w=g.slice(1,-1);return{type:"em",raw:g,text:w,tokens:this.lexer.inlineTokens(w)}}const k=g.slice(2,-2);return{type:"strong",raw:g,text:k,tokens:this.lexer.inlineTokens(k)}}}}codespan(e){const t=this.rules.inline.code.exec(e);if(t){let s=t[2].replace(/\n/g," ");const i=/[^ ]/.test(s),r=/^ /.test(s)&&/ $/.test(s);return i&&r&&(s=s.substring(1,s.length-1)),s=U(s,!0),{type:"codespan",raw:t[0],text:s}}}br(e){const t=this.rules.inline.br.exec(e);if(t)return{type:"br",raw:t[0]}}del(e){const t=this.rules.inline.del.exec(e);if(t)return{type:"del",raw:t[0],text:t[2],tokens:this.lexer.inlineTokens(t[2])}}autolink(e){const t=this.rules.inline.autolink.exec(e);if(t){let s,i;return t[2]==="@"?(s=U(t[1]),i="mailto:"+s):(s=U(t[1]),i=s),{type:"link",raw:t[0],text:s,href:i,tokens:[{type:"text",raw:s,text:s}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let s,i;if(t[2]==="@")s=U(t[0]),i="mailto:"+s;else{let r;do r=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])[0];while(r!==t[0]);s=U(t[0]),t[1]==="www."?i="http://"+t[0]:i=t[0]}return{type:"link",raw:t[0],text:s,href:i,tokens:[{type:"text",raw:s,text:s}]}}}inlineText(e){const t=this.rules.inline.text.exec(e);if(t){let s;return this.lexer.state.inRawBlock?s=t[0]:s=U(t[0]),{type:"text",raw:t[0],text:s}}}}const $={newline:/^(?: *(?:\n|$))+/,code:/^( {4}[^\n]+(?:\n(?: *(?:\n|$))*)?)+/,fences:/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,hr:/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,heading:/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,blockquote:/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/,list:/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/,html:"^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n *)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n *)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n *)+\\n|$))",def:/^ {0,3}\[(label)\]: *(?:\n *)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n *)?| *\n *)(title))? *(?:\n+|$)/,table:Te,lheading:/^(?!bull )((?:.|\n(?!\s*?\n|bull ))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,_paragraph:/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,text:/^[^\n]+/};$._label=/(?!\s*\])(?:\\.|[^\[\]\\])+/;$._title=/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/;$.def=R($.def).replace("label",$._label).replace("title",$._title).getRegex();$.bullet=/(?:[*+-]|\d{1,9}[.)])/;$.listItemStart=R(/^( *)(bull) */).replace("bull",$.bullet).getRegex();$.list=R($.list).replace(/bull/g,$.bullet).replace("hr","\\n+(?=\\1?(?:(?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$))").replace("def","\\n+(?="+$.def.source+")").getRegex();$._tag="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";$._comment=/<!--(?!-?>)[\s\S]*?(?:-->|$)/;$.html=R($.html,"i").replace("comment",$._comment).replace("tag",$._tag).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();$.lheading=R($.lheading).replace(/bull/g,$.bullet).getRegex();$.paragraph=R($._paragraph).replace("hr",$.hr).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",$._tag).getRegex();$.blockquote=R($.blockquote).replace("paragraph",$.paragraph).getRegex();$.normal={...$};$.gfm={...$.normal,table:"^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)"};$.gfm.table=R($.gfm.table).replace("hr",$.hr).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code"," {4}[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",$._tag).getRegex();$.gfm.paragraph=R($._paragraph).replace("hr",$.hr).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",$.gfm.table).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",$._tag).getRegex();$.pedantic={...$.normal,html:R(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",$._comment).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:Te,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:R($.normal._paragraph).replace("hr",$.hr).replace("heading",` *#{1,6} *[^
]`).replace("lheading",$.lheading).replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").getRegex()};const _={escape:/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,autolink:/^<(scheme:[^\s\x00-\x1f<>]*|email)>/,url:Te,tag:"^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>",link:/^!?\[(label)\]\(\s*(href)(?:\s+(title))?\s*\)/,reflink:/^!?\[(label)\]\[(ref)\]/,nolink:/^!?\[(ref)\](?:\[\])?/,reflinkSearch:"reflink|nolink(?!\\()",emStrong:{lDelim:/^(?:\*+(?:((?!\*)[punct])|[^\s*]))|^_+(?:((?!_)[punct])|([^\s_]))/,rDelimAst:/^[^_*]*?__[^_*]*?\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\*)[punct](\*+)(?=[\s]|$)|[^punct\s](\*+)(?!\*)(?=[punct\s]|$)|(?!\*)[punct\s](\*+)(?=[^punct\s])|[\s](\*+)(?!\*)(?=[punct])|(?!\*)[punct](\*+)(?!\*)(?=[punct])|[^punct\s](\*+)(?=[^punct\s])/,rDelimUnd:/^[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)|[^_]+(?=[^_])|(?!_)[punct](_+)(?=[\s]|$)|[^punct\s](_+)(?!_)(?=[punct\s]|$)|(?!_)[punct\s](_+)(?=[^punct\s])|[\s](_+)(?!_)(?=[punct])|(?!_)[punct](_+)(?!_)(?=[punct])/},code:/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,br:/^( {2,}|\\)\n(?!\s*$)/,del:Te,text:/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,punctuation:/^((?![*_])[\spunctuation])/};_._punctuation="\\p{P}$+<=>`^|~";_.punctuation=R(_.punctuation,"u").replace(/punctuation/g,_._punctuation).getRegex();_.blockSkip=/\[[^[\]]*?\]\([^\(\)]*?\)|`[^`]*?`|<[^<>]*?>/g;_.anyPunctuation=/\\[punct]/g;_._escapes=/\\([punct])/g;_._comment=R($._comment).replace("(?:-->|$)","-->").getRegex();_.emStrong.lDelim=R(_.emStrong.lDelim,"u").replace(/punct/g,_._punctuation).getRegex();_.emStrong.rDelimAst=R(_.emStrong.rDelimAst,"gu").replace(/punct/g,_._punctuation).getRegex();_.emStrong.rDelimUnd=R(_.emStrong.rDelimUnd,"gu").replace(/punct/g,_._punctuation).getRegex();_.anyPunctuation=R(_.anyPunctuation,"gu").replace(/punct/g,_._punctuation).getRegex();_._escapes=R(_._escapes,"gu").replace(/punct/g,_._punctuation).getRegex();_._scheme=/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/;_._email=/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/;_.autolink=R(_.autolink).replace("scheme",_._scheme).replace("email",_._email).getRegex();_._attribute=/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/;_.tag=R(_.tag).replace("comment",_._comment).replace("attribute",_._attribute).getRegex();_._label=/(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/;_._href=/<(?:\\.|[^\n<>\\])+>|[^\s\x00-\x1f]*/;_._title=/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/;_.link=R(_.link).replace("label",_._label).replace("href",_._href).replace("title",_._title).getRegex();_.reflink=R(_.reflink).replace("label",_._label).replace("ref",$._label).getRegex();_.nolink=R(_.nolink).replace("ref",$._label).getRegex();_.reflinkSearch=R(_.reflinkSearch,"g").replace("reflink",_.reflink).replace("nolink",_.nolink).getRegex();_.normal={..._};_.pedantic={..._.normal,strong:{start:/^__|\*\*/,middle:/^__(?=\S)([\s\S]*?\S)__(?!_)|^\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/,endAst:/\*\*(?!\*)/g,endUnd:/__(?!_)/g},em:{start:/^_|\*/,middle:/^()\*(?=\S)([\s\S]*?\S)\*(?!\*)|^_(?=\S)([\s\S]*?\S)_(?!_)/,endAst:/\*(?!\*)/g,endUnd:/_(?!_)/g},link:R(/^!?\[(label)\]\((.*?)\)/).replace("label",_._label).getRegex(),reflink:R(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",_._label).getRegex()};_.gfm={..._.normal,escape:R(_.escape).replace("])","~|])").getRegex(),_extended_email:/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/,url:/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/,_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/,text:/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/};_.gfm.url=R(_.gfm.url,"i").replace("email",_.gfm._extended_email).getRegex();_.breaks={..._.gfm,br:R(_.br).replace("{2,}","*").getRegex(),text:R(_.gfm.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()};class B{tokens;options;state;tokenizer;inlineQueue;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||ie,this.options.tokenizer=this.options.tokenizer||new Re,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};const t={block:$.normal,inline:_.normal};this.options.pedantic?(t.block=$.pedantic,t.inline=_.pedantic):this.options.gfm&&(t.block=$.gfm,this.options.breaks?t.inline=_.breaks:t.inline=_.gfm),this.tokenizer.rules=t}static get rules(){return{block:$,inline:_}}static lex(e,t){return new B(t).lex(e)}static lexInline(e,t){return new B(t).inlineTokens(e)}lex(e){e=e.replace(/\r\n|\r/g,`
`),this.blockTokens(e,this.tokens);let t;for(;t=this.inlineQueue.shift();)this.inlineTokens(t.src,t.tokens);return this.tokens}blockTokens(e,t=[]){this.options.pedantic?e=e.replace(/\t/g,"    ").replace(/^ +$/gm,""):e=e.replace(/^( *)(\t+)/gm,(o,l,d)=>l+"    ".repeat(d.length));let s,i,r,a;for(;e;)if(!(this.options.extensions&&this.options.extensions.block&&this.options.extensions.block.some(o=>(s=o.call({lexer:this},e,t))?(e=e.substring(s.raw.length),t.push(s),!0):!1))){if(s=this.tokenizer.space(e)){e=e.substring(s.raw.length),s.raw.length===1&&t.length>0?t[t.length-1].raw+=`
`:t.push(s);continue}if(s=this.tokenizer.code(e)){e=e.substring(s.raw.length),i=t[t.length-1],i&&(i.type==="paragraph"||i.type==="text")?(i.raw+=`
`+s.raw,i.text+=`
`+s.text,this.inlineQueue[this.inlineQueue.length-1].src=i.text):t.push(s);continue}if(s=this.tokenizer.fences(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.heading(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.hr(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.blockquote(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.list(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.html(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.def(e)){e=e.substring(s.raw.length),i=t[t.length-1],i&&(i.type==="paragraph"||i.type==="text")?(i.raw+=`
`+s.raw,i.text+=`
`+s.raw,this.inlineQueue[this.inlineQueue.length-1].src=i.text):this.tokens.links[s.tag]||(this.tokens.links[s.tag]={href:s.href,title:s.title});continue}if(s=this.tokenizer.table(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.lheading(e)){e=e.substring(s.raw.length),t.push(s);continue}if(r=e,this.options.extensions&&this.options.extensions.startBlock){let o=1/0;const l=e.slice(1);let d;this.options.extensions.startBlock.forEach(c=>{d=c.call({lexer:this},l),typeof d=="number"&&d>=0&&(o=Math.min(o,d))}),o<1/0&&o>=0&&(r=e.substring(0,o+1))}if(this.state.top&&(s=this.tokenizer.paragraph(r))){i=t[t.length-1],a&&i.type==="paragraph"?(i.raw+=`
`+s.raw,i.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue[this.inlineQueue.length-1].src=i.text):t.push(s),a=r.length!==e.length,e=e.substring(s.raw.length);continue}if(s=this.tokenizer.text(e)){e=e.substring(s.raw.length),i=t[t.length-1],i&&i.type==="text"?(i.raw+=`
`+s.raw,i.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue[this.inlineQueue.length-1].src=i.text):t.push(s);continue}if(e){const o="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(o);break}else throw new Error(o)}}return this.state.top=!0,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}inlineTokens(e,t=[]){let s,i,r,a=e,o,l,d;if(this.tokens.links){const c=Object.keys(this.tokens.links);if(c.length>0)for(;(o=this.tokenizer.rules.inline.reflinkSearch.exec(a))!=null;)c.includes(o[0].slice(o[0].lastIndexOf("[")+1,-1))&&(a=a.slice(0,o.index)+"["+"a".repeat(o[0].length-2)+"]"+a.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(o=this.tokenizer.rules.inline.blockSkip.exec(a))!=null;)a=a.slice(0,o.index)+"["+"a".repeat(o[0].length-2)+"]"+a.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);for(;(o=this.tokenizer.rules.inline.anyPunctuation.exec(a))!=null;)a=a.slice(0,o.index)+"++"+a.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);for(;e;)if(l||(d=""),l=!1,!(this.options.extensions&&this.options.extensions.inline&&this.options.extensions.inline.some(c=>(s=c.call({lexer:this},e,t))?(e=e.substring(s.raw.length),t.push(s),!0):!1))){if(s=this.tokenizer.escape(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.tag(e)){e=e.substring(s.raw.length),i=t[t.length-1],i&&s.type==="text"&&i.type==="text"?(i.raw+=s.raw,i.text+=s.text):t.push(s);continue}if(s=this.tokenizer.link(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(s.raw.length),i=t[t.length-1],i&&s.type==="text"&&i.type==="text"?(i.raw+=s.raw,i.text+=s.text):t.push(s);continue}if(s=this.tokenizer.emStrong(e,a,d)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.codespan(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.br(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.del(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.autolink(e)){e=e.substring(s.raw.length),t.push(s);continue}if(!this.state.inLink&&(s=this.tokenizer.url(e))){e=e.substring(s.raw.length),t.push(s);continue}if(r=e,this.options.extensions&&this.options.extensions.startInline){let c=1/0;const h=e.slice(1);let p;this.options.extensions.startInline.forEach(g=>{p=g.call({lexer:this},h),typeof p=="number"&&p>=0&&(c=Math.min(c,p))}),c<1/0&&c>=0&&(r=e.substring(0,c+1))}if(s=this.tokenizer.inlineText(r)){e=e.substring(s.raw.length),s.raw.slice(-1)!=="_"&&(d=s.raw.slice(-1)),l=!0,i=t[t.length-1],i&&i.type==="text"?(i.raw+=s.raw,i.text+=s.text):t.push(s);continue}if(e){const c="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(c);break}else throw new Error(c)}}return t}}class Pe{options;constructor(e){this.options=e||ie}code(e,t,s){const i=(t||"").match(/^\S*/)?.[0];return e=e.replace(/\n$/,"")+`
`,i?'<pre><code class="language-'+U(i)+'">'+(s?e:U(e,!0))+`</code></pre>
`:"<pre><code>"+(s?e:U(e,!0))+`</code></pre>
`}blockquote(e){return`<blockquote>
${e}</blockquote>
`}html(e,t){return e}heading(e,t,s){return`<h${t}>${e}</h${t}>
`}hr(){return`<hr>
`}list(e,t,s){const i=t?"ol":"ul",r=t&&s!==1?' start="'+s+'"':"";return"<"+i+r+`>
`+e+"</"+i+`>
`}listitem(e,t,s){return`<li>${e}</li>
`}checkbox(e){return"<input "+(e?'checked="" ':"")+'disabled="" type="checkbox">'}paragraph(e){return`<p>${e}</p>
`}table(e,t){return t&&(t=`<tbody>${t}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+t+`</table>
`}tablerow(e){return`<tr>
${e}</tr>
`}tablecell(e,t){const s=t.header?"th":"td";return(t.align?`<${s} align="${t.align}">`:`<${s}>`)+e+`</${s}>
`}strong(e){return`<strong>${e}</strong>`}em(e){return`<em>${e}</em>`}codespan(e){return`<code>${e}</code>`}br(){return"<br>"}del(e){return`<del>${e}</del>`}link(e,t,s){const i=At(e);if(i===null)return s;e=i;let r='<a href="'+e+'"';return t&&(r+=' title="'+t+'"'),r+=">"+s+"</a>",r}image(e,t,s){const i=At(e);if(i===null)return s;e=i;let r=`<img src="${e}" alt="${s}"`;return t&&(r+=` title="${t}"`),r+=">",r}text(e){return e}}class ot{strong(e){return e}em(e){return e}codespan(e){return e}del(e){return e}html(e){return e}text(e){return e}link(e,t,s){return""+s}image(e,t,s){return""+s}br(){return""}}class q{options;renderer;textRenderer;constructor(e){this.options=e||ie,this.options.renderer=this.options.renderer||new Pe,this.renderer=this.options.renderer,this.renderer.options=this.options,this.textRenderer=new ot}static parse(e,t){return new q(t).parse(e)}static parseInline(e,t){return new q(t).parseInline(e)}parse(e,t=!0){let s="";for(let i=0;i<e.length;i++){const r=e[i];if(this.options.extensions&&this.options.extensions.renderers&&this.options.extensions.renderers[r.type]){const a=r,o=this.options.extensions.renderers[a.type].call({parser:this},a);if(o!==!1||!["space","hr","heading","code","table","blockquote","list","html","paragraph","text"].includes(a.type)){s+=o||"";continue}}switch(r.type){case"space":continue;case"hr":{s+=this.renderer.hr();continue}case"heading":{const a=r;s+=this.renderer.heading(this.parseInline(a.tokens),a.depth,Ci(this.parseInline(a.tokens,this.textRenderer)));continue}case"code":{const a=r;s+=this.renderer.code(a.text,a.lang,!!a.escaped);continue}case"table":{const a=r;let o="",l="";for(let c=0;c<a.header.length;c++)l+=this.renderer.tablecell(this.parseInline(a.header[c].tokens),{header:!0,align:a.align[c]});o+=this.renderer.tablerow(l);let d="";for(let c=0;c<a.rows.length;c++){const h=a.rows[c];l="";for(let p=0;p<h.length;p++)l+=this.renderer.tablecell(this.parseInline(h[p].tokens),{header:!1,align:a.align[p]});d+=this.renderer.tablerow(l)}s+=this.renderer.table(o,d);continue}case"blockquote":{const a=r,o=this.parse(a.tokens);s+=this.renderer.blockquote(o);continue}case"list":{const a=r,o=a.ordered,l=a.start,d=a.loose;let c="";for(let h=0;h<a.items.length;h++){const p=a.items[h],g=p.checked,k=p.task;let w="";if(p.task){const v=this.renderer.checkbox(!!g);d?p.tokens.length>0&&p.tokens[0].type==="paragraph"?(p.tokens[0].text=v+" "+p.tokens[0].text,p.tokens[0].tokens&&p.tokens[0].tokens.length>0&&p.tokens[0].tokens[0].type==="text"&&(p.tokens[0].tokens[0].text=v+" "+p.tokens[0].tokens[0].text)):p.tokens.unshift({type:"text",text:v+" "}):w+=v+" "}w+=this.parse(p.tokens,d),c+=this.renderer.listitem(w,k,!!g)}s+=this.renderer.list(c,o,l);continue}case"html":{const a=r;s+=this.renderer.html(a.text,a.block);continue}case"paragraph":{const a=r;s+=this.renderer.paragraph(this.parseInline(a.tokens));continue}case"text":{let a=r,o=a.tokens?this.parseInline(a.tokens):a.text;for(;i+1<e.length&&e[i+1].type==="text";)a=e[++i],o+=`
`+(a.tokens?this.parseInline(a.tokens):a.text);s+=t?this.renderer.paragraph(o):o;continue}default:{const a='Token with "'+r.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return s}parseInline(e,t){t=t||this.renderer;let s="";for(let i=0;i<e.length;i++){const r=e[i];if(this.options.extensions&&this.options.extensions.renderers&&this.options.extensions.renderers[r.type]){const a=this.options.extensions.renderers[r.type].call({parser:this},r);if(a!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(r.type)){s+=a||"";continue}}switch(r.type){case"escape":{const a=r;s+=t.text(a.text);break}case"html":{const a=r;s+=t.html(a.text);break}case"link":{const a=r;s+=t.link(a.href,a.title,this.parseInline(a.tokens,t));break}case"image":{const a=r;s+=t.image(a.href,a.title,a.text);break}case"strong":{const a=r;s+=t.strong(this.parseInline(a.tokens,t));break}case"em":{const a=r;s+=t.em(this.parseInline(a.tokens,t));break}case"codespan":{const a=r;s+=t.codespan(a.text);break}case"br":{s+=t.br();break}case"del":{const a=r;s+=t.del(this.parseInline(a.tokens,t));break}case"text":{const a=r;s+=t.text(a.text);break}default:{const a='Token with "'+r.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return s}}class Ce{options;constructor(e){this.options=e||ie}static passThroughHooks=new Set(["preprocess","postprocess"]);preprocess(e){return e}postprocess(e){return e}}class Ti{defaults=at();options=this.setOptions;parse=this.#e(B.lex,q.parse);parseInline=this.#e(B.lexInline,q.parseInline);Parser=q;Renderer=Pe;TextRenderer=ot;Lexer=B;Tokenizer=Re;Hooks=Ce;constructor(...e){this.use(...e)}walkTokens(e,t){let s=[];for(const i of e)switch(s=s.concat(t.call(this,i)),i.type){case"table":{const r=i;for(const a of r.header)s=s.concat(this.walkTokens(a.tokens,t));for(const a of r.rows)for(const o of a)s=s.concat(this.walkTokens(o.tokens,t));break}case"list":{const r=i;s=s.concat(this.walkTokens(r.items,t));break}default:{const r=i;this.defaults.extensions?.childTokens?.[r.type]?this.defaults.extensions.childTokens[r.type].forEach(a=>{s=s.concat(this.walkTokens(r[a],t))}):r.tokens&&(s=s.concat(this.walkTokens(r.tokens,t)))}}return s}use(...e){const t=this.defaults.extensions||{renderers:{},childTokens:{}};return e.forEach(s=>{const i={...s};if(i.async=this.defaults.async||i.async||!1,s.extensions&&(s.extensions.forEach(r=>{if(!r.name)throw new Error("extension name required");if("renderer"in r){const a=t.renderers[r.name];a?t.renderers[r.name]=function(...o){let l=r.renderer.apply(this,o);return l===!1&&(l=a.apply(this,o)),l}:t.renderers[r.name]=r.renderer}if("tokenizer"in r){if(!r.level||r.level!=="block"&&r.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");const a=t[r.level];a?a.unshift(r.tokenizer):t[r.level]=[r.tokenizer],r.start&&(r.level==="block"?t.startBlock?t.startBlock.push(r.start):t.startBlock=[r.start]:r.level==="inline"&&(t.startInline?t.startInline.push(r.start):t.startInline=[r.start]))}"childTokens"in r&&r.childTokens&&(t.childTokens[r.name]=r.childTokens)}),i.extensions=t),s.renderer){const r=this.defaults.renderer||new Pe(this.defaults);for(const a in s.renderer){const o=s.renderer[a],l=a,d=r[l];r[l]=(...c)=>{let h=o.apply(r,c);return h===!1&&(h=d.apply(r,c)),h||""}}i.renderer=r}if(s.tokenizer){const r=this.defaults.tokenizer||new Re(this.defaults);for(const a in s.tokenizer){const o=s.tokenizer[a],l=a,d=r[l];r[l]=(...c)=>{let h=o.apply(r,c);return h===!1&&(h=d.apply(r,c)),h}}i.tokenizer=r}if(s.hooks){const r=this.defaults.hooks||new Ce;for(const a in s.hooks){const o=s.hooks[a],l=a,d=r[l];Ce.passThroughHooks.has(a)?r[l]=c=>{if(this.defaults.async)return Promise.resolve(o.call(r,c)).then(p=>d.call(r,p));const h=o.call(r,c);return d.call(r,h)}:r[l]=(...c)=>{let h=o.apply(r,c);return h===!1&&(h=d.apply(r,c)),h}}i.hooks=r}if(s.walkTokens){const r=this.defaults.walkTokens,a=s.walkTokens;i.walkTokens=function(o){let l=[];return l.push(a.call(this,o)),r&&(l=l.concat(r.call(this,o))),l}}this.defaults={...this.defaults,...i}}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return B.lex(e,t??this.defaults)}parser(e,t){return q.parse(e,t??this.defaults)}#e(e,t){return(s,i)=>{const r={...i},a={...this.defaults,...r};this.defaults.async===!0&&r.async===!1&&(a.silent||console.warn("marked(): The async option was set to true by an extension. The async: false option sent to parse will be ignored."),a.async=!0);const o=this.#t(!!a.silent,!!a.async);if(typeof s>"u"||s===null)return o(new Error("marked(): input parameter is undefined or null"));if(typeof s!="string")return o(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(s)+", string expected"));if(a.hooks&&(a.hooks.options=a),a.async)return Promise.resolve(a.hooks?a.hooks.preprocess(s):s).then(l=>e(l,a)).then(l=>a.walkTokens?Promise.all(this.walkTokens(l,a.walkTokens)).then(()=>l):l).then(l=>t(l,a)).then(l=>a.hooks?a.hooks.postprocess(l):l).catch(o);try{a.hooks&&(s=a.hooks.preprocess(s));const l=e(s,a);a.walkTokens&&this.walkTokens(l,a.walkTokens);let d=t(l,a);return a.hooks&&(d=a.hooks.postprocess(d)),d}catch(l){return o(l)}}}#t(e,t){return s=>{if(s.message+=`
Please report this to https://github.com/markedjs/marked.`,e){const i="<p>An error occurred:</p><pre>"+U(s.message+"",!0)+"</pre>";return t?Promise.resolve(i):i}if(t)return Promise.reject(s);throw s}}}const se=new Ti;function F(n,e){return se.parse(n,e)}F.options=F.setOptions=function(n){return se.setOptions(n),F.defaults=se.defaults,as(F.defaults),F};F.getDefaults=at;F.defaults=ie;F.use=function(...n){return se.use(...n),F.defaults=se.defaults,as(F.defaults),F};F.walkTokens=function(n,e){return se.walkTokens(n,e)};F.parseInline=se.parseInline;F.Parser=q;F.parser=q.parse;F.Renderer=Pe;F.TextRenderer=ot;F.Lexer=B;F.lexer=B.lex;F.Tokenizer=Re;F.Hooks=Ce;F.parse=F;F.options;F.setOptions;F.use;F.walkTokens;F.parseInline;q.parse;B.lex;var Ri={exports:{}};(function(n){var e=typeof window<"u"?window:typeof WorkerGlobalScope<"u"&&self instanceof WorkerGlobalScope?self:{};/**
 * Prism: Lightweight, robust, elegant syntax highlighting
 *
 * @license MIT <https://opensource.org/licenses/MIT>
 * @author Lea Verou <https://lea.verou.me>
 * @namespace
 * @public
 */var t=function(s){var i=/(?:^|\s)lang(?:uage)?-([\w-]+)(?=\s|$)/i,r=0,a={},o={manual:s.Prism&&s.Prism.manual,disableWorkerMessageHandler:s.Prism&&s.Prism.disableWorkerMessageHandler,util:{encode:function f(u){return u instanceof l?new l(u.type,f(u.content),u.alias):Array.isArray(u)?u.map(f):u.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\u00a0/g," ")},type:function(f){return Object.prototype.toString.call(f).slice(8,-1)},objId:function(f){return f.__id||Object.defineProperty(f,"__id",{value:++r}),f.__id},clone:function f(u,b){b=b||{};var y,x;switch(o.util.type(u)){case"Object":if(x=o.util.objId(u),b[x])return b[x];y={},b[x]=y;for(var C in u)u.hasOwnProperty(C)&&(y[C]=f(u[C],b));return y;case"Array":return x=o.util.objId(u),b[x]?b[x]:(y=[],b[x]=y,u.forEach(function(A,S){y[S]=f(A,b)}),y);default:return u}},getLanguage:function(f){for(;f;){var u=i.exec(f.className);if(u)return u[1].toLowerCase();f=f.parentElement}return"none"},setLanguage:function(f,u){f.className=f.className.replace(RegExp(i,"gi"),""),f.classList.add("language-"+u)},currentScript:function(){if(typeof document>"u")return null;if(document.currentScript&&document.currentScript.tagName==="SCRIPT")return document.currentScript;try{throw new Error}catch(y){var f=(/at [^(\r\n]*\((.*):[^:]+:[^:]+\)$/i.exec(y.stack)||[])[1];if(f){var u=document.getElementsByTagName("script");for(var b in u)if(u[b].src==f)return u[b]}return null}},isActive:function(f,u,b){for(var y="no-"+u;f;){var x=f.classList;if(x.contains(u))return!0;if(x.contains(y))return!1;f=f.parentElement}return!!b}},languages:{plain:a,plaintext:a,text:a,txt:a,extend:function(f,u){var b=o.util.clone(o.languages[f]);for(var y in u)b[y]=u[y];return b},insertBefore:function(f,u,b,y){y=y||o.languages;var x=y[f],C={};for(var A in x)if(x.hasOwnProperty(A)){if(A==u)for(var S in b)b.hasOwnProperty(S)&&(C[S]=b[S]);b.hasOwnProperty(A)||(C[A]=x[A])}var P=y[f];return y[f]=C,o.languages.DFS(o.languages,function(z,X){X===P&&z!=f&&(this[z]=C)}),C},DFS:function f(u,b,y,x){x=x||{};var C=o.util.objId;for(var A in u)if(u.hasOwnProperty(A)){b.call(u,A,u[A],y||A);var S=u[A],P=o.util.type(S);P==="Object"&&!x[C(S)]?(x[C(S)]=!0,f(S,b,null,x)):P==="Array"&&!x[C(S)]&&(x[C(S)]=!0,f(S,b,A,x))}}},plugins:{},highlightAll:function(f,u){o.highlightAllUnder(document,f,u)},highlightAllUnder:function(f,u,b){var y={callback:b,container:f,selector:'code[class*="language-"], [class*="language-"] code, code[class*="lang-"], [class*="lang-"] code'};o.hooks.run("before-highlightall",y),y.elements=Array.prototype.slice.apply(y.container.querySelectorAll(y.selector)),o.hooks.run("before-all-elements-highlight",y);for(var x=0,C;C=y.elements[x++];)o.highlightElement(C,u===!0,y.callback)},highlightElement:function(f,u,b){var y=o.util.getLanguage(f),x=o.languages[y];o.util.setLanguage(f,y);var C=f.parentElement;C&&C.nodeName.toLowerCase()==="pre"&&o.util.setLanguage(C,y);var A=f.textContent,S={element:f,language:y,grammar:x,code:A};function P(X){S.highlightedCode=X,o.hooks.run("before-insert",S),S.element.innerHTML=S.highlightedCode,o.hooks.run("after-highlight",S),o.hooks.run("complete",S),b&&b.call(S.element)}if(o.hooks.run("before-sanity-check",S),C=S.element.parentElement,C&&C.nodeName.toLowerCase()==="pre"&&!C.hasAttribute("tabindex")&&C.setAttribute("tabindex","0"),!S.code){o.hooks.run("complete",S),b&&b.call(S.element);return}if(o.hooks.run("before-highlight",S),!S.grammar){P(o.util.encode(S.code));return}if(u&&s.Worker){var z=new Worker(o.filename);z.onmessage=function(X){P(X.data)},z.postMessage(JSON.stringify({language:S.language,code:S.code,immediateClose:!0}))}else P(o.highlight(S.code,S.grammar,S.language))},highlight:function(f,u,b){var y={code:f,grammar:u,language:b};if(o.hooks.run("before-tokenize",y),!y.grammar)throw new Error('The language "'+y.language+'" has no grammar.');return y.tokens=o.tokenize(y.code,y.grammar),o.hooks.run("after-tokenize",y),l.stringify(o.util.encode(y.tokens),y.language)},tokenize:function(f,u){var b=u.rest;if(b){for(var y in b)u[y]=b[y];delete u.rest}var x=new h;return p(x,x.head,f),c(f,x,u,x.head,0),k(x)},hooks:{all:{},add:function(f,u){var b=o.hooks.all;b[f]=b[f]||[],b[f].push(u)},run:function(f,u){var b=o.hooks.all[f];if(!(!b||!b.length))for(var y=0,x;x=b[y++];)x(u)}},Token:l};s.Prism=o;function l(f,u,b,y){this.type=f,this.content=u,this.alias=b,this.length=(y||"").length|0}l.stringify=function f(u,b){if(typeof u=="string")return u;if(Array.isArray(u)){var y="";return u.forEach(function(P){y+=f(P,b)}),y}var x={type:u.type,content:f(u.content,b),tag:"span",classes:["token",u.type],attributes:{},language:b},C=u.alias;C&&(Array.isArray(C)?Array.prototype.push.apply(x.classes,C):x.classes.push(C)),o.hooks.run("wrap",x);var A="";for(var S in x.attributes)A+=" "+S+'="'+(x.attributes[S]||"").replace(/"/g,"&quot;")+'"';return"<"+x.tag+' class="'+x.classes.join(" ")+'"'+A+">"+x.content+"</"+x.tag+">"};function d(f,u,b,y){f.lastIndex=u;var x=f.exec(b);if(x&&y&&x[1]){var C=x[1].length;x.index+=C,x[0]=x[0].slice(C)}return x}function c(f,u,b,y,x,C){for(var A in b)if(!(!b.hasOwnProperty(A)||!b[A])){var S=b[A];S=Array.isArray(S)?S:[S];for(var P=0;P<S.length;++P){if(C&&C.cause==A+","+P)return;var z=S[P],X=z.inside,lt=!!z.lookbehind,ct=!!z.greedy,cs=z.alias;if(ct&&!z.pattern.global){var ds=z.pattern.toString().match(/[imsuy]*$/)[0];z.pattern=RegExp(z.pattern.source,ds+"g")}for(var dt=z.pattern||z,M=y.next,j=x;M!==u.tail&&!(C&&j>=C.reach);j+=M.value.length,M=M.next){var ne=M.value;if(u.length>f.length)return;if(!(ne instanceof l)){var ye=1,O;if(ct){if(O=d(dt,j,f,lt),!O||O.index>=f.length)break;var xe=O.index,hs=O.index+O[0].length,Y=j;for(Y+=M.value.length;xe>=Y;)M=M.next,Y+=M.value.length;if(Y-=M.value.length,j=Y,M.value instanceof l)continue;for(var ae=M;ae!==u.tail&&(Y<hs||typeof ae.value=="string");ae=ae.next)ye++,Y+=ae.value.length;ye--,ne=f.slice(j,Y),O.index-=j}else if(O=d(dt,0,ne,lt),!O)continue;var xe=O.index,_e=O[0],Me=ne.slice(0,xe),ht=ne.slice(xe+_e.length),Ue=j+ne.length;C&&Ue>C.reach&&(C.reach=Ue);var ve=M.prev;Me&&(ve=p(u,ve,Me),j+=Me.length),g(u,ve,ye);var us=new l(A,X?o.tokenize(_e,X):_e,cs,_e);if(M=p(u,ve,us),ht&&p(u,M,ht),ye>1){var He={cause:A+","+P,reach:Ue};c(f,u,b,M.prev,j,He),C&&He.reach>C.reach&&(C.reach=He.reach)}}}}}}function h(){var f={value:null,prev:null,next:null},u={value:null,prev:f,next:null};f.next=u,this.head=f,this.tail=u,this.length=0}function p(f,u,b){var y=u.next,x={value:b,prev:u,next:y};return u.next=x,y.prev=x,f.length++,x}function g(f,u,b){for(var y=u.next,x=0;x<b&&y!==f.tail;x++)y=y.next;u.next=y,y.prev=u,f.length-=x}function k(f){for(var u=[],b=f.head.next;b!==f.tail;)u.push(b.value),b=b.next;return u}if(!s.document)return s.addEventListener&&(o.disableWorkerMessageHandler||s.addEventListener("message",function(f){var u=JSON.parse(f.data),b=u.language,y=u.code,x=u.immediateClose;s.postMessage(o.highlight(y,o.languages[b],b)),x&&s.close()},!1)),o;var w=o.util.currentScript();w&&(o.filename=w.src,w.hasAttribute("data-manual")&&(o.manual=!0));function v(){o.manual||o.highlightAll()}if(!o.manual){var T=document.readyState;T==="loading"||T==="interactive"&&w&&w.defer?document.addEventListener("DOMContentLoaded",v):window.requestAnimationFrame?window.requestAnimationFrame(v):window.setTimeout(v,16)}return o}(e);n.exports&&(n.exports=t),typeof Ve<"u"&&(Ve.Prism=t),t.languages.markup={comment:{pattern:/<!--(?:(?!<!--)[\s\S])*?-->/,greedy:!0},prolog:{pattern:/<\?[\s\S]+?\?>/,greedy:!0},doctype:{pattern:/<!DOCTYPE(?:[^>"'[\]]|"[^"]*"|'[^']*')+(?:\[(?:[^<"'\]]|"[^"]*"|'[^']*'|<(?!!--)|<!--(?:[^-]|-(?!->))*-->)*\]\s*)?>/i,greedy:!0,inside:{"internal-subset":{pattern:/(^[^\[]*\[)[\s\S]+(?=\]>$)/,lookbehind:!0,greedy:!0,inside:null},string:{pattern:/"[^"]*"|'[^']*'/,greedy:!0},punctuation:/^<!|>$|[[\]]/,"doctype-tag":/^DOCTYPE/i,name:/[^\s<>'"]+/}},cdata:{pattern:/<!\[CDATA\[[\s\S]*?\]\]>/i,greedy:!0},tag:{pattern:/<\/?(?!\d)[^\s>\/=$<%]+(?:\s(?:\s*[^\s>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))|(?=[\s/>])))+)?\s*\/?>/,greedy:!0,inside:{tag:{pattern:/^<\/?[^\s>\/]+/,inside:{punctuation:/^<\/?/,namespace:/^[^\s>\/:]+:/}},"special-attr":[],"attr-value":{pattern:/=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+)/,inside:{punctuation:[{pattern:/^=/,alias:"attr-equals"},{pattern:/^(\s*)["']|["']$/,lookbehind:!0}]}},punctuation:/\/?>/,"attr-name":{pattern:/[^\s>\/]+/,inside:{namespace:/^[^\s>\/:]+:/}}}},entity:[{pattern:/&[\da-z]{1,8};/i,alias:"named-entity"},/&#x?[\da-f]{1,8};/i]},t.languages.markup.tag.inside["attr-value"].inside.entity=t.languages.markup.entity,t.languages.markup.doctype.inside["internal-subset"].inside=t.languages.markup,t.hooks.add("wrap",function(s){s.type==="entity"&&(s.attributes.title=s.content.replace(/&amp;/,"&"))}),Object.defineProperty(t.languages.markup.tag,"addInlined",{value:function(i,r){var a={};a["language-"+r]={pattern:/(^<!\[CDATA\[)[\s\S]+?(?=\]\]>$)/i,lookbehind:!0,inside:t.languages[r]},a.cdata=/^<!\[CDATA\[|\]\]>$/i;var o={"included-cdata":{pattern:/<!\[CDATA\[[\s\S]*?\]\]>/i,inside:a}};o["language-"+r]={pattern:/[\s\S]+/,inside:t.languages[r]};var l={};l[i]={pattern:RegExp(/(<__[^>]*>)(?:<!\[CDATA\[(?:[^\]]|\](?!\]>))*\]\]>|(?!<!\[CDATA\[)[\s\S])*?(?=<\/__>)/.source.replace(/__/g,function(){return i}),"i"),lookbehind:!0,greedy:!0,inside:o},t.languages.insertBefore("markup","cdata",l)}}),Object.defineProperty(t.languages.markup.tag,"addAttribute",{value:function(s,i){t.languages.markup.tag.inside["special-attr"].push({pattern:RegExp(/(^|["'\s])/.source+"(?:"+s+")"+/\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))/.source,"i"),lookbehind:!0,inside:{"attr-name":/^[^\s=]+/,"attr-value":{pattern:/=[\s\S]+/,inside:{value:{pattern:/(^=\s*(["']|(?!["'])))\S[\s\S]*(?=\2$)/,lookbehind:!0,alias:[i,"language-"+i],inside:t.languages[i]},punctuation:[{pattern:/^=/,alias:"attr-equals"},/"|'/]}}}})}}),t.languages.html=t.languages.markup,t.languages.mathml=t.languages.markup,t.languages.svg=t.languages.markup,t.languages.xml=t.languages.extend("markup",{}),t.languages.ssml=t.languages.xml,t.languages.atom=t.languages.xml,t.languages.rss=t.languages.xml,function(s){var i=/(?:"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n])*')/;s.languages.css={comment:/\/\*[\s\S]*?\*\//,atrule:{pattern:RegExp("@[\\w-](?:"+/[^;{\s"']|\s+(?!\s)/.source+"|"+i.source+")*?"+/(?:;|(?=\s*\{))/.source),inside:{rule:/^@[\w-]+/,"selector-function-argument":{pattern:/(\bselector\s*\(\s*(?![\s)]))(?:[^()\s]|\s+(?![\s)])|\((?:[^()]|\([^()]*\))*\))+(?=\s*\))/,lookbehind:!0,alias:"selector"},keyword:{pattern:/(^|[^\w-])(?:and|not|only|or)(?![\w-])/,lookbehind:!0}}},url:{pattern:RegExp("\\burl\\((?:"+i.source+"|"+/(?:[^\\\r\n()"']|\\[\s\S])*/.source+")\\)","i"),greedy:!0,inside:{function:/^url/i,punctuation:/^\(|\)$/,string:{pattern:RegExp("^"+i.source+"$"),alias:"url"}}},selector:{pattern:RegExp(`(^|[{}\\s])[^{}\\s](?:[^{};"'\\s]|\\s+(?![\\s{])|`+i.source+")*(?=\\s*\\{)"),lookbehind:!0},string:{pattern:i,greedy:!0},property:{pattern:/(^|[^-\w\xA0-\uFFFF])(?!\s)[-_a-z\xA0-\uFFFF](?:(?!\s)[-\w\xA0-\uFFFF])*(?=\s*:)/i,lookbehind:!0},important:/!important\b/i,function:{pattern:/(^|[^-a-z0-9])[-a-z0-9]+(?=\()/i,lookbehind:!0},punctuation:/[(){};:,]/},s.languages.css.atrule.inside.rest=s.languages.css;var r=s.languages.markup;r&&(r.tag.addInlined("style","css"),r.tag.addAttribute("style","css"))}(t),t.languages.clike={comment:[{pattern:/(^|[^\\])\/\*[\s\S]*?(?:\*\/|$)/,lookbehind:!0,greedy:!0},{pattern:/(^|[^\\:])\/\/.*/,lookbehind:!0,greedy:!0}],string:{pattern:/(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/,greedy:!0},"class-name":{pattern:/(\b(?:class|extends|implements|instanceof|interface|new|trait)\s+|\bcatch\s+\()[\w.\\]+/i,lookbehind:!0,inside:{punctuation:/[.\\]/}},keyword:/\b(?:break|catch|continue|do|else|finally|for|function|if|in|instanceof|new|null|return|throw|try|while)\b/,boolean:/\b(?:false|true)\b/,function:/\b\w+(?=\()/,number:/\b0x[\da-f]+\b|(?:\b\d+(?:\.\d*)?|\B\.\d+)(?:e[+-]?\d+)?/i,operator:/[<>]=?|[!=]=?=?|--?|\+\+?|&&?|\|\|?|[?*/~^%]/,punctuation:/[{}[\];(),.:]/},t.languages.javascript=t.languages.extend("clike",{"class-name":[t.languages.clike["class-name"],{pattern:/(^|[^$\w\xA0-\uFFFF])(?!\s)[_$A-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\.(?:constructor|prototype))/,lookbehind:!0}],keyword:[{pattern:/((?:^|\})\s*)catch\b/,lookbehind:!0},{pattern:/(^|[^.]|\.\.\.\s*)\b(?:as|assert(?=\s*\{)|async(?=\s*(?:function\b|\(|[$\w\xA0-\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally(?=\s*(?:\{|$))|for|from(?=\s*(?:['"]|$))|function|(?:get|set)(?=\s*(?:[#\[$\w\xA0-\uFFFF]|$))|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\b/,lookbehind:!0}],function:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*(?:\.\s*(?:apply|bind|call)\s*)?\()/,number:{pattern:RegExp(/(^|[^\w$])/.source+"(?:"+(/NaN|Infinity/.source+"|"+/0[bB][01]+(?:_[01]+)*n?/.source+"|"+/0[oO][0-7]+(?:_[0-7]+)*n?/.source+"|"+/0[xX][\dA-Fa-f]+(?:_[\dA-Fa-f]+)*n?/.source+"|"+/\d+(?:_\d+)*n/.source+"|"+/(?:\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[Ee][+-]?\d+(?:_\d+)*)?/.source)+")"+/(?![\w$])/.source),lookbehind:!0},operator:/--|\+\+|\*\*=?|=>|&&=?|\|\|=?|[!=]==|<<=?|>>>?=?|[-+*/%&|^!=<>]=?|\.{3}|\?\?=?|\?\.?|[~:]/}),t.languages.javascript["class-name"][0].pattern=/(\b(?:class|extends|implements|instanceof|interface|new)\s+)[\w.\\]+/,t.languages.insertBefore("javascript","keyword",{regex:{pattern:RegExp(/((?:^|[^$\w\xA0-\uFFFF."'\])\s]|\b(?:return|yield))\s*)/.source+/\//.source+"(?:"+/(?:\[(?:[^\]\\\r\n]|\\.)*\]|\\.|[^/\\\[\r\n])+\/[dgimyus]{0,7}/.source+"|"+/(?:\[(?:[^[\]\\\r\n]|\\.|\[(?:[^[\]\\\r\n]|\\.|\[(?:[^[\]\\\r\n]|\\.)*\])*\])*\]|\\.|[^/\\\[\r\n])+\/[dgimyus]{0,7}v[dgimyus]{0,7}/.source+")"+/(?=(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?:$|[\r\n,.;:})\]]|\/\/))/.source),lookbehind:!0,greedy:!0,inside:{"regex-source":{pattern:/^(\/)[\s\S]+(?=\/[a-z]*$)/,lookbehind:!0,alias:"language-regex",inside:t.languages.regex},"regex-delimiter":/^\/|\/$/,"regex-flags":/^[a-z]+$/}},"function-variable":{pattern:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*[=:]\s*(?:async\s*)?(?:\bfunction\b|(?:\((?:[^()]|\([^()]*\))*\)|(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)\s*=>))/,alias:"function"},parameter:[{pattern:/(function(?:\s+(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)?\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\))/,lookbehind:!0,inside:t.languages.javascript},{pattern:/(^|[^$\w\xA0-\uFFFF])(?!\s)[_$a-z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*=>)/i,lookbehind:!0,inside:t.languages.javascript},{pattern:/(\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*=>)/,lookbehind:!0,inside:t.languages.javascript},{pattern:/((?:\b|\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\w\xA0-\uFFFF]))(?:(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*\s*)\(\s*|\]\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*\{)/,lookbehind:!0,inside:t.languages.javascript}],constant:/\b[A-Z](?:[A-Z_]|\dx?)*\b/}),t.languages.insertBefore("javascript","string",{hashbang:{pattern:/^#!.*/,greedy:!0,alias:"comment"},"template-string":{pattern:/`(?:\\[\s\S]|\$\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})+\}|(?!\$\{)[^\\`])*`/,greedy:!0,inside:{"template-punctuation":{pattern:/^`|`$/,alias:"string"},interpolation:{pattern:/((?:^|[^\\])(?:\\{2})*)\$\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})+\}/,lookbehind:!0,inside:{"interpolation-punctuation":{pattern:/^\$\{|\}$/,alias:"punctuation"},rest:t.languages.javascript}},string:/[\s\S]+/}},"string-property":{pattern:/((?:^|[,{])[ \t]*)(["'])(?:\\(?:\r\n|[\s\S])|(?!\2)[^\\\r\n])*\2(?=\s*:)/m,lookbehind:!0,greedy:!0,alias:"property"}}),t.languages.insertBefore("javascript","operator",{"literal-property":{pattern:/((?:^|[,{])[ \t]*)(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*:)/m,lookbehind:!0,alias:"property"}}),t.languages.markup&&(t.languages.markup.tag.addInlined("script","javascript"),t.languages.markup.tag.addAttribute(/on(?:abort|blur|change|click|composition(?:end|start|update)|dblclick|error|focus(?:in|out)?|key(?:down|up)|load|mouse(?:down|enter|leave|move|out|over|up)|reset|resize|scroll|select|slotchange|submit|unload|wheel)/.source,"javascript")),t.languages.js=t.languages.javascript,function(){if(typeof t>"u"||typeof document>"u")return;Element.prototype.matches||(Element.prototype.matches=Element.prototype.msMatchesSelector||Element.prototype.webkitMatchesSelector);var s="Loading…",i=function(w,v){return"✖ Error "+w+" while fetching file: "+v},r="✖ Error: File does not exist or is empty",a={js:"javascript",py:"python",rb:"ruby",ps1:"powershell",psm1:"powershell",sh:"bash",bat:"batch",h:"c",tex:"latex"},o="data-src-status",l="loading",d="loaded",c="failed",h="pre[data-src]:not(["+o+'="'+d+'"]):not(['+o+'="'+l+'"])';function p(w,v,T){var f=new XMLHttpRequest;f.open("GET",w,!0),f.onreadystatechange=function(){f.readyState==4&&(f.status<400&&f.responseText?v(f.responseText):f.status>=400?T(i(f.status,f.statusText)):T(r))},f.send(null)}function g(w){var v=/^\s*(\d+)\s*(?:(,)\s*(?:(\d+)\s*)?)?$/.exec(w||"");if(v){var T=Number(v[1]),f=v[2],u=v[3];return f?u?[T,Number(u)]:[T,void 0]:[T,T]}}t.hooks.add("before-highlightall",function(w){w.selector+=", "+h}),t.hooks.add("before-sanity-check",function(w){var v=w.element;if(v.matches(h)){w.code="",v.setAttribute(o,l);var T=v.appendChild(document.createElement("CODE"));T.textContent=s;var f=v.getAttribute("data-src"),u=w.language;if(u==="none"){var b=(/\.(\w+)$/.exec(f)||[,"none"])[1];u=a[b]||b}t.util.setLanguage(T,u),t.util.setLanguage(v,u);var y=t.plugins.autoloader;y&&y.loadLanguages(u),p(f,function(x){v.setAttribute(o,d);var C=g(v.getAttribute("data-range"));if(C){var A=x.split(/\r\n?|\n/g),S=C[0],P=C[1]==null?A.length:C[1];S<0&&(S+=A.length),S=Math.max(0,Math.min(S-1,A.length)),P<0&&(P+=A.length),P=Math.max(0,Math.min(P,A.length)),x=A.slice(S,P).join(`
`),v.hasAttribute("data-start")||v.setAttribute("data-start",String(S+1))}T.textContent=x,t.highlightElement(T)},function(x){v.setAttribute(o,c),T.textContent=x})}}),t.plugins.fileHighlight={highlight:function(v){for(var T=(v||document).querySelectorAll(h),f=0,u;u=T[f++];)t.highlightElement(u)}};var k=!1;t.fileHighlight=function(){k||(console.warn("Prism.fileHighlight is deprecated. Use `Prism.plugins.fileHighlight.highlight` instead."),k=!0),t.plugins.fileHighlight.highlight.apply(this,arguments)}}()})(Ri);Prism.languages.javascript=Prism.languages.extend("clike",{"class-name":[Prism.languages.clike["class-name"],{pattern:/(^|[^$\w\xA0-\uFFFF])(?!\s)[_$A-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\.(?:constructor|prototype))/,lookbehind:!0}],keyword:[{pattern:/((?:^|\})\s*)catch\b/,lookbehind:!0},{pattern:/(^|[^.]|\.\.\.\s*)\b(?:as|assert(?=\s*\{)|async(?=\s*(?:function\b|\(|[$\w\xA0-\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally(?=\s*(?:\{|$))|for|from(?=\s*(?:['"]|$))|function|(?:get|set)(?=\s*(?:[#\[$\w\xA0-\uFFFF]|$))|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\b/,lookbehind:!0}],function:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*(?:\.\s*(?:apply|bind|call)\s*)?\()/,number:{pattern:RegExp(/(^|[^\w$])/.source+"(?:"+(/NaN|Infinity/.source+"|"+/0[bB][01]+(?:_[01]+)*n?/.source+"|"+/0[oO][0-7]+(?:_[0-7]+)*n?/.source+"|"+/0[xX][\dA-Fa-f]+(?:_[\dA-Fa-f]+)*n?/.source+"|"+/\d+(?:_\d+)*n/.source+"|"+/(?:\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[Ee][+-]?\d+(?:_\d+)*)?/.source)+")"+/(?![\w$])/.source),lookbehind:!0},operator:/--|\+\+|\*\*=?|=>|&&=?|\|\|=?|[!=]==|<<=?|>>>?=?|[-+*/%&|^!=<>]=?|\.{3}|\?\?=?|\?\.?|[~:]/});Prism.languages.javascript["class-name"][0].pattern=/(\b(?:class|extends|implements|instanceof|interface|new)\s+)[\w.\\]+/;Prism.languages.insertBefore("javascript","keyword",{regex:{pattern:RegExp(/((?:^|[^$\w\xA0-\uFFFF."'\])\s]|\b(?:return|yield))\s*)/.source+/\//.source+"(?:"+/(?:\[(?:[^\]\\\r\n]|\\.)*\]|\\.|[^/\\\[\r\n])+\/[dgimyus]{0,7}/.source+"|"+/(?:\[(?:[^[\]\\\r\n]|\\.|\[(?:[^[\]\\\r\n]|\\.|\[(?:[^[\]\\\r\n]|\\.)*\])*\])*\]|\\.|[^/\\\[\r\n])+\/[dgimyus]{0,7}v[dgimyus]{0,7}/.source+")"+/(?=(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?:$|[\r\n,.;:})\]]|\/\/))/.source),lookbehind:!0,greedy:!0,inside:{"regex-source":{pattern:/^(\/)[\s\S]+(?=\/[a-z]*$)/,lookbehind:!0,alias:"language-regex",inside:Prism.languages.regex},"regex-delimiter":/^\/|\/$/,"regex-flags":/^[a-z]+$/}},"function-variable":{pattern:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*[=:]\s*(?:async\s*)?(?:\bfunction\b|(?:\((?:[^()]|\([^()]*\))*\)|(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)\s*=>))/,alias:"function"},parameter:[{pattern:/(function(?:\s+(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*)?\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\))/,lookbehind:!0,inside:Prism.languages.javascript},{pattern:/(^|[^$\w\xA0-\uFFFF])(?!\s)[_$a-z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*=>)/i,lookbehind:!0,inside:Prism.languages.javascript},{pattern:/(\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*=>)/,lookbehind:!0,inside:Prism.languages.javascript},{pattern:/((?:\b|\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\w\xA0-\uFFFF]))(?:(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*\s*)\(\s*|\]\s*\(\s*)(?!\s)(?:[^()\s]|\s+(?![\s)])|\([^()]*\))+(?=\s*\)\s*\{)/,lookbehind:!0,inside:Prism.languages.javascript}],constant:/\b[A-Z](?:[A-Z_]|\dx?)*\b/});Prism.languages.insertBefore("javascript","string",{hashbang:{pattern:/^#!.*/,greedy:!0,alias:"comment"},"template-string":{pattern:/`(?:\\[\s\S]|\$\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})+\}|(?!\$\{)[^\\`])*`/,greedy:!0,inside:{"template-punctuation":{pattern:/^`|`$/,alias:"string"},interpolation:{pattern:/((?:^|[^\\])(?:\\{2})*)\$\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})+\}/,lookbehind:!0,inside:{"interpolation-punctuation":{pattern:/^\$\{|\}$/,alias:"punctuation"},rest:Prism.languages.javascript}},string:/[\s\S]+/}},"string-property":{pattern:/((?:^|[,{])[ \t]*)(["'])(?:\\(?:\r\n|[\s\S])|(?!\2)[^\\\r\n])*\2(?=\s*:)/m,lookbehind:!0,greedy:!0,alias:"property"}});Prism.languages.insertBefore("javascript","operator",{"literal-property":{pattern:/((?:^|[,{])[ \t]*)(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*:)/m,lookbehind:!0,alias:"property"}});Prism.languages.markup&&(Prism.languages.markup.tag.addInlined("script","javascript"),Prism.languages.markup.tag.addAttribute(/on(?:abort|blur|change|click|composition(?:end|start|update)|dblclick|error|focus(?:in|out)?|key(?:down|up)|load|mouse(?:down|enter|leave|move|out|over|up)|reset|resize|scroll|select|slotchange|submit|unload|wheel)/.source,"javascript"));Prism.languages.js=Prism.languages.javascript;Prism.languages.python={comment:{pattern:/(^|[^\\])#.*/,lookbehind:!0,greedy:!0},"string-interpolation":{pattern:/(?:f|fr|rf)(?:("""|''')[\s\S]*?\1|("|')(?:\\.|(?!\2)[^\\\r\n])*\2)/i,greedy:!0,inside:{interpolation:{pattern:/((?:^|[^{])(?:\{\{)*)\{(?!\{)(?:[^{}]|\{(?!\{)(?:[^{}]|\{(?!\{)(?:[^{}])+\})+\})+\}/,lookbehind:!0,inside:{"format-spec":{pattern:/(:)[^:(){}]+(?=\}$)/,lookbehind:!0},"conversion-option":{pattern:/![sra](?=[:}]$)/,alias:"punctuation"},rest:null}},string:/[\s\S]+/}},"triple-quoted-string":{pattern:/(?:[rub]|br|rb)?("""|''')[\s\S]*?\1/i,greedy:!0,alias:"string"},string:{pattern:/(?:[rub]|br|rb)?("|')(?:\\.|(?!\1)[^\\\r\n])*\1/i,greedy:!0},function:{pattern:/((?:^|\s)def[ \t]+)[a-zA-Z_]\w*(?=\s*\()/g,lookbehind:!0},"class-name":{pattern:/(\bclass\s+)\w+/i,lookbehind:!0},decorator:{pattern:/(^[\t ]*)@\w+(?:\.\w+)*/m,lookbehind:!0,alias:["annotation","punctuation"],inside:{punctuation:/\./}},keyword:/\b(?:_(?=\s*:)|and|as|assert|async|await|break|case|class|continue|def|del|elif|else|except|exec|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|print|raise|return|try|while|with|yield)\b/,builtin:/\b(?:__import__|abs|all|any|apply|ascii|basestring|bin|bool|buffer|bytearray|bytes|callable|chr|classmethod|cmp|coerce|compile|complex|delattr|dict|dir|divmod|enumerate|eval|execfile|file|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|intern|isinstance|issubclass|iter|len|list|locals|long|map|max|memoryview|min|next|object|oct|open|ord|pow|property|range|raw_input|reduce|reload|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|type|unichr|unicode|vars|xrange|zip)\b/,boolean:/\b(?:False|None|True)\b/,number:/\b0(?:b(?:_?[01])+|o(?:_?[0-7])+|x(?:_?[a-f0-9])+)\b|(?:\b\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\B\.\d+(?:_\d+)*)(?:e[+-]?\d+(?:_\d+)*)?j?(?!\w)/i,operator:/[-+%=]=?|!=|:=|\*\*?=?|\/\/?=?|<[<=>]?|>[=>]?|[&|^~]/,punctuation:/[{}[\];(),.:]/};Prism.languages.python["string-interpolation"].inside.interpolation.inside.rest=Prism.languages.python;Prism.languages.py=Prism.languages.python;Prism.languages.json={property:{pattern:/(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?=\s*:)/,lookbehind:!0,greedy:!0},string:{pattern:/(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?!\s*:)/,lookbehind:!0,greedy:!0},comment:{pattern:/\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/,greedy:!0},number:/-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i,punctuation:/[{}[\],]/,operator:/:/,boolean:/\b(?:false|true)\b/,null:{pattern:/\bnull\b/,alias:"keyword"}};Prism.languages.webmanifest=Prism.languages.json;(function(n){var e="\\b(?:BASH|BASHOPTS|BASH_ALIASES|BASH_ARGC|BASH_ARGV|BASH_CMDS|BASH_COMPLETION_COMPAT_DIR|BASH_LINENO|BASH_REMATCH|BASH_SOURCE|BASH_VERSINFO|BASH_VERSION|COLORTERM|COLUMNS|COMP_WORDBREAKS|DBUS_SESSION_BUS_ADDRESS|DEFAULTS_PATH|DESKTOP_SESSION|DIRSTACK|DISPLAY|EUID|GDMSESSION|GDM_LANG|GNOME_KEYRING_CONTROL|GNOME_KEYRING_PID|GPG_AGENT_INFO|GROUPS|HISTCONTROL|HISTFILE|HISTFILESIZE|HISTSIZE|HOME|HOSTNAME|HOSTTYPE|IFS|INSTANCE|JOB|LANG|LANGUAGE|LC_ADDRESS|LC_ALL|LC_IDENTIFICATION|LC_MEASUREMENT|LC_MONETARY|LC_NAME|LC_NUMERIC|LC_PAPER|LC_TELEPHONE|LC_TIME|LESSCLOSE|LESSOPEN|LINES|LOGNAME|LS_COLORS|MACHTYPE|MAILCHECK|MANDATORY_PATH|NO_AT_BRIDGE|OLDPWD|OPTERR|OPTIND|ORBIT_SOCKETDIR|OSTYPE|PAPERSIZE|PATH|PIPESTATUS|PPID|PS1|PS2|PS3|PS4|PWD|RANDOM|REPLY|SECONDS|SELINUX_INIT|SESSION|SESSIONTYPE|SESSION_MANAGER|SHELL|SHELLOPTS|SHLVL|SSH_AUTH_SOCK|TERM|UID|UPSTART_EVENTS|UPSTART_INSTANCE|UPSTART_JOB|UPSTART_SESSION|USER|WINDOWID|XAUTHORITY|XDG_CONFIG_DIRS|XDG_CURRENT_DESKTOP|XDG_DATA_DIRS|XDG_GREETER_DATA_DIR|XDG_MENU_PREFIX|XDG_RUNTIME_DIR|XDG_SEAT|XDG_SEAT_PATH|XDG_SESSION_DESKTOP|XDG_SESSION_ID|XDG_SESSION_PATH|XDG_SESSION_TYPE|XDG_VTNR|XMODIFIERS)\\b",t={pattern:/(^(["']?)\w+\2)[ \t]+\S.*/,lookbehind:!0,alias:"punctuation",inside:null},s={bash:t,environment:{pattern:RegExp("\\$"+e),alias:"constant"},variable:[{pattern:/\$?\(\([\s\S]+?\)\)/,greedy:!0,inside:{variable:[{pattern:/(^\$\(\([\s\S]+)\)\)/,lookbehind:!0},/^\$\(\(/],number:/\b0x[\dA-Fa-f]+\b|(?:\b\d+(?:\.\d*)?|\B\.\d+)(?:[Ee]-?\d+)?/,operator:/--|\+\+|\*\*=?|<<=?|>>=?|&&|\|\||[=!+\-*/%<>^&|]=?|[?~:]/,punctuation:/\(\(?|\)\)?|,|;/}},{pattern:/\$\((?:\([^)]+\)|[^()])+\)|`[^`]+`/,greedy:!0,inside:{variable:/^\$\(|^`|\)$|`$/}},{pattern:/\$\{[^}]+\}/,greedy:!0,inside:{operator:/:[-=?+]?|[!\/]|##?|%%?|\^\^?|,,?/,punctuation:/[\[\]]/,environment:{pattern:RegExp("(\\{)"+e),lookbehind:!0,alias:"constant"}}},/\$(?:\w+|[#?*!@$])/],entity:/\\(?:[abceEfnrtv\\"]|O?[0-7]{1,3}|U[0-9a-fA-F]{8}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{1,2})/};n.languages.bash={shebang:{pattern:/^#!\s*\/.*/,alias:"important"},comment:{pattern:/(^|[^"{\\$])#.*/,lookbehind:!0},"function-name":[{pattern:/(\bfunction\s+)[\w-]+(?=(?:\s*\(?:\s*\))?\s*\{)/,lookbehind:!0,alias:"function"},{pattern:/\b[\w-]+(?=\s*\(\s*\)\s*\{)/,alias:"function"}],"for-or-select":{pattern:/(\b(?:for|select)\s+)\w+(?=\s+in\s)/,alias:"variable",lookbehind:!0},"assign-left":{pattern:/(^|[\s;|&]|[<>]\()\w+(?:\.\w+)*(?=\+?=)/,inside:{environment:{pattern:RegExp("(^|[\\s;|&]|[<>]\\()"+e),lookbehind:!0,alias:"constant"}},alias:"variable",lookbehind:!0},parameter:{pattern:/(^|\s)-{1,2}(?:\w+:[+-]?)?\w+(?:\.\w+)*(?=[=\s]|$)/,alias:"variable",lookbehind:!0},string:[{pattern:/((?:^|[^<])<<-?\s*)(\w+)\s[\s\S]*?(?:\r?\n|\r)\2/,lookbehind:!0,greedy:!0,inside:s},{pattern:/((?:^|[^<])<<-?\s*)(["'])(\w+)\2\s[\s\S]*?(?:\r?\n|\r)\3/,lookbehind:!0,greedy:!0,inside:{bash:t}},{pattern:/(^|[^\\](?:\\\\)*)"(?:\\[\s\S]|\$\([^)]+\)|\$(?!\()|`[^`]+`|[^"\\`$])*"/,lookbehind:!0,greedy:!0,inside:s},{pattern:/(^|[^$\\])'[^']*'/,lookbehind:!0,greedy:!0},{pattern:/\$'(?:[^'\\]|\\[\s\S])*'/,greedy:!0,inside:{entity:s.entity}}],environment:{pattern:RegExp("\\$?"+e),alias:"constant"},variable:s.variable,function:{pattern:/(^|[\s;|&]|[<>]\()(?:add|apropos|apt|apt-cache|apt-get|aptitude|aspell|automysqlbackup|awk|basename|bash|bc|bconsole|bg|bzip2|cal|cargo|cat|cfdisk|chgrp|chkconfig|chmod|chown|chroot|cksum|clear|cmp|column|comm|composer|cp|cron|crontab|csplit|curl|cut|date|dc|dd|ddrescue|debootstrap|df|diff|diff3|dig|dir|dircolors|dirname|dirs|dmesg|docker|docker-compose|du|egrep|eject|env|ethtool|expand|expect|expr|fdformat|fdisk|fg|fgrep|file|find|fmt|fold|format|free|fsck|ftp|fuser|gawk|git|gparted|grep|groupadd|groupdel|groupmod|groups|grub-mkconfig|gzip|halt|head|hg|history|host|hostname|htop|iconv|id|ifconfig|ifdown|ifup|import|install|ip|java|jobs|join|kill|killall|less|link|ln|locate|logname|logrotate|look|lpc|lpr|lprint|lprintd|lprintq|lprm|ls|lsof|lynx|make|man|mc|mdadm|mkconfig|mkdir|mke2fs|mkfifo|mkfs|mkisofs|mknod|mkswap|mmv|more|most|mount|mtools|mtr|mutt|mv|nano|nc|netstat|nice|nl|node|nohup|notify-send|npm|nslookup|op|open|parted|passwd|paste|pathchk|ping|pkill|pnpm|podman|podman-compose|popd|pr|printcap|printenv|ps|pushd|pv|quota|quotacheck|quotactl|ram|rar|rcp|reboot|remsync|rename|renice|rev|rm|rmdir|rpm|rsync|scp|screen|sdiff|sed|sendmail|seq|service|sftp|sh|shellcheck|shuf|shutdown|sleep|slocate|sort|split|ssh|stat|strace|su|sudo|sum|suspend|swapon|sync|sysctl|tac|tail|tar|tee|time|timeout|top|touch|tr|traceroute|tsort|tty|umount|uname|unexpand|uniq|units|unrar|unshar|unzip|update-grub|uptime|useradd|userdel|usermod|users|uudecode|uuencode|v|vcpkg|vdir|vi|vim|virsh|vmstat|wait|watch|wc|wget|whereis|which|who|whoami|write|xargs|xdg-open|yarn|yes|zenity|zip|zsh|zypper)(?=$|[)\s;|&])/,lookbehind:!0},keyword:{pattern:/(^|[\s;|&]|[<>]\()(?:case|do|done|elif|else|esac|fi|for|function|if|in|select|then|until|while)(?=$|[)\s;|&])/,lookbehind:!0},builtin:{pattern:/(^|[\s;|&]|[<>]\()(?:\.|:|alias|bind|break|builtin|caller|cd|command|continue|declare|echo|enable|eval|exec|exit|export|getopts|hash|help|let|local|logout|mapfile|printf|pwd|read|readarray|readonly|return|set|shift|shopt|source|test|times|trap|type|typeset|ulimit|umask|unalias|unset)(?=$|[)\s;|&])/,lookbehind:!0,alias:"class-name"},boolean:{pattern:/(^|[\s;|&]|[<>]\()(?:false|true)(?=$|[)\s;|&])/,lookbehind:!0},"file-descriptor":{pattern:/\B&\d\b/,alias:"important"},operator:{pattern:/\d?<>|>\||\+=|=[=~]?|!=?|<<[<-]?|[&\d]?>>|\d[<>]&?|[<>][&=]?|&[>&]?|\|[&|]?/,inside:{"file-descriptor":{pattern:/^\d/,alias:"important"}}},punctuation:/\$?\(\(?|\)\)?|\.\.|[{}[\];\\]/,number:{pattern:/(^|\s)(?:[1-9]\d*|0)(?:[.,]\d+)?\b/,lookbehind:!0}},t.inside=n.languages.bash;for(var i=["comment","function-name","for-or-select","assign-left","parameter","string","environment","function","keyword","builtin","boolean","file-descriptor","operator","punctuation","number"],r=s.variable[1].inside,a=0;a<i.length;a++)r[i[a]]=n.languages.bash[i[a]];n.languages.sh=n.languages.bash,n.languages.shell=n.languages.bash})(Prism);(function(n){n.languages.typescript=n.languages.extend("javascript",{"class-name":{pattern:/(\b(?:class|extends|implements|instanceof|interface|new|type)\s+)(?!keyof\b)(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?:\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?/,lookbehind:!0,greedy:!0,inside:null},builtin:/\b(?:Array|Function|Promise|any|boolean|console|never|number|string|symbol|unknown)\b/}),n.languages.typescript.keyword.push(/\b(?:abstract|declare|is|keyof|readonly|require)\b/,/\b(?:asserts|infer|interface|module|namespace|type)\b(?=\s*(?:[{_$a-zA-Z\xA0-\uFFFF]|$))/,/\btype\b(?=\s*(?:[\{*]|$))/),delete n.languages.typescript.parameter,delete n.languages.typescript["literal-property"];var e=n.languages.extend("typescript",{});delete e["class-name"],n.languages.typescript["class-name"].inside=e,n.languages.insertBefore("typescript","function",{decorator:{pattern:/@[$\w\xA0-\uFFFF]+/,inside:{at:{pattern:/^@/,alias:"operator"},function:/^[\s\S]+/}},"generic-function":{pattern:/#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>(?=\s*\()/,greedy:!0,inside:{function:/^#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*/,generic:{pattern:/<[\s\S]+/,alias:"class-name",inside:e}}}}),n.languages.ts=n.languages.typescript})(Prism);(function(n){var e=/(?:"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n])*')/;n.languages.css={comment:/\/\*[\s\S]*?\*\//,atrule:{pattern:RegExp("@[\\w-](?:"+/[^;{\s"']|\s+(?!\s)/.source+"|"+e.source+")*?"+/(?:;|(?=\s*\{))/.source),inside:{rule:/^@[\w-]+/,"selector-function-argument":{pattern:/(\bselector\s*\(\s*(?![\s)]))(?:[^()\s]|\s+(?![\s)])|\((?:[^()]|\([^()]*\))*\))+(?=\s*\))/,lookbehind:!0,alias:"selector"},keyword:{pattern:/(^|[^\w-])(?:and|not|only|or)(?![\w-])/,lookbehind:!0}}},url:{pattern:RegExp("\\burl\\((?:"+e.source+"|"+/(?:[^\\\r\n()"']|\\[\s\S])*/.source+")\\)","i"),greedy:!0,inside:{function:/^url/i,punctuation:/^\(|\)$/,string:{pattern:RegExp("^"+e.source+"$"),alias:"url"}}},selector:{pattern:RegExp(`(^|[{}\\s])[^{}\\s](?:[^{};"'\\s]|\\s+(?![\\s{])|`+e.source+")*(?=\\s*\\{)"),lookbehind:!0},string:{pattern:e,greedy:!0},property:{pattern:/(^|[^-\w\xA0-\uFFFF])(?!\s)[-_a-z\xA0-\uFFFF](?:(?!\s)[-\w\xA0-\uFFFF])*(?=\s*:)/i,lookbehind:!0},important:/!important\b/i,function:{pattern:/(^|[^-a-z0-9])[-a-z0-9]+(?=\()/i,lookbehind:!0},punctuation:/[(){};:,]/},n.languages.css.atrule.inside.rest=n.languages.css;var t=n.languages.markup;t&&(t.tag.addInlined("style","css"),t.tag.addAttribute("style","css"))})(Prism);Prism.languages.markup={comment:{pattern:/<!--(?:(?!<!--)[\s\S])*?-->/,greedy:!0},prolog:{pattern:/<\?[\s\S]+?\?>/,greedy:!0},doctype:{pattern:/<!DOCTYPE(?:[^>"'[\]]|"[^"]*"|'[^']*')+(?:\[(?:[^<"'\]]|"[^"]*"|'[^']*'|<(?!!--)|<!--(?:[^-]|-(?!->))*-->)*\]\s*)?>/i,greedy:!0,inside:{"internal-subset":{pattern:/(^[^\[]*\[)[\s\S]+(?=\]>$)/,lookbehind:!0,greedy:!0,inside:null},string:{pattern:/"[^"]*"|'[^']*'/,greedy:!0},punctuation:/^<!|>$|[[\]]/,"doctype-tag":/^DOCTYPE/i,name:/[^\s<>'"]+/}},cdata:{pattern:/<!\[CDATA\[[\s\S]*?\]\]>/i,greedy:!0},tag:{pattern:/<\/?(?!\d)[^\s>\/=$<%]+(?:\s(?:\s*[^\s>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))|(?=[\s/>])))+)?\s*\/?>/,greedy:!0,inside:{tag:{pattern:/^<\/?[^\s>\/]+/,inside:{punctuation:/^<\/?/,namespace:/^[^\s>\/:]+:/}},"special-attr":[],"attr-value":{pattern:/=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+)/,inside:{punctuation:[{pattern:/^=/,alias:"attr-equals"},{pattern:/^(\s*)["']|["']$/,lookbehind:!0}]}},punctuation:/\/?>/,"attr-name":{pattern:/[^\s>\/]+/,inside:{namespace:/^[^\s>\/:]+:/}}}},entity:[{pattern:/&[\da-z]{1,8};/i,alias:"named-entity"},/&#x?[\da-f]{1,8};/i]};Prism.languages.markup.tag.inside["attr-value"].inside.entity=Prism.languages.markup.entity;Prism.languages.markup.doctype.inside["internal-subset"].inside=Prism.languages.markup;Prism.hooks.add("wrap",function(n){n.type==="entity"&&(n.attributes.title=n.content.replace(/&amp;/,"&"))});Object.defineProperty(Prism.languages.markup.tag,"addInlined",{value:function(e,t){var s={};s["language-"+t]={pattern:/(^<!\[CDATA\[)[\s\S]+?(?=\]\]>$)/i,lookbehind:!0,inside:Prism.languages[t]},s.cdata=/^<!\[CDATA\[|\]\]>$/i;var i={"included-cdata":{pattern:/<!\[CDATA\[[\s\S]*?\]\]>/i,inside:s}};i["language-"+t]={pattern:/[\s\S]+/,inside:Prism.languages[t]};var r={};r[e]={pattern:RegExp(/(<__[^>]*>)(?:<!\[CDATA\[(?:[^\]]|\](?!\]>))*\]\]>|(?!<!\[CDATA\[)[\s\S])*?(?=<\/__>)/.source.replace(/__/g,function(){return e}),"i"),lookbehind:!0,greedy:!0,inside:i},Prism.languages.insertBefore("markup","cdata",r)}});Object.defineProperty(Prism.languages.markup.tag,"addAttribute",{value:function(n,e){Prism.languages.markup.tag.inside["special-attr"].push({pattern:RegExp(/(^|["'\s])/.source+"(?:"+n+")"+/\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))/.source,"i"),lookbehind:!0,inside:{"attr-name":/^[^\s=]+/,"attr-value":{pattern:/=[\s\S]+/,inside:{value:{pattern:/(^=\s*(["']|(?!["'])))\S[\s\S]*(?=\2$)/,lookbehind:!0,alias:[e,"language-"+e],inside:Prism.languages[e]},punctuation:[{pattern:/^=/,alias:"attr-equals"},/"|'/]}}}})}});Prism.languages.html=Prism.languages.markup;Prism.languages.mathml=Prism.languages.markup;Prism.languages.svg=Prism.languages.markup;Prism.languages.xml=Prism.languages.extend("markup",{});Prism.languages.ssml=Prism.languages.xml;Prism.languages.atom=Prism.languages.xml;Prism.languages.rss=Prism.languages.xml;function D(n){return n?n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}K`:String(n):"0"}function zn(n){return n?new Date(n).toLocaleString():""}function Pi(n){if(!n)return"Unknown";try{const e=new Date(n),s=new Date-e;return s<6e4?"Just now":s<36e5?`${Math.floor(s/6e4)} min ago`:s<864e5?`${Math.floor(s/36e5)} hours ago`:e.toLocaleDateString()}catch{return"Unknown"}}function Mn(n,e=100){return!n||n.length<=e?n:n.substring(0,e)+"..."}function L(n){const e=document.createElement("div");return e.textContent=n,e.innerHTML}function Pt(n){const e=[],t=n.split(`
`);let s="IDLE",i=null,r=null,a=[],o=[],l=0;for(let d=0;d<t.length;d++){const c=t[d],h=c.trim();s==="IDLE"?h&&!h.startsWith("```")&&!h.startsWith("#")&&(r=h,s="EXPECT_START"):s==="EXPECT_START"?h==="««« EDIT"?(l=d-1,i={filePath:r,startIndex:l},a=[],s="EDIT_SECTION"):h?r=h:(s="IDLE",r=null):s==="EDIT_SECTION"?h==="═══════ REPL"?(i.editLines=a.join(`
`),o=[],s="REPL_SECTION"):a.push(c):s==="REPL_SECTION"&&(h==="»»» EDIT END"?(i.replLines=o.join(`
`),i.endIndex=d,e.push(i),s="IDLE",i=null,r=null):o.push(c))}return e}function ze(n,e){if(!n||n.length===0)return null;const t=i=>i?.replace(/^\.\//,"").replace(/\\/g,"/").trim(),s=t(e);return n.find(i=>t(i.file_path)===s)}const he=new Map,Ii=12;function It(n){let e=5381,t=0;for(let s=0;s<n.length;s++){const i=n[s];t+=i.length;for(let r=0;r<i.length;r++)e=(e<<5)+e+i.charCodeAt(r)|0;e=(e<<5)+e+10|0}return{hash:e,totalLen:t}}function Di(n,e){const t=It(n),s=It(e);return`${n.length}:${e.length}:${t.totalLen}:${s.totalLen}:${t.hash}:${s.hash}`}function Li(n,e){const t=Di(n,e),s=he.get(t);if(s)return s.result;const i=n.length,r=e.length,a=new Array(i+1);for(let p=0;p<=i;p++)a[p]=new Int32Array(r+1);for(let p=1;p<=i;p++)for(let g=1;g<=r;g++)n[p-1]===e[g-1]?a[p][g]=a[p-1][g-1]+1:a[p][g]=Math.max(a[p-1][g],a[p][g-1]);const o=[];let l=i,d=r;for(;l>0||d>0;)l>0&&d>0&&n[l-1]===e[d-1]?(o.push({type:"context",line:n[l-1]}),l--,d--):d>0&&(l===0||a[l][d-1]>=a[l-1][d])?(o.push({type:"add",line:e[d-1]}),d--):(o.push({type:"remove",line:n[l-1]}),l--);const c=o.reverse(),h=zi(c);if(he.size>=Ii){const p=he.keys().next().value;he.delete(p)}return he.set(t,{result:h}),h}function zi(n){const e=[];let t=0;for(;t<n.length;){const s=n[t],i=n[t+1];if(s.type==="remove"&&i?.type==="add"){const r=Mi(s.line,i.line);if(r.similarity>.7){e.push({...s,pair:{charDiff:r.oldSegments}}),e.push({...i,pair:{charDiff:r.newSegments}}),t+=2;continue}}e.push(s),t++}return e}function Mi(n,e){if(n===e)return{oldSegments:[{type:"same",text:n}],newSegments:[{type:"same",text:e}],similarity:1};const t=Dt(n),s=Dt(e),i=t.length,r=s.length;if(i===0&&r===0)return{oldSegments:[],newSegments:[],similarity:1};if(i===0)return{oldSegments:[],newSegments:[{type:"add",text:e}],similarity:0};if(r===0)return{oldSegments:[{type:"remove",text:n}],newSegments:[],similarity:0};const a=Array(i+1).fill(null).map(()=>Array(r+1).fill(0));for(let w=1;w<=i;w++)for(let v=1;v<=r;v++)t[w-1]===s[v-1]?a[w][v]=a[w-1][v-1]+1:a[w][v]=Math.max(a[w-1][v],a[w][v-1]);const o=[],l=[];let d=i,c=r;for(;d>0||c>0;)d>0&&c>0&&t[d-1]===s[c-1]?(o.push({type:"same",text:t[d-1]}),l.push({type:"same",text:s[c-1]}),d--,c--):c>0&&(d===0||a[d][c-1]>=a[d-1][c])?(l.push({type:"add",text:s[c-1]}),c--):(o.push({type:"remove",text:t[d-1]}),d--);const h=Lt(o.reverse()),p=Lt(l.reverse()),k=2*a[i][r]/(i+r);return{oldSegments:h,newSegments:p,similarity:k}}function Dt(n){const e=[];let t="",s=null;for(const i of n){let r;/\s/.test(i)?r="space":/\w/.test(i)?r="word":r="punct",s===null?(s=r,t=i):r===s?t+=i:(e.push(t),t=i,s=r)}return t&&e.push(t),e}function Lt(n){if(n.length===0)return[];const e=[];let t={type:n[0].type,text:n[0].text};for(let s=1;s<n.length;s++)n[s].type===t.type?t.text+=n[s].text:(e.push(t),t={type:n[s].type,text:n[s].text});return e.push(t),e}function zt(n,e){const t=ze(e,n.filePath),s=t?t.status:"pending",i=s==="applied"?"✓ Applied":s==="failed"?"✗ Failed":"○ Pending";let r="";if(t&&t.status==="failed"&&t.reason){const h=t.estimated_line?` (near line ${t.estimated_line})`:"";r=`<div class="edit-block-error">Error: ${L(t.reason)}${h}</div>`}const a=t&&t.estimated_line?`<span class="edit-block-line-info">line ${t.estimated_line}</span>`:"",o=Hi(n.editLines,n.replLines),d=(n.editLines?n.editLines.split(`
`):[]).find(h=>h.trim().length>0)||"",c=L(d).replace(/"/g,"&quot;");return`
    <div class="edit-block" data-file="${L(n.filePath)}">
      <div class="edit-block-header">
        <span class="edit-block-file" data-file="${L(n.filePath)}" data-context="${c}">${L(n.filePath)}</span>
        <div>
          ${a}
          <span class="edit-block-status ${s}">${i}</span>
        </div>
      </div>
      <div class="edit-block-content">
        ${o}
      </div>
      ${r}
    </div>
  `}function Ui(n){if(!n||n.length===0)return"";const e=n.map(r=>{const a=r.status==="applied",o=a?"applied":"failed",l=a?"✓":"✗",d=a?"Applied successfully":`Failed: ${r.reason||"Unknown error"}`;return`<span class="edit-tag ${o}" title="${L(d)}" data-file="${L(r.file_path)}"><span class="edit-tag-icon">${l}</span>${L(r.file_path)}</span>`}).join(""),t=n.filter(r=>r.status==="applied").length,s=n.length-t;let i="";return t>0&&s>0?i=`${t} applied, ${s} failed`:t>0?i=`${t} edit${t>1?"s":""} applied`:i=`${s} edit${s>1?"s":""} failed`,`
    <div class="edits-summary">
      <div class="edits-summary-header">✏️ Edits: ${i}</div>
      <div class="edits-summary-list">${e}</div>
    </div>
  `}function Hi(n,e){const t=n?n.split(`
`):[],s=e?e.split(`
`):[];return t.length===0&&s.length===0?"":Li(t,s).map(a=>{const o=a.type==="add"?"+":a.type==="remove"?"-":" ";if(a.pair?.charDiff){const d=Oi(a.pair.charDiff,a.type);return`<span class="diff-line ${a.type}"><span class="diff-line-prefix">${o}</span>${d}</span>`}const l=L(a.line);return`<span class="diff-line ${a.type}"><span class="diff-line-prefix">${o}</span>${l}</span>`}).join(`
`)}function Oi(n,e){return n.map(t=>{const s=L(t.text);return t.type==="same"?s:e==="remove"&&t.type==="remove"||e==="add"&&t.type==="add"?`<span class="diff-change">${s}</span>`:s}).join("")}function Ni(n,e){let t='<div class="streaming-edit-pulse"></div>';if(e&&e.length>0){const s=e.findIndex(i=>i.startsWith("═══════"));if(s===-1)t=e.map(i=>`<span class="diff-line context"><span class="diff-line-prefix"> </span>${L(i)}</span>`).join(`
`);else{const i=e.slice(0,s),r=e.slice(s+1);t=ji(i,r)}t+=`
<div class="streaming-edit-pulse"></div>`}return`
    <div class="edit-block in-progress">
      <div class="edit-block-header">
        <span class="edit-block-file">${L(n)}</span>
        <div>
          <span class="edit-block-status pending">⏳ Writing...</span>
        </div>
      </div>
      <div class="edit-block-content">
        ${t}
      </div>
    </div>
  `}function ji(n,e){let t=0;const s=Math.min(n.length,e.length);for(;t<s&&n[t]===e[t];)t++;const i=[];for(let r=0;r<t;r++)i.push(`<span class="diff-line context"><span class="diff-line-prefix"> </span>${L(n[r])}</span>`);for(let r=t;r<n.length;r++)i.push(`<span class="diff-line remove"><span class="diff-line-prefix">-</span>${L(n[r])}</span>`);for(let r=t;r<e.length;r++)i.push(`<span class="diff-line add"><span class="diff-line-prefix">+</span>${L(e[r])}</span>`);return i.join(`
`)}function Bi(n,e,t){if(!e||e.length===0)return{html:n,foundFiles:[]};const s=t?new Set(t):new Set,i=n.toLowerCase(),r=e.filter(k=>i.includes(k.toLowerCase()));if(r.length===0)return{html:n,foundFiles:[]};r.sort((k,w)=>w.length-k.length);const a=r.map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),o=new RegExp(`(${a.join("|")})`,"g"),l=new Set,d=[],c=/<pre\b[^>]*>[\s\S]*?<\/pre>/gi;let h;for(;(h=c.exec(n))!==null;)d.push([h.index,h.index+h[0].length]);const p=k=>{for(const[w,v]of d){if(k>=w&&k<v)return!0;if(w>k)break}return!1};return{html:n.replace(o,(k,w,v)=>{if(p(v))return k;const T=n.substring(Math.max(0,v-500),v),f=T.lastIndexOf("<"),u=T.lastIndexOf(">");return f>u||n.substring(Math.max(0,v-50),v).includes('class="file-mention')?k:(l.add(w),`<span class="file-mention${s.has(w)?" in-context":""}" data-file="${w}">${w}</span>`)}),foundFiles:[...l]}}function qi(n,e){if(n.length===0)return"";const t=n.filter(a=>!e||!e.includes(a)),s=t.length>1,i=n.map(a=>{const o=e&&e.includes(a),l=o?"in-context":"not-in-context",d=o?"✓":"+";return`<span class="file-chip ${l}" data-file="${L(a)}"><span class="chip-icon">${d}</span>${L(a)}</span>`}).join("");return`
    <div class="files-summary">
      <div class="files-summary-header">📁 Files Referenced ${s?`<button class="select-all-btn" data-files='${JSON.stringify(t)}'>+ Add All (${t.length})</button>`:""}</div>
      <div class="files-summary-list">${i}</div>
    </div>
  `}function Vi(n,e){const t=n.dataset.file;t&&e.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:t},bubbles:!0,composed:!0}))}function Wi(n,e){const t=n.dataset.file,s=n.dataset.context;if(t){const i=ze(e.editResults,t);e.dispatchEvent(new CustomEvent("edit-block-click",{detail:{path:t,line:i?.estimated_line||1,status:i?.status||"pending",searchContext:s||null},bubbles:!0,composed:!0}))}}function Gi(n,e){const t=n.dataset.file;if(t){const s=ze(e.editResults,t);e.dispatchEvent(new CustomEvent("edit-block-click",{detail:{path:t,line:s?.estimated_line||1,status:s?.status||"pending",searchContext:null},bubbles:!0,composed:!0}))}}function Xi(n,e){const t=n.dataset.file;t&&e.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:t},bubbles:!0,composed:!0}))}function Yi(n,e){try{const t=JSON.parse(n.dataset.files||"[]");for(const s of t)e.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:s},bubbles:!0,composed:!0}))}catch(t){console.error("Failed to parse files:",t)}}function Zi(n,e){const t=n.dataset.file;if(t){const s=ze(e.editResults,t);e.dispatchEvent(new CustomEvent("edit-block-click",{detail:{path:t,line:s?.estimated_line||1,status:s?.status||"pending",searchContext:null},bubbles:!0,composed:!0}))}}const Ki=[{selector:".file-mention",handler:Vi},{selector:".edit-block-file",handler:Wi},{selector:".edit-tag",handler:Gi},{selector:".file-chip",handler:Xi},{selector:".select-all-btn",handler:Yi},{selector:".edit-block",handler:Zi}];function Ji(n,e){for(const{selector:t,handler:s}of Ki){const i=n.target.closest(t);if(i){s(i,e);return}}}class Qi extends H{static properties={content:{type:String},role:{type:String},mentionedFiles:{type:Array},selectedFiles:{type:Array},editResults:{type:Array},final:{type:Boolean},streaming:{type:Boolean,reflect:!0}};static styles=N`
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

    /* Streaming cursor */
    :host([streaming]) .content::after {
      content: '▌';
      display: inline;
      animation: blink 0.8s step-end infinite;
      color: #e94560;
      font-weight: bold;
    }

    @keyframes blink {
      50% { opacity: 0; }
    }

    /* In-progress edit block pulse */
    .streaming-edit-pulse {
      height: 24px;
      background: linear-gradient(90deg, transparent, rgba(233,69,96,0.1), transparent);
      background-size: 200% 100%;
      animation: pulse-sweep 1.5s ease-in-out infinite;
    }

    @keyframes pulse-sweep {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `;constructor(){super(),this.content="",this.role="assistant",this.mentionedFiles=[],this.selectedFiles=[],this.editResults=[],this.final=!0,this.streaming=!1,this._foundFiles=[],this._codeScrollPositions=new Map,this._cachedContent=null,this._cachedResult=null,this._cachedFinal=null,this._incrementalHtml="",this._incrementalParsedTo=0,this._incrementalFenceOpen=!1,F.setOptions({highlight:(e,t)=>t&&Prism.languages[t]?Prism.highlight(e,Prism.languages[t],t):e,breaks:!0,gfm:!0})}processContent(){if(!this.content)return"";if(this.role==="user")return L(this.content).replace(/\n/g,"<br>");if(this._cachedContent===this.content&&this._cachedResult&&this._cachedFinal===this.final)return this._cachedResult;if(!this.final){if(this.content.includes("««« EDIT")){const a=this._processStreamingWithEditBlocks(this.content);return this._streamCacheSource=this.content,this._streamCache=a,this._cachedContent=null,this._cachedResult=null,a}const r=this._incrementalParse(this.content);return this._streamCacheSource=this.content,this._streamCache=r,this._cachedContent=null,this._cachedResult=null,r}this._cachedContent=this.content;const t=this.content.includes("««« EDIT");let s;return t?s=this.processContentWithEditBlocks(this.content):this._streamCache&&this._streamCacheSource===this.content?s=this._streamCache:s=F.parse(this.content),this._streamCache=null,this._streamCacheSource=null,this._incrementalHtml="",this._incrementalParsedTo=0,this._incrementalFenceOpen=!1,s=this.wrapCodeBlocksWithCopyButton(s),s=this.highlightFileMentions(s),this._cachedResult=s,this._cachedFinal=this.final,s}processContentWithEditBlocks(e){const t=Pt(e);if(t.length===0)return F.parse(e);const s=e.split(`
`),i=[];let r=0;for(const v of t){if(v.startIndex>r){const T=s.slice(r,v.startIndex);i.push({type:"text",content:T.join(`
`)})}i.push({type:"edit",block:v}),r=v.endIndex+1}if(r<s.length){const v=s.slice(r);i.push({type:"text",content:v.join(`
`)})}const a=`

<!--EDIT_BLOCK_`,o=`-->

`;let l="",d=0;for(const v of i)v.type==="text"?l+=v.content:(l+=`${a}${d}${o}`,d++);const c=F.parse(l),h=i.filter(v=>v.type==="edit"),p=/<!--EDIT_BLOCK_(\d+)-->/g;let g="",k=0,w;for(;(w=p.exec(c))!==null;){g+=c.slice(k,w.index);const v=parseInt(w[1],10);v<h.length&&(g+=zt(h[v].block,this.editResults)),k=w.index+w[0].length}return g+=c.slice(k),g}_incrementalParse(e){this._incrementalParsedTo>0&&!e.startsWith(e.slice(0,this._incrementalParsedTo))&&(this._incrementalHtml="",this._incrementalParsedTo=0,this._incrementalFenceOpen=!1);const t=e.slice(this._incrementalParsedTo),s=this._findSafeSplit(t);if(s>0){const a=t.slice(0,s);this._incrementalHtml+=F.parse(a),this._incrementalParsedTo+=s}const i=e.slice(this._incrementalParsedTo);if(!i)return this._incrementalHtml;const r=L(i).replace(/\n/g,"<br>");return this._incrementalHtml+r}_findSafeSplit(e){let t=0,s=this._incrementalFenceOpen;const i=e.split(`
`);let r=0;for(let a=0;a<i.length;a++){const o=i[a],l=o.trimStart();l.startsWith("```")&&(s=!s),r+=o.length+1,!s&&l===""&&a>0&&(t=r)}if(t>0){let a=this._incrementalFenceOpen;const l=e.slice(0,t).split(`
`);for(const d of l)d.trimStart().startsWith("```")&&(a=!a);this._incrementalFenceOpen=a}return t}_processStreamingWithEditBlocks(e){const t=Pt(e),s=e.split(`
`);let i=null;const r=e.lastIndexOf("««« EDIT"),a=e.lastIndexOf("»»» EDIT END");if(r>a){const h=e.slice(0,r).trimEnd().split(`
`),p=h[h.length-1]?.trim();p&&!p.startsWith("```")&&!p.startsWith("#")&&(i=p)}const o=[];let l=0;for(const c of t){if(c.startIndex>l){const h=s.slice(l,c.startIndex);o.push({type:"text",content:h.join(`
`)})}o.push({type:"edit",block:c}),l=c.endIndex+1}if(l<s.length)if(i!==null){const c=s.indexOf(i,l);if(c>l){const g=s.slice(l,c);o.push({type:"text",content:g.join(`
`)})}else if(c===-1&&l<s.length){const g=s.findIndex((k,w)=>w>=l&&k.trim()==="««« EDIT");if(g>l+1){const k=s.slice(l,g-1);o.push({type:"text",content:k.join(`
`)})}}const h=s.findIndex((g,k)=>k>=l&&g.trim()==="««« EDIT"),p=h!==-1?s.slice(h+1):[];o.push({type:"in-progress",filePath:i,partialLines:p})}else{const c=s.slice(l);o.push({type:"text",content:c.join(`
`)})}let d="";for(const c of o)c.type==="text"?c.content.trim()&&(d+=F.parse(c.content)):c.type==="edit"?d+=zt(c.block,[]):c.type==="in-progress"&&(d+=Ni(c.filePath,c.partialLines));return d}wrapCodeBlocksWithCopyButton(e){const t=/(<pre[^>]*>)(\s*<code[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/gi;return e.replace(t,(s,i,r,a,o)=>`<div class="code-wrapper">${i}${r}${a}${o}<button class="copy-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">Copy</button></div>`)}highlightFileMentions(e){const{html:t,foundFiles:s}=Bi(e,this.mentionedFiles,this.selectedFiles);return this._foundFiles=s,t}renderEditsSummary(){return Ui(this.editResults)}renderFilesSummary(){return qi(this._foundFiles,this.selectedFiles)}handleClick(e){Ji(e,this)}willUpdate(){if(this._codeScrollPositions.clear(),this.final&&this.content?.includes("```")){const e=this.shadowRoot?.querySelectorAll("pre");e&&e.forEach((t,s)=>{t.scrollLeft>0&&this._codeScrollPositions.set(s,t.scrollLeft)})}}updated(){if(this._codeScrollPositions.size>0){const e=this.shadowRoot?.querySelectorAll("pre");e&&this._codeScrollPositions.forEach((t,s)=>{e[s]&&(e[s].scrollLeft=t)})}}render(){const e=this.processContent(),t=this.final;return m`
      <div class="content" @click=${this.handleClick}>
        ${je(e)}
        ${t&&this.role==="assistant"?je(this.renderEditsSummary()):""}
        ${t&&this.role==="assistant"?je(this.renderFilesSummary()):""}
      </div>
    `}}customElements.define("card-markdown",Qi);class en extends H{static properties={content:{type:String},mentionedFiles:{type:Array},selectedFiles:{type:Array},editResults:{type:Array},final:{type:Boolean}};shouldUpdate(e){for(const[t,s]of e){const i=this[t];if(i!==s)if(Array.isArray(i)&&Array.isArray(s)){if(i.length!==s.length||i.some((r,a)=>r!==s[a]))return!0}else return!0}return!1}static styles=N`
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
  `;copyToClipboard(){navigator.clipboard.writeText(this.content)}copyToPrompt(){this.dispatchEvent(new CustomEvent("copy-to-prompt",{detail:{content:this.content},bubbles:!0,composed:!0}))}render(){return m`
      <div class="card">
        <div class="header">
          <div class="label">Assistant</div>
          <div class="actions">
            <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
            <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
          </div>
        </div>
        <card-markdown .content=${this.content} role="assistant" .final=${this.final!==!1} ?streaming=${this.final===!1} .mentionedFiles=${this.mentionedFiles||[]} .selectedFiles=${this.selectedFiles||[]} .editResults=${this.editResults||[]}></card-markdown>
        <div class="footer-actions">
          <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
          <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
        </div>
      </div>
    `}}customElements.define("assistant-card",en);class tn extends H{static properties={isListening:{type:Boolean,state:!0},autoTranscribe:{type:Boolean,state:!0},isSupported:{type:Boolean,state:!0},ledStatus:{type:String,state:!0}};constructor(){super(),this.isListening=!1,this.autoTranscribe=!1,this.isSupported="webkitSpeechRecognition"in window||"SpeechRecognition"in window,this.ledStatus="inactive",this.recognition=null,this._initSpeechRecognition()}static styles=N`
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
  `;connectedCallback(){super.connectedCallback(),this.isSupported&&(this.recognition||this._initSpeechRecognition())}disconnectedCallback(){if(this.recognition)try{this.recognition.stop()}catch{}super.disconnectedCallback()}_initSpeechRecognition(){if(!this.isSupported)return;const e=window.SpeechRecognition||window.webkitSpeechRecognition;this.recognition=new e,this.recognition.continuous=!1,this.recognition.interimResults=!1,this.recognition.lang=navigator.language||"en-US",this.recognition.onstart=this._handleStart.bind(this),this.recognition.onresult=this._handleResult.bind(this),this.recognition.onerror=this._handleError.bind(this),this.recognition.onend=this._handleEnd.bind(this),this.recognition.onspeechstart=this._handleSpeechStart.bind(this),this.recognition.onspeechend=this._handleSpeechEnd.bind(this)}_handleStart(){this.isListening=!0,this.ledStatus="listening",this.dispatchEvent(new CustomEvent("recording-started",{bubbles:!0,composed:!0}))}_handleSpeechStart(){this.ledStatus="speaking"}_handleSpeechEnd(){this.autoTranscribe&&this.isListening&&(this.ledStatus="listening")}_handleResult(e){if(e.results.length>0){const t=e.results[e.resultIndex][0].transcript;this.dispatchEvent(new CustomEvent("transcript",{detail:{text:t},bubbles:!0,composed:!0})),this.autoTranscribe||this.stopListening()}}_handleError(e){console.error("Speech recognition error:",e.error),this.stopListening(),this.dispatchEvent(new CustomEvent("recognition-error",{detail:{error:e.error},bubbles:!0,composed:!0}))}_handleEnd(){this.autoTranscribe&&this.isListening?setTimeout(()=>{try{this.recognition.start()}catch(e){console.error("Error restarting recognition:",e),this.isListening=!1,this.ledStatus="inactive"}},100):(this.isListening=!1,this.ledStatus="inactive")}startListening(){if(!(!this.isSupported||this.isListening))try{this.recognition.start()}catch(e){console.error("Error starting recognition:",e)}}stopListening(){if(!(!this.isSupported||!this.isListening))try{this.recognition.stop()}catch(e){console.error("Error stopping recognition:",e),this.isListening=!1,this.ledStatus="inactive"}}_toggleListening(){this.isListening?this.stopListening():this.startListening()}_toggleAutoTranscribe(){this.autoTranscribe=!this.autoTranscribe,this.autoTranscribe?this.startListening():this.stopListening()}render(){if(!this.isSupported)return m``;const e=this.ledStatus==="speaking"?"speaking":this.isListening?"listening":"";return m`
      <button 
        class="mic-btn ${e}"
        @click=${this._toggleAutoTranscribe}
        title=${this.autoTranscribe?"Stop auto-transcribe":"Enable auto-transcribe (continuous listening)"}
      >🎤</button>
    `}}customElements.define("speech-to-text",tn);const sn={L0:"#4ade80",L1:"#2dd4bf",L2:"#60a5fa",L3:"#fbbf24",active:"#fb923c"};function Xe(n){return sn[n]||"#888"}function nn(n){const e=n.tier_info;if(!e)return"";const t=["L0","L1","L2","L3","active"],s=n.prompt_tokens||0,i=n.cache_hit_tokens||0,r=s>0?Math.round(i/s*100):0,a=t.map(o=>{const l=e[o];if(!l||l.tokens===0&&o!=="L0")return null;const d=l.tokens||0,c=l.symbols||0,h=l.files||0,p=o!=="active",g=[];o==="L0"&&(l.has_system&&g.push("sys"),l.has_legend&&g.push("legend")),c>0&&g.push(`${c}sym`),h>0&&g.push(`${h}f`),l.has_urls&&g.push("urls");const k=l.history||0;k>0?g.push(`${k}hist`):l.has_history&&g.push("hist");const w=g.length>0?g.join("+"):"—",v=o==="active"?"active":`${o}`;return m`
      <div class="hud-tier-row" style="--tier-color: ${Xe(o)}">
        <span class="hud-tier-label">${v}</span>
        <span class="hud-tier-contents">${w}</span>
        <span class="hud-tier-tokens">${D(d)}</span>
        ${p?m`<span class="hud-tier-cached">●</span>`:m`<span class="hud-tier-uncached">○</span>`}
      </div>
    `}).filter(o=>o!==null);return m`
    <div class="hud-divider"></div>
    <div class="hud-section-title">Cache Tiers</div>
    <div class="hud-cache-header">
      <span class="hud-cache-percent" style="--cache-percent-color: ${r>50?"#7ec699":r>20?"#f0a500":"#e94560"}">
        ${r}% cache hit
      </span>
    </div>
    <div class="hud-tier-list">
      ${a}
    </div>
  `}function rn(n){if(!n.tier_info)return"";const t=n.promotions||[],s=n.demotions||[];if(t.length===0&&s.length===0)return"";const i=r=>{if(!r)return"?";if(r.startsWith("history:")){const l=r.slice(8);return l.length>20?"💬"+l.substring(0,20)+"…":"💬"+l}const a=r.replace("symbol:","📦 "),o=a.split("/");return o.length>2?"..."+o.slice(-2).join("/"):a};return m`
    <div class="hud-divider"></div>
    <div class="hud-section-title">Tier Changes</div>
    ${t.length>0?m`
      <div class="hud-row promotion">
        <span class="hud-label">📈</span>
        <span class="hud-value hud-changes">${t.slice(0,3).map(r=>m`<span>${i(r[0])}</span><span style="color:${Xe(r[1])}">→${r[1]} </span>`)}${t.length>3?m` +${t.length-3}`:""}</span>
      </div>
    `:""}
    ${s.length>0?m`
      <div class="hud-row demotion">
        <span class="hud-label">📉</span>
        <span class="hud-value hud-changes">${s.slice(0,3).map(r=>m`<span>${i(r[0])}</span><span style="color:${Xe("active")}">${r[1]}→active </span>`)}${s.length>3?m` +${s.length-3}`:""}</span>
      </div>
    `:""}
  `}function an(n){if(!n._hudVisible||!n._hudData)return"";const e=n._hudData,t=e.prompt_tokens||0,s=e.cache_hit_tokens||0,i=t>0?Math.round(s/t*100):0;return m`
    <div class="token-hud ${n._hudVisible?"visible":""}"
         @mouseenter=${()=>n._onHudMouseEnter()}
         @mouseleave=${()=>n._onHudMouseLeave()}>
      <div class="hud-header">
        <div class="hud-title">📊 Tokens</div>
        ${s>0?m`
          <div class="hud-cache-badge" style="--cache-color: ${i>50?"#7ec699":i>20?"#f0a500":"#e94560"}">
            ${i}% cached
          </div>
        `:""}
      </div>
      ${e.system_tokens!==void 0?m`
        <div class="hud-section-title">Context Breakdown</div>
        <div class="hud-row">
          <span class="hud-label">System:</span>
          <span class="hud-value">${D(e.system_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Symbol Map:</span>
          <span class="hud-value">${D(e.symbol_map_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Files:</span>
          <span class="hud-value">${D(e.file_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">History:</span>
          <span class="hud-value">${D(e.history_tokens)}</span>
        </div>
        <div class="hud-row total">
          <span class="hud-label">Context:</span>
          <span class="hud-value">${D(e.context_total_tokens)} / ${D(e.max_input_tokens)}</span>
        </div>
      `:""}
      ${nn(e)}
      <div class="hud-divider"></div>
      <div class="hud-section-title">This Request</div>
      <div class="hud-row">
        <span class="hud-label">Prompt:</span>
        <span class="hud-value">${D(e.prompt_tokens)}</span>
      </div>
      <div class="hud-row">
        <span class="hud-label">Response:</span>
        <span class="hud-value">${D(e.completion_tokens)}</span>
      </div>
      <div class="hud-row total">
        <span class="hud-label">Total:</span>
        <span class="hud-value">${D(e.total_tokens)}</span>
      </div>
      ${e.cache_hit_tokens?m`
        <div class="hud-row cache">
          <span class="hud-label">Cache hit:</span>
          <span class="hud-value">${D(e.cache_hit_tokens)} (${i}%)</span>
        </div>
      `:""}
      ${e.cache_write_tokens?m`
        <div class="hud-row cache-write">
          <span class="hud-label">Cache write:</span>
          <span class="hud-value">${D(e.cache_write_tokens)}</span>
        </div>
      `:""}
      ${e.history_tokens!==void 0?m`
        <div class="hud-divider"></div>
        <div class="hud-row history ${e.history_tokens>e.history_threshold*.95?"critical":e.history_tokens>e.history_threshold*.8?"warning":""}">
          <span class="hud-label">History:</span>
          <span class="hud-value">${D(e.history_tokens)} / ${D(e.history_threshold)}</span>
        </div>
      `:""}
      ${rn(e)}
      ${e.session_total_tokens?m`
        <div class="hud-divider"></div>
        <div class="hud-section-title">Session Total</div>
        <div class="hud-row cumulative">
          <span class="hud-label">In:</span>
          <span class="hud-value">${D(e.session_prompt_tokens)}</span>
        </div>
        <div class="hud-row cumulative">
          <span class="hud-label">Out:</span>
          <span class="hud-value">${D(e.session_completion_tokens)}</span>
        </div>
        <div class="hud-row cumulative total">
          <span class="hud-label">Total:</span>
          <span class="hud-value">${D(e.session_total_tokens)}</span>
        </div>
      `:""}
    </div>
  `}function on(n){const e=n.detectedUrls?.length>0,t=Object.keys(n.fetchedUrls||{}).length>0,s=Object.keys(n.fetchingUrls||{}).length>0;return!e&&!t&&!s?"":m`
    <div class="url-chips-area">
      ${t?m`
        <div class="url-chips-row fetched">
          ${Object.values(n.fetchedUrls).map(i=>{const r=!n.excludedUrls?.has(i.url),a=i.error?"error":r?"success":"excluded";return m`
              <div class="url-chip fetched ${a}" 
                   title=${i.error?i.error:i.summary||i.readme||"No summary available"}>
                ${i.error?m`
                  <span class="url-chip-icon">❌</span>
                `:m`
                  <input 
                    type="checkbox" 
                    class="url-chip-checkbox"
                    .checked=${r}
                    @change=${()=>n.toggleUrlIncluded(i.url)}
                    title="${r?"Click to exclude from context":"Click to include in context"}"
                  />
                `}
                <span class="url-chip-label" 
                      @click=${()=>n.viewUrlContent(i)}
                      style="cursor: pointer;">
                  ${i.title||n.getUrlDisplayName({url:i.url})}
                </span>
                <button class="url-chip-remove" @click=${()=>n.removeFetchedUrl(i.url)} title="Remove">×</button>
              </div>
            `})}
        </div>
      `:""}
      ${e||s?m`
        <div class="url-chips-row detected">
          ${(n.detectedUrls||[]).map(i=>m`
            <div class="url-chip detected">
              <span class="url-chip-type">${n.getUrlTypeLabel(i.type)}</span>
              <span class="url-chip-label" title=${i.url}>
                ${n.getUrlDisplayName(i)}
              </span>
              ${n.fetchingUrls?.[i.url]?m`<span class="url-chip-loading">⏳</span>`:m`
                    <button class="url-chip-fetch" @click=${()=>n.fetchUrl(i)} title="Fetch content">
                      📥
                    </button>
                    <button class="url-chip-dismiss" @click=${()=>n.dismissUrl(i.url)} title="Dismiss">×</button>
                  `}
            </div>
          `)}
          ${Object.entries(n.fetchingUrls||{}).filter(([i])=>!(n.detectedUrls||[]).some(r=>r.url===i)).map(([i])=>m`
            <div class="url-chip fetching">
              <span class="url-chip-loading">⏳</span>
              <span class="url-chip-label">Fetching...</span>
            </div>
          `)}
        </div>
      `:""}
    </div>
  `}function ln(n){const e=n._hudData?.history_tokens||0,t=n._hudData?.history_threshold||9e3;if(t<=0)return"";const s=Math.min(100,e/t*100),i=s>95?"critical":s>80?"warning":"";return m`
    <div class="history-bar ${i}" title="History: ${D(e)} / ${D(t)} (${Math.round(s)}%)">
      <div class="history-bar-fill" style="width: ${s}%"></div>
    </div>
  `}function cn(n){return!n.promptSnippets||n.promptSnippets.length===0?"":m`
    <div class="snippet-drawer ${n.snippetDrawerOpen?"open":""}">
      <button 
        class="snippet-drawer-toggle ${n.snippetDrawerOpen?"open":""}" 
        @click=${()=>n.toggleSnippetDrawer()}
        title="${n.snippetDrawerOpen?"Close snippets":"Open snippets"}"
      >📋</button>
      <div class="snippet-drawer-content">
        ${n.promptSnippets.map(e=>m`
          <button 
            class="snippet-btn" 
            @click=${()=>n.appendSnippet(e.message)}
            title="${e.tooltip}"
          >${e.icon}</button>
        `)}
      </div>
    </div>
  `}const Mt=[];function dn(n){return n.minimized?"":m`
    <div class="resize-handle resize-handle-n" @mousedown=${e=>n._handleResizeStart(e,"n")}></div>
    <div class="resize-handle resize-handle-s" @mousedown=${e=>n._handleResizeStart(e,"s")}></div>
    <div class="resize-handle resize-handle-e" @mousedown=${e=>n._handleResizeStart(e,"e")}></div>
    <div class="resize-handle resize-handle-w" @mousedown=${e=>n._handleResizeStart(e,"w")}></div>
    <div class="resize-handle resize-handle-ne" @mousedown=${e=>n._handleResizeStart(e,"ne")}></div>
    <div class="resize-handle resize-handle-nw" @mousedown=${e=>n._handleResizeStart(e,"nw")}></div>
    <div class="resize-handle resize-handle-se" @mousedown=${e=>n._handleResizeStart(e,"se")}></div>
    <div class="resize-handle resize-handle-sw" @mousedown=${e=>n._handleResizeStart(e,"sw")}></div>
  `}function Ut(n){return n.minimized?"":m`
    <div class="panel-resizer">
      <div class="panel-resizer-handle" @mousedown=${e=>n._handlePanelResizeStart(e)}></div>
      <button class="panel-collapse-btn" @click=${()=>n.toggleLeftPanel()} title="${n.leftPanelCollapsed?"Expand panel":"Collapse panel"}">
        ${n.leftPanelCollapsed?"▶":"◀"}
      </button>
    </div>
  `}function hn(n){const e=n.dialogX!==null&&n.dialogY!==null,t=e?`left: ${n.dialogX}px; top: ${n.dialogY}px;`:"",s=n.getResizeStyle?n.getResizeStyle():"",i=[t,s].filter(Boolean).join("; ");return m`
    ${an(n)}
    <history-browser
      .visible=${n.showHistoryBrowser}
      @copy-to-prompt=${r=>n.handleHistoryCopyToPrompt(r)}
      @load-session=${r=>n.handleLoadSession(r)}
    ></history-browser>
    <div class="dialog ${n.minimized?"minimized":""} ${n.showFilePicker?"with-picker":""} ${e?"dragged":""}"
         style=${i}>
      ${dn(n)}
      <div class="header" @mousedown=${r=>n._handleDragStart(r)}>
        <div class="header-section header-left" @click=${n.toggleMinimize}>
          <span>${n.activeLeftTab===E.FILES?"💬 Chat":n.activeLeftTab===E.SEARCH?"🔍 Search":n.activeLeftTab===E.CONTEXT?"📊 Context":n.activeLeftTab===E.CACHE?"🗄️ Cache":"⚙️ Settings"}</span>
        </div>
        <div class="header-section header-tabs">
          <button 
            class="header-tab ${n.activeLeftTab===E.FILES?"active":""}"
            @click=${r=>{r.stopPropagation(),n.switchTab(E.FILES)}}
            title="Files & Chat"
          >📁</button>
          <button 
            class="header-tab ${n.activeLeftTab===E.SEARCH?"active":""}"
            @click=${r=>{r.stopPropagation(),n.switchTab(E.SEARCH)}}
            title="Search"
          >🔍</button>
          <button 
            class="header-tab ${n.activeLeftTab===E.CONTEXT?"active":""}"
            @click=${r=>{r.stopPropagation(),n.switchTab(E.CONTEXT)}}
            title="Context Budget"
          >📊</button>
          <button 
            class="header-tab ${n.activeLeftTab===E.CACHE?"active":""}"
            @click=${r=>{r.stopPropagation(),n.switchTab(E.CACHE)}}
            title="Cache Tiers"
          >🗄️</button>
          <button 
            class="header-tab ${n.activeLeftTab===E.SETTINGS?"active":""}"
            @click=${r=>{r.stopPropagation(),n.switchTab(E.SETTINGS)}}
            title="Settings"
          >⚙️</button>
        </div>
        <div class="header-section header-git">
          ${!n.minimized&&n.activeLeftTab===E.FILES?m`
            <button class="header-btn" @click=${n.copyGitDiff} title="Copy git diff HEAD to clipboard">
              📋
            </button>
            <button class="header-btn commit-btn" @click=${n.handleCommit} title="Generate commit message and commit">
              💾
            </button>
            <button class="header-btn reset-btn" @click=${n.handleResetHard} title="Reset to HEAD (discard all changes)">
              ⚠️
            </button>
          `:""}
        </div>
        <div class="header-section header-right">
          ${!n.minimized&&n.activeLeftTab===E.FILES?m`
            <button class="header-btn" @click=${n.toggleHistoryBrowser} title="View conversation history">
              📜
            </button>
            <button class="header-btn" @click=${n.clearContext} title="Clear conversation context">
              🗑️
            </button>
          `:""}
          <button class="header-btn" @click=${n.toggleMinimize}>${n.minimized?"▲":"▼"}</button>
        </div>
      </div>
      ${n.minimized?"":m`
        <div class="main-content">
          <div class="files-tab-panel ${n.activeLeftTab!==E.FILES?"tab-hidden":""}">
            ${n.showFilePicker&&!n.leftPanelCollapsed?m`
              <div class="picker-panel" style="width: ${n.leftPanelWidth}px">
                <file-picker
                  .tree=${n.fileTree}
                  .modified=${n.modifiedFiles}
                  .staged=${n.stagedFiles}
                  .untracked=${n.untrackedFiles}
                  .diffStats=${n.diffStats}
                  .viewingFile=${n.viewingFile}
                  .selected=${n._selectedObject}
                  .expanded=${n.filePickerExpanded}
                  @selection-change=${n.handleSelectionChange}
                  @expanded-change=${n.handleExpandedChange}
                  @file-view=${n.handleFileView}
                  @copy-path-to-prompt=${n.handleCopyPathToPrompt}
                ></file-picker>
              </div>
              ${Ut(n)}
            `:n.showFilePicker&&n.leftPanelCollapsed?m`
              ${Ut(n)}
            `:""}
            <div class="chat-panel"
                 @dragover=${r=>n._handleDragOver(r)}
                 @drop=${r=>n._handleDrop(r)}>
              <div class="messages-wrapper">
                <div class="messages" id="messages-container" @copy-to-prompt=${r=>n.handleCopyToPrompt(r)} @file-mention-click=${r=>n.handleFileMentionClick(r)} @wheel=${r=>n.handleWheel(r)}>
                  ${_i(n.messageHistory,r=>r.id,r=>{if(r.role==="user")return m`<user-card .content=${r.content} .images=${r.images||Mt}></user-card>`;if(r.role==="assistant")return m`<assistant-card .content=${r.content} .final=${r.final!==!1} .mentionedFiles=${n._addableFiles} .selectedFiles=${n.selectedFiles} .editResults=${r.editResults||Mt}></assistant-card>`})}
                  <div id="scroll-sentinel"></div>
                </div>
                ${n._showScrollButton?m`
                  <button class="scroll-to-bottom-btn" @click=${()=>n.scrollToBottomNow()} title="Scroll to bottom">
                    ↓
                  </button>
                `:""}
              </div>
              ${n.pastedImages.length>0?m`
                <div class="image-preview-area">
                  ${n.pastedImages.map((r,a)=>m`
                    <div class="image-preview">
                      <img src=${r.preview} alt=${r.name}>
                      <button class="remove-image" @click=${()=>n.removeImage(a)}>×</button>
                    </div>
                  `)}
                  <button class="clear-images" @click=${()=>n.clearImages()}>Clear all</button>
                </div>
              `:""}
              ${on(n)}
              <div class="input-area">
                ${n._showHistorySearch?m`
                  <div class="history-search-dropdown">
                    ${n._historySearchResults.length>0?m`
                      <div class="history-search-results">
                        ${[...n._historySearchResults].reverse().map((r,a)=>{const o=n._historySearchResults.length-1-a;return m`
                            <div class="history-search-item ${o===n._historySearchIndex?"selected":""}"
                                 @click=${()=>n._selectHistorySearchResult(o)}
                                 @mouseenter=${()=>{n._historySearchIndex=o,n.requestUpdate()}}>
                              <span class="history-search-preview">${r.preview}</span>
                            </div>
                          `})}
                      </div>
                    `:m`
                      <div class="history-search-empty">No matches</div>
                    `}
                    <input class="history-overlay-input"
                           type="text"
                           placeholder="Type to search history..."
                           .value=${n._historySearchQuery||""}
                           @input=${r=>n._handleHistoryOverlayInput(r)}
                           @keydown=${r=>n._handleHistoryOverlayKeydown(r)}
                           @blur=${()=>setTimeout(()=>n._closeHistorySearch(),150)}
                    />
                  </div>
                `:""}
                <div class="input-buttons-stack">
                  <speech-to-text @transcript=${r=>n.handleSpeechTranscript(r)}></speech-to-text>
                  ${cn(n)}
                </div>
                <textarea
                  placeholder="Type a message... (paste images with Ctrl+V)"
                  .value=${n.inputValue}
                  @input=${n.handleInput}
                  @keydown=${n.handleKeyDown}
                  ?disabled=${n.isStreaming||n.isCompacting}
                ></textarea>
                ${n.isStreaming||n.isCompacting?m`<button class="send-btn stop-btn" @click=${()=>n.stopStreaming()}>Stop</button>`:m`<button class="send-btn" @click=${n.sendMessage}>Send</button>`}
              </div>
            </div>
          </div>
          ${n._visitedTabs.has(E.SEARCH)?m`
            <div class="embedded-panel ${n.activeLeftTab!==E.SEARCH?"tab-hidden":""}">
              <find-in-files
                @result-selected=${r=>n.handleSearchResultSelected(r)}
                @file-selected=${r=>n.handleSearchFileSelected(r)}
              ></find-in-files>
            </div>
          `:""}
          ${n._visitedTabs.has(E.CONTEXT)?m`
            <div class="embedded-panel ${n.activeLeftTab!==E.CONTEXT?"tab-hidden":""}">
              <context-viewer
                .selectedFiles=${n.selectedFiles||[]}
                .fetchedUrls=${Object.keys(n.fetchedUrls||{})}
                .excludedUrls=${n.excludedUrls}
                @remove-url=${r=>n.handleContextRemoveUrl(r)}
                @url-inclusion-changed=${r=>n.handleContextUrlInclusionChanged(r)}
              ></context-viewer>
            </div>
          `:""}
          ${n._visitedTabs.has(E.CACHE)?m`
            <div class="embedded-panel ${n.activeLeftTab!==E.CACHE?"tab-hidden":""}">
              <cache-viewer
                .selectedFiles=${n.selectedFiles||[]}
                .fetchedUrls=${Object.keys(n.fetchedUrls||{})}
                .excludedUrls=${n.excludedUrls}
                @remove-url=${r=>n.handleContextRemoveUrl(r)}
                @url-inclusion-changed=${r=>n.handleContextUrlInclusionChanged(r)}
                @file-selected=${r=>n.handleFileMentionClick(r)}
              ></cache-viewer>
            </div>
          `:""}
          ${n._visitedTabs.has(E.SETTINGS)?m`
            <div class="embedded-panel ${n.activeLeftTab!==E.SETTINGS?"tab-hidden":""}">
              <settings-panel
                @config-edit-request=${r=>n.handleConfigEditRequest(r)}
              ></settings-panel>
            </div>
          `:""}
        </div>
      `}
      ${ln(n)}
    </div>
  `}const un=n=>class extends n{connectedCallback(){super.connectedCallback(),this._boundHandleGitOperation=this.handleGitOperation.bind(this),this.addEventListener("git-operation",this._boundHandleGitOperation)}disconnectedCallback(){super.disconnectedCallback(),this.removeEventListener("git-operation",this._boundHandleGitOperation)}async handleGitOperation(e){const{operation:t,paths:s}=e.detail;try{switch(t){case"stage":await this.call["Repo.stage_files"](s);break;case"stage-dir":await this.call["Repo.stage_files"](s);break;case"unstage":await this.call["Repo.unstage_files"](s);break;case"discard":await this.call["Repo.discard_changes"](s);break;case"delete":await this.call["Repo.delete_file"](s[0]);break;case"create-file":await this.call["Repo.create_file"](s[0],"");break;case"create-dir":await this.call["Repo.create_directory"](s[0]);break;default:console.warn("Unknown git operation:",t);return}await this.loadFileTree()}catch(i){console.error(`Git operation "${t}" failed:`,i),this.addMessage("assistant",`⚠️ **Git operation failed:** ${t}

${i.message||i}`)}}async loadFileTree(){if(!this.call){console.warn("loadFileTree called but RPC not ready");return}try{const e=await this.call["Repo.get_file_tree"](),t=this.extractResponse(e);if(t&&!t.error){const s=JSON.stringify(t.tree);s!==this._lastTreeJson&&(this._lastTreeJson=s,this.fileTree=t.tree),this.modifiedFiles=t.modified||[],this.stagedFiles=t.staged||[],this.untrackedFiles=t.untracked||[],this.diffStats=t.diffStats||{}}}catch(e){console.error("Error loading file tree:",e),this.addMessage("assistant","⚠️ **Failed to load file tree.** The server may be unavailable.")}}toggleFilePicker(){this.showFilePicker=!this.showFilePicker,this.showFilePicker&&!this.fileTree&&this.loadFileTree()}handleSelectionChange(e){this.selectedFiles=e.detail}handleCopyPathToPrompt(e){const{path:t}=e.detail;if(!t)return;const s=this.inputValue&&!this.inputValue.endsWith(" ")?" ":"";this.inputValue=this.inputValue+s+t+" ",this.updateComplete.then(()=>{const i=this.shadowRoot?.querySelector("textarea");i&&(i.focus(),i.selectionStart=i.selectionEnd=i.value.length)})}async handleFileView(e){const{path:t}=e.detail;try{const s=await this.call["Repo.get_file_content"](t,"working"),i=this.extractResponse(s);let r="";try{const l=await this.call["Repo.get_file_content"](t,"HEAD");r=this.extractResponse(l),typeof r!="string"&&(r="")}catch{r=""}const a=r==="",o=this.modifiedFiles.includes(t);this.dispatchEvent(new CustomEvent("edits-applied",{detail:{files:[{path:t,original:r,modified:typeof i=="string"?i:"",isNew:a&&!o}]},bubbles:!0,composed:!0}))}catch(s){console.error("Error viewing file:",s)}}_handleAtMention(e){const t=e.lastIndexOf("@");if(t!==-1){const s=e.substring(t+1),i=s.indexOf(" "),r=i===-1?s:s.substring(0,i);i===-1&&s.length>=0?(this.showFilePicker=!0,this._setFilePickerFilter(r)):this._clearFilePickerFilter()}else this._clearFilePickerFilter()}_setFilePickerFilter(e){const t=this.shadowRoot?.querySelector("file-picker");t&&(t.filter=e,t.updateComplete.then(()=>{const s=t.getVisibleFiles();t.focusedFile=s.length>0?s[0]:""}))}_clearFilePickerFilter(){const e=this.shadowRoot?.querySelector("file-picker");e&&e.filter&&(e.filter="",e.focusedFile="")}_clearAtMention(){this.inputValue=this.inputValue.replace(/@\S*$/,"").trimEnd();const e=this.shadowRoot?.querySelector("file-picker");e&&(e.filter="",e.focusedFile=""),this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector("textarea");t&&(t.value=this.inputValue,this._autoResizeTextarea(t),t.focus())})}handleFileMentionClick(e){const{path:t}=e.detail;if(!t)return;const s=this.shadowRoot?.querySelector("file-picker");if(s){const i={...s.selected},r=t.split("/").pop(),a=i[t];a?delete i[t]:i[t]=!0,s.selected=i,this.selectedFiles=Object.keys(i).filter(l=>i[l]),s.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}));const o="Do you want to see more files before you continue?";if(a){const l=this.inputValue.match(/^The files? (.+) added\. /);if(l){const d=l[1].split(", ").filter(c=>c!==r);d.length===0?this.inputValue="":d.length===1?this.inputValue=`The file ${d[0]} added. ${o}`:this.inputValue=`The files ${d.join(", ")} added. ${o}`}}else{const l=this.inputValue.match(/^The files? (.+) added\. /);l?this.inputValue=`The files ${l[1]}, ${r} added. ${o}`:this.inputValue.trim()===""?this.inputValue=`The file ${r} added. ${o}`:this.inputValue=this.inputValue.trimEnd()+` (added ${r}) `}this.updateComplete.then(()=>{const l=this.shadowRoot?.querySelector("textarea");l&&(l.focus(),l.selectionStart=l.selectionEnd=l.value.length)})}}getAddableFiles(){if(!this.fileTree)return[];const e=[],t=s=>{s.path&&e.push(s.path),s.children&&s.children.forEach(t)};return t(this.fileTree),e}},pn=n=>class extends n{async handleResetHard(){if(confirm(`⚠️ This will discard ALL uncommitted changes!

Are you sure you want to reset to HEAD?`))try{this.addMessage("assistant","🔄 Resetting repository to HEAD...");const e=await this.call["Repo.reset_hard"](),t=this.extractResponse(e);if(t&&t.error){this.addMessage("assistant",`Error resetting: ${t.error}`);return}this.addMessage("assistant","✅ Repository reset to HEAD. All uncommitted changes have been discarded."),await this.loadFileTree(),this.dispatchEvent(new CustomEvent("edits-applied",{detail:{files:[]},bubbles:!0,composed:!0}))}catch(e){console.error("Error during reset:",e),this.addMessage("assistant",`Error during reset: ${e.message}`)}}async clearContext(){try{const e=await this.call["LiteLLM.clear_history"]();this.extractResponse(e),this.messageHistory=[],this.showHistoryBrowser&&(this.showHistoryBrowser=!1),this.clearAllUrlState&&this.clearAllUrlState(),this._hudData||(this._hudData={}),this._hudData.history_tokens=0,this.requestUpdate(),this.addMessage("assistant","Context cleared. Starting fresh conversation.")}catch(e){console.error("Error clearing context:",e),this.addMessage("assistant",`Error clearing context: ${e.message}`)}}async showTokenReport(){try{const e=this.selectedFiles.length>0?this.selectedFiles:null,t=await this.call["LiteLLM.get_token_report"](e,null),s=this.extractResponse(t);this.addMessage("assistant","```\n"+s+"\n```")}catch(e){console.error("Error getting token report:",e),this.addMessage("assistant",`Error getting token report: ${e.message}`)}}async copyGitDiff(){try{const e=await this.call["Repo.get_unstaged_diff"](),t=await this.call["Repo.get_staged_diff"](),s=this.extractResponse(e)||"",i=this.extractResponse(t)||"";let r="";if(i&&typeof i=="string"&&(r+=i),s&&typeof s=="string"&&(r&&(r+=`
`),r+=s),!r.trim()){this.addMessage("assistant","No changes to copy (working tree is clean).");return}await navigator.clipboard.writeText(r),this.addMessage("assistant",`📋 Copied diff to clipboard (${r.split(`
`).length} lines)`)}catch(e){console.error("Error copying git diff:",e),this.addMessage("assistant",`Error copying diff: ${e.message}`)}}async handleCommit(){try{this.addMessage("assistant","📦 Staging all changes...");const e=await this.call["Repo.stage_all"](),t=this.extractResponse(e);if(t&&t.error){this.addMessage("assistant",`Error staging changes: ${t.error}`);return}const s=await this.call["Repo.get_staged_diff"](),i=this.extractResponse(s);if(!i||typeof i=="object"&&i.error){this.addMessage("assistant",`Error getting diff: ${i?.error||"No staged changes"}`);return}if(!i.trim()){this.addMessage("assistant","No changes to commit.");return}this.addMessage("assistant","🤖 Generating commit message...");const r=await this.call["LiteLLM.get_commit_message"](i),a=this.extractResponse(r);if(a&&a.error){this.addMessage("assistant",`Error generating commit message: ${a.error}`);return}const o=a.message;this.addMessage("assistant",`📝 Generated commit message:
\`\`\`
${o}
\`\`\`

Committing...`);const l=await this.call["Repo.commit"](o),d=this.extractResponse(l);if(d&&d.error){this.addMessage("assistant",`Error committing: ${d.error}`);return}this.addMessage("assistant",`✅ Committed successfully!

Commit: \`${d.short_hash}\`
Message: ${o.split(`
`)[0]}`),await this.loadFileTree()}catch(e){console.error("Error during commit:",e),this.addMessage("assistant",`Error during commit: ${e.message}`)}}async sendMessage(){if(!this.inputValue.trim()&&this.pastedImages.length===0)return;this._userHasScrolledUp=!1,this._showScrollButton=!1;const e=this.inputValue,t=this.getImagesForSend(),s=this.pastedImages.length>0?[...this.pastedImages]:null,i=this.getFetchedUrlsForMessage?this.getFetchedUrlsForMessage():[];let r=this.inputValue;if(i.length>0){const o=i.map(l=>{const d=l.title||l.url,c=l.summary||l.content||"";return`## ${d}
Source: ${l.url}

${c}`}).join(`

---

`);r=`${this.inputValue}

---
**Referenced URL Content:**

${o}`}this.addMessage("user",e,s),this.inputValue="",this.pastedImages=[],this.clearUrlState&&this.clearUrlState();const a=this.shadowRoot?.querySelector("textarea");a&&(a.style.height="auto",a.style.overflowY="hidden");try{const o=this._generateRequestId();this._streamingRequests.set(o,{message:r}),this.isStreaming=!0,this._startStreamingWatchdog();const l=await this.call["LiteLLM.chat_streaming"](o,r,this.selectedFiles.length>0?this.selectedFiles:null,t),d=this.extractResponse(l);if(d.error){this._streamingRequests.delete(o),this.isStreaming=!1;const c=this.messageHistory[this.messageHistory.length-1];c&&c.role==="assistant"&&(c.content=`Error: ${d.error}`,c.final=!0,this.messageHistory=[...this.messageHistory])}}catch(o){console.error("Error sending message:",o),this.addMessage("assistant",`Error: ${o.message}`)}}async _buildDiffFiles(e){const t=e.content||{},s=e.passed.map(async i=>{const[r,a,o]=i;let l="";try{if(a==="")l="";else{const c=t[r]||"";l=await this._getOriginalFileContent(r,c,a,o)}}catch(c){console.error("Error getting original content:",c),l=a}let d=t[r];if(!d)try{const c=await this.call["Repo.get_file_content"](r);d=this.extractResponse(c)}catch{d=o}return{path:r,original:l,modified:d,isNew:a===""}});return Promise.all(s)}async _getOriginalFileContent(e,t,s,i){try{const r=await this.call["Repo.get_file_content"](e,"HEAD"),a=this.extractResponse(r);if(a&&typeof a=="string")return a}catch{}return s===""?"":s&&i&&t?t.replace(i,s):""}},fn=n=>class extends n{initInputHandler(){this._savedScrollRatio=1,this._savedWasAtBottom=!0,this._historySearchQuery="",this._historySearchResults=[],this._historySearchIndex=-1,this._showHistorySearch=!1,this._boundHandlePaste=this._handlePaste.bind(this),document.addEventListener("paste",this._boundHandlePaste),this._boundHandleDragOver=this._handleDragOver.bind(this),this._boundHandleDrop=this._handleDrop.bind(this)}destroyInputHandler(){document.removeEventListener("paste",this._boundHandlePaste)}_handlePaste(e){const t=e.clipboardData?.items;if(t){for(const s of t)if(s.type.startsWith("image/")){e.preventDefault();const i=s.getAsFile();i&&this.processImageFile(i);break}}}_handleDragOver(e){e.dataTransfer?.types?.includes("Files")&&(e.preventDefault(),e.dataTransfer.dropEffect="copy")}_handleDrop(e){const t=e.dataTransfer?.files;if(!t||t.length===0)return;let s=!1;for(const i of t)i.type.startsWith("image/")&&(s=!0,this.processImageFile(i));s&&e.preventDefault()}processImageFile(e){const t=new FileReader;t.onload=s=>{const i=s.target.result.split(",")[1],r=e.type;this.pastedImages=[...this.pastedImages,{data:i,mime_type:r,preview:s.target.result,name:e.name||`image-${Date.now()}.${r.split("/")[1]}`}]},t.readAsDataURL(e)}removeImage(e){this.pastedImages=this.pastedImages.filter((t,s)=>s!==e)}clearImages(){this.pastedImages=[]}getImagesForSend(){return this.pastedImages.length===0?null:this.pastedImages.map(e=>({data:e.data,mime_type:e.mime_type}))}_getUserMessageHistory(){const e=new Set,t=[],s=this.messageHistory.filter(i=>i.role==="user").map(i=>i.content);for(let i=s.length-1;i>=0;i--){const r=s[i];r&&r.trim()&&!e.has(r)&&(e.add(r),t.push(r))}return t}_fuzzyMatch(e,t){const s=e.toLowerCase(),i=t.toLowerCase();let r=0;for(let a=0;a<i.length&&r<s.length;a++)i[a]===s[r]&&r++;return r===s.length}_fuzzyScore(e,t){const s=e.toLowerCase(),i=t.toLowerCase(),r=i.indexOf(s);if(r!==-1)return r;let a=0,o=0;for(let l=0;l<i.length&&o<s.length;l++)i[l]===s[o]&&(a+=l,o++);return a+1e3}_navigateHistory(e){const t=this._getUserMessageHistory();if(t.length===0)return!1;if(this._historyNavIndex===void 0||this._historyNavIndex===null)return e===-1?(this._historyNavSaved=this.inputValue,this._historyNavIndex=0,this.inputValue=t[0],!0):!1;const s=this._historyNavIndex-e;return s<0?(this.inputValue=this._historyNavSaved||"",this._historyNavIndex=null,!0):s>=t.length?!1:(this._historyNavIndex=s,this.inputValue=t[s],!0)}_openHistorySearch(){this._getUserMessageHistory().length!==0&&(this._savedInputBeforeHistory=this.inputValue,this._historySearchQuery="",this._showHistorySearch=!0,this._historySearchIndex=0,this._updateHistorySearchResults(),this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector(".history-overlay-input");t&&(t.focus(),t.selectionStart=t.selectionEnd=t.value.length);const s=this.shadowRoot?.querySelector(".history-search-results");s&&(s.scrollTop=s.scrollHeight)}))}_closeHistorySearch(){this._showHistorySearch=!1,this._historySearchQuery="",this._historySearchResults=[],this._historySearchIndex=-1,this.requestUpdate()}_updateHistorySearchResults(){const e=this._historySearchQuery||"",t=this._getUserMessageHistory();e.trim()?this._historySearchResults=t.filter(s=>this._fuzzyMatch(e,s)).sort((s,i)=>this._fuzzyScore(e,s)-this._fuzzyScore(e,i)).slice(0,20).map(s=>({content:s,preview:s.length>120?s.substring(0,120)+"…":s})):this._historySearchResults=t.slice(0,20).map(s=>({content:s,preview:s.length>120?s.substring(0,120)+"…":s})),this._historySearchIndex>=this._historySearchResults.length&&(this._historySearchIndex=Math.max(0,this._historySearchResults.length-1)),this.requestUpdate()}_handleHistoryOverlayInput(e){this._historySearchQuery=e.target.value,this._updateHistorySearchResults()}_handleHistoryOverlayKeydown(e){e.key==="ArrowDown"?(e.preventDefault(),this._historySearchIndex>0&&(this._historySearchIndex--,this.requestUpdate(),this._scrollHistorySelectionIntoView())):e.key==="ArrowUp"?(e.preventDefault(),this._historySearchIndex<this._historySearchResults.length-1&&(this._historySearchIndex++,this.requestUpdate(),this._scrollHistorySelectionIntoView())):e.key==="Enter"?(e.preventDefault(),this._selectHistorySearchResult(this._historySearchIndex)):e.key==="Escape"&&(e.preventDefault(),this._closeHistorySearch(),this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector("textarea");t&&t.focus()}))}_scrollHistorySelectionIntoView(){this.updateComplete.then(()=>{const e=this.shadowRoot?.querySelector(".history-search-item.selected");e&&e.scrollIntoView({block:"nearest"})})}_selectHistorySearchResult(e){const t=this._historySearchResults[e];t&&(this.inputValue=t.content),this._closeHistorySearch(),this.updateComplete.then(()=>{const s=this.shadowRoot?.querySelector("textarea");s&&(s.focus(),this._autoResizeTextarea(s))})}_autoResizeTextarea(e){if(!e)return;const t=100;e.style.setProperty("--textarea-max-height",`${t}px`),e.style.height="auto";const s=Math.min(e.scrollHeight,t);e.style.height=`${s}px`,e.scrollHeight>t?e.style.overflowY="auto":e.style.overflowY="hidden"}handleCopyToPrompt(e){const{content:t}=e.detail;this.inputValue=t,this.updateComplete.then(()=>{const s=this.shadowRoot?.querySelector("textarea");s&&s.focus()})}_isFilePickerNavigating(){const e=this.shadowRoot?.querySelector("file-picker");return e&&e.filter&&this.showFilePicker}_getFilePicker(){return this.shadowRoot?.querySelector("file-picker")}handleKeyDown(e){if(this._isFilePickerNavigating()){const s=this._getFilePicker();if(e.key==="ArrowUp"){e.preventDefault(),s.navigateFocus(-1);return}if(e.key==="ArrowDown"){e.preventDefault(),s.navigateFocus(1);return}if(e.key===" "&&s.focusedFile){e.preventDefault(),s.toggleFocusedFile();return}if(e.key==="Escape"){e.preventDefault(),this._clearAtMention();return}if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(),s.focusedFile&&this.handleFileView({detail:{path:s.focusedFile}});return}}if(this._showHistorySearch&&e.key==="Escape"){e.preventDefault(),this._closeHistorySearch();return}if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(),this.sendMessage(),this._closeHistorySearch();return}if(e.key==="Escape"){const s=this.shadowRoot?.querySelector("file-picker");if(s&&s.filter){s.filter="";return}return}const t=e.target;if(e.key==="ArrowUp"&&t.selectionStart===0&&t.selectionEnd===0&&(e.preventDefault(),this._openHistorySearch()),e.key==="ArrowDown"&&this._savedInputBeforeHistory!==void 0){const s=t.value.length,i=t.value.lastIndexOf(`
`),r=t.selectionStart>i&&t.selectionEnd>i;t.selectionStart===s&&t.selectionEnd===s?(e.preventDefault(),this.inputValue=this._savedInputBeforeHistory,this._savedInputBeforeHistory=void 0,this.updateComplete.then(()=>{const a=this.shadowRoot?.querySelector("textarea");a&&(a.selectionStart=a.selectionEnd=a.value.length,this._autoResizeTextarea(a))})):r&&(e.preventDefault(),t.selectionStart=t.selectionEnd=s)}}handleInput(e){this.inputValue=e.target.value,this._handleAtMention(e.target.value),this._autoResizeTextarea(e.target),this.detectUrlsInInput&&this.detectUrlsInInput(e.target.value)}handleSpeechTranscript(e){const{text:t}=e.detail;if(!t)return;const s=t,i=this.inputValue&&!this.inputValue.endsWith(" ")&&!this.inputValue.endsWith(`
`);this.inputValue=this.inputValue+(i?" ":"")+s,this.updateComplete.then(()=>{const r=this.shadowRoot?.querySelector("textarea");r&&(r.value=this.inputValue,this._autoResizeTextarea(r),r.selectionStart=r.selectionEnd=r.value.length,r.focus())}),this.detectUrlsInInput&&this.detectUrlsInInput(this.inputValue)}toggleMinimize(){const e=this.shadowRoot?.querySelector("#messages-container");if(this.minimized)this.minimized=!1,this.updateComplete.then(()=>{requestAnimationFrame(()=>{requestAnimationFrame(()=>{const t=this.shadowRoot?.querySelector("#messages-container");if(t)if(this._savedWasAtBottom)t.scrollTop=t.scrollHeight;else{const s=t.scrollHeight-t.clientHeight;t.scrollTop=s*this._savedScrollRatio}})})});else{if(e){const t=e.scrollTop,s=e.scrollHeight,i=e.clientHeight,r=s-i,a=s-t-i;this._savedWasAtBottom=a<50,this._savedScrollRatio=r>0?t/r:1}this.minimized=!0}}},gn=n=>class extends n{initWindowControls(){this._isDragging=!1,this._didDrag=!1,this._dragStartX=0,this._dragStartY=0,this._dialogStartX=0,this._dialogStartY=0,this._isResizing=!1,this._resizeDirection=null,this._resizeStartX=0,this._resizeStartY=0,this._resizeStartWidth=0,this._resizeStartHeight=0,this._dialogWidth=null,this._dialogHeight=null,this._boundHandleMouseMove=this._handleMouseMove.bind(this),this._boundHandleMouseUp=this._handleMouseUp.bind(this),this._boundHandleResizeMove=this._handleResizeMove.bind(this),this._boundHandleResizeEnd=this._handleResizeEnd.bind(this)}_handleDragStart(e){e.button===0&&e.target.tagName!=="BUTTON"&&(this._isDragging=!0,this._didDrag=!1,this._dragStartX=e.clientX,this._dragStartY=e.clientY,this._dialogStartX=this.dialogX,this._dialogStartY=this.dialogY,document.addEventListener("mousemove",this._boundHandleMouseMove),document.addEventListener("mouseup",this._boundHandleMouseUp),e.preventDefault())}_handleMouseMove(e){if(!this._isDragging)return;const t=e.clientX-this._dragStartX,s=e.clientY-this._dragStartY;(Math.abs(t)>5||Math.abs(s)>5)&&(this._didDrag=!0),this._didDrag&&(this.dialogX=this._dialogStartX+t,this.dialogY=this._dialogStartY+s)}_handleMouseUp(){const e=this._isDragging,t=this._didDrag;this._isDragging=!1,document.removeEventListener("mousemove",this._boundHandleMouseMove),document.removeEventListener("mouseup",this._boundHandleMouseUp),e&&!t&&this.toggleMinimize()}_handleResizeStart(e,t){if(e.button!==0)return;e.preventDefault(),e.stopPropagation(),this._isResizing=!0,this._resizeDirection=t,this._resizeStartX=e.clientX,this._resizeStartY=e.clientY;const s=this.shadowRoot?.querySelector(".dialog");if(s){const i=s.getBoundingClientRect();this._resizeStartWidth=i.width,this._resizeStartHeight=i.height}document.addEventListener("mousemove",this._boundHandleResizeMove),document.addEventListener("mouseup",this._boundHandleResizeEnd)}_handleResizeMove(e){if(!this._isResizing)return;const t=e.clientX-this._resizeStartX,s=e.clientY-this._resizeStartY,i=this._resizeDirection;let r=this._resizeStartWidth,a=this._resizeStartHeight;i.includes("e")?r=Math.max(300,this._resizeStartWidth+t):i.includes("w")&&(r=Math.max(300,this._resizeStartWidth-t),this.dialogX!==null&&(this.dialogX=this.dialogX+(this._resizeStartWidth-r))),i.includes("s")?a=Math.max(200,this._resizeStartHeight+s):i.includes("n")&&(a=Math.max(200,this._resizeStartHeight-s),this.dialogY!==null&&(this.dialogY=this.dialogY+(this._resizeStartHeight-a))),this._dialogWidth=r,this._dialogHeight=a,this.requestUpdate()}_handleResizeEnd(){this._isResizing=!1,this._resizeDirection=null,document.removeEventListener("mousemove",this._boundHandleResizeMove),document.removeEventListener("mouseup",this._boundHandleResizeEnd)}getResizeStyle(){const e=[];return this._dialogWidth&&e.push(`width: ${this._dialogWidth}px`),this._dialogHeight&&e.push(`height: ${this._dialogHeight}px`),e.join("; ")}destroyWindowControls(){document.removeEventListener("mousemove",this._boundHandleMouseMove),document.removeEventListener("mouseup",this._boundHandleMouseUp),document.removeEventListener("mousemove",this._boundHandleResizeMove),document.removeEventListener("mouseup",this._boundHandleResizeEnd)}},mn=n=>class extends n{static get properties(){return{...super.properties,isStreaming:{type:Boolean},isCompacting:{type:Boolean},_hudVisible:{type:Boolean},_hudData:{type:Object}}}initStreaming(){this._streamingRequests=new Map,this.isStreaming=!1,this.isCompacting=!1,this._hudVisible=!1,this._hudData=null,this._hudTimeout=null,this._streamingTimeout=null}streamChunk(e,t){this._streamingRequests.has(e)&&this.streamWrite(t,!1,"assistant")}async stopStreaming(){if(this._streamingRequests.size===0)return;this._clearStreamingWatchdog();const[e]=this._streamingRequests.keys();try{await this.call["LiteLLM.cancel_streaming"](e)}catch(t){console.error("Error cancelling stream:",t)}}compactionEvent(e,t){if(t.type==="compaction_start")this.addMessage("assistant",t.message),this.isCompacting=!0;else if(t.type==="compaction_complete"){const s=t.tokens_saved.toLocaleString(),i=t.tokens_before.toLocaleString(),r=t.tokens_after.toLocaleString();if(this._hudData&&(this._hudData={...this._hudData,history_tokens:t.tokens_after}),t.case==="none"){const l=this.messageHistory[this.messageHistory.length-1];l&&l.role==="assistant"&&l.content.includes("Compacting")&&(this.messageHistory=this.messageHistory.slice(0,-1));return}const a=[];let o;if(t.case==="summarize")o=`📋 **History Compacted**

${t.truncated_count} older messages were summarized to preserve context.

---
_${i} → ${r} tokens (saved ${s})_`;else if(t.case==="truncate_only"){const l=t.topic_detected?`

**Topic change detected:** ${t.topic_detected}`:"";o=`✂️ **History Truncated**

${t.truncated_count} older messages from previous topic removed.${l}

---
_${i} → ${r} tokens (saved ${s})_`}else o=`🗜️ **History Compacted** (${t.case})

${t.truncated_count} messages processed.

---
_${i} → ${r} tokens (saved ${s})_`;if(a.push({role:"assistant",content:o,final:!0,isCompactionNotice:!0}),t.compacted_messages&&t.compacted_messages.length>0)for(const l of t.compacted_messages)a.push({role:l.role,content:l.content,final:!0});this.messageHistory=a,this.isCompacting=!1,console.log(`📋 History compacted: ${t.case}, now showing ${a.length} messages`),this._refreshCacheViewer()}else if(t.type==="compaction_error"){const s=this.messageHistory[this.messageHistory.length-1];if(s&&s.role==="assistant"&&s.content.includes("Compacting")){const i=`⚠️ **Compaction Failed**

${t.error}

_Continuing without compaction..._`,r={...s,content:i,final:!0};this.messageHistory=[...this.messageHistory.slice(0,-1),r]}this.isCompacting=!1}}async streamComplete(e,t){if(!this._streamingRequests.has(e))return;if(this._clearStreamingWatchdog(),this._streamingRequests.delete(e),this.isStreaming=!1,this._pendingChunk){const i=this._pendingChunk;this._pendingChunk=null,this._chunkRafPending=!1,this._processStreamChunk(i.chunk,i.final,i.role,i.editResults)}const s=this.messageHistory[this.messageHistory.length-1];if(t.error){const i=[...t.binary_files||[],...t.invalid_files||[]];if(i.length>0&&this.selectedFiles){const a=new Set(i);this.selectedFiles=this.selectedFiles.filter(l=>!a.has(l));const o=this.shadowRoot?.querySelector("file-picker");if(o&&o.selected){const l={...o.selected};for(const d of i)delete l[d];o.selected=l}}let r=`⚠️ **Error:** ${t.error}`;if(i.length>0&&(r+=`

*The file(s) have been deselected. You can send your message again.*`),s&&s.role==="assistant"){const a={...s,content:r,final:!0,editResults:[]};this.messageHistory=[...this.messageHistory.slice(0,-1),a]}else{this.addMessage("assistant",r);const a=this.messageHistory[this.messageHistory.length-1];a&&a.role==="assistant"&&(this.messageHistory=[...this.messageHistory.slice(0,-1),{...a,final:!0,editResults:[]}])}return}if(s&&s.role==="assistant"){const i=this._buildEditResults(t);let r=s.content;t.cancelled&&(r=r+`

*[stopped]*`);const a={...s,content:r,final:!0,editResults:i};this.messageHistory=[...this.messageHistory.slice(0,-1),a]}if(t.passed&&t.passed.length>0){await this.loadFileTree();const i=t.passed.map(r=>Array.isArray(r)?r[0]:r.file_path||r.path).filter(Boolean);i.length>0&&this.dispatchEvent(new CustomEvent("files-edited",{detail:{paths:i},bubbles:!0,composed:!0}))}t.token_usage&&this._showHud(t.token_usage),typeof this.loadPromptSnippets=="function"&&this.loadPromptSnippets(),this._refreshCacheViewer(),setTimeout(()=>{const i=this.shadowRoot?.querySelector("textarea");i&&i.focus()},100)}_showHud(e){this._hudTimeout&&clearTimeout(this._hudTimeout),this._hudData=e,this._hudVisible=!0,this._hudHovered=!1,this._startHudTimeout()}_startHudTimeout(){this._hudTimeout&&clearTimeout(this._hudTimeout),this._hudTimeout=setTimeout(()=>{this._hudHovered||(this._hudVisible=!1)},8e3)}_onHudMouseEnter(){this._hudHovered=!0,this._hudTimeout&&(clearTimeout(this._hudTimeout),this._hudTimeout=null)}_onHudMouseLeave(){this._hudHovered=!1,this._hudTimeout=setTimeout(()=>{this._hudVisible=!1},2e3)}_buildEditResults(e){if(e.edit_results&&e.edit_results.length>0)return e.edit_results.map(s=>({file_path:s.file_path,status:s.status==="applied"?"applied":"failed",reason:s.reason||null,estimated_line:s.estimated_line||null}));const t=[];if(e.passed)for(const s of e.passed){const i=Array.isArray(s)?s[0]:s.file_path||s.path;t.push({file_path:i,status:"applied",reason:null,estimated_line:null})}if(e.failed)for(const s of e.failed){const i=Array.isArray(s)?s[0]:s.file_path||s.path,r=Array.isArray(s)?s[1]:s.reason||s.error;t.push({file_path:i,status:"failed",reason:r,estimated_line:null})}return t}_startStreamingWatchdog(){this._clearStreamingWatchdog(),this._streamingTimeout=setTimeout(()=>{this.isStreaming&&(console.warn("Streaming timeout - forcing recovery"),this.isStreaming=!1,this._streamingRequests.clear(),this.addMessage("assistant","⚠️ Response timed out. Please try again."))},5*60*1e3)}_clearStreamingWatchdog(){this._streamingTimeout&&(clearTimeout(this._streamingTimeout),this._streamingTimeout=null)}_refreshCacheViewer(){const e=this.shadowRoot?.querySelector("cache-viewer");e&&(e._breakdownStale=!0,e.visible&&e.refreshBreakdown());const t=this.shadowRoot?.querySelector("context-viewer");t&&(t._breakdownStale=!0,t.visible&&t.refreshBreakdown())}_generateRequestId(){return`${Date.now()}-${Math.random().toString(36).substr(2,9)}`}};class bn{constructor(e,t){this._rpcCall=e,this._onStateChange=t,this._detectedUrls=[],this._fetchingUrls={},this._fetchedUrls={},this._excludedUrls=new Set,this._urlDetectDebounce=null}destroy(){this._urlDetectDebounce&&(clearTimeout(this._urlDetectDebounce),this._urlDetectDebounce=null)}get detectedUrls(){return this._detectedUrls}get fetchingUrls(){return this._fetchingUrls}get fetchedUrls(){return this._fetchedUrls}get excludedUrls(){return this._excludedUrls}detectUrlsInInput(e){this._urlDetectDebounce&&clearTimeout(this._urlDetectDebounce),this._urlDetectDebounce=setTimeout(async()=>{await this._performUrlDetection(e)},300)}async _performUrlDetection(e){if(!this._rpcCall||!e){this._detectedUrls=[],this._notifyStateChange();return}try{const t=await this._rpcCall("LiteLLM.detect_urls",e);Array.isArray(t)?this._detectedUrls=t.filter(s=>!this._fetchedUrls[s.url]):this._detectedUrls=[]}catch(t){console.error("URL detection failed:",t),this._detectedUrls=[]}this._notifyStateChange()}async fetchUrl(e,t=""){const s=e.url;if(!this._fetchingUrls[s]){this._fetchingUrls={...this._fetchingUrls,[s]:!0},this._notifyStateChange();try{const i=await this._rpcCall("LiteLLM.fetch_url",s,!0,!0,null,t);this._fetchedUrls={...this._fetchedUrls,[s]:i},this._detectedUrls=this._detectedUrls.filter(r=>r.url!==s),i.error&&console.warn(`Failed to fetch ${s}:`,i.error)}catch(i){console.error("URL fetch failed:",i),this._fetchedUrls={...this._fetchedUrls,[s]:{url:s,error:i.message}}}finally{const{[s]:i,...r}=this._fetchingUrls;this._fetchingUrls=r,this._notifyStateChange()}}}toggleUrlIncluded(e){const t=new Set(this._excludedUrls);return t.has(e)?t.delete(e):t.add(e),this._excludedUrls=t,this._notifyStateChange(),!t.has(e)}removeFetchedUrl(e){const{[e]:t,...s}=this._fetchedUrls;if(this._fetchedUrls=s,this._excludedUrls.has(e)){const i=new Set(this._excludedUrls);i.delete(e),this._excludedUrls=i}this._notifyStateChange()}dismissUrl(e){this._detectedUrls=this._detectedUrls.filter(t=>t.url!==e),this._notifyStateChange()}clearState(){this._detectedUrls=[],this._fetchingUrls={},this._notifyStateChange()}clearAllState(){this._detectedUrls=[],this._fetchingUrls={},this._fetchedUrls={},this._excludedUrls=new Set,this._notifyStateChange()}getFetchedUrlsForMessage(){return Object.values(this._fetchedUrls).filter(e=>!e.error&&!this._excludedUrls.has(e.url))}getUrlTypeLabel(e){return{github_repo:"📦 GitHub Repo",github_file:"📄 GitHub File",github_issue:"🐛 Issue",github_pr:"🔀 PR",documentation:"📚 Docs",generic_web:"🌐 Web"}[e]||"🔗 URL"}getUrlDisplayName(e){if(e.github_info){const t=e.github_info;return t.path?`${t.owner}/${t.repo}/${t.path.split("/").pop()}`:`${t.owner}/${t.repo}`}try{const t=new URL(e.url),s=t.pathname;if(s&&s!=="/"){const i=s.split("/").filter(Boolean);return i.length>2?`${t.hostname}/.../${i.slice(-1)[0]}`:`${t.hostname}${s}`}return t.hostname}catch{return e.url.substring(0,40)}}_notifyStateChange(){this._onStateChange&&this._onStateChange({detectedUrls:this._detectedUrls,fetchingUrls:this._fetchingUrls,fetchedUrls:this._fetchedUrls,excludedUrls:this._excludedUrls})}}const yn=N`
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
  .row.focused {
    background: #0f3460;
    outline: 1px solid #e94560;
    outline-offset: -1px;
  }
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
`;function xn(n){return m`
    <div class="container">
      <div class="header">
        <input 
          type="text" 
          placeholder="Filter files..." 
          .value=${n.filter} 
          @input=${e=>n.filter=e.target.value}
        >
      </div>
      <div class="tree">
        ${n.tree?n.renderNode(n.tree):m`<div style="color:#666;padding:20px;text-align:center;">Loading...</div>`}
      </div>
      <div class="actions">
        <button @click=${()=>n.selectAll()}>Select All</button>
        <button @click=${()=>n.clearAll()}>Clear</button>
        <span class="count">${n.selectedFiles.length} selected</span>
      </div>
    </div>
  `}const _n=n=>class extends n{get selectedFiles(){return Object.keys(this.selected).filter(e=>this.selected[e])}toggleSelect(e,t){t.stopPropagation(),this.selected={...this.selected,[e]:!this.selected[e]},this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}_dirFilesCache=new Map;_dirFilesCacheTree=null;collectFilesInDir(e,t=""){const s=this.tree;s!==this._dirFilesCacheTree&&(this._dirFilesCache.clear(),this._dirFilesCacheTree=s);const i=t||"__root__";if(this._dirFilesCache.has(i))return this._dirFilesCache.get(i);const r=[];if(e.path&&r.push(e.path),e.children)for(const a of e.children){const o=t?`${t}/${a.name}`:a.name;r.push(...this.collectFilesInDir(a,o))}return this._dirFilesCache.set(i,r),r}toggleSelectDir(e,t,s){s.stopPropagation();const i=this.collectFilesInDir(e,t),r=i.every(o=>this.selected[o]),a={...this.selected};for(const o of i)a[o]=!r;this.selected=a,this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}isDirFullySelected(e,t){const s=this.collectFilesInDir(e,t);return s.length===0?!1:s.every(i=>this.selected[i])}isDirPartiallySelected(e,t){const s=this.collectFilesInDir(e,t);if(s.length===0)return!1;const i=s.filter(r=>this.selected[r]).length;return i>0&&i<s.length}selectAll(){const e={},t=s=>{s.path&&(e[s.path]=!0),s.children?.forEach(t)};this.tree&&t(this.tree),this.selected=e,this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}clearAll(){this.selected={},this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}},vn=n=>class extends n{matchesFilter(e,t){if(!t)return!0;const s=t.toLowerCase();return e.path?e.path.toLowerCase().includes(s):e.children?e.children.some(i=>this.matchesFilter(i,s)):!1}toggleExpand(e){const t={...this.expanded,[e]:!this.expanded[e]};this._updateExpanded?this._updateExpanded(t):this.expanded=t}viewFile(e,t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("file-view",{detail:{path:e},bubbles:!0,composed:!0}))}copyPathToPrompt(e,t){t.preventDefault(),t.stopPropagation(),this.dispatchEvent(new CustomEvent("copy-path-to-prompt",{detail:{path:e},bubbles:!0,composed:!0}))}getFileStatus(e){const t=this.modified.includes(e),s=this.staged.includes(e),i=this.untracked.includes(e);let r="clean",a="";return s&&t?(r="staged-modified",a="M"):s?(r="staged",a="A"):t?(r="modified",a="M"):i&&(r="untracked",a="U"),{statusClass:r,statusIndicator:a}}renderNode(e,t=""){const s=t?`${t}/${e.name}`:e.name,i=!!e.children;return this.matchesFilter(e,this.filter)?i?this.renderDirNode(e,s):this.renderFileNode(e):""}renderDirNode(e,t){const s=this.expanded[t]??!!this.filter,i=this.isDirFullySelected(e,t),r=this.isDirPartiallySelected(e,t);return m`
      <div class="node">
        <div class="row" 
             @contextmenu=${a=>this.handleContextMenu(a,t,"dir",e)}
             @auxclick=${a=>{a.button===1&&(a.preventDefault(),this.copyPathToPrompt(t,a))}}
             @mousedown=${a=>{a.button===1&&a.preventDefault()}}
             @mouseup=${a=>{a.button===1&&a.preventDefault()}}>
          <input 
            type="checkbox" 
            .checked=${i}
            .indeterminate=${r}
            @click=${a=>this.toggleSelectDir(e,t,a)}
          >
          <span class="icon" @click=${()=>this.toggleExpand(t)}>${s?"▾":"▸"}</span>
          <span class="name" @click=${()=>this.toggleExpand(t)}>${e.name}</span>
        </div>
        <div class="children ${s?"":"hidden"}">
          ${e.children.map(a=>this.renderNode(a,t))}
        </div>
      </div>
    `}getLineCountClass(e){return e>170?"danger":e>130?"warning":""}renderFileNode(e){const t=e.path,{statusClass:s,statusIndicator:i}=this.getFileStatus(t),r=e.lines||0,a=this.getLineCountClass(r),o=this.diffStats?.[t],l=this.viewingFile===t,d=this.focusedFile===t;return m`
      <div class="node">
        <div class="row ${l?"viewing":""} ${d?"focused":""}" @contextmenu=${c=>this.handleContextMenu(c,t,"file")}>
          <span class="line-count ${a}">${r}</span>
          <input 
            type="checkbox" 
            .checked=${!!this.selected[t]} 
            @click=${c=>this.toggleSelect(t,c)}
          >
          ${i?m`<span class="status-indicator ${s}">${i}</span>`:m`<span class="status-indicator"></span>`}
          <span class="name ${s}" 
                @click=${c=>this.viewFile(t,c)}
                @auxclick=${c=>{c.button===1&&(c.preventDefault(),this.copyPathToPrompt(t,c))}}
                @mousedown=${c=>{c.button===1&&c.preventDefault()}}
                @mouseup=${c=>{c.button===1&&c.preventDefault()}}>${e.name}</span>
          ${o?m`
            <span class="diff-stats">
              ${o.additions>0?m`<span class="additions">+${o.additions}</span>`:""}
              ${o.deletions>0?m`<span class="deletions">-${o.deletions}</span>`:""}
            </span>
          `:""}
        </div>
      </div>
    `}},wn=n=>class extends n{static get properties(){return{...super.properties,_contextMenu:{type:Object,state:!0}}}constructor(){super(),this._contextMenu=null,this._boundCloseContextMenu=this._closeContextMenu.bind(this)}connectedCallback(){super.connectedCallback(),document.addEventListener("click",this._boundCloseContextMenu),document.addEventListener("contextmenu",this._boundCloseContextMenu)}disconnectedCallback(){super.disconnectedCallback(),document.removeEventListener("click",this._boundCloseContextMenu),document.removeEventListener("contextmenu",this._boundCloseContextMenu)}_closeContextMenu(){this._contextMenu&&(this._contextMenu=null)}handleContextMenu(e,t,s,i=null){e.preventDefault(),e.stopPropagation(),this._contextMenu={x:e.clientX,y:e.clientY,path:t,type:s,node:i}}_getFileMenuItems(e){const t=this.modified.includes(e),s=this.staged.includes(e),i=this.untracked.includes(e),r=[];return(t||i)&&r.push({label:"Stage file",action:()=>this._stageFile(e)}),s&&r.push({label:"Unstage file",action:()=>this._unstageFile(e)}),t&&r.push({label:"Discard changes",action:()=>this._discardChanges(e),danger:!0}),r.push({label:"Delete file",action:()=>this._deleteFile(e),danger:!0}),r}_getDirMenuItems(e,t){const s=[],i=this.collectFilesInDir(t,e),r=i.some(o=>this.modified.includes(o)||this.untracked.includes(o)),a=i.some(o=>this.staged.includes(o));return r&&s.push({label:"Stage all in directory",action:()=>this._stageDirectory(e)}),a&&s.push({label:"Unstage all in directory",action:()=>this._unstageDirectory(i)}),s.push({label:"New file...",action:()=>this._createNewFile(e)}),s.push({label:"New directory...",action:()=>this._createNewDirectory(e)}),s}async _stageFile(e){this._closeContextMenu(),this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"stage",paths:[e]},bubbles:!0,composed:!0}))}async _unstageFile(e){this._closeContextMenu(),this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"unstage",paths:[e]},bubbles:!0,composed:!0}))}async _discardChanges(e){this._closeContextMenu(),confirm(`Discard all changes to "${e}"?

This cannot be undone.`)&&this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"discard",paths:[e]},bubbles:!0,composed:!0}))}async _deleteFile(e){this._closeContextMenu(),confirm(`Delete "${e}"?

This cannot be undone.`)&&this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"delete",paths:[e]},bubbles:!0,composed:!0}))}async _stageDirectory(e){this._closeContextMenu(),this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"stage-dir",paths:[e]},bubbles:!0,composed:!0}))}async _unstageDirectory(e){this._closeContextMenu();const t=e.filter(s=>this.staged.includes(s));this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"unstage",paths:t},bubbles:!0,composed:!0}))}async _createNewFile(e){this._closeContextMenu();const t=prompt("Enter new file name:");if(!t)return;const s=this.tree?.name||"";let i=e;s&&e.startsWith(s+"/")?i=e.substring(s.length+1):e===s&&(i="");const r=i?`${i}/${t}`:t;this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"create-file",paths:[r]},bubbles:!0,composed:!0}))}async _createNewDirectory(e){this._closeContextMenu();const t=prompt("Enter new directory name:");if(!t)return;const s=this.tree?.name||"";let i=e;s&&e.startsWith(s+"/")?i=e.substring(s.length+1):e===s&&(i="");const r=i?`${i}/${t}`:t;this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:"create-dir",paths:[r]},bubbles:!0,composed:!0}))}renderContextMenu(){if(!this._contextMenu)return"";const{x:e,y:t,path:s,type:i,node:r}=this._contextMenu,a=i==="file"?this._getFileMenuItems(s):this._getDirMenuItems(s,r);return a.length===0?"":m`
      <div class="context-menu" style="left: ${e}px; top: ${t}px;">
        ${a.map(o=>m`
          <div 
            class="context-menu-item ${o.danger?"danger":""}"
            @click=${o.action}
          >
            ${o.label}
          </div>
        `)}
      </div>
    `}},kn=wn(vn(_n(H)));class $n extends kn{static properties={tree:{type:Object},modified:{type:Array},staged:{type:Array},untracked:{type:Array},diffStats:{type:Object},selected:{type:Object},expanded:{type:Object},filter:{type:String},viewingFile:{type:String},focusedFile:{type:String}};static styles=yn;constructor(){super(),this.tree=null,this.modified=[],this.staged=[],this.untracked=[],this.diffStats={},this.selected={},this.expanded={},this.filter="",this.viewingFile=null,this.focusedFile="",this._expandedInitialized=!1}willUpdate(e){const t=Object.keys(this.expanded||{}).length>0;!this._expandedInitialized&&this.tree&&!t&&(this.modified.length>0||this.staged.length>0||this.untracked.length>0)&&(this._expandedInitialized=!0,this._expandChangedFileDirs(),this._autoSelectChangedFiles())}_autoSelectChangedFiles(){const e=[...this.modified,...this.staged,...this.untracked];if(e.length===0)return;const t={...this.selected};for(const s of e)t[s]=!0;this.selected=t,this.dispatchEvent(new CustomEvent("selection-change",{detail:this.selectedFiles}))}getScrollTop(){return this.shadowRoot?.querySelector(".tree")?.scrollTop??0}setScrollTop(e){const t=this.shadowRoot?.querySelector(".tree");t&&e>=0&&(t.scrollTop=e)}_expandChangedFileDirs(){const e=[...this.modified,...this.staged,...this.untracked],t=new Set,s=this.tree?.name||"";s&&t.add(s);for(const r of e){const a=r.split("/");let o=s;for(let l=0;l<a.length-1;l++)o=o?`${o}/${a[l]}`:a[l],t.add(o)}const i={...this.expanded};for(const r of t)i[r]=!0;this._updateExpanded(i)}_updateExpanded(e){this.expanded=e,queueMicrotask(()=>{this.dispatchEvent(new CustomEvent("expanded-change",{detail:e}))})}_collectVisibleFiles(e,t=""){if(!e)return[];const s=[],i=t?`${t}/${e.name}`:e.name;if(e.children){const r=this.expanded[i]??!!this.filter;if(this.filter||r)for(const a of e.children)s.push(...this._collectVisibleFiles(a,i))}else e.path&&(!this.filter||this.matchesFilter(e,this.filter))&&s.push(e.path);return s}getVisibleFiles(){return this.tree?this._collectVisibleFiles(this.tree):[]}navigateFocus(e){const t=this.getVisibleFiles();if(t.length===0)return;const s=t.indexOf(this.focusedFile);let i;s===-1?i=e===1?0:t.length-1:(i=s+e,i<0&&(i=0),i>=t.length&&(i=t.length-1)),this.focusedFile=t[i],this._scrollFocusedIntoView()}toggleFocusedFile(){if(!this.focusedFile)return;const e={stopPropagation:()=>{}};this.toggleSelect(this.focusedFile,e)}_scrollFocusedIntoView(){this.updateComplete.then(()=>{const e=this.shadowRoot?.querySelector(".row.focused");e&&e.scrollIntoView({block:"nearest",behavior:"smooth"})})}shouldUpdate(e){return e.size===1&&e.has("selected"),!0}render(){return m`
      ${xn(this)}
      ${this.renderContextMenu()}
    `}}customElements.define("file-picker",$n);const Sn=mn(gn(fn(pn(un(fi)))));class Cn extends Sn{static properties={inputValue:{type:String},minimized:{type:Boolean},isConnected:{type:Boolean},fileTree:{type:Object},modifiedFiles:{type:Array},stagedFiles:{type:Array},untrackedFiles:{type:Array},diffStats:{type:Object},selectedFiles:{type:Array},showFilePicker:{type:Boolean},pastedImages:{type:Array},dialogX:{type:Number},dialogY:{type:Number},showHistoryBrowser:{type:Boolean},viewingFile:{type:String},promptSnippets:{type:Array},snippetDrawerOpen:{type:Boolean},leftPanelWidth:{type:Number},leftPanelCollapsed:{type:Boolean},detectedUrls:{type:Array},fetchingUrls:{type:Object},fetchedUrls:{type:Object},excludedUrls:{type:Object},activeLeftTab:{type:String},filePickerExpanded:{type:Object}};static styles=gi;constructor(){super(),this.inputValue="",this.minimized=!1,this.isConnected=!1,this.fileTree=null,this.modifiedFiles=[],this.stagedFiles=[],this.untrackedFiles=[],this.diffStats={},this.selectedFiles=[],this.showFilePicker=!0,this.pastedImages=[],this.dialogX=null,this.dialogY=null,this.showHistoryBrowser=!1,this.viewingFile=null,this.detectedUrls=[],this.fetchingUrls={},this.fetchedUrls={},this.excludedUrls=new Set,this.activeLeftTab=E.FILES,this.promptSnippets=[],this.snippetDrawerOpen=!1,this.filePickerExpanded={},this._visitedTabs=new Set([E.FILES]),this._selectedObject={},this._addableFiles=[],this.leftPanelWidth=parseInt(localStorage.getItem("promptview-left-panel-width"))||280,this.leftPanelCollapsed=localStorage.getItem("promptview-left-panel-collapsed")==="true",this._isPanelResizing=!1;const e=new URLSearchParams(window.location.search);this.port=e.get("port"),this._urlService=null}_initUrlService(){this._urlService=new bn(async(e,...t)=>{const s=await this.call[e](...t);return this.extractResponse(s)},e=>{this.detectedUrls=e.detectedUrls,this.fetchingUrls=e.fetchingUrls,this.fetchedUrls=e.fetchedUrls,this.excludedUrls=e.excludedUrls})}detectUrlsInInput(e){this._urlService?.detectUrlsInInput(e)}async fetchUrl(e){await this._urlService?.fetchUrl(e,this.inputValue)}toggleUrlIncluded(e){const t=this._urlService?.toggleUrlIncluded(e);this.dispatchEvent(new CustomEvent("url-inclusion-changed",{detail:{url:e,included:t},bubbles:!0,composed:!0}))}removeFetchedUrl(e){this._urlService?.removeFetchedUrl(e),this.dispatchEvent(new CustomEvent("url-removed",{detail:{url:e},bubbles:!0,composed:!0})),this._urlService?.detectUrlsInInput(this.inputValue)}dismissUrl(e){this._urlService?.dismissUrl(e)}viewUrlContent(e){this.dispatchEvent(new CustomEvent("view-url-content",{detail:{url:e.url,content:e},bubbles:!0,composed:!0}))}clearUrlState(){this._urlService?.clearState()}clearAllUrlState(){this._urlService?.clearAllState()}getFetchedUrlsForMessage(){return this._urlService?.getFetchedUrlsForMessage()||[]}getUrlTypeLabel(e){return this._urlService?.getUrlTypeLabel(e)||"🔗 URL"}getUrlDisplayName(e){return this._urlService?.getUrlDisplayName(e)||e.url}willUpdate(e){if(e.has("selectedFiles")){const t={};for(const r of this.selectedFiles||[])t[r]=!0;this._selectedObject=t;const s=this._stableSelectedFiles,i=this.selectedFiles||[];!s||s.length!==i.length||i.some((r,a)=>r!==s[a])?this._stableSelectedFiles=i:this.selectedFiles=s}if(e.has("fileTree")){const t=this.getAddableFiles(),s=this._addableFiles;(!s||s.length!==t.length||t.some((i,r)=>i!==s[r]))&&(this._addableFiles=t)}}async toggleHistoryBrowser(){this.showHistoryBrowser||await ce(()=>import("./HistoryBrowser-D-wwOhPB.js"),[]),this.showHistoryBrowser=!this.showHistoryBrowser,this.showHistoryBrowser&&this.updateComplete.then(()=>{const e=this.shadowRoot?.querySelector("history-browser");e&&e.show()})}handleHistoryCopyToPrompt(e){const{content:t}=e.detail;this.inputValue=t,this.showHistoryBrowser=!1,this.updateComplete.then(()=>{const s=this.shadowRoot?.querySelector("textarea");s&&s.focus()})}async handleLoadSession(e){const{messages:t,sessionId:s}=e.detail;if(this.clearHistory(),this._userHasScrolledUp=!1,this._showScrollButton=!1,s)try{await this.call["LiteLLM.load_session_into_context"](s)}catch(i){console.warn("Could not load session into context:",i)}for(const i of t)this.addMessage(i.role,i.content,i.images||null);this.showHistoryBrowser=!1,await this.updateComplete,requestAnimationFrame(()=>{requestAnimationFrame(()=>this.scrollToBottomNow())}),await this._refreshHistoryBar(),this._refreshCacheViewer()}connectedCallback(){super.connectedCallback(),this.addClass(this,"PromptView"),this.initInputHandler(),this.initWindowControls(),this.initStreaming(),this._initUrlService(),this.updateComplete.then(()=>this.setupScrollObserver()),this.addEventListener("edit-block-click",this._handleEditBlockClick.bind(this)),this._boundPanelResizeMove=this._handlePanelResizeMove.bind(this),this._boundPanelResizeEnd=this._handlePanelResizeEnd.bind(this)}_handleEditBlockClick(e){const{path:t,line:s,status:i,searchContext:r}=e.detail;this.dispatchEvent(new CustomEvent("navigate-to-edit",{detail:{path:t,line:s,status:i,searchContext:r},bubbles:!0,composed:!0}))}async switchTab(e){if(!this._visitedTabs.has(e))switch(e){case E.SEARCH:await ce(()=>import("./FindInFiles-CpBDwLkD.js"),[]);break;case E.CONTEXT:await ce(()=>import("./ContextViewer-CNE0CWlE.js"),__vite__mapDeps([0,1]));break;case E.CACHE:await ce(()=>import("./CacheViewer-RsrlvWjn.js"),__vite__mapDeps([2,1]));break;case E.SETTINGS:await ce(()=>import("./SettingsPanel-DEME-kUR.js"),[]);break}this._visitedTabs.add(e),this.activeLeftTab=e,e===E.FILES&&this.updateComplete.then(()=>this.setupScrollObserver()),e===E.SEARCH?this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector("find-in-files");t&&t.focusInput()}):e===E.CONTEXT?this.updateComplete.then(()=>{this._refreshViewer("context-viewer")}):e===E.CACHE?this.updateComplete.then(()=>{this._refreshViewer("cache-viewer")}):e===E.SETTINGS&&this.updateComplete.then(()=>{this._refreshSettingsPanel()})}async _refreshViewer(e){const t=this.shadowRoot?.querySelector(e);t&&this.call&&(await t.refreshBreakdown(),t.breakdown&&this._syncHistoryBarFromBreakdown(t.breakdown))}async _refreshSettingsPanel(){const e=this.shadowRoot?.querySelector("settings-panel");e&&await e.loadConfigInfo()}_syncHistoryBarFromBreakdown(e){if(!e)return;this._hudData||(this._hudData={});const t=e.breakdown?.history;t&&(this._hudData.history_tokens=t.tokens||0,this._hudData.history_threshold=t.compaction_threshold||t.max_tokens||5e4),this.requestUpdate()}async _refreshHistoryBar(){if(this.call){if(this._refreshHistoryBarPromise)return this._refreshHistoryBarPromise;this._refreshHistoryBarPromise=(async()=>{try{const e=await this.call["LiteLLM.get_context_breakdown"](this.selectedFiles||[],Object.keys(this.fetchedUrls||{})),t=this.extractResponse(e);this._syncHistoryBarFromBreakdown(t)}catch(e){console.warn("Could not refresh history bar:",e)}})();try{await this._refreshHistoryBarPromise}finally{this._refreshHistoryBarPromise=null}}}handleSearchResultSelected(e){this.dispatchEvent(new CustomEvent("search-result-selected",{detail:e.detail,bubbles:!0,composed:!0}))}handleSearchFileSelected(e){this.dispatchEvent(new CustomEvent("search-file-selected",{detail:e.detail,bubbles:!0,composed:!0}))}handleContextRemoveUrl(e){const{url:t}=e.detail;if(this.fetchedUrls&&this.fetchedUrls[t]){const{[t]:s,...i}=this.fetchedUrls;this.fetchedUrls=i}this.dispatchEvent(new CustomEvent("context-remove-url",{detail:e.detail,bubbles:!0,composed:!0}))}handleContextUrlInclusionChanged(e){const{url:t,included:s}=e.detail,i=new Set(this.excludedUrls);s?i.delete(t):i.add(t),this.excludedUrls=i}handleExpandedChange(e){this.filePickerExpanded=e.detail}handleConfigEditRequest(e){this.dispatchEvent(new CustomEvent("config-edit-request",{bubbles:!0,composed:!0,detail:e.detail}))}disconnectedCallback(){super.disconnectedCallback(),this.destroyInputHandler(),this.destroyWindowControls(),this.disconnectScrollObserver(),this.removeEventListener("edit-block-click",this._handleEditBlockClick),this._urlService?.destroy(),window.removeEventListener("mousemove",this._boundPanelResizeMove),window.removeEventListener("mouseup",this._boundPanelResizeEnd)}remoteIsUp(){}async setupDone(){if(this.isConnected=!0,this.call||await new Promise(e=>setTimeout(e,100)),!this.call){console.warn("setupDone called but this.call is not available yet");return}As(this.call),await this.loadFileTree(),await this.loadLastSession(),await this.loadPromptSnippets(),await this._refreshHistoryBar()}async loadPromptSnippets(){try{const e=await this.call["LiteLLM.get_prompt_snippets"](),t=this.extractResponse(e);Array.isArray(t)&&(this.promptSnippets=t)}catch(e){console.warn("Could not load prompt snippets:",e)}}toggleSnippetDrawer(){this.snippetDrawerOpen=!this.snippetDrawerOpen}appendSnippet(e){this.snippetDrawerOpen=!1,this.inputValue&&!this.inputValue.endsWith(`
`)?this.inputValue+=`
`+e:this.inputValue+=e,this.updateComplete.then(()=>{const t=this.shadowRoot?.querySelector("textarea");t&&(t.focus(),t.value=this.inputValue,t.selectionStart=t.selectionEnd=t.value.length,this._autoResizeTextarea(t))})}toggleLeftPanel(){this.leftPanelCollapsed=!this.leftPanelCollapsed,localStorage.setItem("promptview-left-panel-collapsed",this.leftPanelCollapsed)}_handlePanelResizeStart(e){e.preventDefault(),this._isPanelResizing=!0,this._panelResizeStartX=e.clientX,this._panelResizeStartWidth=this.leftPanelWidth,window.addEventListener("mousemove",this._boundPanelResizeMove),window.addEventListener("mouseup",this._boundPanelResizeEnd)}_handlePanelResizeMove(e){if(!this._isPanelResizing)return;const t=e.clientX-this._panelResizeStartX,s=Math.max(150,Math.min(500,this._panelResizeStartWidth+t));this.leftPanelWidth=s}_handlePanelResizeEnd(){this._isPanelResizing&&(this._isPanelResizing=!1,localStorage.setItem("promptview-left-panel-width",this.leftPanelWidth),window.removeEventListener("mousemove",this._boundPanelResizeMove),window.removeEventListener("mouseup",this._boundPanelResizeEnd))}async loadLastSession(){try{const e=await this.call["LiteLLM.history_list_sessions"](1),t=this.extractResponse(e);if(t&&t.length>0){const s=t[0].session_id,i=await this.call["LiteLLM.load_session_into_context"](s),r=this.extractResponse(i);if(r&&r.length>0){for(const a of r)this.addMessage(a.role,a.content,a.images||null,a.edit_results||null);await this.updateComplete,requestAnimationFrame(()=>{requestAnimationFrame(()=>this.scrollToBottomNow())})}}await this._refreshHistoryBar(),this._refreshCacheViewer()}catch(e){console.warn("Could not load last session:",e),console.error(e)}}remoteDisconnected(e){this.isConnected=!1}extractResponse(e){return Qt(e)}streamChunk(e,t){try{return super.streamChunk(e,t),!0}catch(s){return console.error("streamChunk error:",s),!1}}streamComplete(e,t){return Promise.resolve().then(async()=>{try{await super.streamComplete(e,t)}catch(s){console.error("streamComplete async error:",s)}}),!0}compactionEvent(e,t){try{return super.compactionEvent(e,t),!0}catch(s){return console.error("compactionEvent error:",s),!1}}render(){return hn(this)}}customElements.define("prompt-view",Cn);const En=N`
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
`;class Ht extends H{static properties={open:{type:Boolean}};constructor(){super(),this.open=!1}_close(){this.dispatchEvent(new CustomEvent("close",{bubbles:!0,composed:!0}))}_handleOverlayClick(e){e.target===e.currentTarget&&this._close()}_copyToClipboard(e){e&&navigator.clipboard.writeText(e)}}class Fn extends Ht{static properties={...Ht.properties,url:{type:String},content:{type:Object},showFullContent:{type:Boolean}};static styles=[En,N`
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
    `];constructor(){super(),this.url="",this.content=null,this.showFullContent=!1}updated(e){e.has("open")&&this.open&&(this.showFullContent=!1)}_toggleFullContent(){this.showFullContent=!this.showFullContent}render(){return this.open?m`
      <div class="overlay" @click=${this._handleOverlayClick}>
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">URL Content</span>
            <button class="close-btn" @click=${this._close}>✕</button>
          </div>
          
          ${this._renderContent()}
        </div>
      </div>
    `:m``}_renderContent(){if(!this.content)return m`<div class="loading">Loading...</div>`;if(this.content.error)return m`<div class="error">Error: ${this.content.error}</div>`;const{title:e,type:t,fetched_at:s,content_tokens:i,readme_tokens:r,description:a,content:o,readme:l,symbol_map:d}=this.content;return m`
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
          <span class="meta-value">${D(r||i)}</span>
        </div>
      </div>
      
      <div class="modal-body">
        ${a?m`
          <div class="content-section">
            <div class="content-label">Description</div>
            <div class="content-box">${a}</div>
          </div>
        `:""}
        
        ${l?m`
          <div class="content-section">
            <div class="content-label">README</div>
            <div class="content-box ${this.showFullContent?"full":""}">${l}</div>
          </div>
        `:""}
        
        ${d?m`
          <div class="content-section">
            <div class="content-label">Symbol Map</div>
            <div class="content-box ${this.showFullContent?"full":""}">${d}</div>
          </div>
        `:""}
        
        ${o&&this.showFullContent?m`
          <div class="content-section">
            <div class="content-label">Full Content</div>
            <div class="content-box full">${o}</div>
          </div>
        `:""}
      </div>
      
      <div class="modal-footer">
        ${o||d?m`
          <button class="footer-btn" @click=${this._toggleFullContent}>
            ${this.showFullContent?"Hide Details":"Show Full Content"}
          </button>
        `:""}
      </div>
    `}}customElements.define("url-content-modal",Fn);class An extends Ps(H){static properties={diffFiles:{type:Array},showDiff:{type:Boolean},serverURI:{type:String},viewingFile:{type:String},showUrlModal:{type:Boolean},urlModalContent:{type:Object}};static styles=N`
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

  `;constructor(){super(),this.diffFiles=[],this.showDiff=!1,this.viewingFile=null,this.showUrlModal=!1,this.urlModalContent=null;const t=new URLSearchParams(window.location.search).get("port")||"8765";this.serverURI=`ws://localhost:${t}`,this._handleKeydown=this._handleKeydown.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._handleKeydown)}onRpcReady(){this._updateTitle()}async _updateTitle(){try{const e=await this._rpcExtract("Repo.get_repo_name");e&&(document.title=e)}catch(e){console.error("Failed to get repo name:",e)}}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._handleKeydown)}_handleKeydown(e){if(e.ctrlKey&&e.shiftKey&&e.key==="F"){e.preventDefault();const t=this.shadowRoot?.querySelector("prompt-view");t&&t.switchTab(E.SEARCH)}if(e.ctrlKey&&e.key==="b"){e.preventDefault();const t=this.shadowRoot?.querySelector("prompt-view");t&&t.switchTab(E.FILES)}}async _fetchFileContent(e,t=void 0){try{const s=t?[e,t]:[e],i=await this._rpcExtract("Repo.get_file_content",...s);return typeof i=="string"?i:i?.content??null}catch(s){return console.error("Failed to fetch file content:",e,s),null}}async _loadFileIntoDiff(e,t=!0){const s=t!==!1;if(this.diffFiles.find(a=>a.path===e)&&!s)return!0;const r=await this._fetchFileContent(e);if(r!==null){const a={path:e,original:r,modified:r,isNew:!1,isReadOnly:!0};return s?this.diffFiles=[a]:this.diffFiles=[...this.diffFiles,a],!0}return!1}async handleSearchResultSelected(e){const{file:t,line:s}=e.detail;this.viewingFile=t,this.activeLeftTab="files",await this._loadFileIntoDiff(t),await this.updateComplete;const i=this.shadowRoot.querySelector("diff-viewer");i&&setTimeout(()=>{i.selectFile(t),setTimeout(()=>{i._revealPosition(s,1)},150)},100)}async handleSearchFileSelected(e){const{file:t}=e.detail;this.viewingFile=t,await this._loadFileIntoDiff(t)}handleCloseSearch(){this.activeLeftTab="files"}handleFileSelected(e){this.viewingFile=e.detail.path}handleEditsApplied(e){const{files:t}=e.detail;t&&t.length>0&&(this.diffFiles=t,this.showDiff=!0)}async handleFilesEdited(e){const{paths:t}=e.detail;if(!t||t.length===0)return;const s=this.shadowRoot.querySelector("diff-viewer");if(!s)return;const i=s.getOpenFilePaths();if(i.length===0)return;const r=new Set(t),a=i.filter(o=>r.has(o));a.length!==0&&await Promise.all(a.map(async o=>{const[l,d]=await Promise.all([this._fetchFileContent(o,"HEAD").then(c=>c??""),this._fetchFileContent(o).then(c=>c??"")]);s.refreshFileContent(o,l,d)}))}async handleNavigateToEdit(e){const{path:t,line:s,searchContext:i,status:r}=e.detail;this.viewingFile=t;const a=this.diffFiles.find(d=>d.path===t);a&&a.original!==a.modified||(r==="applied"?await this._loadDiffFromHead(t)||await this._loadFileIntoDiff(t):a||await this._loadFileIntoDiff(t)),await this.updateComplete;const l=this.shadowRoot.querySelector("diff-viewer");l&&setTimeout(()=>{l.selectFile(t),setTimeout(()=>{const d=i&&l._findLineByContent(i)||s;d&&l._revealPosition(d,1)},150)},100)}async _loadDiffFromHead(e){const t=await this._fetchFileContent(e,"HEAD"),s=await this._fetchFileContent(e);return t===null||s===null||t===s?!1:(this.diffFiles=[{path:e,original:t,modified:s,isNew:!1,isReadOnly:!1}],!0)}clearDiff(){this.diffFiles=[],this.showDiff=!1;const e=this.shadowRoot.querySelector("diff-viewer");e&&e.clearFiles()}async handleRequestFileLoad(e){const{file:t,line:s,column:i,replace:r}=e.detail;if(await this._loadFileIntoDiff(t,r)&&(s||i)){await this.updateComplete;const o=this.shadowRoot.querySelector("diff-viewer");o&&setTimeout(()=>{o.selectFile(t),s&&setTimeout(()=>{o._revealPosition(s,i||1)},150)},100)}}handleRemoveUrl(e){const t=this.shadowRoot?.querySelector("prompt-view");t&&t.handleContextRemoveUrl(e)}handleUrlRemoved(e){this._refreshContextViewer()}handleViewUrlContent(e){const{content:t}=e.detail;this.urlModalContent=t,this.showUrlModal=!0}closeUrlModal(){this.showUrlModal=!1,this.urlModalContent=null}async handleConfigEditRequest(e){const{configType:t}=e.detail;try{const s=await this._rpcExtract("Settings.get_config_content",t);if(!s?.success){console.error("Failed to load config:",s?.error);return}const i=`[config]/${t}`;this.diffFiles=[{path:i,original:s.content,modified:s.content,isNew:!1,isReadOnly:!1,isConfig:!0,configType:t,realPath:s.path}],this.viewingFile=i}catch(s){console.error("Failed to load config for editing:",s)}}async handleFileSave(e){const{path:t,content:s,isConfig:i,configType:r}=e.detail;try{if(i&&r){const a=await this._rpcExtract("Settings.save_config_content",r,s);a?.success||console.error("Failed to save config:",a?.error)}else await this._rpc("Repo.write_file",t,s)}catch(a){console.error("Failed to save file:",a)}}async handleFilesSave(e){const{files:t}=e.detail;for(const s of t)try{if(s.isConfig&&s.configType){const i=await this._rpcExtract("Settings.save_config_content",s.configType,s.content);i?.success||console.error("Failed to save config:",i?.error)}else await this._rpc("Repo.write_file",s.path,s.content)}catch(i){console.error("Failed to save file:",s.path,i)}}render(){return m`
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
    `}}customElements.define("app-shell",An);export{Ht as M,Ps as R,H as a,m as b,D as c,In as d,Qt as e,zn as f,Xe as g,N as i,En as m,Mn as t};
