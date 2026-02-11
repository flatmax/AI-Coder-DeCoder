const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/editor.main-EKIkdlC-.js","assets/editor-DTpzSb6z.css"])))=>i.map(i=>d[i]);
(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))i(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function t(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function i(s){if(s.ep)return;s.ep=!0;const r=t(s);fetch(s.href,r)}})();/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const bt=globalThis,ii=bt.ShadowRoot&&(bt.ShadyCSS===void 0||bt.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,si=Symbol(),Di=new WeakMap;let cs=class{constructor(e,t,i){if(this._$cssResult$=!0,i!==si)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const t=this.t;if(ii&&e===void 0){const i=t!==void 0&&t.length===1;i&&(e=Di.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),i&&Di.set(t,e))}return e}toString(){return this.cssText}};const Dn=n=>new cs(typeof n=="string"?n:n+"",void 0,si),te=(n,...e)=>{const t=n.length===1?n[0]:e.reduce((i,s,r)=>i+(o=>{if(o._$cssResult$===!0)return o.cssText;if(typeof o=="number")return o;throw Error("Value passed to 'css' function must be a 'css' function result: "+o+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+n[r+1],n[0]);return new cs(t,n,si)},zn=(n,e)=>{if(ii)n.adoptedStyleSheets=e.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const t of e){const i=document.createElement("style"),s=bt.litNonce;s!==void 0&&i.setAttribute("nonce",s),i.textContent=t.cssText,n.appendChild(i)}},zi=ii?n=>n:n=>n instanceof CSSStyleSheet?(e=>{let t="";for(const i of e.cssRules)t+=i.cssText;return Dn(t)})(n):n;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:Pn,defineProperty:Fn,getOwnPropertyDescriptor:Bn,getOwnPropertyNames:Un,getOwnPropertySymbols:Hn,getPrototypeOf:qn}=Object,Tt=globalThis,Pi=Tt.trustedTypes,Gn=Pi?Pi.emptyScript:"",jn=Tt.reactiveElementPolyfillSupport,Qe=(n,e)=>n,Gt={toAttribute(n,e){switch(e){case Boolean:n=n?Gn:null;break;case Object:case Array:n=n==null?n:JSON.stringify(n)}return n},fromAttribute(n,e){let t=n;switch(e){case Boolean:t=n!==null;break;case Number:t=n===null?null:Number(n);break;case Object:case Array:try{t=JSON.parse(n)}catch{t=null}}return t}},ds=(n,e)=>!Pn(n,e),Fi={attribute:!0,type:String,converter:Gt,reflect:!1,useDefault:!1,hasChanged:ds};Symbol.metadata??=Symbol("metadata"),Tt.litPropertyMetadata??=new WeakMap;let Fe=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=Fi){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){const i=Symbol(),s=this.getPropertyDescriptor(e,i,t);s!==void 0&&Fn(this.prototype,e,s)}}static getPropertyDescriptor(e,t,i){const{get:s,set:r}=Bn(this.prototype,e)??{get(){return this[t]},set(o){this[t]=o}};return{get:s,set(o){const a=s?.call(this);r?.call(this,o),this.requestUpdate(e,a,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??Fi}static _$Ei(){if(this.hasOwnProperty(Qe("elementProperties")))return;const e=qn(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(Qe("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Qe("properties"))){const t=this.properties,i=[...Un(t),...Hn(t)];for(const s of i)this.createProperty(s,t[s])}const e=this[Symbol.metadata];if(e!==null){const t=litPropertyMetadata.get(e);if(t!==void 0)for(const[i,s]of t)this.elementProperties.set(i,s)}this._$Eh=new Map;for(const[t,i]of this.elementProperties){const s=this._$Eu(t,i);s!==void 0&&this._$Eh.set(s,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const i=new Set(e.flat(1/0).reverse());for(const s of i)t.unshift(zi(s))}else e!==void 0&&t.push(zi(e));return t}static _$Eu(e,t){const i=t.attribute;return i===!1?void 0:typeof i=="string"?i:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){const e=new Map,t=this.constructor.elementProperties;for(const i of t.keys())this.hasOwnProperty(i)&&(e.set(i,this[i]),delete this[i]);e.size>0&&(this._$Ep=e)}createRenderRoot(){const e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return zn(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,i){this._$AK(e,i)}_$ET(e,t){const i=this.constructor.elementProperties.get(e),s=this.constructor._$Eu(e,i);if(s!==void 0&&i.reflect===!0){const r=(i.converter?.toAttribute!==void 0?i.converter:Gt).toAttribute(t,i.type);this._$Em=e,r==null?this.removeAttribute(s):this.setAttribute(s,r),this._$Em=null}}_$AK(e,t){const i=this.constructor,s=i._$Eh.get(e);if(s!==void 0&&this._$Em!==s){const r=i.getPropertyOptions(s),o=typeof r.converter=="function"?{fromAttribute:r.converter}:r.converter?.fromAttribute!==void 0?r.converter:Gt;this._$Em=s;const a=o.fromAttribute(t,r.type);this[s]=a??this._$Ej?.get(s)??a,this._$Em=null}}requestUpdate(e,t,i,s=!1,r){if(e!==void 0){const o=this.constructor;if(s===!1&&(r=this[e]),i??=o.getPropertyOptions(e),!((i.hasChanged??ds)(r,t)||i.useDefault&&i.reflect&&r===this._$Ej?.get(e)&&!this.hasAttribute(o._$Eu(e,i))))return;this.C(e,t,i)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:i,reflect:s,wrapped:r},o){i&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,o??t??this[e]),r!==!0||o!==void 0)||(this._$AL.has(e)||(this.hasUpdated||i||(t=void 0),this._$AL.set(e,t)),s===!0&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(const[s,r]of this._$Ep)this[s]=r;this._$Ep=void 0}const i=this.constructor.elementProperties;if(i.size>0)for(const[s,r]of i){const{wrapped:o}=r,a=this[s];o!==!0||this._$AL.has(s)||a===void 0||this.C(s,void 0,r,a)}}let e=!1;const t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(i=>i.hostUpdate?.()),this.update(t)):this._$EM()}catch(i){throw e=!1,this._$EM(),i}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(e){}firstUpdated(e){}};Fe.elementStyles=[],Fe.shadowRootOptions={mode:"open"},Fe[Qe("elementProperties")]=new Map,Fe[Qe("finalized")]=new Map,jn?.({ReactiveElement:Fe}),(Tt.reactiveElementVersions??=[]).push("2.1.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const ni=globalThis,Bi=n=>n,xt=ni.trustedTypes,Ui=xt?xt.createPolicy("lit-html",{createHTML:n=>n}):void 0,hs="$lit$",Ee=`lit$${Math.random().toFixed(9).slice(2)}$`,ps="?"+Ee,Kn=`<${ps}>`,Ie=document,et=()=>Ie.createComment(""),tt=n=>n===null||typeof n!="object"&&typeof n!="function",ri=Array.isArray,Wn=n=>ri(n)||typeof n?.[Symbol.iterator]=="function",Bt=`[ 	
\f\r]`,Ke=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Hi=/-->/g,qi=/>/g,Ae=RegExp(`>|${Bt}(?:([^\\s"'>=/]+)(${Bt}*=${Bt}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Gi=/'/g,ji=/"/g,us=/^(?:script|style|textarea|title)$/i,Zn=n=>(e,...t)=>({_$litType$:n,strings:e,values:t}),h=Zn(1),Ne=Symbol.for("lit-noChange"),b=Symbol.for("lit-nothing"),Ki=new WeakMap,Me=Ie.createTreeWalker(Ie,129);function fs(n,e){if(!ri(n)||!n.hasOwnProperty("raw"))throw Error("invalid template strings array");return Ui!==void 0?Ui.createHTML(e):e}const Vn=(n,e)=>{const t=n.length-1,i=[];let s,r=e===2?"<svg>":e===3?"<math>":"",o=Ke;for(let a=0;a<t;a++){const l=n[a];let c,p,u=-1,g=0;for(;g<l.length&&(o.lastIndex=g,p=o.exec(l),p!==null);)g=o.lastIndex,o===Ke?p[1]==="!--"?o=Hi:p[1]!==void 0?o=qi:p[2]!==void 0?(us.test(p[2])&&(s=RegExp("</"+p[2],"g")),o=Ae):p[3]!==void 0&&(o=Ae):o===Ae?p[0]===">"?(o=s??Ke,u=-1):p[1]===void 0?u=-2:(u=o.lastIndex-p[2].length,c=p[1],o=p[3]===void 0?Ae:p[3]==='"'?ji:Gi):o===ji||o===Gi?o=Ae:o===Hi||o===qi?o=Ke:(o=Ae,s=void 0);const _=o===Ae&&n[a+1].startsWith("/>")?" ":"";r+=o===Ke?l+Kn:u>=0?(i.push(c),l.slice(0,u)+hs+l.slice(u)+Ee+_):l+Ee+(u===-2?a:_)}return[fs(n,r+(n[t]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),i]};class it{constructor({strings:e,_$litType$:t},i){let s;this.parts=[];let r=0,o=0;const a=e.length-1,l=this.parts,[c,p]=Vn(e,t);if(this.el=it.createElement(c,i),Me.currentNode=this.el.content,t===2||t===3){const u=this.el.content.firstChild;u.replaceWith(...u.childNodes)}for(;(s=Me.nextNode())!==null&&l.length<a;){if(s.nodeType===1){if(s.hasAttributes())for(const u of s.getAttributeNames())if(u.endsWith(hs)){const g=p[o++],_=s.getAttribute(u).split(Ee),v=/([.?@])?(.*)/.exec(g);l.push({type:1,index:r,name:v[2],strings:_,ctor:v[1]==="."?Yn:v[1]==="?"?Qn:v[1]==="@"?Jn:Rt}),s.removeAttribute(u)}else u.startsWith(Ee)&&(l.push({type:6,index:r}),s.removeAttribute(u));if(us.test(s.tagName)){const u=s.textContent.split(Ee),g=u.length-1;if(g>0){s.textContent=xt?xt.emptyScript:"";for(let _=0;_<g;_++)s.append(u[_],et()),Me.nextNode(),l.push({type:2,index:++r});s.append(u[g],et())}}}else if(s.nodeType===8)if(s.data===ps)l.push({type:2,index:r});else{let u=-1;for(;(u=s.data.indexOf(Ee,u+1))!==-1;)l.push({type:7,index:r}),u+=Ee.length-1}r++}}static createElement(e,t){const i=Ie.createElement("template");return i.innerHTML=e,i}}function Be(n,e,t=n,i){if(e===Ne)return e;let s=i!==void 0?t._$Co?.[i]:t._$Cl;const r=tt(e)?void 0:e._$litDirective$;return s?.constructor!==r&&(s?._$AO?.(!1),r===void 0?s=void 0:(s=new r(n),s._$AT(n,t,i)),i!==void 0?(t._$Co??=[])[i]=s:t._$Cl=s),s!==void 0&&(e=Be(n,s._$AS(n,e.values),s,i)),e}class Xn{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){const{el:{content:t},parts:i}=this._$AD,s=(e?.creationScope??Ie).importNode(t,!0);Me.currentNode=s;let r=Me.nextNode(),o=0,a=0,l=i[0];for(;l!==void 0;){if(o===l.index){let c;l.type===2?c=new nt(r,r.nextSibling,this,e):l.type===1?c=new l.ctor(r,l.name,l.strings,this,e):l.type===6&&(c=new er(r,this,e)),this._$AV.push(c),l=i[++a]}o!==l?.index&&(r=Me.nextNode(),o++)}return Me.currentNode=Ie,s}p(e){let t=0;for(const i of this._$AV)i!==void 0&&(i.strings!==void 0?(i._$AI(e,i,t),t+=i.strings.length-2):i._$AI(e[t])),t++}}class nt{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,i,s){this.type=2,this._$AH=b,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=i,this.options=s,this._$Cv=s?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=Be(this,e,t),tt(e)?e===b||e==null||e===""?(this._$AH!==b&&this._$AR(),this._$AH=b):e!==this._$AH&&e!==Ne&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):Wn(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==b&&tt(this._$AH)?this._$AA.nextSibling.data=e:this.T(Ie.createTextNode(e)),this._$AH=e}$(e){const{values:t,_$litType$:i}=e,s=typeof i=="number"?this._$AC(e):(i.el===void 0&&(i.el=it.createElement(fs(i.h,i.h[0]),this.options)),i);if(this._$AH?._$AD===s)this._$AH.p(t);else{const r=new Xn(s,this),o=r.u(this.options);r.p(t),this.T(o),this._$AH=r}}_$AC(e){let t=Ki.get(e.strings);return t===void 0&&Ki.set(e.strings,t=new it(e)),t}k(e){ri(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let i,s=0;for(const r of e)s===t.length?t.push(i=new nt(this.O(et()),this.O(et()),this,this.options)):i=t[s],i._$AI(r),s++;s<t.length&&(this._$AR(i&&i._$AB.nextSibling,s),t.length=s)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){const i=Bi(e).nextSibling;Bi(e).remove(),e=i}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}}class Rt{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,i,s,r){this.type=1,this._$AH=b,this._$AN=void 0,this.element=e,this.name=t,this._$AM=s,this.options=r,i.length>2||i[0]!==""||i[1]!==""?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=b}_$AI(e,t=this,i,s){const r=this.strings;let o=!1;if(r===void 0)e=Be(this,e,t,0),o=!tt(e)||e!==this._$AH&&e!==Ne,o&&(this._$AH=e);else{const a=e;let l,c;for(e=r[0],l=0;l<r.length-1;l++)c=Be(this,a[i+l],t,l),c===Ne&&(c=this._$AH[l]),o||=!tt(c)||c!==this._$AH[l],c===b?e=b:e!==b&&(e+=(c??"")+r[l+1]),this._$AH[l]=c}o&&!s&&this.j(e)}j(e){e===b?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}}class Yn extends Rt{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===b?void 0:e}}class Qn extends Rt{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==b)}}class Jn extends Rt{constructor(e,t,i,s,r){super(e,t,i,s,r),this.type=5}_$AI(e,t=this){if((e=Be(this,e,t,0)??b)===Ne)return;const i=this._$AH,s=e===b&&i!==b||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,r=e!==b&&(i===b||s);s&&this.element.removeEventListener(this.name,this,i),r&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}}class er{constructor(e,t,i){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(e){Be(this,e)}}const tr=ni.litHtmlPolyfillSupport;tr?.(it,nt),(ni.litHtmlVersions??=[]).push("3.3.2");const ir=(n,e,t)=>{const i=t?.renderBefore??e;let s=i._$litPart$;if(s===void 0){const r=t?.renderBefore??null;i._$litPart$=s=new nt(e.insertBefore(et(),r),r,void 0,t??{})}return s._$AI(n),s};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const oi=globalThis;let Z=class extends Fe{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){const e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=ir(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return Ne}};Z._$litElement$=!0,Z.finalized=!0,oi.litElementHydrateSupport?.({LitElement:Z});const sr=oi.litElementPolyfillSupport;sr?.({LitElement:Z});(oi.litElementVersions??=[]).push("4.2.2");class nr{getAllFns(e,t){let i=[],s=e.constructor.prototype;for(;s!=null;){let r=s.constructor.name.replace("_exports_","");if(t!=null&&(r=t),r!=="Object"){let o=Object.getOwnPropertyNames(s).filter(a=>a!=="constructor"&&a.indexOf("__")<0);o.forEach((a,l)=>{o[l]=r+"."+a}),i=i.concat(o)}if(t!=null)break;s=s.__proto__}return i}exposeAllFns(e,t){let i=this.getAllFns(e,t);var s={};return i.forEach(function(r){s[r]=function(o,a){Promise.resolve(e[r.substring(r.indexOf(".")+1)].apply(e,o.args)).then(function(l){return a(null,l)}).catch(function(l){return console.log("failed : "+l),a(l)})}}),s}}Window.LitElement=Z;/*! JRPC v3.1.0
 * <https://github.com/vphantom/js-jrpc>
 * Copyright 2016 Stéphane Lavergne
 * Free software under MIT License: <https://opensource.org/licenses/MIT> */var rr=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof self<"u"?self:{};rr.setImmediate=typeof setImmediate<"u"?setImmediate:(n,...e)=>setTimeout(()=>n(...e),0);function ae(n){this.active=!0,this.transmitter=null,this.remoteTimeout=6e4,this.localTimeout=0,this.serial=0,this.outbox={requests:[],responses:[]},this.inbox={},this.localTimers={},this.outTimers={},this.localComponents={"system.listComponents":!0,"system.extension.dual-batch":!0},this.remoteComponents={},this.exposed={},this.exposed["system.listComponents"]=(function(e,t){return typeof e=="object"&&e!==null&&(this.remoteComponents=e,this.remoteComponents["system._upgraded"]=!0),t(null,this.localComponents)}).bind(this),this.exposed["system.extension.dual-batch"]=function(e,t){return t(null,!0)},typeof n=="object"&&("remoteTimeout"in n&&typeof n.remoteTimeout=="number"&&(this.remoteTimeout=n.remoteTimeout*1e3),"localTimeout"in n&&typeof n.localTimeout=="number"&&(this.localTimeout=n.localTimeout*1e3))}function or(){var n=this;return n.active=!1,n.transmitter=null,n.remoteTimeout=0,n.localTimeout=0,n.localComponents={},n.remoteComponents={},n.outbox.requests.length=0,n.outbox.responses.length=0,n.inbox={},n.exposed={},Object.keys(n.localTimers).forEach(function(e){clearTimeout(n.localTimers[e]),delete n.localTimers[e]}),Object.keys(n.outTimers).forEach(function(e){clearTimeout(n.outTimers[e]),delete n.outTimers[e]}),n}function ar(n){var e,t,i=null,s={responses:[],requests:[]};if(typeof n!="function"&&(n=this.transmitter),!this.active||typeof n!="function")return this;if(e=this.outbox.responses.length,t=this.outbox.requests.length,e>0&&t>0&&"system.extension.dual-batch"in this.remoteComponents)s=i={responses:this.outbox.responses,requests:this.outbox.requests},this.outbox.responses=[],this.outbox.requests=[];else if(e>0)e>1?(s.responses=i=this.outbox.responses,this.outbox.responses=[]):s.responses.push(i=this.outbox.responses.pop());else if(t>0)t>1?(s.requests=i=this.outbox.requests,this.outbox.requests=[]):s.requests.push(i=this.outbox.requests.pop());else return this;return setImmediate(n,JSON.stringify(i),cr.bind(this,s)),this}function lr(n){return this.transmitter=n,this.transmit()}function cr(n,e){this.active&&e&&(n.responses.length>0&&Array.prototype.push.apply(this.outbox.responses,n.responses),n.requests.length>0&&Array.prototype.push.apply(this.outbox.requests,n.requests))}function dr(n){var e=[],t=[];if(!this.active)return this;if(typeof n=="string")try{n=JSON.parse(n)}catch{return this}if(n.constructor===Array){if(n.length===0)return this;typeof n[0].method=="string"?e=n:t=n}else typeof n=="object"&&(typeof n.requests<"u"&&typeof n.responses<"u"?(e=n.requests,t=n.responses):typeof n.method=="string"?e.push(n):t.push(n));return t.forEach(gs.bind(this)),e.forEach(ur.bind(this)),this}function hr(){return this.active?this.call("system.listComponents",this.localComponents,(function(n,e){!n&&typeof e=="object"&&(this.remoteComponents=e,this.remoteComponents["system._upgraded"]=!0)}).bind(this)):this}function ai(n,e,t){var i={jsonrpc:"2.0",method:n};return this.active?(typeof e=="function"&&(t=e,e=null),"system._upgraded"in this.remoteComponents&&!(n in this.remoteComponents)?(typeof t=="function"&&setImmediate(t,{code:-32601,message:"Unknown remote method"}),this):(typeof e=="object"&&(i.params=e),this.serial++,typeof t=="function"&&(i.id=this.serial,this.inbox[this.serial]=t),this.outbox.requests.push(i),this.transmit(),typeof t!="function"?this:(this.remoteTimeout>0?this.outTimers[this.serial]=setTimeout(gs.bind(this,{jsonrpc:"2.0",id:this.serial,error:{code:-1e3,message:"Timed out waiting for response"}}),this.remoteTimeout):this.outTimers[this.serial]=!0,this))):this}function gs(n){var e=!1,t=null;if(this.active&&"id"in n&&n.id in this.outTimers)clearTimeout(this.outTimers[n.id]),delete this.outTimers[n.id];else return;n.id in this.inbox&&("error"in n?e=n.error:t=n.result,setImmediate(this.inbox[n.id],e,t),delete this.inbox[n.id])}function pr(n,e){var t;if(!this.active)return this;if(typeof n=="string")this.localComponents[n]=!0,this.exposed[n]=e;else if(typeof n=="object")for(t in n)n.hasOwnProperty(t)&&(this.localComponents[t]=!0,this.exposed[t]=n[t]);return this}function ur(n){var e=null,t=null;if(!(!this.active||typeof n!="object"||n===null)&&typeof n.jsonrpc=="string"&&n.jsonrpc==="2.0"){if(e=typeof n.id<"u"?n.id:null,typeof n.method!="string"){e!==null&&(this.localTimers[e]=!0,setImmediate(We.bind(this,e,-32600)));return}if(!(n.method in this.exposed)){e!==null&&(this.localTimers[e]=!0,setImmediate(We.bind(this,e,-32601)));return}if("params"in n)if(typeof n.params=="object")t=n.params;else{e!==null&&(this.localTimers[e]=!0,setImmediate(We.bind(this,e,-32602)));return}e!==null&&(this.localTimeout>0?this.localTimers[e]=setTimeout(We.bind(this,e,{code:-1002,message:"Method handler timed out"}),this.localTimeout):this.localTimers[e]=!0),setImmediate(this.exposed[n.method],t,We.bind(this,e))}}function We(n,e,t){var i={jsonrpc:"2.0",id:n};if(n!==null){if(this.active&&n in this.localTimers)clearTimeout(this.localTimers[n]),delete this.localTimers[n];else return;typeof e<"u"&&e!==null&&e!==!1?typeof e=="number"?i.error={code:e,message:"error"}:e===!0?i.error={code:-1,message:"error"}:typeof e=="string"?i.error={code:-1,message:e}:typeof e=="object"&&"code"in e&&"message"in e?i.error=e:i.error={code:-2,message:"error",data:e}:i.result=t,this.outbox.responses.push(i),this.transmit()}}ae.prototype.shutdown=or;ae.prototype.call=ai;ae.prototype.notify=ai;ae.prototype.expose=pr;ae.prototype.upgrade=hr;ae.prototype.receive=dr;ae.prototype.transmit=ar;ae.prototype.setTransmitter=lr;typeof Promise<"u"&&typeof Promise.promisify=="function"&&(ae.prototype.callAsync=Promise.promisify(ai));Window.JRPC=ae;const _t=self.crypto;_t.randomUUID||(_t.randomUUID=()=>_t.getRandomValues(new Uint8Array(32)).toString("base64").replaceAll(",",""));class fr extends Z{newRemote(){let e;return typeof Window>"u"?e=new ae({remoteTimeout:this.remoteTimeout}):e=new ae({remoteTimeout:this.remoteTimeout}),e.uuid=_t.randomUUID(),this.remotes==null&&(this.remotes={}),this.remotes[e.uuid]=e,e}createRemote(e){let t=this.newRemote();return this.remoteIsUp(),this.ws?(e=this.ws,this.ws.onclose=function(i){this.rmRemote(i,t.uuid)}.bind(this),this.ws.onmessage=i=>{t.receive(i.data)}):(e.on("close",(i,s)=>this.rmRemote.bind(this)(i,t.uuid)),e.on("message",function(i,s){const r=s?i:i.toString();t.receive(r)})),this.setupRemote(t,e),t}remoteIsUp(){console.log("JRPCCommon::remoteIsUp")}rmRemote(e,t){if(this.server&&this.remotes[t]&&this.remotes[t].rpcs&&Object.keys(this.remotes[t].rpcs).forEach(i=>{this.server[i]&&delete this.server[i]}),Object.keys(this.remotes).length&&delete this.remotes[t],this.call&&Object.keys(this.remotes).length){let i=[];for(const s in this.remotes)this.remotes[s].rpcs&&(i=i.concat(Object.keys(this.remotes[s].rpcs)));if(this.call){let s=Object.keys(this.call);for(let r=0;r<s.length;r++)i.indexOf(s[r])<0&&delete this.call[s[r]]}}else this.call={};this.remoteDisconnected(t)}remoteDisconnected(e){console.log("JPRCCommon::remoteDisconnected "+e)}setupRemote(e,t){e.setTransmitter(this.transmit.bind(t)),this.classes&&this.classes.forEach(i=>{e.expose(i)}),e.upgrade(),e.call("system.listComponents",[],(i,s)=>{i?(console.log(i),console.log("Something went wrong when calling system.listComponents !")):this.setupFns(Object.keys(s),e)})}transmit(e,t){try{return this.send(e),t(!1)}catch(i){return console.log(i),t(!0)}}setupFns(e,t){e.forEach(i=>{t.rpcs==null&&(t.rpcs={}),t.rpcs[i]=function(s){return new Promise((r,o)=>{t.call(i,{args:Array.from(arguments)},(a,l)=>{a?(console.log("Error when calling remote function : "+i),o(a)):r(l)})})},this.call==null&&(this.call={}),this.call[i]==null&&(this.call[i]=(...s)=>{let r=[],o=[];for(const a in this.remotes)this.remotes[a].rpcs[i]!=null&&(o.push(a),r.push(this.remotes[a].rpcs[i](...s)));return Promise.all(r).then(a=>{let l={};return o.forEach((c,p)=>l[c]=a[p]),l})}),this.server==null&&(this.server={}),this.server[i]==null?this.server[i]=function(s){return new Promise((r,o)=>{t.call(i,{args:Array.from(arguments)},(a,l)=>{a?(console.log("Error when calling remote function : "+i),o(a)):r(l)})})}:this.server[i]=function(s){return new Promise((r,o)=>{o(new Error("More then one remote has this RPC, not sure who to talk to : "+i))})}}),this.setupDone()}setupDone(){}addClass(e,t){e.getRemotes=()=>this.remotes,e.getCall=()=>this.call,e.getServer=()=>this.server;let s=new nr().exposeAllFns(e,t);if(this.classes==null?this.classes=[s]:this.classes.push(s),this.remotes!=null)for(const[r,o]of Object.entries(this.remotes))o.expose(s),o.upgrade()}}class ms extends fr{static get properties(){return{serverURI:{type:String},ws:{type:Object},server:{type:Object},remoteTimeout:{type:Number}}}constructor(){super(),this.remoteTimeout=60}updated(e){e.has("serverURI")&&this.serverURI&&this.serverURI!="undefined"&&this.serverChanged()}serverChanged(){this.ws!=null&&delete this.ws;try{this.ws=new WebSocket(this.serverURI),console.assert(this.ws.parent==null,"wss.parent already exists, this needs upgrade."),this.ws.addEventListener("open",this.createRemote.bind(this)),this.ws.addEventListener("error",this.wsError.bind(this))}catch(e){this.serverURI="",this.setupSkip(e)}}wsError(e){this.setupSkip(e)}isConnected(){return this.server!=null&&this.server!={}}setupSkip(){this.dispatchEvent(new CustomEvent("skip"))}setupDone(){this.dispatchEvent(new CustomEvent("done"))}}window.customElements.get("jrpc-client")||window.customElements.define("jrpc-client",ms);let ft=null,yt=null,Ye=null;const jt=new Set;function bs(){yt||(yt=new Promise(n=>{Ye=n}))}bs();const Se={set(n){ft=n,Ye&&(Ye(n),Ye=null);for(const e of jt)try{e.onRpcReady()}catch(t){console.error("onRpcReady error:",t)}},get call(){return ft},get connected(){return ft!==null},get ready(){return bs(),yt},reset(){ft=null,yt=new Promise(n=>{Ye=n})}},le=n=>class extends n{constructor(){super(),this._rpcRegistered=!1}connectedCallback(){super.connectedCallback(),jt.add(this),this._rpcRegistered=!0,Se.connected&&queueMicrotask(()=>this.onRpcReady())}disconnectedCallback(){super.disconnectedCallback(),jt.delete(this),this._rpcRegistered=!1}get rpcConnected(){return Se.connected}async rpcCall(e,...t){return Se.call||await Se.ready,Se.call[e](...t)}async rpcExtract(e,...t){const i=await this.rpcCall(e,...t);if(i==null)return i;if(typeof i=="object"){const s=Object.keys(i);if(s.length===1)return i[s[0]]}return i}onRpcReady(){}};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const gr={CHILD:2},mr=n=>(...e)=>({_$litDirective$:n,values:e});class br{constructor(e){}get _$AU(){return this._$AM._$AU}_$AT(e,t,i){this._$Ct=e,this._$AM=t,this._$Ci=i}_$AS(e,t){return this.update(e,t)}update(e,t){return this.render(...t)}}/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */class Kt extends br{constructor(e){if(super(e),this.it=b,e.type!==gr.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(e){if(e===b||e==null)return this._t=void 0,this.it=e;if(e===Ne)return e;if(typeof e!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(e===this.it)return this._t;this.it=e;const t=[e];return t.raw=t,this._t={_$litType$:this.constructor.resultType,strings:t,values:[]}}}Kt.directiveName="unsafeHTML",Kt.resultType=1;const Ut=mr(Kt);function li(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var Oe=li();function _s(n){Oe=n}var Je={exec:()=>null};function D(n,e=""){let t=typeof n=="string"?n:n.source;const i={replace:(s,r)=>{let o=typeof r=="string"?r:r.source;return o=o.replace(ne.caret,"$1"),t=t.replace(s,o),i},getRegex:()=>new RegExp(t,e)};return i}var ne={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] /,listReplaceTask:/^\[[ xX]\] +/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:n=>new RegExp(`^( {0,3}${n})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}#`),htmlBeginRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}<(?:[a-z].*>|!--)`,"i")},_r=/^(?:[ \t]*(?:\n|$))+/,vr=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,xr=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,rt=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,yr=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,ci=/(?:[*+-]|\d{1,9}[.)])/,vs=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,xs=D(vs).replace(/bull/g,ci).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),wr=D(vs).replace(/bull/g,ci).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),di=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,kr=/^[^\n]+/,hi=/(?!\s*\])(?:\\.|[^\[\]\\])+/,Er=D(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",hi).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),Sr=D(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,ci).getRegex(),At="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",pi=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,$r=D("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",pi).replace("tag",At).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),ys=D(di).replace("hr",rt).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",At).getRegex(),Cr=D(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",ys).getRegex(),ui={blockquote:Cr,code:vr,def:Er,fences:xr,heading:yr,hr:rt,html:$r,lheading:xs,list:Sr,newline:_r,paragraph:ys,table:Je,text:kr},Wi=D("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",rt).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",At).getRegex(),Tr={...ui,lheading:wr,table:Wi,paragraph:D(di).replace("hr",rt).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Wi).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",At).getRegex()},Rr={...ui,html:D(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",pi).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:Je,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:D(di).replace("hr",rt).replace("heading",` *#{1,6} *[^
]`).replace("lheading",xs).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Ar=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,Mr=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,ws=/^( {2,}|\\)\n(?!\s*$)/,Ir=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,Mt=/[\p{P}\p{S}]/u,fi=/[\s\p{P}\p{S}]/u,ks=/[^\s\p{P}\p{S}]/u,Nr=D(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,fi).getRegex(),Es=/(?!~)[\p{P}\p{S}]/u,Lr=/(?!~)[\s\p{P}\p{S}]/u,Or=/(?:[^\s\p{P}\p{S}]|~)/u,Dr=/\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g,Ss=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,zr=D(Ss,"u").replace(/punct/g,Mt).getRegex(),Pr=D(Ss,"u").replace(/punct/g,Es).getRegex(),$s="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Fr=D($s,"gu").replace(/notPunctSpace/g,ks).replace(/punctSpace/g,fi).replace(/punct/g,Mt).getRegex(),Br=D($s,"gu").replace(/notPunctSpace/g,Or).replace(/punctSpace/g,Lr).replace(/punct/g,Es).getRegex(),Ur=D("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,ks).replace(/punctSpace/g,fi).replace(/punct/g,Mt).getRegex(),Hr=D(/\\(punct)/,"gu").replace(/punct/g,Mt).getRegex(),qr=D(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Gr=D(pi).replace("(?:-->|$)","-->").getRegex(),jr=D("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Gr).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),wt=/(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/,Kr=D(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",wt).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),Cs=D(/^!?\[(label)\]\[(ref)\]/).replace("label",wt).replace("ref",hi).getRegex(),Ts=D(/^!?\[(ref)\](?:\[\])?/).replace("ref",hi).getRegex(),Wr=D("reflink|nolink(?!\\()","g").replace("reflink",Cs).replace("nolink",Ts).getRegex(),gi={_backpedal:Je,anyPunctuation:Hr,autolink:qr,blockSkip:Dr,br:ws,code:Mr,del:Je,emStrongLDelim:zr,emStrongRDelimAst:Fr,emStrongRDelimUnd:Ur,escape:Ar,link:Kr,nolink:Ts,punctuation:Nr,reflink:Cs,reflinkSearch:Wr,tag:jr,text:Ir,url:Je},Zr={...gi,link:D(/^!?\[(label)\]\((.*?)\)/).replace("label",wt).getRegex(),reflink:D(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",wt).getRegex()},Wt={...gi,emStrongRDelimAst:Br,emStrongLDelim:Pr,url:D(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/,"i").replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,text:/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/},Vr={...Wt,br:D(ws).replace("{2,}","*").getRegex(),text:D(Wt.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},gt={normal:ui,gfm:Tr,pedantic:Rr},Ze={normal:gi,gfm:Wt,breaks:Vr,pedantic:Zr},Xr={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Zi=n=>Xr[n];function ue(n,e){if(e){if(ne.escapeTest.test(n))return n.replace(ne.escapeReplace,Zi)}else if(ne.escapeTestNoEncode.test(n))return n.replace(ne.escapeReplaceNoEncode,Zi);return n}function Vi(n){try{n=encodeURI(n).replace(ne.percentDecode,"%")}catch{return null}return n}function Xi(n,e){const t=n.replace(ne.findPipe,(r,o,a)=>{let l=!1,c=o;for(;--c>=0&&a[c]==="\\";)l=!l;return l?"|":" |"}),i=t.split(ne.splitPipe);let s=0;if(i[0].trim()||i.shift(),i.length>0&&!i.at(-1)?.trim()&&i.pop(),e)if(i.length>e)i.splice(e);else for(;i.length<e;)i.push("");for(;s<i.length;s++)i[s]=i[s].trim().replace(ne.slashPipe,"|");return i}function Ve(n,e,t){const i=n.length;if(i===0)return"";let s=0;for(;s<i&&n.charAt(i-s-1)===e;)s++;return n.slice(0,i-s)}function Yr(n,e){if(n.indexOf(e[1])===-1)return-1;let t=0;for(let i=0;i<n.length;i++)if(n[i]==="\\")i++;else if(n[i]===e[0])t++;else if(n[i]===e[1]&&(t--,t<0))return i;return t>0?-2:-1}function Yi(n,e,t,i,s){const r=e.href,o=e.title||null,a=n[1].replace(s.other.outputLinkReplace,"$1");i.state.inLink=!0;const l={type:n[0].charAt(0)==="!"?"image":"link",raw:t,href:r,title:o,text:a,tokens:i.inlineTokens(a)};return i.state.inLink=!1,l}function Qr(n,e,t){const i=n.match(t.other.indentCodeCompensation);if(i===null)return e;const s=i[1];return e.split(`
`).map(r=>{const o=r.match(t.other.beginningSpace);if(o===null)return r;const[a]=o;return a.length>=s.length?r.slice(s.length):r}).join(`
`)}var kt=class{options;rules;lexer;constructor(n){this.options=n||Oe}space(n){const e=this.rules.block.newline.exec(n);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(n){const e=this.rules.block.code.exec(n);if(e){const t=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?t:Ve(t,`
`)}}}fences(n){const e=this.rules.block.fences.exec(n);if(e){const t=e[0],i=Qr(t,e[3]||"",this.rules);return{type:"code",raw:t,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:i}}}heading(n){const e=this.rules.block.heading.exec(n);if(e){let t=e[2].trim();if(this.rules.other.endingHash.test(t)){const i=Ve(t,"#");(this.options.pedantic||!i||this.rules.other.endingSpaceChar.test(i))&&(t=i.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:t,tokens:this.lexer.inline(t)}}}hr(n){const e=this.rules.block.hr.exec(n);if(e)return{type:"hr",raw:Ve(e[0],`
`)}}blockquote(n){const e=this.rules.block.blockquote.exec(n);if(e){let t=Ve(e[0],`
`).split(`
`),i="",s="";const r=[];for(;t.length>0;){let o=!1;const a=[];let l;for(l=0;l<t.length;l++)if(this.rules.other.blockquoteStart.test(t[l]))a.push(t[l]),o=!0;else if(!o)a.push(t[l]);else break;t=t.slice(l);const c=a.join(`
`),p=c.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");i=i?`${i}
${c}`:c,s=s?`${s}
${p}`:p;const u=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(p,r,!0),this.lexer.state.top=u,t.length===0)break;const g=r.at(-1);if(g?.type==="code")break;if(g?.type==="blockquote"){const _=g,v=_.raw+`
`+t.join(`
`),E=this.blockquote(v);r[r.length-1]=E,i=i.substring(0,i.length-_.raw.length)+E.raw,s=s.substring(0,s.length-_.text.length)+E.text;break}else if(g?.type==="list"){const _=g,v=_.raw+`
`+t.join(`
`),E=this.list(v);r[r.length-1]=E,i=i.substring(0,i.length-g.raw.length)+E.raw,s=s.substring(0,s.length-_.raw.length)+E.raw,t=v.substring(r.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:i,tokens:r,text:s}}}list(n){let e=this.rules.block.list.exec(n);if(e){let t=e[1].trim();const i=t.length>1,s={type:"list",raw:"",ordered:i,start:i?+t.slice(0,-1):"",loose:!1,items:[]};t=i?`\\d{1,9}\\${t.slice(-1)}`:`\\${t}`,this.options.pedantic&&(t=i?t:"[*+-]");const r=this.rules.other.listItemRegex(t);let o=!1;for(;n;){let l=!1,c="",p="";if(!(e=r.exec(n))||this.rules.block.hr.test(n))break;c=e[0],n=n.substring(c.length);let u=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,I=>" ".repeat(3*I.length)),g=n.split(`
`,1)[0],_=!u.trim(),v=0;if(this.options.pedantic?(v=2,p=u.trimStart()):_?v=e[1].length+1:(v=e[2].search(this.rules.other.nonSpaceChar),v=v>4?1:v,p=u.slice(v),v+=e[1].length),_&&this.rules.other.blankLine.test(g)&&(c+=g+`
`,n=n.substring(g.length+1),l=!0),!l){const I=this.rules.other.nextBulletRegex(v),P=this.rules.other.hrRegex(v),G=this.rules.other.fencesBeginRegex(v),C=this.rules.other.headingBeginRegex(v),B=this.rules.other.htmlBeginRegex(v);for(;n;){const U=n.split(`
`,1)[0];let V;if(g=U,this.options.pedantic?(g=g.replace(this.rules.other.listReplaceNesting,"  "),V=g):V=g.replace(this.rules.other.tabCharGlobal,"    "),G.test(g)||C.test(g)||B.test(g)||I.test(g)||P.test(g))break;if(V.search(this.rules.other.nonSpaceChar)>=v||!g.trim())p+=`
`+V.slice(v);else{if(_||u.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||G.test(u)||C.test(u)||P.test(u))break;p+=`
`+g}!_&&!g.trim()&&(_=!0),c+=U+`
`,n=n.substring(U.length+1),u=V.slice(v)}}s.loose||(o?s.loose=!0:this.rules.other.doubleBlankLine.test(c)&&(o=!0));let E=null,M;this.options.gfm&&(E=this.rules.other.listIsTask.exec(p),E&&(M=E[0]!=="[ ] ",p=p.replace(this.rules.other.listReplaceTask,""))),s.items.push({type:"list_item",raw:c,task:!!E,checked:M,loose:!1,text:p,tokens:[]}),s.raw+=c}const a=s.items.at(-1);if(a)a.raw=a.raw.trimEnd(),a.text=a.text.trimEnd();else return;s.raw=s.raw.trimEnd();for(let l=0;l<s.items.length;l++)if(this.lexer.state.top=!1,s.items[l].tokens=this.lexer.blockTokens(s.items[l].text,[]),!s.loose){const c=s.items[l].tokens.filter(u=>u.type==="space"),p=c.length>0&&c.some(u=>this.rules.other.anyLine.test(u.raw));s.loose=p}if(s.loose)for(let l=0;l<s.items.length;l++)s.items[l].loose=!0;return s}}html(n){const e=this.rules.block.html.exec(n);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(n){const e=this.rules.block.def.exec(n);if(e){const t=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),i=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",s=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:t,raw:e[0],href:i,title:s}}}table(n){const e=this.rules.block.table.exec(n);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;const t=Xi(e[1]),i=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),s=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],r={type:"table",raw:e[0],header:[],align:[],rows:[]};if(t.length===i.length){for(const o of i)this.rules.other.tableAlignRight.test(o)?r.align.push("right"):this.rules.other.tableAlignCenter.test(o)?r.align.push("center"):this.rules.other.tableAlignLeft.test(o)?r.align.push("left"):r.align.push(null);for(let o=0;o<t.length;o++)r.header.push({text:t[o],tokens:this.lexer.inline(t[o]),header:!0,align:r.align[o]});for(const o of s)r.rows.push(Xi(o,r.header.length).map((a,l)=>({text:a,tokens:this.lexer.inline(a),header:!1,align:r.align[l]})));return r}}lheading(n){const e=this.rules.block.lheading.exec(n);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(n){const e=this.rules.block.paragraph.exec(n);if(e){const t=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:t,tokens:this.lexer.inline(t)}}}text(n){const e=this.rules.block.text.exec(n);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(n){const e=this.rules.inline.escape.exec(n);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(n){const e=this.rules.inline.tag.exec(n);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(n){const e=this.rules.inline.link.exec(n);if(e){const t=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(t)){if(!this.rules.other.endAngleBracket.test(t))return;const r=Ve(t.slice(0,-1),"\\");if((t.length-r.length)%2===0)return}else{const r=Yr(e[2],"()");if(r===-2)return;if(r>-1){const a=(e[0].indexOf("!")===0?5:4)+e[1].length+r;e[2]=e[2].substring(0,r),e[0]=e[0].substring(0,a).trim(),e[3]=""}}let i=e[2],s="";if(this.options.pedantic){const r=this.rules.other.pedanticHrefTitle.exec(i);r&&(i=r[1],s=r[3])}else s=e[3]?e[3].slice(1,-1):"";return i=i.trim(),this.rules.other.startAngleBracket.test(i)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(t)?i=i.slice(1):i=i.slice(1,-1)),Yi(e,{href:i&&i.replace(this.rules.inline.anyPunctuation,"$1"),title:s&&s.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(n,e){let t;if((t=this.rules.inline.reflink.exec(n))||(t=this.rules.inline.nolink.exec(n))){const i=(t[2]||t[1]).replace(this.rules.other.multipleSpaceGlobal," "),s=e[i.toLowerCase()];if(!s){const r=t[0].charAt(0);return{type:"text",raw:r,text:r}}return Yi(t,s,t[0],this.lexer,this.rules)}}emStrong(n,e,t=""){let i=this.rules.inline.emStrongLDelim.exec(n);if(!i||i[3]&&t.match(this.rules.other.unicodeAlphaNumeric))return;if(!(i[1]||i[2]||"")||!t||this.rules.inline.punctuation.exec(t)){const r=[...i[0]].length-1;let o,a,l=r,c=0;const p=i[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(p.lastIndex=0,e=e.slice(-1*n.length+r);(i=p.exec(e))!=null;){if(o=i[1]||i[2]||i[3]||i[4]||i[5]||i[6],!o)continue;if(a=[...o].length,i[3]||i[4]){l+=a;continue}else if((i[5]||i[6])&&r%3&&!((r+a)%3)){c+=a;continue}if(l-=a,l>0)continue;a=Math.min(a,a+l+c);const u=[...i[0]][0].length,g=n.slice(0,r+i.index+u+a);if(Math.min(r,a)%2){const v=g.slice(1,-1);return{type:"em",raw:g,text:v,tokens:this.lexer.inlineTokens(v)}}const _=g.slice(2,-2);return{type:"strong",raw:g,text:_,tokens:this.lexer.inlineTokens(_)}}}}codespan(n){const e=this.rules.inline.code.exec(n);if(e){let t=e[2].replace(this.rules.other.newLineCharGlobal," ");const i=this.rules.other.nonSpaceChar.test(t),s=this.rules.other.startingSpaceChar.test(t)&&this.rules.other.endingSpaceChar.test(t);return i&&s&&(t=t.substring(1,t.length-1)),{type:"codespan",raw:e[0],text:t}}}br(n){const e=this.rules.inline.br.exec(n);if(e)return{type:"br",raw:e[0]}}del(n){const e=this.rules.inline.del.exec(n);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(n){const e=this.rules.inline.autolink.exec(n);if(e){let t,i;return e[2]==="@"?(t=e[1],i="mailto:"+t):(t=e[1],i=t),{type:"link",raw:e[0],text:t,href:i,tokens:[{type:"text",raw:t,text:t}]}}}url(n){let e;if(e=this.rules.inline.url.exec(n)){let t,i;if(e[2]==="@")t=e[0],i="mailto:"+t;else{let s;do s=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(s!==e[0]);t=e[0],e[1]==="www."?i="http://"+e[0]:i=e[0]}return{type:"link",raw:e[0],text:t,href:i,tokens:[{type:"text",raw:t,text:t}]}}}inlineText(n){const e=this.rules.inline.text.exec(n);if(e){const t=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:t}}}},xe=class Zt{tokens;options;state;tokenizer;inlineQueue;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||Oe,this.options.tokenizer=this.options.tokenizer||new kt,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};const t={other:ne,block:gt.normal,inline:Ze.normal};this.options.pedantic?(t.block=gt.pedantic,t.inline=Ze.pedantic):this.options.gfm&&(t.block=gt.gfm,this.options.breaks?t.inline=Ze.breaks:t.inline=Ze.gfm),this.tokenizer.rules=t}static get rules(){return{block:gt,inline:Ze}}static lex(e,t){return new Zt(t).lex(e)}static lexInline(e,t){return new Zt(t).inlineTokens(e)}lex(e){e=e.replace(ne.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let t=0;t<this.inlineQueue.length;t++){const i=this.inlineQueue[t];this.inlineTokens(i.src,i.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,t=[],i=!1){for(this.options.pedantic&&(e=e.replace(ne.tabCharGlobal,"    ").replace(ne.spaceLine,""));e;){let s;if(this.options.extensions?.block?.some(o=>(s=o.call({lexer:this},e,t))?(e=e.substring(s.raw.length),t.push(s),!0):!1))continue;if(s=this.tokenizer.space(e)){e=e.substring(s.raw.length);const o=t.at(-1);s.raw.length===1&&o!==void 0?o.raw+=`
`:t.push(s);continue}if(s=this.tokenizer.code(e)){e=e.substring(s.raw.length);const o=t.at(-1);o?.type==="paragraph"||o?.type==="text"?(o.raw+=`
`+s.raw,o.text+=`
`+s.text,this.inlineQueue.at(-1).src=o.text):t.push(s);continue}if(s=this.tokenizer.fences(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.heading(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.hr(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.blockquote(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.list(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.html(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.def(e)){e=e.substring(s.raw.length);const o=t.at(-1);o?.type==="paragraph"||o?.type==="text"?(o.raw+=`
`+s.raw,o.text+=`
`+s.raw,this.inlineQueue.at(-1).src=o.text):this.tokens.links[s.tag]||(this.tokens.links[s.tag]={href:s.href,title:s.title});continue}if(s=this.tokenizer.table(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.lheading(e)){e=e.substring(s.raw.length),t.push(s);continue}let r=e;if(this.options.extensions?.startBlock){let o=1/0;const a=e.slice(1);let l;this.options.extensions.startBlock.forEach(c=>{l=c.call({lexer:this},a),typeof l=="number"&&l>=0&&(o=Math.min(o,l))}),o<1/0&&o>=0&&(r=e.substring(0,o+1))}if(this.state.top&&(s=this.tokenizer.paragraph(r))){const o=t.at(-1);i&&o?.type==="paragraph"?(o.raw+=`
`+s.raw,o.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=o.text):t.push(s),i=r.length!==e.length,e=e.substring(s.raw.length);continue}if(s=this.tokenizer.text(e)){e=e.substring(s.raw.length);const o=t.at(-1);o?.type==="text"?(o.raw+=`
`+s.raw,o.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=o.text):t.push(s);continue}if(e){const o="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(o);break}else throw new Error(o)}}return this.state.top=!0,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}inlineTokens(e,t=[]){let i=e,s=null;if(this.tokens.links){const a=Object.keys(this.tokens.links);if(a.length>0)for(;(s=this.tokenizer.rules.inline.reflinkSearch.exec(i))!=null;)a.includes(s[0].slice(s[0].lastIndexOf("[")+1,-1))&&(i=i.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+i.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(s=this.tokenizer.rules.inline.anyPunctuation.exec(i))!=null;)i=i.slice(0,s.index)+"++"+i.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);for(;(s=this.tokenizer.rules.inline.blockSkip.exec(i))!=null;)i=i.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+i.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);let r=!1,o="";for(;e;){r||(o=""),r=!1;let a;if(this.options.extensions?.inline?.some(c=>(a=c.call({lexer:this},e,t))?(e=e.substring(a.raw.length),t.push(a),!0):!1))continue;if(a=this.tokenizer.escape(e)){e=e.substring(a.raw.length),t.push(a);continue}if(a=this.tokenizer.tag(e)){e=e.substring(a.raw.length),t.push(a);continue}if(a=this.tokenizer.link(e)){e=e.substring(a.raw.length),t.push(a);continue}if(a=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(a.raw.length);const c=t.at(-1);a.type==="text"&&c?.type==="text"?(c.raw+=a.raw,c.text+=a.text):t.push(a);continue}if(a=this.tokenizer.emStrong(e,i,o)){e=e.substring(a.raw.length),t.push(a);continue}if(a=this.tokenizer.codespan(e)){e=e.substring(a.raw.length),t.push(a);continue}if(a=this.tokenizer.br(e)){e=e.substring(a.raw.length),t.push(a);continue}if(a=this.tokenizer.del(e)){e=e.substring(a.raw.length),t.push(a);continue}if(a=this.tokenizer.autolink(e)){e=e.substring(a.raw.length),t.push(a);continue}if(!this.state.inLink&&(a=this.tokenizer.url(e))){e=e.substring(a.raw.length),t.push(a);continue}let l=e;if(this.options.extensions?.startInline){let c=1/0;const p=e.slice(1);let u;this.options.extensions.startInline.forEach(g=>{u=g.call({lexer:this},p),typeof u=="number"&&u>=0&&(c=Math.min(c,u))}),c<1/0&&c>=0&&(l=e.substring(0,c+1))}if(a=this.tokenizer.inlineText(l)){e=e.substring(a.raw.length),a.raw.slice(-1)!=="_"&&(o=a.raw.slice(-1)),r=!0;const c=t.at(-1);c?.type==="text"?(c.raw+=a.raw,c.text+=a.text):t.push(a);continue}if(e){const c="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(c);break}else throw new Error(c)}}return t}},Et=class{options;parser;constructor(n){this.options=n||Oe}space(n){return""}code({text:n,lang:e,escaped:t}){const i=(e||"").match(ne.notSpaceStart)?.[0],s=n.replace(ne.endingNewline,"")+`
`;return i?'<pre><code class="language-'+ue(i)+'">'+(t?s:ue(s,!0))+`</code></pre>
`:"<pre><code>"+(t?s:ue(s,!0))+`</code></pre>
`}blockquote({tokens:n}){return`<blockquote>
${this.parser.parse(n)}</blockquote>
`}html({text:n}){return n}heading({tokens:n,depth:e}){return`<h${e}>${this.parser.parseInline(n)}</h${e}>
`}hr(n){return`<hr>
`}list(n){const e=n.ordered,t=n.start;let i="";for(let o=0;o<n.items.length;o++){const a=n.items[o];i+=this.listitem(a)}const s=e?"ol":"ul",r=e&&t!==1?' start="'+t+'"':"";return"<"+s+r+`>
`+i+"</"+s+`>
`}listitem(n){let e="";if(n.task){const t=this.checkbox({checked:!!n.checked});n.loose?n.tokens[0]?.type==="paragraph"?(n.tokens[0].text=t+" "+n.tokens[0].text,n.tokens[0].tokens&&n.tokens[0].tokens.length>0&&n.tokens[0].tokens[0].type==="text"&&(n.tokens[0].tokens[0].text=t+" "+ue(n.tokens[0].tokens[0].text),n.tokens[0].tokens[0].escaped=!0)):n.tokens.unshift({type:"text",raw:t+" ",text:t+" ",escaped:!0}):e+=t+" "}return e+=this.parser.parse(n.tokens,!!n.loose),`<li>${e}</li>
`}checkbox({checked:n}){return"<input "+(n?'checked="" ':"")+'disabled="" type="checkbox">'}paragraph({tokens:n}){return`<p>${this.parser.parseInline(n)}</p>
`}table(n){let e="",t="";for(let s=0;s<n.header.length;s++)t+=this.tablecell(n.header[s]);e+=this.tablerow({text:t});let i="";for(let s=0;s<n.rows.length;s++){const r=n.rows[s];t="";for(let o=0;o<r.length;o++)t+=this.tablecell(r[o]);i+=this.tablerow({text:t})}return i&&(i=`<tbody>${i}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+i+`</table>
`}tablerow({text:n}){return`<tr>
${n}</tr>
`}tablecell(n){const e=this.parser.parseInline(n.tokens),t=n.header?"th":"td";return(n.align?`<${t} align="${n.align}">`:`<${t}>`)+e+`</${t}>
`}strong({tokens:n}){return`<strong>${this.parser.parseInline(n)}</strong>`}em({tokens:n}){return`<em>${this.parser.parseInline(n)}</em>`}codespan({text:n}){return`<code>${ue(n,!0)}</code>`}br(n){return"<br>"}del({tokens:n}){return`<del>${this.parser.parseInline(n)}</del>`}link({href:n,title:e,tokens:t}){const i=this.parser.parseInline(t),s=Vi(n);if(s===null)return i;n=s;let r='<a href="'+n+'"';return e&&(r+=' title="'+ue(e)+'"'),r+=">"+i+"</a>",r}image({href:n,title:e,text:t,tokens:i}){i&&(t=this.parser.parseInline(i,this.parser.textRenderer));const s=Vi(n);if(s===null)return ue(t);n=s;let r=`<img src="${n}" alt="${t}"`;return e&&(r+=` title="${ue(e)}"`),r+=">",r}text(n){return"tokens"in n&&n.tokens?this.parser.parseInline(n.tokens):"escaped"in n&&n.escaped?n.text:ue(n.text)}},mi=class{strong({text:n}){return n}em({text:n}){return n}codespan({text:n}){return n}del({text:n}){return n}html({text:n}){return n}text({text:n}){return n}link({text:n}){return""+n}image({text:n}){return""+n}br(){return""}},ye=class Vt{options;renderer;textRenderer;constructor(e){this.options=e||Oe,this.options.renderer=this.options.renderer||new Et,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new mi}static parse(e,t){return new Vt(t).parse(e)}static parseInline(e,t){return new Vt(t).parseInline(e)}parse(e,t=!0){let i="";for(let s=0;s<e.length;s++){const r=e[s];if(this.options.extensions?.renderers?.[r.type]){const a=r,l=this.options.extensions.renderers[a.type].call({parser:this},a);if(l!==!1||!["space","hr","heading","code","table","blockquote","list","html","paragraph","text"].includes(a.type)){i+=l||"";continue}}const o=r;switch(o.type){case"space":{i+=this.renderer.space(o);continue}case"hr":{i+=this.renderer.hr(o);continue}case"heading":{i+=this.renderer.heading(o);continue}case"code":{i+=this.renderer.code(o);continue}case"table":{i+=this.renderer.table(o);continue}case"blockquote":{i+=this.renderer.blockquote(o);continue}case"list":{i+=this.renderer.list(o);continue}case"html":{i+=this.renderer.html(o);continue}case"paragraph":{i+=this.renderer.paragraph(o);continue}case"text":{let a=o,l=this.renderer.text(a);for(;s+1<e.length&&e[s+1].type==="text";)a=e[++s],l+=`
`+this.renderer.text(a);t?i+=this.renderer.paragraph({type:"paragraph",raw:l,text:l,tokens:[{type:"text",raw:l,text:l,escaped:!0}]}):i+=l;continue}default:{const a='Token with "'+o.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return i}parseInline(e,t=this.renderer){let i="";for(let s=0;s<e.length;s++){const r=e[s];if(this.options.extensions?.renderers?.[r.type]){const a=this.options.extensions.renderers[r.type].call({parser:this},r);if(a!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(r.type)){i+=a||"";continue}}const o=r;switch(o.type){case"escape":{i+=t.text(o);break}case"html":{i+=t.html(o);break}case"link":{i+=t.link(o);break}case"image":{i+=t.image(o);break}case"strong":{i+=t.strong(o);break}case"em":{i+=t.em(o);break}case"codespan":{i+=t.codespan(o);break}case"br":{i+=t.br(o);break}case"del":{i+=t.del(o);break}case"text":{i+=t.text(o);break}default:{const a='Token with "'+o.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return i}},vt=class{options;block;constructor(n){this.options=n||Oe}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(n){return n}postprocess(n){return n}processAllTokens(n){return n}provideLexer(){return this.block?xe.lex:xe.lexInline}provideParser(){return this.block?ye.parse:ye.parseInline}},Rs=class{defaults=li();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=ye;Renderer=Et;TextRenderer=mi;Lexer=xe;Tokenizer=kt;Hooks=vt;constructor(...n){this.use(...n)}walkTokens(n,e){let t=[];for(const i of n)switch(t=t.concat(e.call(this,i)),i.type){case"table":{const s=i;for(const r of s.header)t=t.concat(this.walkTokens(r.tokens,e));for(const r of s.rows)for(const o of r)t=t.concat(this.walkTokens(o.tokens,e));break}case"list":{const s=i;t=t.concat(this.walkTokens(s.items,e));break}default:{const s=i;this.defaults.extensions?.childTokens?.[s.type]?this.defaults.extensions.childTokens[s.type].forEach(r=>{const o=s[r].flat(1/0);t=t.concat(this.walkTokens(o,e))}):s.tokens&&(t=t.concat(this.walkTokens(s.tokens,e)))}}return t}use(...n){const e=this.defaults.extensions||{renderers:{},childTokens:{}};return n.forEach(t=>{const i={...t};if(i.async=this.defaults.async||i.async||!1,t.extensions&&(t.extensions.forEach(s=>{if(!s.name)throw new Error("extension name required");if("renderer"in s){const r=e.renderers[s.name];r?e.renderers[s.name]=function(...o){let a=s.renderer.apply(this,o);return a===!1&&(a=r.apply(this,o)),a}:e.renderers[s.name]=s.renderer}if("tokenizer"in s){if(!s.level||s.level!=="block"&&s.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");const r=e[s.level];r?r.unshift(s.tokenizer):e[s.level]=[s.tokenizer],s.start&&(s.level==="block"?e.startBlock?e.startBlock.push(s.start):e.startBlock=[s.start]:s.level==="inline"&&(e.startInline?e.startInline.push(s.start):e.startInline=[s.start]))}"childTokens"in s&&s.childTokens&&(e.childTokens[s.name]=s.childTokens)}),i.extensions=e),t.renderer){const s=this.defaults.renderer||new Et(this.defaults);for(const r in t.renderer){if(!(r in s))throw new Error(`renderer '${r}' does not exist`);if(["options","parser"].includes(r))continue;const o=r,a=t.renderer[o],l=s[o];s[o]=(...c)=>{let p=a.apply(s,c);return p===!1&&(p=l.apply(s,c)),p||""}}i.renderer=s}if(t.tokenizer){const s=this.defaults.tokenizer||new kt(this.defaults);for(const r in t.tokenizer){if(!(r in s))throw new Error(`tokenizer '${r}' does not exist`);if(["options","rules","lexer"].includes(r))continue;const o=r,a=t.tokenizer[o],l=s[o];s[o]=(...c)=>{let p=a.apply(s,c);return p===!1&&(p=l.apply(s,c)),p}}i.tokenizer=s}if(t.hooks){const s=this.defaults.hooks||new vt;for(const r in t.hooks){if(!(r in s))throw new Error(`hook '${r}' does not exist`);if(["options","block"].includes(r))continue;const o=r,a=t.hooks[o],l=s[o];vt.passThroughHooks.has(r)?s[o]=c=>{if(this.defaults.async)return Promise.resolve(a.call(s,c)).then(u=>l.call(s,u));const p=a.call(s,c);return l.call(s,p)}:s[o]=(...c)=>{let p=a.apply(s,c);return p===!1&&(p=l.apply(s,c)),p}}i.hooks=s}if(t.walkTokens){const s=this.defaults.walkTokens,r=t.walkTokens;i.walkTokens=function(o){let a=[];return a.push(r.call(this,o)),s&&(a=a.concat(s.call(this,o))),a}}this.defaults={...this.defaults,...i}}),this}setOptions(n){return this.defaults={...this.defaults,...n},this}lexer(n,e){return xe.lex(n,e??this.defaults)}parser(n,e){return ye.parse(n,e??this.defaults)}parseMarkdown(n){return(t,i)=>{const s={...i},r={...this.defaults,...s},o=this.onError(!!r.silent,!!r.async);if(this.defaults.async===!0&&s.async===!1)return o(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof t>"u"||t===null)return o(new Error("marked(): input parameter is undefined or null"));if(typeof t!="string")return o(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(t)+", string expected"));r.hooks&&(r.hooks.options=r,r.hooks.block=n);const a=r.hooks?r.hooks.provideLexer():n?xe.lex:xe.lexInline,l=r.hooks?r.hooks.provideParser():n?ye.parse:ye.parseInline;if(r.async)return Promise.resolve(r.hooks?r.hooks.preprocess(t):t).then(c=>a(c,r)).then(c=>r.hooks?r.hooks.processAllTokens(c):c).then(c=>r.walkTokens?Promise.all(this.walkTokens(c,r.walkTokens)).then(()=>c):c).then(c=>l(c,r)).then(c=>r.hooks?r.hooks.postprocess(c):c).catch(o);try{r.hooks&&(t=r.hooks.preprocess(t));let c=a(t,r);r.hooks&&(c=r.hooks.processAllTokens(c)),r.walkTokens&&this.walkTokens(c,r.walkTokens);let p=l(c,r);return r.hooks&&(p=r.hooks.postprocess(p)),p}catch(c){return o(c)}}}onError(n,e){return t=>{if(t.message+=`
Please report this to https://github.com/markedjs/marked.`,n){const i="<p>An error occurred:</p><pre>"+ue(t.message+"",!0)+"</pre>";return e?Promise.resolve(i):i}if(e)return Promise.reject(t);throw t}}},Le=new Rs;function F(n,e){return Le.parse(n,e)}F.options=F.setOptions=function(n){return Le.setOptions(n),F.defaults=Le.defaults,_s(F.defaults),F};F.getDefaults=li;F.defaults=Oe;F.use=function(...n){return Le.use(...n),F.defaults=Le.defaults,_s(F.defaults),F};F.walkTokens=function(n,e){return Le.walkTokens(n,e)};F.parseInline=Le.parseInline;F.Parser=ye;F.parser=ye.parse;F.Renderer=Et;F.TextRenderer=mi;F.Lexer=xe;F.lexer=xe.lex;F.Tokenizer=kt;F.Hooks=vt;F.parse=F;F.options;F.setOptions;F.use;F.walkTokens;F.parseInline;ye.parse;xe.lex;function Jr(n){return n&&n.__esModule&&Object.prototype.hasOwnProperty.call(n,"default")?n.default:n}var Ht,Qi;function eo(){if(Qi)return Ht;Qi=1;function n(d){return d instanceof Map?d.clear=d.delete=d.set=function(){throw new Error("map is read-only")}:d instanceof Set&&(d.add=d.clear=d.delete=function(){throw new Error("set is read-only")}),Object.freeze(d),Object.getOwnPropertyNames(d).forEach(f=>{const x=d[f],R=typeof x;(R==="object"||R==="function")&&!Object.isFrozen(x)&&n(x)}),d}class e{constructor(f){f.data===void 0&&(f.data={}),this.data=f.data,this.isMatchIgnored=!1}ignoreMatch(){this.isMatchIgnored=!0}}function t(d){return d.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;")}function i(d,...f){const x=Object.create(null);for(const R in d)x[R]=d[R];return f.forEach(function(R){for(const K in R)x[K]=R[K]}),x}const s="</span>",r=d=>!!d.scope,o=(d,{prefix:f})=>{if(d.startsWith("language:"))return d.replace("language:","language-");if(d.includes(".")){const x=d.split(".");return[`${f}${x.shift()}`,...x.map((R,K)=>`${R}${"_".repeat(K+1)}`)].join(" ")}return`${f}${d}`};class a{constructor(f,x){this.buffer="",this.classPrefix=x.classPrefix,f.walk(this)}addText(f){this.buffer+=t(f)}openNode(f){if(!r(f))return;const x=o(f.scope,{prefix:this.classPrefix});this.span(x)}closeNode(f){r(f)&&(this.buffer+=s)}value(){return this.buffer}span(f){this.buffer+=`<span class="${f}">`}}const l=(d={})=>{const f={children:[]};return Object.assign(f,d),f};class c{constructor(){this.rootNode=l(),this.stack=[this.rootNode]}get top(){return this.stack[this.stack.length-1]}get root(){return this.rootNode}add(f){this.top.children.push(f)}openNode(f){const x=l({scope:f});this.add(x),this.stack.push(x)}closeNode(){if(this.stack.length>1)return this.stack.pop()}closeAllNodes(){for(;this.closeNode(););}toJSON(){return JSON.stringify(this.rootNode,null,4)}walk(f){return this.constructor._walk(f,this.rootNode)}static _walk(f,x){return typeof x=="string"?f.addText(x):x.children&&(f.openNode(x),x.children.forEach(R=>this._walk(f,R)),f.closeNode(x)),f}static _collapse(f){typeof f!="string"&&f.children&&(f.children.every(x=>typeof x=="string")?f.children=[f.children.join("")]:f.children.forEach(x=>{c._collapse(x)}))}}class p extends c{constructor(f){super(),this.options=f}addText(f){f!==""&&this.add(f)}startScope(f){this.openNode(f)}endScope(){this.closeNode()}__addSublanguage(f,x){const R=f.root;x&&(R.scope=`language:${x}`),this.add(R)}toHTML(){return new a(this,this.options).value()}finalize(){return this.closeAllNodes(),!0}}function u(d){return d?typeof d=="string"?d:d.source:null}function g(d){return E("(?=",d,")")}function _(d){return E("(?:",d,")*")}function v(d){return E("(?:",d,")?")}function E(...d){return d.map(x=>u(x)).join("")}function M(d){const f=d[d.length-1];return typeof f=="object"&&f.constructor===Object?(d.splice(d.length-1,1),f):{}}function I(...d){return"("+(M(d).capture?"":"?:")+d.map(R=>u(R)).join("|")+")"}function P(d){return new RegExp(d.toString()+"|").exec("").length-1}function G(d,f){const x=d&&d.exec(f);return x&&x.index===0}const C=/\[(?:[^\\\]]|\\.)*\]|\(\??|\\([1-9][0-9]*)|\\./;function B(d,{joinWith:f}){let x=0;return d.map(R=>{x+=1;const K=x;let W=u(R),k="";for(;W.length>0;){const w=C.exec(W);if(!w){k+=W;break}k+=W.substring(0,w.index),W=W.substring(w.index+w[0].length),w[0][0]==="\\"&&w[1]?k+="\\"+String(Number(w[1])+K):(k+=w[0],w[0]==="("&&x++)}return k}).map(R=>`(${R})`).join(f)}const U=/\b\B/,V="[a-zA-Z]\\w*",ie="[a-zA-Z_]\\w*",ge="\\b\\d+(\\.\\d+)?",me="(-?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?|\\.\\d+)([eE][-+]?\\d+)?)",De="\\b(0b[01]+)",Ue="!|!=|!==|%|%=|&|&&|&=|\\*|\\*=|\\+|\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\?|\\[|\\{|\\(|\\^|\\^=|\\||\\|=|\\|\\||~",He=(d={})=>{const f=/^#![ ]*\//;return d.binary&&(d.begin=E(f,/.*\b/,d.binary,/\b.*/)),i({scope:"meta",begin:f,end:/$/,relevance:0,"on:begin":(x,R)=>{x.index!==0&&R.ignoreMatch()}},d)},be={begin:"\\\\[\\s\\S]",relevance:0},qe={scope:"string",begin:"'",end:"'",illegal:"\\n",contains:[be]},$e={scope:"string",begin:'"',end:'"',illegal:"\\n",contains:[be]},Ge={begin:/\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\b/},O=function(d,f,x={}){const R=i({scope:"comment",begin:d,end:f,contains:[]},x);R.contains.push({scope:"doctag",begin:"[ ]*(?=(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):)",end:/(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):/,excludeBegin:!0,relevance:0});const K=I("I","a","is","so","us","to","at","if","in","it","on",/[A-Za-z]+['](d|ve|re|ll|t|s|n)/,/[A-Za-z]+[-][a-z]+/,/[A-Za-z][a-z]{2,}/);return R.contains.push({begin:E(/[ ]+/,"(",K,/[.]?[:]?([.][ ]|[ ])/,"){3}")}),R},se=O("//","$"),re=O("/\\*","\\*/"),ce=O("#","$"),_e={scope:"number",begin:ge,relevance:0},Ce={scope:"number",begin:me,relevance:0},Ks={scope:"number",begin:De,relevance:0},Ws={scope:"regexp",begin:/\/(?=[^/\n]*\/)/,end:/\/[gimuy]*/,contains:[be,{begin:/\[/,end:/\]/,relevance:0,contains:[be]}]},Zs={scope:"title",begin:V,relevance:0},Vs={scope:"title",begin:ie,relevance:0},Xs={begin:"\\.\\s*"+ie,relevance:0};var at=Object.freeze({__proto__:null,APOS_STRING_MODE:qe,BACKSLASH_ESCAPE:be,BINARY_NUMBER_MODE:Ks,BINARY_NUMBER_RE:De,COMMENT:O,C_BLOCK_COMMENT_MODE:re,C_LINE_COMMENT_MODE:se,C_NUMBER_MODE:Ce,C_NUMBER_RE:me,END_SAME_AS_BEGIN:function(d){return Object.assign(d,{"on:begin":(f,x)=>{x.data._beginMatch=f[1]},"on:end":(f,x)=>{x.data._beginMatch!==f[1]&&x.ignoreMatch()}})},HASH_COMMENT_MODE:ce,IDENT_RE:V,MATCH_NOTHING_RE:U,METHOD_GUARD:Xs,NUMBER_MODE:_e,NUMBER_RE:ge,PHRASAL_WORDS_MODE:Ge,QUOTE_STRING_MODE:$e,REGEXP_MODE:Ws,RE_STARTERS_RE:Ue,SHEBANG:He,TITLE_MODE:Zs,UNDERSCORE_IDENT_RE:ie,UNDERSCORE_TITLE_MODE:Vs});function Ys(d,f){d.input[d.index-1]==="."&&f.ignoreMatch()}function Qs(d,f){d.className!==void 0&&(d.scope=d.className,delete d.className)}function Js(d,f){f&&d.beginKeywords&&(d.begin="\\b("+d.beginKeywords.split(" ").join("|")+")(?!\\.)(?=\\b|\\s)",d.__beforeBegin=Ys,d.keywords=d.keywords||d.beginKeywords,delete d.beginKeywords,d.relevance===void 0&&(d.relevance=0))}function en(d,f){Array.isArray(d.illegal)&&(d.illegal=I(...d.illegal))}function tn(d,f){if(d.match){if(d.begin||d.end)throw new Error("begin & end are not supported with match");d.begin=d.match,delete d.match}}function sn(d,f){d.relevance===void 0&&(d.relevance=1)}const nn=(d,f)=>{if(!d.beforeMatch)return;if(d.starts)throw new Error("beforeMatch cannot be used with starts");const x=Object.assign({},d);Object.keys(d).forEach(R=>{delete d[R]}),d.keywords=x.keywords,d.begin=E(x.beforeMatch,g(x.begin)),d.starts={relevance:0,contains:[Object.assign(x,{endsParent:!0})]},d.relevance=0,delete x.beforeMatch},rn=["of","and","for","in","not","or","if","then","parent","list","value"],on="keyword";function xi(d,f,x=on){const R=Object.create(null);return typeof d=="string"?K(x,d.split(" ")):Array.isArray(d)?K(x,d):Object.keys(d).forEach(function(W){Object.assign(R,xi(d[W],f,W))}),R;function K(W,k){f&&(k=k.map(w=>w.toLowerCase())),k.forEach(function(w){const T=w.split("|");R[T[0]]=[W,an(T[0],T[1])]})}}function an(d,f){return f?Number(f):ln(d)?0:1}function ln(d){return rn.includes(d.toLowerCase())}const yi={},Te=d=>{console.error(d)},wi=(d,...f)=>{console.log(`WARN: ${d}`,...f)},ze=(d,f)=>{yi[`${d}/${f}`]||(console.log(`Deprecated as of ${d}. ${f}`),yi[`${d}/${f}`]=!0)},lt=new Error;function ki(d,f,{key:x}){let R=0;const K=d[x],W={},k={};for(let w=1;w<=f.length;w++)k[w+R]=K[w],W[w+R]=!0,R+=P(f[w-1]);d[x]=k,d[x]._emit=W,d[x]._multi=!0}function cn(d){if(Array.isArray(d.begin)){if(d.skip||d.excludeBegin||d.returnBegin)throw Te("skip, excludeBegin, returnBegin not compatible with beginScope: {}"),lt;if(typeof d.beginScope!="object"||d.beginScope===null)throw Te("beginScope must be object"),lt;ki(d,d.begin,{key:"beginScope"}),d.begin=B(d.begin,{joinWith:""})}}function dn(d){if(Array.isArray(d.end)){if(d.skip||d.excludeEnd||d.returnEnd)throw Te("skip, excludeEnd, returnEnd not compatible with endScope: {}"),lt;if(typeof d.endScope!="object"||d.endScope===null)throw Te("endScope must be object"),lt;ki(d,d.end,{key:"endScope"}),d.end=B(d.end,{joinWith:""})}}function hn(d){d.scope&&typeof d.scope=="object"&&d.scope!==null&&(d.beginScope=d.scope,delete d.scope)}function pn(d){hn(d),typeof d.beginScope=="string"&&(d.beginScope={_wrap:d.beginScope}),typeof d.endScope=="string"&&(d.endScope={_wrap:d.endScope}),cn(d),dn(d)}function un(d){function f(k,w){return new RegExp(u(k),"m"+(d.case_insensitive?"i":"")+(d.unicodeRegex?"u":"")+(w?"g":""))}class x{constructor(){this.matchIndexes={},this.regexes=[],this.matchAt=1,this.position=0}addRule(w,T){T.position=this.position++,this.matchIndexes[this.matchAt]=T,this.regexes.push([T,w]),this.matchAt+=P(w)+1}compile(){this.regexes.length===0&&(this.exec=()=>null);const w=this.regexes.map(T=>T[1]);this.matcherRe=f(B(w,{joinWith:"|"}),!0),this.lastIndex=0}exec(w){this.matcherRe.lastIndex=this.lastIndex;const T=this.matcherRe.exec(w);if(!T)return null;const Q=T.findIndex((je,Lt)=>Lt>0&&je!==void 0),X=this.matchIndexes[Q];return T.splice(0,Q),Object.assign(T,X)}}class R{constructor(){this.rules=[],this.multiRegexes=[],this.count=0,this.lastIndex=0,this.regexIndex=0}getMatcher(w){if(this.multiRegexes[w])return this.multiRegexes[w];const T=new x;return this.rules.slice(w).forEach(([Q,X])=>T.addRule(Q,X)),T.compile(),this.multiRegexes[w]=T,T}resumingScanAtSamePosition(){return this.regexIndex!==0}considerAll(){this.regexIndex=0}addRule(w,T){this.rules.push([w,T]),T.type==="begin"&&this.count++}exec(w){const T=this.getMatcher(this.regexIndex);T.lastIndex=this.lastIndex;let Q=T.exec(w);if(this.resumingScanAtSamePosition()&&!(Q&&Q.index===this.lastIndex)){const X=this.getMatcher(0);X.lastIndex=this.lastIndex+1,Q=X.exec(w)}return Q&&(this.regexIndex+=Q.position+1,this.regexIndex===this.count&&this.considerAll()),Q}}function K(k){const w=new R;return k.contains.forEach(T=>w.addRule(T.begin,{rule:T,type:"begin"})),k.terminatorEnd&&w.addRule(k.terminatorEnd,{type:"end"}),k.illegal&&w.addRule(k.illegal,{type:"illegal"}),w}function W(k,w){const T=k;if(k.isCompiled)return T;[Qs,tn,pn,nn].forEach(X=>X(k,w)),d.compilerExtensions.forEach(X=>X(k,w)),k.__beforeBegin=null,[Js,en,sn].forEach(X=>X(k,w)),k.isCompiled=!0;let Q=null;return typeof k.keywords=="object"&&k.keywords.$pattern&&(k.keywords=Object.assign({},k.keywords),Q=k.keywords.$pattern,delete k.keywords.$pattern),Q=Q||/\w+/,k.keywords&&(k.keywords=xi(k.keywords,d.case_insensitive)),T.keywordPatternRe=f(Q,!0),w&&(k.begin||(k.begin=/\B|\b/),T.beginRe=f(T.begin),!k.end&&!k.endsWithParent&&(k.end=/\B|\b/),k.end&&(T.endRe=f(T.end)),T.terminatorEnd=u(T.end)||"",k.endsWithParent&&w.terminatorEnd&&(T.terminatorEnd+=(k.end?"|":"")+w.terminatorEnd)),k.illegal&&(T.illegalRe=f(k.illegal)),k.contains||(k.contains=[]),k.contains=[].concat(...k.contains.map(function(X){return fn(X==="self"?k:X)})),k.contains.forEach(function(X){W(X,T)}),k.starts&&W(k.starts,w),T.matcher=K(T),T}if(d.compilerExtensions||(d.compilerExtensions=[]),d.contains&&d.contains.includes("self"))throw new Error("ERR: contains `self` is not supported at the top-level of a language.  See documentation.");return d.classNameAliases=i(d.classNameAliases||{}),W(d)}function Ei(d){return d?d.endsWithParent||Ei(d.starts):!1}function fn(d){return d.variants&&!d.cachedVariants&&(d.cachedVariants=d.variants.map(function(f){return i(d,{variants:null},f)})),d.cachedVariants?d.cachedVariants:Ei(d)?i(d,{starts:d.starts?i(d.starts):null}):Object.isFrozen(d)?i(d):d}var gn="11.11.1";class mn extends Error{constructor(f,x){super(f),this.name="HTMLInjectionError",this.html=x}}const Nt=t,Si=i,$i=Symbol("nomatch"),bn=7,Ci=function(d){const f=Object.create(null),x=Object.create(null),R=[];let K=!0;const W="Could not find the language '{}', did you forget to load/include a language module?",k={disableAutodetect:!0,name:"Plain text",contains:[]};let w={ignoreUnescapedHTML:!1,throwUnescapedHTML:!1,noHighlightRe:/^(no-?highlight)$/i,languageDetectRe:/\blang(?:uage)?-([\w-]+)\b/i,classPrefix:"hljs-",cssSelector:"pre code",languages:null,__emitter:p};function T(m){return w.noHighlightRe.test(m)}function Q(m){let $=m.className+" ";$+=m.parentNode?m.parentNode.className:"";const L=w.languageDetectRe.exec($);if(L){const H=we(L[1]);return H||(wi(W.replace("{}",L[1])),wi("Falling back to no-highlight mode for this block.",m)),H?L[1]:"no-highlight"}return $.split(/\s+/).find(H=>T(H)||we(H))}function X(m,$,L){let H="",Y="";typeof $=="object"?(H=m,L=$.ignoreIllegals,Y=$.language):(ze("10.7.0","highlight(lang, code, ...args) has been deprecated."),ze("10.7.0",`Please use highlight(code, options) instead.
https://github.com/highlightjs/highlight.js/issues/2277`),Y=m,H=$),L===void 0&&(L=!0);const de={code:H,language:Y};dt("before:highlight",de);const ke=de.result?de.result:je(de.language,de.code,L);return ke.code=de.code,dt("after:highlight",ke),ke}function je(m,$,L,H){const Y=Object.create(null);function de(y,S){return y.keywords[S]}function ke(){if(!A.keywords){J.addText(q);return}let y=0;A.keywordPatternRe.lastIndex=0;let S=A.keywordPatternRe.exec(q),N="";for(;S;){N+=q.substring(y,S.index);const z=pe.case_insensitive?S[0].toLowerCase():S[0],ee=de(A,z);if(ee){const[ve,Ln]=ee;if(J.addText(N),N="",Y[z]=(Y[z]||0)+1,Y[z]<=bn&&(ut+=Ln),ve.startsWith("_"))N+=S[0];else{const On=pe.classNameAliases[ve]||ve;he(S[0],On)}}else N+=S[0];y=A.keywordPatternRe.lastIndex,S=A.keywordPatternRe.exec(q)}N+=q.substring(y),J.addText(N)}function ht(){if(q==="")return;let y=null;if(typeof A.subLanguage=="string"){if(!f[A.subLanguage]){J.addText(q);return}y=je(A.subLanguage,q,!0,Oi[A.subLanguage]),Oi[A.subLanguage]=y._top}else y=Ot(q,A.subLanguage.length?A.subLanguage:null);A.relevance>0&&(ut+=y.relevance),J.__addSublanguage(y._emitter,y.language)}function oe(){A.subLanguage!=null?ht():ke(),q=""}function he(y,S){y!==""&&(J.startScope(S),J.addText(y),J.endScope())}function Mi(y,S){let N=1;const z=S.length-1;for(;N<=z;){if(!y._emit[N]){N++;continue}const ee=pe.classNameAliases[y[N]]||y[N],ve=S[N];ee?he(ve,ee):(q=ve,ke(),q=""),N++}}function Ii(y,S){return y.scope&&typeof y.scope=="string"&&J.openNode(pe.classNameAliases[y.scope]||y.scope),y.beginScope&&(y.beginScope._wrap?(he(q,pe.classNameAliases[y.beginScope._wrap]||y.beginScope._wrap),q=""):y.beginScope._multi&&(Mi(y.beginScope,S),q="")),A=Object.create(y,{parent:{value:A}}),A}function Ni(y,S,N){let z=G(y.endRe,N);if(z){if(y["on:end"]){const ee=new e(y);y["on:end"](S,ee),ee.isMatchIgnored&&(z=!1)}if(z){for(;y.endsParent&&y.parent;)y=y.parent;return y}}if(y.endsWithParent)return Ni(y.parent,S,N)}function Rn(y){return A.matcher.regexIndex===0?(q+=y[0],1):(Ft=!0,0)}function An(y){const S=y[0],N=y.rule,z=new e(N),ee=[N.__beforeBegin,N["on:begin"]];for(const ve of ee)if(ve&&(ve(y,z),z.isMatchIgnored))return Rn(S);return N.skip?q+=S:(N.excludeBegin&&(q+=S),oe(),!N.returnBegin&&!N.excludeBegin&&(q=S)),Ii(N,y),N.returnBegin?0:S.length}function Mn(y){const S=y[0],N=$.substring(y.index),z=Ni(A,y,N);if(!z)return $i;const ee=A;A.endScope&&A.endScope._wrap?(oe(),he(S,A.endScope._wrap)):A.endScope&&A.endScope._multi?(oe(),Mi(A.endScope,y)):ee.skip?q+=S:(ee.returnEnd||ee.excludeEnd||(q+=S),oe(),ee.excludeEnd&&(q=S));do A.scope&&J.closeNode(),!A.skip&&!A.subLanguage&&(ut+=A.relevance),A=A.parent;while(A!==z.parent);return z.starts&&Ii(z.starts,y),ee.returnEnd?0:S.length}function In(){const y=[];for(let S=A;S!==pe;S=S.parent)S.scope&&y.unshift(S.scope);y.forEach(S=>J.openNode(S))}let pt={};function Li(y,S){const N=S&&S[0];if(q+=y,N==null)return oe(),0;if(pt.type==="begin"&&S.type==="end"&&pt.index===S.index&&N===""){if(q+=$.slice(S.index,S.index+1),!K){const z=new Error(`0 width match regex (${m})`);throw z.languageName=m,z.badRule=pt.rule,z}return 1}if(pt=S,S.type==="begin")return An(S);if(S.type==="illegal"&&!L){const z=new Error('Illegal lexeme "'+N+'" for mode "'+(A.scope||"<unnamed>")+'"');throw z.mode=A,z}else if(S.type==="end"){const z=Mn(S);if(z!==$i)return z}if(S.type==="illegal"&&N==="")return q+=`
`,1;if(Pt>1e5&&Pt>S.index*3)throw new Error("potential infinite loop, way more iterations than matches");return q+=N,N.length}const pe=we(m);if(!pe)throw Te(W.replace("{}",m)),new Error('Unknown language: "'+m+'"');const Nn=un(pe);let zt="",A=H||Nn;const Oi={},J=new w.__emitter(w);In();let q="",ut=0,Re=0,Pt=0,Ft=!1;try{if(pe.__emitTokens)pe.__emitTokens($,J);else{for(A.matcher.considerAll();;){Pt++,Ft?Ft=!1:A.matcher.considerAll(),A.matcher.lastIndex=Re;const y=A.matcher.exec($);if(!y)break;const S=$.substring(Re,y.index),N=Li(S,y);Re=y.index+N}Li($.substring(Re))}return J.finalize(),zt=J.toHTML(),{language:m,value:zt,relevance:ut,illegal:!1,_emitter:J,_top:A}}catch(y){if(y.message&&y.message.includes("Illegal"))return{language:m,value:Nt($),illegal:!0,relevance:0,_illegalBy:{message:y.message,index:Re,context:$.slice(Re-100,Re+100),mode:y.mode,resultSoFar:zt},_emitter:J};if(K)return{language:m,value:Nt($),illegal:!1,relevance:0,errorRaised:y,_emitter:J,_top:A};throw y}}function Lt(m){const $={value:Nt(m),illegal:!1,relevance:0,_top:k,_emitter:new w.__emitter(w)};return $._emitter.addText(m),$}function Ot(m,$){$=$||w.languages||Object.keys(f);const L=Lt(m),H=$.filter(we).filter(Ai).map(oe=>je(oe,m,!1));H.unshift(L);const Y=H.sort((oe,he)=>{if(oe.relevance!==he.relevance)return he.relevance-oe.relevance;if(oe.language&&he.language){if(we(oe.language).supersetOf===he.language)return 1;if(we(he.language).supersetOf===oe.language)return-1}return 0}),[de,ke]=Y,ht=de;return ht.secondBest=ke,ht}function _n(m,$,L){const H=$&&x[$]||L;m.classList.add("hljs"),m.classList.add(`language-${H}`)}function Dt(m){let $=null;const L=Q(m);if(T(L))return;if(dt("before:highlightElement",{el:m,language:L}),m.dataset.highlighted){console.log("Element previously highlighted. To highlight again, first unset `dataset.highlighted`.",m);return}if(m.children.length>0&&(w.ignoreUnescapedHTML||(console.warn("One of your code blocks includes unescaped HTML. This is a potentially serious security risk."),console.warn("https://github.com/highlightjs/highlight.js/wiki/security"),console.warn("The element with unescaped HTML:"),console.warn(m)),w.throwUnescapedHTML))throw new mn("One of your code blocks includes unescaped HTML.",m.innerHTML);$=m;const H=$.textContent,Y=L?X(H,{language:L,ignoreIllegals:!0}):Ot(H);m.innerHTML=Y.value,m.dataset.highlighted="yes",_n(m,L,Y.language),m.result={language:Y.language,re:Y.relevance,relevance:Y.relevance},Y.secondBest&&(m.secondBest={language:Y.secondBest.language,relevance:Y.secondBest.relevance}),dt("after:highlightElement",{el:m,result:Y,text:H})}function vn(m){w=Si(w,m)}const xn=()=>{ct(),ze("10.6.0","initHighlighting() deprecated.  Use highlightAll() now.")};function yn(){ct(),ze("10.6.0","initHighlightingOnLoad() deprecated.  Use highlightAll() now.")}let Ti=!1;function ct(){function m(){ct()}if(document.readyState==="loading"){Ti||window.addEventListener("DOMContentLoaded",m,!1),Ti=!0;return}document.querySelectorAll(w.cssSelector).forEach(Dt)}function wn(m,$){let L=null;try{L=$(d)}catch(H){if(Te("Language definition for '{}' could not be registered.".replace("{}",m)),K)Te(H);else throw H;L=k}L.name||(L.name=m),f[m]=L,L.rawDefinition=$.bind(null,d),L.aliases&&Ri(L.aliases,{languageName:m})}function kn(m){delete f[m];for(const $ of Object.keys(x))x[$]===m&&delete x[$]}function En(){return Object.keys(f)}function we(m){return m=(m||"").toLowerCase(),f[m]||f[x[m]]}function Ri(m,{languageName:$}){typeof m=="string"&&(m=[m]),m.forEach(L=>{x[L.toLowerCase()]=$})}function Ai(m){const $=we(m);return $&&!$.disableAutodetect}function Sn(m){m["before:highlightBlock"]&&!m["before:highlightElement"]&&(m["before:highlightElement"]=$=>{m["before:highlightBlock"](Object.assign({block:$.el},$))}),m["after:highlightBlock"]&&!m["after:highlightElement"]&&(m["after:highlightElement"]=$=>{m["after:highlightBlock"](Object.assign({block:$.el},$))})}function $n(m){Sn(m),R.push(m)}function Cn(m){const $=R.indexOf(m);$!==-1&&R.splice($,1)}function dt(m,$){const L=m;R.forEach(function(H){H[L]&&H[L]($)})}function Tn(m){return ze("10.7.0","highlightBlock will be removed entirely in v12.0"),ze("10.7.0","Please use highlightElement now."),Dt(m)}Object.assign(d,{highlight:X,highlightAuto:Ot,highlightAll:ct,highlightElement:Dt,highlightBlock:Tn,configure:vn,initHighlighting:xn,initHighlightingOnLoad:yn,registerLanguage:wn,unregisterLanguage:kn,listLanguages:En,getLanguage:we,registerAliases:Ri,autoDetection:Ai,inherit:Si,addPlugin:$n,removePlugin:Cn}),d.debugMode=function(){K=!1},d.safeMode=function(){K=!0},d.versionString=gn,d.regex={concat:E,lookahead:g,either:I,optional:v,anyNumberOfTimes:_};for(const m in at)typeof at[m]=="object"&&n(at[m]);return Object.assign(d,at),d},Pe=Ci({});return Pe.newInstance=()=>Ci({}),Ht=Pe,Pe.HighlightJS=Pe,Pe.default=Pe,Ht}var to=eo();const j=Jr(to),Ji="[A-Za-z$_][0-9A-Za-z$_]*",io=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],so=["true","false","null","undefined","NaN","Infinity"],As=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],Ms=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],Is=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],no=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],ro=[].concat(Is,As,Ms);function Ns(n){const e=n.regex,t=(O,{after:se})=>{const re="</"+O[0].slice(1);return O.input.indexOf(re,se)!==-1},i=Ji,s={begin:"<>",end:"</>"},r=/<[A-Za-z0-9\\._:-]+\s*\/>/,o={begin:/<[A-Za-z0-9\\._:-]+/,end:/\/[A-Za-z0-9\\._:-]+>|\/>/,isTrulyOpeningTag:(O,se)=>{const re=O[0].length+O.index,ce=O.input[re];if(ce==="<"||ce===","){se.ignoreMatch();return}ce===">"&&(t(O,{after:re})||se.ignoreMatch());let _e;const Ce=O.input.substring(re);if(_e=Ce.match(/^\s*=/)){se.ignoreMatch();return}if((_e=Ce.match(/^\s+extends\s+/))&&_e.index===0){se.ignoreMatch();return}}},a={$pattern:Ji,keyword:io,literal:so,built_in:ro,"variable.language":no},l="[0-9](_?[0-9])*",c=`\\.(${l})`,p="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",u={className:"number",variants:[{begin:`(\\b(${p})((${c})|\\.)?|(${c}))[eE][+-]?(${l})\\b`},{begin:`\\b(${p})\\b((${c})\\b|\\.)?|(${c})\\b`},{begin:"\\b(0|[1-9](_?[0-9])*)n\\b"},{begin:"\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b"},{begin:"\\b0[bB][0-1](_?[0-1])*n?\\b"},{begin:"\\b0[oO][0-7](_?[0-7])*n?\\b"},{begin:"\\b0[0-7]+n?\\b"}],relevance:0},g={className:"subst",begin:"\\$\\{",end:"\\}",keywords:a,contains:[]},_={begin:".?html`",end:"",starts:{end:"`",returnEnd:!1,contains:[n.BACKSLASH_ESCAPE,g],subLanguage:"xml"}},v={begin:".?css`",end:"",starts:{end:"`",returnEnd:!1,contains:[n.BACKSLASH_ESCAPE,g],subLanguage:"css"}},E={begin:".?gql`",end:"",starts:{end:"`",returnEnd:!1,contains:[n.BACKSLASH_ESCAPE,g],subLanguage:"graphql"}},M={className:"string",begin:"`",end:"`",contains:[n.BACKSLASH_ESCAPE,g]},P={className:"comment",variants:[n.COMMENT(/\/\*\*(?!\/)/,"\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\{",end:"\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:i+"(?=\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\n])\s/,relevance:0}]}]}),n.C_BLOCK_COMMENT_MODE,n.C_LINE_COMMENT_MODE]},G=[n.APOS_STRING_MODE,n.QUOTE_STRING_MODE,_,v,E,M,{match:/\$\d+/},u];g.contains=G.concat({begin:/\{/,end:/\}/,keywords:a,contains:["self"].concat(G)});const C=[].concat(P,g.contains),B=C.concat([{begin:/(\s*)\(/,end:/\)/,keywords:a,contains:["self"].concat(C)}]),U={className:"params",begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:a,contains:B},V={variants:[{match:[/class/,/\s+/,i,/\s+/,/extends/,/\s+/,e.concat(i,"(",e.concat(/\./,i),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\s+/,i],scope:{1:"keyword",3:"title.class"}}]},ie={relevance:0,match:e.either(/\bJSON/,/\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,/\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,/\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...As,...Ms]}},ge={label:"use_strict",className:"meta",relevance:10,begin:/^\s*['"]use (strict|asm)['"]/},me={variants:[{match:[/function/,/\s+/,i,/(?=\s*\()/]},{match:[/function/,/\s*(?=\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[U],illegal:/%/},De={relevance:0,match:/\b[A-Z][A-Z_0-9]+\b/,className:"variable.constant"};function Ue(O){return e.concat("(?!",O.join("|"),")")}const He={match:e.concat(/\b/,Ue([...Is,"super","import"].map(O=>`${O}\\s*\\(`)),i,e.lookahead(/\s*\(/)),className:"title.function",relevance:0},be={begin:e.concat(/\./,e.lookahead(e.concat(i,/(?![0-9A-Za-z$_(])/))),end:i,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},qe={match:[/get|set/,/\s+/,i,/(?=\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\(\)/},U]},$e="(\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)|"+n.UNDERSCORE_IDENT_RE+")\\s*=>",Ge={match:[/const|var|let/,/\s+/,i,/\s*/,/=\s*/,/(async\s*)?/,e.lookahead($e)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[U]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:a,exports:{PARAMS_CONTAINS:B,CLASS_REFERENCE:ie},illegal:/#(?![$_A-z])/,contains:[n.SHEBANG({label:"shebang",binary:"node",relevance:5}),ge,n.APOS_STRING_MODE,n.QUOTE_STRING_MODE,_,v,E,M,P,{match:/\$\d+/},u,ie,{scope:"attr",match:i+e.lookahead(":"),relevance:0},Ge,{begin:"("+n.RE_STARTERS_RE+"|\\b(case|return|throw)\\b)\\s*",keywords:"return throw case",relevance:0,contains:[P,n.REGEXP_MODE,{className:"function",begin:$e,returnBegin:!0,end:"\\s*=>",contains:[{className:"params",variants:[{begin:n.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\(\s*\)/,skip:!0},{begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:a,contains:B}]}]},{begin:/,/,relevance:0},{match:/\s+/,relevance:0},{variants:[{begin:s.begin,end:s.end},{match:r},{begin:o.begin,"on:begin":o.isTrulyOpeningTag,end:o.end}],subLanguage:"xml",contains:[{begin:o.begin,end:o.end,skip:!0,contains:["self"]}]}]},me,{beginKeywords:"while if switch catch for"},{begin:"\\b(?!function)"+n.UNDERSCORE_IDENT_RE+"\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)\\s*\\{",returnBegin:!0,label:"func.def",contains:[U,n.inherit(n.TITLE_MODE,{begin:i,className:"title.function"})]},{match:/\.\.\./,relevance:0},be,{match:"\\$"+i,relevance:0},{match:[/\bconstructor(?=\s*\()/],className:{1:"title.function"},contains:[U]},He,De,V,qe,{match:/\$[(.]/}]}}function Ls(n){const e=n.regex,t=/[\p{XID_Start}_]\p{XID_Continue}*/u,i=["and","as","assert","async","await","break","case","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","match","nonlocal|10","not","or","pass","raise","return","try","while","with","yield"],a={$pattern:/[A-Za-z]\w+|__\w+__/,keyword:i,built_in:["__import__","abs","all","any","ascii","bin","bool","breakpoint","bytearray","bytes","callable","chr","classmethod","compile","complex","delattr","dict","dir","divmod","enumerate","eval","exec","filter","float","format","frozenset","getattr","globals","hasattr","hash","help","hex","id","input","int","isinstance","issubclass","iter","len","list","locals","map","max","memoryview","min","next","object","oct","open","ord","pow","print","property","range","repr","reversed","round","set","setattr","slice","sorted","staticmethod","str","sum","super","tuple","type","vars","zip"],literal:["__debug__","Ellipsis","False","None","NotImplemented","True"],type:["Any","Callable","Coroutine","Dict","List","Literal","Generic","Optional","Sequence","Set","Tuple","Type","Union"]},l={className:"meta",begin:/^(>>>|\.\.\.) /},c={className:"subst",begin:/\{/,end:/\}/,keywords:a,illegal:/#/},p={begin:/\{\{/,relevance:0},u={className:"string",contains:[n.BACKSLASH_ESCAPE],variants:[{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?'''/,end:/'''/,contains:[n.BACKSLASH_ESCAPE,l],relevance:10},{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?"""/,end:/"""/,contains:[n.BACKSLASH_ESCAPE,l],relevance:10},{begin:/([fF][rR]|[rR][fF]|[fF])'''/,end:/'''/,contains:[n.BACKSLASH_ESCAPE,l,p,c]},{begin:/([fF][rR]|[rR][fF]|[fF])"""/,end:/"""/,contains:[n.BACKSLASH_ESCAPE,l,p,c]},{begin:/([uU]|[rR])'/,end:/'/,relevance:10},{begin:/([uU]|[rR])"/,end:/"/,relevance:10},{begin:/([bB]|[bB][rR]|[rR][bB])'/,end:/'/},{begin:/([bB]|[bB][rR]|[rR][bB])"/,end:/"/},{begin:/([fF][rR]|[rR][fF]|[fF])'/,end:/'/,contains:[n.BACKSLASH_ESCAPE,p,c]},{begin:/([fF][rR]|[rR][fF]|[fF])"/,end:/"/,contains:[n.BACKSLASH_ESCAPE,p,c]},n.APOS_STRING_MODE,n.QUOTE_STRING_MODE]},g="[0-9](_?[0-9])*",_=`(\\b(${g}))?\\.(${g})|\\b(${g})\\.`,v=`\\b|${i.join("|")}`,E={className:"number",relevance:0,variants:[{begin:`(\\b(${g})|(${_}))[eE][+-]?(${g})[jJ]?(?=${v})`},{begin:`(${_})[jJ]?`},{begin:`\\b([1-9](_?[0-9])*|0+(_?0)*)[lLjJ]?(?=${v})`},{begin:`\\b0[bB](_?[01])+[lL]?(?=${v})`},{begin:`\\b0[oO](_?[0-7])+[lL]?(?=${v})`},{begin:`\\b0[xX](_?[0-9a-fA-F])+[lL]?(?=${v})`},{begin:`\\b(${g})[jJ](?=${v})`}]},M={className:"comment",begin:e.lookahead(/# type:/),end:/$/,keywords:a,contains:[{begin:/# type:/},{begin:/#/,end:/\b\B/,endsWithParent:!0}]},I={className:"params",variants:[{className:"",begin:/\(\s*\)/,skip:!0},{begin:/\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:a,contains:["self",l,E,u,n.HASH_COMMENT_MODE]}]};return c.contains=[u,E,l],{name:"Python",aliases:["py","gyp","ipython"],unicodeRegex:!0,keywords:a,illegal:/(<\/|\?)|=>/,contains:[l,E,{scope:"variable.language",match:/\bself\b/},{beginKeywords:"if",relevance:0},{match:/\bor\b/,scope:"keyword"},u,M,n.HASH_COMMENT_MODE,{match:[/\bdef/,/\s+/,t],scope:{1:"keyword",3:"title.function"},contains:[I]},{variants:[{match:[/\bclass/,/\s+/,t,/\s*/,/\(\s*/,t,/\s*\)/]},{match:[/\bclass/,/\s+/,t]}],scope:{1:"keyword",3:"title.class",6:"title.class.inherited"}},{className:"meta",begin:/^[\t ]*@/,end:/(?=#)|$/,contains:[E,I,u]}]}}const St="[A-Za-z$_][0-9A-Za-z$_]*",Os=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],Ds=["true","false","null","undefined","NaN","Infinity"],zs=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],Ps=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],Fs=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],Bs=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],Us=[].concat(Fs,zs,Ps);function oo(n){const e=n.regex,t=(O,{after:se})=>{const re="</"+O[0].slice(1);return O.input.indexOf(re,se)!==-1},i=St,s={begin:"<>",end:"</>"},r=/<[A-Za-z0-9\\._:-]+\s*\/>/,o={begin:/<[A-Za-z0-9\\._:-]+/,end:/\/[A-Za-z0-9\\._:-]+>|\/>/,isTrulyOpeningTag:(O,se)=>{const re=O[0].length+O.index,ce=O.input[re];if(ce==="<"||ce===","){se.ignoreMatch();return}ce===">"&&(t(O,{after:re})||se.ignoreMatch());let _e;const Ce=O.input.substring(re);if(_e=Ce.match(/^\s*=/)){se.ignoreMatch();return}if((_e=Ce.match(/^\s+extends\s+/))&&_e.index===0){se.ignoreMatch();return}}},a={$pattern:St,keyword:Os,literal:Ds,built_in:Us,"variable.language":Bs},l="[0-9](_?[0-9])*",c=`\\.(${l})`,p="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",u={className:"number",variants:[{begin:`(\\b(${p})((${c})|\\.)?|(${c}))[eE][+-]?(${l})\\b`},{begin:`\\b(${p})\\b((${c})\\b|\\.)?|(${c})\\b`},{begin:"\\b(0|[1-9](_?[0-9])*)n\\b"},{begin:"\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b"},{begin:"\\b0[bB][0-1](_?[0-1])*n?\\b"},{begin:"\\b0[oO][0-7](_?[0-7])*n?\\b"},{begin:"\\b0[0-7]+n?\\b"}],relevance:0},g={className:"subst",begin:"\\$\\{",end:"\\}",keywords:a,contains:[]},_={begin:".?html`",end:"",starts:{end:"`",returnEnd:!1,contains:[n.BACKSLASH_ESCAPE,g],subLanguage:"xml"}},v={begin:".?css`",end:"",starts:{end:"`",returnEnd:!1,contains:[n.BACKSLASH_ESCAPE,g],subLanguage:"css"}},E={begin:".?gql`",end:"",starts:{end:"`",returnEnd:!1,contains:[n.BACKSLASH_ESCAPE,g],subLanguage:"graphql"}},M={className:"string",begin:"`",end:"`",contains:[n.BACKSLASH_ESCAPE,g]},P={className:"comment",variants:[n.COMMENT(/\/\*\*(?!\/)/,"\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\{",end:"\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:i+"(?=\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\n])\s/,relevance:0}]}]}),n.C_BLOCK_COMMENT_MODE,n.C_LINE_COMMENT_MODE]},G=[n.APOS_STRING_MODE,n.QUOTE_STRING_MODE,_,v,E,M,{match:/\$\d+/},u];g.contains=G.concat({begin:/\{/,end:/\}/,keywords:a,contains:["self"].concat(G)});const C=[].concat(P,g.contains),B=C.concat([{begin:/(\s*)\(/,end:/\)/,keywords:a,contains:["self"].concat(C)}]),U={className:"params",begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:a,contains:B},V={variants:[{match:[/class/,/\s+/,i,/\s+/,/extends/,/\s+/,e.concat(i,"(",e.concat(/\./,i),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\s+/,i],scope:{1:"keyword",3:"title.class"}}]},ie={relevance:0,match:e.either(/\bJSON/,/\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,/\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,/\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...zs,...Ps]}},ge={label:"use_strict",className:"meta",relevance:10,begin:/^\s*['"]use (strict|asm)['"]/},me={variants:[{match:[/function/,/\s+/,i,/(?=\s*\()/]},{match:[/function/,/\s*(?=\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[U],illegal:/%/},De={relevance:0,match:/\b[A-Z][A-Z_0-9]+\b/,className:"variable.constant"};function Ue(O){return e.concat("(?!",O.join("|"),")")}const He={match:e.concat(/\b/,Ue([...Fs,"super","import"].map(O=>`${O}\\s*\\(`)),i,e.lookahead(/\s*\(/)),className:"title.function",relevance:0},be={begin:e.concat(/\./,e.lookahead(e.concat(i,/(?![0-9A-Za-z$_(])/))),end:i,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},qe={match:[/get|set/,/\s+/,i,/(?=\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\(\)/},U]},$e="(\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)|"+n.UNDERSCORE_IDENT_RE+")\\s*=>",Ge={match:[/const|var|let/,/\s+/,i,/\s*/,/=\s*/,/(async\s*)?/,e.lookahead($e)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[U]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:a,exports:{PARAMS_CONTAINS:B,CLASS_REFERENCE:ie},illegal:/#(?![$_A-z])/,contains:[n.SHEBANG({label:"shebang",binary:"node",relevance:5}),ge,n.APOS_STRING_MODE,n.QUOTE_STRING_MODE,_,v,E,M,P,{match:/\$\d+/},u,ie,{scope:"attr",match:i+e.lookahead(":"),relevance:0},Ge,{begin:"("+n.RE_STARTERS_RE+"|\\b(case|return|throw)\\b)\\s*",keywords:"return throw case",relevance:0,contains:[P,n.REGEXP_MODE,{className:"function",begin:$e,returnBegin:!0,end:"\\s*=>",contains:[{className:"params",variants:[{begin:n.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\(\s*\)/,skip:!0},{begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:a,contains:B}]}]},{begin:/,/,relevance:0},{match:/\s+/,relevance:0},{variants:[{begin:s.begin,end:s.end},{match:r},{begin:o.begin,"on:begin":o.isTrulyOpeningTag,end:o.end}],subLanguage:"xml",contains:[{begin:o.begin,end:o.end,skip:!0,contains:["self"]}]}]},me,{beginKeywords:"while if switch catch for"},{begin:"\\b(?!function)"+n.UNDERSCORE_IDENT_RE+"\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)\\s*\\{",returnBegin:!0,label:"func.def",contains:[U,n.inherit(n.TITLE_MODE,{begin:i,className:"title.function"})]},{match:/\.\.\./,relevance:0},be,{match:"\\$"+i,relevance:0},{match:[/\bconstructor(?=\s*\()/],className:{1:"title.function"},contains:[U]},He,De,V,qe,{match:/\$[(.]/}]}}function Hs(n){const e=n.regex,t=oo(n),i=St,s=["any","void","number","boolean","string","object","never","symbol","bigint","unknown"],r={begin:[/namespace/,/\s+/,n.IDENT_RE],beginScope:{1:"keyword",3:"title.class"}},o={beginKeywords:"interface",end:/\{/,excludeEnd:!0,keywords:{keyword:"interface extends",built_in:s},contains:[t.exports.CLASS_REFERENCE]},a={className:"meta",relevance:10,begin:/^\s*['"]use strict['"]/},l=["type","interface","public","private","protected","implements","declare","abstract","readonly","enum","override","satisfies"],c={$pattern:St,keyword:Os.concat(l),literal:Ds,built_in:Us.concat(s),"variable.language":Bs},p={className:"meta",begin:"@"+i},u=(E,M,I)=>{const P=E.contains.findIndex(G=>G.label===M);if(P===-1)throw new Error("can not find mode to replace");E.contains.splice(P,1,I)};Object.assign(t.keywords,c),t.exports.PARAMS_CONTAINS.push(p);const g=t.contains.find(E=>E.scope==="attr"),_=Object.assign({},g,{match:e.concat(i,e.lookahead(/\s*\?:/))});t.exports.PARAMS_CONTAINS.push([t.exports.CLASS_REFERENCE,g,_]),t.contains=t.contains.concat([p,r,o,_]),u(t,"shebang",n.SHEBANG()),u(t,"use_strict",a);const v=t.contains.find(E=>E.label==="func.def");return v.relevance=0,Object.assign(t,{name:"TypeScript",aliases:["ts","tsx","mts","cts"]}),t}function ao(n){const e={className:"attr",begin:/"(\\.|[^\\"\r\n])*"(?=\s*:)/,relevance:1.01},t={match:/[{}[\],:]/,className:"punctuation",relevance:0},i=["true","false","null"],s={scope:"literal",beginKeywords:i.join(" ")};return{name:"JSON",aliases:["jsonc"],keywords:{literal:i},contains:[e,t,n.QUOTE_STRING_MODE,s,n.C_NUMBER_MODE,n.C_LINE_COMMENT_MODE,n.C_BLOCK_COMMENT_MODE],illegal:"\\S"}}function bi(n){const e=n.regex,t={},i={begin:/\$\{/,end:/\}/,contains:["self",{begin:/:-/,contains:[t]}]};Object.assign(t,{className:"variable",variants:[{begin:e.concat(/\$[\w\d#@][\w\d_]*/,"(?![\\w\\d])(?![$])")},i]});const s={className:"subst",begin:/\$\(/,end:/\)/,contains:[n.BACKSLASH_ESCAPE]},r=n.inherit(n.COMMENT(),{match:[/(^|\s)/,/#.*$/],scope:{2:"comment"}}),o={begin:/<<-?\s*(?=\w+)/,starts:{contains:[n.END_SAME_AS_BEGIN({begin:/(\w+)/,end:/(\w+)/,className:"string"})]}},a={className:"string",begin:/"/,end:/"/,contains:[n.BACKSLASH_ESCAPE,t,s]};s.contains.push(a);const l={match:/\\"/},c={className:"string",begin:/'/,end:/'/},p={match:/\\'/},u={begin:/\$?\(\(/,end:/\)\)/,contains:[{begin:/\d+#[0-9a-f]+/,className:"number"},n.NUMBER_MODE,t]},g=["fish","bash","zsh","sh","csh","ksh","tcsh","dash","scsh"],_=n.SHEBANG({binary:`(${g.join("|")})`,relevance:10}),v={className:"function",begin:/\w[\w\d_]*\s*\(\s*\)\s*\{/,returnBegin:!0,contains:[n.inherit(n.TITLE_MODE,{begin:/\w[\w\d_]*/})],relevance:0},E=["if","then","else","elif","fi","time","for","while","until","in","do","done","case","esac","coproc","function","select"],M=["true","false"],I={match:/(\/[a-z._-]+)+/},P=["break","cd","continue","eval","exec","exit","export","getopts","hash","pwd","readonly","return","shift","test","times","trap","umask","unset"],G=["alias","bind","builtin","caller","command","declare","echo","enable","help","let","local","logout","mapfile","printf","read","readarray","source","sudo","type","typeset","ulimit","unalias"],C=["autoload","bg","bindkey","bye","cap","chdir","clone","comparguments","compcall","compctl","compdescribe","compfiles","compgroups","compquote","comptags","comptry","compvalues","dirs","disable","disown","echotc","echoti","emulate","fc","fg","float","functions","getcap","getln","history","integer","jobs","kill","limit","log","noglob","popd","print","pushd","pushln","rehash","sched","setcap","setopt","stat","suspend","ttyctl","unfunction","unhash","unlimit","unsetopt","vared","wait","whence","where","which","zcompile","zformat","zftp","zle","zmodload","zparseopts","zprof","zpty","zregexparse","zsocket","zstyle","ztcp"],B=["chcon","chgrp","chown","chmod","cp","dd","df","dir","dircolors","ln","ls","mkdir","mkfifo","mknod","mktemp","mv","realpath","rm","rmdir","shred","sync","touch","truncate","vdir","b2sum","base32","base64","cat","cksum","comm","csplit","cut","expand","fmt","fold","head","join","md5sum","nl","numfmt","od","paste","ptx","pr","sha1sum","sha224sum","sha256sum","sha384sum","sha512sum","shuf","sort","split","sum","tac","tail","tr","tsort","unexpand","uniq","wc","arch","basename","chroot","date","dirname","du","echo","env","expr","factor","groups","hostid","id","link","logname","nice","nohup","nproc","pathchk","pinky","printenv","printf","pwd","readlink","runcon","seq","sleep","stat","stdbuf","stty","tee","test","timeout","tty","uname","unlink","uptime","users","who","whoami","yes"];return{name:"Bash",aliases:["sh","zsh"],keywords:{$pattern:/\b[a-z][a-z0-9._-]+\b/,keyword:E,literal:M,built_in:[...P,...G,"set","shopt",...C,...B]},contains:[_,n.SHEBANG(),v,u,r,o,I,a,l,c,p,t]}}const lo=n=>({IMPORTANT:{scope:"meta",begin:"!important"},BLOCK_COMMENT:n.C_BLOCK_COMMENT_MODE,HEXCOLOR:{scope:"number",begin:/#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\b/},FUNCTION_DISPATCH:{className:"built_in",begin:/[\w-]+(?=\()/},ATTRIBUTE_SELECTOR_MODE:{scope:"selector-attr",begin:/\[/,end:/\]/,illegal:"$",contains:[n.APOS_STRING_MODE,n.QUOTE_STRING_MODE]},CSS_NUMBER_MODE:{scope:"number",begin:n.NUMBER_RE+"(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?",relevance:0},CSS_VARIABLE:{className:"attr",begin:/--[A-Za-z_][A-Za-z0-9_-]*/}}),co=["a","abbr","address","article","aside","audio","b","blockquote","body","button","canvas","caption","cite","code","dd","del","details","dfn","div","dl","dt","em","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","header","hgroup","html","i","iframe","img","input","ins","kbd","label","legend","li","main","mark","menu","nav","object","ol","optgroup","option","p","picture","q","quote","samp","section","select","source","span","strong","summary","sup","table","tbody","td","textarea","tfoot","th","thead","time","tr","ul","var","video"],ho=["defs","g","marker","mask","pattern","svg","switch","symbol","feBlend","feColorMatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feFlood","feGaussianBlur","feImage","feMerge","feMorphology","feOffset","feSpecularLighting","feTile","feTurbulence","linearGradient","radialGradient","stop","circle","ellipse","image","line","path","polygon","polyline","rect","text","use","textPath","tspan","foreignObject","clipPath"],po=[...co,...ho],uo=["any-hover","any-pointer","aspect-ratio","color","color-gamut","color-index","device-aspect-ratio","device-height","device-width","display-mode","forced-colors","grid","height","hover","inverted-colors","monochrome","orientation","overflow-block","overflow-inline","pointer","prefers-color-scheme","prefers-contrast","prefers-reduced-motion","prefers-reduced-transparency","resolution","scan","scripting","update","width","min-width","max-width","min-height","max-height"].sort().reverse(),fo=["active","any-link","blank","checked","current","default","defined","dir","disabled","drop","empty","enabled","first","first-child","first-of-type","fullscreen","future","focus","focus-visible","focus-within","has","host","host-context","hover","indeterminate","in-range","invalid","is","lang","last-child","last-of-type","left","link","local-link","not","nth-child","nth-col","nth-last-child","nth-last-col","nth-last-of-type","nth-of-type","only-child","only-of-type","optional","out-of-range","past","placeholder-shown","read-only","read-write","required","right","root","scope","target","target-within","user-invalid","valid","visited","where"].sort().reverse(),go=["after","backdrop","before","cue","cue-region","first-letter","first-line","grammar-error","marker","part","placeholder","selection","slotted","spelling-error"].sort().reverse(),mo=["accent-color","align-content","align-items","align-self","alignment-baseline","all","anchor-name","animation","animation-composition","animation-delay","animation-direction","animation-duration","animation-fill-mode","animation-iteration-count","animation-name","animation-play-state","animation-range","animation-range-end","animation-range-start","animation-timeline","animation-timing-function","appearance","aspect-ratio","backdrop-filter","backface-visibility","background","background-attachment","background-blend-mode","background-clip","background-color","background-image","background-origin","background-position","background-position-x","background-position-y","background-repeat","background-size","baseline-shift","block-size","border","border-block","border-block-color","border-block-end","border-block-end-color","border-block-end-style","border-block-end-width","border-block-start","border-block-start-color","border-block-start-style","border-block-start-width","border-block-style","border-block-width","border-bottom","border-bottom-color","border-bottom-left-radius","border-bottom-right-radius","border-bottom-style","border-bottom-width","border-collapse","border-color","border-end-end-radius","border-end-start-radius","border-image","border-image-outset","border-image-repeat","border-image-slice","border-image-source","border-image-width","border-inline","border-inline-color","border-inline-end","border-inline-end-color","border-inline-end-style","border-inline-end-width","border-inline-start","border-inline-start-color","border-inline-start-style","border-inline-start-width","border-inline-style","border-inline-width","border-left","border-left-color","border-left-style","border-left-width","border-radius","border-right","border-right-color","border-right-style","border-right-width","border-spacing","border-start-end-radius","border-start-start-radius","border-style","border-top","border-top-color","border-top-left-radius","border-top-right-radius","border-top-style","border-top-width","border-width","bottom","box-align","box-decoration-break","box-direction","box-flex","box-flex-group","box-lines","box-ordinal-group","box-orient","box-pack","box-shadow","box-sizing","break-after","break-before","break-inside","caption-side","caret-color","clear","clip","clip-path","clip-rule","color","color-interpolation","color-interpolation-filters","color-profile","color-rendering","color-scheme","column-count","column-fill","column-gap","column-rule","column-rule-color","column-rule-style","column-rule-width","column-span","column-width","columns","contain","contain-intrinsic-block-size","contain-intrinsic-height","contain-intrinsic-inline-size","contain-intrinsic-size","contain-intrinsic-width","container","container-name","container-type","content","content-visibility","counter-increment","counter-reset","counter-set","cue","cue-after","cue-before","cursor","cx","cy","direction","display","dominant-baseline","empty-cells","enable-background","field-sizing","fill","fill-opacity","fill-rule","filter","flex","flex-basis","flex-direction","flex-flow","flex-grow","flex-shrink","flex-wrap","float","flood-color","flood-opacity","flow","font","font-display","font-family","font-feature-settings","font-kerning","font-language-override","font-optical-sizing","font-palette","font-size","font-size-adjust","font-smooth","font-smoothing","font-stretch","font-style","font-synthesis","font-synthesis-position","font-synthesis-small-caps","font-synthesis-style","font-synthesis-weight","font-variant","font-variant-alternates","font-variant-caps","font-variant-east-asian","font-variant-emoji","font-variant-ligatures","font-variant-numeric","font-variant-position","font-variation-settings","font-weight","forced-color-adjust","gap","glyph-orientation-horizontal","glyph-orientation-vertical","grid","grid-area","grid-auto-columns","grid-auto-flow","grid-auto-rows","grid-column","grid-column-end","grid-column-start","grid-gap","grid-row","grid-row-end","grid-row-start","grid-template","grid-template-areas","grid-template-columns","grid-template-rows","hanging-punctuation","height","hyphenate-character","hyphenate-limit-chars","hyphens","icon","image-orientation","image-rendering","image-resolution","ime-mode","initial-letter","initial-letter-align","inline-size","inset","inset-area","inset-block","inset-block-end","inset-block-start","inset-inline","inset-inline-end","inset-inline-start","isolation","justify-content","justify-items","justify-self","kerning","left","letter-spacing","lighting-color","line-break","line-height","line-height-step","list-style","list-style-image","list-style-position","list-style-type","margin","margin-block","margin-block-end","margin-block-start","margin-bottom","margin-inline","margin-inline-end","margin-inline-start","margin-left","margin-right","margin-top","margin-trim","marker","marker-end","marker-mid","marker-start","marks","mask","mask-border","mask-border-mode","mask-border-outset","mask-border-repeat","mask-border-slice","mask-border-source","mask-border-width","mask-clip","mask-composite","mask-image","mask-mode","mask-origin","mask-position","mask-repeat","mask-size","mask-type","masonry-auto-flow","math-depth","math-shift","math-style","max-block-size","max-height","max-inline-size","max-width","min-block-size","min-height","min-inline-size","min-width","mix-blend-mode","nav-down","nav-index","nav-left","nav-right","nav-up","none","normal","object-fit","object-position","offset","offset-anchor","offset-distance","offset-path","offset-position","offset-rotate","opacity","order","orphans","outline","outline-color","outline-offset","outline-style","outline-width","overflow","overflow-anchor","overflow-block","overflow-clip-margin","overflow-inline","overflow-wrap","overflow-x","overflow-y","overlay","overscroll-behavior","overscroll-behavior-block","overscroll-behavior-inline","overscroll-behavior-x","overscroll-behavior-y","padding","padding-block","padding-block-end","padding-block-start","padding-bottom","padding-inline","padding-inline-end","padding-inline-start","padding-left","padding-right","padding-top","page","page-break-after","page-break-before","page-break-inside","paint-order","pause","pause-after","pause-before","perspective","perspective-origin","place-content","place-items","place-self","pointer-events","position","position-anchor","position-visibility","print-color-adjust","quotes","r","resize","rest","rest-after","rest-before","right","rotate","row-gap","ruby-align","ruby-position","scale","scroll-behavior","scroll-margin","scroll-margin-block","scroll-margin-block-end","scroll-margin-block-start","scroll-margin-bottom","scroll-margin-inline","scroll-margin-inline-end","scroll-margin-inline-start","scroll-margin-left","scroll-margin-right","scroll-margin-top","scroll-padding","scroll-padding-block","scroll-padding-block-end","scroll-padding-block-start","scroll-padding-bottom","scroll-padding-inline","scroll-padding-inline-end","scroll-padding-inline-start","scroll-padding-left","scroll-padding-right","scroll-padding-top","scroll-snap-align","scroll-snap-stop","scroll-snap-type","scroll-timeline","scroll-timeline-axis","scroll-timeline-name","scrollbar-color","scrollbar-gutter","scrollbar-width","shape-image-threshold","shape-margin","shape-outside","shape-rendering","speak","speak-as","src","stop-color","stop-opacity","stroke","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-opacity","stroke-width","tab-size","table-layout","text-align","text-align-all","text-align-last","text-anchor","text-combine-upright","text-decoration","text-decoration-color","text-decoration-line","text-decoration-skip","text-decoration-skip-ink","text-decoration-style","text-decoration-thickness","text-emphasis","text-emphasis-color","text-emphasis-position","text-emphasis-style","text-indent","text-justify","text-orientation","text-overflow","text-rendering","text-shadow","text-size-adjust","text-transform","text-underline-offset","text-underline-position","text-wrap","text-wrap-mode","text-wrap-style","timeline-scope","top","touch-action","transform","transform-box","transform-origin","transform-style","transition","transition-behavior","transition-delay","transition-duration","transition-property","transition-timing-function","translate","unicode-bidi","user-modify","user-select","vector-effect","vertical-align","view-timeline","view-timeline-axis","view-timeline-inset","view-timeline-name","view-transition-name","visibility","voice-balance","voice-duration","voice-family","voice-pitch","voice-range","voice-rate","voice-stress","voice-volume","white-space","white-space-collapse","widows","width","will-change","word-break","word-spacing","word-wrap","writing-mode","x","y","z-index","zoom"].sort().reverse();function bo(n){const e=n.regex,t=lo(n),i={begin:/-(webkit|moz|ms|o)-(?=[a-z])/},s="and or not only",r=/@-?\w[\w]*(-\w+)*/,o="[a-zA-Z-][a-zA-Z0-9_-]*",a=[n.APOS_STRING_MODE,n.QUOTE_STRING_MODE];return{name:"CSS",case_insensitive:!0,illegal:/[=|'\$]/,keywords:{keyframePosition:"from to"},classNameAliases:{keyframePosition:"selector-tag"},contains:[t.BLOCK_COMMENT,i,t.CSS_NUMBER_MODE,{className:"selector-id",begin:/#[A-Za-z0-9_-]+/,relevance:0},{className:"selector-class",begin:"\\."+o,relevance:0},t.ATTRIBUTE_SELECTOR_MODE,{className:"selector-pseudo",variants:[{begin:":("+fo.join("|")+")"},{begin:":(:)?("+go.join("|")+")"}]},t.CSS_VARIABLE,{className:"attribute",begin:"\\b("+mo.join("|")+")\\b"},{begin:/:/,end:/[;}{]/,contains:[t.BLOCK_COMMENT,t.HEXCOLOR,t.IMPORTANT,t.CSS_NUMBER_MODE,...a,{begin:/(url|data-uri)\(/,end:/\)/,relevance:0,keywords:{built_in:"url data-uri"},contains:[...a,{className:"string",begin:/[^)]/,endsWithParent:!0,excludeEnd:!0}]},t.FUNCTION_DISPATCH]},{begin:e.lookahead(/@/),end:"[{;]",relevance:0,illegal:/:/,contains:[{className:"keyword",begin:r},{begin:/\s/,endsWithParent:!0,excludeEnd:!0,relevance:0,keywords:{$pattern:/[a-z-]+/,keyword:s,attribute:uo.join(" ")},contains:[{begin:/[a-z-]+(?=:)/,className:"attribute"},...a,t.CSS_NUMBER_MODE]}]},{className:"selector-tag",begin:"\\b("+po.join("|")+")\\b"}]}}function qs(n){const e=n.regex,t=e.concat(/[\p{L}_]/u,e.optional(/[\p{L}0-9_.-]*:/u),/[\p{L}0-9_.-]*/u),i=/[\p{L}0-9._:-]+/u,s={className:"symbol",begin:/&[a-z]+;|&#[0-9]+;|&#x[a-f0-9]+;/},r={begin:/\s/,contains:[{className:"keyword",begin:/#?[a-z_][a-z1-9_-]+/,illegal:/\n/}]},o=n.inherit(r,{begin:/\(/,end:/\)/}),a=n.inherit(n.APOS_STRING_MODE,{className:"string"}),l=n.inherit(n.QUOTE_STRING_MODE,{className:"string"}),c={endsWithParent:!0,illegal:/</,relevance:0,contains:[{className:"attr",begin:i,relevance:0},{begin:/=\s*/,relevance:0,contains:[{className:"string",endsParent:!0,variants:[{begin:/"/,end:/"/,contains:[s]},{begin:/'/,end:/'/,contains:[s]},{begin:/[^\s"'=<>`]+/}]}]}]};return{name:"HTML, XML",aliases:["html","xhtml","rss","atom","xjb","xsd","xsl","plist","wsf","svg"],case_insensitive:!0,unicodeRegex:!0,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,relevance:10,contains:[r,l,a,o,{begin:/\[/,end:/\]/,contains:[{className:"meta",begin:/<![a-z]/,end:/>/,contains:[r,o,l,a]}]}]},n.COMMENT(/<!--/,/-->/,{relevance:10}),{begin:/<!\[CDATA\[/,end:/\]\]>/,relevance:10},s,{className:"meta",end:/\?>/,variants:[{begin:/<\?xml/,relevance:10,contains:[l]},{begin:/<\?[a-z][a-z0-9]+/}]},{className:"tag",begin:/<style(?=\s|>)/,end:/>/,keywords:{name:"style"},contains:[c],starts:{end:/<\/style>/,returnEnd:!0,subLanguage:["css","xml"]}},{className:"tag",begin:/<script(?=\s|>)/,end:/>/,keywords:{name:"script"},contains:[c],starts:{end:/<\/script>/,returnEnd:!0,subLanguage:["javascript","handlebars","xml"]}},{className:"tag",begin:/<>|<\/>/},{className:"tag",begin:e.concat(/</,e.lookahead(e.concat(t,e.either(/\/>/,/>/,/\s/)))),end:/\/?>/,contains:[{className:"name",begin:t,relevance:0,starts:c}]},{className:"tag",begin:e.concat(/<\//,e.lookahead(e.concat(t,/>/))),contains:[{className:"name",begin:t,relevance:0},{begin:/>/,relevance:0,endsParent:!0}]}]}}function Gs(n){const e="true false yes no null",t="[\\w#;/?:@&=+$,.~*'()[\\]]+",i={className:"attr",variants:[{begin:/[\w*@][\w*@ :()\./-]*:(?=[ \t]|$)/},{begin:/"[\w*@][\w*@ :()\./-]*":(?=[ \t]|$)/},{begin:/'[\w*@][\w*@ :()\./-]*':(?=[ \t]|$)/}]},s={className:"template-variable",variants:[{begin:/\{\{/,end:/\}\}/},{begin:/%\{/,end:/\}/}]},r={className:"string",relevance:0,begin:/'/,end:/'/,contains:[{match:/''/,scope:"char.escape",relevance:0}]},o={className:"string",relevance:0,variants:[{begin:/"/,end:/"/},{begin:/\S+/}],contains:[n.BACKSLASH_ESCAPE,s]},a=n.inherit(o,{variants:[{begin:/'/,end:/'/,contains:[{begin:/''/,relevance:0}]},{begin:/"/,end:/"/},{begin:/[^\s,{}[\]]+/}]}),g={className:"number",begin:"\\b"+"[0-9]{4}(-[0-9][0-9]){0,2}"+"([Tt \\t][0-9][0-9]?(:[0-9][0-9]){2})?"+"(\\.[0-9]*)?"+"([ \\t])*(Z|[-+][0-9][0-9]?(:[0-9][0-9])?)?"+"\\b"},_={end:",",endsWithParent:!0,excludeEnd:!0,keywords:e,relevance:0},v={begin:/\{/,end:/\}/,contains:[_],illegal:"\\n",relevance:0},E={begin:"\\[",end:"\\]",contains:[_],illegal:"\\n",relevance:0},M=[i,{className:"meta",begin:"^---\\s*$",relevance:10},{className:"string",begin:"[\\|>]([1-9]?[+-])?[ ]*\\n( +)[^ ][^\\n]*\\n(\\2[^\\n]+\\n?)*"},{begin:"<%[%=-]?",end:"[%-]?%>",subLanguage:"ruby",excludeBegin:!0,excludeEnd:!0,relevance:0},{className:"type",begin:"!\\w+!"+t},{className:"type",begin:"!<"+t+">"},{className:"type",begin:"!"+t},{className:"type",begin:"!!"+t},{className:"meta",begin:"&"+n.UNDERSCORE_IDENT_RE+"$"},{className:"meta",begin:"\\*"+n.UNDERSCORE_IDENT_RE+"$"},{className:"bullet",begin:"-(?=[ ]|$)",relevance:0},n.HASH_COMMENT_MODE,{beginKeywords:e,keywords:{literal:e}},g,{className:"number",begin:n.C_NUMBER_RE+"\\b",relevance:0},v,E,r,o],I=[...M];return I.pop(),I.push(a),_.contains=I,{name:"YAML",case_insensitive:!0,aliases:["yml"],contains:M}}function _o(n){const e=n.regex,t=n.COMMENT("//","$",{contains:[{begin:/\\\n/}]}),i="decltype\\(auto\\)",s="[a-zA-Z_]\\w*::",o="("+i+"|"+e.optional(s)+"[a-zA-Z_]\\w*"+e.optional("<[^<>]+>")+")",a={className:"type",variants:[{begin:"\\b[a-z\\d_]*_t\\b"},{match:/\batomic_[a-z]{3,6}\b/}]},c={className:"string",variants:[{begin:'(u8?|U|L)?"',end:'"',illegal:"\\n",contains:[n.BACKSLASH_ESCAPE]},{begin:"(u8?|U|L)?'("+"\\\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4,8}|[0-7]{3}|\\S)"+"|.)",end:"'",illegal:"."},n.END_SAME_AS_BEGIN({begin:/(?:u8?|U|L)?R"([^()\\ ]{0,16})\(/,end:/\)([^()\\ ]{0,16})"/})]},p={className:"number",variants:[{match:/\b(0b[01']+)/},{match:/(-?)\b([\d']+(\.[\d']*)?|\.[\d']+)((ll|LL|l|L)(u|U)?|(u|U)(ll|LL|l|L)?|f|F|b|B)/},{match:/(-?)\b(0[xX][a-fA-F0-9]+(?:'[a-fA-F0-9]+)*(?:\.[a-fA-F0-9]*(?:'[a-fA-F0-9]*)*)?(?:[pP][-+]?[0-9]+)?(l|L)?(u|U)?)/},{match:/(-?)\b\d+(?:'\d+)*(?:\.\d*(?:'\d*)*)?(?:[eE][-+]?\d+)?/}],relevance:0},u={className:"meta",begin:/#\s*[a-z]+\b/,end:/$/,keywords:{keyword:"if else elif endif define undef warning error line pragma _Pragma ifdef ifndef elifdef elifndef include"},contains:[{begin:/\\\n/,relevance:0},n.inherit(c,{className:"string"}),{className:"string",begin:/<.*?>/},t,n.C_BLOCK_COMMENT_MODE]},g={className:"title",begin:e.optional(s)+n.IDENT_RE,relevance:0},_=e.optional(s)+n.IDENT_RE+"\\s*\\(",M={keyword:["asm","auto","break","case","continue","default","do","else","enum","extern","for","fortran","goto","if","inline","register","restrict","return","sizeof","typeof","typeof_unqual","struct","switch","typedef","union","volatile","while","_Alignas","_Alignof","_Atomic","_Generic","_Noreturn","_Static_assert","_Thread_local","alignas","alignof","noreturn","static_assert","thread_local","_Pragma"],type:["float","double","signed","unsigned","int","short","long","char","void","_Bool","_BitInt","_Complex","_Imaginary","_Decimal32","_Decimal64","_Decimal96","_Decimal128","_Decimal64x","_Decimal128x","_Float16","_Float32","_Float64","_Float128","_Float32x","_Float64x","_Float128x","const","static","constexpr","complex","bool","imaginary"],literal:"true false NULL",built_in:"std string wstring cin cout cerr clog stdin stdout stderr stringstream istringstream ostringstream auto_ptr deque list queue stack vector map set pair bitset multiset multimap unordered_set unordered_map unordered_multiset unordered_multimap priority_queue make_pair array shared_ptr abort terminate abs acos asin atan2 atan calloc ceil cosh cos exit exp fabs floor fmod fprintf fputs free frexp fscanf future isalnum isalpha iscntrl isdigit isgraph islower isprint ispunct isspace isupper isxdigit tolower toupper labs ldexp log10 log malloc realloc memchr memcmp memcpy memset modf pow printf putchar puts scanf sinh sin snprintf sprintf sqrt sscanf strcat strchr strcmp strcpy strcspn strlen strncat strncmp strncpy strpbrk strrchr strspn strstr tanh tan vfprintf vprintf vsprintf endl initializer_list unique_ptr"},I=[u,a,t,n.C_BLOCK_COMMENT_MODE,p,c],P={variants:[{begin:/=/,end:/;/},{begin:/\(/,end:/\)/},{beginKeywords:"new throw return else",end:/;/}],keywords:M,contains:I.concat([{begin:/\(/,end:/\)/,keywords:M,contains:I.concat(["self"]),relevance:0}]),relevance:0},G={begin:"("+o+"[\\*&\\s]+)+"+_,returnBegin:!0,end:/[{;=]/,excludeEnd:!0,keywords:M,illegal:/[^\w\s\*&:<>.]/,contains:[{begin:i,keywords:M,relevance:0},{begin:_,returnBegin:!0,contains:[n.inherit(g,{className:"title.function"})],relevance:0},{relevance:0,match:/,/},{className:"params",begin:/\(/,end:/\)/,keywords:M,relevance:0,contains:[t,n.C_BLOCK_COMMENT_MODE,c,p,a,{begin:/\(/,end:/\)/,keywords:M,relevance:0,contains:["self",t,n.C_BLOCK_COMMENT_MODE,c,p,a]}]},a,t,n.C_BLOCK_COMMENT_MODE,u]};return{name:"C",aliases:["h"],keywords:M,disableAutodetect:!0,illegal:"</",contains:[].concat(P,G,I,[u,{begin:n.IDENT_RE+"::",keywords:M},{className:"class",beginKeywords:"enum class struct union",end:/[{;:<>=]/,contains:[{beginKeywords:"final class struct"},n.TITLE_MODE]}]),exports:{preprocessor:u,strings:c,keywords:M}}}function vo(n){const e=n.regex,t=n.COMMENT("//","$",{contains:[{begin:/\\\n/}]}),i="decltype\\(auto\\)",s="[a-zA-Z_]\\w*::",o="(?!struct)("+i+"|"+e.optional(s)+"[a-zA-Z_]\\w*"+e.optional("<[^<>]+>")+")",a={className:"type",begin:"\\b[a-z\\d_]*_t\\b"},c={className:"string",variants:[{begin:'(u8?|U|L)?"',end:'"',illegal:"\\n",contains:[n.BACKSLASH_ESCAPE]},{begin:"(u8?|U|L)?'("+"\\\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4,8}|[0-7]{3}|\\S)"+"|.)",end:"'",illegal:"."},n.END_SAME_AS_BEGIN({begin:/(?:u8?|U|L)?R"([^()\\ ]{0,16})\(/,end:/\)([^()\\ ]{0,16})"/})]},p={className:"number",variants:[{begin:"[+-]?(?:(?:[0-9](?:'?[0-9])*\\.(?:[0-9](?:'?[0-9])*)?|\\.[0-9](?:'?[0-9])*)(?:[Ee][+-]?[0-9](?:'?[0-9])*)?|[0-9](?:'?[0-9])*[Ee][+-]?[0-9](?:'?[0-9])*|0[Xx](?:[0-9A-Fa-f](?:'?[0-9A-Fa-f])*(?:\\.(?:[0-9A-Fa-f](?:'?[0-9A-Fa-f])*)?)?|\\.[0-9A-Fa-f](?:'?[0-9A-Fa-f])*)[Pp][+-]?[0-9](?:'?[0-9])*)(?:[Ff](?:16|32|64|128)?|(BF|bf)16|[Ll]|)"},{begin:"[+-]?\\b(?:0[Bb][01](?:'?[01])*|0[Xx][0-9A-Fa-f](?:'?[0-9A-Fa-f])*|0(?:'?[0-7])*|[1-9](?:'?[0-9])*)(?:[Uu](?:LL?|ll?)|[Uu][Zz]?|(?:LL?|ll?)[Uu]?|[Zz][Uu]|)"}],relevance:0},u={className:"meta",begin:/#\s*[a-z]+\b/,end:/$/,keywords:{keyword:"if else elif endif define undef warning error line pragma _Pragma ifdef ifndef include"},contains:[{begin:/\\\n/,relevance:0},n.inherit(c,{className:"string"}),{className:"string",begin:/<.*?>/},t,n.C_BLOCK_COMMENT_MODE]},g={className:"title",begin:e.optional(s)+n.IDENT_RE,relevance:0},_=e.optional(s)+n.IDENT_RE+"\\s*\\(",v=["alignas","alignof","and","and_eq","asm","atomic_cancel","atomic_commit","atomic_noexcept","auto","bitand","bitor","break","case","catch","class","co_await","co_return","co_yield","compl","concept","const_cast|10","consteval","constexpr","constinit","continue","decltype","default","delete","do","dynamic_cast|10","else","enum","explicit","export","extern","false","final","for","friend","goto","if","import","inline","module","mutable","namespace","new","noexcept","not","not_eq","nullptr","operator","or","or_eq","override","private","protected","public","reflexpr","register","reinterpret_cast|10","requires","return","sizeof","static_assert","static_cast|10","struct","switch","synchronized","template","this","thread_local","throw","transaction_safe","transaction_safe_dynamic","true","try","typedef","typeid","typename","union","using","virtual","volatile","while","xor","xor_eq"],E=["bool","char","char16_t","char32_t","char8_t","double","float","int","long","short","void","wchar_t","unsigned","signed","const","static"],M=["any","auto_ptr","barrier","binary_semaphore","bitset","complex","condition_variable","condition_variable_any","counting_semaphore","deque","false_type","flat_map","flat_set","future","imaginary","initializer_list","istringstream","jthread","latch","lock_guard","multimap","multiset","mutex","optional","ostringstream","packaged_task","pair","promise","priority_queue","queue","recursive_mutex","recursive_timed_mutex","scoped_lock","set","shared_future","shared_lock","shared_mutex","shared_timed_mutex","shared_ptr","stack","string_view","stringstream","timed_mutex","thread","true_type","tuple","unique_lock","unique_ptr","unordered_map","unordered_multimap","unordered_multiset","unordered_set","variant","vector","weak_ptr","wstring","wstring_view"],I=["abort","abs","acos","apply","as_const","asin","atan","atan2","calloc","ceil","cerr","cin","clog","cos","cosh","cout","declval","endl","exchange","exit","exp","fabs","floor","fmod","forward","fprintf","fputs","free","frexp","fscanf","future","invoke","isalnum","isalpha","iscntrl","isdigit","isgraph","islower","isprint","ispunct","isspace","isupper","isxdigit","labs","launder","ldexp","log","log10","make_pair","make_shared","make_shared_for_overwrite","make_tuple","make_unique","malloc","memchr","memcmp","memcpy","memset","modf","move","pow","printf","putchar","puts","realloc","scanf","sin","sinh","snprintf","sprintf","sqrt","sscanf","std","stderr","stdin","stdout","strcat","strchr","strcmp","strcpy","strcspn","strlen","strncat","strncmp","strncpy","strpbrk","strrchr","strspn","strstr","swap","tan","tanh","terminate","to_underlying","tolower","toupper","vfprintf","visit","vprintf","vsprintf"],C={type:E,keyword:v,literal:["NULL","false","nullopt","nullptr","true"],built_in:["_Pragma"],_type_hints:M},B={className:"function.dispatch",relevance:0,keywords:{_hint:I},begin:e.concat(/\b/,/(?!decltype)/,/(?!if)/,/(?!for)/,/(?!switch)/,/(?!while)/,n.IDENT_RE,e.lookahead(/(<[^<>]+>|)\s*\(/))},U=[B,u,a,t,n.C_BLOCK_COMMENT_MODE,p,c],V={variants:[{begin:/=/,end:/;/},{begin:/\(/,end:/\)/},{beginKeywords:"new throw return else",end:/;/}],keywords:C,contains:U.concat([{begin:/\(/,end:/\)/,keywords:C,contains:U.concat(["self"]),relevance:0}]),relevance:0},ie={className:"function",begin:"("+o+"[\\*&\\s]+)+"+_,returnBegin:!0,end:/[{;=]/,excludeEnd:!0,keywords:C,illegal:/[^\w\s\*&:<>.]/,contains:[{begin:i,keywords:C,relevance:0},{begin:_,returnBegin:!0,contains:[g],relevance:0},{begin:/::/,relevance:0},{begin:/:/,endsWithParent:!0,contains:[c,p]},{relevance:0,match:/,/},{className:"params",begin:/\(/,end:/\)/,keywords:C,relevance:0,contains:[t,n.C_BLOCK_COMMENT_MODE,c,p,a,{begin:/\(/,end:/\)/,keywords:C,relevance:0,contains:["self",t,n.C_BLOCK_COMMENT_MODE,c,p,a]}]},a,t,n.C_BLOCK_COMMENT_MODE,u]};return{name:"C++",aliases:["cc","c++","h++","hpp","hh","hxx","cxx"],keywords:C,illegal:"</",classNameAliases:{"function.dispatch":"built_in"},contains:[].concat(V,ie,B,U,[u,{begin:"\\b(deque|list|queue|priority_queue|pair|stack|vector|map|set|bitset|multiset|multimap|unordered_map|unordered_set|unordered_multiset|unordered_multimap|array|tuple|optional|variant|function|flat_map|flat_set)\\s*<(?!<)",end:">",keywords:C,contains:["self",a]},{begin:n.IDENT_RE+"::",keywords:C},{match:[/\b(?:enum(?:\s+(?:class|struct))?|class|struct|union)/,/\s+/,/\w+/],className:{1:"keyword",3:"title.class"}}])}}function xo(n){const e=n.regex;return{name:"Diff",aliases:["patch"],contains:[{className:"meta",relevance:10,match:e.either(/^@@ +-\d+,\d+ +\+\d+,\d+ +@@/,/^\*\*\* +\d+,\d+ +\*\*\*\*$/,/^--- +\d+,\d+ +----$/)},{className:"comment",variants:[{begin:e.either(/Index: /,/^index/,/={3,}/,/^-{3}/,/^\*{3} /,/^\+{3}/,/^diff --git/),end:/$/},{match:/^\*{15}$/}]},{className:"addition",begin:/^\+/,end:/$/},{className:"deletion",begin:/^-/,end:/$/},{className:"addition",begin:/^!/,end:/$/}]}}function js(n){const e=n.regex,t={begin:/<\/?[A-Za-z_]/,end:">",subLanguage:"xml",relevance:0},i={begin:"^[-\\*]{3,}",end:"$"},s={className:"code",variants:[{begin:"(`{3,})[^`](.|\\n)*?\\1`*[ ]*"},{begin:"(~{3,})[^~](.|\\n)*?\\1~*[ ]*"},{begin:"```",end:"```+[ ]*$"},{begin:"~~~",end:"~~~+[ ]*$"},{begin:"`.+?`"},{begin:"(?=^( {4}|\\t))",contains:[{begin:"^( {4}|\\t)",end:"(\\n)$"}],relevance:0}]},r={className:"bullet",begin:"^[ 	]*([*+-]|(\\d+\\.))(?=\\s+)",end:"\\s+",excludeEnd:!0},o={begin:/^\[[^\n]+\]:/,returnBegin:!0,contains:[{className:"symbol",begin:/\[/,end:/\]/,excludeBegin:!0,excludeEnd:!0},{className:"link",begin:/:\s*/,end:/$/,excludeBegin:!0}]},a=/[A-Za-z][A-Za-z0-9+.-]*/,l={variants:[{begin:/\[.+?\]\[.*?\]/,relevance:0},{begin:/\[.+?\]\(((data|javascript|mailto):|(?:http|ftp)s?:\/\/).*?\)/,relevance:2},{begin:e.concat(/\[.+?\]\(/,a,/:\/\/.*?\)/),relevance:2},{begin:/\[.+?\]\([./?&#].*?\)/,relevance:1},{begin:/\[.*?\]\(.*?\)/,relevance:0}],returnBegin:!0,contains:[{match:/\[(?=\])/},{className:"string",relevance:0,begin:"\\[",end:"\\]",excludeBegin:!0,returnEnd:!0},{className:"link",relevance:0,begin:"\\]\\(",end:"\\)",excludeBegin:!0,excludeEnd:!0},{className:"symbol",relevance:0,begin:"\\]\\[",end:"\\]",excludeBegin:!0,excludeEnd:!0}]},c={className:"strong",contains:[],variants:[{begin:/_{2}(?!\s)/,end:/_{2}/},{begin:/\*{2}(?!\s)/,end:/\*{2}/}]},p={className:"emphasis",contains:[],variants:[{begin:/\*(?![*\s])/,end:/\*/},{begin:/_(?![_\s])/,end:/_/,relevance:0}]},u=n.inherit(c,{contains:[]}),g=n.inherit(p,{contains:[]});c.contains.push(g),p.contains.push(u);let _=[t,l];return[c,p,u,g].forEach(I=>{I.contains=I.contains.concat(_)}),_=_.concat(c,p),{name:"Markdown",aliases:["md","mkdown","mkd"],contains:[{className:"section",variants:[{begin:"^#{1,6}",end:"$",contains:_},{begin:"(?=^.+?\\n[=-]{2,}$)",contains:[{begin:"^[=-]*$"},{begin:"^",end:"\\n",contains:_}]}]},t,r,c,p,{className:"quote",begin:"^>\\s+",contains:_,end:"$"},s,i,l,o,{scope:"literal",match:/&([a-zA-Z0-9]+|#[0-9]{1,7}|#[Xx][0-9a-fA-F]{1,6});/}]}}j.registerLanguage("javascript",Ns);j.registerLanguage("js",Ns);j.registerLanguage("python",Ls);j.registerLanguage("py",Ls);j.registerLanguage("typescript",Hs);j.registerLanguage("ts",Hs);j.registerLanguage("json",ao);j.registerLanguage("bash",bi);j.registerLanguage("sh",bi);j.registerLanguage("shell",bi);j.registerLanguage("css",bo);j.registerLanguage("html",qs);j.registerLanguage("xml",qs);j.registerLanguage("yaml",Gs);j.registerLanguage("yml",Gs);j.registerLanguage("c",_o);j.registerLanguage("cpp",vo);j.registerLanguage("diff",xo);j.registerLanguage("markdown",js);j.registerLanguage("md",js);const yo=new Rs({gfm:!0,breaks:!1,renderer:{code({text:n,lang:e}){const t=e&&j.getLanguage(e)?e:null;let i;if(t)try{i=j.highlight(n,{language:t}).value}catch{i=Xt(n)}else i=Xt(n);return`<pre class="code-block">${t?`<span class="code-lang">${t}</span>`:""}<button class="code-copy-btn" title="Copy code">📋</button><code class="hljs${t?` language-${t}`:""}">${i}</code></pre>`}}});function Xt(n){return n.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function es(n){if(!n)return"";try{return yo.parse(n)}catch(e){return console.warn("Markdown parse error:",e),`<pre>${Xt(n)}</pre>`}}function fe(){}fe.prototype={diff:function(e,t){var i,s=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},r=s.callback;typeof s=="function"&&(r=s,s={});var o=this;function a(C){return C=o.postProcess(C,s),r?(setTimeout(function(){r(C)},0),!0):C}e=this.castInput(e,s),t=this.castInput(t,s),e=this.removeEmpty(this.tokenize(e,s)),t=this.removeEmpty(this.tokenize(t,s));var l=t.length,c=e.length,p=1,u=l+c;s.maxEditLength!=null&&(u=Math.min(u,s.maxEditLength));var g=(i=s.timeout)!==null&&i!==void 0?i:1/0,_=Date.now()+g,v=[{oldPos:-1,lastComponent:void 0}],E=this.extractCommon(v[0],t,e,0,s);if(v[0].oldPos+1>=c&&E+1>=l)return a(ts(o,v[0].lastComponent,t,e,o.useLongestToken));var M=-1/0,I=1/0;function P(){for(var C=Math.max(M,-p);C<=Math.min(I,p);C+=2){var B=void 0,U=v[C-1],V=v[C+1];U&&(v[C-1]=void 0);var ie=!1;if(V){var ge=V.oldPos-C;ie=V&&0<=ge&&ge<l}var me=U&&U.oldPos+1<c;if(!ie&&!me){v[C]=void 0;continue}if(!me||ie&&U.oldPos<V.oldPos?B=o.addToPath(V,!0,!1,0,s):B=o.addToPath(U,!1,!0,1,s),E=o.extractCommon(B,t,e,C,s),B.oldPos+1>=c&&E+1>=l)return a(ts(o,B.lastComponent,t,e,o.useLongestToken));v[C]=B,B.oldPos+1>=c&&(I=Math.min(I,C-1)),E+1>=l&&(M=Math.max(M,C+1))}p++}if(r)(function C(){setTimeout(function(){if(p>u||Date.now()>_)return r();P()||C()},0)})();else for(;p<=u&&Date.now()<=_;){var G=P();if(G)return G}},addToPath:function(e,t,i,s,r){var o=e.lastComponent;return o&&!r.oneChangePerToken&&o.added===t&&o.removed===i?{oldPos:e.oldPos+s,lastComponent:{count:o.count+1,added:t,removed:i,previousComponent:o.previousComponent}}:{oldPos:e.oldPos+s,lastComponent:{count:1,added:t,removed:i,previousComponent:o}}},extractCommon:function(e,t,i,s,r){for(var o=t.length,a=i.length,l=e.oldPos,c=l-s,p=0;c+1<o&&l+1<a&&this.equals(i[l+1],t[c+1],r);)c++,l++,p++,r.oneChangePerToken&&(e.lastComponent={count:1,previousComponent:e.lastComponent,added:!1,removed:!1});return p&&!r.oneChangePerToken&&(e.lastComponent={count:p,previousComponent:e.lastComponent,added:!1,removed:!1}),e.oldPos=l,c},equals:function(e,t,i){return i.comparator?i.comparator(e,t):e===t||i.ignoreCase&&e.toLowerCase()===t.toLowerCase()},removeEmpty:function(e){for(var t=[],i=0;i<e.length;i++)e[i]&&t.push(e[i]);return t},castInput:function(e){return e},tokenize:function(e){return Array.from(e)},join:function(e){return e.join("")},postProcess:function(e){return e}};function ts(n,e,t,i,s){for(var r=[],o;e;)r.push(e),o=e.previousComponent,delete e.previousComponent,e=o;r.reverse();for(var a=0,l=r.length,c=0,p=0;a<l;a++){var u=r[a];if(u.removed)u.value=n.join(i.slice(p,p+u.count)),p+=u.count;else{if(!u.added&&s){var g=t.slice(c,c+u.count);g=g.map(function(_,v){var E=i[p+v];return E.length>_.length?E:_}),u.value=n.join(g)}else u.value=n.join(t.slice(c,c+u.count));c+=u.count,u.added||(p+=u.count)}}return r}function is(n,e){var t;for(t=0;t<n.length&&t<e.length;t++)if(n[t]!=e[t])return n.slice(0,t);return n.slice(0,t)}function ss(n,e){var t;if(!n||!e||n[n.length-1]!=e[e.length-1])return"";for(t=0;t<n.length&&t<e.length;t++)if(n[n.length-(t+1)]!=e[e.length-(t+1)])return n.slice(-t);return n.slice(-t)}function Yt(n,e,t){if(n.slice(0,e.length)!=e)throw Error("string ".concat(JSON.stringify(n)," doesn't start with prefix ").concat(JSON.stringify(e),"; this is a bug"));return t+n.slice(e.length)}function Qt(n,e,t){if(!e)return n+t;if(n.slice(-e.length)!=e)throw Error("string ".concat(JSON.stringify(n)," doesn't end with suffix ").concat(JSON.stringify(e),"; this is a bug"));return n.slice(0,-e.length)+t}function Xe(n,e){return Yt(n,e,"")}function mt(n,e){return Qt(n,e,"")}function ns(n,e){return e.slice(0,wo(n,e))}function wo(n,e){var t=0;n.length>e.length&&(t=n.length-e.length);var i=e.length;n.length<e.length&&(i=n.length);var s=Array(i),r=0;s[0]=0;for(var o=1;o<i;o++){for(e[o]==e[r]?s[o]=s[r]:s[o]=r;r>0&&e[o]!=e[r];)r=s[r];e[o]==e[r]&&r++}r=0;for(var a=t;a<n.length;a++){for(;r>0&&n[a]!=e[r];)r=s[r];n[a]==e[r]&&r++}return r}var $t="a-zA-Z0-9_\\u{C0}-\\u{FF}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}",ko=new RegExp("[".concat($t,"]+|\\s+|[^").concat($t,"]"),"ug"),ot=new fe;ot.equals=function(n,e,t){return t.ignoreCase&&(n=n.toLowerCase(),e=e.toLowerCase()),n.trim()===e.trim()};ot.tokenize=function(n){var e=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},t;if(e.intlSegmenter){if(e.intlSegmenter.resolvedOptions().granularity!="word")throw new Error('The segmenter passed must have a granularity of "word"');t=Array.from(e.intlSegmenter.segment(n),function(r){return r.segment})}else t=n.match(ko)||[];var i=[],s=null;return t.forEach(function(r){/\s/.test(r)?s==null?i.push(r):i.push(i.pop()+r):/\s/.test(s)?i[i.length-1]==s?i.push(i.pop()+r):i.push(s+r):i.push(r),s=r}),i};ot.join=function(n){return n.map(function(e,t){return t==0?e:e.replace(/^\s+/,"")}).join("")};ot.postProcess=function(n,e){if(!n||e.oneChangePerToken)return n;var t=null,i=null,s=null;return n.forEach(function(r){r.added?i=r:r.removed?s=r:((i||s)&&rs(t,s,i,r),t=r,i=null,s=null)}),(i||s)&&rs(t,s,i,null),n};function Eo(n,e,t){return ot.diff(n,e,t)}function rs(n,e,t,i){if(e&&t){var s=e.value.match(/^\s*/)[0],r=e.value.match(/\s*$/)[0],o=t.value.match(/^\s*/)[0],a=t.value.match(/\s*$/)[0];if(n){var l=is(s,o);n.value=Qt(n.value,o,l),e.value=Xe(e.value,l),t.value=Xe(t.value,l)}if(i){var c=ss(r,a);i.value=Yt(i.value,a,c),e.value=mt(e.value,c),t.value=mt(t.value,c)}}else if(t)n&&(t.value=t.value.replace(/^\s*/,"")),i&&(i.value=i.value.replace(/^\s*/,""));else if(n&&i){var p=i.value.match(/^\s*/)[0],u=e.value.match(/^\s*/)[0],g=e.value.match(/\s*$/)[0],_=is(p,u);e.value=Xe(e.value,_);var v=ss(Xe(p,_),g);e.value=mt(e.value,v),i.value=Yt(i.value,p,v),n.value=Qt(n.value,p,p.slice(0,p.length-v.length))}else if(i){var E=i.value.match(/^\s*/)[0],M=e.value.match(/\s*$/)[0],I=ns(M,E);e.value=mt(e.value,I)}else if(n){var P=n.value.match(/\s*$/)[0],G=e.value.match(/^\s*/)[0],C=ns(P,G);e.value=Xe(e.value,C)}}var So=new fe;So.tokenize=function(n){var e=new RegExp("(\\r?\\n)|[".concat($t,"]+|[^\\S\\n\\r]+|[^").concat($t,"]"),"ug");return n.match(e)||[]};var It=new fe;It.tokenize=function(n,e){e.stripTrailingCr&&(n=n.replace(/\r\n/g,`
`));var t=[],i=n.split(/(\n|\r\n)/);i[i.length-1]||i.pop();for(var s=0;s<i.length;s++){var r=i[s];s%2&&!e.newlineIsToken?t[t.length-1]+=r:t.push(r)}return t};It.equals=function(n,e,t){return t.ignoreWhitespace?((!t.newlineIsToken||!n.includes(`
`))&&(n=n.trim()),(!t.newlineIsToken||!e.includes(`
`))&&(e=e.trim())):t.ignoreNewlineAtEof&&!t.newlineIsToken&&(n.endsWith(`
`)&&(n=n.slice(0,-1)),e.endsWith(`
`)&&(e=e.slice(0,-1))),fe.prototype.equals.call(this,n,e,t)};function $o(n,e,t){return It.diff(n,e,t)}var Co=new fe;Co.tokenize=function(n){return n.split(/(\S.+?[.!?])(?=\s+|$)/)};var To=new fe;To.tokenize=function(n){return n.split(/([{}:;,]|\s+)/)};function Jt(n){"@babel/helpers - typeof";return Jt=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(e){return typeof e}:function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},Jt(n)}var st=new fe;st.useLongestToken=!0;st.tokenize=It.tokenize;st.castInput=function(n,e){var t=e.undefinedReplacement,i=e.stringifyReplacer,s=i===void 0?function(r,o){return typeof o>"u"?t:o}:i;return typeof n=="string"?n:JSON.stringify(ei(n,null,null,s),s,"  ")};st.equals=function(n,e,t){return fe.prototype.equals.call(st,n.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"),t)};function ei(n,e,t,i,s){e=e||[],t=t||[],i&&(n=i(s,n));var r;for(r=0;r<e.length;r+=1)if(e[r]===n)return t[r];var o;if(Object.prototype.toString.call(n)==="[object Array]"){for(e.push(n),o=new Array(n.length),t.push(o),r=0;r<n.length;r+=1)o[r]=ei(n[r],e,t,i,s);return e.pop(),t.pop(),o}if(n&&n.toJSON&&(n=n.toJSON()),Jt(n)==="object"&&n!==null){e.push(n),o={},t.push(o);var a=[],l;for(l in n)Object.prototype.hasOwnProperty.call(n,l)&&a.push(l);for(a.sort(),r=0;r<a.length;r+=1)l=a[r],o[l]=ei(n[l],e,t,i,l);e.pop(),t.pop()}else o=n;return o}var ti=new fe;ti.tokenize=function(n){return n.slice()};ti.join=ti.removeEmpty=function(n){return n};const Ro="<<<< EDIT",Ao="==== REPLACE",Mo=">>>> EDIT END";function Io(n){if(!n)return[];const e=n.split(`
`),t=[];let i=[],s="text",r="",o=[],a=[];function l(){i.length>0&&(t.push({type:"text",content:i.join(`
`)}),i=[])}for(const c of e)if(s==="text"){if(c.trim()===Ro&&r){l(),s="old",o=[],a=[];continue}No(c.trim())?r=c.trim():r="",i.push(c)}else if(s==="old")c.trim()===Ao?s="new":o.push(c);else if(s==="new")if(c.trim()===Mo){if(t.length>0&&t[t.length-1].type==="text"){const p=t[t.length-1],u=p.content.split(`
`);u.length>0&&u[u.length-1].trim()===r&&(u.pop(),p.content=u.join(`
`),p.content.trim()||t.pop())}t.push({type:"edit",filePath:r,oldLines:[...o],newLines:[...a],isCreate:o.length===0}),s="text",r="",o=[],a=[]}else a.push(c);return s==="text"?l():(l(),r&&t.push({type:"edit-pending",filePath:r,oldLines:[...o],newLines:[...a]})),t}function No(n){return!n||n.length>200||n.startsWith("#")||n.startsWith("//")||n.startsWith("/*")||n.startsWith("*")||n.startsWith("-")||n.startsWith(">")||n.startsWith("```")?!1:n.includes("/")||n.includes("\\")||n.includes(".")&&!n.includes(" ")}function Lo(n,e){const t=n.join(`
`),i=e.join(`
`),s=$o(t,i),r=[];for(const l of s){const c=l.value.replace(/\n$/,"").split(`
`),p=l.added?"add":l.removed?"remove":"context";for(const u of c)r.push({type:p,text:u})}const o=[];let a=0;for(;a<r.length;){if(r[a].type==="context"){o.push(r[a]),a++;continue}const l=[];for(;a<r.length&&r[a].type==="remove";)l.push(r[a].text),a++;const c=[];for(;a<r.length&&r[a].type==="add";)c.push(r[a].text),a++;const p=Math.min(l.length,c.length);for(let u=0;u<p;u++){const g=Oo(l[u],c[u]);o.push({type:"remove",text:l[u],charDiff:g.old}),o.push({type:"add",text:c[u],charDiff:g.new})}for(let u=p;u<l.length;u++)o.push({type:"remove",text:l[u]});for(let u=p;u<c.length;u++)o.push({type:"add",text:c[u]})}return o}function Oo(n,e){const t=Eo(n,e),i=[],s=[];for(const r of t)r.added?s.push({type:"insert",text:r.value}):r.removed?i.push({type:"delete",text:r.value}):(i.push({type:"equal",text:r.value}),s.push({type:"equal",text:r.value}));return{old:os(i),new:os(s)}}function os(n){if(n.length===0)return[];const e=[{...n[0]}];for(let t=1;t<n.length;t++){const i=e[e.length-1];n[t].type===i.type?i.text+=n[t].text:e.push({...n[t]})}return e}class Do extends le(Z){static properties={messages:{type:Array},streaming:{type:Boolean},streamContent:{type:String},editResults:{type:Array},repoFiles:{type:Array},selectedFiles:{type:Object}};static styles=te`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .messages-wrapper {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .messages {
      height: 100%;
      overflow-y: auto;
      padding: 12px 16px;
      scroll-behavior: smooth;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }

    .message-card {
      margin-bottom: 12px;
      padding: 10px 14px;
      border-radius: var(--radius-md);
      line-height: 1.5;
      max-width: 100%;
      overflow-wrap: break-word;
      content-visibility: auto;
      contain-intrinsic-size: auto 120px;
    }

    .message-card.force-visible {
      content-visibility: visible;
    }

    .message-card.user {
      background: var(--bg-elevated);
      border-left: 3px solid var(--accent-primary);
    }

    .message-card.assistant {
      background: var(--bg-surface);
      border-left: 3px solid var(--accent-success);
    }

    .message-card.assistant.streaming {
      border-left-color: var(--accent-warning);
    }

    /* Message action toolbars (top + bottom) */
    .message-card {
      position: relative;
    }

    .msg-actions {
      position: absolute;
      right: 8px;
      display: flex;
      gap: 2px;
      opacity: 0;
      transition: opacity var(--transition-fast);
      z-index: 2;
    }
    .msg-actions.top { top: 6px; }
    .msg-actions.bottom { bottom: 6px; }
    .message-card:hover .msg-actions {
      opacity: 1;
    }

    .msg-action-btn {
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: 3px;
      padding: 2px 6px;
      font-size: 12px;
      cursor: pointer;
      color: var(--text-muted);
      line-height: 1;
      transition: color var(--transition-fast), background var(--transition-fast);
    }
    .msg-action-btn:hover {
      color: var(--text-primary);
      background: var(--bg-surface);
    }
    .msg-action-btn.copied {
      color: var(--accent-success);
    }

    .role-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
      letter-spacing: 0.5px;
    }

    /* Markdown content styles */
    .md-content {
      font-size: 13.5px;
      color: var(--text-primary);
    }

    .md-content p { margin: 0.4em 0; }
    .md-content p:first-child { margin-top: 0; }
    .md-content p:last-child { margin-bottom: 0; }

    .md-content code {
      font-family: var(--font-mono);
      font-size: 12.5px;
      background: var(--bg-primary);
      padding: 1px 5px;
      border-radius: 3px;
      color: var(--accent-primary);
    }

    .md-content pre.code-block {
      position: relative;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      margin: 8px 0;
      overflow-x: auto;
    }

    .md-content pre.code-block code {
      background: none;
      padding: 0;
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1.5;
    }

    .md-content pre .code-lang {
      position: absolute;
      top: 4px;
      right: 8px;
      font-size: 10px;
      color: var(--text-muted);
      font-family: var(--font-sans);
    }

    .md-content pre .code-copy-btn {
      position: absolute;
      top: 4px;
      right: 4px;
      padding: 2px 6px;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--transition-fast), background var(--transition-fast);
      z-index: 1;
      font-family: var(--font-sans);
      line-height: 1;
    }
    .md-content pre .code-copy-btn:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }
    .md-content pre:hover .code-copy-btn {
      opacity: 1;
    }
    .md-content pre .code-copy-btn.copied {
      opacity: 1;
      color: var(--accent-success);
    }

    /* Shift lang label left when copy button is present */
    .md-content pre .code-lang {
      right: 36px;
    }

    .md-content ul, .md-content ol { margin: 0.4em 0; padding-left: 1.5em; }
    .md-content li { margin: 0.2em 0; }
    .md-content blockquote {
      border-left: 3px solid var(--border-light);
      padding-left: 12px;
      color: var(--text-secondary);
      margin: 0.4em 0;
    }
    .md-content h1, .md-content h2, .md-content h3,
    .md-content h4, .md-content h5, .md-content h6 {
      margin: 0.6em 0 0.3em;
      color: var(--text-primary);
    }
    .md-content h1 { font-size: 1.3em; }
    .md-content h2 { font-size: 1.15em; }
    .md-content h3 { font-size: 1.05em; }
    .md-content a { color: var(--accent-primary); text-decoration: none; }
    .md-content a:hover { text-decoration: underline; }
    .md-content table {
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 12.5px;
    }
    .md-content th, .md-content td {
      border: 1px solid var(--border-color);
      padding: 4px 8px;
    }
    .md-content th { background: var(--bg-elevated); font-weight: 600; }

    /* highlight.js dark theme overrides */
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

    /* Edit block display */
    .edit-block {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      margin: 8px 0;
      overflow: hidden;
    }

    .edit-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
    }

    .edit-file-path {
      font-family: var(--font-mono);
      color: var(--accent-primary);
      cursor: pointer;
    }
    .edit-file-path:hover { text-decoration: underline; }

    .edit-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .edit-badge.applied { background: #1b5e20; color: #a5d6a7; }
    .edit-badge.failed { background: #b71c1c; color: #ef9a9a; }
    .edit-badge.skipped { background: #4e342e; color: #bcaaa4; }
    .edit-badge.pending { background: #e65100; color: #ffcc80; }
    .edit-badge.new { background: #1a237e; color: #9fa8da; }

    .edit-diff {
      padding: 6px 0;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.5;
      overflow-x: auto;
    }

    .diff-line { padding: 0 10px; white-space: pre; display: block; }
    .diff-line.context { background: #0d1117; color: #e6edf3; }
    .diff-line.remove { background: #2d1215; color: #ffa198; }
    .diff-line.add { background: #122117; color: #7ee787; }

    .diff-line-prefix {
      display: inline-block;
      width: 1.2em;
      user-select: none;
      color: inherit;
      opacity: 0.6;
    }

    /* Character-level highlight within changed lines */
    .diff-line.remove .diff-change { background: #6d3038; border-radius: 2px; padding: 0 2px; }
    .diff-line.add .diff-change    { background: #2b6331; border-radius: 2px; padding: 0 2px; }

    .edit-error {
      padding: 6px 10px;
      font-size: 11px;
      color: var(--accent-error);
      border-top: 1px solid var(--border-color);
    }

    /* File mentions */
    .file-mention {
      color: var(--accent-primary);
      cursor: pointer;
      text-decoration: none;
      border-radius: 2px;
      transition: background var(--transition-fast);
    }
    .file-mention:hover {
      text-decoration: underline;
      background: rgba(100, 180, 255, 0.1);
    }
    .file-mention.in-context {
      color: var(--text-muted);
    }

    /* File summary section */
    .file-summary {
      margin: 8px 0;
      padding: 8px 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      font-size: 12px;
    }

    .file-summary-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
      color: var(--text-secondary);
      font-weight: 600;
    }

    .file-summary-header .add-all-btn {
      margin-left: auto;
      background: none;
      border: 1px solid var(--accent-primary);
      color: var(--accent-primary);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: 11px;
      transition: background var(--transition-fast);
    }
    .file-summary-header .add-all-btn:hover {
      background: rgba(100, 180, 255, 0.15);
    }

    .file-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .file-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-family: var(--font-mono);
      cursor: pointer;
      transition: background var(--transition-fast);
      border: 1px solid var(--border-color);
    }
    .file-chip.in-context {
      background: var(--bg-surface);
      color: var(--text-muted);
      cursor: pointer;
    }
    .file-chip.not-in-context {
      background: rgba(100, 180, 255, 0.08);
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }
    .file-chip.not-in-context:hover {
      background: rgba(100, 180, 255, 0.18);
    }

    /* Edit summary banner */
    .edit-summary {
      margin: 8px 0;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-size: 12px;
    }
    .edit-summary.success { background: rgba(102,187,106,0.1); border: 1px solid rgba(102,187,106,0.3); }
    .edit-summary.has-failures { background: rgba(239,83,80,0.1); border: 1px solid rgba(239,83,80,0.3); }

    .edit-summary-counts {
      display: flex;
      gap: 12px;
      margin-bottom: 4px;
    }
    .edit-summary-counts span { font-weight: 600; }
    .count-applied { color: var(--accent-success); }
    .count-failed { color: var(--accent-error); }
    .count-skipped { color: var(--text-muted); }

    /* Scroll to bottom button */
    .scroll-to-bottom {
      position: absolute;
      bottom: 12px;
      right: 20px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-md);
      transition: opacity var(--transition-fast);
      z-index: 5;
    }
    .scroll-to-bottom:hover { color: var(--text-primary); background: var(--bg-surface); }

    /* User image thumbnails */
    .user-images {
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .user-image-thumb {
      max-width: 200px;
      max-height: 200px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid var(--border-color);
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .user-image-thumb:hover {
      border-color: var(--accent-primary);
      box-shadow: 0 0 8px rgba(100, 180, 255, 0.2);
    }

    /* Image lightbox overlay */
    .image-lightbox {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0,0,0,0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      outline: none;
    }
    .image-lightbox img {
      max-width: 90vw;
      max-height: 90vh;
      border-radius: var(--radius-md);
      box-shadow: 0 4px 30px rgba(0,0,0,0.5);
    }

    #scroll-sentinel { height: 0; overflow: hidden; }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 14px;
    }
  `;constructor(){super(),this.messages=[],this.streaming=!1,this.streamContent="",this.editResults=[],this.repoFiles=[],this.selectedFiles=new Set,this._userScrolledUp=!1,this._pendingScroll=!1,this._observer=null,this._lightboxSrc=null}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-chunk",this._onStreamChunk.bind(this)),window.addEventListener("stream-complete",this._onStreamComplete.bind(this))}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-chunk",this._onStreamChunk),window.removeEventListener("stream-complete",this._onStreamComplete),this._observer&&this._observer.disconnect()}firstUpdated(){const e=this.shadowRoot.getElementById("scroll-sentinel"),t=this.shadowRoot.querySelector(".messages");e&&t&&(this._observer=new IntersectionObserver(([i])=>{i.isIntersecting&&(this._userScrolledUp=!1)},{root:t,threshold:.1}),this._observer.observe(e),t.addEventListener("wheel",i=>{i.deltaY<0&&(this._userScrolledUp=!0,this.requestUpdate())}))}_onStreamChunk(e){const{content:t}=e.detail;this.streamContent=t,this.streaming=!0,this._scrollToBottom()}_onStreamComplete(e){const{result:t}=e.detail;this.streaming=!1,this.editResults=t.edit_results||[],this.dispatchEvent(new CustomEvent("stream-finished",{detail:t,bubbles:!0,composed:!0})),this.streamContent="",this._scrollToBottom()}_scrollToBottom(){this._userScrolledUp||this._pendingScroll||(this._pendingScroll=!0,this.updateComplete.then(()=>{requestAnimationFrame(()=>{const e=this.shadowRoot.getElementById("scroll-sentinel");e&&e.scrollIntoView({behavior:"auto",block:"end"}),this._pendingScroll=!1})}))}_onScrollToBottomClick(){this._userScrolledUp=!1;const e=this.shadowRoot.getElementById("scroll-sentinel");e&&e.scrollIntoView({behavior:"smooth",block:"end"}),this.requestUpdate()}_getEditResult(e){return this.editResults?this.editResults.find(t=>t.file_path===e):null}render(){const e=this.messages||[],t=e.length>0||this.streaming;return h`
      <div class="messages-wrapper">
        <div class="messages" role="log" aria-label="Conversation messages" aria-live="polite">
          ${t?b:h`
            <div class="empty-state">Send a message to start</div>
          `}

          ${e.map((i,s)=>this._renderMessage(i,s,e.length))}

          ${this.streaming?this._renderStreamingMessage():b}

          <div id="scroll-sentinel" aria-hidden="true"></div>
        </div>

        ${this._userScrolledUp?h`
          <button class="scroll-to-bottom" @click=${this._onScrollToBottomClick}
            aria-label="Scroll to bottom of conversation">↓</button>
        `:b}
      </div>

      ${this._lightboxSrc?h`
        <div class="image-lightbox" role="dialog" aria-label="Image preview"
          @click=${this._closeLightbox} @keydown=${this._onLightboxKeyDown}>
          <img src=${this._lightboxSrc} alt="Enlarged image" @click=${i=>i.stopPropagation()}>
          <span class="sr-only">Press Escape to close</span>
        </div>
      `:b}
    `}_renderMessage(e,t,i){const s=e.role==="user",r=t===(this.messages||[]).length-1,o=i-t<=15,a=l=>h`
      <div class="msg-actions ${l}" role="toolbar" aria-label="Message actions">
        <button class="msg-action-btn" title="Copy to clipboard" aria-label="Copy message to clipboard"
          @click=${c=>this._onCopyMessage(c,e)}>📋</button>
        <button class="msg-action-btn" title="Copy to prompt" aria-label="Copy message to input"
          @click=${()=>this._onCopyToPrompt(e)}>↩</button>
      </div>
    `;return h`
      <div class="message-card ${e.role} ${o?"force-visible":""}" role="article"
        aria-label="${s?"Your message":"Assistant response"}">
        ${a("top")}
        <div class="role-label" aria-hidden="true">${s?"You":"Assistant"}</div>
        ${s?h`<div class="md-content" @click=${this._onUserContentClick}>${Ut(this._renderUserContent(e))}</div>`:this._renderAssistantContent(e.content,r,!0)}
        ${a("bottom")}
      </div>
    `}_renderUserContent(e){const t=e.content;let i="";if(typeof t=="string"?i=t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>"):Array.isArray(t)?i=t.map(s=>s.type==="text"?s.text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>"):s.type==="image_url"?`<img class="user-image-thumb" src="${s.image_url.url}" title="Click to enlarge">`:"").join(""):i=String(t),e.images&&e.images.length>0){const s=e.images.map(r=>`<img class="user-image-thumb" src="${r}" title="Click to enlarge">`).join("");i+=`<div class="user-images">${s}</div>`}return i}_renderAssistantContent(e,t,i){const s=Io(e),r=t?this.editResults:[];let o=[];return h`
      <div class="md-content" @click=${this._onMdContentClick}>
        ${s.map(a=>{if(a.type==="text"){if(i&&this.repoFiles?.length>0){const l=es(a.content),{html:c,files:p}=this._detectFileMentions(l,a.content);return o.push(...p),h`${Ut(c)}`}return h`${Ut(es(a.content))}`}if(a.type==="edit"){const l=r.find(c=>c.file_path===a.filePath);return i&&a.filePath&&o.push(a.filePath),this._renderEditBlock(a,l)}return a.type==="edit-pending"?this._renderEditBlock(a,{status:"pending"}):b})}
        ${t&&r.length>0?this._renderEditSummary(r):b}
        ${i?this._renderFileSummary([...new Set(o)]):b}
      </div>
    `}_renderEditBlock(e,t){const i=Lo(e.oldLines||[],e.newLines||[]),s=t?.status||(e.isCreate?"new":"");return h`
      <div class="edit-block" role="region" aria-label="Edit block for ${e.filePath}">
        <div class="edit-header">
          <span class="edit-file-path" role="link" tabindex="0"
            @click=${()=>this._onEditFileClick(e.filePath)}
            @keydown=${r=>{(r.key==="Enter"||r.key===" ")&&(r.preventDefault(),this._onEditFileClick(e.filePath))}}>
            ${e.filePath}
          </span>
          ${s?h`<span class="edit-badge ${s}" role="status">${s}</span>`:b}
        </div>
        <div class="edit-diff">
          ${i.map(r=>this._renderDiffLine(r))}
        </div>
        ${t?.error?h`<div class="edit-error">⚠ ${t.error}</div>`:b}
      </div>
    `}_renderDiffLine(e){const t=e.type==="remove"?"-":e.type==="add"?"+":" ";return e.charDiff&&e.charDiff.length>0?h`<span class="diff-line ${e.type}"><span class="diff-line-prefix">${t}</span>${e.charDiff.map(i=>i.type==="equal"?i.text:h`<span class="diff-change">${i.text}</span>`)}</span>`:h`<span class="diff-line ${e.type}"><span class="diff-line-prefix">${t}</span>${e.text}</span>`}_renderEditSummary(e){const t=e.filter(r=>r.status==="applied").length,i=e.filter(r=>r.status==="failed").length,s=e.filter(r=>r.status==="skipped").length;return t===0&&i===0&&s===0?b:h`
      <div class="edit-summary ${i>0?"has-failures":"success"}">
        <div class="edit-summary-counts">
          ${t?h`<span class="count-applied">✓ ${t} applied</span>`:b}
          ${i?h`<span class="count-failed">✗ ${i} failed</span>`:b}
          ${s?h`<span class="count-skipped">⊘ ${s} skipped</span>`:b}
        </div>
      </div>
    `}_renderStreamingMessage(){return h`
      <div class="message-card assistant streaming" role="article" aria-label="Assistant response (streaming)" aria-busy="true">
        <div class="role-label" aria-hidden="true">Assistant</div>
        ${this._renderAssistantContent(this.streamContent,!1,!1)}
      </div>
    `}_detectFileMentions(e,t){if(!this.repoFiles||this.repoFiles.length===0)return{html:e,files:[]};const i=this.repoFiles.filter(_=>t.includes(_));if(i.length===0)return{html:e,files:[]};i.sort((_,v)=>v.length-_.length);const s=new Set,r=[],o=/<pre[\s>][\s\S]*?<\/pre>/gi;let a=0,l;for(o.lastIndex=0;(l=o.exec(e))!==null;)l.index>a&&r.push({text:e.slice(a,l.index),safe:!0}),r.push({text:l[0],safe:!1}),a=l.index+l[0].length;a<e.length&&r.push({text:e.slice(a),safe:!0});const c=i.map(_=>_.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),p=new RegExp("(?<![\\w/])(?:"+c.join("|")+")(?![\\w/])","g"),u=this.selectedFiles instanceof Set?this.selectedFiles:new Set(this.selectedFiles||[]);return{html:r.map(_=>_.safe?_.text.replace(p,(v,E,M)=>{const I=M.slice(0,E),P=I.lastIndexOf("<"),G=I.lastIndexOf(">");if(P>G)return v;const C=I.slice(Math.max(0,I.length-200));return C.includes('class="file-mention')&&!C.includes("</span>")?v:(s.add(v),`<span class="file-mention${u.has(v)?" in-context":""}" data-file="${v}">${v}</span>`)}):_.text).join(""),files:[...s]}}_renderFileSummary(e){if(!e||e.length===0)return b;const t=this.selectedFiles instanceof Set?this.selectedFiles:new Set(this.selectedFiles||[]),i=e.filter(s=>!t.has(s));return h`
      <div class="file-summary" role="region" aria-label="Files referenced in this response">
        <div class="file-summary-header">
          <span>📁 Files Referenced</span>
          ${i.length>=2?h`
            <button class="add-all-btn"
              aria-label="Add all ${i.length} files to context"
              @click=${()=>this._onAddAllFiles(i)}>
              + Add All (${i.length})
            </button>
          `:b}
        </div>
        <div class="file-chips">
          ${e.map(s=>{const r=t.has(s);return h`
              <span class="file-chip ${r?"in-context":"not-in-context"}"
                @click=${()=>this._onFileMentionClick(s)}>
                ${r?"✓":"+"} ${s}
              </span>
            `})}
        </div>
      </div>
    `}_onFileMentionClick(e){this.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:e},bubbles:!0,composed:!0}))}_onAddAllFiles(e){for(const t of e)this.dispatchEvent(new CustomEvent("file-mention-click",{detail:{path:t},bubbles:!0,composed:!0}))}_onUserContentClick(e){const t=e.target.closest(".user-image-thumb");t&&(e.preventDefault(),this._lightboxSrc=t.src,this.requestUpdate(),this.updateComplete.then(()=>{this.shadowRoot.querySelector(".image-lightbox")?.focus()}))}_onLightboxKeyDown(e){e.key==="Escape"&&(e.preventDefault(),this._closeLightbox())}_closeLightbox(){this._lightboxSrc=null,this.requestUpdate()}_onMdContentClick(e){const t=e.target.closest(".user-image-thumb");if(t){e.preventDefault(),this._lightboxSrc=t.src,this.requestUpdate(),this.updateComplete.then(()=>{this.shadowRoot.querySelector(".image-lightbox")?.focus()});return}const i=e.target.closest(".code-copy-btn");if(i){e.preventDefault();const r=i.closest("pre");if(r){const o=r.querySelector("code"),a=o?o.textContent:r.textContent;navigator.clipboard.writeText(a).then(()=>{i.textContent="✓ Copied",i.classList.add("copied"),setTimeout(()=>{i.textContent="📋",i.classList.remove("copied")},1500)}).catch(()=>{i.textContent="✗ Failed",setTimeout(()=>{i.textContent="📋"},1500)})}return}const s=e.target.closest(".file-mention");if(s){const r=s.dataset.file;r&&this._onFileMentionClick(r)}}_getMessageText(e){return typeof e.content=="string"?e.content:Array.isArray(e.content)?e.content.filter(t=>t.type==="text").map(t=>t.text).join(`
`):String(e.content||"")}_onCopyMessage(e,t){const i=e.currentTarget,s=this._getMessageText(t);navigator.clipboard.writeText(s).then(()=>{i.textContent="✓",i.classList.add("copied"),setTimeout(()=>{i.textContent="📋",i.classList.remove("copied")},1500)}).catch(()=>{i.textContent="✗",setTimeout(()=>{i.textContent="📋"},1500)})}_onCopyToPrompt(e){const t=this._getMessageText(e);this.dispatchEvent(new CustomEvent("copy-to-prompt",{detail:{text:t},bubbles:!0,composed:!0}))}_onEditFileClick(e){this.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:e},bubbles:!0,composed:!0}))}scrollToBottom(){this._userScrolledUp=!1;let e=0,t=0;const i=()=>{const s=this.shadowRoot?.querySelector(".messages");s&&(s.scrollTop=s.scrollHeight,e++<20&&s.scrollHeight!==t&&(t=s.scrollHeight,requestAnimationFrame(i)))};this.updateComplete.then(()=>requestAnimationFrame(i))}scrollToBottomIfAtBottom(){this._scrollToBottom()}}customElements.define("chat-panel",Do);class zo extends Z{static properties={_state:{type:String,state:!0},_supported:{type:Boolean,state:!0}};static styles=te`
    :host {
      display: inline-flex;
    }

    button {
      background: none;
      border: 1px solid var(--border-color, #444);
      border-radius: var(--radius-sm, 4px);
      padding: 4px 8px;
      cursor: pointer;
      font-size: 16px;
      color: var(--text-secondary, #aaa);
      transition: background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    button:hover {
      background: var(--bg-surface, #2a2a2a);
      color: var(--text-primary, #eee);
    }

    button.listening {
      color: #f59e0b;
      border-color: #f59e0b;
      animation: pulse 1.5s ease-in-out infinite;
    }

    button.speaking {
      color: #22c55e;
      border-color: #22c55e;
      animation: none;
      box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    button:disabled {
      display: none;
    }
  `;constructor(){super(),this._state="inactive",this._autoRestart=!1,this._recognition=null;const e=window.SpeechRecognition||window.webkitSpeechRecognition;this._supported=!!e,this._supported&&(this._recognition=new e,this._recognition.continuous=!1,this._recognition.interimResults=!1,this._recognition.lang=navigator.language,this._recognition.onstart=()=>{this._state="listening"},this._recognition.onspeechstart=()=>{this._state="speaking"},this._recognition.onspeechend=()=>{this._state==="speaking"&&(this._state="listening")},this._recognition.onresult=t=>{const i=t.results[t.results.length-1];if(i.isFinal){const s=i[0].transcript.trim();s&&this.dispatchEvent(new CustomEvent("transcript",{detail:{text:s},bubbles:!0,composed:!0}))}},this._recognition.onend=()=>{this._handleEnd()},this._recognition.onerror=t=>{this._autoRestart&&(t.error==="no-speech"||t.error==="aborted")||(console.warn("[SpeechToText] Recognition error:",t.error),this._autoRestart=!1,this._state="inactive",this.dispatchEvent(new CustomEvent("recognition-error",{detail:{error:t.error},bubbles:!0,composed:!0})))})}disconnectedCallback(){if(super.disconnectedCallback(),this._autoRestart=!1,this._recognition)try{this._recognition.stop()}catch{}this._state="inactive"}_handleEnd(){this._autoRestart?setTimeout(()=>{if(this._autoRestart)try{this._recognition.start()}catch(e){console.warn("[SpeechToText] Auto-restart failed:",e),this._autoRestart=!1,this._state="inactive"}},100):this._state="inactive"}_toggle(){if(this._recognition)if(this._autoRestart||this._state!=="inactive"){this._autoRestart=!1;try{this._recognition.stop()}catch{}this._state="inactive"}else{this._autoRestart=!0;try{this._recognition.start()}catch(e){console.warn("[SpeechToText] Failed to start:",e),this._autoRestart=!1,this._state="inactive"}}}render(){return this._supported?h`
      <button
        class=${this._state}
        @click=${this._toggle}
        title=${this._state==="inactive"?"Start voice dictation":"Stop voice dictation"}
        aria-label=${this._state==="inactive"?"Start voice dictation":"Stop voice dictation"}
        aria-pressed=${this._state!=="inactive"}
      >🎤</button>
    `:h``}}customElements.define("speech-to-text",zo);const Po=5*1024*1024,Fo=5,Bo=300;class Uo extends le(Z){static properties={disabled:{type:Boolean},snippets:{type:Array},userMessageHistory:{type:Array},_images:{type:Array,state:!0},_showSnippets:{type:Boolean,state:!0},_showHistorySearch:{type:Boolean,state:!0},_historySearchQuery:{type:String,state:!0},_historySearchResults:{type:Array,state:!0},_historySearchIndex:{type:Number,state:!0},_savedInputBeforeHistory:{type:String,state:!0}};static styles=te`
    :host {
      display: block;
      border-top: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .input-area {
      display: flex;
      flex-direction: column;
      padding: 8px 12px;
      gap: 6px;
    }

    .images-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .image-thumb {
      position: relative;
      width: 60px;
      height: 60px;
      border-radius: var(--radius-sm);
      overflow: hidden;
      border: 1px solid var(--border-color);
    }

    .image-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .image-remove {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--accent-error);
      color: white;
      border: none;
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    .input-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }

    .input-tools {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex-shrink: 0;
    }

    .snippet-toggle {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 6px 8px;
      cursor: pointer;
      color: var(--text-secondary);
      font-size: 14px;
      flex-shrink: 0;
      transition: background var(--transition-fast);
    }
    .snippet-toggle:hover { background: var(--bg-surface); }
    .snippet-toggle.active { background: var(--bg-surface); color: var(--accent-primary); }

    textarea {
      flex: 1;
      min-height: 38px;
      max-height: 200px;
      padding: 8px 10px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13.5px;
      line-height: 1.4;
      resize: none;
      outline: none;
      overflow-y: auto;
    }

    textarea:focus { border-color: var(--accent-primary); }
    textarea:disabled { opacity: 0.5; cursor: not-allowed; }

    textarea::placeholder { color: var(--text-muted); }

    .send-btn {
      background: var(--accent-primary);
      border: none;
      border-radius: var(--radius-sm);
      padding: 8px 14px;
      color: var(--bg-primary);
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity var(--transition-fast);
    }
    .send-btn:hover { opacity: 0.9; }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }

    .stop-btn {
      background: var(--accent-error, #ef5350);
      border: none;
      border-radius: var(--radius-sm);
      padding: 8px 14px;
      color: white;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity var(--transition-fast);
    }
    .stop-btn:hover { opacity: 0.85; }

    /* Snippet drawer */
    .snippet-drawer {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 6px 0;
    }

    .snippet-btn {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 4px 8px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-secondary);
      transition: background var(--transition-fast);
      white-space: nowrap;
    }
    .snippet-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }

    /* Input history search overlay */
    .history-overlay {
      position: absolute;
      bottom: 100%;
      left: 12px;
      right: 12px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      max-height: 340px;
      display: flex;
      flex-direction: column;
      z-index: 50;
    }

    .history-search-input {
      padding: 8px 10px;
      background: var(--bg-primary);
      border: none;
      border-bottom: 1px solid var(--border-color);
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 12.5px;
      outline: none;
    }
    .history-search-input::placeholder { color: var(--text-muted); }

    .history-results {
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    .history-item {
      padding: 8px 12px;
      font-size: 12.5px;
      color: var(--text-secondary);
      cursor: pointer;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .history-item:last-child { border-bottom: none; }
    .history-item:hover { background: var(--bg-surface); }
    .history-item.selected { background: var(--bg-surface); color: var(--accent-primary); }
  `;constructor(){super(),this.disabled=!1,this.snippets=[],this.userMessageHistory=[],this._images=[],this._showSnippets=!1,this._showHistorySearch=!1,this._historySearchQuery="",this._historySearchResults=[],this._historySearchIndex=0,this._savedInputBeforeHistory=void 0,this._urlDetectTimer=null,this._lastDetectedText=""}_onInput(e){this._autoResize(e.target),this._scheduleUrlDetection(e.target.value)}_scheduleUrlDetection(e){this._urlDetectTimer&&clearTimeout(this._urlDetectTimer),this._urlDetectTimer=setTimeout(()=>{this._urlDetectTimer=null,this._detectUrls(e)},Bo)}async _detectUrls(e){if(!(!e||e===this._lastDetectedText)&&this.rpcConnected){this._lastDetectedText=e;try{const t=await this.rpcExtract("LLM.detect_urls",e);Array.isArray(t)&&this.dispatchEvent(new CustomEvent("urls-detected",{detail:{urls:t},bubbles:!0,composed:!0}))}catch{}}}_autoResize(e){e.style.height="auto",e.style.height=Math.min(e.scrollHeight,200)+"px"}_onKeyDown(e){const t=e.target;if(!this._showHistorySearch){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(),this._send();return}if(e.key==="Escape"){if(this._showSnippets){this._showSnippets=!1;return}t.value="",this._autoResize(t);return}if(e.key==="ArrowUp"&&t.selectionStart===0&&t.selectionEnd===0){this._openHistorySearch(),e.preventDefault();return}e.key==="ArrowDown"&&this._savedInputBeforeHistory!==void 0&&t.selectionStart===t.value.length&&(t.value=this._savedInputBeforeHistory,this._savedInputBeforeHistory=void 0,this._autoResize(t),e.preventDefault())}}_send(){const e=this.shadowRoot.querySelector("textarea");!e||!e.value.trim()&&this._images.length===0||this.disabled||(this.dispatchEvent(new CustomEvent("send-message",{detail:{message:e.value,images:[...this._images]},bubbles:!0,composed:!0})),e.value="",this._images=[],this._autoResize(e),this._showSnippets=!1,this._showHistorySearch=!1,this._savedInputBeforeHistory=void 0,this._lastDetectedText="",this._urlDetectTimer&&(clearTimeout(this._urlDetectTimer),this._urlDetectTimer=null))}_stop(){this.dispatchEvent(new CustomEvent("stop-streaming",{bubbles:!0,composed:!0}))}_onPaste(e){const t=e.clipboardData?.items;if(t){for(const i of t)if(i.type.startsWith("image/")){e.preventDefault();const s=i.getAsFile();if(!s)continue;if(s.size>Po){console.warn("Image too large (>5MB)");continue}if(this._images.length>=Fo){console.warn("Maximum images reached");continue}const r=new FileReader;r.onload=()=>{this._images=[...this._images,r.result]},r.readAsDataURL(s);break}}}_removeImage(e){this._images=this._images.filter((t,i)=>i!==e)}_onTranscript(e){const{text:t}=e.detail;if(!t)return;const i=this.shadowRoot.querySelector("textarea");i&&(i.value&&!i.value.endsWith(" ")?i.value+=" "+t:i.value+=t,this._autoResize(i),this._scheduleUrlDetection(i.value))}_toggleSnippets(){this._showSnippets=!this._showSnippets,this._showHistory=!1}_insertSnippet(e){const t=this.shadowRoot.querySelector("textarea");if(!t)return;const i=t.selectionStart,s=t.value.substring(0,i),r=t.value.substring(t.selectionEnd);t.value=s+e+r,t.selectionStart=t.selectionEnd=i+e.length,this._autoResize(t),this._showSnippets=!1,t.focus()}_getUserMessageHistory(){return!this.userMessageHistory||this.userMessageHistory.length===0?[]:this.userMessageHistory}_openHistorySearch(){const e=this._getUserMessageHistory();if(e.length===0)return;const t=this.shadowRoot.querySelector("textarea");this._savedInputBeforeHistory=t?.value||"",this._historySearchQuery="",this._historySearchResults=[...e].reverse().slice(-20),this._historySearchIndex=this._historySearchResults.length-1,this._showHistorySearch=!0,this._showSnippets=!1,this.updateComplete.then(()=>{this.shadowRoot.querySelector(".history-search-input")?.focus(),this._scrollHistoryToBottom()})}_onHistorySearchInput(e){const t=e.target.value;this._historySearchQuery=t,this._filterHistoryResults(t),this._historySearchIndex=this._historySearchResults.length-1,this.updateComplete.then(()=>this._scrollHistoryToBottom())}_filterHistoryResults(e){const t=this._getUserMessageHistory();if(!e.trim()){this._historySearchResults=[...t].reverse().slice(-20);return}const i=e.toLowerCase(),s=[];for(const r of t){const o=r.toLowerCase(),a=o.indexOf(i);a!==-1?s.push({msg:r,score:1e3-a}):this._fuzzyMatch(i,o)&&s.push({msg:r,score:0})}s.sort((r,o)=>o.score-r.score),this._historySearchResults=s.slice(0,20).map(r=>r.msg).reverse()}_fuzzyMatch(e,t){let i=0;for(let s=0;s<t.length&&i<e.length;s++)t[s]===e[i]&&i++;return i===e.length}_onHistorySearchKeyDown(e){if(e.key==="ArrowUp"){e.preventDefault(),this._historySearchIndex>0&&this._historySearchIndex--,this._scrollHistoryItemIntoView();return}if(e.key==="ArrowDown"){if(e.preventDefault(),this._historySearchIndex<this._historySearchResults.length-1)this._historySearchIndex++;else{this._restoreAndClose();return}this._scrollHistoryItemIntoView();return}if(e.key==="Enter"){e.preventDefault(),this._selectHistoryResult();return}if(e.key==="Escape"){e.preventDefault(),this._restoreAndClose();return}}_scrollHistoryItemIntoView(){this.updateComplete.then(()=>{this.shadowRoot.querySelector(".history-item.selected")?.scrollIntoView({block:"nearest"})})}_scrollHistoryToBottom(){const e=this.shadowRoot.querySelector(".history-results");e&&(e.scrollTop=e.scrollHeight)}_restoreAndClose(){const e=this.shadowRoot.querySelector("textarea");e&&this._savedInputBeforeHistory!==void 0&&(e.value=this._savedInputBeforeHistory,this._autoResize(e)),this._savedInputBeforeHistory=void 0,this._showHistorySearch=!1,this.updateComplete.then(()=>{this.shadowRoot.querySelector("textarea")?.focus()})}_selectHistoryResult(){const e=this._historySearchResults;if(this._historySearchIndex>=0&&this._historySearchIndex<e.length){const t=this.shadowRoot.querySelector("textarea");t&&(t.value=e[this._historySearchIndex],this._autoResize(t))}this._showHistorySearch=!1,this.updateComplete.then(()=>{this.shadowRoot.querySelector("textarea")?.focus()})}_closeHistorySearch(){this._restoreAndClose()}focus(){this.updateComplete.then(()=>{this.shadowRoot.querySelector("textarea")?.focus()})}clear(){const e=this.shadowRoot.querySelector("textarea");e&&(e.value="",this._autoResize(e)),this._images=[],this._lastDetectedText="",this._urlDetectTimer&&(clearTimeout(this._urlDetectTimer),this._urlDetectTimer=null)}render(){return h`
      <div class="input-area" style="position:relative;" role="region" aria-label="Chat input">

        ${this._showHistorySearch?h`
          <div class="history-overlay" role="listbox" aria-label="Message history">
            <input class="history-search-input"
              type="text"
              placeholder="Search message history…"
              aria-label="Search message history"
              aria-controls="history-results-list"
              aria-activedescendant=${this._historySearchIndex>=0?`history-item-${this._historySearchIndex}`:b}
              .value=${this._historySearchQuery}
              @input=${this._onHistorySearchInput}
              @keydown=${this._onHistorySearchKeyDown}
            >
            <div class="history-results" id="history-results-list" role="group">
              ${this._historySearchResults.length===0?h`
                <div class="history-item" style="color:var(--text-muted); cursor:default;" role="option" aria-disabled="true">
                  No matches
                </div>
              `:this._historySearchResults.map((e,t)=>h`
                <div class="history-item ${t===this._historySearchIndex?"selected":""}"
                  id="history-item-${t}"
                  role="option"
                  aria-selected=${t===this._historySearchIndex}
                  @click=${()=>{this._historySearchIndex=t,this._selectHistoryResult()}}>
                  ${e.length>120?e.substring(0,120)+"…":e}
                </div>
              `)}
            </div>
          </div>
        `:b}

        ${this._images.length>0?h`
          <div class="images-row" role="list" aria-label="Attached images">
            ${this._images.map((e,t)=>h`
              <div class="image-thumb" role="listitem">
                <img src=${e} alt="Pasted image ${t+1}">
                <button class="image-remove" @click=${()=>this._removeImage(t)}
                  aria-label="Remove image ${t+1}">×</button>
              </div>
            `)}
          </div>
        `:b}

        ${this._showSnippets&&this.snippets.length>0?h`
          <div class="snippet-drawer" role="toolbar" aria-label="Quick insert snippets">
            ${this.snippets.map(e=>h`
              <button class="snippet-btn" title=${e.tooltip||e.message}
                aria-label="${e.tooltip||e.message.substring(0,60)}"
                @click=${()=>this._insertSnippet(e.message)}>
                ${e.icon} ${e.tooltip||e.message.substring(0,30)}
              </button>
            `)}
          </div>
        `:b}

        <div class="input-row">
          <div class="input-tools">
            <speech-to-text @transcript=${this._onTranscript}></speech-to-text>
            ${this.snippets.length>0?h`
              <button class="snippet-toggle ${this._showSnippets?"active":""}"
                @click=${this._toggleSnippets} title="Snippets"
                aria-label="Toggle snippet drawer"
                aria-expanded=${this._showSnippets}>💡</button>
            `:b}
          </div>

          <textarea
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            aria-label="Chat message input"
            ?disabled=${this.disabled}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
            @paste=${this._onPaste}
            rows="1"
          ></textarea>

          ${this.disabled?h`
            <button class="stop-btn" @click=${this._stop} aria-label="Stop streaming response">
              ⏹ Stop
            </button>
          `:h`
            <button class="send-btn" @click=${this._send} aria-label="Send message">
              Send
            </button>
          `}
        </div>
        <span class="sr-only" aria-live="polite" id="input-status">
          ${this.disabled?"Waiting for response...":""}
        </span>
      </div>
    `}}customElements.define("chat-input",Uo);class Ct extends le(Z){static properties={detected:{type:Array},fetched:{type:Array},excluded:{type:Object},_fetching:{type:Object,state:!0}};static styles=te`
    :host {
      display: block;
    }

    .chips-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 12px;
      border-top: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.4;
      border: 1px solid var(--border-color);
      background: var(--bg-surface);
      color: var(--text-secondary);
      max-width: 320px;
    }

    .chip.fetched {
      border-color: var(--accent-success);
      background: rgba(102, 187, 106, 0.08);
    }

    .chip.fetched.excluded {
      border-color: var(--border-color);
      background: var(--bg-surface);
      opacity: 0.6;
    }

    .chip.fetched.error {
      border-color: var(--accent-error);
      background: rgba(239, 83, 80, 0.08);
    }

    .chip.fetching {
      border-color: var(--accent-warning);
      background: rgba(255, 167, 38, 0.08);
    }

    .type-badge {
      font-size: 11px;
      flex-shrink: 0;
    }

    .chip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .chip-label.clickable {
      cursor: pointer;
    }
    .chip-label.clickable:hover {
      color: var(--accent-primary);
      text-decoration: underline;
    }

    .chip-btn {
      background: none;
      border: none;
      padding: 0 2px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-muted);
      flex-shrink: 0;
      line-height: 1;
    }
    .chip-btn:hover {
      color: var(--text-primary);
    }

    .chip-checkbox {
      width: 13px;
      height: 13px;
      flex-shrink: 0;
      cursor: pointer;
      accent-color: var(--accent-success);
    }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent-warning);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;static TYPE_ICONS={github_repo:"📦",github_file:"📄",github_issue:"🐛",github_pr:"🔀",documentation:"📖",generic:"🔗"};constructor(){super(),this.detected=[],this.fetched=[],this.excluded=new Set,this._fetching=new Set}async _fetchUrl(e){if(!this._fetching.has(e)){this._fetching=new Set([...this._fetching,e]);try{const t=await this.rpcExtract("LLM.fetch_url",e,!0,!0,"");this.dispatchEvent(new CustomEvent("url-fetched",{detail:{url:e,result:t},bubbles:!0,composed:!0}))}catch(t){console.error("URL fetch failed:",t),this.dispatchEvent(new CustomEvent("url-fetched",{detail:{url:e,result:{url:e,error:String(t)}},bubbles:!0,composed:!0}))}finally{const t=new Set(this._fetching);t.delete(e),this._fetching=t}}}_dismiss(e){this.dispatchEvent(new CustomEvent("url-dismissed",{detail:{url:e},bubbles:!0,composed:!0}))}_remove(e){this.dispatchEvent(new CustomEvent("url-removed",{detail:{url:e},bubbles:!0,composed:!0}))}_toggleExclude(e){this.dispatchEvent(new CustomEvent("url-toggle-exclude",{detail:{url:e},bubbles:!0,composed:!0}))}_viewContent(e){this.dispatchEvent(new CustomEvent("url-view-content",{detail:{url:e},bubbles:!0,composed:!0}))}render(){const e=this.detected.length>0,t=this.fetched.length>0,i=this._fetching.size>0;return!e&&!t&&!i?b:h`
      <div class="chips-row" role="list" aria-label="URL references">
        ${this.fetched.map(s=>this._renderFetchedChip(s))}
        ${this.detected.map(s=>this._renderDetectedChip(s))}
      </div>
    `}_renderDetectedChip(e){const t=this._fetching.has(e.url),i=Ct.TYPE_ICONS[e.url_type]||"🔗";return h`
      <span class="chip ${t?"fetching":""}" role="listitem">
        <span class="type-badge" aria-hidden="true">${i}</span>
        <span class="chip-label">${e.display_name||e.url}</span>
        ${t?h`<span class="spinner" aria-label="Fetching"></span>`:h`<button class="chip-btn" title="Fetch" aria-label="Fetch ${e.display_name||e.url}" @click=${()=>this._fetchUrl(e.url)}>📥</button>`}
        <button class="chip-btn" title="Dismiss" aria-label="Dismiss ${e.display_name||e.url}" @click=${()=>this._dismiss(e.url)}>×</button>
      </span>
    `}_renderFetchedChip(e){const t=this.excluded.has(e.url),i=!!e.error,s=Ct.TYPE_ICONS[e.url_type]||"🔗";return h`
      <span class="chip fetched ${t?"excluded":""} ${i?"error":""}" role="listitem">
        ${i?b:h`
          <input type="checkbox"
            class="chip-checkbox"
            .checked=${!t}
            @change=${()=>this._toggleExclude(e.url)}
            title=${t?"Include in context":"Exclude from context"}
            aria-label="${t?"Include":"Exclude"} ${e.title||e.display_name||e.url} ${t?"in":"from"} context"
          >
        `}
        <span class="type-badge" aria-hidden="true">${i?"⚠️":s}</span>
        <span class="chip-label clickable"
          role="button"
          title=${e.url}
          @click=${()=>this._viewContent(e.url)}>
          ${e.title||e.display_name||e.url}
        </span>
        <button class="chip-btn" title="Remove" aria-label="Remove ${e.title||e.display_name||e.url}" @click=${()=>this._remove(e.url)}>×</button>
      </span>
    `}}customElements.define("url-chips",Ct);class Ho extends le(Z){static properties={tree:{type:Object},modified:{type:Array},staged:{type:Array},untracked:{type:Array},diffStats:{type:Object},selectedFiles:{type:Object},_filter:{type:String,state:!0},_expanded:{type:Object,state:!0},_focused:{type:String,state:!0},_contextMenu:{type:Object,state:!0},_autoSelected:{type:Boolean,state:!0},viewerActiveFile:{type:String}};static styles=te`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      font-size: 12.5px;
      --indent: 16px;
    }

    /* ── Filter bar ── */
    .filter-bar {
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }

    .filter-bar input {
      width: 100%;
      padding: 4px 8px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
      outline: none;
      font-family: var(--font-sans);
    }
    .filter-bar input:focus { border-color: var(--accent-primary); }
    .filter-bar input::placeholder { color: var(--text-muted); }

    /* ── Tree container ── */
    .tree-container {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 4px 0;
    }

    /* ── Tree node row ── */
    .node-row {
      display: flex;
      align-items: center;
      padding: 2px 8px 2px 0;
      cursor: default;
      user-select: none;
      white-space: nowrap;
      min-height: 24px;
      border-left: 2px solid transparent;
      transition: background var(--transition-fast);
    }
    .node-row:hover { background: var(--bg-surface); }
    .node-row.focused {
      background: var(--bg-surface);
      border-left-color: var(--accent-primary);
    }
    .node-row.active-in-viewer {
      background: rgba(100, 180, 255, 0.08);
      border-left-color: var(--accent-primary);
    }
    .node-row.active-in-viewer:hover {
      background: rgba(100, 180, 255, 0.14);
    }

    /* Indent spacer */
    .indent { flex-shrink: 0; }

    /* Expand toggle */
    .toggle {
      width: 18px;
      flex-shrink: 0;
      text-align: center;
      font-size: 10px;
      color: var(--text-muted);
      cursor: pointer;
      line-height: 1;
    }
    .toggle:hover { color: var(--text-primary); }

    /* Checkbox */
    .node-check {
      width: 14px;
      height: 14px;
      margin-right: 4px;
      flex-shrink: 0;
      cursor: pointer;
      accent-color: var(--accent-primary);
    }

    /* Name */
    .node-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-primary);
    }
    .node-name.dir { font-weight: 600; color: var(--text-secondary); }
    .node-name.file-click { cursor: pointer; }
    .node-name.file-click:hover { color: var(--accent-primary); text-decoration: underline; }

    /* Line count */
    .line-count {
      font-size: 10px;
      margin-left: 6px;
      flex-shrink: 0;
      font-family: var(--font-mono);
    }
    .line-count.green { color: var(--accent-success); }
    .line-count.orange { color: var(--accent-warning); }
    .line-count.red { color: var(--accent-error); }

    /* Git status badge */
    .git-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 0 4px;
      border-radius: 3px;
      margin-left: 4px;
      flex-shrink: 0;
      line-height: 1.5;
    }
    .git-badge.modified { background: rgba(255,167,38,0.2); color: var(--accent-warning); }
    .git-badge.staged { background: rgba(102,187,106,0.2); color: var(--accent-success); }
    .git-badge.untracked { background: rgba(102,187,106,0.2); color: var(--accent-success); }

    /* Diff stats */
    .diff-stats {
      font-size: 10px;
      margin-left: 4px;
      flex-shrink: 0;
      font-family: var(--font-mono);
    }
    .diff-add { color: var(--accent-success); }
    .diff-del { color: var(--accent-error); }

    /* ── Context menu ── */
    .context-menu {
      position: fixed;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-lg);
      z-index: 200;
      min-width: 160px;
      padding: 4px 0;
      font-size: 12px;
    }
    .context-item {
      padding: 5px 14px;
      cursor: pointer;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .context-item:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .context-item.danger { color: var(--accent-error); }
    .context-item.danger:hover { background: rgba(239,83,80,0.1); }
    .context-sep {
      height: 1px;
      background: var(--border-color);
      margin: 4px 0;
    }

    /* ── Confirm/prompt overlay ── */
    .overlay-backdrop {
      position: fixed;
      inset: 0;
      z-index: 250;
    }
    .overlay-dialog {
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      padding: 16px 20px;
      z-index: 260;
      min-width: 280px;
    }
    .overlay-dialog p {
      margin: 0 0 12px 0;
      color: var(--text-primary);
      font-size: 13px;
    }
    .overlay-dialog input {
      width: 100%;
      padding: 6px 8px;
      margin-bottom: 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 13px;
      outline: none;
      box-sizing: border-box;
    }
    .overlay-dialog input:focus { border-color: var(--accent-primary); }
    .overlay-btns {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .overlay-btns button {
      padding: 5px 14px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 12px;
    }
    .overlay-btns button.primary {
      background: var(--accent-primary);
      color: var(--bg-primary);
      border-color: var(--accent-primary);
    }
    .overlay-btns button.danger {
      background: var(--accent-error);
      color: white;
      border-color: var(--accent-error);
    }

    .empty-tree {
      padding: 20px;
      color: var(--text-muted);
      text-align: center;
      font-size: 13px;
    }
  `;constructor(){super(),this.tree=null,this.modified=[],this.staged=[],this.untracked=[],this.diffStats={},this.selectedFiles=new Set,this._filter="",this._expanded=new Set,this._focused="",this._contextMenu=null,this._autoSelected=!1,this._overlayState=null,this.viewerActiveFile="",this._flatVisibleCache=null,this._onDocClick=this._onDocClick.bind(this),this._onDocKeydown=this._onDocKeydown.bind(this)}connectedCallback(){super.connectedCallback(),document.addEventListener("click",this._onDocClick,!0),document.addEventListener("keydown",this._onDocKeydown)}disconnectedCallback(){super.disconnectedCallback(),document.removeEventListener("click",this._onDocClick,!0),document.removeEventListener("keydown",this._onDocKeydown)}willUpdate(e){(e.has("tree")||e.has("_filter")||e.has("_expanded"))&&(this._flatVisibleCache=null),e.has("tree")&&this.tree&&!this._autoSelected&&(this._autoSelected=!0,this._autoSelect())}_autoSelect(){const e=new Set([...this.modified||[],...this.staged||[],...this.untracked||[]]);if(e.size!==0){this.selectedFiles=new Set(e);for(const t of e)this._expandParents(t);this._emitSelection()}}_expandParents(e){const t=e.split("/");for(let i=1;i<t.length;i++)this._expanded.add(t.slice(0,i).join("/"));this._expanded=new Set(this._expanded)}_onFilterInput(e){this._filter=e.target.value}_matchesFilter(e){if(!this._filter)return!0;const t=this._filter.toLowerCase();return e.path.toLowerCase().includes(t)?!0:e.type==="dir"?(e.children||[]).some(i=>this._matchesFilter(i)):!1}_toggleSelect(e,t,i){const s=new Set(this.selectedFiles);if(t){const r=this._collectFiles(i);r.every(a=>s.has(a))?r.forEach(a=>s.delete(a)):r.forEach(a=>s.add(a))}else s.has(e)?s.delete(e):s.add(e);this.selectedFiles=s,this._emitSelection()}_collectFiles(e){const t=[],i=s=>{for(const r of s)r.type==="file"?t.push(r.path):r.children&&i(r.children)};return i(e||[]),t}_dirCheckState(e){const t=this._collectFiles(e);if(t.length===0)return"none";const i=t.filter(s=>this.selectedFiles.has(s)).length;return i===0?"none":i===t.length?"all":"indeterminate"}_emitSelection(){this.dispatchEvent(new CustomEvent("selection-changed",{detail:{selectedFiles:[...this.selectedFiles]},bubbles:!0,composed:!0}))}_toggleExpand(e){const t=new Set(this._expanded);t.has(e)?t.delete(e):t.add(e),this._expanded=t}_onFileNameClick(e){this.dispatchEvent(new CustomEvent("file-clicked",{detail:{path:e},bubbles:!0,composed:!0}))}_onMiddleClick(e,t){if(e.button!==1)return;e.preventDefault(),e.stopPropagation();const i=a=>{a.button===1&&(a.preventDefault(),a.stopPropagation())},s=a=>{a.preventDefault(),a.stopPropagation()};window.addEventListener("auxclick",i,{once:!0,capture:!0}),window.addEventListener("mouseup",i,{once:!0,capture:!0});const o=this.closest("files-tab")?.shadowRoot?.querySelector("chat-input")?.shadowRoot?.querySelector("textarea");o&&(o.addEventListener("paste",s,{once:!0,capture:!0}),setTimeout(()=>o.removeEventListener("paste",s,!0),200)),this.dispatchEvent(new CustomEvent("path-to-input",{detail:{path:t},bubbles:!0,composed:!0}))}_gitStatus(e){return this.staged?.includes(e)?"staged":this.modified?.includes(e)?"modified":this.untracked?.includes(e)?"untracked":""}_gitBadge(e){return e==="staged"?"S":e==="modified"?"M":e==="untracked"?"U":""}_nameColor(e){const t=this._gitStatus(e);return t==="modified"?"color: var(--accent-warning)":t==="staged"||t==="untracked"?"color: var(--accent-success)":"color: var(--text-muted)"}_lineCountClass(e){return e<=0?"":e<130?"green":e<=170?"orange":"red"}_onContextMenu(e,t){e.preventDefault(),e.stopPropagation(),this._contextMenu={x:e.clientX,y:e.clientY,node:t},this.requestUpdate()}_onDocClick(){this._contextMenu&&(this._contextMenu=null,this.requestUpdate())}_onDocKeydown(e){if(e.key==="Escape"){if(this._overlayState){this._overlayState=null,this.requestUpdate();return}this._contextMenu&&(this._contextMenu=null,this.requestUpdate())}}_contextItems(e){const t=[],i=e.path;if(e.type==="file"){const s=this._gitStatus(i);(s==="modified"||s==="untracked")&&t.push({label:"Stage file",icon:"＋",op:"stage",paths:[i]}),s==="staged"&&t.push({label:"Unstage file",icon:"−",op:"unstage",paths:[i]}),s==="modified"&&t.push({label:"Discard changes",icon:"↩",op:"discard",paths:[i],danger:!0,confirm:!0}),t.push({sep:!0}),t.push({label:"Rename / Move",icon:"✏️",op:"rename",paths:[i],prompt:!0}),t.push({label:"Delete file",icon:"🗑",op:"delete",paths:[i],danger:!0,confirm:!0})}else{const s=this._collectFiles(e.children||[]),r=s.some(a=>this._gitStatus(a)==="modified"||this._gitStatus(a)==="untracked"),o=s.some(a=>this._gitStatus(a)==="staged");r&&t.push({label:"Stage all in dir",icon:"＋",op:"stage",paths:s.filter(a=>{const l=this._gitStatus(a);return l==="modified"||l==="untracked"})}),o&&t.push({label:"Unstage all",icon:"−",op:"unstage",paths:s.filter(a=>this._gitStatus(a)==="staged")}),t.length>0&&t.push({sep:!0}),t.push({label:"Rename / Move",icon:"✏️",op:"rename-dir",paths:[i],prompt:!0}),t.push({label:"New file",icon:"📄",op:"create-file",paths:[i],prompt:!0}),t.push({label:"New directory",icon:"📁",op:"create-dir",paths:[i],prompt:!0})}return t}_onContextItemClick(e){if(this._contextMenu=null,e.confirm)this._overlayState={type:"confirm",item:e},this.requestUpdate();else if(e.prompt){const t=e.op.startsWith("rename")?e.paths[0]:"";this._overlayState={type:"prompt",item:e,value:t},this.requestUpdate()}else this._executeGitOp(e.op,e.paths)}_onOverlayConfirm(){const e=this._overlayState?.item;this._overlayState=null,e&&this._executeGitOp(e.op,e.paths),this.requestUpdate()}_onOverlayPromptConfirm(){const{item:e,value:t}=this._overlayState||{};this._overlayState=null,this.requestUpdate(),!(!e||!t?.trim())&&this._executeGitOp(e.op,e.paths,t.trim())}async _executeGitOp(e,t,i){try{let s;switch(e){case"stage":s=await this.rpcExtract("Repo.stage_files",t);break;case"unstage":s=await this.rpcExtract("Repo.unstage_files",t);break;case"discard":s=await this.rpcExtract("Repo.discard_changes",t);break;case"delete":s=await this.rpcExtract("Repo.delete_file",t[0]);break;case"rename":case"rename-dir":s=await this.rpcExtract(e==="rename-dir"?"Repo.rename_directory":"Repo.rename_file",t[0],i);break;case"create-file":s=await this.rpcExtract("Repo.create_file",t[0]+"/"+i,"");break;case"create-dir":{const r=t[0]+"/"+i+"/.gitkeep";s=await this.rpcExtract("Repo.create_file",r,"");break}default:console.warn("Unknown git op:",e);return}s?.error&&console.error("Git operation failed:",s.error),this.dispatchEvent(new CustomEvent("git-operation",{detail:{operation:e,paths:t,result:s},bubbles:!0,composed:!0}))}catch(s){console.error("Git operation error:",s)}}_getFlatVisible(){if(this._flatVisibleCache)return this._flatVisibleCache;const e=[],t=(i,s)=>{for(const r of i)this._matchesFilter(r)&&(e.push({path:r.path,type:r.type,depth:s}),r.type==="dir"&&(this._expanded.has(r.path)||this._filter)&&t(r.children||[],s+1))};return this.tree?.children&&t(this.tree.children,0),this._flatVisibleCache=e,e}_onTreeKeydown(e){const t=this._getFlatVisible();if(t.length===0)return;const i=t.findIndex(s=>s.path===this._focused);if(e.key==="ArrowDown"){e.preventDefault();const s=Math.min(i+1,t.length-1);this._focused=t[s>=0?s:0].path,this._scrollFocusedIntoView()}else if(e.key==="ArrowUp"){e.preventDefault();const s=Math.max(i-1,0);this._focused=t[s].path,this._scrollFocusedIntoView()}else if(e.key===" "||e.key==="Enter"){if(e.preventDefault(),i>=0){const s=t[i];s.type==="dir"?this._toggleExpand(s.path):this._toggleSelect(s.path,!1,[])}}else if(e.key==="ArrowRight"){if(e.preventDefault(),i>=0&&t[i].type==="dir"){const s=new Set(this._expanded);s.add(t[i].path),this._expanded=s}}else if(e.key==="ArrowLeft"&&(e.preventDefault(),i>=0&&t[i].type==="dir")){const s=new Set(this._expanded);s.delete(t[i].path),this._expanded=s}}_scrollFocusedIntoView(){this.updateComplete.then(()=>{const e=this.shadowRoot.querySelector(".node-row.focused");e&&e.scrollIntoView({block:"nearest"})})}setTree(e){this.tree=e.tree||null,this.modified=e.modified||[],this.staged=e.staged||[],this.untracked=e.untracked||[],this.diffStats=e.diff_stats||{}}setSelectedFiles(e){this.selectedFiles=new Set(e)}render(){return h`
      <div class="filter-bar">
        <input type="text"
          placeholder="Filter files..."
          aria-label="Filter files"
          .value=${this._filter}
          @input=${this._onFilterInput}
        >
      </div>

      <div class="tree-container"
        role="tree"
        aria-label="Repository files"
        tabindex="0"
        @keydown=${this._onTreeKeydown}
      >
        ${this.tree?.children?.length?this._renderNodes(this.tree.children,0):h`<div class="empty-tree">No files</div>`}
      </div>

      ${this._contextMenu?this._renderContextMenu():b}
      ${this._overlayState?this._renderOverlay():b}
    `}_renderNodes(e,t){return e?e.filter(i=>this._matchesFilter(i)).map(i=>i.type==="dir"?this._renderDir(i,t):this._renderFile(i,t)):b}_renderDir(e,t){const i=this._expanded.has(e.path)||!!this._filter,s=this._dirCheckState(e.children||[]),r=this._focused===e.path;return h`
      <div class="node-row ${r?"focused":""}"
        role="treeitem"
        aria-expanded=${i}
        aria-selected=${s==="all"}
        style="padding-left: ${t*16+4}px"
        @contextmenu=${o=>this._onContextMenu(o,e)}
        @click=${()=>{this._focused=e.path,this._toggleExpand(e.path)}}
        @mousedown=${o=>this._onMiddleClick(o,e.path)}
      >
        <span class="toggle" aria-hidden="true" @click=${o=>{o.stopPropagation(),this._toggleExpand(e.path)}}>
          ${i?"▾":"▸"}
        </span>
        <input type="checkbox"
          class="node-check"
          aria-label="Select ${e.name}"
          .checked=${s==="all"}
          .indeterminate=${s==="indeterminate"}
          @change=${()=>this._toggleSelect(e.path,!0,e.children||[])}
          @click=${o=>o.stopPropagation()}
        >
        <span class="node-name dir">${e.name}</span>
      </div>
      ${i?h`<div role="group">${this._renderNodes(e.children||[],t+1)}</div>`:b}
    `}_renderFile(e,t){const i=this.selectedFiles.has(e.path),s=this._gitStatus(e.path),r=this._gitBadge(s),o=this.diffStats?.[e.path],a=this._focused===e.path,l=this.viewerActiveFile===e.path;return h`
      <div class="node-row ${a?"focused":""} ${l?"active-in-viewer":""}"
        role="treeitem"
        aria-selected=${i}
        aria-current=${l?"true":b}
        style="padding-left: ${t*16+4}px"
        @contextmenu=${c=>this._onContextMenu(c,e)}
        @click=${()=>{this._focused=e.path}}
        @mousedown=${c=>this._onMiddleClick(c,e.path)}
      >
        <span class="toggle" aria-hidden="true"></span>
        <input type="checkbox"
          class="node-check"
          aria-label="Select ${e.name}"
          .checked=${i}
          @change=${()=>this._toggleSelect(e.path,!1,[])}
          @click=${c=>c.stopPropagation()}
        >
        <span class="node-name file-click"
          role="link"
          tabindex="-1"
          style=${this._nameColor(e.path)}
          @click=${c=>{c.stopPropagation(),this._onFileNameClick(e.path)}}>
          ${e.name}
        </span>
        ${e.lines>0?h`
          <span class="line-count ${this._lineCountClass(e.lines)}">${e.lines}</span>
        `:b}
        ${r?h`
          <span class="git-badge ${s}">${r}</span>
        `:b}
        ${o?h`
          <span class="diff-stats">
            ${o.additions?h`<span class="diff-add">+${o.additions}</span>`:b}
            ${o.deletions?h`<span class="diff-del">-${o.deletions}</span>`:b}
          </span>
        `:b}
      </div>
    `}_renderContextMenu(){const{x:e,y:t,node:i}=this._contextMenu,s=this._contextItems(i),r=Math.min(e,window.innerWidth-180),o=Math.min(t,window.innerHeight-s.length*30-20);return h`
      <div class="context-menu"
        role="menu"
        aria-label="File actions"
        style="left:${r}px; top:${o}px"
        @click=${a=>a.stopPropagation()}>
        ${s.map(a=>a.sep?h`<div class="context-sep" role="separator"></div>`:h`
              <div class="context-item ${a.danger?"danger":""}"
                role="menuitem"
                tabindex="-1"
                @click=${()=>this._onContextItemClick(a)}>
                <span aria-hidden="true">${a.icon}</span>
                <span>${a.label}</span>
              </div>`)}
      </div>
    `}_renderOverlay(){const e=this._overlayState;if(e.type==="confirm")return h`
        <div class="overlay-backdrop" @click=${()=>{this._overlayState=null,this.requestUpdate()}}></div>
        <div class="overlay-dialog" role="alertdialog" aria-label="Confirm ${e.item.label.toLowerCase()}">
          <p>Are you sure you want to <b>${e.item.label.toLowerCase()}</b>?</p>
          <p style="font-size:12px; color:var(--text-secondary)">${e.item.paths.join(", ")}</p>
          <div class="overlay-btns">
            <button @click=${()=>{this._overlayState=null,this.requestUpdate()}}>Cancel</button>
            <button class="danger" @click=${this._onOverlayConfirm}>${e.item.label}</button>
          </div>
        </div>
      `;if(e.type==="prompt"){const t=e.item.op.includes("create-file")?"filename.ext":e.item.op.includes("create-dir")?"directory-name":e.item.paths[0]||"";return h`
        <div class="overlay-backdrop" @click=${()=>{this._overlayState=null,this.requestUpdate()}}></div>
        <div class="overlay-dialog" role="dialog" aria-label="${e.item.label}">
          <p>${e.item.label}</p>
          <input type="text"
            aria-label="${e.item.label} path"
            .value=${e.value}
            placeholder=${t}
            @input=${i=>{e.value=i.target.value}}
            @keydown=${i=>{i.key==="Enter"&&this._onOverlayPromptConfirm()}}
          >
          <div class="overlay-btns">
            <button @click=${()=>{this._overlayState=null,this.requestUpdate()}}>Cancel</button>
            <button class="primary" @click=${this._onOverlayPromptConfirm}>OK</button>
          </div>
        </div>
      `}return b}updated(e){if(super.updated(e),this._overlayState?.type==="prompt"){const t=this.shadowRoot.querySelector(".overlay-dialog input");t&&t.focus()}}}customElements.define("file-picker",Ho);const qo=300,Go=1e4;class jo extends le(Z){static properties={open:{type:Boolean,reflect:!0},_sessions:{type:Array,state:!0},_selectedId:{type:String,state:!0},_messages:{type:Array,state:!0},_query:{type:String,state:!0},_searchResults:{type:Array,state:!0},_searching:{type:Boolean,state:!0},_loadingSessions:{type:Boolean,state:!0},_loadingMessages:{type:Boolean,state:!0},_highlightMsgId:{type:String,state:!0}};static styles=te`
    :host { display: contents; }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fade-in 0.15s ease;
    }

    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: min(900px, 90vw);
      height: min(600px, 80vh);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: slide-up 0.15s ease;
    }

    @keyframes slide-up {
      from { transform: translateY(12px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-elevated);
      flex-shrink: 0;
    }

    .header-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .header-search {
      flex: 1;
      margin: 0 12px;
    }

    .search-input {
      width: 100%;
      padding: 5px 10px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
      font-family: var(--font-mono);
      outline: none;
      box-sizing: border-box;
    }
    .search-input:focus { border-color: var(--accent-primary); }
    .search-input::placeholder { color: var(--text-muted); }

    .header-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    .header-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 4px 10px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
      white-space: nowrap;
    }
    .header-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .header-btn.primary {
      background: var(--accent-primary);
      color: white;
      border-color: var(--accent-primary);
    }
    .header-btn.primary:hover { opacity: 0.9; }
    .header-btn.primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .close-btn {
      background: none;
      border: none;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 16px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
      line-height: 1;
    }
    .close-btn:hover { color: var(--text-primary); }

    /* ── Body ── */
    .body {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    /* ── Left panel (session list) ── */
    .left-panel {
      width: 280px;
      min-width: 200px;
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex-shrink: 0;
    }

    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .session-item {
      padding: 8px 12px;
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: background var(--transition-fast);
    }
    .session-item:hover { background: var(--bg-surface); }
    .session-item.selected {
      background: var(--bg-surface);
      border-left-color: var(--accent-primary);
    }

    .session-time {
      font-size: 10px;
      color: var(--text-muted);
      margin-bottom: 2px;
    }

    .session-preview {
      font-size: 12px;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .session-count {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .list-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 12px;
      padding: 20px;
      text-align: center;
    }

    .list-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--text-muted);
      font-size: 12px;
      gap: 6px;
    }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Right panel (messages) ── */
    .right-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    .messages-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .messages-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 12px;
    }

    .msg-card {
      margin-bottom: 10px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
      background: var(--bg-elevated);
      transition: border-color 0.3s ease;
    }
    .msg-card.highlighted {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 1px var(--accent-primary);
    }

    .msg-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
    }

    .msg-role {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 3px;
      color: white;
    }
    .msg-role.user { background: var(--accent-primary); }
    .msg-role.assistant { background: #7c4dff; }

    .msg-meta {
      font-size: 10px;
      color: var(--text-muted);
      flex: 1;
    }

    .msg-actions {
      display: flex;
      gap: 2px;
    }

    .msg-action-btn {
      background: none;
      border: none;
      padding: 2px 5px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast), background var(--transition-fast);
      line-height: 1;
    }
    .msg-action-btn:hover {
      color: var(--text-primary);
      background: var(--bg-surface);
    }

    .msg-content {
      padding: 8px 10px;
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
    }

    .msg-files {
      padding: 4px 10px 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .file-badge {
      font-size: 10px;
      font-family: var(--font-mono);
      padding: 1px 6px;
      background: var(--bg-surface);
      border-radius: 3px;
      color: var(--text-muted);
    }

    /* ── Search result items ── */
    .search-item {
      padding: 8px 12px;
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: background var(--transition-fast);
    }
    .search-item:hover { background: var(--bg-surface); }

    .search-item-role {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .search-item-preview {
      font-size: 12px;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 2px;
    }

    .search-item-session {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .search-highlight {
      background: rgba(79, 195, 247, 0.2);
      color: var(--accent-primary);
      border-radius: 2px;
    }
  `;constructor(){super(),this.open=!1,this._sessions=[],this._selectedId=null,this._messages=[],this._query="",this._searchResults=[],this._searching=!1,this._loadingSessions=!1,this._loadingMessages=!1,this._highlightMsgId=null,this._debounceTimer=null,this._sessionsLoadedAt=0}updated(e){e.has("open")&&this.open&&this._onOpen()}_onOpen(){const e=Date.now();(!this._sessions.length||e-this._sessionsLoadedAt>Go)&&this._loadSessions(),this.updateComplete.then(()=>{this.shadowRoot.querySelector(".search-input")?.focus()})}async _loadSessions(){if(this.rpcConnected){this._loadingSessions=!0;try{const e=await this.rpcExtract("LLM.history_list_sessions",50);Array.isArray(e)&&(this._sessions=e,this._sessionsLoadedAt=Date.now())}catch(e){console.warn("Failed to load sessions:",e)}finally{this._loadingSessions=!1}}}async _selectSession(e){if(this._selectedId!==e){this._selectedId=e,this._messages=[],this._highlightMsgId=null,this._loadingMessages=!0;try{const t=await this.rpcExtract("LLM.history_get_session",e);Array.isArray(t)&&(this._messages=t)}catch(t){console.warn("Failed to load session:",t)}finally{this._loadingMessages=!1}}}_onSearchInput(e){if(this._query=e.target.value,this._debounceTimer&&clearTimeout(this._debounceTimer),!this._query.trim()){this._searchResults=[],this._searching=!1;return}this._debounceTimer=setTimeout(()=>this._executeSearch(),qo)}async _executeSearch(){const e=this._query.trim();if(!(!e||!this.rpcConnected)){this._searching=!0;try{const t=await this.rpcExtract("LLM.history_search",e,null,50);Array.isArray(t)&&(this._searchResults=t)}catch(t){console.warn("Search failed:",t)}finally{this._searching=!1}}}_onSearchResultClick(e){this._highlightMsgId=e.id||null,e.session_id&&e.session_id!==this._selectedId?this._selectSession(e.session_id).then(()=>{this._scrollToHighlighted()}):this._scrollToHighlighted()}_scrollToHighlighted(){this.updateComplete.then(()=>{const e=this.shadowRoot.querySelector(".msg-card.highlighted");e&&e.scrollIntoView({block:"center",behavior:"smooth"})})}async _loadIntoContext(){if(!(!this._selectedId||!this.rpcConnected))try{const e=await this.rpcExtract("LLM.load_session_into_context",this._selectedId);if(e?.error){console.error("Load session failed:",e.error);return}this.dispatchEvent(new CustomEvent("session-loaded",{detail:{sessionId:this._selectedId,messages:this._messages.map(t=>({role:t.role,content:t.content}))},bubbles:!0,composed:!0})),this._close()}catch(e){console.error("Load session failed:",e)}}async _copyMessage(e){try{await navigator.clipboard.writeText(e.content)}catch(t){console.warn("Copy failed:",t)}}_toPrompt(e){this.dispatchEvent(new CustomEvent("insert-to-prompt",{detail:{text:e.content},bubbles:!0,composed:!0})),this._close()}_close(){this.open=!1,this.dispatchEvent(new CustomEvent("history-closed",{bubbles:!0,composed:!0}))}_onBackdropClick(e){e.target===e.currentTarget&&this._close()}_onKeyDown(e){e.key==="Escape"&&(e.stopPropagation(),this._close())}_formatTime(e){if(!e)return"";try{const t=new Date(e),s=new Date-t,r=Math.floor(s/(1e3*60*60*24));return r===0?t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):r===1?"Yesterday "+t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):r<7?t.toLocaleDateString([],{weekday:"short"})+" "+t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):t.toLocaleDateString([],{month:"short",day:"numeric"})+" "+t.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}catch{return String(e).slice(0,16)}}_truncate(e,t=100){if(!e)return"";const i=e.replace(/\n/g," ").trim();return i.length<=t?i:i.slice(0,t)+"…"}_highlightQuery(e,t){if(!t||!e)return e;const i=this._truncate(e,120);try{const s=t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),r=new RegExp(`(${s})`,"gi"),o=i.split(r);return o.length<=1?i:o.map((a,l)=>l%2===1?h`<span class="search-highlight">${a}</span>`:a)}catch{return i}}render(){if(!this.open)return b;const e=this._query.trim().length>0;return h`
      <div class="backdrop" @click=${this._onBackdropClick} @keydown=${this._onKeyDown}
        role="dialog" aria-modal="true" aria-label="History browser">
        <div class="modal">
          <div class="header">
            <span class="header-title" id="history-dialog-title">📜 History</span>
            <div class="header-search">
              <input type="text"
                class="search-input"
                placeholder="Search messages..."
                aria-label="Search conversation history"
                .value=${this._query}
                @input=${this._onSearchInput}
                @keydown=${t=>t.key==="Escape"&&this._close()}
              >
            </div>
            <div class="header-actions">
              <button class="header-btn primary"
                ?disabled=${!this._selectedId}
                @click=${this._loadIntoContext}
                title="Load selected session into active context"
                aria-label="Load selected session into active context">
                Load Session
              </button>
            </div>
            <button class="close-btn" @click=${this._close} title="Close" aria-label="Close history browser">✕</button>
          </div>
          <div class="body">
            <div class="left-panel" role="navigation" aria-label="Sessions">
              <div class="session-list" role="listbox" aria-label="Session list">
                ${e?this._renderSearchResults():this._renderSessionList()}
              </div>
            </div>
            <div class="right-panel">
              ${this._loadingMessages?h`
                <div class="messages-empty" role="status"><span class="spinner" aria-hidden="true"></span>&nbsp; Loading...</div>
              `:this._messages.length===0?h`
                <div class="messages-empty">
                  ${this._selectedId?"No messages in this session":"Select a session to view messages"}
                </div>
              `:h`
                <div class="messages-container" role="log" aria-label="Session messages">
                  ${this._messages.map(t=>this._renderMessage(t))}
                </div>
              `}
            </div>
          </div>
        </div>
      </div>
    `}_renderSessionList(){return this._loadingSessions?h`<div class="list-loading"><span class="spinner"></span> Loading sessions...</div>`:this._sessions.length===0?h`<div class="list-empty">No sessions yet</div>`:this._sessions.map(e=>h`
      <div class="session-item ${this._selectedId===e.session_id?"selected":""}"
        role="option"
        aria-selected=${this._selectedId===e.session_id}
        @click=${()=>this._selectSession(e.session_id)}>
        <div class="session-time">${this._formatTime(e.timestamp)}</div>
        <div class="session-preview">${this._truncate(e.preview,80)}</div>
        <div class="session-count">${e.message_count||0} messages</div>
      </div>
    `)}_renderSearchResults(){return this._searching?h`<div class="list-loading"><span class="spinner"></span> Searching...</div>`:this._searchResults.length===0?h`<div class="list-empty">
        ${this._query.trim()?`No results for "${this._query}"`:"Type to search"}
      </div>`:this._searchResults.map(e=>h`
      <div class="search-item" @click=${()=>this._onSearchResultClick(e)}>
        <span class="search-item-role">${e.role||"?"}</span>
        <div class="search-item-preview">
          ${this._highlightQuery(e.content,this._query.trim())}
        </div>
        <div class="search-item-session">${this._formatTime(e.timestamp)}</div>
      </div>
    `)}_renderMessage(e){const t=this._highlightMsgId&&e.id===this._highlightMsgId;return h`
      <div class="msg-card ${t?"highlighted":""}" role="article"
        aria-label="${e.role} message">
        <div class="msg-header">
          <span class="msg-role ${e.role}">${e.role}</span>
          <span class="msg-meta">${this._formatTime(e.timestamp)}</span>
          <div class="msg-actions" role="toolbar" aria-label="Message actions">
            <button class="msg-action-btn" @click=${()=>this._copyMessage(e)}
              title="Copy to clipboard" aria-label="Copy to clipboard">📋</button>
            <button class="msg-action-btn" @click=${()=>this._toPrompt(e)}
              title="Insert into prompt" aria-label="Insert into prompt">📝</button>
          </div>
        </div>
        <div class="msg-content">${e.content||""}</div>
        ${e.files?.length?h`
          <div class="msg-files">
            ${e.files.map(i=>h`<span class="file-badge">${i}</span>`)}
          </div>
        `:b}
        ${e.files_modified?.length?h`
          <div class="msg-files">
            ${e.files_modified.map(i=>h`<span class="file-badge">✏️ ${i}</span>`)}
          </div>
        `:b}
      </div>
    `}}customElements.define("history-browser",jo);class Ko extends Z{static properties={_visible:{type:Boolean,state:!0},_data:{type:Object,state:!0},_fading:{type:Boolean,state:!0}};static styles=te`
    :host {
      position: absolute;
      bottom: 80px;
      right: 16px;
      z-index: 50;
      pointer-events: none;
    }

    .hud {
      pointer-events: auto;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 8px 12px;
      box-shadow: var(--shadow-md);
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      cursor: pointer;
      user-select: none;
      opacity: 1;
      transition: opacity 0.6s ease;
      min-width: 200px;
    }

    .hud.fading {
      opacity: 0;
    }

    .hud-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 1px 0;
    }

    .hud-label {
      color: var(--text-muted);
    }

    .hud-value {
      color: var(--text-primary);
      text-align: right;
    }

    .hud-value.cache-hit {
      color: var(--accent-success);
    }

    .hud-value.cache-write {
      color: var(--accent-primary);
    }

    .hud-divider {
      border-top: 1px solid var(--border-color);
      margin: 3px 0;
    }

    .hud-title {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
  `;constructor(){super(),this._visible=!1,this._data=null,this._fading=!1,this._hideTimer=null,this._fadeTimer=null}show(e){const t=e.token_usage||{};!t.total_tokens&&!t.prompt_tokens||(this._data={prompt:t.prompt_tokens||0,completion:t.completion_tokens||0,cacheRead:t.cache_read_tokens||0,cacheWrite:t.cache_creation_tokens||0,total:t.total_tokens||0},this._visible=!0,this._fading=!1,clearTimeout(this._hideTimer),clearTimeout(this._fadeTimer),this._fadeTimer=setTimeout(()=>{this._fading=!0},4e3),this._hideTimer=setTimeout(()=>{this._visible=!1,this._fading=!1},4600))}_dismiss(){clearTimeout(this._hideTimer),clearTimeout(this._fadeTimer),this._visible=!1,this._fading=!1}_fmt(e){return e==null||e===0?"0":e>=1e3?`${(e/1e3).toFixed(1)}k`:String(e)}render(){if(!this._visible||!this._data)return b;const e=this._data,t=e.prompt>0?Math.round(e.cacheRead/e.prompt*100):0;return h`
      <div class="hud ${this._fading?"fading":""}" @click=${this._dismiss}
        role="status" aria-label="Token usage summary">
        <div class="hud-title">Token Usage</div>
        <div class="hud-row">
          <span class="hud-label">Prompt</span>
          <span class="hud-value">${this._fmt(e.prompt)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Completion</span>
          <span class="hud-value">${this._fmt(e.completion)}</span>
        </div>
        ${e.cacheRead>0?h`
          <div class="hud-row">
            <span class="hud-label">Cache hit</span>
            <span class="hud-value cache-hit">${this._fmt(e.cacheRead)} (${t}%)</span>
          </div>
        `:b}
        ${e.cacheWrite>0?h`
          <div class="hud-row">
            <span class="hud-label">Cache write</span>
            <span class="hud-value cache-write">${this._fmt(e.cacheWrite)}</span>
          </div>
        `:b}
        <div class="hud-divider"></div>
        <div class="hud-row">
          <span class="hud-label">Total</span>
          <span class="hud-value">${this._fmt(e.total)}</span>
        </div>
      </div>
    `}}customElements.define("token-hud",Ko);class Wo extends le(Z){static properties={messages:{type:Array,state:!0},selectedFiles:{type:Array,state:!0},streaming:{type:Boolean,state:!0},snippets:{type:Array,state:!0},_activeRequestId:{type:String,state:!0},_detectedUrls:{type:Array,state:!0},_fetchedUrls:{type:Array,state:!0},_excludedUrls:{type:Object,state:!0},_pickerCollapsed:{type:Boolean,state:!0},_pickerWidth:{type:Number,state:!0},_dividerDragging:{type:Boolean,state:!0},_confirmAction:{type:Object,state:!0},_historyOpen:{type:Boolean,state:!0},_repoFiles:{type:Array,state:!0},_viewerActiveFile:{type:String,state:!0}};static styles=te`
    :host {
      display: flex;
      height: 100%;
      overflow: hidden;
    }

    .file-picker-panel {
      border-right: 1px solid var(--border-color);
      background: var(--bg-secondary);
      overflow: hidden;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
    }

    .file-picker-panel.collapsed {
      width: 0 !important;
      min-width: 0 !important;
      border-right: none;
    }

    /* ── Panel divider / resize handle ── */
    .panel-divider {
      width: 6px;
      flex-shrink: 0;
      background: var(--bg-secondary);
      border-left: 1px solid var(--border-color);
      cursor: col-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 5;
      transition: background var(--transition-fast);
    }
    .panel-divider:hover,
    .panel-divider.dragging {
      background: var(--bg-surface);
    }
    .panel-divider.collapsed {
      cursor: default;
      width: 4px;
    }

    .divider-grip {
      width: 2px;
      height: 24px;
      border-radius: 1px;
      background: var(--border-color);
      pointer-events: none;
    }
    .panel-divider:hover .divider-grip,
    .panel-divider.dragging .divider-grip {
      background: var(--text-muted);
    }

    .collapse-btn {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 16px;
      height: 32px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: 3px;
      color: var(--text-muted);
      font-size: 9px;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 6;
      line-height: 1;
    }
    .panel-divider:hover .collapse-btn,
    .panel-divider.collapsed .collapse-btn {
      display: flex;
    }
    .collapse-btn:hover {
      color: var(--text-primary);
      background: var(--bg-surface);
    }

    .chat-panel-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
      position: relative;
    }

    /* ── Git action bar ── */
    .git-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-elevated);
      flex-shrink: 0;
    }

    .git-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background var(--transition-fast), color var(--transition-fast);
      white-space: nowrap;
    }
    .git-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .git-btn.danger:hover {
      background: rgba(239,83,80,0.15);
      color: var(--accent-error);
    }
    .git-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .git-spacer { flex: 1; }

    .session-btn {
      background: none;
      border: none;
      padding: 3px 6px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
    }
    .session-btn:hover { color: var(--text-primary); }

    /* ── Confirm dialog ── */
    .confirm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 300;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .confirm-dialog {
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 16px 20px;
      box-shadow: var(--shadow-lg);
      max-width: 360px;
    }
    .confirm-dialog p {
      color: var(--text-primary);
      font-size: 13px;
      margin: 0 0 12px 0;
    }
    .confirm-btns {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .confirm-btns button {
      padding: 5px 14px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 12px;
    }
    .confirm-btns button.danger {
      background: var(--accent-error);
      color: white;
      border-color: var(--accent-error);
    }
  `;constructor(){super(),this.messages=[],this.selectedFiles=[],this.streaming=!1,this.snippets=[],this._activeRequestId=null,this._watchdogTimer=null,this._detectedUrls=[],this._fetchedUrls=[],this._excludedUrls=new Set,this._dividerDragging=!1,this._confirmAction=null,this._historyOpen=!1,this._repoFiles=[],this._viewerActiveFile="",this._pickerCollapsed=localStorage.getItem("ac-dc-picker-collapsed")==="true",this._pickerWidth=parseInt(localStorage.getItem("ac-dc-picker-width"))||280,this._onDividerMove=this._onDividerMove.bind(this),this._onDividerUp=this._onDividerUp.bind(this)}connectedCallback(){super.connectedCallback(),this._boundOnStateLoaded=this._onStateLoaded.bind(this),this._boundOnStreamComplete=this._onStreamComplete.bind(this),this._boundOnCompactionEvent=this._onCompactionEvent.bind(this),this._boundOnFilesChanged=this._onFilesChanged.bind(this),this._boundOnViewerActiveFile=this._onViewerActiveFile.bind(this),window.addEventListener("state-loaded",this._boundOnStateLoaded),window.addEventListener("stream-complete",this._boundOnStreamComplete),window.addEventListener("compaction-event",this._boundOnCompactionEvent),window.addEventListener("files-changed",this._boundOnFilesChanged),window.addEventListener("viewer-active-file",this._boundOnViewerActiveFile)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("state-loaded",this._boundOnStateLoaded),window.removeEventListener("stream-complete",this._boundOnStreamComplete),window.removeEventListener("compaction-event",this._boundOnCompactionEvent),window.removeEventListener("files-changed",this._boundOnFilesChanged),window.removeEventListener("viewer-active-file",this._boundOnViewerActiveFile),document.removeEventListener("mousemove",this._onDividerMove),document.removeEventListener("mouseup",this._onDividerUp),this._clearWatchdog()}onRpcReady(){this._loadSnippets(),this._loadFileTree()}async _loadSnippets(){try{const e=await this.rpcExtract("Settings.get_snippets");this.snippets=e?.snippets||[]}catch(e){console.warn("Failed to load snippets:",e)}}async _loadFileTree(){try{const e=await this.rpcExtract("Repo.get_file_tree");if(e&&!e.error){const t=this.shadowRoot.querySelector("file-picker");t&&t.setTree(e),this._repoFiles=this._collectAllFiles(e.tree)}}catch(e){console.warn("Failed to load file tree:",e)}}_collectAllFiles(e){if(!e)return[];const t=[],i=s=>{s.type==="file"&&t.push(s.path),s.children&&s.children.forEach(i)};return i(e),t}_onStateLoaded(e){const t=e.detail;t&&(this.messages=t.messages||[],this.selectedFiles=t.selected_files||[],this.streaming=t.streaming_active||!1,this.updateComplete.then(()=>{const i=this.shadowRoot.querySelector("file-picker");if(i&&this.selectedFiles.length&&i.setSelectedFiles(this.selectedFiles),this.messages.length>0){const s=this.shadowRoot.querySelector("chat-panel");s&&s.updateComplete.then(()=>{s.scrollToBottom()})}}))}_onSelectionChanged(e){const{selectedFiles:t}=e.detail;this.selectedFiles=t,this.rpcConnected&&this.rpcCall("LLM.set_selected_files",t).catch(()=>{})}_onFileClicked(e){this.dispatchEvent(new CustomEvent("navigate-file",{detail:{path:e.detail.path},bubbles:!0,composed:!0}))}_onPathToInput(e){const{path:t}=e.detail;if(!t)return;const i=this.shadowRoot.querySelector("chat-input");if(!i)return;const s=i.shadowRoot?.querySelector("textarea");if(!s)return;const r=s.selectionStart,o=s.value.substring(0,r),a=s.value.substring(s.selectionEnd),l=" "+t+" ";s.value=o+l+a;const c=r+l.length;s.selectionStart=s.selectionEnd=c,s.dispatchEvent(new Event("input")),i._autoResize(s),s.focus()}async _onGitOperation(){await this._loadFileTree()}_onFilesChanged(e){const{selectedFiles:t}=e.detail;t&&(this.selectedFiles=t,this.updateComplete.then(()=>{const i=this.shadowRoot.querySelector("file-picker");i&&i.setSelectedFiles(t)}))}_onViewerActiveFile(e){this._viewerActiveFile=e.detail?.path||""}_onFileMentionClick(e){const{path:t}=e.detail;if(!t)return;const i=new Set(this.selectedFiles),s=i.has(t);s?(i.delete(t),this._removeFileFromInput(t)):(i.add(t),this._addFileToInput(t)),this.selectedFiles=[...i];const r=this.shadowRoot.querySelector("file-picker");r&&(r.setSelectedFiles(this.selectedFiles),s||r._expandParents(t)),this.rpcConnected&&this.rpcCall("LLM.set_selected_files",this.selectedFiles).catch(()=>{})}_addFileToInput(e){const t=this.shadowRoot.querySelector("chat-input");if(!t)return;const i=t.shadowRoot?.querySelector("textarea");if(!i)return;const s=e.split("/").pop(),r=i.value,o=" added. Do you want to see more files before you continue?",a=/^The files? (.+) added\. Do you want to see more files before you continue\?$/,l=r.match(a);if(l){const c=l[1];i.value=`The files ${c}, ${s}${o}`}else r.trim()===""?i.value=`The file ${s}${o}`:i.value=`${r} (added ${s})`;i.dispatchEvent(new Event("input")),t._autoResize(i)}_removeFileFromInput(e){const t=this.shadowRoot.querySelector("chat-input");if(!t)return;const i=t.shadowRoot?.querySelector("textarea");if(!i)return;const s=e.split("/").pop(),r=i.value,o=" added. Do you want to see more files before you continue?",a=/^The files? (.+) added\. Do you want to see more files before you continue\?$/,l=r.match(a);if(l){const c=l[1].split(", ").filter(p=>p!==s);c.length===0?i.value="":c.length===1?i.value=`The file ${c[0]}${o}`:i.value=`The files ${c.join(", ")}${o}`}else{const c=` (added ${s})`;r.includes(c)&&(i.value=r.replace(c,""))}i.dispatchEvent(new Event("input")),t._autoResize(i)}_getUserMessageHistory(){if(!this.messages||this.messages.length===0)return[];const e=new Set,t=[];for(let i=this.messages.length-1;i>=0;i--){const s=this.messages[i];if(s.role==="user"&&s.content){const r=typeof s.content=="string"?s.content:"";r&&!e.has(r)&&(e.add(r),t.push(r))}}return t}_onUrlsDetected(e){const{urls:t}=e.detail,i=new Set(this._fetchedUrls.map(s=>s.url));this._detectedUrls=t.filter(s=>!i.has(s.url))}_onUrlFetched(e){const{url:t,result:i}=e.detail;this._detectedUrls=this._detectedUrls.filter(o=>o.url!==t);const s=this._fetchedUrls.findIndex(o=>o.url===t),r={url:t,url_type:i.url_type||"generic",title:i.title||"",display_name:i.display_name||t,error:i.error||""};s>=0?this._fetchedUrls=[...this._fetchedUrls.slice(0,s),r,...this._fetchedUrls.slice(s+1)]:this._fetchedUrls=[...this._fetchedUrls,r]}_onUrlDismissed(e){this._detectedUrls=this._detectedUrls.filter(t=>t.url!==e.detail.url)}_onUrlRemoved(e){const{url:t}=e.detail;this._fetchedUrls=this._fetchedUrls.filter(s=>s.url!==t);const i=new Set(this._excludedUrls);i.delete(t),this._excludedUrls=i}_onUrlToggleExclude(e){const{url:t}=e.detail,i=new Set(this._excludedUrls);i.has(t)?i.delete(t):i.add(t),this._excludedUrls=i}_onUrlViewContent(e){console.log("[url-chips] View content for:",e.detail.url)}_getIncludedUrls(){return this._fetchedUrls.filter(e=>!e.error&&!this._excludedUrls.has(e.url)).map(e=>e.url)}async _onSendMessage(e){const{message:t,images:i}=e.detail;if(this.streaming)return;const s={role:"user",content:t};i&&i.length>0&&(s.images=[...i]),this.messages=[...this.messages,s],this._detectedUrls=[];const r=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;this._activeRequestId=r,this.streaming=!0,this._startWatchdog(),this.shadowRoot.querySelector("chat-panel")?.scrollToBottom();try{await this.rpcCall("LLM.chat_streaming",r,t,this.selectedFiles,i.length>0?i:[])}catch(o){console.error("chat_streaming failed:",o),this.streaming=!1,this._clearWatchdog(),this._toast("Failed to send message: "+(o.message||o),"error")}}_onStreamComplete(e){const{result:t}=e.detail;this._clearWatchdog(),this.streaming=!1,this._activeRequestId=null,t.error&&this._toast(t.error,"error"),t.response&&(this.messages=[...this.messages,{role:"assistant",content:t.response,editResults:t.edit_results||[]}]),t.token_usage&&this.shadowRoot.querySelector("token-hud")?.show(t),t.files_modified?.length>0&&this._loadFileTree(),this.shadowRoot.querySelector("chat-input")?.focus()}_onCompactionEvent(e){const t=e.detail?.event;if(t&&t.type==="compaction_complete"&&t.case!=="none"){t.messages&&(this.messages=[...t.messages],this.updateComplete.then(()=>{this.shadowRoot.querySelector("chat-panel")?.scrollToBottomIfAtBottom()}));const i=t.case==="truncate"?`History truncated: ${t.messages_before} → ${t.messages_after} messages`:`History compacted: ${t.messages_before} → ${t.messages_after} messages`;console.log(`[ac-dc] ${i}`)}}_startWatchdog(){this._clearWatchdog(),this._watchdogTimer=setTimeout(()=>{console.warn("[ac-dc] Watchdog timeout — forcing stream recovery"),this.streaming=!1,this._activeRequestId=null},300*1e3)}_clearWatchdog(){this._watchdogTimer&&(clearTimeout(this._watchdogTimer),this._watchdogTimer=null)}async _onStopStreaming(){if(this._activeRequestId)try{await this.rpcCall("LLM.cancel_streaming",this._activeRequestId)}catch(e){console.warn("Failed to cancel streaming:",e)}}_onCopyToPrompt(e){const{text:t}=e.detail;if(!t)return;const i=this.shadowRoot.querySelector("chat-input");if(i){const s=i.shadowRoot?.querySelector("textarea");s&&(s.value=t,s.dispatchEvent(new Event("input")),i._autoResize(s),i.focus())}}_onDividerDown(e){this._pickerCollapsed||(e.preventDefault(),this._dividerDragging=!0,this._dividerStartX=e.clientX,this._dividerStartWidth=this._pickerWidth,document.addEventListener("mousemove",this._onDividerMove),document.addEventListener("mouseup",this._onDividerUp))}_onDividerMove(e){if(!this._dividerDragging)return;const t=e.clientX-this._dividerStartX,i=Math.max(150,Math.min(500,this._dividerStartWidth+t));this._pickerWidth=i}_onDividerUp(){this._dividerDragging&&(this._dividerDragging=!1,document.removeEventListener("mousemove",this._onDividerMove),document.removeEventListener("mouseup",this._onDividerUp),localStorage.setItem("ac-dc-picker-width",String(this._pickerWidth)))}_togglePickerCollapsed(){this._pickerCollapsed=!this._pickerCollapsed,localStorage.setItem("ac-dc-picker-collapsed",String(this._pickerCollapsed))}_toast(e,t="info"){window.dispatchEvent(new CustomEvent("ac-toast",{detail:{message:e,type:t},bubbles:!0}))}async _copyDiff(){try{const e=await this.rpcExtract("Repo.get_staged_diff"),t=await this.rpcExtract("Repo.get_unstaged_diff"),i=[];e?.diff&&i.push(`=== Staged ===
`+e.diff),t?.diff&&i.push(`=== Unstaged ===
`+t.diff);const s=i.join(`

`)||"(no changes)";await navigator.clipboard.writeText(s),this._toast("Diff copied to clipboard","success")}catch(e){console.error("Copy diff failed:",e),this._toast("Failed to copy diff: "+(e.message||e),"error")}}async _commitWithMessage(){if(!this.streaming)try{this._toast("Staging all changes...","info"),await this.rpcExtract("Repo.stage_all");const e=await this.rpcExtract("Repo.get_staged_diff");if(!e?.diff?.trim()){this._toast("Nothing to commit — working tree clean","info");return}this._toast("Generating commit message...","info");const t=await this.rpcExtract("LLM.generate_commit_message",e.diff);if(t?.error){this._toast(`Commit message generation failed: ${t.error}`,"error");return}const i=t.message||t;this._toast("Committing...","info");const s=await this.rpcExtract("Repo.commit",i);s?.error?this._toast(`Commit failed: ${s.error}`,"error"):(this._toast("Committed successfully","success"),this.messages=[...this.messages,{role:"assistant",content:`**Committed:**

${i}`}],this.updateComplete.then(()=>{this.shadowRoot.querySelector("chat-panel")?.scrollToBottomIfAtBottom()})),await this._loadFileTree()}catch(e){console.error("Commit failed:",e),this._toast("Commit failed: "+(e.message||e),"error")}}_requestReset(){this._confirmAction={message:"Reset all changes? This will discard all uncommitted modifications (git reset --hard HEAD).",action:()=>this._doReset()}}async _doReset(){this._confirmAction=null;try{const e=await this.rpcExtract("Repo.reset_hard");e?.error?this._toast(`Reset failed: ${e.error}`,"error"):this._toast("Repository reset to HEAD","success"),await this._loadFileTree(),this.shadowRoot.querySelector("chat-panel")?.scrollToBottom()}catch(e){console.error("Reset failed:",e),this._toast("Reset failed: "+(e.message||e),"error")}}_cancelConfirm(){this._confirmAction=null}async _newSession(){try{await this.rpcExtract("LLM.history_new_session"),this.messages=[],this._detectedUrls=[],this._fetchedUrls=[],this._excludedUrls=new Set,this._toast("New session started","info"),window.dispatchEvent(new CustomEvent("session-reset"))}catch(e){console.error("New session failed:",e),this._toast("Failed to start new session: "+(e.message||e),"error")}}_openHistory(){this._historyOpen=!0}_onHistoryClosed(){this._historyOpen=!1}_onSessionLoaded(e){const{messages:t}=e.detail;Array.isArray(t)&&(this.messages=[...t]),this._historyOpen=!1,this.updateComplete.then(()=>{this.shadowRoot.querySelector("chat-panel")?.scrollToBottom()})}_onInsertToPrompt(e){const{text:t}=e.detail;if(t){const i=this.shadowRoot.querySelector("chat-input");if(i){const s=i.shadowRoot?.querySelector("textarea");s&&(s.value=t,s.dispatchEvent(new Event("input")),i.focus())}}}render(){const e=this._pickerCollapsed?"":`width:${this._pickerWidth}px; min-width:150px; max-width:500px;`;return h`
      <div class="file-picker-panel ${this._pickerCollapsed?"collapsed":""}"
        style=${e}>
        <file-picker
          .viewerActiveFile=${this._viewerActiveFile}
          @selection-changed=${this._onSelectionChanged}
          @file-clicked=${this._onFileClicked}
          @git-operation=${this._onGitOperation}
          @path-to-input=${this._onPathToInput}
        ></file-picker>
      </div>

      <div class="panel-divider ${this._pickerCollapsed?"collapsed":""} ${this._dividerDragging?"dragging":""}"
        @mousedown=${t=>this._onDividerDown(t)}>
        <span class="divider-grip"></span>
        <button class="collapse-btn"
          @mousedown=${t=>t.stopPropagation()}
          @click=${this._togglePickerCollapsed}
          title=${this._pickerCollapsed?"Show file picker":"Hide file picker"}
          aria-label=${this._pickerCollapsed?"Show file picker":"Hide file picker"}
          aria-expanded=${!this._pickerCollapsed}>
          ${this._pickerCollapsed?"▶":"◀"}
        </button>
      </div>

      <div class="chat-panel-container">
        <div class="git-actions" role="toolbar" aria-label="Git actions">
          <button class="git-btn" @click=${this._copyDiff} title="Copy diff to clipboard"
            aria-label="Copy diff to clipboard">
            📋 Diff
          </button>
          <button class="git-btn" @click=${this._commitWithMessage}
            ?disabled=${this.streaming} title="Stage all, generate message, commit"
            aria-label="Auto-commit with generated message">
            💾 Commit
          </button>
          <button class="git-btn danger" @click=${this._requestReset}
            ?disabled=${this.streaming} title="Reset to HEAD"
            aria-label="Reset repository to HEAD">
            ⚠️ Reset
          </button>
          <span class="git-spacer"></span>
          <button class="session-btn" @click=${this._openHistory}
            title="Browse history" aria-label="Browse conversation history">📜</button>
          <button class="session-btn" @click=${this._newSession}
            title="New session (clear chat)" aria-label="Start new session">🗑️</button>
        </div>

        <chat-panel
          .messages=${this.messages}
          .streaming=${this.streaming}
          .repoFiles=${this._repoFiles}
          .selectedFiles=${new Set(this.selectedFiles)}
          @file-mention-click=${this._onFileMentionClick}
          @copy-to-prompt=${this._onCopyToPrompt}
        ></chat-panel>

        <url-chips
          .detected=${this._detectedUrls}
          .fetched=${this._fetchedUrls}
          .excluded=${this._excludedUrls}
          @urls-detected=${this._onUrlsDetected}
          @url-fetched=${this._onUrlFetched}
          @url-dismissed=${this._onUrlDismissed}
          @url-removed=${this._onUrlRemoved}
          @url-toggle-exclude=${this._onUrlToggleExclude}
          @url-view-content=${this._onUrlViewContent}
        ></url-chips>

        <chat-input
          .disabled=${this.streaming}
          .snippets=${this.snippets}
          .userMessageHistory=${this._getUserMessageHistory()}
          @send-message=${this._onSendMessage}
          @stop-streaming=${this._onStopStreaming}
          @urls-detected=${this._onUrlsDetected}
        ></chat-input>

        <token-hud></token-hud>
      </div>

      <history-browser
        .open=${this._historyOpen}
        @history-closed=${this._onHistoryClosed}
        @session-loaded=${this._onSessionLoaded}
        @insert-to-prompt=${this._onInsertToPrompt}
      ></history-browser>

      ${this._confirmAction?h`
        <div class="confirm-backdrop" @click=${this._cancelConfirm} role="presentation">
          <div class="confirm-dialog" role="alertdialog" aria-label="Confirm action"
            @click=${t=>t.stopPropagation()}>
            <p>${this._confirmAction.message}</p>
            <div class="confirm-btns">
              <button @click=${this._cancelConfirm}>Cancel</button>
              <button class="danger" @click=${()=>this._confirmAction.action()}>Reset</button>
            </div>
          </div>
        </div>
      `:b}
    `}}customElements.define("files-tab",Wo);const Zo=300;class Vo extends le(Z){static properties={_query:{type:String,state:!0},_results:{type:Array,state:!0},_loading:{type:Boolean,state:!0},_error:{type:String,state:!0},_ignoreCase:{type:Boolean,state:!0},_useRegex:{type:Boolean,state:!0},_wholeWord:{type:Boolean,state:!0},_focusedIdx:{type:Number,state:!0},_expandedFiles:{type:Object,state:!0}};static styles=te`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* ── Search bar ── */
    .search-bar {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
      background: var(--bg-secondary);
    }

    .search-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .search-input {
      flex: 1;
      padding: 6px 10px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 13px;
      font-family: var(--font-mono);
      outline: none;
    }
    .search-input:focus { border-color: var(--accent-primary); }
    .search-input::placeholder { color: var(--text-muted); }

    .option-row {
      display: flex;
      gap: 4px;
    }

    .option-btn {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
      white-space: nowrap;
      font-family: var(--font-mono);
    }
    .option-btn:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }
    .option-btn.active {
      background: var(--accent-primary);
      color: var(--bg-primary);
      border-color: var(--accent-primary);
    }

    .result-count {
      font-size: 11px;
      color: var(--text-muted);
      padding: 0 2px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Results ── */
    .results-container {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
      padding: 20px;
      text-align: center;
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--text-muted);
      font-size: 13px;
      gap: 8px;
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .error-state {
      padding: 12px 16px;
      color: var(--accent-error);
      font-size: 12px;
    }

    /* ── File group ── */
    .file-group {
      border-bottom: 1px solid var(--border-color);
    }

    .file-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
      background: var(--bg-elevated);
      transition: background var(--transition-fast);
      font-size: 12px;
    }
    .file-header:hover { background: var(--bg-surface); }

    .file-toggle {
      font-size: 10px;
      color: var(--text-muted);
      width: 14px;
      text-align: center;
      flex-shrink: 0;
    }

    .file-path {
      flex: 1;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--accent-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .file-path:hover { text-decoration: underline; }

    .match-count {
      font-size: 10px;
      color: var(--text-muted);
      flex-shrink: 0;
      padding: 1px 5px;
      background: var(--bg-surface);
      border-radius: 8px;
    }

    /* ── Match rows ── */
    .match-row {
      display: flex;
      align-items: flex-start;
      gap: 0;
      padding: 3px 12px 3px 32px;
      cursor: pointer;
      transition: background var(--transition-fast);
      font-size: 12px;
      font-family: var(--font-mono);
      line-height: 1.5;
      border-left: 2px solid transparent;
    }
    .match-row:hover { background: var(--bg-surface); }
    .match-row.focused {
      background: var(--bg-surface);
      border-left-color: var(--accent-primary);
    }

    .match-line-num {
      color: var(--text-muted);
      width: 40px;
      flex-shrink: 0;
      text-align: right;
      padding-right: 8px;
      font-size: 11px;
    }

    .match-content {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: pre;
      color: var(--text-secondary);
    }

    .match-highlight {
      background: rgba(79, 195, 247, 0.2);
      color: var(--accent-primary);
      font-weight: 600;
      border-radius: 2px;
    }

    /* ── Context lines ── */
    .context-row {
      display: flex;
      align-items: flex-start;
      padding: 1px 12px 1px 32px;
      font-size: 11px;
      font-family: var(--font-mono);
      line-height: 1.5;
      opacity: 0.5;
    }

    .context-line-num {
      color: var(--text-muted);
      width: 40px;
      flex-shrink: 0;
      text-align: right;
      padding-right: 8px;
      font-size: 10px;
    }

    .context-content {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: pre;
      color: var(--text-muted);
    }
  `;constructor(){super(),this._query="",this._results=[],this._loading=!1,this._error="",this._focusedIdx=-1,this._expandedFiles=new Set,this._debounceTimer=null,this._generation=0,this._ignoreCase=localStorage.getItem("ac-dc-search-ignoreCase")!=="false",this._useRegex=localStorage.getItem("ac-dc-search-useRegex")==="true",this._wholeWord=localStorage.getItem("ac-dc-search-wholeWord")==="true"}focus(){this.updateComplete.then(()=>{this.shadowRoot.querySelector(".search-input")?.focus()})}_onInput(e){this._query=e.target.value,this._scheduleSearch()}_scheduleSearch(){if(this._debounceTimer&&clearTimeout(this._debounceTimer),!this._query.trim()){this._results=[],this._error="",this._loading=!1,this._focusedIdx=-1;return}this._debounceTimer=setTimeout(()=>{this._debounceTimer=null,this._executeSearch()},Zo)}async _executeSearch(){if(!this.rpcConnected)return;const e=this._query.trim();if(!e)return;const t=++this._generation;this._loading=!0,this._error="";try{const i=await this.rpcExtract("Repo.search_files",e,this._wholeWord,this._useRegex,this._ignoreCase,4);if(t!==this._generation)return;Array.isArray(i)?(this._results=i,this._expandedFiles=new Set(i.map(s=>s.file))):this._results=[],this._focusedIdx=-1}catch(i){if(t!==this._generation)return;this._error=String(i),this._results=[]}finally{t===this._generation&&(this._loading=!1)}}_toggleOption(e){this[`_${e}`]=!this[`_${e}`],localStorage.setItem(`ac-dc-search-${e}`,String(this[`_${e}`])),this._query.trim()&&this._executeSearch()}_toggleFileExpand(e){const t=new Set(this._expandedFiles);t.has(e)?t.delete(e):t.add(e),this._expandedFiles=t}_getFlatMatches(){const e=[];for(const t of this._results)if(this._expandedFiles.has(t.file))for(const i of t.matches||[])e.push({file:t.file,match:i});return e}_getTotalMatches(){let e=0;for(const t of this._results)e+=(t.matches||[]).length;return e}_onKeyDown(e){if(e.key==="Escape"){if(this._query){this._query="",this._results=[],this._error="",this._focusedIdx=-1;const i=this.shadowRoot.querySelector(".search-input");i&&(i.value="")}return}const t=this._getFlatMatches();t.length!==0&&(e.key==="ArrowDown"?(e.preventDefault(),this._focusedIdx=Math.min(this._focusedIdx+1,t.length-1),this._scrollFocusedIntoView()):e.key==="ArrowUp"?(e.preventDefault(),this._focusedIdx=Math.max(this._focusedIdx-1,0),this._scrollFocusedIntoView()):e.key==="Enter"&&(e.preventDefault(),this._focusedIdx>=0&&this._focusedIdx<t.length?this._selectMatch(t[this._focusedIdx].file,t[this._focusedIdx].match):t.length>0&&this._selectMatch(t[0].file,t[0].match)))}_scrollFocusedIntoView(){this.updateComplete.then(()=>{const e=this.shadowRoot.querySelector(".match-row.focused");e&&e.scrollIntoView({block:"nearest"})})}_selectMatch(e,t){this.dispatchEvent(new CustomEvent("search-navigate",{detail:{path:e,line:t.line_num},bubbles:!0,composed:!0}))}_onFileHeaderClick(e){this.dispatchEvent(new CustomEvent("search-navigate",{detail:{path:e,line:1},bubbles:!0,composed:!0}))}_highlightMatch(e,t){if(!t||!e)return e;try{let i;if(this._useRegex)i=new RegExp(`(${t})`,this._ignoreCase?"gi":"g");else{const r=t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),o=this._wholeWord?`\\b${r}\\b`:r;i=new RegExp(`(${o})`,this._ignoreCase?"gi":"g")}const s=e.split(i);return s.length<=1?e:s.map((r,o)=>o%2===1?`<span class="match-highlight">${this._escapeHtml(r)}</span>`:this._escapeHtml(r)).join("")}catch{return this._escapeHtml(e)}}_escapeHtml(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}render(){const e=this._getTotalMatches(),t=this._results.length;return h`
      <div class="search-bar">
        <div class="search-row">
          <input type="text"
            class="search-input"
            placeholder="Search files..."
            aria-label="Search repository files"
            .value=${this._query}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
          >
          ${e>0?h`
            <span class="result-count" role="status" aria-live="polite">${e} match${e!==1?"es":""} in ${t} file${t!==1?"s":""}</span>
          `:b}
        </div>
        <div class="option-row" role="toolbar" aria-label="Search options">
          <button class="option-btn ${this._ignoreCase?"active":""}"
            @click=${()=>this._toggleOption("ignoreCase")}
            title="Ignore case"
            aria-label="Ignore case"
            aria-pressed=${this._ignoreCase}>Aa</button>
          <button class="option-btn ${this._useRegex?"active":""}"
            @click=${()=>this._toggleOption("useRegex")}
            title="Regular expression"
            aria-label="Use regular expression"
            aria-pressed=${this._useRegex}>.*</button>
          <button class="option-btn ${this._wholeWord?"active":""}"
            @click=${()=>this._toggleOption("wholeWord")}
            title="Whole word"
            aria-label="Whole word match"
            aria-pressed=${this._wholeWord}>ab</button>
        </div>
      </div>

      <div class="results-container" @keydown=${this._onKeyDown} tabindex="-1"
        role="region" aria-label="Search results">
        ${this._loading?h`
          <div class="loading-state"><span class="spinner"></span> Searching...</div>
        `:this._error?h`
          <div class="error-state">⚠ ${this._error}</div>
        `:this._results.length===0&&this._query.trim()?h`
          <div class="empty-state">No results for "${this._query}"</div>
        `:this._results.length===0?h`
          <div class="empty-state">Type to search across the repository</div>
        `:this._renderResults()}
      </div>
    `}_renderResults(){let e=0;return this._results.map(t=>{const i=this._expandedFiles.has(t.file),s=(t.matches||[]).length,r=i?(t.matches||[]).map(o=>{const a=e++;return this._renderMatch(t.file,o,a)}):(e+=s,b);return h`
        <div class="file-group">
          <div class="file-header" @click=${()=>this._toggleFileExpand(t.file)}>
            <span class="file-toggle">${i?"▾":"▸"}</span>
            <span class="file-path" @click=${o=>{o.stopPropagation(),this._onFileHeaderClick(t.file)}}>${t.file}</span>
            <span class="match-count">${s}</span>
          </div>
          ${r}
        </div>
      `})}_renderMatch(e,t,i){const s=i===this._focusedIdx,r=this._highlightMatch(t.line,this._query);return h`
      ${(t.context_before||[]).map(o=>h`
        <div class="context-row">
          <span class="context-line-num">${o.line_num}</span>
          <span class="context-content">${o.line}</span>
        </div>
      `)}
      <div class="match-row ${s?"focused":""}"
        @click=${()=>this._selectMatch(e,t)}>
        <span class="match-line-num">${t.line_num}</span>
        <span class="match-content" .innerHTML=${r}></span>
      </div>
      ${(t.context_after||[]).map(o=>h`
        <div class="context-row">
          <span class="context-line-num">${o.line_num}</span>
          <span class="context-content">${o.line}</span>
        </div>
      `)}
    `}}customElements.define("search-tab",Vo);class Xo extends le(Z){static properties={_data:{type:Object,state:!0},_loading:{type:Boolean,state:!0},_error:{type:String,state:!0},_expanded:{type:Object,state:!0}};static styles=te`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }

    .toolbar-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }

    .refresh-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast);
    }
    .refresh-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .loading-state, .error-state, .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
    }
    .error-state { color: var(--accent-error); }

    /* ── Budget bar ── */
    .budget-section {
      margin-bottom: 16px;
    }

    .budget-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 6px;
    }

    .budget-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .budget-value {
      font-size: 11px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
    }

    .budget-bar {
      height: 8px;
      background: var(--bg-surface);
      border-radius: 4px;
      overflow: hidden;
      display: flex;
    }

    .budget-segment {
      height: 100%;
      transition: width var(--transition-normal);
      min-width: 1px;
    }

    .seg-system { background: #7c4dff; }
    .seg-symbols { background: #00bcd4; }
    .seg-files { background: #4caf50; }
    .seg-urls { background: #ff9800; }
    .seg-history { background: #f44336; }
    .seg-free { background: transparent; }

    .budget-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 8px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--text-secondary);
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 2px;
      flex-shrink: 0;
    }

    /* ── Category cards ── */
    .category {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      margin-bottom: 8px;
      overflow: hidden;
      background: var(--bg-elevated);
    }

    .category-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
      transition: background var(--transition-fast);
    }
    .category-header:hover { background: var(--bg-surface); }

    .category-icon { font-size: 14px; flex-shrink: 0; }

    .category-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }

    .category-tokens {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
    }

    .category-toggle {
      font-size: 10px;
      color: var(--text-muted);
      width: 14px;
      text-align: center;
    }

    .category-body {
      border-top: 1px solid var(--border-color);
      padding: 8px 12px;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 0;
      font-size: 11px;
    }

    .detail-path {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
      margin-right: 8px;
    }

    .detail-tokens {
      font-family: var(--font-mono);
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .detail-note {
      font-size: 11px;
      color: var(--text-muted);
      font-style: italic;
      padding: 2px 0;
    }

    /* ── Session totals ── */
    .session-section {
      margin-top: 16px;
      padding: 10px 12px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
    }

    .session-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 6px;
    }

    .session-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 16px;
    }

    .session-stat {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
    }

    .stat-label { color: var(--text-secondary); }

    .stat-value {
      font-family: var(--font-mono);
      color: var(--text-primary);
    }

    /* ── Cache rate badge ── */
    .cache-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .cache-badge.good { background: rgba(76,175,80,0.15); color: #4caf50; }
    .cache-badge.ok { background: rgba(255,152,0,0.15); color: #ff9800; }
    .cache-badge.low { background: rgba(244,67,54,0.15); color: #f44336; }
  `;constructor(){super(),this._data=null,this._loading=!1,this._error="",this._expanded=new Set}connectedCallback(){super.connectedCallback(),this._boundRefresh=()=>this._refresh(),window.addEventListener("stream-complete",this._boundRefresh),window.addEventListener("compaction-event",this._boundRefresh)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-complete",this._boundRefresh),window.removeEventListener("compaction-event",this._boundRefresh)}onRpcReady(){this._refresh()}async _refresh(){if(this.rpcConnected){this._loading=!0,this._error="";try{const e=await this.rpcExtract("LLM.get_context_breakdown");e&&!e.error?this._data=e:this._error=e?.error||"No data returned"}catch(e){this._error=String(e)}finally{this._loading=!1}}}_toggle(e){const t=new Set(this._expanded);t.has(e)?t.delete(e):t.add(e),this._expanded=t}_fmt(e){return e==null?"0":e>=1e3?`${(e/1e3).toFixed(1)}k`:String(e)}_pct(e,t){return t?Math.max(.5,e/t*100):0}_cacheClass(e){return e>=60?"good":e>=30?"ok":"low"}render(){return h`
      <div class="toolbar">
        <span class="toolbar-title">Context Budget</span>
        ${this._data?h`
          <span class="cache-badge ${this._cacheClass(this._data.cache_hit_rate)}">
            Cache ${this._data.cache_hit_rate}%
          </span>
        `:b}
        <button class="refresh-btn" @click=${this._refresh} aria-label="Refresh context data">↻ Refresh</button>
      </div>
      <div class="content" role="region" aria-label="Context budget details">
        ${this._loading?h`<div class="loading-state">Loading...</div>`:this._error?h`<div class="error-state">⚠ ${this._error}</div>`:this._data?this._renderData():h`<div class="empty-state">No context data yet</div>`}
      </div>
    `}_renderData(){const e=this._data,t=e.breakdown,i=e.max_input_tokens||1,s=e.total_tokens||0,r=[{key:"system",tokens:t.system?.tokens||0,cls:"seg-system",label:"System"},{key:"symbols",tokens:t.symbol_map?.tokens||0,cls:"seg-symbols",label:"Symbols"},{key:"files",tokens:t.files?.tokens||0,cls:"seg-files",label:"Files"},{key:"urls",tokens:t.urls?.tokens||0,cls:"seg-urls",label:"URLs"},{key:"history",tokens:t.history?.tokens||0,cls:"seg-history",label:"History"}];return h`
      <div class="budget-section">
        <div class="budget-header">
          <span class="budget-label">Token Budget</span>
          <span class="budget-value">${this._fmt(s)} / ${this._fmt(i)}</span>
        </div>
        <div class="budget-bar" role="meter" aria-label="Token budget usage"
          aria-valuenow=${s} aria-valuemin="0" aria-valuemax=${i}>
          ${r.map(o=>h`
            <div class="budget-segment ${o.cls}"
              style="width:${this._pct(o.tokens,i)}%"
              title="${o.label}: ${this._fmt(o.tokens)}"
              aria-hidden="true"></div>
          `)}
        </div>
        <div class="budget-legend">
          ${r.filter(o=>o.tokens>0).map(o=>h`
            <span class="legend-item">
              <span class="legend-dot ${o.cls}"></span>
              ${o.label}: ${this._fmt(o.tokens)}
            </span>
          `)}
        </div>
      </div>

      ${this._renderCategory("system","⚙️","System Prompt",t.system?.tokens,null)}
      ${this._renderCategory("symbols","🗺️","Symbol Map",t.symbol_map?.tokens,()=>h`
          <div class="detail-note">${t.symbol_map?.files||0} files indexed</div>
        `)}
      ${this._renderCategory("files","📄","Active Files",t.files?.tokens,()=>(t.files?.items||[]).map(o=>h`
          <div class="detail-row">
            <span class="detail-path">${o.path}</span>
            <span class="detail-tokens">${this._fmt(o.tokens)}</span>
          </div>
        `))}
      ${this._renderCategory("urls","🔗","URL Context",t.urls?.tokens,()=>(t.urls?.items||[]).length===0?h`<div class="detail-note">No URLs fetched</div>`:(t.urls?.items||[]).map(o=>h`
            <div class="detail-row">
              <span class="detail-path" title="${o.url}">${o.display_name||o.url}</span>
              <span class="detail-tokens">${this._fmt(o.tokens)}</span>
            </div>
          `))}
      ${this._renderCategory("history","💬","History",t.history?.tokens,()=>h`
          ${t.history?.needs_summary?h`
            <div class="detail-note">⚠ Approaching compaction threshold</div>
          `:b}
          <div class="detail-note">Max: ${this._fmt(t.history?.max_tokens)} tokens</div>
        `)}

      ${e.session_totals?this._renderSessionTotals(e.session_totals):b}
    `}_renderCategory(e,t,i,s,r){const o=this._expanded.has(e),a=!!r;return h`
      <div class="category">
        <div class="category-header"
          @click=${()=>a&&this._toggle(e)}
          role=${a?"button":"presentation"}
          tabindex=${a?"0":b}
          aria-expanded=${a?o:b}
          @keydown=${l=>{a&&(l.key==="Enter"||l.key===" ")&&(l.preventDefault(),this._toggle(e))}}>
          <span class="category-icon" aria-hidden="true">${t}</span>
          <span class="category-name">${i}</span>
          <span class="category-tokens">${this._fmt(s)}</span>
          ${a?h`
            <span class="category-toggle" aria-hidden="true">${o?"▾":"▸"}</span>
          `:b}
        </div>
        ${o&&a?h`
          <div class="category-body" role="region" aria-label="${i} details">${r()}</div>
        `:b}
      </div>
    `}_renderSessionTotals(e){return h`
      <div class="session-section">
        <div class="session-title">Session Totals</div>
        <div class="session-grid">
          <div class="session-stat">
            <span class="stat-label">Prompt</span>
            <span class="stat-value">${this._fmt(e.prompt)}</span>
          </div>
          <div class="session-stat">
            <span class="stat-label">Completion</span>
            <span class="stat-value">${this._fmt(e.completion)}</span>
          </div>
          <div class="session-stat">
            <span class="stat-label">Cache Hit</span>
            <span class="stat-value">${this._fmt(e.cache_hit)}</span>
          </div>
          <div class="session-stat">
            <span class="stat-label">Cache Write</span>
            <span class="stat-value">${this._fmt(e.cache_write)}</span>
          </div>
        </div>
      </div>
    `}}customElements.define("context-tab",Xo);class Yo extends le(Z){static properties={_data:{type:Object,state:!0},_loading:{type:Boolean,state:!0},_error:{type:String,state:!0},_filter:{type:String,state:!0},_expandedTiers:{type:Object,state:!0}};static styles=te`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }

    .filter-input {
      flex: 1;
      padding: 5px 8px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
      font-family: var(--font-mono);
      outline: none;
    }
    .filter-input:focus { border-color: var(--accent-primary); }
    .filter-input::placeholder { color: var(--text-muted); }

    .refresh-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .refresh-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .loading-state, .error-state, .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
    }
    .error-state { color: var(--accent-error); }

    /* ── Tier block ── */
    .tier-block {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      margin-bottom: 10px;
      overflow: hidden;
      background: var(--bg-elevated);
    }

    .tier-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
      transition: background var(--transition-fast);
    }
    .tier-header:hover { background: var(--bg-surface); }

    .tier-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      color: white;
      flex-shrink: 0;
    }
    .tier-badge.L0 { background: #7c4dff; }
    .tier-badge.L1 { background: #00bcd4; }
    .tier-badge.L2 { background: #4caf50; }
    .tier-badge.L3 { background: #ff9800; }
    .tier-badge.active { background: #78909c; }

    .tier-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }

    .tier-tokens {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
    }

    .tier-cached {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 8px;
      background: rgba(76,175,80,0.15);
      color: #4caf50;
    }
    .tier-cached.uncached {
      background: rgba(120,144,156,0.15);
      color: #78909c;
    }

    .tier-toggle {
      font-size: 10px;
      color: var(--text-muted);
      width: 14px;
      text-align: center;
    }

    .tier-body {
      border-top: 1px solid var(--border-color);
      padding: 8px 12px;
    }

    /* ── Content groups ── */
    .content-group {
      margin-bottom: 8px;
    }
    .content-group:last-child { margin-bottom: 0; }

    .group-header {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .item-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      font-size: 11px;
    }

    .item-key {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
    }

    .item-n {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      flex-shrink: 0;
      min-width: 20px;
      text-align: right;
    }

    .item-tokens {
      font-family: var(--font-mono);
      color: var(--text-muted);
      flex-shrink: 0;
      font-size: 10px;
    }

    /* ── Stability bar (N progress) ── */
    .stability-bar {
      width: 40px;
      height: 6px;
      background: var(--bg-surface);
      border-radius: 3px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .stability-fill {
      height: 100%;
      border-radius: 3px;
      transition: width var(--transition-normal);
    }
    .stability-fill.low { background: #ff9800; }
    .stability-fill.mid { background: #00bcd4; }
    .stability-fill.high { background: #4caf50; }

    /* ── Recent changes ── */
    .changes-section {
      margin-top: 16px;
    }

    .changes-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .change-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
      font-size: 11px;
    }

    .change-dir {
      font-size: 13px;
      flex-shrink: 0;
    }

    .change-key {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .change-tiers {
      font-size: 10px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .no-changes {
      font-size: 11px;
      color: var(--text-muted);
      font-style: italic;
    }
  `;constructor(){super(),this._data=null,this._loading=!1,this._error="",this._filter="",this._expandedTiers=new Set}connectedCallback(){super.connectedCallback(),this._boundRefresh=()=>this._refresh(),window.addEventListener("stream-complete",this._boundRefresh),window.addEventListener("compaction-event",this._boundRefresh)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-complete",this._boundRefresh),window.removeEventListener("compaction-event",this._boundRefresh)}onRpcReady(){this._refresh()}async _refresh(){if(this.rpcConnected){this._loading=!0,this._error="";try{const e=await this.rpcExtract("LLM.get_context_breakdown");e&&!e.error?this._data=e:this._error=e?.error||"No data returned"}catch(e){this._error=String(e)}finally{this._loading=!1}}}_toggleTier(e){const t=new Set(this._expandedTiers);t.has(e)?t.delete(e):t.add(e),this._expandedTiers=t}_fmt(e){return e==null?"0":e>=1e3?`${(e/1e3).toFixed(1)}k`:String(e)}_matchesFilter(e){return this._filter?e.toLowerCase().includes(this._filter.toLowerCase()):!0}_stabilityClass(e,t){if(!t||t<=0)return"high";const i=e/t;return i>=.7?"high":i>=.4?"mid":"low"}_stabilityPct(e,t){return!t||t<=0?100:Math.min(100,e/t*100)}_stripPrefix(e){return e.startsWith("symbol:")||e.startsWith("file:")||e.startsWith("history:")?e.split(":",1)[1]||e.substring(e.indexOf(":")+1):e}render(){return h`
      <div class="toolbar">
        <input type="text" class="filter-input"
          placeholder="Filter items..."
          aria-label="Filter cache items"
          .value=${this._filter}
          @input=${e=>this._filter=e.target.value}>
        <button class="refresh-btn" @click=${this._refresh} aria-label="Refresh cache data">↻ Refresh</button>
      </div>
      <div class="content" role="region" aria-label="Cache tier details">
        ${this._loading?h`<div class="loading-state">Loading...</div>`:this._error?h`<div class="error-state">⚠ ${this._error}</div>`:this._data?this._renderData():h`<div class="empty-state">No cache data yet</div>`}
      </div>
    `}_renderData(){const e=this._data.blocks||[],t=this._data.promotions||[],i=this._data.demotions||[];return h`
      ${e.map(s=>this._renderTierBlock(s))}
      ${t.length>0||i.length>0?this._renderChanges(t,i):b}
    `}_renderTierBlock(e){const t=this._expandedTiers.has(e.name),i=e.name.replace(/\s+/g,""),s=(e.contents||[]).map(r=>{if(!r.items)return r;const o=r.items.filter(a=>this._matchesFilter(a.key));return{...r,items:o,count:o.length}}).filter(r=>r.count>0||r.type==="history");return this._filter&&s.length===0?b:h`
      <div class="tier-block">
        <div class="tier-header" @click=${()=>this._toggleTier(e.name)}
          role="button" tabindex="0" aria-expanded=${t}
          aria-label="${e.name} tier — ${this._fmt(e.tokens)} tokens, ${e.cached?"cached":"uncached"}"
          @keydown=${r=>{(r.key==="Enter"||r.key===" ")&&(r.preventDefault(),this._toggleTier(e.name))}}>
          <span class="tier-badge ${i}" aria-hidden="true">${e.name}</span>
          <span class="tier-name">${e.cached?"Cached":"Uncached"}</span>
          <span class="tier-tokens">${this._fmt(e.tokens)} tokens</span>
          <span class="tier-cached ${e.cached?"":"uncached"}">
            ${e.cached?"✓ cached":"○ live"}
          </span>
          <span class="tier-toggle" aria-hidden="true">${t?"▾":"▸"}</span>
        </div>
        ${t?h`
          <div class="tier-body">
            ${s.length===0?h`
              <span style="font-size:11px;color:var(--text-muted)">No items</span>
            `:s.map(r=>this._renderContentGroup(r))}
          </div>
        `:b}
      </div>
    `}_renderContentGroup(e){return h`
      <div class="content-group">
        <div class="group-header">${e.type} (${e.count})</div>
        ${e.type==="history"?h`
          <div style="font-size:11px;color:var(--text-muted)">
            ${this._fmt(e.tokens)} tokens
          </div>
        `:(e.items||[]).map(t=>h`
          <div class="item-row">
            <span class="item-key" title="${t.key}">${this._stripPrefix(t.key)}</span>
            <span class="item-n">${t.n}</span>
            <div class="stability-bar" role="meter" aria-label="Stability"
              aria-valuenow=${t.n} aria-valuemin="0"
              aria-valuemax=${t.threshold||12}
              title="N=${t.n}/${t.threshold||"?"}">
              <div class="stability-fill ${this._stabilityClass(t.n,t.threshold)}"
                style="width:${this._stabilityPct(t.n,t.threshold)}%" aria-hidden="true"></div>
            </div>
            <span class="item-tokens">${this._fmt(t.tokens)}</span>
          </div>
        `)}
      </div>
    `}_renderChanges(e,t){return h`
      <div class="changes-section">
        <div class="changes-title">Recent Changes</div>
        ${e.length===0&&t.length===0?h`
          <div class="no-changes">No tier changes since last request</div>
        `:b}
        ${e.map(i=>h`
          <div class="change-row">
            <span class="change-dir">📈</span>
            <span class="change-key" title="${i.key}">${this._stripPrefix(i.key)}</span>
            <span class="change-tiers">${i.from} → ${i.to}</span>
          </div>
        `)}
        ${t.map(i=>h`
          <div class="change-row">
            <span class="change-dir">📉</span>
            <span class="change-key" title="${i.key}">${this._stripPrefix(i.key)}</span>
            <span class="change-tiers">${i.from} → ${i.to}</span>
          </div>
        `)}
      </div>
    `}}customElements.define("cache-tab",Yo);const qt=[{key:"litellm",label:"LLM Config",icon:"🤖",lang:"json",reloadable:!0},{key:"app",label:"App Config",icon:"⚙️",lang:"json",reloadable:!0},{key:"system",label:"System Prompt",icon:"📝",lang:"markdown",reloadable:!1},{key:"system_extra",label:"System Extra",icon:"📎",lang:"markdown",reloadable:!1},{key:"compaction",label:"Compaction Skill",icon:"🗜️",lang:"markdown",reloadable:!1},{key:"snippets",label:"Snippets",icon:"✂️",lang:"json",reloadable:!1}];class Qo extends le(Z){static properties={_editing:{type:String,state:!0},_content:{type:String,state:!0},_configPath:{type:String,state:!0},_saving:{type:Boolean,state:!0},_toast:{type:Object,state:!0},_configInfo:{type:Object,state:!0}};static styles=te`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    /* ── Info banner ── */
    .info-banner {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 12px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      margin-bottom: 12px;
      font-size: 11px;
    }

    .info-row {
      display: flex;
      gap: 8px;
    }

    .info-label {
      color: var(--text-muted);
      min-width: 100px;
      flex-shrink: 0;
    }

    .info-value {
      color: var(--text-secondary);
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Config cards ── */
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }

    .config-card {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 12px;
      background: var(--bg-elevated);
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }
    .config-card:hover {
      background: var(--bg-surface);
      border-color: var(--accent-primary);
    }
    .config-card.active {
      border-color: var(--accent-primary);
      background: var(--bg-surface);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .card-icon { font-size: 18px; }

    .card-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .card-lang {
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      padding: 1px 5px;
      background: var(--bg-surface);
      border-radius: 3px;
      margin-left: auto;
    }

    /* ── Editor area ── */
    .editor-area {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: var(--bg-elevated);
    }

    .editor-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .editor-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }

    .editor-path {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 200px;
    }

    .editor-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 10px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .editor-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .editor-btn.primary {
      background: var(--accent-primary);
      color: white;
      border-color: var(--accent-primary);
    }
    .editor-btn.primary:hover {
      opacity: 0.9;
    }
    .editor-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .editor-textarea {
      width: 100%;
      min-height: 300px;
      padding: 12px;
      background: var(--bg-primary);
      color: var(--text-primary);
      border: none;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      resize: vertical;
      outline: none;
      tab-size: 2;
      box-sizing: border-box;
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      border-radius: var(--radius-md);
      font-size: 12px;
      font-weight: 500;
      z-index: 500;
      animation: toast-in 0.3s ease, toast-out 0.3s ease 2.7s;
      pointer-events: none;
    }
    .toast.success {
      background: rgba(76,175,80,0.9);
      color: white;
    }
    .toast.error {
      background: rgba(244,67,54,0.9);
      color: white;
    }
    .toast.info {
      background: rgba(33,150,243,0.9);
      color: white;
    }

    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes toast-out {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;constructor(){super(),this._editing=null,this._content="",this._configPath="",this._saving=!1,this._toast=null,this._configInfo=null,this._toastTimer=null}onRpcReady(){this._loadConfigInfo()}async _loadConfigInfo(){try{const e=await this.rpcExtract("Settings.get_config_info");this._configInfo=e}catch(e){console.warn("Failed to load config info:",e)}}async _openEditor(e){try{const t=await this.rpcExtract("Settings.get_config_content",e);if(t?.error){this._showToast(t.error,"error");return}this._editing=e,this._content=t.content||"",this._configPath=t.path||""}catch(t){this._showToast(String(t),"error")}}async _save(){if(!(!this._editing||this._saving)){this._saving=!0;try{const e=await this.rpcExtract("Settings.save_config_content",this._editing,this._content);e?.error?this._showToast(`Save failed: ${e.error}`,"error"):(this._showToast("Saved successfully","success"),qt.find(i=>i.key===this._editing)?.reloadable&&await this._reload(this._editing))}catch(e){this._showToast(`Save failed: ${e}`,"error")}finally{this._saving=!1}}}async _reload(e){try{let t;e==="litellm"?(t=await this.rpcExtract("Settings.reload_llm_config"),this._showToast(`Reloaded: model=${t?.model||"?"}`,"info")):e==="app"&&(t=await this.rpcExtract("Settings.reload_app_config"),this._showToast("App config reloaded","info"))}catch(t){this._showToast(`Reload failed: ${t}`,"error")}}_closeEditor(){this._editing=null,this._content="",this._configPath=""}_showToast(e,t="info"){this._toastTimer&&clearTimeout(this._toastTimer),this._toast={message:e,type:t},this._toastTimer=setTimeout(()=>{this._toast=null},3e3)}render(){return h`
      <div class="content">
        ${this._configInfo?this._renderInfo():b}
        ${this._renderCardGrid()}
        ${this._editing?this._renderEditor():b}
      </div>
      ${this._toast?h`
        <div class="toast ${this._toast.type}" role="alert" aria-live="assertive">${this._toast.message}</div>
      `:b}
    `}_renderInfo(){const e=this._configInfo;return h`
      <div class="info-banner">
        <div class="info-row">
          <span class="info-label">Model</span>
          <span class="info-value">${e.model||"—"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Smaller Model</span>
          <span class="info-value">${e.smaller_model||"—"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Config Dir</span>
          <span class="info-value" title="${e.config_dir||""}">${e.config_dir||"—"}</span>
        </div>
      </div>
    `}_renderCardGrid(){return h`
      <div class="card-grid" role="list" aria-label="Configuration files">
        ${qt.map(e=>h`
          <div class="config-card ${this._editing===e.key?"active":""}"
            role="listitem"
            tabindex="0"
            aria-label="Edit ${e.label}"
            aria-current=${this._editing===e.key?"true":b}
            @click=${()=>this._openEditor(e.key)}
            @keydown=${t=>{(t.key==="Enter"||t.key===" ")&&(t.preventDefault(),this._openEditor(e.key))}}>
            <div class="card-header">
              <span class="card-icon" aria-hidden="true">${e.icon}</span>
              <span class="card-label">${e.label}</span>
              <span class="card-lang">${e.lang}</span>
            </div>
          </div>
        `)}
      </div>
    `}_renderEditor(){const e=qt.find(t=>t.key===this._editing);return h`
      <div class="editor-area" role="region" aria-label="Editing ${e?.label||this._editing}">
        <div class="editor-toolbar" role="toolbar" aria-label="Editor actions">
          <span class="editor-title">${e?.icon||""} ${e?.label||this._editing}</span>
          <span class="editor-path" title="${this._configPath}">${this._configPath}</span>
          ${e?.reloadable?h`
            <button class="editor-btn" @click=${()=>this._reload(this._editing)}
              aria-label="Reload ${e?.label} configuration">
              ↻ Reload
            </button>
          `:b}
          <button class="editor-btn primary" @click=${this._save} ?disabled=${this._saving}
            aria-label="Save ${e?.label}">
            ${this._saving?"Saving...":"💾 Save"}
          </button>
          <button class="editor-btn" @click=${this._closeEditor} aria-label="Close editor">✕</button>
        </div>
        <textarea class="editor-textarea"
          aria-label="${e?.label||"Config"} content"
          .value=${this._content}
          @input=${t=>this._content=t.target.value}
          @keydown=${t=>{(t.ctrlKey||t.metaKey)&&t.key==="s"&&(t.preventDefault(),this._save())}}
          spellcheck="false"
        ></textarea>
      </div>
    `}}customElements.define("settings-tab",Qo);const as=[{id:"FILES",icon:"📁",label:"Files & Chat"},{id:"SEARCH",icon:"🔍",label:"Search"},{id:"CONTEXT",icon:"📊",label:"Context Budget"},{id:"CACHE",icon:"🗄️",label:"Cache Tiers"},{id:"SETTINGS",icon:"⚙️",label:"Settings"}];class _i extends le(Z){static properties={connected:{type:Boolean},error:{type:String},activeTab:{type:String,state:!0},minimized:{type:Boolean,state:!0},_dragging:{type:Boolean,state:!0},_positioned:{type:Boolean,state:!0},_visitedTabs:{type:Object,state:!0},_historyPercent:{type:Number,state:!0}};static KEYBOARD_SHORTCUTS={1:"FILES",2:"SEARCH",3:"CONTEXT",4:"CACHE",5:"SETTINGS"};static styles=te`
    :host {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      width: 50vw;
      min-width: 400px;
      height: 100vh;
      z-index: 10;
    }

    .dialog {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }

    :host(.positioned) {
      min-width: 300px;
      min-height: 200px;
    }

    :host(.minimized) {
      height: 48px !important;
      min-height: 48px;
    }

    :host(.minimized) .content,
    :host(.minimized) .history-bar {
      display: none;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      height: 48px;
      padding: 0 12px;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border-color);
      cursor: default;
      user-select: none;
      flex-shrink: 0;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 120px;
      cursor: pointer;
    }

    .header-left .title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .connection-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-error);
      flex-shrink: 0;
    }
    .connection-dot.connected { background: var(--accent-success); }

    .tabs {
      display: flex;
      gap: 2px;
      flex: 1;
      justify-content: center;
    }

    .tab-btn {
      background: none;
      border: none;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: 16px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
      position: relative;
    }

    .tab-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    .tab-btn.active {
      background: var(--bg-surface);
      color: var(--accent-primary);
    }

    .tab-btn .tooltip {
      display: none;
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      padding: 4px 8px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      font-size: 11px;
      white-space: nowrap;
      z-index: 100;
      color: var(--text-secondary);
      pointer-events: none;
    }

    .tab-btn:hover .tooltip { display: block; }

    .header-right {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 80px;
      justify-content: flex-end;
    }

    .header-btn {
      background: none;
      border: none;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: 14px;
      color: var(--text-secondary);
      transition: background var(--transition-fast);
    }

    .header-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    /* Content area */
    .content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .tab-panel {
      width: 100%;
      height: 100%;
      overflow: auto;
    }

    .tab-panel[hidden] {
      display: none;
    }

    .tab-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 14px;
    }

    .connecting-overlay {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
      color: var(--text-secondary);
      font-size: 14px;
      padding: 24px;
      text-align: center;
    }

    .connecting-brand {
      font-size: 3rem;
      font-weight: 700;
      color: var(--text-primary);
      opacity: 0.6;
      letter-spacing: 2px;
      font-family: var(--font-mono);
    }

    .connecting-spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid var(--border-color);
      border-top-color: var(--accent-primary);
      border-radius: 50%;
      animation: conn-spin 0.8s linear infinite;
    }

    @keyframes conn-spin { to { transform: rotate(360deg); } }

    .connecting-message {
      color: var(--text-muted);
      font-size: 13px;
      max-width: 300px;
      line-height: 1.5;
    }

    .connecting-error {
      color: var(--accent-error);
      font-size: 13px;
    }

    /* History bar */
    .history-bar {
      height: 3px;
      background: var(--bg-elevated);
      flex-shrink: 0;
    }

    .history-fill {
      height: 100%;
      background: var(--accent-success);
      transition: width var(--transition-normal), background var(--transition-normal);
      border-radius: 0 2px 2px 0;
    }

    .history-fill.warning { background: var(--accent-warning); }
    .history-fill.critical { background: var(--accent-error); }

    /* Resize handles — always rendered, positioned within the dialog */
    .resize-handle {
      position: absolute;
      z-index: 10;
    }
    /* Right edge always available (primary handle for left-docked state) */
    .resize-e { top: 8px; right: 0; bottom: 8px; width: 4px; cursor: e-resize; }

    /* Other edges only available after undocking */
    .resize-n { top: 0; left: 8px; right: 8px; height: 4px; cursor: n-resize; }
    .resize-s { bottom: 0; left: 8px; right: 8px; height: 4px; cursor: s-resize; }
    .resize-w { top: 8px; left: 0; bottom: 8px; width: 4px; cursor: w-resize; }
    .resize-ne { top: 0; right: 0; width: 8px; height: 8px; cursor: ne-resize; }
    .resize-nw { top: 0; left: 0; width: 8px; height: 8px; cursor: nw-resize; }
    .resize-se { bottom: 0; right: 0; width: 8px; height: 8px; cursor: se-resize; }
    .resize-sw { bottom: 0; left: 0; width: 8px; height: 8px; cursor: sw-resize; }
  `;constructor(){super(),this.activeTab="FILES",this.minimized=!1,this._dragging=!1,this._positioned=!1,this._visitedTabs=new Set(["FILES"]),this._dragStart=null,this._resizeDir=null,this._historyPercent=0,this._onMouseMove=this._onMouseMove.bind(this),this._onMouseUp=this._onMouseUp.bind(this),this._boundOnStreamComplete=this._onStreamCompleteForBar.bind(this),this._boundOnCompactionEvent=this._onCompactionEventForBar.bind(this),this._boundOnStateLoaded=this._onStateLoadedForBar.bind(this),this._boundOnSessionReset=this._onSessionResetForBar.bind(this)}connectedCallback(){super.connectedCallback(),this.addEventListener("search-navigate",this._onSearchNavigate.bind(this)),window.addEventListener("stream-complete",this._boundOnStreamComplete),window.addEventListener("compaction-event",this._boundOnCompactionEvent),window.addEventListener("state-loaded",this._boundOnStateLoaded),window.addEventListener("session-reset",this._boundOnSessionReset),this._boundOnGlobalKeyDown=this._onGlobalKeyDown.bind(this),window.addEventListener("keydown",this._boundOnGlobalKeyDown)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-complete",this._boundOnStreamComplete),window.removeEventListener("compaction-event",this._boundOnCompactionEvent),window.removeEventListener("state-loaded",this._boundOnStateLoaded),window.removeEventListener("session-reset",this._boundOnSessionReset),window.removeEventListener("keydown",this._boundOnGlobalKeyDown)}onRpcReady(){this._refreshHistoryBar()}_switchTab(e){this.activeTab=e,this._visitedTabs=new Set([...this._visitedTabs,e]),e==="SEARCH"&&this.updateComplete.then(()=>{this.shadowRoot.querySelector("search-tab")?.focus()})}_onGlobalKeyDown(e){if(e.altKey&&!e.ctrlKey&&!e.metaKey){const t=_i.KEYBOARD_SHORTCUTS[e.key];if(t){e.preventDefault(),this.minimized&&this._toggleMinimize(),this._switchTab(t);return}}e.altKey&&e.key==="m"&&!e.ctrlKey&&!e.metaKey&&(e.preventDefault(),this._toggleMinimize())}_onSearchNavigate(e){e.stopPropagation(),this.dispatchEvent(new CustomEvent("navigate-file",{detail:e.detail,bubbles:!0,composed:!0}))}_toggleMinimize(){this.minimized=!this.minimized,this.minimized?this.classList.add("minimized"):this.classList.remove("minimized")}_onHeaderMouseDown(e){e.target.closest("button")||(this._dragStart={x:e.clientX,y:e.clientY,moved:!1},document.addEventListener("mousemove",this._onMouseMove),document.addEventListener("mouseup",this._onMouseUp))}_onMouseMove(e){if(this._resizeDir){this._handleResize(e);return}if(!this._dragStart)return;const t=e.clientX-this._dragStart.x,i=e.clientY-this._dragStart.y;if(!this._dragStart.moved&&Math.abs(t)+Math.abs(i)<5)return;this._dragStart.moved=!0;const s=this;if(!this._positioned){const a=s.getBoundingClientRect();s.style.left=a.left+"px",s.style.top=a.top+"px",s.style.width=a.width+"px",s.style.height=a.height+"px",this._positioned=!0,this.classList.add("positioned"),this._dragStart.x=e.clientX,this._dragStart.y=e.clientY;return}const r=parseFloat(s.style.left)+t,o=parseFloat(s.style.top)+i;s.style.left=r+"px",s.style.top=o+"px",this._dragStart.x=e.clientX,this._dragStart.y=e.clientY}_onMouseUp(e){if(document.removeEventListener("mousemove",this._onMouseMove),document.removeEventListener("mouseup",this._onMouseUp),this._resizeDir){this._resizeDir=null;return}this._dragStart&&!this._dragStart.moved&&this._toggleMinimize(),this._dragStart=null}_onResizeStart(e,t){t.preventDefault(),t.stopPropagation();const i=this;if(!this._positioned){const s=i.getBoundingClientRect();i.style.left=s.left+"px",i.style.top=s.top+"px",i.style.width=s.width+"px",i.style.height=s.height+"px",this._positioned=!0,this.classList.add("positioned")}this._resizeDir=e,this._resizeStart={x:t.clientX,y:t.clientY,left:parseFloat(i.style.left),top:parseFloat(i.style.top),width:parseFloat(i.style.width),height:parseFloat(i.style.height)},document.addEventListener("mousemove",this._onMouseMove),document.addEventListener("mouseup",this._onMouseUp)}_handleResize(e){const t=this,i=this._resizeStart,s=e.clientX-i.x,r=e.clientY-i.y,o=this._resizeDir;let a=i.left,l=i.top,c=i.width,p=i.height;o.includes("e")&&(c=Math.max(300,i.width+s)),o.includes("w")&&(c=Math.max(300,i.width-s),a=i.left+i.width-c),o.includes("s")&&(p=Math.max(200,i.height+r)),o.includes("n")&&(p=Math.max(200,i.height-r),l=i.top+i.height-p),t.style.left=a+"px",t.style.top=l+"px",t.style.width=c+"px",t.style.height=p+"px"}_onStreamCompleteForBar(){this._refreshHistoryBar()}_onCompactionEventForBar(e){const t=e.detail?.event;t?.type==="compaction_complete"&&t.case!=="none"&&this._refreshHistoryBar()}_onStateLoadedForBar(){this._refreshHistoryBar()}_onSessionResetForBar(){this._refreshHistoryBar()}async _refreshHistoryBar(){if(this.rpcConnected)try{const e=await this.rpcExtract("LLM.get_history_status");e&&typeof e.percent=="number"&&(this._historyPercent=e.percent)}catch{}}_historyBarClass(){return this._historyPercent>90?"critical":this._historyPercent>75?"warning":""}render(){const e=as.find(t=>t.id===this.activeTab)?.label||"";return h`
      <div class="dialog" role="region" aria-label="Main dialog">

        <!-- Right edge always available (primary handle for left-docked state) -->
        <div class="resize-handle resize-e" aria-hidden="true" @mousedown=${t=>this._onResizeStart("e",t)}></div>

        ${this._positioned?h`
          <div class="resize-handle resize-n" aria-hidden="true" @mousedown=${t=>this._onResizeStart("n",t)}></div>
          <div class="resize-handle resize-s" aria-hidden="true" @mousedown=${t=>this._onResizeStart("s",t)}></div>
          <div class="resize-handle resize-w" aria-hidden="true" @mousedown=${t=>this._onResizeStart("w",t)}></div>
          <div class="resize-handle resize-ne" aria-hidden="true" @mousedown=${t=>this._onResizeStart("ne",t)}></div>
          <div class="resize-handle resize-nw" aria-hidden="true" @mousedown=${t=>this._onResizeStart("nw",t)}></div>
          <div class="resize-handle resize-se" aria-hidden="true" @mousedown=${t=>this._onResizeStart("se",t)}></div>
          <div class="resize-handle resize-sw" aria-hidden="true" @mousedown=${t=>this._onResizeStart("sw",t)}></div>
        `:""}

        <div class="header" @mousedown=${this._onHeaderMouseDown} role="toolbar" aria-label="Dialog controls">
          <div class="header-left" @click=${this._toggleMinimize}>
            <span class="connection-dot ${this.connected?"connected":""}"
              role="status"
              aria-label=${this.connected?"Connected to server":"Disconnected from server"}></span>
            <span class="title">${e}</span>
          </div>

          <nav class="tabs" role="tablist" aria-label="Main navigation">
            ${as.map((t,i)=>h`
              <button
                role="tab"
                class="tab-btn ${this.activeTab===t.id?"active":""}"
                aria-selected=${this.activeTab===t.id}
                aria-controls="tabpanel-${t.id}"
                id="tab-${t.id}"
                @click=${s=>{s.stopPropagation(),this._switchTab(t.id)}}
                title="${t.label} (Alt+${i+1})"
                aria-label="${t.label}"
              >
                ${t.icon}
                <span class="tooltip">${t.label}</span>
              </button>
            `)}
          </nav>

          <div class="header-right">
            <button class="header-btn" @click=${t=>{t.stopPropagation(),this._toggleMinimize()}}
              title=${this.minimized?"Maximize (Alt+M)":"Minimize (Alt+M)"}
              aria-label=${this.minimized?"Maximize dialog":"Minimize dialog"}
              aria-expanded=${!this.minimized}>
              ${this.minimized?"□":"─"}
            </button>
          </div>
        </div>

        <div class="content">
          ${this.connected?h`
            ${this._renderTabPanel("FILES",()=>h`
              <files-tab></files-tab>
            `)}
            ${this._renderTabPanel("SEARCH",()=>h`
              <search-tab></search-tab>
            `)}
            ${this._renderTabPanel("CONTEXT",()=>h`
              <context-tab></context-tab>
            `)}
            ${this._renderTabPanel("CACHE",()=>h`
              <cache-tab></cache-tab>
            `)}
            ${this._renderTabPanel("SETTINGS",()=>h`
              <settings-tab></settings-tab>
            `)}
          `:h`
            <div class="connecting-overlay">
              <div class="connecting-brand">AC⚡DC</div>
              ${this.error?h`
                <div class="connecting-error">${this.error}</div>
                <div class="connecting-spinner"></div>
                <div class="connecting-message">Attempting to reconnect to server...</div>
              `:h`
                <div class="connecting-spinner"></div>
                <div class="connecting-message">Connecting to server...</div>
              `}
            </div>
          `}
        </div>

        <div class="history-bar" role="progressbar"
          aria-label="History token usage"
          aria-valuenow=${this._historyPercent}
          aria-valuemin="0"
          aria-valuemax="100">
          <div class="history-fill ${this._historyBarClass()}"
               style="width: ${this._historyPercent}%"></div>
        </div>
      </div>
    `}_renderTabPanel(e,t){return this._visitedTabs.has(e)?h`
      <div class="tab-panel" role="tabpanel" id="tabpanel-${e}"
        aria-labelledby="tab-${e}" ?hidden=${this.activeTab!==e}>
        ${t()}
      </div>
    `:h`<div class="tab-panel" role="tabpanel" id="tabpanel-${e}"
        aria-labelledby="tab-${e}" ?hidden=${this.activeTab!==e}></div>`}}customElements.define("ac-dialog",_i);const Jo="modulepreload",ea=function(n){return"/AI-Coder-DeCoder/a7efe9c7/"+n},ls={},ta=function(e,t,i){let s=Promise.resolve();if(t&&t.length>0){let o=function(c){return Promise.all(c.map(p=>Promise.resolve(p).then(u=>({status:"fulfilled",value:u}),u=>({status:"rejected",reason:u}))))};document.getElementsByTagName("link");const a=document.querySelector("meta[property=csp-nonce]"),l=a?.nonce||a?.getAttribute("nonce");s=o(t.map(c=>{if(c=ea(c),c in ls)return;ls[c]=!0;const p=c.endsWith(".css"),u=p?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${c}"]${u}`))return;const g=document.createElement("link");if(g.rel=p?"stylesheet":Jo,p||(g.as="script"),g.crossOrigin="",g.href=c,l&&g.setAttribute("nonce",l),document.head.appendChild(g),p)return new Promise((_,v)=>{g.addEventListener("load",_),g.addEventListener("error",()=>v(new Error(`Unable to preload CSS for ${c}`)))})}))}function r(o){const a=new Event("vite:preloadError",{cancelable:!0});if(a.payload=o,window.dispatchEvent(a),!a.defaultPrevented)throw o}return s.then(o=>{for(const a of o||[])a.status==="rejected"&&r(a.reason);return e().catch(r)})},ia={".py":"python",".js":"javascript",".mjs":"javascript",".jsx":"javascript",".ts":"typescript",".tsx":"typescript",".json":"json",".html":"html",".htm":"html",".css":"css",".scss":"scss",".less":"less",".md":"markdown",".markdown":"markdown",".yaml":"yaml",".yml":"yaml",".xml":"xml",".svg":"xml",".sh":"shell",".bash":"shell",".zsh":"shell",".c":"c",".h":"c",".cpp":"cpp",".cc":"cpp",".cxx":"cpp",".hpp":"cpp",".hxx":"cpp",".java":"java",".go":"go",".rs":"rust",".rb":"ruby",".sql":"sql",".toml":"ini",".ini":"ini",".cfg":"ini",".txt":"plaintext"};function sa(n){if(!n)return"plaintext";const e=n.lastIndexOf(".");if(e<0)return"plaintext";const t=n.substring(e).toLowerCase();return ia[t]||"plaintext"}class na extends le(Z){static properties={_files:{type:Array,state:!0},_activeIndex:{type:Number,state:!0},_dirtyPaths:{type:Object,state:!0},_monacoReady:{type:Boolean,state:!0}};get activePath(){return this._activeIndex>=0&&this._activeIndex<this._files.length?this._files[this._activeIndex].path:""}static styles=te`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .container {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: var(--bg-primary);
    }

    /* ── Tab bar ── */
    .tab-bar {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 4px;
      height: 34px;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tab-bar::-webkit-scrollbar { display: none; }

    .tab {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
      cursor: pointer;
      border-right: 1px solid var(--border-color);
      white-space: nowrap;
      transition: background var(--transition-fast), color var(--transition-fast);
      flex-shrink: 0;
      user-select: none;
    }
    .tab:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .tab.active {
      background: var(--bg-primary);
      color: var(--text-primary);
      border-bottom: 2px solid var(--accent-primary);
    }

    .tab-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 0px 4px;
      border-radius: 3px;
      color: white;
    }
    .tab-badge.new { background: var(--accent-success); }
    .tab-badge.mod { background: var(--accent-warning); }

    .tab-dirty {
      color: var(--accent-warning);
      font-size: 14px;
      line-height: 1;
    }

    .tab-close {
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0 2px;
      border-radius: 2px;
      line-height: 1;
    }
    .tab-close:hover {
      color: var(--accent-error);
      background: rgba(239,83,80,0.15);
    }

    .tab-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      margin-left: auto;
      flex-shrink: 0;
    }

    .tab-action-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px 8px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
      white-space: nowrap;
    }
    .tab-action-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .tab-action-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .close-all-btn {
      background: none;
      border: none;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
    }
    .close-all-btn:hover { color: var(--accent-error); }

    /* ── Editor container ── */
    .editor-wrapper {
      flex: 1;
      position: relative;
      overflow: hidden;
      min-height: 0;
    }

    .editor-container {
      width: 100%;
      height: 100%;
      position: relative;
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
      position: relative;
    }

    .brand-watermark {
      position: absolute;
      left: 75%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: 8rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      opacity: 0.18;
      user-select: none;
      pointer-events: none;
      white-space: nowrap;
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
      gap: 8px;
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;constructor(){super(),this._files=[],this._activeIndex=-1,this._dirtyPaths=new Set,this._monacoReady=!1,this._monaco=null,this._editor=null,this._styleObserver=null,this._lspRegistered=!1,this._lspDisposables=[],this._onKeyDown=this._onKeyDown.bind(this)}connectedCallback(){super.connectedCallback(),document.addEventListener("keydown",this._onKeyDown)}disconnectedCallback(){super.disconnectedCallback(),document.removeEventListener("keydown",this._onKeyDown),this._disposeLspProviders(),this._disposeEditor(),this._styleObserver&&(this._styleObserver.disconnect(),this._styleObserver=null)}onRpcReady(){this._tryRegisterLsp()}get isDirty(){return this._dirtyPaths.size>0}get fileCount(){return this._files.length}async openFile(e){const{path:t,original:i="",modified:s="",is_new:r=!1,is_read_only:o=!1,is_config:a=!1,config_type:l="",real_path:c="",line:p=null}=e,u=this._files.findIndex(_=>_.path===t);if(u>=0){this._activeIndex=u,await this._ensureMonaco(),this._showActiveFile(),p&&this._revealLine(p),this._emitActiveFileChanged();return}const g={path:t,original:i,modified:s,is_new:r,is_read_only:!!o,is_config:!!a,config_type:l||"",real_path:c||"",savedContent:s};this._files=[...this._files,g],this._activeIndex=this._files.length-1,await this._ensureMonaco(),this._showActiveFile(),p&&this._revealLine(p),this._emitActiveFileChanged()}async openRepoFile(e,t=null){if(!this.rpcConnected)return;let i="",s="",r=!1;try{i=(await this.rpcExtract("Repo.get_file_content",e,"HEAD"))?.content||""}catch{}try{s=(await this.rpcExtract("Repo.get_file_content",e))?.content||"",!i&&s&&(r=!0)}catch{}await this.openFile({path:e,original:i,modified:s,is_new:r,is_read_only:!1,line:t})}async openConfigFile(e,t){if(this.rpcConnected)try{const i=await this.rpcExtract("Settings.get_config_content",e);if(i?.error){console.error("Failed to load config:",i.error);return}const s=i.content||"",r=`[config] ${t||e}`;await this.openFile({path:r,original:s,modified:s,is_config:!0,config_type:e,real_path:i.path||""})}catch(i){console.error("Failed to open config:",i)}}async openEditResults(e,t){if(!(!this.rpcConnected||!t?.length)){for(const i of t){let s="",r="",o=!1;try{s=(await this.rpcExtract("Repo.get_file_content",i,"HEAD"))?.content||""}catch{}try{r=(await this.rpcExtract("Repo.get_file_content",i))?.content||"",!s&&r&&(o=!0)}catch{continue}const a=this._files.findIndex(l=>l.path===i);if(a>=0){const l=[...this._files];l[a]={...l[a],original:s,modified:r,is_new:o,savedContent:r},this._files=l,this._dirtyPaths=new Set([...this._dirtyPaths].filter(c=>c!==i))}else this._files=[...this._files,{path:i,original:s,modified:r,is_new:o,is_read_only:!1,is_config:!1,config_type:"",real_path:"",savedContent:r}]}this._activeIndex=this._files.findIndex(i=>t.includes(i.path)),this._activeIndex<0&&this._files.length>0&&(this._activeIndex=0),await this._ensureMonaco(),this._showActiveFile(),this._emitActiveFileChanged()}}closeAll(){this._files=[],this._activeIndex=-1,this._dirtyPaths=new Set,this._disposeEditor(),this._emitActiveFileChanged()}async _ensureMonaco(){if(!this._monacoReady)try{const e=await ta(()=>import("./editor.main-EKIkdlC-.js").then(t=>t.e),__vite__mapDeps([0,1]));this._monaco=e,this._monacoReady=!0,this._tryRegisterLsp()}catch(e){console.error("Failed to load Monaco:",e)}}_createEditor(){if(!this._monaco||this._editor)return;const e=this.shadowRoot.querySelector(".editor-container");if(!e)return;this._injectMonacoStyles(),this._editor=this._monaco.editor.createDiffEditor(e,{theme:"vs-dark",automaticLayout:!0,readOnly:!1,originalEditable:!1,renderSideBySide:!0,enableSplitViewResizing:!0,minimap:{enabled:!1},scrollBeyondLastLine:!1,fontSize:13,fontFamily:"var(--font-mono), 'Fira Code', 'Cascadia Code', monospace",fixedOverflowWidgets:!0}),this._editor.getModifiedEditor().onDidChangeModelContent(()=>{this._onContentChanged()})}_injectMonacoStyles(){this.shadowRoot&&(this._syncAllStyles(),this._styleObserver||(this._styleObserver=new MutationObserver(()=>this._syncAllStyles()),this._styleObserver.observe(document.head,{childList:!0,subtree:!0,characterData:!0}),this._styleObserver.observe(document.body,{childList:!0,subtree:!0,characterData:!0})))}_syncAllStyles(){const e=this.shadowRoot;if(e){e.querySelectorAll("[data-monaco-styles]").forEach(t=>t.remove());for(const t of document.head.querySelectorAll('style, link[rel="stylesheet"]')){const i=t.cloneNode(!0);i.setAttribute("data-monaco-styles","true"),e.appendChild(i)}for(const t of document.body.querySelectorAll("style")){const i=t.cloneNode(!0);i.setAttribute("data-monaco-styles","true"),e.appendChild(i)}if(document.adoptedStyleSheets?.length>0&&(e.adoptedStyleSheets=[...document.adoptedStyleSheets]),!e.querySelector("#monaco-shadow-fixes")){const t=document.createElement("style");t.id="monaco-shadow-fixes",t.textContent=`
        /* Find widget z-index within shadow root */
        .monaco-editor .find-widget {
          z-index: 100;
        }

        /* Ensure both editor panes receive pointer events for scrolling */
        .monaco-diff-editor .editor.original,
        .monaco-diff-editor .editor.modified {
          pointer-events: auto;
        }

        /* Highlight line decoration (used by _revealLine) */
        .highlight-line {
          background: rgba(79, 195, 247, 0.15) !important;
        }
      `,e.appendChild(t)}}}_disposeEditor(){this._editor&&(this._editor.dispose(),this._editor=null)}_showActiveFile(){if(!this._monaco||this._activeIndex<0||this._activeIndex>=this._files.length)return;const e=this._files[this._activeIndex],t=sa(e.real_path||e.path);if(this._editor||this._createEditor(),!this._editor)return;const i=this._monaco.editor.createModel(e.original,t),s=this._monaco.editor.createModel(e.modified,t),r=this._editor.getModel();this._editor.setModel({original:i,modified:s}),r&&(r.original&&r.original.dispose(),r.modified&&r.modified.dispose()),this._editor.getModifiedEditor().updateOptions({readOnly:!!e.is_read_only}),requestAnimationFrame(()=>{this._editor&&this._editor.layout()}),setTimeout(()=>this._syncAllStyles(),500)}_revealLine(e){!this._editor||!e||requestAnimationFrame(()=>{const t=this._editor.getModifiedEditor();t.revealLineInCenter(e),t.setPosition({lineNumber:e,column:1});const i=t.deltaDecorations([],[{range:new this._monaco.Range(e,1,e,1),options:{isWholeLine:!0,className:"highlight-line",overviewRuler:{color:"#4fc3f7",position:this._monaco.editor.OverviewRulerLane.Full}}}]);setTimeout(()=>{this._editor&&t.deltaDecorations(i,[])},2e3)})}_onContentChanged(){if(this._activeIndex<0||this._activeIndex>=this._files.length)return;const e=this._files[this._activeIndex];if(e.is_read_only)return;const i=this._editor.getModifiedEditor().getValue(),s=new Set(this._dirtyPaths);i!==e.savedContent?s.add(e.path):s.delete(e.path),(s.size!==this._dirtyPaths.size||[...s].some(r=>!this._dirtyPaths.has(r)))&&(this._dirtyPaths=s,this._emitDirtyChanged())}_emitDirtyChanged(){this.dispatchEvent(new CustomEvent("dirty-changed",{detail:{isDirty:this.isDirty,dirtyPaths:[...this._dirtyPaths]},bubbles:!0,composed:!0}))}_emitActiveFileChanged(){this.dispatchEvent(new CustomEvent("active-file-changed",{detail:{path:this.activePath},bubbles:!0,composed:!0}))}async _saveActive(){this._activeIndex<0||await this._saveFile(this._activeIndex)}async _saveFile(e){const t=this._files[e];if(!t||t.is_read_only||!this._editor||this._activeIndex!==e)return;const s=this._editor.getModifiedEditor().getValue(),r=[...this._files];r[e]={...r[e],modified:s,savedContent:s},this._files=r;const o=new Set(this._dirtyPaths);o.delete(t.path),this._dirtyPaths=o,this._emitDirtyChanged(),this.dispatchEvent(new CustomEvent("file-save",{detail:{path:t.path,content:s,isConfig:t.is_config,configType:t.config_type,realPath:t.real_path},bubbles:!0,composed:!0}))}async _saveAll(){for(let e=0;e<this._files.length;e++)this._dirtyPaths.has(this._files[e].path)&&(this._activeIndex!==e&&(this._activeIndex=e,this._showActiveFile(),await new Promise(t=>requestAnimationFrame(t))),await this._saveFile(e))}_selectTab(e){e!==this._activeIndex&&(this._syncCurrentContent(),this._activeIndex=e,this._showActiveFile(),this._emitActiveFileChanged())}_closeTab(e,t){t&&t.stopPropagation();const i=this._files[e],s=this._files.filter((o,a)=>a!==e),r=new Set(this._dirtyPaths);r.delete(i.path),this._dirtyPaths=r,this._files=s,s.length===0?(this._activeIndex=-1,this._disposeEditor()):this._activeIndex>=s.length?(this._activeIndex=s.length-1,this._showActiveFile()):e<=this._activeIndex&&(this._activeIndex=Math.max(0,this._activeIndex-1),this._showActiveFile()),this._emitDirtyChanged(),this._emitActiveFileChanged()}_closeAll(){this.closeAll(),this._emitDirtyChanged()}_syncCurrentContent(){if(!this._editor||this._activeIndex<0||this._activeIndex>=this._files.length)return;const e=this._files[this._activeIndex];if(e.is_read_only)return;const i=this._editor.getModifiedEditor().getValue();if(i!==e.modified){const s=[...this._files];s[this._activeIndex]={...s[this._activeIndex],modified:i},this._files=s}}_onKeyDown(e){if(this._files.length!==0){if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault(),this._saveActive();return}(e.ctrlKey||e.metaKey)&&e.key==="w"&&this._files.length>0&&this._activeIndex>=0&&(e.preventDefault(),this._closeTab(this._activeIndex))}}render(){return h`
      <div class="container" role="region" aria-label="Diff viewer">
        ${this._files.length>0?h`
          ${this._renderTabBar()}
          <div class="editor-wrapper">
            ${this._monacoReady?h`
              <div class="editor-container" role="document" aria-label="Code diff editor"></div>
            `:h`
              <div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span> Loading editor...</div>
            `}
          </div>
        `:h`
          <div class="empty-state">
            <span class="brand-watermark">AC⚡DC</span>
          </div>
        `}
      </div>
    `}_renderTabBar(){const e=this._dirtyPaths.size>0;return h`
      <div class="tab-bar" role="tablist" aria-label="Open files">
        ${this._files.map((t,i)=>{const s=this._dirtyPaths.has(t.path),r=i===this._activeIndex,o=t.path.length>40?"…"+t.path.slice(-38):t.path;return h`
            <div class="tab ${r?"active":""}" role="tab"
              aria-selected=${r}
              aria-label="${t.path}${s?" (unsaved changes)":""}"
              tabindex=${r?"0":"-1"}
              @click=${()=>this._selectTab(i)}
              @keydown=${a=>{a.key==="ArrowRight"&&(a.preventDefault(),this._selectTab(Math.min(i+1,this._files.length-1))),a.key==="ArrowLeft"&&(a.preventDefault(),this._selectTab(Math.max(i-1,0)))}}>
              ${t.is_new?h`<span class="tab-badge new" aria-label="New file">NEW</span>`:b}
              ${!t.is_new&&t.original!==t.savedContent?h`<span class="tab-badge mod" aria-label="Modified">MOD</span>`:b}
              <span>${o}</span>
              ${s?h`<span class="tab-dirty" aria-hidden="true">●</span>`:b}
              <span class="tab-close" role="button" aria-label="Close ${t.path}"
                @click=${a=>this._closeTab(i,a)}>✕</span>
            </div>
          `})}
        <div class="tab-actions">
          ${e?h`
            <button class="tab-action-btn" @click=${this._saveAll}
              aria-label="Save all modified files">💾 Save All</button>
          `:b}
          <button class="close-all-btn" @click=${this._closeAll} title="Close all files"
            aria-label="Close all open files">✕ All</button>
        </div>
      </div>
    `}updated(e){super.updated(e),this._monacoReady&&!this._editor&&this._files.length>0&&this.updateComplete.then(()=>{this._createEditor(),this._showActiveFile()})}_tryRegisterLsp(){if(this._lspRegistered||!this._monacoReady||!this.rpcConnected||!this._monaco)return;this._lspRegistered=!0,console.log("[lsp] Registering Monaco language providers");const e=this._monaco,t=this,i=["python","javascript","typescript","c","cpp"];for(const s of i)this._lspDisposables.push(e.languages.registerHoverProvider(s,{provideHover:(r,o)=>t._provideHover(r,o)})),this._lspDisposables.push(e.languages.registerDefinitionProvider(s,{provideDefinition:(r,o)=>t._provideDefinition(r,o)})),this._lspDisposables.push(e.languages.registerReferenceProvider(s,{provideReferences:(r,o,a)=>t._provideReferences(r,o)})),this._lspDisposables.push(e.languages.registerCompletionItemProvider(s,{triggerCharacters:[".","_"],provideCompletionItems:(r,o)=>t._provideCompletions(r,o)}))}_disposeLspProviders(){for(const e of this._lspDisposables)try{e.dispose()}catch{}this._lspDisposables=[],this._lspRegistered=!1}_getPathForModel(e){if(!this._editor||this._activeIndex<0)return null;const t=this._files[this._activeIndex];if(!t||t.is_config)return null;const i=e.uri.toString(),s=this._editor.getModifiedEditor().getModel();if(s&&s.uri.toString()===i)return t.real_path||t.path;const r=this._editor.getOriginalEditor().getModel();return r&&r.uri.toString()===i?t.real_path||t.path:null}async _provideHover(e,t){const i=this._getPathForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLM.lsp_get_hover",i,t.lineNumber,t.column);return s?{contents:[{value:s,isTrusted:!0}]}:null}catch(s){return console.warn("[lsp] hover error:",s),null}}async _provideDefinition(e,t){const i=this._getPathForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLM.lsp_get_definition",i,t.lineNumber,t.column);if(!s||!s.file)return null;const r=s.file,o=s.range||{},a=o.start_line||1,l=Math.max(1,o.start_col||1);return r!==i?(setTimeout(()=>this.openRepoFile(r,a),0),null):[{uri:e.uri,range:new this._monaco.Range(a,l,o.end_line||a,Math.max(1,o.end_col||l))}]}catch(s){return console.warn("[lsp] definition error:",s),null}}async _provideReferences(e,t){const i=this._getPathForModel(e);if(!i)return null;try{const s=await this.rpcExtract("LLM.lsp_get_references",i,t.lineNumber,t.column);if(!s||!s.length)return null;const r=this._monaco;return s.map(o=>{const a=o.range||{},l=o.file||i,c=l===i?e.uri:r.Uri.parse(`file:///${l}`),p=a.start_line||o.line||1,u=Math.max(1,a.start_col||1);return{uri:c,range:new r.Range(p,u,a.end_line||p,Math.max(1,a.end_col||u))}})}catch(s){return console.warn("[lsp] references error:",s),null}}async _provideCompletions(e,t){const i=this._getPathForModel(e);if(!i)return null;try{const s=e.getWordUntilPosition(t),r=await this.rpcExtract("LLM.lsp_get_completions",i,t.lineNumber,t.column);if(!r||!r.length)return{suggestions:[]};const o=this._monaco,a=new o.Range(t.lineNumber,s.startColumn,t.lineNumber,s.endColumn),l={class:o.languages.CompletionItemKind.Class,function:o.languages.CompletionItemKind.Function,method:o.languages.CompletionItemKind.Method,variable:o.languages.CompletionItemKind.Variable,property:o.languages.CompletionItemKind.Property,module:o.languages.CompletionItemKind.Module,import:o.languages.CompletionItemKind.Reference};return{suggestions:r.map((p,u)=>({label:p.label,kind:l[p.kind]||o.languages.CompletionItemKind.Text,detail:p.detail||"",insertText:p.label,range:a,sortText:String(u).padStart(5,"0")}))}}catch(s){return console.warn("[lsp] completions error:",s),{suggestions:[]}}}}customElements.define("diff-viewer",na);class vi extends Z{static properties={_toasts:{type:Array,state:!0}};static styles=te`
    :host {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 10000;
      display: flex;
      flex-direction: column-reverse;
      gap: 8px;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: var(--radius-md, 8px);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, #e0e0e0);
      background: var(--bg-elevated, #2a2a2a);
      border: 1px solid var(--border-color, #444);
      box-shadow: var(--shadow-lg, 0 4px 12px rgba(0,0,0,0.3));
      pointer-events: auto;
      max-width: 380px;
      animation: toast-in 0.25s ease-out;
      transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .toast.fading {
      opacity: 0;
      transform: translateX(20px);
    }

    .toast.success { border-left: 3px solid var(--accent-success, #66bb6a); }
    .toast.error { border-left: 3px solid var(--accent-error, #ef5350); }
    .toast.warning { border-left: 3px solid var(--accent-warning, #ff9800); }
    .toast.info { border-left: 3px solid var(--accent-primary, #4fc3f7); }

    .toast-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    .toast-message {
      flex: 1;
      min-width: 0;
    }

    .toast-close {
      background: none;
      border: none;
      color: var(--text-muted, #888);
      cursor: pointer;
      font-size: 14px;
      padding: 0 2px;
      flex-shrink: 0;
      line-height: 1;
    }
    .toast-close:hover { color: var(--text-primary, #e0e0e0); }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateX(20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
  `;static ICONS={success:"✓",error:"✗",warning:"⚠",info:"ℹ"};constructor(){super(),this._toasts=[],this._idCounter=0,this._onToast=this._onToast.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("ac-toast",this._onToast)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("ac-toast",this._onToast);for(const e of this._toasts)e._timer&&clearTimeout(e._timer),e._fadeTimer&&clearTimeout(e._fadeTimer)}_onToast(e){const{message:t,type:i="info",duration:s=5e3}=e.detail||{};if(!t)return;const r=++this._idCounter,o={id:r,message:t,type:i,fading:!1};if(o._fadeTimer=setTimeout(()=>this._startFade(r),s),this._toasts=[...this._toasts,o],this._toasts.length>5){const a=this._toasts[0];this._dismiss(a.id)}}_startFade(e){this._toasts=this._toasts.map(t=>t.id===e?{...t,fading:!0}:t),setTimeout(()=>this._remove(e),300)}_dismiss(e){const t=this._toasts.find(i=>i.id===e);t&&(t._fadeTimer&&clearTimeout(t._fadeTimer),t._timer&&clearTimeout(t._timer)),this._startFade(e)}_remove(e){this._toasts=this._toasts.filter(t=>t.id!==e)}render(){return this._toasts.length===0?b:h`
      ${this._toasts.map(e=>h`
        <div class="toast ${e.type} ${e.fading?"fading":""}" role="alert" aria-live="assertive">
          <span class="toast-icon" aria-hidden="true">${vi.ICONS[e.type]||"ℹ"}</span>
          <span class="toast-message">${e.message}</span>
          <button class="toast-close" @click=${()=>this._dismiss(e.id)} aria-label="Dismiss notification">×</button>
        </div>
      `)}
    `}}customElements.define("toast-container",vi);class ra extends ms{static properties={connected:{type:Boolean,state:!0},error:{type:String,state:!0},_reconnecting:{type:Boolean,state:!0},_reconnectAttempt:{type:Number,state:!0}};static get styles(){return te`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        position: relative;
      }

      .diff-background {
        position: fixed;
        inset: 0;
        z-index: 0;
      }

      ac-dialog {
        /* Positioning managed by ac-dialog itself via :host styles */
      }

      .reconnect-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 32px;
        background: var(--accent-warning, #ff9800);
        color: #000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        z-index: 9999;
        gap: 8px;
      }

      .reconnect-spinner {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(0,0,0,0.3);
        border-top-color: #000;
        border-radius: 50%;
        animation: rspin 0.8s linear infinite;
      }

      @keyframes rspin { to { transform: rotate(360deg); } }
    `}constructor(){super(),this.connected=!1,this.error="",this._reconnecting=!1,this._reconnectAttempt=0,this._reconnectTimer=null,this.remoteTimeout=60;const t=new URLSearchParams(window.location.search).get("port")||"18080";this.serverURI=`ws://localhost:${t}`,this._onNavigateFile=this._onNavigateFile.bind(this),this._onFileSave=this._onFileSave.bind(this),this._onStreamCompleteForDiff=this._onStreamCompleteForDiff.bind(this),this._onActiveFileChanged=this._onActiveFileChanged.bind(this)}connectedCallback(){super.connectedCallback(),this.addClass(this,"AcApp"),this.addEventListener("navigate-file",this._onNavigateFile),this.addEventListener("file-save",this._onFileSave),this.addEventListener("active-file-changed",this._onActiveFileChanged),window.addEventListener("stream-complete",this._onStreamCompleteForDiff)}disconnectedCallback(){super.disconnectedCallback(),this.removeEventListener("navigate-file",this._onNavigateFile),this.removeEventListener("file-save",this._onFileSave),this.removeEventListener("active-file-changed",this._onActiveFileChanged),window.removeEventListener("stream-complete",this._onStreamCompleteForDiff)}setupDone(){console.log(`[ac-dc] Connected to ${this.serverURI}`),this.connected=!0,this.error="",this._reconnecting=!1,this._reconnectAttempt=0,this._reconnectTimer&&(clearTimeout(this._reconnectTimer),this._reconnectTimer=null),Se.set(this.call),this._loadInitialState(),this._wasDisconnected&&(this._wasDisconnected=!1,this._dispatchToast("Reconnected to server","success"))}setupSkip(){console.warn("[ac-dc] Connection failed or skipped");const e=this.connected;this.connected=!1,this.error="Connection failed",e&&(this._wasDisconnected=!0,Se.reset(),this._dispatchToast("Disconnected from server — reconnecting...","error")),this._scheduleReconnect()}remoteDisconnected(){console.warn("[ac-dc] Remote disconnected");const e=this.connected;this.connected=!1,e&&(this._wasDisconnected=!0,Se.reset(),this._dispatchToast("Server disconnected — reconnecting...","error")),this._scheduleReconnect()}_scheduleReconnect(){if(this._reconnectTimer)return;this._reconnecting=!0,this._reconnectAttempt++;const e=Math.min(1e3*Math.pow(2,this._reconnectAttempt-1),15e3);console.log(`[ac-dc] Reconnecting in ${e}ms (attempt ${this._reconnectAttempt})`),this._reconnectTimer=setTimeout(()=>{this._reconnectTimer=null;try{this.open()}catch(t){console.warn("[ac-dc] Reconnect attempt failed:",t),this._scheduleReconnect()}},e)}_dispatchToast(e,t="info"){window.dispatchEvent(new CustomEvent("ac-toast",{detail:{message:e,type:t},bubbles:!0}))}streamChunk(e,t){return this._dispatch("stream-chunk",{requestId:e,content:t}),!0}streamComplete(e,t){return this._dispatch("stream-complete",{requestId:e,result:t}),!0}compactionEvent(e,t){return this._dispatch("compaction-event",{requestId:e,event:t}),!0}filesChanged(e){return this._dispatch("files-changed",{selectedFiles:e}),!0}async _loadInitialState(){try{const e=await this._extract("LLM.get_current_state");this._dispatch("state-loaded",e)}catch(e){console.error("[ac-dc] Failed to load initial state:",e)}}async _extract(e,...t){const i=await this.call[e](...t);if(i&&typeof i=="object"){const s=Object.keys(i);if(s.length===1)return i[s[0]]}return i}_dispatch(e,t){window.dispatchEvent(new CustomEvent(e,{detail:t,bubbles:!0}))}_onNavigateFile(e){const{path:t,line:i}=e.detail||{};if(!t)return;const s=this.shadowRoot.querySelector("diff-viewer");s&&s.openRepoFile(t,i||null)}async _onFileSave(e){e.stopPropagation();const{path:t,content:i,isConfig:s,configType:r}=e.detail||{};if(t)if(s&&r)try{await this._extract("Settings.save_config_content",r,i)}catch(o){console.error("Config save failed:",o)}else try{await this._extract("Repo.write_file",t,i);try{await this._extract("Repo.stage_files",[t])}catch{}try{await this._extract("LLM.invalidate_symbol_files",[t])}catch{}this._dispatch("files-changed",{})}catch(o){console.error("File save failed:",o)}}_onStreamCompleteForDiff(e){const{result:t}=e.detail||{};if(!t?.files_modified?.length)return;const i=this.shadowRoot.querySelector("diff-viewer");i&&i.openEditResults(t.edit_results,t.files_modified)}_onActiveFileChanged(e){window.dispatchEvent(new CustomEvent("viewer-active-file",{detail:{path:e.detail?.path||""}}))}render(){return h`
      <div class="diff-background">
        <diff-viewer></diff-viewer>
      </div>
      <ac-dialog .connected=${this.connected} .error=${this.error}></ac-dialog>
      ${this._reconnecting?h`
        <div class="reconnect-banner">
          <span class="reconnect-spinner"></span>
          Reconnecting${this._reconnectAttempt>1?` (attempt ${this._reconnectAttempt})`:""}...
        </div>
      `:""}
      <toast-container></toast-container>
    `}}customElements.define("ac-app",ra);export{ta as _};
//# sourceMappingURL=index-Lv1RTP05.js.map
