var R=Object.defineProperty;var S=(w,e,a)=>e in w?R(w,e,{enumerable:!0,configurable:!0,writable:!0,value:a}):w[e]=a;var B=(w,e,a)=>S(w,typeof e!="symbol"?e+"":e,a);import{R as z,i as E,t as D,s as G,a as H,b as p,A as x,w as $}from"./index-C7j0XrdE.js";import"./monaco-B6MQ1wD3.js";import"./marked-IDzlF_wn.js";import"./hljs-gJDTAEaL.js";const v=["#4fc3f7","#50c878","#f59e0b","#f97316","#a78bfa","#f472b6","#2dd4bf","#60a5fa","#fb923c","#e879f9"],g=36,f=24,L=5,k=16;class C extends z(E){constructor(){super(),this._commits=[],this._branches=[],this._hasMore=!1,this._loading=!1,this._selectedCommit=null,this._selectedBranch=null,this._disambiguate=null,this._cleanCheck=null,this._starting=!1,this._showRemotes=this._loadBool("ac-dc-review-remotes",!1),this._hiddenBranches=new Set,this._visible=!1,this._error=null,this._laneMap=new Map,this._branchLanes=[],this._forkEdges=[],this._maxLane=0}_loadBool(e,a){try{const d=localStorage.getItem(e);return d===null?a:d==="true"}catch{return a}}show(){this._visible=!0,this._checkClean()}hide(){this._visible=!1,this._disambiguate=null,this.dispatchEvent(new CustomEvent("review-selector-close",{bubbles:!0,composed:!0}))}async _checkClean(){try{const e=await this.rpcExtract("LLMService.check_review_ready");this._cleanCheck=e,e!=null&&e.clean&&await this._loadGraph()}catch(e){this._error=e.message||"Failed to check working tree"}}async _loadGraph(e=0){if(!this._loading){this._loading=!0;try{const a=await this.rpcExtract("LLMService.get_commit_graph",100,e,this._showRemotes);if(a!=null&&a.error){this._error=a.error;return}e===0?(this._commits=a.commits||[],this._branches=a.branches||[]):this._commits=[...this._commits,...a.commits||[]],this._hasMore=a.has_more||!1,this._computeLayout()}catch(a){this._error=a.message||"Failed to load commit graph"}finally{this._loading=!1}}}async _loadMore(){this._loading||!this._hasMore||await this._loadGraph(this._commits.length)}async _toggleRemotes(){this._showRemotes=!this._showRemotes;try{localStorage.setItem("ac-dc-review-remotes",String(this._showRemotes))}catch{}this._selectedCommit=null,this._selectedBranch=null,this._disambiguate=null,await this._loadGraph(0)}_toggleBranchVisibility(e){const a=new Set(this._hiddenBranches);a.has(e)?a.delete(e):a.add(e),this._hiddenBranches=a}_computeLayout(){var c;const e=this._commits,a=this._branches;if(!e.length)return;const d=[...a].sort((s,o)=>s.is_current!==o.is_current?s.is_current?-1:1:s.is_remote!==o.is_remote?s.is_remote?1:-1:0),i=new Map,l=[];let m=0;for(const s of d){if(i.has(s.sha)){l.push({name:s.name,lane:i.get(s.sha),color:v[i.get(s.sha)%v.length],sha:s.sha,is_current:s.is_current,is_remote:s.is_remote});continue}const o=m++;i.set(s.sha,o),l.push({name:s.name,lane:o,color:v[o%v.length],sha:s.sha,is_current:s.is_current,is_remote:s.is_remote})}const t=new Map;for(let s=0;s<e.length;s++)t.set(e[s].sha,s);const r=new Map,n=new Set;for(const s of l){let o=s.sha;for(;o&&t.has(o)&&!n.has(o);){r.set(o,s.lane),n.add(o);const b=t.get(o);o=((c=e[b].parents)==null?void 0:c[0])||null}}for(const s of e)r.has(s.sha)||r.set(s.sha,m);const h=[];for(let s=0;s<e.length;s++){const o=e[s],b=r.get(o.sha)??0;for(let u=0;u<(o.parents||[]).length;u++){const _=o.parents[u],y=t.get(_);if(y===void 0)continue;const M=r.get(_)??0;(M!==b||u>0)&&h.push({fromRow:s,fromLane:b,toRow:y,toLane:M,isMerge:u>0})}}this._laneMap=r,this._branchLanes=l,this._forkEdges=h,this._maxLane=m}_onCommitClick(e,a,d){var r;const i=this._branchLanes.filter(n=>{const h=[n.sha],c=new Set;for(;h.length>0;){const s=h.pop();if(!s||c.has(s))continue;if(s===e.sha)return!0;c.add(s);const o=this._commits.findIndex(u=>u.sha===s);if(o<0)continue;const b=this._commits[o].parents||[];for(const u of b)h.push(u)}return!1});if(i.length===0){this._selectedCommit=e.sha,this._selectedBranch=((r=this._branchLanes[0])==null?void 0:r.name)||null,this._showBranchPopover(e,a,d,this._branchLanes);return}const l=this._laneMap.get(e.sha),t=i.find(n=>n.lane===l)||i[0];this._selectedCommit=e.sha,this._selectedBranch=t.name,this._showBranchPopover(e,a,d,i)}_showBranchPopover(e,a,d,i){var t;const l=(t=this.shadowRoot)==null?void 0:t.querySelector(".graph-scroll"),m=(l==null?void 0:l.getBoundingClientRect())||{left:0};this._disambiguate={candidates:i,x:d.clientX-m.left+20,y:a*g-((l==null?void 0:l.scrollTop)||0)+g/2}}_selectDisambiguatedBranch(e){this._selectedBranch=e,this._disambiguate=null}async _startReview(){if(!(!this._selectedCommit||!this._selectedBranch||this._starting)){this._starting=!0,this._error=null;try{const e=await this.rpcExtract("LLMService.start_review",this._selectedBranch,this._selectedCommit);if(e!=null&&e.error){this._error=e.error;return}this.dispatchEvent(new CustomEvent("review-started",{detail:e,bubbles:!0,composed:!0})),this.hide()}catch(e){this._error=e.message||"Failed to start review"}finally{this._starting=!1}}}_onHeaderMouseDown(e){if(e.target.closest("button"))return;e.preventDefault();const a=e.clientX,d=e.clientY,i=this.getBoundingClientRect(),l=i.left,m=i.top,t=n=>{const h=n.clientX-a,c=n.clientY-d;this.style.left=`${l+h}px`,this.style.top=`${m+c}px`,this.style.right="auto",this.style.bottom="auto",this.style.width=`${i.width}px`,this.style.height=`${i.height}px`},r=()=>{window.removeEventListener("mousemove",t),window.removeEventListener("mouseup",r)};window.addEventListener("mousemove",t),window.addEventListener("mouseup",r)}_onGraphScroll(e){const a=e.target;a.scrollTop+a.clientHeight>=a.scrollHeight-50&&this._loadMore(),this._disambiguate&&(this._disambiguate=null)}_onKeyDown(e){e.key==="Escape"&&(e.preventDefault(),this._disambiguate?this._disambiguate=null:this.hide())}_onBackdropClick(e){(e.target===e.currentTarget||e.target.classList.contains("backdrop"))&&this.hide()}_renderGraph(){const e=this._commits;if(!e.length)return p`<div class="warning-box"><span>No commits found</span></div>`;new Set(this._branchLanes.filter(t=>!this._hiddenBranches.has(t.name)).map(t=>t.name));const d=k+(this._maxLane+1)*f+12,i=Math.max(600,d+400),l=e.length*g+20,m=new Map;for(const t of this._branchLanes)m.has(t.sha)||m.set(t.sha,[]),m.get(t.sha).push(t);return p`
      <svg class="graph-svg" width="${i}" height="${l}"
           xmlns="http://www.w3.org/2000/svg">

        <!-- Vertical lane lines -->
        ${this._branchLanes.filter(t=>!this._hiddenBranches.has(t.name)).map(t=>{let r=e.length,n=0;for(let c=0;c<e.length;c++)this._laneMap.get(e[c].sha)===t.lane&&(r=Math.min(r,c),n=Math.max(n,c));if(r>n)return x;const h=k+t.lane*f+f/2;return $`<line
            x1="${h}" y1="${r*g+g/2}"
            x2="${h}" y2="${n*g+g/2}"
            stroke="${t.color}" stroke-width="2" opacity="0.4"
            stroke-dasharray="${t.is_remote?"4,3":"none"}"
          />`})}

        <!-- Fork/merge edges -->
        ${this._forkEdges.map(t=>{const r=k+t.fromLane*f+f/2,n=t.fromRow*g+g/2,h=k+t.toLane*f+f/2,c=t.toRow*g+g/2,s=(n+c)/2,o=v[t.fromLane%v.length];return $`<path
            d="M ${r} ${n} C ${r} ${s}, ${h} ${s}, ${h} ${c}"
            fill="none" stroke="${o}" stroke-width="1.5" opacity="0.5"
            stroke-dasharray="${t.isMerge?"4,3":"none"}"
          />`})}

        <!-- Commit nodes and text -->
        ${e.map((t,r)=>{var u;const n=this._laneMap.get(t.sha)??0,h=v[n%v.length],c=k+n*f+f/2,s=r*g+g/2,o=t.sha===this._selectedCommit,b=m.get(t.sha)||[];return $`
            <g class="commit-row ${o?"selected":""}"
               @click=${_=>this._onCommitClick(t,r,_)}>
              <rect class="row-bg" x="0" y="${r*g}"
                    width="${i}" height="${g}"
                    fill="transparent" />
              ${o?$`
                <circle cx="${c}" cy="${s}" r="${L+3}"
                        fill="none" stroke="${h}" stroke-width="2" opacity="0.5" />
              `:x}
              <circle cx="${c}" cy="${s}" r="${L}"
                      fill="${h}" />
              ${b.map((_,y)=>$`
                <rect x="${c+L+4+y*80}" y="${s-8}"
                      width="${75}" height="16" rx="3"
                      fill="${_.color}" opacity="0.2" />
                <text x="${c+L+7+y*80}" y="${s+3}"
                      font-size="9" fill="${_.color}" font-weight="600">
                  ${_.name.length>12?_.name.slice(0,11)+"…":_.name}
                </text>
              `)}
              <text x="${d}" y="${s-2}" font-size="11" fill="var(--text-primary)">
                <tspan font-family="var(--font-mono)" font-size="10" fill="var(--text-muted)">${t.short_sha}</tspan>
                <tspan dx="6">${((u=t.message)==null?void 0:u.length)>60?t.message.slice(0,59)+"…":t.message}</tspan>
              </text>
              <text x="${d}" y="${s+12}" font-size="9" fill="var(--text-muted)">
                ${t.author} · ${t.relative_date}
              </text>
            </g>
          `})}
      </svg>
    `}render(){var a,d;if(!this._visible)return x;if(this._cleanCheck&&!this._cleanCheck.clean)return p`
        <div class="backdrop" @click=${this._onBackdropClick}>
          <div class="dialog" role="dialog" aria-modal="true" aria-label="Code review — uncommitted changes warning"
               @keydown=${this._onKeyDown} tabindex="0">
            <div class="header" @mousedown=${this._onHeaderMouseDown}>
              <span class="header-title">📋 Code Review</span>
              <span class="header-spacer"></span>
              <button class="close-btn" @click=${()=>this.hide()} aria-label="Close">✕</button>
            </div>
            <div class="warning-box">
              <span class="icon">⚠️</span>
              <div>Working tree has uncommitted changes</div>
              <div>Cannot start a review with pending changes.<br>Please commit, stash, or discard changes first:</div>
              <pre>git stash\ngit commit -am "wip"\ngit checkout -- &lt;file&gt;</pre>
            </div>
            <div class="footer">
              <span class="header-spacer"></span>
              <button class="close-btn" @click=${()=>this.hide()}>Close</button>
            </div>
          </div>
        </div>
      `;let e=null;if(this._selectedCommit&&this._selectedBranch){const i=this._branchLanes.find(r=>r.name===this._selectedBranch),l=((a=i==null?void 0:i.sha)==null?void 0:a.slice(0,7))||"?",m=this._selectedCommit.slice(0,7);let t=0;if(i){let r=i.sha;const n=new Set;for(;r&&!n.has(r)&&r!==this._selectedCommit;){n.add(r),t++;const h=this._commits.findIndex(c=>c.sha===r);if(h<0)break;r=((d=this._commits[h].parents)==null?void 0:d[0])||null}}e={branch:this._selectedBranch,tipShort:l,baseShort:m,commitCount:t}}return p`
      <div class="backdrop" @click=${this._onBackdropClick}>
        <div class="dialog" @click=${i=>i.stopPropagation()} @keydown=${this._onKeyDown} tabindex="0">

          <div class="header" @mousedown=${this._onHeaderMouseDown}>
            <span class="header-title">📋 Code Review</span>
            <span class="header-spacer"></span>
            <button class="close-btn" @click=${()=>this.hide()}>✕</button>
          </div>

          <!-- Branch Legend -->
          <div class="legend">
            ${this._branchLanes.map(i=>p`
              <span
                class="legend-chip ${i.is_current?"current":""} ${i.is_remote?"remote":""} ${this._hiddenBranches.has(i.name)?"hidden":""}"
                @click=${()=>this._toggleBranchVisibility(i.name)}
                title="${i.name}">
                <span class="dot" style="background: ${i.color}"></span>
                ${i.name.length>20?i.name.slice(0,19)+"…":i.name}
              </span>
            `)}
            <button class="remote-toggle ${this._showRemotes?"active":""}"
              @click=${this._toggleRemotes} title="Toggle remote branches"
              aria-label="Toggle remote branches"
              aria-pressed="${this._showRemotes}">
              ⊙ remotes
            </button>
          </div>

          <!-- Graph -->
          <div class="graph-scroll" @scroll=${this._onGraphScroll}>
            ${this._loading&&this._commits.length===0?p`<div class="loading-sentinel">Loading commits...</div>`:this._error&&this._commits.length===0?p`<div class="warning-box">${this._error}</div>`:this._renderGraph()}
            ${this._hasMore?p`
              <div class="loading-sentinel">${this._loading?"Loading...":""}</div>
            `:x}

            <!-- Disambiguation popover -->
            ${this._disambiguate?p`
              <div class="disambiguate"
                   style="left: ${this._disambiguate.x}px; top: ${this._disambiguate.y}px"
                   @click=${i=>i.stopPropagation()}>
                ${this._disambiguate.candidates.map(i=>p`
                  <div class="disambiguate-item ${i.name===this._selectedBranch?"selected":""}"
                       @click=${()=>this._selectDisambiguatedBranch(i.name)}>
                    <span style="color: ${i.color}">●</span> ${i.name}
                  </div>
                `)}
              </div>
            `:x}
          </div>

          <!-- Footer -->
          <div class="footer">
            ${this._error&&this._commits.length>0?p`<span class="footer-hint" style="color: var(--accent-red)">${this._error}</span>`:x}
            ${e?p`
              <div class="review-summary">
                📋 Review: <strong>${e.branch}</strong><br>
                ${e.baseShort} → ${e.tipShort} (HEAD) · ${e.commitCount} commits
              </div>
              ${this._starting?p`
                <span class="starting-indicator">⟳ Starting review...</span>
              `:p`
                <button class="start-btn" @click=${this._startReview}
                  ?disabled=${this._starting}
                  aria-label="Start code review of ${this._selectedBranch||"selected branch"}">Start Review</button>
              `}
            `:p`
              <span class="footer-hint">Click a commit to select the review starting point</span>
            `}
          </div>

        </div>
      </div>
    `}}B(C,"properties",{_commits:{type:Array,state:!0},_branches:{type:Array,state:!0},_hasMore:{type:Boolean,state:!0},_loading:{type:Boolean,state:!0},_selectedCommit:{type:String,state:!0},_selectedBranch:{type:String,state:!0},_disambiguate:{type:Object,state:!0},_cleanCheck:{type:Object,state:!0},_starting:{type:Boolean,state:!0},_showRemotes:{type:Boolean,state:!0},_hiddenBranches:{type:Object,state:!0},_visible:{type:Boolean,state:!0},_error:{type:String,state:!0}}),B(C,"styles",[D,G,H`
    :host {
      display: block;
      position: fixed;
      z-index: 500;
      top: 15%;
      left: 20%;
      width: 60%;
      height: 70%;
      min-width: 400px;
      min-height: 300px;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: -1;
    }

    .dialog {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      cursor: grab;
      user-select: none;
    }
    .header:active { cursor: grabbing; }
    .header-title {
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--text-primary);
    }
    .header-spacer { flex: 1; }
    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1rem;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
    }
    .close-btn:hover {
      color: var(--text-primary);
      background: var(--bg-secondary);
    }

    /* Branch legend */
    .legend {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-primary);
      flex-wrap: wrap;
      overflow-x: auto;
    }
    .legend-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid var(--border-primary);
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      transition: opacity 0.15s;
    }
    .legend-chip.hidden { opacity: 0.35; }
    .legend-chip .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .legend-chip.current {
      border-color: var(--accent-primary);
      font-weight: 600;
    }
    .legend-chip.remote {
      border-style: dashed;
    }
    .remote-toggle {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.65rem;
      padding: 2px 6px;
      border-radius: 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .remote-toggle:hover { color: var(--text-primary); }
    .remote-toggle.active {
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }

    /* Graph area */
    .graph-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      position: relative;
    }
    .graph-svg {
      display: block;
    }

    /* Commit row (SVG overlay for text) */
    .commit-row {
      cursor: pointer;
    }
    .commit-row:hover rect.row-bg {
      fill: rgba(255, 255, 255, 0.03);
    }
    .commit-row.selected rect.row-bg {
      fill: rgba(79, 195, 247, 0.1);
    }

    /* Footer / action bar */
    .footer {
      padding: 10px 16px;
      border-top: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      min-height: 48px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .footer-hint {
      color: var(--text-muted);
      font-size: 0.8rem;
    }
    .review-summary {
      flex: 1;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    .review-summary strong {
      color: var(--accent-primary);
    }
    .start-btn {
      background: var(--accent-primary);
      border: none;
      color: var(--bg-primary);
      font-size: 0.8rem;
      font-weight: 600;
      padding: 6px 16px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .start-btn:hover { opacity: 0.9; }
    .start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Disambiguate popover */
    .disambiguate {
      position: absolute;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      padding: 4px 0;
      z-index: 10;
      min-width: 140px;
    }
    .disambiguate-item {
      padding: 6px 12px;
      font-size: 0.8rem;
      cursor: pointer;
      color: var(--text-primary);
    }
    .disambiguate-item:hover {
      background: var(--bg-secondary);
    }
    .disambiguate-item.selected {
      color: var(--accent-primary);
      font-weight: 600;
    }

    /* Warning message */
    .warning-box {
      padding: 24px;
      text-align: center;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-secondary);
      font-size: 0.85rem;
    }
    .warning-box .icon { font-size: 1.5rem; }
    .warning-box pre {
      background: var(--bg-primary);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.8rem;
      text-align: left;
    }

    /* Loading */
    .loading-sentinel {
      text-align: center;
      padding: 8px;
      color: var(--text-muted);
      font-size: 0.75rem;
    }

    .starting-indicator {
      color: var(--accent-primary);
      font-size: 0.8rem;
    }
  `]);customElements.define("ac-review-selector",C);export{C as AcReviewSelector};
