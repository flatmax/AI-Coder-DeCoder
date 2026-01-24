be lean where possible, but not too lean if it needs to be understandable
```code```
JRPC-OO lifecycle:
in javascript :
* setupDone() When the system is finished setup and ready to be used
* remoteDisconnected(uuid) Notify that a remote has been disconnected
* remoteIsUp() Remote is up but not ready to call see setupDone
In python (uses asyncio) :
* def remote_is_up(self): Remote is up
* def remote_disconnected(self, uuid): Notify that a remote has been disconnected
* def setup_done(self): When the system is finished setup and ready to be used

Usage :
Both client and server allow you to add an instance of a class and the methods are parsed out enabling it to be called.
py: def add_class(self, cls_instance, obj_name=None):
js: addClass(c, objName) - Typically called in connectedCallback
Once a class is added the class has :
this.getRemotes to get the remotes in js
self.get_remotes in py
this.getCall to get the call object with the method names available for RPC
self.get_call() (assume get_call exists) in py

JRPC-OO usage :
js promise : this.call['Class.method'](args)
py : self.get_call()['Class.method'](args)
Python can't use async functions with jrpc-oo

JRPC-OO response :
The return value is an object of {remote UUID : return data, ... }. utils.js function extractResponseData returns the data from the first UUID, as well as data for other forms.

webapp js :
customElements.define are separated from their classes - customElements.define calls are put in the `webapp` directory and the class implementation in the `webapp/src` directory or its sub-directories as required.

LitElement components combine standard custom element lifecycle methods with Lit's reactive update cycle for efficient DOM updates.

Key Lifecycle Methods:

constructor(): Called when the element is created; initializes properties and requests an update.

connectedCallback(): Invoked when the component is added to the DOM; initiates the first update cycle and establishes the renderRoot.

disconnectedCallback(): Called when the component is removed from the DOM; pauses updates and is the place to clean up event listeners.

shouldUpdate(changedProperties): Determines if an update should proceed based on changed properties (return true by default).

update(changedProperties): Reflects property values and calls render() to update the DOM.

render(): Returns the template result (e.g., html template literal) to update the component's DOM.

firstUpdated(changedProperties): Called once after the component's initial DOM update.

updated(changedProperties): Invoked after every completed component update.

updateComplete: A promise that resolves when the element has finished its current update cycle.

The reactive update cycle is asynchronous, batching property changes before the browser's next paint, ensuring efficient rendering.

JRPC-OO Class Registration                                                                                                                                                                                          
                                                                                                                                                                                                                      
  When using @flatmax/jrpc-oo to expose JavaScript classes to the Python backend, always pass the class name as a string to addClass():                                                                               
                                                                                                                                                                                                                      
  // CORRECT - survives minification                                                                                                                                                                                  
  this.addClass(this, 'PromptView');                                                                                                                                                                                  
                                                                                                                                                                                                                      
  // WRONG - breaks in production builds                                                                                                                                                                              
  this.addClass(this);                                                                                                                                                                                                
                                                                                                                                                                                                                      
  Why: Production bundlers (Vite/Rollup) minify class names (e.g., PromptView → vi). The JRPC library uses constructor.name to register methods like PromptView.streamChunk. When the server calls back to            
  PromptView.streamChunk, it won't find it because the method was registered as vi.streamChunk.                                                                                                                       
                                                                                                                                                                                                                      
  Applies to: Any class that:                                                                                                                                                                                         
  1. Extends JRPCClient (or uses JRPC mixins)                                                                                                                                                                         
  2. Has methods the Python backend calls via callbacks                                                                                                                                                               
  3. Will be included in production builds